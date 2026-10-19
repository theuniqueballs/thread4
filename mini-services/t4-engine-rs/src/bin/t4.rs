//! THREAD 4 — RUST CLI (`t4`).
//!
//! Приказ (Фаза 1): «Перепиши thread4/cli.ts и бизнес-логику на Rust…
//! все команды должны работать с теми же флагами». CLI работает с базами
//! НАПРЯМУЮ (без HTTP): scratch — чтение-запись, продакшн — только RO.
//!
//! Граница честности: `scribe` — LLM-слой (z-ai-web-dev-sdk, Node), он
//! ДЕЛЕГИРУЕТСЯ в bun thread4/cli.ts с потоком stdout — как мост.
//! Всё детерминистичное (компиль, гейты, цепь, сдача) — здесь, в Rust.

use std::path::PathBuf;
use std::process::Command;

use clap::{Parser, Subcommand};
use rusqlite::Connection;
use serde_json::{json, Value};

use t4_engine_rs::{chain, compile, db, selftest, theme};

const ABOUT: &str = "THREAD 4 Rust CLI — ядро компиляции/гейтов/цепи без HTTP (scratch RW, продакшн RO)";

#[derive(Parser)]
#[command(name = "t4", version = "1.1.0", about = ABOUT)]
struct Cli {
    /// Путь к рабочей базе (по умолчанию — scratch twin'а)
    #[arg(long, global = true)]
    db: Option<PathBuf>,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Однажды: родить летопись (era.born + spec.imported + law.ratified)
    Seed,
    /// Скомпилировать план батча (памятуя окно ротации)
    Compile {
        /// Тема батча (1..200)
        theme: String,
        /// OC-темы: "Тема:R+|Тема:R+|Тема:R+" (1..3)
        #[arg(long)]
        oc: String,
        /// EXP-слоты (0..9)
        #[arg(long, default_value_t = 8)]
        exp: u32,
        /// A/B-пары (2..3)
        #[arg(long, default_value_t = 2)]
        ab: u32,
        /// Движок: per-theme | per-theme raw-plus
        #[arg(long, default_value = "per-theme")]
        engine: String,
        /// Слаг T4-NN (иначе — следующий номер)
        #[arg(long)]
        slug: Option<String>,
        /// Список видов: R37,R38
        #[arg(long)]
        species: Option<String>,
        /// Заметка автора
        #[arg(long)]
        notes: Option<String>,
        /// Idempotency-Key (8..128: [A-Za-z0-9._-])
        #[arg(long)]
        idem: Option<String>,
        /// Фаза 2: Theme Expansion + гейт №25 (для EXP — выключен)
        #[arg(long, default_value_t = true)]
        expand_theme: bool,
        /// Правленые якоря автора (JSON-файл из /v1/theme/expand)
        #[arg(long)]
        theme_anchors: Option<PathBuf>,
        /// Печатать план JSON-ом
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Писец (LLM-мост): делегируется в bun thread4/cli.ts, stdout — поток
    Scribe {
        slug: String,
        /// Максимум кругов ремонта (по умолчанию 3)
        #[arg(long, default_value_t = 3)]
        rounds: u32,
    },
    /// Сухой прогон гейтов по сохранённому плану (событий НЕТ)
    Check {
        slug: String,
        /// Файл текста батча — прогнать гейт №25 (theme/adherence)
        #[arg(long)]
        text: Option<PathBuf>,
        /// Показать чистый JSON
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Официальный прогон гейтов: gate.run-событие в летопись
    Gates {
        slug: String,
        /// Текстовая батарея файл-эры (13 словарных гейтов Rust по batches/<slug>.md);
        /// для scratch-слогов пишет gate.run + t4_gate_runs, исторические — чистая печать
        #[arg(long, default_value_t = false)]
        text: bool,
        /// Чистый JSON (только с --text)
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Сдать батч (batch.delivered; hard-гейты обязаны PASS)
    Deliver {
        slug: String,
    },
    /// Закрыть батч навсегда (провенанс остаётся, номер не переиспользуется)
    Void {
        slug: String,
        /// Причина (по умолчанию «решение автора»)
        #[arg(default_value = "решение автора")]
        reason: String,
    },
    /// Структурный дрейф батча против окна ротации (отчёт, не гейт)
    Drift {
        slug: String,
        /// Порог повтора (мин. вхождений)
        #[arg(long, default_value_t = 2)]
        min: u32,
        /// Сколько верхних строк показать
        #[arg(long, default_value_t = 10)]
        top: u32,
        /// Чистый JSON
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Хеш-цепь: полная сверка (append-only, --heal запрещён доктриной)
    Verify {
        /// Проверить только продакшн (RO)
        #[arg(long, default_value_t = false)]
        prod: bool,
        #[arg(long, hide = true)]
        heal: bool,
    },
    /// Состояние летописей (продакшн RO + рабочая)
    State,
    /// Батарея самотеста (>=63 проверки; продакшн — только RO-паритет)
    Selftest {
        /// Не проверять продакшн-паритет
        #[arg(long, default_value_t = false)]
        no_prod: bool,
    },
}

fn open_db(db_arg: &Option<PathBuf>) -> Result<Connection, String> {
    match db_arg {
        Some(p) => {
            let p = p.clone();
            if let Some(dir) = p.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let conn = Connection::open(&p).map_err(|e| e.to_string())?;
            conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
            conn.pragma_update(None, "synchronous", "NORMAL").map_err(|e| e.to_string())?;
            db::migrate_schema(&conn).map_err(|e| e.to_string())?;
            Ok(conn)
        }
        None => db::open_scratch_rw().map_err(|e| format!("scratch-база: {e}")),
    }
}

fn parse_oc(spec: &str) -> Result<Vec<(String, String, u32)>, String> {
    let mut out = Vec::new();
    for (i, part) in spec.split('|').enumerate() {
        let (theme, rating) = part
            .rsplit_once(':')
            .ok_or_else(|| format!("--oc: кусок №{} без рейтинга — жди «Тема:R+»", i + 1))?;
        if !["PG-13", "R", "R+", "X"].contains(&rating) {
            return Err(format!("--oc: рейтинг «{rating}» вне PG-13|R|R+|X"));
        }
        out.push((theme.trim().to_string(), rating.trim().to_string(), (i + 1) as u32));
    }
    if out.is_empty() || out.len() > 3 {
        return Err("--oc: 1..3 OC-тем".into());
    }
    Ok(out)
}

fn print_receipts(receipts: &[Value]) {
    for r in receipts {
        let gate = r.get("gate").and_then(|g| g.as_str()).unwrap_or("?");
        let level = r.get("level").and_then(|g| g.as_str()).unwrap_or("?");
        let verdict = r.get("verdict").and_then(|g| g.as_str()).unwrap_or("?");
        println!("  [{level:>4}] {gate:<18} {verdict}");
        for f in r.get("findings").and_then(|x| x.as_array()).unwrap_or(&Vec::new()) {
            println!("         · {}", f.as_str().unwrap_or(""));
        }
        for n in r.get("notes").and_then(|x| x.as_array()).unwrap_or(&Vec::new()) {
            println!("         ~ {}", n.as_str().unwrap_or(""));
        }
    }
}

fn die(msg: &str) -> ! {
    eprintln!("t4: {msg}");
    std::process::exit(1);
}

fn main() {
    let cli = Cli::parse();
    let db_arg = cli.db.clone();
    match cli.cmd {
        Cmd::Seed => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            let born = conn
                .query_row(
                    "SELECT COUNT(*) FROM t4_events WHERE type = 'era.born'",
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0);
            if born > 0 {
                println!("t4 seed: летопись уже рождена — пропуск (идемпотентно)");
                return;
            }
            let tx = conn.unchecked_transaction().unwrap();
            chain::append_event_tx(&tx, &chain::AppendInput {
                typ: "era.born",
                summary: "Эпоха THREAD 4 рождена (Rust CLI seed)",
                data: Some(&json!({"era": "THREAD 4", "bornBy": "t4-cli"})),
                batch_slug: None,
            }).unwrap();
            chain::append_event_tx(&tx, &chain::AppendInput {
                typ: "spec.imported",
                summary: "Спеки эпохи: канон 1.9.0, полки Rust-ядра",
                data: Some(&json!({"canon": "1.9.0", "fam": "2.3.0"})),
                batch_slug: None,
            }).unwrap();
            chain::append_event_tx(&tx, &chain::AppendInput {
                typ: "law.ratified",
                summary: "Законы №27 ТОН-НЕ-ЩИТ · №28 ПРОСВЕТ-ЧЁТКОСТЬ · №29 ДРЕСС-КОД ратифицированы",
                data: Some(&json!({"laws": [27, 28, 29]})),
                batch_slug: None,
            }).unwrap();
            tx.commit().unwrap();
            let v = chain::verify_chain(&conn);
            println!("t4 seed: летопись рождена — {} звена, ЦЕЛА: {}", v.events, v.ok);
        }
        Cmd::Compile { theme, oc, exp, ab, engine, slug, species, notes, idem, expand_theme, theme_anchors, json: as_json } => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            let oc_parsed = parse_oc(&oc).unwrap_or_else(|m| die(&m));
            let mut body = json!({
                "theme": theme,
                "engine": engine,
                "exp": exp,
                "abPairs": ab,
                "ocThemes": oc_parsed.iter().map(|(t, r, p)| json!({
                    "theme": t, "rating": r, "position": p
                })).collect::<Vec<_>>(),
                "expandTheme": expand_theme,
            });
            if let Some(s) = slug {
                body["slug"] = json!(s);
            }
            if let Some(sp) = &species {
                let list: Vec<&str> = sp.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                body["species"] = json!({ "on": !list.is_empty(), "count": list.len(), "list": list });
            } else {
                body["species"] = json!({ "on": false, "count": 0, "list": [] });
            }
            if let Some(n) = notes {
                body["notes"] = json!(n);
            }
            if let Some(path) = &theme_anchors {
                let txt = std::fs::read_to_string(path)
                    .unwrap_or_else(|e| die(&format!("theme-anchors: {e}")));
                body["themeAnchors"] = serde_json::from_str(&txt)
                    .unwrap_or_else(|e| die(&format!("theme-anchors JSON: {e}")));
            }
            let req = compile::parse_request(&body).unwrap_or_else(|m| die(&m));
            let resolved = req.slug.clone().unwrap_or_else(|| format!("T4-{:02}", compile::next_batch_number(&conn)));

            /* Фаза 2: якоря + гейт №25 — до транзакции */
            let mut theme_out: Option<(Value, theme::ThemeReceipt)> = None;
            if req.expand_theme {
                if req.exp > 0 {
                    println!("тема-модуль: EXP-батч — Theme Expansion и гейт №25 выключены (приказ)");
                    theme_out = Some((Value::Null, theme::exp_off_receipt()));
                } else {
                    let (anchors, min) = match &req.theme_anchors {
                        Some(v) => theme::ThemeAnchors::from_json(v, &req.theme, &resolved).unwrap_or_else(|m| die(&m)),
                        None => {
                            let a = theme::expand(&req.theme, &resolved, 0)
                                .unwrap_or_else(|| die("тема не разложилась"));
                            (a, theme::DEFAULT_MIN_ADHERENCE)
                        }
                    };
                    let oc_list: Vec<String> = req.oc_themes.iter().map(|o| o.theme.clone()).collect();
                    let gate = theme::plan_gate(&anchors, &oc_list, 0);
                    println!("— якоря ({}) —", anchors.tokens().len());
                    println!("  локейшн {} · время {} · свет {}", anchors.locale, anchors.time_of_day, anchors.light);
                    println!("  настроение {} · гардероб {} · камера {}", anchors.palette_mood, anchors.wardrobe_family, anchors.camera);
                    println!("  мотивы: {}", anchors.motifs.join(" / "));
                    println!("  атмосфера: {}", anchors.atmosphere.join(" / "));
                    println!("  токены: {}", anchors.tokens().join(", "));
                    println!("— гейт №25 (тема) —");
                    println!("  [hard] theme               {}", gate.verdict);
                    for f in &gate.findings {
                        println!("         · {f}");
                    }
                    if gate.verdict == "FAIL" {
                        die("тема-гейт №25 FAIL — правь якоря или тему");
                    }
                    theme_out = Some((anchors.to_json(min), gate));
                }
            }

            let out = compile::compile_batch(&conn, &req, idem.as_deref()).unwrap_or_else(|e| die(&e.0));
            if as_json {
                println!("{}", serde_json::to_string_pretty(&out.plan_json).unwrap());
            } else {
                println!("план {} «{}» — sha10 {}, слотов {}, seed {}", out.slug, req.theme, out.sha10,
                    out.plan_json.get("slots").and_then(|s| s.as_array()).map(|a| a.len()).unwrap_or(0),
                    out.seed_hex);
                if let Some(receipts) = out.plan_json.get("receipts").and_then(|r| r.as_array()) {
                    println!("— планировочные гейты —");
                    print_receipts(receipts);
                }
                println!("hard: {} · событие seq {} (scratch)", if out.hard_pass { "PASS" } else { "FAIL" }, out.event_seq);
            }
            if let Some((anchors_json, _)) = &theme_out {
                if !anchors_json.is_null() {
                    let tx = conn.unchecked_transaction().unwrap();
                    let evt = chain::append_event_tx(&tx, &chain::AppendInput {
                        typ: "note",
                        summary: &format!("Theme Expansion: {} «{}» — якоря записаны (CLI)", out.slug, req.theme),
                        data: Some(&json!({ "module": "theme-expansion", "slug": out.slug, "anchors": anchors_json })),
                        batch_slug: Some(&out.slug),
                    }).unwrap();
                    tx.commit().unwrap();
                    println!("тема-запись: note {} в летопись", evt.id);
                }
            }
        }
        Cmd::Scribe { slug, rounds } => {
            let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
            println!("t4 scribe: LLM-слой (z-ai) живёт в Node-мосту — делегирую: bun thread4/cli.ts scribe {slug} {rounds}");
            let status = Command::new("bun")
                .arg("thread4/cli.ts")
                .arg("scribe")
                .arg(&slug)
                .arg(rounds.to_string())
                .current_dir(repo)
                .status()
                .unwrap_or_else(|e| die(&format!("bun не запущен: {e}")));
            std::process::exit(status.code().unwrap_or(1));
        }
        Cmd::Check { slug, text, json: as_json } => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            let payload: Option<String> = conn
                .query_row("SELECT payload FROM t4_batches WHERE slug = ?1", [&slug], |r| r.get(0))
                .ok();
            let payload = payload.unwrap_or_else(|| die(&format!("batch {slug} не найден")));
            let plan: Value = serde_json::from_str(&payload).unwrap_or_else(|e| die(&e.to_string()));
            let receipts = compile::audit_plan(&plan).unwrap_or_else(|m| die(&m));
            let mut all: Vec<Value> = receipts.iter().map(|r| json!({
                "gate": r.gate, "level": r.level, "verdict": r.verdict,
                "findings": r.findings, "notes": r.notes,
            })).collect();
            if let Some(tp) = &text {
                let txt = std::fs::read_to_string(tp).unwrap_or_else(|e| die(&format!("text: {e}")));
                let theme_str = plan.get("theme").and_then(|t| t.as_str()).unwrap_or("");
                let resolved = req_slug_or_default(&plan, &slug);
                match theme::expand(theme_str, &resolved, 0) {
                    Some(a) => {
                        let tr = theme::text_gate(&txt, &a, theme::DEFAULT_MIN_ADHERENCE);
                        all.push(tr.to_json());
                    }
                    None => println!("гейт №25: EXP-батч — выключен (OFF)"),
                }
            }
            if as_json {
                println!("{}", serde_json::to_string_pretty(&json!({ "slug": slug, "receipts": all })).unwrap());
            } else {
                println!("check {slug} (сухой — события не пишутся):");
                print_receipts(&all);
            }
            let hard_fail = all.iter().any(|r| r.get("level").and_then(|x| x.as_str()) == Some("hard")
                && r.get("verdict").and_then(|x| x.as_str()) == Some("FAIL"));
            if hard_fail {
                std::process::exit(1);
            }
        }
        Cmd::Gates { slug, text, json: as_json } => {
            if text {
                /* Текстовая батарея файл-эры (этапы 0-1, textgates.rs): файлы
                 * репо RO; scratch-слаг → gate.run + t4_gate_runs в рабочую
                 * базу; исторический (прод) — чистый анализ, БЕЗ записей. */
                let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
                let (_batch, outcome) = match t4_engine_rs::textgates::run_for_slug(&slug) {
                    Ok(v) => v,
                    Err(e) => die(&e.to_string()),
                };
                let receipts = t4_engine_rs::textgates::receipts_json(&outcome.receipts);
                if as_json {
                    println!("{}", serde_json::to_string_pretty(&json!({
                        "slug": slug,
                        "sha10": outcome.sha10,
                        "batteryRust": t4_engine_rs::textgates::BATTERY_RUST,
                        "batteryTs": t4_engine_rs::textgates::BATTERY_TS,
                        "hardPass": outcome.hard_pass,
                        "hardFails": outcome.hard_fails(),
                        "receipts": receipts,
                    })).unwrap());
                } else {
                    println!("gates {slug} (текст-батарея Rust, {}/30 — словарные):", t4_engine_rs::textgates::BATTERY_RUST.len());
                    print_receipts(&receipts);
                }
                let in_db: bool = conn
                    .query_row("SELECT 1 FROM t4_batches WHERE slug = ?1", [&slug], |_| Ok(()))
                    .is_ok();
                if in_db {
                    let (event_id, seq, run_index) =
                        t4_engine_rs::textgates::record_gate_run(&conn, &outcome)
                            .unwrap_or_else(|m| die(&m));
                    println!("записано: gate.run {event_id} (seq {seq}, прогон #{run_index}) в рабочую летопись");
                } else {
                    println!("слаг {slug} исторический (не в рабочей базе) — чистый анализ, записей нет (прод не тронут)");
                }
                if !outcome.hard_pass {
                    std::process::exit(1);
                }
                return;
            }
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            let payload: Option<String> = conn
                .query_row("SELECT payload FROM t4_batches WHERE slug = ?1", [&slug], |r| r.get(0))
                .ok();
            let payload = payload.unwrap_or_else(|| die(&format!("batch {slug} не найден")));
            let plan: Value = serde_json::from_str(&payload).unwrap_or_else(|e| die(&e.to_string()));
            let receipts = compile::audit_plan(&plan).unwrap_or_else(|m| die(&m));
            let hard_pass = receipts.iter().filter(|r| r.level == "hard").all(|r| r.verdict == "PASS");
            let receipts_json: Vec<Value> = receipts.iter().map(|r| json!({
                "gate": r.gate, "level": r.level, "verdict": r.verdict,
                "findings": r.findings, "notes": r.notes,
            })).collect();
            println!("gates {slug} (официальный прогон — gate.run в летопись):");
            print_receipts(&receipts_json);
            let at = chain::iso_now();
            let tx = conn.unchecked_transaction().unwrap();
            let evt = chain::append_event_tx(&tx, &chain::AppendInput {
                typ: "gate.run",
                summary: &format!("Гейты {slug}: hard {} (планировочные, Rust CLI)", if hard_pass { "PASS" } else { "FAIL" }),
                data: Some(&json!({ "slug": slug, "hardPass": hard_pass, "receipts": receipts_json })),
                batch_slug: Some(&slug),
            }).unwrap();
            let run_index: i64 = conn
                .query_row("SELECT COUNT(*) FROM t4_gate_runs WHERE batch_slug = ?1", [&slug], |r| r.get(0))
                .unwrap_or(0) + 1;
            tx.execute(
                "INSERT INTO t4_gate_runs (batch_slug, run_index, hard_pass, receipts, at, event_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![slug, run_index, if hard_pass { 1 } else { 0 }, serde_json::to_string(&receipts_json).unwrap(), at, evt.id],
            ).ok();
            tx.commit().unwrap();
            println!("записано: gate.run {} (seq {})", evt.id, evt.seq);
            if !hard_pass {
                std::process::exit(1);
            }
        }
        Cmd::Deliver { slug } => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            match t4_engine_rs::cli_deliver(&conn, &slug) {
                Ok(v) => {
                    println!("{}", v.get("summary").and_then(|x| x.as_str()).unwrap_or("сдано"));
                    println!("t4 deliver: {} → {} ({})", slug,
                        v.get("status").and_then(|x| x.as_str()).unwrap_or("?"),
                        v.get("deliveredAt").and_then(|x| x.as_str()).unwrap_or("?"));
                }
                Err(m) => die(&m),
            }
        }
        Cmd::Void { slug, reason } => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            match t4_engine_rs::cli_void(&conn, &slug, &reason) {
                Ok(v) => println!("{}", v.get("summary").and_then(|x| x.as_str()).unwrap_or("закрыт")),
                Err(m) => die(&m),
            }
        }
        Cmd::Drift { slug, min, top, json: as_json } => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            let payload: Option<String> = conn
                .query_row("SELECT payload FROM t4_batches WHERE slug = ?1", [&slug], |r| r.get(0))
                .ok();
            let payload = payload.unwrap_or_else(|| die(&format!("batch {slug} не найден")));
            let plan: Value = serde_json::from_str(&payload).unwrap_or_else(|e| die(&e.to_string()));
            let my_palettes: Vec<String> = plan.get("slots").and_then(|s| s.as_array()).map(|a| {
                a.iter().filter_map(|x| x.get("paletteId").and_then(|p| p.as_str()).map(String::from)).collect()
            }).unwrap_or_default();
            let mut stmt = conn.prepare(
                "SELECT slug, payload FROM t4_batches WHERE status = 'delivered' AND slug != ?1
                 ORDER BY delivered_at DESC LIMIT 3",
            ).unwrap();
            let rows: Vec<(String, String)> = stmt
                .query_map([&slug], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .flatten()
                .collect();
            let mut intersection: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
            for (_wslug, wpayload) in &rows {
                let wplan: Value = serde_json::from_str(wpayload).unwrap_or(Value::Null);
                if let Some(ws) = wplan.get("slots").and_then(|s| s.as_array()) {
                    for x in ws {
                        if let Some(p) = x.get("paletteId").and_then(|p| p.as_str()) {
                            if my_palettes.iter().any(|m| m == p) {
                                *intersection.entry(p.to_string()).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
            let _ = wslug_marker(&rows);
            let mut hits: Vec<(String, u32)> = intersection.into_iter().collect();
            hits.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            let above: Vec<(String, u32)> = hits.into_iter().filter(|(_, c)| *c >= min).take(top as usize).collect();
            if as_json {
                println!("{}", serde_json::to_string_pretty(&json!({
                    "slug": slug, "window": rows.iter().map(|(s, _)| s).collect::<Vec<_>>(),
                    "paletteDrift": above,
                })).unwrap());
            } else {
                println!("drift {slug} — структурный (палитры против окна ротации):");
                if above.is_empty() {
                    println!("  чисто: пересечений с окном ≥ {min} нет");
                } else {
                    for (p, c) in &above {
                        println!("  {p}: встречается в {c} батчах окна");
                    }
                }
                println!("  (текстовый дрейф тегов — tools/drift-report.ts, TS-слой)");
            }
        }
        Cmd::Verify { prod, heal } => {
            if heal {
                die("verify --heal: append-only летопись — починка хвоста запрещена доктриной (Залп 1 «Правда»)");
            }
            let mut ok_all = true;
            if prod || db_arg.is_none() {
                match db::open_production_ro() {
                    Ok(conn) => {
                        let v = chain::verify_chain(&conn);
                        println!("продакшн (RO): {} звеньев · head {}… · {}", v.events,
                            v.head.as_deref().map(|h| &h[..10]).unwrap_or("—"),
                            if v.ok { "ЦЕЛА" } else { "БИТАЯ" });
                        for p in v.problems.iter().take(5) {
                            println!("  · {p}");
                        }
                        ok_all &= v.ok;
                    }
                    Err(e) => {
                        println!("продакшн (RO): недоступен — {e}");
                        if prod {
                            ok_all = false;
                        }
                    }
                }
            }
            if !prod {
                let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
                let v = chain::verify_chain(&conn);
                println!("рабочая: {} звеньев · head {}… · {}", v.events,
                    v.head.as_deref().map(|h| &h[..10]).unwrap_or("—"),
                    if v.ok { "ЦЕЛА" } else { "БИТАЯ" });
                for p in v.problems.iter().take(5) {
                    println!("  · {p}");
                }
                ok_all &= v.ok;
            }
            if !ok_all {
                std::process::exit(1);
            }
        }
        Cmd::State => {
            let conn = open_db(&db_arg).unwrap_or_else(|m| die(&m));
            let mine = chain::verify_chain(&conn);
            let prod_v = db::open_production_ro().ok().map(|c| chain::verify_chain(&c));
            let out = json!({
                "work": {
                    "events": mine.events,
                    "ok": mine.ok,
                    "head": mine.head,
                    "nextSlug": format!("T4-{:02}", compile::next_batch_number(&conn)),
                },
                "production": prod_v.map(|v| json!({
                    "events": v.events, "ok": v.ok, "head": v.head,
                    "nextSlug": format!("T4-{:02}", compile::next_batch_number(&conn)),
                })),
            });
            println!("{}", serde_json::to_string_pretty(&out).unwrap());
        }
        Cmd::Selftest { no_prod } => {
            let prod_conn = if no_prod { None } else { db::open_production_ro().ok() };
            let battery = selftest::run(prod_conn.as_ref());
            for c in &battery.checks {
                if c.passed {
                    println!("  PASS  {}", c.name);
                } else {
                    println!("  FAIL  {} — {}", c.name, c.detail.clone().unwrap_or_default());
                }
            }
            println!(
                "selftest: {}/{} PASS{}",
                battery.passed(),
                battery.total(),
                if battery.skipped > 0 {
                    format!(
                        " ({} skipped: {})",
                        battery.skipped,
                        battery.skip_reasons.join(" · ")
                    )
                } else {
                    String::new()
                }
            );
            if !battery.all_ok() || battery.total() < 63 {
                eprintln!("selftest: порог 63 не покрыт или есть FAIL");
                std::process::exit(1);
            }
        }
    }
}

fn wslug_marker(rows: &[(String, String)]) -> usize {
    rows.len()
}

fn req_slug_or_default(plan: &Value, fallback: &str) -> String {
    plan.get("slug")
        .and_then(|s| s.as_str())
        .unwrap_or(fallback)
        .to_string()
}
