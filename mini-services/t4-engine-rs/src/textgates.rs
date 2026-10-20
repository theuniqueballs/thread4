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
//! ЭТАП 1+1бис — 16 словарных гейтов, findings ДОСЛОВНО как в TS (автор
//! читает квитанции; паритет сверяется по записанным TS-слепкам gate.run в
//! thread4/events/log.jsonl — verdict per gate — и по живым TS-прогонам):
//!   rating-recipe (hard, сердце PH-доктрины) · canon (hard) · diversity
//!   (hard) · budget · cadence · prop-geometry · noun-lock ·
//!   character-collision · theme-presence · original-character-coverage ·
//!   artist-leak · garment-family · freq-report (advisory) · usage
//!   (advisory) · one-hard-claim · echo-window (+ условный
//!   rating-recipe-exploratory, warn — вне базы).
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
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::compile::Receipt;

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

pub fn specs_dir() -> PathBuf {
    thread4_dir().join("specs")
}

pub fn event_log_path() -> PathBuf {
    thread4_dir().join("events/log.jsonl")
}

fn read_text(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p).ok()
}

fn read_json(p: &std::path::Path) -> Option<serde_json::Value> {
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

fn ascii_word(c: char) -> bool {
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
fn contains_word_ci(hay: &str, needle: &str) -> bool {
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
    let v = read_json(&contracts_dir().join(format!("{slug}.json")))?;
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

fn warn_receipt(gate: &'static str, findings: Vec<String>) -> Receipt {
    Receipt {
        gate,
        level: "warn",
        verdict: if findings.is_empty() { "PASS" } else { "WARN" },
        findings,
        notes: Vec::new(),
    }
}

fn advisory_receipt(gate: &'static str, findings: Vec<String>) -> Receipt {
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
fn tag_block_of(pos: &str) -> String {
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
/* Этап 1-бис — rating-recipe (hard, gates.ts:745) · canon (hard, :997) */
/* · diversity (hard, :1057) — сердце PH-доктрины, findings ДОСЛОВНО.  */
/* ================================================================== */

/// serde-десериализация JSON-объекта в Vec<(String, V)> С СОХРАНЕНИЕМ
/// порядка ключей документа: serde_json::Map без preserve_order сортирует
/// ключи, а порядок находок гейтов обязан совпадать с TS Object.entries
/// (JSON-документ) байт-в-байт.
mod ordered_map {
    use serde::de::{MapAccess, Visitor};
    use std::fmt;
    use std::marker::PhantomData;

    pub fn deserialize<'de, D, V>(deserializer: D) -> Result<Vec<(String, V)>, D::Error>
    where
        D: serde::Deserializer<'de>,
        V: serde::Deserialize<'de>,
    {
        struct OrderedMap<V>(PhantomData<V>);
        impl<'de, V: serde::Deserialize<'de>> Visitor<'de> for OrderedMap<V> {
            type Value = Vec<(String, V)>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut access: A) -> Result<Self::Value, A::Error> {
                let mut out = Vec::new();
                while let Some(key) = access.next_key::<String>()? {
                    out.push((key, access.next_value::<V>()?));
                }
                Ok(out)
            }
        }
        deserializer.deserialize_map(OrderedMap(PhantomData))
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Mechanism {
    pub hard: Vec<String>,
    pub required_state: Vec<String>,
    pub underlayer_block_applies_to: Vec<String>,
    pub underlayer_block: Vec<String>,
    pub lower_claims: Vec<String>,
    pub upper_claims: Vec<String>,
    pub dead_fabrics_lower: Vec<String>,
    pub dead_fabrics_upper: Vec<String>,
    pub counter_neg: Vec<String>,
    pub counter_neg_lifted: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct TierRecipe {
    pub signals: Vec<String>,
    pub signal_min: Option<u32>,
    pub signals_hard: Vec<String>,
    pub hard_min: Option<u32>,
    #[serde(deserialize_with = "ordered_map::deserialize")]
    pub mechanisms: Vec<(String, Mechanism)>,
    pub counter_neg: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct RatingRecipes {
    #[serde(default, deserialize_with = "ordered_map::deserialize")]
    pub tiers: Vec<(String, TierRecipe)>,
    #[serde(default)]
    pub eternal_floors: EternalFloors,
}

/// getRatingRecipes() (specs.ts): None при отсутствии/бите — гейт молчит
/// (TS: recipes?.tiers ?? {} → рецепт не найден → continue → PASS).
pub fn load_rating_recipes() -> Option<RatingRecipes> {
    let txt = read_text(&specs_dir().join("rating-recipes.json"))?;
    serde_json::from_str(&txt).ok()
}

pub struct OcEntry {
    pub name: String,
    pub hair: String,
    pub eyes: String,
}

/// oc-canon.json ocs: (имя, hair, eyes). Порядок — отсортированный
/// (serde_json Map), в TS — порядок документа; различие проявляется только
/// при ДВУХ разных именах OC в одном POS (патология, в живых файлах
/// не встречается — паритет-батарея поймает).
pub fn oc_canon_entries() -> Vec<OcEntry> {
    read_json(&specs_dir().join("oc-canon.json"))
        .and_then(|v| {
            v.get("ocs").and_then(|o| o.as_object()).map(|o| {
                o.iter()
                    .map(|(name, oc)| OcEntry {
                        name: name.clone(),
                        hair: oc.get("hair").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                        eyes: oc.get("eyes").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                    })
                    .collect()
            })
        })
        .unwrap_or_default()
}

#[derive(Clone, Debug, Default)]
pub struct CarriersSpec {
    class_mech: std::collections::HashMap<String, String>,
    sheer_ids: std::collections::HashSet<String>,
}

pub fn load_carriers() -> Option<CarriersSpec> {
    let v = read_json(&specs_dir().join("carriers.json"))?;
    let mut class_mech = std::collections::HashMap::new();
    if let Some(cd) = v.get("class_defs").and_then(|x| x.as_object()) {
        for (k, val) in cd {
            if let Some(m) = val.get("mech").and_then(|x| x.as_str()) {
                class_mech.insert(k.clone(), m.to_string());
            }
        }
    }
    let mut sheer_ids = std::collections::HashSet::new();
    if let Some(cl) = v.get("classes").and_then(|x| x.as_object()) {
        for (_class, arr) in cl {
            if let Some(list) = arr.as_array() {
                for c in list {
                    if c.get("sheer_family").and_then(|x| x.as_bool()).unwrap_or(false) {
                        if let Some(id) = c.get("id").and_then(|x| x.as_str()) {
                            sheer_ids.insert(id.to_string());
                        }
                    }
                }
            }
        }
    }
    Some(CarriersSpec { class_mech, sheer_ids })
}

/// Все спеки текстовой батареи одной пачкой (один прогон — одна загрузка).
pub struct TextSpecs {
    pub bans: Option<Bans>,
    pub recipes: Option<RatingRecipes>,
    pub oc_canon: Vec<OcEntry>,
    pub carriers: Option<CarriersSpec>,
    /* --- этап 1-в (остаток BATTERY_TS[14] + условный raw-plus) --- */
    /// policy.json → law (compiler.ts:429 getPolicy().law). TS при
    /// отсутствии спека ГРОМКО КРАШИТСЯ («код не знает чисел», П-2);
    /// twin падает на документированные константы 24/3/21/9 — на живом
    /// дереве файл есть, расхождения не даёт.
    pub laws: Laws,
    /// races.json — niche-legibility (race tokens) + contract-fidelity (kin)
    pub races: Vec<RaceEntry>,
    /// dresser.json — гейт dresser (checkCoherence, квитанция №29)
    pub dresser: Option<DresserSpec>,
    /// rating-techniques.json — техника-карта автора (gates 14/25)
    pub techniques: Option<RatingTechniques>,
}

pub fn load_text_specs() -> TextSpecs {
    TextSpecs {
        bans: load_bans(),
        recipes: load_rating_recipes(),
        oc_canon: oc_canon_entries(),
        carriers: load_carriers(),
        laws: load_laws().unwrap_or(Laws {
            slots_total: 24,
            oc_slots: 3,
            mains_total: 21,
            exp_slots_max: 9,
        }),
        races: load_races(),
        dresser: load_dresser(),
        techniques: load_rating_techniques(),
    }
}

/* ================================================================== */
/* Этап 1-в — спеки оставшихся гейтов                                   */
/* ================================================================== */

/// LAWS (policy.json → law): структура слотов и EXP-оверлея.
#[derive(Clone, Debug)]
pub struct Laws {
    pub slots_total: u32,
    pub oc_slots: u32,
    pub mains_total: u32,
    pub exp_slots_max: u32,
}

pub fn load_laws() -> Option<Laws> {
    let v = read_json(&specs_dir().join("policy.json"))?;
    let l = v.get("law")?;
    Some(Laws {
        slots_total: l.get("slotsTotal").and_then(|x| x.as_u64()).unwrap_or(24) as u32,
        oc_slots: l.get("ocSlots").and_then(|x| x.as_u64()).unwrap_or(3) as u32,
        mains_total: l.get("mainsTotal").and_then(|x| x.as_u64()).unwrap_or(21) as u32,
        exp_slots_max: l.get("expSlotsMax").and_then(|x| x.as_u64()).unwrap_or(9) as u32,
    })
}

/// eternal_floors (rating-recipes.json): вечные флооры POS/NEG (закон №25
/// вынул genital_lock — X-блок живёт в tiers.X.counter_neg).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct EternalFloors {
    pub anti_loli: Vec<String>,
    pub leak_guard: Vec<String>,
    pub candle_guard: Vec<String>,
    pub face_guard: Vec<String>,
}

/// RaceEntry (races.json): name + features — niche-legibility и
/// contract-fidelity (kinTokensOf) читают один и тот же спек.
#[derive(Clone, Debug)]
pub struct RaceEntry {
    pub name: String,
    pub features: Vec<String>,
}

pub fn load_races() -> Vec<RaceEntry> {
    read_json(&specs_dir().join("races.json"))
        .and_then(|v| {
            v.get("races").and_then(|x| x.as_array()).map(|arr| {
                arr.iter()
                    .map(|r| RaceEntry {
                        name: r.get("name").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                        features: r
                            .get("features")
                            .and_then(|x| x.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|f| f.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect()
            })
        })
        .unwrap_or_default()
}

/// DressConflict (dresser.json → conflicts[]).
#[derive(Clone, Debug, Default)]
pub struct DressConflict {
    pub pair: Vec<String>,
    pub rule: String,
    pub why: String,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct DresserSpec {
    pub conflicts: Vec<DressConflict>,
}

pub fn load_dresser() -> Option<DresserSpec> {
    let v = read_json(&specs_dir().join("dresser.json"))?;
    let mut out = DresserSpec::default();
    if let Some(arr) = v.get("conflicts").and_then(|x| x.as_array()) {
        for c in arr {
            out.conflicts.push(DressConflict {
                pair: c
                    .get("pair")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|p| p.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
                rule: c.get("rule").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                why: c.get("why").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                tags: c
                    .get("tags")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
            });
        }
    }
    Some(out)
}

/// TechniqueEntry (rating-techniques.json → techniques[]). Поля pg13/r/
/// rplus/x — отметки efficacy («●» на живом тире); trap/suppressor —
/// флаги ловушек/супрессоров (гейт их цитирует дословно).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct TechniqueEntry {
    pub tag: String,
    #[serde(rename = "match")]
    pub match_alts: Vec<Vec<String>>,
    pub layer: u32,
    #[serde(rename = "pg13")]
    pub pg13: String,
    pub r: String,
    pub rplus: String,
    pub x: String,
    #[serde(deserialize_with = "de_bool_or_false")]
    pub trap: bool,
    #[serde(deserialize_with = "de_bool_or_false")]
    pub suppressor: bool,
    pub note: String,
}

/// trap/suppressor в спеке бывают bool ИЛИ строкой-пояснением — TS
/// проверяет truthiness (любая непустая строка = true).
fn de_bool_or_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    Ok(match v {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => b,
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    })
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct RplusFloor {
    pub signals_min: u32,
    pub layers_min: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct RatingTechniques {
    pub techniques: Vec<TechniqueEntry>,
    pub sum_rules: SumRulesShim,
    pub xcut_hold: XcutHold,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct SumRulesShim {
    pub rplus_floor: Option<RplusFloor>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct XcutHold {
    pub framing: Vec<String>,
    pub lower_cover: Vec<String>,
}

pub fn load_rating_techniques() -> Option<RatingTechniques> {
    let txt = read_text(&specs_dir().join("rating-techniques.json"))?;
    serde_json::from_str(&txt).ok()
}

/* ================================================================== */
/* Этап 1-в — состояние: фолд летописи-файла (readEvents + foldState)   */
/*                                                                      */
/* ЭТАЛОН (src/lib/t4/gates.ts) читает thread4/events/log.jsonl         */
/* (events.ts readEvents: файл-эра, заморожена на 421 звене). Прод-      */
/* SQLite — НЕ зеркало: миграция импортировала только 399 звеньев,       */
/* хроники разошлись в переходный период (runIndex по SQLite занижен:   */
/* T4-04 — 3 против 5). Байт-паритет = фолд ТОГО ЖЕ файла, что читает   */
/* bun runGates. Поля состояния — только те, что едят гейты:            */
/* deliveredAt (window/simcheck), voided, алиасы слагов, счёт gate.run.  */
/* ================================================================== */

#[derive(Clone, Debug, Default)]
pub struct ChronState {
    /// slug → at последнего batch.delivered (foldState: batches.deliveredAt)
    pub delivered_at: std::collections::HashMap<String, String>,
    /// batch.void слаги, порядок истории (foldState voidedSlugs)
    pub voided: Vec<String>,
    /// окно ротации: 3 последних сданных, СТАРЕЙШИЙ → СВЕЖАЙШИЙ
    /// (foldState: sort ASC по (deliveredAt, slug), slice(-3))
    pub window_slugs: Vec<String>,
    /// счёт gate.run по слагу (runIndex эталона = priorRuns + 1)
    pub gate_runs: std::collections::HashMap<String, u32>,
}

impl ChronState {
    pub fn empty() -> ChronState {
        ChronState::default()
    }
}

/// foldState (events.ts:565-718) в объёме гейтов: compiled/delivered/void/
/// slug-alias. Алиасы применяются ПОСЛЕ всей истории; dropVoid снимает void
/// с нового слага (провенанс дубля — T4-18→T4-17).
pub fn fold_chronicle(log: &str) -> ChronState {
    use std::collections::HashMap;
    let mut delivered_at: HashMap<String, String> = HashMap::new();
    let mut voided: Vec<String> = Vec::new();
    // oldSlug → (newSlug, dropVoid)
    let mut aliases: Vec<(String, String, bool)> = Vec::new();
    let mut gate_runs: HashMap<String, u32> = HashMap::new();

    for line in log.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let data = v.get("data").cloned().unwrap_or(serde_json::Value::Null);
        let slug = data.get("slug").and_then(|x| x.as_str()).map(String::from);
        match typ {
            "batch.compiled" => {
                // запись создаётся/освежается, deliveredAt СОХРАНЯЕТСЯ
                if let Some(s) = slug {
                    delivered_at.entry(s).or_insert_with(String::new);
                }
            }
            "batch.delivered" => {
                if let Some(s) = slug {
                    let at = v.get("at").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    delivered_at.insert(s, at);
                }
            }
            "batch.void" => {
                if let Some(s) = slug {
                    if !voided.contains(&s) {
                        voided.push(s);
                    }
                }
            }
            "gate.run" => {
                if let Some(s) = slug {
                    *gate_runs.entry(s).or_insert(0) += 1;
                }
            }
            "note" => {
                let kind = data.get("kind").and_then(|x| x.as_str()).unwrap_or("");
                if kind == "slug-alias" {
                    let old = data.get("oldSlug").and_then(|x| x.as_str()).map(String::from);
                    let new = data.get("newSlug").and_then(|x| x.as_str()).map(String::from);
                    let drop = data.get("replaces").and_then(|x| x.as_str()) == Some("voided-dubl");
                    if let (Some(o), Some(n)) = (old, new) {
                        if o != n {
                            aliases.push((o, n, drop));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    // алиасы после всей истории (ISSUE 17): запись переезжает old → new
    for (old, new, drop_void) in &aliases {
        if let Some(at) = delivered_at.remove(old) {
            delivered_at.insert(new.clone(), at);
        }
        if *drop_void {
            voided.retain(|s| s != new);
        }
    }
    // delivered: has deliveredAt (непустую) && не void; sort (at, slug) ASC
    let mut delivered: Vec<(String, String)> = delivered_at
        .into_iter()
        .filter(|(s, at)| !at.is_empty() && !voided.contains(s))
        .collect();
    delivered.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    let window_slugs: Vec<String> =
        delivered.iter().rev().take(3).rev().map(|(s, _)| s.clone()).collect();
    ChronState { delivered_at: HashMap::new(), voided, window_slugs, gate_runs }
    // ^ delivered_at: consumed above; для historical_window_for нужен
    //   полный словарь — пересобираем ниже (см. fold_chronicle_full)
}

/// Полный фолд (с delivered_at для historicalWindowFor) — отдельная функция,
/// чтобы не держать два прохода в одной памяти: fold_chronicle оставлен для
/// совместимости тестов, живой путь — fold_chronicle_full.
pub fn fold_chronicle_full(log: &str) -> ChronState {
    use std::collections::HashMap;
    let mut delivered_at: HashMap<String, String> = HashMap::new();
    let mut voided: Vec<String> = Vec::new();
    let mut aliases: Vec<(String, String, bool)> = Vec::new();
    let mut gate_runs: HashMap<String, u32> = HashMap::new();

    for line in log.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        let data = v.get("data").cloned().unwrap_or(serde_json::Value::Null);
        let slug = data.get("slug").and_then(|x| x.as_str()).map(String::from);
        match typ {
            "batch.compiled" => {
                if let Some(s) = slug {
                    delivered_at.entry(s).or_insert_with(String::new);
                }
            }
            "batch.delivered" => {
                if let Some(s) = slug {
                    let at = v.get("at").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    delivered_at.insert(s, at);
                }
            }
            "batch.void" => {
                if let Some(s) = slug {
                    if !voided.contains(&s) {
                        voided.push(s);
                    }
                }
            }
            "gate.run" => {
                if let Some(s) = slug {
                    *gate_runs.entry(s).or_insert(0) += 1;
                }
            }
            "note" => {
                let kind = data.get("kind").and_then(|x| x.as_str()).unwrap_or("");
                if kind == "slug-alias" {
                    let old = data.get("oldSlug").and_then(|x| x.as_str()).map(String::from);
                    let new = data.get("newSlug").and_then(|x| x.as_str()).map(String::from);
                    let drop = data.get("replaces").and_then(|x| x.as_str()) == Some("voided-dubl");
                    if let (Some(o), Some(n)) = (old, new) {
                        if o != n {
                            aliases.push((o, n, drop));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    for (old, new, drop_void) in &aliases {
        if let Some(at) = delivered_at.remove(old) {
            delivered_at.insert(new.clone(), at);
        }
        if *drop_void {
            voided.retain(|s| s != new);
        }
    }
    let mut delivered: Vec<(String, String)> = delivered_at
        .iter()
        .filter(|(s, at)| !at.is_empty() && !voided.contains(s))
        .map(|(s, at)| (s.clone(), at.clone()))
        .collect();
    delivered.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    let window_slugs: Vec<String> =
        delivered.iter().rev().take(3).rev().map(|(s, _)| s.clone()).collect();
    ChronState { delivered_at, voided, window_slugs, gate_runs }
}

pub fn chronicle_state() -> ChronState {
    match read_text(&event_log_path()) {
        Some(log) => fold_chronicle_full(&log),
        None => ChronState::empty(),
    }
}

/// historicalWindowFor (gates.ts:448): сданный батч судится только с
/// членами окна, сданными НЕ ПОЗЖЕ него самого; несданный видит всё окно.
pub fn historical_window_for(batch_slug: &str, st: &ChronState) -> Vec<String> {
    let Some(mine) = st.delivered_at.get(batch_slug) else {
        return st.window_slugs.clone();
    };
    if mine.is_empty() {
        return st.window_slugs.clone();
    }
    st.window_slugs
        .iter()
        .filter(|w| match st.delivered_at.get(*w) {
            None => true,
            Some(at) => at.is_empty() || at.as_str() <= mine.as_str(),
        })
        .cloned()
        .collect()
}

/// windowOthersFor (gates.ts:421): себя, объявленный rebuildOf-источник и
/// перестройки ЭТОГО слага (член окна с contract.rebuildOf == batchSlug)
/// исключаем — ребилд переиспользует материал источника по дизайну.
pub fn window_others_for(
    batch_slug: &str,
    window: &[String],
    rebuild_of: Option<&str>,
) -> Vec<String> {
    window
        .iter()
        .filter(|w| {
            if *w == batch_slug || Some(w.as_str()) == rebuild_of {
                return false;
            }
            match read_json(&contracts_dir().join(format!("{}.json", w))) {
                Some(v) => v.get("rebuildOf").and_then(|x| x.as_str()) != Some(batch_slug),
                None => true, // контракта нет — член остаётся (wc?.rebuildOf !== slug)
            }
        })
        .cloned()
        .collect()
}

/// observableSlotCount (compiler.ts:326): слоты с хоть какой позой/палитрой.
fn observable_slot_count(slots: &[serde_json::Value]) -> usize {
    slots
        .iter()
        .filter(|s| {
            let pose = s.get("pose").and_then(|x| x.as_str()).unwrap_or("");
            let pal = s.get("palette").and_then(|x| x.as_str()).unwrap_or("");
            !pose.trim().is_empty() || !pal.trim().is_empty()
        })
        .count()
}

/* ================================================================== */
/* Этап 1-в — simcheck-хелперы: слова, Жаккар, toFixed(2) V8, сплит     */
/* ================================================================== */

/// words (gates.ts:2487): [a-z']+ на нижнем регистре, длина > 3, set.
fn sim_words(s: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let low = s.to_lowercase();
    let b = low.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        if b[i].is_ascii_lowercase() || b[i] == b'\'' {
            let start = i;
            while i < b.len() && (b[i].is_ascii_lowercase() || b[i] == b'\'') {
                i += 1;
            }
            let w = &low[start..i];
            if w.chars().count() > 3 {
                out.insert(w.to_string());
            }
        } else {
            i += 1;
        }
    }
    out
}

/// jaccard-дельта: порог сравнивается целочисленно (j_gt), формат —
/// js_fixed2; сырой f64-вариант TS не нужен.

/// toFixed(2) в семантике V8 (знаменатель мал: J = inter/union, union ≤
/// несколько сотен). Сравнение с порогом — целочисленное, ФОРМАТ — по
/// точной десятичной экспансии f64: V8 округляет half-away-from-zero.
fn js_fixed2(inter: usize, union: usize) -> String {
    // k = round_half_away(value·100) на точном значении d = fl(inter/union)
    let p = (inter as u128) * 100;
    let q = union.max(1) as u128;
    let k_floor = p / q;
    let r2 = (p % q) * 2;
    let k = if r2 > q {
        k_floor + 1
    } else if r2 < q {
        k_floor
    } else {
        // точный тай: value·100 = k_floor + 1/2 → значение (2k+1)/200;
        // d = fl(value): если значение точно представимо (знаменатель —
        // степень двойки после сокращения) → half-away → вверх; иначе
        // сторона fl определяет округление (хвост мантиссы).
        let n = 2 * k_floor + 1;
        let den = 200u128;
        let g = gcd_u128(n, den);
        let (n2, d2) = (n / g, den / g);
        if d2.is_power_of_two() {
            k_floor + 1
        } else {
            let scaled = n2 << 96;
            let rem = scaled % d2;
            if rem * 2 > d2 {
                k_floor + 1 // fl выше тай-точки → цифры за 2-м знаком > 5 → вверх
            } else {
                k_floor // fl ниже — вниз (rem*2 == d2 невозможен: d2 не 2^a)
            }
        }
    };
    format!("{}.{:02}", k / 100, k % 100)
}

fn gcd_u128(a: u128, b: u128) -> u128 {
    if b == 0 { a } else { gcd_u128(b, a % b) }
}

/// Предложение с J>порог: «{left}…» (J={js_fixed2}) — порог сравнивается
/// ЦЕЛОЧИСЛЕННО (inter/union > threshold ⟺ inter·den > union·num) — так
/// байт-в-байт к f64-сравнению JS на живых данных (дистанция до порога
/// ≥ 1/union ≫ ulp), без сырого float.
fn j_gt(inter: usize, union: usize, num: u64, den: u64) -> bool {
    (inter as u128) * (den as u128) > (union as u128) * (num as u128)
}

/// POS-сплит предложений: /[.!?]\s+/ — ОДИН пунктуационный символ + ≥1
/// пробельный; пункт без хвостового пробела остаётся в предложении.
/// Затем trim → toLowerCase → filter(len>40 && !boilerplate).
fn sim_sentences(pos: &str) -> Vec<String> {
    let mut raw: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut chars = pos.chars().peekable();
    while let Some(c) = chars.next() {
        cur.push(c);
        if (c == '.' || c == '!' || c == '?') && chars.peek().is_some_and(|n| n.is_whitespace()) {
            while chars.peek().is_some_and(|n| n.is_whitespace()) {
                chars.next();
            }
            raw.push(std::mem::take(&mut cur));
        }
    }
    raw.push(cur);
    raw.into_iter()
        .map(|x| x.trim().to_lowercase())
        .filter(|x| x.chars().count() > 40 && !is_boilerplate(x))
        .collect()
}

fn is_boilerplate(s: &str) -> bool {
    s.contains("masterpiece")
        || s.contains("best quality")
        || s.contains("anime artstyle")
        || s.contains("her face is rendered in stylized")
}

fn hard_receipt_with_notes(gate: &'static str, findings: Vec<String>, notes: Vec<String>) -> Receipt {
    Receipt {
        gate,
        level: "hard",
        verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
        findings,
        notes,
    }
}

/* ================================================================== */
/* Этап 1-в — гейты 1-6 (structure · exp-purity · floors · dresser ·    */
/* window · niche-legibility)                                           */
/* ================================================================== */

/// 1. structure (gates.ts:545, hard): закон 24+EXP, OC=3, мейны=21,
/// поля POS/NEG/THESIS/жанр, quality-теги, фейс-лок, опенер, Canon у OC.
pub fn gate_structure(batch: &TextBatch, laws: &Laws) -> Receipt {
    let mut f = Vec::new();
    let exp_count = batch.slots.iter().filter(|s| s.genre == "EXP").count();
    let mains = batch
        .slots
        .iter()
        .filter(|s| s.genre != "OC" && s.genre != "EXP")
        .count();
    let oc_count = batch.slots.iter().filter(|s| s.genre == "OC").count();
    if batch.slots.len() as u32 != laws.slots_total + exp_count as u32 {
        f.push(format!(
            "слотов {}, ожидается {} + EXP-оверлей ({} OC + {} мейнов — вердикт T4-02; EXP-слотов {}, отдельно от мейнов — приказ 2026-10-08)",
            batch.slots.len(),
            laws.slots_total,
            laws.oc_slots,
            laws.mains_total,
            exp_count
        ));
    }
    if exp_count as u32 > laws.exp_slots_max {
        f.push(format!(
            "EXP-оверлей {} > {} слотов (law.expSlotsMax — «9 лишних слотов под всякие гадости», приказ автора)",
            exp_count, laws.exp_slots_max
        ));
    }
    if oc_count as u32 != laws.oc_slots {
        f.push(format!("OC-слотов {}, ожидается {}", oc_count, laws.oc_slots));
    }
    if mains as u32 != laws.mains_total {
        f.push(format!(
            "тематических мейнов {}, ожидается {} (EXP-оверлей не входит — приказ 2026-10-08)",
            mains, laws.mains_total
        ));
    }
    for s in &batch.slots {
        if s.pos.is_empty() {
            f.push(format!("P{}: пустой POS", s.position));
        }
        if s.neg.is_empty() {
            f.push(format!("P{}: пустой NEG", s.position));
        }
        if s.thesis.is_empty() {
            f.push(format!("P{}: нет THESIS", s.position));
        }
        if s.genre.is_empty() {
            f.push(format!(
                "P{}: жанр не назван в шапке (OC/NICHE/VOLT/EXQUISITE — вердикт T4-02)",
                s.position
            ));
        }
        if !s.pos.is_empty() && !s.pos.to_lowercase().contains("masterpiece") {
            f.push(format!("P{}: POS без quality-тегов", s.position));
        }
        if !s.pos.is_empty() && !s.pos.to_lowercase().contains("anime eyes") {
            f.push(format!("P{}: нет фейс-лока (anime eyes)", s.position));
        }
        if !s.pos.is_empty() && !s.pos.to_lowercase().contains("anime style") {
            f.push(format!("P{}: нет опенера (anime style)", s.position));
        }
    }
    for s in batch.slots.iter().filter(|x| x.position <= 3) {
        if s.canon.is_empty() {
            f.push(format!("P{} (OC): нет Canon-строки", s.position));
        }
    }
    hard_receipt("structure", f)
}

/// normalizeThemeWords (batch-md.ts:354): <3 символов и дубли — вон.
fn normalize_theme_words(words: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for w in words {
        let k = w.trim().to_lowercase();
        if k.chars().count() < 3 || !seen.insert(k.clone()) {
            continue;
        }
        out.push(k);
    }
    out
}

/// themeTokenHit (batch-md.ts:377): `(^|[\s_-])(w1|w2…)([\s_-]|$)` на
/// нижнем регистре; regex-матч = САМОЕ ЛЕВОЕ вхождение, на позиции —
/// альтернация в порядке документа (лево-приоритетный скан).
fn theme_token_hit(token: &str, kws: &[String]) -> Option<String> {
    if kws.is_empty() {
        return None;
    }
    let t: Vec<char> = token.to_lowercase().chars().collect();
    let is_sep = |c: char| c == ' ' || c == '_' || c == '-' || c.is_whitespace();
    for i in 0..t.len() {
        if i > 0 && !is_sep(t[i - 1]) {
            continue;
        }
        for kw in kws {
            let kc: Vec<char> = kw.chars().collect();
            if i + kc.len() > t.len() || t[i..i + kc.len()] != kc[..] {
                continue;
            }
            let j = i + kc.len();
            if j == t.len() || is_sep(t[j]) {
                return Some(kw.clone());
            }
        }
    }
    None
}

/// /^EXP\s+{letter}-{half}(?![A-Za-z0-9])/u — маркер THESIS EXP-слота.
fn exp_marker_ok(thesis: &str, letter: &str, half: &str) -> bool {
    let Some(rest) = thesis.strip_prefix("EXP") else { return false };
    let rb = rest.as_bytes();
    let mut idx = 0usize;
    while idx < rb.len() && (rb[idx] as char).is_whitespace() {
        idx += 1;
    }
    if idx == 0 {
        return false; // \s+ обязателен
    }
    let after_ws = &rest[idx..];
    let Some(after_letter) = after_ws.strip_prefix(letter) else { return false };
    let Some(after_dash) = after_letter.strip_prefix('-') else { return false };
    let Some(tail) = after_dash.strip_prefix(half) else { return false };
    match tail.chars().next() {
        None => true,
        Some(c) => !c.is_ascii_alphanumeric(),
    }
}

/// /^EXP\s+(?:single\s*·\s*)?[\u03B1-\u03C9]/u — маркер без контракта.
fn fallback_exp_marker(thesis: &str) -> bool {
    let Some(rest) = thesis.strip_prefix("EXP") else { return false };
    let rb = rest.as_bytes();
    let mut idx = 0usize;
    while idx < rb.len() && (rb[idx] as char).is_whitespace() {
        idx += 1;
    }
    if idx == 0 {
        return false;
    }
    let after = &rest[idx..];
    let after = match after.strip_prefix("single") {
        Some(a) => {
            let a = a.trim_start_matches(|c: char| c.is_whitespace());
            match a.strip_prefix('·') {
                Some(x) => x.trim_start_matches(|c: char| c.is_whitespace()),
                None => return false,
            }
        }
        None => after,
    };
    match after.chars().next() {
        Some(c) => ('\u{03B1}'..='\u{03C9}').contains(&c),
        None => false,
    }
}

/// /PL\d+/i на шапке (exp-purity: поза пары) — первое вхождение, upper.
fn pose_of_header(header: &str) -> String {
    let b = header.as_bytes();
    let mut i = 0usize;
    while i + 3 <= b.len() {
        if (b[i] == b'P' || b[i] == b'p')
            && (b[i + 1] == b'L' || b[i + 1] == b'l')
            && b[i + 2].is_ascii_digit()
        {
            let mut j = i + 2;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            return header[i..j].to_uppercase();
        }
        i += 1;
    }
    String::new()
}

/// 1b. exp-purity (gates.ts:579, hard, вердикт T4-34): маркер THESIS,
/// тема-слова вне POS болванки, A/B-пара делит план.
pub fn gate_exp_purity(batch: &TextBatch, contract: Option<&Contract>) -> Receipt {
    let mut f = Vec::new();
    let mut notes = Vec::new();
    let exp_slots: Vec<&TextSlot> = batch.slots.iter().filter(|s| s.genre == "EXP").collect();
    if exp_slots.is_empty() {
        notes.push(
            "EXP-оверлея нет — гейт молчит (EXP — не обязанность каждого батча: пара по умолчанию, 0 — явным приказом)"
                .to_string(),
        );
        return hard_receipt_with_notes("exp-purity", f, notes);
    }
    let theme_line = batch
        .text
        .lines()
        .find(|l| l.starts_with("ТЕМА-СЛОВА:"))
        .unwrap_or("");
    let mut theme_words: Vec<String> = theme_line
        .strip_prefix("ТЕМА-СЛОВА:")
        .unwrap_or("")
        .trim_start()
        .split(',')
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty())
        .collect();
    if theme_words.is_empty() {
        if let Some(t) = contract.and_then(|c| c.theme.as_deref()) {
            theme_words = t
                .split(|c: char| c == ' ' || c == '_' || c == '-' || c.is_whitespace())
                .filter(|w| w.chars().count() >= 3)
                .map(String::from)
                .collect();
        }
    }
    let kws = normalize_theme_words(&theme_words);
    let has_matcher = !kws.is_empty();
    let mut contract_exp: std::collections::HashMap<u32, (String, String, Option<u32>, String)> =
        Default::default();
    if let Some(c) = contract {
        for cs in &c.slots {
            if let Some(e) = &cs.exp {
                contract_exp.insert(
                    cs.position,
                    (e.letter.clone(), e.half.clone(), e.pair_with, e.hypothesis.clone()),
                );
            }
        }
    }
    for s in &exp_slots {
        match contract_exp.get(&s.position) {
            Some((letter, half, _, hyp)) => {
                if !exp_marker_ok(&s.thesis, letter, half) {
                    let h: String = hyp.chars().take(60).collect();
                    f.push(format!(
                        "P{}: THESIS EXP-слота не открывается маркером «EXP {}-{} · …» (гипотеза: {}…) — радар не увидит программу, вердикт T4-34",
                        s.position, letter, half, h
                    ));
                }
            }
            None => {
                if !fallback_exp_marker(&s.thesis) {
                    f.push(format!(
                        "P{}: THESIS EXP-слота без маркера «EXP <буква>-<половина> · …» (контракт exp-данных тоже не дал) — гипотеза нечитаема радаром",
                        s.position
                    ));
                }
            }
        }
        if has_matcher {
            let mut hits: Vec<String> = Vec::new();
            for token in s.pos.split(',') {
                if let Some(hit) = theme_token_hit(token.trim(), &kws) {
                    if !hits.contains(&hit) {
                        hits.push(hit);
                    }
                }
            }
            if !hits.is_empty() {
                f.push(format!(
                    "P{}: тема-слова в POS EXP-болванки ({}) — EXP без темы (вердикт T4-34)",
                    s.position,
                    hits.join(", ")
                ));
            }
        }
        if let Some((_, _, Some(pw), _)) = contract_exp.get(&s.position) {
            match batch.slots.iter().find(|x| x.position == *pw) {
                Some(other) if genre_of(&other.meta) == "EXP" => {
                    let mine = pose_of_header(&s.header);
                    let theirs = pose_of_header(&other.header);
                    if !mine.is_empty() && !theirs.is_empty() && mine != theirs {
                        f.push(format!(
                            "P{}: пара делит план — поза {} ≠ {} у P{} (разница пар ровно одна, канон T4-27.2)",
                            s.position, mine, theirs, pw
                        ));
                    }
                }
                _ => {
                    f.push(format!(
                        "P{}: пара EXP указывает на P{}, но его нет в батче или он не EXP-слот",
                        s.position, pw
                    ));
                }
            }
        }
    }
    notes.push(format!(
        "EXP-слотов {} · с exp-контрактом {} · тема-слов для фильтра {}",
        exp_slots.len(),
        contract_exp.len(),
        if has_matcher { theme_words.len() } else { 0 }
    ));
    hard_receipt_with_notes("exp-purity", f, notes)
}

/// XXX-сигналы вечного потолка (gates.ts:353).
const XXX_SIGNALS: [&str; 11] = [
    "sex",
    "sexual act",
    "intercourse",
    "penetration",
    "creampie",
    "cum",
    "cumshot",
    "semen",
    "blowjob",
    "handjob",
    "masturbat",
];

/// /\bNEEDLE/i — левая граница на ЛЮБОЙ позиции (первый satisfying match).
fn has_left_boundary_ci(hay_lower: &str, needle_lower: &str) -> bool {
    let mut from = 0usize;
    while let Some(rel) = hay_lower[from..].find(needle_lower) {
        let s = from + rel;
        if s == 0 || !hay_lower[..s].chars().next_back().is_some_and(ascii_word) {
            return true;
        }
        from = s + 1;
    }
    false
}

/// 2. floors (gates.ts:677, hard): анти-лоли ≥4, лика/свечная/фейс-гарды,
/// milf-квота (N30: треть батча), XXX-сигналы (левая \b, аудит V3).
pub fn gate_floors(batch: &TextBatch, recipes: Option<&RatingRecipes>) -> Receipt {
    let mut f = Vec::new();
    let empty = EternalFloors::default();
    let floors = recipes.map(|r| &r.eternal_floors).unwrap_or(&empty);
    let mut milf_slots: Vec<u32> = Vec::new();
    for s in &batch.slots {
        let neg = s.neg.to_lowercase();
        let loli_hits = floors
            .anti_loli
            .iter()
            .filter(|t| neg.contains(&t.to_lowercase()))
            .count();
        if loli_hits < 4 {
            f.push(format!(
                "P{}: анти-лоли флоор слаб ({}/{} терминов) — нужно ≥4",
                s.position,
                loli_hits,
                floors.anti_loli.len()
            ));
        }
        for term in &floors.leak_guard {
            if !neg.contains(&term.to_lowercase()) {
                f.push(format!("P{}: лика-гарда пропускает «{}»", s.position, term));
                break;
            }
        }
        let pos_lower = s.pos.to_lowercase();
        let concept_calls = ["candle", "lantern", "torch", "chandelier", "lamp", "brazier"]
            .iter()
            .any(|w| pos_lower.contains(w));
        if !concept_calls {
            for term in &floors.candle_guard {
                if !neg.contains(&term.to_lowercase()) {
                    f.push(format!("P{}: свечная гарда пропускает «{}»", s.position, term));
                    break;
                }
            }
        }
        for term in &floors.face_guard {
            if !neg.contains(&term.to_lowercase()) {
                f.push(format!("P{}: фейс-гарда пропускает «{}»", s.position, term));
                break;
            }
        }
        // milf: \b(milf|milfs)\b/i — milf-токен в POS легален, квота — треть
        if contains_word_ci(&s.pos, "milf") || contains_word_ci(&s.pos, "milfs") {
            if !milf_slots.contains(&s.position) {
                milf_slots.push(s.position);
            }
        }
        for t in XXX_SIGNALS {
            if has_left_boundary_ci(&pos_lower, t) {
                f.push(format!(
                    "P{}: XXX-сигнал в POS («{}») — вечный потолок",
                    s.position, t
                ));
                break;
            }
        }
    }
    let milf_cap = (batch.slots.len() + 2) / 3; // Math.ceil(len/3)
    if milf_slots.len() > milf_cap {
        let ids: Vec<String> = milf_slots.iter().map(|n| format!("P{n:02}")).collect();
        f.push(format!(
            "milf-токен в {} слотах ({}) > {} — N30-поправка: милф разрешён, но не везде",
            milf_slots.len(),
            ids.join(", "),
            milf_cap
        ));
    }
    hard_receipt("floors", f)
}

/// checkCoherence (dresser.ts:163) — квитанции когерентности дресс-кода.
fn check_coherence(
    tag_run: &str,
    tier: &str,
    is_exploratory: bool,
    spec: Option<&DresserSpec>,
) -> Vec<String> {
    let mut out = Vec::new();
    let Some(spec) = spec else { return out };
    let t = tag_run.to_lowercase();
    const GROUP_A: [&str; 6] = [
        "garter straps",
        "garter belt",
        "thighhighs",
        "stockings",
        "lingerie set",
        "sheer nightgown",
    ];
    const GROUP_B: [&str; 2] = ["swimsuit", "bikini"];
    for conf in &spec.conflicts {
        let tags: Vec<String> = conf.tags.iter().map(|x| x.to_lowercase()).collect();
        let ga: Vec<&String> = tags.iter().filter(|x| GROUP_A.contains(&x.as_str())).collect();
        let gb: Vec<&String> = tags.iter().filter(|x| GROUP_B.contains(&x.as_str())).collect();
        let a_hit = !ga.is_empty() && ga.iter().any(|x| contains_word_ci(&t, x));
        let b_hit = !gb.is_empty() && gb.iter().any(|x| contains_word_ci(&t, x));
        if a_hit && b_hit {
            let p0 = conf.pair.first().map(|s| s.as_str()).unwrap_or("");
            let p1 = conf.pair.get(1).map(|s| s.as_str()).unwrap_or("");
            out.push(format!("конфликт дресс-кода: {p0} + {p1} — {}", conf.why));
        }
        let fa_hit = t.contains("gown") || t.contains("opera gloves");
        let fb_hit = t.contains("gym leggings")
            || t.contains("tennis skirt")
            || t.contains("track shorts");
        if conf.rule == "warn"
            && ((fa_hit && fb_hit)
                || (t.contains("sports bra")
                    && (t.contains("garter belt") || t.contains("stockings"))))
        {
            out.push(format!("смешение регистров (Дрессер, warn): {}", conf.why));
        }
    }
    if tier == "R+" && !is_exploratory {
        if contains_word_ci(&t, "nipples through clothing") {
            out.push(
                "№28: через-заявка на R+ — это X-канал по определению (hard в rating-recipe; EXP-слот обязан флаг ⚗)".to_string(),
            );
        }
        if t.contains("wet clothes")
            && contains_word_ci(&t, "see-through")
            && !contains_word_ci(&t, "swimsuit")
        {
            out.push(
                "№28: мокрое+сквозное на тканевом верхе = X-комбо (P12/P25/P26 T4-31); купальник — исключение (P21)".to_string(),
            );
        }
    }
    const UPPER_ITEMS: [&str; 15] = [
        "blouse", "tee", "shirt", "knit top", "cardigan", "jacket", "coat", "parka", "robe",
        "vest", "corset", "sweater", "kimono", "crop top", "halter",
    ];
    let mut upper_hits = 0usize;
    for u in UPPER_ITEMS {
        if contains_word_ci(&t, u) {
            upper_hits += 1;
        }
    }
    if upper_hits >= 3 {
        out.push(format!(
            "§7-бис: {upper_hits} верхних предметов в тег-ране — рендерер соберёт скромную комбинацию (RENDER LAW 3+ слоёв)"
        ));
    }
    const PROP_WORDS: [&str; 6] =
        ["measuring tape", "ribbon", "harness", "bell", "collar tag", "ribbon choker"];
    const CONTACT_VERBS: [&str; 8] =
        ["wraps", "measures", "holds", "threads", "winds", "clips", "ties", "loop"];
    for p in PROP_WORDS {
        if t.contains(p) && !CONTACT_VERBS.iter().any(|v| t.contains(v)) {
            out.push(format!(
                "P03-правило: реквизит «{p}» без контакт-глагола (wraps/measures/holds…) — читается ошибкой, не темой (мерная лента T4-31)"
            ));
        }
    }
    out
}

/// 3-бис. dresser (gates.ts:960, warn, квитанция №29): №28-риски каналов
/// на R+, конфликты категорий, слои §7-бис, P03-реквизит.
pub fn gate_dresser(batch: &TextBatch, dresser: Option<&DresserSpec>) -> Receipt {
    let mut f = Vec::new();
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier.is_empty() {
            continue;
        }
        let tag_run = tag_run_of(&s.pos);
        let is_expl = is_exploratory_slot(s);
        if tier == "R+" && !is_expl {
            let swim = contains_word_ci(&tag_run, "swimsuit")
                || contains_word_ci(&tag_run, "bikini")
                || contains_word_ci(&tag_run, "rash guard");
            if contains_word_ci(&tag_run, "see-through") {
                f.push(format!(
                    "P{}: №28-риск: «see-through» на R+ — тег рисует просвет (P09: даже тёмный knit — X; P30 выжил лишь с «dark garment» и опозданием тега) — лучше опустить, бугорки живут без него",
                    s.position
                ));
            }
            if tag_run.contains("wet clothes") && !swim {
                f.push(format!(
                    "P{}: №28-риск: «wet clothes» на тканевом верхе R+ — влага тянит в X (№27: тон не щит); DRY-формула P30 — «sweat glisting»; мокрый купальник — исключение (P21-золото)",
                    s.position
                ));
            }
        }
        let tier28 = if tier == "R+" || tier == "X" { tier } else { "R" };
        for r in check_coherence(&tag_run, tier28, is_expl, dresser) {
            f.push(format!("P{}: {r}", s.position));
        }
    }
    warn_receipt("dresser", f)
}

/// 6. window (gates.ts:1142, hard): позы/палитры против окна ротации;
/// себя/rebuildOf/перестройки исключаем, ретроактивное окно (T4-31-ревизия).
pub fn gate_window(batch: &TextBatch, contract: Option<&Contract>, st: &ChronState) -> Receipt {
    let mut f = Vec::new();
    let mut notes = Vec::new();
    if st.window_slugs.is_empty() {
        return hard_receipt_with_notes("window", f, notes);
    }
    match contract {
        None => {
            notes.push(
                "батч без контракта (RAW/ручной): сравнение поз/палитр с окном неприменимо; текстовая близость покрывается simcheck".to_string(),
            );
        }
        Some(c) => {
            let window = historical_window_for(&batch.slug, st);
            let others = window_others_for(&batch.slug, &window, c.rebuild_of.as_deref());
            let mut my_poses: std::collections::HashSet<String> = Default::default();
            let mut my_pals: std::collections::HashSet<String> = Default::default();
            for s in &batch.slots {
                if let Some(m) = extract_pose_id(&s.header) {
                    my_poses.insert(m);
                }
                if let Some(p) = extract_palette_id(&s.header) {
                    my_pals.insert(p);
                }
            }
            let mut opaque: Vec<String> = Vec::new();
            for w in &others {
                let wc = read_json(&contracts_dir().join(format!("{w}.json")));
                let Some(wc) = wc else {
                    opaque.push(w.clone());
                    continue;
                };
                let slots = wc
                    .get("slots")
                    .and_then(|x| x.as_array())
                    .cloned()
                    .unwrap_or_default();
                if observable_slot_count(&slots) == 0 {
                    opaque.push(w.clone());
                    continue;
                }
                for s in &slots {
                    let pose = s.get("pose").and_then(|x| x.as_str()).unwrap_or("");
                    let pal = s.get("palette").and_then(|x| x.as_str()).unwrap_or("");
                    if pose.trim().is_empty() && pal.trim().is_empty() {
                        continue;
                    }
                    if my_poses.contains(pose) {
                        f.push(format!("поза {pose} конфликтует с окном ({w})"));
                    }
                    if my_pals.contains(pal) {
                        f.push(format!("палитра {pal} конфликтует с окном ({w})"));
                    }
                }
            }
            if !opaque.is_empty() {
                notes.push(format!(
                    "члены окна без контракта (позы/палитры ненаблюдаемы): {}",
                    opaque.join(", ")
                ));
            }
        }
    }
    hard_receipt_with_notes("window", f, notes)
}

/// 8b. niche-legibility (gates.ts:1239, warn, вердикт T4-02): раса делает
/// физическую работу (теги расы в POS) + свидетель в кадре.
pub fn gate_niche_legibility(
    batch: &TextBatch,
    contract: Option<&Contract>,
    races: &[RaceEntry],
    laws: &Laws,
) -> Receipt {
    let mut f = Vec::new();
    const WITNESS_WORDS: [&str; 16] = [
        "mirror",
        "shop glass",
        "security monitor",
        "door gap",
        "propped phone",
        "traffic mirror",
        "level gauge",
        "window pane",
        "wet street",
        "elevator brass",
        "photo frame",
        "spoon",
        "watch face",
        "car hood",
        "fountain edge",
        "witness",
    ];
    let niche_slots: Vec<&TextSlot> = batch.slots.iter().filter(|s| s.genre == "NICHE").collect();
    for s in &niche_slots {
        let pos_lower = s.pos.to_lowercase();
        let race_name = contract
            .and_then(|c| c.slots.iter().find(|x| x.position == s.position))
            .and_then(|x| x.race.clone())
            .unwrap_or_default();
        if !race_name.is_empty() {
            let rn_full = race_name.to_lowercase();
            let rn_core = rn_full.split(" (").next().unwrap_or("").to_string();
            let race_entry = races.iter().find(|r| {
                let other = r.name.to_lowercase();
                let other_core = other.split(" (").next().unwrap_or("").to_string();
                rn_full.contains(&other_core) || other.contains(&rn_core)
            });
            let mut tokens: Vec<String> = Vec::new();
            let add_tokens = |src: &str, tokens: &mut Vec<String>| {
                let norm: String = src
                    .to_lowercase()
                    .chars()
                    .map(|c| if c == '(' || c == ')' || c == '-' { ' ' } else { c })
                    .collect();
                for w in norm.split_whitespace() {
                    if w.chars().count() > 3
                        && !["girl", "kin", "with"].contains(&w)
                        && !tokens.iter().any(|x| x == w)
                    {
                        tokens.push(w.to_string());
                    }
                }
            };
            add_tokens(&race_name, &mut tokens);
            if let Some(re) = race_entry {
                add_tokens(&re.features.join(" "), &mut tokens);
            }
            let hits = tokens.iter().filter(|w| pos_lower.contains(w.as_str())).count();
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
    if niche_slots.is_empty() && themed_mains as u32 == laws.mains_total {
        f.push("NICHE-слотов нет — жанровая структура батча сломана".to_string());
    }
    warn_receipt("niche-legibility", f)
}

/// 8d. claim-visibility (gates.ts:1320, warn, вердикт T4-03): зона сигнала
/// открыта камере — нижняя/грудная зона не закрыта, слоёв ≤, OC смотрит.
pub fn gate_claim_visibility(batch: &TextBatch) -> Receipt {
    let mut f = Vec::new();
    const LOWER_COVERS: [&str; 16] = [
        "skirt",
        "dress",
        "cloak",
        "cape",
        "coat",
        "apron",
        "happi",
        "tied at waist",
        "tied at the waist",
        "shirt tied",
        "towel around waist",
        "waist wrap",
        "sarong",
        "long shirt",
        "untucked shirt",
        "peplum",
    ];
    const CHEST_COVERS: [&str; 10] = [
        "buttoned shirt",
        "buttoned-up",
        "buttoned up",
        "zipped up",
        "zipped to",
        "closed jacket",
        "buttoned jacket",
        "turtleneck",
        "high-neck",
        "closed coat",
    ];
    const TOP_LAYERS: [&str; 24] = [
        "shirt",
        "tee",
        "t-shirt",
        "tank",
        "camisole",
        "blouse",
        "sweater",
        "pullover",
        "hoodie",
        "jacket",
        "coat",
        "blazer",
        "cardigan",
        "happi",
        "tunic",
        "turtleneck",
        "button-down",
        "flannel",
        "jersey",
        "varsity",
        "parka",
        "poncho",
        "robe",
        "overalls",
    ];
    // GARMENT_NOUNS: Set из TOP_LAYERS + добавки (Set = insertion order)
    const GARMENT_EXTRA: [&str; 31] = [
        "leotard",
        "bodysuit",
        "swimsuit",
        "bikini",
        "microbikini",
        "bra",
        "panties",
        "thong",
        "boyshorts",
        "lingerie",
        "garter belt",
        "stockings",
        "thighhighs",
        "socks",
        "jeans",
        "pants",
        "trousers",
        "breeches",
        "shorts",
        "skirt",
        "dress",
        "apron",
        "towel",
        "nightgown",
        "slip",
        "corset",
        "harness",
        "wrap",
        "sarong",
        "sash",
        "obi",
    ];
    const GARMENT_TAIL: [&str; 7] = [
        "bolero", "kimono", "leggings", "fishnets", "uniform", "cloak", "cape",
    ];
    let mut garment_nouns: Vec<String> = Vec::new();
    for g in TOP_LAYERS
        .iter()
        .chain(GARMENT_EXTRA.iter())
        .chain(GARMENT_TAIL.iter())
    {
        if !garment_nouns.iter().any(|x| x == g) {
            garment_nouns.push(g.to_string());
        }
    }
    const POSE_AWAY: [&str; 8] = [
        "forward fold",
        "prone",
        "facedown",
        "face down",
        "from behind",
        "back to camera",
        "back turned",
        "bent away",
    ];
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier != "R+" && tier != "X" {
            continue;
        }
        let first_period = s.pos.find('.');
        let tag_block = match first_period {
            Some(i) if i > 0 => s.pos[..i].to_lowercase(),
            _ => s.pos.to_lowercase(),
        };
        let pos_lower = s.pos.to_lowercase();
        // 1) нижняя зона сигнала закрыта верхним предметом
        let lower_claim = ["cameltoe", "camel toe", "visible pantyline", "pantyline"]
            .iter()
            .any(|c| tag_block.contains(c));
        if lower_claim {
            if let Some(cover) = LOWER_COVERS.iter().find(|c| contains_word_ci(&tag_block, c)) {
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
            if let Some(cover) = CHEST_COVERS.iter().find(|c| contains_word_ci(&tag_block, c)) {
                f.push(format!(
                    "P{}: зона сигнала (грудь) закрыта «{}» — tape/handbra не виден камере (вердикт T4-03)",
                    s.position, cover
                ));
            }
        }
        // 3) слоевой хаос: ≥5 предметов одежды в тег-блоке
        let garments: Vec<&String> = garment_nouns
            .iter()
            .filter(|g| contains_word_ci(&tag_block, g))
            .collect();
        if garments.len() >= 5 {
            let shown: Vec<String> = garments.iter().take(5).map(|g| g.to_string()).collect();
            f.push(format!(
                "P{}: {} предметов одежды в тег-блоке ({}) — ≤2 слоя на зону, зона сигнала ≤1 (вердикт T4-03: слои путают рендер)",
                s.position,
                garments.len(),
                shown.join(", ")
            ));
        }
        // 3b) стопка верхних слоёв: ≥3 верхних предметов
        let tops: Vec<&str> = TOP_LAYERS
            .iter()
            .filter(|g| contains_word_ci(&tag_block, g))
            .copied()
            .collect();
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
            if let Some(away) = POSE_AWAY
                .iter()
                .find(|p| tag_block.contains(*p) || pos_lower.contains(*p))
            {
                f.push(format!(
                    "P{}: OC-слот с позой «{}» — зона сигнала уходит от камеры; OC = любимые персонажи автора, камера-смотрящие позы (вердикт T4-03)",
                    s.position, away
                ));
            }
        }
        // 5) позиция заявки/состояния в тег-ране (R+; OC-люфт 22)
        if tier == "R+" {
            let pos_tags: Vec<String> = tag_block.split(',').map(|t| t.trim().to_string()).collect();
            let find_idx = |needle: &str| pos_tags.iter().position(|t| t.contains(needle));
            let idxs: Vec<usize> = [find_idx("wet clothes"), find_idx("see-through")]
                .into_iter()
                .flatten()
                .collect();
            let wet_idx = idxs.iter().min().copied().map(|v| v as i64).unwrap_or(-1);
            let limit: i64 = if s.genre == "OC" { 22 } else { 16 };
            if wet_idx >= limit {
                f.push(format!(
                    "P{}: состояние ткани стоит тегом №{} — хвост тег-рана рендерер читает слабо; подними wet clothes / see-through к началу (рендер-вердикт T4-03)",
                    s.position,
                    wet_idx + 1
                ));
            }
        }
    }
    warn_receipt("claim-visibility", f)
}

/* ================================================================== */
/* Этап 1-в — техника-карта (таблица автора) и гейты 8e/12              */
/* ================================================================== */

/// TECH_BOILER_RE (gates.ts:364): бойлерплейт вырезается из тег-блока —
/// «ecchi anime style» не дарит слой 3. Глобальная замена на ' '.
fn tech_tag_block(pos: &str) -> String {
    const BOILER: [&str; 8] = [
        "hentai anime style",
        "ecchi anime style",
        "anime style",
        "masterpiece",
        "best quality",
        "anime artstyle",
        "1girl",
        "solo",
    ];
    let first_period = pos.find('.');
    let tb = match first_period {
        Some(i) if i > 0 => pos[..i].to_lowercase(),
        _ => pos.to_lowercase(),
    };
    let chars: Vec<(usize, char)> = tb.char_indices().collect();
    let mut out = String::with_capacity(tb.len());
    let mut i = 0usize;
    'outer: while i < chars.len() {
        let (byte_pos, ch) = chars[i];
        // \b перед альтернативой
        let left_ok = byte_pos == 0
            || !tb[..byte_pos].chars().next_back().is_some_and(ascii_word);
        if left_ok && ascii_word(ch) {
            for alt in BOILER {
                if tb[byte_pos..].starts_with(alt) {
                    let end = byte_pos + alt.len();
                    let after_ok = end >= tb.len()
                        || !tb[end..].chars().next().is_some_and(ascii_word);
                    if after_ok {
                        out.push(' ');
                        // продвигаем на длину альтернативы (символы)
                        let mut consumed = 0usize;
                        while consumed < alt.chars().count() {
                            i += 1;
                            consumed += 1;
                        }
                        continue 'outer;
                    }
                }
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

/// techHit (gates.ts:373): some(alt → every(needle: \b…\b по tb)).
/// Регистр НЕ приводится (в TS нет /i) — tb уже в нижнем, иглы спека —
/// тоже (живой спек соответствует).
fn tech_hit(tb: &str, match_alts: &[Vec<String>]) -> bool {
    if match_alts.is_empty() {
        return false;
    }
    match_alts
        .iter()
        .any(|alt| alt.iter().all(|s| contains_word(tb, s)))
}

/// isLadderSignal (gates.ts:381): ● на R / R+ / X.
fn is_ladder_signal(e: &TechniqueEntry) -> bool {
    e.r == "●" || e.rplus == "●" || e.x == "●"
}

/// dedupeSubsumed (gates.ts:387): субсумируемые теги не считаются вторым
/// сигналом (двойной счёт ломает сумму слоёв).
fn dedupe_subsumed<'a>(hits: &[&'a TechniqueEntry]) -> Vec<&'a TechniqueEntry> {
    let has = |frags: &[&str]| {
        hits.iter().any(|e| frags.iter().any(|frag| e.tag.contains(frag)))
    };
    hits.iter().copied().filter(|e| {
            if e.tag == "nipples"
                && has(&[
                    "nipples through",
                    "taped nipples",
                    "clothed nipples",
                    "covered nipples",
                    "nipple outline",
                ])
            {
                return false;
            }
            if e.tag == "naked, nude" && has(&["naked apron", "naked shirt", "almost naked"]) {
                return false;
            }
            if e.tag == "see-through" && has(&["see-through breasts"]) {
                return false;
            }
            if (e.tag == "bare breasts" || e.tag == "no bra, bare breasts")
                && has(&["breasts out", "one breast out", "breast slip"])
            {
                return false;
            }
            true
        })
        .collect()
}

fn layer_name(l: u32) -> &'static str {
    match l {
        1 => "видимо",
        2 => "как",
        3 => "зачем",
        4 => "дорисовывает",
        // TS: LAYER_NAMES[l] === undefined → литерал «undefined» в шаблоне
        _ => "undefined",
    }
}

/// TECH_WET_RE / TECH_SHEER_RE (gates.ts:408): \b…\b, 1-в-1.
fn tech_wet(tb: &str) -> bool {
    ["wet clothes", "steam", "shower", "rain", "sweat"]
        .iter()
        .any(|w| contains_word(tb, w))
}

fn tech_sheer(tb: &str) -> bool {
    contains_word(tb, "see-through")
}

/// 8e. technique-layers (gates.ts:1430, warn, таблица автора): сумма
/// факторов, ловушки, супрессоры, мокрое+сквозное, X Cut hold.
pub fn gate_technique_layers(batch: &TextBatch, tech: Option<&RatingTechniques>) -> Receipt {
    let mut f = Vec::new();
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
        let raw_hits: Vec<&TechniqueEntry> = tech
            .techniques
            .iter()
            .filter(|e| tech_hit(&tb, &e.match_alts))
            .collect();
        let hits = dedupe_subsumed(&raw_hits);
        let ladder: Vec<&&TechniqueEntry> = hits.iter().filter(|e| is_ladder_signal(e)).collect();
        let mut layers_hit: Vec<u32> = ladder.iter().map(|e| e.layer).collect();
        layers_hit.sort_unstable();
        layers_hit.dedup();
        if tier == "R+" {
            // (1) сумма факторов
            let (floor_sig, floor_layers) = tech
                .sum_rules
                .rplus_floor
                .as_ref()
                .map(|f| (f.signals_min, f.layers_min))
                .unwrap_or((3, 2));
            if (ladder.len() as u32) < floor_sig || (layers_hit.len() as u32) < floor_layers {
                let map: Vec<String> = ladder
                    .iter()
                    .take(6)
                    .map(|e| e.tag.split(',').next().unwrap_or("").to_string())
                    .collect();
                let layers_str = if !layers_hit.is_empty() {
                    format!(
                        "({})",
                        layers_hit
                            .iter()
                            .map(|l| layer_name(*l).to_string())
                            .collect::<Vec<_>>()
                            .join("+")
                    )
                } else {
                    String::new()
                };
                f.push(format!(
                    "P{}: сумма факторов не набрана — {} сигнал(а) через {} слой(я) {}· блок 8: R+ = {}+ сигнала через {}+ слоя — это R/R+ граница, не R+ сумма; карта кадра: {}",
                    s.position,
                    ladder.len(),
                    layers_hit.len(),
                    layers_str,
                    floor_sig,
                    floor_layers,
                    if map.is_empty() { "—".to_string() } else { map.join(", ") }
                ));
            }
            // (2) ловушки
            for e in &hits {
                if e.trap {
                    f.push(format!(
                        "P{}: ловушка «{}» — {} (X-риск известен до рендера)",
                        s.position, e.tag, e.note
                    ));
                }
            }
            // (3) супрессоры
            for e in &hits {
                if e.suppressor {
                    f.push(format!(
                        "P{}: супрессор «{}» — держит кадр ниже заявленного, снимай или компенсируй (блок 4/7)",
                        s.position, e.tag
                    ));
                }
            }
            // (4) мокрое + сквозное — батч-уровень ниже
            if tech_wet(&tb) && tech_sheer(&tb) {
                wet_sheer_slots.push(format!("P{}", s.position));
            }
        }
        if tier == "X" {
            // (5) X Cut hold: кадрирование или закрытый низ
            let framing = tech
                .xcut_hold
                .framing
                .iter()
                .any(|t| tech_hit(&tb, std::slice::from_ref(&vec![t.clone()])));
            let covered = tech
                .xcut_hold
                .lower_cover
                .iter()
                .any(|t| tech_hit(&tb, std::slice::from_ref(&vec![t.clone()])));
            if !framing && !covered {
                let default_lower = ["skirt", "shorts"];
                let lower_list: Vec<&str> = if tech.xcut_hold.lower_cover.is_empty() {
                    default_lower.to_vec()
                } else {
                    tech.xcut_hold.lower_cover.iter().map(|x| x.as_str()).collect()
                };
                let framing_list: Vec<&str> = if tech.xcut_hold.framing.is_empty() {
                    vec!["upper body", "portrait"]
                } else {
                    tech.xcut_hold.framing.iter().map(|x| x.as_str()).collect()
                };
                f.push(format!(
                    "P{}: X Cut hold (блок 9) — низ тела ни закрыт ({}…), ни выведен из кадра ({}) — модель может «дорисовать» ниже",
                    s.position,
                    lower_list.iter().take(5).copied().collect::<Vec<_>>().join("/"),
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

/// 12. technique map (gates.ts:1846, advisory): карта слоёв — отчёт.
pub fn gate_technique_map(batch: &TextBatch, tech: Option<&RatingTechniques>) -> Receipt {
    let mut f = Vec::new();
    match tech {
        None => {
            f.push("техника-карта не загружена (specs/rating-techniques.json)".to_string());
        }
        Some(tech) => {
            for s in &batch.slots {
                let tier = tier_of(&s.meta);
                if tier != "R+" && tier != "X" {
                    continue;
                }
                let tb = tech_tag_block(&s.pos);
                let raw_hits: Vec<&TechniqueEntry> = tech
                    .techniques
                    .iter()
                    .filter(|e| tech_hit(&tb, &e.match_alts))
                    .collect();
                let hits = dedupe_subsumed(&raw_hits);
                let ladder: Vec<&&TechniqueEntry> =
                    hits.iter().filter(|e| is_ladder_signal(e)).collect();
                let mut layers_hit: Vec<u32> = ladder.iter().map(|e| e.layer).collect();
                layers_hit.sort_unstable();
                layers_hit.dedup();
                let map: Vec<String> = ladder
                    .iter()
                    .take(8)
                    .map(|e| e.tag.split(',').next().unwrap_or("").to_string())
                    .collect();
                let layers_str = if !layers_hit.is_empty() {
                    layers_hit
                        .iter()
                        .map(|l| format!("{l}·{}", layer_name(*l)))
                        .collect::<Vec<_>>()
                        .join(" + ")
                } else {
                    "—".to_string()
                };
                f.push(format!(
                    "P{:02} {}: {} сигнал(ов) · слои {} · {}",
                    s.position,
                    tier,
                    ladder.len(),
                    layers_str,
                    if map.is_empty() { "—".to_string() } else { map.join(", ") }
                ));
            }
            if f.is_empty() {
                f.push("R+/X слотов в батче нет".to_string());
            }
        }
    }
    advisory_receipt("technique-map", f)
}

/// 12b. salience-chain v2 (gates.ts:1873, warn — §9-секста + §9-септима):
/// 9 звеньев OBJECT→…→POSE-RISK; ≥2 порванных = тир под угрозой.
pub fn gate_salience_chain(batch: &TextBatch, contract: Option<&Contract>) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    const LIGHT_WORDS: [&str; 10] = [
        "white", "pale", "cream", "ivory", "pastel", "pink", "salt", "linen", "silver", "chalk",
    ];
    const GLOW_WORDS: [&str; 9] = [
        "glow",
        "spotlight",
        "backlit",
        "backlight",
        "rim light",
        "sunlit",
        "sunlight",
        "lit from",
        "flare",
    ];
    const DARK_SCENE: [&str; 10] = [
        "night",
        "noir",
        "midnight",
        "dark",
        "deep indigo",
        "black",
        "dusk",
        "shadow",
        "ultramarine deep",
        "eclipse",
    ];
    const CAMERA_TAGS: [&str; 16] = [
        "from below",
        "close-up",
        "closeup",
        "cowboy shot",
        "upper body",
        "portrait",
        "pov",
        "over-shoulder",
        "through-gap",
        "dutch angle",
        "from above",
        "wide shot",
        "foreshortening",
        "looking up",
        "looking down",
        "close on",
    ];
    const INTENT_TAGS: [&str; 16] = [
        "erotic pose",
        "extreme fanservice",
        "fanservice",
        "seductive",
        "seductive smile",
        "bedroom eyes",
        "half-closed eyes",
        "half-lidded",
        "parted lips",
        "teasing",
        "suggestive",
        "provocative",
        "come hither",
        "sultry",
        "looking at viewer",
        "eye contact",
    ];
    const UPPER_LIGHT: [&str; 37] = [
        "blouse",
        "tee",
        "t-shirt",
        "shirt",
        "knit",
        "cardigan",
        "leotard",
        "bodysuit",
        "swimsuit",
        "bikini",
        "romper",
        "slip",
        "dress",
        "sundress",
        "nightgown",
        "gown",
        "robe",
        "kimono",
        "yukata",
        "sheet",
        "towel",
        "halter",
        "tunic",
        "apron",
        "qipao",
        "cheongsam",
        "sweater",
        "gi",
        "nightshirt",
        "hoodie",
        "jersey",
        "pullover",
        "flannel",
        "turtleneck",
        "crop top",
        "tank top",
        "tube top",
    ];
    const UPPER_LIGHT_TAIL: [&str; 5] = ["wrap top", "fishnet top", "bodystocking", "top", "halter top"];
    const LOWER_LIGHT_SAL: [&str; 10] = [
        "skirt",
        "shorts",
        "pants",
        "trousers",
        "leggings",
        "tights",
        "pantyhose",
        "sarong",
        "wrap",
        "boyshorts",
    ];
    const X_SIGNALS: [&str; 6] = [
        "topless",
        "bare breasts",
        "exposed breasts",
        "nsfw",
        "nude",
        "naked",
    ];
    const POSE_VERBS: [&str; 36] = [
        "standing", "kneel", "sitting", "leaning", "climb", "slide", "stretch", "arch", "bend",
        "turn", "twirl", "float", "stride", "spiral", "hang", "curl", "lean", "reach", "prone",
        "crouch", "drape", "sprawl", "recline", "straddl", "waltz", "handstand", "cartwheel",
        "pli", "sprint", "jump", "bounce", "balance", "extend", "lock", "draw", "halt",
    ];
    const LOWER_COVERS_SC: [&str; 13] = [
        "skirt",
        "dress",
        "cloak",
        "cape",
        "coat",
        "apron",
        "tied at waist",
        "tied at the waist",
        "shirt tied",
        "waist wrap",
        "sarong",
        "long shirt",
        "peplum",
    ];
    const CHEST_COVERS_SC: [&str; 9] = [
        "buttoned shirt",
        "buttoned-up",
        "buttoned up",
        "zipped up",
        "closed jacket",
        "buttoned jacket",
        "turtleneck",
        "high-neck",
        "closed coat",
    ];
    let body_word = |t: &str| {
        ["hair", "skin", "eyes", "stocking", "sock", "thighhigh", "pantyhose", "scales", "ears", "tail", "horn", "freckle", "cheek"]
            .iter()
            .any(|w| t.contains(w))
    };
    const BLOCKERS_SC: [&str; 10] = [
        "crossed arms",
        "arms crossed",
        "crossed shawl",
        "shawl crossed",
        "scarf crossed",
        "crossed scarf",
        "crossed over her chest",
        "arms over her chest",
        "arms over chest",
        "shawl over her chest",
    ];
    const CLOSE_CAM: [&str; 7] = [
        "close-up",
        "closeup",
        "cowboy shot",
        "portrait",
        "pov",
        "upper body",
        "close on",
    ];
    let mut upper_light_all: Vec<&str> = Vec::new();
    for g in UPPER_LIGHT.iter().chain(UPPER_LIGHT_TAIL.iter()) {
        upper_light_all.push(g);
    }
    let mut pose_risk_by_pos: std::collections::HashMap<u32, String> = Default::default();
    if let Some(c) = contract {
        for cs in &c.slots {
            pose_risk_by_pos.insert(cs.position, cs.pose_risk.clone());
        }
    }
    let mut at_risk = 0usize;
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier != "R+" && tier != "X" {
            continue;
        }
        let first_period = s.pos.find('.');
        let tag_block = match first_period {
            Some(i) if i > 0 => s.pos[..i].to_lowercase(),
            _ => s.pos.to_lowercase(),
        };
        let pos_lower = s.pos.to_lowercase();
        let spine_lower = s.spine.to_lowercase();
        let tags: Vec<String> = tag_block.split(',').map(|t| t.trim().to_string()).collect();
        let is_x = tier == "X";
        // OBJECT
        let upper_claim = [
            "nipples through clothing",
            "clothed nipples",
            "see-through",
            "taped nipples",
            "topless with tape",
            "handbra",
        ]
        .iter()
        .find(|c| tag_block.contains(**c))
        .copied();
        let lower_claim = ["visible pantyline", "pantyline"]
            .iter()
            .find(|c| tag_block.contains(**c))
            .copied();
        let x_claim = X_SIGNALS.iter().find(|c| tag_block.contains(**c)).copied();
        let garment_tag = tags.iter().find(|t| {
            upper_light_all.iter().any(|g| contains_word(t, g))
                || LOWER_LIGHT_SAL.iter().any(|g| contains_word(t, g))
        });
        let on_skin = upper_claim == Some("taped nipples")
            || upper_claim == Some("topless with tape")
            || upper_claim == Some("handbra");
        let obj_ok = if is_x {
            x_claim.is_some()
        } else {
            (upper_claim.is_some() || lower_claim.is_some()) && (on_skin || garment_tag.is_some())
        };
        // EXPOSURE
        let cover_lower = if lower_claim.is_some() {
            LOWER_COVERS_SC.iter().find(|c| tag_block.contains(*c)).copied()
        } else {
            None
        };
        let cover_chest = if on_skin {
            CHEST_COVERS_SC.iter().find(|c| tag_block.contains(*c)).copied()
        } else {
            None
        };
        let exp_ok = cover_lower.is_none() && cover_chest.is_none();
        let exp_unclear = if !exp_ok {
            false
        } else if garment_tag.is_some() {
            tags.iter().filter(|t| ["shirt", "cardigan", "jacket", "robe", "kimono"].iter().any(|w| t.contains(w))).count() >= 2
        } else {
            false
        };
        // CAMERA
        let cam_tag = CAMERA_TAGS.iter().find(|c| tag_block.contains(**c)).copied();
        let cam_ok = cam_tag.is_some()
            || POSE_VERBS.iter().any(|v| tag_block.contains(v))
            || POSE_VERBS.iter().any(|v| spine_lower.contains(v));
        // CONTRAST
        let garment_light = garment_tag
            .map(|gt| LIGHT_WORDS.iter().any(|w| gt.contains(w)))
            .unwrap_or(false);
        let scene_glow = GLOW_WORDS.iter().any(|w| tag_block.contains(w));
        let dark_scene = DARK_SCENE.iter().any(|w| tag_block.contains(w));
        let bg_light_count = tags
            .iter()
            .filter(|t| {
                garment_tag.is_none_or(|g| g.as_str() != t.as_str())
                    && !body_word(t)
                    && LIGHT_WORDS.iter().any(|w| t.contains(w))
            })
            .count();
        let wet = tag_block.contains("wet clothes");
        let mut con_ok = false;
        let mut con_unclear = false;
        let mut con_why = String::new();
        if wet && dark_scene && !garment_light && !scene_glow {
            con_why = "мокрая тёмная ткань без света — пятно-риск".to_string();
        } else if garment_light && bg_light_count >= 2 {
            con_why = "светлое на светлом — слияние с фоном".to_string();
        } else if garment_light || scene_glow || is_x {
            con_ok = true;
        } else {
            con_unclear = true;
            con_why = "нет ни светлой вещи, ни света на зоне".to_string();
        }
        // SALIENCE
        let limit = if is_x {
            20usize
        } else if s.genre == "OC" {
            22
        } else {
            16
        };
        let mut claim_candidates: Vec<usize> = Vec::new();
        for c in [
            upper_claim,
            lower_claim,
            x_claim,
            if tag_block.contains("wet clothes") { Some("wet clothes") } else { None },
            if tag_block.contains("see-through") { Some("see-through") } else { None },
        ]
        .into_iter()
        .flatten()
        {
            if let Some(i) = tags.iter().position(|t| t.contains(c)) {
                claim_candidates.push(i);
            }
        }
        let claim_idx = claim_candidates.iter().min().copied().unwrap_or(99);
        let sal_ok = claim_idx < limit;
        // INTERPRETATION
        let intent = INTENT_TAGS
            .iter()
            .find(|c| tag_block.contains(**c) || pos_lower.contains(**c))
            .copied();
        let int_ok = if is_x { x_claim.is_some() } else { intent.is_some() };
        // BLOCKER
        let blocker_hit = BLOCKERS_SC.iter().find(|c| pos_lower.contains(**c)).copied();
        let blk_ok = blocker_hit.is_none();
        // LEGIBILITY
        let close_cam = CLOSE_CAM.iter().find(|c| tag_block.contains(**c)).copied();
        let leg_ok = close_cam.is_some() || (con_ok && (garment_light || scene_glow));
        // POSE-RISK
        let pose_risk = pose_risk_by_pos.get(&s.position).cloned().unwrap_or_default();
        let pr_ok = pose_risk != "HIGH";
        let marks = [obj_ok, exp_ok, cam_ok, con_ok, sal_ok, int_ok, blk_ok, leg_ok, pr_ok];
        let broken = marks.iter().filter(|x| !**x).count();
        if broken >= 2 {
            at_risk += 1;
        }
        let mark = |ok: bool, unclear: bool| -> &'static str {
            if ok {
                "✓"
            } else if unclear {
                "?"
            } else {
                "✗"
            }
        };
        let obj_extra = if obj_ok && garment_tag.is_some() && !is_x {
            let gt = garment_tag.unwrap();
            let last = gt.split(' ').next_back().unwrap_or("");
            format!(" ({last})")
        } else if obj_ok && is_x && x_claim.is_some() {
            format!(" ({})", x_claim.unwrap())
        } else {
            String::new()
        };
        let exp_extra = if !exp_ok && (cover_lower.is_some() || cover_chest.is_some()) {
            let c = cover_lower.or(cover_chest).unwrap();
            format!(" (закрыта «{c}»)")
        } else {
            String::new()
        };
        let cam_extra = if cam_tag.is_some() {
            format!(" ({})", cam_tag.unwrap())
        } else {
            " (поза)".to_string()
        };
        let con_extra = if !con_ok {
            format!(" — {con_why}")
        } else {
            String::new()
        };
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
        let blk_extra = if !blk_ok {
            format!(" («{}» — the frame's one closed door, P21)", blocker_hit.unwrap())
        } else {
            String::new()
        };
        let leg_extra = if close_cam.is_some() {
            format!(" ({})", close_cam.unwrap())
        } else if leg_ok {
            " (свет на зоне)".to_string()
        } else {
            " (дистанция кадра)".to_string()
        };
        let pr_extra = if !pose_risk.is_empty() {
            format!(" ({pose_risk})")
        } else {
            String::new()
        };
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
            mark(obj_ok, false), obj_extra,
            mark(exp_ok, exp_unclear), exp_extra,
            mark(cam_ok, false), cam_extra,
            mark(con_ok, con_unclear), con_extra,
            mark(sal_ok, false), sal_extra,
            mark(int_ok, false), int_extra,
            mark(blk_ok, false), blk_extra,
            mark(leg_ok, false), leg_extra,
            mark(pr_ok, false), pr_extra,
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
/* Этап 1-в — гейты 17-30 (ab · simcheck · fidelity · bumps · raw-plus) */
/* ================================================================== */

/// 9b. ab-single-variable (gates.ts:1633, warn, Залп 2 «Рефлекс»): A/B-пара
/// отличается ровно одной заменой носителя (policy.ab.one_variable).
pub fn gate_ab_single_variable(contract: Option<&Contract>) -> Receipt {
    let mut f = Vec::new();
    let Some(c) = contract else {
        f.push("контракт без A/B-пар — дисциплина §10 не атрибутируема".to_string());
        return warn_receipt("ab-single-variable", f);
    };
    if c.ab_pairs.is_empty() {
        f.push("контракт без A/B-пар — дисциплина §10 не атрибутируема".to_string());
    }
    for p in &c.ab_pairs {
        let sa = c.slots.iter().find(|s| s.position == p.a);
        let sb = c.slots.iter().find(|s| s.position == p.b);
        let (Some(sa), Some(sb)) = (sa, sb) else {
            f.push(format!("пара {}: слоты не читаются из контракта", p.pair));
            continue;
        };
        let xi: std::collections::HashSet<&String> = sa.carriers.iter().collect();
        let yi: std::collections::HashSet<&String> = sb.carriers.iter().collect();
        let d = xi.iter().filter(|id| !yi.contains(**id)).count()
            + yi.iter().filter(|id| !xi.contains(**id)).count();
        if d > 2 {
            f.push(format!(
                "пара {} ({}): {} отличий стека — больше одной замены носителя (policy.ab.one_variable, аудит I-4)",
                p.pair, p.lead, d
            ));
        }
    }
    warn_receipt("ab-single-variable", f)
}

/// 9. simcheck (gates.ts:1746, warn): внутри-батчевые близнецы (J>0.75) +
/// окно ротации (J>0.7); rebuildOf-исключение двустороннее.
pub fn gate_simcheck(batch: &TextBatch, contract: Option<&Contract>, st: &ChronState) -> Receipt {
    let mut f = Vec::new();
    let mut mine: Vec<(u32, String)> = Vec::new();
    for s in &batch.slots {
        for sent in sim_sentences(&s.pos) {
            mine.push((s.position, sent));
        }
    }
    // mySentences: Set текстов (вставной порядок)
    let mut my_texts: Vec<String> = Vec::new();
    for (_, t) in &mine {
        if !my_texts.contains(t) {
            my_texts.push(t.clone());
        }
    }
    // внутри-батчевые близнецы
    let mut intra: Vec<String> = Vec::new();
    for i in 0..mine.len() {
        for j in (i + 1)..mine.len() {
            let a = sim_words(&mine[i].1);
            let b = sim_words(&mine[j].1);
            let inter = a.intersection(&b).count();
            let union = a.len() + b.len() - inter;
            if union > 0 && j_gt(inter, union, 75, 100) {
                let head: String = mine[i].1.chars().take(60).collect();
                intra.push(format!(
                    "P{}≈P{}: «{head}…» (J={})",
                    mine[i].0,
                    mine[j].0,
                    js_fixed2(inter, union)
                ));
            }
        }
    }
    if !intra.is_empty() {
        let shown: Vec<String> = intra.iter().take(4).cloned().collect();
        let more = if intra.len() > 4 {
            format!(" — и ещё {}", intra.len() - 4)
        } else {
            String::new()
        };
        f.push(format!("внутри-батчевые близнецы: {}{}", shown.join(" · "), more));
    }
    // окно ротации
    let window = historical_window_for(&batch.slug, st);
    let others = window_others_for(
        &batch.slug,
        &window,
        contract.and_then(|c| c.rebuild_of.as_deref()),
    );
    for w in &others {
        let Some(wtext) = read_text(&batches_dir().join(format!("{w}.md"))) else {
            continue;
        };
        let wbatch = parse_batch(w, &wtext);
        let mut w_sentences: Vec<String> = Vec::new();
        for s in &wbatch.slots {
            for sent in sim_sentences(&s.pos) {
                w_sentences.push(sent);
            }
        }
        for ms in &my_texts {
            let a = sim_words(ms);
            for theirs in &w_sentences {
                let b = sim_words(theirs);
                let inter = a.intersection(&b).count();
                let union = a.len() + b.len() - inter;
                if union > 0 && j_gt(inter, union, 7, 10) {
                    let head: String = ms.chars().take(60).collect();
                    f.push(format!("похоже на {w}: «{head}…» (J={})", js_fixed2(inter, union)));
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

/* --- contract-fidelity (gates.ts:233-335, ревизия 2026-10-14) -------- */

/// kinTokensOf (gates.ts:238): кин-токены расы (имя/синонимы/фичи).
fn kin_tokens_of(race_name: &str, races: &[RaceEntry]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let name = race_name.trim();
    if name.is_empty() {
        return out;
    }
    // core: \s*\(.*?\)\s* → ''
    let mut core = String::new();
    let mut depth = false;
    let mut chars = name.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '(' {
            depth = true;
            // \s* перед скобкой уже в core — убрать хвостовые пробелы
            while core.ends_with(' ') {
                core.pop();
            }
            continue;
        }
        if c == ')' {
            depth = false;
            continue;
        }
        if !depth {
            core.push(c);
        }
    }
    let core = core.trim().to_string();
    // paren: /\((.*?)\)/ первое вхождение
    let paren: String = {
        let start = name.find('(');
        let end = name.find(')');
        match (start, end) {
            (Some(a), Some(b)) if b > a => name[a + 1..b].to_string(),
            _ => String::new(),
        }
    };
    // push: lower → /-?\s*kin/g → '' → trim (strip_kin_pattern — честный
    // скан '-?\s*kin' вместе с префиксом)
    let push = |s_raw: &str, out: &mut Vec<String>| {
        let s = strip_kin_pattern(s_raw);
        let s = s.trim().to_string();
        if !s.is_empty() && s != "human" && s.chars().count() >= 3 {
            if !out.contains(&s) {
                out.push(s.clone());
            }
            let g = format!("{s} girl");
            if !out.contains(&g) {
                out.push(g);
            }
        }
    };
    push(&core, &mut out);
    for p in paren.split(|c| c == ',' || c == '/') {
        push(p.trim(), &mut out);
    }
    let spec = races.iter().find(|r| r.name.to_lowercase() == core.to_lowercase());
    for feat in spec.map(|s| s.features.clone()).unwrap_or_default() {
        let head = feat.to_lowercase().split(" — ").next().unwrap_or("").trim().to_string();
        if head.is_empty()
            || head.contains("sol")
            || head.contains("lock")
            || head.contains("forbid")
        {
            continue;
        }
        if !out.contains(&head) {
            out.push(head.clone());
        }
        if let Some(first) = head.split_whitespace().next() {
            if !out.iter().any(|x| x == first) {
                out.push(first.to_string());
            }
        }
    }
    out.retain(|s| s != "human");
    out
}

/// /-?\s*kin/g → '' (kinTokensOf): снять '-kin' / ' kin' / 'kin'.
fn strip_kin_pattern(s_raw: &str) -> String {
    let s = s_raw.to_lowercase();
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < b.len() {
        // ищем 'kin' начиная с i, но матч стартует на '-' или \s* перед ним
        if let Some(rel) = s[i..].find("kin") {
            let kpos = i + rel;
            // граница матча: идём влево от kpos по \s*, затем опционально '-'
            let mut start = kpos;
            while start > i && b[start - 1] == b' ' {
                start -= 1;
            }
            if start > i && b[start - 1] == b'-' {
                start -= 1;
            }
            out.push_str(&s[i..start]);
            i = kpos + 3;
        } else {
            out.push_str(&s[i..]);
            break;
        }
    }
    out
}

/// contractFidelity (gates.ts:275): сверка батча с контрактом по осям.
pub fn contract_fidelity(contract: &Contract, batch: &TextBatch, races: &[RaceEntry]) -> Vec<String> {
    let mut f = Vec::new();
    for cs in &contract.slots {
        let label = format!("P{:02}", cs.position);
        let Some(bs) = batch.slots.iter().find(|s| s.position == cs.position) else {
            f.push(format!("{label}: слот контракта отсутствует в батче"));
            continue;
        };
        let meta = &bs.meta;
        // свободные регексы отображения (gates.ts:293/301): /PL\d+/ и
        // /P\d{1,3}_[A-Z_]+/ БЕЗ границ слов (это не поиск, а подпись —
        // «какой позы/палитры машина нашла в шапке»)
        let shown_pose = |m: &str| -> String {
            let b = m.as_bytes();
            let mut i = 0usize;
            while i + 3 <= b.len() {
                if b[i] == b'P' && b[i + 1] == b'L' && b[i + 2].is_ascii_digit() {
                    let mut j = i + 2;
                    while j < b.len() && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    return m[i..j].to_string();
                }
                i += 1;
            }
            "—".to_string()
        };
        let shown_pal = |m: &str| -> String {
            let chars: Vec<(usize, char)> = m.char_indices().collect();
            for idx in 0..chars.len() {
                let (bp, ch) = chars[idx];
                if ch != 'P' {
                    continue;
                }
                let mut j = idx + 1;
                let mut digits = 0usize;
                while digits < 3 && j < chars.len() && chars[j].1.is_ascii_digit() {
                    j += 1;
                    digits += 1;
                }
                if digits == 0 || j >= chars.len() || chars[j].1 != '_' {
                    continue;
                }
                j += 1;
                let start = j;
                while j < chars.len() && (chars[j].1.is_ascii_uppercase() || chars[j].1 == '_') {
                    j += 1;
                }
                if j > start {
                    let end = chars.get(j).map(|(b, _)| *b).unwrap_or(m.len());
                    return m[bp..end].to_string();
                }
            }
            "—".to_string()
        };
        if !cs.pose.is_empty() && !contains_word(meta, &cs.pose) {
            let pl = shown_pose(meta);
            f.push(format!(
                "{label}: поза контракта {} ≠ шапки батча ({}) — кино-сдвиг (класс T4-30), вернуть позу из Spine",
                cs.pose, pl
            ));
        }
        if !cs.palette.is_empty() && !contains_word(meta, &cs.palette) {
            let pal = shown_pal(meta);
            f.push(format!(
                "{label}: палитра контракта {} ≠ шапки ({})",
                cs.palette, pal
            ));
        }
        if !cs.rating.is_empty() && cs.rating != tier_of(meta) {
            let t = tier_of(meta);
            let shown = if t.is_empty() { "—" } else { t };
            f.push(format!("{label}: рейтинг контракта {} ≠ шапки {}", cs.rating, shown));
        }
        if let Some(oc) = &cs.oc {
            if !oc.is_empty() && !meta.to_lowercase().contains(&oc.to_lowercase()) {
                f.push(format!("{label}: OC контракта {oc} не назван в шапке слота"));
            }
        }
        if let Some(race) = &cs.race {
            if !race.is_empty() {
                let tokens = kin_tokens_of(race, races);
                let pos_lower = bs.pos.to_lowercase().replace('_', " ");
                if !tokens.is_empty() && !tokens.iter().any(|t| pos_lower.contains(t.as_str())) {
                    let shown: Vec<String> = tokens.iter().take(4).cloned().collect();
                    f.push(format!(
                        "{label}: раса «{}» не работает в кадре — POS не несёт ни одного её токена ({}) — закон №3: раса делает ФИЗИЧЕСКУЮ работу, не тег-бижутерию",
                        race,
                        shown.join(", ")
                    ));
                }
            }
        }
        let stack_c: Vec<&String> = cs.carriers.iter().filter(|id| !id.is_empty()).collect();
        if !stack_c.is_empty() {
            let miss: Vec<&String> = stack_c
                .iter()
                .copied()
                .filter(|id| !bs.stack.contains(id))
                .collect();
            let extra: Vec<&String> = bs.stack.iter().filter(|id| !stack_c.contains(id)).collect();
            if !miss.is_empty() || !extra.is_empty() {
                let miss_s = if miss.is_empty() {
                    String::new()
                } else {
                    format!(
                        " — потеряно: {}",
                        miss.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                    )
                };
                let extra_s = if extra.is_empty() {
                    String::new()
                } else {
                    format!(
                        " — лишнее: {}",
                        extra.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                    )
                };
                f.push(format!(
                    "{label}: стек контракта [{}] ≠ Stack: [{}]{}{}",
                    stack_c.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" + "),
                    bs.stack.join(" + "),
                    miss_s,
                    extra_s
                ));
            }
        }
    }
    f
}

/// 26. contract-fidelity (gates.ts:2310, warn): WARN — верность контракту.
pub fn gate_contract_fidelity(
    batch: &TextBatch,
    contract: Option<&Contract>,
    races: &[RaceEntry],
) -> Receipt {
    let mut findings = Vec::new();
    let mut notes = Vec::new();
    match contract {
        Some(c) => {
            findings = contract_fidelity(c, batch, races);
        }
        None => {
            notes.push(
                "контракта нет — RAW/ручная сборка: верность контракту не проверяема".to_string(),
            );
        }
    }
    Receipt {
        gate: "contract-fidelity",
        level: "warn",
        verdict: if findings.is_empty() { "PASS" } else { "WARN" },
        findings,
        notes,
    }
}

/// 29. bumps-квота G17 (gates.ts:2417, warn): bumps ≥ 40% R+-дресс-слотов
/// (только при ≥5; RAW/ручной без контракта — не судим).
pub fn gate_bumps_quota(contract: Option<&Contract>) -> Receipt {
    let mut f = Vec::new();
    if let Some(c) = contract {
        let rplus_dressed: Vec<&ContractSlot> = c
            .slots
            .iter()
            .filter(|cs| cs.rating == "R+" && cs.kind != "EXP" && cs.dress_channel.is_some())
            .collect();
        let bumps_n = rplus_dressed
            .iter()
            .filter(|cs| cs.dress_channel.as_deref() == Some("bumps"))
            .count();
        if rplus_dressed.len() >= 5 {
            let pct = ((bumps_n as f64) / (rplus_dressed.len() as f64) * 100.0 + 0.5).floor() as u64;
            if (bumps_n as f64) / (rplus_dressed.len() as f64) < 0.4 {
                f.push(format!(
                    "bumps-канал {bumps_n} из {} R+-дресс-слотов ({pct}%) < 40% — самый живой через-ткань сигнал недопредставлен (G17, №52-бэклог): канал бугорков должен получать ⌈0.4×R+⌉ слотов (генератор уже строит dark-минимум под квоту — пересобери контракт)",
                    rplus_dressed.len()
                ));
            }
        }
    }
    warn_receipt("bumps-quota", f)
}

/* --- 13. raw-plus (gates.ts:2030, hard, условный) -------------------- */

const RP_LIGHT_WORDS: [&str; 20] = [
    "light", "glow", "sun", "moon", "star", "neon", "spot", "backlit", "rim", "dawn", "dusk",
    "beam", "halo", "luminous", "caustic", "floodlight", "shimmer", "glare", "flare", "glint",
];

const RP_NEG_BAN: [&str; 15] = [
    "visible pantyline",
    "topless",
    "exposed breasts",
    "naked",
    "nude",
    "bare breasts",
    "nsfw",
    "nipples through clothing",
    "clothed nipples",
    "extreme fanservice",
    "exposed genitals",
    "vulva",
    "pubic hair",
    "sex",
    "sexual act",
];

const RP_DARK_TONE: [&str; 33] = [
    "black", "ink", "midnight", "charcoal", "espresso", "dark navy", "deep navy", "oxblood",
    "void", "sumi", "burgundy", "wine", "maroon", "plum", "chocolate", "cocoa", "aubergine",
    "obsidian", "onyx", "raven", "soot", "sable", "dark red", "deep red", "dark green",
    "deep green", "forest green", "dark brown", "deep brown", "dark teal", "dark purple",
    "dark violet", "dark crimson",
];

const RP_LIGHT_FAMILY: [&str; 39] = [
    "white", "ash", "cream", "ivory", "pale", "pastel", "linen", "chalk", "silver", "grey",
    "gray", "moss", "umber", "prussian", "rose", "blush", "sand", "wheat", "oat", "pearl",
    "fog", "rain", "salt", "smoke", "slate", "dove", "butter", "peach", "coral", "salmon",
    "mint", "powder", "beige", "ecru", "champagne", "tan", "lemon", "lilac", "lavender",
];

const RP_GARMENT: [&str; 41] = [
    "blouse", "tee", "t-shirt", "shirt", "knit", "cardigan", "leotard", "bodysuit", "swimsuit",
    "bikini", "romper", "slip", "dress", "sundress", "nightgown", "gown", "robe", "kimono",
    "yukata", "sheet", "towel", "halter", "tunic", "apron", "qipao", "cheongsam", "sweater",
    "gi", "nightshirt", "hoodie", "jersey", "pullover", "flannel", "turtleneck", "crop top",
    "tank top", "tube top", "wrap top", "fishnet top", "bodystocking", "top",
];

const RP_TITLE_STOP: [&str; 12] = [
    "the", "a", "an", "of", "on", "in", "and", "or", "to", "no", "is", "for",
];

/// №23: точки-концы предложений (десятичные не считаются).
fn sentence_dots(pos: &str) -> usize {
    let b = pos.as_bytes();
    let mut n = 0usize;
    for (i, &c) in b.iter().enumerate() {
        if c != b'.' {
            continue;
        }
        let prev_digit = i > 0 && b[i - 1].is_ascii_digit();
        let next_digit = i + 1 < b.len() && b[i + 1].is_ascii_digit();
        if !prev_digit && !next_digit {
            n += 1;
        }
    }
    n
}

/// /\blight\b[^,.\n]{0,40}\bchest\b/i — «light on chest» окном до 40.
fn light_on_chest(pos: &str) -> bool {
    let low = pos.to_lowercase();
    let b = low.as_bytes();
    let mut i = 0usize;
    while let Some(rel) = low[i..].find("light") {
        let s = i + rel;
        let e = s + "light".len();
        let left_ok = s == 0 || !low[..s].chars().next_back().is_some_and(ascii_word);
        if left_ok {
            // \bchest\b на дистанции 0..40 символов [^,.\n]
            let mut j = e;
            let mut dist = 0usize;
            let mut matched = false;
            while j < b.len() && dist <= 40 {
                let c = b[j] as char;
                if c == ',' || c == '.' || c == '\n' {
                    break;
                }
                if low[j..].starts_with("chest") {
                    let before_ok = j == e || {
                        // между light и chest уже есть ≥0 символов; \b перед chest:
                        let prev = low[j - 1..].chars().next().unwrap();
                        !prev.is_ascii_alphanumeric() && prev != '_'
                    };
                    let after = j + "chest".len();
                    let after_ok =
                        after >= low.len() || !low[after..].chars().next().is_some_and(ascii_word);
                    if before_ok && after_ok {
                        matched = true;
                        break;
                    }
                }
                if c == ' ' || c.is_ascii_alphanumeric() || !ascii_word(c) {
                    j += 1;
                    dist += 1;
                } else {
                    j += 1;
                    dist += 1;
                }
            }
            if matched {
                return true;
            }
        }
        i = s + 1;
    }
    false
}

/// #h1: /#\\s*T4-[^\\n]*RAW\\+/m — маркер RAW+ в H1.
fn h1_raw_plus_marker(text: &str) -> bool {
    for line in text.lines() {
        let Some(rest) = line.strip_prefix('#') else { continue };
        let rest = rest.trim_start_matches(|c: char| c.is_whitespace());
        if let Some(after) = rest.strip_prefix("T4-") {
            if after.contains("RAW+") {
                return true;
            }
        }
    }
    false
}

/// #h1: /#\\s*[^\\n]*?["«]([^"»\\n]+)["»]/m — тайтл темы (первая строка).
fn h1_theme_title(text: &str) -> String {
    for line in text.lines() {
        let Some(rest) = line.strip_prefix('#') else { continue };
        let rest = rest.trim_start_matches(|c: char| c.is_whitespace());
        // ленивый [^\n]*? до открывающей кавычки; скан ПО СИМВОЛАМ
        // (байт-скан ловил продолжающий байт '»' как отдельный «символ»)
        let chars: Vec<(usize, char)> = rest.char_indices().collect();
        let mut open: Option<usize> = None;
        for (bp, ch) in &chars {
            if *ch == '"' || *ch == '«' {
                open = Some(*bp);
                break;
            }
        }
        if let Some(oi) = open {
            let open_len = rest[oi..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
            for (bp, ch) in &chars {
                if *bp <= oi {
                    continue;
                }
                if *ch == '"' || *ch == '»' {
                    return rest[oi + open_len..*bp].trim().to_string();
                }
            }
        }
    }
    String::new()
}

/// /[a-zа-яё0-9']+/g на нижнем регистре тайтла.
fn title_words(theme_title: &str) -> Vec<String> {
    let low = theme_title.to_lowercase();
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in low.chars() {
        let ok = c.is_ascii_lowercase()
            || c.is_ascii_digit()
            || c == '\''
            || ('а'..='я').contains(&c)
            || c == 'ё';
        if ok {
            cur.push(c);
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn normalize_pos_words(pos: &str) -> String {
    let low = pos.to_lowercase();
    let mut out = String::with_capacity(low.len());
    let mut last_sep = false;
    for c in low.chars() {
        let ok = c.is_ascii_lowercase()
            || c.is_ascii_digit()
            || c == '\''
            || ('а'..='я').contains(&c)
            || c == 'ё';
        if ok {
            out.push(c);
            last_sep = false;
        } else if !last_sep {
            out.push(' ');
            last_sep = true;
        }
    }
    out.trim().to_string()
}

/// 13. raw-plus (gates.ts:2030, hard, условный — маркер RAW+ в H1 или
/// engine контракта): Danbooru-скелет + PH-наработки, БЕЗ прозы.
pub fn gate_raw_plus(batch: &TextBatch, contract: Option<&Contract>) -> Vec<Receipt> {
    let raw_plus_marker = h1_raw_plus_marker(&batch.text);
    let engine_raw = contract
        .and_then(|c| c.engine.clone())
        .map(|e| e.to_lowercase().contains("raw-plus"))
        .unwrap_or(false);
    if !raw_plus_marker && !engine_raw {
        return Vec::new();
    }
    let Some(c) = contract else {
        // TS: rp = readJson(...) — контракта нет → rp null → abPairs/palette
        // пустые, гейт гоняется по слотам (палитра не назначена и т.д.)
        return gate_raw_plus_body(batch, &Contract::default());
    };
    gate_raw_plus_body(batch, c)
}

fn gate_raw_plus_body(batch: &TextBatch, rp: &Contract) -> Vec<Receipt> {
    let mut out = Vec::new();
    // наследование палитры B-половинкой (abPairs: b → a)
    let mut inherits_from: std::collections::HashMap<u32, u32> = Default::default();
    for p in &rp.ab_pairs {
        inherits_from.insert(p.b, p.a);
    }
    let mut palette_by_pos: std::collections::HashMap<u32, String> = Default::default();
    for s in &rp.slots {
        if !s.palette.is_empty() {
            palette_by_pos.insert(s.position, s.palette.clone());
        }
    }
    let resolve_palette = |pos: u32, header: &str| -> String {
        if let Some(own) = extract_palette_id(header) {
            return own;
        }
        match inherits_from.get(&pos) {
            Some(donor) => palette_by_pos.get(donor).cloned().unwrap_or_default(),
            None => String::new(),
        }
    };
    let mut f: Vec<String> = Vec::new();
    let mut expl: Vec<String> = Vec::new();
    let mut pal_count: Vec<(String, u32)> = Vec::new();
    let theme_title = h1_theme_title(&batch.text);
    let title_ws = title_words(&theme_title);
    let theme_kw_line = batch
        .text
        .lines()
        .find(|l| l.starts_with("ТЕМА-СЛОВА:"))
        .unwrap_or("");
    let theme_kw_set: std::collections::HashSet<String> = theme_kw_line
        .strip_prefix("ТЕМА-СЛОВА:")
        .unwrap_or("")
        .trim_start()
        .split(',')
        .map(|w| w.trim().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();
    let mut light_carrying_tops: Vec<u32> = Vec::new();
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
        if pal.is_empty() {
            slot_f.push("палитра не назначена (нет в шапке, нет наследования по abPairs — specs/raw-plus.json, закон №23)".to_string());
        }
        if !s.pos.to_lowercase().contains("stylized 2d anime face") {
            slot_f.push("нет face-блока (stylized 2D anime face — M17, приказ «концепция аниме-лиц»)".to_string());
        }
        if !contains_word_ci(&s.pos, "small nose") || !contains_word_ci(&s.pos, "small mouth") {
            slot_f.push("face-блок неполный (anime eyes (цвет), small nose, small mouth — M17)".to_string());
        }
        if !RP_LIGHT_WORDS.iter().any(|w| s.pos.to_lowercase().contains(w)) {
            slot_f.push("нет света-на-зоне: ни одного светового слова в POS (закон №21 — X-граница плоской натяжки, «блеклость»)".to_string());
        }
        let pos_low = s.pos.to_lowercase();
        if !pos_low.contains("masterpiece")
            || !pos_low.contains("best quality")
            || !pos_low.contains("anime artstyle")
        {
            slot_f.push("нет финальных квалити-тегов (masterpiece, best quality, anime artstyle)".to_string());
        }
        let neg_low = s.neg.to_lowercase();
        if !neg_low.contains("washed-out")
            || !neg_low.contains("faded colors")
            || !neg_low.contains("low contrast")
        {
            slot_f.push("нет ANTI-WASH в NEG (washed-out, faded colors, low contrast — Five Locks)".to_string());
        }
        let period_count = sentence_dots(&s.pos);
        if period_count > 1 {
            slot_f.push(format!(
                "проза в POS: точек {period_count} > 1 — только финальная (закон №23: теги, БЕЗ прозы)"
            ));
        }
        if s.pos.chars().any(|c| matches!(c, '"' | '\u{201C}' | '\u{201D}' | '«' | '»')) {
            slot_f.push("диалог/кавычки в POS — проза запрещена (закон №23)".to_string());
        }
        if pos_low.contains("is rendered in") {
            slot_f.push(
                "PH face-lock проза в POS («is rendered in…») — RAW+ пишет face-блок тегом (закон №23)".to_string(),
            );
        }
        if contains_word_ci(&s.pos, "she") {
            slot_f.push(
                "прозовое местоимение «she» в POS — теги несут существительные (закон №23)".to_string(),
            );
        }
        // закон №26: тайтл темы не в POS
        if !title_ws.is_empty() {
            let pos_n = normalize_pos_words(&s.pos);
            let full = title_ws.join(" ");
            let mut title_hit = String::new();
            if title_ws.len() >= 2 && pos_n.contains(&full) {
                title_hit = theme_title.clone();
            } else {
                if title_ws.len() >= 3 {
                    for i in 0..=(title_ws.len() - 3) {
                        let run = &title_ws[i..i + 3];
                        let content = run.iter().filter(|w| !RP_TITLE_STOP.contains(&w.as_str())).count();
                        if content < 2 {
                            continue;
                        }
                        let joined = run.join(" ");
                        if pos_n.contains(&joined) {
                            title_hit = format!("…{joined}…");
                            break;
                        }
                    }
                }
                let title_content: Vec<&String> =
                    title_ws.iter().filter(|w| !RP_TITLE_STOP.contains(&w.as_str())).collect();
                if title_hit.is_empty()
                    && title_content.len() == 1
                    && !theme_kw_set.contains(title_content[0].as_str())
                    && contains_word(&pos_n, title_content[0])
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
        // закон №27: вещь ближайшая к заявке
        let pos_tags27: Vec<String> = s
            .pos
            .to_lowercase()
            .replace('_', " ")
            .split(|c| c == ',' || c == '.')
            .map(|t| t.trim().to_string())
            .collect();
        const CLAIM_27: [&str; 6] = [
            "nipples through clothing",
            "clothed nipples",
            "covered nipples",
            "wet clothes",
            "see-through",
            "breast clinging",
        ];
        let mut claim_idx27: Vec<usize> = Vec::new();
        let mut garment_idx27: Vec<usize> = Vec::new();
        for (i, t) in pos_tags27.iter().enumerate() {
            if CLAIM_27.iter().any(|c| t.contains(c)) {
                claim_idx27.push(i);
            }
            if RP_GARMENT.iter().any(|g| contains_word(t, g)) {
                garment_idx27.push(i);
            }
        }
        let mut garment_tag27 = String::new();
        if !garment_idx27.is_empty() {
            if !claim_idx27.is_empty() {
                let dist = |gi: usize| {
                    claim_idx27
                        .iter()
                        .map(|ci| (gi as i64 - *ci as i64).unsigned_abs())
                        .min()
                        .unwrap_or(u64::MAX)
                };
                let best = garment_idx27
                    .iter()
                    .copied()
                    .reduce(|best, gi| if dist(gi) < dist(best) { gi } else { best })
                    .unwrap();
                garment_tag27 = pos_tags27[best].clone();
            } else {
                garment_tag27 = pos_tags27[garment_idx27[0]].clone();
            }
        }
        let garment_norm27 = garment_tag27.replace('-', " ");
        let garment_dark =
            !garment_tag27.is_empty() && RP_DARK_TONE.iter().any(|w| contains_word_ci(&garment_norm27, w));
        let garment_light_fam = !garment_tag27.is_empty()
            && !garment_dark
            && RP_LIGHT_FAMILY.iter().any(|w| contains_word_ci(&garment_norm27, w));
        let pos_lower27 = s.pos.to_lowercase().replace('_', " ");
        let through_claim27 = pos_lower27.contains("nipples through clothing");
        let loc = light_on_chest(&s.pos);
        let wet_sheer27 = pos_lower27.contains("wet clothes")
            || pos_lower27.contains("see-through")
            || pos_lower27.contains("breast clinging");
        if tier_of(&s.meta) == "R+" {
            if through_claim27 && !garment_dark {
                let g = if !garment_tag27.is_empty() {
                    format!(" («{}»)", garment_tag27)
                } else {
                    " (цвет вещи не назван)".to_string()
                };
                slot_f.push(format!(
                    "закон №28 (№27-наследие): through-заявка «nipples through clothing» — X-канал ПО ОПРЕДЕЛЕНИЮ на любом тоне{g}: тег рисует цветной сосок через любую ткань (P09 свитер, P12 не-сквозная — T4-31); R+ бугорки = DRY dark + covered-first (P30)"
                ));
            }
            if loc && wet_sheer27 {
                slot_f.push(
                    "закон №27: «light on chest» на sheer/wet верхе — прямой X-усилитель (квитанции P14/P17): свет на зоне — glow сцены на вещь, не «свет на груди»".to_string(),
                );
            }
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
        // закон №25: бан-лист NEG (X-слоты исключены)
        if tier_of(&s.meta) != "X" {
            for t in RP_NEG_BAN {
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
    let distinct = pal_count.len();
    if distinct < 7 {
        f.push(format!("палитр в батче {distinct} < 7 (C066 — закон №23)"));
    }
    for (pal, n) in &pal_count {
        if *n > 3 {
            f.push(format!("палитра {pal} использована {n} раз > 3 (C067 — закон №23)"));
        }
    }
    if light_carrying_tops.len() > 3 {
        f.push(format!(
            "закон №27: светлых/серо-семейных несущих верхов с заявкой {} > 3 — тон вещи ротацией dark/mid/light, светлый кластер рушит и канал (X-слайды), и разнообразие кадра (вердикты T4-26/T4-28)",
            light_carrying_tops.len()
        ));
        for p in &light_carrying_tops {
            f.push(format!(
                "P{p}: закон №27 — несущий верх светлой/серо-семьи в кластере {n}>3; перетони вещь в dark/mid (тёмный полюс несёт through-заявку, светлый — covered/clothed, кластер ≤3)",
                n = light_carrying_tops.len()
            ));
        }
    }
    out.push(hard_receipt("raw-plus", f));
    if !expl.is_empty() {
        out.push(Receipt {
            gate: "raw-plus-exploratory",
            level: "warn",
            verdict: "WARN",
            findings: expl,
            notes: Vec::new(),
        });
    }
    out
}

fn hard_receipt(gate: &'static str, findings: Vec<String>) -> Receipt {
    Receipt {
        gate,
        level: "hard",
        verdict: if findings.is_empty() { "PASS" } else { "FAIL" },
        findings,
        notes: Vec::new(),
    }
}

/// countSignals (gates.ts:343): подстрока, каждый сигнал ≤1 раза.
fn count_signals(hay_lower: &str, signals: &[String]) -> usize {
    signals
        .iter()
        .filter(|s| hay_lower.contains(&s.to_lowercase()))
        .count()
}

/// recipeKey (gates.ts:337)
fn recipe_key(tier: &str) -> &str {
    match tier {
        "PG-13" => "PG13",
        "R+" => "RPLUS",
        other => other,
    }
}

/// TIER_RANK (verdicts.ts:13) — единая копия порядка тиров (Залп 2).
fn tier_rank(tier: &str) -> u32 {
    match tier {
        "PG-13" | "PG13" => 0,
        "R" => 1,
        "R+" | "RPLUS" => 2,
        "X" => 3,
        "XXX" => 4,
        _ => 0,
    }
}

/// signalMinDefault (gates.ts:754)
fn signal_min_default(tier: &str) -> Option<u32> {
    match tier {
        "PG-13" | "R+" | "X" => Some(2),
        "R" => Some(1),
        _ => None,
    }
}

/// tagRun (gates.ts:793): POS до первой точки; точка на позиции 0 или без
/// точек — весь POS (TS `firstDot > 0 ? slice : pos`), lowercase.
fn tag_run_of(pos: &str) -> String {
    let run = match pos.find('.') {
        Some(0) | None => pos,
        Some(i) => &pos[..i],
    };
    run.to_lowercase()
}

fn is_exploratory_slot(s: &TextSlot) -> bool {
    s.header.contains('⚗')
}

/// №27/№28 dark-слова (gates.ts:875, /\b(...)\b/i по tagRun).
const DARK28: [&str; 23] = [
    "black", "ink", "midnight", "charcoal", "espresso", "dark", "deep", "oxblood", "void",
    "sumi", "burgundy", "wine", "maroon", "plum", "chocolate", "cocoa", "aubergine",
    "obsidian", "onyx", "raven", "soot", "sable", "forest",
];

fn any_word_ci(hay: &str, words: &[&str]) -> bool {
    words.iter().any(|w| contains_word_ci(hay, w))
}

/// Первое вхождение needle с ASCII-границами слов (левое-первое ПОЗИЦИЯ).
fn first_word_occurrence(hay: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    let mut from = 0usize;
    while let Some(rel) = hay[from..].find(needle) {
        let s = from + rel;
        let e = s + needle.len();
        let before = s == 0 || !hay[..s].chars().next_back().is_some_and(ascii_word);
        let after = e >= hay.len() || !hay[e..].chars().next().is_some_and(ascii_word);
        if before && after {
            return Some(s);
        }
        from = s + 1;
    }
    None
}

/// /\bPL\d{1,3}\b/ — левый+правый ASCII-\b, {1,3} жадный с бэктрекингом
/// (JS-семантика: левое-первое совпадение, на позиции — от 3 цифр вниз).
fn extract_pose_id(header: &str) -> Option<String> {
    let chars: Vec<(usize, char)> = header.char_indices().collect();
    for idx in 0..chars.len() {
        let (byte_pos, ch) = chars[idx];
        if ch != 'P' {
            continue;
        }
        if byte_pos > 0 && header[..byte_pos].chars().next_back().is_some_and(ascii_word) {
            continue;
        }
        if idx + 1 >= chars.len() || chars[idx + 1].1 != 'L' {
            continue;
        }
        let digits_start = idx + 2;
        let mut digit_count = 0usize;
        while digit_count < 3
            && digits_start + digit_count < chars.len()
            && chars[digits_start + digit_count].1.is_ascii_digit()
        {
            digit_count += 1;
        }
        for len in (1..=digit_count).rev() {
            let end_idx = digits_start + len;
            let after = chars.get(end_idx).map(|(_, c)| *c);
            if !after.is_some_and(ascii_word) {
                let start = chars[idx].0;
                let end = chars.get(end_idx).map(|(b, _)| *b).unwrap_or(header.len());
                return Some(header[start..end].to_string());
            }
        }
    }
    None
}

/// /\b(P\d{1,3}_[A-Z_]+)\b/ — палитры P##_NAME (gates.ts:1130).
fn extract_palette_id(header: &str) -> Option<String> {
    let chars: Vec<(usize, char)> = header.char_indices().collect();
    for idx in 0..chars.len() {
        let (byte_pos, ch) = chars[idx];
        if ch != 'P' {
            continue;
        }
        if byte_pos > 0 && header[..byte_pos].chars().next_back().is_some_and(ascii_word) {
            continue;
        }
        let mut j = idx + 1;
        let mut digit_count = 0usize;
        while digit_count < 3 && j < chars.len() && chars[j].1.is_ascii_digit() {
            j += 1;
            digit_count += 1;
        }
        if digit_count == 0 || j >= chars.len() || chars[j].1 != '_' {
            continue;
        }
        j += 1;
        let mut end_idx = j;
        while end_idx < chars.len() && (chars[end_idx].1.is_ascii_uppercase() || chars[end_idx].1 == '_') {
            end_idx += 1;
        }
        // [A-Z_] жаден, все символы класса — слово-символы: бэктрекинг не
        // может дать \b (граница word↔word невозможна) — проверяем только
        // полную длину (1-в-1 с JS).
        if end_idx == chars.len() || !ascii_word(chars[end_idx].1) {
            let start = chars[idx].0;
            let end = chars.get(end_idx).map(|(b, _)| *b).unwrap_or(header.len());
            return Some(header[start..end].to_string());
        }
    }
    None
}

/// hair/eye слова канона: /[a-z]+/gi + фильтры gates.ts:1042-1047.
fn spec_words(spec: &str, stop: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let flush = |cur: &mut String, out: &mut Vec<String>| {
        if !cur.is_empty() {
            if cur.chars().count() > 3 && !stop.contains(&cur.as_str()) {
                out.push(cur.clone());
            }
            cur.clear();
        }
    };
    for ch in spec.chars() {
        if ch.is_ascii_alphabetic() {
            cur.extend(ch.to_lowercase());
        } else {
            flush(&mut cur, &mut out);
        }
    }
    flush(&mut cur, &mut out);
    out
}

/// 3. rating-recipe (gates.ts:745, hard) — рецепт тира: сигналы, hard-заявка,
/// механизмы (состояние ткани/подслой/мёртвые ткани/контр-NEG), законы
/// №27/№28, counter-NEG, X Cut hold, overclaim. EXPLORATORY (⚗) — редирект
/// в условный warn-гейт rating-recipe-exploratory (§10), не блок.
pub fn gate_rating_recipe(batch: &TextBatch, recipes: Option<&RatingRecipes>) -> Vec<Receipt> {
    let mut f: Vec<String> = Vec::new();
    let mut exploratory_findings: Vec<String> = Vec::new();
    let empty: Vec<(String, TierRecipe)> = Vec::new();
    let tiers = match recipes {
        Some(r) => &r.tiers,
        None => &empty,
    };
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier.is_empty() {
            f.push(format!("P{}: рейтинг не распознан в шапке («{}»)", s.position, s.meta));
            continue;
        }
        let Some((_, recipe)) = tiers.iter().find(|(k, _)| k.as_str() == recipe_key(tier)) else {
            continue;
        };
        let pos_lower = s.pos.to_lowercase();
        let neg_lower = s.neg.to_lowercase();
        let tag_run = tag_run_of(&s.pos);

        let signals = count_signals(&pos_lower, &recipe.signals);
        let min = recipe
            .signal_min
            .or_else(|| signal_min_default(tier))
            .unwrap_or(1) as usize;
        if signals < min {
            f.push(format!(
                "P{}: заявлен {}, сигнал-тегов рецепта {}/{} — рейтинг не заработан (рецепт: {}…)",
                s.position,
                tier,
                signals,
                min,
                recipe.signals.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
            ));
        }
        if !recipe.signals_hard.is_empty() {
            let hard = count_signals(&pos_lower, &recipe.signals_hard);
            let hard_min = recipe.hard_min.unwrap_or(1) as usize;
            if hard < hard_min {
                let cameltoe_only =
                    contains_word_ci(&pos_lower, "cameltoe") || contains_word_ci(&pos_lower, "camel toe");
                f.push(format!(
                    "P{}: заявлен {}, но рендер-доказанной заявки нет ({}/{}){}: {}",
                    s.position,
                    tier,
                    hard,
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
        for (mech_name, m) in &recipe.mechanisms {
            let active_hard: Vec<&String> = m
                .hard
                .iter()
                .filter(|h| tag_run.contains(&h.to_lowercase()))
                .collect();
            if active_hard.is_empty() {
                continue;
            }
            if !m.required_state.is_empty() {
                let state_hit = m
                    .required_state
                    .iter()
                    .any(|st| tag_run.contains(&st.to_lowercase()));
                if !state_hit {
                    let msg = format!(
                        "P{}: механизм «{}» без состояния ткани — в тег-блоке нет ни одного из [{}] (рендер-вердикт T4-03: сухая плотная ткань не несёт edge, P13/P21 умерли именно так)",
                        s.position,
                        mech_name,
                        m.required_state.join(" / ")
                    );
                    if is_exploratory_slot(s) {
                        exploratory_findings.push(format!("EXPLORATORY (§10, квитанция): {msg}"));
                    } else {
                        f.push(msg);
                    }
                }
            }
            if m
                .underlayer_block_applies_to
                .iter()
                .any(|h| active_hard.iter().any(|a| *a == h))
            {
                for u in &m.underlayer_block {
                    if contains_word_ci(&tag_run, u) {
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
            let dead_list: Vec<&String> = if is_lower {
                m.dead_fabrics_lower
                    .iter()
                    .chain(m.dead_fabrics_upper.iter().filter(|x| x.as_str() == "suit"))
                    .collect()
            } else if is_upper {
                m.dead_fabrics_upper
                    .iter()
                    .chain(m.dead_fabrics_lower.iter().filter(|x| x.as_str() == "suit"))
                    .collect()
            } else {
                Vec::new()
            };
            for df in dead_list {
                if contains_word_ci(&tag_run, df) {
                    f.push(format!(
                        "P{}: мёртвая ткань «{}» в тег-блоке при активной {} заявке «{}» — эта ткань не несёт edge (рендер-вердикт T4-03: джинсы/бархат/костюм → PG-13)",
                        s.position,
                        df,
                        if is_lower { "нижней" } else { "грудной" },
                        mech_name
                    ));
                    break;
                }
            }
        }
        for (mech_name, m) in &recipe.mechanisms {
            if !m
                .hard
                .iter()
                .any(|h| pos_lower.contains(&h.to_lowercase()))
            {
                continue;
            }
            for t in &m.counter_neg {
                if !neg_lower.contains(&t.to_lowercase()) {
                    f.push(format!(
                        "P{}: механизм «{}» требует контр-NEG «{}» в NEG",
                        s.position, mech_name, t
                    ));
                }
            }
            for t in &m.counter_neg_lifted {
                if neg_lower.contains(&t.to_lowercase()) {
                    f.push(format!(
                        "P{}: механизм «{}» заглушен — «{}» в NEG закрывает грудь и душит сигнал (вердикт T4-03)",
                        s.position, mech_name, t
                    ));
                }
            }
        }
        if tier == "R+" {
            let swim28 = any_word_ci(&tag_run, &["swimsuit", "bikini", "rash guard"]);
            let through28 = tag_run.contains("nipples through clothing");
            let wet_combo28 = tag_run.contains("wet clothes") && tag_run.contains("see-through");
            let sheer28 = contains_word_ci(&tag_run, "sheer");
            let bumps28 =
                contains_word_ci(&tag_run, "clothed nipples") || contains_word_ci(&tag_run, "covered nipples");
            let dark28 = any_word_ci(&tag_run, &DARK28);
            let mut msg28 = |m: &str| {
                if is_exploratory_slot(s) {
                    exploratory_findings
                        .push(format!("EXPLORATORY (§10, квитанция): P{}: {}", s.position, m));
                } else {
                    f.push(format!("P{}: {}", s.position, m));
                }
            };
            if through28 {
                msg28("закон №28: «nipples through clothing» на R+ — через-заявка = X-канал ПО ОПРЕДЕЛЕНИЮ (рендерер рисует цветной сосок через любую ткань: P09 свитер, P12 не-сквозная жёлтая; P30-формула бугорков = DRY dark + covered-first + clinging + sweat)");
            }
            if wet_combo28 && !swim28 {
                msg28("закон №28: мокрое+сквозное на тканевом верхе = X-комбо на любом тоне (P12 deep-amber, P25 rose-pink, P26 black — все X); купальник — исключение (P21-золото), но тут не он");
            }
            if sheer28 {
                msg28("закон №28: слово «sheer» на R+ — сквозь-заявка в самом слове (P04 sheer black под призмой → X, P26 sheer crop → X); бугорки-канал живёт БЕЗ sheer-слова");
            }
            if bumps28 && !dark28 {
                msg28("закон №28+№27: бугорки-канал (clothed/covered nipples) без тёмного слова-цвета — бугорки живут ТОЛЬКО на тёмной вещи (P30 oxblood/espresso — единственный выживший; светлые/серые вершины — каналы вне-ткани)");
            }
        }
        let counter_hit = recipe
            .counter_neg
            .iter()
            .any(|t| neg_lower.contains(&t.to_lowercase()));
        if !counter_hit {
            f.push(format!(
                "P{}: контр-NEG не держит границу тира (нужно ≥1 из: {})",
                s.position,
                recipe.counter_neg.iter().take(3).cloned().collect::<Vec<_>>().join(", ")
            ));
        }
        if tier == "X" {
            let missing: Vec<&String> = recipe
                .counter_neg
                .iter()
                .filter(|t| !neg_lower.contains(&t.to_lowercase()))
                .collect();
            if !missing.is_empty() {
                f.push(format!(
                    "P{}: X Cut hold (блок 9) — в NEG нет: {} — весь блок границы X обязан стоять в NEG (главная угроза X Cut — модель дорисовывает ниже; это флоор-сила, не совет)",
                    s.position,
                    missing.iter().map(|t| t.as_str()).collect::<Vec<_>>().join(", ")
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
        let my_order = tier_rank(tier);
        for (other_key, other) in tiers {
            let other_tier = match other_key.as_str() {
                "PG13" => "PG-13",
                "RPLUS" => "R+",
                x => x,
            };
            if tier_rank(other_tier) > my_order && other_tier != "XXX" {
                let over: Vec<&String> = other
                    .signals
                    .iter()
                    .filter(|sig| {
                        pos_lower.contains(&sig.to_lowercase())
                            && !recipe
                                .signals
                                .iter()
                                .any(|m| m.to_lowercase().contains(&sig.to_lowercase()))
                    })
                    .collect();
                if !over.is_empty() && tier != "X" {
                    f.push(format!(
                        "P{}: заявлен {}, но несёт сигнал выше тиром: «{}»",
                        s.position, tier, over[0]
                    ));
                }
            }
        }
    }
    let mut out = vec![hard_receipt("rating-recipe", f)];
    if !exploratory_findings.is_empty() {
        out.push(Receipt {
            gate: "rating-recipe-exploratory",
            level: "warn",
            verdict: "WARN",
            findings: exploratory_findings,
            notes: Vec::new(),
        });
    }
    out
}

/// 4. canon (gates.ts:997, hard) — имена OC никогда не входят в POS
/// (§9-кватерна) + канон-локи волос/глаз по oc-canon.json (§8).
pub fn gate_canon(batch: &TextBatch, oc_canon: &[OcEntry]) -> Receipt {
    let mut f: Vec<String> = Vec::new();
    for s in &batch.slots {
        for oc in oc_canon {
            if contains_word(&s.pos, &oc.name) {
                f.push(format!(
                    "P{}: имя ОС «{}» в POS — триггер чужих персонажей у рендерера (приказ автора, T4-04); опиши её дескрипторами, имя живёт в шапке/Canon",
                    s.position, oc.name
                ));
                break;
            }
        }
    }
    for s in batch.slots.iter().filter(|x| x.position <= 3) {
        // nameMatch: /\b(имена)\b/ по header + ' ' + canon — левое-первое
        // ПО ПОЗИЦИИ (JS-альтернатива), при равной позиции — порядок списка.
        let hay_named = format!("{} {}", s.header, s.canon);
        let mut best: Option<(usize, &OcEntry)> = None;
        for oc in oc_canon {
            if let Some(pos) = first_word_occurrence(&hay_named, &oc.name) {
                if best.map(|(bp, _)| pos < bp).unwrap_or(true) {
                    best = Some((pos, oc));
                }
            }
        }
        let Some((_, oc)) = best else {
            f.push(format!("P{}: OC не опознан в шапке", s.position));
            continue;
        };
        let hair_words = spec_words(&oc.hair, &["hair", "with", "held", "long", "into"]);
        let eye_words = spec_words(&oc.eyes, &["eyes", "with", "held"]);
        let hay = format!("{} {}", s.canon, s.pos).to_lowercase();
        let hair_hit = hair_words.iter().any(|w| hay.contains(w.as_str()));
        let eye_hit = eye_words.iter().any(|w| hay.contains(w.as_str()));
        if !hair_hit {
            f.push(format!("P{} ({}): канон-лок волос не виден", s.position, oc.name));
        }
        if !eye_hit {
            f.push(format!("P{} ({}): канон-лок глаз не виден", s.position, oc.name));
        }
    }
    hard_receipt("canon", f)
}

/// Дубли идентификаторов в шапках (gates.ts:1112): n > 1 и не вся группа —
/// EXP-пара (маркер «(EXP ·» в каждой шапке группы) — исключение §10.
/// Порядок вывода — порядок первого вхождения (JS Map insertion).
fn dup_ids_of<T: Fn(&str) -> Option<String>>(batch: &TextBatch, extract: T) -> Vec<String> {
    let mut counts: Vec<(String, usize, usize)> = Vec::new();
    for s in &batch.slots {
        let Some(id) = extract(&s.header) else { continue };
        let exp_mark = s.header.contains("(EXP ·");
        match counts.iter_mut().find(|(k, _, _)| k == &id) {
            Some((_, n, exp)) => {
                *n += 1;
                if exp_mark {
                    *exp += 1;
                }
            }
            None => counts.push((id, 1, usize::from(exp_mark))),
        }
    }
    counts
        .into_iter()
        .filter(|(_, n, exp)| *n > 1 && exp != n)
        .map(|(id, _, _)| id)
        .collect()
}

/// 5. diversity (gates.ts:1057, hard) — капы монополии: core-4, механо-
/// группы/классы, sheer-квоты, моно-носитель, W-класс, уникальность
/// поз/палитр (EXP-пары одной переменной — исключение §10).
pub fn gate_diversity(batch: &TextBatch, carriers: Option<&CarriersSpec>) -> Receipt {
    let empty = CarriersSpec::default();
    let carriers = carriers.unwrap_or(&empty);
    let mech_of = |cls: &str| carriers.class_mech.get(cls).map(String::as_str).unwrap_or("");
    let cls_of = |id: &str| -> String {
        let b = id.as_bytes();
        if b.len() >= 4 && &b[..3] == b"CR-" && b[3].is_ascii_uppercase() {
            (b[3] as char).to_string()
        } else {
            "?".to_string()
        }
    };
    let mut f: Vec<String> = Vec::new();
    let mut all_stacked: Vec<String> = Vec::new();
    let mut sheer_frames = 0usize;
    let mut rplus_count = 0usize;
    for s in &batch.slots {
        let tier = tier_of(&s.meta);
        if tier == "R+" || tier == "X" {
            rplus_count += 1;
            let mut groups: Vec<&str> = Vec::new();
            let mut classes: Vec<String> = Vec::new();
            for id in &s.stack {
                let mech = mech_of(&cls_of(id));
                if !groups.contains(&mech) {
                    groups.push(mech);
                }
                let cls = cls_of(id);
                if !classes.contains(&cls) {
                    classes.push(cls);
                }
            }
            if s.stack.len() < 4 {
                f.push(format!("P{}: стек {}/4 носителей (core-4)", s.position, s.stack.len()));
            }
            if groups.len() < 4 {
                let g = if groups.is_empty() {
                    "пусто".to_string()
                } else {
                    groups.join(",")
                };
                f.push(format!(
                    "P{}: механо-групп {}/4 ({})",
                    s.position,
                    groups.len(),
                    g
                ));
            }
            if classes.len() < 4 {
                f.push(format!("P{}: классов {}/4", s.position, classes.len()));
            }
            let sheer_ids: Vec<&String> = s.stack.iter().filter(|id| carriers.sheer_ids.contains(*id)).collect();
            if sheer_ids.len() > 2 {
                f.push(format!("P{}: sheer-носителей {} > 2", s.position, sheer_ids.len()));
            }
            if !sheer_ids.is_empty() {
                sheer_frames += 1;
            }
        }
        all_stacked.extend(s.stack.iter().cloned());
    }
    let mut per_carrier: Vec<(String, usize)> = Vec::new();
    for id in &all_stacked {
        match per_carrier.iter_mut().find(|(k, _)| k == id) {
            Some((_, n)) => *n += 1,
            None => per_carrier.push((id.clone(), 1)),
        }
    }
    for (id, n) in &per_carrier {
        if *n > 4 {
            f.push(format!("моно-носитель {} в {} слотах > 4 — моно-механизм N28", id, n));
        }
    }
    let w_count = all_stacked.iter().filter(|id| cls_of(id) == "W").count();
    let w_share = if all_stacked.is_empty() {
        0.0
    } else {
        ((w_count as f64 / all_stacked.len() as f64) * 100.0).round()
    };
    if w_share > 45.0 {
        f.push(format!("W-класс {}% > 45% (моно-механизм)", w_share));
    }
    if rplus_count > 0 {
        let sheer_pct = ((sheer_frames as f64 / rplus_count as f64) * 100.0).round();
        if sheer_pct > 40.0 {
            f.push(format!("sheer-кадры {}% > 40% R+ слотов (N28-ловушка)", sheer_pct));
        }
    }
    let pose_ids: Vec<String> = batch.slots.iter().filter_map(|s| extract_pose_id(&s.header)).collect();
    let pose_dups = dup_ids_of(batch, extract_pose_id);
    if !pose_dups.is_empty() {
        f.push(format!(
            "позы не уникальны в батче: {} (EXP-пары одной переменной — исключение §10)",
            pose_dups.join(", ")
        ));
    }
    let pal_ids: Vec<String> = batch.slots.iter().filter_map(|s| extract_palette_id(&s.header)).collect();
    if pose_ids.len() == batch.slots.len() && pal_ids.len() != batch.slots.len() {
        f.push(format!(
            "слотов с палитрой в шапке: {}/{}",
            pal_ids.len(),
            batch.slots.len()
        ));
    }
    let pal_dups = dup_ids_of(batch, extract_palette_id);
    if pal_ids.len() >= batch.slots.len() && !pal_dups.is_empty() {
        f.push(format!(
            "палитры не уникальны в батче: {} (EXP-пары — исключение §10)",
            pal_dups.join(", ")
        ));
    }
    hard_receipt("diversity", f)
}

/* ================================================================== */
/* Батарея целиком + прогон по слагу                                    */
/* ================================================================== */

/// Все 30 базовых гейтов в Rust (этапы 1 → 1-бис → 1-в; 7 hard +
/// 20 warn + 3 advisory, порядок квитанций = runGates).
pub const BATTERY_RUST: [&str; 30] = [
    "structure", "exp-purity", "floors", "rating-recipe", "dresser", "canon",
    "diversity", "window", "budget", "cadence", "niche-legibility", "prop-geometry",
    "claim-visibility", "technique-layers", "noun-lock", "character-collision",
    "ab-single-variable", "theme-presence", "original-character-coverage", "artist-leak",
    "garment-family", "simcheck", "freq-report", "usage", "technique-map", "salience-chain",
    "contract-fidelity", "one-hard-claim", "echo-window", "bumps-quota",
];

/// Этап 1-в ЗАВЕРШЁН: все 30 базовых гейтов портированы в Rust
/// (7 hard + 20 warn + 3 advisory); условные (raw-plus, у него
/// raw-plus-exploratory, у rating-recipe — rating-recipe-exploratory) —
/// вне счёта базы, как и в GATES_TOTAL=30 (живой прогон даёт 30–33
/// квитанции). Порядок квитанций — 1-в-1 с runGates.
pub const BATTERY_TS: [&str; 0] = [];

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

/// Полная текстовая батарея по parsed-батчу (порядок квитанций — 1-в-1 с
/// runGates: 30 базовых + условные raw-plus/raw-plus-exploratory; условный
/// rating-recipe-exploratory эмиттится внутри gate_rating_recipe).
pub fn run_text_gates(
    batch: &TextBatch,
    specs: &TextSpecs,
    contract: Option<&Contract>,
    chron: &ChronState,
) -> Vec<Receipt> {
    let mut out = Vec::with_capacity(BATTERY_RUST.len() + 3);
    out.push(gate_structure(batch, &specs.laws));
    out.push(gate_exp_purity(batch, contract));
    out.push(gate_floors(batch, specs.recipes.as_ref()));
    out.extend(gate_rating_recipe(batch, specs.recipes.as_ref()));
    out.push(gate_dresser(batch, specs.dresser.as_ref()));
    out.push(gate_canon(batch, &specs.oc_canon));
    out.push(gate_diversity(batch, specs.carriers.as_ref()));
    out.push(gate_window(batch, contract, chron));
    out.push(gate_budget(batch, specs.bans.as_ref()));
    out.push(gate_cadence(batch));
    out.push(gate_niche_legibility(batch, contract, &specs.races, &specs.laws));
    out.push(gate_prop_geometry(batch));
    out.push(gate_claim_visibility(batch));
    out.push(gate_technique_layers(batch, specs.techniques.as_ref()));
    out.push(gate_noun_lock(batch));
    out.push(gate_character_collision(batch));
    out.push(gate_ab_single_variable(contract));
    out.push(gate_theme_presence(batch));
    out.push(gate_oc_coverage(batch));
    out.push(gate_artist_leak(batch));
    out.push(gate_garment_family(batch));
    out.push(gate_simcheck(batch, contract, chron));
    out.push(gate_freq_report(batch));
    out.push(gate_usage(batch));
    out.push(gate_technique_map(batch, specs.techniques.as_ref()));
    out.push(gate_salience_chain(batch, contract));
    out.extend(gate_raw_plus(batch, contract));
    out.push(gate_contract_fidelity(batch, contract, &specs.races));
    out.push(gate_one_hard_claim(batch));
    out.push(gate_echo_window(batch));
    out.push(gate_bumps_quota(contract));
    out
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
    let specs = load_text_specs();
    // состояние = фолд файла-летописи (эталон TS читает его же; прод-SQLite
    // НЕ зеркало — миграция сняла 399 из 421 звеньев, см. блок ChronState)
    let chron = chronicle_state();
    let contract = load_contract(slug);
    let receipts = run_text_gates(&batch, &specs, contract.as_ref(), &chron);
    let mut hasher = Sha256::new();
    hasher.update(file.as_bytes());
    let full: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    let sha10 = full[..10].to_string();
    let hard_pass = receipts.iter().filter(|r| r.level == "hard").all(|r| r.verdict == "PASS");
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
        // 30/30 в Rust (этап 1-в завершён: BATTERY_TS пуст) — GATES_TOTAL=30,
        // аудит Rust-эры; порядок квитанций run_text_gates = runGates
        assert_eq!(BATTERY_RUST.len(), 30);
        assert_eq!(BATTERY_TS.len(), 0);
        let specs = load_text_specs();
        assert_eq!(BATTERY_RUST.len(), run_text_gates(&parse_batch("T4-90", SYNTH_ETALON), &specs, None, &ChronState::empty()).len());
    }

    #[test]
    fn structure_gate_counts_and_pins() {
        let specs = load_text_specs();
        // живой батч: структура PASS на T4-41 (паритет-батарея, 0 diff);
        // эталонный синтетик (SYNTH_ETALON) старше порта structure — его
        // structure-вердикт не обязателен PASS
        let live = run_for_slug("T4-41").unwrap().1;
        let st41 = live.receipts.iter().find(|r| r.gate == "structure").unwrap();
        assert_eq!(st41.verdict, "PASS");
        // квитанция structure всегда ровно одна и hard
        let all = run_text_gates(&parse_batch("T4-90", SYNTH_ETALON), &specs, None, &ChronState::empty());
        assert_eq!(all.iter().filter(|r| r.gate == "structure").count(), 1);
        assert_eq!(all[0].gate, "structure", "первая квитанция прогона — structure (порядок runGates)");
    }

    #[test]
    fn exp_purity_marker_semantics() {
        // контрактный маркер: буква/половина из контракта, хвост — не ASCII-алнум
        assert!(exp_marker_ok("EXP α-A · гипотеза", "α", "A"));
        assert!(exp_marker_ok("EXP β-B", "β", "B"));
        assert!(!exp_marker_ok("EXP α-A2 · хвост", "α", "A"));
        assert!(!exp_marker_ok("EXP α-AB", "α", "A"));
        assert!(!exp_marker_ok("EXPα-A", "α", "A"));
        // кириллица в хвосте — НЕ ASCII-алнум: lookahead пропускает (1-в-1 с JS)
        assert!(exp_marker_ok("EXP α-Aбез-пробела", "α", "A"));
        // фолбэк: гreek-буква, опциональный single
        assert!(fallback_exp_marker("EXP α · что-то"));
        assert!(fallback_exp_marker("EXP single·β ..."));
        assert!(!fallback_exp_marker("EXP х · не-гreek"));
    }

    #[test]
    fn floors_template_and_milf_cap() {
        let specs = load_text_specs();
        let live = run_for_slug("T4-20.1-EXP").unwrap().1;
        let fl = live.receipts.iter().find(|r| r.gate == "floors").unwrap();
        assert!(
            fl.findings.iter().any(|f| f.contains("(3/9 терминов)")),
            "шаблон «(N/M терминов)» — скобка ДО слова (паритет gates.ts:693)"
        );
    }

    #[test]
    fn simcheck_jaccard_v8_formatting() {
        // toFixed(2) V8: точный тай 1/8 = 0.125 → half-away → «0.13»
        assert_eq!(js_fixed2(1, 8), "0.13");
        assert_eq!(js_fixed2(1, 3), "0.33");
        assert_eq!(js_fixed2(2, 3), "0.67");
        assert_eq!(js_fixed2(3, 4), "0.75");
        assert_eq!(js_fixed2(1, 1), "1.00");
        // пороги: inter/union > 0.75 и > 0.7 — целочисленное сравнение
        assert!(!j_gt(3, 4, 75, 100));
        assert!(j_gt(4, 5, 75, 100));
        assert!(j_gt(7, 10, 7, 10) == false);
        assert!(j_gt(8, 10, 7, 10));
    }

    #[test]
    fn chronicle_fold_window_tail() {
        // живой фолд: окно [T4-33, T4-34, T4-41] (старейший → свежайший),
        // void'ы (T4-36/T4-39/T4-40/T4-42) из окна выдавлены
        let st = chronicle_state();
        assert_eq!(st.window_slugs, vec!["T4-33", "T4-34", "T4-41"]);
        // JSONL заморожен ДО void'а T4-42 — в файле его нет; проверяем честно:
        assert!(!st.voided.contains(&"T4-42".to_string()), "JSONL не знает движковых void'ов");
        assert!(!st.window_slugs.contains(&"T4-42".to_string()));
        // историческое окно: T4-33 видит только себя (self убирает windowOthers)
        let hist = historical_window_for("T4-33", &st);
        assert_eq!(hist, vec!["T4-33".to_string()], "члены, сданные позже, ретроактивно не судят");
        assert!(window_others_for("T4-33", &hist, None).is_empty());
        let hist41 = historical_window_for("T4-41", &st);
        assert_eq!(hist41.len(), 3, "свежайший видит всё окно (история не судит будущее)");
        // runIndex T4-04: JSONL — истина (SQLite-миграция занижала: 3 vs 5)
        assert_eq!(st.gate_runs.get("T4-04").copied(), Some(5));
    }

    #[test]
    fn salience_intent_tags_full_list() {
        // регрессия 16-го тега: «eye contact» — паритет gates.ts:1898
        let specs = load_text_specs();
        let live = run_for_slug("T4-07").unwrap().1;
        let sc = live.receipts.iter().find(|r| r.gate == "salience-chain").unwrap();
        assert!(sc.findings.iter().any(|f| f.contains("INTERPRETATION ✓ (eye contact)")));
    }

    #[test]
    fn spec_loaders_order_and_content() {
        let recipes = load_rating_recipes().expect("rating-recipes.json читается");
        let keys: Vec<&str> = recipes.tiers.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["PG13", "R", "RPLUS", "X", "XXX"], "порядок тиров — как в документе");
        let rplus = &recipes.tiers.iter().find(|(k, _)| k == "RPLUS").unwrap().1;
        let mechs: Vec<&str> = rplus.mechanisms.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(mechs, vec!["bumps", "on_skin"], "порядок механизмов — как в документе");
        assert_eq!(rplus.signals_hard.len(), 6);
        let oc = oc_canon_entries();
        assert!(oc.iter().any(|o| o.name == "Vae" && o.hair.contains("black")));
        let carriers = load_carriers().expect("carriers.json читается");
        assert_eq!(carriers.class_mech.get("W").map(String::as_str), Some("FABRIC"));
        assert!(carriers.sheer_ids.contains("CR-W07"));
    }

    #[test]
    fn extractor_js_backtracking_semantics() {
        // \bPL\d{1,3}\b: 4 цифры — граница не достигается ни при какой длине
        assert_eq!(extract_pose_id("P01 — a (VOLT · — · R+ · PL1234)"), None);
        assert_eq!(extract_pose_id("P01 — a (VOLT · — · R+ · PL24 · P30_STEEL)"), Some("PL24".into()));
        assert_eq!(extract_pose_id("(PL7)"), Some("PL7".into()));
        // левая граница: «XPL24» — P после слово-символа
        assert_eq!(extract_pose_id("XPL24"), None);
        assert_eq!(extract_pose_id("·PL24"), Some("PL24".into()));
        // палитра: \d{1,3} бэктрекинг, [A-Z_]+ жадный, хвостовой \b
        assert_eq!(extract_palette_id("(VOLT · — · R+ · P1_NIGHT)"), Some("P1_NIGHT".into()));
        assert_eq!(extract_palette_id("(P7777_X)"), None);
        assert_eq!(extract_palette_id("(P77_LATE_MILK)"), Some("P77_LATE_MILK".into()));
        assert_eq!(extract_palette_id("(P77_LATE_MILKx)"), None);
        assert_eq!(extract_palette_id("(x P077_LATE)"), Some("P077_LATE".into()));
    }

    #[test]
    fn rating_recipe_gate_tier_logic() {
        let specs = load_text_specs();
        // PASS: R+ с рендер-доказанной заявкой + контр-NEG в NEG
        let ok = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, visible pantyline, tight clothes, masterpiece, best quality, anime artstyle.\nNEG:\nchild, bra, camisole, nipples exposed\n",
        );
        let receipts = gate_rating_recipe(&ok, specs.recipes.as_ref());
        assert_eq!(receipts[0].verdict, "PASS", "{:?}", receipts[0].findings);
        // FAIL: R+ без hard-заявки + cameltoe-ветка
        let bad = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, cameltoe, tight clothes, masterpiece, best quality, anime artstyle.\nNEG:\nbra\n",
        );
        let receipts = gate_rating_recipe(&bad, specs.recipes.as_ref());
        assert_eq!(receipts[0].verdict, "FAIL");
        assert!(receipts[0].findings.iter().any(|x| x.contains("рендер-доказанной заявки нет (0/1) — cameltoe рендер-мёртв")), "{:?}", receipts[0].findings);
        // overclaim: R+ с X-сигналом выше тиром. «topless» тут НЕ сработал бы —
        // R+-сигнал «topless with tape» содержит его как подстроку (дедуп
        // gates.ts:940) — живой триггер «nipples through clothing» (T4-31)
        let over = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nPOS:\nanime style, nipples through clothing, visible pantyline, tight clothes, masterpiece, best quality, anime artstyle.\nNEG:\nbra, nipples exposed\n",
        );
        let receipts = gate_rating_recipe(&over, specs.recipes.as_ref());
        assert!(receipts[0].findings.iter().any(|x| x == "P1: заявлен R+, но несёт сигнал выше тиром: «nipples through clothing»"), "{:?}", receipts[0].findings);
        // X Cut hold: NEG без части блока границы
        let xcut = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · X)\nPOS:\nanime style, nipples, spread legs, masterpiece, best quality, anime artstyle.\nNEG:\nexposed genitals\n",
        );
        let receipts = gate_rating_recipe(&xcut, specs.recipes.as_ref());
        assert!(receipts[0].findings.iter().any(|x| x.contains("X Cut hold (блок 9) — в NEG нет:")), "{:?}", receipts[0].findings);
        assert!(receipts[0].findings.iter().any(|x| x.contains("«spread legs» в POS приглашает рендерер ниже груди")), "{:?}", receipts[0].findings);
        // ⚗-слот: №28-находка уезжает в условный exploratory-гейт
        let expl = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R+ · ⚗)\nPOS:\nanime style, sheer wrap, masterpiece, best quality, anime artstyle.\nNEG:\nbra\n",
        );
        let receipts = gate_rating_recipe(&expl, specs.recipes.as_ref());
        // №28-находка уезжает в ⚗-квитанцию, но сигнал-счёт остаётся hard
        // (редиректится только required_state/№28 — gates.ts:805/881)
        assert_eq!(receipts[0].verdict, "FAIL", "{:?}", receipts[0].findings);
        assert_eq!(receipts[0].findings.len(), 2, "{:?}", receipts[0].findings);
        assert!(receipts[0].findings[0].contains("сигнал-тегов рецепта 0/2"));
        assert!(receipts[0].findings[1].contains("рендер-доказанной заявки нет (0/1)"));
        assert_eq!(receipts.len(), 2);
        assert_eq!(receipts[1].gate, "rating-recipe-exploratory");
        assert!(receipts[1].findings.iter().any(|x| x.contains("слово «sheer» на R+")));
    }

    #[test]
    fn canon_gate_name_and_locks() {
        let specs = load_text_specs();
        // имя OC в POS — находка; P01 без имени OC — «не опознан»
        let bad = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R)\nPOS:\nanime style, Vae, masterpiece, best quality, anime artstyle.\nNEG:\nx\n",
        );
        let r = gate_canon(&bad, &specs.oc_canon);
        assert_eq!(r.verdict, "FAIL");
        assert!(r.findings.iter().any(|x| x.contains("имя ОС «Vae» в POS")));
        assert!(r.findings.iter().any(|x| x == "P1: OC не опознан в шапке"));
        // PASS: OC Vae с волосами/глазами канона в POS
        let ok = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (OC · Vae · R+ · PL24 · P25_VOID_EMBER)\nPOS:\nanime style, very long black hair, single white streak, striking red eyes, masterpiece, best quality, anime artstyle.\nNEG:\nx\n",
        );
        let r = gate_canon(&ok, &specs.oc_canon);
        assert_eq!(r.verdict, "PASS", "{:?}", r.findings);
    }

    #[test]
    fn diversity_gate_caps_and_exp_exempt() {
        let specs = load_text_specs();
        // FAIL: стек 2/4 на обоих R+
        let bad = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R+)\nStack: CR-W01 + CR-B02\nPOS:\nx\nNEG:\nx\nP02 — b (VOLT · — · R+)\nStack: CR-W01 + CR-B02\nPOS:\nx\nNEG:\nx\n",
        );
        let r = gate_diversity(&bad, specs.carriers.as_ref());
        assert!(r.findings.iter().any(|x| x == "P1: стек 2/4 носителей (core-4)"));
        assert!(r.findings.iter().any(|x| x == "P1: механо-групп 2/4 (FABRIC,BODY)"));
        assert!(r.findings.iter().any(|x| x == "P2: классов 2/4"));
        // PASS: core-4 из 4 механо-групп
        let ok = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP01 — a (VOLT · — · R+ · PL24 · P30_STEEL)\nStack: CR-W01 + CR-A01 + CR-E01 + CR-D01\nPOS:\nx\nNEG:\nx\n",
        );
        let r = gate_diversity(&ok, specs.carriers.as_ref());
        assert_eq!(r.verdict, "PASS", "{:?}", r.findings);
        // EXP-пара: общая поза+палитра у двух EXP-слотов — НЕ дубль (§10)
        let exp_pair = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP05 — e1 (EXP · VOLT · — · R+ · PL24 · P106_NIGHT)\nPOS:\nx\nNEG:\nx\nP06 — e2 (EXP · VOLT · — · R+ · PL24 · P106_NIGHT)\nPOS:\nx\nNEG:\nx\n",
        );
        let r = gate_diversity(&exp_pair, specs.carriers.as_ref());
        assert!(r.findings.iter().all(|x| !x.contains("не уникальны")), "{:?}", r.findings);
        // тот же дубль БЕЗ EXP-маркера — мутон
        let plain_dup = parse_batch(
            "T4-90",
            "# T4-90 «x»\nP05 — e1 (VOLT · — · R+ · PL24 · P106_NIGHT)\nPOS:\nx\nNEG:\nx\nP06 — e2 (VOLT · — · R+ · PL24 · P106_NIGHT)\nPOS:\nx\nNEG:\nx\n",
        );
        let r = gate_diversity(&plain_dup, specs.carriers.as_ref());
        assert!(r.findings.iter().any(|x| x.contains("позы не уникальны в батче: PL24")), "{:?}", r.findings);
        assert!(r.findings.iter().any(|x| x.contains("палитры не уникальны в батче: P106_NIGHT")), "{:?}", r.findings);
    }
}
