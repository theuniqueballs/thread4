//! THREAD 4 ENGINE (RUST TWIN) — entry point.
//!
//! «Разбери по полочкам движок и перенеси всё что можно на Rust» —
//! this binary is the shelf-by-shelf port of mini-services/t4-engine:
//!
//!   полка 1  canonical.rs   — stable JSON + chain formula (byte-exact)
//!   полка 2  db.rs          — sqlite storage, DDL, meta/chain pointer
//!   полка 3  chain.rs       — append-only hash-chained chronicle + audit
//!   полка 4  compile.rs     — deterministic plan compiler + planning gates
//!   полка 5  rpc.rs         — route table, envelope, auth, rate limits
//!   полка 6  canon.rs       — Code-as-Config (numbers with provenance)
//!
//! Acceptance bar (checked at boot, logged loudly):
//!   · verify_chain over the PRODUCTION chronicle → same verdict as bun
//!   · payload_sha10 over the stored T4-41 plan → same fingerprint
//!
//! Boot order mirrors the TS engine: canon arithmetic → open handles →
//! serve. A broken canon kills the twin before it answers anything.

mod auth;
mod canon;
mod canonical;
mod chain;
mod compile;
mod db;
mod ratelimit;
mod rpc;

use std::sync::Arc;

fn main() {
    let problems = canon::slot_law_checks();
    if !problems.is_empty() {
        eprintln!("t4-engine-rs: canon arithmetic broken:");
        for p in problems {
            eprintln!("  · {p}");
        }
        std::process::exit(1);
    }

    let prod = match db::open_production_ro() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("t4-engine-rs: продакшн t4.db не открывается (RO) — {e}");
            eprintln!("  (t4-engine должен быть поднят первым; twin только читает его)");
            std::process::exit(1);
        }
    };
    let scratch = match db::open_scratch_rw() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("t4-engine-rs: scratch-база не создаётся — {e}");
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

    let twin = Arc::new(rpc::Twin {
        prod,
        scratch,
        key: auth::KeyCache::new(),
        limiter: ratelimit::Limiter::new(),
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
    Ok((canonical::payload_sha10(&payload_for_hash), expected))
}
