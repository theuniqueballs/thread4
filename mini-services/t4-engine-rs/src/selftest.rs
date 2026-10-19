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
}

impl Battery {
    fn push(&mut self, name: &str, passed: bool, detail: Option<String>) {
        self.checks.push(Check { name: name.to_string(), passed, detail });
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
    let mut b = Battery { checks: Vec::new(), skipped: 0 };

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
                        b.skipped += 1;
                    }
                }
                None => {
                    b.skipped += 1;
                }
            }
        }
        None => {
            b.skipped += 3;
        }
    }

    b
}
