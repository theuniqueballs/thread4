//! THREAD 4 ENGINE (RUST TWIN) — библиотечный корень.
//!
//! Полки дважды используется: серверный бин (src/main.rs — twin :3201) и
//! CLI (src/bin/t4.rs — прямые операции с базами без HTTP). Одна логика —
//! один источник права: CLI и RPC НЕ могут разъехаться.

pub mod auth;
pub mod canon;
pub mod canonical;
pub mod chain;
pub mod compile;
pub mod db;
pub mod live;
pub mod ratelimit;
pub mod rpc;
pub mod selftest;
pub mod textgates;
pub mod theme;

/* ---------------- deliver / void — общее ядро (зеркало handlers.ts) ---------------- */
//
// Один источник права для трёх потребителей: RPC-маршруты, CLI и
// selftest-батарея. Гварды и сообщения — 1-в-1 из движка (bun).

use rusqlite::Connection;
use serde_json::json;

fn get_batch_core(conn: &Connection, slug: &str) -> Result<(String, String, Option<String>, i64, i64, i64, i64, i64, String), String> {
    let row: Option<(String, String, Option<String>, i64, i64, i64, i64, i64, String)> = conn
        .query_row(
            "SELECT title, status, delivered_at, hard_pass, slots_total, exp_slots, diff_up, diff_down, sha10
             FROM t4_batches WHERE slug = ?1",
            [slug],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?,
                ))
            },
        )
        .ok();
    row.ok_or_else(|| format!("batch {slug} не найден"))
}

/// Сдача батча (зеркало handlers.ts deliver): гварды → tx { batch.delivered +
/// markDelivered }. Возвращает ответ-конверт (slug/status/at/eventId).
pub fn cli_deliver(conn: &Connection, slug: &str) -> Result<serde_json::Value, String> {
    if !compile::valid_slug_pub(slug) {
        return Err(format!("deliver: слаг «{slug}» не лезет в канон T4-NN"));
    }
    let (title, status, delivered_at, hard_pass, slots_total, exp_slots, diff_up, diff_down, sha10) =
        get_batch_core(conn, slug)?;
    if status == "void" {
        return Err(format!("batch {slug} закрыт (void) — провенанс неприкосновенен"));
    }
    if status == "delivered" {
        return Err(format!("batch {slug} уже сдан {}", delivered_at.unwrap_or_default()));
    }
    if hard_pass != 1 {
        return Err(format!(
            "batch {slug}: hard-гейты планирования НЕ пройдены — сдача запрещена (first run clean, §9)"
        ));
    }
    let at = chain::iso_now();
    let summary = format!(
        "Сдан {slug} «{title}»: {slots_total} слотов (EXP {exp_slots}), diff ↑{diff_up} ↓{diff_down}"
    );
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let evt = chain::append_event_tx(
        &tx,
        &chain::AppendInput {
            typ: "batch.delivered",
            summary: &summary,
            data: Some(&json!({
                "slug": slug,
                "slots": slots_total,
                "exp": exp_slots,
                "sha10": sha10,
            })),
            batch_slug: Some(slug),
        },
    )?;
    let changed = tx
        .execute(
            "UPDATE t4_batches SET status = 'delivered', delivered_at = ?1, event_id = ?2
             WHERE slug = ?3 AND status = 'compiled'",
            rusqlite::params![at, evt.id, slug],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("batch {slug}: статус сменился под руками — повтори запрос"));
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "slug": slug, "status": "delivered", "deliveredAt": at, "eventId": evt.id, "summary": summary }))
}

/// Закрытие батча (зеркало handlers.ts void): провенанс остаётся, номер
/// не забивается — рекомпиляция void-слага легальна (вердикт автора
/// 2026-10-20). Причина автора идёт хвостом в summary.
pub fn cli_void(conn: &Connection, slug: &str, reason: &str) -> Result<serde_json::Value, String> {
    if !compile::valid_slug_pub(slug) {
        return Err(format!("void: слаг «{slug}» не лезет в канон T4-NN"));
    }
    let (title, status, _, _, _, _, _, _, _) = get_batch_core(conn, slug)?;
    if status == "void" {
        return Err(format!("batch {slug} уже закрыт (void)"));
    }
    let at = chain::iso_now();
    let summary = format!(
        "Закрыт {slug} «{title}»: провенанс сохранён, номер не забивается — рекомпиляция void-слага легальна (вердикт автора 2026-10-20){}",
        if reason.trim().is_empty() || reason == "решение автора" {
            String::new()
        } else {
            format!(" · причина: {}", reason.trim())
        }
    );
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let evt = chain::append_event_tx(
        &tx,
        &chain::AppendInput {
            typ: "batch.void",
            summary: &summary,
            data: Some(&json!({ "slug": slug, "priorStatus": status })),
            batch_slug: Some(slug),
        },
    )?;
    let changed = tx
        .execute(
            "UPDATE t4_batches SET status = 'void' WHERE slug = ?1 AND status != 'void'",
            [slug],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("batch {slug}: статус сменился под руками — повтори запрос"));
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({ "slug": slug, "status": "void", "at": at, "eventId": evt.id, "summary": summary }))
}

/// Классификация сообщений ядра в RPC-таксономию (статусы движка).
pub fn classify_core_error(m: &str) -> (u16, &'static str) {
    if m.contains("не найден") {
        (404, "notFound")
    } else if m.contains("закрыт") || m.contains("уже") || m.contains("под руками") {
        (409, "conflict")
    } else {
        (422, "unprocessable")
    }
}
