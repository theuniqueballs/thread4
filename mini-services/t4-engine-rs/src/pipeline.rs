//! THREAD 4 ENGINE (UNIFIED) — ЕДИНЫЙ КОНВЕЙЕР (приказ «МОЩНОСТЬ», 2026-10-20).
//!
//! Пять этапов жизни батча, строго по порядку — интерфейс-проводник ведёт
//! автора за руку, движок ведёт конвейер за машину:
//!
//!   1. theme    «Раскрытие темы»  — якоря (гейт темы), EXP-батч: пропуск
//!   2. compile  «Компиляция»      — реестр канона (Rust, byte-parity) +
//!                                   бриф писца (мост: файловый компилятор)
//!   3. build    «Сборка»          — одноразовый движок: спайн (LLM-мост)
//!   4. scribe   «Писец»            — чанки прозы (LLM-мост) + сборка файла
//!                                   + батарея Rust + ремонт ≤3 кругов
//!   5. deliver  «Сдача»            — полная батарея + фиксация в хеш-цепи
//!
//! Режимы: AUTO (одна кнопка 1→5) и MANUAL (любой этап отдельно — визуально
//! все этапы лежат в той же цепочке). Прогон живёт в выделенном потоке,
//! RU-тексты этапов идут в live-шину (SSE) блоками expand/compile/build/
//! scribe/gates/deliver + полоса pipeline для переходов.
//!
//! Один писатель летописи: этот процесс. Bun-движок :3200 остановлен
//! (cutover), файловая эра не пишет события — мосты compute-only.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::bridge;
use crate::compile::{self, CompileRequest};
use crate::live::{self, BLOCK_BUILD, BLOCK_DELIVER, BLOCK_EXPAND, BLOCK_GATES, BLOCK_PIPELINE, BLOCK_SCRIBE};
use crate::theme;
use crate::textgates;

/* ---------------- канва этапов ---------------- */

pub const STAGE_KEYS: [&str; 5] = ["theme", "compile", "build", "scribe", "deliver"];
pub const STAGE_TITLES: [&str; 5] = [
    "Раскрытие темы",
    "Компиляция",
    "Сборка",
    "Писец",
    "Сдача",
];

pub const IDX_THEME: usize = 0;
pub const IDX_COMPILE: usize = 1;
pub const IDX_BUILD: usize = 2;
pub const IDX_SCRIBE: usize = 3;
pub const IDX_DELIVER: usize = 4;

pub fn stage_index(key: &str) -> Option<usize> {
    STAGE_KEYS.iter().position(|k| *k == key)
}

/* ---------------- состояние ---------------- */

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum StageStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
    Stale,
}

impl StageStatus {
    fn as_str(self) -> &'static str {
        match self {
            StageStatus::Pending => "pending",
            StageStatus::Running => "running",
            StageStatus::Done => "done",
            StageStatus::Failed => "failed",
            StageStatus::Skipped => "skipped",
            StageStatus::Stale => "stale",
        }
    }
    /// Этап «прошёл» для цепочки авто-режима (skip — честный проход EXP).
    fn is_passed(self) -> bool {
        matches!(self, StageStatus::Done | StageStatus::Skipped)
    }
}

#[derive(Clone)]
pub struct StageEntry {
    pub status: StageStatus,
    pub at: Option<String>,
    pub summary: Option<String>,
    pub detail: Option<Value>,
}

impl StageEntry {
    fn fresh() -> Self {
        StageEntry { status: StageStatus::Pending, at: None, summary: None, detail: None }
    }
}

/// Сквозные артефакты прогона: каждый этап читает выход предыдущего,
/// BUT всё решающее живёт на диске/в базе (файл контракта, t4_builds,
/// batches/<slug>.md) — ручной перезапуск любого этапа работает и после
/// рестарта движка.
#[derive(Default)]
pub struct StageCtx {
    pub anchors: Option<theme::ThemeAnchors>,
    pub theme_gate: Option<theme::ThemeReceipt>,
    pub plan: Option<Value>,
    pub contract: Option<Value>,
    pub contract_markdown: Option<String>,
    pub build: Option<Value>,
    pub batch_markdown: Option<String>,
    pub scribe_rounds: u32,
    pub scribe_polished: u32,
    pub scribe_first_run_clean: bool,
}

pub struct RunState {
    pub mode: &'static str,
    pub started_at: String,
    pub slug: String,
    pub draft: CompileRequest,
    pub stages: Vec<StageEntry>,
    pub current: Option<usize>,
    pub finished: Option<String>,
    pub ok: bool,
}

struct SharedRun {
    state: RunState,
    ctx: StageCtx,
    abort: Arc<AtomicBool>,
    /// Детали последнего провала этапа (квитанции писца и т.п.) —
    /// «Подробности» и Copy for AI на проваленной карточке обязаны
    /// видеть ПОЧЕМУ, даже когда этап вернул Err.
    fail_detail: Option<Value>,
}

pub struct PipelineHub {
    run: Mutex<Option<SharedRun>>,
    run_seq: std::sync::atomic::AtomicU64,
}

static HUB: OnceLock<PipelineHub> = OnceLock::new();

pub fn hub() -> &'static PipelineHub {
    HUB.get_or_init(|| PipelineHub {
        run: Mutex::new(None),
        run_seq: std::sync::atomic::AtomicU64::new(0),
    })
}

/* ---------------- персист прогона (t4_meta) ---------------- */

/// Прогон живёт дольше памяти: рестарт движка не должен бросать автора
/// (manual-этапы и статусы обязаны пережить перезапуск — квитанции
/// восстановятся с диска/БД, детали этапов в UI вернутся по повтору).
/// Компактный JSON в t4_meta['pipeline_run']; черновик — телом
/// compile-запроса (strict-парсер с обеих сторон = одна правда).
fn persist_locked(run: &RunState) {
    let mut draft = serde_json::Map::new();
    draft.insert("theme".into(), serde_json::json!(run.draft.theme));
    draft.insert("exp".into(), serde_json::json!(run.draft.exp));
    draft.insert("abPairs".into(), serde_json::json!(run.draft.ab_pairs));
    draft.insert("engine".into(), serde_json::json!(run.draft.engine));
    draft.insert(
        "species".into(),
        serde_json::json!({
            "on": run.draft.species_on,
            "count": run.draft.species_list.len() as u64,
            "list": run.draft.species_list,
        }),
    );
    draft.insert(
        "ocThemes".into(),
        serde_json::json!(run.draft.oc_themes.iter().map(|o| serde_json::json!({
            "theme": o.theme, "rating": o.rating, "position": o.position,
        })).collect::<Vec<_>>()),
    );
    if let Some(n) = &run.draft.notes {
        draft.insert("notes".into(), serde_json::json!(n));
    }
    if let Some(a) = &run.draft.theme_anchors {
        draft.insert("themeAnchors".into(), a.clone());
    }
    let compact = serde_json::json!({
        "mode": run.mode,
        "slug": run.slug,
        "startedAt": run.started_at,
        "finished": run.finished,
        "ok": run.ok,
        "draft": serde_json::Value::Object(draft),
        "stages": run.stages.iter().map(|e| serde_json::json!({
            "status": e.status.as_str(),
            "summary": e.summary,
        })).collect::<Vec<_>>(),
    });
    if let Ok(conn) = crate::db::open_production_rw() {
        let _ = conn.execute(
            "INSERT INTO t4_meta (key, value) VALUES ('pipeline_run', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [compact.to_string()],
        );
    }
}

/// Восстановление прогона из t4_meta (main.rs зовёт на загрузке один раз).
/// Нет записи — состояния выводятся ИЗ БД по свежему батчу (рестарт движка
/// не бросает автора: стадии живут в летописи, а не только в памяти).
pub fn load_persisted(conn: &Connection) {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM t4_meta WHERE key = 'pipeline_run'", [], |r| r.get(0))
        .ok();
    if let Some(raw) = raw {
        if let Some(run) = parse_persisted(&raw) {
            let mut guard = match hub().run.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            if guard.is_none() {
                live::info(
                    BLOCK_PIPELINE,
                    &format!(
                        "прогон восстановлен из t4_meta: батч {} · этапы {}/5 отмечены",
                        run.slug,
                        run.stages.iter().filter(|e| e.status.is_passed()).count()
                    ),
                );
                *guard = Some(run);
            }
            return;
        }
    }
    if let Some(run) = derive_from_db(conn) {
        let mut guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if guard.is_none() {
            live::info(
                BLOCK_PIPELINE,
                &format!(
                    "прогон выведен из летописи: батч {} · этапы {}/5 отмечены",
                    run.slug,
                    run.stages.iter().filter(|e| e.status.is_passed()).count()
                ),
            );
            *guard = Some(run);
        }
    }
}

fn parse_persisted(raw: &str) -> Option<SharedRun> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let draft = compile::parse_request(v.get("draft").unwrap_or(&Value::Null)).ok()?;
    let stages: Vec<StageEntry> = v
        .get("stages")
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .map(|e| StageEntry {
                    status: match e.get("status").and_then(|s| s.as_str()) {
                        Some("running") => StageStatus::Pending,
                        Some("done") => StageStatus::Done,
                        Some("failed") => StageStatus::Failed,
                        Some("skipped") => StageStatus::Skipped,
                        Some("stale") => StageStatus::Stale,
                        _ => StageStatus::Pending,
                    },
                    at: None,
                    summary: e
                        .get("summary")
                        .and_then(|s| s.as_str())
                        .map(String::from),
                    detail: None,
                })
                .collect()
        })
        .unwrap_or_else(|| (0..5).map(|_| StageEntry::fresh()).collect());
    let mode = if v.get("mode").and_then(|m| m.as_str()) == Some("manual") {
        "manual"
    } else {
        "auto"
    };
    Some(SharedRun {
        state: RunState {
            mode,
            started_at: v
                .get("startedAt")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            slug: v
                .get("slug")
                .and_then(|s| s.as_str())
                .unwrap_or_default()
                .to_string(),
            draft,
            stages,
            current: None,
            finished: v
                .get("finished")
                .and_then(|s| s.as_str())
                .map(String::from),
            ok: v.get("ok").and_then(|s| s.as_bool()).unwrap_or(false),
        },
        ctx: StageCtx::default(),
        abort: Arc::new(AtomicBool::new(false)),
        fail_detail: None,
    })
}

/// Фолбэк без t4_meta: свежий не-void батч + летопись честно говорят,
/// где конвейер стоит. Черновик — плейсхолдер (UI всё равно присылает
/// свой при каждом запуске этапа).
fn derive_from_db(conn: &Connection) -> Option<SharedRun> {
    let latest: Option<(String, String, String, i64)> = conn
        .query_row(
            "SELECT slug, status, theme, exp_slots FROM t4_batches
             WHERE status != 'void' ORDER BY created_at DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    let (slug, status, theme, exp_slots) = latest?;
    let exp = exp_slots.max(0) as u32;

    // тема: EXP → skip; иначе note «Theme Expansion» по слагу → done
    let theme_status = if exp > 0 {
        StageStatus::Skipped
    } else {
        let has_note: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM t4_events WHERE batch_slug = ?1 AND type = 'note'
                 AND summary LIKE 'Theme Expansion%' LIMIT 1",
                [&slug],
                |r| r.get(0),
            )
            .ok();
        if has_note.is_some() {
            StageStatus::Done
        } else {
            StageStatus::Pending
        }
    };
    let compile_status = StageStatus::Done;
    let build_status = {
        let has_build: Option<i64> = conn
            .query_row("SELECT 1 FROM t4_builds WHERE slug = ?1", [&slug], |r| r.get(0))
            .ok();
        if has_build.is_some() {
            StageStatus::Done
        } else {
            StageStatus::Pending
        }
    };
    let (scribe_status, scribe_summary) = {
        let drafted: Option<String> = conn
            .query_row(
                "SELECT summary FROM t4_events
                 WHERE batch_slug = ?1 AND type = 'scribe.drafted'
                 ORDER BY seq DESC LIMIT 1",
                [&slug],
                |r| r.get(0),
            )
            .ok();
        match drafted {
            Some(summary) => {
                let hard: Option<i64> = conn
                    .query_row(
                        "SELECT json_extract(data, '$.hardPass') FROM t4_events
                         WHERE batch_slug = ?1 AND type = 'scribe.drafted'
                         ORDER BY seq DESC LIMIT 1",
                        [&slug],
                        |r| r.get(0),
                    )
                    .ok();
                match hard {
                    Some(1) => (StageStatus::Done, Some(summary)),
                    Some(_) => (StageStatus::Failed, Some(summary)),
                    None => (StageStatus::Done, Some(summary)),
                }
            }
            None => (StageStatus::Pending, None),
        }
    };
    let deliver_status = if status == "delivered" {
        StageStatus::Done
    } else {
        StageStatus::Pending
    };

    let entry = |s: StageStatus, sum: Option<String>| StageEntry {
        status: s,
        at: None,
        summary: sum,
        detail: None,
    };
    let summary_of = |s: StageStatus| {
        (s == StageStatus::Done).then(|| "прочитан из летописи".to_string())
    };
    let stages = vec![
        entry(theme_status, summary_of(theme_status)),
        entry(compile_status, summary_of(compile_status)),
        entry(build_status, summary_of(build_status)),
        entry(scribe_status, scribe_summary),
        entry(deliver_status, summary_of(deliver_status)),
    ];

    let draft = compile::parse_request(&serde_json::json!({
        "theme": theme,
        "exp": exp,
        "abPairs": 2,
        "engine": "per-theme",
        "species": { "on": false, "count": 0, "list": [] },
        "ocThemes": [ { "theme": theme, "rating": "R+", "position": 1 } ],
    }))
    .ok()?;

    Some(SharedRun {
        state: RunState {
            mode: "auto",
            started_at: String::new(),
            slug: slug.clone(),
            draft,
            stages,
            current: None,
            finished: None,
            ok: false,
        },
        ctx: StageCtx::default(),
        abort: Arc::new(AtomicBool::new(false)),
        fail_detail: None,
    })
}

/// Процессный замок писателей: RPC-мутации и поток конвейера делят одну
/// цепь — транзакции не интерливятся (deferred BEGIN + app-level lock).
pub static CHAIN_LOCK: Mutex<()> = Mutex::new(());

pub fn chain_lock() -> std::sync::MutexGuard<'static, ()> {
    match CHAIN_LOCK.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

/* ---------------- исходы этапов ---------------- */

#[derive(Debug)]
pub struct StageOutcome {
    pub summary: String,
    pub detail: Value,
    pub skipped: bool,
}

fn done(summary: String, detail: Value) -> StageOutcome {
    StageOutcome { summary, detail, skipped: false }
}

fn skipped(summary: String, detail: Value) -> StageOutcome {
    StageOutcome { summary, detail, skipped: true }
}

/* ---------------- snapshot для UI ---------------- */

fn snapshot_locked(run: &SharedRun) -> Value {
    let s = &run.state;
    let stages: Vec<Value> = s
        .stages
        .iter()
        .enumerate()
        .map(|(i, e)| {
            json!({
                "key": STAGE_KEYS[i],
                "title": STAGE_TITLES[i],
                "status": e.status.as_str(),
                "at": e.at,
                "summary": e.summary,
                "detail": e.detail,
            })
        })
        .collect();
    json!({
        "running": s.current.is_some() && s.finished.is_none(),
        "mode": s.mode,
        "slug": s.slug,
        "theme": s.draft.theme,
        "exp": s.draft.exp,
        "startedAt": s.started_at,
        "current": s.current.map(|i| STAGE_KEYS[i]),
        "finished": s.finished,
        "ok": s.ok,
        "stages": stages,
    })
}

/// GET /v1/pipeline — снимок прогона (нет прогона — честный idle).
pub fn state_snapshot() -> Value {
    let guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    match guard.as_ref() {
        Some(run) => snapshot_locked(run),
        None => json!({
            "running": false,
            "mode": null,
            "slug": null,
            "theme": null,
            "exp": 0,
            "startedAt": null,
            "current": null,
            "finished": null,
            "ok": null,
            "stages": [],
        }),
    }
}

fn busy_check() -> Result<(), String> {
    let guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(run) = guard.as_ref() {
        if run.state.current.is_some() && run.state.finished.is_none() {
            return Err(format!(
                "конвейер уже идёт (этап «{}», батч {}) — дождись, останови или перезапусти после",
                run.state.current.map(|i| STAGE_TITLES[i]).unwrap_or("—"),
                run.state.slug
            ));
        }
    }
    Ok(())
}

/* ---------------- запуск ---------------- */

/// AUTO: одна кнопка — машина сама ведёт 1→2→3→4→5.
pub fn start_auto(body: Value) -> Result<Value, String> {
    busy_check()?;
    let draft = compile::parse_request(&body)?;
    let conn = crate::db::open_production_rw().map_err(|e| e.to_string())?;
    let slug = resolve_slug(&conn, &draft);
    drop(conn);

    let run_id = hub().run_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let abort = Arc::new(AtomicBool::new(false));
    let (theme, exp, ab, engine) =
        (draft.theme.clone(), draft.exp, draft.ab_pairs, draft.engine.clone());
    {
        let mut guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        *guard = Some(SharedRun {
            state: RunState {
                mode: "auto",
                started_at: crate::chain::iso_now(),
                slug: slug.clone(),
                draft,
                stages: (0..5).map(|_| StageEntry::fresh()).collect(),
                current: None,
                finished: None,
                ok: false,
            },
            ctx: StageCtx::default(),
            abort: abort.clone(),
            fail_detail: None,
        });
    }

    live::info(
        BLOCK_PIPELINE,
        &format!(
            "КОНВЕЙЕР СТАРТ (авто, прогон №{run_id}): батч {slug} · тема «{}» · EXP {} · A/B {} · движок {}",
            theme.clone(),
            exp, ab, engine.clone()
        ),
    );
    std::thread::spawn(move || runner(abort, true, 0..5));
    Ok(json!({ "started": true, "mode": "auto", "slug": slug, "run": run_id }))
}

/// MANUAL: один этап — цепочка та же, ручной override. Этапы ниже
/// помечаются устаревшими (stale) — автор видит это сразу.
pub fn start_stage(name: &str, body: Value) -> Result<Value, String> {
    busy_check()?;
    let idx = stage_index(name)
        .ok_or_else(|| format!("этап «{name}» не существует — этапы: {}", STAGE_KEYS.join(", ")))?;
    let draft = compile::parse_request(&body)?;
    let conn = crate::db::open_production_rw().map_err(|e| e.to_string())?;
    let slug = resolve_slug(&conn, &draft);
    drop(conn);

    let run_id = hub().run_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let abort = Arc::new(AtomicBool::new(false));
    {
        let mut guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut stages: Vec<StageEntry> = (0..5).map(|_| StageEntry::fresh()).collect();
        // этапы выше — принятые (иначе нечего перезапускать), ниже — stale
        for (i, e) in stages.iter_mut().enumerate() {
            if i < idx {
                e.status = StageStatus::Done;
                e.summary = Some("принят до ручного прогона".into());
            } else if i > idx {
                e.status = StageStatus::Stale;
                e.summary = Some("устарел после ручного этапа выше — будет пересобран".into());
            }
        }
        stages[idx].status = StageStatus::Pending;
        *guard = Some(SharedRun {
            state: RunState {
                mode: "manual",
                started_at: crate::chain::iso_now(),
                slug: slug.clone(),
                draft,
                stages,
                current: None,
                finished: None,
                ok: false,
            },
            ctx: StageCtx::default(),
            abort: abort.clone(),
            fail_detail: None,
        });
    }

    live::info(
        BLOCK_PIPELINE,
        &format!(
            "РУЧНОЙ ЭТАП {}/5 · {} — батч {slug}",
            idx + 1,
            STAGE_TITLES[idx]
        ),
    );
    std::thread::spawn(move || runner(abort, false, std::iter::once(idx)));
    Ok(json!({ "started": true, "mode": "manual", "stage": name, "slug": slug, "run": run_id }))
}

/// POST /v1/pipeline/abort — оператор останавливает авто-режим; этап
/// завершается честным «прервано», цепочка не портится (события пишутся
/// только атомарными транзакциями).
pub fn request_abort() -> Value {
    let guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    match guard.as_ref() {
        Some(run) => {
            run.abort.store(true, Ordering::SeqCst);
            live::warn(BLOCK_PIPELINE, "ОПЕРАТОР НАЖАЛ СТОП — конвейер прервётся на границе текущего шага");
            json!({ "accepted": true, "slug": run.state.slug })
        }
        None => json!({ "accepted": false, "reason": "конвейер не идёт" }),
    }
}

fn resolve_slug(conn: &Connection, draft: &CompileRequest) -> String {
    if let Some(s) = &draft.slug {
        if compile::valid_slug_pub(s) {
            return s.clone();
        }
    }
    format!("T4-{:02}", compile::next_batch_number(conn))
}

/* ---------------- поток прогона ---------------- */

fn runner(abort: Arc<AtomicBool>, auto: bool, stages: impl Iterator<Item = usize>) {
    let conn = match crate::db::open_production_rw() {
        Ok(c) => c,
        Err(e) => {
            live::error(BLOCK_PIPELINE, &format!("конвейер: прод-база не открылась — {e}"));
            finish_run(false, Some(format!("база не открылась: {e}")));
            return;
        }
    };

    for idx in stages {
        if abort.load(Ordering::SeqCst) {
            mark_stage(idx, StageStatus::Failed, Some("прервано оператором".into()), None);
            live::warn(BLOCK_PIPELINE, &format!("ЭТАП {}/5 · {} — ПРЕРВАНО ОПЕРАТОРОМ", idx + 1, STAGE_TITLES[idx]));
            finish_run(false, Some("прервано оператором".into()));
            return;
        }
        mark_running(idx);
        live::info(
            BLOCK_PIPELINE,
            &format!("ЭТАП {}/5 · {} — старт", idx + 1, STAGE_TITLES[idx]),
        );

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_stage(&conn, idx, abort.clone())
        }));
        let outcome = match result {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                live::error(
                    BLOCK_PIPELINE,
                    &format!("ЭТАП {}/5 · {} — ПРОВАЛ: {}", idx + 1, STAGE_TITLES[idx], e),
                );
                let detail = pop_fail_detail();
                mark_stage(idx, StageStatus::Failed, Some(e.clone()), detail);
                finish_run(false, Some(e));
                return;
            }
            Err(_) => {
                let e = "внутренний сбой этапа (паника перехвачена, цепь цела)";
                live::error(BLOCK_PIPELINE, &format!("ЭТАП {}/5 — ПАНИКА: {e}", idx + 1));
                mark_stage(idx, StageStatus::Failed, Some(e.to_string()), None);
                finish_run(false, Some(e.to_string()));
                return;
            }
        };

        let status = if outcome.skipped {
            StageStatus::Skipped
        } else {
            StageStatus::Done
        };
        mark_stage(idx, status, Some(outcome.summary.clone()), Some(outcome.detail.clone()));
        live::info(
            BLOCK_PIPELINE,
            &format!(
                "ЭТАП {}/5 · {} — {}{}",
                idx + 1,
                STAGE_TITLES[idx],
                if outcome.skipped { "ПРОПУЩЕН · " } else { "ГОТОВ · " },
                outcome.summary
            ),
        );
    }

    let ok = if auto {
        all_passed()
    } else {
        last_run_status_is_done()
    };
    let slug = current_slug();
    let verdict = if ok {
        live::info(
            BLOCK_PIPELINE,
            &format!("КОНВЕЙЕР ЗАВЕРШЁН: батч {slug} прошёл все этапы"),
        );
        format!("батч {slug} готов")
    } else {
        live::warn(BLOCK_PIPELINE, "КОНВЕЙЕР ЗАВЕРШЁН с незакрытыми этапами");
        "этапы остались незакрытыми".to_string()
    };
    finish_run(ok, Some(verdict));
}

fn all_passed() -> bool {
    let guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard
        .as_ref()
        .map(|r| r.state.stages.iter().all(|e| e.status.is_passed()))
        .unwrap_or(false)
}

fn last_run_status_is_done() -> bool {
    // ручной режим: успех = целевой этап done/skipped (последний отмеченный)
    let guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard
        .as_ref()
        .map(|r| {
            r.state
                .stages
                .iter()
                .rev()
                .find(|e| e.status != StageStatus::Pending)
                .map(|e| e.status.is_passed())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

fn current_slug() -> String {
    let guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.as_ref().map(|r| r.state.slug.clone()).unwrap_or_default()
}

fn mark_running(idx: usize) {
    let mut guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(run) = guard.as_mut() {
        run.state.stages[idx].status = StageStatus::Running;
        run.state.stages[idx].at = Some(crate::chain::iso_now());
        run.state.current = Some(idx);
        run.state.finished = None;
        run.fail_detail = None;
    }
}

/// Квитанции провала: этап вернул Err, но его детали (батарея писца и
/// т.д.) обязан видеть UI — «Подробности» + Copy for AI на карточке.
fn stash_fail_detail(detail: Value) {
    let mut guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(run) = guard.as_mut() {
        run.fail_detail = Some(detail);
    }
}

fn pop_fail_detail() -> Option<Value> {
    let mut guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.as_mut().and_then(|run| run.fail_detail.take())
}

fn mark_stage(idx: usize, status: StageStatus, summary: Option<String>, detail: Option<Value>) {
    let mut guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(run) = guard.as_mut() {
        run.state.stages[idx].status = status;
        run.state.stages[idx].summary = summary;
        run.state.stages[idx].detail = detail;
        run.state.stages[idx].at = Some(crate::chain::iso_now());
        run.state.current = None;
        persist_locked(&run.state);
    }
}

fn finish_run(ok: bool, verdict: Option<String>) {
    let mut guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(run) = guard.as_mut() {
        run.state.finished = verdict.or_else(|| Some("завершено".into()));
        run.state.ok = ok;
        run.state.current = None;
        persist_locked(&run.state);
    }
}

/* ---------------- исполнители этапов ---------------- */

/// Читает черновик из состояния, разворачивает этап. Каждый исполнитель
/// сам тянет недостающее с диска/БД — ручной прогон живёт без памяти
/// о прошлом автопрогоне.
fn run_stage(conn: &Connection, idx: usize, abort: Arc<AtomicBool>) -> Result<StageOutcome, String> {
    let (draft, slug) = {
        let guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let run = guard.as_ref().ok_or("прогон исчез")?;
        (run.state.draft.clone(), run.state.slug.clone())
    };
    match idx {
        IDX_THEME => stage_theme(conn, &draft, &slug),
        IDX_COMPILE => stage_compile(conn, &draft, &slug),
        IDX_BUILD => stage_build(conn, &slug, abort),
        IDX_SCRIBE => stage_scribe(conn, &slug, abort),
        IDX_DELIVER => stage_deliver(conn, &slug),
        _ => Err("нет такого этапа".into()),
    }
}

/// Этап 1 · «Раскрытие темы»: якоря из темы (детерминированный expand),
/// правки автора — strict, гейт темы режет до записи. EXP — честный skip.
fn stage_theme(conn: &Connection, draft: &CompileRequest, slug: &str) -> Result<StageOutcome, String> {
    if draft.exp > 0 {
        let receipt = theme::exp_off_receipt();
        live::info(BLOCK_EXPAND, "тема-модуль: EXP-батч — раскрытие темы пропущено (болванки без темы)");
        return Ok(skipped(
            "EXP-батч — этап пропущен (якоря не нужны)".into(),
            json!({ "gate": receipt.to_json(), "disabled": true }),
        ));
    }

    let (anchors, gate) = resolve_anchors(draft, slug)?;
    for f in &gate.findings {
        live::warn(BLOCK_GATES, &format!("гейт темы: {f}"));
    }
    if gate.verdict == "FAIL" {
        return Err(format!(
            "гейт темы не прошёл ({} замечаний) — правь якоря или тему",
            gate.findings.len()
        ));
    }

    // событие-след: якоря зафиксированы в летописи (как делал compile-маршрут)
    let anchors_json = anchors.to_json(theme::DEFAULT_MIN_ADHERENCE);
    {
        let _g = chain_lock();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let data = json!({
            "module": "theme-expansion",
            "version": theme::MODULE_VERSION,
            "slug": slug,
            "anchors": anchors_json,
            "gate": gate.to_json(),
        });
        let evt = crate::chain::append_event_tx(
            &tx,
            &crate::chain::AppendInput {
                typ: "note",
                summary: &format!(
                    "Theme Expansion: {slug} «{}» — якоря собраны, гейт темы {}",
                    draft.theme, gate.verdict
                ),
                data: Some(&data),
                batch_slug: Some(slug),
            },
        )
        .map_err(|m| m)?;
        tx.commit().map_err(|e| e.to_string())?;
        live::info(BLOCK_EXPAND, &format!("якоря записаны в летопись (note {})", evt.id));
    }

    let mut guard = match hub().run.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(run) = guard.as_mut() {
        run.ctx.anchors = Some(anchors.clone());
        run.ctx.theme_gate = Some(gate.clone());
    }

    Ok(done(
        format!(
            "якоря: {} · {} · {}",
            anchors.locale, anchors.time_of_day, anchors.palette_mood
        ),
        json!({ "anchors": anchors_json, "gate": gate.to_json() }),
    ))
}

fn resolve_anchors(draft: &CompileRequest, slug: &str) -> Result<(theme::ThemeAnchors, theme::ThemeReceipt), String> {
    let oc_themes: Vec<String> = draft.oc_themes.iter().map(|o| o.theme.clone()).collect();
    let (anchors, min) = match &draft.theme_anchors {
        Some(v) => {
            live::info(BLOCK_EXPAND, "тема-модуль: приняты правленые якоря автора (strict)");
            theme::ThemeAnchors::from_json(v, &draft.theme, slug)?
        }
        None => {
            live::info(BLOCK_EXPAND, &format!("тема-модуль: раскрываю «{}» по сиду", draft.theme));
            let a = theme::expand(&draft.theme, slug, 0)
                .ok_or_else(|| "тему не удалось разложить на якоря".to_string())?;
            (a, theme::DEFAULT_MIN_ADHERENCE)
        }
    };
    for line in [
        format!("локейшн: {} · время: {}", anchors.locale, anchors.time_of_day),
        format!("свет: {} · настроение: {}", anchors.light, anchors.palette_mood),
        format!("мотивы: {}", anchors.motifs.join(" / ")),
        format!("гардероб: {} · позы: {} · камера: {}", anchors.wardrobe_family, anchors.pose_family, anchors.camera),
        format!("атмосфера: {} · сид {}", anchors.atmosphere.join(" / "), anchors.seed),
    ] {
        live::info(BLOCK_EXPAND, &line);
    }
    let gate = theme::plan_gate(&anchors, &oc_themes, 0);
    live::info(BLOCK_EXPAND, &format!("гейт темы: {}", gate.verdict));
    let _ = min;
    Ok((anchors, gate))
}

/// Этап 2 · «Компиляция»: ДВЕ правды без вранья —
///   · реестр канона (compile_batch: byte-parity с движковой эрой,
///     планировочные гейты, событие batch.compiled, проекция);
///   · бриф писца (мост → файловый компилятор контрактов) — позы/стеки/
///     лиды/дресс; Rust сводит его с каноном (аудит структуры/флоров),
///     добавляет EXP-болванки (машина, нулевая дискреция) и пишет
///     contracts/<slug>.{json,md}.
fn stage_compile(conn: &Connection, draft: &CompileRequest, slug: &str) -> Result<StageOutcome, String> {
    // Якоря уже собраны этапом темы; для ручного прогона без этапа 1 —
    // восстанавливаем молча (idempotent).
    if draft.exp == 0 {
        let have = {
            let guard = match hub().run.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            guard.as_ref().map(|r| r.ctx.anchors.clone()).flatten().is_some()
        };
        if !have {
            let (anchors, gate) = resolve_anchors(draft, slug)?;
            if gate.verdict == "FAIL" {
                return Err("гейт темы не прошёл — сначала правь якоря (этап 1)".into());
            }
            let mut guard = match hub().run.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            if let Some(run) = guard.as_mut() {
                run.ctx.anchors = Some(anchors);
                run.ctx.theme_gate = Some(gate);
            }
        }
    }

    // реестр канона: compiled-репетиция пересобираемая (force), delivered
    // неприкосновенен — compile_batch сам держит эти гварды.
    let existing = compile::get_batch_status(conn, slug);
    let force = matches!(existing.as_deref(), Some("compiled"));
    let mut req = draft.clone();
    req.slug = Some(slug.to_string());
    req.force = force;
    live::info(
        live::BLOCK_COMPILE,
        &format!(
            "compile: {slug} · тема «{}» · EXP {} · A/B {}{}",
            draft.theme, draft.exp, draft.ab_pairs,
            if force { " · ПЕРЕсборка поверх compiled" } else { "" }
        ),
    );

    let outcome = {
        let _g = chain_lock();
        compile::compile_batch(conn, &req, None).map_err(|e| e.0)?
    };
    for r in compile::audit_plan(&outcome.plan_json).unwrap_or_default() {
        live::info(
            BLOCK_GATES,
            &format!("канон · {}: {}{}", r.gate, r.verdict, if r.findings.is_empty() { String::new() } else { format!(" — {} замечаний", r.findings.len()) }),
        );
    }
    if !outcome.hard_pass {
        return Err("планировочные гейты канона не прошли — правь бриф".into());
    }
    live::info(
        live::BLOCK_COMPILE,
        &format!("реестр канона собран (sha {})", outcome.sha10),
    );

    // бриф писца: мост (файловый компилятор, compute-only)
    let oc_json: Vec<Value> = draft
        .oc_themes
        .iter()
        .map(|o| json!({ "position": o.position, "theme": o.theme, "rating": o.rating }))
        .collect();
    live::info(live::BLOCK_COMPILE, "собираю бриф писца (позы, стеки, лиды, дресс)…");
    let (mut contract, contract_md) = bridge::compile_contract(
        slug,
        &draft.theme,
        &draft.engine,
        &json!(oc_json),
        draft.notes.as_deref(),
    )
    .map_err(|e| format!("бриф писца не собрался — {e}"))?;

    // EXP-болванки: машина достраивает их из реестра (нулевой discretion)
    let exp_added = merge_exp_stubs(&mut contract, &outcome.plan_json);
    let merged_slots = contract
        .get("slots")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    // аудит брифа против канона: структура (24 ядра + EXP) и вечные флоры
    let audit = audit_brief(&merged_slots, &draft.theme, draft.notes.as_deref().unwrap_or(""), draft.exp);
    let mut hard_fails: Vec<String> = Vec::new();
    for r in &audit {
        if r.level == "hard" && r.verdict == "FAIL" {
            for f in &r.findings {
                hard_fails.push(f.clone());
                live::warn(BLOCK_GATES, &format!("канон · бриф: {f}"));
            }
        }
    }
    if !hard_fails.is_empty() {
        stash_fail_detail(json!({
            "audit": audit.iter().map(|r| json!({
                "gate": r.gate, "level": r.level, "verdict": r.verdict, "findings": r.findings,
            })).collect::<Vec<_>>(),
            "note": "бриф писца (файловый компилятор) разошёлся с реестром канона — это шов двух компиляторов",
        }));
        return Err(format!(
            "бриф писца разошёлся с каноном ({} нарушений) — это шов двух компиляторов, дай знать",
            hard_fails.len()
        ));
    }

    // артефакты брифа: contracts/<slug>.json + contracts/<slug>.md
    let contract_pretty = serde_json::to_string_pretty(&contract).map_err(|e| e.to_string())?;
    let json_path = textgates::contracts_dir().join(format!("{slug}.json"));
    std::fs::write(&json_path, &contract_pretty).map_err(|e| format!("contracts/{slug}.json: {e}"))?;
    if !contract_md.is_empty() {
        let md_path = textgates::contracts_dir().join(format!("{slug}.md"));
        std::fs::write(&md_path, &contract_md).map_err(|e| format!("contracts/{slug}.md: {e}"))?;
    }
    let brief_sha = crate::canonical::payload_sha10(&contract);

    // событие-след брифа (note: одна летопись, один писатель)
    {
        let _g = chain_lock();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        crate::chain::append_event_tx(
            &tx,
            &crate::chain::AppendInput {
                typ: "note",
                summary: &format!(
                    "{slug}: бриф писца собран (слоты {}, EXP {exp_added}, sha {brief_sha})",
                    merged_slots.len()
                ),
                data: Some(&json!({
                    "slug": slug,
                    "kind": "scribe-contract",
                    "sha10": brief_sha,
                    "slots": merged_slots.len(),
                    "exp": exp_added,
                })),
                batch_slug: Some(slug),
            },
        )
        .map_err(|m| m)?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    let core = merged_slots.len() - exp_added as usize;
    Ok(done(
        format!(
            "план: {} слотов{} · палитры без повторов · бриф писца на диске",
            core,
            if exp_added > 0 { format!(" + EXP {exp_added}") } else { String::new() }
        ),
        json!({
            "registry": {
                "sha10": outcome.sha10,
                "slots": merged_slots.len(),
                "diffUp": Value::Null,
                "diffDown": Value::Null,
            },
            "briefSha10": brief_sha,
            "slots": merged_slots,
        }),
    ))
}

/// EXP-болванки из реестра канона дословно перекочёвывают в бриф писца:
/// машина — нулевая дискреция (вердикт T4-34), писец только обшивает их
/// своими тегами, THESIS/якорь собирает машина (assemble писца).
fn merge_exp_stubs(contract: &mut Value, plan: &Value) -> u32 {
    let exp_slots: Vec<Value> = plan
        .get("slots")
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .filter(|s| s.get("kind").and_then(|k| k.as_str()) == Some("EXP"))
                .map(|s| {
                    let pos = s.get("position").and_then(|p| p.as_u64()).unwrap_or(0);
                    let exp = s.get("exp").cloned().unwrap_or(Value::Null);
                    json!({
                        "position": pos,
                        "kind": "EXP",
                        "rating": "R+",
                        "register": "young",
                        "pose": "PL00",
                        "poseName": "neutral stand",
                        "poseRisk": "low",
                        "palette": s.get("paletteId").cloned().unwrap_or(Value::Null),
                        "paletteName": "",
                        "kinetics": ["K00"],
                        "carriers": [],
                        "lead": "auto",
                        "closer": "image-close",
                        "fabricTone": "mid",
                        "race": Value::Null,
                        "oc": Value::Null,
                        "exp": exp,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let n = exp_slots.len() as u32;
    if let Some(slots) = contract.get_mut("slots").and_then(|s| s.as_array_mut()) {
        for s in exp_slots {
            slots.push(s);
        }
    }
    n
}

/// Аудит брифа против канона: структура (та же лестница 3+14+7+EXP) и
/// вечные флоры. Окно/AB у двух эр свои — их честно проверяет каждый
/// компилятор сам (реестр — engine-эрой, бриф — файловой).
fn audit_brief(slots: &[Value], theme: &str, notes: &str, exp: u32) -> Vec<compile::Receipt> {
    let mut plans: Vec<compile::SlotPlan> = Vec::new();
    for s in slots {
        let kind_raw = s.get("kind").and_then(|k| k.as_str()).unwrap_or("MAIN");
        let kind = match kind_raw {
            "VOLT" | "EXQUISITE" => "MAIN",
            other => other,
        };
        plans.push(compile::SlotPlan {
            position: s.get("position").and_then(|p| p.as_u64()).unwrap_or(0) as u32,
            kind: kind.to_string(),
            rating: s.get("rating").and_then(|r| r.as_str()).unwrap_or("R+").to_string(),
            register: s.get("register").and_then(|r| r.as_str()).unwrap_or("young").to_string(),
            oc_theme: s.get("ocTheme").and_then(|v| v.as_str()).map(String::from),
            race: s.get("race").and_then(|v| v.as_str()).map(String::from),
            palette_id: s
                .get("palette")
                .and_then(|p| p.as_str())
                .or_else(|| s.get("paletteId").and_then(|p| p.as_str()))
                .unwrap_or("P000")
                .to_string(),
            exp_letter: s.get("exp").and_then(|e| e.get("letter")).and_then(|v| v.as_str()).map(String::from),
            exp_half: s.get("exp").and_then(|e| e.get("half")).and_then(|v| v.as_str()).map(String::from),
            exp_pair_with: s.get("exp").and_then(|e| e.get("pairWith")).and_then(|v| v.as_u64()).map(|n| n as u32),
            exp_hypothesis: s.get("exp").and_then(|e| e.get("hypothesis")).and_then(|v| v.as_str()).map(String::from),
            ab_pair: s.get("ab").and_then(|a| a.get("pair")).and_then(|v| v.as_str()).and_then(|v| v.parse::<u32>().ok()),
            ab_half: s.get("ab").and_then(|a| a.get("half")).and_then(|v| v.as_str()).map(String::from),
        });
    }
    vec![
        compile::gate_structure(&plans, exp),
        compile::gate_floors(theme, notes, &plans),
    ]
}

/// Этап 3 · «Сборка»: одноразовый движок батча — спайн (LLM-мост):
/// имя/закон/тезис/три акта/тема-слова. Движок умирает вместе с батчем.
fn stage_build(conn: &Connection, slug: &str, _abort: Arc<AtomicBool>) -> Result<StageOutcome, String> {
    if textgates::load_contract(slug).is_none() {
        return Err(format!("нет брифа писца для {slug} — сначала этап «Компиляция»"));
    }
    if compile::get_batch_status(conn, slug).as_deref() == Some("delivered") {
        return Err(format!("{slug} уже сдан — одноразовый движок утилизирован (3.2-традиция)"));
    }

    live::info(BLOCK_BUILD, "кузница: изобретаю одноразовый движок под тему (LLM-спайн)…");
    let build = bridge::invent_spine(slug).map_err(|e| format!("спайн не собрался — {e}"))?;
    let name = build.get("engineName").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let law = build.get("engineLaw").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let thesis = build.get("thesis").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let acts = build.get("acts").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let keywords = build.get("themeKeywords").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if name.trim().is_empty() || law.trim().is_empty() {
        return Err("спайн вернул пустой движок — повтори этап «Сборка»".into());
    }

    // архив одноразовых движков (файл-эра традиция, артефакт, не SSoT)
    let archive = textgates::thread4_dir().join("engines-archive.jsonl");
    if let Some(dir) = archive.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&archive)
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(
                f,
                "{}",
                json!({
                    "slug": slug,
                    "engine": name,
                    "law": law,
                    "at": crate::chain::iso_now(),
                })
            )
        });

    let at = crate::chain::iso_now();
    let (event_id, seq) = {
        let _g = chain_lock();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let data = json!({
            "slug": slug,
            "engine": name,
            "law": law,
            "thesis": thesis,
            "acts": acts,
            "themeKeywords": keywords,
        });
        let evt = crate::chain::append_event_tx(
            &tx,
            &crate::chain::AppendInput {
                typ: "engine.built",
                summary: &format!("{slug}: одноразовый движок «{name}» выкован — {law}"),
                data: Some(&data),
                batch_slug: Some(slug),
            },
        )
        .map_err(|m| m)?;
        tx.execute(
            "INSERT INTO t4_builds (slug, engine_name, engine_law, thesis, acts, theme_keywords, created_at, event_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(slug) DO UPDATE SET
               engine_name = excluded.engine_name, engine_law = excluded.engine_law,
               thesis = excluded.thesis, acts = excluded.acts,
               theme_keywords = excluded.theme_keywords, created_at = excluded.created_at,
               event_id = excluded.event_id",
            rusqlite::params![
                slug,
                name,
                law,
                thesis,
                serde_json::to_string(&acts).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".into()),
                at,
                evt.id,
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        (evt.id, evt.seq)
    };

    live::info(
        BLOCK_BUILD,
        &format!("движок «{name}» выкован: {} · акты: {}", law, acts.len()),
    );

    {
        let mut guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(run) = guard.as_mut() {
            run.ctx.build = Some(build.clone());
        }
    }

    Ok(done(
        format!("движок «{name}» · {} акт(а) назначены", acts.len()),
        json!({
            "engine": name,
            "law": law,
            "thesis": thesis,
            "acts": acts,
            "themeKeywords": keywords,
            "eventId": event_id,
            "seq": seq,
        }),
    ))
}

fn load_build(conn: &Connection, slug: &str) -> Result<Value, String> {
    let row: Option<(String, String, String, String, String, String)> = conn
        .query_row(
            "SELECT engine_name, engine_law, thesis, acts, theme_keywords, created_at
             FROM t4_builds WHERE slug = ?1",
            [slug],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .ok();
    let (engine_name, engine_law, thesis, acts, keywords, _at) =
        row.ok_or_else(|| format!("движок для {slug} не выкован — сначала этап «Сборка»"))?;
    Ok(json!({
        "engineName": engine_name,
        "engineLaw": engine_law,
        "thesis": thesis,
        "acts": serde_json::from_str::<Value>(&acts).unwrap_or(Value::Array(vec![])),
        "themeKeywords": serde_json::from_str::<Value>(&keywords).unwrap_or(Value::Array(vec![])),
    }))
}

/// Этап 4 · «Писец»: чанки прозы (мост/LLM) → сборка файла (мост) →
/// батарея Rust (память) → ремонт ≤3 кругов → полировка (1 круг, откат
/// при потере hard) → файл батча + черновик + событие scribe.drafted.
fn stage_scribe(conn: &Connection, slug: &str, abort: Arc<AtomicBool>) -> Result<StageOutcome, String> {
    let status = compile::get_batch_status(conn, slug).ok_or("батч не скомпилирован")?;
    if status == "delivered" {
        return Err(format!("{slug} уже сдан — писец не переписывает сданное"));
    }
    if textgates::load_contract(slug).is_none() {
        return Err(format!("нет брифа писца для {slug} — сначала этап «Компиляция»"));
    }
    let build = {
        let cached = {
            let guard = match hub().run.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            guard.as_ref().and_then(|r| r.ctx.build.clone())
        };
        match cached {
            Some(b) => b,
            None => load_build(conn, slug)?,
        }
    };
    let anchors = {
        let guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.as_ref().and_then(|r| r.ctx.anchors.clone())
    };

    let contract = textgates::load_contract(slug).ok_or("бриф писца не читается")?;
    let positions: Vec<u32> = contract
        .slots
        .iter()
        .map(|s| s.position)
        .collect();
    let chunk_size = 6usize;

    let mut outputs: Vec<Value> = Vec::new();
    let mut rounds: u32 = 0;
    let mut polished: u32 = 0;
    let max_repair = 3u32;

    // круг 0: чистый проход чанками
    for chunk in positions.chunks(chunk_size) {
        if abort.load(Ordering::SeqCst) {
            return Err("прервано оператором (писец остановлен между чанками)".into());
        }
        live::info(
            BLOCK_SCRIBE,
            &format!("пишу слоты {}…", chunk.iter().map(|p| format!("P{p:02}")).collect::<Vec<_>>().join(", ")),
        );
        let got = bridge::write_chunk(slug, &build, chunk, "write", &[])
            .map_err(|e| format!("писец не дошёл до слотов {chunk:?} — {e}"))?;
        for o in got {
            merge_output(&mut outputs, o);
        }
    }

    let mut markdown = bridge::assemble_batch(slug, &build, &json!(outputs))
        .map_err(|e| format!("сборка черновика рассыпалась — {e}"))?;
    let mut battery = battery_on_text(slug, &markdown, anchors.as_ref());

    // ремонт hard-фейлов: ≤3 круга, позиции из находок
    let mut round: u32 = 0;
    loop {
        let hard_fails: Vec<&compile::Receipt> = battery
            .receipts
            .iter()
            .filter(|r| r.level == "hard" && r.verdict == "FAIL")
            .collect();
        let missing: Vec<u32> = positions
            .iter()
            .copied()
            .filter(|p| {
                !outputs
                    .iter()
                    .any(|o| o.get("position").and_then(|v| v.as_u64()) == Some(*p as u64)
                        && o.get("pos").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false))
            })
            .collect();
        if hard_fails.is_empty() && missing.is_empty() {
            break;
        }
        if round >= max_repair {
            live::warn(
                BLOCK_SCRIBE,
                "hard-фейл остался после трёх кругов ремонта — черновик записан, сдача закрыта",
            );
            break;
        }
        round += 1;
        rounds = round;
        live::info(BLOCK_SCRIBE, &format!("круг ремонта {round}: чиню {}", hard_fails.len() + missing.len()));
        for r in &hard_fails {
            for f in r.findings.iter().take(4) {
                live::warn(BLOCK_GATES, &format!("{}: {f}", r.gate));
            }
        }
        let mut failed: Vec<u32> = missing.clone();
        for r in &hard_fails {
            for f in &r.findings {
                if let Some(p) = leading_position(f) {
                    if positions.contains(&p) && !failed.contains(&p) {
                        failed.push(p);
                    }
                }
            }
        }
        if failed.is_empty() {
            break;
        }
        let findings: Vec<String> = hard_fails
            .iter()
            .flat_map(|r| r.findings.iter().cloned())
            .take(24)
            .collect();
        let fixed = bridge::write_chunk(slug, &build, &failed, "repair", &findings)
            .map_err(|e| format!("ремонт не дошёл — {e}"))?;
        for o in fixed {
            merge_output(&mut outputs, o);
        }
        markdown = bridge::assemble_batch(slug, &build, &json!(outputs))
            .map_err(|e| format!("сборка после ремонта рассыпалась — {e}"))?;
        battery = battery_on_text(slug, &markdown, anchors.as_ref());
    }

    // полировка качества: один круг WARN-гейтов, откат при потере hard
    const POLISH_GATES: [&str; 5] = [
        "noun-lock", "claim-visibility", "prop-geometry", "simcheck", "contract-fidelity",
    ];
    if battery.hard_pass {
        let warn_positions: Vec<u32> = {
            let mut v = Vec::new();
            for r in &battery.receipts {
                if r.level == "warn" && r.verdict == "WARN" && POLISH_GATES.contains(&r.gate) {
                    for f in &r.findings {
                        if let Some(p) = leading_position(f) {
                            if positions.contains(&p) && !v.contains(&p) {
                                v.push(p);
                            }
                        }
                    }
                }
            }
            v
        };
        if !warn_positions.is_empty() {
            live::info(
                BLOCK_SCRIBE,
                &format!("полировка качества: {} слот(а)", warn_positions.len()),
            );
            let backup_md = markdown.clone();
            let backup_outputs = outputs.clone();
            let findings: Vec<String> = battery
                .receipts
                .iter()
                .filter(|r| r.level == "warn" && r.verdict == "WARN" && POLISH_GATES.contains(&r.gate))
                .flat_map(|r| r.findings.iter().cloned())
                .take(24)
                .collect();
            let polished_out = bridge::write_chunk(slug, &build, &warn_positions, "polish", &findings);
            match polished_out {
                Ok(fixed) => {
                    for o in fixed {
                        merge_output(&mut outputs, o);
                    }
                    let md2 = bridge::assemble_batch(slug, &build, &json!(outputs))
                        .map_err(|e| format!("сборка после полировки рассыпалась — {e}"))?;
                    let after = battery_on_text(slug, &md2, anchors.as_ref());
                    if after.hard_pass {
                        polished = warn_positions.len() as u32;
                        markdown = md2;
                        battery = after;
                        live::info(BLOCK_SCRIBE, "полировка: hard удержан, WARN-слоты переписаны");
                    } else {
                        markdown = backup_md;
                        outputs = backup_outputs;
                        live::warn(BLOCK_SCRIBE, "полировка сломала hard — ОТКАТ к черновику до полировки");
                    }
                }
                Err(e) => {
                    live::warn(BLOCK_SCRIBE, &format!("полировка не дошла (продолжаю без неё): {e}"));
                }
            }
        }
    }

    // финал: файлы + событие
    let sha10 = battery.sha10.clone();
    let batches_path = textgates::batches_dir().join(format!("{slug}.md"));
    std::fs::write(&batches_path, &markdown).map_err(|e| format!("batches/{slug}.md: {e}"))?;
    let draft_path = textgates::thread4_dir().join("drafts").join(format!("{slug}-draft.md"));
    if let Some(dir) = draft_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&draft_path, &markdown);

    let written = outputs.len();
    let hard_pass = battery.hard_pass;
    let title = contract
        .theme
        .clone()
        .unwrap_or_else(|| slug.to_string());
    let event_id = {
        let _g = chain_lock();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let evt = crate::chain::append_event_tx(
            &tx,
            &crate::chain::AppendInput {
                typ: "scribe.drafted",
                summary: &format!(
                    "{slug} «{title}»: писец написал черновик — {written}/{} слотов, ремонт {rounds} круг(а), полировка {polished}, гейты dry {} (sha {sha10})",
                    positions.len(),
                    if hard_pass { "PASS" } else { "FAIL" },
                ),
                data: Some(&json!({
                    "slug": slug,
                    "title": title,
                    "slots": written,
                    "rounds": rounds,
                    "polished": polished,
                    "hardPass": hard_pass,
                    "sha10": sha10,
                    "engine": build.get("engineName"),
                })),
                batch_slug: Some(slug),
            },
        )
        .map_err(|m| m)?;
        tx.execute(
            "INSERT INTO t4_drafts (slug, body, sha, created_at, event_id) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(slug) DO UPDATE SET body = excluded.body, sha = excluded.sha,
               created_at = excluded.created_at, event_id = excluded.event_id",
            rusqlite::params![slug, markdown, sha10, crate::chain::iso_now(), evt.id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        evt.id
    };
    live::info(
        BLOCK_SCRIBE,
        &format!("черновик записан → batches/{slug}.md (событие {event_id})"),
    );

    let first_run_clean = hard_pass && rounds == 0 && polished == 0;
    {
        let mut guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(run) = guard.as_mut() {
            run.ctx.batch_markdown = Some(markdown.clone());
            run.ctx.scribe_rounds = rounds;
            run.ctx.scribe_polished = polished;
            run.ctx.scribe_first_run_clean = first_run_clean;
        }
    }

    if !hard_pass {
        let fail = json!({
            "rounds": rounds,
            "polished": polished,
            "hardPass": false,
            "sha10": sha10,
            "receipts": textgates::receipts_json(&battery.receipts),
            "failedSlots": positions.iter().copied().filter(|p| !outputs.iter().any(|o| o.get("position").and_then(|v| v.as_u64()) == Some(*p as u64))).collect::<Vec<u32>>(),
            "note": "ремонт исчерпан: правь бриф/якоря или перезапусти писца — черновик записан, сдача закрыта",
        });
        stash_fail_detail(fail);
        return Err(format!(
            "писец закончил с hard-фейлом (ремонт исчерпан) — черновик записан, квитанции в «Подробностях»"
        ));
    }
    Ok(done(
        format!(
            "черновик: {} промпт(а) · hard PASS · ремонт {rounds} · полировка {polished}",
            written
        ),
        json!({
            "rounds": rounds,
            "polished": polished,
            "hardPass": hard_pass,
            "firstRunClean": first_run_clean,
            "sha10": sha10,
            "receipts": textgates::receipts_json(&battery.receipts),
            "failedSlots": positions.iter().copied().filter(|p| !outputs.iter().any(|o| o.get("position").and_then(|v| v.as_u64()) == Some(*p as u64))).collect::<Vec<u32>>(),
        }),
    ))
}

fn merge_output(outputs: &mut Vec<Value>, o: Value) {
    let pos = o.get("position").and_then(|v| v.as_u64());
    if let Some(pos) = pos {
        if let Some(existing) = outputs
            .iter_mut()
            .find(|x| x.get("position").and_then(|v| v.as_u64()) == Some(pos))
        {
            let keep_old = existing
                .get("pos")
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            let new_good = o
                .get("pos")
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if !keep_old || new_good {
                *existing = o;
            }
        } else {
            outputs.push(o);
        }
    }
}

fn leading_position(finding: &str) -> Option<u32> {
    let mut rest = finding;
    if let Some(i) = rest.find("P") {
        rest = &rest[i + 1..];
    } else {
        return None;
    }
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let n: u32 = digits.parse().ok()?;
    if (1..=99).contains(&n) {
        Some(n)
    } else {
        None
    }
}

/// Полная батарея Rust по тексту в памяти: текст-гейты + гейт темы
/// (adherence якорям, если якоря есть). Никаких записей — решает этап.
pub struct InMemBattery {
    pub sha10: String,
    pub receipts: Vec<compile::Receipt>,
    pub hard_pass: bool,
}

fn battery_on_text(slug: &str, markdown: &str, anchors: Option<&theme::ThemeAnchors>) -> InMemBattery {
    let batch = textgates::parse_batch(slug, markdown);
    let bans = textgates::load_bans();
    let mut receipts = textgates::run_text_gates(&batch, bans.as_ref());
    if let Some(a) = anchors {
        let r = theme::text_gate(markdown, a, theme::DEFAULT_MIN_ADHERENCE);
        receipts.push(compile::Receipt {
            gate: r.gate,
            level: r.level,
            verdict: r.verdict,
            findings: r.findings,
            notes: r.notes,
        });
    }
    let mut hasher = sha2::Sha256::new();
    use sha2::Digest;
    hasher.update(markdown.as_bytes());
    let full: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    let sha10 = full[..10].to_string();
    let hard_pass = receipts.iter().filter(|r| r.level == "hard").all(|r| r.verdict == "PASS");
    InMemBattery { sha10, receipts, hard_pass }
}

/// Этап 5 · «Сдача»: полная батарея по ФАЙЛУ (он-то и есть батч) →
/// gate.run в летопись → ростер ОС → WORKLOG в файле батча → мета-JSON →
/// batch.delivered. Hard канона + hard батареи — оба обязательны.
fn stage_deliver(conn: &Connection, slug: &str) -> Result<StageOutcome, String> {
    let status = compile::get_batch_status(conn, slug).ok_or("батч не скомпилирован")?;
    if status == "delivered" {
        return Err(format!("{slug} уже сдан — сданное неприкосновенно"));
    }
    let batch_file = textgates::batches_dir().join(format!("{slug}.md"));
    let text = std::fs::read_to_string(&batch_file)
        .map_err(|_| format!("нет batches/{slug}.md — писец ещё не писал этот батч"))?;

    let anchors = {
        let guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.as_ref().and_then(|r| r.ctx.anchors.clone())
    };
    live::info(BLOCK_DELIVER, "сдача: финальная батарея по черновику…");
    let battery = battery_on_text(slug, &text, anchors.as_ref());
    for r in &battery.receipts {
        let line = format!("{} ({}): {}{}", r.gate, r.level, r.verdict, if r.findings.is_empty() { String::new() } else { format!(" — {} замечаний", r.findings.len()) });
        if r.verdict == "PASS" || r.verdict == "REPORT" {
            live::info(BLOCK_GATES, &line);
        } else {
            live::warn(BLOCK_GATES, &line);
        }
    }
    if !battery.hard_pass {
        stash_fail_detail(json!({
            "sha10": battery.sha10,
            "receipts": textgates::receipts_json(&battery.receipts),
            "note": "финальная батарея срезала черновик — перезапусти писца или правь batches/<slug>.md руками",
        }));
        return Err("батарея не прошла: hard-фейлы — правь черновик (перезапусти писца)".into());
    }
    let (hard_pass_plan,) = conn
        .query_row("SELECT hard_pass FROM t4_batches WHERE slug = ?1", [slug], |r| {
            Ok(r.get::<_, i64>(0)?)
        })
        .map(|n| (n == 1,))
        .map_err(|e| e.to_string())?;
    if !hard_pass_plan {
        return Err("канон-реестр батча без hard PASS — пересобери компиляцию".into());
    }

    let outcome = textgates::TextGatesOutcome {
        slug: slug.to_string(),
        sha10: battery.sha10.clone(),
        receipts: battery.receipts.clone(),
        hard_pass: battery.hard_pass,
        contract_theme: None,
        rebuild_of: None,
    };
    let (gate_event_id, gate_seq, run_index) = {
        let _g = chain_lock();
        textgates::record_gate_run(conn, &outcome).map_err(|e| e)?
    };
    live::info(
        BLOCK_GATES,
        &format!("прогон #{run_index} записан в летопись (gate.run {gate_event_id}, seq {gate_seq})"),
    );

    let first_run_clean = {
        let guard = match hub().run.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard
            .as_ref()
            .map(|r| r.ctx.scribe_first_run_clean && run_index == 1)
            .unwrap_or(run_index == 1)
    };

    // ростер ОС финален при сдаче (файл-эра семантика)
    let contract = textgates::load_contract(slug);
    let oc_from_contract: Vec<String> = contract
        .as_ref()
        .map(|c| {
            c.slots
                .iter()
                .filter(|s| s.kind == "OC")
                .filter_map(|s| s.oc.clone())
                .collect()
        })
        .unwrap_or_default();
    let parsed = textgates::parse_batch(slug, &text);
    let oc_from_batch: Vec<String> = parsed
        .slots
        .iter()
        .filter(|s| s.genre.eq_ignore_ascii_case("OC"))
        .filter_map(|s| {
            s.meta
                .split('·')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .nth(1)
        })
        .filter(|x| x != "—")
        .collect();
    let mut roster: Vec<String> = Vec::new();
    for name in oc_from_contract.into_iter().chain(oc_from_batch) {
        if !name.is_empty() && !roster.contains(&name) {
            roster.push(name);
        }
    }
    {
        let _g = chain_lock();
        let existing: Vec<String> = {
            let mut out = Vec::new();
            if let Ok(mut stmt) =
                conn.prepare("SELECT data FROM t4_events WHERE type = 'oc.appeared' AND batch_slug = ?1")
            {
                if let Ok(rows) = stmt.query_map([slug], |r| r.get::<_, String>(0)) {
                    for d in rows.flatten() {
                        if let Ok(v) = serde_json::from_str::<Value>(&d) {
                            if let Some(n) = v.get("name").and_then(|x| x.as_str()) {
                                out.push(n.to_string());
                            }
                        }
                    }
                }
            }
            out
        };
        for name in &roster {
            if existing.contains(name) {
                continue;
            }
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            crate::chain::append_event_tx(
                &tx,
                &crate::chain::AppendInput {
                    typ: "oc.appeared",
                    summary: &format!("OC {name} назначен в {slug}"),
                    data: Some(&json!({ "slug": slug, "name": name })),
                    batch_slug: Some(slug),
                },
            )
            .map_err(|m| m)?;
            tx.commit().map_err(|e| e.to_string())?;
        }
    }

    // WORKLOG батча (конституция §12) — один раз, в конец файла
    let mut text_final = text.clone();
    if !text_final.contains("## WORKLOG") {
        let warns: Vec<&compile::Receipt> = battery
            .receipts
            .iter()
            .filter(|r| r.level == "warn" && r.verdict == "WARN")
            .collect();
        let engine = load_build(conn, slug)
            .ok()
            .and_then(|b| b.get("engineName").and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_else(|| "—".to_string());
        let mut wl = String::from("\n\n## WORKLOG\n\n");
        wl.push_str(&format!(
            "- Сдача: прогон #{run_index}, hard PASS{} (sha10 {}). Движок: {engine}.\n",
            if first_run_clean { " · FIRST RUN CLEAN" } else { "" },
            battery.sha10
        ));
        wl.push_str(&format!(
            "- Структура: {} слот(а) — см. бриф писца (contracts/{slug}.json).\n",
            parsed.slots.len()
        ));
        if warns.is_empty() {
            wl.push_str("- Предупреждения: ноль — все проверки чистые.\n");
        } else {
            for w in warns {
                wl.push_str(&format!("- Квитанция [{}]: {}\n", w.gate, w.findings.iter().take(4).cloned().collect::<Vec<_>>().join(" · ")));
            }
        }
        text_final = format!("{}{}", text_final.trim_end(), wl);
        std::fs::write(&batch_file, &text_final).map_err(|e| format!("WORKLOG в batches/{slug}.md: {e}"))?;
    }

    // мета-JSON у батча (файл-эра паритет — читальный зал и радары)
    let meta = json!({
        "slug": slug,
        "title": parsed.title,
        "date": crate::chain::iso_now(),
        "hardPass": true,
        "firstRunClean": first_run_clean,
        "sha10": battery.sha10,
        "run": run_index,
        "receipts": textgates::receipts_json(&battery.receipts),
    });
    let meta_path = textgates::batches_dir().join(format!("{slug}.json"));
    let _ = std::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );

    let delivered = {
        let _g = chain_lock();
        crate::cli_deliver(conn, slug)?
    };
    if let Some(s) = delivered.get("summary").and_then(|v| v.as_str()) {
        live::info(BLOCK_DELIVER, s);
    }
    live::info(
        BLOCK_DELIVER,
        &format!("сдача закрыта: {slug} в летописи, цепь пополнена"),
    );

    Ok(done(
        format!(
            "сдан: батарея PASS · прогон #{run_index}{} · цепь пополнена",
            if first_run_clean { " · FIRST RUN CLEAN" } else { "" }
        ),
        json!({
            "deliver": delivered,
            "runIndex": run_index,
            "firstRunClean": first_run_clean,
            "sha10": battery.sha10,
            "receipts": textgates::receipts_json(&battery.receipts),
            "ocRoster": roster,
        }),
    ))
}

/* ---------------- тесты (без сети: мосты падают честно) ---------------- */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate_schema;

    fn temp_db(tag: &str) -> Connection {
        let path = std::env::temp_dir().join(format!("t4-pipeline-{tag}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).expect("temp db");
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        migrate_schema(&conn).expect("schema");
        conn
    }

    fn exp_draft() -> CompileRequest {
        let body = json!({
            "theme": "тема теста",
            "exp": 3,
            "abPairs": 2,
            "engine": "per-theme",
            "ocThemes": [ { "theme": "якорь ОС", "rating": "R+", "position": 1 } ],
        });
        compile::parse_request(&body).unwrap()
    }

    #[test]
    fn stage_index_maps_keys() {
        assert_eq!(stage_index("scribe"), Some(IDX_SCRIBE));
        assert_eq!(stage_index("нет"), None);
    }

    #[test]
    fn exp_theme_stage_is_honest_skip() {
        let conn = temp_db("exp-skip");
        let out = stage_theme(&conn, &exp_draft(), "T4-99").unwrap();
        assert!(out.skipped, "EXP-батч обязан честно пропускать этап темы");
        assert!(out.detail.get("disabled").and_then(|v| v.as_bool()) == Some(true));
    }

    #[test]
    fn leading_position_extracts_subject() {
        assert_eq!(leading_position("P07: заявка без прицела"), Some(7));
        assert_eq!(leading_position("P12/P20 — R+ только на тёмном"), Some(12));
        assert_eq!(leading_position("нет номера"), None);
    }

    #[test]
    fn merge_output_replaces_only_good_pos() {
        let mut outputs = vec![json!({ "position": 1, "pos": "" })];
        merge_output(
            &mut outputs,
            json!({ "position": 1, "pos": "anime style, masterpiece, best quality, anime artstyle." }),
        );
        assert_eq!(outputs.len(), 1);
        assert!(outputs[0].get("pos").unwrap().as_str().unwrap().contains("anime style"));
        // пустой ответ не затирает живой слот
        merge_output(&mut outputs, json!({ "position": 1, "pos": "" }));
        assert!(outputs[0].get("pos").unwrap().as_str().unwrap().contains("anime style"));
    }

    #[test]
    fn deliver_without_scribe_fails_honestly() {
        let conn = temp_db("deliver-guard");
        let e = stage_deliver(&conn, "T4-98").unwrap_err();
        assert!(e.contains("не скомпилирован"), "guard текст: {e}");
    }

    #[test]
    fn busy_check_free_when_idle() {
        assert!(busy_check().is_ok());
    }

    #[test]
    fn snapshot_idle_is_honest() {
        let v = state_snapshot();
        assert_eq!(v["running"], false);
        assert_eq!(v["stages"].as_array().map(|a| a.len()), Some(0));
    }
}
