//! THREAD 4 ENGINE (UNIFIED) — entry point.
//!
//! CUTOVER 2026-10-20 (приказ «МОЩНОСТЬ»): это ЕДИНЫЙ движок THREAD 4.
//! Прежняя схема «bun-движок :3200 пишет прод, Rust-twin :3201 пишет
//! scratch» закрыта — один бинарник, одна база, один писатель:
//!
//!   полка 1  canonical.rs   — stable JSON + chain formula (byte-exact)
//!   полка 2  db.rs           — sqlite storage (прод RW), DDL, meta/chain
//!   полка 3  chain.rs        — append-only hash-chained chronicle + audit
//!   полка 4  compile.rs      — deterministic plan compiler + planning gates
//!   полка 5  rpc.rs          — route table, envelope, auth, rate limits
//!   полка 6  canon.rs        — Code-as-Config (numbers with provenance)
//!   полка 7  theme.rs        — Theme Expansion (гейт темы, EXP-оф)
//!   полка 8  live.rs         — SSE-шина живой консоли (heartbeat)
//!   полка 9  textgates.rs    — текст-батарея (порт gates.ts)
//!   полка 10 bridge.rs       — LLM-мост к Next-слою (compute-only)
//!   полка 11 pipeline.rs     — КОНВЕЙЕР: 5 этапов, авто + ручной + abort
//!
//! Acceptance bar (checked at boot, logged loudly):
//!   · verify_chain over the PRODUCTION chronicle → same verdict as bun
//!   · payload_sha10 over the stored T4-41 plan → same fingerprint
//!   · НИКАКОГО второго писателя: если :3200 (старый bun-движок) ещё
//!     отвечает — движок отказывается подниматься (две цепи = враньё).
//!
//! Boot order mirrors the TS engine: canon arithmetic → open handles →
//! serve. A broken canon kills the engine before it answers anything.

use std::sync::Arc;

use t4_engine_rs::{auth, canon, chain, db, rpc};

fn main() {
    let problems = canon::slot_law_checks();
    if !problems.is_empty() {
        eprintln!("t4-engine-rs: canon arithmetic broken:");
        for p in problems {
            eprintln!("  · {p}");
        }
        std::process::exit(1);
    }

    /* ---- гвард единственного писателя: старый bun-движок обязан быть мёртв ---- */
    if let Ok(stream) = std::net::TcpStream::connect(("127.0.0.1", 3200)) {
        drop(stream);
        eprintln!("t4-engine-rs: ОТКАЗ ПОДЪЁМА — на :3200 отвечает старый bun-движок.");
        eprintln!("  Единая база = один писатель: останови mini-services/t4-engine (kill pid) и поднимись снова.");
        std::process::exit(1);
    }

    /* ---- handles: прод RW — чтения и записи через одну и ту же базу ---- */
    let prod = match db::open_production_ro() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("t4-engine-rs: продакшн t4.db не открывается (RO) — {e}");
            std::process::exit(1);
        }
    };
    let scratch = match db::open_production_rw() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("t4-engine-rs: продакшн t4.db не открывается (RW) — {e}");
            eprintln!("  (cutover: единый движок пишет прод; проверь, что файл не повреждён и валидация схемы проходит)");
            std::process::exit(1);
        }
    };

    /* ---- acceptance bar №1: the production chain verifies in Rust ---- */
    let verdict = chain::verify_chain(&prod);
    if verdict.ok {
        eprintln!(
            "t4-engine-rs: продакшн-цепь ЦЕЛА — {} звеньев, head {}…",
            verdict.events,
            verdict.head.as_deref().map(|h| &h[..12]).unwrap_or("—")
        );
    } else {
        eprintln!("t4-engine-rs: ВНИМАНИЕ — продакшн-цепь не сходится ({} проблем):", verdict.problems.len());
        for p in verdict.problems.iter().take(5) {
            eprintln!("  · {p}");
        }
    }

    /* ---- acceptance bar №2: canonical serializer parity (T4-41 plan) ---- */
    let parity = parity_check_t441(&prod);
    match &parity {
        Ok((sha10, expected)) => {
            eprintln!(
                "t4-engine-rs: канонический сериализатор — sha10 плана T4-41 = {sha10} (ожидался {expected}) → {}",
                if sha10 == expected { "СОВПАДЕНИЕ БАЙТ-В-БАЙТ" } else { "РАСХОЖДЕНИЕ" }
            );
        }
        Err(e) => eprintln!("t4-engine-rs: parity-проверка пропущена — {e}"),
    }

    /* ---- cutover-эра: восстановить прогон конвейера из t4_meta (если был) ---- */
    t4_engine_rs::pipeline::load_persisted(&prod);

    eprintln!("t4-engine-rs: CUTOVER — единый движок: прод RW (один писатель), конвейер 5 этапов готов, live-SSE /v1/live");

    let twin = Arc::new(rpc::Twin {
        prod,
        scratch,
        key: auth::KeyCache::new(),
        limiter: t4_engine_rs::ratelimit::Limiter::new(),
        boot_at: std::time::Instant::now(),
    });
    rpc::serve(twin);
}

/// Recompute the T4-41 plan fingerprint with the Rust canonicalizer:
/// read the stored payload, drop `sha10`, hash slots as a count, and
/// compare with the sha10 the bun engine committed to the chronicle.
fn parity_check_t441(prod: &rusqlite::Connection) -> Result<(String, String), String> {
    let row: Option<(String, String)> = prod
        .query_row(
            "SELECT payload, sha10 FROM t4_batches WHERE slug = 'T4-41'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let (payload, expected) = row.ok_or("T4-41 не найден в продакшн-базе")?;
    let plan: serde_json::Value =
        serde_json::from_str(&payload).map_err(|e| format!("payload не парсится: {e}"))?;
    let slots_count = plan
        .get("slots")
        .and_then(|s| s.as_array())
        .map(|a| a.len())
        .ok_or("payload без slots[]")?;
    let mut payload_for_hash = plan.clone();
    let obj = payload_for_hash
        .as_object_mut()
        .ok_or("payload не объект")?;
    obj.remove("sha10");
    obj.insert("slots".into(), (slots_count as u64).into());
    Ok((t4_engine_rs::canonical::payload_sha10(&payload_for_hash), expected))
}
