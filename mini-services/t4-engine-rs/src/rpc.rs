//! THREAD 4 ENGINE (RUST TWIN) — the RPC surface (tiny_http).
//!
//! Route table mirrors the TS engine method-for-method. The twin serves
//! READS from the production db (read-only) and WRITES into its own
//! scratch chronicle — the doctrine is printed in /v1/health so nobody
//! mistakes the twin for the SSoT.
//!
//! Lifecycle per request (same order as the engine):
//!   body cap → route match → rate limit → auth → JSON body → handler
//!   → {ok:true,data} envelope → RpcError taxonomy on failure.

use std::io::Read;
use std::sync::Arc;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::auth::KeyCache;
use crate::canon::{ERA, CANON_VERSION, FAM, MAX_BODY_BYTES};
use crate::chain;
use crate::compile;
use crate::db;
use crate::ratelimit::{BucketName, Limiter};

pub struct Twin {
    pub prod: Connection,
    pub scratch: Connection,
    pub key: KeyCache,
    pub limiter: Limiter,
    pub boot_at: std::time::Instant,
}

pub enum AuthFailure {
    NoLock,
    Forbidden,
}

pub struct RpcError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
    pub hint: Option<String>,
}

impl RpcError {
    fn validation(message: impl Into<String>, hint: Option<String>) -> Self {
        RpcError { status: 422, code: "validation", message: message.into(), hint }
    }
    fn bad_request(message: impl Into<String>) -> Self {
        RpcError { status: 400, code: "badRequest", message: message.into(), hint: None }
    }
    fn unprocessable(message: impl Into<String>) -> Self {
        RpcError { status: 422, code: "unprocessable", message: message.into(), hint: None }
    }
}

fn ok_envelope(data: Value) -> (u16, String) {
    (200, json!({ "ok": true, "data": data }).to_string())
}

fn err_envelope(e: &RpcError) -> (u16, String) {
    let mut err = json!({ "code": e.code, "message": e.message });
    if let Some(h) = &e.hint {
        err["hint"] = json!(h);
    }
    (e.status, json!({ "ok": false, "error": err }).to_string())
}

#[derive(Clone, Copy, PartialEq)]
enum AuthLevel {
    Open,
    Locked,
}

pub fn serve(twin: Arc<Twin>) {
    let addr = format!("{}:{}", crate::canon::SERVE_HOSTNAME, crate::canon::SERVE_PORT);
    let server = match tiny_http::Server::http(&addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("t4-engine-rs: порт {} занят/ошибка — {e}", crate::canon::SERVE_PORT);
            std::process::exit(1);
        }
    };
    eprintln!("t4-engine-rs: слушаю {addr} (чтение — продакшн t4.db RO, запись — scratch-летопись)");

    for mut request in server.incoming_requests() {
        let twin = twin.clone();
        let method = request.method().to_string().to_uppercase();
        let url = request.url().to_string();
        let headers: Vec<(String, String)> = request
            .headers()
            .iter()
            .map(|h| {
                (
                    h.field.as_str().as_str().to_string(),
                    h.value.as_str().to_string(),
                )
            })
            .collect();
        let (path, query) = match url.split_once('?') {
            Some((p, q)) => (p.to_string(), q.to_string()),
            None => (url.clone(), String::new()),
        };
        let segments: Vec<String> = path
            .trim_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        let header = |name: &str| -> Option<String> {
            headers
                .iter()
                .find(|(f, _)| f.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.clone())
        };

        // 1. body cap BEFORE anything else
        let content_length = header("content-length")
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if content_length > MAX_BODY_BYTES {
            let (status, body) = err_envelope(&RpcError {
                status: 413,
                code: "payload",
                message: format!("тело {content_length} байт > лимита {MAX_BODY_BYTES} байт"),
                hint: None,
            });
            respond(request, status, body);
            continue;
        }

        let ip = Limiter::client_ip(&headers);

        // 2. route match
        let route = route_match(&method, &segments);
        let (route_key, bucket, auth_level) = match route {
            Some(r) => r,
            None => {
                let (status, body) = err_envelope(&RpcError::bad_request(format!(
                    "путь «{path}» вне allowlist — маршруты: /v1/health · /v1/meta · /v1/state · /v1/events · /v1/batches[/:slug] · /v1/chain/verify · POST /v1/compile · POST /v1/events"
                )));
                respond(request, status, body);
                continue;
            }
        };

        // 3. rate limit BEFORE auth (same order as the engine)
        if let Err(name) = twin.limiter.consume(bucket, &ip) {
            let spec = crate::ratelimit::bucket_spec(name);
            let (status, body) = err_envelope(&RpcError {
                status: 429,
                code: "rateLimit",
                message: format!(
                    "слишком много запросов — бакет {name:?} (ёмкость {}, пополнение {}/сек)",
                    spec.capacity as u32, spec.refill_per_sec
                ),
                hint: None,
            });
            respond(request, status, body);
            continue;
        }

        // 4. auth (header-only key, timing-safe)
        if auth_level == AuthLevel::Locked {
            let presented = header("x-commander-key").unwrap_or_default();
            if let Err(fail) = twin.key.check(presented.trim()) {
                let e = match fail {
                    AuthFailure::NoLock => RpcError {
                        status: 503,
                        code: "auth",
                        message: "commander-key не создан — мутации залочены (Залп 1 «Правда»)"
                            .into(),
                        hint: Some(
                            "создай ~/.t4/commander.key (32+ случайных символов) и передавай в заголовке x-commander-key"
                                .into(),
                        ),
                    },
                    AuthFailure::Forbidden => RpcError {
                        status: 403,
                        code: "auth",
                        message: "чужой или пустой commander-key — операция запрещена".into(),
                        hint: None,
                    },
                };
                let (status, body) = err_envelope(&e);
                respond(request, status, body);
                continue;
            }
        }

        // 5. read the body (POST) — borrow released before respond
        let mut body_text = String::new();
        if method == "POST" {
            let _ = request.as_reader().read_to_string(&mut body_text);
        }
        let body_bytes = body_text.clone();

        let result: Result<(u16, String), RpcError> = match route_key {
            RouteKey::Health => Ok(ok_envelope(health(&twin))),
            RouteKey::Meta => Ok(ok_envelope(meta())),
            RouteKey::State => Ok(ok_envelope(state(&twin))),
            RouteKey::EventsGet => Ok(ok_envelope(events(&twin.prod, &query))),
            RouteKey::Batches => {
                if segments.len() == 3 {
                    Ok(ok_envelope(batch_detail(&twin.prod, &segments[2])))
                } else {
                    Ok(ok_envelope(batches(&twin.prod)))
                }
            }
            RouteKey::ChainVerify => Ok(ok_envelope(chain_verify(&twin.prod))),
            RouteKey::Compile => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => compile_route(&twin, &body, header("idempotency-key")),
            },
            RouteKey::AppendEvent => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => append_event_route(&twin, &body),
            },
        };

        match result {
            Ok((status, body)) => respond(request, status, body),
            Err(e) => {
                let (status, body) = err_envelope(&e);
                respond(request, status, body);
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum RouteKey {
    Health,
    Meta,
    State,
    EventsGet,
    Batches,
    ChainVerify,
    Compile,
    AppendEvent,
}

fn route_match(method: &str, segs: &[String]) -> Option<(RouteKey, BucketName, AuthLevel)> {
    if segs.len() < 2 || segs[0] != "v1" {
        return None;
    }
    match (method, segs[1].as_str()) {
        ("GET", "health") => Some((RouteKey::Health, BucketName::Open, AuthLevel::Open)),
        ("GET", "meta") => Some((RouteKey::Meta, BucketName::Open, AuthLevel::Open)),
        ("GET", "state") => Some((RouteKey::State, BucketName::Read, AuthLevel::Open)),
        ("GET", "events") => Some((RouteKey::EventsGet, BucketName::Read, AuthLevel::Open)),
        ("GET", "chain") if segs.len() == 3 && segs[2] == "verify" => {
            Some((RouteKey::ChainVerify, BucketName::Read, AuthLevel::Open))
        }
        ("GET", "batches") => Some((RouteKey::Batches, BucketName::Read, AuthLevel::Open)),
        ("POST", "compile") => Some((RouteKey::Compile, BucketName::Compile, AuthLevel::Locked)),
        ("POST", "events") => Some((RouteKey::AppendEvent, BucketName::Mutation, AuthLevel::Locked)),
        _ => None,
    }
}

fn respond(request: tiny_http::Request, status: u16, body: String) {
    let response = tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"content-type"[..], &b"application/json; charset=utf-8"[..])
                .unwrap(),
        )
        .with_header(tiny_http::Header::from_bytes(&b"cache-control"[..], &b"no-store"[..]).unwrap())
        .with_header(tiny_http::Header::from_bytes(&b"x-engine"[..], &b"t4-engine-rs/1.0.0"[..]).unwrap());
    let _ = request.respond(response);
}

fn parse_json_body(text: &str) -> Result<Value, RpcError> {
    if text.trim().is_empty() {
        return Err(RpcError::bad_request("bad json (пустое тело)"));
    }
    serde_json::from_str(text).map_err(|_| RpcError::bad_request("bad json (тело не парсится)"))
}

/* ---------------- handlers ---------------- */

fn health(t: &Twin) -> Value {
    json!({
        "ok": true,
        "era": ERA,
        "engine": "t4-engine-rs",
        "version": "1.0.0",
        "canon": CANON_VERSION,
        "fam": FAM,
        "role": "Rust twin: читает продакшн-летопись (RO), пишет собственную scratch-летопись",
        "production": { "db": "t4-engine/data/t4.db", "mode": "read-only" },
        "scratch": { "db": "t4-engine-rs/data/t4-rs-scratch.db", "mode": "read-write" },
        "uptimeSec": t.boot_at.elapsed().as_secs(),
    })
}

fn meta() -> Value {
    let mut m = compile::meta_block();
    m["eventTypes"] = json!(crate::canon::EVENT_TYPES);
    m["verdictSources"] = json!(crate::canon::VERDICT_SOURCES);
    m["serve"]["port"] = json!(crate::canon::SERVE_PORT);
    m["twin"] = json!({
        "language": "rust",
        "parity": "chain formula + canonical serialization + compiler fingerprints — byte-exact vs t4-engine (bun)",
    });
    m
}

fn state(t: &Twin) -> Value {
    let prod_chain = chain::verify_chain(&t.prod);
    let scratch_chain = chain::verify_chain(&t.scratch);
    json!({
        "era": ERA,
        "canon": CANON_VERSION,
        "production": {
            "events": db::count_events(&t.prod),
            "chain": {
                "height": prod_chain.events,
                "head": prod_chain.head,
                "ok": prod_chain.ok,
                "problems": prod_chain.problems,
            },
            "nextSlug": format!("T4-{:02}", compile::next_batch_number(&t.prod)),
            "lastDelivered": last_delivered(&t.prod),
        },
        "scratch": {
            "events": db::count_events(&t.scratch),
            "chain": {
                "height": scratch_chain.events,
                "head": scratch_chain.head,
                "ok": scratch_chain.ok,
                "problems": scratch_chain.problems,
            },
            "nextSlug": format!("T4-{:02}", compile::next_batch_number(&t.scratch)),
        },
        "uptimeSec": t.boot_at.elapsed().as_secs(),
    })
}

fn last_delivered(conn: &Connection) -> Option<Value> {
    let row: Option<(String, String, Option<String>)> = conn
        .query_row(
            "SELECT slug, title, delivered_at FROM t4_batches WHERE status = 'delivered'
             ORDER BY delivered_at DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    row.map(|(slug, title, at)| json!({ "slug": slug, "title": title, "deliveredAt": at }))
}

fn events(conn: &Connection, query: &str) -> Value {
    let q: std::collections::HashMap<String, String> = query
        .split('&')
        .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect();
    let after = q.get("after").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let limit = q.get("limit").and_then(|v| v.parse::<u32>().ok()).unwrap_or(100);
    let typ = q.get("type").cloned();
    let rows = chain::read_events(conn, after, limit, typ.as_deref()).unwrap_or_default();
    let events: Vec<Value> = rows
        .iter()
        .map(|e| {
            json!({
                "seq": e.seq,
                "id": e.id,
                "at": e.at,
                "type": e.r#type,
                "summary": e.summary,
                "hash": e.hash,
                "prev": e.prev_hash,
                "data": e.data.as_ref().and_then(|d| serde_json::from_str::<Value>(d).ok()),
            })
        })
        .collect();
    json!({ "events": events, "returned": rows.len(), "total": db::count_events(conn) })
}

fn batches(conn: &Connection) -> Value {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT slug, title, status, exp_slots, hard_pass, diff_up, diff_down, created_at, delivered_at
         FROM t4_batches ORDER BY created_at DESC LIMIT 50",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(json!({
                "slug": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "status": r.get::<_, String>(2)?,
                "expSlots": r.get::<_, i64>(3)?,
                "hardPass": r.get::<_, i64>(4)? == 1,
                "diffUp": r.get::<_, i64>(5)?,
                "diffDown": r.get::<_, i64>(6)?,
                "createdAt": r.get::<_, String>(7)?,
                "deliveredAt": r.get::<_, Option<String>>(8)?,
            }))
        }) {
            for row in rows.flatten() {
                out.push(row);
            }
        }
    }
    json!({ "batches": out, "returned": out.len() })
}

fn batch_detail(conn: &Connection, slug: &str) -> Value {
    let row: Option<(String, String, String, String, String, i64, i64, i64, i64, i64, String)> = conn
        .query_row(
            "SELECT slug, title, theme, engine, status, slots_total, exp_slots, ab_pairs, hard_pass, diff_up, payload
             FROM t4_batches WHERE slug = ?1",
            [slug],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?,
                ))
            },
        )
        .ok();
    match row {
        None => json!({ "error": format!("batch {slug} не найден") }),
        Some((slug, title, theme, engine, status, slots, exp, ab, hard, diff_up, payload)) => {
            let plan: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            json!({
                "slug": slug, "title": title, "theme": theme, "engine": engine, "status": status,
                "slotsTotal": slots, "expSlots": exp, "abPairs": ab, "hardPass": hard == 1,
                "diffUp": diff_up, "plan": plan,
            })
        }
    }
}

fn chain_verify(conn: &Connection) -> Value {
    let v = chain::verify_chain(conn);
    json!({ "ok": v.ok, "events": v.events, "head": v.head, "problems": v.problems })
}

fn compile_route(
    t: &Twin,
    body: &Value,
    idem_header: Option<String>,
) -> Result<(u16, String), RpcError> {
    let idem = match idem_header {
        Some(k) if !k.is_empty() => {
            if !(8..=128).contains(&k.len())
                || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
            {
                return Err(RpcError::validation(
                    "Idempotency-Key: 8..128 символов [A-Za-z0-9._-]",
                    None,
                ));
            }
            let cached: Option<String> = t
                .scratch
                .query_row(
                    "SELECT response FROM t4_idempotency WHERE key = ?1 AND endpoint = 'compile'",
                    [&k],
                    |r| r.get(0),
                )
                .ok();
            if let Some(response) = cached {
                return Ok((200, response));
            }
            Some(k)
        }
        _ => None,
    };
    let req = compile::parse_request(body).map_err(|m| RpcError::validation(m, None))?;
    let outcome =
        compile::compile_batch(&t.scratch, &req, idem.as_deref()).map_err(|e| RpcError::unprocessable(e.0))?;
    Ok(ok_envelope(json!({
        "plan": outcome.plan_json,
        "event": { "id": outcome.event_id, "at": outcome.event_at, "seq": outcome.event_seq },
        "receipts": outcome.plan_json.get("receipts").cloned().unwrap_or(Value::Null),
        "idempotentReplay": false,
        "twinNote": "скомпилировано в scratch-летописи twin'а; продакшн не тронут",
    })))
}

fn append_event_route(t: &Twin, body: &Value) -> Result<(u16, String), RpcError> {
    let obj = body
        .as_object()
        .ok_or_else(|| RpcError::validation("events: тело должно быть JSON-объектом (strict)", None))?;
    for k in obj.keys() {
        if k != "type" && k != "summary" && k != "data" {
            return Err(RpcError::validation(
                format!("events: тело не прошло Zod (strict) — лишнее поле «{k}»"),
                None,
            ));
        }
    }
    let typ = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let summary = obj.get("summary").and_then(|v| v.as_str()).unwrap_or("");
    if typ.is_empty() || summary.is_empty() {
        return Err(RpcError::validation(
            "events: тело не прошло Zod (strict) — type и summary обязательны",
            None,
        ));
    }
    let data = obj.get("data");
    let tx = t
        .scratch
        .unchecked_transaction()
        .map_err(|e| RpcError::unprocessable(e.to_string()))?;
    let evt = chain::append_event_tx(
        &tx,
        &chain::AppendInput { typ, summary, data, batch_slug: None },
    )
    .map_err(|m| RpcError::unprocessable(m))?;
    tx.commit().map_err(|e| RpcError::unprocessable(e.to_string()))?;
    Ok(ok_envelope(json!({ "id": evt.id, "at": evt.at, "type": evt.r#type, "chainHead": evt.hash })))
}
