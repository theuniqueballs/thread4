//! THREAD 4 ENGINE (RUST TWIN) — THEME EXPANSION (гейт №25).
//!
//! Приказ автора (2026-10-19, «Фаза 2»): модуль принимает тему и раскладывает
//! её на визуальные якоря (JSON); 25-й гейт проверяет adherence промпта теме.
//! Для EXP-батчей модуль и гейт ВЫКЛЮЧАЮТСЯ (тема не тянет EXP — болванки
//! чисты по вердикту T4-34).
//!
//! Доктрина (CONSTITUTION §2): детерминизм — якоря выводятся seed'ом
//! sha256(theme|slug|theme-expander/v1) → mulberry32, НО слова автора весят
//! больше кубика: лексикон (RU+EN) перехватывает измерение, если тема его
//! называет. Якоря живут ВНЕ канонического плана (byte-parity с bun-движком
//! неприкосновенна): они едут в ответе RPC, в «note»-событии scratch-летописи
//! и в живую консоль блоком «expand».

use sha2::{Digest, Sha256};

use crate::canon::FLOORS;

pub const THEME_GATE: &str = "theme";
pub const MODULE_VERSION: &str = "1.0.0";
pub const MIN_TOKENS: usize = 6;
pub const MAX_TOKENS: usize = 12;
pub const DEFAULT_MIN_ADHERENCE: f64 = 0.5;

/* ---------------- seed (тот же конвейер, что компилятор) ---------------- */

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
        ((t ^ (t >> 14)) as u32) as f64 / 4_294_967_296.0
    }
}

fn pick<'a>(rng: &mut impl FnMut() -> f64, pool: &[&'a str]) -> &'a str {
    pool[((rng)() * pool.len() as f64) as usize % pool.len()]
}

fn pick_n<'a>(rng: &mut impl FnMut() -> f64, pool: &[&'a str], n: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut guard = 0;
    while out.len() < n && guard < pool.len() * 4 {
        guard += 1;
        let v = pick(rng, pool);
        if !out.iter().any(|x| x == v) {
            out.push(v.to_string());
        }
    }
    out
}

/* ---------------- якорные пулы (canon-стиль, происхождение в комментарии) ---------------- */
/* Пулы чисты от вечных флоров: свечи/лампы/факелы и лоли-токены в якорях */
/* запрещены конструктивно — гейт всё равно проверяет (авторские правки).  */

const LOCALES: &[&str] = &[
    "urban rooftop", "old library", "hot springs", "night market",
    "summer beach", "abandoned chapel", "glass gallery", "deep forest",
    "luxury train", "snowy street", "lakeside pier", "greenhouse",
];

const TIMES: &[&str] = &[
    "golden hour", "blue hour", "deep night", "overcast noon",
    "rainy dusk", "first light", "neon midnight", "misty morning",
];

const LIGHTS: &[&str] = &[
    "rim light", "soft window light", "hard side light",
    "backlit haze", "moon glow", "practical neon",
];

const PALETTE_MOODS: &[&str] = &[
    "ash & ember", "sea glass & driftwood", "ink & gold leaf",
    "orchid dusk", "moss & honey", "smoke & clementine",
    "plum & pewter", "bone & madder red",
];

const MOTIFS: &[&str] = &[
    "scattered petals", "torn letter paper", "koi shadows",
    "silver thread seams", "broken porcelain", "warm rain streaks",
    "wind-bent grass", "distant bell echo", "hushed fog banks", "spilled ink",
];

const WARDROBES: &[&str] = &[
    "layered knits", "tailored uniforms", "flowing silhouettes",
    "structured denim", "athletic mesh", "vintage lacework",
    "monastic wraps", "evening drapery",
];

const POSE_FAMILIES: &[&str] = &[
    "mid-motion lean", "seated contrapposto", "back-turned glance",
    "sprawled rest", "close whisper frame", "arched stretch",
];

const CAMERAS: &[&str] = &[
    "35mm intimate", "50mm neutral", "85mm portrait compression",
    "wide establishing", "overhead crane",
];

const ATMOSPHERES: &[&str] = &[
    "hushed", "electric", "tender", "stormy",
    "lazy", "ceremonial", "clandestine", "celebratory",
];

/* ---------------- лексикон: слово автора весит больше кубика ---------------- */
/* (RU+EN ключи; срабатывание перехватывает измерение у seed'а)             */

const LEXICON: &[(&[&str], &str, &str)] = &[
    (&["ночь", "полночь", "night", "midnight"], "timeOfDay", "deep night"),
    (&["закат", "sunset", "вечер", "evening"], "timeOfDay", "golden hour"),
    (&["сумерки", "dusk", "twilight"], "timeOfDay", "blue hour"),
    (&["утро", "morning", "рассвет", "dawn"], "timeOfDay", "misty morning"),
    (&["полдень", "noon", "midi"], "timeOfDay", "overcast noon"),
    (&["дождь", "rain", "ливень", "гроза", "storm"], "atmosphere", "stormy"),
    (&["тих", "hush", "спокой", "calm"], "atmosphere", "hushed"),
    (&["праздник", "party", "festival"], "atmosphere", "celebratory"),
    (&["тайна", "secret", "mystery", " clandestine"], "atmosphere", "clandestine"),
    (&["лень", "lazy", "сонн", "drowsy"], "atmosphere", "lazy"),
    (&["нежн", "tender", "мягк"], "atmosphere", "tender"),
    (&["город", "city", "улиц", "street"], "locale", "urban rooftop"),
    (&["лес", "forest", "рощ"], "locale", "deep forest"),
    (&["море", "sea", "beach", "пляж", "океан", "ocean"], "locale", "summer beach"),
    (&["поезд", "train"], "locale", "luxury train"),
    (&["зима", "winter", "снег", "snow"], "locale", "snowy street"),
    (&["школ", "school", "академ", "academy"], "locale", "old library"),
    (&["храм", "chapel", "church"], "locale", "abandoned chapel"),
    (&["сад", "garden", "теплиц", "greenhouse"], "locale", "greenhouse"),
    (&["озер", "lake", "pier", "причал"], "locale", "lakeside pier"),
    (&["рынок", "market", "базар"], "locale", "night market"),
    (&["бассейн", "pool", "источник", "springs"], "locale", "hot springs"),
];

fn lexicon_scan(theme_lower: &str) -> Vec<(String, String, String)> {
    let mut hits = Vec::new();
    for (keys, field, value) in LEXICON.iter() {
        for k in keys.iter() {
            let k = k.trim();
            if !k.is_empty() && theme_lower.contains(k) {
                hits.push((k.to_string(), field.to_string(), value.to_string()));
                break;
            }
        }
    }
    hits
}

/* ---------------- якоря ---------------- */

#[derive(Clone, Debug, PartialEq)]
pub struct ThemeAnchors {
    pub theme: String,
    pub slug: String,
    pub locale: String,
    pub time_of_day: String,
    pub light: String,
    pub palette_mood: String,
    pub motifs: Vec<String>,
    pub wardrobe_family: String,
    pub pose_family: String,
    pub camera: String,
    pub atmosphere: Vec<String>,
    pub lexicon_hits: Vec<String>,
    pub seed: String,
}

impl ThemeAnchors {
    /// Токены для гейта adherence: компактные, ≥3 симв., уникальные.
    pub fn tokens(&self) -> Vec<String> {
        let mut tokens: Vec<String> = Vec::new();
        let push = |v: &str, out: &mut Vec<String>| {
            let v = v.trim().to_lowercase();
            if v.chars().count() >= 3 && !out.iter().any(|x: &String| x == &v) {
                out.push(v);
            }
        };
        push(&self.locale, &mut tokens);
        push(&self.time_of_day, &mut tokens);
        push(&self.light, &mut tokens);
        push(&self.palette_mood, &mut tokens);
        for m in &self.motifs {
            push(m, &mut tokens);
        }
        push(&self.wardrobe_family, &mut tokens);
        push(&self.pose_family, &mut tokens);
        push(&self.camera, &mut tokens);
        for a in &self.atmosphere {
            push(a, &mut tokens);
        }
        tokens
    }

    pub fn to_json(&self, min_adherence: f64) -> serde_json::Value {
        serde_json::json!({
            "module": "theme-expansion",
            "version": MODULE_VERSION,
            "theme": self.theme,
            "slug": self.slug,
            "locale": self.locale,
            "timeOfDay": self.time_of_day,
            "light": self.light,
            "paletteMood": self.palette_mood,
            "motifs": self.motifs,
            "wardrobeFamily": self.wardrobe_family,
            "poseFamily": self.pose_family,
            "camera": self.camera,
            "atmosphere": self.atmosphere,
            "tokens": self.tokens(),
            "lexiconHits": self.lexicon_hits,
            "minAdherence": clamp_adherence(min_adherence),
            "seed": self.seed,
        })
    }

    /// Восстановление из JSON (правки автора) со strict-валидацией полей.
    pub fn from_json(v: &serde_json::Value, theme: &str, slug: &str) -> Result<(ThemeAnchors, f64), String> {
        let obj = v
            .as_object()
            .ok_or("themeAnchors: должен быть JSON-объектом (strict)")?;
        const ALLOWED: &[&str] = &[
            "module", "version", "theme", "slug",
            "locale", "timeOfDay", "light", "paletteMood", "motifs",
            "wardrobeFamily", "poseFamily", "camera", "atmosphere",
            "tokens", "lexiconHits", "minAdherence", "seed",
        ];
        for k in obj.keys() {
            if !ALLOWED.contains(&k.as_str()) {
                return Err(format!("themeAnchors: лишнее поле «{k}» (strict)"));
            }
        }
        let get_str = |k: &str| -> Result<String, String> {
            obj.get(k)
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("themeAnchors: «{k}» обязателен (непустая строка)"))
        };
        let get_vec = |k: &str| -> Result<Vec<String>, String> {
            obj.get(k)
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<String>>()
                })
                .filter(|v| !v.is_empty())
                .ok_or_else(|| format!("themeAnchors: «{k}» — непустой массив строк"))
        };
        let anchors = ThemeAnchors {
            theme: theme.to_string(),
            slug: slug.to_string(),
            locale: get_str("locale")?,
            time_of_day: get_str("timeOfDay")?,
            light: get_str("light")?,
            palette_mood: get_str("paletteMood")?,
            motifs: get_vec("motifs")?,
            wardrobe_family: get_str("wardrobeFamily")?,
            pose_family: get_str("poseFamily")?,
            camera: get_str("camera")?,
            atmosphere: get_vec("atmosphere")?,
            lexicon_hits: obj
                .get("lexiconHits")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            seed: obj
                .get("seed")
                .and_then(|x| x.as_str())
                .unwrap_or("author-edited")
                .to_string(),
        };
        let min_adherence = obj
            .get("minAdherence")
            .and_then(|x| x.as_f64())
            .unwrap_or(DEFAULT_MIN_ADHERENCE);
        Ok((anchors, clamp_adherence(min_adherence)))
    }
}

fn clamp_adherence(v: f64) -> f64 {
    if !v.is_finite() {
        return DEFAULT_MIN_ADHERENCE;
    }
    v.clamp(0.25, 0.9)
}

fn seed_hex(theme: &str, slug: &str) -> String {
    let mut h = Sha256::new();
    h.update(format!("{theme}|{slug}|theme-expander/v{MODULE_VERSION}"));
    let d = h.finalize();
    d.iter().take(8).map(|b| format!("{:02x}", b)).collect()
}

/// Раскладка темы на якоря. `exp > 0` → None: EXP-батчи живут без темы
/// (приказ автора; гейт №25 для EXP выключен).
pub fn expand(theme: &str, slug: &str, exp: u32) -> Option<ThemeAnchors> {
    if exp > 0 {
        return None;
    }
    let seed = seed_hex(theme, slug);
    let mut rng = mulberry32(hash_seed(&format!("{theme}|{slug}|theme-expander/v{MODULE_VERSION}")));
    let theme_lower = theme.to_lowercase();
    let hits = lexicon_scan(&theme_lower);
    let override_field = |field: &str| -> Option<String> {
        hits.iter()
            .find(|(_, f, _)| f == field)
            .map(|(_, _, v)| v.clone())
    };

    let atmosphere: Vec<String> = {
        let mut a = pick_n(&mut rng, ATMOSPHERES, 2);
        if let Some(v) = override_field("atmosphere") {
            a.insert(0, v);
            a.truncate(2);
        }
        a
    };

    Some(ThemeAnchors {
        theme: theme.to_string(),
        slug: slug.to_string(),
        locale: override_field("locale").unwrap_or_else(|| pick(&mut rng, LOCALES).to_string()),
        time_of_day: override_field("timeOfDay").unwrap_or_else(|| pick(&mut rng, TIMES).to_string()),
        light: pick(&mut rng, LIGHTS).to_string(),
        palette_mood: pick(&mut rng, PALETTE_MOODS).to_string(),
        motifs: pick_n(&mut rng, MOTIFS, 3),
        wardrobe_family: pick(&mut rng, WARDROBES).to_string(),
        pose_family: pick(&mut rng, POSE_FAMILIES).to_string(),
        camera: pick(&mut rng, CAMERAS).to_string(),
        atmosphere,
        lexicon_hits: hits.iter().map(|(k, f, v)| format!("{k}→{f}={v}")).collect(),
        seed,
    })
}

/* ---------------- гейт №25 ---------------- */

#[derive(Clone, Debug)]
pub struct ThemeReceipt {
    pub gate: &'static str,
    pub level: &'static str,
    pub verdict: &'static str,
    pub findings: Vec<String>,
    pub notes: Vec<String>,
}

impl ThemeReceipt {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "gate": self.gate,
            "level": self.level,
            "verdict": self.verdict,
            "findings": self.findings,
            "notes": self.notes,
        })
    }
}

/// EXP-батч: модуль и гейт выключены (приказ автора) — честная квитанция OFF.
pub fn exp_off_receipt() -> ThemeReceipt {
    ThemeReceipt {
        gate: THEME_GATE,
        level: "hard",
        verdict: "OFF",
        findings: Vec::new(),
        notes: vec![
            "EXP-батч — Theme Expansion и гейт №25 выключены (приказ автора)".into(),
        ],
    }
}

/// Гейт темы уровня ПЛАНА (compile-time): якоря честны против вечных
/// флоров, бюджет токенов держится, OC-темы не спорят с якорями.
pub fn plan_gate(anchors: &ThemeAnchors, oc_themes: &[String], exp: u32) -> ThemeReceipt {
    if exp > 0 {
        return ThemeReceipt {
            gate: THEME_GATE,
            level: "hard",
            verdict: "OFF",
            findings: Vec::new(),
            notes: vec![
                "EXP-батч — Theme Expansion и гейт №25 выключены (приказ автора)".into(),
            ],
        };
    }
    let mut findings = Vec::new();
    let mut notes = Vec::new();

    // 1) вечные флоры: якорь не имеет права проносить баны в промпты
    let all = anchors.tokens();
    'outer: for token in &all {
        let t = token.to_lowercase();
        for (group, bans) in FLOORS.iter() {
            for ban in bans.iter() {
                if t.contains(&ban.to_lowercase()) {
                    findings.push(format!(
                        "theme/флоры: якорь «{token}» проносит вечный бан «{ban}» ({group}) — расширь тему"
                    ));
                    break 'outer;
                }
            }
        }
    }

    // 2) бюджет токенов
    if all.len() < MIN_TOKENS {
        findings.push(format!(
            "theme: якорей-токенов {} < {MIN_TOKENS} — тема не раскрыта",
            all.len()
        ));
    }
    if all.len() > MAX_TOKENS {
        findings.push(format!(
            "theme: якорей-токенов {} > {MAX_TOKENS} — перегруз, режь",
            all.len()
        ));
    }

    // 3) OC-темы не спорят с якорями (лексикон против якорного измерения)
    for oc in oc_themes {
        let hits = lexicon_scan(&oc.to_lowercase());
        for (_, field, value) in hits {
            let anchored = match field.as_str() {
                "timeOfDay" => Some(&anchors.time_of_day),
                "locale" => Some(&anchors.locale),
                "atmosphere" => anchors.atmosphere.first(),
                _ => None,
            };
            if let Some(a) = anchored {
                if a.to_lowercase() != value.to_lowercase() {
                    findings.push(format!(
                        "theme: OC-тема «{oc}» тянет {field} «{value}», якорь держит «{a}» — противоречие"
                    ));
                }
            }
        }
    }

    notes.push(format!(
        "якорей {} · токенов {} · minAdherence {:.0}%",
        10,
        all.len(),
        DEFAULT_MIN_ADHERENCE * 100.0
    ));
    ThemeReceipt {
        gate: THEME_GATE,
        level: "hard",
        verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
        findings,
        notes,
    }
}

/// Гейт темы уровня ТЕКСТА (scribe-time / review): adherence промпта якорям.
pub fn text_gate(text: &str, anchors: &ThemeAnchors, min_adherence: f64) -> ThemeReceipt {
    if text.trim().is_empty() {
        return ThemeReceipt {
            gate: THEME_GATE,
            level: "hard",
            verdict: "FAIL",
            findings: vec!["theme/adherence: текст пуст — проверять нечего".into()],
            notes: Vec::new(),
        };
    }
    let lower = text.to_lowercase();
    let tokens = anchors.tokens();
    let held: Vec<&String> = tokens.iter().filter(|t| lower.contains(t.as_str())).collect();
    let ratio = if tokens.is_empty() { 0.0 } else { held.len() as f64 / tokens.len() as f64 };
    let min = clamp_adherence(min_adherence);
    let mut findings = Vec::new();
    if ratio < min {
        findings.push(format!(
            "theme/adherence: текст держит {}/{} якорей ({:.0}%) — нужно ≥ {:.0}%",
            held.len(),
            tokens.len(),
            ratio * 100.0,
            min * 100.0
        ));
    }
    ThemeReceipt {
        gate: THEME_GATE,
        level: "hard",
        verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
        findings,
        notes: vec![format!(
            "держит: {}",
            if held.is_empty() {
                "—".to_string()
            } else {
                held.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ")
            }
        )],
    }
}

/* ---------------- тесты (battery: theme-12) ---------------- */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_deterministic() {
        let a = expand("rainy night at the old harbor", "T4-42", 0).unwrap();
        let b = expand("rainy night at the old harbor", "T4-42", 0).unwrap();
        assert_eq!(a, b, "якоря обязаны быть детерминированными (seed от темы)");
    }

    #[test]
    fn expand_seed_depends_on_slug() {
        let a = expand("storm over the city", "T4-42", 0).unwrap();
        let b = expand("storm over the city", "T4-43", 0).unwrap();
        assert_ne!(a.seed, b.seed, "другой слаг — другой сид");
    }

    #[test]
    fn expand_exp_off() {
        assert!(expand("тема", "T4-99", 8).is_none(), "EXP-батч: модуль выключен");
    }

    #[test]
    fn lexicon_overrides_seed() {
        let a = expand("полночь на крыше", "T4-42", 0).unwrap();
        assert_eq!(a.time_of_day, "deep night", "слово автора весит больше кубика");
        assert!(!a.lexicon_hits.is_empty());
    }

    #[test]
    fn lexicon_locale_ru() {
        let a = expand("зима у озера", "T4-43", 0).unwrap();
        assert_eq!(a.locale, "snowy street");
    }

    #[test]
    fn tokens_dedup_and_len() {
        let a = expand("morning garden tea", "T4-42", 0).unwrap();
        let t = a.tokens();
        assert!(t.iter().all(|x| x.chars().count() >= 3));
        let mut seen = std::collections::HashSet::new();
        assert!(t.iter().all(|x| seen.insert(x.clone())), "токены уникальны");
    }

    #[test]
    fn plan_gate_exp_off_receipt() {
        let a = expand("тема", "T4-42", 0).unwrap();
        let r = plan_gate(&a, &[], 8);
        assert_eq!(r.verdict, "OFF");
        assert!(r.notes.iter().any(|n| n.contains("EXP-батч")));
    }

    #[test]
    fn plan_gate_clean_pass() {
        let a = expand("тихое утро в саду", "T4-42", 0).unwrap();
        let r = plan_gate(&a, &[], 0);
        assert_eq!(r.verdict, "PASS", "findings: {:?}", r.findings);
    }

    #[test]
    fn plan_gate_floor_smuggle_caught() {
        let mut a = expand("ночь", "T4-42", 0).unwrap();
        a.motifs = vec!["candle smoke".into(), "warm rain streaks".into(), "koi shadows".into()];
        let r = plan_gate(&a, &[], 0);
        assert_eq!(r.verdict, "FAIL");
        assert!(r.findings.iter().any(|f| f.contains("вечный бан")));
    }

    #[test]
    fn plan_gate_oc_contradiction() {
        let a = expand("полночь в городе", "T4-42", 0).unwrap(); // time = deep night
        let r = plan_gate(&a, &["sunny noon picnic".into()], 0);
        assert_eq!(r.verdict, "FAIL");
        assert!(r.findings.iter().any(|f| f.contains("противоречие")));
    }

    #[test]
    fn text_gate_pass() {
        let a = expand("dawn at the lake", "T4-42", 0).unwrap();
        let held = a.tokens().iter().take(4).cloned().collect::<Vec<_>>().join(" ");
        let r = text_gate(&held, &a, 0.25);
        assert_eq!(r.verdict, "PASS", "findings: {:?}", r.findings);
    }

    #[test]
    fn text_gate_fail_below_min() {
        let a = expand("dawn at the lake", "T4-42", 0).unwrap();
        let r = text_gate("совсем другой текст без якорей", &a, 0.5);
        assert_eq!(r.verdict, "FAIL");
        assert!(r.findings.iter().any(|f| f.contains("adherence")));
    }

    #[test]
    fn anchors_json_roundtrip() {
        let a = expand("stormy night market", "T4-42", 0).unwrap();
        let j = a.to_json(DEFAULT_MIN_ADHERENCE);
        let (b, min) = ThemeAnchors::from_json(&j, &a.theme, &a.slug).unwrap();
        assert_eq!(a, b);
        assert_eq!(min, DEFAULT_MIN_ADHERENCE);
    }

    #[test]
    fn anchors_strict_rejects_unknown_field() {
        let a = expand("тема", "T4-42", 0).unwrap();
        let mut j = a.to_json(DEFAULT_MIN_ADHERENCE);
        j["hack"] = serde_json::json!(true);
        assert!(ThemeAnchors::from_json(&j, &a.theme, &a.slug).is_err());
    }

    #[test]
    fn pools_floor_clean() {
        // конструктивная чистота пулов: сами якорные пулы не проносят баны
        let all: Vec<&str> = LOCALES
            .iter()
            .chain(TIMES.iter())
            .chain(LIGHTS.iter())
            .chain(PALETTE_MOODS.iter())
            .chain(MOTIFS.iter())
            .chain(WARDROBES.iter())
            .chain(POSE_FAMILIES.iter())
            .chain(CAMERAS.iter())
            .chain(ATMOSPHERES.iter())
            .copied()
            .collect();
        for v in all {
            let lv = v.to_lowercase();
            for (_, bans) in FLOORS.iter() {
                for ban in bans.iter() {
                    assert!(
                        !lv.contains(&ban.to_lowercase()),
                        "пул-якорь «{v}» содержит бан «{ban}»"
                    );
                }
            }
        }
    }
}
