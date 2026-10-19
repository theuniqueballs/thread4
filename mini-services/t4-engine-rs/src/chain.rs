//! THREAD 4 ENGINE (RUST TWIN) — the hash chain (Залп 1 «Правда»).
//!
//! Formula INHERITED from the file era byte-for-byte:
//!   hash = sha256(prev + '|' + rawLine), genesis link = 'GENESIS'.
//! verify_chain() recomputes every hash from the stored raw lines — the
//! auditor never trusts the cached head. This module is the acceptance
//! bar of the port: running it over the PRODUCTION db must report the
//! same verdict as the bun engine (`✓ ЦЕПЬ ЦЕЛА`, same head).

use rusqlite::{Connection, OptionalExtension};

use crate::canonical::{canonical_event_line, chain_hash};
use crate::canon::{CONFIDENCE_LEVELS, EVENT_TYPES, VERDICT_SOURCES};
use crate::db::{read_chain_pointer, write_chain_pointer};

#[derive(Clone, Debug)]
pub struct EventRow {
    pub seq: u32,
    pub id: String,
    pub at: String,
    pub r#type: String,
    pub summary: String,
    pub data: Option<String>,
    pub raw: String,
    pub prev_hash: String,
    pub hash: String,
    pub batch_slug: Option<String>,
}

#[derive(Debug)]
pub struct ChainVerdict {
    pub ok: bool,
    pub events: u32,
    pub head: Option<String>,
    pub problems: Vec<String>,
}

/* ---------------- born-wounded checks (ported verbatim) ---------------- */

pub fn assert_born_clean(summary: &str) -> Result<(), String> {
    if summary.contains('\u{FFFD}') {
        return Err(
            "event born wounded: U+FFFD в summary — битая кодировка фиксируется на входе, не в истории (инцидент 2026-09-26)"
                .to_string(),
        );
    }
    if summary.chars().count() > 4000 {
        return Err(format!(
            "event born wounded: summary > 4000 симв (получено {})",
            summary.chars().count()
        ));
    }
    Ok(())
}

pub fn assert_born_semantics(typ: &str, data: Option<&serde_json::Value>) -> Result<(), String> {
    if !EVENT_TYPES.contains(&typ) {
        return Err(format!(
            "event born wounded: неизвестный тип «{typ}» — летопись закрыта enum'ом"
        ));
    }
    if typ == "render.verdict" {
        let src = data
            .and_then(|d| d.get("source"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !VERDICT_SOURCES.contains(&src) {
            return Err(format!(
                "event born wounded: render.verdict требует data.source из enum [{}] (Issue #1)",
                VERDICT_SOURCES.join(", ")
            ));
        }
        let conf = data.and_then(|d| d.get("confidence"));
        if let Some(c) = conf {
            let cs = c.as_str().unwrap_or("");
            if !CONFIDENCE_LEVELS.contains(&cs) {
                return Err(format!(
                    "event born wounded: confidence вне enum [{}]",
                    CONFIDENCE_LEVELS.join(", ")
                ));
            }
        }
        if (src == "author" || src == "author-batch" || src == "author-verbatim" || src == "author-oc")
            && conf.is_none()
        {
            return Err(format!(
                "event born wounded: author-вердикт требует confidence: {}",
                CONFIDENCE_LEVELS.join(" | ")
            ));
        }
    }
    if typ == "oracle.spoke" {
        let model = data
            .and_then(|d| d.get("model"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if model.is_empty() {
            return Err(
                "event born wounded: oracle.spoke требует data.model — анонимный оракул запрещён"
                    .to_string(),
            );
        }
        let reply = data
            .and_then(|d| d.get("reply"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if reply.chars().count() < 50 || reply.chars().count() > 4000 {
            return Err("event born wounded: oracle.spoke требует data.reply 50..4000 симв".to_string());
        }
    }
    Ok(())
}

/* ---------------- ids: 8 hex, collision-retried ---------------- */

fn random_hex8() -> String {
    // std-only randomness: /dev/urandom, 4 bytes → 8 hex chars (uuid-slice
    // shape of the TS engine: crypto.randomUUID().slice(0, 8))
    let mut buf = [0u8; 4];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut buf);
    } else {
        // last resort: time-seeded fallback (still 8 hex, still unique-ish)
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        buf.copy_from_slice(&t.to_le_bytes()[0..4]);
    }
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn new_event_id(conn: &Connection) -> Result<String, String> {
    for _ in 0..8 {
        let id = random_hex8();
        let exists: Option<i64> = conn
            .query_row("SELECT 1 FROM t4_events WHERE id = ?1", [&id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Ok(id);
        }
    }
    Err("event id space exhausted (8 попыток, все коллизии) — проверь целостность БД".into())
}

/* ---------------- append ---------------- */

pub struct AppendInput<'a> {
    pub typ: &'a str,
    pub summary: &'a str,
    pub data: Option<&'a serde_json::Value>,
    pub batch_slug: Option<&'a str>,
}

/// ISO timestamp with millisecond precision — the `new Date().toISOString()` shape.
pub fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    // civil-from-days (Howard Hinnant's algorithm, UTC)
    let z = (days as i64) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, m, s, millis
    )
}

/// Appends one event inside an open transaction (callers wrap projections
/// in the SAME tx — state is derived, never half-written).
pub fn append_event_tx(conn: &Connection, input: &AppendInput) -> Result<EventRow, String> {
    assert_born_clean(input.summary)?;
    assert_born_semantics(input.typ, input.data)?;
    let pointer = read_chain_pointer(conn);
    let id = new_event_id(conn)?;
    let at = iso_now();
    let raw = canonical_event_line(&id, &at, input.typ, input.summary, input.data);
    let hash = chain_hash(&pointer.head, &raw);
    let data_text = input.data.map(|d| d.to_string());

    conn.execute(
        "INSERT INTO t4_events (id, at, type, summary, data, raw, prev_hash, hash, batch_slug)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            at,
            input.typ,
            input.summary,
            data_text,
            raw,
            pointer.head,
            hash,
            input.batch_slug,
        ],
    )
    .map_err(|e| e.to_string())?;
    write_chain_pointer(
        conn,
        &crate::db::ChainPointer {
            head: hash.clone(),
            height: pointer.height + 1,
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(EventRow {
        seq: pointer.height + 1,
        id,
        at,
        r#type: input.typ.to_string(),
        summary: input.summary.to_string(),
        data: data_text,
        raw,
        prev_hash: pointer.head,
        hash,
        batch_slug: input.batch_slug.map(|s| s.to_string()),
    })
}

/* ---------------- reads / full audit ---------------- */

pub fn read_events(
    conn: &Connection,
    after: u32,
    limit: u32,
    typ: Option<&str>,
) -> Result<Vec<EventRow>, String> {
    let limit = limit.min(1000);
    let mut out = Vec::new();
    if let Some(t) = typ {
        let mut stmt = conn
            .prepare("SELECT * FROM t4_events WHERE seq > ?1 AND type = ?2 ORDER BY seq ASC LIMIT ?3")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![after as i64, t, limit as i64], map_event_row)
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }
    let mut stmt = conn
        .prepare("SELECT * FROM t4_events WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![after as i64, limit as i64], map_event_row)
        .map_err(|e| e.to_string())?;
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn map_event_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<EventRow> {
    let seq: i64 = r.get("seq")?;
    Ok(EventRow {
        seq: seq.max(0) as u32,
        id: r.get("id")?,
        at: r.get("at")?,
        r#type: r.get("type")?,
        summary: r.get("summary")?,
        data: r.get("data")?,
        raw: r.get("raw")?,
        prev_hash: r.get("prev_hash")?,
        hash: r.get("hash")?,
        batch_slug: r.get("batch_slug")?,
    })
}

/// Full chain audit — recomputes every hash from the stored raw lines.
pub fn verify_chain(conn: &Connection) -> ChainVerdict {
    let mut problems: Vec<String> = Vec::new();
    let mut stmt = match conn.prepare("SELECT seq, id, raw, prev_hash, hash FROM t4_events ORDER BY seq ASC") {
        Ok(s) => s,
        Err(_) => {
            return ChainVerdict {
                ok: false,
                events: 0,
                head: None,
                problems: vec!["t4_events не читается".into()],
            }
        }
    };
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .unwrap_or_else(|_| panic!("query"));

    let mut prev = crate::canon::CHAIN_GENESIS.to_string();
    let mut last_hash: Option<String> = None;
    let mut count: u32 = 0;
    for row in rows.flatten() {
        let (seq, _id, raw, prev_hash, hash) = row;
        count += 1;
        if prev_hash != prev {
            problems.push(format!(
                "seq {seq}: prev_hash не совпадает с хешем предыдущего звена (форк/правка)"
            ));
        }
        let computed = chain_hash(&prev, &raw);
        if computed != hash {
            problems.push(format!(
                "seq {seq}: hash не воспроизводится из raw — летопись правлена руками"
            ));
        }
        if seq != count as i64 {
            problems.push(format!("seq {seq}: нумерация дырявая (ожидалась {count})"));
        }
        prev = hash.clone();
        last_hash = Some(hash);
    }

    if count == 0 {
        return ChainVerdict {
            ok: true,
            events: 0,
            head: None,
            problems: vec!["цепь пуста — летопись ещё не родилась".into()],
        };
    }

    let pointer = read_chain_pointer(conn);
    let last = last_hash.clone().unwrap_or_default();
    if pointer.head != last || pointer.height != count {
        problems.push(format!(
            "t4_meta head/height ({}…/{}) отстал от таблицы ({}…/{})",
            &pointer.head[..10.min(pointer.head.len())],
            pointer.height,
            &last[..10.min(last.len())],
            count
        ));
    }

    ChainVerdict {
        ok: problems.is_empty(),
        events: count,
        head: last_hash,
        problems,
    }
}
