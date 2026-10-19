//! THREAD 4 ENGINE (RUST TWIN) — the RPC surface (tiny_http).
//!
//! Route table mirrors the TS engine method-for-method (+ Фаза 2: live SSE,
//! theme expand/check, deliver/void — зеркальная семантика handlers.ts).
//! The twin serves READS from the production db (read-only) and WRITES into
//! its own scratch chronicle — the doctrine is printed in /v1/health so
//! nobody mistakes the twin for the SSoT.
//!
//! Lifecycle per request (same order as the engine):
//!   body cap → route match → rate limit → auth → JSON body → handler
//!   → {ok:true,data} envelope → RpcError taxonomy on failure.
//! SSE (/v1/live) уходит в отдельный поток ДО auth — долгоживущий поток
//! не должен занимать акцепт-цикл (heartbeat 15с, жизнь ≤600с).

use std::sync::Arc;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::auth::KeyCache;
use crate::canon::{ERA, CANON_VERSION, FAM, MAX_BODY_BYTES};
use crate::chain;
use crate::compile;
use crate::db;
use crate::live;
use crate::live::{BLOCK_COMPILE, BLOCK_DELIVER, BLOCK_EXPAND, BLOCK_GATES, BLOCK_SYSTEM};
use crate::pipeline;
use crate::ratelimit::{BucketName, Limiter};
use crate::theme;

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
    fn not_found(message: impl Into<String>) -> Self {
        RpcError { status: 404, code: "notFound", message: message.into(), hint: None }
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
    eprintln!("t4-engine-rs: слушаю {addr} (чтение — продакшн t4.db RO, запись — scratch-летопись; SSE /v1/live — поток в отдельном потоке)");

    live::info(BLOCK_SYSTEM, "twin поднят: продакшн RO, scratch RW, live-шина заряжена");

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
                    "путь «{path}» вне allowlist — маршруты: /v1/health · /v1/meta · /v1/state · /v1/events · /v1/live · /v1/batches[/:slug] · /v1/chain/verify · /v1/theme/expand · /v1/theme/check · /v1/pipeline · POST /v1/pipeline/auto · POST /v1/pipeline/abort · POST /v1/pipeline/stage/:имя · POST /v1/compile · POST /v1/events · POST /v1/gates · POST /v1/batches/:slug/deliver · POST /v1/batches/:slug/void"
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

        // 3b. SSE: долгоживущий поток живёт в СВОЁМ потоке — акцепт-цикл свободен
        if route_key == RouteKey::Live {
            let after = query_map(&query)
                .get("after")
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            std::thread::spawn(move || respond_sse(request, after));
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
            /* Сборки воркфлоу: scratch-летопись twin'а (Riptide-эра). Прод и
             * scratch делят формат слага T4-NN — этот маршрут честно отдаёт
             * ТОЛЬКО собственные сборки twin'а, чтобы дубли-слаги двух
             * пространств были видимы и различимы в UI (кнопка «Сборка»). */
            RouteKey::ScratchBatches => Ok(ok_envelope(batches(&twin.scratch))),
            RouteKey::ScratchBatchDetail => scratch_batch_detail(&twin, &segments[3]),
            RouteKey::ChainVerify => Ok(ok_envelope(chain_verify(&twin.prod))),
            RouteKey::Compile => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => compile_route(&twin, &body, header("idempotency-key")),
            },
            RouteKey::AppendEvent => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => append_event_route(&twin, &body),
            },
            RouteKey::ThemeExpand => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => theme_expand_route(&body),
            },
            RouteKey::ThemeCheck => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => theme_check_route(&body),
            },
            RouteKey::Deliver => deliver_route(&twin, &segments[2]),
            RouteKey::Void => void_route(&twin, &segments[2]),
            RouteKey::Gates => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => {
                    let _g = pipeline::chain_lock();
                    gates_route(&twin, &body)
                }
            },
            RouteKey::PipelineGet => Ok(ok_envelope(pipeline::state_snapshot())),
            RouteKey::PipelineAuto => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => pipeline_auto_route(&body),
            },
            RouteKey::PipelineStage => match parse_json_body(&body_bytes) {
                Err(e) => Err(e),
                Ok(body) => pipeline_stage_route(&segments[3], &body),
            },
            RouteKey::PipelineAbort => pipeline_abort_route(),
            RouteKey::Live => unreachable!("SSE обрабатывается до auth"),
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
    Live,
    ThemeExpand,
    ThemeCheck,
    Deliver,
    Void,
    Gates,
    ScratchBatches,
    ScratchBatchDetail,
    PipelineGet,
    PipelineAuto,
    PipelineStage,
    PipelineAbort,
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
        ("GET", "live") => Some((RouteKey::Live, BucketName::Open, AuthLevel::Open)),
        ("GET", "chain") if segs.len() == 3 && segs[2] == "verify" => {
            Some((RouteKey::ChainVerify, BucketName::Read, AuthLevel::Open))
        }
        ("GET", "batches") => Some((RouteKey::Batches, BucketName::Read, AuthLevel::Open)),
        /* сборки воркфлоу: собственные батчи twin'а из scratch-летописи */
        ("GET", "scratch") if segs.len() == 3 && segs[2] == "batches" => {
            Some((RouteKey::ScratchBatches, BucketName::Read, AuthLevel::Open))
        }
        /* план сборки со слотами: воркфлоу-витрина «Сборка» открывает
         * содержимое compiled-батча (слоты-промпты, палитры, OC-темы) —
         * «сборщик» без содержимого не сборщик (2026-10-20) */
        ("GET", "scratch") if segs.len() == 4 && segs[2] == "batches" => {
            Some((RouteKey::ScratchBatchDetail, BucketName::Read, AuthLevel::Open))
        }
        ("POST", "compile") => Some((RouteKey::Compile, BucketName::Compile, AuthLevel::Locked)),
        ("POST", "events") => Some((RouteKey::AppendEvent, BucketName::Mutation, AuthLevel::Locked)),
        ("POST", "theme") if segs.len() == 3 && segs[2] == "expand" => {
            Some((RouteKey::ThemeExpand, BucketName::Open, AuthLevel::Open))
        }
        ("POST", "theme") if segs.len() == 3 && segs[2] == "check" => {
            Some((RouteKey::ThemeCheck, BucketName::Open, AuthLevel::Open))
        }
        ("POST", "batches") if segs.len() == 4 && segs[3] == "deliver" => {
            Some((RouteKey::Deliver, BucketName::Mutation, AuthLevel::Locked))
        }
        ("POST", "batches") if segs.len() == 4 && segs[3] == "void" => {
            Some((RouteKey::Void, BucketName::Mutation, AuthLevel::Locked))
        }
        /* текст-батарея файл-эры (этапы 0-1, textgates.rs): файлы репо RO,
         * продакшн-контекст RO, записи — только scratch-слаги twin'а */
        ("POST", "gates") => Some((RouteKey::Gates, BucketName::Mutation, AuthLevel::Locked)),
        /* КОНВЕЙЕР (cutover-эра): снимок прогона открыт, запуск/стоп —
         * только командир. Слаг этапа: theme|compile|build|scribe|deliver. */
        ("GET", "pipeline") => Some((RouteKey::PipelineGet, BucketName::Read, AuthLevel::Open)),
        ("POST", "pipeline") if segs.len() == 3 && segs[2] == "auto" => {
            Some((RouteKey::PipelineAuto, BucketName::Mutation, AuthLevel::Locked))
        }
        ("POST", "pipeline") if segs.len() == 3 && segs[2] == "abort" => {
            Some((RouteKey::PipelineAbort, BucketName::Mutation, AuthLevel::Locked))
        }
        ("POST", "pipeline") if segs.len() == 4 && segs[2] == "stage" => {
            Some((RouteKey::PipelineStage, BucketName::Mutation, AuthLevel::Locked))
        }
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
        .with_header(tiny_http::Header::from_bytes(&b"x-engine"[..], &b"t4-engine-rs/1.1.0"[..]).unwrap());
    let _ = request.respond(response);
}

/// SSE-ответ: chunked-поток из live-шины. Heartbeat 15с (`event: ping`),
/// прощание `event: bye` c последним seq — клиент переподключается с
/// `?after=seq`. Лекарство инцидента «Не удалось записать»: шлюз не рвёт
/// живой поток.
fn respond_sse(request: tiny_http::Request, after: u64) {
    eprintln!("t4-engine-rs: SSE-подписка live?after={after} — поток отвечает");
    let headers = vec![
        tiny_http::Header::from_bytes(&b"content-type"[..], &b"text/event-stream; charset=utf-8"[..])
            .unwrap(),
        tiny_http::Header::from_bytes(&b"cache-control"[..], &b"no-store"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"x-accel-buffering"[..], &b"no"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"x-engine"[..], &b"t4-engine-rs/1.1.0"[..]).unwrap(),
    ];
    let reader = live::LiveReader::new(after);
    eprintln!("t4-engine-rs: SSE-читатель создан (Identity-стрим, flush ~1КБ)");
    let response = tiny_http::Response::new(
        tiny_http::StatusCode(200),
        headers,
        reader,
        // Identity-обход чанкового буфера: огромный заявленный размер +
        // бесконечный chunked_threshold → raw_print берёт arm (Some(l), _):
        // io::copy пишет НАПРЯМУЮ в BufWriter(1024) — кадры уходят на провод
        // с задержкой ≤ ~1КБ, а не молчаливым каскадом энкодер(8КБ)+writer(1КБ).
        Some(1_000_000_000),
        None,
    )
    .with_chunked_threshold(usize::MAX);
    let _ = request.respond(response);
    eprintln!("t4-engine-rs: SSE-соединение закрыто (клиент отвалился или 600с)");
}

fn parse_json_body(text: &str) -> Result<Value, RpcError> {
    if text.trim().is_empty() {
        return Err(RpcError::bad_request("bad json (пустое тело)"));
    }
    serde_json::from_str(text).map_err(|_| RpcError::bad_request("bad json (тело не парсится)"))
}

fn query_map(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

/* ---------------- handlers ---------------- */

fn health(t: &Twin) -> Value {
    json!({
        "ok": true,
        "era": ERA,
        "engine": "t4-engine-rs",
        "version": "2.0.0",
        "canon": CANON_VERSION,
        "fam": FAM,
        "role": "ЕДИНЫЙ движок (cutover 2026-10-20): прод-летопись RW, один писатель, конвейер 5 этапов (авто + ручной), полная батарея, live SSE",
        "production": { "db": "t4-engine/data/t4.db", "mode": "read-write (единственный писатель)" },
        "scratch": { "retired": true, "note": "scratch-эра закрыта (архив на месте); слаги едины — дублей больше нет" },
        "pipeline": { "endpoint": "/v1/pipeline", "stages": pipeline::STAGE_KEYS, "auto": "POST /v1/pipeline/auto", "manual": "POST /v1/pipeline/stage/:имя", "abort": "POST /v1/pipeline/abort" },
        "live": { "endpoint": "/v1/live", "blocks": ["expand", "compile", "build", "gates", "scribe", "deliver", "pipeline", "system"], "heartbeatSec": 15 },
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
        "phase2": "theme expansion (гейт №25, EXP-оф) + live SSE + deliver/void зеркально handlers.ts",
    });
    m
}

fn state(t: &Twin) -> Value {
    let prod_chain = chain::verify_chain(&t.prod);
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
            /* Cutover: единое пространство — подсказка одна, дублей нет */
            "nextSlug": format!("T4-{:02}", compile::next_batch_number(&t.prod).max(compile::next_batch_number(&t.scratch))),
            "lastDelivered": last_delivered(&t.prod),
        },
        "pipeline": pipeline::state_snapshot(),
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
    let q = query_map(query);
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
        "SELECT slug, title, status, exp_slots, hard_pass, diff_up, diff_down, created_at, delivered_at, sha10
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
                "sha10": r.get::<_, String>(9)?,
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

/* План сборки воркфлоу (scratch): полные слоты-промпты compiled-батча —
 * витрина «Сборка» показывает содержимое, а не только строку в списке
 * (2026-10-20: «ни одного промпта не сгенерил» — контент был заперт в БД).
 * Слаг обязан быть каноническим T4-NN; пустой ответ — 404, не тихий null. */
fn scratch_batch_detail(t: &Twin, slug: &str) -> Result<(u16, String), RpcError> {
    if !crate::compile::valid_slug_pub(slug) {
        return Err(RpcError::bad_request(format!(
            "слаг «{slug}» не лезет в канон T4-NN"
        )));
    }
    let detail = batch_detail(&t.scratch, slug);
    if detail.get("error").is_some() {
        return Err(RpcError::not_found(format!(
            "сборка {slug} не найдена в scratch-летописи twin'а"
        )));
    }
    Ok(ok_envelope(detail))
}

fn chain_verify(conn: &Connection) -> Value {
    let v = chain::verify_chain(conn);
    json!({ "ok": v.ok, "events": v.events, "head": v.head, "problems": v.problems })
}

/* ---------------- compile (+ live + theme, Фаза 2) ---------------- */

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

    /* live: намерение */
    let resolved_slug = req
        .slug
        .clone()
        .unwrap_or_else(|| format!("T4-{:02}", compile::next_batch_number(&t.scratch)));
    live::info(
        "compile",
        &format!(
            "compile: слаг-кандидат {resolved_slug} · тема «{}» · EXP {} · A/B {} · движок {}",
            req.theme, req.exp, req.ab_pairs, req.engine
        ),
    );

    /* Фаза 2: Theme Expansion — ДО транзакции; гейт №25 режет до записи */
    let mut theme_block: Option<(Value, theme::ThemeReceipt, f64)> = None;
    if req.expand_theme {
        if req.exp > 0 {
            live::info(
                BLOCK_EXPAND,
                "тема-модуль: EXP-батч — Theme Expansion и гейт №25 выключены (приказ автора)",
            );
            theme_block = Some((Value::Null, theme::exp_off_receipt(), 0.0));
        } else {
            let (anchors, min_adherence) = match &req.theme_anchors {
                Some(v) => {
                    live::info(BLOCK_EXPAND, "тема-модуль: приняты правленые якоря автора (strict)");
                    theme::ThemeAnchors::from_json(v, &req.theme, &resolved_slug)
                        .map_err(|m| RpcError::validation(m, None))?
                }
                None => {
                    let a = theme::expand(&req.theme, &resolved_slug, 0).ok_or_else(|| {
                        RpcError::unprocessable("expandTheme: тему не удалось разложить на якоря")
                    })?;
                    (a, theme::DEFAULT_MIN_ADHERENCE)
                }
            };
            for line in [
                format!("тема «{}» → локейшн: {}", anchors.theme, anchors.locale),
                format!("время: {} · свет: {}", anchors.time_of_day, anchors.light),
                format!("палитральное настроение: {}", anchors.palette_mood),
                format!("мотивы: {}", anchors.motifs.join(" / ")),
                format!("гардероб: {} · позы: {} · камера: {}", anchors.wardrobe_family, anchors.pose_family, anchors.camera),
                format!("атмосфера: {} · сид {}", anchors.atmosphere.join(" / "), anchors.seed),
                format!("токены для гейта: {}", anchors.tokens().join(", ")),
            ] {
                live::info(BLOCK_EXPAND, &line);
            }
            let oc_themes: Vec<String> = req.oc_themes.iter().map(|o| o.theme.clone()).collect();
            let gate = theme::plan_gate(&anchors, &oc_themes, 0);
            for f in &gate.findings {
                live::error(BLOCK_GATES, &format!("тема-гейт №25: {f}"));
            }
            live::info(
                BLOCK_GATES,
                &format!("тема-гейт №25 ({}): {}", gate.level, gate.verdict),
            );
            if gate.verdict == "FAIL" {
                return Err(RpcError::unprocessable(
                    format!(
                        "тема-гейт №25 FAIL ({} замечаний) — правь якоря (themeAnchors) или тему",
                        gate.findings.len()
                    ),
                ));
            }
            theme_block = Some((anchors.to_json(min_adherence), gate, min_adherence));
        }
    }

    /* компиляция — канонический путь (byte-parity не тронут) */
    let outcome = compile::compile_batch(&t.scratch, &req, idem.as_deref())
        .map_err(|e| {
            live::error(BLOCK_COMPILE, &format!("compile: {}", e.0));
            RpcError::unprocessable(e.0)
        })?;

    /* live: квитанции планировочных гейтов */
    if let Some(receipts) = outcome.plan_json.get("receipts").and_then(|r| r.as_array()) {
        for r in receipts {
            let gate = r.get("gate").and_then(|g| g.as_str()).unwrap_or("?");
            let level = r.get("level").and_then(|g| g.as_str()).unwrap_or("?");
            let verdict = r.get("verdict").and_then(|g| g.as_str()).unwrap_or("?");
            let findings = r.get("findings").and_then(|f| f.as_array()).map(|a| a.len()).unwrap_or(0);
            live::info(
                BLOCK_GATES,
                &format!("{gate} ({level}): {verdict}{}", if findings > 0 { format!(" — {findings} замечаний") } else { String::new() }),
            );
        }
    }
    live::info(
        BLOCK_COMPILE,
        &format!(
            "compile: {slug} готов — sha10 {sha10}, слотов {}, hard {}",
            outcome.plan_json.get("slots").and_then(|s| s.as_array()).map(|a| a.len()).unwrap_or(0),
            if outcome.hard_pass { "PASS" } else { "FAIL" },
            slug = outcome.slug,
            sha10 = outcome.sha10,
        ),
    );

    /* тема-гейт в квитанции компиляции (вне плана) + событие-запись в scratch */
    if let Some((anchors_json, gate, _min)) = &theme_block {
        if !anchors_json.is_null() {
            let data = json!({
                "module": "theme-expansion",
                "version": theme::MODULE_VERSION,
                "slug": outcome.slug,
                "anchors": anchors_json,
                "gate": gate.to_json(),
            });
            let tx = t
                .scratch
                .unchecked_transaction()
                .map_err(|e| RpcError::unprocessable(e.to_string()))?;
            let evt = chain::append_event_tx(
                &tx,
                &chain::AppendInput {
                    typ: "note",
                    summary: &format!(
                        "Theme Expansion: {} «{}» — гейт №25 {}",
                        outcome.slug,
                        req.theme,
                        gate.verdict
                    ),
                    data: Some(&data),
                    batch_slug: Some(&outcome.slug),
                },
            )
            .map_err(|m| RpcError::unprocessable(m))?;
            tx.commit().map_err(|e| RpcError::unprocessable(e.to_string()))?;
            live::info(
                BLOCK_EXPAND,
                &format!("Theme Expansion записан в scratch-летопись (note {})", evt.id),
            );
        }
    }

    let mut data = json!({
        "plan": outcome.plan_json,
        "event": { "id": outcome.event_id, "at": outcome.event_at, "seq": outcome.event_seq },
        "receipts": outcome.plan_json.get("receipts").cloned().unwrap_or(Value::Null),
        "idempotentReplay": false,
        "twinNote": "скомпилировано в scratch-летописи twin'а; продакшн не тронут",
    });
    if let Some((anchors_json, gate, _)) = theme_block {
        if !anchors_json.is_null() {
            data["themeAnchors"] = anchors_json;
        }
        data["themeGate"] = gate.to_json();
    }
    if outcome.reassembly {
        data["reassembly"] = json!(true);
        data["twinNote"] = json!(
            "ПЕРЕсобрано в scratch-летописи twin'а поверх compiled — прежний план в supersedes события, прод не тронут"
        );
    }
    Ok(ok_envelope(data))
}

/* ---------------- theme routes (Фаза 2) ---------------- */

fn theme_expand_route(body: &Value) -> Result<(u16, String), RpcError> {
    let obj = body
        .as_object()
        .ok_or_else(|| RpcError::validation("theme/expand: тело должно быть JSON-объектом (strict)", None))?;
    for k in obj.keys() {
        if !["theme", "slug", "exp", "ocThemes"].contains(&k.as_str()) {
            return Err(RpcError::validation(
                format!("theme/expand: лишнее поле «{k}» (strict)"),
                None,
            ));
        }
    }
    let t_str = obj
        .get("theme")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() <= 200)
        .ok_or_else(|| RpcError::validation("theme/expand: theme обязателен (1..200 симв)", None))?;
    let slug = obj
        .get("slug")
        .and_then(|v| v.as_str())
        .unwrap_or("T4-00")
        .to_string();
    let exp = obj.get("exp").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let oc_themes: Vec<String> = obj
        .get("ocThemes")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    live::info(BLOCK_EXPAND, &format!("theme/expand: «{t_str}» (exp {exp})"));
    if exp > 0 {
        let gate = theme::exp_off_receipt();
        return Ok(ok_envelope(json!({
            "disabled": true,
            "reason": "EXP-батч — Theme Expansion и гейт №25 выключены (приказ автора)",
            "gate": gate.to_json(),
        })));
    }
    let anchors = theme::expand(&t_str, &slug, 0)
        .ok_or_else(|| RpcError::unprocessable("тему не удалось разложить"))?;
    let gate = theme::plan_gate(&anchors, &oc_themes, 0);
    Ok(ok_envelope(json!({
        "anchors": anchors.to_json(theme::DEFAULT_MIN_ADHERENCE),
        "gate": gate.to_json(),
    })))
}

fn theme_check_route(body: &Value) -> Result<(u16, String), RpcError> {
    let obj = body
        .as_object()
        .ok_or_else(|| RpcError::validation("theme/check: тело должно быть JSON-объектом (strict)", None))?;
    for k in obj.keys() {
        if !["text", "anchors", "minAdherence"].contains(&k.as_str()) {
            return Err(RpcError::validation(
                format!("theme/check: лишнее поле «{k}» (strict)"),
                None,
            ));
        }
    }
    let text = obj
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::validation("theme/check: text обязателен", None))?;
    let anchors_v = obj
        .get("anchors")
        .ok_or_else(|| RpcError::validation("theme/check: anchors обязателен (JSON из /v1/theme/expand)", None))?;
    let min = obj
        .get("minAdherence")
        .and_then(|v| v.as_f64())
        .unwrap_or(theme::DEFAULT_MIN_ADHERENCE);
    let (anchors, min_from_json) = theme::ThemeAnchors::from_json(anchors_v, "", "")
        .map_err(|m| RpcError::validation(m, None))?;
    let receipt = theme::text_gate(text, &anchors, if min != theme::DEFAULT_MIN_ADHERENCE { min } else { min_from_json });
    for f in &receipt.findings {
        live::warn(BLOCK_GATES, &format!("тема/adherence: {f}"));
    }
    live::info(
        BLOCK_GATES,
        &format!("тема/adherence (гейт №25): {}", receipt.verdict),
    );
    Ok(ok_envelope(json!({ "receipt": receipt.to_json() })))
}

/* ---------------- append event ---------------- */

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
    live::info("system", &format!("событие «{typ}» записано в scratch (seq {})", evt.seq));
    Ok(ok_envelope(json!({ "id": evt.id, "at": evt.at, "type": evt.r#type, "chainHead": evt.hash })))
}

/* ---------------- pipeline (cutover-эра: конвейер 5 этапов) ---------------- */

/// Одна кнопка: POST /v1/pipeline/auto — машина ведёт 1→5 сама.
fn pipeline_auto_route(body: &Value) -> Result<(u16, String), RpcError> {
    match pipeline::start_auto(body.clone()) {
        Ok(v) => Ok(ok_envelope(v)),
        Err(m) => {
            live::error("pipeline", &format!("авто-запуск отклонён: {m}"));
            let (status, code) = crate::classify_core_error(&m);
            Err(RpcError { status, code, message: m, hint: None })
        }
    }
}

/// Ручной override: POST /v1/pipeline/stage/:имя — один этап,
/// нижележащие помечаются устаревшими.
fn pipeline_stage_route(stage: &str, body: &Value) -> Result<(u16, String), RpcError> {
    match pipeline::start_stage(stage, body.clone()) {
        Ok(v) => Ok(ok_envelope(v)),
        Err(m) => {
            live::error("pipeline", &format!("ручной этап «{stage}» отклонён: {m}"));
            let (status, code) = crate::classify_core_error(&m);
            Err(RpcError { status, code, message: m, hint: None })
        }
    }
}

fn pipeline_abort_route() -> Result<(u16, String), RpcError> {
    Ok(ok_envelope(pipeline::request_abort()))
}

/* ---------------- deliver / void (общее ядро lib.rs, зеркало handlers.ts) ---------------- */

fn deliver_route(t: &Twin, slug: &str) -> Result<(u16, String), RpcError> {
    match crate::cli_deliver(&t.scratch, slug) {
        Ok(v) => {
            if let Some(s) = v.get("summary").and_then(|x| x.as_str()) {
                live::info(BLOCK_DELIVER, s);
            }
            live::info(
                BLOCK_DELIVER,
                "сдано в scratch-летописи twin'а — продакшн не тронут",
            );
            Ok(ok_envelope(v))
        }
        Err(m) => {
            let (status, code) = crate::classify_core_error(&m);
            Err(RpcError { status, code, message: m, hint: None })
        }
    }
}

fn void_route(t: &Twin, slug: &str) -> Result<(u16, String), RpcError> {
    match crate::cli_void(&t.scratch, slug, "решение автора") {
        Ok(v) => {
            if let Some(s) = v.get("summary").and_then(|x| x.as_str()) {
                live::info(BLOCK_SYSTEM, s);
            }
            Ok(ok_envelope(v))
        }
        Err(m) => {
            let (status, code) = crate::classify_core_error(&m);
            Err(RpcError { status, code, message: m, hint: None })
        }
    }
}

/* ---------------- gates (текст-батарея файл-эры, этапы 0-1) ---------------- */

/// POST /v1/gates — прогон 13 словарных текстовых гейтов по batches/<slug>.md.
/// Данные: файлы репо RO (текст батча живёт только там) + прод-контекст RO
/// (runIndex/окно/OC-ростер). Записи: слаг из scratch-летописи twin'а →
/// gate.run + t4_gate_runs в scratch; исторический (прод) слаг — ЧИСТЫЙ
/// анализ, продакшн не тронут.
fn gates_route(t: &Twin, body: &Value) -> Result<(u16, String), RpcError> {
    let obj = body
        .as_object()
        .ok_or_else(|| RpcError::validation("gates: тело должно быть JSON-объектом (strict)", None))?;
    for k in obj.keys() {
        if k != "slug" {
            return Err(RpcError::validation(
                format!("gates: лишнее поле «{k}» (strict) — только {{\"slug\":\"T4-NN\"}}"),
                None,
            ));
        }
    }
    let slug = obj
        .get("slug")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| RpcError::validation("gates: slug обязателен (T4-NN[/суффикс])", None))?;
    live::info(BLOCK_GATES, &format!("gates: слаг {slug} — текст-батарея Rust ({}/30)", crate::textgates::BATTERY_RUST.len()));

    let (_batch, outcome) = match crate::textgates::run_for_slug(&slug) {
        Ok(v) => v,
        Err(e) => {
            return Err(match e {
                crate::textgates::TextGatesError::UnsafeSlug(_) => RpcError::validation(e.to_string(), None),
                crate::textgates::TextGatesError::NoDraft(_) => RpcError::not_found(e.to_string()),
            })
        }
    };

    /* прогресс в live-шину: по одному кадру на гейт (номер/имя/вердикт) */
    let total = outcome.receipts.len();
    for (i, r) in outcome.receipts.iter().enumerate() {
        let line = format!(
            "текст-гейт {}/{}: {} ({}): {}{}",
            i + 1,
            total,
            r.gate,
            r.level,
            r.verdict,
            if r.findings.is_empty() {
                String::new()
            } else {
                format!(" — {} замечаний", r.findings.len())
            },
        );
        if r.verdict == "PASS" || r.verdict == "REPORT" {
            live::info(BLOCK_GATES, &line);
        } else {
            live::warn(BLOCK_GATES, &line);
            for f in r.findings.iter().take(4) {
                live::warn(BLOCK_GATES, &format!("  · {f}"));
            }
        }
    }

    /* записи: scratch-слаг twin'а → gate.run в scratch-цепь + t4_gate_runs;
     * исторический (прод) — НИКАКИХ записей, runIndex из прод-летописи RO */
    let in_scratch: bool = t
        .scratch
        .query_row("SELECT 1 FROM t4_batches WHERE slug = ?1", [&slug], |_| Ok(()))
        .is_ok();
    let (run_index, recorded) = if in_scratch {
        let (event_id, seq, run_index) = crate::textgates::record_gate_run(&t.scratch, &outcome)
            .map_err(RpcError::unprocessable)?;
        live::info(
            BLOCK_GATES,
            &format!("записано: gate.run {event_id} (seq {seq}, прогон #{run_index}) в scratch-летопись"),
        );
        (run_index as u64, Some(seq))
    } else {
        let ctx = crate::textgates::prod_context(&t.prod, &slug);
        live::info(
            BLOCK_GATES,
            &format!(
                "слаг {slug} исторический (прод: прогонов {}, окно [{}]) — чистый анализ, записей нет",
                ctx.prior_runs,
                ctx.window_slugs.join(", ")
            ),
        );
        (ctx.prior_runs + 1, None)
    };

    let hard_fails = outcome.hard_fails();
    let warns = outcome.warns();
    let mut data = json!({
        "slug": slug,
        "receipts": crate::textgates::receipts_json(&outcome.receipts),
        "hardPass": outcome.hard_pass,
        "hardFails": hard_fails,
        "warns": warns,
        "batteryRust": crate::textgates::BATTERY_RUST,
        "batteryTs": crate::textgates::BATTERY_TS,
        "sha10": outcome.sha10,
        "runIndex": run_index,
    });
    if let Some(theme) = &outcome.contract_theme {
        data["contractTheme"] = json!(theme);
    }
    if let Some(rebuild) = &outcome.rebuild_of {
        data["rebuildOf"] = json!(rebuild);
    }
    data["twinNote"] = if let Some(seq) = recorded {
        json!(format!("записано в scratch-летопись twin'а (seq {seq}); продакшн не тронут"))
    } else {
        json!("исторический слаг — чистый анализ, НИКАКИХ записей; runIndex из прод-летописи (RO)")
    };
    live::info(
        BLOCK_GATES,
        &format!(
            "батарея {}: hard {}, warn-гейтов {} из {}/30",
            if outcome.hard_pass { "PASS" } else { "FAIL" },
            if outcome.hard_pass { "PASS" } else { "FAIL" },
            warns.len(),
            crate::textgates::BATTERY_RUST.len(),
        ),
    );
    Ok(ok_envelope(data))
}

/* ---------------- tests: маршрут /v1/gates без сети (cfg(test)) ---------------- */

#[cfg(test)]
mod gates_tests {
    use super::*;
    use crate::textgates::recorded_ts_snapshot;

    fn temp_twin(tag: &str) -> Twin {
        let path = std::env::temp_dir().join(format!("t4-rpc-gates-{tag}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let scratch = Connection::open(&path).expect("temp scratch");
        scratch.pragma_update(None, "journal_mode", "WAL").ok();
        crate::db::migrate_schema(&scratch).expect("schema");
        let prod_path = std::env::temp_dir().join(format!("t4-rpc-prod-{tag}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&prod_path);
        let prod = Connection::open(&prod_path).expect("temp prod");
        prod.pragma_update(None, "journal_mode", "WAL").ok();
        crate::db::migrate_schema(&prod).expect("schema");
        Twin {
            prod,
            scratch,
            key: crate::auth::KeyCache::new(),
            limiter: crate::ratelimit::Limiter::new(),
            boot_at: std::time::Instant::now(),
        }
    }

    fn segs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// unwrap без Debug на RpcError (прод-структура не расширяется ради теста)
    fn unwrap_ok(r: Result<(u16, String), RpcError>) -> (u16, String) {
        match r {
            Ok(v) => v,
            Err(e) => panic!("gates_route Err: {} {} — {}", e.status, e.code, e.message),
        }
    }

    #[test]
    fn route_post_gates_locked() {
        let r = route_match("POST", &segs(&["v1", "gates"]));
        assert!(matches!(r, Some((RouteKey::Gates, _, AuthLevel::Locked))));
        // GET не разрешён
        assert!(route_match("GET", &segs(&["v1", "gates"])).is_none());
    }

    #[test]
    fn gates_route_strict_body() {
        let t = temp_twin("strict");
        let (status, code, message) = match gates_route(&t, &json!({"slug": "T4-27", "dry": true})) {
            Err(e) => (e.status, e.code, e.message),
            Ok(_) => (0, "", String::new()),
        };
        assert_eq!((status, code), (422, "validation"));
        assert!(message.contains("лишнее поле «dry»"));
    }

    #[test]
    fn gates_route_historical_no_writes() {
        // исторический слог: чистый анализ, runIndex из прод-летописи RO,
        // НИКАКИХ записей ни в прод, ни в scratch
        let t = temp_twin("hist");
        // прод-летопись: 3 записанных прогона T4-27 (как в живой базе)
        for i in 0..3 {
            let tx = t.prod.unchecked_transaction().unwrap();
            crate::chain::append_event_tx(
                &tx,
                &crate::chain::AppendInput {
                    typ: "gate.run",
                    summary: &format!("T4-27 гейты: прогон #{}", i + 1),
                    data: Some(&json!({"slug": "T4-27", "run": i + 1})),
                    batch_slug: Some("T4-27"),
                },
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let prod_before = crate::db::count_events(&t.prod);
        let scratch_before = crate::db::count_events(&t.scratch);
        let (status, body) = unwrap_ok(gates_route(&t, &json!({"slug": "T4-27"})));
        assert_eq!(status, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        let data = &v["data"];
        assert_eq!(data["slug"], "T4-27");
        assert_eq!(data["runIndex"], 4, "прод-летопись: 3 прогона + 1");
        assert_eq!(data["hardPass"], true);
        assert_eq!(data["batteryRust"].as_array().unwrap().len(), 13);
        assert_eq!(data["batteryTs"].as_array().unwrap().len(), 17);
        assert!(data["receipts"].as_array().unwrap().len() == 13);
        assert_eq!(crate::db::count_events(&t.prod), prod_before, "прод не тронут");
        assert_eq!(crate::db::count_events(&t.scratch), scratch_before, "scratch не тронут: исторический слог — чистый анализ");
        let runs: i64 = t
            .scratch
            .query_row("SELECT COUNT(*) FROM t4_gate_runs WHERE batch_slug = 'T4-27'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(runs, 0);
    }

    #[test]
    fn gates_route_scratch_batch_writes() {
        // слаг есть в scratch-летописи twin'а → gate.run + t4_gate_runs;
        // слаг с живым файлом batches/T4-27.md (файлы репо RO)
        let t = temp_twin("scratch");
        t.scratch
            .execute(
                "INSERT INTO t4_batches (slug, title, theme, engine, status, slots_total, exp_slots,
                 ab_pairs, hard_pass, diff_up, diff_down, payload, sha10, created_at, event_id)
                 VALUES ('T4-27', 'синтетика', 'синтетика', 'per-theme', 'compiled', 24, 0, 2, 1, 0, 0,
                 '{}', 'deadbeef00', '2026-10-19T00:00:00.000Z', 'evt00001')",
                [],
            )
            .unwrap();
        let (status, _body) = unwrap_ok(gates_route(&t, &json!({"slug": "T4-27"})));
        assert_eq!(status, 200);
        let events: i64 = t
            .scratch
            .query_row("SELECT COUNT(*) FROM t4_events WHERE type = 'gate.run'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 1, "gate.run обязан писаться для scratch-слога");
        let runs: i64 = t
            .scratch
            .query_row("SELECT COUNT(*) FROM t4_gate_runs WHERE batch_slug = 'T4-27'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(runs, 1);
        let verdict = crate::chain::verify_chain(&t.scratch);
        assert!(verdict.ok, "scratch-цепь цела после записи");
        // продакшн не тронут
        assert_eq!(crate::db::count_events(&t.prod), 0);
    }

    #[test]
    fn gates_route_missing_draft_404() {
        let t = temp_twin("nodraft");
        let (status, code, message) = match gates_route(&t, &json!({"slug": "T4-99"})) {
            Err(e) => (e.status, e.code, e.message),
            Ok(_) => (0, "", String::new()),
        };
        assert_eq!((status, code), (404, "notFound"));
        assert_eq!(message, "нет драфта batches/T4-99.md — батарея неприменима");
    }

    #[test]
    fn gates_route_live_snapshot_parity_available() {
        // записанные TS-слепки читаются из летописи репо (файл-эра): как
        // минимум один живой слепок для T4-34 обязан находиться
        let Ok((_b, o)) = crate::textgates::run_for_slug("T4-34") else {
            return; // файлы репо недоступны в окружении теста — честный пропуск
        };
        let snap = recorded_ts_snapshot("T4-34", &o.sha10);
        assert!(snap.is_some(), "слепок gate.run для T4-34 (sha {}) обязан читаться", o.sha10);
        let s = snap.unwrap();
        assert!(s.verdicts.iter().any(|(g, v)| g == "noun-lock" && v == "WARN"));
    }
}
