//! THREAD 4 ENGINE (RUST TWIN) — THE COMPILER (constitution §3).
//!
//! Verbatim port of mini-services/t4-engine/src/core/compile.ts:
//! deterministic (seed = sha256(theme + '|' + slug) → mulberry32), plan
//! of 24 core slots (3 OC by author themes + 14 R+ mains + 7 NICHE
//! ladder) + EXP overlay + A/B pairs with exactly one variable, planning
//! gates (structure / exp-purity / floors / window / ab), diff vs the
//! previous delivered batch. Parity bar: the same request on a fresh
//! scratch db (same window context as the original compile) must
//! reproduce the bun engine's sha10 fingerprint byte-exactly.

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::canonical::{payload_sha10, stable_stringify};
use crate::canon::{
    EXP_HYPOTHESIS_TEMPLATES, EXP_LETTERS, Palette, Slots, AB_MAX, AB_MIN, CHAIN_GENESIS,
    ENGINE_MODES, FLOORS, REGISTERS, RATINGS, FAM, CANON_VERSION, ERA,
};
use crate::chain::{append_event_tx, AppendInput};

/* ---------------- seeded RNG (ported verbatim) ---------------- */

fn hash_seed(s: &str) -> u32 {
    let digest = Sha256::digest(s.as_bytes());
    u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]])
}

fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6D2B79F5);
        let mut t = a;
        t ^= t >> 15;
        t = t.wrapping_mul(t | 1);
        t = t.wrapping_add(t.wrapping_mul(t ^ (t >> 7)).wrapping_mul(61 ^ t));
        // ((t ^ (t >>> 14)) >>> 0) / 2^32
        ((t ^ (t >> 14)) as u32) as f64 / 4_294_967_296.0
    }
}

struct Rng {
    next: Box<dyn FnMut() -> f64>,
}

impl Rng {
    /// Fisher-Yates, same iteration order as the TS engine.
    fn shuffle<T: Clone>(&mut self, arr: &[T]) -> Vec<T> {
        let mut out = arr.to_vec();
        let mut i = out.len();
        while i > 1 {
            i -= 1;
            let j = ((self.next)() * (i + 1) as f64).floor() as usize;
            out.swap(i, j.min(i));
        }
        out
    }
}

/* ---------------- domain error ---------------- */

#[derive(Debug)]
pub struct CompileError(pub String);

/* ---------------- request (strict-subset validation) ---------------- */

#[derive(Clone, Debug)]
pub struct OcTheme {
    pub theme: String,
    pub rating: String,
    pub position: u32,
}

#[derive(Clone, Debug)]
pub struct CompileRequest {
    pub slug: Option<String>,
    pub theme: String,
    pub engine: String,
    pub exp: u32,
    pub ab_pairs: u32,
    pub species_on: bool,
    pub species_list: Vec<String>,
    pub oc_themes: Vec<OcTheme>,
    pub notes: Option<String>,
    /// Parity-replay pin: freeze `createdAt` to reproduce a historical
    /// fingerprint byte-exactly (the sha10 commits to createdAt). None → now().
    pub parity_created_at: Option<String>,
    /// TWIN-ONLY (Фаза 2): Theme Expansion поверх компиляции. В план НЕ
    /// входит — канонический sha10 не тронут (byte-parity с bun-движком).
    pub expand_theme: bool,
    /// Правленые автором якоря (после шага «Theme Expansion» в UI);
    /// strict-валидируются theme::ThemeAnchors::from_json.
    pub theme_anchors: Option<serde_json::Value>,
    /// TWIN-ONLY (пересборка): compiled-сборку в scratch-летописи можно
    /// заменить новым планом — репетиция переписываема до сдачи. delivered
    /// неприкосновенен при любом force, void и так свободен. В канонический
    /// план НЕ входит — sha10 byte-parity не тронут.
    pub force: bool,
}

pub fn parse_request(body: &serde_json::Value) -> Result<CompileRequest, String> {
    let obj = body
        .as_object()
        .ok_or("compile: тело должно быть JSON-объектом (strict — лишние поля запрещены)")?;
    for k in obj.keys() {
        if ![
            "slug", "theme", "engine", "exp", "abPairs", "species", "ocThemes", "notes",
            "parityCreatedAt", "expandTheme", "themeAnchors", "force",
        ]
        .contains(&k.as_str()) {
            return Err(format!(
                "compile: тело запроса не прошло Zod (strict — лишние поля запрещены): unrecognized key \"{k}\""
            ));
        }
    }
    let theme = obj
        .get("theme")
        .and_then(|v| v.as_str())
        .ok_or("compile: theme обязателен (1..200 симв)")?
        .trim()
        .to_string();
    if theme.is_empty() || theme.len() > 200 {
        return Err("compile: theme обязателен (1..200 симв)".into());
    }
    let slug = match obj.get("slug") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => {
            let s = v.as_str().ok_or("compile: slug обязан быть строкой T4-NN")?;
            if !valid_slug(s) {
                return Err(format!("compile: slug «{s}» не лезет в канон T4-NN"));
            }
            Some(s.to_string())
        }
    };
    let engine = obj
        .get("engine")
        .and_then(|v| v.as_str())
        .unwrap_or("per-theme")
        .to_string();
    if !ENGINE_MODES.contains(&engine.as_str()) {
        return Err(format!(
            "compile: engine вне enum [{}]",
            ENGINE_MODES.join(", ")
        ));
    }
    let exp = match obj.get("exp") {
        None | Some(serde_json::Value::Null) => Slots::EXP_DEFAULT,
        Some(v) => {
            let n = v.as_u64().ok_or("compile: exp — целое 0..9")? as u32;
            if n > Slots::EXP_MAX {
                return Err(format!("compile: exp ≤ {} (expMax)", Slots::EXP_MAX));
            }
            n
        }
    };
    let ab_pairs = match obj.get("abPairs") {
        None | Some(serde_json::Value::Null) => AB_MIN,
        Some(v) => {
            let n = v.as_u64().ok_or("compile: abPairs — целое 2..3")? as u32;
            if n < AB_MIN || n > AB_MAX {
                return Err(format!("compile: abPairs, канон {AB_MIN}..{AB_MAX}"));
            }
            n
        }
    };
    let species = obj.get("species").cloned().unwrap_or_else(|| {
        serde_json::json!({ "on": false, "count": 0, "list": [] })
    });
    let species_obj = species
        .as_object()
        .ok_or("compile: species {on, count, list} (strict)")?;
    for k in species_obj.keys() {
        if !["on", "count", "list"].contains(&k.as_str()) {
            return Err(format!("compile: species strict — лишнее поле «{k}»"));
        }
    }
    let species_on = species_obj
        .get("on")
        .and_then(|v| v.as_bool())
        .ok_or("compile: species.on обязан быть bool")?;
    let species_list = species_obj
        .get("list")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let oc_themes_raw = obj
        .get("ocThemes")
        .and_then(|v| v.as_array())
        .ok_or("compile: ocThemes — 1..3 объекта {theme, rating, position}")?;
    if oc_themes_raw.is_empty() || oc_themes_raw.len() > Slots::OC_SLOTS as usize {
        return Err("compile: ocThemes — 1..3 объекта {theme, rating, position}".into());
    }
    let mut oc_themes = Vec::new();
    for t in oc_themes_raw {
        let to = t
            .as_object()
            .ok_or("compile: ocThemes[?] — объект {theme, rating, position} (strict)")?;
        for k in to.keys() {
            if !["theme", "rating", "wishes", "position"].contains(&k.as_str()) {
                return Err(format!("compile: ocThemes strict — лишнее поле «{k}»"));
            }
        }
        let theme = to
            .get("theme")
            .and_then(|v| v.as_str())
            .ok_or("compile: ocThemes[].theme обязателен (1..120)")?
            .trim()
            .to_string();
        if theme.is_empty() || theme.len() > 120 {
            return Err("compile: ocThemes[].theme обязателен (1..120)".into());
        }
        let rating = to
            .get("rating")
            .and_then(|v| v.as_str())
            .ok_or("compile: ocThemes[].rating обязателен (PG-13|R|R+|X)")?
            .to_string();
        if !RATINGS.contains(&rating.as_str()) {
            return Err("compile: ocThemes[].rating обязан быть PG-13|R|R+|X".into());
        }
        let position = to
            .get("position")
            .and_then(|v| v.as_u64())
            .ok_or("compile: ocThemes[].position 1..3")? as u32;
        if position < 1 || position > Slots::OC_SLOTS {
            return Err("compile: ocThemes[].position 1..3".into());
        }
        oc_themes.push(OcTheme { theme, rating, position });
    }
    let notes = obj
        .get("notes")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let parity_created_at = obj
        .get("parityCreatedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let expand_theme = obj
        .get("expandTheme")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let theme_anchors = match obj.get("themeAnchors") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) if v.is_object() => Some(v.clone()),
        Some(_) => {
            return Err("compile: themeAnchors обязан быть JSON-объектом якорей".into());
        }
    };
    let force = match obj.get("force") {
        None | Some(serde_json::Value::Null) => false,
        Some(v) => v
            .as_bool()
            .ok_or("compile: force обязан быть bool (true = пересборка поверх compiled)")?,
    };
    Ok(CompileRequest {
        slug,
        theme,
        engine,
        exp,
        ab_pairs,
        species_on,
        species_list,
        oc_themes,
        notes,
        parity_created_at,
        expand_theme,
        theme_anchors,
        force,
    })
}

fn valid_slug(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 4 || bytes.len() > 8 {
        return false;
    }
    if &s[0..3] != "T4-" {
        return false;
    }
    let digits = &s[3..];
    if digits.len() < 2 || digits.len() > 3 {
        return false;
    }
    digits.bytes().all(|b| b.is_ascii_digit())
}

/// Публичный доступ к канону слага (deliver/void маршруты, CLI).
pub fn valid_slug_pub(s: &str) -> bool {
    valid_slug(s)
}

/* ---------------- planning gates (receipts verbatim) ---------------- */

#[derive(Clone)]
pub struct Receipt {
    pub gate: &'static str,
    pub level: &'static str,
    pub verdict: &'static str,
    pub findings: Vec<String>,
    pub notes: Vec<String>,
}

fn receipt_json(r: &Receipt) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    m.insert("gate".into(), r.gate.into());
    m.insert("level".into(), r.level.into());
    m.insert("verdict".into(), r.verdict.into());
    m.insert("findings".into(), serde_json::Value::Array(
        r.findings.iter().map(|f| f.as_str().into()).collect(),
    ));
    if !r.notes.is_empty() {
        m.insert("notes".into(), serde_json::Value::Array(
            r.notes.iter().map(|n| n.as_str().into()).collect(),
        ));
    }
    serde_json::Value::Object(m)
}

fn hard(gate: &'static str, findings: Vec<String>, notes: Vec<String>) -> Receipt {
    Receipt {
        gate,
        level: "hard",
        verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
        findings,
        notes,
    }
}

fn warn_receipt(gate: &'static str, findings: Vec<String>, notes: Vec<String>) -> Receipt {
    Receipt {
        gate,
        level: "warn",
        verdict: if findings.is_empty() { "PASS" } else { "WARN" },
        findings,
        notes,
    }
}

/* ---------------- slot plan ---------------- */

#[derive(Clone)]
pub struct SlotPlan {
    pub position: u32,
    pub kind: String,
    pub rating: String,
    pub register: String,
    pub oc_theme: Option<String>,
    pub race: Option<String>,
    pub palette_id: String,
    pub exp_letter: Option<String>,
    pub exp_half: Option<String>,
    pub exp_pair_with: Option<u32>,
    pub exp_hypothesis: Option<String>,
    pub ab_pair: Option<u32>,
    pub ab_half: Option<String>,
}

fn slot_json(s: &SlotPlan) -> serde_json::Value {
    // Key set mirrors the TS engine's SlotPlan serialization exactly
    // (position, kind, rating, register, ocTheme?, race?, paletteId, exp?,
    // ab?); key ORDER is irrelevant — the payload hashes slots as a count.
    let mut m = serde_json::Map::new();
    m.insert("position".into(), s.position.into());
    m.insert("kind".into(), s.kind.as_str().into());
    m.insert("rating".into(), s.rating.as_str().into());
    m.insert("register".into(), s.register.as_str().into());
    if let Some(t) = &s.oc_theme {
        m.insert("ocTheme".into(), t.as_str().into());
    }
    if let Some(r) = &s.race {
        m.insert("race".into(), r.as_str().into());
    }
    m.insert("paletteId".into(), s.palette_id.as_str().into());
    if s.kind == "EXP" {
        let mut e = serde_json::Map::new();
        e.insert("letter".into(), s.exp_letter.clone().unwrap_or_default().into());
        e.insert("half".into(), s.ab_half.clone().unwrap_or_else(|| s.exp_half.clone().unwrap_or_default()).into());
        if let Some(pw) = s.exp_pair_with {
            e.insert("pairWith".into(), pw.into());
        }
        e.insert(
            "hypothesis".into(),
            s.exp_hypothesis.clone().unwrap_or_default().into(),
        );
        m.insert("exp".into(), serde_json::Value::Object(e));
    }
    if let Some(p) = s.ab_pair {
        let mut a = serde_json::Map::new();
        a.insert("pair".into(), p.into());
        a.insert("half".into(), s.ab_half.clone().unwrap_or_default().into());
        m.insert("ab".into(), serde_json::Value::Object(a));
    }
    serde_json::Value::Object(m)
}

fn pid(n: u32) -> String {
    format!("P{:03}", n)
}

fn assign_palettes(
    rng: &mut Rng,
    count: u32,
    first: u32,
    last: u32,
    exclude: &std::collections::HashSet<String>,
) -> Result<Vec<String>, CompileError> {
    let mut pool: Vec<u32> = Vec::new();
    for n in first..=last {
        if !exclude.contains(&pid(n)) {
            pool.push(n);
        }
    }
    if (pool.len() as u32) < count {
        return Err(CompileError(format!(
            "window: доступно палитр {}, нужно {} — фонд исчерпан окном (расширь палитру или сократи батч)",
            pool.len(),
            count
        )));
    }
    let shuffled = rng.shuffle(&pool);
    Ok(shuffled[..count as usize].iter().map(|n| pid(*n)).collect())
}

/* ---------------- the compile (transactional) ---------------- */

pub struct CompileOutcome {
    pub plan_json: serde_json::Value,
    pub slug: String,
    pub sha10: String,
    pub seed_hex: String,
    pub hard_pass: bool,
    pub event_id: String,
    pub event_at: String,
    pub event_seq: u32,
    pub idempotent_replay: bool,
    /// true — пересборка поверх compiled (событие несёт supersedes).
    pub reassembly: bool,
}

pub fn compile_batch(
    conn: &Connection,
    req: &CompileRequest,
    idempotency_key: Option<&str>,
) -> Result<CompileOutcome, CompileError> {
    /* slug resolution & duplicate guard
     *
     * Пересборка (2026-10-20, приказ «сборщика нет»): compiled-сборка
     * в scratch — репетиция, force:true заменяет её новым планом; старый
     * план честно уходит в supersedes-блок события летописи. delivered
     * неприкосновенен всегда — только void освобождает номер. */
    let slug = match &req.slug {
        Some(s) => s.clone(),
        None => format!("T4-{:02}", next_batch_number(conn)),
    };
    let existing = get_batch_status(conn, &slug);
    let reassembly = matches!(existing.as_deref(), Some("compiled")) && req.force;
    if let Some(st) = &existing {
        if st != "void" && !reassembly {
            return Err(CompileError(format!(
                "batch.compiled: слаг {slug} уже занят (status {st}) — сданное/закрытое неприкосновенно; compiled-сборку можно ПЕРЕсобрать (force:true), void-слаг рекомпилируем, следующий номер свободен (вердикт автора 2026-10-20)"
            )));
        }
    }
    let supersedes: Option<serde_json::Value> = if reassembly {
        conn.query_row(
            "SELECT sha10, slots_total, created_at FROM t4_batches WHERE slug = ?1",
            [&slug],
            |r| {
                Ok(serde_json::json!({
                    "sha10": r.get::<_, String>(0)?,
                    "slots": r.get::<_, i64>(1)?,
                    "createdAt": r.get::<_, String>(2)?,
                    "priorStatus": "compiled",
                }))
            },
        )
        .ok()
    } else {
        None
    };

    /* deterministic plan */
    let seed_int = hash_seed(&format!("{}|{}", req.theme, slug));
    let mut rng = Rng {
        next: Box::new(mulberry32(seed_int)),
    };
    let created_at = req
        .parity_created_at
        .clone()
        .unwrap_or_else(crate::chain::iso_now);

    let window_union = palette_window_union(conn, Palette::WINDOW_BATCHES);
    let core_fresh = Slots::TOTAL;
    let exp_fresh = req.exp;
    let extension_free = Palette::EXTENSION_LAST_ID - Palette::EXTENSION_FIRST_ID + 1;

    let core_palettes = assign_palettes(&mut rng, core_fresh, Palette::FIRST_ID, Palette::LAST_ID, &window_union)
        .map_err(|e| e)?;
    let exp_palettes = assign_palettes(
        &mut rng,
        exp_fresh,
        Palette::EXTENSION_FIRST_ID,
        Palette::EXTENSION_LAST_ID,
        &std::collections::HashSet::new(),
    )
    .map_err(|e| e)?;

    /* slot assembly — EXACT order of the TS engine */
    let mut slots: Vec<SlotPlan> = Vec::new();
    let race_list: Option<Vec<String>> = if req.species_on && !req.species_list.is_empty() {
        Some(req.species_list.clone())
    } else {
        None
    };
    let mut race_cursor: usize = 0;

    // 3 OC slots (positions 1..3)
    for i in 0..Slots::OC_SLOTS {
        let oc = &req.oc_themes[(i as usize).min(req.oc_themes.len() - 1)];
        slots.push(SlotPlan {
            position: i + 1,
            kind: "OC".into(),
            rating: oc.rating.clone(),
            register: REGISTERS[(i as usize) % REGISTERS.len()].to_string(),
            oc_theme: Some(oc.theme.clone()),
            race: race_list.as_ref().map(|l| {
                let r = l[race_cursor % l.len()].clone();
                race_cursor += 1;
                r
            }),
            palette_id: core_palettes[i as usize].clone(),
            exp_letter: None,
            exp_half: None,
            exp_pair_with: None,
            exp_hypothesis: None,
            ab_pair: None,
            ab_half: None,
        });
    }

    // 14 R+ mains
    let mut palette_cursor = Slots::OC_SLOTS;
    for _ in 0..Slots::RPLUS_MAINS {
        let pos = slots.len() as u32 + 1;
        slots.push(SlotPlan {
            position: pos,
            kind: "MAIN".into(),
            rating: "R+".into(),
            register: REGISTERS[(pos as usize) % REGISTERS.len()].to_string(),
            oc_theme: None,
            race: race_list.as_ref().map(|l| {
                let r = l[race_cursor % l.len()].clone();
                race_cursor += 1;
                r
            }),
            palette_id: core_palettes[palette_cursor as usize].clone(),
            exp_letter: None,
            exp_half: None,
            exp_pair_with: None,
            exp_hypothesis: None,
            ab_pair: None,
            ab_half: None,
        });
        palette_cursor += 1;
    }

    // 7 NICHE: deterministic ladder R, PG-13, R, R+, R, PG-13, R+
    let ladder = ["R", "PG-13", "R", "R+", "R", "PG-13", "R+"];
    for (i, rating) in ladder.iter().enumerate() {
        let pos = slots.len() as u32 + 1;
        slots.push(SlotPlan {
            position: pos,
            kind: "NICHE".into(),
            rating: rating.to_string(),
            register: REGISTERS[(pos as usize) % REGISTERS.len()].to_string(),
            oc_theme: None,
            race: race_list.as_ref().map(|l| {
                let r = l[race_cursor % l.len()].clone();
                race_cursor += 1;
                r
            }),
            palette_id: core_palettes[palette_cursor as usize].clone(),
            exp_letter: None,
            exp_half: None,
            exp_pair_with: None,
            exp_hypothesis: None,
            ab_pair: None,
            ab_half: None,
        });
        palette_cursor += 1;
        let _ = i;
    }

    // EXP overlay: α-A, α-B, β-A, β-B … pairWith links B-half to previous
    for i in 0..exp_fresh as usize {
        let letter = EXP_LETTERS[i % EXP_LETTERS.len()];
        let hypothesis = EXP_HYPOTHESIS_TEMPLATES[i % EXP_HYPOTHESIS_TEMPLATES.len()];
        let half = if i % 2 == 0 { "A" } else { "B" };
        slots.push(SlotPlan {
            position: Slots::TOTAL + i as u32 + 1,
            kind: "EXP".into(),
            rating: "R+".into(),
            register: "young".into(),
            oc_theme: None,
            race: None,
            palette_id: exp_palettes[i].clone(),
            exp_letter: Some(letter.to_string()),
            exp_half: Some(half.to_string()),
            exp_pair_with: if half == "B" && i > 0 {
                Some(Slots::TOTAL + i as u32)
            } else {
                None
            },
            exp_hypothesis: Some(format!("EXP {letter}-{half} · {hypothesis}")),
            ab_pair: None,
            ab_half: None,
        });
    }

    // A/B pairs: one variable = palette; the machine syncs register+rating.
    let main_idx: Vec<usize> = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.kind == "MAIN")
        .map(|(i, _)| i)
        .collect();
    for p in 1..=req.ab_pairs as usize {
        let ai = main_idx[(p * 2 - 2) % main_idx.len()];
        let bi = main_idx[(p * 2 - 1) % main_idx.len()];
        slots[bi].register = slots[ai].register.clone();
        slots[bi].rating = slots[ai].rating.clone();
        slots[ai].ab_pair = Some(p as u32);
        slots[ai].ab_half = Some("A".into());
        slots[bi].ab_pair = Some(p as u32);
        slots[bi].ab_half = Some("B".into());
    }

    /* planning gates */
    let receipts = vec![
        gate_structure(&slots, exp_fresh),
        gate_exp_purity(&slots, &req.theme, exp_fresh),
        gate_floors(&req.theme, req.notes.as_deref().unwrap_or(""), &slots),
        gate_window(window_union.len() as u32, core_fresh, extension_free, exp_fresh),
        gate_ab(&slots, req.ab_pairs),
    ];
    let hard_pass = receipts
        .iter()
        .filter(|r| r.level == "hard")
        .all(|r| r.verdict == "PASS");

    /* diff vs previous delivered (scratch chronicle: none → first batch) */
    let diff = diff_against_previous(conn, &slots);

    let seed_hex_full = {
        let mut h = Sha256::new();
        h.update(format!("{}|{}", req.theme, slug).as_bytes());
        hex16(&h.finalize())
    };
    let seed_hex_clone = seed_hex_full.clone();

    let mut plan = serde_json::Map::new();
    plan.insert("slug".into(), slug.clone().into());
    plan.insert("title".into(), req.theme.clone().into());
    plan.insert("theme".into(), req.theme.clone().into());
    plan.insert("engine".into(), req.engine.clone().into());
    plan.insert("seed".into(), seed_hex_full.clone().into());
    plan.insert(
        "slots".into(),
        serde_json::Value::Array(slots.iter().map(slot_json).collect()),
    );
    plan.insert("exp".into(), exp_fresh.into());
    plan.insert("abPairs".into(), req.ab_pairs.into());
    let mut pw = serde_json::Map::new();
    pw.insert("union".into(), (window_union.len() as u32).into());
    pw.insert("budget".into(), (Palette::FUND - window_union.len() as u32).into());
    pw.insert("extensionFree".into(), extension_free.into());
    plan.insert("paletteWindow".into(), serde_json::Value::Object(pw));
    plan.insert(
        "receipts".into(),
        serde_json::Value::Array(receipts.iter().map(receipt_json).collect()),
    );
    plan.insert(
        "diff".into(),
        serde_json::json!({ "up": diff.0, "down": diff.1, "against": serde_json::Value::Null }),
    );
    plan.insert("sha10".into(), "0000000000".into());
    plan.insert("createdAt".into(), created_at.clone().into());
    let plan_value = serde_json::Value::Object(plan);

    /* canonical payload → sha10 (slots hashed as a COUNT, sha10 excluded) */
    let mut payload = plan_value.clone();
    let obj = payload.as_object_mut().unwrap();
    obj.remove("sha10");
    obj.insert("slots".into(), (slots.len() as u64).into());
    let sha10 = payload_sha10(&payload);

    let mut final_plan = plan_value.clone();
    final_plan
        .as_object_mut()
        .unwrap()
        .insert("sha10".into(), sha10.clone().into());

    /* atomic commit: event + projection + draft + idempotency in ONE tx */
    let summary = format!(
        "{} {slug} «{}»: {} слотов (EXP {exp_fresh}, A/B {}), движок {}{}{}",
        if reassembly { "ПЕРЕсобран" } else { "Скомпилирован" },
        req.theme,
        slots.len(),
        req.ab_pairs,
        req.engine,
        if reassembly { " (пересборка поверх compiled — прежний план в supersedes)" } else { "" },
        if hard_pass { "" } else { " — HARD FAIL планировочных гейтов" }
    );
    let mut data = serde_json::Map::new();
    data.insert("slug".into(), slug.clone().into());
    data.insert("theme".into(), req.theme.clone().into());
    data.insert("engine".into(), req.engine.clone().into());
    data.insert("slots".into(), (slots.len() as u64).into());
    data.insert("exp".into(), exp_fresh.into());
    data.insert("abPairs".into(), req.ab_pairs.into());
    data.insert("hardPass".into(), hard_pass.into());
    data.insert("sha10".into(), sha10.clone().into());
    data.insert("diffUp".into(), diff.0.into());
    data.insert("diffDown".into(), diff.1.into());
    data.insert("windowUnion".into(), (window_union.len() as u64).into());
    data.insert(
        "paletteBudget".into(),
        (Palette::FUND - window_union.len() as u32).into(),
    );
    if let Some(s) = &supersedes {
        data.insert("supersedes".into(), s.clone());
        data.insert("reassembly".into(), true.into());
    }
    data.insert(
        "receipts".into(),
        serde_json::Value::Array(
            receipts
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "gate": r.gate,
                        "level": r.level,
                        "verdict": r.verdict,
                    })
                })
                .collect(),
        ),
    );
    let data_value = serde_json::Value::Object(data);

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| CompileError(e.to_string()))?;
    let evt = append_event_tx(
        &tx,
        &AppendInput {
            typ: "batch.compiled",
            summary: &summary,
            data: Some(&data_value),
            batch_slug: Some(&slug),
        },
    )
    .map_err(CompileError)?;
    upsert_batch_from_compile(
        &tx,
        &slug,
        &req.theme,
        &req.engine,
        &slots,
        exp_fresh,
        req.ab_pairs,
        hard_pass,
        diff,
        &stable_stringify(&final_plan),
        &sha10,
        &created_at,
        &evt.id,
    )
    .map_err(|e| CompileError(e.to_string()))?;
    tx.commit().map_err(|e| CompileError(e.to_string()))?;

    if let Some(key) = idempotency_key {
        let response = serde_json::json!({
            "ok": true,
            "data": {
                "plan": final_plan,
                "event": { "id": evt.id, "at": evt.at, "seq": evt.seq }
            }
        });
        let _ = conn.execute(
            "INSERT OR REPLACE INTO t4_idempotency (key, endpoint, response, created_at) VALUES (?1, 'compile', ?2, ?3)",
            rusqlite::params![key, response.to_string(), created_at],
        );
    }

    Ok(CompileOutcome {
        plan_json: final_plan,
        slug,
        sha10,
        seed_hex: seed_hex_clone,
        hard_pass,
        event_id: evt.id,
        event_at: evt.at,
        event_seq: evt.seq,
        idempotent_replay: false,
        reassembly,
    })
}

/* ---------------- gates (messages verbatim from compile.ts) ---------------- */

pub(crate) fn gate_structure(slots: &[SlotPlan], exp: u32) -> Receipt {
    let mut f = Vec::new();
    let oc = slots.iter().filter(|s| s.kind == "OC").count();
    let mains = slots.iter().filter(|s| s.kind == "MAIN").count();
    let niche = slots.iter().filter(|s| s.kind == "NICHE").count();
    let exps = slots.iter().filter(|s| s.kind == "EXP").count();
    if slots.len() as u32 != Slots::TOTAL + exp {
        f.push(format!(
            "слотов {}, ожидается {} (ядро {} + EXP {})",
            slots.len(),
            Slots::TOTAL + exp,
            Slots::TOTAL,
            exp
        ));
    }
    if oc as u32 != Slots::OC_SLOTS {
        f.push(format!("OC-слотов {}, ожидается {}", oc, Slots::OC_SLOTS));
    }
    if mains as u32 != Slots::RPLUS_MAINS {
        f.push(format!(
            "R+-мейнов {}, ожидается {}",
            mains, Slots::RPLUS_MAINS
        ));
    }
    if niche as u32 != Slots::NICHE_COUNT {
        f.push(format!(
            "NICHE-слотов {}, ожидается {}",
            niche, Slots::NICHE_COUNT
        ));
    }
    if exps as u32 != exp {
        f.push(format!("EXP-слотов {}, заявлено {}", exps, exp));
    }
    let mut seen = std::collections::HashSet::new();
    for s in slots {
        if !seen.insert(s.palette_id.clone()) {
            f.push(format!(
                "P{}: палитра {} повторяется в батче (ротация без повторов)",
                s.position, s.palette_id
            ));
        }
    }
    hard("structure", f, Vec::new())
}

pub(crate) fn gate_exp_purity(slots: &[SlotPlan], theme: &str, exp: u32) -> Receipt {
    let mut f = Vec::new();
    let mut notes = Vec::new();
    let exps: Vec<&SlotPlan> = slots.iter().filter(|s| s.kind == "EXP").collect();
    if exps.is_empty() {
        notes.push("EXP-оверлея нет — гейт молчит (0 — только явным приказом)".into());
        return hard("exp-purity", f, notes);
    }
    let theme_words: Vec<String> = theme
        .split(|c: char| c.is_whitespace() || c == '_' || c == '-')
        .map(|w| w.trim().to_lowercase())
        .filter(|w| w.chars().count() >= 3)
        .collect();
    for s in &exps {
        let hypothesis = s.exp_hypothesis.clone().unwrap_or_default();
        let letter = s.exp_letter.clone().unwrap_or_default();
        if letter.is_empty() {
            f.push(format!(
                "P{}: EXP-слот без программы (letter/half/hypothesis) — радар не увидит",
                s.position
            ));
            continue;
        }
        // /^[α-ω]$/ — the greek range
        if !is_greek_lower(&letter) {
            f.push(format!("P{}: маркер не греческая буква ({})", s.position, letter));
        }
        if let Some(pw) = s.exp_pair_with {
            let other = slots.iter().find(|x| x.position == pw);
            match other {
                None => f.push(format!(
                    "P{}: пара EXP указывает на P{}, которого нет или он не EXP",
                    s.position, pw
                )),
                Some(o) if o.kind != "EXP" => f.push(format!(
                    "P{}: пара EXP указывает на P{}, которого нет или он не EXP",
                    s.position, pw
                )),
                _ => {}
            }
        }
        if !theme_words.is_empty() && theme_words.iter().any(|w| hypothesis.to_lowercase().contains(w.as_str())) {
            f.push(format!(
                "P{}: тема-слово в гипотезе EXP-болванки — EXP без темы (вердикт T4-34)",
                s.position
            ));
        }
    }
    notes.push(format!(
        "EXP-слотов {} (заявлено {}) · тема-слов для фильтра {}",
        exps.len(),
        exp,
        theme_words.len()
    ));
    hard("exp-purity", f, notes)
}

fn is_greek_lower(s: &str) -> bool {
    let ch = s.chars().next().unwrap_or('\0');
    s.chars().count() == 1 && ('\u{03B1}'..='\u{03C9}').contains(&ch)
}

pub(crate) fn gate_floors(theme: &str, notes: &str, slots: &[SlotPlan]) -> Receipt {
    let mut texts: Vec<String> = vec![theme.to_string(), notes.to_string()];
    for s in slots {
        texts.push(format!(
            "{} {} {}",
            s.kind,
            s.oc_theme.clone().unwrap_or_default(),
            s.exp_hypothesis.clone().unwrap_or_default()
        ));
    }
    let joined = texts.join("\n").to_lowercase();
    let mut f = Vec::new();
    for (group, tokens) in FLOORS.iter() {
        for token in tokens.iter() {
            if joined.contains(&token.to_lowercase()) {
                f.push(format!(
                    "floors/{}: banned token «{}» в плане (eternal floors)",
                    group, token
                ));
            }
        }
    }
    hard("floors", f, Vec::new())
}

pub(crate) fn gate_window(window_union: u32, fresh_needed: u32, extension_pool: u32, exp_needed: u32) -> Receipt {
    let mut f = Vec::new();
    let mut notes = Vec::new();
    let budget = Palette::FUND - window_union;
    if budget < fresh_needed {
        f.push(format!(
            "window: фонд {} − окно {} = {} свежих палитр, нужно {} — расширь фонд или очисти окно",
            Palette::FUND, window_union, budget, fresh_needed
        ));
    }
    if extension_pool < exp_needed {
        f.push(format!(
            "EXP-бюджет: свободных extension-палитр {}, нужно {} (P{}–P{} — резерв EXP)",
            extension_pool,
            exp_needed,
            Palette::EXTENSION_FIRST_ID,
            Palette::EXTENSION_LAST_ID
        ));
    }
    if exp_needed > 0 && exp_needed < Slots::EXP_MAX {
        notes.push(format!(
            "EXP {}/{}: вердикт T4-32 ждёт расширение до {} (нужно 28 / окно {} / фонд {})",
            exp_needed, Slots::EXP_MAX, Slots::EXP_MAX, window_union, Palette::FUND
        ));
    }
    notes.push(format!(
        "окно = {} палитр из {} батчей · бюджет {}",
        window_union, Palette::WINDOW_BATCHES, budget
    ));
    hard("window", f, notes)
}

pub(crate) fn gate_ab(slots: &[SlotPlan], ab_pairs: u32) -> Receipt {
    let mut f = Vec::new();
    if ab_pairs > 0 && (ab_pairs < AB_MIN || ab_pairs > AB_MAX) {
        f.push(format!("A/B-пар {}, канон {}..{}", ab_pairs, AB_MIN, AB_MAX));
    }
    let mut by_pair: std::collections::BTreeMap<u32, Vec<&SlotPlan>> = std::collections::BTreeMap::new();
    for s in slots {
        if let Some(p) = s.ab_pair {
            by_pair.entry(p).or_default().push(s);
        }
    }
    for (pair, members) in &by_pair {
        if members.len() != 2 {
            f.push(format!("A/B-пара {}: {} участников — ровно два (полы A и B)", pair, members.len()));
            continue;
        }
        let (a, b) = (members[0], members[1]);
        if a.ab_half == b.ab_half {
            f.push(format!("A/B-пара {}: обе половины {}", pair, a.ab_half.clone().unwrap_or_default()));
        }
        if a.kind != b.kind || a.rating != b.rating || a.register != b.register {
            f.push(format!(
                "A/B-пара {}: различается больше одной переменной (kind/rating/register общие)",
                pair
            ));
        }
        if a.palette_id == b.palette_id {
            f.push(format!(
                "A/B-пара {}: палитра общая — единственная переменная обязана отличаться",
                pair
            ));
        }
    }
    warn_receipt("ab-single-variable", f, Vec::new())
}

/* ---------------- stored-plan audit (`t4 check` / UI Review) ---------------- */

/// Восстановление слотов из СОХРАНЁННОГО плана — без пересборки: план —
/// источник права (§0), аудит пересчитывает гейты по нему самому.
fn slot_from_json(v: &serde_json::Value) -> Option<SlotPlan> {
    Some(SlotPlan {
        position: v.get("position")?.as_u64()? as u32,
        kind: v.get("kind")?.as_str()?.to_string(),
        rating: v.get("rating")?.as_str()?.to_string(),
        register: v.get("register")?.as_str()?.to_string(),
        oc_theme: v.get("ocTheme").and_then(|x| x.as_str()).map(String::from),
        race: v.get("race").and_then(|x| x.as_str()).map(String::from),
        palette_id: v.get("paletteId")?.as_str()?.to_string(),
        exp_letter: v.get("exp").and_then(|e| e.get("letter")).and_then(|x| x.as_str()).map(String::from),
        exp_half: v.get("exp").and_then(|e| e.get("half")).and_then(|x| x.as_str()).map(String::from),
        exp_pair_with: v.get("exp").and_then(|e| e.get("pairWith")).and_then(|x| x.as_u64()).map(|n| n as u32),
        exp_hypothesis: v.get("exp").and_then(|e| e.get("hypothesis")).and_then(|x| x.as_str()).map(String::from),
        ab_pair: v.get("ab").and_then(|a| a.get("pair")).and_then(|x| x.as_u64()).map(|n| n as u32),
        ab_half: v.get("ab").and_then(|a| a.get("half")).and_then(|x| x.as_str()).map(String::from),
    })
}

/// Сухой пересчёт планировочных гейтов по сохранённому плану —
/// receipts те же, события НЕ пишутся (зеркало `check` в cli.ts).
pub fn audit_plan(plan: &serde_json::Value) -> Result<Vec<Receipt>, String> {
    let slots_json = plan
        .get("slots")
        .and_then(|s| s.as_array())
        .ok_or("audit_plan: план без slots[]")?;
    let mut slots: Vec<SlotPlan> = Vec::new();
    for (i, s) in slots_json.iter().enumerate() {
        slots.push(slot_from_json(s).ok_or_else(|| format!("audit_plan: слот №{} битый", i + 1))?);
    }
    let theme = plan.get("theme").and_then(|t| t.as_str()).unwrap_or("");
    let notes = plan.get("notes").and_then(|t| t.as_str()).unwrap_or("");
    let exp = plan.get("exp").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let ab = plan.get("abPairs").and_then(|x| x.as_u64()).unwrap_or(2) as u32;
    let window_union = plan
        .get("paletteWindow")
        .and_then(|w| w.get("union"))
        .and_then(|x| x.as_u64())
        .unwrap_or(0) as u32;
    let extension_free = Palette::EXTENSION_LAST_ID - Palette::EXTENSION_FIRST_ID + 1;
    Ok(vec![
        gate_structure(&slots, exp),
        gate_exp_purity(&slots, theme, exp),
        gate_floors(theme, notes, &slots),
        gate_window(window_union, Slots::TOTAL, extension_free, exp),
        gate_ab(&slots, ab),
    ])
}

/* ---------------- projections (scratch writes) ---------------- */

fn upsert_batch_from_compile(
    conn: &Connection,
    slug: &str,
    theme: &str,
    engine: &str,
    slots: &[SlotPlan],
    exp: u32,
    ab_pairs: u32,
    hard_pass: bool,
    diff: (u32, u32),
    payload_json: &str,
    sha10: &str,
    created_at: &str,
    event_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO t4_batches
           (slug, title, theme, engine, status, slots_total, exp_slots, ab_pairs,
            hard_pass, diff_up, diff_down, payload, sha10, created_at, delivered_at, event_id)
         VALUES (?1, ?2, ?3, ?4, 'compiled', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, ?14)
         ON CONFLICT(slug) DO UPDATE SET
           title = excluded.title, theme = excluded.theme, engine = excluded.engine,
           status = 'compiled', slots_total = excluded.slots_total, exp_slots = excluded.exp_slots,
           ab_pairs = excluded.ab_pairs, hard_pass = excluded.hard_pass,
           diff_up = excluded.diff_up, diff_down = excluded.diff_down,
           payload = excluded.payload, sha10 = excluded.sha10, created_at = excluded.created_at,
           delivered_at = NULL, event_id = excluded.event_id",
        rusqlite::params![
            slug,
            theme,
            theme,
            engine,
            slots.len() as u32,
            exp,
            ab_pairs,
            if hard_pass { 1 } else { 0 },
            diff.0,
            diff.1,
            payload_json,
            sha10,
            created_at,
            event_id,
        ],
    )?;
    Ok(())
}

pub fn get_batch_status(conn: &Connection, slug: &str) -> Option<String> {
    conn.query_row(
        "SELECT status FROM t4_batches WHERE slug = ?1",
        [slug],
        |r| r.get(0),
    )
    .ok()
}

pub fn next_batch_number(conn: &Connection) -> u32 {
    let mut max: u32 = 0;
    if let Ok(mut stmt) = conn.prepare("SELECT slug FROM t4_batches") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for slug in rows.flatten() {
                if let Some(n) = slug
                    .strip_prefix("T4-")
                    .and_then(|d| d.parse::<u32>().ok())
                {
                    if slug.len() >= 4 && slug[3..].bytes().all(|b| b.is_ascii_digit()) {
                        max = max.max(n);
                    }
                }
            }
        }
    }
    max + 1
}

pub fn palette_window_union(conn: &Connection, window_batches: u32) -> std::collections::HashSet<String> {
    let mut union = std::collections::HashSet::new();
    let rows: Vec<String> = {
        match conn.prepare(
            "SELECT payload FROM t4_batches WHERE status = 'delivered' ORDER BY delivered_at DESC LIMIT ?1",
        ) {
            Ok(mut stmt) => stmt
                .query_map([window_batches as i64], |r| r.get::<_, String>(0))
                .map(|rows| rows.flatten().collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };
    for payload in rows {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
            if let Some(slots) = v.get("slots").and_then(|s| s.as_array()) {
                for s in slots {
                    if let Some(pid) = s.get("paletteId").and_then(|p| p.as_str()) {
                        union.insert(pid.to_string());
                    }
                }
            }
        }
    }
    union
}

const RATING_ORDER: [&str; 4] = ["PG-13", "R", "R+", "X"];

fn diff_against_previous(conn: &Connection, slots: &[SlotPlan]) -> (u32, u32) {
    let prev: Option<String> = conn
        .query_row(
            "SELECT payload FROM t4_batches WHERE status = 'delivered' ORDER BY delivered_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    let prev = match prev {
        None => return (0, 0),
        Some(p) => p,
    };
    let parsed: serde_json::Value = match serde_json::from_str(&prev) {
        Ok(v) => v,
        Err(_) => return (0, 0),
    };
    let prev_ratings: Vec<String> = parsed
        .get("slots")
        .and_then(|s| s.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.get("rating").and_then(|r| r.as_str()))
                .filter(|r| RATING_ORDER.contains(r))
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let mine: Vec<&str> = slots.iter().map(|s| s.rating.as_str()).collect();
    let n = prev_ratings.len().min(mine.len());
    let (mut up, mut down) = (0u32, 0u32);
    for i in 0..n {
        let d = rating_rank(mine[i]) as i64 - rating_rank(&prev_ratings[i]) as i64;
        if d > 0 {
            up += 1;
        }
        if d < 0 {
            down += 1;
        }
    }
    (up, down)
}

fn rating_rank(r: &str) -> usize {
    RATING_ORDER.iter().position(|x| *x == r).unwrap_or(0)
}

fn hex16(bytes: &[u8]) -> String {
    bytes[..8].iter().map(|b| format!("{:02x}", b)).collect()
}

/// canon block for /v1/meta
pub fn meta_block() -> serde_json::Value {
    serde_json::json!({
        "era": ERA,
        "canon": CANON_VERSION,
        "fam": FAM,
        "constitution": { "version": "1.0.0", "doc": "thread4/CONSTITUTION.md" },
        "laws": [
            { "n": 27, "name": "ТОН-НЕ-ЩИТ", "note": "тон несущей вещи на зоне заявки: through-заявка живёт только на dark" },
            { "n": 28, "name": "ПРОСВЕТ-ЧЁТКОСТЬ", "note": "видимость окна палитр честна в квитанции" },
            { "n": 29, "name": "ДРЕСС-КОД", "note": "дресс-код слота назначается контрактом" }
        ],
        "slots": { "total": Slots::TOTAL, "ocSlots": Slots::OC_SLOTS, "mainsTotal": Slots::MAINS_TOTAL, "nicheCount": Slots::NICHE_COUNT, "rplusMains": Slots::RPLUS_MAINS, "xSlots": Slots::X_SLOTS, "expMax": Slots::EXP_MAX, "expDefault": Slots::EXP_DEFAULT },
        "ab": { "min": AB_MIN, "max": AB_MAX, "oneVariable": true },
        "palette": { "fund": Palette::FUND, "firstId": Palette::FIRST_ID, "lastId": Palette::LAST_ID, "extensionFirstId": Palette::EXTENSION_FIRST_ID, "extensionLastId": Palette::EXTENSION_LAST_ID, "windowBatches": Palette::WINDOW_BATCHES },
        "chain": { "genesis": CHAIN_GENESIS, "algorithm": "sha256" },
        "serve": { "port": crate::canon::SERVE_PORT, "hostname": crate::canon::SERVE_HOSTNAME, "maxBodyBytes": crate::canon::MAX_BODY_BYTES },
    })
}
