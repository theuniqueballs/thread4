//! THREAD 4 ENGINE (RUST TWIN) — ТЕКСТОВАЯ БАТАРЕЯ ГЕЙТОВ (этапы 0–1).
//!
//! Порт scribe-time гейтов из src/lib/t4/gates.ts (файл-эра) в Rust-близнец.
//! Файл-эра живёт в файлах репо: текст 21-промптного батча и контракты
//! есть ТОЛЬКО в thread4/batches/*.md и thread4/contracts/*.json (аудит
//! 2026-10-17: в sqlite — план-скелет без прозы), поэтому батарея читает
//! файлы репо, а окно/runIndex — продакшн-базу ТОЛЬКО RO.
//!
//! ЭТАП 0 — фундамент:
//!   · парсер батча: ПОДМНОЖЕСТВО parseBatchMd (batch-md.ts:122-196) —
//!     слоты/секции/мета 1-в-1 (одна правда слота, аудит «двойной парсер»),
//!     тонкий адаптер parseBatch (gates.ts:182) поверх него;
//!   · лоадер контракта contracts/T4-NN.json → типизированные структуры;
//!   · лоадер спеков: specs/bans.json (единственный спек, который читают
//!     гейты этапа 1 — budget);
//!   · прод-контекст RO: runIndex (счёт gate.run в летописи), окно ротации
//!     (3 последних сданных), OC-ростер (oc-canon.json).
//!
//! ЭТАП 1 — 13 словарных гейтов, findings ДОСЛОВНО как в TS (автор читает
//! квитанции; паритет сверяется по записанным TS-слепкам gate.run в
//! thread4/events/log.jsonl — verdict per gate — и по живым TS-прогонам):
//!   budget · cadence · prop-geometry · noun-lock · character-collision ·
//!   theme-presence · original-character-coverage · artist-leak ·
//!   garment-family · freq-report (advisory) · usage (advisory) ·
//!   one-hard-claim · echo-window.
//!
//! ЭТАП 2 — подмодуль textgates2 (12 + 3 условных): rating-recipe · dresser
//! · canon · diversity · niche-legibility · claim-visibility ·
//! technique-layers · simcheck · technique-map (advisory) · salience-chain
//! · contract-fidelity · bumps-quota + условные raw-plus (hard),
//! rating-recipe-exploratory (warn ⚗), raw-plus-exploratory (warn ⚗).
//! Батарея целиком (25 безусловных) собирается здесь — run_text_gates.
//!
//! Receipt переиспользуется из compile.rs (одна форма квитанции); канал
//! записи — scratch-летопись twin'а (chain::append_event_tx + t4_gate_runs),
//! продакшн-база не пишется НИКОГДА.
//!
//! JS-регексы с lookahead/lookbehind (cadence-сплит, character-collision,
//! garment-family bra(?!less)) regex-crate не умеет — здесь ручные сканеры
//! с той же семантикой (ASCII \b: [A-Za-z0-9_], «-» НЕ слово-символ).

use std::path::PathBuf;

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::compile::Receipt;

/// Этап 2 (этот же файл-эра-стиль): 12 оставшихся словарных гейтов +
/// 3 условных — подмодуль, чтобы `super::` видел лоадеры/хелперы этапа 0-1.
pub mod textgates2;

/* ================================================================== */
/* Пути репо (как fsutil.ts: T4_ROOT = cwd/thread4, twin'у — от манифеста) */
/* ================================================================== */

pub fn thread4_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join("thread4")
}

pub fn batches_dir() -> PathBuf {
    thread4_dir().join("batches")
}

pub fn contracts_dir() -> PathBuf {
    thread4_dir().join("contracts")
}

/* ---------------- РЕПЕТИЦИИ конвейера (twin) ----------------
 * Инцидент Фазы 3 (2026-10-20): этапы конвейера писали артефакты прямо в
 * прод-дерево thread4/ — репетиция T4-01/T4-02 ПЕРЕЗАПИСАЛА исторические
 * контракты. Доктрина: конвейер — репетиции в scratch; прод-дерево для
 * него read-only. Батарея гейтов (run_text_gates, /v1/gates, паритет-
 * слепки) читает ПРОД-контракты как раньше — redirect только у этапов. */
pub fn rehearsal_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/rehearsals")
}

pub fn rehearsal_contracts_dir() -> PathBuf {
    rehearsal_dir().join("contracts")
}

pub fn rehearsal_batches_dir() -> PathBuf {
    rehearsal_dir().join("batches")
}

pub fn rehearsal_drafts_dir() -> PathBuf {
    rehearsal_dir().join("drafts")
}

pub fn rehearsal_archive_path() -> PathBuf {
    rehearsal_dir().join("engines-archive.jsonl")
}

pub fn specs_dir() -> PathBuf {
    thread4_dir().join("specs")
}

pub fn event_log_path() -> PathBuf {
    thread4_dir().join("events/log.jsonl")
}

pub(crate) fn read_text(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p).ok()
}

pub(crate) fn read_json(p: &std::path::Path) -> Option<serde_json::Value> {
    let txt = read_text(p)?;
    serde_json::from_str(&txt).ok()
}

/// Слаг-канон файл-эры (fsutil.isSafeSlug 1-в-1): T4- + буква/цифра, хвост
/// [A-Za-z0-9.-], БЕЗ разделителей пути — T4-27.2-EXP легален (в отличие
/// от более строгого compile::valid_slug, который канонизирует НОВЫЕ слаги).
pub fn is_safe_slug(slug: &str) -> bool {
    let b = slug.as_bytes();
    if b.len() < 4 || !slug.starts_with("T4-") {
        return false;
    }
    let tail = &slug[3..];
    let t = tail.as_bytes();
    if !t[0].is_ascii_alphanumeric() {
        return false;
    }
    if t.len() == 1 {
        return true;
    }
    if tail.len() > 32 || !t[t.len() - 1].is_ascii_alphanumeric() {
        return false;
    }
    tail[1..tail.len() - 1]
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
}

/* ================================================================== */
/* Этап 0.1 — парсер батча: parseBatchMd (подмножество) + parseBatch   */
/* ================================================================== */

/// Слот батча, как он записан в .md (SlotMd, batch-md.ts:18 — поля, которые
/// читают гейты; kind/rating/pose/palette/who — разбор меты по форме).
#[derive(Clone, Debug, Default, PartialEq)]
struct SlotMd {
    /// «P01»
    id: String,
    /// slug слота из шапки
    slug: String,
    /// полная строка шапки слота (сырьё гейтов: маркеры ⚗, «(EXP ·», PL##…)
    raw_header: String,
    /// содержимое скобки меты шапки (до последней «)»)
    raw_meta: String,
    kind: String,
    who: String,
    rating: String,
    pose: String,
    palette: String,
    thesis: String,
    canon: String,
    spine: String,
    stack: String,
    pos: String,
    neg: String,
}

/// Слот, каким его видят гейты (ParsedSlot, gates.ts:123 — форма неизменна)
/// + разобранные поля меты (kind/rating/pose/palette/who) для следующих фаз.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextSlot {
    pub position: u32,
    pub header: String,
    pub anchor: String,
    pub meta: String,
    /// OC | NICHE | VOLT | EXQUISITE | EXP ('' если не назван)
    pub genre: String,
    pub thesis: String,
    pub canon: String,
    pub spine: String,
    pub stack: Vec<String>,
    pub pos: String,
    pub neg: String,
    /// разобранная мета (parseMeta): жанр-ключ, имя ОС/раса, рейтинг, поза, палитра
    pub kind: String,
    pub who: String,
    pub rating: String,
    pub pose: String,
    pub palette: String,
}

#[derive(Clone, Debug, Default)]
pub struct TextBatch {
    pub slug: String,
    /// полный текст файла батча (тема-слова, HEROINE-BATCH, sha10)
    pub text: String,
    pub title: String,
    pub slots: Vec<TextSlot>,
}

/// collapse(s): пробельные серии → один пробел, без краёв (batch-md.ts:86).
fn collapse(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_ws && !out.is_empty() {
                out.push(' ');
            }
            prev_ws = true;
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

const KINDS: [&str; 5] = ["OC", "VOLT", "NICHE", "EXQUISITE", "EXP"];

/// RATINGS = /^(R\+?|X|XXX|PG-?13)$/i (batch-md.ts:84)
fn is_rating_token(seg: &str) -> bool {
    let s = seg.to_ascii_uppercase();
    matches!(s.as_str(), "R" | "R+" | "X" | "XXX" | "PG13" | "PG-13")
}

/// /^PL\d+$/ (регистрозависимо, как в TS) — \d+ = ≥1 цифра: «PL1» —
/// валидная поза (len>3 отрезал бы её, ломая parseMeta — аудит паритета)
fn is_pose_token(seg: &str) -> bool {
    let b = seg.as_bytes();
    b.len() >= 3 && b[0] == b'P' && b[1] == b'L' && b[2..].iter().all(|c| c.is_ascii_digit())
}

/// /^P[A-Z0-9_]+$/ + seg.contains('_') (палитры P##_NAME)
fn is_palette_token(seg: &str) -> bool {
    let b = seg.as_bytes();
    if b.len() < 2 || b[0] != b'P' || !seg.contains('_') {
        return false;
    }
    b[1..].iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == b'_')
}

/// Классификация сегментов меты по форме (parseMeta, batch-md.ts:91).
fn parse_meta(raw: &str) -> (String, String, String, String, String) {
    let (mut kind, mut who, mut rating, mut pose, mut palette) =
        (String::new(), String::new(), String::new(), String::new(), String::new());
    for seg_raw in raw.split('·') {
        let seg = collapse(seg_raw);
        if seg.is_empty() || seg == "—" {
            continue;
        }
        let upper = seg.to_ascii_uppercase();
        if KINDS.contains(&upper.as_str()) {
            if kind.is_empty() {
                kind = upper;
            }
            continue;
        }
        if is_rating_token(&seg) {
            if rating.is_empty() {
                // PG13 → PG-13, остальное как есть (batch-md.ts:101)
                rating = if upper == "PG13" { "PG-13".into() } else { upper };
            }
            continue;
        }
        if is_pose_token(&seg) {
            if pose.is_empty() {
                pose = seg;
            }
            continue;
        }
        if is_palette_token(&seg) {
            if palette.is_empty() {
                palette = seg;
            }
            continue;
        }
        if upper.starts_with("REHAB") {
            // REHAB-маркер классифицируется отдельно (не who), значение
            // гейтам этапа 1 не нужно
            continue;
        }
        if who.is_empty() {
            who = seg;
        }
    }
    (kind, who, rating, pose, palette)
}

/// Шапка слота «P0X — slug (мета…)» — жадный (.*) до ПОСЛЕДНЕЙ «)» в строке
/// (SLOT_HEADER_RE, batch-md.ts:59): мета бывает с вложенными скобками, а
/// после скобки — парные маркеры «⚗», якориться на конец строки нельзя.
fn slot_header(line: &str) -> Option<(String, String, String)> {
    let b = line.as_bytes();
    if b.first() != Some(&b'P') {
        return None;
    }
    let digits_len = b[1..].iter().take_while(|c| c.is_ascii_digit()).count();
    if digits_len == 0 {
        return None;
    }
    let rest = line[1 + digits_len..].strip_prefix(" — ")?; // em-dash, как в TS
    // (\S+)\s+\(:  первый не-пробельный токен, затем ОБЯЗАТЕЛЬНО пробел и «(»
    let slug_end = rest.find(char::is_whitespace)?;
    let slug = &rest[..slug_end];
    if slug.is_empty() {
        return None;
    }
    let after_slug = rest[slug_end..].trim_start();
    let inner = after_slug.strip_prefix('(')?;
    // (.*)\):  от «(» до ПОСЛЕДНЕЙ «)» строки
    let close = inner.rfind(')')?;
    let meta = &inner[..close];
    let id = format!("P{:0>2}", &line[1..1 + digits_len]);
    Some((id, slug.to_string(), meta.to_string()))
}

/// BOUNDARY_RE (batch-md.ts:82): структурные линии (ACT-хедеры, divider-ы,
/// markdown, blockquote, EXP OVERLAY) — НЕ контент: обрывают секцию, в
/// слот не пишутся (bug fix 2026-10-15: мусор прилипал к NEG).
fn is_boundary(line: &str) -> bool {
    // [═━─=]{3,}
    let box_run = line.chars().take_while(|c| matches!(c, '═' | '━' | '─' | '=')).count();
    if box_run >= 3 {
        return true;
    }
    // [*_]{3,}
    let mark_run = line.chars().take_while(|c| *c == '*' || *c == '_').count();
    if mark_run >= 3 {
        return true;
    }
    // [-]{3,}\s*$ — строка из дефисов до конца (с хвостовыми пробелами)
    let dash_run = line.chars().take_while(|c| *c == '-').count();
    if dash_run >= 3 && line.chars().skip(dash_run).all(|c| c.is_whitespace()) {
        return true;
    }
    // #{1,6}\s
    if line.starts_with('#') {
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if hashes <= 6 && line[hashes..].starts_with(char::is_whitespace) {
            return true;
        }
    }
    // >\s
    if line.starts_with('>') && line[1..].starts_with(char::is_whitespace) {
        return true;
    }
    // ACT\s+[IVX]+\b — ≥1 пробел после ACT, римский ран, граница после
    if let Some(rest) = line.strip_prefix("ACT") {
        let trimmed = rest.trim_start();
        if rest.len() != trimmed.len() {
            let rom = trimmed.chars().take_while(|c| matches!(c, 'I' | 'V' | 'X')).count();
            if rom > 0 {
                let after = &trimmed[rom..];
                if after.is_empty() || !after.chars().next().is_some_and(ascii_word) {
                    return true;
                }
            }
        }
    }
    // EXP\s+OVERLAY\b / REHAB\s+OVERLAY\b — \s+ и хвостовая граница
    for p in ["EXP", "REHAB"] {
        if let Some(rest) = line.strip_prefix(p) {
            let trimmed = rest.trim_start();
            if rest.len() != trimmed.len() && trimmed.starts_with("OVERLAY") {
                let after = &trimmed["OVERLAY".len()..];
                if after.is_empty() || !after.chars().next().is_some_and(ascii_word) {
                    return true;
                }
            }
        }
    }
    false
}

/// Префикс секции (SECTION_RE, batch-md.ts:60): THESIS/Canon/Spine/Stack/
/// POS/NEG пишутся в слот; PROTOCOL/HEROINE-BATCH — обрывают (section=null).
fn section_prefix<'a>(line: &'a str) -> Option<(&'static str, &'a str)> {
    for p in [
        ("THESIS:", "thesis"),
        ("Canon:", "canon"),
        ("Spine:", "spine"),
        ("Stack:", "stack"),
        ("POS:", "pos"),
        ("NEG:", "neg"),
    ] {
        if let Some(rest) = line.strip_prefix(p.0) {
            return Some((p.1, rest));
        }
    }
    if line.starts_with("PROTOCOL:") || line.starts_with("HEROINE-BATCH:") {
        return Some(("", ""));
    }
    None
}

/// parseBatchMd (batch-md.ts:122) — подмножество: слоты по шапкам, секции по
/// префиксам, boundary-линии секцию обрывают. 1-в-1 по семантике.
fn parse_batch_md(md: &str) -> Option<(String, Vec<SlotMd>)> {
    if md.is_empty() {
        return None;
    }
    let lines: Vec<&str> = md.split('\n').collect();
    // тайтл BatchMd: первая строка «# …» (радар); гейты берут extract_batch_title
    let mut radar_title = String::new();
    for l in &lines {
        if let Some(rest) = l.strip_prefix("# ") {
            radar_title = collapse(rest);
            break;
        }
    }
    let mut slots: Vec<SlotMd> = Vec::new();
    let mut cur: Option<SlotMd> = None;
    let mut section: Option<&'static str> = None;
    for line in &lines {
        if let Some((id, slug, meta)) = slot_header(line) {
            if let Some(s) = cur.take() {
                slots.push(s);
            }
            let (kind, who, rating, pose, palette) = parse_meta(&meta);
            cur = Some(SlotMd {
                id,
                slug,
                raw_header: (*line).to_string(),
                raw_meta: meta,
                kind,
                who,
                rating,
                pose,
                palette,
                thesis: String::new(),
                canon: String::new(),
                spine: String::new(),
                stack: String::new(),
                pos: String::new(),
                neg: String::new(),
            });
            section = None;
            continue;
        }
        if cur.is_none() {
            continue;
        }
        if is_boundary(line) {
            section = None;
            continue;
        }
        if let Some((key, rest)) = section_prefix(line) {
            // неизвестные секции → section = null: строки не прилипают
            section = if key.is_empty() { None } else { Some(key) };
            if let (Some(sec), Some(slot)) = (section, cur.as_mut()) {
                let same_line = collapse(rest);
                if !same_line.is_empty() {
                    append_section(slot, sec, &same_line);
                }
            }
            continue;
        }
        if let (Some(sec), Some(slot)) = (section, cur.as_mut()) {
            let v = collapse(line);
            if v.is_empty() {
                continue;
            }
            append_section(slot, sec, &v);
        }
    }
    if let Some(s) = cur.take() {
        slots.push(s);
    }
    if slots.is_empty() {
        None
    } else {
        Some((radar_title, slots))
    }
}

fn append_section(slot: &mut SlotMd, section: &str, value: &str) {
    let field = match section {
        "thesis" => &mut slot.thesis,
        "canon" => &mut slot.canon,
        "spine" => &mut slot.spine,
        "stack" => &mut slot.stack,
        "pos" => &mut slot.pos,
        "neg" => &mut slot.neg,
        _ => return,
    };
    if field.is_empty() {
        *field = value.to_string();
    } else {
        field.push(' ');
        field.push_str(value);
    }
}

/// Тайтл батча из H1 (extractBatchTitle, gates.ts:166): легаси
/// «# THREAD 4 … Batch T4-NN «TITLE»» и современный «# T4-NN «TITLE» …».
pub fn extract_batch_title(text: &str) -> String {
    // легаси: /#\s*THREAD 4[^\n]*?Batch\s+(T4-\d+)[^\n]*?["«]([^"»\n]+)["»]/i
    // (# не обязан быть в начале строки; Batch\s+ — ≥1 пробел; quote-пара
    // берётся первой в строке — во всех 65 живых файлах первая кавычка
    // и есть тайтл)
    for line in text.split('\n') {
        let hash = match line.find('#') {
            Some(i) => i,
            None => continue,
        };
        let after_hash = line[hash + 1..].trim_start();
        let up = after_hash.to_ascii_uppercase();
        if !up.starts_with("THREAD 4") {
            continue;
        }
        if let Some(title) = legacy_batch_title(&up, line) {
            return title;
        }
    }
    // современный: /^#\s*T4-[\dA-Za-z.-]+\s*["«]([^"»\n]+)["»]/m — «#» в
    // начале строки, \s* ДО идентификатора и ПОСЛЕ (ноль пробелов — тоже)
    for line in text.split('\n') {
        let after_hash = match line.strip_prefix('#') {
            Some(r) => r,
            None => continue,
        };
        let trimmed = after_hash.trim_start();
        let Some(rest) = trimmed.strip_prefix("T4-") else { continue };
        let id_end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'))
            .unwrap_or(rest.len());
        if id_end == 0 {
            continue;
        }
        let after_id = rest[id_end..].trim_start();
        // \s*["«] — сразу после пробелов обязана быть кавычка (иначе это
        // не тайтл-строка: «# T4-14: …» — двоеточие рвёт матч, как и в TS)
        if after_id.starts_with('"') || after_id.starts_with('«') {
            if let Some(title) = quoted_title(after_id) {
                return title;
            }
        }
    }
    String::new()
}

/// Хвост легаси-тайтла после THREAD 4: найти «BATCH\s+T4-<digit>» в строке
/// (без учёта регистра); квот-пара — первая в ИСХОДНОЙ строке.
fn legacy_batch_title(up_line: &str, orig_line: &str) -> Option<String> {
    let mut from = 0usize;
    while let Some(rel) = up_line[from..].find("BATCH") {
        let b = from + rel;
        let rest = &up_line[b + "BATCH".len()..];
        let trimmed = rest.trim_start();
        if rest.len() != trimmed.len() && trimmed.starts_with("T4-") {
            let digits = &trimmed[3..];
            if digits.starts_with(|c: char| c.is_ascii_digit()) {
                return quoted_title(orig_line);
            }
        }
        from = b + 1;
    }
    None
}

/// Содержимое первых «…» или «…» в строке (одна форма для обоих тайтлов).
fn quoted_title(line: &str) -> Option<String> {
    let open = line.find(['"', '«'])?;
    let open_len = line[open..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    let rest = &line[open + open_len..];
    let close = rest.find(['"', '»'])?;
    if close == 0 {
        return None;
    }
    Some(rest[..close].trim().to_string())
}

/// genreOf (gates.ts:153): жанр из меты шапки, EXP — первым (оверлей
/// поверх 24-слотового закона, приказ 2026-10-08).
pub fn genre_of(meta: &str) -> &'static str {
    let u = meta.to_uppercase();
    for g in ["EXP", "OC", "NICHE", "VOLT", "EXQUISITE"] {
        if contains_word(&u, g) {
            return g;
        }
    }
    ""
}

/// tierOf (gates.ts:210): порядок важен — XXX до X, R+ до R («R+ ·» — \b
/// после «+» никогда не сработает), PG-13 до X.
pub fn tier_of(meta: &str) -> &'static str {
    let u = meta.to_uppercase();
    if contains_word(&u, "XXX") {
        return "XXX";
    }
    // /\bR\+/ — «+» не слово-симвл: TS НЕ проверяет хвост после «+»
    // (теоретическое «R+15» — тир R+ в TS); contains_word требует границу
    // с обеих сторон, поэтому для R+ — только левая граница (1-в-1 к /\bR\+/)
    if contains_word_left(&u, "R+") || contains_word(&u, "RPLUS") {
        return "R+";
    }
    if contains_word(&u, "PG-13") || contains_word(&u, "PG13") {
        return "PG-13";
    }
    if contains_word(&u, "X") {
        return "X";
    }
    if contains_word(&u, "R") {
        return "R";
    }
    ""
}

/// parseBatch (gates.ts:182) — тонкий адаптер над parseBatchMd: интерфейс
/// ParsedSlot для гейтов; заголовок обязан нести мету в скобках.
pub fn parse_batch(slug: &str, text: &str) -> TextBatch {
    let title = extract_batch_title(text);
    let Some((_, slots_md)) = parse_batch_md(text) else {
        return TextBatch { slug: slug.to_string(), text: text.to_string(), title, slots: Vec::new() };
    };
    let slots = slots_md
        .into_iter()
        .map(|s| {
            let position: u32 = s.id.trim_start_matches('P').parse().unwrap_or(0);
            // Stack: CR-[A-Z]\d{2} — все носители, порядок файла
            let stack = find_carrier_ids(&s.stack);
            let genre = genre_of(&s.raw_meta).to_string();
            TextSlot {
                position,
                header: s.raw_header,
                anchor: s.slug,
                meta: s.raw_meta,
                genre,
                thesis: s.thesis,
                canon: s.canon,
                spine: s.spine,
                stack,
                pos: s.pos,
                neg: s.neg,
                kind: s.kind,
                who: s.who,
                rating: s.rating,
                pose: s.pose,
                palette: s.palette,
            }
        })
        .collect();
    TextBatch { slug: slug.to_string(), text: text.to_string(), title, slots }
}

/// /CR-[A-Z]\d{2}/g — глобальный поиск носителей в Stack-строке.
fn find_carrier_ids(stack: &str) -> Vec<String> {
    let b = stack.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 6 <= b.len() {
        if b[i] == b'C'
            && b[i + 1] == b'R'
            && b[i + 2] == b'-'
            && b[i + 3].is_ascii_uppercase()
            && b[i + 4].is_ascii_digit()
            && b[i + 5].is_ascii_digit()
        {
            out.push(stack[i..i + 6].to_string());
            i += 6;
        } else {
            i += 1;
        }
    }
    out
}

/* ================================================================== */
/* ASCII-границы слов: JS \b = [A-Za-z0-9_] (ручной скан, без regex-crate)*/
/* ================================================================== */

pub(crate) fn ascii_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Подстрока, окружённая ASCII-границами слов (JS \b).
pub fn contains_word(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut from = 0usize;
    while let Some(rel) = hay[from..].find(needle) {
        let s = from + rel;
        let e = s + needle.len();
        let before = s == 0 || !hay[..s].chars().next_back().is_some_and(ascii_word);
        let after = e >= hay.len() || !hay[e..].chars().next().is_some_and(ascii_word);
        if before && after {
            return true;
        }
        from = s + 1;
    }
    false
}

/// Регистронезависимый contains_word (JS /i) — ASCII-иглы.
pub(crate) fn contains_word_ci(hay: &str, needle: &str) -> bool {
    contains_word(&hay.to_ascii_lowercase(), &needle.to_ascii_lowercase())
}

/// /\bNEEDLE/ — только ЛЕВАЯ граница слова (тир «R+»: /\bR\+/ — «+»
/// не слово-симвл, TS хвост не проверяет).
fn contains_word_left(hay: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut from = 0usize;
    while let Some(rel) = hay[from..].find(needle) {
        let s = from + rel;
        if s == 0 || !hay[..s].chars().next_back().is_some_and(ascii_word) {
            return true;
        }
        from = s + 1;
    }
    false
}

/// squash: дефисы → подчёркивания (character-collision, закон №23
/// sd_fragment verbatim: «aurora-teal-silk» = один токен, T4-29-находка).
fn squash(s: &str) -> String {
    s.replace('-', "_")
}

/* ================================================================== */
/* Этап 0.2 — контракт (contracts/T4-NN.json → типизированные структуры)  */
/* ================================================================== */

#[derive(Clone, Debug, Default)]
pub struct ExpProg {
    pub letter: String,
    pub half: String,
    pub pair_with: Option<u32>,
    pub hypothesis: String,
}

#[derive(Clone, Debug, Default)]
pub struct ContractSlot {
    pub position: u32,
    pub kind: String,
    pub rating: String,
    pub oc: Option<String>,
    pub oc_theme: Option<String>,
    pub race: Option<String>,
    pub pose: String,
    pub pose_name: String,
    pub pose_risk: String,
    pub palette: String,
    pub carriers: Vec<String>,
    pub dress_channel: Option<String>,
    pub exp: Option<ExpProg>,
    pub ab_pair: Option<String>,
    pub ab_half: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct AbPair {
    pub pair: String,
    pub a: u32,
    pub b: u32,
    pub lead: String,
}

#[derive(Clone, Debug, Default)]
pub struct Contract {
    pub theme: Option<String>,
    pub engine: Option<String>,
    pub rebuild_of: Option<String>,
    pub slots: Vec<ContractSlot>,
    pub ab_pairs: Vec<AbPair>,
}

fn s_of(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(String::from)
}

/// Лоадер контракта: RO-файл → типизированные структуры; отсутствует/бит —
/// None (зеркало readJson). RAW/ручные батчи живут без контракта — честно.
pub fn load_contract(slug: &str) -> Option<Contract> {
    load_contract_in(&contracts_dir(), slug)
}

/// Тот же лоадер из другого корня (репетиции конвейера пишут и читают
/// СВОИ контракты — прод-дерево не трогают).
pub fn load_contract_in(dir: &std::path::Path, slug: &str) -> Option<Contract> {
    let v = read_json(&dir.join(format!("{slug}.json")))?;
    let mut out = Contract {
        theme: s_of(&v, "theme"),
        engine: s_of(&v, "engine"),
        rebuild_of: s_of(&v, "rebuildOf"),
        slots: Vec::new(),
        ab_pairs: Vec::new(),
    };
    if let Some(arr) = v.get("slots").and_then(|x| x.as_array()) {
        for slot in arr {
            let exp = slot.get("exp").map(|e| ExpProg {
                letter: s_of(e, "letter").unwrap_or_else(|| "α".into()),
                half: s_of(e, "half").unwrap_or_else(|| "A".into()),
                pair_with: e.get("pairWith").and_then(|x| x.as_u64()).map(|n| n as u32),
                hypothesis: s_of(e, "hypothesis").unwrap_or_default(),
            });
            let ab = slot.get("ab");
            out.slots.push(ContractSlot {
                position: slot.get("position").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                kind: s_of(slot, "kind").unwrap_or_default(),
                rating: s_of(slot, "rating").unwrap_or_default(),
                oc: s_of(slot, "oc"),
                oc_theme: s_of(slot, "ocTheme"),
                race: s_of(slot, "race"),
                pose: s_of(slot, "pose").unwrap_or_default(),
                pose_name: s_of(slot, "poseName").unwrap_or_default(),
                pose_risk: s_of(slot, "poseRisk").unwrap_or_default(),
                palette: s_of(slot, "palette").unwrap_or_default(),
                carriers: slot
                    .get("carriers")
                    .and_then(|x| x.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|c| c.get("id").and_then(|i| i.as_str()).map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                dress_channel: slot.get("dress").and_then(|d| s_of(d, "channel")),
                exp,
                ab_pair: ab.and_then(|a| s_of(a, "pair")),
                ab_half: ab.and_then(|a| s_of(a, "half")),
            });
        }
    }
    if let Some(arr) = v.get("abPairs").and_then(|x| x.as_array()) {
        for p in arr {
            out.ab_pairs.push(AbPair {
                pair: s_of(p, "pair").unwrap_or_default(),
                a: p.get("a").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                b: p.get("b").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
                lead: s_of(p, "lead").unwrap_or_default(),
            });
        }
    }
    Some(out)
}

/* ================================================================== */
/* Этап 0.3 — спеки (specs/bans.json — читает только budget из этапа 1)  */
/* ================================================================== */

#[derive(Clone, Debug)]
pub struct Bans {
    pub pos_target: u32,
    pub pos_hard: u32,
    pub hedge_budget: u32,
}

/// getBans() (specs.ts:501): null при отсутствии/битом JSON — гейты падают
/// на TS-дефолты (?? 300 / ?? 400 / ?? 2).
pub fn load_bans() -> Option<Bans> {
    let v = read_json(&specs_dir().join("bans.json"))?;
    let wb = v.get("word_budget")?;
    Some(Bans {
        pos_target: wb.get("pos_target").and_then(|x| x.as_u64()).unwrap_or(300) as u32,
        pos_hard: wb.get("pos_hard").and_then(|x| x.as_u64()).unwrap_or(400) as u32,
        hedge_budget: v.get("hedge_budget").and_then(|x| x.as_u64()).unwrap_or(2) as u32,
    })
}

/// OC-ростер: имена канонизированных ОС из specs/oc-canon.json (canon-гейт
/// читает их оттуда, не из базы — Залп 2, аудит RC-2/MD-1).
pub fn oc_roster() -> Vec<String> {
    read_json(&specs_dir().join("oc-canon.json"))
        .and_then(|v| v.get("ocs").and_then(|o| o.as_object()).map(|o| o.keys().cloned().collect()))
        .unwrap_or_default()
}

/* ================================================================== */
/* Прод-контекст RO: runIndex + окно ротации + OC-ростер                */
/* ================================================================== */

#[derive(Clone, Debug, Default)]
pub struct ProdContext {
    /// сколько gate.run уже записано для слага в ПРОД-летописи (+1 = индекс
    /// следующего прогона; TS считает из readEvents — движок-эра = t4_events)
    pub prior_runs: u64,
    /// окно ротации: 3 последних сданных батча (окно-гейт следующей фазы)
    pub window_slugs: Vec<String>,
    pub oc_roster: Vec<String>,
}

pub fn prod_context(prod: &Connection, slug: &str) -> ProdContext {
    let prior_runs: u64 = prod
        .query_row(
            "SELECT COUNT(*) FROM t4_events
             WHERE type = 'gate.run' AND json_extract(data, '$.slug') = ?1",
            [slug],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n.max(0) as u64)
        .unwrap_or(0);
    let mut window_slugs = Vec::new();
    if let Ok(mut stmt) = prod.prepare(
        "SELECT slug FROM t4_batches WHERE status = 'delivered'
         ORDER BY delivered_at DESC LIMIT 3",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for row in rows.flatten() {
                window_slugs.push(row);
            }
        }
    }
    ProdContext { prior_runs, window_slugs, oc_roster: oc_roster() }
}

/* ================================================================== */
/* Квитанции: формы гейтов (Receipt из compile.rs — один тип на twin)    */
/* ================================================================== */

pub(crate) fn warn_receipt(gate: &'static str, findings: Vec<String>) -> Receipt {
    Receipt {
        gate,
        level: "warn",
        verdict: if findings.is_empty() { "PASS" } else { "WARN" },
        findings,
        notes: Vec::new(),
    }
}

pub(crate) fn advisory_receipt(gate: &'static str, findings: Vec<String>) -> Receipt {
    Receipt { gate, level: "advisory", verdict: "REPORT", findings, notes: Vec::new() }
}

/// JSON-форма квитанции (та же, что compile::receipt_json — он приватен,
/// compile.rs неприкосновенен; форма идентична поле-в-поле).
pub fn receipt_json(r: &Receipt) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    m.insert("gate".into(), r.gate.into());
    m.insert("level".into(), r.level.into());
    m.insert("verdict".into(), r.verdict.into());
    m.insert(
        "findings".into(),
        serde_json::Value::Array(r.findings.iter().map(|f| f.as_str().into()).collect()),
    );
    if !r.notes.is_empty() {
        m.insert(
            "notes".into(),
            serde_json::Value::Array(r.notes.iter().map(|n| n.as_str().into()).collect()),
        );
    }
    serde_json::Value::Object(m)
}

pub fn receipts_json(receipts: &[Receipt]) -> Vec<serde_json::Value> {
    receipts.iter().map(receipt_json).collect()
}

/* ================================================================== */
/* Этап 1 — 13 словарных гейтов (порядок как в runGates)                */
/* ================================================================== */

/// 7. budget (gates.ts:1203, warn) — POS ≤300 слов цель/≤400 потолок,
/// хеджей ≤2. Спек: bans.json word_budget/pos_target/pos_hard, hedge_budget.
pub fn gate_budget(batch: &TextBatch, bans: Option<&Bans>) -> Receipt {
    let (target, hard_cap, hedge_budget) = match bans {
        Some(b) => (b.pos_target, b.pos_hard, b.hedge_budget),
        None => (300, 400, 2),
    };
    const HEDGES: [&str; 7] =
        ["maybe", "perhaps", "slightly", "almost", "sort of", "kind of", "a bit"];
    let mut f = Vec::new();
    for s in &batch.slots {
        let words = s.pos.split_whitespace().count() as u32;
        if words > hard_cap {
            f.push(format!("P{}: POS {} слов > {}", s.position, words, hard_cap));
        } else if words > target {
            f.push(format!("P{}: POS {} слов (цель {}) — плотнее", s.position, words, target));
        }
        let pos_lower = s.pos.to_lowercase();
        let hedges_n = HEDGES.iter().filter(|h| pos_lower.contains(**h)).count();
        if hedges_n as u32 > hedge_budget {
            f.push(format!("P{}: хеджей {} > {}", s.position, hedges_n, hedge_budget));
        }
    }
    warn_receipt("budget", f)
}

/// closerClassOf (gates.ts:470): класс клоузера по последнему предложению
/// POS (N25-ловушка; типографские кавычки “ ” „ « — тоже диалог).
pub fn closer_class_of(last: &str) -> &'static str {
    // /[«"\u201E\u201C\u201D]/ — кавычка где угодно в предложении
    if last.contains(['«', '"', '\u{201E}', '\u{201C}', '\u{201D}']) {
        return "dialogue";
    }
    // /["\u201D]\s*$/ — закрывается кавычкой верхних регистров
    let trimmed = last.trim_end();
    if trimmed.ends_with('"') || trimmed.ends_with('\u{201D}') {
        return "dialogue";
    }
    // /—\s*\S+[.,]?\s*$/: после «—» ровно одно слово до конца (жадный \S+,
    // пробел внутри не даёт матча на этой позиции — но другой «—» может)
    for (idx, _) in trimmed.match_indices('—') {
        let rest = trimmed[idx + '—'.len_utf8()..].trim_start();
        if rest.is_empty() {
            continue;
        }
        let head_len = rest.find(char::is_whitespace).unwrap_or(rest.len());
        if rest[head_len..].trim().is_empty() {
            return "fragment-pair";
        }
    }
    // /\b(waited|still|again|on)\.\s*$/i — image-close: хвостовой слово-ран
    if trimmed.ends_with('.') {
        let head = &trimmed[..trimmed.len() - 1];
        let run: String = head
            .chars()
            .rev()
            .take_while(|c| ascii_word(*c))
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if matches!(run.as_str(), "waited" | "still" | "again" | "on") {
            return "image-close";
        }
    }
    "other"
}

/// 8. cadence (gates.ts:1219, warn) — клоузер-формула ≤60% одного класса.
pub fn gate_cadence(batch: &TextBatch) -> Receipt {
    let mut f = Vec::new();
    // порядок ключей как Object.entries: 'other' первым, классы по первому появлению
    let mut closers: Vec<(&'static str, u32)> = vec![("other", 0)];
    for s in &batch.slots {
        let last = last_sentence(&s.pos);
        let cls = closer_class_of(&last);
        match closers.iter().position(|(k, _)| *k == cls) {
            Some(i) => closers[i].1 += 1,
            None => closers.push((cls, 1)),
        }
    }
    let total = batch.slots.len().max(1) as f64;
    for (cls, n) in closers {
        let share = n as f64 / total;
        if share > 0.6 && cls != "other" {
            f.push(format!(
                "клоузер-формула: {} {}% > 60% (N25-ловушка)",
                cls,
                (share * 100.0).round() as i64
            ));
        }
    }
    warn_receipt("cadence", f)
}

/// Сплит предложений POS: граница = пробельная серия после [.!?…"\u00bb]
/// (JS split /(?<=[…])\s+/ — lookbehind, ручной скан); последнее — клоузер.
fn last_sentence(pos: &str) -> String {
    let chars: Vec<char> = pos.chars().collect();
    let mut last_cut: Option<usize> = None;
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            let run_start = i;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            if run_start > 0
                && matches!(chars[run_start - 1], '.' | '!' | '?' | '…' | '"' | '\u{00BB}')
            {
                last_cut = Some(run_start);
            }
        } else {
            i += 1;
        }
    }
    let start = last_cut.unwrap_or(0);
    chars[start..].iter().collect::<String>().trim().to_string()
}

/// 8c. prop-geometry (gates.ts:1286, warn) — сложный проп ≥2 якорей
/// контакта (вердикт T4-02, «небольшая хуёвая геометрия расположения»).
pub fn gate_prop_geometry(batch: &TextBatch) -> Receipt {
    const COMPLEX_PROPS: &[&str] = &[
        "wheel", "helm", "valve", "ladder", "stairs", "staircase", "railing", "rail",
        "bicycle", "handlebar", "rope", "pulley", "crane", "swing", "scaffold",
        "scaffolding", "mast", "tiller", "treadmill", "steering", "oar", "winch",
    ];
    const ANCHORS: &[&str] = &[
        "hand on", "hands on", "hands at", "fingers around", "fingers curled", "grip",
        "gripping", "grips", "grip on", "braced", "brace", "foot on", "feet on",
        "feet braced", "feet planted", "palm flat", "palm on", "knee on", "elbow on",
        "shoulder against", "leaning against", "lean against", "arched against",
        "heels planted", "toes on", "fingertips on", "wrapped around", "wound around",
        "knuckles white", "soles flat", "held fast", "anchored",
    ];
    let mut f = Vec::new();
    for s in &batch.slots {
        // тег-блок — то, что рендерер обязан нарисовать (до первой точки);
        // метафоры прозы («her leg as its staircase») пропами не считаются
        let tag_block = tag_block_of(&s.pos);
        let prop = match COMPLEX_PROPS.iter().find(|p| contains_word(&tag_block, p)) {
            Some(p) => *p,
            None => continue,
        };
        let pos_lower = s.pos.to_lowercase();
        let anchor_hits = ANCHORS.iter().filter(|a| pos_lower.contains(**a)).count();
        if anchor_hits < 2 {
            f.push(format!(
                "P{}: сложный проп «{}» с {}/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)",
                s.position, prop, anchor_hits
            ));
        }
    }
    warn_receipt("prop-geometry", f)
}

/// Тег-блок POS: до первой точки, нижний регистр (весь POS, если точки нет).
pub(crate) fn tag_block_of(pos: &str) -> String {
    match pos.find('.') {
        Some(0) | None => pos.to_lowercase(),
        Some(i) => pos[..i].to_lowercase(),
    }
}

/// 8f. noun-lock (gates.ts:1493, warn) — ЗАКОН САЛИЕНСА: заявка живёт на
/// ИМЕНОВАННОМ объекте; подслой под сквозь-ткань заявку лочится в NEG
/// (тишина = дыра); §9-септима bare-under позитивом (вердикт T4-05, P07).
pub fn gate_noun_lock(batch: &TextBatch) -> Receipt {
    const UPPER_LIGHT: &[&str] = &[
        "blouse", "tee", "t-shirt", "shirt", "knit", "cardigan", "leotard",
        "bodysuit", "swimsuit", "bikini", "romper", "slip", "dress",
        "sundress", "nightgown", "gown", "robe", "kimono", "yukata", "sheet",
        "towel", "halter", "tunic", "apron", "qipao", "cheongsam",
        "sweater", "gi", "nightshirt",
        "crop top", "tank top", "tube top", "wrap top", "halter top",
        "jersey", "pullover", "bodystocking", "fishnet top",
    ];
    const LOWER_LIGHT: &[&str] = &[
        "skirt", "shorts", "pants", "trousers", "leggings", "tights",
        "pantyhose", "dress", "sheet", "towel", "sarong", "wrap", "slip",
        "leotard", "bodysuit", "swimsuit", "bikini", "romper", "qipao", "boyshorts",
    ];
    const UNDERLOCK: &[&str] = &[
        "bra", "sports bra", "push-up bra", "camisole", "bandeau",
        "undershirt", "swimsuit top",
    ];
    const UPPER_CLAIMS: &[&str] = &["nipples through clothing", "clothed nipples", "see-through"];
    const LOWER_CLAIMS: &[&str] = &["visible pantyline", "pantyline"];
    const ON_SKIN: &[&str] = &["taped nipples", "topless with tape", "handbra"];
    const BARE_UNDER: &[&str] = &[
        "nothing underneath", "nothing beneath", "nothing under", "braless",
        "no bra", "without underlayer", "worn without a bra",
        "worn without underlayer", "unlined", "only layer", "single layer",
        "worn alone", "on bare skin", "against bare skin",
    ];
    let mut f = Vec::new();
    for s in &batch.slots {
        if tier_of(&s.meta) != "R+" {
            continue;
        }
        let tag_block = tag_block_of(&s.pos);
        let neg_lower = s.neg.to_lowercase();
        let pos_lower_full = s.pos.to_lowercase();
        let upper_active: Vec<&str> =
            UPPER_CLAIMS.iter().filter(|c| tag_block.contains(**c)).copied().collect();
        let lower_active: Vec<&str> =
            LOWER_CLAIMS.iter().filter(|c| tag_block.contains(**c)).copied().collect();
        let on_skin_active: Vec<&str> =
            ON_SKIN.iter().filter(|c| tag_block.contains(**c)).copied().collect();
        if upper_active.is_empty() && lower_active.is_empty() && on_skin_active.is_empty() {
            continue;
        }
        if !upper_active.is_empty() {
            let garment = UPPER_LIGHT.iter().find(|g| contains_word(&tag_block, g));
            if garment.is_none() {
                f.push(format!(
                    "P{}: сквозь-ткань заявка ({}) не залочена на именованную тонкую вещь — назови garment существительным (blouse/tee/shirt/knit/swimsuit/leotard/sheet/towel…), прилагательное заявку не несёт (§10-поправка, noun-lock)",
                    s.position, upper_active[0]
                ));
            }
            // тишина по подслою = дыра: NEG лочит подслой (границы слов
            // обязательны: «brazier» свечной гарды ≠ «bra»)
            let lock = UNDERLOCK
                .iter()
                .filter(|t| !contains_word(&tag_block, t))
                .find(|t| contains_word(&neg_lower, t));
            if lock.is_none() {
                f.push(format!(
                    "P{}: тишина по подслою = дыра — NEG не лочит подслой (bra / camisole / bandeau / undershirt): рендерер дорисует его сам и тир упадёт в R (§10-поправка, noun-lock)",
                    s.position
                ));
            }
            // §9-септима, правило 1 — BARE-UNDER ПОЗИТИВОМ (T4-05, P07:
            // только для nipples through / clothed nipples)
            let needs_bare_under = upper_active
                .iter()
                .any(|c| *c == "nipples through clothing" || *c == "clothed nipples");
            if needs_bare_under && !BARE_UNDER.iter().any(|t| pos_lower_full.contains(t)) {
                f.push(format!(
                    "P{}: подслой не заявлен позитивом — «braless / nothing underneath» нет в POS: негатива мало, рендерер рисует лифчик ПОВЕРХ NEG-лока (вердикт T4-05, P07) — POS обязан нести позитивное утверждение (§9-септима, noun-lock bare-under)",
                    s.position
                ));
            }
        }
        if !lower_active.is_empty() {
            let garment = LOWER_LIGHT.iter().find(|g| contains_word(&tag_block, g));
            if garment.is_none() {
                f.push(format!(
                    "P{}: нижняя заявка ({}) не залочена на именованную вещь — pantyline живёт на именованном низе (skirt/shorts/leggings/sheet…), не в воздухе (§10-поправка, noun-lock)",
                    s.position, lower_active[0]
                ));
            }
        }
    }
    warn_receipt("noun-lock", f)
}

/// 8g. character-collision (gates.ts:1589, warn) — данбуру-омонимы
/// допустимы ТОЛЬКО составными (aurora borealis); одиночное слово —
/// триггер чужого персонажа (T4-05, P08: aurora_(arknights) «пробежал
/// персонаж»). TS-регекс с lookahead — ручной скан, семантика 1-в-1.
pub fn gate_character_collision(batch: &TextBatch) -> Receipt {
    // слово → безопасные продолжения (составные формы)
    const HOMONYMS: &[(&str, &[&str])] = &[
        ("aurora", &["borealis", "australis", "sky", "light", "dawn", "veil", "crown", "glow", "shimmer"]),
        ("meteor", &["shower", "strike", "glow"]),
        ("nova", &["burst", "glow"]),
        ("alice", &["in wonderland", "band", "blue"]),
        ("miku", &["hatsune"]),
        ("celestia", &["gown", "veil"]),
    ];
    let mut f = Vec::new();
    for s in &batch.slots {
        let first_period = s.pos.find('.');
        let tag_block = squash(&match first_period {
            Some(0) | None => s.pos.clone(),
            Some(i) => s.pos[..i].to_string(),
        }
        .to_lowercase());
        let prose = squash(&match first_period {
            Some(i) if i > 0 => s.pos[i..].to_lowercase(),
            _ => String::new(),
        });
        'words: for (word, safe) in HOMONYMS {
            // \bWORD\b(?!\s+(?:safe…)) — одиночное слово триггер; составное
            // (продолжение из safe-списка сразу за ним) — разрешено
            if homonym_trigger(&tag_block, word, safe) || homonym_trigger(&prose, word, safe) {
                f.push(format!(
                    "P{}: омоним данбуру «{}» в POS — рендерер матчит чужого персонажа ({}_…: T4-05 P08 — aurora_(arknights) «пробежал персонаж»). Только составной формой (§9-септима, character-collision)",
                    s.position, word, word
                ));
                break 'words;
            }
        }
    }
    warn_receipt("character-collision", f)
}

/// Ручной скан `\bword\b(?!\s+(?:alt1|alt2…))` (регистронезависимо; вход
/// уже squashed+lowercase: '_' — слово-симвл, дефисные цепочки = один
/// токен, одиночное «aurora,» остаётся триггером).
fn homonym_trigger(hay: &str, word: &str, safe: &[&str]) -> bool {
    let mut from = 0usize;
    while let Some(rel) = hay[from..].find(word) {
        let s = from + rel;
        let e = s + word.len();
        let before = s == 0 || !hay[..s].chars().next_back().is_some_and(ascii_word);
        let after_ok = e >= hay.len() || !hay[e..].chars().next().is_some_and(ascii_word);
        if before && after_ok {
            // lookahead (?!\s+alt): триггер = следующий текст НЕ «пробелы+alt»
            let rest = &hay[e..];
            let trimmed = rest.trim_start();
            let consumed_ws = rest.len() - trimmed.len();
            if consumed_ws == 0 {
                return true;
            }
            let ok_safe =
                safe.iter().any(|alt| trimmed.len() >= alt.len() && trimmed[..alt.len()].eq_ignore_ascii_case(alt));
            if !ok_safe {
                return true;
            }
        }
        from = s + 1;
    }
    false
}

/// 9d. theme-presence (gates.ts:1665, warn) — тема-слова ≥60% не-EXP
/// слотов (вердикт автора «тема не раскрывается»): строка ТЕМА-СЛОВА из
/// шапки — та же, что видит автор.
pub fn gate_theme_presence(batch: &TextBatch) -> Receipt {
    let mut f = Vec::new();
    // /^ТЕМА-СЛОВА:\s*(.+)$/m — (.+) ≥1 символ: пустой хвост = строки нет
    let kw_line = batch
        .text
        .split('\n')
        .find_map(|l| l.strip_prefix("ТЕМА-СЛОВА:").filter(|rest| !rest.is_empty()).map(String::from));
    match kw_line {
        None => f.push(
            "в батче нет строки ТЕМА-СЛОВА — тема не меряется (спайн писца обязан вывести из темы)".into(),
        ),
        Some(rest) => {
            let kws: Vec<String> = rest
                .split(',')
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
            let with_theme = batch
                .slots
                .iter()
                .filter(|s| {
                    let pos_l = s.pos.to_lowercase();
                    let th_l = s.thesis.to_lowercase();
                    kws.iter().any(|k| pos_l.contains(k.as_str()) || th_l.contains(k.as_str()))
                })
                .count() as u32;
            // EXP-болванки темы не несут по построению — знаменатель без них
            let theme_denom = batch
                .slots
                .iter()
                .filter(|s| !s.header.contains("(EXP ·"))
                .count() as u32;
            if (with_theme as f64) < ((theme_denom.max(1)) as f64 * 0.6).ceil() {
                f.push(format!(
                    "тему несут {}/{} слотов (нужно ≥60%; EXP-болванки не в счёте) — слова: {}; тема живёт в кадрах, не в шапке",
                    with_theme, theme_denom, kws.join(", ")
                ));
            }
        }
    }
    warn_receipt("theme-presence", f)
}

/// 9e-2. original-character-coverage (gates.ts:1693, warn) — U1: тег
/// «original character» в каждом не-OC слоте (Issue #24); героинь-батчи
/// (HEROINE-BATCH: yes) — исключение (ORDER v2, вердикт T4-17).
pub fn gate_oc_coverage(batch: &TextBatch) -> Receipt {
    let mut f = Vec::new();
    // /HEROINE-BATCH:\s*yes/i на всём файле (\s* может пересечь \n)
    let lower_text = batch.text.to_ascii_lowercase();
    let heroine = lower_text
        .find("heroine-batch:")
        .map(|i| lower_text[i + 14..].trim_start().starts_with("yes"))
        .unwrap_or(false);
    if heroine {
        f.insert(
            0,
            "HEROINE-BATCH: yes — U1 действует только на OC-слоты (ORDER v2, вердикт T4-17); не-OC слоты исключены".into(),
        );
    } else {
        for s in &batch.slots {
            if s.genre == "OC" {
                continue;
            }
            let tag_block = tag_block_of(&s.pos);
            if !contains_word(&tag_block, "original character") {
                f.push(format!(
                    "P{}: нет original character в тег-блоке — U1 в ручном потоке (Issue #24)",
                    s.position
                ));
            }
        }
    }
    warn_receipt("original-character-coverage", f)
}

/// 9e-3. artist-leak (gates.ts:1717, warn) — artist-токены = PH-утечка
/// (T4-11 P06): имя художника в POS зовёт его стиль чужого рисования.
pub fn gate_artist_leak(batch: &TextBatch) -> Receipt {
    let mut f = Vec::new();
    for s in &batch.slots {
        let tag_block = match s.pos.find('.') {
            Some(0) | None => s.pos.clone(),
            Some(i) => s.pos[..i].to_string(),
        };
        if contains_word_ci(&tag_block, "artist")
            || contains_word_ci(&tag_block, "art by")
            || contains_word_ci(&tag_block, "drawn by")
            || contains_word_ci(&tag_block, "painted by")
        {
            f.push(format!(
                "P{}: artist-подобный токен в тег-блоке — artist_ban, PH-утечка (Issue #24, U3)",
                s.position
            ));
        }
    }
    warn_receipt("artist-leak", f)
}

/// 9e. garment-family (gates.ts:1733, warn) — бельё-семья ≤58% батча
/// (U8; вердикт автора «дохуя белья с чулками»). \bbra\b(?!less) ≡ \bbra\b
/// («less» начинается со слова-симвл — границы и так нет; lookahead
/// избыточен), остальное — слово-границы, регистр неважен.
pub fn gate_garment_family(batch: &TextBatch) -> Receipt {
    let mut f = Vec::new();
    let lingerie_n = batch
        .slots
        .iter()
        .filter(|s| {
            let p = s.pos.to_lowercase();
            contains_word(&p, "lingerie")
                || contains_word(&p, "stockings")
                || contains_word(&p, "stocking")
                || contains_word(&p, "garter belt")
                || contains_word(&p, "panties")
                || contains_word(&p, "thong")
                || contains_word(&p, "bra")
                || contains_word(&p, "lace")
        })
        .count();
    let cap = ((batch.slots.len() as f64) * 0.58).ceil() as usize;
    if lingerie_n > cap {
        f.push(format!(
            "бельё-семья монополизирует батч: {}/{} слотов несут lingerie/stockings/garter — вердикт автора «дохуя белья с чулками»; разнообразь семьи одежды (forma/верхняя/спорт/домашнее), эротика не обязана быть бельём",
            lingerie_n,
            batch.slots.len()
        ));
    }
    warn_receipt("garment-family", f)
}

/// 10. freq-report (gates.ts:1812, advisory) — слово ≥8 слотов = кандидат
/// в тики (отчёт автору, вердикт не меняет).
pub fn gate_freq_report(batch: &TextBatch) -> Receipt {
    const STOP: &[&str] = &[
        "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "with", "her", "his",
        "its", "from", "into", "over", "under", "is", "are", "was", "were", "be", "been",
        "by", "as", "for", "that", "this", "it", "she", "they", "them", "their", "not",
        "no", "but", "all", "one", "two",
    ];
    // порядок ключей = порядок первого присвоения (Object.entries в JS)
    let mut freq: Vec<(String, u32)> = Vec::new();
    for s in &batch.slots {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for w in ascii_words(&s.pos.to_lowercase()) {
            if STOP.contains(&w.as_str()) || w.chars().count() < 5 || !seen.insert(w.clone()) {
                continue;
            }
            match freq.iter_mut().find(|(k, _)| *k == w) {
                Some((_, n)) => *n += 1,
                None => freq.push((w, 1)),
            }
        }
    }
    // .sort((a,b) => b[1]-a[1]) — стабильно, .slice(0, 12)
    freq.sort_by(|a, b| b.1.cmp(&a.1));
    let denom = batch.slots.len().max(1);
    let tics: Vec<String> = freq
        .into_iter()
        .filter(|(_, n)| *n >= 8)
        .take(12)
        .map(|(w, n)| format!("{w} {n}/{denom}"))
        .collect();
    let mut f = Vec::new();
    if tics.is_empty() {
        f.push("тиков не обнаружено".into());
    } else {
        f.push(format!("кандидаты в тики: {}", tics.join(" · ")));
    }
    advisory_receipt("freq-report", f)
}

/// /[a-z']+/g — слова из строчных ASCII-букв и апострофов.
fn ascii_words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        if ch.is_ascii_lowercase() || ch == '\'' {
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

/// 11. usage (gates.ts:1837, advisory) — носители в стеках, счёт R+/X.
pub fn gate_usage(batch: &TextBatch) -> Receipt {
    let stacked: Vec<&str> = batch.slots.iter().flat_map(|s| s.stack.iter().map(|x| x.as_str())).collect();
    let mut uniq = std::collections::HashSet::new();
    for id in &stacked {
        uniq.insert(*id);
    }
    let rplus = batch.slots.iter().filter(|s| tier_of(&s.meta) == "R+").count();
    let x = batch.slots.iter().filter(|s| tier_of(&s.meta) == "X").count();
    advisory_receipt(
        "usage",
        vec![
            format!("носителей в стеках: {}; уникальных: {}", stacked.len(), uniq.len()),
            format!("R+ слотов: {rplus}; X: {x}"),
        ],
    )
}

/// 27. one-hard-claim G20 (gates.ts:2332, warn) — ОДНА hard-claim семья на
/// R+ слоте (№52-бэклог; две заявки гасят друг друга — T4-19/T4-32
/// «стерильно»). EXP-слоты — эксперимент по определению, не судим.
pub fn gate_one_hard_claim(batch: &TextBatch) -> Receipt {
    const THROUGH: &[&str] = &["nipples through clothing", "clothed nipples", "covered nipples"];
    const WET: &[&str] = &["wet clothes", "see-through", "sheer fabric"];
    const PANTYLINE: &[&str] = &["visible pantyline", "cameltoe"];
    const ON_SKIN: &[&str] = &["handbra", "tape on nipples", "arms covering chest", "arms covering her chest"];
    let families: [(&str, &[&str]); 4] = [
        ("through", THROUGH),
        ("wet", WET),
        ("pantyline", PANTYLINE),
        ("on-skin", ON_SKIN),
    ];
    let mut f = Vec::new();
    for s in &batch.slots {
        if tier_of(&s.meta) != "R+" || s.genre == "EXP" {
            continue;
        }
        let pos_lower = s.pos.to_lowercase();
        let fams: Vec<&str> = families
            .iter()
            .filter(|(_, toks)| toks.iter().any(|t| pos_lower.contains(t)))
            .map(|(name, _)| *name)
            .collect();
        if fams.len() >= 2 {
            f.push(format!(
                "P{}: {} hard-claim семьи сразу ({}) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот",
                s.position,
                fams.len(),
                fams.join(" + ")
            ));
        }
    }
    warn_receipt("one-hard-claim", f)
}

/// 28. echo-window ±2 G33 (gates.ts:2361, warn) — «запрет эха»: соседние
/// слоты (±2) не делят ≥6 сигнатурных токенов (слова ≥5 символов минус
/// общедоменный стоп-лист; тела — территория G12 interleave, не эха).
pub fn gate_echo_window(batch: &TextBatch) -> Receipt {
    const ECHO_STOP: &[&str] = &[
        "anime", "style", "ecchi", "original", "character", "girl", "solo", "masterpiece",
        "quality", "artstyle", "small", "nose", "mouth", "stylized", "eyes", "lighting",
        "breasts", "nipples", "clothed", "covered", "underneath", "nothing", "fabric",
        "clinging", "sweat", "glistening", "tight", "extreme", "fanservice", "body",
        "form", "frame", "close", "camera", "upper", "chest", "dark", "garment", "shoulder",
        "shoulders", "waist", "hips", "thighs", "skin", "hair", "color", "colors", "tone",
        "image", "figure", "sitting", "standing", "looking", "viewer", "full",
        "petite", "slender", "athletic", "curvy", "full-figured", "figured", "slim",
        "toned", "compact", "voluptuous", "hourglass", "milf", "student", "young",
        "narrow", "slight", "softly", "mounded", "modest", "generous", "heavy",
    ];
    let extra_stop = ["p00", "p01", "p02", "p03", "p04", "p05", "p06", "p07"];
    // sigOf: /[a-z][a-z-]{4,}/g — максимальные [a-z-]-раны от первой буквы,
    // длина ≥5; Set сохраняет порядок вставки
    let sig_of = |pos: &str| -> Vec<String> {
        let lower = pos.to_lowercase();
        let mut out: Vec<String> = Vec::new();
        let mut run = String::new();
        let flush = |run: &mut String, out: &mut Vec<String>| {
            let first_letter = run.chars().position(|c| c.is_ascii_lowercase());
            if let Some(start) = first_letter {
                if run.len() - start >= 5 {
                    let w = &run[start..];
                    if !ECHO_STOP.contains(&w)
                        && !extra_stop.contains(&w)
                        && !out.iter().any(|x| x == w)
                    {
                        out.push(w.to_string());
                    }
                }
            }
            run.clear();
        };
        for ch in lower.chars() {
            if ch.is_ascii_lowercase() || ch == '-' {
                run.push(ch);
            } else if !run.is_empty() {
                flush(&mut run, &mut out);
            }
        }
        if !run.is_empty() {
            flush(&mut run, &mut out);
        }
        out
    };
    let mut slots: Vec<&TextSlot> = batch.slots.iter().collect();
    slots.sort_by_key(|s| s.position);
    let sigs: Vec<(u32, Vec<String>)> = slots.iter().map(|s| (s.position, sig_of(&s.pos))).collect();
    let mut f: Vec<String> = Vec::new();
    for i in 0..sigs.len() {
        for d in 1..=2 {
            let j = i + d;
            if j >= sigs.len() {
                break;
            }
            let (pa, a) = &sigs[i];
            let (pb, b) = &sigs[j];
            if a.is_empty() || b.is_empty() {
                continue;
            }
            let mut shared = 0;
            let mut first = String::new();
            for w in a {
                if b.iter().any(|x| x == w) {
                    shared += 1;
                    if first.is_empty() {
                        first = w.clone();
                    }
                }
            }
            if shared >= 6 {
                f.push(format!(
                    "P{pa}↔P{pb}: эхо {shared} сигнатур (первая «{first}») — соседние кадры жуют одно (G33, №52-бэклог): разведи вещи/пропсы/детали"
                ));
            }
        }
    }
    if f.len() > 8 {
        let rest = f.len() - 8;
        f.truncate(8);
        f.push(format!("…и ещё {rest} пар"));
    }
    warn_receipt("echo-window", f)
}

/* ================================================================== */
/* Батарея целиком + прогон по слагу                                    */
/* ================================================================== */

/// Портировано в Rust (этапы 1–2): 25 безусловных текстовых гейтов.
/// Порядок — как в TS runGates (сверено по живым bun-прогонам): 12 из
/// textgates2.rs (rating-recipe … bumps-quota) вставлены на свои места.
pub const BATTERY_RUST: [&str; 25] = [
    "rating-recipe", "dresser", "canon", "diversity", "budget", "cadence",
    "niche-legibility", "prop-geometry", "claim-visibility", "technique-layers",
    "noun-lock", "character-collision", "theme-presence", "original-character-coverage",
    "artist-leak", "garment-family", "simcheck", "freq-report", "usage",
    "technique-map", "salience-chain", "contract-fidelity", "one-hard-claim",
    "echo-window", "bumps-quota",
];

/// Осталось в TS (30 базовых − 25): 5 гейтов планирования (structure,
/// exp-purity, floors, window, ab-single-variable) — живут в compile.rs
/// на уровне ПЛАНА (до текста батча), портированы туда дословно.
/// Условные (raw-plus, rating-recipe-exploratory, raw-plus-exploratory) —
/// вне счёта базы, как и в GATES_TOTAL=30; их квитанции появляются
/// только при маркерах (RAW+ в H1/engine, ⚗ в шапках слотов).
pub const BATTERY_TS: [&str; 5] = [
    "structure", "exp-purity", "floors", "window", "ab-single-variable",
];

pub struct TextGatesOutcome {
    pub slug: String,
    pub sha10: String,
    pub receipts: Vec<Receipt>,
    pub hard_pass: bool,
    pub contract_theme: Option<String>,
    pub rebuild_of: Option<String>,
}

impl TextGatesOutcome {
    pub fn hard_fails(&self) -> Vec<&'static str> {
        self.receipts
            .iter()
            .filter(|r| r.level == "hard" && r.verdict == "FAIL")
            .map(|r| r.gate)
            .collect()
    }
    pub fn warns(&self) -> Vec<&'static str> {
        self.receipts
            .iter()
            .filter(|r| r.level == "warn" && r.verdict == "WARN")
            .map(|r| r.gate)
            .collect()
    }
}

/// Полная текстовая батарея по parsed-батчу (порядок — как в TS runGates:
/// 3 rating-recipe → 3-бис dresser → 4 canon → 5 diversity → 7 budget →
/// 8 cadence → 8b niche-legibility → 8c prop-geometry → 8d claim-visibility
/// → 8e technique-layers → 8f noun-lock → 8g character-collision →
/// 9d theme-presence → original-character-coverage → artist-leak →
/// 9e garment-family → 9 simcheck → 10 freq-report → 11 usage →
/// 12 technique-map → 12b salience-chain → [13 raw-plus] → 26 contract-
/// fidelity → 27 one-hard-claim → 28 echo-window → 29 bumps-quota).
/// Спеки/контракт читаются RO свежим чтением (как TS: гейт-ран не кэшит).
/// Сигнатура неизменна (pipeline.rs — потребитель), контракт грузится
/// внутри по batch.slug.
pub fn run_text_gates(batch: &TextBatch, bans: Option<&Bans>) -> Vec<Receipt> {
    let contract = load_contract(&batch.slug);
    let recipes = textgates2::load_rating_recipes();
    let carriers = textgates2::load_carriers();
    let races = textgates2::load_races();
    let tech = textgates2::load_rating_techniques();
    let mut receipts = Vec::with_capacity(28);
    // 3. rating-recipe (hard) + ⚗-квитанция §10 (условная, сразу за ним)
    let (rr, rr_expl) = textgates2::gate_rating_recipe(batch, recipes.as_ref());
    receipts.push(rr);
    if let Some(r) = rr_expl {
        receipts.push(r);
    }
    receipts.push(textgates2::gate_dresser(batch));
    receipts.push(textgates2::gate_canon(batch));
    receipts.push(textgates2::gate_diversity(batch, carriers.as_ref()));
    receipts.push(gate_budget(batch, bans));
    receipts.push(gate_cadence(batch));
    receipts.push(textgates2::gate_niche_legibility(batch, contract.as_ref(), races.as_ref()));
    receipts.push(gate_prop_geometry(batch));
    receipts.push(textgates2::gate_claim_visibility(batch));
    receipts.push(textgates2::gate_technique_layers(batch, tech.as_ref()));
    receipts.push(gate_noun_lock(batch));
    receipts.push(gate_character_collision(batch));
    receipts.push(gate_theme_presence(batch));
    receipts.push(gate_oc_coverage(batch));
    receipts.push(gate_artist_leak(batch));
    receipts.push(gate_garment_family(batch));
    receipts.push(textgates2::gate_simcheck(batch, contract.as_ref()));
    receipts.push(gate_freq_report(batch));
    receipts.push(gate_usage(batch));
    receipts.push(textgates2::gate_technique_map(batch, tech.as_ref()));
    receipts.push(textgates2::gate_salience_chain(batch, contract.as_ref()));
    // 13. raw-plus (hard, УСЛОВНЫЙ: маркер RAW+ в H1 или engine контракта;
    // None = маркера нет — TS не пушит квитанцию вовсе) + ⚗-квитанция
    if let Some((rp, rp_expl)) = textgates2::gate_raw_plus(batch, contract.as_ref()) {
        receipts.push(rp);
        if let Some(r) = rp_expl {
            receipts.push(r);
        }
    }
    receipts.push(textgates2::gate_contract_fidelity(batch, contract.as_ref(), races.as_ref()));
    receipts.push(gate_one_hard_claim(batch));
    receipts.push(gate_echo_window(batch));
    receipts.push(textgates2::gate_bumps_quota(contract.as_ref()));
    receipts
}

#[derive(Debug)]
pub enum TextGatesError {
    UnsafeSlug(String),
    NoDraft(String),
}

impl std::fmt::Display for TextGatesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TextGatesError::UnsafeSlug(s) => write!(
                f,
                "bad slug {s:?}: ожидается T4-NN[/суффикс] — только буквы/цифры/точка/дефис, без разделителей пути"
            ),
            TextGatesError::NoDraft(slug) => {
                write!(f, "нет драфта batches/{slug}.md — батарея неприменима")
            }
        }
    }
}

/// Прогон текстовой батареи по слагу: файлы репо RO, никаких записей —
/// решающие стороны сами пишут scratch-летопись (record_gate_run).
pub fn run_for_slug(slug: &str) -> Result<(TextBatch, TextGatesOutcome), TextGatesError> {
    if !is_safe_slug(slug) {
        return Err(TextGatesError::UnsafeSlug(slug.to_string()));
    }
    let file = read_text(&batches_dir().join(format!("{slug}.md")))
        .ok_or_else(|| TextGatesError::NoDraft(slug.to_string()))?;
    let batch = parse_batch(slug, &file);
    let bans = load_bans();
    let receipts = run_text_gates(&batch, bans.as_ref());
    let mut hasher = Sha256::new();
    hasher.update(file.as_bytes());
    let full: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    let sha10 = full[..10].to_string();
    let hard_pass = receipts.iter().filter(|r| r.level == "hard").all(|r| r.verdict == "PASS");
    let contract = load_contract(slug);
    Ok((
        batch,
        TextGatesOutcome {
            slug: slug.to_string(),
            sha10,
            receipts,
            hard_pass,
            contract_theme: contract.as_ref().and_then(|c| c.theme.clone()),
            rebuild_of: contract.as_ref().and_then(|c| c.rebuild_of.clone()),
        },
    ))
}

/// Запись прогона в scratch-летопись twin'а: gate.run-событие (зеркало формы
/// TS: receipts-слепок {gate, level, verdict}) + строка t4_gate_runs.
/// Продакшн не тронут — ever. Возвращает (event_id, seq, run_index).
pub fn record_gate_run(
    conn: &Connection,
    outcome: &TextGatesOutcome,
) -> Result<(String, u64, u32), String> {
    let run_index: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM t4_gate_runs WHERE batch_slug = ?1",
            [&outcome.slug],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| (n.max(0) + 1) as u32)
        .map_err(|e| e.to_string())?;
    let warns = outcome.warns();
    let hard_fails = outcome.hard_fails();
    let receipts_proj: Vec<serde_json::Value> = outcome
        .receipts
        .iter()
        .map(|r| serde_json::json!({ "gate": r.gate, "level": r.level, "verdict": r.verdict }))
        .collect();
    let data = serde_json::json!({
        "slug": outcome.slug,
        "run": run_index,
        "sha10": outcome.sha10,
        "hardPass": outcome.hard_pass,
        "battery": "text-rust",
        "batteryRust": BATTERY_RUST,
        "batteryTs": BATTERY_TS,
        "hardFails": hard_fails,
        "warns": warns.len(),
        "warnNames": warns,
        "receipts": receipts_proj,
    });
    let summary = format!(
        "Гейты {} (текст-батарея Rust, {}/30): прогон #{}, hard {} (sha {})",
        outcome.slug,
        BATTERY_RUST.len(),
        run_index,
        if outcome.hard_pass { "PASS" } else { "FAIL" },
        outcome.sha10
    );
    let at = crate::chain::iso_now();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let evt = crate::chain::append_event_tx(
        &tx,
        &crate::chain::AppendInput {
            typ: "gate.run",
            summary: &summary,
            data: Some(&data),
            batch_slug: Some(&outcome.slug),
        },
    )?;
    let receipts_full = serde_json::to_string(&receipts_json(&outcome.receipts)).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO t4_gate_runs (batch_slug, run_index, hard_pass, receipts, at, event_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            outcome.slug,
            run_index,
            if outcome.hard_pass { 1 } else { 0 },
            receipts_full,
            at,
            evt.id
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok((evt.id, evt.seq as u64, run_index))
}

/* ================================================================== */
/* Паритет со слепками TS (thread4/events/log.jsonl, gate.run)           */
/* ================================================================== */

/// Слепок одного TS-прогона: sha10 файла на момент записи + per-gate
/// verdicts (записаны gates.ts:2476 как {gate, level, verdict}).
#[derive(Clone, Debug, Default)]
pub struct TsGateSnapshot {
    pub sha10: String,
    pub run: u64,
    pub verdicts: Vec<(String, String)>,
}

/// Последний записанный TS-слепок для слага с ЗАДАННЫМ sha10 текущего файла
/// (летопись не судит прошлые состояния файла — сверяем только честные).
pub fn recorded_ts_snapshot(slug: &str, sha10: &str) -> Option<TsGateSnapshot> {
    let text = read_text(&event_log_path())?;
    let mut best: Option<TsGateSnapshot> = None;
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v.get("type").and_then(|t| t.as_str()) != Some("gate.run") {
            continue;
        }
        let Some(d) = v.get("data") else { continue };
        if d.get("slug").and_then(|s| s.as_str()) != Some(slug) {
            continue;
        }
        if d.get("sha10").and_then(|s| s.as_str()) != Some(sha10) {
            continue;
        }
        let mut snap = TsGateSnapshot {
            sha10: sha10.to_string(),
            run: d.get("run").and_then(|r| r.as_u64()).unwrap_or(0),
            verdicts: Vec::new(),
        };
        if let Some(arr) = d.get("receipts").and_then(|r| r.as_array()) {
            for r in arr {
                let gate = r.get("gate").and_then(|g| g.as_str()).unwrap_or("").to_string();
                let verdict = r.get("verdict").and_then(|g| g.as_str()).unwrap_or("").to_string();
                snap.verdicts.push((gate, verdict));
            }
        }
        best = Some(snap);
    }
    best
}

/* ================================================================== */
/* Юнит-тесты: парсер + гейты (cargo test)                              */
/* ================================================================== */

#[cfg(test)]
mod tests {
    use super::*;

    const SYNTH_ETALON: &str = "# T4-90 «Selftest Etalon» — БАТЧ\n\
        \n\
        ТЕМА-СЛОВА: harbor, lantern\n\
        \n\
        P01 — oc-anchor (OC · Vae · R+ · PL24 · P25_VOID_EMBER)\n\
        THESIS: Vae keeps the harbor lantern lit through the storm.\n\
        Canon: Vae — copper hair, green eyes\n\
        Spine: PL24 · LEAD throat · oc register\n\
        Stack: CR-W23 + CR-B08\n\
        POS:\n\
        \n\
        anime style, original character, 1girl, solo, harbor night, lantern glow, wet pier, copper hair, green eyes, masterpiece, best quality, anime artstyle.\n\
        \n\
        NEG:\n\
        \n\
        child, loli, bra, camisole, candle, lamp\n\
        \n\
        P02 — volt-anchor (VOLT · — · R+ · PL70 · P30_STEEL_MARKET)\n\
        THESIS: The lantern sale at the steel market keeps its glow long after midnight.\n\
        Spine: PL70 · LEAD hips · student register\n\
        Stack: CR-W11 + CR-B02\n\
        POS:\n\
        \n\
        anime style, original character, 1girl, solo, steel market stalls, lantern sale, rain drift, wool coat, copper wire hoops, masterpiece, best quality, anime artstyle.\n\
        \n\
        NEG:\n\
        \n\
        child, loli, bra, camisole, candle, lamp\n";

    #[test]
    fn parser_slots_and_meta() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(b.title, "Selftest Etalon");
        assert_eq!(b.slots.len(), 2);
        let s1 = &b.slots[0];
        assert_eq!(s1.position, 1);
        assert_eq!(s1.anchor, "oc-anchor");
        assert_eq!(s1.genre, "OC");
        assert_eq!(s1.kind, "OC");
        assert_eq!(s1.who, "Vae");
        assert_eq!(s1.rating, "R+");
        assert_eq!(s1.pose, "PL24");
        assert_eq!(s1.palette, "P25_VOID_EMBER");
        assert_eq!(tier_of(&s1.meta), "R+");
        assert_eq!(s1.stack, vec!["CR-W23".to_string(), "CR-B08".to_string()]);
        assert!(s1.thesis.contains("harbor lantern"));
        assert!(s1.canon.contains("copper hair"));
        assert!(s1.pos.starts_with("anime style, original character"));
        assert!(s1.neg.contains("child"));
        let s2 = &b.slots[1];
        assert_eq!(s2.genre, "VOLT");
        // «—» сегмент — не who
        assert_eq!(s2.who, "");
        assert_eq!(tier_of(&s2.meta), "R+");
    }

    #[test]
    fn parser_boundary_and_unknown_sections() {
        let md = "# T4-90 «x»\n\
            P01 — a (OC · Vae · R+)\n\
            THESIS: one\n\
            POS:\n\
            first line\n\
            ════════════\n\
            ACT II — LATE\n\
            second line\n\
            PROTOCOL: hidden\n\
            third line\n\
            NEG:\n\
            real neg\n";
        let b = parse_batch("T4-90", md);
        let s = &b.slots[0];
        // boundary-линии и неизвестные секции НЕ прилипают к POS (bug fix 2026-10-15)
        assert_eq!(s.pos, "first line");
        assert_eq!(s.neg, "real neg");
    }

    #[test]
    fn parser_exp_meta_and_title_forms() {
        let md = "# THREAD 4 — Batch T4-14: \"Silver Wake\" — БАТЧ (проза)\n\
            P25 — kappa-b-mirror (EXP · VOLT · — · R+ · PL159 · P83_MIDNIGHT_LAGOON) ⚗\n\
            THESIS: EXP κ-B · H10 mirror test\n\
            POS:\n\
            anime style, original character\n\
            NEG:\n\
            child\n";
        let b = parse_batch("T4-14", md);
        assert_eq!(b.title, "Silver Wake");
        let s = &b.slots[0];
        assert_eq!(s.genre, "EXP");
        assert!(s.header.contains("⚗"));
        assert!(s.header.contains("(EXP ·"));
    }

    #[test]
    fn tier_and_genre_edge_cases() {
        assert_eq!(tier_of("X · студия"), "X");
        assert_eq!(tier_of("R+ · PL24"), "R+");
        assert_eq!(tier_of("XXX · a"), "XXX");
        assert_eq!(tier_of("PG-13 · a"), "PG-13");
        assert_eq!(tier_of("R · plain"), "R");
        assert_eq!(tier_of("ничего"), "");
        assert_eq!(genre_of("VOLT · EXP · — · R+"), "EXP");
        assert_eq!(genre_of("EXQUISITE · — · R+"), "EXQUISITE");
        // \b: «VOLTAGE» не жанр
        assert_eq!(genre_of("VOLTAGE · — · R+"), "");
    }

    #[test]
    fn word_boundary_scanner() {
        assert!(contains_word("bra, camisole", "bra"));
        assert!(contains_word("no bra worn", "bra"));
        assert!(!contains_word("brazier light", "bra"));
        assert!(!contains_word("abrasion", "bra"));
        // squash: дефисная цепочка = один токен, границы нет
        assert!(!contains_word(&squash("pale-gold-aurora warm"), "aurora"));
        assert!(contains_word("aurora, sky", "aurora"));
    }

    #[test]
    fn budget_gate_pass_and_fail() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        let r = gate_budget(&b, None);
        assert_eq!((r.gate, r.level, r.verdict), ("budget", "warn", "PASS"));
        // потолок: > 400 слов → «> 400»
        let long_pos = format!("{} {}", "word ".repeat(400).trim(), "extra tail");
        let md = format!("# T4-91 «x»\nP01 — a (VOLT · — · R+)\nPOS:\n{long_pos}\nNEG:\nx\n");
        let b2 = parse_batch("T4-91", &md);
        let r2 = gate_budget(&b2, None);
        assert_eq!(r2.verdict, "WARN");
        assert!(r2.findings[0].starts_with("P1: POS 402 слов > 400"), "{}", r2.findings[0]);
        // цель: 301..400 → «плотнее»
        let mid_pos = "word ".repeat(310);
        let md2 = format!("# T4-91 «x»\nP01 — a (VOLT · — · R+)\nPOS:\n{mid_pos}\nNEG:\nx\n");
        let b3 = parse_batch("T4-91", &md2);
        let r3 = gate_budget(&b3, None);
        assert!(r3.findings.iter().any(|f| f.starts_with("P1: POS 310 слов (цель 300) — плотнее")), "{:?}", r3.findings);
        // хеджи
        let md4 = "# T4-91 «x»\nP01 — a (VOLT · — · R)\nPOS:\nmaybe perhaps slightly almost\nNEG:\nx\n";
        let b4 = parse_batch("T4-91", md4);
        let r4 = gate_budget(&b4, None);
        assert!(r4.findings.iter().any(|f| f == "P1: хеджей 4 > 2"), "{:?}", r4.findings);
    }

    #[test]
    fn cadence_gate_classes() {
        assert_eq!(closer_class_of("she said «quietly»"), "dialogue");
        assert_eq!(closer_class_of("frame ends here — still."), "fragment-pair");
        assert_eq!(closer_class_of("the lantern still burned, she waited."), "image-close");
        assert_eq!(closer_class_of("plain ending"), "other");
        assert_eq!(closer_class_of("quote at end\u{201D}"), "dialogue");
        // \b: «on» в «upon.» не image-close
        assert_eq!(closer_class_of("leaning upon."), "other");
        let mut md = String::from("# T4-92 «x»\n");
        for i in 1..=5 {
            md.push_str(&format!(
                "P{i:02} — a (VOLT · — · R)\nPOS:\nframe {i} — close.\nNEG:\nx\n"
            ));
        }
        let b = parse_batch("T4-92", &md);
        let r = gate_cadence(&b);
        assert_eq!(r.verdict, "WARN");
        assert!(r.findings[0].starts_with("клоузер-формула: fragment-pair 100% > 60% (N25-ловушка)"));
        let clean = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_cadence(&clean).verdict, "PASS");
    }

    #[test]
    fn parity_exactness_edge_cases() {
        // Аудит 1-в-1 (теоретические края, TS-семантика дословно):
        // · /\bR\+/ — хвост не проверяется: «R+15» = R+ (не X/R)
        assert_eq!(tier_of("R+15 · не бывает, но TS так"), "R+");
        assert_eq!(tier_of("R+X"), "R+");
        // «NR+» — границы слева нет (TS \bR: 'N' — слово-симвл)
        assert_eq!(tier_of("NR+ · а"), "");
        // · /^PL\d+$/ — ОДНА цифра валидна (parseMeta: PL1 = поза, не who)
        let (kind, who, rating, pose, palette) = parse_meta("VOLT · — · R+ · PL1 · P1_NIGHT");
        assert_eq!((kind.as_str(), who.as_str(), rating.as_str()), ("VOLT", "", "R+"));
        assert_eq!((pose.as_str(), palette.as_str()), ("PL1", "P1_NIGHT"));
        // · BOUNDARY_RE: \s+ (не один пробел) и хвостовые \b
        assert!(is_boundary("ACT  II — LATE"));
        assert!(is_boundary("EXP  OVERLAY"));
        assert!(is_boundary("REHAB OVERLAY:"));
        assert!(is_boundary("ACT IIIVX")); // \b на конце строки — срабатывает
        assert!(!is_boundary("EXP OVERLAYX"));
        assert!(!is_boundary("ACTING UP")); // ACT без \s — не boundary
        assert!(!is_boundary("ACT IVXN")); // \b после рана: 'N' — слово-симвл
        // Современный тайтл: \s* — ноль пробелов до кавычки тоже легален
        assert_eq!(extract_batch_title("# T4-14«Silver»"), "Silver");
        assert_eq!(extract_batch_title("# T4-14: «Silver»"), ""); // ':' рвёт матч
        // легаси: Batch с любым регистром и ≥1 пробелом
        assert_eq!(
            extract_batch_title("# THREAD 4 — batch  T4-09: \"Held\""),
            "Held"
        );
        // '#' легаси не обязан открывать строку; современный — обязан
        assert_eq!(extract_batch_title("  # THREAD 4 — Batch T4-03: \"Last\""), "Last");
        assert_eq!(extract_batch_title("  # T4-03 «Last»"), "");
    }

    #[test]
    fn prop_geometry_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_prop_geometry(&b).verdict, "PASS");
        let md = "# T4-93 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, girl on the rope bridge.\nNEG:\nx\n";
        let b2 = parse_batch("T4-93", md);
        let r = gate_prop_geometry(&b2);
        assert_eq!(r.verdict, "WARN");
        assert_eq!(
            r.findings[0],
            "P1: сложный проп «rope» с 0/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)"
        );
        // «handrail» не ловится подстрокой «rail» (границы слов), а «rail»
        // с 2 якорями — PASS
        let md3 = "# T4-93 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, handrail shine, grip on the rail, feet planted wide.\nNEG:\nx\n";
        let b3 = parse_batch("T4-93", md3);
        assert_eq!(gate_prop_geometry(&b3).verdict, "PASS");
    }

    #[test]
    fn noun_lock_gate_branches() {
        // сквозь-ткань заявка без именованной вещи + без NEG-лока
        let md = "# T4-94 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, see-through silhouette, nothing underneath.\nNEG:\nchild\n";
        let b = parse_batch("T4-94", md);
        let r = gate_noun_lock(&b);
        assert_eq!(r.verdict, "WARN");
        assert_eq!(r.findings.len(), 2, "{:?}", r.findings);
        assert!(r.findings.iter().any(|f| f.contains("сквозь-ткань заявка (see-through) не залочена")));
        assert!(r.findings.iter().any(|f| f.contains("тишина по подслою = дыра")));
        // bare-under требуется только для nipples through / clothed nipples
        let md2 = "# T4-94 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, clothed nipples, silk blouse.\nNEG:\nchild, bra, camisole\n";
        let b2 = parse_batch("T4-94", md2);
        let r2 = gate_noun_lock(&b2);
        assert!(r2.findings.iter().any(|f| f.contains("подслой не заявлен позитивом")), "{:?}", r2.findings);
        assert!(!r2.findings.iter().any(|f| f.contains("не залочена")));
        // нижняя заявка
        let md3 = "# T4-94 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, visible pantyline, nothing underneath.\nNEG:\nchild, bra\n";
        let b3 = parse_batch("T4-94", md3);
        let r3 = gate_noun_lock(&b3);
        assert!(r3.findings.iter().any(|f| f.contains("нижняя заявка (visible pantyline) не залочена")));
        // R-слоты гейт не судит
        let md4 = "# T4-94 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, see-through.\nNEG:\nchild\n";
        let b4 = parse_batch("T4-94", md4);
        assert_eq!(gate_noun_lock(&b4).verdict, "PASS");
        // «brazier» в NEG не является локом «bra» (границы слов)
        let md5 = "# T4-94 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, see-through veil.\nNEG:\nbrazier light\n";
        let b5 = parse_batch("T4-94", md5);
        let r5 = gate_noun_lock(&b5);
        assert!(r5.findings.iter().any(|f| f.contains("тишина по подслою")), "{:?}", r5.findings);
    }

    #[test]
    fn character_collision_gate() {
        let md = |pos: &str| format!("# T4-95 «x»\nP01 — a (VOLT · — · R)\nPOS:\n{pos}\nNEG:\nx\n");
        let trigger = parse_batch("T4-95", &md("aurora sky shimmer, teal veil"));
        // «aurora sky» — safe-продолжение → PASS
        assert_eq!(gate_character_collision(&trigger).verdict, "PASS");
        let lone = parse_batch("T4-95", &md("aurora, stars, night"));
        let r = gate_character_collision(&lone);
        assert_eq!(r.verdict, "WARN");
        assert_eq!(
            r.findings[0],
            "P1: омоним данбуру «aurora» в POS — рендерер матчит чужого персонажа (aurora_…: T4-05 P08 — aurora_(arknights) «пробежал персонаж»). Только составной формой (§9-септима, character-collision)"
        );
        // дефисная цепочка = один токен (закон №23 sd_fragment verbatim)
        let chain = parse_batch("T4-95", &md("pale-gold-aurora warm edges, miku hatsune"));
        assert_eq!(gate_character_collision(&chain).verdict, "PASS");
        // проза после точки проверяется тем же правилом
        let prose_bad = parse_batch("T4-95", &md("night falls. aurora rises"));
        let rp = gate_character_collision(&prose_bad);
        assert_eq!(rp.verdict, "WARN", "{:?}", rp.findings);
        // safe-продолжение в прозе — легально
        let prose_ok = parse_batch("T4-95", &md("night falls. aurora light rises"));
        assert_eq!(gate_character_collision(&prose_ok).verdict, "PASS");
    }

    #[test]
    fn theme_presence_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_theme_presence(&b).verdict, "PASS");
        let md = "# T4-96 «x»\nТЕМА-СЛОВА: orchid\nP01 — a (VOLT · — · R)\nPOS:\nanime style, harbor\nNEG:\nx\nP02 — b (VOLT · — · R)\nPOS:\nanime style, pier\nNEG:\nx\n";
        let b2 = parse_batch("T4-96", md);
        let r = gate_theme_presence(&b2);
        assert_eq!(r.verdict, "WARN");
        assert!(r.findings[0].starts_with("тему несут 0/2 слотов (нужно ≥60%; EXP-болванки не в счёте) — слова: orchid"), "{}", r.findings[0]);
        let no_line = "# T4-96 «x»\nP01 — a (VOLT · — · R)\nPOS:\nx\nNEG:\nx\n";
        let b3 = parse_batch("T4-96", no_line);
        let r3 = gate_theme_presence(&b3);
        assert_eq!(r3.findings[0], "в батче нет строки ТЕМА-СЛОВА — тема не меряется (спайн писца обязан вывести из темы)");
    }

    #[test]
    fn oc_coverage_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_oc_coverage(&b).verdict, "PASS");
        let md = "# T4-97 «x»\nP01 — a (OC · Vae · R+)\nPOS:\nanime style, original character, 1girl.\nNEG:\nx\nP02 — b (VOLT · — · R)\nPOS:\nanime style, 1girl.\nNEG:\nx\n";
        let b2 = parse_batch("T4-97", md);
        let r = gate_oc_coverage(&b2);
        assert_eq!(r.findings[0], "P2: нет original character в тег-блоке — U1 в ручном потоке (Issue #24)");
        let heroine = format!("{md}\nHEROINE-BATCH: yes\n");
        let b3 = parse_batch("T4-97", &heroine);
        let r3 = gate_oc_coverage(&b3);
        assert_eq!(
            r3.findings[0],
            "HEROINE-BATCH: yes — U1 действует только на OC-слоты (ORDER v2, вердикт T4-17); не-OC слоты исключены"
        );
    }

    #[test]
    fn artist_leak_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_artist_leak(&b).verdict, "PASS");
        let md = "# T4-98 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, art by someone, solo.\nNEG:\nx\n";
        let b2 = parse_batch("T4-98", md);
        let r = gate_artist_leak(&b2);
        assert_eq!(r.findings[0], "P1: artist-подобный токен в тег-блоке — artist_ban, PH-утечка (Issue #24, U3)");
        // тег-блок — только до первой точки: artist в прозе не считается
        let md2 = "# T4-98 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, solo. painted by hand prose tail.\nNEG:\nx\n";
        let b3 = parse_batch("T4-98", md2);
        assert_eq!(gate_artist_leak(&b3).verdict, "PASS");
    }

    #[test]
    fn garment_family_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_garment_family(&b).verdict, "PASS");
        // 3 из 3 слотов с бельём > ceil(3*0.58)=2
        let slot = |i: usize| {
            format!(
                "P{i:02} — a (VOLT · — · R)\nPOS:\nanime style, lace lingerie, stockings, garter belt, bra.\nNEG:\nx\n"
            )
        };
        let md = format!("# T4-99 «x»\n{}{}{}", slot(1), slot(2), slot(3));
        let b2 = parse_batch("T4-99", &md);
        let r = gate_garment_family(&b2);
        assert_eq!(r.verdict, "WARN");
        assert!(r.findings[0].starts_with("бельё-семья монополизирует батч: 3/3 слотов"), "{}", r.findings[0]);
        // braless не считается (\bbra\b: «less» — слово-симвл, границы нет)
        let md2 = "# T4-99 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, braless look.\nNEG:\nx\n";
        let b3 = parse_batch("T4-99", md2);
        assert_eq!(gate_garment_family(&b3).verdict, "PASS");
    }

    #[test]
    fn freq_report_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        let r = gate_freq_report(&b);
        assert_eq!((r.gate, r.level, r.verdict), ("freq-report", "advisory", "REPORT"));
        assert_eq!(r.findings[0], "тиков не обнаружено");
        // слово в ≥8 слотах = тик (8/8)
        let mut md = String::from("# T4-99 «x»\n");
        for i in 1..=8 {
            md.push_str(&format!(
                "P{i:02} — a (VOLT · — · R)\nPOS:\nanime style, copperwire glow, solo {i}.\nNEG:\nx\n"
            ));
        }
        let b2 = parse_batch("T4-99", &md);
        let r2 = gate_freq_report(&b2);
        // anime/style — 5-буквенные, не в стоп-листе → тоже тики (как в живых
        // TS-прогонах: «anime 33/33 · style 33/33»)
        assert!(r2.findings[0].contains("copperwire 8/8"), "{}", r2.findings[0]);
        assert!(r2.findings[0].starts_with("кандидаты в тики: anime 8/8 · style 8/8 · copperwire 8/8"), "{}", r2.findings[0]);
    }

    #[test]
    fn usage_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        let r = gate_usage(&b);
        assert_eq!(r.verdict, "REPORT");
        assert_eq!(r.findings[0], "носителей в стеках: 4; уникальных: 4");
        assert_eq!(r.findings[1], "R+ слотов: 2; X: 0");
    }

    #[test]
    fn one_hard_claim_gate() {
        let md = "# T4-99 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, clothed nipples, wet clothes.\nNEG:\nx\n\
                  P02 — b (EXP · VOLT · — · R+)\nPOS:\nanime style, clothed nipples, wet clothes.\nNEG:\nx\n";
        let b = parse_batch("T4-99", md);
        let r = gate_one_hard_claim(&b);
        assert_eq!(r.findings.len(), 1, "{:?}", r.findings);
        assert_eq!(
            r.findings[0],
            "P1: 2 hard-claim семьи сразу (through + wet) — заявки делят внимание кадра (G20, №52-бэклог): оставь ОДНУ, вторую перевези в другой слот"
        );
        // одна семья — PASS; «wet fabric» без «wet clothes» не семья wet
        let md2 = "# T4-99 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, clothed nipples, wet fabric only.\nNEG:\nx\n";
        let b2 = parse_batch("T4-99", md2);
        assert_eq!(gate_one_hard_claim(&b2).verdict, "PASS");
        // three семьи: through + wet + pantyline
        let md3 = "# T4-99 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, covered nipples, see-through, visible pantyline.\nNEG:\nx\n";
        let b3 = parse_batch("T4-99", md3);
        let r3 = gate_one_hard_claim(&b3);
        assert!(r3.findings[0].contains("3 hard-claim семьи сразу (through + wet + pantyline)"), "{}", r3.findings[0]);
        // R не судим
        let md4 = "# T4-99 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, covered nipples, see-through.\nNEG:\nx\n";
        let b4 = parse_batch("T4-99", md4);
        assert_eq!(gate_one_hard_claim(&b4).verdict, "PASS");
    }

    #[test]
    fn echo_window_gate() {
        let b = parse_batch("T4-90", SYNTH_ETALON);
        assert_eq!(gate_echo_window(&b).verdict, "PASS");
        let pos_a = "anime style, brass lantern, copper hoop, velvet drape, marble step, granite ledge.";
        let pos_b = "anime style, brass lantern, copper hoop, velvet drape, marble step, granite bench.";
        let md = format!(
            "# T4-99 «x»\nP01 — a (VOLT · — · R)\nPOS:\n{pos_a}\nNEG:\nx\nP02 — b (VOLT · — · R)\nPOS:\n{pos_b}\nNEG:\nx\n"
        );
        let b2 = parse_batch("T4-99", &md);
        let r = gate_echo_window(&b2);
        assert_eq!(r.verdict, "WARN");
        assert!(r.findings[0].starts_with("P1↔P2: эхо 7 сигнатур (первая «brass»"), "{}", r.findings[0]);
        // стоп-лист: anime/style/masterpiece… не сигнатуры; «full-figured» —
        // один токен-тишера (дефис внутри [a-z-]-рана)
        let pos_c = "anime style, ecchi style, masterpiece, original character, small nose.";
        let md2 = format!(
            "# T4-99 «x»\nP01 — a (VOLT · — · R)\nPOS:\n{pos_c}\nNEG:\nx\nP02 — b (VOLT · — · R)\nPOS:\n{pos_c}\nNEG:\nx\n"
        );
        let b3 = parse_batch("T4-99", &md2);
        assert_eq!(gate_echo_window(&b3).verdict, "PASS");
    }

    #[test]
    fn slug_canon_file_era() {
        assert!(is_safe_slug("T4-27"));
        assert!(is_safe_slug("T4-27.2-EXP"));
        assert!(!is_safe_slug("../etc/passwd"));
        assert!(!is_safe_slug("T4-"));
        assert!(!is_safe_slug("t4-27"));
    }

    #[test]
    fn contract_loader_on_live_file() {
        if let Some(c) = load_contract("T4-27.2-EXP") {
            assert_eq!(c.rebuild_of.as_deref(), Some("T4-27"));
            assert!(!c.slots.is_empty());
            assert_eq!(c.slots[0].position, 1);
            assert_eq!(c.slots[0].kind, "OC");
            assert_eq!(c.slots[0].oc.as_deref(), Some("Vae"));
            assert_eq!(c.slots[0].rating, "R+");
            assert_eq!(c.slots[0].palette, "P35_VOID_EMBER");
            assert!(!c.ab_pairs.is_empty());
            assert_eq!(c.ab_pairs[0].pair, "κ");
        } else {
            panic!("контракт T4-27.2-EXP не читается — файлы репо должны быть на месте");
        }
    }

    #[test]
    fn bans_loader_defaults_and_live() {
        if let Some(b) = load_bans() {
            assert_eq!(b.pos_target, 300);
            assert_eq!(b.pos_hard, 400);
            assert_eq!(b.hedge_budget, 2);
        } else {
            panic!("bans.json не читается — спеки репо должны быть на месте");
        }
    }

    #[test]
    fn battery_names_match_ts() {
        // 25 портированных + 5 планировочных в TS = 30 базовых (GATES_TOTAL=30,
        // аудит Rust-эры); условные (raw-plus, ⚗) — вне счёта базы
        assert_eq!(BATTERY_RUST.len() + BATTERY_TS.len(), 30);
        // синтетика без маркеров RAW+/⚗ — ровно 25 безусловных квитанций,
        // порядок — дословно как в TS runGates (батч без условных гейтов)
        let receipts = run_text_gates(&parse_batch("T4-90", SYNTH_ETALON), None);
        assert_eq!(BATTERY_RUST.len(), receipts.len());
        let names: Vec<&str> = receipts.iter().map(|r| r.gate).collect();
        assert_eq!(names, BATTERY_RUST.to_vec());
        // батарея уникальна (условные гейты не дублируются)
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len());
    }
}
