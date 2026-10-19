//! THREAD 4 ENGINE (RUST TWIN) — ТЕКСТОВАЯ БАТАРЕЯ ГЕЙТОВ, ЭТАП 2.
//!
//! Порт оставшихся scribe-time гейтов из src/lib/t4/gates.ts (файл-эра):
//! 12 безусловных — rating-recipe (hard, «сердце PH») · dresser (warn,
//! №29-когерентность) · canon (hard, OC-канон) · diversity (hard) ·
//! niche-legibility (warn) · claim-visibility (warn) · technique-layers
//! (warn) · simcheck (warn, Jaccard) · technique-map (advisory) ·
//! salience-chain (warn, §9-секста+§9-септима) · contract-fidelity (warn) ·
//! bumps-quota (warn, G17) — и 3 условных (маркер-зависимые, вне счёта
//! базы): raw-plus (hard, RAW+-маркер в H1 или engine контракта) ·
//! rating-recipe-exploratory (warn, ⚗) · raw-plus-exploratory (warn, ⚗).
//!
//! Конвенции этапа 1 (textgates.rs) неприкосновенны: файлы репо RO,
//! findings ДОСЛОВНО на русском как в TS, квитанции — compile::Receipt,
//! гейты ничего не пишут. Порядок батареи — как в TS runGates (сверено
//! по живым bun-прогонам и слепкам gate.run в летописи файл-эры).
//!
//! Два места, где JS-семантика тоньше regex-crate:
//!  · \b по кириллическим иглам (закон №26: слова тайтла бывают русскими)
//!    требует ТОЧНОГО класса слова JS [A-Za-z0-9_] — хелпер js_word_bounded
//!    (кириллица — НЕ слово-симвл, «\bколокол\b» после пробела не матчится);
//!  · порядок ключей OC-канона читается из файла ручным сканером —
//!    serde_json BTreeMap сортирует ключи, а TS Object.keys хранит порядок
//!    вставки, и canon-гейт выбирает ПЕРВОЕ совпавшее имя по порядку файла.

use crate::compile::Receipt;
use std::collections::{HashMap, HashSet};

use super::{
    advisory_receipt, ascii_word, contains_word, contains_word_ci, read_json, read_text, specs_dir,
    tag_block_of, tier_of, warn_receipt, Contract, TextBatch, TextSlot,
};

/* ================================================================== */
/* Этап 2.0 — лоадеры спеков (RO; свежее чтение, как textgates.rs)      */
/* ================================================================== */

/// OC-канон: (имя, hair, eyes) в ПОРЯДКЕ ФАЙЛА (canon-гейт).
#[derive(Clone, Debug, Default)]
pub struct OcCanon {
    pub hair_eyes: Vec<(String, String, String)>,
}

/// Порядок ключей объекта «"<key>"» верхнего уровня в ФАЙЛОВОМ порядке.
/// serde_json::Value (BTreeMap) сортирует ключи — TS Object.keys хранит
/// порядок вставки. Сканер структурный: строки с экранированием, баланс
/// вложенных {} и [] — без полноценного JSON-парсера, только ключи.
fn json_object_keys_in_file_order(raw: &str, key: &str) -> Option<Vec<String>> {
    let chars: Vec<char> = raw.chars().collect();
    let needle: Vec<char> = format!("\"{key}\"").chars().collect();
    let mut obj_start = None;
    for i in 0..chars.len() {
        if chars[i] != '"'
            || chars.len() - i < needle.len()
            || chars[i..i + needle.len()] != needle[..]
        {
            continue;
        }
        let mut j = i + needle.len();
        while j < chars.len() && chars[j].is_whitespace() {
            j += 1;
        }
        if j < chars.len() && chars[j] == ':' {
            j += 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && chars[j] == '{' {
                obj_start = Some(j + 1);
                break;
            }
        }
    }
    let mut i = obj_start?;
    let mut keys: Vec<String> = Vec::new();
    loop {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() || chars[i] == '}' {
            break;
        }
        if chars[i] != '"' {
            return None; // не ключ — честный отказ, вызывающий упадёт на дефолт
        }
        i += 1;
        let mut k = String::new();
        while i < chars.len() && chars[i] != '"' {
            if chars[i] == '\\' && i + 1 < chars.len() {
                k.push(chars[i + 1]);
                i += 2;
            } else {
                k.push(chars[i]);
                i += 1;
            }
        }
        if i >= chars.len() {
            return None;
        }
        i += 1; // закрывающая кавычка ключа
        keys.push(k);
        // ':' + пропуск значения (баланс скобок/строк)
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i < chars.len() && chars[i] == ':' {
            i += 1;
        }
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let mut depth = 0i32;
        let mut in_str = false;
        while i < chars.len() {
            let c = chars[i];
            if in_str {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == '"' {
                    in_str = false;
                }
                i += 1;
                continue;
            }
            match c {
                '"' => in_str = true,
                '{' | '[' => depth += 1,
                '}' | ']' if depth > 0 => depth -= 1,
                '}' | ']' | ',' if depth == 0 => break,
                _ => {}
            }
            i += 1;
        }
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i < chars.len() && chars[i] == ',' {
            i += 1;
        }
    }
    Some(keys)
}

/// getOCCanon() (specs.ts:480): specs/oc-canon.json → имена в порядке файла.
pub fn load_oc_canon() -> Option<OcCanon> {
    let path = specs_dir().join("oc-canon.json");
    let raw = read_text(&path)?;
    let v = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    let ocs = v.get("ocs")?.as_object()?;
    let order = json_object_keys_in_file_order(&raw, "ocs")
        .unwrap_or_else(|| ocs.keys().cloned().collect());
    let mut hair_eyes = Vec::new();
    for name in order {
        let Some(oc) = ocs.get(&name) else { continue };
        let s = |k: &str| oc.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        hair_eyes.push((name, s("hair"), s("eyes")));
    }
    Some(OcCanon { hair_eyes })
}

/// Один механизм рецепта (rating-recipes tiers.<T>.mechanisms.<name>).
#[derive(Clone, Debug, Default)]
pub struct Mech {
    pub name: String,
    pub hard: Vec<String>,
    pub counter_neg: Vec<String>,
    pub counter_neg_lifted: Vec<String>,
    pub required_state: Vec<String>,
    pub underlayer_block: Vec<String>,
    pub underlayer_block_applies_to: Vec<String>,
    pub dead_fabrics_lower: Vec<String>,
    pub dead_fabrics_upper: Vec<String>,
    pub lower_claims: Vec<String>,
    pub upper_claims: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct TierRecipe {
    pub signals: Vec<String>,
    pub signal_min: Option<i64>,
    pub signals_hard: Vec<String>,
    pub hard_min: Option<i64>,
    /// порядок файла (BTreeMap-сортировка совпадает: bumps, on_skin / through_fabric)
    pub mechanisms: Vec<Mech>,
    /// None = поля нет (XXX-тир) — TS «(recipe.counter_neg ?? [])»
    pub counter_neg: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default)]
pub struct RatingRecipes {
    /// ключи как в спеке: PG13 / R / RPLUS / X / XXX (порядок файла = алфавит)
    pub tiers: Vec<(String, TierRecipe)>,
}

fn str_arr(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// getRatingRecipes() (specs.ts:492): specs/rating-recipes.json v1.9.0.
pub fn load_rating_recipes() -> Option<RatingRecipes> {
    let v = read_json(&specs_dir().join("rating-recipes.json"))?;
    let tiers = v.get("tiers")?.as_object()?;
    let mut out = Vec::new();
    for (key, t) in tiers {
        let mut mechanisms = Vec::new();
        if let Some(me) = t.get("mechanisms").and_then(|x| x.as_object()) {
            for (mname, m) in me {
                mechanisms.push(Mech {
                    name: mname.clone(),
                    hard: str_arr(m, "hard"),
                    counter_neg: str_arr(m, "counter_neg"),
                    counter_neg_lifted: str_arr(m, "counter_neg_lifted"),
                    required_state: str_arr(m, "required_state"),
                    underlayer_block: str_arr(m, "underlayer_block"),
                    underlayer_block_applies_to: str_arr(m, "underlayer_block_applies_to"),
                    dead_fabrics_lower: str_arr(m, "dead_fabrics_lower"),
                    dead_fabrics_upper: str_arr(m, "dead_fabrics_upper"),
                    lower_claims: str_arr(m, "lower_claims"),
                    upper_claims: str_arr(m, "upper_claims"),
                });
            }
        }
        out.push((
            key.clone(),
            TierRecipe {
                signals: str_arr(t, "signals"),
                signal_min: t.get("signal_min").and_then(|x| x.as_i64()),
                signals_hard: str_arr(t, "signals_hard"),
                hard_min: t.get("hard_min").and_then(|x| x.as_i64()),
                mechanisms,
                counter_neg: t.get("counter_neg").and_then(|x| x.as_array()).map(|a| {
                    a.iter().filter_map(|x| x.as_str().map(String::from)).collect()
                }),
            },
        ));
    }
    Some(RatingRecipes { tiers: out })
}

/// Строка таблицы приёмов автора (rating-techniques.json techniques[]).
#[derive(Clone, Debug, Default)]
pub struct TechEntry {
    pub tag: String,
    /// альтернативы (ИЛИ); внутри альтернативы — подстроки через И
    pub match_alts: Vec<Vec<String>>,
    pub layer: i64,
    pub r: String,
    pub rplus: String,
    pub x: String,
    pub note: String,
    pub trap: bool,
    pub suppressor: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Techniques {
    pub techniques: Vec<TechEntry>,
    /// sum_rules.rplus_floor: (signals_min, layers_min)
    pub rplus_floor: (i64, i64),
    pub xcut_framing: Option<Vec<String>>,
    pub xcut_lower_cover: Option<Vec<String>>,
}

/// getRatingTechniques() (specs.ts:495): specs/rating-techniques.json.
pub fn load_rating_techniques() -> Option<Techniques> {
    let v = read_json(&specs_dir().join("rating-techniques.json"))?;
    let arr = v.get("techniques")?.as_array()?;
    let mut techniques = Vec::new();
    for e in arr {
        let match_alts = e
            .get("match")
            .and_then(|x| x.as_array())
            .map(|alts| {
                alts
                    .iter()
                    .map(|a| {
                        a.as_array()
                            .map(|x| x.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();
        let s = |k: &str| e.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        techniques.push(TechEntry {
            tag: s("tag"),
            match_alts,
            layer: e.get("layer").and_then(|x| x.as_i64()).unwrap_or(0),
            r: s("r"),
            rplus: s("rplus"),
            x: s("x"),
            note: s("note"),
            trap: e.get("trap").and_then(|x| x.as_bool()).unwrap_or(false),
            suppressor: e.get("suppressor").and_then(|x| x.as_bool()).unwrap_or(false),
        });
    }
    let floor = v
        .get("sum_rules")
        .and_then(|x| x.get("rplus_floor"))
        .map(|f| {
            (
                f.get("signals_min").and_then(|x| x.as_i64()).unwrap_or(3),
                f.get("layers_min").and_then(|x| x.as_i64()).unwrap_or(2),
            )
        })
        .unwrap_or((3, 2));
    let opt_arr = |k: &str| {
        v.get("xcut_hold")
            .and_then(|x| x.get(k))
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
    };
    Some(Techniques {
        techniques,
        rplus_floor: floor,
        xcut_framing: opt_arr("framing"),
        xcut_lower_cover: opt_arr("lower_cover"),
    })
}

/// Дрессер: гейт читает ТОЛЬКО conflicts (каналы/категории — писец, dresser.ts).
#[derive(Clone, Debug, Default)]
pub struct DresserSpec {
    pub conflicts: Vec<DressConflict>,
}

#[derive(Clone, Debug, Default)]
pub struct DressConflict {
    pub pair: Vec<String>,
    pub rule: String,
    pub why: String,
    pub tags: Vec<String>,
}

/// getDresser() (specs.ts:628): specs/dresser.json (квитанция №29).
pub fn load_dresser() -> Option<DresserSpec> {
    let v = read_json(&specs_dir().join("dresser.json"))?;
    let mut conflicts = Vec::new();
    for c in v.get("conflicts").and_then(|x| x.as_array()).unwrap_or(&Vec::new()) {
        conflicts.push(DressConflict {
            pair: c
                .get("pair")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            rule: c.get("rule").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            why: c.get("why").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            tags: str_arr(c, "tags"),
        });
    }
    Some(DresserSpec { conflicts })
}

/// Носители: класс → механо-группа + sheer-семья (diversity-гейт).
#[derive(Clone, Debug, Default)]
pub struct CarriersLite {
    pub class_mech: HashMap<String, String>,
    pub sheer_ids: HashSet<String>,
}

/// getCarriers() (specs.ts:465): specs/carriers.json.
pub fn load_carriers() -> Option<CarriersLite> {
    let v = read_json(&specs_dir().join("carriers.json"))?;
    let mut class_mech = HashMap::new();
    if let Some(defs) = v.get("class_defs").and_then(|x| x.as_object()) {
        for (cls, d) in defs {
            class_mech.insert(
                cls.clone(),
                d.get("mech").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            );
        }
    }
    let mut sheer_ids = HashSet::new();
    if let Some(classes) = v.get("classes").and_then(|x| x.as_object()) {
        for (_, list) in classes {
            for c in list.as_array().unwrap_or(&Vec::new()) {
                if c.get("sheer_family").and_then(|x| x.as_bool()) == Some(true) {
                    if let Some(id) = c.get("id").and_then(|x| x.as_str()) {
                        sheer_ids.insert(id.to_string());
                    }
                }
            }
        }
    }
    Some(CarriersLite { class_mech, sheer_ids })
}

/// Расы: имя → фичи (races.json; contract-fidelity + niche-legibility).
#[derive(Clone, Debug, Default)]
pub struct RacesLite {
    pub races: Vec<(String, Vec<String>)>,
}

/// getRaces() (specs.ts:483): specs/races.json.
pub fn load_races() -> Option<RacesLite> {
    let v = read_json(&specs_dir().join("races.json"))?;
    let mut races = Vec::new();
    for r in v.get("races").and_then(|x| x.as_array()).unwrap_or(&Vec::new()) {
        races.push((
            r.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            str_arr(r, "features"),
        ));
    }
    Some(RacesLite { races })
}

/* ================================================================== */
/* Этап 2.1 — JS-семантические хелперы                                  */
/* ================================================================== */

/// ТОЧНАЯ семантика JS `/\bneedle\b/` (без флагов): слово = [A-Za-z0-9_];
/// кириллица — НЕ слово-симвл (закон №26: тайтл бывает русским —
/// «\bколокол\b» в JS НЕ матчится после пробела; contains_word бы совпал).
fn js_word_bounded(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let hc: Vec<char> = hay.chars().collect();
    let nc: Vec<char> = needle.chars().collect();
    let first = nc[0];
    let last = nc[nc.len() - 1];
    if hc.len() < nc.len() {
        return false;
    }
    let mut from = 0usize;
    while from + nc.len() <= hc.len() {
        if hc[from..from + nc.len()] == nc[..] {
            let before = if from == 0 {
                ascii_word(first) // \b на старте строки = первый символ — слово
            } else {
                ascii_word(hc[from - 1]) != ascii_word(first)
            };
            let e = from + nc.len();
            let after = if e >= hc.len() {
                ascii_word(last) // \b в конце строки = последний символ — слово
            } else {
                ascii_word(hc[e]) != ascii_word(last)
            };
            if before && after {
                return true;
            }
        }
        from += 1;
    }
    false
}

/// Любое из слов списка с ASCII-границами (JS /\b(a|b|…)\b/, hay lower).
fn word_any(hay: &str, list: &[&str]) -> bool {
    list.iter().any(|w| contains_word(hay, w))
}

/// Любая из подстрок (JS /a|b|…/ без границ).
fn sub_any(hay: &str, list: &[&str]) -> bool {
    list.iter().any(|s| hay.contains(s))
}

/// /^CR-([A-Z])/ — класс носителя; без матча '?' (clsOf, gates.ts:1061).
fn cls_of(id: &str) -> String {
    let b = id.as_bytes();
    if b.len() >= 4 && b[0] == b'C' && b[1] == b'R' && b[2] == b'-' && b[3].is_ascii_uppercase() {
        (b[3] as char).to_string()
    } else {
        "?".into()
    }
}

/// Первый матч /PL\d+/ в мете (contract-fidelity: поза шапки, без границ).
fn meta_pose_token(meta: &str) -> String {
    let b = meta.as_bytes();
    let mut i = 0usize;
    while i + 2 < b.len() {
        if b[i] == b'P' && b[i + 1] == b'L' && b[i + 2].is_ascii_digit() {
            let mut e = i + 2;
            while e < b.len() && b[e].is_ascii_digit() {
                e += 1;
            }
            return meta[i..e].to_string();
        }
        i += 1;
    }
    String::new()
}

/// Первый матч /P\d{1,3}_[A-Z_]+/ в мете (без границ — fallback палитры).
fn meta_palette_token(meta: &str) -> String {
    let b = meta.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'P' && i + 1 < b.len() && b[i + 1].is_ascii_digit() {
            let mut e = i + 1;
            while e < b.len() && e - i <= 3 && b[e].is_ascii_digit() {
                e += 1;
            }
            if e - i >= 2 && e < b.len() && b[e] == b'_' {
                let mut j = e + 1;
                while j < b.len() && (b[j].is_ascii_uppercase() || b[j] == b'_') {
                    j += 1;
                }
                if j > e + 1 {
                    return meta[i..j].to_string();
                }
            }
        }
        i += 1;
    }
    String::new()
}

/// Первый матч /\bPL\d{1,3}\b/ в шапке (diversity: позы; 4-я цифра рвёт \b).
fn header_pose_token(header: &str) -> String {
    let chars: Vec<char> = header.chars().collect();
    let mut i = 0usize;
    while i + 2 < chars.len() {
        if chars[i] == 'P'
            && chars[i + 1] == 'L'
            && chars[i + 2].is_ascii_digit()
            && (i == 0 || !ascii_word(chars[i - 1]))
        {
            let mut e = i + 2;
            while e < chars.len() && chars[e].is_ascii_digit() && e - i <= 4 {
                e += 1;
            }
            let digits = e - i - 2; // жадно ≤3: «PL1599» — \b после \d{1,3} не встаёт
            if digits >= 1 && digits <= 3 && (e >= chars.len() || !ascii_word(chars[e])) {
                return chars[i..e].iter().collect();
            }
        }
        i += 1;
    }
    String::new()
}

/// Первый матч /\b(P\d{1,3}_[A-Z_]+)\b/ в шапке (diversity/raw-plus).
fn header_palette_token(header: &str) -> String {
    let chars: Vec<char> = header.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == 'P'
            && i + 1 < chars.len()
            && chars[i + 1].is_ascii_digit()
            && (i == 0 || !ascii_word(chars[i - 1]))
        {
            let mut e = i + 1;
            while e < chars.len() && chars[e].is_ascii_digit() && e - i <= 3 {
                e += 1;
            }
            if e - i >= 2 && e - i <= 4 && e < chars.len() && chars[e] == '_' {
                let mut j = e + 1;
                while j < chars.len() && (chars[j].is_ascii_uppercase() || chars[j] == '_') {
                    j += 1;
                }
                if j > e + 1 && (j >= chars.len() || !ascii_word(chars[j])) {
                    return chars[i..j].iter().collect();
                }
            }
        }
        i += 1;
    }
    String::new()
}

/// sentenceDots (gates.ts:463): точки-концы предложений — точка НЕ между
/// цифрами («2.5d», «v2.0» — теги, не проза). Экспорт — для raw-plus.
pub fn sentence_dots(pos: &str) -> usize {
    let chars: Vec<char> = pos.chars().collect();
    let mut n = 0usize;
    for (i, c) in chars.iter().enumerate() {
        if *c != '.' {
            continue;
        }
        let prev_digit = i > 0 && chars[i - 1].is_ascii_digit();
        let next_digit = i + 1 < chars.len() && chars[i + 1].is_ascii_digit();
        if !prev_digit && !next_digit {
            n += 1;
        }
    }
    n
}

/// JS `x.toFixed(2)`: округление половины ОТ НУЛЯ (V8), потом два знака.
/// (x*100).round() — половина от нуля; деление назад и {:.2} — точная печать
/// (голая {:.2} — half-to-even, разошёлся бы с V8 на 0.125 → «0.12»≠«0.13»).
fn js_tofix2(x: f64) -> String {
    let r = (x * 100.0).round();
    format!("{:.2}", r / 100.0)
}

/// Слова Jaccard (gates.ts:2487): /[a-z']+/g, длина > 3, Set-семантика.
fn jaccard_words(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_ascii_lowercase() || ch == '\'' {
            cur.push(ch);
        } else if !cur.is_empty() {
            if cur.chars().count() > 3 && !out.contains(&cur) {
                out.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
        }
    }
    if !cur.is_empty() && cur.chars().count() > 3 && !out.contains(&cur) {
        out.push(cur);
    }
    out
}

/// Jaccard (gates.ts:2491): |A∩B| / |A∪B|; пустое множество — 0.
fn jaccard(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.iter().filter(|x| b.contains(x)).count();
    let union = a.len() + b.len() - inter;
    inter as f64 / union as f64
}

/// simcheck-предложения (sentencesOf, gates.ts:1758): split(/[.!?]\s+/),
/// trim+lower, длина > 40 (UTF-16 ≈ chars: живые тексты — BMP), не бойлерплейт.
fn simcheck_sentences(pos: &str) -> Vec<String> {
    let chars: Vec<char> = pos.chars().collect();
    let mut segments: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        if matches!(chars[i], '.' | '!' | '?') {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j > i + 1 {
                segments.push(chars[start..i].iter().collect());
                start = j;
                i = j;
                continue;
            }
        }
        i += 1;
    }
    segments.push(chars[start..].iter().collect());
    segments
        .into_iter()
        .filter_map(|s| {
            let t = s.trim().to_lowercase();
            let is_boiler = t.contains("masterpiece")
                || t.contains("best quality")
                || t.contains("anime artstyle")
                || t.contains("her face is rendered in stylized");
            if t.chars().count() > 40 && !is_boiler {
                Some(t)
            } else {
                None
            }
        })
        .collect()
}

/// /[a-z]+/gi — раны ASCII-букв (canon: слова канон-локов).
fn ascii_letter_runs(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphabetic() {
            cur.push(ch);
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn push_uniq<T: PartialEq>(v: &mut Vec<T>, x: T) {
    if !v.iter().any(|e| *e == x) {
        v.push(x);
    }
}

/* ------------------------------------------------------------------ */
/* Файл-эра летопись: окно ротации для simcheck                         */
/* ------------------------------------------------------------------ */

/// Свертка файл-эры (foldState, events.ts:592) в объёме, нужном simcheck:
/// deliveredAt по слагам + окно (3 последних сданных, void вне, алиасы).
#[derive(Clone, Debug, Default)]
pub struct FoldedEra {
    pub delivered_at: Vec<(String, Option<String>)>,
    pub window: Vec<String>,
}

fn upsert_delivered(v: &mut Vec<(String, Option<String>)>, slug: &str, at: Option<String>) {
    if let Some(rec) = v.iter_mut().find(|(s, _)| s == slug) {
        rec.1 = at;
    } else {
        v.push((slug.to_string(), at));
    }
}

/// foldState(readEvents()) — только события, нужные окну (RO, файл-эра).
pub fn fold_file_era() -> FoldedEra {
    let mut state = FoldedEra::default();
    let Some(text) = read_text(&super::event_log_path()) else { return state };
    let mut voided: Vec<String> = Vec::new();
    let mut aliases: Vec<(String, String, bool)> = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let typ = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let at = v.get("at").and_then(|t| t.as_str()).unwrap_or("");
        let d = v.get("data");
        let dslug = d.and_then(|d| d.get("slug")).and_then(|s| s.as_str());
        match typ {
            "batch.compiled" => {
                if let Some(slug) = dslug {
                    let existing = state
                        .delivered_at
                        .iter()
                        .find(|(s, _)| s == slug)
                        .and_then(|(_, a)| a.clone());
                    upsert_delivered(&mut state.delivered_at, slug, existing);
                }
            }
            "batch.delivered" => {
                if let Some(slug) = dslug {
                    upsert_delivered(&mut state.delivered_at, slug, Some(at.to_string()));
                }
            }
            "batch.void" => {
                if let Some(slug) = dslug {
                    if !voided.iter().any(|s| s == slug) {
                        voided.push(slug.to_string());
                    }
                }
            }
            "note" => {
                let kind = d.and_then(|d| d.get("kind")).and_then(|s| s.as_str());
                if kind == Some("slug-alias") {
                    let old = d.and_then(|d| d.get("oldSlug")).and_then(|s| s.as_str());
                    let new = d.and_then(|d| d.get("newSlug")).and_then(|s| s.as_str());
                    let replaces = d.and_then(|d| d.get("replaces")).and_then(|s| s.as_str());
                    if let (Some(o), Some(n)) = (old, new) {
                        if o != n {
                            aliases.push((o.to_string(), n.to_string(), replaces == Some("voided-dubl")));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    // ISSUE 17: алиасы применяются ПОСЛЕ всей истории (легализация задним числом)
    for (old, new, drop_void) in aliases {
        if let Some(pos) = state.delivered_at.iter().position(|(s, _)| s == &old) {
            let (_, at) = state.delivered_at.remove(pos);
            upsert_delivered(&mut state.delivered_at, &new, at);
        }
        if drop_void {
            voided.retain(|s| s != &new);
        }
    }
    let mut delivered: Vec<(String, String)> = state
        .delivered_at
        .iter()
        .filter_map(|(s, a)| a.clone().map(|a| (s.clone(), a)))
        .filter(|(s, _)| !voided.contains(s))
        .collect();
    delivered.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    state.window = delivered.iter().rev().take(3).rev().map(|(s, _)| s.clone()).collect();
    state
}

/// historicalWindowFor (gates.ts:448): сданный батч судят только члены
/// окна, сданные НЕ ПОЗЖЕ него (будущее не судит прошлое); несданный —
/// видит всё текущее окно.
pub fn historical_window(slug: &str, state: &FoldedEra) -> Vec<String> {
    let mine_at = state
        .delivered_at
        .iter()
        .find(|(s, _)| s == slug)
        .and_then(|(_, a)| a.clone());
    match mine_at {
        None => state.window.clone(),
        Some(mine) => state
            .window
            .iter()
            .filter(|w| match state.delivered_at.iter().find(|(s, _)| s == *w) {
                Some((_, Some(at))) => *at <= mine,
                _ => true, // несданный член (TS: !wmAt → keep)
            })
            .cloned()
            .collect(),
    }
}

/// windowOthersFor (gates.ts:421): себя, источник rebuildOf и ПЕРЕСТРОЙКИ
/// этого батча (wc.rebuildOf == batchSlug) окно не судит.
pub fn window_others(slug: &str, window: &[String], rebuild_of: Option<&str>) -> Vec<String> {
    window
        .iter()
        .filter(|w| {
            if w.as_str() == slug || Some(w.as_str()) == rebuild_of {
                return false;
            }
            let wc_rebuild = read_json(&super::contracts_dir().join(format!("{}.json", w)))
                .and_then(|v| v.get("rebuildOf").and_then(|x| x.as_str()).map(String::from));
            wc_rebuild.as_deref() != Some(slug)
        })
        .cloned()
        .collect()
}

/* ------------------------------------------------------------------ */
/* Техника-карта: общие механики technique-layers / technique-map       */
/* ------------------------------------------------------------------ */

/// techTagBlock (gates.ts:367): тег-блок до первой точки, lower, бойлерплейт
/// (quality/фейс-опенеры/1girl/solo) вырезается — «ecchi anime style» не
/// должен дарить слой 3.
pub fn tech_tag_block(pos: &str) -> String {
    let tb = tag_block_of(pos);
    const BOILER: &[&str] = &[
        "hentai anime style", "ecchi anime style", "anime style", "masterpiece",
        "best quality", "anime artstyle", "1girl", "solo",
    ];
    let chars: Vec<char> = tb.chars().collect();
    let mut out = String::with_capacity(tb.len());
    let mut i = 0usize;
    'outer: while i < chars.len() {
        if i == 0 || !ascii_word(chars[i - 1]) {
            for alt in BOILER {
                let a: Vec<char> = alt.chars().collect();
                if i + a.len() <= chars.len() && chars[i..i + a.len()] == a[..] {
                    let e = i + a.len();
                    if e >= chars.len() || !ascii_word(chars[e]) {
                        out.push(' ');
                        i = e;
                        continue 'outer;
                    }
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// techHit (gates.ts:373): альтернативы (ИЛИ), внутри — подстроки через И,
/// каждая \b…\b (регистрозависимо; вход lower, спек lower).
fn tech_hit(tb: &str, alts: &[Vec<String>]) -> bool {
    alts.iter().any(|alt| alt.iter().all(|s| contains_word(tb, s)))
}

/// Сигнал лестницы R+: ● на R / R+ / X (gates.ts:380).
fn is_ladder_signal(e: &TechEntry) -> bool {
    e.r == "●" || e.rplus == "●" || e.x == "●"
}

/// dedupeSubsumed (gates.ts:387): субсумируемые теги не считаются дважды.
fn dedupe_subsumed(hits: &[TechEntry]) -> Vec<TechEntry> {
    let has = |re: &[&str]| hits.iter().any(|e| sub_any(&e.tag, re));
    hits.iter()
        .filter(|e| {
            if e.tag == "nipples"
                && has(&["nipples through", "taped nipples", "clothed nipples", "covered nipples", "nipple outline"])
            {
                return false;
            }
            if e.tag == "naked, nude" && has(&["naked apron", "naked shirt", "almost naked"]) {
                return false;
            }
            if e.tag == "see-through" && has(&["see-through breasts"]) {
                return false;
            }
            let bare = e.tag == "bare breasts" || e.tag == "no bra, bare breasts";
            if bare && has(&["breasts out", "one breast out", "breast slip"]) {
                return false;
            }
            true
        })
        .cloned()
        .collect()
}

const LAYER_NAMES: &[(i64, &str)] = &[(1, "видимо"), (2, "как"), (3, "зачем"), (4, "дорисовывает")];

/// join слоёв как JS: `${layersHit.map(l => LAYER_NAMES[l]).join('+')}` —
/// неизвестный слой в JS join печатается пустой строкой.
fn layer_name(l: i64) -> &'static str {
    LAYER_NAMES.iter().find(|(n, _)| *n == l).map(|(_, s)| *s).unwrap_or("")
}

/* ================================================================== */
/* 3. rating-recipe (hard) + rating-recipe-exploratory (warn, ⚗)        */
/* ================================================================== */

fn recipe_key(tier: &str) -> &'static str {
    match tier {
        "PG-13" => "PG13",
        "R+" => "RPLUS",
        "R" => "R",
        "X" => "X",
        "XXX" => "XXX",
        _ => "",
    }
}

/// TIER_RANK (verdicts.ts:13): PG-13=0, R=1, R+=2, X=3, XXX=4.
fn tier_rank(tier: &str) -> i64 {
    match tier {
        "PG-13" | "PG13" => 0,
        "R" => 1,
        "R+" | "RPLUS" => 2,
        "X" => 3,
        "XXX" => 4,
        _ => 0,
    }
}

/// /[a-zа-яё0-9']+/ — раны слов (закон №26: тайтлы бывают русскими).
fn word_runs_latin_cyr(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        let ok = ch.is_ascii_lowercase()
            || ('\u{0430}'..='\u{044F}').contains(&ch)
            || ch == '\u{0451}'
            || ch.is_ascii_digit()
            || ch == '\'';
        if ok {
            cur.push(ch);
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// /[a-zа-яё0-9']+/g → ' ' — нормализация POS для закон-№26 пробега
/// (каждый ран разделителей → один пробел, как в JS- replace).
fn normalize_word_runs(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_sep = false;
    for ch in s.chars() {
        let ok = ch.is_ascii_lowercase()
            || ('\u{0430}'..='\u{044F}').contains(&ch)
            || ch == '\u{0451}'
            || ch.is_ascii_digit()
            || ch == '\'';
        if ok {
            out.push(ch);
            prev_sep = false;
        } else if !prev_sep {
            out.push(' ');
            prev_sep = true;
        }
    }
    out
}

const TITLE_STOP: &[&str] =
    &["the", "a", "an", "of", "on", "in", "and", "or", "to", "no", "is", "for", "her"];

fn is_title_stop(w: &str) -> bool {
    TITLE_STOP.contains(&w)
}

fn count_signals(haystack_lower: &str, signals: &[String]) -> usize {
    signals.iter().filter(|s| haystack_lower.contains(&s.to_lowercase())).count()
}

/// 3. rating-recipe (gates.ts:745, hard) — «сердце PH»: per-slot рецепт по
/// specs/rating-recipes.json (сигнал-теги, рендер-доказанные заявки,
/// механизмы с состоянием ткани, закон №28, контр-NEG, X Cut, overclaim).
/// Возвращает (основная квитанция, опциональная ⚗-квитанция §10).
pub fn gate_rating_recipe(
    batch: &TextBatch,
    recipes: Option<&RatingRecipes>,
) -> (Receipt, Option<Receipt>) {
    let mut f: Vec<String> = Vec::new();
    let mut exploratory: Vec<String> = Vec::new();
    let tiers: &[(String, TierRecipe)] = recipes.map(|r| r.tiers.as_slice()).unwrap_or(&[]);
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier.is_empty() {
            f.push(format!("P{}: рейтинг не распознан в шапке («{}»)", s.position, s.meta));
            continue;
        }
        let key = recipe_key(tier);
        let Some((_, recipe)) = tiers.iter().find(|(k, _)| k == key) else { continue };
        let pos_lower = s.pos.to_lowercase();
        let neg_lower = s.neg.to_lowercase();
        let is_exploratory = s.header.contains('⚗');
        let signals = count_signals(&pos_lower, &recipe.signals);
        // signalMinDefault (gates.ts:754); ?? 1 — XXX-тир
        let default_min: i64 = match tier {
            "PG-13" => 2,
            "R" => 1,
            "R+" => 2,
            "X" => 2,
            _ => 1,
        };
        let min = recipe.signal_min.unwrap_or(default_min);
        if (signals as i64) < min {
            f.push(format!(
                "P{}: заявлен {}, сигнал-тегов рецепта {}/{} — рейтинг не заработан (рецепт: {}…)",
                s.position,
                tier,
                signals,
                min,
                recipe.signals.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
            ));
        }
        // HARD-CLAIM (вердикт T4-03): signals_hard обязан нести рендер-доказанную заявку
        if !recipe.signals_hard.is_empty() {
            let hard_n = count_signals(&pos_lower, &recipe.signals_hard);
            let hard_min = recipe.hard_min.unwrap_or(1);
            if (hard_n as i64) < hard_min {
                let cameltoe_only =
                    contains_word(&pos_lower, "cameltoe") || contains_word(&pos_lower, "camel toe");
                f.push(format!(
                    "P{}: заявлен {}, но рендер-доказанной заявки нет ({}/{}){}: {}",
                    s.position,
                    tier,
                    hard_n,
                    hard_min,
                    if cameltoe_only {
                        " — cameltoe рендер-мёртв (0 отрисовок, рендер-вердикт T4-03), заявку не зарабатывает"
                    } else {
                        ""
                    },
                    recipe.signals_hard.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
                ));
            }
        }
        // RENDER LAW: (а) состояние ткани (б) подслой (в) мёртвые ткани
        let tag_run = tag_block_of(&s.pos);
        for m in &recipe.mechanisms {
            let active_hard: Vec<&String> =
                m.hard.iter().filter(|h| tag_run.contains(&h.to_lowercase())).collect();
            if active_hard.is_empty() {
                continue;
            }
            if !m.required_state.is_empty() {
                let state_hit = m.required_state.iter().any(|st| tag_run.contains(&st.to_lowercase()));
                if !state_hit {
                    let msg = format!(
                        "P{}: механизм «{}» без состояния ткани — в тег-блоке нет ни одного из [{}] (рендер-вердикт T4-03: сухая плотная ткань не несёт edge, P13/P21 умерли именно так)",
                        s.position,
                        m.name,
                        m.required_state.join(" / ")
                    );
                    if is_exploratory {
                        exploratory.push(format!("EXPLORATORY (§10, квитанция): {msg}"));
                    } else {
                        f.push(msg);
                    }
                }
            }
            if m.underlayer_block_applies_to.iter().any(|h| active_hard.iter().any(|a| *a == h)) {
                for u in &m.underlayer_block {
                    if contains_word(&tag_run, u) {
                        f.push(format!(
                            "P{}: подслой «{}» под сквозь-ткань заявкой — рендерер рисует подслой, не edge, тиры падают в R (рендер-вердикт T4-03: P12 sports bra под sheer → R, P14 bra под gauze → R)",
                            s.position, u
                        ));
                        break;
                    }
                }
            }
            let is_lower = active_hard.iter().any(|h| m.lower_claims.contains(h));
            let is_upper = active_hard.iter().any(|h| m.upper_claims.contains(h));
            let mut dead_list: Vec<String> = Vec::new();
            if is_lower {
                dead_list.extend(m.dead_fabrics_lower.iter().cloned());
                dead_list.extend(m.dead_fabrics_upper.iter().filter(|x| x.as_str() == "suit").cloned());
            } else if is_upper {
                dead_list.extend(m.dead_fabrics_upper.iter().cloned());
                dead_list.extend(m.dead_fabrics_lower.iter().filter(|x| x.as_str() == "suit").cloned());
            }
            for df in &dead_list {
                if contains_word(&tag_run, df) {
                    f.push(format!(
                        "P{}: мёртвая ткань «{}» в тег-блоке при активной {} заявке «{}» — эта ткань не несёт edge (рендер-вердикт T4-03: джинсы/бархат/костюм → PG-13)",
                        s.position,
                        df,
                        if is_lower { "нижней" } else { "грудной" },
                        m.name
                    ));
                    break;
                }
            }
        }
        // механизм-осознанный контр-NEG (hard-тег по ВСЕМУ POS, подстрока)
        for m in &recipe.mechanisms {
            if !m.hard.iter().any(|h| pos_lower.contains(&h.to_lowercase())) {
                continue;
            }
            for t in &m.counter_neg {
                if !neg_lower.contains(&t.to_lowercase()) {
                    f.push(format!("P{}: механизм «{}» требует контр-NEG «{}» в NEG", s.position, m.name, t));
                }
            }
            for t in &m.counter_neg_lifted {
                if neg_lower.contains(&t.to_lowercase()) {
                    f.push(format!(
                        "P{}: механизм «{}» заглушен — «{}» в NEG закрывает грудь и душит сигнал (вердикт T4-03)",
                        s.position, m.name, t
                    ));
                }
            }
        }
        // ЗАКОН №28 (через-ткань = X-канал ПО ОПРЕДЕЛЕНИЮ; EXP ⚗ — квитанцией)
        if tier == "R+" {
            const DARK28: &[&str] = &[
                "black", "ink", "midnight", "charcoal", "espresso", "dark", "deep", "oxblood",
                "void", "sumi", "burgundy", "wine", "maroon", "plum", "chocolate", "cocoa",
                "aubergine", "obsidian", "onyx", "raven", "soot", "sable", "forest",
            ];
            let swim28 = word_any(&tag_run, &["swimsuit", "bikini", "rash guard"]);
            let through28 = contains_word(&tag_run, "nipples through clothing");
            let wet_combo28 = contains_word(&tag_run, "wet clothes") && contains_word(&tag_run, "see-through");
            let sheer28 = contains_word(&tag_run, "sheer");
            let bumps28 = contains_word(&tag_run, "clothed nipples") || contains_word(&tag_run, "covered nipples");
            let msg28 = |m: String, f: &mut Vec<String>, expl: &mut Vec<String>| {
                if is_exploratory {
                    expl.push(format!("EXPLORATORY (§10, квитанция): P{}: {}", s.position, m));
                } else {
                    f.push(format!("P{}: {}", s.position, m));
                }
            };
            if through28 {
                msg28("закон №28: «nipples through clothing» на R+ — через-заявка = X-канал ПО ОПРЕДЕЛЕНИЮ (рендерер рисует цветной сосок через любую ткань: P09 свитер, P12 не-сквозная жёлтая; P30-формула бугорков = DRY dark + covered-first + clinging + sweat)".into(), &mut f, &mut exploratory);
            }
            if wet_combo28 && !swim28 {
                msg28("закон №28: мокрое+сквозное на тканевом верхе = X-комбо на любом тоне (P12 deep-amber, P25 rose-pink, P26 black — все X); купальник — исключение (P21-золото), но тут не он".into(), &mut f, &mut exploratory);
            }
            if sheer28 {
                msg28("закон №28: слово «sheer» на R+ — сквозь-заявка в самом слове (P04 sheer black под призмой → X, P26 sheer crop → X); бугорки-канал живёт БЕЗ sheer-слова".into(), &mut f, &mut exploratory);
            }
            if bumps28 && !word_any(&tag_run, DARK28) {
                msg28("закон №28+№27: бугорки-канал (clothed/covered nipples) без тёмного слова-цвета — бугорки живут ТОЛЬКО на тёмной вещи (P30 oxblood/espresso — единственный выживший; светлые/серые вершины — каналы вне-ткани)".into(), &mut f, &mut exploratory);
            }
        }
        // контр-NEG границы тира
        let counter_hit = recipe
            .counter_neg
            .as_ref()
            .map(|cn| cn.iter().any(|t| neg_lower.contains(&t.to_lowercase())))
            .unwrap_or(false);
        if !counter_hit {
            f.push(format!(
                "P{}: контр-NEG не держит границу тира (нужно ≥1 из: {})",
                s.position,
                recipe
                    .counter_neg
                    .as_ref()
                    .map(|cn| cn.iter().take(3).cloned().collect::<Vec<_>>().join(", "))
                    .unwrap_or_default()
            ));
        }
        // X CUT HOLD (блок 9)
        if tier == "X" {
            let missing: Vec<String> = recipe
                .counter_neg
                .as_ref()
                .map(|cn| {
                    cn.iter()
                        .filter(|t| !neg_lower.contains(&t.to_lowercase()))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            if !missing.is_empty() {
                f.push(format!(
                    "P{}: X Cut hold (блок 9) — в NEG нет: {} — весь блок границы X обязан стоять в NEG (главная угроза X Cut — модель дорисовывает ниже; это флоор-сила, не совет)",
                    s.position,
                    missing.join(", ")
                ));
            }
            for t in ["spread legs", "nude lower body", "uncensored"] {
                if tag_run.contains(t) {
                    f.push(format!(
                        "P{}: X Cut hold (блок 9) — «{}» в POS приглашает рендерер ниже груди",
                        s.position, t
                    ));
                    break;
                }
            }
        }
        // overclaim: сигнал тира ВЫШЕ в POS (подстроки своих сигналов — легальны)
        let my_order = tier_rank(tier);
        for (other_key, other) in tiers {
            let other_tier = match other_key.as_str() {
                "PG13" => "PG-13",
                "RPLUS" => "R+",
                k => k,
            };
            if tier_rank(other_tier) <= my_order || other_tier == "XXX" {
                continue;
            }
            let over: Vec<String> = other
                .signals
                .iter()
                .filter(|sig| {
                    pos_lower.contains(&sig.to_lowercase())
                        && !recipe.signals.iter().any(|m| m.to_lowercase().contains(&sig.to_lowercase()))
                })
                .cloned()
                .collect();
            if !over.is_empty() && tier != "X" {
                f.push(format!(
                    "P{}: заявлен {}, но несёт сигнал выше тиром: «{}»",
                    s.position, tier, over[0]
                ));
            }
        }
    }
    let main = Receipt {
        gate: "rating-recipe",
        level: "hard",
        verdict: if f.is_empty() { "PASS" } else { "FAIL" },
        findings: f,
        notes: Vec::new(),
    };
    let exploratory_receipt = if exploratory.is_empty() {
        None
    } else {
        Some(Receipt {
            gate: "rating-recipe-exploratory",
            level: "warn",
            verdict: "WARN",
            findings: exploratory,
            notes: Vec::new(),
        })
    };
    (main, exploratory_receipt)
}

/* ================================================================== */
/* 3-бис. dresser (warn, квитанция №29)                                 */
/* ================================================================== */

/// checkCoherence (dresser.ts:163): конфликты категорий, №28-квитанции,
/// слои §7-бис, P03-реквизит. Строки-квитанции слота.
fn check_coherence(
    spec: &Option<DresserSpec>,
    t: &str,
    tier: &str,
    is_exploratory: bool,
) -> Vec<String> {
    let mut out = Vec::new();
    let Some(spec) = spec else { return out };
    const GROUP_A: &[&str] =
        &["garter straps", "garter belt", "thighhighs", "stockings", "lingerie set", "sheer nightgown"];
    const GROUP_B: &[&str] = &["swimsuit", "bikini"];
    for conf in &spec.conflicts {
        let tags: Vec<String> = conf.tags.iter().map(|x| x.to_lowercase()).collect();
        let group_a: Vec<&String> = tags.iter().filter(|x| GROUP_A.contains(&x.as_str())).collect();
        let group_b: Vec<&String> = tags.iter().filter(|x| GROUP_B.contains(&x.as_str())).collect();
        let a_hit = !group_a.is_empty() && group_a.iter().any(|x| contains_word(t, x));
        let b_hit = !group_b.is_empty() && group_b.iter().any(|x| contains_word(t, x));
        if a_hit && b_hit {
            out.push(format!(
                "конфликт дресс-кода: {} + {} — {}",
                conf.pair.first().map(String::as_str).unwrap_or(""),
                conf.pair.get(1).map(String::as_str).unwrap_or(""),
                conf.why
            ));
        }
        let fa_hit = t.contains("gown") || t.contains("opera gloves");
        let fb_hit = t.contains("gym leggings") || t.contains("tennis skirt") || t.contains("track shorts");
        if conf.rule == "warn"
            && ((fa_hit && fb_hit)
                || (t.contains("sports bra") && (t.contains("garter belt") || t.contains("stockings"))))
        {
            out.push(format!("смешение регистров (Дрессер, warn): {}", conf.why));
        }
    }
    if tier == "R+" && !is_exploratory {
        if contains_word(t, "nipples through clothing") {
            out.push("№28: через-заявка на R+ — это X-канал по определению (hard в rating-recipe; EXP-слот обязан флаг ⚗)".into());
        }
        if contains_word(t, "wet clothes") && contains_word(t, "see-through") && !contains_word(t, "swimsuit") {
            out.push("№28: мокрое+сквозное на тканевом верхе = X-комбо (P12/P25/P26 T4-31); купальник — исключение (P21)".into());
        }
    }
    const UPPER_ITEMS: &[&str] = &[
        "blouse", "tee", "shirt", "knit top", "cardigan", "jacket", "coat", "parka", "robe",
        "vest", "corset", "sweater", "kimono", "crop top", "halter",
    ];
    let upper_hits = UPPER_ITEMS.iter().filter(|u| contains_word(t, u)).count();
    if upper_hits >= 3 {
        out.push(format!(
            "§7-бис: {} верхних предметов в тег-ране — рендерер соберёт скромную комбинацию (RENDER LAW 3+ слоёв)",
            upper_hits
        ));
    }
    const PROP_WORDS: &[&str] = &["measuring tape", "ribbon", "harness", "bell", "collar tag", "ribbon choker"];
    const CONTACT_VERBS: &[&str] = &["wraps", "measures", "holds", "threads", "winds", "clips", "ties", "loop"];
    for p in PROP_WORDS {
        if t.contains(p) && !CONTACT_VERBS.iter().any(|v| t.contains(v)) {
            out.push(format!(
                "P03-правило: реквизит «{}» без контакт-глагола (wraps/measures/holds…) — читается ошибкой, не темой (мерная лента T4-31)",
                p
            ));
        }
    }
    out
}

/// 3-бис. dresser (gates.ts:960, warn) — когерентность дресс-кода: №28-риски
/// на R+ (квитанцией; hard живёт в rating-recipe) + conflicts/слои/P03.
pub fn gate_dresser(batch: &TextBatch) -> Receipt {
    let spec = load_dresser();
    let mut f: Vec<String> = Vec::new();
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier.is_empty() {
            continue;
        }
        let tag_run = tag_block_of(&s.pos);
        let is_expl = s.header.contains('⚗');
        if tier == "R+" && !is_expl {
            let swim = word_any(&tag_run, &["swimsuit", "bikini", "rash guard"]);
            if contains_word(&tag_run, "see-through") {
                f.push(format!(
                    "P{}: №28-риск: «see-through» на R+ — тег рисует просвет (P09: даже тёмный knit — X; P30 выжил лишь с «dark garment» и опозданием тега) — лучше опустить, бугорки живут без него",
                    s.position
                ));
            }
            if contains_word(&tag_run, "wet clothes") && !swim {
                f.push(format!(
                    "P{}: №28-риск: «wet clothes» на тканевом верхе R+ — влага тянит в X (№27: тон не щит); DRY-формула P30 — «sweat glisting»; мокрый купальник — исключение (P21-золото)",
                    s.position
                ));
            }
        }
        let tier28 = if tier == "R+" || tier == "X" { tier } else { "R" };
        for r in check_coherence(&spec, &tag_run, tier28, is_expl) {
            f.push(format!("P{}: {}", s.position, r));
        }
    }
    warn_receipt("dresser", f)
}

/* ================================================================== */
/* 4. canon (hard, OC-канон)                                            */
/* ================================================================== */

/// Левейший \bимя\b в тексте (JS-альтернация матчит левую позицию; два
/// имени не начинаются с одной позиции — порядок ключей роли не играет).
fn leftmost_oc_name<'a>(hay: &str, names: &'a [(String, String, String)]) -> Option<&'a str> {
    let hc: Vec<char> = hay.chars().collect();
    let mut best: Option<(usize, usize)> = None; // (позиция, индекс имени)
    for (idx, (name, _, _)) in names.iter().enumerate() {
        let nc: Vec<char> = name.chars().collect();
        if nc.is_empty() || hc.len() < nc.len() {
            continue;
        }
        let mut from = 0usize;
        while from + nc.len() <= hc.len() {
            if hc[from..from + nc.len()] == nc[..] {
                let before = from == 0 || !ascii_word(hc[from - 1]);
                let e = from + nc.len();
                let after = e >= hc.len() || !ascii_word(hc[e]);
                if before && after && best.map(|(p, _)| from < p).unwrap_or(true) {
                    best = Some((from, idx));
                }
            }
            from += 1;
        }
    }
    best.map(|(_, idx)| names[idx].0.as_str())
}

/// 4. canon (gates.ts:997, hard) — OC-канон: имена ОС в POS запрещены
/// (триггеры чужих персонажей, T4-04); слоты 1-3 обязаны опознать ОС и
/// нести канон-локи волос/глаз (ростер — specs/oc-canon.json, не regex).
pub fn gate_canon(batch: &TextBatch) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    let oc = load_oc_canon();
    let empty: Vec<(String, String, String)> = Vec::new();
    let names: &[(String, String, String)] =
        oc.as_ref().map(|c| c.hair_eyes.as_slice()).unwrap_or(&empty);
    for s in &batch.slots {
        for (name, _, _) in names {
            if contains_word(&s.pos, name) {
                f.push(format!(
                    "P{}: имя ОС «{}» в POS — триггер чужих персонажей у рендерера (приказ автора, T4-04); опиши её дескрипторами, имя живёт в шапке/Canon",
                    s.position, name
                ));
                break;
            }
        }
    }
    if !names.is_empty() {
        for s in batch.slots.iter().filter(|s| s.position <= 3) {
            let hay = format!("{} {}", s.header, s.canon);
            let Some(name) = leftmost_oc_name(&hay, names) else {
                f.push(format!("P{}: OC не опознан в шапке", s.position));
                continue;
            };
            let Some((_, hair, eyes)) = names.iter().find(|(n, _, _)| n == name) else {
                continue;
            };
            const STOP_HAIR: &[&str] = &["hair", "with", "held", "long", "into"];
            const STOP_EYES: &[&str] = &["eyes", "with", "held"];
            let hair_words: Vec<String> = ascii_letter_runs(hair)
                .into_iter()
                .filter(|w| w.chars().count() > 3 && !STOP_HAIR.contains(&w.to_lowercase().as_str()))
                .collect();
            let eye_words: Vec<String> = ascii_letter_runs(eyes)
                .into_iter()
                .filter(|w| w.chars().count() > 3 && !STOP_EYES.contains(&w.to_lowercase().as_str()))
                .collect();
            let canon_hay = format!("{} {}", s.canon, s.pos).to_lowercase();
            if !hair_words.iter().any(|w| canon_hay.contains(&w.to_lowercase())) {
                f.push(format!("P{} ({}): канон-лок волос не виден", s.position, name));
            }
            if !eye_words.iter().any(|w| canon_hay.contains(&w.to_lowercase())) {
                f.push(format!("P{} ({}): канон-лок глаз не виден", s.position, name));
            }
        }
    }
    Receipt {
        gate: "canon",
        level: "hard",
        verdict: if f.is_empty() { "PASS" } else { "FAIL" },
        findings: f,
        notes: Vec::new(),
    }
}

/* ================================================================== */
/* 5. diversity (hard)                                                  */
/* ================================================================== */

/// 5. diversity (gates.ts:1057, hard) — лексическое разнообразие: core-4
/// стеки (4 класса / 4 механо-группы / sheer ≤2 на слот), моно-носитель
/// N28 ≤4 слотов, W-класс ≤45%, sheer-кадры ≤40% R+ слотов, уникальность
/// поз/палитр (EXP-пары одной переменной — исключение §10).
pub fn gate_diversity(batch: &TextBatch, carriers: Option<&CarriersLite>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    let mech_of = |cls: &str| -> String {
        carriers
            .and_then(|c| c.class_mech.get(cls))
            .cloned()
            .unwrap_or_default()
    };
    let is_sheer = |id: &str| carriers.map(|c| c.sheer_ids.contains(id)).unwrap_or(false);
    let mut all_stacked: Vec<String> = Vec::new();
    let mut sheer_frames: usize = 0;
    let mut rplus_count: usize = 0;
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier == "R+" || tier == "X" {
            rplus_count += 1;
            let mut groups: Vec<String> = Vec::new();
            let mut classes: Vec<String> = Vec::new();
            for id in &s.stack {
                push_uniq(&mut groups, mech_of(&cls_of(id)));
                push_uniq(&mut classes, cls_of(id));
            }
            if s.stack.len() < 4 {
                f.push(format!("P{}: стек {}/4 носителей (core-4)", s.position, s.stack.len()));
            }
            if groups.len() < 4 {
                let joined = groups.join(",");
                f.push(format!(
                    "P{}: механо-групп {}/4 ({})",
                    s.position,
                    groups.len(),
                    if joined.is_empty() { "пусто".into() } else { joined }
                ));
            }
            if classes.len() < 4 {
                f.push(format!("P{}: классов {}/4", s.position, classes.len()));
            }
            let sheer_ids: Vec<&String> = s.stack.iter().filter(|id| is_sheer(id)).collect();
            if sheer_ids.len() > 2 {
                f.push(format!("P{}: sheer-носителей {} > 2", s.position, sheer_ids.len()));
            }
            if !sheer_ids.is_empty() {
                sheer_frames += 1;
            }
        }
        all_stacked.extend(s.stack.iter().cloned());
    }
    // моно-носитель N28: один ID ≤4 слотов (порядок = первое появление)
    let mut per_carrier: Vec<(String, usize)> = Vec::new();
    for s in &batch.slots {
        for id in &s.stack {
            match per_carrier.iter_mut().find(|(k, _)| k == id) {
                Some((_, n)) => *n += 1,
                None => per_carrier.push((id.clone(), 1)),
            }
        }
    }
    for (id, n) in &per_carrier {
        if *n > 4 {
            f.push(format!("моно-носитель {id} в {n} слотах > 4 — моно-механизм N28"));
        }
    }
    let w_count = all_stacked.iter().filter(|id| cls_of(id) == "W").count();
    let w_share = if all_stacked.is_empty() {
        0i64
    } else {
        ((w_count as f64 / all_stacked.len() as f64) * 100.0).round() as i64
    };
    if w_share > 45 {
        f.push(format!("W-класс {w_share}% > 45% (моно-механизм)"));
    }
    if rplus_count > 0 {
        let sheer_pct = ((sheer_frames as f64 / rplus_count as f64) * 100.0).round() as i64;
        if sheer_pct > 40 {
            f.push(format!("sheer-кадры {sheer_pct}% > 40% R+ слотов (N28-ловушка)"));
        }
    }
    // уникальность поз/палитр: EXP-пары §10 — единственное исключение
    fn dup_ids(batch: &TextBatch, extract: fn(&TextSlot) -> String) -> Vec<String> {
        let mut counts: Vec<(String, usize, usize)> = Vec::new(); // (id, n, exp)
        for s in &batch.slots {
            let id = extract(s);
            if id.is_empty() {
                continue;
            }
            let is_exp = s.header.contains("(EXP ·");
            match counts.iter_mut().find(|(k, _, _)| k == &id) {
                Some((_, n, exp)) => {
                    *n += 1;
                    if is_exp {
                        *exp += 1;
                    }
                }
                None => counts.push((id, 1, if is_exp { 1 } else { 0 })),
            }
        }
        counts
            .iter()
            .filter(|(_, n, exp)| *n > 1 && exp != n)
            .map(|(id, _, _)| id.clone())
            .collect()
    }
    let pose_ids: Vec<String> = batch
        .slots
        .iter()
        .map(|s| header_pose_token(&s.header))
        .filter(|x| !x.is_empty())
        .collect();
    let pose_dups = dup_ids(batch, |s| header_pose_token(&s.header));
    if !pose_dups.is_empty() {
        f.push(format!(
            "позы не уникальны в батче: {} (EXP-пары одной переменной — исключение §10)",
            pose_dups.join(", ")
        ));
    }
    let pal_ids: Vec<String> = batch
        .slots
        .iter()
        .map(|s| header_palette_token(&s.header))
        .filter(|x| !x.is_empty())
        .collect();
    if pose_ids.len() == batch.slots.len() && pal_ids.len() != batch.slots.len() {
        f.push(format!("слотов с палитрой в шапке: {}/{}", pal_ids.len(), batch.slots.len()));
    }
    let pal_dups = dup_ids(batch, |s| header_palette_token(&s.header));
    if pal_ids.len() >= batch.slots.len() && !pal_dups.is_empty() {
        f.push(format!(
            "палитры не уникальны в батче: {} (EXP-пары — исключение §10)",
            pal_dups.join(", ")
        ));
    }
    Receipt {
        gate: "diversity",
        level: "hard",
        verdict: if f.is_empty() { "PASS" } else { "FAIL" },
        findings: f,
        notes: Vec::new(),
    }
}

/* ================================================================== */
/* 8b. niche-legibility (warn, вердикт T4-02)                           */
/* ================================================================== */

/// 8b. niche-legibility (gates.ts:1239, warn) — ниша обязана быть видна:
/// теги расы в POS (≥2) + свидетель в кадре; NICHE-структура мейнов.
pub fn gate_niche_legibility(
    batch: &TextBatch,
    contract: Option<&Contract>,
    races: Option<&RacesLite>,
) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    const WITNESS_WORDS: &[&str] = &[
        "mirror", "shop glass", "security monitor", "door gap", "propped phone",
        "traffic mirror", "level gauge", "window pane", "wet street", "elevator brass",
        "photo frame", "spoon", "watch face", "car hood", "fountain edge", "witness",
    ];
    let niche_slots: Vec<&TextSlot> = batch.slots.iter().filter(|s| s.genre == "NICHE").collect();
    for s in &niche_slots {
        let pos_lower = s.pos.to_lowercase();
        let race_name = contract
            .and_then(|c| c.slots.iter().find(|cs| cs.position == s.position))
            .and_then(|cs| cs.race.clone())
            .unwrap_or_default();
        if !race_name.is_empty() {
            let core = race_name.to_lowercase();
            let race_entry = races.and_then(|r| {
                r.races.iter().find(|(name, _)| {
                    let rn = name.to_lowercase();
                    let rp = rn.split(" (").next().unwrap_or("").to_string();
                    let np = core.split(" (").next().unwrap_or("").to_string();
                    core.contains(&rp) || rn.contains(&np)
                })
            });
            // токены: имя расы + фичи; [()-] → ' ', слова >3, без girl/kin/with
            let mut tokens: Vec<String> = Vec::new();
            let mut feed = String::new();
            feed.push_str(&race_name.to_lowercase().replace(['(', ')', '-'], " "));
            feed.push(' ');
            if let Some((_, features)) = race_entry {
                feed.push_str(&features.join(" ").to_lowercase().replace(['(', ')', '-'], " "));
            }
            for w in feed.split_whitespace() {
                if w.chars().count() > 3 && !["girl", "kin", "with"].contains(&w) {
                    push_uniq(&mut tokens, w.to_string());
                }
            }
            let hits = tokens.iter().filter(|t| pos_lower.contains(t.as_str())).count();
            if hits < 2 {
                f.push(format!(
                    "P{}: NICHE-раса «{}» не читается в POS (тегов расы {}/2) — раса делает физическую работу в кадре",
                    s.position, race_name, hits
                ));
            }
        }
        let witness_hit = WITNESS_WORDS.iter().any(|w| pos_lower.contains(w));
        if !witness_hit && !race_name.is_empty() {
            f.push(format!(
                "P{}: NICHE без свидетеля в кадре (mirror/glass/monitor/phone/gauge…) — свидетель держит невозможное",
                s.position
            ));
        }
    }
    let themed_mains = batch
        .slots
        .iter()
        .filter(|s| s.genre != "OC" && s.genre != "EXP")
        .count();
    if niche_slots.is_empty() && themed_mains == crate::canon::Slots::MAINS_TOTAL as usize {
        f.push("NICHE-слотов нет — жанровая структура батча сломана".into());
    }
    warn_receipt("niche-legibility", f)
}

/* ================================================================== */
/* 8d. claim-visibility (warn, вердикт T4-03)                          */
/* ================================================================== */

/// GARMENT_NOUNS (gates.ts:1342) — Set-порядок вставки (дубли happi/jersey
/// остаются на первом месте).
const CLAIM_VIS_GARMENTS: &[&str] = &[
    "shirt", "tee", "t-shirt", "tank", "camisole", "blouse", "sweater", "pullover", "hoodie",
    "jacket", "coat", "blazer", "cardigan", "happi", "tunic", "turtleneck", "button-down",
    "flannel", "jersey", "varsity", "parka", "poncho", "robe", "overalls", "leotard",
    "bodysuit", "swimsuit", "bikini", "microbikini", "bra", "panties", "thong", "boyshorts",
    "lingerie", "garter belt", "stockings", "thighhighs", "socks", "jeans", "pants", "trousers",
    "breeches", "shorts", "skirt", "dress", "apron", "towel", "nightgown", "slip", "corset",
    "harness", "wrap", "sarong", "sash", "obi", "bolero", "kimono", "leggings", "fishnets",
    "uniform", "cloak", "cape",
];

/// 8d. claim-visibility (gates.ts:1320, warn) — зона сигнала открыта камере:
/// нижняя/грудная заявка не закрыта верхом, ≤4 предметов в тег-блоке,
/// стопка верхних слоёв <3, OC-слоты не уходят позой, состояние ткани
/// рано в тег-ране (позиция тега — warn, эвиденс неоднозначен).
pub fn gate_claim_visibility(batch: &TextBatch) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    const LOWER_COVERS: &[&str] = &[
        "skirt", "dress", "cloak", "cape", "coat", "apron", "happi", "tied at waist",
        "tied at the waist", "shirt tied", "towel around waist", "waist wrap", "sarong",
        "long shirt", "untucked shirt", "peplum",
    ];
    const CHEST_COVERS: &[&str] = &[
        "buttoned shirt", "buttoned-up", "buttoned up", "zipped up", "zipped to",
        "closed jacket", "buttoned jacket", "turtleneck", "high-neck", "closed coat",
    ];
    const TOP_LAYERS: &[&str] = &[
        "shirt", "tee", "t-shirt", "tank", "camisole", "blouse", "sweater", "pullover",
        "hoodie", "jacket", "coat", "blazer", "cardigan", "happi", "tunic", "turtleneck",
        "button-down", "flannel", "jersey", "varsity", "parka", "poncho", "robe", "overalls",
    ];
    const POSE_AWAY: &[&str] = &[
        "forward fold", "prone", "facedown", "face down", "from behind", "back to camera",
        "back turned", "bent away",
    ];
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier != "R+" && tier != "X" {
            continue;
        }
        let tag_block = tag_block_of(&s.pos);
        let pos_lower = s.pos.to_lowercase();
        let cover_in = |list: &[&'static str]| -> Option<&'static str> {
            list.iter().find(|c| contains_word(&tag_block, **c)).copied()
        };
        // 1) нижняя зона закрыта верхним предметом
        let lower_claim = ["cameltoe", "camel toe", "visible pantyline", "pantyline"]
            .iter()
            .any(|c| tag_block.contains(c));
        if lower_claim {
            if let Some(cover) = cover_in(LOWER_COVERS) {
                f.push(format!(
                    "P{}: зона сигнала (низ) закрыта «{}» — cameltoe/pantyline не виден камере; открой зону или перевези claim (вердикт T4-03)",
                    s.position, cover
                ));
            }
        }
        // 2) грудная on-skin зона закрыта застёгнутым верхом
        let chest_claim = ["taped nipples", "topless with tape", "handbra"]
            .iter()
            .any(|c| tag_block.contains(c));
        if chest_claim {
            if let Some(cover) = cover_in(CHEST_COVERS) {
                f.push(format!(
                    "P{}: зона сигнала (грудь) закрыта «{}» — tape/handbra не виден камере (вердикт T4-03)",
                    s.position, cover
                ));
            }
        }
        // 3) слоевой хаос: ≥5 предметов одежды в тег-блоке
        let garments: Vec<&'static str> =
            CLAIM_VIS_GARMENTS.iter().filter(|g| contains_word(&tag_block, g)).copied().collect();
        if garments.len() >= 5 {
            f.push(format!(
                "P{}: {} предметов одежды в тег-блоке ({}) — ≤2 слоя на зону, зона сигнала ≤1 (вердикт T4-03: слои путают рендер)",
                s.position,
                garments.len(),
                garments.iter().take(5).copied().collect::<Vec<_>>().join(", ")
            ));
        }
        // 3b) стопка верхних слоёв: ≥3 верхних предметов
        let tops: Vec<&'static str> =
            TOP_LAYERS.iter().filter(|g| contains_word(&tag_block, g)).copied().collect();
        if tops.len() >= 3 {
            f.push(format!(
                "P{}: стопка верхних слоёв {} ({}) — «майка поверх рубашки» ломает порядок слоёв (вердикт T4-03)",
                s.position,
                tops.len(),
                tops.join(", ")
            ));
        }
        // 4) OC-слот позой уходит от камеры
        if s.genre == "OC" {
            let away = POSE_AWAY.iter().find(|p| tag_block.contains(*p) || pos_lower.contains(*p));
            if let Some(away) = away {
                f.push(format!(
                    "P{}: OC-слот с позой «{}» — зона сигнала уходит от камеры; OC = любимые персонажи автора, камера-смотрящие позы (вердикт T4-03)",
                    s.position, away
                ));
            }
        }
        // 5) позиция состояния в тег-ране (ранние весят больше; OC — люфт)
        if tier == "R+" {
            let pos_tags: Vec<&str> = tag_block.split(',').map(|t| t.trim()).collect();
            let find_idx = |needle: &str| pos_tags.iter().position(|t| t.contains(needle));
            let idxs: Vec<usize> = [find_idx("wet clothes"), find_idx("see-through")]
                .into_iter()
                .flatten()
                .collect();
            let wet_idx = idxs.iter().min().copied();
            let limit = if s.genre == "OC" { 22 } else { 16 }; // 0-based
            if let Some(idx) = wet_idx {
                if idx >= limit {
                    f.push(format!(
                        "P{}: состояние ткани стоит тегом №{} — хвост тег-рана рендерер читает слабо; подними wet clothes / see-through к началу (рендер-вердикт T4-03)",
                        s.position,
                        idx + 1
                    ));
                }
            }
        }
    }
    warn_receipt("claim-visibility", f)
}

/* ================================================================== */
/* 8e. technique-layers (warn, таблица автора)                          */
/* ================================================================== */

/// 8e. technique-layers (gates.ts:1430, warn) — закон суммы факторов
/// (блок 8): R+ = 3+ сигнала через 2+ слоя; ловушки X-●, супрессоры,
/// мокрое+сквозное = осознанный X-риск; X Cut hold — низ закрыт/в кадре.
pub fn gate_technique_layers(batch: &TextBatch, tech: Option<&Techniques>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    let Some(tech) = tech else {
        return warn_receipt("technique-layers", f);
    };
    let mut wet_sheer_slots: Vec<String> = Vec::new();
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier != "R+" && tier != "X" {
            continue;
        }
        let tb = tech_tag_block(&s.pos);
        let hits: Vec<TechEntry> = dedupe_subsumed(
            &tech
                .techniques
                .iter()
                .filter(|e| tech_hit(&tb, &e.match_alts))
                .cloned()
                .collect::<Vec<_>>(),
        );
        let ladder: Vec<&TechEntry> = hits.iter().filter(|e| is_ladder_signal(e)).collect();
        let mut layers_hit: Vec<i64> = Vec::new();
        for e in &ladder {
            push_uniq(&mut layers_hit, e.layer);
        }
        layers_hit.sort();
        if tier == "R+" {
            // (1) сумма факторов — R+ зарабатывается суммой, не одним слоем
            let (signals_min, layers_min) = tech.rplus_floor;
            if (ladder.len() as i64) < signals_min || (layers_hit.len() as i64) < layers_min {
                let map = ladder
                    .iter()
                    .map(|e| e.tag.split(',').next().unwrap_or("").to_string())
                    .take(6)
                    .collect::<Vec<_>>()
                    .join(", ");
                let layers_str = if !layers_hit.is_empty() {
                    format!("({})", layers_hit.iter().map(|l| layer_name(*l)).collect::<Vec<_>>().join("+"))
                } else {
                    String::new()
                };
                f.push(format!(
                    "P{}: сумма факторов не набрана — {} сигнал(а) через {} слой(я) {}· блок 8: R+ = {}+ сигнала через {}+ слоя — это R/R+ граница, не R+ сумма; карта кадра: {}",
                    s.position,
                    ladder.len(),
                    layers_hit.len(),
                    layers_str,
                    signals_min,
                    layers_min,
                    if map.is_empty() { "—".into() } else { map }
                ));
            }
            // (2) ловушки: X-● теги — модель часто решает за тебя
            for e in &hits {
                if e.trap {
                    f.push(format!(
                        "P{}: ловушка «{}» — {} (X-риск известен до рендера)",
                        s.position, e.tag, e.note
                    ));
                }
            }
            // (3) супрессоры: держат кадр в PG-13/R
            for e in &hits {
                if e.suppressor {
                    f.push(format!(
                        "P{}: супрессор «{}» — держит кадр ниже заявленного, снимай или компенсируй (блок 4/7)",
                        s.position, e.tag
                    ));
                }
            }
            // (4) мокрое + сквозное — осознанный X-риск (батч-уровень ниже)
            let wet = word_any(&tb, &["wet clothes", "steam", "shower", "rain", "sweat"]);
            if wet && contains_word(&tb, "see-through") {
                wet_sheer_slots.push(format!("P{}", s.position));
            }
        }
        if tier == "X" {
            // (5) X Cut hold: кадрирование или закрытый низ (блок 9)
            let framing = tech
                .xcut_framing
                .as_ref()
                .map(|list| list.iter().any(|t| tech_hit(&tb, &[vec![t.clone()]])))
                .unwrap_or(false);
            let covered = tech
                .xcut_lower_cover
                .as_ref()
                .map(|list| list.iter().any(|t| tech_hit(&tb, &[vec![t.clone()]])))
                .unwrap_or(false);
            if !framing && !covered {
                let lower = tech
                    .xcut_lower_cover
                    .clone()
                    .unwrap_or_else(|| vec!["skirt".into(), "shorts".into()]);
                let framing_list = tech
                    .xcut_framing
                    .clone()
                    .unwrap_or_else(|| vec!["upper body".into(), "portrait".into()]);
                f.push(format!(
                    "P{}: X Cut hold (блок 9) — низ тела ни закрыт ({}…), ни выведен из кадра ({}) — модель может «дорисовать» ниже",
                    s.position,
                    lower.iter().take(5).cloned().collect::<Vec<_>>().join("/"),
                    framing_list.join("/")
                ));
            }
        }
    }
    if !wet_sheer_slots.is_empty() {
        f.push(format!(
            "осознанный X-риск (блок 8, строка 5): {} R+ слотов несут мокрое+сквозное ({}) — очень высокий риск нечаянного X при рендере; это рабочий механизм рецепта v1.2.0, автор фильтрует перекидкой",
            wet_sheer_slots.len(),
            wet_sheer_slots.join(", ")
        ));
    }
    warn_receipt("technique-layers", f)
}

/* ================================================================== */
/* 9. simcheck (warn, Jaccard)                                         */
/* ================================================================== */

/// 9. simcheck (gates.ts:1746, warn) — дословные близнецы: внутри-батчевые
/// (J>0.75) и против окна ротации (J>0.7); себя, rebuildOf-источник и
/// перестройки себя окно не судит; бойлерплейт — не предложение автора.
pub fn gate_simcheck(batch: &TextBatch, contract: Option<&Contract>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    let mut mine_sentences: Vec<String> = Vec::new(); // Set-семантика, порядок вставки
    let mut mine_pairs: Vec<(u32, String)> = Vec::new(); // (slot, text) — полный список
    for s in &batch.slots {
        for text in simcheck_sentences(&s.pos) {
            mine_pairs.push((s.position, text.clone()));
            push_uniq(&mut mine_sentences, text);
        }
    }
    // внутри-батчевый сход (вердикт-диагноз 2026-09-24: T4-07 P01/P02)
    let mut intra: Vec<String> = Vec::new();
    for i in 0..mine_pairs.len() {
        for j in i + 1..mine_pairs.len() {
            let jj = jaccard(&jaccard_words(&mine_pairs[i].1), &jaccard_words(&mine_pairs[j].1));
            if jj > 0.75 {
                intra.push(format!(
                    "P{}≈P{}: «{}…» (J={})",
                    mine_pairs[i].0,
                    mine_pairs[j].0,
                    mine_pairs[i].1.chars().take(60).collect::<String>(),
                    js_tofix2(jj)
                ));
            }
        }
    }
    if !intra.is_empty() {
        let head: Vec<String> = intra.iter().take(4).cloned().collect();
        let tail = if intra.len() > 4 {
            format!(" — и ещё {}", intra.len() - 4)
        } else {
            String::new()
        };
        f.push(format!("внутри-батчевые близнецы: {}{}", head.join(" · "), tail));
    }
    // окно ротации: повторная сдача себя не судит; rebuildOf — по дизайну
    let state = fold_file_era();
    let rebuild_of = contract.and_then(|c| c.rebuild_of.clone());
    for w in window_others(&batch.slug, &historical_window(&batch.slug, &state), rebuild_of.as_deref()) {
        let Some(w_text) = read_text(&super::batches_dir().join(format!("{}.md", w))) else {
            continue;
        };
        let w_batch = super::parse_batch(&w, &w_text);
        let theirs: Vec<String> = w_batch
            .slots
            .iter()
            .flat_map(|s| simcheck_sentences(&s.pos))
            .collect();
        for mine_s in &mine_sentences {
            let mine_words = jaccard_words(mine_s);
            for theirs_s in &theirs {
                let j = jaccard(&mine_words, &jaccard_words(theirs_s));
                if j > 0.7 {
                    f.push(format!(
                        "похоже на {}: «{}…» (J={})",
                        w,
                        mine_s.chars().take(60).collect::<String>(),
                        js_tofix2(j)
                    ));
                }
            }
        }
    }
    if f.len() > 8 {
        let rest = f.len() - 8;
        f.truncate(8);
        f.push(format!("…и ещё {rest} пар"));
    }
    warn_receipt("simcheck", f)
}

/* ================================================================== */
/* 12. technique-map (advisory, карта слоёв)                            */
/* ================================================================== */

/// 12. technique-map (gates.ts:1846, advisory) — прозрачность для автора:
/// сколько сигналов и через какие слои набрано в каждом R+/X кадре.
pub fn gate_technique_map(batch: &TextBatch, tech: Option<&Techniques>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    let Some(tech) = tech else {
        f.push("техника-карта не загружена (specs/rating-techniques.json)".into());
        return advisory_receipt("technique-map", f);
    };
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier != "R+" && tier != "X" {
            continue;
        }
        let tb = tech_tag_block(&s.pos);
        let hits = dedupe_subsumed(
            &tech
                .techniques
                .iter()
                .filter(|e| tech_hit(&tb, &e.match_alts))
                .cloned()
                .collect::<Vec<_>>(),
        );
        let ladder: Vec<&TechEntry> = hits.iter().filter(|e| is_ladder_signal(e)).collect();
        let mut layers_hit: Vec<i64> = Vec::new();
        for e in &ladder {
            push_uniq(&mut layers_hit, e.layer);
        }
        layers_hit.sort();
        let layers_str = if layers_hit.is_empty() {
            "—".to_string()
        } else {
            layers_hit
                .iter()
                .map(|l| format!("{}·{}", l, layer_name(*l)))
                .collect::<Vec<_>>()
                .join(" + ")
        };
        let map = ladder
            .iter()
            .map(|e| e.tag.split(',').next().unwrap_or("").to_string())
            .take(8)
            .collect::<Vec<_>>()
            .join(", ");
        f.push(format!(
            "P{:02} {}: {} сигнал(ов) · слои {} · {}",
            s.position,
            tier,
            ladder.len(),
            layers_str,
            if map.is_empty() { "—".into() } else { map }
        ));
    }
    if f.is_empty() {
        f.push("R+/X слотов в батче нет".into());
    }
    advisory_receipt("technique-map", f)
}

/* ================================================================== */
/* 12b. salience-chain (warn, §9-секста + §9-септима)                   */
/* ================================================================== */

/// 12b. salience-chain v2 (gates.ts:1873, warn) — ЗАКОН САЛИЕНСА: девять
/// звеньев OBJECT → EXPOSURE → CAMERA → CONTRAST → SALIENCE →
/// INTERPRETATION → BLOCKER → LEGIBILITY → POSE-RISK; ≥2 порванных —
/// тир под угрозой (U7: салиенс = прогноз доставки, подтверждён T4-11).
pub fn gate_salience_chain(batch: &TextBatch, contract: Option<&Contract>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    const LIGHT_WORDS: &[&str] =
        &["white", "pale", "cream", "ivory", "pastel", "pink", "salt", "linen", "silver", "chalk"];
    const GLOW_WORDS: &[&str] = &[
        "glow", "spotlight", "backlit", "backlight", "rim light", "sunlit", "sunlight",
        "lit from", "flare",
    ];
    const DARK_SCENE: &[&str] = &[
        "night", "noir", "midnight", "dark", "deep indigo", "black", "dusk", "shadow",
        "ultramarine deep", "eclipse",
    ];
    const CAMERA_TAGS: &[&str] = &[
        "from below", "close-up", "closeup", "cowboy shot", "upper body", "portrait", "pov",
        "over-shoulder", "through-gap", "dutch angle", "from above", "wide shot",
        "foreshortening", "looking up", "looking down", "close on",
    ];
    const INTENT_TAGS: &[&str] = &[
        "erotic pose", "extreme fanservice", "fanservice", "seductive", "seductive smile",
        "bedroom eyes", "half-closed eyes", "half-lidded", "parted lips", "teasing",
        "suggestive", "provocative", "come hither", "sultry", "looking at viewer", "eye contact",
    ];
    const UPPER_LIGHT: &[&str] = &[
        "blouse", "tee", "t-shirt", "shirt", "knit", "cardigan", "leotard", "bodysuit",
        "swimsuit", "bikini", "romper", "slip", "dress", "sundress", "nightgown", "gown",
        "robe", "kimono", "yukata", "sheet", "towel", "halter", "tunic", "apron", "qipao",
        "cheongsam", "sweater", "gi", "nightshirt", "hoodie", "jersey", "pullover", "flannel",
        "turtleneck", "crop top", "tank top", "tube top", "wrap top", "fishnet top",
        "bodystocking", "top",
    ];
    const LOWER_LIGHT_SAL: &[&str] = &[
        "skirt", "shorts", "pants", "trousers", "leggings", "tights", "pantyhose", "sarong",
        "wrap", "boyshorts",
    ];
    const X_SIGNALS: &[&str] = &["topless", "bare breasts", "exposed breasts", "nsfw", "nude", "naked"];
    const POSE_VERBS: &[&str] = &[
        "standing", "kneel", "sitting", "leaning", "climb", "slide", "stretch", "arch",
        "bend", "turn", "twirl", "float", "stride", "spiral", "hang", "curl", "lean", "reach",
        "prone", "crouch", "drape", "sprawl", "recline", "straddl", "waltz", "handstand",
        "cartwheel", "pli", "sprint", "jump", "bounce", "balance", "extend", "lock", "draw",
        "halt",
    ];
    const LOWER_COVERS_SC: &[&str] = &[
        "skirt", "dress", "cloak", "cape", "coat", "apron", "tied at waist", "tied at the waist",
        "shirt tied", "waist wrap", "sarong", "long shirt", "peplum",
    ];
    const CHEST_COVERS_SC: &[&str] = &[
        "buttoned shirt", "buttoned-up", "buttoned up", "zipped up", "closed jacket",
        "buttoned jacket", "turtleneck", "high-neck", "closed coat",
    ];
    const BLOCKERS_SC: &[&str] = &[
        "crossed arms", "arms crossed", "crossed shawl", "shawl crossed", "scarf crossed",
        "crossed scarf", "crossed over her chest", "arms over her chest", "arms over chest",
        "shawl over her chest",
    ];
    const CLOSE_CAM: &[&str] =
        &["close-up", "closeup", "cowboy shot", "portrait", "pov", "upper body", "close on"];
    let mark = |ok: bool, unclear: bool| -> char {
        if ok {
            '✓'
        } else if unclear {
            '?'
        } else {
            '✗'
        }
    };
    let mut at_risk: usize = 0;
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier != "R+" && tier != "X" {
            continue;
        }
        let tag_block = tag_block_of(&s.pos);
        let pos_lower = s.pos.to_lowercase();
        let spine_lower = s.spine.to_lowercase();
        let tags: Vec<&str> = tag_block.split(',').map(|t| t.trim()).collect();
        let is_x = tier == "X";
        // OBJECT: именованная заявка (X: bare-state, R+: сигнал-тег + вещь)
        let upper_claim = [
            "nipples through clothing", "clothed nipples", "see-through", "taped nipples",
            "topless with tape", "handbra",
        ]
        .iter()
        .find(|c| tag_block.contains(*c));
        let lower_claim = ["visible pantyline", "pantyline"].iter().find(|c| tag_block.contains(*c));
        let x_claim = X_SIGNALS.iter().find(|c| tag_block.contains(*c));
        let garment_tag = tags.iter().find(|t| {
            UPPER_LIGHT.iter().any(|g| contains_word(t, g)) || LOWER_LIGHT_SAL.iter().any(|g| contains_word(t, g))
        });
        let garment_tag: Option<&str> = garment_tag.copied();
        let on_skin = matches!(upper_claim, Some(&"taped nipples") | Some(&"topless with tape") | Some(&"handbra"));
        let obj_ok = if is_x {
            x_claim.is_some()
        } else {
            (upper_claim.is_some() || lower_claim.is_some()) && (on_skin || garment_tag.is_some())
        };
        // EXPOSURE: зона заявки открыта камере
        let cover_lower = if lower_claim.is_some() {
            LOWER_COVERS_SC.iter().find(|c| tag_block.contains(**c))
        } else {
            None
        };
        let cover_chest = if on_skin { CHEST_COVERS_SC.iter().find(|c| tag_block.contains(**c)) } else { None };
        let exp_ok = cover_lower.is_none() && cover_chest.is_none();
        let exp_unclear = if !exp_ok {
            false
        } else if garment_tag.is_some() {
            tags.iter()
                .filter(|t| sub_any(t, &["shirt", "cardigan", "jacket", "robe", "kimono"]))
                .count()
                >= 2
        } else {
            false
        };
        // CAMERA: камера-участник (тег, поза в тегах или спайне)
        let cam_tag = CAMERA_TAGS.iter().find(|c| tag_block.contains(**c));
        let cam_ok = cam_tag.is_some() || sub_any(&tag_block, POSE_VERBS) || sub_any(&spine_lower, POSE_VERBS);
        // CONTRAST: свет НА зоне заявки (закон №21)
        let garment_light = garment_tag.map(|g| LIGHT_WORDS.iter().any(|w| g.contains(*w))).unwrap_or(false);
        let scene_glow = GLOW_WORDS.iter().any(|w| tag_block.contains(*w));
        let dark_scene = DARK_SCENE.iter().any(|w| tag_block.contains(*w));
        let body_word = |t: &str| sub_any(t, &["hair", "skin", "eyes", "stocking", "sock", "thighhigh", "pantyhose", "scales", "ears", "tail", "horn", "freckle", "cheek"]);
        let bg_light_count = tags
            .iter()
            .filter(|t| {
                Some(**t) != garment_tag && !body_word(t) && LIGHT_WORDS.iter().any(|w| t.contains(*w))
            })
            .count();
        let wet = tag_block.contains("wet clothes");
        let (con_ok, con_unclear, con_why) = if wet && dark_scene && !garment_light && !scene_glow {
            (false, false, "мокрая тёмная ткань без света — пятно-риск")
        } else if garment_light && bg_light_count >= 2 {
            (false, false, "светлое на светлом — слияние с фоном")
        } else if garment_light || scene_glow || is_x {
            (true, false, "")
        } else {
            (false, true, "нет ни светлой вещи, ни света на зоне")
        };
        // SALIENCE: заявка стоит рано в тег-ране
        let limit = if is_x { 20 } else if s.genre == "OC" { 22 } else { 16 };
        let mut claim_idx: Option<usize> = None;
        for c in [upper_claim.copied(), lower_claim.copied(), x_claim.copied(), Some("wet clothes"), Some("see-through")]
            .into_iter()
            .flatten()
        {
            if !tag_block.contains(c) {
                continue;
            }
            if let Some(i) = tags.iter().position(|t| t.contains(c)) {
                claim_idx = Some(claim_idx.map_or(i, |prev: usize| prev.min(i)));
            }
        }
        let claim_idx = claim_idx.unwrap_or(99);
        let sal_ok = claim_idx < limit;
        // INTERPRETATION: подача (X: bare state = заявление)
        let intent = INTENT_TAGS.iter().find(|c| tag_block.contains(**c) || pos_lower.contains(**c));
        let int_ok = if is_x { x_claim.is_some() } else { intent.is_some() };
        // BLOCKER (§9-септима, звено 7): в кадре нет запертой двери
        let blocker_hit = BLOCKERS_SC.iter().find(|c| pos_lower.contains(**c));
        let blk_ok = blocker_hit.is_none();
        // LEGIBILITY (звено 8): различимость на дистанции кадра
        let close_cam = CLOSE_CAM.iter().find(|c| tag_block.contains(**c));
        let leg_ok = close_cam.is_some() || (con_ok && (garment_light || scene_glow));
        // POSE-RISK (звено 9): HIGH-поза × R+/X = амплификатор мутаций
        let pose_risk = contract
            .and_then(|c| c.slots.iter().find(|cs| cs.position == s.position))
            .map(|cs| cs.pose_risk.clone())
            .unwrap_or_default();
        let pr_ok = pose_risk != "HIGH";
        let broken = [obj_ok, exp_ok, cam_ok, con_ok, sal_ok, int_ok, blk_ok, leg_ok, pr_ok]
            .iter()
            .filter(|x| !**x)
            .count();
        if broken >= 2 {
            at_risk += 1;
        }
        let obj_extra = if obj_ok && garment_tag.is_some() && !is_x {
            format!(" ({})", garment_tag.unwrap().split(' ').next_back().unwrap_or(""))
        } else if obj_ok && is_x && x_claim.is_some() {
            format!(" ({})", x_claim.unwrap())
        } else {
            String::new()
        };
        let exp_extra = if !exp_ok && (cover_lower.is_some() || cover_chest.is_some()) {
            format!(
                " (закрыта «{}»)",
                cover_lower.or(cover_chest).copied().unwrap_or("")
            )
        } else {
            String::new()
        };
        let cam_extra = match cam_tag {
            Some(t) => format!(" ({t})"),
            None => " (поза)".to_string(),
        };
        let con_extra = if !con_ok { format!(" — {con_why}") } else { String::new() };
        let sal_extra = if claim_idx == 99 {
            " (нет заявки)".to_string()
        } else {
            format!(" (№{})", claim_idx + 1)
        };
        let int_extra = if intent.is_some() && !is_x {
            format!(" ({})", intent.unwrap())
        } else if is_x {
            " (bare state = заявление)".to_string()
        } else {
            " (без подачи)".to_string()
        };
        let blk_extra = match blocker_hit {
            Some(b) => format!(" («{b}» — the frame's one closed door, P21)"),
            None => String::new(),
        };
        let leg_extra = match close_cam {
            Some(c) => format!(" ({c})"),
            None if leg_ok => " (свет на зоне)".to_string(),
            None => " (дистанция кадра)".to_string(),
        };
        let pr_extra = if pose_risk.is_empty() { String::new() } else { format!(" ({pose_risk})") };
        let tail = if broken >= 2 {
            format!(" → {broken} звена порваны: ПРОГНОЗ — тир под угрозой")
        } else if broken == 1 {
            " → 1 звено порвано".to_string()
        } else {
            " → цепочка цела".to_string()
        };
        f.push(format!(
            "P{:02} {}: OBJECT {}{} · EXPOSURE {}{} · CAMERA {}{} · CONTRAST {}{} · SALIENCE {}{} · INTERPRETATION {}{} · BLOCKER {}{} · LEGIBILITY {}{} · POSE-RISK {}{}{}",
            s.position,
            tier,
            mark(obj_ok, false),
            obj_extra,
            mark(exp_ok, exp_unclear),
            exp_extra,
            mark(cam_ok, false),
            cam_extra,
            mark(con_ok, con_unclear),
            con_extra,
            mark(sal_ok, false),
            sal_extra,
            mark(int_ok, false),
            int_extra,
            mark(blk_ok, false),
            blk_extra,
            mark(leg_ok, false),
            leg_extra,
            mark(pr_ok, false),
            pr_extra,
            tail
        ));
    }
    if !f.is_empty() {
        f.insert(
            0,
            format!(
                "салиенс-цепочка (§9-секста + §9-септима BLOCKER/LEGIBILITY/POSE-RISK, вердикт T4-05): {} R+/X слотов, под угрозой {} (≥2 порванных звеньев — провал звена роняет тир)",
                f.len(),
                at_risk
            ),
        );
    }
    warn_receipt("salience-chain", f)
}

/* ================================================================== */
/* 13. raw-plus (hard, условный) + raw-plus-exploratory (warn, ⚗)       */
/* ================================================================== */

/// /\blight\b[^,.\n]{0,40}\bchest\b/i — «light on chest» окном до 40
/// символов без точки/запятой (ловит «light on her chest», не трогает
/// «glow falling on the garment»).
fn light_on_chest(pos: &str) -> bool {
    let chars: Vec<char> = pos.to_lowercase().chars().collect();
    let chest: Vec<char> = "chest".chars().collect();
    let light: Vec<char> = "light".chars().collect();
    let mut i = 0usize;
    while i + light.len() <= chars.len() {
        if chars[i..i + light.len()] == light[..] && (i == 0 || !ascii_word(chars[i - 1])) {
            let e = i + light.len();
            let after_b = e >= chars.len() || !ascii_word(chars[e]);
            if after_b {
                // run {0,40} из [^,.\n], затем \bchest\b
                let mut k = 0usize;
                loop {
                    if k > 40 {
                        break;
                    }
                    let cs = e + k;
                    if cs + chest.len() > chars.len() {
                        break;
                    }
                    if !ascii_word(chars[cs - 1])
                        && chars[cs..cs + chest.len()] == chest[..]
                        && (cs + chest.len() >= chars.len() || !ascii_word(chars[cs + chest.len()]))
                    {
                        return true;
                    }
                    let rc = chars[e + k];
                    if rc == ',' || rc == '.' || rc == '\n' {
                        break;
                    }
                    k += 1;
                }
            }
        }
        i += 1;
    }
    false
}

/// 13. raw-plus (gates.ts:2030, hard, УСЛОВНЫЙ: маркер RAW+ в H1 —
/// /^#\s*T4-[^\n]*RAW\+/m — или engine контракта raw-plus). Danbooru-
/// скелет №20/№23: палитра на слот (наследование по abPairs), face-блок,
/// свет-на-зоне №21, квалити/ANTI-WASH, проза-запреты, законы №25/№26/№27.
/// None = маркера нет — гейт молчит (TS не пушит квитанцию вовсе).
pub fn gate_raw_plus(
    batch: &TextBatch,
    contract: Option<&Contract>,
) -> Option<(Receipt, Option<Receipt>)> {
    let raw_plus_marker = batch.text.lines().any(|line| {
        line.strip_prefix('#')
            .map(|r| r.trim_start())
            .and_then(|r| r.strip_prefix("T4-"))
            .is_some_and(|tail| tail.contains("RAW+"))
    });
    let contract_engine = contract.and_then(|c| c.engine.clone()).unwrap_or_default();
    let raw_plus = raw_plus_marker || contract_engine.to_lowercase().contains("raw-plus");
    if !raw_plus {
        return None;
    }
    let mut f: Vec<String> = Vec::new();
    let mut expl: Vec<String> = Vec::new();
    // B-половинка наследует палитру A (спек raw-plus.inheritance)
    let mut inherits_from: HashMap<u32, u32> = HashMap::new();
    let mut palette_by_pos: HashMap<u32, String> = HashMap::new();
    if let Some(c) = contract {
        for p in &c.ab_pairs {
            inherits_from.insert(p.b, p.a);
        }
        for s in &c.slots {
            if !s.palette.is_empty() {
                palette_by_pos.insert(s.position, s.palette.clone());
            }
        }
    }
    let resolve_palette = |pos: u32, header: &str| -> String {
        let own = header_palette_token(header);
        if !own.is_empty() {
            return own;
        }
        match inherits_from.get(&pos) {
            Some(donor) => palette_by_pos.get(donor).cloned().unwrap_or_default(),
            None => String::new(),
        }
    };
    const LIGHT_RE: &[&str] = &[
        "light", "glow", "sun", "moon", "star", "neon", "spot", "backlit", "rim", "dawn",
        "dusk", "beam", "halo", "luminous", "caustic", "floodlight", "shimmer", "glare",
        "flare", "glint",
    ];
    const NEG_BAN: &[&str] = &[
        "visible pantyline", "topless", "exposed breasts", "naked", "nude", "bare breasts",
        "nsfw", "nipples through clothing", "clothed nipples", "extreme fanservice",
        "exposed genitals", "vulva", "pubic hair", "sex", "sexual act",
    ];
    const DARK_TONE: &[&str] = &[
        "black", "ink", "midnight", "charcoal", "espresso", "dark navy", "deep navy", "oxblood",
        "void", "sumi", "burgundy", "wine", "maroon", "plum", "chocolate", "cocoa", "aubergine",
        "obsidian", "onyx", "raven", "soot", "sable", "dark red", "deep red", "dark green",
        "deep green", "forest green", "dark brown", "deep brown", "dark teal", "dark purple",
        "dark violet", "dark crimson",
    ];
    const GARMENT_RE: &[&str] = &[
        "blouse", "tee", "t-shirt", "shirt", "knit", "cardigan", "leotard", "bodysuit",
        "swimsuit", "bikini", "romper", "slip", "dress", "sundress", "nightgown", "gown", "robe",
        "kimono", "yukata", "sheet", "towel", "halter", "tunic", "apron", "qipao", "cheongsam",
        "sweater", "gi", "nightshirt", "hoodie", "jersey", "pullover", "flannel", "turtleneck",
        "crop top", "tank top", "tube top", "wrap top", "fishnet top", "bodystocking", "top",
    ];
    const LIGHT_FAMILY: &[&str] = &[
        "white", "ash", "cream", "ivory", "pale", "pastel", "linen", "chalk", "silver", "grey",
        "gray", "moss", "umber", "prussian", "rose", "blush", "sand", "wheat", "oat", "pearl",
        "fog", "rain", "salt", "smoke", "slate", "dove", "butter", "peach", "coral", "salmon",
        "mint", "powder", "beige", "ecru", "champagne", "tan", "lemon", "lilac", "lavender",
    ];
    const CLAIM_27: &[&str] = &[
        "nipples through clothing", "clothed nipples", "covered nipples", "wet clothes",
        "see-through", "breast clinging",
    ];
    let mut light_carrying_tops: Vec<u32> = Vec::new();
    // закон №26: тайтл темы не в POS; ТЕМА-СЛОВА — санкция
    let theme_title = raw_plus_theme_title(&batch.text);
    let title_words: Vec<String> = word_runs_latin_cyr(&theme_title.to_lowercase());
    let theme_kw_line = batch
        .text
        .lines()
        .find_map(|l| l.strip_prefix("ТЕМА-СЛОВА:").map(String::from))
        .unwrap_or_default();
    let theme_kw_set: Vec<String> = theme_kw_line
        .to_lowercase()
        .split(',')
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty())
        .collect();
    let mut pal_count: Vec<(String, usize)> = Vec::new();
    for s in &batch.slots {
        let pal = resolve_palette(s.position, &s.header);
        if !pal.is_empty() {
            match pal_count.iter_mut().find(|(k, _)| *k == pal) {
                Some((_, n)) => *n += 1,
                None => pal_count.push((pal.clone(), 1)),
            }
        }
        let is_expl = s.header.contains('⚗');
        let mut slot_f: Vec<String> = Vec::new();
        let pos_lower = s.pos.to_lowercase();
        let neg_lower = s.neg.to_lowercase();
        if pal.is_empty() {
            slot_f.push("палитра не назначена (нет в шапке, нет наследования по abPairs — specs/raw-plus.json, закон №23)".into());
        }
        if !pos_lower.contains("stylized 2d anime face") {
            slot_f.push("нет face-блока (stylized 2D anime face — M17, приказ «концепция аниме-лиц»)".into());
        }
        if !contains_word_ci(&s.pos, "small nose") || !contains_word_ci(&s.pos, "small mouth") {
            slot_f.push("face-блок неполный (anime eyes (цвет), small nose, small mouth — M17)".into());
        }
        if !sub_any(&pos_lower, LIGHT_RE) {
            slot_f.push("нет света-на-зоне: ни одного светового слова в POS (закон №21 — X-граница плоской натяжки, «блеклость»)".into());
        }
        if !pos_lower.contains("masterpiece") || !pos_lower.contains("best quality") || !pos_lower.contains("anime artstyle") {
            slot_f.push("нет финальных квалити-тегов (masterpiece, best quality, anime artstyle)".into());
        }
        if !neg_lower.contains("washed-out") || !neg_lower.contains("faded colors") || !neg_lower.contains("low contrast") {
            slot_f.push("нет ANTI-WASH в NEG (washed-out, faded colors, low contrast — Five Locks)".into());
        }
        // закон №23: теги, БЕЗ прозы (десятичные — не проза)
        let period_count = sentence_dots(&s.pos);
        if period_count > 1 {
            slot_f.push(format!(
                "проза в POS: точек {period_count} > 1 — только финальная (закон №23: теги, БЕЗ прозы)"
            ));
        }
        if s.pos.contains(['"', '\u{201C}', '\u{201D}', '«', '»']) {
            slot_f.push("диалог/кавычки в POS — проза запрещена (закон №23)".into());
        }
        if pos_lower.contains("is rendered in") {
            slot_f.push("PH face-lock проза в POS («is rendered in…») — RAW+ пишет face-блок тегом (закон №23)".into());
        }
        if contains_word_ci(&s.pos, "she") {
            slot_f.push("прозовое местоимение «she» в POS — теги несут существительные (закон №23)".into());
        }
        // закон №26: тайтл не в POS — ни целиком, ни пробегом слов
        if !title_words.is_empty() {
            let pos_n = normalize_word_runs(&pos_lower);
            let full = title_words.join(" ");
            let mut title_hit = String::new();
            if title_words.len() >= 2 && pos_n.contains(&full) {
                title_hit = theme_title.clone();
            } else {
                if title_words.len() >= 3 {
                    let mut i = 0usize;
                    while i + 3 <= title_words.len() && title_hit.is_empty() {
                        let run: Vec<&str> = title_words[i..i + 3].iter().map(String::as_str).collect();
                        let content_words = run.iter().copied().filter(|w| !is_title_stop(w)).count();
                        if content_words >= 2 && pos_n.contains(&run.join(" ")) {
                            title_hit = format!("…{}…", run.join(" "));
                        }
                        i += 1;
                    }
                }
                let title_content: Vec<&str> = title_words
                    .iter()
                    .map(String::as_str)
                    .filter(|w| !is_title_stop(w))
                    .collect();
                if title_hit.is_empty()
                    && title_content.len() == 1
                    && !theme_kw_set.iter().any(|k| k.as_str() == title_content[0])
                    && js_word_bounded(&pos_n, title_content[0])
                {
                    title_hit = format!("…{}…", title_content[0]);
                }
            }
            if !title_hit.is_empty() {
                slot_f.push(format!(
                    "закон №26: название темы в POS ({title_hit}) — всё из позитива уходит в рендер, тайтл-тег травит кадр; тема через отрисуемое (закон/палитра/свет/объекты/лицо)"
                ));
            }
        }
        // закон №27: тон несущей вещи против заявки (ближайшая вещь к заявке)
        let pos_tags27: Vec<String> = pos_lower
            .replace('_', " ")
            .split([',', '.'])
            .map(|t| t.trim().to_string())
            .collect();
        let mut claim_idx27: Vec<usize> = Vec::new();
        let mut garment_idx27: Vec<usize> = Vec::new();
        for (i, t) in pos_tags27.iter().enumerate() {
            if CLAIM_27.iter().any(|c| t.contains(c)) {
                claim_idx27.push(i);
            }
            if word_any(t, GARMENT_RE) {
                garment_idx27.push(i);
            }
        }
        let garment_tag27: String = if !garment_idx27.is_empty() {
            let pick = if !claim_idx27.is_empty() {
                garment_idx27
                    .iter()
                    .copied()
                    .reduce(|best, gi| {
                        let dist = claim_idx27.iter().map(|ci| (gi as i64 - *ci as i64).abs()).min().unwrap_or(0);
                        let best_dist =
                            claim_idx27.iter().map(|ci| (best as i64 - *ci as i64).abs()).min().unwrap_or(0);
                        if dist < best_dist {
                            gi
                        } else {
                            best
                        }
                    })
                    .unwrap_or(garment_idx27[0])
            } else {
                garment_idx27[0]
            };
            pos_tags27[pick].clone()
        } else {
            String::new()
        };
        let garment_norm27 = garment_tag27.replace('-', " ");
        let garment_dark = !garment_tag27.is_empty() && word_any(&garment_norm27, DARK_TONE);
        let garment_light_fam =
            !garment_tag27.is_empty() && !garment_dark && word_any(&garment_norm27, LIGHT_FAMILY);
        let pos_lower27 = pos_lower.replace('_', " ");
        let through_claim27 = pos_lower27.contains("nipples through clothing");
        let light_chest = light_on_chest(&s.pos);
        let wet_sheer27 = pos_lower27.contains("wet clothes")
            || pos_lower27.contains("see-through")
            || pos_lower27.contains("breast clinging");
        if tier_of(&s.meta) == "R+" {
            if through_claim27 && !garment_dark {
                slot_f.push(format!(
                    "закон №28 (№27-наследие): through-заявка «nipples through clothing» — X-канал ПО ОПРЕДЕЛЕНИЮ на любом тоне{}: тег рисует цветной сосок через любую ткань (P09 свитер, P12 не-сквозная — T4-31); R+ бугорки = DRY dark + covered-first (P30)",
                    if !garment_tag27.is_empty() {
                        format!(" («{}»)", garment_tag27)
                    } else {
                        " (цвет вещи не назван)".to_string()
                    }
                ));
            }
            if light_chest && wet_sheer27 {
                slot_f.push("закон №27: «light on chest» на sheer/wet верхе — прямой X-усилитель (квитанции P14/P17): свет на зоне — glow сцены на вещь, не «свет на груди»".into());
            }
            // светлый полюс №27 — EXP-болванки в кластер не толкаются (§10)
            if !s.header.contains("(EXP ·")
                && garment_light_fam
                && (through_claim27
                    || pos_lower27.contains("clothed nipples")
                    || pos_lower27.contains("covered nipples"))
                && wet_sheer27
            {
                light_carrying_tops.push(s.position);
            }
        }
        // закон №25: авторский бан-лист NEG (X-слоты держат coverage-блок)
        if tier_of(&s.meta) != "X" {
            for t in NEG_BAN {
                if contains_word_ci(&s.neg, t) {
                    slot_f.push(format!(
                        "закон №25: запрещённый автором NEG-термин «{t}» — руинит заявку (specs/rating-recipes.json v1.7.0 → neg_law)"
                    ));
                }
            }
        }
        if slot_f.is_empty() {
            continue;
        }
        if is_expl {
            expl.push(format!(
                "EXPLORATORY ⚗ (§10, квитанция): P{}: {}",
                s.position,
                slot_f.join(" · ")
            ));
        } else {
            f.push(format!("P{}: {}", s.position, slot_f.join(" · ")));
        }
    }
    // батч-уровень: №23 — ≥7 палитр, ни одна чаще 3 раз (C066/C067)
    let distinct = pal_count.len();
    if distinct < 7 {
        f.push(format!("палитр в батче {distinct} < 7 (C066 — закон №23)"));
    }
    for (pal, n) in &pal_count {
        if *n > 3 {
            f.push(format!("палитра {pal} использована {n} раз > 3 (C067 — закон №23)"));
        }
    }
    // батч-уровень: №27 — кластер светлых/серо-семейных несущих верхов ≤3
    if light_carrying_tops.len() > 3 {
        f.push(format!(
            "закон №27: светлых/серо-семейных несущих верхов с заявкой {} > 3 — тон вещи ротацией dark/mid/light, светлый кластер рушит и канал (X-слайды), и разнообразие кадра (вердикты T4-26/T4-28)",
            light_carrying_tops.len()
        ));
        for p in &light_carrying_tops {
            f.push(format!(
                "P{p}: закон №27 — несущий верх светлой/серо-семьи в кластере {}>3; перетони вещь в dark/mid (тёмный полюс несёт through-заявку, светлый — covered/clothed, кластер ≤3)",
                light_carrying_tops.len()
            ));
        }
    }
    let main = Receipt {
        gate: "raw-plus",
        level: "hard",
        verdict: if f.is_empty() { "PASS" } else { "FAIL" },
        findings: f,
        notes: Vec::new(),
    };
    let expl_receipt = if expl.is_empty() {
        None
    } else {
        Some(Receipt {
            gate: "raw-plus-exploratory",
            level: "warn",
            verdict: "WARN",
            findings: expl,
            notes: Vec::new(),
        })
    };
    Some((main, expl_receipt))
}

/// /^#\s*[^\n]*?["«]([^"»\n]+)["»]/m — тайтл из H1 RAW+ (первая кавычка
/// любой пары на строке, начинающейся с «#» без отступа).
fn raw_plus_theme_title(text: &str) -> String {
    for line in text.lines() {
        let Some(rest) = line.strip_prefix('#') else { continue };
        let rest = rest.trim_start();
        let Some(open) = rest.find(['"', '«']) else { continue };
        let open_len = rest[open..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
        let inner = &rest[open + open_len..];
        let Some(close) = inner.find(['"', '»']) else { continue };
        if close > 0 {
            return inner[..close].trim().to_string();
        }
    }
    String::new()
}

/* ================================================================== */
/* 26. contract-fidelity (warn, контракт vs батч)                       */
/* ================================================================== */

/// kinTokensOf (gates.ts:238): кин-токены расы — имя (cat → «cat»,
/// «cat girl»), скобочные синонимы, существительные фич.
fn kin_tokens_of(race_name: &str, races: Option<&RacesLite>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let name = race_name.trim();
    if name.is_empty() {
        return out;
    }
    // core: имя без скобочных групп (/\s*\(.*?\)\s*/g → '')
    let core = {
        let chars: Vec<char> = name.chars().collect();
        let mut out = String::new();
        let mut i = 0usize;
        while i < chars.len() {
            if chars[i] == '(' {
                if let Some(j) = (i + 1..chars.len()).find(|&j| chars[j] == ')') {
                    while out.ends_with(char::is_whitespace) {
                        out.pop();
                    }
                    i = j + 1;
                    while i < chars.len() && chars[i].is_whitespace() {
                        i += 1;
                    }
                    continue;
                }
            }
            out.push(chars[i]);
            i += 1;
        }
        out.trim().to_string()
    };
    // paren: первая скобочная группа
    let paren = {
        let chars: Vec<char> = name.chars().collect();
        match chars.iter().position(|&c| c == '(') {
            Some(p) => match (p + 1..chars.len()).find(|&j| chars[j] == ')') {
                Some(q) => chars[p + 1..q].iter().collect::<String>().trim().to_string(),
                None => String::new(),
            },
            None => String::new(),
        }
    };
    let push = |s_raw: &str, out: &mut Vec<String>| {
        // .toLowerCase().replace(/-?\s*kin/g, '').trim()
        let s = strip_kin(&s_raw.to_lowercase()).trim().to_string();
        if !s.is_empty() && s != "human" && s.chars().count() >= 3 {
            push_uniq(out, s.clone());
            push_uniq(out, format!("{s} girl"));
        }
    };
    push(&core, &mut out);
    for p in paren.split([',', '/']) {
        push(p.trim(), &mut out);
    }
    let spec = races.and_then(|r| {
        r.races
            .iter()
            .find(|(n, _)| n.to_lowercase() == core.to_lowercase())
    });
    if let Some((_, features)) = spec {
        for feat in features {
            let head = feat.to_lowercase().split(" — ").next().unwrap_or("").trim().to_string();
            if head.is_empty() || sub_any(&head, &["sol", "lock", "forbid"]) {
                continue;
            }
            push_uniq(&mut out, head.clone());
            push_uniq(&mut out, head.split_whitespace().next().unwrap_or("").to_string());
        }
    }
    out.retain(|s| s != "human");
    out
}

/// replace(/-?\s*kin/g, '') — все вхождения [-]?\s*kin вырезаны;
/// «fox-kin» → «fox», «fox kin» → «fox», «kindness» → «dness» (1-в-1 JS).
fn strip_kin(low: &str) -> String {
    let chars: Vec<char> = low.chars().collect();
    let kin: Vec<char> = "kin".chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        if i + kin.len() <= chars.len() && chars[i..i + kin.len()] == kin[..] {
            i += kin.len();
            // поглощённые перед «kin»: \s* затем один опциональный '-'
            while out.ends_with(char::is_whitespace) {
                out.pop();
            }
            if out.ends_with('-') {
                out.pop();
            }
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// 26. contract-fidelity (gates.ts:2310, warn) — сверка собранного батча с
/// контрактом (поза/палитра/стек/рейтинг/OC/раса); дефект T4-30 (кино-сдвиг)
/// чинится полирующим кругом писца. RAW/ручная сборка — честная заметка.
pub fn gate_contract_fidelity(
    batch: &TextBatch,
    contract: Option<&Contract>,
    races: Option<&RacesLite>,
) -> Receipt {
    let Some(contract) = contract else {
        return Receipt {
            gate: "contract-fidelity",
            level: "warn",
            verdict: "PASS",
            findings: Vec::new(),
            notes: vec![
                "контракта нет — RAW/ручная сборка: верность контракту не проверяема".into(),
            ],
        };
    };
    let mut f: Vec<String> = Vec::new();
    for cs in &contract.slots {
        let label = format!("P{:02}", cs.position);
        let Some(bs) = batch.slots.iter().find(|s| s.position == cs.position) else {
            f.push(format!("{label}: слот контракта отсутствует в батче"));
            continue;
        };
        let meta = &bs.meta;
        if !cs.pose.is_empty() && !contains_word(meta, &cs.pose) {
            let hat = meta_pose_token(meta);
            f.push(format!(
                "{label}: поза контракта {} ≠ шапки батча ({}) — кино-сдвиг (класс T4-30), вернуть позу из Spine",
                cs.pose,
                if hat.is_empty() { "—".to_string() } else { hat }
            ));
        }
        if !cs.palette.is_empty() && !contains_word(meta, &cs.palette) {
            let hat = meta_palette_token(meta);
            f.push(format!(
                "{label}: палитра контракта {} ≠ шапки ({})",
                cs.palette,
                if hat.is_empty() { "—".to_string() } else { hat }
            ));
        }
        let tier = tier_of(meta);
        if !cs.rating.is_empty() && cs.rating != tier {
            f.push(format!(
                "{label}: рейтинг контракта {} ≠ шапки {}",
                cs.rating,
                if tier.is_empty() { "—".to_string() } else { tier.to_string() }
            ));
        }
        if let Some(oc) = &cs.oc {
            if !meta.to_lowercase().contains(&oc.to_lowercase()) {
                f.push(format!("{label}: OC контракта {oc} не назван в шапке слота"));
            }
        }
        if let Some(race) = &cs.race {
            if !race.is_empty() {
                let tokens = kin_tokens_of(race, races);
                let pos_lower = bs.pos.to_lowercase().replace('_', " ");
                if !tokens.is_empty() && !tokens.iter().any(|t| pos_lower.contains(t)) {
                    f.push(format!(
                        "{label}: раса «{race}» не работает в кадре — POS не несёт ни одного её токена ({}) — закон №3: раса делает ФИЗИЧЕСКУЮ работу, не тег-бижутерию",
                        tokens.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
                    ));
                }
            }
        }
        let stack_c: Vec<String> = cs.carriers.iter().filter(|id| !id.is_empty()).cloned().collect();
        if !stack_c.is_empty() {
            let miss: Vec<&String> = stack_c.iter().filter(|id| !bs.stack.contains(id)).collect();
            let extra: Vec<&String> = bs.stack.iter().filter(|id| !stack_c.contains(id)).collect();
            if !miss.is_empty() || !extra.is_empty() {
                let miss_s = if !miss.is_empty() {
                    format!(" — потеряно: {}", miss.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))
                } else {
                    String::new()
                };
                let extra_s = if !extra.is_empty() {
                    format!(" — лишнее: {}", extra.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))
                } else {
                    String::new()
                };
                f.push(format!(
                    "{label}: стек контракта [{}] ≠ Stack: [{}]{}{}",
                    stack_c.iter().map(String::as_str).collect::<Vec<_>>().join(" + "),
                    bs.stack.join(" + "),
                    miss_s,
                    extra_s
                ));
            }
        }
    }
    warn_receipt("contract-fidelity", f)
}

/* ================================================================== */
/* 29. bumps-quota (warn, G17)                                          */
/* ================================================================== */

/// 29. bumps-quota (gates.ts:2417, warn) — канал бугорков ≥40% R+-
/// дресс-слотов (контракт меряет; RAW/ручной без контракта не судим).
pub fn gate_bumps_quota(contract: Option<&Contract>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    let rplus_dressed: Vec<&super::ContractSlot> = contract
        .map(|c| {
            c.slots
                .iter()
                .filter(|cs| {
                    cs.rating == "R+" && cs.kind != "EXP"
                        && cs.dress_channel.as_deref().map(|c| !c.is_empty()).unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    let bumps_n = rplus_dressed
        .iter()
        .filter(|cs| cs.dress_channel.as_deref() == Some("bumps"))
        .count();
    if rplus_dressed.len() >= 5 {
        let pct = ((bumps_n as f64 / rplus_dressed.len() as f64) * 100.0).round() as i64;
        if (bumps_n as f64) / (rplus_dressed.len() as f64) < 0.4 {
            f.push(format!(
                "bumps-канал {bumps_n} из {} R+-дресс-слотов ({pct}%) < 40% — самый живой через-ткань сигнал недопредставлен (G17, №52-бэклог): канал бугорков должен получать ⌈0.4×R+⌉ слотов (генератор уже строит dark-минимум под квоту — пересобери контракт)",
                rplus_dressed.len()
            ));
        }
    }
    warn_receipt("bumps-quota", f)
}

/* ================================================================== */
/* Тесты этапа 2                                                        */
/* ================================================================== */

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{Contract, ContractSlot};

    #[test]
    fn helpers_js_semantics() {
        // JS \b: кириллица — НЕ слово-симвл
        assert!(!js_word_bounded(" колокол тишины ", "колокол"));
        assert!(js_word_bounded("abc колокол", "abc"));
        assert!(js_word_bounded("колокол abc", "abc"));
        assert!(js_word_bounded(" abc ", "abc"));
        assert!(!js_word_bounded("xabc", "abc"));
        assert_eq!(cls_of("CR-W01"), "W");
        assert_eq!(cls_of("XCR-W01"), "?");
        assert_eq!(meta_pose_token("OC · Vae · R+ · PL24 · P25_X"), "PL24");
        assert_eq!(meta_palette_token("R+ · P35_VOID_EMBER · tail"), "P35_VOID_EMBER");
        assert_eq!(header_pose_token("P01 — a (VOLT · — · R+ · PL70 · P30_X)"), "PL70");
        assert_eq!(header_pose_token("P01 — a (VOLT · — · R+ · PL1599)"), "");
        assert_eq!(header_palette_token("P01 — a (VOLT · P30_STEEL_MARKET)"), "P30_STEEL_MARKET");
        assert_eq!(sentence_dots("тег блок. проза 2.5d хвост."), 2);
        assert_eq!(js_tofix2(0.875), "0.88");
        assert_eq!(js_tofix2(0.7), "0.70");
        // V8 toFixed: половина ОТ НУЛЯ (не half-even) и 1 → «1.00»
        assert_eq!(js_tofix2(0.125), "0.13");
        assert_eq!(js_tofix2(1.0), "1.00");
        assert_eq!(js_tofix2(0.375), "0.38");
        assert!(light_on_chest("rim light on her chest below"));
        assert!(!light_on_chest("glow falling on the garment zone"));
        assert!(!light_on_chest("light,chest"));
    }

    #[test]
    fn spec_loaders_live() {
        let oc = load_oc_canon().expect("oc-canon.json обязан читаться");
        // порядок файла (не алфавит): Sue первым, Lucy последним
        assert_eq!(oc.hair_eyes.first().map(|(n, _, _)| n.as_str()), Some("Sue"));
        assert_eq!(oc.hair_eyes.last().map(|(n, _, _)| n.as_str()), Some("Lucy"));
        assert!(oc.hair_eyes.len() >= 20);
        let rr = load_rating_recipes().expect("rating-recipes.json");
        assert!(rr.tiers.iter().any(|(k, _)| k == "RPLUS"));
        let rplus = rr.tiers.iter().find(|(k, _)| k == "RPLUS").unwrap();
        assert_eq!(rplus.1.mechanisms.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), vec!["bumps", "on_skin"]);
        let tech = load_rating_techniques().expect("rating-techniques.json");
        assert!(tech.techniques.len() >= 100);
        assert_eq!(tech.rplus_floor, (3, 2));
        let car = load_carriers().expect("carriers.json");
        assert_eq!(car.class_mech.get("W").map(String::as_str), Some("FABRIC"));
        assert!(car.sheer_ids.contains("CR-W07"));
        assert!(!car.sheer_ids.contains("CR-W01"));
        let dr = load_dresser().expect("dresser.json");
        assert_eq!(dr.conflicts.len(), 3);
        let races = load_races().expect("races.json");
        assert!(races.races.len() >= 40);
    }

    #[test]
    fn fold_window_live() {
        let st = fold_file_era();
        assert!(!st.window.is_empty());
        assert!(st.window.len() <= 3);
        assert!(st.delivered_at.iter().any(|(s, a)| s == "T4-27" && a.is_some()));
        // несданный слаг видит всё текущее окно; T4-27 сдан давно — его
        // историческое окно пусто (будущее не судит прошлое: все члены
        // текущего окна сданы ПОЗЖЕ него)
        let unknown = historical_window("T4-99-unknown", &st);
        assert_eq!(unknown, st.window);
        assert!(historical_window("T4-27", &st).is_empty());
    }

    #[test]
    fn simcheck_sentence_split() {
        let sents = simcheck_sentences(
            "the lantern sale at the steel market keeps its glow long after midnight ends. another fully different sentence about the harbor pier and fog",
        );
        assert_eq!(sents.len(), 2);
        assert!(sents[0].starts_with("the lantern sale"));
        // десятичная точка без \s не рвёт предложение
        assert_eq!(
            simcheck_sentences("v2.0 release of the fully tagged and described character portrait").len(),
            1
        );
        // бойлерплейт не предложение автора
        assert!(simcheck_sentences("masterpiece, best quality, anime artstyle rendering here").is_empty());
    }

    #[test]
    fn technique_tag_block_boiler_removed() {
        let tb = tech_tag_block("ecchi anime style, 1girl, solo, covered nipples, rain coat.");
        assert!(!tb.contains("anime style"));
        assert!(!tb.contains("1girl"));
        assert!(tb.contains("covered nipples"));
    }

    #[test]
    fn kin_tokens_semantics() {
        // Kitsune (fox-kin): core «kitsune», синоним «fox» (kin-суффикс снят)
        let races = load_races();
        let tokens = kin_tokens_of("Kitsune (fox-kin)", races.as_ref());
        assert!(tokens.iter().any(|t| t == "kitsune"));
        assert!(tokens.iter().any(|t| t == "fox"));
        assert!(tokens.iter().any(|t| t == "fox girl"));
        assert!(!tokens.iter().any(|t| t.contains("kin")));
    }

    /* ---------------- per-gate: детект + PASS (этап 2) ---------------- */

    fn synth(md: &str) -> TextBatch {
        super::super::parse_batch("T4-90", md)
    }

    #[test]
    fn rating_recipe_detect_and_pass() {
        let recipes = load_rating_recipes();
        // FAIL: R+ слот без сигнал-тегов рецепта — 3 находки дословно
        let b = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, wool coat.\nNEG:\nchild\n");
        let (r, expl) = gate_rating_recipe(&b, recipes.as_ref());
        assert_eq!((r.gate, r.level, r.verdict), ("rating-recipe", "hard", "FAIL"));
        assert!(expl.is_none());
        assert!(r.findings.iter().any(|f| f.starts_with(
            "P1: заявлен R+, сигнал-тегов рецепта 0/2 — рейтинг не заработан (рецепт: covered nipples, breast clinging, cameltoe, camel toe, clothed nipples…)"
        )), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f.starts_with(
            "P1: заявлен R+, но рендер-доказанной заявки нет (0/1): visible pantyline, clothed nipples, covered nipples, taped nipples"
        )), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f
            == "P1: контр-NEG не держит границу тира (нужно ≥1 из: nipples exposed, areola, bra)"), "{:?}", r.findings);
        // PASS: заявка + состояние ткани + тёмный тон + контр-NEG + без подслоя
        let b2 = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, covered nipples, fabric clinging, tight clothes, black sweater, masterpiece, best quality, anime artstyle.\nNEG:\nbra, camisole, bandeau, undershirt, child\n",
        );
        let (r2, expl2) = gate_rating_recipe(&b2, recipes.as_ref());
        assert_eq!((r2.verdict, r2.findings.as_slice(), expl2.is_none()), ("PASS", &[][..], true), "{:?}", r2.findings);
    }

    #[test]
    fn rating_recipe_exploratory_receipt() {
        let recipes = load_rating_recipes();
        // ⚗-слот: механизм без состояния ткани — квитанцией §10, не hard
        let b = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R+) ⚗\nPOS:\nanime style, clothed nipples, camel toe, black cotton dress, masterpiece, best quality, anime artstyle.\nNEG:\nbra, camisole, bandeau, undershirt, child\n",
        );
        let (main, expl) = gate_rating_recipe(&b, recipes.as_ref());
        assert_eq!(main.verdict, "PASS", "нарушение ушло в ⚗-квитанцию: {:?}", main.findings);
        let e = expl.expect("⚗-слот обязан дать rating-recipe-exploratory");
        assert_eq!((e.gate, e.level, e.verdict), ("rating-recipe-exploratory", "warn", "WARN"));
        assert_eq!(e.findings.len(), 1, "{:?}", e.findings);
        assert!(e.findings[0].starts_with(
            "EXPLORATORY (§10, квитанция): P1: механизм «bumps» без состояния ткани — в тег-блоке нет ни одного из [fabric clinging / breast clinging / sweat glistening / tight] (рендер-вердикт T4-03: сухая плотная ткань не несёт edge, P13/P21 умерли именно так)"
        ), "{}", e.findings[0]);
    }

    #[test]
    fn canon_detect_and_pass() {
        // FAIL: имя ОС в POS — триггер чужих персонажей (регистр важен)
        let b = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, Sue at the counter.\nNEG:\nchild\n");
        let r = gate_canon(&b);
        assert_eq!((r.gate, r.level, r.verdict), ("canon", "hard", "FAIL"));
        assert!(r.findings.iter().any(|f| f
            == "P1: имя ОС «Sue» в POS — триггер чужих персонажей у рендерера (приказ автора, T4-04); опиши её дескрипторами, имя живёт в шапке/Canon"), "{:?}", r.findings);
        // OC-слот без опознанного имени (позиция ≤3)
        let b2 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, quiet room.\nNEG:\nchild\n");
        let r2 = gate_canon(&b2);
        assert!(r2.findings.iter().any(|f| f == "P1: OC не опознан в шапке"), "{:?}", r2.findings);
        // PASS: слот вне OC-тройки (позиция > 3), имён в POS нет
        let b3 = synth("# T4-90 «x»\nP05 — a (VOLT · — · R)\nPOS:\nanime style, copper hair, green eyes.\nNEG:\nchild\n");
        assert_eq!(gate_canon(&b3).verdict, "PASS");
    }

    #[test]
    fn diversity_detect_and_pass() {
        let carriers = load_carriers();
        // FAIL: стек 2/4 + группы/классы < 4
        let b = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nStack: CR-W01 + CR-B01\nPOS:\nanime style, quiet room.\nNEG:\nchild\n",
        );
        let r = gate_diversity(&b, carriers.as_ref());
        assert_eq!((r.gate, r.level, r.verdict), ("diversity", "hard", "FAIL"));
        assert!(r.findings.iter().any(|f| f == "P1: стек 2/4 носителей (core-4)"), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f.starts_with("P1: механо-групп 2/4")), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f == "P1: классов 2/4"), "{:?}", r.findings);
        // PASS: core-4 — 4 класса из 4 механо-групп, без sheer
        let b2 = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R+ · PL70 · P30_STEEL_MARKET)\nStack: CR-W01 + CR-B01 + CR-E01 + CR-D01\nPOS:\nanime style, quiet room.\nNEG:\nchild\n",
        );
        let r2 = gate_diversity(&b2, carriers.as_ref());
        assert_eq!(r2.verdict, "PASS", "{:?}", r2.findings);
    }

    #[test]
    fn dresser_detect_and_pass() {
        // FAIL: №28-риск see-through на R+
        let b = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, see-through veil.\nNEG:\nchild\n");
        let r = gate_dresser(&b);
        assert_eq!((r.gate, r.level, r.verdict), ("dresser", "warn", "WARN"));
        assert_eq!(
            r.findings[0],
            "P1: №28-риск: «see-through» на R+ — тег рисует просвет (P09: даже тёмный knit — X; P30 выжил лишь с «dark garment» и опозданием тега) — лучше опустить, бугорки живут без него"
        );
        // конфликт категорий (квитанция №29, вердикт T4-31 дословно)
        let b2 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, garter belt, swimsuit.\nNEG:\nchild\n");
        let r2 = gate_dresser(&b2);
        assert!(r2.findings.iter().any(|f| f.starts_with(
            "P1: конфликт дресс-кода: garter straps + swim — T4-31 дословно: «нахуя с купальником надевать эти бретельки которые держат чулки»"
        )), "{:?}", r2.findings);
        // PASS: R-слот без №28-рисков и конфликтов
        let b3 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, wool coat.\nNEG:\nchild\n");
        assert_eq!(gate_dresser(&b3).verdict, "PASS");
    }

    #[test]
    fn niche_legibility_detect_and_pass() {
        let races = load_races();
        let contract = Contract {
            slots: vec![ContractSlot {
                position: 1,
                kind: "NICHE".into(),
                rating: "R".into(),
                race: Some("Cat-kin".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        // FAIL: раса не работает в кадре + нет свидетеля
        let b = synth("# T4-90 «x»\nP01 — a (NICHE · — · R)\nPOS:\nanime style, quiet room, wooden chair.\nNEG:\nchild\n");
        let r = gate_niche_legibility(&b, Some(&contract), races.as_ref());
        assert_eq!((r.gate, r.verdict), ("niche-legibility", "WARN"));
        assert!(r.findings.iter().any(|f| f.starts_with(
            "P1: NICHE-раса «Cat-kin» не читается в POS (тегов расы 0/2) — раса делает физическую работу в кадре"
        )), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f
            == "P1: NICHE без свидетеля в кадре (mirror/glass/monitor/phone/gauge…) — свидетель держит невозможное"), "{:?}", r.findings);
        // PASS: фичи расы в POS + свидетель
        let b2 = synth(
            "# T4-90 «x»\nP01 — a (NICHE · — · R)\nPOS:\nanime style, fluffy ears, tufted tail, shop glass reflection.\nNEG:\nchild\n",
        );
        let r2 = gate_niche_legibility(&b2, Some(&contract), races.as_ref());
        assert_eq!(r2.verdict, "PASS", "{:?}", r2.findings);
    }

    #[test]
    fn claim_visibility_detect_and_pass() {
        // FAIL: нижняя зона сигнала закрыта юбкой
        let b = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, cameltoe, long skirt.\nNEG:\nchild\n");
        let r = gate_claim_visibility(&b);
        assert_eq!((r.gate, r.verdict), ("claim-visibility", "WARN"));
        assert_eq!(
            r.findings[0],
            "P1: зона сигнала (низ) закрыта «skirt» — cameltoe/pantyline не виден камере; открой зону или перевези claim (вердикт T4-03)"
        );
        // стопка верхних слоёв ≥3
        let b2 = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, shirt, jacket, parka over the frame.\nNEG:\nchild\n",
        );
        let r2 = gate_claim_visibility(&b2);
        assert!(r2.findings.iter().any(|f| f.starts_with("P1: стопка верхних слоёв 3 (shirt, jacket, parka)")), "{:?}", r2.findings);
        // PASS: заявка без закрытых зон
        let b3 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, covered nipples, fabric clinging, black crop top.\nNEG:\nchild\n");
        assert_eq!(gate_claim_visibility(&b3).verdict, "PASS");
    }

    #[test]
    fn technique_layers_detect_and_pass() {
        let tech = load_rating_techniques();
        // FAIL: сумма факторов не набрана (R+ без сигналов лестницы)
        let b = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, calm morning light.\nNEG:\nchild\n");
        let r = gate_technique_layers(&b, tech.as_ref());
        assert_eq!((r.gate, r.verdict), ("technique-layers", "WARN"));
        assert_eq!(
            r.findings[0],
            "P1: сумма факторов не набрана — 0 сигнал(а) через 0 слой(я) · блок 8: R+ = 3+ сигнала через 2+ слоя — это R/R+ граница, не R+ сумма; карта кадра: —"
        );
        // X Cut hold (блок 9): X-слот без кадрирования/закрытого низа
        let b2 = synth("# T4-90 «x»\nP01 — a (VOLT · — · X)\nPOS:\nanime style, topless, standing.\nNEG:\nchild\n");
        let r2 = gate_technique_layers(&b2, tech.as_ref());
        assert!(r2.findings.iter().any(|f| f.starts_with(
            "P1: X Cut hold (блок 9) — низ тела ни закрыт (skirt/shorts/panties/pants/jeans…), ни выведен из кадра (upper body/portrait/cowboy shot/close-up) — модель может «дорисовать» ниже"
        )), "{:?}", r2.findings);
        // PASS: R-слоты гейт не судит
        let b3 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, calm morning light.\nNEG:\nchild\n");
        assert_eq!(gate_technique_layers(&b3, tech.as_ref()).verdict, "PASS");
    }

    #[test]
    fn simcheck_detect_and_pass() {
        // FAIL: внутри-батчевые дословные близнецы (J=1.00)
        let sent = "the lantern sale at the steel market keeps its glow long after midnight ends.";
        let md = format!(
            "# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\n{sent}\nNEG:\nchild\nP02 — b (VOLT · — · R)\nPOS:\n{sent}\nNEG:\nchild\n"
        );
        let r = gate_simcheck(&synth(&md), None);
        assert_eq!((r.gate, r.verdict), ("simcheck", "WARN"));
        assert!(r.findings.iter().any(|f| f.starts_with("внутри-батчевые близнецы: P1≈P2: «the lantern sale") && f.contains("(J=1.00)")), "{:?}", r.findings);
        // PASS: разные предложения (окно живой летописи не совпадает с синтетикой)
        let ok = format!(
            "# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\n{sent}\nNEG:\nchild\nP02 — b (VOLT · — · R)\nPOS:\nanother pier with fog and seagulls over the copper roofs at dawn.\nNEG:\nchild\n"
        );
        let r2 = gate_simcheck(&synth(&ok), None);
        assert_eq!(r2.verdict, "PASS", "{:?}", r2.findings);
    }

    #[test]
    fn technique_map_report() {
        let tech = load_rating_techniques();
        // advisory REPORT: карта слоёв на каждый R+ кадр
        let b = synth("# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, calm morning light.\nNEG:\nchild\n");
        let r = gate_technique_map(&b, tech.as_ref());
        assert_eq!((r.gate, r.level, r.verdict), ("technique-map", "advisory", "REPORT"));
        assert!(r.findings.iter().any(|f| f.starts_with("P01 R+: 0 сигнал(ов) · слои — · —")), "{:?}", r.findings);
        // без R+/X слотов — честная пустая карта
        let b2 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, calm morning light.\nNEG:\nchild\n");
        let r2 = gate_technique_map(&b2, tech.as_ref());
        assert_eq!(r2.findings, vec!["R+/X слотов в батче нет".to_string()]);
    }

    #[test]
    fn salience_chain_detect_and_pass() {
        // WARN: цепочка на каждый R+ кадр; CONTRAST '?' без светлой вещи
        let b = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, clothed nipples, fabric clinging, black blouse, upper body, close-up, seductive smile.\nNEG:\nchild\n",
        );
        let r = gate_salience_chain(&b, None);
        assert_eq!((r.gate, r.verdict), ("salience-chain", "WARN"));
        assert!(r.findings[0].starts_with(
            "салиенс-цепочка (§9-секста + §9-септима BLOCKER/LEGIBILITY/POSE-RISK, вердикт T4-05): 1 R+/X слотов, под угрозой 0 (≥2 порванных звеньев — провал звена роняет тир)"
        ), "{}", r.findings[0]);
        assert!(r.findings[1].contains("OBJECT ✓ (blouse)"), "{}", r.findings[1]);
        assert!(r.findings[1].contains("CAMERA ✓ (close-up)"), "{}", r.findings[1]); // CAMERA_TAGS: close-up раньше upper body (TS .find)
        assert!(r.findings[1].contains("CONTRAST ? — нет ни светлой вещи, ни света на зоне"), "{}", r.findings[1]);
        assert!(r.findings[1].ends_with("→ 1 звено порвано"), "{}", r.findings[1]);
        // PASS: R-слоты вне закона салиенса
        let b2 = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, quiet room.\nNEG:\nchild\n");
        assert_eq!(gate_salience_chain(&b2, None).verdict, "PASS");
    }

    #[test]
    fn contract_fidelity_detect_and_pass() {
        // FAIL: поза/палитра/раса/стек разошлись с контрактом
        let contract = Contract {
            slots: vec![ContractSlot {
                position: 1,
                kind: "MAINS".into(),
                rating: "R".into(),
                pose: "PL24".into(),
                palette: "P25_VOID_EMBER".into(),
                race: Some("Cat-kin".into()),
                carriers: vec!["CR-W01".into()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let b = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R · PL70 · P30_STEEL_MARKET)\nStack: CR-B02\nPOS:\nanime style, quiet room.\nNEG:\nchild\n",
        );
        let races = load_races();
        let r = gate_contract_fidelity(&b, Some(&contract), races.as_ref());
        assert_eq!((r.gate, r.verdict), ("contract-fidelity", "WARN"));
        assert!(r.findings.iter().any(|f| f
            == "P01: поза контракта PL24 ≠ шапки батча (PL70) — кино-сдвиг (класс T4-30), вернуть позу из Spine"), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f == "P01: палитра контракта P25_VOID_EMBER ≠ шапки (P30_STEEL_MARKET)"), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f.starts_with(
            "P01: раса «Cat-kin» не работает в кадре — POS не несёт ни одного её токена ("
        ) && f.contains("закон №3: раса делает ФИЗИЧЕСКУЮ работу, не тег-бижутерию")), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f
            == "P01: стек контракта [CR-W01] ≠ Stack: [CR-B02] — потеряно: CR-W01 — лишнее: CR-B02"), "{:?}", r.findings);
        // PASS: контракта нет — честная заметка RAW/ручной сборки
        let r2 = gate_contract_fidelity(&b, None, None);
        assert_eq!((r2.verdict, r2.findings.as_slice()), ("PASS", &[][..]));
        assert_eq!(r2.notes, vec!["контракта нет — RAW/ручная сборка: верность контракту не проверяема".to_string()]);
        // PASS: контракт совпадает с шапкой
        let contract_ok = Contract {
            slots: vec![ContractSlot {
                position: 1,
                kind: "MAINS".into(),
                rating: "R".into(),
                pose: "PL70".into(),
                palette: "P30_STEEL_MARKET".into(),
                carriers: vec!["CR-B02".into()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let b2 = synth(
            "# T4-90 «x»\nP01 — a (VOLT · — · R · PL70 · P30_STEEL_MARKET)\nStack: CR-B02\nPOS:\nanime style, fluffy ears.\nNEG:\nchild\n",
        );
        assert_eq!(gate_contract_fidelity(&b2, Some(&contract_ok), None).verdict, "PASS");
    }

    #[test]
    fn bumps_quota_detect_and_pass() {
        let slot = |position: u32, channel: &str| ContractSlot {
            position,
            kind: "MAINS".into(),
            rating: "R+".into(),
            dress_channel: Some(channel.to_string()),
            ..Default::default()
        };
        // FAIL: 1 bumps из 5 R+-дресс-слотов (20% < 40%)
        let contract = Contract {
            slots: vec![
                slot(1, "bumps"),
                slot(2, "wet"),
                slot(3, "wet"),
                slot(4, "pantyline"),
                slot(5, "pantyline"),
            ],
            ..Default::default()
        };
        let r = gate_bumps_quota(Some(&contract));
        assert_eq!((r.gate, r.verdict), ("bumps-quota", "WARN"));
        assert_eq!(
            r.findings[0],
            "bumps-канал 1 из 5 R+-дресс-слотов (20%) < 40% — самый живой через-ткань сигнал недопредставлен (G17, №52-бэклог): канал бугорков должен получать ⌈0.4×R+⌉ слотов (генератор уже строит dark-минимум под квоту — пересобери контракт)"
        );
        // PASS: 3/5 = 60% ≥ 40%
        let contract_ok = Contract {
            slots: vec![
                slot(1, "bumps"),
                slot(2, "bumps"),
                slot(3, "bumps"),
                slot(4, "wet"),
                slot(5, "pantyline"),
            ],
            ..Default::default()
        };
        assert_eq!(gate_bumps_quota(Some(&contract_ok)).verdict, "PASS");
        // PASS: RAW/ручной батч без контракта не судим
        assert_eq!(gate_bumps_quota(None).verdict, "PASS");
    }

    #[test]
    fn raw_plus_conditional_gate() {
        // без маркера и без engine-контракта — гейт молчит (TS не пушит квитанцию)
        let plain = synth("# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style.\nNEG:\nchild\n");
        assert!(gate_raw_plus(&plain, None).is_none());
        // engine контракта — вторая дверь активации (урок T4-28 v1)
        let engine_contract = Contract { engine: Some("per-theme raw-plus".into()), ..Default::default() };
        let (r, _) = gate_raw_plus(&plain, Some(&engine_contract)).expect("engine raw-plus активирует гейт");
        assert_eq!(r.gate, "raw-plus");
        // маркер в H1 + слот без RAW+ канона — FAIL с дословными находками
        let b = synth("# T4-91 «x» — RAW+\nP01 — a (VOLT · — · R)\nPOS:\nanime style, girl.\nNEG:\nchild\n");
        let (r, expl) = gate_raw_plus(&b, None).expect("маркер RAW+ в H1");
        assert_eq!((r.gate, r.level, r.verdict), ("raw-plus", "hard", "FAIL"));
        assert!(expl.is_none(), "без ⚗ exploratory-квитанции быть не может");
        assert!(r.findings[0].starts_with("P1: палитра не назначена (нет в шапке, нет наследования по abPairs — specs/raw-plus.json, закон №23)"), "{}", r.findings[0]);
        assert!(r.findings.iter().any(|f| f.contains("нет face-блока (stylized 2D anime face — M17, приказ «концепция аниме-лиц»)")), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f.contains("нет ANTI-WASH в NEG (washed-out, faded colors, low contrast — Five Locks)")), "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f == "палитр в батче 0 < 7 (C066 — закон №23)"), "{:?}", r.findings);
    }

    #[test]
    fn raw_plus_pass_and_exploratory() {
        // PASS: 7 слотов RAW+-канона — палитра на слот, face-блок, свет, квалити
        let mut md = String::from("# T4-92 «Clean Raw Plus» — RAW+\n");
        let pals = [
            "P01_AURORA_DUSK", "P02_MIDNIGHT_ROSE", "P03_HARBOR_FOG", "P04_VELVET_INK",
            "P05_LANTERN_CREAM", "P06_STEEL_MIST", "P07_TIDE_PEARL",
        ];
        for (i, pal) in pals.iter().enumerate() {
            md.push_str(&format!(
                "P{:02} — raw-{i} (VOLT · — · R · {pal})\nPOS:\nstylized 2d anime face, anime eyes teal, small nose, small mouth, neon glow, masterpiece, best quality, anime artstyle.\nNEG:\nwashed-out, faded colors, low contrast, child\n",
                i + 1
            ));
        }
        let (r, expl) = gate_raw_plus(&synth(&md), None).expect("маркер RAW+ в H1");
        assert_eq!((r.gate, r.verdict, r.findings.as_slice()), ("raw-plus", "PASS", &[][..]), "{:?}", r.findings);
        assert!(expl.is_none());
        // ⚗-слот: нарушения — квитанцией raw-plus-exploratory (§10)
        let md2 = "# T4-93 «x» — RAW+\nP01 — a (VOLT · — · R) ⚗\nPOS:\nanime style, girl.\nNEG:\nchild\n";
        let (r2, expl2) = gate_raw_plus(&synth(md2), None).expect("маркер RAW+ в H1");
        let e = expl2.expect("⚗ обязан дать raw-plus-exploratory");
        assert_eq!((e.gate, e.level, e.verdict), ("raw-plus-exploratory", "warn", "WARN"));
        assert!(e.findings[0].starts_with("EXPLORATORY ⚗ (§10, квитанция): P1: палитра не назначена"), "{}", e.findings[0]);
        // main несёт только батч-уровень (палитры < 7), слотовые ушли в ⚗
        assert!(!r2.findings.iter().any(|f| f.starts_with("P1: ")), "{:?}", r2.findings);
        assert!(r2.findings.iter().any(|f| f == "палитр в батче 0 < 7 (C066 — закон №23)"), "{:?}", r2.findings);
    }
}
