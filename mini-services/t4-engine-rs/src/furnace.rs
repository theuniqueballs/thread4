//! FURNACE (ПЕЧЬ) — последняя инстанция перед сдачей (ARS NOVEAU-эра).
//!
//! Агент-оценщик на LLM через мост: смотрит, ЧТО налепили предыдущие
//! инстанции — (1) гейты: что поймали и что ПРОПУСТИЛИ; (2) тема: раскрыты
//! ли 21 история в кадрах; (3) писец: сделал ли работу (фейс-лок, канон,
//! форма тег-рана, NEG-флоры, бюджет тира); (4) итог. Составляет обширный
//! репорт БЕЗ ПИЗДЕЖА: что получилось — что нет.
//!
//! Вердикт PASS/WARN — конвейер идёт дальше; FAIL — автосдача стопится,
//! ручная сдача требует явного furnaceOverride автора (§1: автор владеет
//! вкусом). Артефакт: data/rehearsals/reports/<slug>-furnace.md, событие
//! furnace.reported.

use serde_json::{json, Value};

pub const FURNACE_VERDICTS: [&str; 3] = ["PASS", "WARN", "FAIL"];
pub const REPORT_EVENT: &str = "furnace.reported";

pub fn reports_dir() -> std::path::PathBuf {
    crate::textgates::rehearsal_dir().join("reports")
}

pub fn report_path(slug: &str) -> std::path::PathBuf {
    reports_dir().join(format!("{slug}-furnace.md"))
}

/// Валидация репорта от моста: строгая форма, честные значения.
pub fn validate_report(v: &Value) -> Result<Value, String> {
    let obj = v
        .as_object()
        .ok_or("furnace: репорт обязан быть JSON-объектом (strict)")?;
    for k in obj.keys() {
        if !["verdict", "summary", "findings", "strengths", "gatesEcho", "themeRead", "scribeWork"].contains(&k.as_str()) {
            return Err(format!("furnace: в репорте лишнее поле «{k}» (strict)"));
        }
    }
    let verdict = obj
        .get("verdict")
        .and_then(|x| x.as_str())
        .ok_or("furnace: verdict обязателен (PASS|WARN|FAIL)")?;
    if !FURNACE_VERDICTS.contains(&verdict) {
        return Err(format!(
            "furnace: verdict «{verdict}» вне словаря ({})",
            FURNACE_VERDICTS.join("|")
        ));
    }
    let summary = obj
        .get("summary")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or("furnace: summary обязателен (непустой)")?;
    let findings = obj
        .get("findings")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    for f in &findings {
        let area = f.get("area").and_then(|x| x.as_str()).unwrap_or("");
        let note = f.get("note").and_then(|x| x.as_str()).unwrap_or("");
        if area.trim().is_empty() || note.trim().is_empty() {
            return Err("furnace: каждая находка несёт area и note (strict)".into());
        }
    }
    Ok(json!({
        "verdict": verdict,
        "summary": summary,
        "findings": findings,
        "strengths": obj.get("strengths").and_then(|x| x.as_array()).cloned().unwrap_or_default(),
        "gatesEcho": obj.get("gatesEcho").and_then(|x| x.as_str()).unwrap_or(""),
        "themeRead": obj.get("themeRead").and_then(|x| x.as_str()).unwrap_or(""),
        "scribeWork": obj.get("scribeWork").and_then(|x| x.as_str()).unwrap_or(""),
    }))
}

/// Рендер репорта в markdown-артефакт (обширный, честный).
pub fn markdown_report(slug: &str, theme: &str, report: &Value, receipts: &[Value]) -> String {
    let mut l = Vec::new();
    let verdict = report.get("verdict").and_then(|v| v.as_str()).unwrap_or("?");
    l.push(format!("# ПЕЧЬ · FURNACE — {} «{}»", slug, theme));
    l.push(String::new());
    l.push(format!("**Вердикт: {verdict}**"));
    l.push(String::new());
    l.push(report.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string());
    l.push(String::new());
    for (key, title) in [
        ("themeRead", "## Тема: 21 история в кадрах"),
        ("scribeWork", "## Писец: регламент"),
        ("gatesEcho", "## Гейты: что поймали / что пропустили"),
    ] {
        if let Some(t) = report.get(key).and_then(|v| v.as_str()) {
            if !t.trim().is_empty() {
                l.push(String::new());
                l.push(title.to_string());
                l.push(String::new());
                l.push(t.trim().to_string());
            }
        }
    }
    let findings = report.get("findings").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if !findings.is_empty() {
        l.push(String::new());
        l.push("## Находки".into());
        for f in &findings {
            let area = f.get("area").and_then(|x| x.as_str()).unwrap_or("?");
            let sev = f.get("severity").and_then(|x| x.as_str()).unwrap_or("note");
            let slot = f.get("slot").and_then(|x| x.as_str()).unwrap_or("");
            let note = f.get("note").and_then(|x| x.as_str()).unwrap_or("");
            l.push(format!(
                "- **[{area}{slot}]** ({sev}) — {note}"
            ));
        }
    }
    let strengths = report.get("strengths").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if !strengths.is_empty() {
        l.push(String::new());
        l.push("## Что получилось".into());
        for s in &strengths {
            if let Some(t) = s.as_str() {
                l.push(format!("- {t}"));
            }
        }
    }
    if !receipts.is_empty() {
        l.push(String::new());
        l.push("## Квитанции батареи (как их видела машина)".into());
        for r in receipts {
            let gate = r.get("gate").and_then(|x| x.as_str()).unwrap_or("?");
            let level = r.get("level").and_then(|x| x.as_str()).unwrap_or("?");
            let verdict = r.get("verdict").and_then(|x| x.as_str()).unwrap_or("?");
            l.push(format!("- {gate} [{level}] — {verdict}"));
        }
    }
    l.push(String::new());
    l.push(format!(
        "_Печь — оценка LLM до глаза автора: финальный вердикт всегда за автором (§1)._"
    ));
    l.join("\n")
}

/// Прогон Печи: мост → валидация → артефакт + событие. Возвращает отчёт.
/// Соединение/летопись — передаёт этап (один писатель летописи — движок).
pub fn run(
    conn: &rusqlite::Connection,
    slug: &str,
    theme: &str,
    batch_markdown: &str,
    receipts: &[Value],
) -> Result<Value, String> {
    let contract = crate::collector::load(slug);
    let report_raw = crate::bridge::furnace_eval(
        slug,
        theme,
        batch_markdown,
        &json!(receipts),
        contract.as_ref(),
    )?;
    let report = validate_report(&report_raw)?;

    let md = markdown_report(slug, theme, &report, receipts);
    std::fs::create_dir_all(reports_dir()).map_err(|e| format!("reports/: {e}"))?;
    std::fs::write(report_path(slug), &md).map_err(|e| format!("reports/{slug}-furnace.md: {e}"))?;

    let verdict = report.get("verdict").and_then(|v| v.as_str()).unwrap_or("?").to_string();
    let findings_n = report.get("findings").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    {
        let _g = crate::pipeline::chain_lock();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let evt = crate::chain::append_event_tx(
            &tx,
            &crate::chain::AppendInput {
                typ: REPORT_EVENT,
                summary: &format!(
                    "{slug} «{theme}»: Печь оценила черновик — {verdict}, находок {findings_n}"
                ),
                data: Some(&json!({
                    "slug": slug,
                    "verdict": verdict,
                    "summary": report.get("summary"),
                    "findings": findings_n,
                    "report": report_path(slug).display().to_string(),
                })),
                batch_slug: Some(slug),
            },
        )
        .map_err(|m| m)?;
        tx.commit().map_err(|e| e.to_string())?;
        crate::live::info(
            crate::live::BLOCK_FURNACE,
            &format!("репорт Печи записан (событие {})", evt.id),
        );
    }
    Ok(report)
}

/// Последний вердикт Печи по слагу из летописи (для гварда сдачи).
pub fn last_verdict(conn: &rusqlite::Connection, slug: &str) -> Option<String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT data FROM t4_events WHERE batch_slug = ?1 AND type = ?2
             ORDER BY id DESC LIMIT 1",
            rusqlite::params![slug, REPORT_EVENT],
            |r| r.get(0),
        )
        .ok();
    let data: Value = serde_json::from_str(&raw?).ok()?;
    data.get("verdict").and_then(|v| v.as_str()).map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_ok_report() {
        let r = json!({
            "verdict": "WARN",
            "summary": "batch holds, 3 stories missing",
            "findings": [{"area": "theme", "slot": "P07", "severity": "warn", "note": "story tokens absent"}],
            "strengths": ["canon verbatim everywhere"],
            "themeRead": "18/24 stories visible",
            "scribeWork": "face lock held",
            "gatesEcho": "gates caught floors; missed palette drift"
        });
        assert_eq!(validate_report(&r).unwrap()["verdict"], "WARN");
    }

    #[test]
    fn validate_rejects_bad_verdict_and_keys() {
        let mut r = json!({"verdict": "MEGA", "summary": "x", "findings": []});
        assert!(validate_report(&r).is_err());
        r["verdict"] = json!("PASS");
        r["hack"] = json!(true);
        assert!(validate_report(&r).is_err());
    }

    #[test]
    fn validate_rejects_finding_without_note() {
        let r = json!({
            "verdict": "FAIL",
            "summary": "x",
            "findings": [{"area": "scribe"}]
        });
        assert!(validate_report(&r).is_err());
    }

    #[test]
    fn markdown_carries_all_sections() {
        let r = json!({
            "verdict": "PASS",
            "summary": "честный итог",
            "findings": [{"area": "gates", "slot": "P12", "severity": "note", "note": "пропущен дресс-конфликт"}],
            "strengths": ["фейс-лок во всех слотах"],
            "themeRead": "21/24",
            "scribeWork": "REGLEMENT OK",
            "gatesEcho": "floors пойманы"
        });
        let md = markdown_report("T4-46", "Moss", &r, &[json!({"gate": "floors", "level": "hard", "verdict": "PASS"})]);
        assert!(md.contains("Вердикт: PASS"));
        assert!(md.contains("P12"));
        assert!(md.contains("Квитанции батареи"));
        assert!(md.contains("§1"));
    }
}
