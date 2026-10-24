//! ARS NOVEAU — раскры́ватель темы новой эры (приказ автора 2026-10-23).
//!
//! Концепт (docs/ARS-NOVEAU-2026-10-23.md): по каждой теме строится
//! 21 ОТДЕЛЬНАЯ история мейн-пула (одна история = один слот = один способ,
//! которым тема раскрывает себя в ЭТОМ кадре) + 3 истории ОС + EXP-идеи
//! ВНЕ темы. Раскрыватель думает через мост (LLM-провайдер писца) — он же
//! изобретает спайн батча (движок/теза/акты/тема-слова): отдельный этап
//! «Сборка» упразднён, спайн рождается здесь.
//!
//! Доктрина (CONSTITUTION §2/§3): истории живут ВНЕ канонического плана
//! (byte-parity sha10 неприкосновенна) — артефакт этапа хранится в
//! data/rehearsals/ars/<slug>.json, экспозиция для автора — .md рядом.
//! Правки автора — strict-JSON (наследие theme-эры: слово автора весит
//! больше кубика, теперь — больше модели).
//!
//! Гейты: план (структура/микс/полнота/флоры/чистота EXP/уникальность
//! thesis) — до компиляции; текст (adherence историй, гейт №25
//! преемственен) — в батарее писца.

use sha2::{Digest, Sha256};

use crate::compile::Receipt;

pub const ARS_GATE: &str = "ars";
pub const MODULE_VERSION: &str = "1.0.0";
/// Текстовый гейт наследует имя «theme» (№25) — летопись и UI продолжают
/// видеть знакомый ключ, семантика сменилась: adherence ИСТОРИЯМ слотов.
pub const ADHERENCE_GATE: &str = "theme";
pub const DEFAULT_MIN_ADHERENCE: f64 = 0.6;

/* ---------------- жанровый микс (policy.ars.mix, §2) ---------------- */

/// Микс историй мейнов. Единственная правда — specs/policy.json
/// (law + ars.mix); константа — фолбэк, когда спек не читается.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mix {
    pub mains: usize,
    pub ocs: usize,
    pub niche_min: usize,
    pub niche_max: usize,
    pub exquisite_min: usize,
    pub exquisite_max: usize,
}

pub const DEFAULT_MIX: Mix = Mix {
    mains: 21,
    ocs: 3,
    niche_min: 5,
    niche_max: 8,
    exquisite_min: 1,
    exquisite_max: 4,
};

impl Mix {
    /// Читается из specs/policy.json → ars.mix (§2: одна правда на факт).
    pub fn from_policy() -> Mix {
        let path = crate::textgates::specs_dir().join("policy.json");
        let v = crate::textgates::read_json(&path);
        let g = |k: &str, d: usize| {
            v.as_ref()
                .and_then(|p| p.get("ars"))
                .and_then(|a| a.get("mix"))
                .and_then(|m| m.get(k))
                .and_then(|x| x.as_u64())
                .map(|n| n as usize)
                .unwrap_or(d)
        };
        Mix {
            mains: g("mains", DEFAULT_MIX.mains),
            ocs: g("ocs", DEFAULT_MIX.ocs),
            niche_min: g("niche_min", DEFAULT_MIX.niche_min),
            niche_max: g("niche_max", DEFAULT_MIX.niche_max),
            exquisite_min: g("exquisite_min", DEFAULT_MIX.exquisite_min),
            exquisite_max: g("exquisite_max", DEFAULT_MIX.exquisite_max),
        }
    }
}

/* ---------------- истории ---------------- */

pub const MAIN_GENRES: [&str; 3] = ["NICHE", "VOLT", "EXQUISITE"];
pub const EXP_KINDS: [&str; 5] = ["niche-concept", "pose", "garment", "kin", "oc"];
pub const MAX_EXP_IDEAS: usize = 9;

/// Одна история слота: ВСЁ, что должно быть в итоговом рендере.
#[derive(Clone, Debug, PartialEq)]
pub struct ArsStory {
    /// Позиция внутри своего пула: мейны 1..21, ОС 1..3.
    pub position: u32,
    /// NICHE | VOLT | EXQUISITE (мейн) | OC (ос-история).
    pub genre: String,
    /// Имя истории (2–4 слова, для автора).
    pub title: String,
    /// ЧТО тема раскрывает именно в этом слоте.
    pub reveal: String,
    /// Сцена: что происходит в кадре.
    pub scene: String,
    /// Окружение: место, предметы, физика мира.
    pub environment: String,
    /// Вайб: настроение кадра (drawable-подача).
    pub vibe: String,
    /// Освещение: источник, направление, характер.
    pub lighting: String,
    /// Идея позы — НАПРАВЛЕНИЕ; финальную позу назначит компилятор.
    pub pose_idea: String,
    /// Концепт аутфита; тон/канал/состояние назначит Дрессер (№28/№29).
    pub outfit: String,
    /// Персонаж: волосы/строение/кожа/раса-механика (ОС — подача канона).
    pub character: String,
    /// Объект-свидетель — третий глаз кадра (опц.).
    pub witness: Option<String>,
    /// Требование ULTIMATE DICE: ритм/структура тег-рана (опц.).
    pub dice: Option<String>,
    /// Закон кадра одной строкой — зерно THESIS писца.
    pub thesis: String,
}

/// EXP-идея: ВНЕ темы, только проверка на успех (policy.ars.exp_outside_theme).
#[derive(Clone, Debug, PartialEq)]
pub struct ArsExpIdea {
    pub id: u32,
    /// niche-concept | pose | garment | kin | oc.
    pub kind: String,
    /// Что проверяем (одной строкой, drawable).
    pub hypothesis: String,
    /// Единственная переменная A/B (что меняем между половинами).
    pub variables: String,
}

/// Артефакт ARS NOVEAU: спайн + 21 история + 3 ОС + EXP-идеи.
#[derive(Clone, Debug, PartialEq)]
pub struct ArsBuild {
    pub slug: String,
    pub theme: String,
    pub engine_name: String,
    pub engine_law: String,
    pub batch_thesis: String,
    pub acts: Vec<String>,
    pub theme_keywords: Vec<String>,
    pub mains: Vec<ArsStory>,
    pub ocs: Vec<ArsStory>,
    pub exp: Vec<ArsExpIdea>,
    pub seed: String,
}

/* ---------------- strict JSON (правки автора) ---------------- */

const STORY_ALLOWED: &[&str] = &[
    "position", "genre", "title", "reveal", "scene", "environment", "vibe",
    "lighting", "poseIdea", "outfit", "character", "witness", "dice", "thesis",
];

impl ArsStory {
    pub fn from_json(v: &serde_json::Value, default_pos: u32) -> Result<ArsStory, String> {
        let obj = v
            .as_object()
            .ok_or("ars: история обязана быть JSON-объектом (strict)")?;
        for k in obj.keys() {
            if !STORY_ALLOWED.contains(&k.as_str()) {
                return Err(format!("ars: в истории лишнее поле «{k}» (strict)"));
            }
        }
        let get_str = |k: &str| -> Result<String, String> {
            obj.get(k)
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("ars: поле истории «{k}» обязательно (непустая строка)"))
        };
        let genre = get_str("genre")?;
        let ok_genre = MAIN_GENRES.contains(&genre.as_str()) || genre == "OC";
        if !ok_genre {
            return Err(format!(
                "ars: жанр «{genre}» вне словаря (NICHE|VOLT|EXQUISITE|OC)"
            ));
        }
        Ok(ArsStory {
            position: obj
                .get("position")
                .and_then(|x| x.as_u64())
                .map(|n| n as u32)
                .unwrap_or(default_pos),
            genre,
            title: get_str("title")?,
            reveal: get_str("reveal")?,
            scene: get_str("scene")?,
            environment: get_str("environment")?,
            vibe: get_str("vibe")?,
            lighting: get_str("lighting")?,
            pose_idea: get_str("poseIdea")?,
            outfit: get_str("outfit")?,
            character: get_str("character")?,
            witness: obj
                .get("witness")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            dice: obj
                .get("dice")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            thesis: get_str("thesis")?,
        })
    }

    pub fn to_json(&self) -> serde_json::Value {
        let mut m = serde_json::Map::new();
        m.insert("position".into(), self.position.into());
        m.insert("genre".into(), self.genre.as_str().into());
        m.insert("title".into(), self.title.as_str().into());
        m.insert("reveal".into(), self.reveal.as_str().into());
        m.insert("scene".into(), self.scene.as_str().into());
        m.insert("environment".into(), self.environment.as_str().into());
        m.insert("vibe".into(), self.vibe.as_str().into());
        m.insert("lighting".into(), self.lighting.as_str().into());
        m.insert("poseIdea".into(), self.pose_idea.as_str().into());
        m.insert("outfit".into(), self.outfit.as_str().into());
        m.insert("character".into(), self.character.as_str().into());
        if let Some(w) = &self.witness {
            m.insert("witness".into(), w.as_str().into());
        }
        if let Some(d) = &self.dice {
            m.insert("dice".into(), d.as_str().into());
        }
        m.insert("thesis".into(), self.thesis.as_str().into());
        serde_json::Value::Object(m)
    }

    /// Поля истории одной строкой — для флоров/токенов.
    fn all_text(&self) -> String {
        format!(
            "{} {} {} {} {} {} {} {} {} {} {} {} {}",
            self.title, self.reveal, self.scene, self.environment, self.vibe,
            self.lighting, self.pose_idea, self.outfit, self.character,
            self.witness.clone().unwrap_or_default(),
            self.dice.clone().unwrap_or_default(),
            self.thesis, self.genre,
        )
        .to_lowercase()
    }
}

impl ArsExpIdea {
    pub fn from_json(v: &serde_json::Value, default_id: u32) -> Result<ArsExpIdea, String> {
        let obj = v
            .as_object()
            .ok_or("ars: EXP-идея обязана быть JSON-объектом (strict)")?;
        for k in obj.keys() {
            if !["id", "kind", "hypothesis", "variables"].contains(&k.as_str()) {
                return Err(format!("ars: в EXP-идее лишнее поле «{k}» (strict)"));
            }
        }
        let get_str = |k: &str| -> Result<String, String> {
            obj.get(k)
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("ars: поле EXP-идеи «{k}» обязательно"))
        };
        let kind = get_str("kind")?;
        if !EXP_KINDS.contains(&kind.as_str()) {
            return Err(format!(
                "ars: kind EXP-идеи «{kind}» вне словаря ({})",
                EXP_KINDS.join("|")
            ));
        }
        Ok(ArsExpIdea {
            id: obj
                .get("id")
                .and_then(|x| x.as_u64())
                .map(|n| n as u32)
                .unwrap_or(default_id),
            kind,
            hypothesis: get_str("hypothesis")?,
            variables: get_str("variables")?,
        })
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "kind": self.kind,
            "hypothesis": self.hypothesis,
            "variables": self.variables,
        })
    }
}

const BUILD_ALLOWED: &[&str] = &[
    "module", "version", "slug", "theme",
    "engineName", "engineLaw", "thesis", "acts", "themeKeywords",
    "mains", "ocs", "exp", "seed",
];

impl ArsBuild {
    /// Восстановление из JSON (выход моста или правки автора), strict.
    pub fn from_json(v: &serde_json::Value, theme: &str, slug: &str) -> Result<ArsBuild, String> {
        let obj = v
            .as_object()
            .ok_or("ars: артефакт обязан быть JSON-объектом (strict)")?;
        for k in obj.keys() {
            if !BUILD_ALLOWED.contains(&k.as_str()) {
                return Err(format!("ars: в артефакте лишнее поле «{k}» (strict)"));
            }
        }
        let get_str = |k: &str| -> Result<String, String> {
            obj.get(k)
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("ars: «{k}» обязателен (непустая строка)"))
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
                .ok_or_else(|| format!("ars: «{k}» — непустой массив строк"))
        };
        let stories = |k: &str| -> Result<Vec<ArsStory>, String> {
            obj.get(k)
                .and_then(|x| x.as_array())
                .ok_or_else(|| format!("ars: «{k}» — массив историй"))?
                .iter()
                .enumerate()
                .map(|(i, s)| ArsStory::from_json(s, i as u32 + 1))
                .collect()
        };
        let exp = obj
            .get("exp")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .enumerate()
                    .map(|(i, s)| ArsExpIdea::from_json(s, i as u32 + 1))
                    .collect::<Result<Vec<_>, _>>()
            })
            .unwrap_or_else(|| Ok(Vec::new()))?;
        if exp.len() > MAX_EXP_IDEAS {
            return Err(format!("ars: EXP-идей {} > {MAX_EXP_IDEAS} (expSlotsMax)", exp.len()));
        }
        Ok(ArsBuild {
            slug: slug.to_string(),
            theme: theme.to_string(),
            engine_name: get_str("engineName")?,
            engine_law: get_str("engineLaw")?,
            batch_thesis: get_str("thesis")?,
            acts: get_vec("acts")?,
            theme_keywords: get_vec("themeKeywords")?,
            mains: stories("mains")?,
            ocs: stories("ocs")?,
            exp,
            seed: obj
                .get("seed")
                .and_then(|x| x.as_str())
                .unwrap_or("author-edited")
                .to_string(),
        })
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "module": "ars-nouveau",
            "version": MODULE_VERSION,
            "slug": self.slug,
            "theme": self.theme,
            "engineName": self.engine_name,
            "engineLaw": self.engine_law,
            "thesis": self.batch_thesis,
            "acts": self.acts,
            "themeKeywords": self.theme_keywords,
            "mains": self.mains.iter().map(|s| s.to_json()).collect::<Vec<_>>(),
            "ocs": self.ocs.iter().map(|s| s.to_json()).collect::<Vec<_>>(),
            "exp": self.exp.iter().map(|e| e.to_json()).collect::<Vec<_>>(),
            "seed": self.seed,
        })
    }

    /// Сид детерминизма: якорь репродукции для правок автора.
    pub fn seed_of(theme: &str, slug: &str) -> String {
        let mut h = Sha256::new();
        h.update(format!("{theme}|{slug}|ars-nouveau/v{MODULE_VERSION}"));
        let d = h.finalize();
        d.iter().take(8).map(|b| format!("{b:02x}")).collect()
    }

    /// Экспозиция автору (§12: структурная экспозиция ДО батча).
    pub fn markdown(&self) -> String {
        let mut l = Vec::new();
        l.push(format!("# ARS NOVEAU — {} «{}»", self.slug, self.theme));
        l.push(String::new());
        l.push(format!("**Движок**: {} — {}", self.engine_name, self.engine_law));
        l.push(String::new());
        l.push(self.batch_thesis.trim().to_string());
        l.push(String::new());
        if !self.theme_keywords.is_empty() {
            l.push(format!("ТЕМА-СЛОВА: {}", self.theme_keywords.join(", ")));
        }
        if !self.acts.is_empty() {
            l.push(format!("АКТЫ: I {} · II {} · III {}", self.acts[0], self.acts.get(1).map(|s| s.as_str()).unwrap_or("—"), self.acts.get(2).map(|s| s.as_str()).unwrap_or("—")));
        }
        l.push(String::new());
        l.push(format!("## 21 история мейн-пула"));
        for s in &self.mains {
            l.push(String::new());
            l.push(format!(
                "**S{:02} · {} · {}** — {}",
                s.position, s.genre, s.title, s.thesis
            ));
            l.push(format!("- reveal: {}", s.reveal));
            l.push(format!("- сцена: {} | окружение: {}", s.scene, s.environment));
            l.push(format!("- вайб: {} | свет: {}", s.vibe, s.lighting));
            l.push(format!("- поза: {} | одежда: {}", s.pose_idea, s.outfit));
            l.push(format!("- персонаж: {}", s.character));
            if let Some(w) = &s.witness {
                l.push(format!("- свидетель: {w}"));
            }
            if let Some(d) = &s.dice {
                l.push(format!("- dice: {d}"));
            }
        }
        l.push(String::new());
        l.push(format!("## 3 истории ОС"));
        for s in &self.ocs {
            l.push(String::new());
            l.push(format!("**OC-{} · {}** — {}", s.position, s.title, s.thesis));
            l.push(format!("- сцена: {} | свет: {}", s.scene, s.lighting));
            l.push(format!("- персонаж/подача: {}", s.character));
        }
        if !self.exp.is_empty() {
            l.push(String::new());
            l.push(format!("## EXP-идеи (вне темы — только проверка на успех)"));
            for e in &self.exp {
                l.push(format!("- {} №{} [{}]: {} · переменная: {}", "EXP", e.id, e.kind, e.hypothesis, e.variables));
            }
        }
        l.join("\n")
    }
}

/* ---------------- токены историй (гейт №25, преемство) ---------------- */

/// Стоп-слова: служебная лексика не несёт drawable-нагрузки.
const TOKEN_STOP: &[&str] = &[
    "the", "and", "with", "her", "his", "she", "into", "over", "under",
    "from", "that", "this", "onto", "across", "through", "around", "while",
    "where", "there", "here", "very", "just", "like", "made", "makes",
    "girl", "woman", "frame", "scene", "vibe", "light", "lighting",
    "pose", "outfit", "character", "body", "skin", "hair",
];

/// Drawable-токены истории: существительные сцены/окружения/света/одежды,
/// ≥4 символов, без стоп-слов. Гейт adherence мерит их присутствие в
/// тексте батча; мост даёт их писцу в STORY-блоке.
pub fn story_tokens(s: &ArsStory) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let push_words = |text: &str, out: &mut Vec<String>| {
        for w in text.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()) {
            let w = w.trim();
            if w.len() >= 4 && !TOKEN_STOP.contains(&w) && !out.iter().any(|x| x == w) {
                out.push(w.to_string());
            }
        }
    };
    push_words(&s.scene, &mut out);
    push_words(&s.environment, &mut out);
    push_words(&s.lighting, &mut out);
    push_words(&s.outfit, &mut out);
    if let Some(w) = &s.witness {
        push_words(w, &mut out);
    }
    out.truncate(6);
    out
}

impl ArsBuild {
    /// Батч-токены для моста (форма якорей theme-эры — chunk-роут читает
    /// tokens/minAdherence без изменений): объединение токенов историй.
    pub fn anchors_compat_json(&self) -> serde_json::Value {
        let mut tokens: Vec<String> = Vec::new();
        for s in self.mains.iter().chain(self.ocs.iter()) {
            for t in story_tokens(s) {
                if !tokens.contains(&t) {
                    tokens.push(t);
                }
            }
        }
        tokens.truncate(30);
        serde_json::json!({
            "module": "ars-nouveau",
            "tokens": tokens,
            "minAdherence": DEFAULT_MIN_ADHERENCE,
        })
    }
}

/* ---------------- гейт плана (до компиляции) ---------------- */

/// Абстракции, запрещённые в историях (NICHE LAW, квитанция T4-11:
/// abstract words — жанровая смерть; история обязана быть drawable).
const ABSTRACT_WORDS: &[&str] = &[
    "dreamlike", "ethereal", "mysterious", "magical", "surreal",
    "enchanting", "whimsical", "otherworldly", "fantastical", "ineffable",
];

pub fn plan_receipts(build: &ArsBuild) -> Vec<Receipt> {
    let mix = Mix::from_policy();
    let mut out = Vec::new();

    // 1) структура: 21 мейн + 3 ОС
    let mut s_find = Vec::new();
    if build.mains.len() != mix.mains {
        s_find.push(format!(
            "ars/структура: историй мейнов {} ≠ {} (закон 24)",
            build.mains.len(),
            mix.mains
        ));
    }
    if build.ocs.len() != mix.ocs {
        s_find.push(format!(
            "ars/структура: историй ОС {} ≠ {}",
            build.ocs.len(),
            mix.ocs
        ));
    }
    if build.acts.len() != 3 {
        s_find.push(format!("ars/структура: актов {} ≠ 3", build.acts.len()));
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "hard",
        verdict: if s_find.is_empty() { "PASS" } else { "FAIL" },
        findings: s_find,
        notes: vec![format!(
            "мейнов {} · ОС {} · EXP-идей {} · актов {}",
            build.mains.len(),
            build.ocs.len(),
            build.exp.len(),
            build.acts.len()
        )],
    });

    // 2) жанровый микс (policy.ars.mix): сколько-то ниш, пара экскуизитов,
    //    остальное — волт (приказ автора)
    let niche = build.mains.iter().filter(|s| s.genre == "NICHE").count();
    let exq = build.mains.iter().filter(|s| s.genre == "EXQUISITE").count();
    let volt = build.mains.iter().filter(|s| s.genre == "VOLT").count();
    let mut m_find = Vec::new();
    if !(mix.niche_min..=mix.niche_max).contains(&niche) {
        m_find.push(format!(
            "ars/микс: ниш {niche} вне окна {}..={}",
            mix.niche_min, mix.niche_max
        ));
    }
    if !(mix.exquisite_min..=mix.exquisite_max).contains(&exq) {
        m_find.push(format!(
            "ars/микс: экскуизитов {exq} вне окна {}..={}",
            mix.exquisite_min, mix.exquisite_max
        ));
    }
    if niche + exq + volt != build.mains.len() {
        m_find.push(format!(
            "ars/микс: жанры вне словаря у {} истории(й)",
            build.mains.len() - niche - exq - volt
        ));
    }
    if build.ocs.iter().any(|s| s.genre != "OC") {
        m_find.push("ars/микс: ос-история обязана нести жанр OC".into());
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "hard",
        verdict: if m_find.is_empty() { "PASS" } else { "FAIL" },
        findings: m_find,
        notes: vec![format!("NICHE {niche} · EXQUISITE {exq} · VOLT {volt}")],
    });

    // 3) полнота полей (strict from_json уже гарантирует непустоту —
    //    здесь ловим содержательную пустоту: thesis-зерно и drawable-минимум)
    let mut c_find = Vec::new();
    for s in build.mains.iter().chain(build.ocs.iter()) {
        if s.thesis.split_whitespace().count() < 4 {
            c_find.push(format!(
                "ars/полнота: S{:02} thesis короче зерна (<4 слов) — закон кадра не сформулирован",
                s.position
            ));
        }
        let tokens = story_tokens(s);
        if tokens.len() < 3 {
            c_find.push(format!(
                "ars/полнота: S{:02} бедна drawable-токенами ({}) — сцена/окружение/свет не названы",
                s.position,
                tokens.len()
            ));
        }
    }
    for e in &build.exp {
        if e.hypothesis.split_whitespace().count() < 3 {
            c_find.push(format!("ars/полнота: EXP №{} — гипотеза не сформулирована", e.id));
        }
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "hard",
        verdict: if c_find.is_empty() { "PASS" } else { "FAIL" },
        findings: c_find,
        notes: Vec::new(),
    });

    // 4) вечные флоры: истории не проносят баны в промпты
    let mut f_find = Vec::new();
    'outer: for s in build.mains.iter().chain(build.ocs.iter()) {
        let all = s.all_text();
        for (group, bans) in crate::canon::FLOORS.iter() {
            for ban in bans.iter() {
                if all.contains(&ban.to_lowercase()) {
                    f_find.push(format!(
                        "ars/флоры: S{:02} несёт вечный бан «{ban}» ({group}) — перепиши историю",
                        s.position
                    ));
                    break 'outer;
                }
            }
        }
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "hard",
        verdict: if f_find.is_empty() { "PASS" } else { "FAIL" },
        findings: f_find,
        notes: Vec::new(),
    });

    // 5) чистота EXP: тема-слова не заходят в EXP-идеи (policy.ars.
    //    exp_outside_theme — развитие вердикта T4-34)
    let mut p_find = Vec::new();
    for e in &build.exp {
        let h = format!("{} {}", e.hypothesis, e.variables).to_lowercase();
        for kw in &build.theme_keywords {
            let kw = kw.to_lowercase();
            if kw.len() >= 4 && h.contains(&kw) {
                p_find.push(format!(
                    "ars/чистота: EXP №{} несёт тему-слово «{kw}» — EXP вне темы",
                    e.id
                ));
            }
        }
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "hard",
        verdict: if p_find.is_empty() { "PASS" } else { "FAIL" },
        findings: p_find,
        notes: Vec::new(),
    });

    // 6) уникальность thesis: тема раскрыта 21 способом, не одним
    let mut u_find = Vec::new();
    for (i, a) in build.mains.iter().enumerate() {
        for b in build.mains.iter().skip(i + 1) {
            if a.thesis.eq_ignore_ascii_case(&b.thesis) {
                u_find.push(format!(
                    "ars/уникальность: S{:02} и S{:02} несут один thesis — тема не раскрыта разными способами",
                    a.position, b.position
                ));
            }
        }
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "warn",
        verdict: if u_find.is_empty() { "PASS" } else { "WARN" },
        findings: u_find,
        notes: Vec::new(),
    });

    // 7) абстракции: drawable-закон (адvisory — модель обязата их избегать)
    let mut a_find = Vec::new();
    for s in build.mains.iter().chain(build.ocs.iter()) {
        let all = s.all_text();
        for w in ABSTRACT_WORDS {
            if all.contains(w) {
                a_find.push(format!(
                    "ars/drawable: S{:02} несёт абстракцию «{w}» — замени физическим фактом",
                    s.position
                ));
            }
        }
    }
    out.push(Receipt {
        gate: ARS_GATE,
        level: "warn",
        verdict: if a_find.is_empty() { "PASS" } else { "WARN" },
        findings: a_find,
        notes: Vec::new(),
    });

    out
}

/// Итог плана: все hard прошли?
pub fn plan_hard_pass(receipts: &[Receipt]) -> bool {
    receipts
        .iter()
        .filter(|r| r.level == "hard")
        .all(|r| r.verdict == "PASS")
}

/* ---------------- текстовый гейт №25 (adherence историям) ---------------- */

/// Adherence текста батча историям: каждая история обязана отдать батчу
/// ≥1 свой drawable-токен; порог — доля историй, добравшихся до текста.
pub fn text_gate(text: &str, build: &ArsBuild, min_adherence: f64) -> Receipt {
    if text.trim().is_empty() {
        return Receipt {
            gate: ADHERENCE_GATE,
            level: "hard",
            verdict: "FAIL",
            findings: vec!["theme/adherence: текст пуст — проверять нечего".into()],
            notes: Vec::new(),
        };
    }
    let lower = text.to_lowercase();
    let mut held = 0usize;
    let mut missed: Vec<u32> = Vec::new();
    for s in build.mains.iter().chain(build.ocs.iter()) {
        let tokens = story_tokens(s);
        if tokens.is_empty() || tokens.iter().any(|t| lower.contains(t.as_str())) {
            held += 1;
        } else {
            missed.push(s.position);
        }
    }
    let total = build.mains.len() + build.ocs.len();
    let ratio = if total == 0 { 0.0 } else { held as f64 / total as f64 };
    let min = min_adherence.clamp(0.25, 0.95);
    let mut findings = Vec::new();
    if ratio < min {
        findings.push(format!(
            "theme/adherence: историй дошло до текста {}/{} ({:.0}%) — нужно ≥ {:.0}%; мимо: S{}",
            held,
            total,
            ratio * 100.0,
            min * 100.0,
            missed
                .iter()
                .map(|p| p.to_string())
                .collect::<Vec<_>>()
                .join(", S")
        ));
    }
    Receipt {
        gate: ADHERENCE_GATE,
        level: "hard",
        verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
        findings,
        notes: vec![format!(
            "историй в тексте: {}/{} ({:.0}%)",
            held,
            total,
            ratio * 100.0
        )],
    }
}

/* ---------------- каталог артефактов ---------------- */

pub fn ars_dir() -> std::path::PathBuf {
    crate::textgates::rehearsal_dir().join("ars")
}

pub fn artifact_path(slug: &str) -> std::path::PathBuf {
    ars_dir().join(format!("{slug}.json"))
}

pub fn exposition_path(slug: &str) -> std::path::PathBuf {
    ars_dir().join(format!("{slug}.md"))
}

/// Артефакт с диска (правки автора/предыдущий прогон) — тема берётся
/// из самого артефакта (одна правда, §2).
pub fn load_artifact(slug: &str) -> Option<ArsBuild> {
    let v = crate::textgates::read_json(&artifact_path(slug))?;
    let theme = v.get("theme").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    ArsBuild::from_json(&v, &theme, slug).ok()
}

/* ---------------- тесты (battery: ars) ---------------- */

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_story(pos: u32, genre: &str, seed_word: &str) -> ArsStory {
        ArsStory {
            position: pos,
            genre: genre.into(),
            title: format!("Test {seed_word}"),
            reveal: format!("the theme shows {seed_word} here"),
            scene: format!("she leans over a {seed_word} railing, steam rising"),
            environment: format!("rooftop garden, {seed_word} vines, wet stone tiles"),
            vibe: "quiet electric hush".into(),
            lighting: "cold moon glow, one warm window behind".into(),
            pose_idea: "seated contrapposto, chin lifted".into(),
            outfit: "thin knit dress, bare shoulders".into(),
            character: "slender, ash-blonde braid, pale skin".into(),
            witness: Some("cracked teacup".into()),
            dice: None,
            thesis: format!("the {seed_word} keeps what the night forgot {pos}"),
        }
    }

    fn demo_build() -> ArsBuild {
        let mut mains = Vec::new();
        for i in 1..=6 {
            mains.push(demo_story(i, "NICHE", &format!("vine{i}")));
        }
        for i in 7..=19 {
            mains.push(demo_story(i, "VOLT", &format!("ember{i}")));
        }
        mains.push(demo_story(20, "EXQUISITE", "gild"));
        mains.push(demo_story(21, "EXQUISITE", "hush"));
        let mut ocs = Vec::new();
        for i in 1..=3 {
            let mut s = demo_story(i, "OC", &format!("oc{i}"));
            s.genre = "OC".into();
            ocs.push(s);
        }
        ArsBuild {
            slug: "T4-46".into(),
            theme: "Test Theme".into(),
            engine_name: "TEST ENGINE".into(),
            engine_law: "test law bends fabric".into(),
            batch_thesis: "one law, twenty-one ways".into(),
            acts: vec!["Arrive".into(), "Worn In".into(), "Kept".into()],
            theme_keywords: vec!["vine".into(), "ember".into()],
            mains,
            ocs,
            exp: vec![ArsExpIdea {
                id: 1,
                kind: "pose".into(),
                hypothesis: "kneel-arch holds the claim at R+".into(),
                variables: "pose LOW vs pose MID".into(),
            }],
            seed: "deadbeef".into(),
        }
    }

    #[test]
    fn json_roundtrip_strict() {
        let b = demo_build();
        let j = b.to_json();
        let back = ArsBuild::from_json(&j, &b.theme, &b.slug).unwrap();
        assert_eq!(b, back);
        let mut bad = j.clone();
        bad["hack"] = serde_json::json!(true);
        assert!(ArsBuild::from_json(&bad, &b.theme, &b.slug).is_err());
    }

    #[test]
    fn plan_hard_pass_on_demo() {
        let b = demo_build();
        let rs = plan_receipts(&b);
        assert!(plan_hard_pass(&rs), "findings: {:?}",
            rs.iter().flat_map(|r| r.findings.clone()).collect::<Vec<_>>());
    }

    #[test]
    fn plan_catches_short_mains() {
        let mut b = demo_build();
        b.mains.truncate(18);
        let rs = plan_receipts(&b);
        assert!(!plan_hard_pass(&rs));
        assert!(rs.iter().any(|r| r.findings.iter().any(|f| f.contains("структура"))));
    }

    #[test]
    fn plan_catches_mix_window() {
        let mut b = demo_build();
        for s in b.mains.iter_mut() {
            s.genre = "VOLT".into();
        }
        let rs = plan_receipts(&b);
        assert!(rs.iter().any(|r| r.findings.iter().any(|f| f.contains("ниш"))));
    }

    #[test]
    fn plan_catches_floor_smuggle() {
        let mut b = demo_build();
        b.mains[0].scene = "she holds a candle over the map".into();
        let rs = plan_receipts(&b);
        assert!(rs.iter().any(|r| r.findings.iter().any(|f| f.contains("вечный бан"))));
    }

    #[test]
    fn plan_catches_exp_theme_leak() {
        let mut b = demo_build();
        b.exp[0].hypothesis = "vine pattern on knit at R+".into();
        let rs = plan_receipts(&b);
        assert!(rs.iter().any(|r| r.findings.iter().any(|f| f.contains("тему-слово"))));
    }

    #[test]
    fn plan_warns_duplicate_thesis() {
        let mut b = demo_build();
        let t = b.mains[0].thesis.clone();
        b.mains[1].thesis = t;
        let rs = plan_receipts(&b);
        assert!(rs.iter().any(|r| r.level == "warn" && r.findings.iter().any(|f| f.contains("уникальность"))));
    }

    #[test]
    fn adherence_pass_and_fail() {
        let b = demo_build();
        let mut text = String::new();
        for s in b.mains.iter().chain(b.ocs.iter()) {
            text.push_str(&story_tokens(s).first().cloned().unwrap_or_default());
            text.push(' ');
        }
        let r = text_gate(&text, &b, 0.6);
        assert_eq!(r.verdict, "PASS", "findings: {:?}", r.findings);
        let r2 = text_gate("совсем другой текст без токенов историй", &b, 0.6);
        assert_eq!(r2.verdict, "FAIL");
    }

    #[test]
    fn anchors_compat_shape() {
        let b = demo_build();
        let j = b.anchors_compat_json();
        assert!(j["tokens"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
        assert_eq!(j["minAdherence"].as_f64(), Some(0.6));
    }

    #[test]
    fn markdown_renders_all_stories() {
        let b = demo_build();
        let md = b.markdown();
        assert!(md.contains("21 история"));
        assert!(md.contains("3 истории ОС"));
        for i in 1..=21u32 {
            assert!(md.contains(&format!("S{i:02}")), "история S{i:02} не попала в экспозицию");
        }
        assert!(md.contains("OC-3"));
    }

    #[test]
    fn exp_kind_dictionary_enforced() {
        let bad = serde_json::json!({
            "id": 1, "kind": "gigachad", "hypothesis": "x y z", "variables": "a vs b"
        });
        assert!(ArsExpIdea::from_json(&bad, 1).is_err());
    }
}
