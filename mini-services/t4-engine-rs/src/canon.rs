//! THREAD 4 ENGINE (RUST TWIN) — CODE-AS-CONFIG.
//!
//! Ported verbatim from mini-services/t4-engine/src/config/canon.ts:
//! every constant cites the same origins. The arithmetic invariants
//! (`slot_law_checks`) run at boot — a broken canon kills the twin
//! before it serves a single request, same doctrine as the TS engine.

pub const ERA: &str = "THREAD 4";
pub const CANON_VERSION: &str = "1.9.0";
pub const FAM: &str = "2.3.0";

pub const RATINGS: [&str; 4] = ["PG-13", "R", "R+", "X"];
pub const REGISTERS: [&str; 3] = ["student", "young", "milf"];
pub const ENGINE_MODES: [&str; 2] = ["per-theme", "per-theme raw-plus"];

pub const EVENT_TYPES: [&str; 23] = [
    "era.born",
    "spec.imported",
    "law.ratified",
    "law.amended",
    /* Фаза 2, итерация 3 (2026-10-21): канон выровнен с TS (canon parity,
     * MERGE-доктрина) — bridge.compiled появился в TS в итерации 2 WRITE-моста,
     * Rust-канон отставал; consciousness.switched — квитанция осознанного
     * переключения источника сознания (file JSONL → живой движок). */
    "consciousness.switched",
    "batch.compiled",
    "bridge.compiled",
    "batch.delivered",
    "batch.void",
    "gate.run",
    "fixpass.paid",
    "scribe.drafted",
    "render.verdict",
    "taste.datum",
    "experiment.logged",
    "oc.appeared",
    "external.review",
    "debt.paid",
    "author.pinned",
    "channel.retired",
    "scribe.objection",
    "oracle.spoke",
    "note",
];

pub const VERDICT_SOURCES: [&str; 5] = [
    "vlm",
    "author",
    "author-batch",
    "author-verbatim",
    "author-oc",
];

pub const CONFIDENCE_LEVELS: [&str; 2] = ["direct", "described"];

/// Slot law (policy.json law.*): 24 core = 3 OC + 21 mains (7 NICHE + 14 R+).
pub struct Slots;
impl Slots {
    pub const TOTAL: u32 = 24;
    pub const OC_SLOTS: u32 = 3;
    pub const MAINS_TOTAL: u32 = 21;
    pub const NICHE_COUNT: u32 = 7;
    pub const RPLUS_MAINS: u32 = 14;
    pub const X_SLOTS: u32 = 0;
    pub const EXP_MAX: u32 = 9;
    pub const EXP_DEFAULT: u32 = 8;
}

/// A/B pairs: exactly one variable, 2..3 pairs.
pub const AB_MIN: u32 = 2;
pub const AB_MAX: u32 = 3;

/// Palette law: fund P01..P105, extension P106..P120 (EXP reserve).
pub struct Palette;
impl Palette {
    pub const FUND: u32 = 105;
    pub const FIRST_ID: u32 = 1;
    pub const LAST_ID: u32 = 105;
    pub const EXTENSION_FIRST_ID: u32 = 106;
    pub const EXTENSION_LAST_ID: u32 = 120;
    pub const WINDOW_BATCHES: u32 = 3;
}

/// Eternal floors (rating-recipes.json eternal_floors) — token bans.
pub const FLOORS: [(&str, &[&str]); 4] = [
    (
        "anti_loli",
        &[
            "child", "children", "childish", "chibi", "young girl",
            "immature body", "oversized head", "loli", "shota",
        ],
    ),
    ("leak_guard", &["signature", "watermark", "artist name", "logo"]),
    (
        "candle_guard",
        &[
            "candle", "candles", "candelabra", "lamp", "lantern",
            "torch", "chandelier", "brazier",
        ],
    ),
    (
        "face_guard",
        &[
            "realistic facial structure", "photorealistic facial proportions",
            "natural human nose bridge", "realistic lip shape",
        ],
    ),
];

/// EXP program (batch verdict T4-34): machine stubs, zero scribe discretion.
pub const EXP_LETTERS: [&str; 9] = ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι"];
pub const EXP_HYPOTHESIS_TEMPLATES: [&str; 9] = [
    "проверка закона №27: тон несущей вещи против зоны заявки",
    "проверка закона №28: окно палитр против свежести EXP-бюджета",
    "проверка закона №29: дресс-код против категории сцены",
    "проверка A/B: ровно одна переменная решает кадр (T4-27.2)",
    "проверка флооров: вечные баны держат строку POS",
    "проверка ротации: палитры не повторяются в батче",
    "проверка каденса: слоты не эхо соседей",
    "проверка границ: NICHE-свидетель держит невозможное",
    "проверка чистоты: болванка без тема-слов (вердикт T4-34)",
];

/// Chain of custody (Залп 1 «Правда»): hash = sha256(prev + '|' + rawLine).
pub const CHAIN_GENESIS: &str = "GENESIS";

/// Twin binding — fixed port 3201, loopback only. The TS engine keeps 3200.
pub const SERVE_PORT: u16 = 3201;
pub const SERVE_HOSTNAME: &str = "127.0.0.1";
pub const MAX_BODY_BYTES: usize = 1_048_576;

/// Boot-time arithmetic — the twin refuses to start on a broken canon.
pub fn slot_law_checks() -> Vec<String> {
    let mut problems = Vec::new();
    if Slots::OC_SLOTS + Slots::MAINS_TOTAL != Slots::TOTAL {
        problems.push("canon: ocSlots + mainsTotal != slots.total".into());
    }
    if Slots::NICHE_COUNT + Slots::RPLUS_MAINS != Slots::MAINS_TOTAL {
        problems.push("canon: nicheCount + rplusMains != mainsTotal".into());
    }
    if Palette::LAST_ID - Palette::FIRST_ID + 1 != Palette::FUND {
        problems.push("canon: palette id span != fund".into());
    }
    if Palette::EXTENSION_FIRST_ID != Palette::LAST_ID + 1 {
        problems.push("canon: palette extension must start right after the fund".into());
    }
    if EXP_LETTERS.len() < Slots::EXP_MAX as usize {
        problems.push("canon: exp letters must cover expMax slots".into());
    }
    if Slots::EXP_DEFAULT > Slots::EXP_MAX {
        problems.push("canon: expDefault > expMax".into());
    }
    if AB_MIN > AB_MAX {
        problems.push("canon: ab.min > ab.max".into());
    }
    problems
}
