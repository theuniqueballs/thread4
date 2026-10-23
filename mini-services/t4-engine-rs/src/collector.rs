//! СБОРЩИК — упаковщик для писца (ARS NOVEAU-эра, приказ 2026-10-23).
//!
//! Детерминированный, БЕЗ LLM: берёт механический контракт (позы/палитры/
//! стеки/лиды/дресс/дайсы/варьety — канон-реестр + бриф) и истории ARS
//! NOVEAU, и складывает БРИКЕТЫ — по одному на слот, «чтобы писцу было
//! максимально понятно, что ему писать». Долги T4-45 вшиты константами
//! (OC-тема→POS, EXP core-4, on_skin контр-NEG, полные ID палитр EXP).
//!
//! Артефакт: data/rehearsals/briquettes/<slug>.json (+ .md экспозиция).
//! Мост читает его в chunk-роуте (compute-only) — STORY-блок слота.

use serde_json::{json, Value};

use crate::ars::{self, ArsBuild};
use crate::compile::Receipt;

pub const COLLECTOR_GATE: &str = "collector";

pub fn briquettes_dir() -> std::path::PathBuf {
    crate::textgates::rehearsal_dir().join("briquettes")
}

pub fn artifact_path(slug: &str) -> std::path::PathBuf {
    briquettes_dir().join(format!("{slug}.json"))
}

pub fn exposition_path(slug: &str) -> std::path::PathBuf {
    briquettes_dir().join(format!("{slug}.md"))
}

pub fn load(slug: &str) -> Option<Value> {
    crate::textgates::read_json(&artifact_path(slug))
}

/* ---------------- законы брикета (долги T4-45 — константы) ---------------- */

const LAW_STORY: &str = "STORY IS LAW (ARS NOVEAU): POS обязан нести drawable-теги ЭТОЙ истории — scene/environment/lighting/outfit/character переводятся в тег-ран, история живёт в кадре, а не в THESIS (квитанция T4-45 б: P03 нёс генерический тезис батча вместо сюжета слота).";
const LAW_OC: &str = "OC-ТЕМА → POS-ТЕГИ (квитанция T4-45 а: тема ОС вплетена в THESIS/Spine, но ПОТЕРЯНА в POS): сюжет ОС обязан дойти до ТЕГ-РАНА — props/light/pose/garment из истории, которые рендерер нарисует; автор видит тему одним взглядом.";
const LAW_EXP: &str = "EXP = БЕЗ ТЕМЫ, НО CORE-4 СТЕК (квитанция T4-45 в: «чистая болванка» ≠ «пустой стек»): 4 носителя (1W+1BODY+1POSITION+1PHYSICS из стека ниже), кадр ОТЛИЧЕН от соседних EXP, A/B-пара отличается ОДНОЙ переменной; тема-слова вычищены (T4-34).";
const LAW_ON_SKIN: &str = "ON_SKIN КОНТР-NEG (квитанция T4-45 д): канал on_skin (tape/handbra) поднимает `topless, naked breasts` из NEG — НЕ ГЛУШИ канал, а держи границу тира: `nipples exposed, areola` в NEG обязательны, иначе X-перелёт.";
const LAW_EXP_PALETTE: &str = "EXP-ПАЛИТРА ПОЛНЫМ ID (квитанция T4-45 г): в шапке слота палитра полным идентификатором P##_NAME — не голый номер.";
const LAW_DRESSER_MERGE: &str = "ОДЕЖДА = МЕРДЖ С ДРЕССЕРОМ (№28/№29): outfit истории — КОНЦЕПТ; канал/тон/состояние назначены механикой — теги состояния дресс-кода вплетаются ДОСЛОВНО, конфликт решает Дрессер.";

/// Собрать брикеты: контракт (полный JSON брифа) × ArsBuild.
/// Возвращает (артефакт, квитанции). Пишет файлы вызывающий (этап).
pub fn build(contract: &Value, ars: &ArsBuild) -> Result<(Value, Vec<Receipt>), String> {
    let slots = contract
        .get("slots")
        .and_then(|s| s.as_array())
        .ok_or("collector: в контракте нет slots[]")?;
    let theme = contract
        .get("theme")
        .and_then(|v| v.as_str())
        .unwrap_or(&ars.theme)
        .to_string();
    let slug = contract
        .get("slug")
        .and_then(|v| v.as_str())
        .unwrap_or(&ars.slug)
        .to_string();

    // порядок пулов: мейны и ОС — по позиции, EXP — по индексу
    let main_idx_of: Vec<usize> = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            let kind = s.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            kind != "OC" && kind != "EXP"
        })
        .map(|(i, _)| i)
        .collect();
    let oc_idx_of: Vec<usize> = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.get("kind").and_then(|v| v.as_str()) == Some("OC"))
        .map(|(i, _)| i)
        .collect();
    let exp_idx_of: Vec<usize> = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| s.get("kind").and_then(|v| v.as_str()) == Some("EXP"))
        .map(|(i, _)| i)
        .collect();

    let mut findings: Vec<String> = Vec::new();
    let mut warns: Vec<String> = Vec::new();

    // раскладка историй по слотам (индексы пулов; механика главнее жанра)
    let mut story_of: Vec<Option<usize>> = vec![None; slots.len()];
    for (n, &si) in main_idx_of.iter().enumerate() {
        if n < ars.mains.len() {
            story_of[si] = Some(n);
        }
    }
    for (n, &si) in oc_idx_of.iter().enumerate() {
        if n < ars.ocs.len() {
            story_of[si] = Some(n);
        }
    }
    let mut briquettes: Vec<Value> = Vec::new();
    let mut main_seen = 0usize;
    let mut oc_seen = 0usize;
    let mut exp_seen = 0usize;

    for (i, slot) in slots.iter().enumerate() {
        let position = slot.get("position").and_then(|v| v.as_u64()).unwrap_or(i as u64 + 1);
        let kind = slot
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("VOLT")
            .to_string();
        let rating = slot
            .get("rating")
            .and_then(|v| v.as_str())
            .unwrap_or("R")
            .to_string();

        let mut laws: Vec<String> = vec![LAW_STORY.into(), LAW_DRESSER_MERGE.into()];
        let mut story_json: Option<Value> = None;

        match kind.as_str() {
            "OC" => {
                if let Some(n) = story_of[i] {
                    let s = &ars.ocs[n];
                    story_json = Some(story_value(s));
                    laws.push(LAW_OC.into());
                }
                oc_seen += 1;
            }
            "EXP" => {
                let idea = ars.exp.get(exp_seen);
                let contract_hyp = slot
                    .get("exp")
                    .and_then(|e| e.get("hypothesis"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let hypothesis = idea
                    .map(|e| e.hypothesis.clone())
                    .unwrap_or_else(|| contract_hyp.to_string());
                if hypothesis.trim().is_empty() {
                    findings.push(format!(
                        "collector: EXP P{position:02} без гипотезы — ни ARS-идея, ни контракт не несут её"
                    ));
                }
                story_json = Some(json!({
                    "genre": "EXP",
                    "title": format!("EXP probe #{}", exp_seen + 1),
                    "reveal": format!("проверка на успех: {}", idea.map(|e| e.kind.as_str()).unwrap_or("unknown")),
                    "scene": idea.map(|e| e.hypothesis.clone()).unwrap_or_else(|| contract_hyp.to_string()),
                    "environment": "болванка вне темы — окружение минимально, работает только гипотеза",
                    "vibe": "лабораторный кадр: одна переменная, всё прочее одинаково",
                    "lighting": "свет на зоне заявки (закон №21), без декоративного шума",
                    "poseIdea": slot.get("poseName").and_then(|v| v.as_str()).unwrap_or("по контракту"),
                    "outfit": slot
                        .get("dress")
                        .and_then(|d| d.get("garment"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("по дресс-коду канала"),
                    "character": slot.get("race").and_then(|v| v.as_str()).unwrap_or("human"),
                    "thesis": format!("EXP {} — {}", idea.map(|e| e.id.to_string()).unwrap_or_else(|| "?".into()), hypothesis),
                    "expIdea": idea.map(|e| e.to_json()).unwrap_or(Value::Null),
                    "contractHypothesis": contract_hyp,
                }));
                laws.push(LAW_EXP.into());
                laws.push(LAW_EXP_PALETTE.into());
                exp_seen += 1;
            }
            _ => {
                if let Some(n) = story_of[i] {
                    let s = &ars.mains[n];
                    // жанр истории против kind слота: механика побеждает
                    if s.genre != kind {
                        warns.push(format!(
                            "collector: P{position:02} — история заявляет {}, слот назначен {}; механика побеждает, писец адаптирует историю под {}",
                            s.genre, kind, kind
                        ));
                    }
                    story_json = Some(story_value(s));
                }
                main_seen += 1;
            }
        }

        if kind != "EXP" && story_json.is_none() {
            findings.push(format!(
                "collector: P{position:02} ({kind}) остался без истории — ARS-артефакт короче контракта"
            ));
        }

        // on_skin контр-NEG (долг T4-45 д)
        let channel = slot
            .get("dress")
            .and_then(|d| d.get("channel"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if channel == "on_skin" {
            laws.push(LAW_ON_SKIN.into());
        }

        // механика: контрактный слот дословно, минус дубли position/kind
        let mut mechanics = slot.clone();
        if let Some(m) = mechanics.as_object_mut() {
            m.remove("position");
            m.remove("kind");
        }

        let mut b = serde_json::Map::new();
        b.insert("position".into(), json!(position));
        b.insert("kind".into(), json!(kind));
        b.insert("rating".into(), json!(rating));
        b.insert("story".into(), story_json.unwrap_or(Value::Null));
        b.insert("mechanics".into(), Value::Object(
            mechanics.as_object().cloned().unwrap_or_default(),
        ));
        b.insert("laws".into(), json!(laws));
        briquettes.push(Value::Object(b));
    }

    if main_seen != main_idx_of.len() || oc_seen != oc_idx_of.len() {
        // уже поймано находками выше — счётчик для ноты
    }

    let artifact = json!({
        "module": "collector",
        "version": "1.0.0",
        "slug": slug,
        "theme": theme,
        "arsSeed": ars.seed,
        "engine": ars.engine_name,
        "briquettes": briquettes,
    });

    let receipts = vec![
        Receipt {
            gate: COLLECTOR_GATE,
            level: "hard",
            verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
            findings,
            notes: vec![format!(
                "брикетов {} (мейнов {} · ОС {} · EXP {}) · историй ARS: мейнов {} · ОС {} · идей {}",
                artifact["briquettes"].as_array().map(|a| a.len()).unwrap_or(0),
                main_idx_of.len(),
                oc_idx_of.len(),
                exp_idx_of.len(),
                ars.mains.len(),
                ars.ocs.len(),
                ars.exp.len(),
            )],
        },
        Receipt {
            gate: COLLECTOR_GATE,
            level: "warn",
            verdict: if warns.is_empty() { "PASS" } else { "WARN" },
            findings: warns,
            notes: Vec::new(),
        },
    ];
    Ok((artifact, receipts))
}

fn story_value(s: &crate::ars::ArsStory) -> Value {
    let mut v = s.to_json();
    if let Some(obj) = v.as_object_mut() {
        obj.insert("tokens".into(), json!(ars::story_tokens(s)));
    }
    v
}

/// Экспозиция брикетов автору: кратко, слот = строка.
pub fn markdown(artifact: &Value) -> String {
    let mut l = Vec::new();
    l.push(format!(
        "# СБОРЩИК — брикеты {} «{}»",
        artifact.get("slug").and_then(|v| v.as_str()).unwrap_or("?"),
        artifact.get("theme").and_then(|v| v.as_str()).unwrap_or("?")
    ));
    l.push(String::new());
    if let Some(bs) = artifact.get("briquettes").and_then(|v| v.as_array()) {
        for b in bs {
            let pos = b.get("position").and_then(|v| v.as_u64()).unwrap_or(0);
            let kind = b.get("kind").and_then(|v| v.as_str()).unwrap_or("?");
            let rating = b.get("rating").and_then(|v| v.as_str()).unwrap_or("?");
            let story = b.get("story");
            let title = story
                .and_then(|s| s.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("—");
            let thesis = story
                .and_then(|s| s.get("thesis"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let pose = b
                .get("mechanics")
                .and_then(|m| m.get("poseName"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let palette = b
                .get("mechanics")
                .and_then(|m| m.get("palette"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            l.push(format!(
                "- P{pos:02} · {kind} · {rating} · «{title}» — {thesis} · {pose} · {palette}"
            ));
        }
    }
    l.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ars::ArsStory;

    fn story(pos: u32, genre: &str) -> ArsStory {
        ArsStory {
            position: pos,
            genre: genre.into(),
            title: format!("Story {pos}"),
            reveal: "what the theme shows here".into(),
            scene: "she leans on a moss railing, steam rising".into(),
            environment: "rooftop garden, wet stone tiles".into(),
            vibe: "quiet hush".into(),
            lighting: "moon glow from the left".into(),
            pose_idea: "seated contrapposto".into(),
            outfit: "thin knit dress".into(),
            character: "slender, ash-blonde braid".into(),
            witness: None,
            dice: None,
            thesis: format!("the moss keeps the night {pos}"),
        }
    }

    fn build_ars() -> ArsBuild {
        let mut mains: Vec<ArsStory> = (1..=7).map(|i| story(i, "NICHE")).collect();
        mains.extend((8..=19).map(|i| story(i, "VOLT")));
        mains.push(story(20, "EXQUISITE"));
        mains.push(story(21, "EXQUISITE"));
        let ocs = vec![story(1, "OC"), story(2, "OC"), story(3, "OC")];
        ArsBuild {
            slug: "T4-46".into(),
            theme: "Moss Cathedral".into(),
            engine_name: "MOSS GRAVITY".into(),
            engine_law: "moss climbs what stands still".into(),
            batch_thesis: "one law".into(),
            acts: vec!["A".into(), "B".into(), "C".into()],
            theme_keywords: vec!["moss".into()],
            mains,
            ocs,
            exp: vec![crate::ars::ArsExpIdea {
                id: 1,
                kind: "garment".into(),
                hypothesis: "oxblood knit bumps channel".into(),
                variables: "dry vs sweat".into(),
            }],
            seed: "cafe".into(),
        }
    }

    fn demo_contract() -> Value {
        let mut slots = Vec::new();
        for i in 1..=21u64 {
            let kind = if i <= 7 { "NICHE" } else if i >= 20 { "EXQUISITE" } else { "VOLT" };
            slots.push(json!({
                "position": i, "kind": kind, "rating": "R+",
                "pose": "PL001", "poseName": "Test Pose", "poseRisk": "LOW",
                "palette": format!("P{i:03}_TEST"), "paletteName": "Test",
                "carriers": [{"id": "W01", "name": "wet knit", "cls": "W", "deg": "state"}],
                "kinetics": ["K01"], "lead": "collarbone", "register": "young",
                "closer": "image-close", "diceSig": "A1·B1·C1·D1·E1", "dice": "identity-first",
                "dress": {"channel": "bumps", "channelName": "бугорки", "category": "knit",
                          "tone": "dark", "garment": "oxblood knit top", "state": ["covered nipples"],
                          "underlayer": "none", "weights": [], "negWeights": [], "law": "№28"},
            }));
        }
        for i in 22..=24u64 {
            slots.push(json!({
                "position": i, "kind": "OC", "oc": "Sue", "ocTheme": "hermit moon",
                "rating": "R+", "pose": "PL002", "poseName": "OC Pose", "poseRisk": "LOW",
                "palette": "P100_OC", "paletteName": "OC Pal", "carriers": [], "kinetics": [],
                "lead": "nape", "register": "milf", "closer": "fragment-pair",
                "bodyType": "FAM-A full-figured",
            }));
        }
        for i in 25..=26u64 {
            slots.push(json!({
                "position": i, "kind": "EXP", "rating": "R+",
                "pose": "PL003", "poseName": "EXP Pose", "poseRisk": "LOW",
                "palette": "P111_ORCHID_HOUSE_GHOST", "paletteName": "Orchid Ghost",
                "carriers": [], "kinetics": [], "lead": "chest", "register": "young",
                "closer": "action-close",
                "exp": {"hypothesis": "contract fallback hypothesis", "half": "A", "pairWith": 26, "letter": "α"},
                "dress": {"channel": "on_skin", "channelName": "на коже", "category": "tape",
                          "tone": "skin", "garment": "nipple tape", "state": ["taped nipples"],
                          "underlayer": "none", "weights": [], "negWeights": [], "law": "№29"},
            }));
        }
        json!({ "slug": "T4-46", "theme": "Moss Cathedral", "slots": slots })
    }

    #[test]
    fn full_contract_gets_briquettes_and_passes() {
        let (artifact, receipts) = build(&demo_contract(), &build_ars()).unwrap();
        assert_eq!(
            artifact["briquettes"].as_array().map(|a| a.len()),
            Some(26)
        );
        assert!(
            receipts.iter().all(|r| r.verdict != "FAIL"),
            "findings: {:?}",
            receipts.iter().flat_map(|r| r.findings.clone()).collect::<Vec<_>>()
        );
        // история мейна с токенами
        let b0 = &artifact["briquettes"][0];
        assert!(b0["story"]["tokens"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
        // EXP: закон + идея
        let bexp = &artifact["briquettes"][24];
        assert!(bexp["laws"].as_array().unwrap().iter().any(|l| l.as_str().unwrap().contains("CORE-4")));
        assert!(bexp["story"]["expIdea"].is_object());
        // on_skin контр-NEG закон доехал
        assert!(bexp["laws"].as_array().unwrap().iter().any(|l| l.as_str().unwrap().contains("ON_SKIN")));
        // OC-закон
        let boc = &artifact["briquettes"][21];
        assert!(boc["laws"].as_array().unwrap().iter().any(|l| l.as_str().unwrap().contains("OC-ТЕМА")));
    }

    #[test]
    fn missing_story_is_hard_fail() {
        let mut ars = build_ars();
        ars.mains.truncate(10);
        let (_, receipts) = build(&demo_contract(), &ars).unwrap();
        assert!(receipts.iter().any(|r| r.verdict == "FAIL"
            && r.findings.iter().any(|f| f.contains("без истории"))));
    }

    #[test]
    fn genre_mismatch_warns_mechanics_win() {
        let mut ars = build_ars();
        ars.mains[0].genre = "VOLT".into(); // контракт говорит NICHE
        let (_, receipts) = build(&demo_contract(), &ars).unwrap();
        assert!(receipts.iter().any(|r| r.level == "warn"
            && r.findings.iter().any(|f| f.contains("механика побеждает"))));
    }

    #[test]
    fn exp_without_any_hypothesis_fails() {
        let mut contract = demo_contract();
        if let Some(slots) = contract["slots"].as_array_mut() {
            slots[24]["exp"] = serde_json::Value::Null;
        }
        let mut ars = build_ars();
        ars.exp.clear();
        let (_, receipts) = build(&contract, &ars).unwrap();
        assert!(receipts.iter().any(|r| r.verdict == "FAIL"
            && r.findings.iter().any(|f| f.contains("без гипотезы"))));
    }

    #[test]
    fn markdown_lists_every_briquette() {
        let (artifact, _) = build(&demo_contract(), &build_ars()).unwrap();
        let md = markdown(&artifact);
        assert!(md.contains("P01"));
        assert!(md.contains("P26"));
    }
}
