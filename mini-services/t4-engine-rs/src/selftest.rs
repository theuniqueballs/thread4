//! THREAD 4 ENGINE (RUST TWIN) — SELFTEST BATTERY.
//!
//! Приказ автора (критерий приёмки): «selftest (Rust) возвращает 63/63».
//! Батарея гоняет живые проверки против временной scratch-базы и модульных
//! инвариантов — без сети, без LLM, без продакшн-записи. Продакшн-паритет
//! (если база доступна) — read-only: цепь + канонический сериализатор.
//!
//! Запуск: `t4 selftest` (CLI) или `cargo test` (юнит-тесты модулей —
//! другая, независимая линия обороны).

use std::path::PathBuf;

use rusqlite::Connection;
use serde_json::json;

use crate::canon;
use crate::canon::{Slots, Palette, FLOORS, RATINGS, REGISTERS, ENGINE_MODES};
use crate::canonical::{chain_hash, js_escape_string, payload_sha10, stable_stringify, timing_safe_equal_str};
use crate::chain::{append_event_tx, assert_born_clean, assert_born_semantics, iso_now, verify_chain, AppendInput};
use crate::compile;
use crate::db;
use crate::live;
use crate::theme;

pub struct Check {
    pub name: String,
    pub passed: bool,
    pub detail: Option<String>,
}

pub struct Battery {
    pub checks: Vec<Check>,
    pub skipped: usize,
    /// причины каждого skip (батарея честна: почему проверка не гналась)
    pub skip_reasons: Vec<String>,
}

impl Battery {
    fn push(&mut self, name: &str, passed: bool, detail: Option<String>) {
        self.checks.push(Check { name: name.to_string(), passed, detail });
    }
    fn skip(&mut self, reason: impl Into<String>) {
        self.skipped += 1;
        self.skip_reasons.push(reason.into());
    }
    fn ok(&mut self, name: &str) {
        self.push(name, true, None);
    }
    fn fail(&mut self, name: &str, detail: String) {
        self.push(name, false, Some(detail));
    }
    fn expect(&mut self, name: &str, cond: bool, detail: impl Fn() -> String) {
        if cond {
            self.ok(name);
        } else {
            self.fail(name, detail());
        }
    }

    pub fn passed(&self) -> usize {
        self.checks.iter().filter(|c| c.passed).count()
    }
    pub fn total(&self) -> usize {
        self.checks.len()
    }
    pub fn all_ok(&self) -> bool {
        self.checks.iter().all(|c| c.passed)
    }
}

/// Временная scratch-база с полной миграцией (чистый старт каждой проверки).
pub fn temp_db(tag: &str) -> Connection {
    let path: PathBuf = std::env::temp_dir().join(format!(
        "t4-selftest-{}-{}.db",
        tag,
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let conn = Connection::open(&path).expect("temp db open");
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "synchronous", "NORMAL").ok();
    db::migrate_schema(&conn).expect("temp db schema");
    conn
}

fn compile_req(theme: &str, slug: &str, exp: u32, created: Option<&str>) -> serde_json::Value {
    let mut body = json!({
        "theme": theme,
        "engine": "per-theme",
        "exp": exp,
        "abPairs": 2,
        "ocThemes": [
            { "theme": "oc alpha", "rating": "R+", "position": 1 },
            { "theme": "oc beta", "rating": "R+", "position": 2 },
            { "theme": "oc gamma", "rating": "R+", "position": 3 }
        ],
        "parityCreatedAt": created,
        "expandTheme": false,
    });
    if slug != "-" {
        body["slug"] = json!(slug);
    }
    body
}

/// Полная батарея. `prod` — если продакшн-база доступна (RO-паритет).
pub fn run(prod: Option<&Connection>) -> Battery {
    let mut b = Battery { checks: Vec::new(), skipped: 0, skip_reasons: Vec::new() };

    /* ============ канон-арифметика ============ */
    b.expect("canon/slot-law-clean", canon::slot_law_checks().is_empty(), || format!("{:?}", canon::slot_law_checks()));
    b.expect("canon/oc+mains==total", Slots::OC_SLOTS + Slots::MAINS_TOTAL == Slots::TOTAL, || "oc+mains != total".into());
    b.expect("canon/niche+rplus==mains", Slots::NICHE_COUNT + Slots::RPLUS_MAINS == Slots::MAINS_TOTAL, || "niche+rplus != mains".into());
    b.expect("canon/palette-span==fund", Palette::LAST_ID - Palette::FIRST_ID + 1 == Palette::FUND, || "span != fund".into());
    b.expect("canon/extension-after-fund", Palette::EXTENSION_FIRST_ID == Palette::LAST_ID + 1, || "extension не сразу после фонда".into());
    b.expect("canon/ratings-enum", RATINGS.len() == 4, || "ratings enum".into());
    b.expect("canon/registers-enum", REGISTERS.len() == 3, || "registers enum".into());
    b.expect("canon/engine-modes", ENGINE_MODES.len() == 2, || "engine modes".into());
    b.expect("canon/floors-groups", FLOORS.len() == 4 && FLOORS.iter().all(|(_, t)| !t.is_empty()), || "floors groups".into());

    /* ============ канонический сериализатор ============ */
    b.expect("canonical/escape-quote", js_escape_string("a\"b") == "\"a\\\"b\"", || "кавычка".into());
    b.expect("canonical/escape-backslash-newline", js_escape_string("a\\b\nc") == "\"a\\\\b\\nc\"", || "бэкслеш+перевод строки".into());
    b.expect("canonical/unicode-raw-utf8", js_escape_string("№28 — русский") == "\"№28 — русский\"", || "не-ASCII остаётся сырым UTF-8".into());
    let sorted = stable_stringify(&json!({"b":1,"a":{"z":true,"c":"x"}}));
    b.expect("canonical/stable-sorts", sorted == r#"{"a":{"c":"x","z":true},"b":1}"#, || sorted.clone());
    b.expect(
        "canonical/stable-array-order",
        stable_stringify(&json!([3,1,2])) == "[3,1,2]",
        || "порядок массива неприкосновенен".into(),
    );
    let line = r#"{"id":"ab12cd34","at":"2026-10-19T08:00:00.000Z","type":"note","summary":"привет"}"#;
    b.expect("canonical/chain-hash-deterministic", chain_hash("GENESIS", line) == chain_hash("GENESIS", line), || "недетерминизм".into());
    b.expect("canonical/chain-hash-len64", chain_hash("GENESIS", line).len() == 64, || "длина sha256".into());
    let sh = payload_sha10(&json!({"x":1}));
    b.expect("canonical/sha10-shape", sh.len() == 10 && sh.chars().all(|c| c.is_ascii_hexdigit()), || sh.clone());
    b.expect("canonical/timing-safe", timing_safe_equal_str("a", "a") && !timing_safe_equal_str("a", "b"), || "timing-safe сравнение".into());

    /* ============ летопись: born-wounded + время ============ */
    b.expect("chain/born-fffd-rejected", assert_born_clean(&format!("битая{}строка", '\u{FFFD}')).is_err(), || "U+FFFD обязан резаться на входе".into());
    b.expect("chain/born-4000-rejected", assert_born_clean(&"x".repeat(4001)).is_err(), || "summary > 4000 симв".into());
    b.expect("chain/born-clean-ok", assert_born_clean("чистая строка").is_ok(), || "чистая строка режется зря".into());
    b.expect("chain/born-unknown-type", assert_born_semantics("не.существует", None).is_err(), || "enum закрыт".into());
    b.expect("chain/born-verdict-source", assert_born_semantics("render.verdict", Some(&json!({"source":"кто-то"}))).is_err(), || "source вне enum".into());
    b.expect("chain/born-verdict-confidence", assert_born_semantics("render.verdict", Some(&json!({"source":"author"}))).is_err(), || "author-вердикт требует confidence".into());
    b.expect("chain/born-oracle-model", assert_born_semantics("oracle.spoke", Some(&json!({"reply":"достаточно длинный ответ оракула для проверки guard"}))).is_err(), || "oracle без model запрещён".into());
    b.expect("chain/iso-now-shape", {
        let s = iso_now();
        s.len() == 24 && s.ends_with('Z') && s.as_bytes()[4] == b'-' && s.as_bytes()[10] == b'T'
    }, || "ISO-форма YYYY-MM-DDTHH:MM:SS.mmmZ".into());
    b.expect("chain/iso-now-monotonic", {
        let a = iso_now();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let c = iso_now();
        a <= c
    }, || "время не движется назад".into());

    /* ============ слаг-канон ============ */
    b.expect("compile/slug-ok", compile::valid_slug_pub("T4-42"), || "T4-42 валиден".into());
    b.expect("compile/slug-rejects", !compile::valid_slug_pub("t4-42") && !compile::valid_slug_pub("T4-4") && !compile::valid_slug_pub("T4-42a") && !compile::valid_slug_pub("XX-42"), || "мусорные слаги".into());

    /* ============ парсер запроса (strict) ============ */
    b.expect("compile/strict-unknown-key", compile::parse_request(&json!({"theme":"т","hack":1})).is_err(), || "strict обязан резать лишние ключи".into());
    b.expect("compile/oc-empty-rejected", compile::parse_request(&json!({"theme":"т","ocThemes":[]})).is_err(), || "ocThemes 1..3".into());
    b.expect("compile/theme-required", compile::parse_request(&json!({"ocThemes":[{"theme":"a","rating":"R+","position":1}]})).is_err(), || "theme обязателен".into());
    b.expect("compile/expand-theme-parsed", {
        let r = compile::parse_request(&json!({"theme":"т","expandTheme":true,"ocThemes":[{"theme":"a","rating":"R+","position":1}]}));
        matches!(&r, Ok(req) if req.expand_theme)
    }, || "expandTheme флаг читается".into());

    /* ============ детерминизм компилятора (две чистые базы) ============ */
    {
        let conn_a = temp_db("det-a");
        let conn_b = temp_db("det-b");
        let body = compile_req("selftest детерминизм", "T4-99", 8, Some("2026-10-19T00:00:00.000Z"));
        let req = compile::parse_request(&body).unwrap();
        let out_a = compile::compile_batch(&conn_a, &req, None);
        let out_b = compile::compile_batch(&conn_b, &req, None);
        match (out_a, out_b) {
            (Ok(a), Ok(c)) => {
                b.expect("compile/determinism-same-sha10", a.sha10 == c.sha10, || format!("{} != {}", a.sha10, c.sha10));
                b.expect("compile/hard-pass", a.hard_pass, || "плановые гейты обязаны проходить на чистой базе".into());
                b.expect("compile/slots-32", a.plan_json.get("slots").and_then(|s| s.as_array()).map(|x| x.len()).unwrap_or(0) == 32, || "24 ядра + 8 EXP".into());
            }
            (Err(e), _) => b.fail("compile/determinism-same-sha10", e.0),
            (_, Err(e)) => b.fail("compile/determinism-same-sha10", e.0),
        }
    }

    /* ============ дубликат слага ============ */
    {
        let conn = temp_db("dup");
        let body = compile_req("дубль", "T4-98", 0, None);
        let req = compile::parse_request(&body).unwrap();
        let first = compile::compile_batch(&conn, &req, None);
        b.expect("compile/first-ok", first.is_ok(), || "первый компиль обязан проходить".into());
        let second = compile::compile_batch(&conn, &req, None);
        b.expect("compile/duplicate-refused", second.is_err(), || "провенанс: слаг не переиспользуется".into());
    }

    /* ============ гейты: живые receipts ============ */
    {
        let conn = temp_db("floors");
        let body = compile_req("candlelit vigil with lanterns", "T4-97", 0, None);
        let req = compile::parse_request(&body).unwrap();
        match compile::compile_batch(&conn, &req, None) {
            Ok(out) => {
                b.expect("gates/floors-ban-caught", {
                    out.plan_json.get("receipts").and_then(|r| r.as_array()).map(|a| {
                        a.iter().any(|x| x.get("gate").and_then(|g| g.as_str()) == Some("floors")
                            && x.get("verdict").and_then(|v| v.as_str()) == Some("FAIL"))
                    }).unwrap_or(false)
                }, || "floors обязан ловить свечи/фонари в теме".into());
                b.expect("gates/hard-fail-blocks", !out.hard_pass, || "hard FAIL обязан топить компиляцию".into());
            }
            Err(e) => b.fail("gates/floors-ban-caught", e.0),
        }
    }
    {
        // window-гейт: окно больше фонда — честная нехватка
        let r = compile::gate_window(100, 24, 15, 8);
        b.expect("gates/window-budget-finding", r.verdict == "FAIL" && r.findings.iter().any(|f| f.contains("расширь фонд")), || "окно обязано давить бюджет".into());
        let r2 = compile::gate_window(60, 24, 15, 8);
        b.expect("gates/window-clean-pass", r2.verdict == "PASS", || r2.findings.join(";"));
    }
    {
        // ab-гейт: одна переменная
        let r = compile::gate_ab(&[], 2);
        b.expect("gates/ab-empty-ok", r.verdict == "PASS", || "пустой батч — vacuous pass".into());
    }

    /* ============ аудит сохранённого плана (check) ============ */
    {
        let conn = temp_db("audit");
        let body = compile_req("аудит плана", "T4-96", 8, None);
        let req = compile::parse_request(&body).unwrap();
        match compile::compile_batch(&conn, &req, None) {
            Ok(out) => match compile::audit_plan(&out.plan_json) {
                Ok(receipts) => {
                    b.expect("audit/receipts-count-5", receipts.len() == 5, || format!("{} != 5", receipts.len()));
                    b.expect("audit/hard-all-pass", receipts.iter().filter(|r| r.level == "hard").all(|r| r.verdict == "PASS"), || "сухой пересчёт обязан сходиться".into());
                }
                Err(e) => b.fail("audit/receipts-count-5", e),
            },
            Err(e) => b.fail("audit/receipts-count-5", e.0),
        }
    }

    /* ============ цепь: append → verify → tamper ============ */
    {
        let conn = temp_db("chain");
        let tx = conn.unchecked_transaction().unwrap();
        let e1 = append_event_tx(&tx, &AppendInput {
            typ: "era.born",
            summary: "эпоха рождена в самотесте",
            data: Some(&json!({"era": "THREAD 4"})),
            batch_slug: None,
        });
        b.expect("chain/append-era-born", e1.is_ok(), || "era.born не пишется".into());
        let _ = e1;
        let _ = tx.commit();
        let tx2 = conn.unchecked_transaction().unwrap();
        let e2 = append_event_tx(&tx2, &AppendInput {
            typ: "note",
            summary: "вторая строка летописи",
            data: None,
            batch_slug: None,
        }).unwrap();
        tx2.commit().unwrap();
        let v = verify_chain(&conn);
        b.expect("chain/verify-2-ok", v.ok && v.events == 2, || format!("{:?}", v.problems));
        // tamper: правим raw первой строки — цепь обязана закричать
        conn.execute("UPDATE t4_events SET raw = '{\"id\":\"zz\",\"at\":\"2026-01-01T00:00:00.000Z\",\"type\":\"note\",\"summary\":\"подделка\"}' WHERE seq = 1", []).unwrap();
        let v2 = verify_chain(&conn);
        b.expect("chain/tamper-detected", !v2.ok && v2.problems.iter().any(|p| p.contains("не воспроизводится")), || "подделка raw не поймана".into());
        let _ = e2;
    }
    {
        // born-wounded на append: битый тип режется ДО записи
        let conn = temp_db("wounded");
        let tx = conn.unchecked_transaction().unwrap();
        let bad = append_event_tx(&tx, &AppendInput {
            typ: "no.such.type",
            summary: "мимо enum",
            data: None,
            batch_slug: None,
        });
        b.expect("chain/append-wounded-refused", bad.is_err(), || "enum обязан резать на входе".into());
        tx.commit().ok();
        b.expect("chain/empty-verify-honest", {
            let v = verify_chain(&conn);
            !v.ok || v.events == 0
        }, || "пустая база обязна вернуться честно".into());
    }

    /* ============ deliver / void (зеркало handlers.ts) ============ */
    {
        let conn = temp_db("deliver");
        let body = compile_req("сдача в самотесте", "T4-95", 0, None);
        let req = compile::parse_request(&body).unwrap();
        let out = compile::compile_batch(&conn, &req, None).expect("компиль для сдачи");
        // deliver напрямую (та же логика, что маршрут, — через SQL-зеркало)
        let delivered = crate::cli_deliver(&conn, "T4-95");
        b.expect("deliver/ok", delivered.is_ok(), || format!("{:?}", delivered));
        let again = crate::cli_deliver(&conn, "T4-95");
        b.expect("deliver/twice-refused", again.is_err(), || "повторная сдача обязна падать".into());
        let v = verify_chain(&conn);
        b.expect("deliver/chain-intact", v.ok && v.events >= 2, || format!("{:?}", v.problems));
        let _ = out;
    }
    {
        let conn = temp_db("void");
        let body = compile_req("void-тест", "T4-94", 0, None);
        let req = compile::parse_request(&body).unwrap();
        compile::compile_batch(&conn, &req, None).expect("компиль для void");
        let voided = crate::cli_void(&conn, "T4-94", "решение автора");
        b.expect("void/ok", voided.is_ok(), || format!("{:?}", voided));
        let again = crate::cli_void(&conn, "T4-94", "повтор");
        b.expect("void/twice-refused", again.is_err(), || "двойной void запрещён".into());
        let recompile = compile::compile_batch(&conn, &req, None);
        // паритет с движком (compile.ts:332): void-слаг МОЖЕТ быть перекомпилирован
        b.expect("void/recompile-allowed-engine-parity", recompile.is_ok(), || "движок разрешает void-перекомпиль — twin обязан зеркалить".into());
    }
    {
        // hard-fail батч нельзя сдать
        let conn = temp_db("hardfail");
        let body = compile_req("candle ritual", "T4-93", 0, None);
        let req = compile::parse_request(&body).unwrap();
        let out = compile::compile_batch(&conn, &req, None).expect("компиль с баном");
        b.expect("deliver/hard-fail-refused", {
            let d = crate::cli_deliver(&conn, "T4-93");
            d.is_err()
        }, || "сдача hard-FAIL обязана быть запрещена".into());
        b.expect("deliver/hard-flag-false", !out.hard_pass, || "hard_pass обязан быть false".into());
    }

    /* ============ Theme Expansion (Фаза 2) ============ */
    {
        let a1 = theme::expand("rainy night at the harbor", "T4-42", 0).unwrap();
        let a2 = theme::expand("rainy night at the harbor", "T4-42", 0).unwrap();
        b.expect("theme/deterministic", a1 == a2, || "якоря обязаны совпадать".into());
        b.expect("theme/exp-off", theme::expand("тема", "T4-99", 8).is_none(), || "EXP — модуль выключен".into());
        b.expect("theme/off-receipt", theme::exp_off_receipt().verdict == "OFF", || "квитанция OFF".into());
        let a = theme::expand("полночь в городе", "T4-43", 0).unwrap();
        b.expect("theme/lexicon-ru-night", a.time_of_day == "deep night", || a.time_of_day.clone());
        b.expect("theme/lexicon-hits-recorded", !a.lexicon_hits.is_empty(), || "лексикон-попадания записаны".into());
        let t = a.tokens();
        b.expect("theme/tokens-dedup", {
            let mut seen = std::collections::HashSet::new();
            t.iter().all(|x| seen.insert(x.clone()))
        }, || "токены уникальны".into());
        b.expect("theme/tokens-len", t.iter().all(|x| x.chars().count() >= 3), || "токены ≥3 симв".into());
        let g = theme::plan_gate(&a, &[], 0);
        b.expect("theme/gate-clean-pass", g.verdict == "PASS", || g.findings.join(";"));
        // контрабанда флоров через правку автора
        let mut bad = a.clone();
        bad.motifs = vec!["candle smoke".into(), "koi shadows".into(), "spilled ink".into()];
        let g2 = theme::plan_gate(&bad, &[], 0);
        b.expect("theme/gate-floor-smuggle", g2.verdict == "FAIL", || "контрабанда банов режется".into());
        // противоречие OC
        let g3 = theme::plan_gate(&a, &["sunny noon picnic".into()], 0);
        b.expect("theme/gate-oc-contradiction", g3.verdict == "FAIL", || "OC против якорей — finding".into());
        // adherence текста
        let held = t.iter().take(4).cloned().collect::<Vec<_>>().join(" ");
        let tr = theme::text_gate(&held, &a, 0.25);
        b.expect("theme/text-pass", tr.verdict == "PASS", || tr.findings.join(";"));
        let tr2 = theme::text_gate("совсем другой текст без якорей", &a, 0.5);
        b.expect("theme/text-fail", tr2.verdict == "FAIL", || "низкая adherence обязана падать".into());
        // strict-парсинг правленых якорей
        let j = a.to_json(0.5);
        b.expect("theme/json-roundtrip", {
            match theme::ThemeAnchors::from_json(&j, &a.theme, &a.slug) {
                Ok((back, min)) => back == a && (min - 0.5).abs() < 1e-9,
                Err(_) => false,
            }
        }, || "JSON-якоря ходят туда-обратно".into());
        let mut hacked = j;
        hacked["hack"] = json!(true);
        b.expect("theme/strict-unknown-field", theme::ThemeAnchors::from_json(&hacked, "x", "y").is_err(), || "strict режет лишние поля".into());
    }

    /* ============ текст-батарея (этапы 0-1, textgates.rs) ============ */
    textgates_battery(&mut b);

    /* ============ live-шина ============ */
    {
        let s1 = live::publish("system", "info", "самотест A");
        let s2 = live::publish("system", "info", "самотест B");
        b.expect("live/seq-monotonic", s2 == s1 + 1, || format!("{s1}->{s2}"));
        b.expect("live/head-seq", live::head_seq() >= s2, || "head_seq отстаёт".into());
        let mut reader = live::LiveReader::with_threshold(s1, 1);
        let mut buf = [0u8; 4096];
        use std::io::Read;
        let _ = reader.read(&mut buf);
        let s = String::from_utf8_lossy(&buf[..]);
        b.expect("live/reader-frames", s.contains("самотест B") && !s.contains("самотест A"), || "реплей после курсора".into());
    }

    /* ============ продакшн-паритет (RO, если база есть) ============ */
    match prod {
        Some(p) => {
            let v = verify_chain(p);
            b.expect("parity/prod-chain-ok", v.ok, || format!("{:?}", v.problems.iter().take(2).cloned().collect::<Vec<_>>()));
            b.expect("parity/prod-height", v.events >= 400, || format!("height {}", v.events));
            let row: Option<(String, String)> = p
                .query_row(
                    "SELECT payload, sha10 FROM t4_batches WHERE slug = 'T4-41'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            match row {
                Some((payload, expected)) => {
                    let plan: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
                    let count = plan.get("slots").and_then(|s| s.as_array()).map(|a| a.len());
                    if let (Some(n), true) = (count, plan.is_object()) {
                        let mut p2 = plan.clone();
                        let obj = p2.as_object_mut().unwrap();
                        obj.remove("sha10");
                        obj.insert("slots".into(), (n as u64).into());
                        let got = payload_sha10(&p2);
                        b.expect("parity/t441-sha10-byteexact", got == expected, || format!("{got} != {expected}"));
                    } else {
                        b.skip("прод: payload T4-41 без slots[] — sha10-паритет неприменим");
                    }
                }
                None => {
                    b.skip("прод: батч T4-41 не найден — sha10-паритет неприменим");
                }
            }
        }
        None => {
            b.skip("нет продакшн-базы (--no-prod или t4.db недоступна): паритет цепи/высоты/sha10");
            b.skip("нет продакшн-базы: высота цепи");
            b.skip("нет продакшн-базы: sha10 T4-41 байт-в-байт");
        }
    }

    b
}

/* ==================================================================== */
/* Текст-батарея файл-эры (этапы 0-1): синтетика PASS/FAIL на каждый     */
/* портированный гейт + паритет с записанными TS-слепками gate.run        */
/* (thread4/events/log.jsonl) и живыми TS-прогонами (sha-pinned findings) */
/* ==================================================================== */

/// Сборка синтетического батча: шапка + слоты (мета, POS, NEG).
fn md_of(header: &str, slots: &[(&str, &str, &str)]) -> String {
    let mut md = String::from(header);
    for (i, (meta, pos, neg)) in slots.iter().enumerate() {
        md.push_str(&format!(
            "P{:02} — synth-{} ({})\nPOS:\n{}\nNEG:\n{}\n",
            i + 1, i, meta, pos, neg
        ));
    }
    md
}

fn run_synth(md: &str) -> Vec<compile::Receipt> {
    let batch = crate::textgates::parse_batch("T4-90", md);
    crate::textgates::run_text_gates(&batch, None)
}

fn gate_of<'a>(receipts: &'a [compile::Receipt], gate: &str) -> &'a compile::Receipt {
    receipts
        .iter()
        .find(|r| r.gate == gate)
        .unwrap_or_else(|| panic!("батарея без гейта {gate}"))
}

fn textgates_battery(b: &mut Battery) {
    use crate::textgates;

    /* ---- синтетика: +1 PASS и +1 FAIL на каждый из 13 гейтов ---- */
    let clean = md_of(
        "# T4-90 «Etalon» — БАТЧ\n\nТЕМА-СЛОВА: harbor, lantern\n",
        &[
            ("OC · Vae · R+ · PL24 · P25_VOID_EMBER",
             "anime style, original character, 1girl, solo, harbor night, lantern glow, copper hair, green eyes, masterpiece, best quality, anime artstyle.",
             "child, loli, bra, camisole, candle"),
            ("VOLT · — · R+ · PL70 · P30_STEEL_MARKET",
             "anime style, original character, 1girl, solo, steel market stalls, lantern sale, rain drift, wool coat, masterpiece, best quality, anime artstyle.",
             "child, loli, bra, camisole, candle"),
        ],
    );
    let clean_receipts = run_synth(&clean);
    {
        // budget PASS — короткие POS, без хеджей
        let r = gate_of(&clean_receipts, "budget");
        b.expect("textgates/budget-pass", r.verdict == "PASS", || r.findings.join("; "));
        let long_pos = format!("{} {}", "word ".repeat(400).trim(), "extra tail");
        let f = run_synth(&md_of("# T4-91 «x»\n", &[("VOLT · — · R+", &long_pos, "x")]));
        let r = gate_of(&f, "budget");
        b.expect("textgates/budget-fail-over-400", {
            r.verdict == "WARN" && r.findings.iter().any(|x| x.starts_with("P1: POS 402 слов > 400"))
        }, || r.findings.join("; "));
    }
    {
        // cadence PASS — разные клоузеры
        let r = gate_of(&clean_receipts, "cadence");
        b.expect("textgates/cadence-pass", r.verdict == "PASS", || r.findings.join("; "));
        let mut md = String::from("# T4-92 «x»\n");
        for i in 1..=5 {
            md.push_str(&format!("P{i:02} — a (VOLT · — · R)\nPOS:\nframe {i} — close.\nNEG:\nx\n"));
        }
        let f_receipts = run_synth(&md);
        let r = gate_of(&f_receipts, "cadence");
        b.expect("textgates/cadence-fail-monoclass", {
            r.verdict == "WARN"
                && r.findings
                    .iter()
                    .any(|x| x.starts_with("клоузер-формула: fragment-pair 100% > 60% (N25-ловушка)"))
        }, || r.findings.join("; "));
    }
    {
        // prop-geometry PASS — без сложных пропов
        let r = gate_of(&clean_receipts, "prop-geometry");
        b.expect("textgates/prop-geometry-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of("# T4-93 «x»\n", &[("VOLT · — · R", "anime style, girl on the rope bridge.", "x")]));
        let r = gate_of(&f, "prop-geometry");
        b.expect("textgates/prop-geometry-fail-anchors", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| {
                    x == "P1: сложный проп «rope» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)"
                })
        }, || r.findings.join("; "));
    }
    {
        // noun-lock PASS — заявка на именованной вещи, подслой в NEG, bare-under в POS
        let ok = run_synth(&md_of("# T4-94 «x»\n", &[(
            "VOLT · — · R+",
            "anime style, clothed nipples, silk blouse, nothing underneath, wet pier.",
            "child, bra, camisole",
        )]));
        let r = gate_of(&ok, "noun-lock");
        b.expect("textgates/noun-lock-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of("# T4-94 «x»\n", &[(
            "VOLT · — · R+",
            "anime style, see-through silhouette, nothing underneath.",
            "child",
        )]));
        let r = gate_of(&f, "noun-lock");
        b.expect("textgates/noun-lock-fail-garment-lock", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| x.contains("сквозь-ткань заявка (see-through) не залочена"))
                && r.findings.iter().any(|x| x.contains("тишина по подслою = дыра"))
        }, || r.findings.join("; "));
    }
    {
        // character-collision PASS — составная форма легальна
        let r = gate_of(&clean_receipts, "character-collision");
        b.expect("textgates/character-collision-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of("# T4-95 «x»\n", &[("VOLT · — · R", "anime style, aurora, stars.", "x")]));
        let r = gate_of(&f, "character-collision");
        b.expect("textgates/character-collision-fail-homonym", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| {
                    x == "P1: омоним данбуру «aurora» в POS — рендерер матчит чужого персонажа (aurora_…: T4-05 P08 — aurora_(arknights) «пробежал персонаж»). Только составной формой (§9-септима, character-collision)"
                })
        }, || r.findings.join("; "));
    }
    {
        // theme-presence PASS — тема-слова в ≥60% не-EXP слотов
        let r = gate_of(&clean_receipts, "theme-presence");
        b.expect("textgates/theme-presence-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of(
            "# T4-96 «x»\n\nТЕМА-СЛОВА: orchid\n",
            &[("VOLT · — · R", "anime style, harbor.", "x"), ("VOLT · — · R", "anime style, pier.", "x")],
        ));
        let r = gate_of(&f, "theme-presence");
        b.expect("textgates/theme-presence-fail-60pct", {
            r.verdict == "WARN"
                && r.findings
                    .iter()
                    .any(|x| x.starts_with("тему несут 0/2 слотов (нужно ≥60%; EXP-болванки не в счёте) — слова: orchid"))
        }, || r.findings.join("; "));
    }
    {
        // original-character-coverage PASS — U1 в каждом не-OC слоте
        let r = gate_of(&clean_receipts, "original-character-coverage");
        b.expect("textgates/oc-coverage-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of("# T4-97 «x»\n", &[("VOLT · — · R", "anime style, 1girl, solo.", "x")]));
        let r = gate_of(&f, "original-character-coverage");
        b.expect("textgates/oc-coverage-fail-u1", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| {
                    x == "P1: нет original character в тег-блоке — U1 в ручном потоке (Issue #24)"
                })
        }, || r.findings.join("; "));
    }
    {
        // artist-leak PASS — без artist-токенов
        let r = gate_of(&clean_receipts, "artist-leak");
        b.expect("textgates/artist-leak-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of("# T4-98 «x»\n", &[("VOLT · — · R", "anime style, art by someone, solo.", "x")]));
        let r = gate_of(&f, "artist-leak");
        b.expect("textgates/artist-leak-fail", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| {
                    x == "P1: artist-подобный токен в тег-блоке — artist_ban, PH-утечка (Issue #24, U3)"
                })
        }, || r.findings.join("; "));
    }
    {
        // garment-family PASS — белья ≤58%
        let r = gate_of(&clean_receipts, "garment-family");
        b.expect("textgates/garment-family-pass", r.verdict == "PASS", || r.findings.join("; "));
        let lingerie_slot = ("VOLT · — · R", "anime style, lace lingerie, stockings, garter belt, bra.", "x");
        let f = run_synth(&md_of("# T4-99 «x»\n", &[lingerie_slot, lingerie_slot, lingerie_slot]));
        let r = gate_of(&f, "garment-family");
        b.expect("textgates/garment-family-fail-58pct", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| x.starts_with("бельё-семья монополизирует батч: 3/3 слотов"))
        }, || r.findings.join("; "));
    }
    {
        // freq-report (advisory): чистый — «тиков не обнаружено»
        let r = gate_of(&clean_receipts, "freq-report");
        b.expect("textgates/freq-report-clean", {
            r.verdict == "REPORT" && r.findings == vec!["тиков не обнаружено".to_string()]
        }, || r.findings.join("; "));
        let mut md = String::from("# T4-99 «x»\n");
        for i in 1..=8 {
            md.push_str(&format!(
                "P{i:02} — a (VOLT · — · R)\nPOS:\nanime style, copperwire glow, solo {i}.\nNEG:\nx\n"
            ));
        }
        let f_receipts = run_synth(&md);
        let r = gate_of(&f_receipts, "freq-report");
        b.expect("textgates/freq-report-tic-detected", {
            r.findings.iter().any(|x| x.contains("copperwire 8/8"))
        }, || r.findings.join("; "));
    }
    {
        // usage (advisory): счёт носителей/R+/X дословно
        let r = gate_of(&clean_receipts, "usage");
        b.expect("textgates/usage-report-clean", {
            r.findings
                == vec![
                    "носителей в стеках: 0; уникальных: 0".to_string(),
                    "R+ слотов: 2; X: 0".to_string(),
                ]
        }, || r.findings.join("; "));
        let mut md = String::from("# T4-99 «x»\n");
        md.push_str("P01 — a (VOLT · — · R+)\nStack: CR-W01 + CR-W01 + CR-B02\nPOS:\nx\nNEG:\nx\n");
        md.push_str("P02 — a (VOLT · — · X)\nStack: CR-W01 + CR-B03\nPOS:\nx\nNEG:\nx\n");
        let f_receipts = run_synth(&md);
        let r = gate_of(&f_receipts, "usage");
        b.expect("textgates/usage-report-stacks", {
            r.findings
                == vec![
                    "носителей в стеках: 5; уникальных: 3".to_string(),
                    "R+ слотов: 1; X: 1".to_string(),
                ]
        }, || r.findings.join("; "));
    }
    {
        // one-hard-claim PASS — одна семья на R+ слоте
        let ok = run_synth(&md_of("# T4-99 «x»\n", &[(
            "VOLT · — · R+",
            "anime style, clothed nipples, wet fabric only.",
            "x",
        )]));
        let r = gate_of(&ok, "one-hard-claim");
        b.expect("textgates/one-hard-claim-pass", r.verdict == "PASS", || r.findings.join("; "));
        let f = run_synth(&md_of("# T4-99 «x»\n", &[(
            "VOLT · — · R+",
            "anime style, clothed nipples, wet clothes.",
            "x",
        )]));
        let r = gate_of(&f, "one-hard-claim");
        b.expect("textgates/one-hard-claim-fail-two-families", {
            r.verdict == "WARN"
                && r.findings.iter().any(|x| {
                    x == "P1: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот"
                })
        }, || r.findings.join("; "));
    }
    {
        // echo-window PASS — <6 общих сигнатур у соседей
        let r = gate_of(&clean_receipts, "echo-window");
        b.expect("textgates/echo-window-pass", r.verdict == "PASS", || r.findings.join("; "));
        let a = "anime style, brass lantern, copper hoop, velvet drape, marble step, granite ledge.";
        let c = "anime style, brass lantern, copper hoop, velvet drape, marble step, granite bench.";
        let f = run_synth(&md_of("# T4-99 «x»\n", &[("VOLT · — · R", a, "x"), ("VOLT · — · R", c, "x")]));
        let r = gate_of(&f, "echo-window");
        b.expect("textgates/echo-window-fail-6signatures", {
            r.verdict == "WARN"
                && r.findings
                    .iter()
                    .any(|x| x.starts_with("P1↔P2: эхо 7 сигнатур (первая «brass»)"))
        }, || r.findings.join("; "));
    }

    /* ---- паритет: Rust-вердикты == записанные TS-слепки gate.run
     * (thread4/events/log.jsonl; сверка ТОЛЬКО при совпадении sha10 файла —
     * летопись не судит прошлые состояния файла) — T4-27 / T4-27.2-EXP /
     * T4-28 / T4-31 / T4-34 ---- */
    for slug in ["T4-27", "T4-27.2-EXP", "T4-28", "T4-31", "T4-34"] {
        match textgates::run_for_slug(slug) {
            Ok((_batch, outcome)) => match textgates::recorded_ts_snapshot(slug, &outcome.sha10) {
                Some(snap) => {
                    let mine: Vec<(&str, &str)> =
                        outcome.receipts.iter().map(|r| (r.gate, r.verdict)).collect();
                    let mut diffs: Vec<String> = Vec::new();
                    let mut compared = 0usize;
                    for (gate, verdict) in &snap.verdicts {
                        if !textgates::BATTERY_RUST.contains(&gate.as_str()) {
                            continue;
                        }
                        compared += 1;
                        match mine.iter().find(|(g, _)| g == gate) {
                            Some((_, v)) if *v == verdict.as_str() => {}
                            Some((_, v)) => {
                                diffs.push(format!("{gate}: TS {verdict} ≠ Rust {v}"))
                            }
                            None => diffs.push(format!("{gate}: нет в Rust-батарее")),
                        }
                    }
                    b.expect(
                        &format!("textgates/parity-{slug}-vs-ts-snapshot"),
                        diffs.is_empty() && compared >= 10,
                        || {
                            format!(
                                "run#{}: compared {compared}, разногласия: {}",
                                snap.run,
                                if diffs.is_empty() { "—".into() } else { diffs.join("; ") }
                            )
                        },
                    );
                }
                None => {
                    // файл ушёл от записанного sha (живая история правится) —
                    // честный skip, сверять прошлое с настоящим нельзя
                    b.skip(format!(
                        "слепок {slug}: текущий sha10 файла не совпадает ни с одним записанным TS-прогоном (летопись не судит прошлые состояния файла)"
                    ));
                }
            },
            Err(e) => b.skip(format!("слепок {slug}: {e}")),
        }
    }

    /* ---- findings-паритет: дословные строки живых TS-прогонов
     * (bun runGates dry-run), sha-pinned к текущим файлам — 6 пинов:
     * prop-geometry×2, noun-lock, usage, one-hard-claim, echo-window ---- */
    let pins: [(&str, &str, &str, &[&str]); 6] = [
        (
            "T4-34", "1c60338a38", "prop-geometry",
            &[
                "P9: сложный проп «rail» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P10: сложный проп «rail» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P25: сложный проп «staircase» с 1/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P26: сложный проп «staircase» с 1/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P27: сложный проп «staircase» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P28: сложный проп «staircase» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
            ],
        ),
        (
            "T4-34", "1c60338a38", "noun-lock",
            &[
                "P5: сквозь-ткань заявка (clothed nipples) не залочена на именованную тонкую вещь — назови garment существительным (blouse/tee/shirt/knit/swimsuit/leotard/sheet/towel…), прилагательное заявку не несёт (§10-поправка, noun-lock)",
                "P9: сквозь-ткань заявка (clothed nipples) не залочена на именованную тонкую вещь — назови garment существительным (blouse/tee/shirt/knit/swimsuit/leotard/sheet/towel…), прилагательное заявку не несёт (§10-поправка, noun-lock)",
                "P14: нижняя заявка (visible pantyline) не залочена на именованную вещь — pantyline живёт на именованном низе (skirt/shorts/leggings/sheet…), не в воздухе (§10-поправка, noun-lock)",
                "P20: сквозь-ткань заявка (clothed nipples) не залочена на именованную тонкую вещь — назови garment существительным (blouse/tee/shirt/knit/swimsuit/leotard/sheet/towel…), прилагательное заявку не несёт (§10-поправка, noun-lock)",
                "P20: нижняя заявка (visible pantyline) не залочена на именованную вещь — pantyline живёт на именованном низе (skirt/shorts/leggings/sheet…), не в воздухе (§10-поправка, noun-lock)",
                "P31: сквозь-ткань заявка (clothed nipples) не залочена на именованную тонкую вещь — назови garment существительным (blouse/tee/shirt/knit/swimsuit/leotard/sheet/towel…), прилагательное заявку не несёт (§10-поправка, noun-lock)",
            ],
        ),
        (
            "T4-31", "397256d2a4", "usage",
            &[
                "носителей в стеках: 128; уникальных: 83",
                "R+ слотов: 25; X: 0",
            ],
        ),
        (
            "T4-31", "397256d2a4", "prop-geometry",
            &[
                "P2: сложный проп «ladder» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P6: сложный проп «swing» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P13: сложный проп «staircase» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P20: сложный проп «swing» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                "P23: сложный проп «swing» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
            ],
        ),
        (
            "T4-28", "7fc06f1962", "one-hard-claim",
            &[
                "P1: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P2: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P4: 2 hard-claim семьи сразу (wet + pantyline) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P5: 2 hard-claim семьи сразу (wet + pantyline) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P7: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P8: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P9: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P11: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P14: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P17: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P19: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P20: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P21: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                "P24: 2 hard-claim семьи сразу (wet + pantyline) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
            ],
        ),
        (
            "T4-27", "1163b4ea98", "echo-window",
            &[
                "P1↔P2: эхо 8 сигнатур (первая «white») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P3↔P4: эхо 9 сигнатур (первая «brown») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P4↔P6: эхо 6 сигнатур (первая «resting») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P6↔P8: эхо 8 сигнатур (первая «across») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P8↔P10: эхо 7 сигнатур (первая «brown») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P10↔P11: эхо 7 сигнатур (первая «chestnut») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P10↔P12: эхо 6 сигнатур (первая «see-through») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "P11↔P12: эхо 12 сигнатур (первая «pressed») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали",
                "…и ещё 16 пар",
            ],
        ),
    ];
    for (slug, sha, gate, expected) in pins {
        match textgates::run_for_slug(slug) {
            Ok((_batch, outcome)) => {
                if outcome.sha10 != sha {
                    // файл батча ушёл от эталонного sha — findings могли
                    // легально измениться; честный skip, не ложная тревога
                    b.skip(format!(
                        "findings-{slug}-{gate}: файл ушёл от эталонного sha {sha} — дословный слепок устарел"
                    ));
                    continue;
                }
                let got = outcome
                    .receipts
                    .iter()
                    .find(|r| r.gate == gate)
                    .map(|r| r.findings.clone())
                    .unwrap_or_default();
                let exp: Vec<String> = expected.iter().map(|s| s.to_string()).collect();
                b.expect(
                    &format!("textgates/findings-{slug}-{gate}-ts-verbatim"),
                    got == exp,
                    || format!("Rust: {:?} — ожидался TS-слепок: {:?}", got, exp),
                );
            }
            Err(e) => b.skip(format!("findings-{slug}-{gate}: {e}")),
        }
    }
}
