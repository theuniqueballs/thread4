//! THREAD 4 ENGINE (RUST TWIN) — ARS NOVEAU (смена 2026-10-24, исполнитель — Доу).
//!
//! Приказ автора: новый Раскрыватель темы. Старый концепт «фраза → три
//! микро-темы» устарел; теперь по каждой теме строится 21 отдельная история
//! (мейн-пул) + свои истории у 3 ОС + EXP-программа (вне темы, только
//! проверки гипотез). Распределение мейнов: часть — НИША, пара слотов —
//! ЭКСКУИЗИТ, остальное — ВОЛЬТ.
//!
//! Пайплайн: EXPAND (LLM через мост :3202) → ASSEMBLE (сборщик-брикетчик,
//! Rust) → SCRIBE (писец, LLM через мост) → GATES (textgates.rs, in-process)
//! → FURNACE (LLM-оценщик) → ПЕЧЬ (сдача — существующий контур).
//!
//! Доктрина: вся логика — ЗДЕСЬ, на Rust; llm-bridge (:3202, bun) — тупая
//! труба к z-ai-web-dev-sdk (SDK живёт только в Node). Замок моста — тот же
//! командирский ключ. Сессии — scratch-мир twin'а (data/ars/*.json), прод
//! неприкосновенен. Каждая стадия — worker-поток: акцепт-цикл RPC не жмёт.

use std::collections::{HashMap, HashSet};
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::canon::{EXP_LETTERS, FLOORS};
use crate::live::{BLOCK_EXPAND, BLOCK_GATES, BLOCK_SCRIBE};
use crate::textgates::{batches_dir, specs_dir};

pub const ARS_VERSION: &str = "1.0.0";
pub const BRIDGE_PORT: u16 = 3202;
pub const LLM_TIMEOUT_SECS: u64 = 150;

/* ================================================================== */
/* Мост: loopback HTTP-клиент (std::net, без новых зависимостей)       */
/* ================================================================== */

fn bridge_key() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/z".to_string());
    let raw = std::fs::read_to_string(format!("{home}/.t4/commander.key")).ok()?;
    let key = raw.trim().to_string();
    if key.len() >= 16 {
        Some(key)
    } else {
        None
    }
}

/// POST JSON на loopback, ответ — разобранный JSON-конверт моста.
/// Ключ моста идёт заголовком x-bridge-key (ЕДИНЫЙ секрет — командирский).
fn bridge_post(path: &str, bridge_key: &str, body: &Value, timeout_secs: u64) -> Result<Value, String> {
    let payload = serde_json::to_string(body).map_err(|e| e.to_string())?;
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", BRIDGE_PORT))
        .map_err(|e| format!("мост :{BRIDGE_PORT} молчит ({e}) — подними mini-services/llm-bridge"))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(timeout_secs)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{BRIDGE_PORT}\r\nContent-Type: application/json\r\nx-bridge-key: {bridge_key}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("мост: запись оборвалась — {e}"))?;

    // Читаем заголовки построчно (до пустой строки), потом ровно Content-Length
    // байт тела — никакой зависимости от EOF/keep-alive.
    use std::io::BufRead;
    let mut reader = std::io::BufReader::new(stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line).map_err(|e| format!("мост: нет статусной строки — {e}"))?;
    let mut content_length: usize = 0;
    let mut chunked = false;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| format!("мост: заголовки оборвались — {e}"))?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        let low = line.to_lowercase();
        if let Some(v) = low.strip_prefix("content-length:") {
            content_length = v.trim().parse::<usize>().unwrap_or(0);
        }
        if low.starts_with("transfer-encoding:") && low.contains("chunked") {
            chunked = true;
        }
    }
    if chunked {
        let mut raw = String::new();
        reader.read_to_string(&mut raw).map_err(|e| format!("мост: chunked-тело оборвалось — {e}"))?;
        let body = dechunk(&raw);
        return serde_json::from_str(&body).map_err(|e| format!("мост: ответ не JSON — {e}: {}", truncate(&body, 300)));
    }
    let mut buf = vec![0u8; content_length];
    let mut read_total = 0usize;
    while read_total < content_length {
        let n = reader
            .read(&mut buf[read_total..])
            .map_err(|e| format!("мост: тело оборвалось на {read_total}/{content_length} — {e}"))?;
        if n == 0 {
            break;
        }
        read_total += n;
    }
    let body = String::from_utf8_lossy(&buf[..read_total]).to_string();
    let _ = status_line;
    serde_json::from_str(&body).map_err(|e| format!("мост: ответ не JSON — {e}: {}", truncate(&body, 300)))
}

fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    loop {
        let Some((size_line, tail)) = rest.split_once("\r\n") else { break };
        let size = usize::from_str_radix(size_line.trim().split(';').next().unwrap_or("0"), 16)
            .unwrap_or(0);
        if size == 0 || tail.len() < size {
            break;
        }
        out.push_str(&tail[..size]);
        rest = &tail[size..];
        if rest.starts_with("\r\n") {
            rest = &rest[2..];
        }
    }
    if out.is_empty() {
        body.to_string()
    } else {
        out
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

/// LLM-вызов через мост: system+user → content. Один повтор на переносимую ошибку.
pub fn llm_chat(system: &str, user: &str, thinking: bool) -> Result<String, String> {
    let key = bridge_key().ok_or("командирский ключ не найден — мост залочен (Залп 1 «Правда»)")?;
    let body = json!({ "system": system, "user": user, "thinking": thinking });
    let started = std::time::Instant::now();
    eprintln!("ars: llm_chat → мост (system {}B, user {}B)", system.len(), user.len());
    let mut last = String::new();
    for attempt in 0..2 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        match bridge_post("/v1/chat", &key, &body, LLM_TIMEOUT_SECS) {
            Ok(v) => {
                if v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
                    let content = v
                        .get("content")
                        .and_then(|x| x.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if !content.trim().is_empty() {
                        eprintln!("ars: llm_chat ← {} символов за {:?}", content.len(), started.elapsed());
                        return Ok(content);
                    }
                    last = "мост: пустой content".into();
                } else {
                    last = format!(
                        "мост: {}",
                        v.pointer("/error/message").and_then(|x| x.as_str()).unwrap_or("неизвестная ошибка")
                    );
                }
            }
            Err(e) => last = e,
        }
        eprintln!("ars: llm_chat попытка {} не удалась за {:?}: {}", attempt + 1, started.elapsed(), last);
    }
    Err(last)
}

/// Вытаскивает первый JSON-объект из ответа LLM (терпит ```-заборы и прозу).
pub fn extract_json(s: &str) -> Result<Value, String> {
    let start = s.find('{').ok_or("в ответе LLM нет JSON-объекта")?;
    let end = s.rfind('}').ok_or("в ответе LLM JSON не закрыт")?;
    if end < start {
        return Err("JSON-объект LLM нечитаем".into());
    }
    serde_json::from_str(&s[start..=end]).map_err(|e| format!("JSON LLM не парсится: {e}"))
}

/// Сканер завершённых top-level объектов: трекинг глубины/строк/экранирования;
/// каждый объект, вернувший глубину в 0, парсим; обрезанный хвост игнорируем
/// (SALVAGE против потолка вывода модели ~15К символов).
fn scan_complete_objects(s: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let chars: Vec<char> = s.chars().collect();
    let mut stack: Vec<usize> = Vec::new();
    let mut in_str = false;
    let mut esc = false;
    for (i, ch) in chars.iter().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if *ch == '\\' {
                esc = true;
            } else if *ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => stack.push(i),
            '}' => {
                if let Some(st) = stack.pop() {
                    let slice: String = chars[st..=i].iter().collect();
                    if let Ok(v) = serde_json::from_str::<Value>(&slice) {
                        out.push(v);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Мягкий разбор: обычный extract_json, при обрезе — salvage-сборка префикса.
pub fn extract_json_soft(s: &str) -> Result<Value, String> {
    if let Ok(v) = extract_json(s) {
        return Ok(v);
    }
    let objs = scan_complete_objects(s);
    let slot_like: Vec<Value> = objs
        .iter()
        .filter(|o| o.get("genre").is_some() || o.get("letter").is_some())
        .cloned()
        .collect();
    if slot_like.len() >= 3 {
        return Ok(json!({ "slots": slot_like }));
    }
    if let Some(one) = objs
        .iter()
        .find(|o| o.get("title").is_some() || o.get("slots").is_some() || o.get("exp_program").is_some())
    {
        return Ok(one.clone());
    }
    Err("JSON обрезан и salvage не нашёл завершённых объектов".into())
}

/* ================================================================== */
/* RNG: тот же конвейер, что компилятор/тема (sha256 → mulberry32)     */
/* ================================================================== */

pub fn hash_seed(s: &str) -> u32 {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(s.as_bytes());
    u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]])
}

type FaceT = (&'static str, &'static str, &'static str);

pub struct ArsRng {
    state: u32,
}

impl ArsRng {
    pub fn new(seed_str: &str) -> Self {
        ArsRng { state: hash_seed(seed_str) }
    }
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state;
        t ^= t >> 15;
        t = t.wrapping_mul(t | 1);
        t = t.wrapping_add(t.wrapping_mul(t ^ (t >> 7)).wrapping_mul(61 ^ t));
        ((t ^ (t >> 14)) as u32) as f64 / 4_294_967_296.0
    }
    pub fn pick<'a>(&mut self, pool: &[&'a str]) -> &'a str {
        pool[(self.next_f64() * pool.len() as f64) as usize % pool.len()]
    }
    pub fn pick_value<'a>(&mut self, pool: &'a [Value]) -> &'a Value {
        &pool[(self.next_f64() * pool.len() as f64) as usize % pool.len()]
    }
    pub fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next_f64() * (hi - lo + 1) as f64) as usize % (hi - lo + 1).max(1)
    }
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = (self.next_f64() * (i + 1) as f64) as usize % (i + 1);
            v.swap(i, j);
        }
    }
}

/* ================================================================== */
/* Сессии: data/ars/<id>.json (scratch-мир twin'а)                     */
/* ================================================================== */

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArsSession {
    pub id: String,
    pub slug: String,
    pub theme: String,
    pub oc_themes: Vec<Value>,
    pub created_at: String,
    pub updated_at: String,
    /// created → expanded → assembled → scribed → gated → done | failed
    pub stage: String,
    /// стадия, выполняющаяся прямо сейчас (worker-поток)
    pub busy: Option<String>,
    pub error: Option<String>,
    pub title: Option<String>,
    pub law_paragraph: Option<String>,
    pub theme_words: Vec<String>,
    pub acts: Vec<String>,
    pub slots: Vec<Value>,
    pub exp_program: Vec<Value>,
    pub bricks: Vec<Value>,
    pub draft_md: Option<String>,
    pub draft_sha10: Option<String>,
    pub gate_receipts: Vec<Value>,
    pub gate_hard_pass: Option<bool>,
    pub gate_run_index: Option<u32>,
    pub furnace: Option<Value>,
    pub scribe_log: Vec<String>,
    pub progress: Value,
}

impl Default for ArsSession {
    fn default() -> Self {
        ArsSession {
            id: String::new(),
            slug: String::new(),
            theme: String::new(),
            oc_themes: vec![],
            created_at: String::new(),
            updated_at: String::new(),
            stage: "created".into(),
            busy: None,
            error: None,
            title: None,
            law_paragraph: None,
            theme_words: vec![],
            acts: vec![],
            slots: vec![],
            exp_program: vec![],
            bricks: vec![],
            draft_md: None,
            draft_sha10: None,
            gate_receipts: vec![],
            gate_hard_pass: None,
            gate_run_index: None,
            furnace: None,
            scribe_log: vec![],
            progress: json!({}),
        }
    }
}

pub fn ars_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/ars")
}

fn session_path(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("ars: подозрительный id сессии «{id}»"));
    }
    Ok(ars_dir().join(format!("{id}.json")))
}

pub fn load_session(id: &str) -> Result<ArsSession, String> {
    let path = session_path(id)?;
    let raw = std::fs::read_to_string(&path).map_err(|_| format!("ars: сессия {id} не найдена"))?;
    serde_json::from_str(&raw).map_err(|e| format!("ars: сессия {id} не читается — {e}"))
}

pub fn save_session(s: &ArsSession) -> Result<(), String> {
    std::fs::create_dir_all(ars_dir()).map_err(|e| e.to_string())?;
    let path = session_path(&s.id)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(s).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn list_sessions() -> Vec<Value> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(ars_dir()) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("json") {
                if let Ok(raw) = std::fs::read_to_string(&p) {
                    if let Ok(v) = serde_json::from_str::<ArsSession>(&raw) {
                        out.push(json!({
                            "id": v.id, "slug": v.slug, "theme": v.theme,
                            "title": v.title, "stage": v.stage, "busy": v.busy,
                            "hardPass": v.gate_hard_pass, "furnaceVerdict": v.furnace.as_ref().map(|f| f.get("verdict").cloned().unwrap_or(Value::Null)),
                            "createdAt": v.created_at, "updatedAt": v.updated_at,
                        }));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| {
        b.get("createdAt").and_then(|x| x.as_str()).unwrap_or("").cmp(a.get("createdAt").and_then(|x| x.as_str()).unwrap_or(""))
    });
    out
}

/// Следующий слаг файл-истины: max(T4-NN.md в batches/) + 1. Void-номера
/// не переиспользуются (номера живут в имени файла — честно и просто).
pub fn next_slug() -> Result<String, String> {
    let mut max: u32 = 40;
    if let Ok(entries) = std::fs::read_dir(batches_dir()) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(rest) = name.strip_prefix("T4-") {
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(n) = digits.parse::<u32>() {
                    max = max.max(n);
                }
            }
        }
    }
    Ok(format!("T4-{:02}", max + 1))
}

pub fn new_session(theme: &str, oc_themes: Value) -> Result<ArsSession, String> {
    let theme = theme.trim().to_string();
    if theme.is_empty() || theme.chars().count() > 300 {
        return Err("ars: тема обязательна (1..300 символов)".into());
    }
    let mut oc_list = Vec::new();
    match oc_themes {
        Value::Array(arr) => {
            for item in arr {
                match item {
                    Value::String(s) => oc_list.push(json!({ "theme": s })),
                    Value::Object(_) => oc_list.push(item),
                    _ => return Err("ars: ocThemes — строки или объекты {name?,theme}".into()),
                }
            }
        }
        Value::Null => {}
        _ => return Err("ars: ocThemes — массив".into()),
    }
    if oc_list.is_empty() || oc_list.len() > 3 {
        return Err("ars: нужно 1..3 ОС-темы (у каждой ОС — своя история по теме)".into());
    }
    let slug = next_slug()?;
    let now = crate::chain::iso_now();
    let id = format!("ars-{}-{:04x}", now.replace(|c: char| !"0123456789".contains(c), ""), hash_seed(&format!("{theme}|{now}")) % 0x10000);
    let s = ArsSession {
        id,
        slug,
        theme,
        oc_themes: oc_list,
        created_at: now.clone(),
        updated_at: now,
        stage: "created".into(),
        ..Default::default()
    };
    save_session(&s)?;
    Ok(s)
}

/* ================================================================== */
/* Спеки: онтология, палитры, позы, расы, ОС-канон, архетипы, стеки    */
/* ================================================================== */

fn read_json_file(path: &PathBuf) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

pub struct Ontology {
    pub env: HashMap<String, Value>,
    pub lp: HashMap<String, Value>,
    pub vibe: HashMap<String, Value>,
}

pub fn load_ontology() -> Result<Ontology, String> {
    let v = read_json_file(&specs_dir().join("ars-ontology.json"))?;
    let mut env = HashMap::new();
    for e in v.get("environments").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(id) = e.get("id").and_then(|x| x.as_str()) {
            env.insert(id.to_string(), e);
        }
    }
    let mut lp = HashMap::new();
    for e in v.get("lighting_presets").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(id) = e.get("id").and_then(|x| x.as_str()) {
            lp.insert(id.to_string(), e);
        }
    }
    let mut vibe = HashMap::new();
    for e in v.get("vibes").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(id) = e.get("id").and_then(|x| x.as_str()) {
            vibe.insert(id.to_string(), e);
        }
    }
    Ok(Ontology { env, lp, vibe })
}

pub fn load_palettes() -> Result<Vec<Value>, String> {
    let v = read_json_file(&specs_dir().join("palettes.json"))?;
    Ok(v.get("palettes").and_then(|x| x.as_array()).cloned().unwrap_or_default())
}

pub fn load_poses() -> Result<HashMap<String, Value>, String> {
    let v = read_json_file(&specs_dir().join("poses.json"))?;
    let mut m = HashMap::new();
    for p in v.get("poses").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(id) = p.get("id").and_then(|x| x.as_str()) {
            m.insert(id.to_string(), p);
        }
    }
    Ok(m)
}

pub fn load_races_active() -> Result<Vec<Value>, String> {
    let v = read_json_file(&specs_dir().join("races.json"))?;
    Ok(v.get("races")
        .and_then(|x| x.as_array()).cloned().unwrap_or_default()
        .into_iter()
        .filter(|r| r.get("status").and_then(|x| x.as_str()) == Some("active"))
        .filter(|r| r.get("name").and_then(|x| x.as_str()) != Some("Human"))
        .collect())
}

/// Активный ОС-ростер: (имя, поля канона) — только active:true.
pub fn load_oc_roster() -> Result<Vec<(String, Value)>, String> {
    let v = read_json_file(&specs_dir().join("oc-canon.json"))?;
    let ocs = v.get("ocs").and_then(|x| x.as_object()).ok_or("oc-canon.json: нет ocs")?;
    let mut out = Vec::new();
    for (name, oc) in ocs {
        if oc.get("active").and_then(|x| x.as_bool()).unwrap_or(false) {
            out.push((name.clone(), oc.clone()));
        }
    }
    Ok(out)
}

pub fn load_oc_canon_full(name: &str) -> Option<Value> {
    let v = read_json_file(&specs_dir().join("oc-canon.json")).ok()?;
    v.get("ocs")?.get(name).cloned()
}

pub fn load_archetypes() -> Result<(HashMap<String, Value>, HashMap<String, Value>), String> {
    let volt = read_json_file(&specs_dir().join("volt-archetypes.json"))?;
    let niche = read_json_file(&specs_dir().join("niche-archetypes.json"))?;
    let mut vm = HashMap::new();
    for a in volt.get("archetypes").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(id) = a.get("id").and_then(|x| x.as_str()) {
            vm.insert(id.to_string(), a);
        }
    }
    let mut nm = HashMap::new();
    for a in niche.get("archetypes").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        if let Some(id) = a.get("id").and_then(|x| x.as_str()) {
            nm.insert(id.to_string(), a);
        }
    }
    Ok((vm, nm))
}

/// carrier.json class_defs: буква класса → count (для CR-<letter><nn>).
pub fn load_carrier_counts() -> Result<(HashMap<String, u32>, HashMap<String, String>), String> {
    let v = read_json_file(&specs_dir().join("carriers.json"))?;
    let mut counts = HashMap::new();
    let mut mech = HashMap::new();
    if let Some(cd) = v.get("class_defs").and_then(|x| x.as_object()) {
        for (letter, def) in cd {
            counts.insert(letter.clone(), def.get("count").and_then(|x| x.as_u64()).unwrap_or(30) as u32);
            if let Some(m) = def.get("mech").and_then(|x| x.as_str()) {
                mech.insert(letter.clone(), m.to_string());
            }
        }
    }
    Ok((counts, mech))
}

/* ================================================================== */
/* ULTIMATE DICE — порт tools/dice.ts (A5P6 §3, RAW-эра)               */
/* ================================================================== */



pub const DIE_A: &[FaceT] = &[
    ("A1", "hair-first", "волосы первыми, потом глаза, потом раса/тело"),
    ("A2", "race-first", "расовые теги первыми (ears/wings/tail/scales), потом волосы"),
    ("A3", "garment-first", "именованная вещь сразу после id — до волос"),
    ("A4", "body-first", "форма тела первой (register-теги), потом волосы"),
    ("A5", "marks-first", "метки/шрамы/веснушки первыми, потом волосы"),
    ("A6", "kinetic-first", "движение-тег первым (mid-motion), потом id-хвост"),
    ("A7", "claims-first", "заявка-теги сразу после id — волосы после одежды"),
    ("A8", "witness-first", "объект-свидетель первым тегом сцены (НИША-путь)"),
];
pub const DIE_B: &[FaceT] = &[
    ("B1", "garment-noun", "вещь субъектом кадра: тег вещи раньше состояний"),
    ("B2", "state-first", "состояние вещи первым: soaked/clinging до имени вещи"),
    ("B3", "reveal-first", "что вещь отдаёт/держит — раньше вещи"),
    ("B4", "fabric-first", "материал первым: cotton/silk/knit до тегов вещи"),
    ("B5", "absence-first", "отсутствие подложки первым: nothing underneath до вещи"),
    ("B6", "tactile-first", "прикосновение ткани к коже первым"),
    ("B7", "action-clothing", "действие раскрывает вещь: pose-глагол до тегов вещи"),
    ("B8", "layer-first", "счёт слоёв первым: один слой, затем…"),
];
pub const DIE_C: &[FaceT] = &[
    ("C1", "theme-noun", "тема стала ОБЪЕКТОМ кадра (нарисованная вещь — не название темы)"),
    ("C2", "theme-action", "она ДЕЛАЕТ тему телом/действием"),
    ("C3", "theme-absence", "тема — то, чего в кадре НЕТ (пустота нарисована)"),
    ("C4", "theme-transform", "тема ИЗМЕНИЛА её/мир (результат виден)"),
    ("C5", "theme-witness", "свидетель в кадре видит тему"),
    ("C6", "theme-implied", "тема вплетена без явного слова (только теги)"),
];
pub const DIE_D: &[FaceT] = &[
    ("D1", "source-off-frame", "источник за кадром, луч входит"),
    ("D2", "edge-on-skin", "свет красит кромку тела на зоне"),
    ("D3", "shadow-contrast", "свет против тени — контраст пары"),
    ("D4", "atmospheric-wash", "цветовой залив всего пространства"),
    ("D5", "light-as-verb", "свет ДЕЙСТВУЕТ на зону (licks/falls/hits)"),
    ("D6", "dual-light", "два источника, две температуры на зоне"),
    ("D7", "glow-from-within", "зона светится сама (экран/прибор/магия)"),
    ("D8", "borrowed-light", "зона ловит чужой свет (мокрое стекло/зеркало)"),
];
pub const DIE_E: &[FaceT] = &[
    ("E1", "three-long", "3 длинных смысловых блока в ран, дыхание медленное"),
    ("E2", "fragment-pair", "2 коротких блока + 1 длинный — обрыв как стиль"),
    ("E3", "action-beat", "глагольная очередь тегов — движение"),
    ("E4", "one-breath", "один длинный блок на весь кадр"),
    ("E5", "dialogue-close", "ран заканчивается «репликой» — близким кадром лица"),
    ("E6", "question-close", "последний блок держит недосказанность"),
];

#[derive(Clone, Debug)]
pub struct DiceRoll {
    pub idx: [usize; 5],
    pub signature: String,
    pub instructions: String,
}

pub fn roll_dice(rng: &mut ArsRng) -> DiceRoll {
    let tables: [&[FaceT]; 5] = [&DIE_A, &DIE_B, &DIE_C, &DIE_D, &DIE_E];
    let mut idx = [0usize; 5];
    let mut codes = Vec::new();
    let mut instr = Vec::new();
    for (i, table) in tables.iter().enumerate() {
        let k = (rng.next_f64() * table.len() as f64) as usize % table.len();
        idx[i] = k;
        let (code, what, how) = table[k];
        codes.push(code.to_string());
        instr.push(format!("{code} {what}: {how}"));
    }
    DiceRoll {
        idx,
        signature: codes.join("·"),
        instructions: instr.join(" · "),
    }
}

/* ================================================================== */
/* ДРЕССЕР №29 — одежда по политике (merge с Dresser)                  */
/* ================================================================== */

pub const DARK_FABRIC_COLORS: &[&str] = &[
    "black", "ink", "midnight", "charcoal", "espresso", "dark navy", "oxblood",
    "void", "sumi", "ink-black", "deep plum", "dark aubergine", "storm-grey",
];
pub const LIGHT_FABRIC_COLORS: &[&str] = &[
    "pale cream", "ivory-white", "soft sage", "powder lilac", "light sand",
    "pale mint", "washed rose", "pale sky",
];

/// Каналы R+ по закону №28: bumps — ТОЛЬКО тёмный DRY; light/mid — не-через-ткани.
pub const RPLUS_CHANNELS: &[&str] = &["bumps", "pantyline", "on_skin", "swim_wet"];

/// Канал → какие категории Дрессера его обслуживают (dresser.json channels.*.categories).
fn channel_categories<'a>(dresser: &'a Value, channel: &str) -> Vec<&'a str> {
    dresser
        .pointer(&format!("/channels/{channel}/categories"))
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default()
}

fn category_item(dresser: &Value, category: &str, rng: &mut ArsRng) -> Option<String> {
    let items = dresser
        .pointer(&format!("/categories/{category}/items"))
        .and_then(|x| x.as_array())?;
    if items.is_empty() {
        return None;
    }
    let pick = items[(rng.next_f64() * items.len() as f64) as usize % items.len()]
        .as_str()?
        .to_string();
    // specialty «concept-forged item (по нише)» — машинный выбор не кует концепты
    if pick.starts_with("concept-forged") {
        return None;
    }
    Some(pick)
}

/// Дресс-код слота: канал/категория/вещь/тон/состояния/подслой/NEG-веса/заявки.
/// Возвращаемый Value кладётся в слот как dress.* и печатается в брикет дословно.
pub fn dress_for(
    tier: &str,
    channel_hint: Option<&str>,
    rng: &mut ArsRng,
    dresser: &Value,
) -> Value {
    let (channel, states, underlayer, neg_extra, claims): (&str, Vec<&str>, &str, Vec<&str>, Vec<&str>) =
        if tier == "R+" {
            let ch = match channel_hint {
                Some(c) if RPLUS_CHANNELS.contains(&c) => c,
                _ => RPLUS_CHANNELS[(rng.next_f64() * 3.0) as usize % 3], // swim_wet не из ротации — 1/батч снаружи
            };
            match ch {
                "bumps" => (
                    "bumps",
                    vec!["covered nipples", "clothed nipples", "dark garment", "fabric clinging", "sweat glistening", "extreme fanservice"],
                    "nothing underneath",
                    vec!["bra", "camisole", "bandeau", "undershirt", "suit", "jeans", "velvet", "leather"],
                    vec!["covered nipples", "clothed nipples", "extreme fanservice"],
                ),
                "pantyline" => (
                    "pantyline",
                    vec!["visible pantyline", "tight", "tight clothes", "nothing underneath", "extreme fanservice"],
                    "nothing underneath",
                    vec!["bra", "camisole", "bandeau", "undershirt", "jeans", "denim", "sweatpants"],
                    vec!["visible pantyline", "tight clothes", "extreme fanservice"],
                ),
                "on_skin" => (
                    "on_skin",
                    vec!["taped nipples", "nothing underneath", "extreme fanservice"],
                    "кожа + реквизит контакта",
                    vec!["nipples exposed", "areola", "bra", "camisole", "bandeau", "undershirt"],
                    vec!["taped nipples", "extreme fanservice"],
                ),
                _ => (
                    "swim_wet",
                    vec!["swimsuit", "wet clothes", "covered nipples", "fabric clinging", "nothing underneath", "extreme fanservice"],
                    "ничего (купальник самодостаточен)",
                    vec!["bra", "camisole", "bandeau", "undershirt", "garter straps", "thighhighs"],
                    vec!["wet clothes", "covered nipples", "extreme fanservice"],
                ),
            }
        } else if tier == "R" {
            (
                "R-layers",
                vec!["lingerie", "panties", "underwear"],
                "именованное бельё и есть вещь",
                vec!["nipples", "areola", "cameltoe"],
                vec!["lingerie", "panties"],
            )
        } else {
            (
                "PG13-tease",
                vec!["sexy outfit", "cleavage", "thighhighs"],
                "обычное бельё",
                vec!["nipples", "areola", "lingerie visible"],
                vec!["sexy outfit", "cleavage"],
            )
        };

    // категория + вещь из Дрессера (с fallback'ом на street)
    let cats = channel_categories(dresser, channel);
    let mut garment: Option<String> = None;
    let mut category: String = cats.first().copied().unwrap_or("street").to_string();
    for cat in cats.iter() {
        if let Some(item) = category_item(dresser, cat, rng) {
            category = (*cat).to_string();
            garment = Some(item);
            break;
        }
    }
    if garment.is_none() {
        garment = category_item(dresser, "street", rng);
    }
    let garment = garment.unwrap_or_else(|| "knit top".to_string());

    // тон: bumps — ТОЛЬКО тёмный (№28); light ≤3 на батч контролирует вызывающий
    let (color, tone) = if channel == "bumps" || (tier == "R+" && rng.next_f64() < 0.6) {
        (rng.pick(DARK_FABRIC_COLORS), "dark")
    } else {
        (rng.pick(LIGHT_FABRIC_COLORS), "light")
    };
    let color = color.to_string();

    // NEG-веса канала (для брикета; в NEG идут без весов — как в T4-45)
    let neg_weights = match channel {
        "bumps" => "(nipples through clothing:1.3),(see-through:1.3)",
        "pantyline" => "(jeans:1.2),(denim:1.2)",
        "on_skin" => "(bra:1.3),(camisole:1.3)",
        "swim_wet" => "(garter straps:1.3)",
        _ => "(lingerie visible:1.2)",
    };

    // цветные вещи: купальник/бельё получают цвет прямо в имя
    let garment_colored = if channel == "swim_wet" || channel == "R-layers" {
        format!("{color} {garment}")
    } else {
        garment.clone()
    };

    json!({
        "channel": channel,
        "tier": tier,
        "category": category,
        "garment": garment_colored,
        "color": color,
        "tone": tone,
        "states": states,
        "underlayer": underlayer,
        "claims": claims,
        "negExtra": neg_extra,
        "negWeights": neg_weights,
        "law": "№29 (Дрессер): аутфит по политике · №28 (канал-тон-состояние)",
    })
}

/// Машинный NEG: вечные флооры + соло-лок + кач-пара + канал + регистр-счётчики.
/// Состав 1-в-1 с проходимыми NEG T4-45 (гейт floors hard).
pub fn machine_neg(tier: &str, channel: &str, register: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut push_all = |v: &[&str]| {
        for s in v {
            let s = s.to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
    };
    for (_, tokens) in FLOORS.iter() {
        push_all(tokens);
    }
    push_all(&["semi-realistic anime face", "2.5D face", "3D face"]);
    push_all(&["male", "man", "1boy", "2girls"]);
    push_all(&["washed-out", "faded colors", "low contrast"]);
    match channel {
        "bumps" => push_all(&["bra", "camisole", "bandeau", "undershirt", "suit", "jeans", "velvet", "leather"]),
        "pantyline" => push_all(&["bra", "camisole", "bandeau", "undershirt", "jeans", "denim", "sweatpants"]),
        "on_skin" => push_all(&["nipples exposed", "areola", "bra", "camisole", "bandeau", "undershirt"]),
        "swim_wet" => push_all(&["bra", "camisole", "bandeau", "undershirt", "garter straps", "thighhighs"]),
        "R-layers" => push_all(&["nipples", "areola", "cameltoe"]),
        _ => push_all(&["nipples", "areola", "lingerie visible"]),
    }
    if register == "milf" {
        push_all(&["petite", "slender", "slim frame"]);
    } else {
        push_all(&["full-figured", "curvy", "milf", "large breasts", "wide hips"]);
    }
    let _ = tier;
    out.join(", ")
}

/// Тело-блок по регистру (до identity): тег-форма, FAM-хвосты ОС срезаются.
pub fn body_block(register: &str, oc_body: Option<&str>) -> String {
    if let Some(b) = oc_body {
        let b = b.split(", FAM").next().unwrap_or(b).trim();
        if !b.is_empty() {
            return b.to_string();
        }
    }
    match register {
        "milf" => "full-figured body, wide hips, soft waist, full chest".into(),
        "young" => "petite body".into(),
        _ => "slender body, narrow frame".into(),
    }
}

/* ================================================================== */
/* EXPAND — LLM думает и строит 24 слот-карточки + EXP-программу       */
/* ================================================================== */

const EXPAND_SYSTEM: &str = r#"Ты — ARS NOVEAU, Раскрыватель темы конвейера THREAD 4. Отвечай ТОЛЬКО минимальным JSON по задаче пользователя: без markdown-заборов, без прозы вокруг, без выхода за рамки задачи. НЕ пиши слоты/программы, которых задача не просит."#;

/// Промпт вызова слотов: акт I (3 OC + 8 мейнов) или акты II+III (13 мейнов).
fn expand_slots_prompt(
    s: &ArsSession,
    onto: &Ontology,
    roster: &[(String, Value)],
    volt: &HashMap<String, Value>,
    niche: &HashMap<String, Value>,
    poses: &HashMap<String, Value>,
    include_pools: bool,
    task: &str,
) -> String {
    let mut out = String::new();
    out.push_str(&format!("ТЕМА: {}\n", s.theme));
    if include_pools {
        out.push_str("ОС-ТЕМЫ (каждой ОС — своя история):\n");
        for (i, oc) in s.oc_themes.iter().enumerate() {
            let name = oc.get("name").and_then(|x| x.as_str()).unwrap_or("");
            let theme = oc.get("theme").and_then(|x| x.as_str()).unwrap_or("");
            out.push_str(&format!("  {}. {}{}\n", i + 1, if name.is_empty() { "(выбери ОС из ростера, подходящую по теме)".to_string() } else { format!("ОС «{name}» — ") }, theme));
        }
        out.push_str("\nОС-РОСТЕР (только эти имена легальны; канон-локи машина впишет сама):\n");
        for (name, oc) in roster.iter().take(24) {
            out.push_str(&format!(
                "  {} — hair: {}; eyes: {}; body: {}\n",
                name,
                oc.get("hair").and_then(|x| x.as_str()).unwrap_or(""),
                oc.get("eyes").and_then(|x| x.as_str()).unwrap_or(""),
                oc.get("body_type").and_then(|x| x.as_str()).unwrap_or(""),
            ));
        }
    }
    out.push_str("\nОКРУЖЕНИЯ (ENV): ");
    let mut envs: Vec<&String> = onto.env.keys().collect();
    envs.sort();
    for id in envs {
        out.push_str(&format!("{} {}; ", id, onto.env[id].get("name").and_then(|x| x.as_str()).unwrap_or("")));
    }
    out.push_str("\nСВЕТ (LP): ");
    let mut lps: Vec<&String> = onto.lp.keys().collect();
    lps.sort();
    for id in lps {
        out.push_str(&format!("{} {}; ", id, onto.lp[id].get("name").and_then(|x| x.as_str()).unwrap_or("")));
    }
    out.push_str("\nВАЙБЫ (E): ");
    let mut es: Vec<&String> = onto.vibe.keys().collect();
    es.sort();
    for id in es {
        out.push_str(&format!("{} {}; ", id, onto.vibe[id].get("name").and_then(|x| x.as_str()).unwrap_or("")));
    }
    if include_pools {
        out.push_str("\nВОЛЬТ-АРХЕТИПЫ (VL): ");
        let mut vl: Vec<(&String, &Value)> = volt.iter().collect();
        vl.sort_by(|a, b| a.0.cmp(b.0));
        for (id, a) in vl {
            out.push_str(&format!("{} {}; ", id, a.get("name").and_then(|x| x.as_str()).unwrap_or("")));
        }
        out.push_str("\nНИША-АРХЕТИПЫ (N): ");
        let mut nn: Vec<(&String, &Value)> = niche.iter().collect();
        nn.sort_by(|a, b| a.0.cmp(b.0));
        for (id, a) in nn {
            out.push_str(&format!("{} {}; ", id, a.get("name").and_then(|x| x.as_str()).unwrap_or("")));
        }
    }
    out.push_str("\nПОЗЫ (PL): ");
    let mut pl: Vec<(&String, &Value)> = poses.iter().collect();
    pl.sort_by(|a, b| a.0.cmp(b.0));
    for (id, p) in pl {
        out.push_str(&format!("{} {}; ", id, p.get("name").and_then(|x| x.as_str()).unwrap_or("")));
    }
    out.push_str("\n\nОБЩЕЕ: КРОТКО! reveal ≤ 12 слов, scene ≤ 8 слов, thesis ≤ 14 слов — длинные ответы ОБРЕЗАЮТСЯ и пропадают. \n");
    out.push_str(task);
    out
}

fn expand_exp_prompt(s: &ArsSession, poses: &HashMap<String, Value>) -> String {
    let mut out = format!("ТЕМА батча (EXP её НЕ касается): {}\n\nПОЗЫ (PL): ", s.theme);
    let mut pl: Vec<(&String, &Value)> = poses.iter().collect();
    pl.sort_by(|a, b| a.0.cmp(b.0));
    for (id, p) in pl {
        out.push_str(&format!("{} {}; ", id, p.get("name").and_then(|x| x.as_str()).unwrap_or("")));
    }
    out.push_str("\n\nЗАДАЧА: EXP-программа — 5 проверок ВНЕ темы (проверяем механики, не тему): α,β,γ,δ — пары с РОВНО ОДНОЙ переменной (state_a/state_b), ι — соло-реплика золотой формулы (мокрый купальник в сухой постановке). kind ∈ tone|state|framing|channel|replica. hypothesis — по-русски: ЧТО проверяем и какой результат = успех.\nВерни СТРОГО один JSON: {\"exp_program\":[5 объектов]}\nФормат: {\"letter\":\"α\",\"kind\":\"state\",\"hypothesis\":\"...\",\"pose\":\"PL13\",\"channel\":\"bumps|pantyline|on_skin|swim_wet\",\"register\":\"student|young|milf\",\"framing\":\"close-up|cowboy shot|upper body\",\"state_a\":\"...\",\"state_b\":\"...|null\",\"garment\":\"вещь EN 1-3 слова\"}");
    out
}

/// Нормализация и обогащение: Rust — авторитет по числам (рейтинги, регистры,
/// расовый каст, палитры, кости, стеки, Дрессер); LLM — по смыслу (reveal/scene/…).
#[allow(clippy::too_many_arguments)]
fn normalize_expand(s: &mut ArsSession, raw: Value) -> Result<(), String> {
    let onto = load_ontology()?;
    let palettes = load_palettes()?;
    let poses = load_poses()?;
    let races = load_races_active()?;
    let roster = load_oc_roster()?;
    let (volt, niche) = load_archetypes()?;
    let (carrier_counts, _mech) = load_carrier_counts()?;
    let dresser = read_json_file(&specs_dir().join("dresser.json"))?;
    // sheer-носители в стеки не берём (diversity: sheer-кадры ≤40% R+)
    let sheer_carriers: Vec<String> = read_json_file(&specs_dir().join("carriers.json"))
        .ok()
        .and_then(|v| {
            let mut out = Vec::new();
            if let Some(classes) = v.get("classes").and_then(|x| x.as_object()) {
                for (_c, arr) in classes {
                    if let Some(list) = arr.as_array() {
                        for item in list {
                            if item.get("sheer_family").and_then(|x| x.as_bool()).unwrap_or(false) {
                                if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                                    out.push(id.to_string());
                                }
                            }
                        }
                    }
                }
            }
            Some(out)
        })
        .unwrap_or_default();

    let title = raw.get("title").and_then(|x| x.as_str()).unwrap_or("Untitled").trim().to_string();
    let law = raw.get("law_paragraph").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if law.chars().count() < 80 {
        return Err("ars: law_paragraph слишком короткий — тема не раскрыта".into());
    }
    let mut theme_words: Vec<String> = raw
        .get("theme_words")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).map(|w| w.trim().to_lowercase()).filter(|w| w.chars().count() >= 3).collect())
        .unwrap_or_default();
    theme_words.dedup();
    if theme_words.len() < 4 {
        return Err("ars: theme_words < 4 — раскрытию не за что зацепиться".into());
    }
    let acts: Vec<String> = raw
        .get("acts")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).map(|t| t.trim().to_uppercase()).collect())
        .unwrap_or_default();
    let mut slots_raw = raw.get("slots").and_then(|x| x.as_array()).ok_or("ars: нет slots[]")?.clone();
    let exp_raw = raw.get("exp_program").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    if slots_raw.len() != 24 {
        return Err(format!("ars: слотов {}, ожидается 24 (3 OC + 21 мейн)", slots_raw.len()));
    }
    if exp_raw.len() != 5 {
        return Err(format!("ars: exp_program — {}, ожидается 5 (α,β,γ,δ,ι)", exp_raw.len()));
    }
    // жанровая квота 15/4/2: LLM предлагает (маркеры ARCH в thesis уважаем),
    // Rust доводит до закона — при дефиците/излишке переназначает без маркеров.
    {
        let desired: [&str; 21] = [
            "VOLT", "VOLT", "NICHE", "VOLT", "VOLT", "NICHE", "VOLT", "VOLT",
            "VOLT", "VOLT", "VOLT", "VOLT", "NICHE", "EXQUISITE", "VOLT",
            "VOLT", "NICHE", "EXQUISITE", "VOLT", "VOLT", "VOLT",
        ];
        let mut genres: Vec<String> = slots_raw.iter().skip(3).map(|v| v.get("genre").and_then(|x| x.as_str()).unwrap_or("VOLT").to_uppercase()).collect();
        let pin_of = |th: &str| -> Option<&'static str> {
            let t = th.to_uppercase();
            if t.contains("ARCH: VL") { Some("VOLT") } else if t.contains("ARCH: N") { Some("NICHE") } else { None }
        };
        let mut pinned: Vec<Option<&'static str>> = Vec::new();
        let mut pinned_genres: std::collections::HashMap<usize, String> = std::collections::HashMap::new();
        let mut pinned_counts = (0usize, 0usize, 0usize); // (V, N, E)
        for (j, g) in genres.iter().enumerate() {
            let raw_slot = &slots_raw[j + 3];
            let pin = pin_of(raw_slot.get("thesis").and_then(|x| x.as_str()).unwrap_or(""));
            if let Some(p) = pin {
                match p {
                    "VOLT" => pinned_counts.0 += 1,
                    "NICHE" => pinned_counts.1 += 1,
                    _ => pinned_counts.2 += 1,
                }
                pinned_genres.insert(j, p.to_string());
            }
            pinned.push(pin);
            let _ = g;
        }
        // пин ПЕРЕЗАПИСЫВАЕТ жанр слота — иначе счёт врёт
        for (j, g) in pinned_genres {
            genres[j] = g;
        }
        let quota = (15usize, 4usize, 2usize);
        let mut remaining = (
            quota.0.saturating_sub(pinned_counts.0),
            quota.1.saturating_sub(pinned_counts.1),
            quota.2.saturating_sub(pinned_counts.2),
        );
        if pinned_counts.0 > quota.0 || pinned_counts.1 > quota.1 || pinned_counts.2 > quota.2 {
            return Err(format!(
                "ars: ARCH-маркеров больше квоты (VOLT {}/{}, NICHE {}/{}, EXQ {}/2) — поправь промпт",
                pinned_counts.0, quota.0, pinned_counts.1, quota.1, pinned_counts.2
            ));
        }
        // чистое заполнение квот: VOLT → NICHE → EXQ (позиция не важна,
        // важен закон 15/4/2 — распределение по актам делает остальное)
        for (j, pin) in pinned.iter().enumerate() {
            if pin.is_some() {
                continue;
            }
            let assigned = if remaining.0 > 0 {
                remaining.0 -= 1;
                Some("VOLT")
            } else if remaining.1 > 0 {
                remaining.1 -= 1;
                Some("NICHE")
            } else if remaining.2 > 0 {
                remaining.2 -= 1;
                Some("EXQUISITE")
            } else {
                None
            };
            if let Some(g) = assigned {
                genres[j] = g.to_string();
            }
        }
        let _ = desired;
        let (nv, nn_, ne) = (genres.iter().filter(|g| g.as_str() == "VOLT").count(), genres.iter().filter(|g| g.as_str() == "NICHE").count(), genres.iter().filter(|g| g.as_str() == "EXQUISITE").count());
        if (nv, nn_, ne) != (15, 4, 2) {
            return Err(format!("ars: жанровый спред после доводки VOLT/NICHE/EXQ = {nv}/{nn_}/{ne}, ожидается 15/4/2"));
        }
        for (j, g) in genres.iter().enumerate() {
            if let Some(obj) = slots_raw[j + 3].as_object_mut() {
                obj.insert("genre".into(), json!(g));
            }
        }
    }

    let mut rng = ArsRng::new(&format!("{}|{}|ars-noveau/v{}", s.slug, s.theme, ARS_VERSION));

    /* --- окно палитр: последние 3 сданных батча файл-истины --- */
    let mut excluded: HashSet<String> = HashSet::new();
    let chron = crate::textgates::chronicle_state();
    for slug in chron.window_slugs.iter() {
        if let Ok(text) = std::fs::read_to_string(batches_dir().join(format!("{slug}.md"))) {
            let b = crate::textgates::parse_batch(slug, &text);
            for slot in b.slots.iter() {
                if !slot.palette.is_empty() {
                    excluded.insert(slot.palette.to_uppercase());
                }
            }
        }
    }
    let mut palette_pool: Vec<Value> = palettes
        .iter()
        .filter(|p| !excluded.contains(&p.get("id").and_then(|x| x.as_str()).unwrap_or("").to_uppercase()))
        .cloned()
        .collect();
    rng.shuffle(&mut palette_pool);
    if palette_pool.len() < 30 {
        return Err(format!("ars: пул палитр после окна — {}, нужно ≥30", palette_pool.len()));
    }

    /* --- рейтинги мейнов: R+×14 · R×5 · PG-13×2 по актам (8/7/6) --- */
    const RATING_PATTERN: [&str; 21] = [
        "R+", "R+", "R+", "R", "R+", "R+", "R", "R+", // акт I
        "R+", "R+", "R+", "R+", "R", "PG-13", "R+", // акт II
        "R+", "R", "PG-13", "R+", "R", "R+", // акт III
    ];
    /* --- регистры третями: 7 student / 7 young / 7 milf --- */
    const REGISTER_PATTERN: [&str; 21] = [
        "student", "student", "young", "milf", "young", "student", "young", "milf",
        "student", "young", "milf", "young", "student", "milf", "young",
        "student", "milf", "young", "milf", "student", "milf",
    ];

    /* --- расовый каст 10/21 --- */
    let mut main_idx: Vec<usize> = (0..21).collect();
    rng.shuffle(&mut main_idx);
    let cast_idx: HashSet<usize> = main_idx.iter().copied().take(10).collect();
    let mut race_pool: Vec<Value> = races.clone();
    rng.shuffle(&mut race_pool);

    /* --- swim_wet: максимум 1 R+ слот на батч --- */
    let swim_slot: usize = (rng.next_f64() * 21.0) as usize % 21;

    let mut used_palettes = 0usize;
    let mut used_poses: HashSet<String> = HashSet::new();
    let mut used_dice: HashSet<String> = HashSet::new();
    let mut used_stacks: HashSet<String> = HashSet::new();
    let mut used_k: HashSet<u32> = HashSet::new();
    let mut light_counter = 0usize;
    let closers = ["action-close", "image-close", "dialogue", "long-fused", "fragment-pair"];
    let framings = ["cowboy shot", "upper body", "close-up"];
    let body_rot = ["A", "B", "C", "S"];
    let pos_rot = ["E", "L", "U", "F"];
    let phys_rot = ["D", "M", "I"];

    let mut slots_out: Vec<Value> = Vec::with_capacity(24);
    for (i, raw_slot) in slots_raw.iter().enumerate() {
        let pos_num = i + 1;
        let genre = if i < 3 { "OC".to_string() } else { raw_slot.get("genre").and_then(|x| x.as_str()).unwrap_or("VOLT").to_uppercase() };
        let rating = if i < 3 { "R+".to_string() } else { RATING_PATTERN[i - 3].to_string() };
        let register = if i < 3 {
            raw_slot.get("register").and_then(|x| x.as_str()).unwrap_or("young").to_string()
        } else {
            REGISTER_PATTERN[i - 3].to_string()
        };
        let act = if i < 3 { "I".to_string() } else if i < 11 { "I".to_string() } else if i < 18 { "II".to_string() } else { "III".to_string() };

        // валидация окружение/свет/вайб/поза (LLM-ids; мусор → детерминированная замена)
        let env_id = {
            let got = raw_slot.get("env").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            if onto.env.contains_key(&got) { got } else { format!("ENV{:02}", 1 + (rng.next_f64() * 12.0) as usize % 12) }
        };
        let lp_id = {
            let got = raw_slot.get("light").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            if onto.lp.contains_key(&got) { got } else { format!("LP{:02}", 1 + (rng.next_f64() * 8.0) as usize % 8) }
        };
        let vibe_id = {
            let got = raw_slot.get("vibe").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            if onto.vibe.contains_key(&got) { got } else { format!("E{:02}", 1 + (rng.next_f64() * 8.0) as usize % 8) }
        };
        let mut pose_id = {
            let got = raw_slot.get("pose").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            if poses.contains_key(&got) { got } else { format!("PL{:02}", 1 + (rng.next_f64() * 48.0) as usize % 48) }
        };
        // позы уникальны в батче (EXP-пары — исключение §10)
        {
            let pl_keys: Vec<String> = poses.keys().cloned().collect();
            let mut guard = 0;
            while used_poses.contains(&pose_id) && guard < 200 {
                pose_id = pl_keys[(rng.next_f64() * pl_keys.len() as f64) as usize % pl_keys.len()].clone();
                guard += 1;
            }
            used_poses.insert(pose_id.clone());
        }
        let env = onto.env[&env_id].clone();
        let lp = onto.lp[&lp_id].clone();
        let vibe = onto.vibe[&vibe_id].clone();
        let pose = poses[&pose_id].clone();

        // архетип
        let (arch, arch_name, arch_hint) = if genre == "VOLT" {
            let got = raw_slot.get("arch").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            let id = if volt.contains_key(&got) { got } else { format!("VL{:02}", 1 + (rng.next_f64() * 30.0) as usize % 30) };
            let a = &volt[&id];
            (id, a.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(), a.get("hint").and_then(|x| x.as_str()).unwrap_or("").to_string())
        } else if genre == "NICHE" {
            let got = raw_slot.get("arch").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            let id = if niche.contains_key(&got) { got } else { format!("N{:02}", 1 + (rng.next_f64() * 50.0) as usize % 50) };
            let a = &niche[&id];
            (id, a.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(), a.get("hint").and_then(|x| x.as_str()).unwrap_or("").to_string())
        } else {
            (String::new(), String::new(), String::new())
        };

        // OC-канон
        let (oc_name, oc_theme, canon_line, oc_body, oc_hair, oc_eyes) = if genre == "OC" {
            let want = raw_slot.get("oc").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            // имя из LLM должно быть в ростере; ОС-тема — по порядку приказа
            let name = if roster.iter().any(|(n, _)| n.eq_ignore_ascii_case(&want)) {
                roster.iter().find(|(n, _)| n.eq_ignore_ascii_case(&want)).unwrap().0.clone()
            } else if let Some(explicit) = s.oc_themes.get(i).and_then(|t| t.get("name")).and_then(|x| x.as_str()) {
                explicit.to_string()
            } else {
                roster[(rng.next_f64() * roster.len() as f64) as usize % roster.len()].0.clone()
            };
            let canon = load_oc_canon_full(&name).unwrap_or(json!({}));
            let theme = s.oc_themes.get(i.min(s.oc_themes.len() - 1)).and_then(|t| t.get("theme")).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let body = canon.get("body_type").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let body_clean = body.split(", FAM").next().unwrap_or(&body).trim().to_string();
            let marks = canon
                .get("signature_marks")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "))
                .or_else(|| canon.get("signature_marks").and_then(|x| x.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            let line = format!(
                "{name} — {}, {}, {}, {}{}",
                canon.get("hair").and_then(|x| x.as_str()).unwrap_or(""),
                canon.get("eyes").and_then(|x| x.as_str()).unwrap_or(""),
                canon.get("skin").and_then(|x| x.as_str()).unwrap_or(""),
                body_clean,
                if marks.is_empty() { String::new() } else { format!(", {marks}") }
            );
            (
                name,
                theme,
                line,
                body_clean,
                canon.get("hair").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                canon.get("eyes").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            )
        } else {
            (String::new(), String::new(), String::new(), String::new(), String::new(), String::new())
        };

        // раса (каст) + фича
        let (race_id, race_name, race_feature) = if genre != "OC" && cast_idx.contains(&(i - 3)) {
            let r = &race_pool[(i - 3) % race_pool.len()];
            let feats: Vec<String> = r
                .get("features")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|f| !f.contains("SOL") && !f.starts_with("none")).map(|f| f.to_string()).collect())
                .unwrap_or_default();
            (
                r.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                r.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                if feats.is_empty() { String::new() } else { feats[(rng.next_f64() * feats.len() as f64) as usize % feats.len()].to_lowercase() },
            )
        } else {
            (String::new(), String::new(), String::new())
        };

        // Дрессер
        let channel_hint = raw_slot.get("channel").and_then(|x| x.as_str()).map(|x| x.to_string());
        let channel_hint = channel_hint.as_deref();
        let dress = if genre == "OC" || rating == "R+" {
            let hint = if channel_hint == Some("swim_wet") && i - 3 != swim_slot { None } else { channel_hint };
            dress_for(&rating, hint, &mut rng, &dresser)
        } else {
            dress_for(&rating, None, &mut rng, &dresser)
        };
        let channel = dress.get("channel").and_then(|x| x.as_str()).unwrap_or("").to_string();

        // палитра
        let palette = &palette_pool[used_palettes % palette_pool.len()];
        used_palettes += 1;

        // кости (уникальная сигнатура в батче)
        let mut roll = roll_dice(&mut rng);
        let mut tries = 0;
        while used_dice.contains(&roll.signature) && tries < 30 {
            roll = roll_dice(&mut rng);
            tries += 1;
        }
        used_dice.insert(roll.signature.clone());

        // стек core-4 (FABRIC + BODY + POSITION + PHYSICS), уникальная четвёрка,
        // без sheer-носителей (анти N28-ловушка)
        let stack = loop {
            let w = "W";
            let b = body_rot[(rng.next_f64() * 4.0) as usize % 4];
            let p = pos_rot[(rng.next_f64() * 4.0) as usize % 4];
            let d = phys_rot[(rng.next_f64() * 3.0) as usize % 3];
            let cc = |l: &str| *carrier_counts.get(l).unwrap_or(&30) as usize;
            let sig = format!(
                "CR-{w}{:02} + CR-{b}{:02} + CR-{p}{:02} + CR-{d}{:02}",
                1 + (rng.next_f64() * cc(w) as f64) as usize % cc(w).max(1),
                1 + (rng.next_f64() * cc(b) as f64) as usize % cc(b).max(1),
                1 + (rng.next_f64() * cc(p) as f64) as usize % cc(p).max(1),
                1 + (rng.next_f64() * cc(d) as f64) as usize % cc(d).max(1)
            );
            let sheer_hit = sig.split(" + ").any(|cr| sheer_carriers.iter().any(|s| sig.contains(s.as_str()) && cr.contains(s.as_str())));
            if !used_stacks.contains(&sig) && !sheer_hit || tries > 60 {
                used_stacks.insert(sig.clone());
                break sig;
            }
        };

        // K-кинетика (уникальная в батче)
        let k_id = loop {
            let k = (10 + (rng.next_f64() * 90.0) as usize) as u32;
            if !used_k.contains(&k) {
                used_k.insert(k);
                break k;
            }
        };

        let lead = match channel.as_str() {
            "pantyline" | "R-layers" => "hips",
            "PG13-tease" => "legs",
            _ => "chest",
        };
        let framing = if rating == "PG-13" {
            "cowboy shot".to_string()
        } else {
            framings[(light_counter) % framings.len()].to_string()
        };
        light_counter += 1;
        let closer = closers[i % closers.len()].to_string();

        let anchor = {
            let got = raw_slot.get("anchor").and_then(|x| x.as_str()).unwrap_or("").trim().to_lowercase();
            let ok = !got.is_empty() && got.chars().count() <= 48 && got.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if ok { got } else { "ars-slot".to_string() }
        };

        // выражение глаз из вайба
        let eye_expr = match vibe_id.as_str() {
            "E01" => "soft", "E02" => "sharp", "E03" => "distant", "E04" => "playful",
            "E05" => "shy", "E06" => "fever-bright", "E07" => "level", _ => "warm",
        };

        slots_out.push(json!({
            "pos": format!("P{pos_num:02}"), "posNum": pos_num, "act": act,
            "genre": genre, "rating": rating,
            "oc": if oc_name.is_empty() { Value::Null } else { json!(oc_name) },
            "ocTheme": if oc_theme.is_empty() { Value::Null } else { json!(oc_theme) },
            "canonLine": if canon_line.is_empty() { Value::Null } else { json!(canon_line) },
            "anchor": anchor, "arch": if arch.is_empty() { Value::Null } else { json!(arch) },
            "archName": arch_name, "archHint": arch_hint,
            "reveal": raw_slot.get("reveal").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            "scene": raw_slot.get("scene").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            "thesis": raw_slot.get("thesis").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            "envId": env_id, "envName": env.get("name").and_then(|x| x.as_str()).unwrap_or(""),
            "envHint": env.get("scene_hint").and_then(|x| x.as_str()).unwrap_or(""),
            "envLightFn": env.get("light_fn").and_then(|x| x.as_str()).unwrap_or(""),
            "vibeId": vibe_id, "vibeName": vibe.get("name").and_then(|x| x.as_str()).unwrap_or(""),
            "vibeTags": vibe.get("tags").and_then(|x| x.as_str()).unwrap_or(""),
            "lightId": lp_id, "lightName": lp.get("name").and_then(|x| x.as_str()).unwrap_or(""),
            "lightRecipe": lp.get("recipe").and_then(|x| x.as_str()).unwrap_or(""),
            "lightFn": lp.get("light_fn").and_then(|x| x.as_str()).unwrap_or(""),
            "poseId": pose_id, "poseName": pose.get("name").and_then(|x| x.as_str()).unwrap_or(""),
            "poseSd": pose.get("sd").and_then(|x| x.as_str()).unwrap_or(""),
            "raceId": if race_id.is_empty() { Value::Null } else { json!(race_id) },
            "raceName": if race_name.is_empty() { Value::Null } else { json!(race_name) },
            "raceFeature": if race_feature.is_empty() { Value::Null } else { json!(race_feature) },
            "hair": if oc_hair.is_empty() { raw_slot.get("eyes").and_then(|x| x.as_str()).map(|_| Value::Null).unwrap_or(Value::Null) } else { json!(oc_hair) },
            "eyes": if oc_eyes.is_empty() { raw_slot.get("eyes").and_then(|x| x.as_str()).map(|e| json!(e)).unwrap_or(Value::Null) } else { json!(oc_eyes) },
            "eyeExpr": eye_expr,
            "body": if oc_body.is_empty() { json!(body_block(&register, None)) } else { json!(oc_body) },
            "register": register, "lead": lead, "closer": closer, "framing": framing, "kId": k_id,
            "paletteId": palette.get("id").and_then(|x| x.as_str()).unwrap_or(""),
            "paletteSd": palette.get("sd_fragment").and_then(|x| x.as_str()).unwrap_or(""),
            "diceSig": roll.signature, "diceInstr": roll.instructions,
            "stack": stack,
            "dress": dress,
        }));
    }

    /* --- EXP-программа: нормализация 5 проверок --- */
    let exp_eye_colors = ["hazel", "grey", "blue", "green", "brown", "gold"];
    let mut exp_out: Vec<Value> = Vec::with_capacity(5);
    for (i, e) in exp_raw.iter().enumerate() {
        let letter = EXP_LETTERS[i].to_string();
        let mut pose_id = {
            let got = e.get("pose").and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            if poses.contains_key(&got) { got } else { format!("PL{:02}", 1 + (rng.next_f64() * 48.0) as usize % 48) }
        };
        let pose = poses[&pose_id].clone();
        let kind = e.get("kind").and_then(|x| x.as_str()).unwrap_or("state").to_string();
        let register = e.get("register").and_then(|x| x.as_str()).unwrap_or("student").to_string();
        let channel = {
            let got = e.get("channel").and_then(|x| x.as_str()).unwrap_or("pantyline").to_string();
            if RPLUS_CHANNELS.contains(&got.as_str()) { got } else { "pantyline".to_string() }
        };
        // EXP-позы не пересекаются с мейн-слотами (diversity: уникальность вне §10-пар)
        {
            let pl_keys: Vec<String> = poses.keys().cloned().collect();
            let mut guard = 0;
            while used_poses.contains(&pose_id) && guard < 200 {
                pose_id = pl_keys[(rng.next_f64() * pl_keys.len() as f64) as usize % pl_keys.len()].clone();
                guard += 1;
            }
            used_poses.insert(pose_id.clone());
        }
        let palette = &palette_pool[used_palettes % palette_pool.len()];
        used_palettes += 1;
        let dress_a = dress_for("R+", Some(&channel), &mut rng, &dresser);
        exp_out.push(json!({
            "letter": letter, "kind": kind,
            "hypothesis": e.get("hypothesis").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            "poseId": pose_id, "poseName": pose.get("name").and_then(|x| x.as_str()).unwrap_or(""),
            "poseSd": pose.get("sd").and_then(|x| x.as_str()).unwrap_or(""),
            "channel": channel, "register": register,
            "framing": e.get("framing").and_then(|x| x.as_str()).unwrap_or("close-up"),
            "stateA": e.get("state_a").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            "stateB": e.get("state_b").and_then(|x| x.as_str()).map(|x| x.to_string()),
            "garment": e.get("garment").and_then(|x| x.as_str()).unwrap_or("jersey shorts"),
            "dressA": dress_a,
            "paletteId": palette.get("id").and_then(|x| x.as_str()).unwrap_or(""),
            "paletteSd": palette.get("sd_fragment").and_then(|x| x.as_str()).unwrap_or(""),
            "eyeColor": exp_eye_colors[(rng.next_f64() * 6.0) as usize % 6],
            "bodyBlock": body_block(&register, None),
        }));
    }

    s.title = Some(title);
    s.law_paragraph = Some(law);
    s.theme_words = theme_words;
    s.acts = acts;
    s.slots = slots_out;
    s.exp_program = exp_out;
    s.stage = "expanded".into();
    s.progress = json!({ "step": "expand", "done": 24, "total": 24, "exp": 5 });
    Ok(())
}

/// Универсальный извлекатель слот-объектов из ответа LLM: {"slots":[…]},
/// голый массив, или произвольный объект с массивом карточек внутри.
fn slots_of(v: &Value) -> Vec<Value> {
    if let Some(arr) = v.get("slots").and_then(|x| x.as_array()) {
        return arr.clone();
    }
    if let Some(arr) = v.as_array() {
        return arr.clone();
    }
    if let Some(obj) = v.as_object() {
        for (_k, val) in obj {
            if let Some(arr) = val.as_array() {
                if !arr.is_empty() && arr.iter().all(|x| x.is_object()) && arr[0].get("genre").is_some() {
                    return arr.clone();
                }
            }
        }
    }
    Vec::new()
}

fn run_stage_expand(id: &str) -> Result<(), String> {
    crate::live::info(crate::live::BLOCK_EXPAND, "ARS NOVEAU: раскрываю тему (6 малых вызовов через мост)…");
    let mut s = load_session(id)?;
    // перераскрытие: честный сброс нижестоящих артефактов
    s.slots.clear();
    s.exp_program.clear();
    s.bricks.clear();
    s.draft_md = None;
    s.draft_sha10 = None;
    s.gate_receipts.clear();
    s.gate_hard_pass = None;
    s.gate_run_index = None;
    s.furnace = None;
    s.scribe_log.clear();
    s.title = None;
    s.law_paragraph = None;
    s.theme_words.clear();
    s.acts.clear();
    let onto = load_ontology()?;
    let roster = load_oc_roster()?;
    let (volt, niche) = load_archetypes()?;
    let poses = load_poses()?;

    /* вызов 1: мета (титул, закон, тема-слова, акты) */
    let meta_user = format!(
        "ТЕМА: {}\nОС-ТЕМЫ:\n{}\n\nВерни СТРОГО один JSON: {{\"title\":\"EN 2-4 слова\",\"law_paragraph\":\"EN проза: физика темы в 3 актах, 3-4 предложения\",\"theme_words\":[6-9 рисуемых EN слов],\"acts\":[\"ИМЯ АКТА I\",\"II\",\"III\"]}}",
        s.theme,
        s.oc_themes.iter().filter_map(|t| t.get("theme").and_then(|x| x.as_str())).enumerate().map(|(i, t)| format!("  {}. {}", i + 1, t)).collect::<Vec<_>>().join("\n")
    );
    let meta = extract_json_soft(&llm_retry(EXPAND_SYSTEM, &meta_user, "мета")?)?;

    /* вызов 2: 3 OC-карточки */
    let oc_user = expand_slots_prompt(&s, &onto, &roster, &volt, &niche, &poses, true,
        "ЗАДАЧА: верни ровно 3 OC-карточки (P01, P02, P03; genre=OC, rating машина поставит R+ сама): каждая ОС — своя история по своей теме. Формат: {\"pos\":1,\"genre\":\"OC\",\"oc\":\"Имя\",\"pose\":\"PL32\",\"env\":\"ENV01\",\"vibe\":\"E03\",\"light\":\"LP05\",\"channel\":\"bumps|pantyline|on_skin|swim_wet или null\",\"anchor\":\"kebab\",\"reveal\":\"...\",\"scene\":\"...\",\"thesis\":\"EN проза 1-2 предложения\",\"arch\":null,\"eyes\":\"цвет или null\"}\nВерни СТРОГО один JSON: {\"slots\":[3 объекта]}");
    let oc_slots = extract_json_soft(&llm_retry(EXPAND_SYSTEM, &oc_user, "OC-слоты")?)?;

    /* вызов 3: мейны акта I (8) */
    let a1_user = expand_slots_prompt(&s, &onto, &roster, &volt, &niche, &poses, false,
        "ЗАДАЧА: верни ровно 8 мейн-карточек акта I (DISCOVERY — первый контакт с темой). Спред: VOLT×6 + NICHE×2. pos 4..11. Формат: {\"pos\":4,\"genre\":\"VOLT|NICHE\",\"oc\":null,\"pose\":\"PL05\",\"env\":\"ENV02\",\"vibe\":\"E04\",\"light\":\"LP05\",\"channel\":\"bumps|pantyline|on_skin|swim_wet или null\",\"anchor\":\"kebab\",\"reveal\":\"...\",\"scene\":\"...\",\"thesis\":\"VOLT: ARCH: VLxx NAME · DEVICE: ... | NICHE: ARCH: Nxx · LAW: ... · PROOF: ...\",\"arch\":\"VL11|N05\",\"eyes\":\"цвет или null\"}\nВерни СТРОГО один JSON: {\"slots\":[8 объектов]}");
    let a1_slots = extract_json_soft(&llm_retry(EXPAND_SYSTEM, &a1_user, "акт I")?)?;

    /* вызов 4: мейны акта II (7) */
    let a2_user = expand_slots_prompt(&s, &onto, &roster, &volt, &niche, &poses, false,
        "ЗАДАЧА: верни ровно 7 мейн-карточек акта II (ESCALATION — нагнетание). Спред: VOLT×5 + NICHE×1 + EXQUISITE×1. pos 12..18. Тот же формат; EXQUISITE — ультра своего жанра, thesis EN проза.\nВерни СТРОГО один JSON: {\"slots\":[7 объектов]}");
    let a2_slots = extract_json_soft(&llm_retry(EXPAND_SYSTEM, &a2_user, "акт II")?)?;

    /* вызов 5: мейны акта III (6) */
    let a3_user = expand_slots_prompt(&s, &onto, &roster, &volt, &niche, &poses, false,
        "ЗАДАЧА: верни ровно 6 мейн-карточек акта III (CONSEQUENCE — что тема оставила). Спред: VOLT×4 + NICHE×1 + EXQUISITE×1. pos 19..24. Тот же формат.\nВерни СТРОГО один JSON: {\"slots\":[6 объектов]}");
    let a3_slots = extract_json_soft(&llm_retry(EXPAND_SYSTEM, &a3_user, "акт III")?)?;

    /* вызов 6: EXP-программа */
    let exp_user = expand_exp_prompt(&s, &poses);
    let exp = extract_json_soft(&llm_retry(EXPAND_SYSTEM, &exp_user, "EXP-программа")?)?;

    let mut slots_all: Vec<Value> = Vec::new();
    for part in [&oc_slots, &a1_slots, &a2_slots, &a3_slots] {
        let got = slots_of(part);
        if got.is_empty() {
            crate::live::warn(BLOCK_EXPAND, "часть ответа без слотов — пропуск (соберём честную ошибку, если слотов не хватит)");
        }
        slots_all.extend(got);
    }
    let raw = json!({
        "title": meta.get("title").cloned().unwrap_or(json!("Untitled")),
        "law_paragraph": meta.get("law_paragraph").cloned().unwrap_or(json!("")),
        "theme_words": meta.get("theme_words").cloned().unwrap_or(json!([])),
        "acts": meta.get("acts").cloned().unwrap_or(json!([])),
        "slots": slots_all,
        "exp_program": exp.get("exp_program").cloned().unwrap_or(json!([])),
    });
    crate::live::info(crate::live::BLOCK_EXPAND, &format!("мост ответил на все вызовы — нормализую ({} карточек)…", slots_all.len()));

    match normalize_expand(&mut s, raw) {
        Ok(()) => {
            save_session(&s)?;
            crate::live::info(BLOCK_EXPAND, &format!("EXPAND готов: {} «{}» — 24 слота + 5 EXP-проверок", s.slug, s.title.clone().unwrap_or_default()));
            Ok(())
        }
        Err(e) => {
            crate::live::warn(BLOCK_EXPAND, &format!("нормализация не прошла: {e} — честная ошибка, expand можно перезапустить"));
            Err(e)
        }
    }
}

/// Один вызов LLM с одним повтором при нечитаемом/обрезанном JSON.
fn llm_retry(system: &str, user: &str, what: &str) -> Result<String, String> {
    match llm_chat(system, user, false) {
        Ok(c) => {
            if extract_json_soft(&c).is_ok() {
                return Ok(c);
            }
            crate::live::warn(BLOCK_EXPAND, &format!("{what}: JSON нечитаем (обрез?) — повтор с правкой"));
            let repair = format!("{user}\n\nПРЕДЫДУЩИЙ ОТВЕТ БЫЛ ОБРЕЗАН ИЛИ НЕЧИТАЕМ. Возвращай КОМПАКТНЕЕ (короче строки, без лишней прозы) и СТРОГО один JSON целиком.");
            llm_chat(system, &repair, false)
        }
        Err(e) => Err(e),
    }
}

/* ================================================================== */
/* ASSEMBLE — Сборщик: брикеты для писца + скелет батча + EXP-болванки */
/* ================================================================== */

const MAIN_HAIRS: &[&str] = &[
    "long wavy chestnut hair", "short black bob", "silver low ponytail",
    "twin shoulder braids", "messy auburn curls", "sleek dark hime cut",
    "loose honey-blonde waves", "high ash-brown ponytail", "wet-look charcoal hair",
];
const MAIN_EYES: &[&str] = &["hazel", "grey", "blue", "green", "brown", "amber", "violet"];
const PLAIN_WASHES: &[&str] = &[
    "cool indigo light wash across her hips", "warm rust light wash along the wall",
    "pale firstlight glow along the floor", "soft ember light wash from the side",
];

fn kebab(s: &str) -> String {
    s.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>().split('-').filter(|w| !w.is_empty()).take(4).collect::<Vec<_>>().join("-")
}

fn slot_who(slot: &Value) -> String {
    let oc = slot.get("oc").and_then(|x| x.as_str()).unwrap_or("");
    if !oc.is_empty() {
        return oc.to_string();
    }
    let race = slot.get("raceName").and_then(|x| x.as_str()).unwrap_or("");
    if !race.is_empty() {
        return race.to_string();
    }
    "—".to_string()
}

/// Брикет — весь заказ слота одним текстом: «просто добавь воды».
pub fn build_brick(slot: &Value, theme_words: &[String]) -> Value {
    let pos = slot.get("pos").and_then(|x| x.as_str()).unwrap_or("");
    let dress = slot.get("dress").cloned().unwrap_or(json!({}));
    let states: Vec<String> = dress.get("states").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect()).unwrap_or_default();
    let hair = slot.get("hair").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let eyes = slot.get("eyes").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let body = slot.get("body").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let marks = slot.get("archHint").and_then(|x| x.as_str()).unwrap_or("");
    let mut rng = ArsRng::new(&format!("hair-eyes|{pos}"));
    let (hair, eyes) = if hair.is_empty() && eyes.is_empty() {
        (rng.pick(MAIN_HAIRS).to_string(), rng.pick(MAIN_EYES).to_string())
    } else {
        (hair, eyes)
    };
    let race = slot.get("raceName").and_then(|x| x.as_str()).unwrap_or("");
    let race_feature = slot.get("raceFeature").and_then(|x| x.as_str()).unwrap_or("");
    let character = if !race.is_empty() {
        format!("раса {} ({}) · волосы: {hair} · глаза: {eyes} · тело: {body}", race, race_feature)
    } else {
        format!("волосы: {hair} · глаза: {eyes} · тело: {body}")
    };
    let brick = format!(
        "БРИКЕТА {pos} — {genre} · {rating} · {poseId} {poseName} · {paletteId} · кость {diceSig}\n\
         РАСКРЫТИЕ ТЕМЫ (ACT {act}): {reveal}\n\
         СЦЕНА: {scene}\n\
         ОКРУЖЕНИЕ: {envName} — {envHint} (свет работает: {envLightFn})\n\
         СВЕТ: {lightName} — {lightRecipe} (light_fn: {lightFn})\n\
         ВАЙБ: {vibeName} — {vibeTags}\n\
         ПОЗА: {poseName} — {poseSd}\n\
         ПЕРСОНАЖ: {character}\n\
         ОДЕЖДА (ДРЕССЕР №29): канал {channel} · категория {category} · вещь «{garment}» · тон {tone} · состояния тегами: {statesJoined} · подслой: {underlayer} · NEG-веса: {negWeights}\n\
         СТЕК (core-4): {stack}\n\
         ФРЕЙМИНГ: {framing} · LEAD: {lead} · closer: {closer}\n\
         ПАЛИТРА (слова тегами в POS): {paletteSd}\n\
         ТЕМА-СЛОВА (≥2 обязаны войти в POS): {words}\n\
         КОСТЬ (ULTIMATE DICE): {diceInstr}\n\
         ЗАКОНЫ: RAW+ №23 (только Danbooru-теги, без прозы, ровно один финальный период, 25-70 тегов) · №26 (название темы НЕ в POS) · №28 (канал-тон-состояние: bumps — тёмная DRY вещь, свет НЕ на зоне заявки) · §9 (заявка рано в ран, свет-камера-контраст строят салиент) · G20 (одна hard-заявка на R+ слот) · лицо в хвосте: stylized 2D anime face, anime eyes ({eyes}, {expr}), small nose, small mouth · финал: masterpiece, best quality, anime artstyle.",
        genre = slot.get("genre").and_then(|x| x.as_str()).unwrap_or(""),
        rating = slot.get("rating").and_then(|x| x.as_str()).unwrap_or(""),
        poseId = slot.get("poseId").and_then(|x| x.as_str()).unwrap_or(""),
        poseName = slot.get("poseName").and_then(|x| x.as_str()).unwrap_or(""),
        paletteId = slot.get("paletteId").and_then(|x| x.as_str()).unwrap_or(""),
        diceSig = slot.get("diceSig").and_then(|x| x.as_str()).unwrap_or(""),
        act = slot.get("act").and_then(|x| x.as_str()).unwrap_or("I"),
        reveal = slot.get("reveal").and_then(|x| x.as_str()).unwrap_or(""),
        scene = slot.get("scene").and_then(|x| x.as_str()).unwrap_or(""),
        envName = slot.get("envName").and_then(|x| x.as_str()).unwrap_or(""),
        envHint = slot.get("envHint").and_then(|x| x.as_str()).unwrap_or(""),
        envLightFn = slot.get("envLightFn").and_then(|x| x.as_str()).unwrap_or(""),
        lightName = slot.get("lightName").and_then(|x| x.as_str()).unwrap_or(""),
        lightRecipe = slot.get("lightRecipe").and_then(|x| x.as_str()).unwrap_or(""),
        lightFn = slot.get("lightFn").and_then(|x| x.as_str()).unwrap_or(""),
        vibeName = slot.get("vibeName").and_then(|x| x.as_str()).unwrap_or(""),
        vibeTags = slot.get("vibeTags").and_then(|x| x.as_str()).unwrap_or(""),
        poseSd = slot.get("poseSd").and_then(|x| x.as_str()).unwrap_or(""),
        channel = dress.get("channel").and_then(|x| x.as_str()).unwrap_or(""),
        category = dress.get("category").and_then(|x| x.as_str()).unwrap_or(""),
        garment = dress.get("garment").and_then(|x| x.as_str()).unwrap_or(""),
        tone = dress.get("tone").and_then(|x| x.as_str()).unwrap_or(""),
        underlayer = dress.get("underlayer").and_then(|x| x.as_str()).unwrap_or(""),
        negWeights = dress.get("negWeights").and_then(|x| x.as_str()).unwrap_or(""),
        statesJoined = states.join(", "),
        stack = slot.get("stack").and_then(|x| x.as_str()).unwrap_or(""),
        framing = slot.get("framing").and_then(|x| x.as_str()).unwrap_or(""),
        lead = slot.get("lead").and_then(|x| x.as_str()).unwrap_or(""),
        closer = slot.get("closer").and_then(|x| x.as_str()).unwrap_or(""),
        paletteSd = slot.get("paletteSd").and_then(|x| x.as_str()).unwrap_or(""),
        diceInstr = slot.get("diceInstr").and_then(|x| x.as_str()).unwrap_or(""),
        expr = slot.get("eyeExpr").and_then(|x| x.as_str()).unwrap_or("soft"),
        words = theme_words.join(", "),
    );
    json!({
        "pos": pos, "genre": slot.get("genre"), "rating": slot.get("rating"),
        "oc": slot.get("oc"), "arch": slot.get("arch"),
        "thesis": slot.get("thesis"), "hair": hair, "eyes": eyes,
        "channel": dress.get("channel"), "claims": dress.get("claims"),
        "brick": brick,
    })
}

fn exp_slot_block(s: &ArsSession, prog: &Value, half: Option<&str>, pos_num: u32) -> Result<String, String> {
    let letter_raw = prog.get("letter").and_then(|x| x.as_str()).unwrap_or("?").to_string();
    let kind = prog.get("kind").and_then(|x| x.as_str()).unwrap_or("state").to_string();
    let state_b_present = prog.get("stateB").map(|x| !x.is_null()).unwrap_or(false);
    let is_solo = kind == "replica" || !state_b_present;
    let letter = if is_solo { "ι".to_string() } else { letter_raw };
    let channel = prog.get("channel").and_then(|x| x.as_str()).unwrap_or("pantyline");
    let register = prog.get("register").and_then(|x| x.as_str()).unwrap_or("student");
    let pose_id = prog.get("poseId").and_then(|x| x.as_str()).unwrap_or("PL13");
    let pose_name = prog.get("poseName").and_then(|x| x.as_str()).unwrap_or("");
    let pose_sd = prog.get("poseSd").and_then(|x| x.as_str()).unwrap_or("");
    let body = prog.get("bodyBlock").and_then(|x| x.as_str()).unwrap_or("slender body");
    let eye = prog.get("eyeColor").and_then(|x| x.as_str()).unwrap_or("hazel");
    let palette_id = prog.get("paletteId").and_then(|x| x.as_str()).unwrap_or("");
    let palette_sd = prog.get("paletteSd").and_then(|x| x.as_str()).unwrap_or("");
    let hypothesis = prog.get("hypothesis").and_then(|x| x.as_str()).unwrap_or("");
    let dress = prog.get("dressA").cloned().unwrap_or(json!({}));
    let states: Vec<String> = dress.get("states").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|v| v.as_str()).map(|t| t.to_string()).collect()).unwrap_or_default();
    let base_garment = prog.get("garment").and_then(|x| x.as_str()).unwrap_or("jersey shorts");

    let mut rng = ArsRng::new(&format!("exp|{}|{letter}", s.slug));
    let anchor = format!("exp-{kind}-pl{}", pose_id.trim_start_matches("PL"));
    let framing = prog.get("framing").and_then(|x| x.as_str()).unwrap_or("close-up").to_string();
    let framing_b = if framing == "close-up" { "cowboy shot".to_string() } else { "close-up".to_string() };
    // SALVAGE чистоты #2: поза/палитра/свет тоже вне темы (tide/water из sd — вон)
    let theme_low: Vec<String> = s.theme_words.iter().map(|w| w.to_lowercase()).collect();
    let hit = |t: &str| theme_low.iter().any(|w| !w.is_empty() && t.to_lowercase().contains(w.as_str()));
    let (pose_name, pose_sd) = if hit(&pose_name) || hit(&pose_sd) {
        ("standing".to_string(), "weight even on both feet".to_string())
    } else {
        (pose_name.to_string(), pose_sd.to_string())
    };
    let pose_sd_first = pose_sd.split(',').next().unwrap_or("").trim().to_string();
    let palette_sd = if hit(&palette_sd) { String::new() } else { palette_sd.to_string() };
    let wash_raw = PLAIN_WASHES[(rng.next_f64() * PLAIN_WASHES.len() as f64) as usize % PLAIN_WASHES.len()];
    let wash = if hit(wash_raw) { "neutral soft light wash".to_string() } else { wash_raw.to_string() };
    let sd_first = pose_sd_first.clone();

    // SALVAGE чистоты: EXP вне темы — Garment с тема-словами заменяется
    let theme_words: Vec<String> = s.theme_words.iter().cloned().collect();
    let base_garment = if theme_words.iter().any(|w| !w.is_empty() && base_garment.to_lowercase().contains(w.as_str())) {
        match channel {
            "bumps" => "oxblood knit top".to_string(),
            "swim_wet" => "dark one-piece swimsuit".to_string(),
            "on_skin" => "sport jersey".to_string(),
            _ => "ink-dark jersey shorts".to_string(),
        }
    } else {
        base_garment.to_string()
    };
    // переменная пары: ровно одна
    let (garment, var_tag, framing_use, note) = match (kind.as_str(), half) {
        ("tone", Some("A")) => (format!("{} {}", rng.pick(DARK_FABRIC_COLORS), base_garment), String::new(), framing.clone(), "тон dark"),
        // №28: bumps живёт ТОЛЬКО на тёмном — «тон» внутри тёмных цветов
        ("tone", Some("B")) => (
            format!("{} {}", rng.pick(DARK_FABRIC_COLORS), base_garment),
            String::new(),
            framing.clone(),
            if channel == "bumps" { "тон dark-вариант" } else { "тон light" },
        ),
        ("state", Some("A")) => (base_garment.to_string(), prog.get("stateA").and_then(|x| x.as_str()).unwrap_or("tight").to_string(), framing.clone(), "состояние А"),
        ("state", Some("B")) => (base_garment.to_string(), prog.get("stateB").and_then(|x| x.as_str()).unwrap_or("fabric clinging").to_string(), framing.clone(), "состояние Б"),
        ("framing", Some("A")) => (base_garment.to_string(), String::new(), framing.clone(), "кадр А"),
        ("framing", Some("B")) => (base_garment.to_string(), String::new(), framing_b.clone(), "кадр Б"),
        ("channel", Some("A")) => (base_garment.to_string(), prog.get("stateA").and_then(|x| x.as_str()).unwrap_or("taped nipples").to_string(), framing.clone(), "канал А"),
        ("channel", Some("B")) => (base_garment.to_string(), prog.get("stateB").and_then(|x| x.as_str()).unwrap_or("handbra").to_string(), framing.clone(), "канал Б"),
        (_, _) => (base_garment.to_string(), String::new(), framing.clone(), "соло-реплика"),
    };
    let partner = match letter.as_str() {
        "α" => 26, "β" => 28, "γ" => 30, "δ" => 32, _ => 0,
    };
    let thesis = if let Some(h) = half {
        if partner > 0 {
            format!("EXP {letter}-{h} · {note}: {hypothesis} — план identical с P{partner:02}.")
        } else {
            format!("EXP {letter} · соло-проба: {hypothesis}.")
        }
    } else {
        format!("EXP {letter} · соло-проба: {hypothesis}.")
    };

    // garment с кириллицей/темой — в машинный дефолт (EXP не доверяет LLM-тексту)
    let garment = if garment.chars().any(|c| !c.is_ascii()) {
        match channel { "bumps" => "oxblood knit top", "swim_wet" => "dark one-piece swimsuit", "on_skin" => "sport jersey", _ => "ink-dark jersey shorts" }.to_string()
    } else {
        garment
    };
    let mut pos_parts: Vec<String> = vec![
        "anime style".into(), "ecchi anime style".into(), "original character".into(), "1girl".into(), "solo".into(),
        body.to_string(), garment.clone(),
    ];
    // №28-гарантия: covered nipples в EXP тянет ткань-состояние за собой
    let low_states = states.iter().map(|s| s.to_lowercase()).collect::<Vec<_>>();
    if low_states.iter().any(|s| s.contains("covered nipples") || s.contains("clothed nipples"))
        && !low_states.iter().any(|s| s.contains("fabric clinging") || s.contains("sweat glistening") || s.contains("tight"))
    {
        pos_parts.push("fabric clinging".into());
        pos_parts.push("sweat glistening".into());
    }
    for st in states.iter() {
        pos_parts.push(st.clone());
    }
    if !var_tag.is_empty() {
        pos_parts.push(var_tag.clone());
    }
    pos_parts.push("extreme fanservice".into());
    pos_parts.push(format!("{pose_name} pose {sd_first}"));
    pos_parts.push(framing_use.clone());
    pos_parts.push("plain studio wall".into());
    pos_parts.push(wash.to_string());
    pos_parts.push(format!("{palette_sd}"));
    pos_parts.push(register.to_string());
    pos_parts.push("stylized 2D anime face".into());
    pos_parts.push(format!("anime eyes ({eye}, level)"));
    pos_parts.push("small nose".into());
    pos_parts.push("small mouth".into());
    pos_parts.push("masterpiece".into());
    pos_parts.push("best quality".into());
    pos_parts.push("anime artstyle".into());
    // дедуп тегов + вырез не-ascii (русские слова в EXP-болванках недопустимы)
    let mut seen_tags: Vec<String> = Vec::new();
    let mut clean_parts: Vec<String> = Vec::new();
    for t in pos_parts {
        let t = t.trim();
        if t.is_empty() { continue; }
        if t.chars().any(|c| !c.is_ascii()) { continue; }
        let tl = t.to_lowercase();
        if seen_tags.contains(&tl) { continue; }
        seen_tags.push(tl);
        clean_parts.push(t.to_string());
    }
    let pos = format!("{}.", clean_parts.join(", "));
    let neg = machine_neg("R+", channel, register);

    // стек EXP: тоже core-4, но каждый слот свой (анти-моно-механизм)
    let mut srng = ArsRng::new(&format!("exp-stack|{}|{letter}|{pos_num}", s.slug));
    let exp_stack = format!(
        "CR-W{:02} + CR-{}{:02} + CR-{}{:02} + CR-{}{:02}",
        1 + (srng.next_f64() * 30.0) as usize % 30,
        ["A", "B", "C", "S"][(srng.next_f64() * 4.0) as usize % 4],
        1 + (srng.next_f64() * 14.0) as usize % 14,
        ["E", "L", "U", "F"][(srng.next_f64() * 4.0) as usize % 4],
        1 + (srng.next_f64() * 20.0) as usize % 20,
        ["D", "M", "I"][(srng.next_f64() * 3.0) as usize % 3],
        1 + (srng.next_f64() * 15.0) as usize % 15,
    );
    Ok(format!(
        "P{pos_num:02} — {anchor} (EXP · — · R+ · {pose_id} · {palette_id})\nTHESIS: {thesis}\nSpine: {pose_id} {pose_name} · K{:02} · LEAD {} · {register} register · closer image-close\nStack: {exp_stack}\nPOS:\n\n{pos}\n\nNEG:\n\n{neg}\n",
        60 + pos_num,
        if channel == "pantyline" { "hips" } else { "chest" }
    ))
}

pub fn run_stage_assemble(id: &str) -> Result<(), String> {
    let mut s = load_session(id)?;
    if s.slots.is_empty() {
        return Err("ars: assemble требует expand".into());
    }
    // пересборка: сброс нижестоящих артефактов (пайплайн честно начинается заново)
    s.bricks.clear();
    s.draft_md = None;
    s.draft_sha10 = None;
    s.gate_receipts.clear();
    s.gate_hard_pass = None;
    s.gate_run_index = None;
    s.furnace = None;
    s.scribe_log.clear();
    crate::live::info(crate::live::BLOCK_COMPILE, "ARS NOVEAU: сборщик пакует брикеты…");

    // брикеты для писца
    let mut bricks = Vec::with_capacity(24);
    for slot in s.slots.iter() {
        bricks.push(build_brick(slot, &s.theme_words));
    }

    // скелет батча
    let mut md = String::new();
    md.push_str(&format!(
        "# THREAD 4 — Batch {}: \"{}\" — БАТЧ (RAW+ / данбуру-формат · ARS NOVEAU v{ARS_VERSION})\n\n",
        s.slug,
        s.title.clone().unwrap_or_else(|| s.theme.clone())
    ));
    md.push_str(&format!("{}\n\n", s.law_paragraph.clone().unwrap_or_default()));
    md.push_str(&format!("ТЕМА-СЛОВА: {}\n\n", s.theme_words.join(", ")));
    md.push_str(&format!(
        "ДВИЖОК (одноразовый): ars-noveau/v{ARS_VERSION} — LLM-раскрыватель темы (мост llm-bridge :3202, сессия {}; сборка Доу)\n\n",
        s.id
    ));
    md.push_str("ЖАНРЫ (легенда — вердикт T4-02: жанр обязан быть виден): **OC** — канон-локи персонажа, тема в слоте; **NICHE** — невозможный образ: раса делает ФИЗИЧЕСКУЮ работу в кадре, свидетель держит кадр, невозможное — первое считывание силуэта; **VOLT** — плоть: камера-участник, тело в движении, взгляд-вектор, экспозиция тегом; **EXQUISITE** — ультра своего жанра.\n");
    md.push_str("СТРУКТУРА (закон 24): 33 промпта = 3 OC + 21 мейн + 9 EXP-болванки (без темы) · спред мейнов R+×14 · R×5 · PG-13×2 · расовый каст 10/21 · регистры третями.\n");
    md.push_str("RENDER PROTOCOL: RAW+ (закон №23) — чистые Danbooru-теги, БЕЗ прозы: палитра под каждый промпт + аниме-лицо тегом + квалити-цвет. Спайн назначен до первого слова; гейты читают те же числа.\n\n");

    // ACT I → OC + мейны 1-8; ACT II → 9-15; ACT III → 16-21
    let act_name = |n: usize| -> String {
        let raw = s.acts.get(n).cloned().unwrap_or_default();
        if raw.is_empty() {
            ["DISCOVERY", "ESCALATION", "CONSEQUENCE"][n].to_string()
        } else {
            raw
        }
    };
    md.push_str(&format!("════════════════════════════════════════════════════════════════════════\nACT I — {}\n════════════════════════════════════════════════════════════════════════\n\n", act_name(0)));
    for (i, slot) in s.slots.iter().enumerate() {
        let pos = slot.get("pos").and_then(|x| x.as_str()).unwrap_or("P??");
        let genre = slot.get("genre").and_then(|x| x.as_str()).unwrap_or("");
        let who = slot_who(slot);
        let rating = slot.get("rating").and_then(|x| x.as_str()).unwrap_or("");
        let pose_id = slot.get("poseId").and_then(|x| x.as_str()).unwrap_or("");
        let palette_id = slot.get("paletteId").and_then(|x| x.as_str()).unwrap_or("");
        md.push_str(&format!(
            "{pos} — {} ({genre} · {who} · {rating} · {pose_id} · {palette_id})\n",
            slot.get("anchor").and_then(|x| x.as_str()).unwrap_or("anchor")
        ));
        md.push_str(&format!("THESIS: {}\n", slot.get("thesis").and_then(|x| x.as_str()).unwrap_or("")));
        if genre == "OC" {
            md.push_str(&format!("Canon: {}\n", slot.get("canonLine").and_then(|x| x.as_str()).unwrap_or("")));
        }
        md.push_str(&format!(
            "Spine: {pose_id} {} · K{:02} · LEAD {} · {} register · closer {}{}\n",
            slot.get("poseName").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("kId").and_then(|x| x.as_u64()).unwrap_or(0),
            slot.get("lead").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("register").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("closer").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("ocTheme").and_then(|x| x.as_str()).map(|t| format!(" · OC theme: {t}")).unwrap_or_default()
        ));
        md.push_str(&format!("Stack: {}\n", slot.get("stack").and_then(|x| x.as_str()).unwrap_or("")));
        md.push_str(&format!("POS:\n\n%%POS:{pos}%%\n\nNEG:\n\n%%NEG:{pos}%%\n\n"));
        // границы актов: после 8-го мейна и 15-го мейна
        let main_i = i as i64 - 3;
        if main_i == 7 {
            md.push_str(&format!("════════════════════════════════════════════════════════════════════════\nACT II — {}\n════════════════════════════════════════════════════════════════════════\n\n", act_name(1)));
        } else if main_i == 14 {
            md.push_str(&format!("════════════════════════════════════════════════════════════════════════\nACT III — {}\n════════════════════════════════════════════════════════════════════════\n\n", act_name(2)));
        }
    }

    // EXP OVERLAY — машинные болванки (канон T4-34: ноль свободы писца)
    md.push_str("════════════════════════════════════════════════════════════════════════\nEXP OVERLAY — 9 болванок (вне темы; пары α/β/γ/δ + соло ι; ноль свободы писца)\n════════════════════════════════════════════════════════════════════════\n\n");
    let mut pos_num = 25u32;
    for prog in s.exp_program.iter() {
        let letter = prog.get("letter").and_then(|x| x.as_str()).unwrap_or("ι").to_string();
        let kind_s = prog.get("kind").and_then(|x| x.as_str()).unwrap_or("state");
        let solo = kind_s == "replica" || prog.get("stateB").map(|x| x.is_null()).unwrap_or(true) || letter == "ι";
        if solo {
            md.push_str(&exp_slot_block(&s, prog, None, pos_num)?);
            md.push('\n');
            pos_num += 1;
        } else {
            md.push_str(&exp_slot_block(&s, prog, Some("A"), pos_num)?);
            md.push('\n');
            pos_num += 1;
            md.push_str(&exp_slot_block(&s, prog, Some("B"), pos_num)?);
            md.push('\n');
            pos_num += 1;
        }
    }

    // sha10 драфта
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(md.as_bytes());
    let sha10: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<Vec<String>>().join("")[..10].to_string();

    let mut s = s;
    s.bricks = bricks;
    s.draft_md = Some(md);
    s.draft_sha10 = Some(sha10);
    s.stage = "assembled".into();
    s.progress = json!({ "step": "assemble", "bricks": s.bricks.len(), "sha10": s.draft_sha10.clone().unwrap_or_default() });
    save_session(&s)?;
    crate::live::info(crate::live::BLOCK_COMPILE, &format!("сборка готова: {} брикетов + скелет (sha {})", s.bricks.len(), s.draft_sha10.clone().unwrap_or_default()));
    Ok(())
}

/* ================================================================== */
/* SCRIBE — писец: брикет → POS/NEG («просто добавь воды»)             */
/* ================================================================== */

const SCRIBE_SYSTEM: &str = r#"Ты — Писец THREAD 4. Из брикета («просто добавь воды») ты делаешь целый промпт: RAW+ POS-тег-ран и NEG-EXTRA.

ФОРМА POS: ОДНА строка Danbooru-тегов через запятую, 25-70 тегов (компактно и плотно, как P30-эталон), ровно один финальный период.
Обязательный скелет по порядку:
1) opener: anime style, ecchi anime style, original character, 1girl, solo,
2) форма тела (из брикета),
3) расовые теги (если есть) → волосы → глаза-цвет,
4) вещь + состояния канала ДОСЛОВНО из «ОДЕЖДА» (канал-тон-состояние: bumps = тёмная DRY вещь + covered nipples, clothed nipples, dark garment, fabric clinging, sweat glistening; свет НЕ на зоне),
5) заявка (claims) РАНО в ране; G20: одна hard-заявка на R+ слот,
6) окружение тегами (scene_hint) + свет тегами (recipe; light_fn соблюдать) + слова палитры (paletteSd),
7) поза тегом: «<pose name lowercase> pose <первый сегмент sd>» + фрейминг,
8) регистр тегом (student|young|milf),
9) лицо: stylized 2D anime face, anime eyes (ЦВЕТ, ВЫРАЖЕНИЕ), small nose, small mouth,
10) финал: masterpiece, best quality, anime artstyle.

КОСТИ (ULTIMATE DICE) — интерпретации граней задают ПОРЯДОК и подачу блоков 3-6 (A: порядок идентификации; B: подача одежды; C: интеграция темы; D: свет; E: ритм). Не ломай скелет — двигай блоки внутри легального конверта.

ВАЖНО ПРО ТЕМУ: ТЕМА-СЛОВА из брикета (например tide, altar, water, rising) — это РИСУЕМЫЕ ОБРАЗЫ темы; минимум ДВА из них обязаны войти в POS как теги-существительные («rising tide», «stone altar», «flood water»). №26 запрещает только НАЗВАНИЕ батча как тег — тема-слова это не название, они обязательны. без прозы, без artist-тегов, без свечей/ламп/факелов; без loli-токенов; тегиDanbooru-стиля строчными, через запятую.

NEG-EXTRA: только ДОПОЛНЕНИЯ к машинному NEG (счётчики вещи/состояний), без nudity-терминов (закон №25), без повторов машинных флооров. Обычно 0-4 тега.

OUTPUT: СТРОГО один JSON: {"slots":[{"pos":"P04","pos_tags":"...","neg_extra":["..."]}]} — по одному на каждый брикет, pos — точный как в брикете."#;

fn scribe_chunk_prompt(bricks: &[Value], theme_words: &[String]) -> String {
    let mut out = format!("ТЕМА-СЛОВА: {}\n\nБРИКЕТЫ:\n", theme_words.join(", "));
    for b in bricks {
        out.push_str(&format!("\n---\n{}\n", b.get("brick").and_then(|x| x.as_str()).unwrap_or("")));
    }
    out.push_str("\nВерни СТРОГО один JSON вида {\"slots\":[{\"pos\":...,\"pos_tags\":...,\"neg_extra\":[...]}]} для КАЖДОГО брикета выше.");
    out
}

fn validate_pos_tags(pos: &str, pos_tags: &str, brick: &Value, theme_words: &[String]) -> Result<(), String> {
    let t = pos_tags.trim();
    if t.split(',').count() < 22 || t.split(',').count() > 90 {
        return Err(format!("{pos}: тегов {}, ожидается 25-70", t.split(',').count()));
    }
    let low = t.to_lowercase();
    if !low.starts_with("anime style") {
        return Err(format!("{pos}: POS не начинается с opener"));
    }
    if !low.ends_with("anime artstyle.") {
        return Err(format!("{pos}: POS должен заканчиваться «anime artstyle.»"));
    }
    if !low.contains("anime eyes") || !low.contains("masterpiece") {
        return Err(format!("{pos}: нет фейс-лока или квалити"));
    }
    for banned in ["candle", "lamp", "lantern", "torch", "chandelier", "brazier", "loli", "shota", "signature", "watermark"] {
        if low.contains(banned) {
            return Err(format!("{pos}: POS несёт вечный флор «{banned}»"));
        }
    }
    if let Some(claims) = brick.get("claims").and_then(|x| x.as_array()) {
        let hits = claims
            .iter()
            .filter_map(|x| x.as_str())
            .filter(|c| low.contains(&c.to_lowercase()))
            .count();
        if claims.iter().any(|x| x.is_string()) && hits == 0 {
            let list: Vec<String> = claims.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect();
            return Err(format!("{pos}: ни одно состояние канала не вошло дословно ({})", list.join(" / ")));
        }
    }
    if brick.get("genre").and_then(|x| x.as_str()) != Some("OC") || theme_words.is_empty() {
        // OC/мейн — тема должна читаться; EXP-подобных в писце нет
    }
    let hits = theme_words.iter().filter(|w| low.contains(w.as_str())).count();
    if hits < 2 {
        return Err(format!("{pos}: тема-слов в POS {hits}, нужно ≥2"));
    }
    Ok(())
}

fn run_stage_scribe(id: &str) -> Result<(), String> {
    let mut s = load_session(id)?;
    if s.bricks.is_empty() {
        return Err("ars: scribe требует assemble".into());
    }
    crate::live::info(crate::live::BLOCK_SCRIBE, "ARS NOVEAU: писец пошёл по брикетам…");
    let mut draft = s.draft_md.clone().ok_or("ars: скелет не собран")?;
    let chunk_size = 6usize;
    let total_chunks = (s.bricks.len() + chunk_size - 1) / chunk_size;
    s.scribe_log.clear();

    for (ci, chunk_start) in (0..s.bricks.len()).step_by(chunk_size).enumerate() {
        let chunk_all: Vec<Value> = s.bricks[chunk_start..(chunk_start + chunk_size).min(s.bricks.len())].to_vec();
        // дозаполняемость: пропускаем слоты, уже влитые в драфт (re-run писца дешёвый)
        let chunk: Vec<Value> = chunk_all
            .iter()
            .filter(|b| {
                let pos = b.get("pos").and_then(|x| x.as_str()).unwrap_or("");
                draft.contains(&format!("%%POS:{pos}%%"))
            })
            .cloned()
            .collect();
        if chunk.is_empty() {
            s.progress = json!({ "step": "scribe", "chunk": ci + 1, "chunks": total_chunks, "skipped": true });
            continue;
        }
        let user = scribe_chunk_prompt(&chunk, &s.theme_words);
        crate::live::info(BLOCK_SCRIBE, &format!("чанк {}/{}, слоты {}..{}", ci + 1, total_chunks,
            chunk.first().and_then(|b| b.get("pos")).and_then(|x| x.as_str()).unwrap_or("?"),
            chunk.last().and_then(|b| b.get("pos")).and_then(|x| x.as_str()).unwrap_or("?")));

        let parse_chunk = |content: &str| -> Result<Vec<Value>, String> {
            let v = extract_json(content)?;
            v.get("slots").and_then(|x| x.as_array()).cloned().ok_or_else(|| "в ответе писца нет slots[]".to_string())
        };

        let mut slots_done: Vec<Value> = {
            let content = llm_chat(SCRIBE_SYSTEM, &user, false)?;
            parse_chunk(&content)?
        };
        // валидация + один круг правки по находкам
        let mut findings: Vec<String> = Vec::new();
        for item in slots_done.iter() {
            let pos = item.get("pos").and_then(|x| x.as_str()).unwrap_or("");
            if let Some(brick) = chunk.iter().find(|b| b.get("pos").and_then(|x| x.as_str()) == Some(pos)) {
                if let Err(e) = validate_pos_tags(pos, item.get("pos_tags").and_then(|x| x.as_str()).unwrap_or(""), brick, &s.theme_words) {
                    findings.push(e);
                }
            }
        }
        if !findings.is_empty() {
            crate::live::warn(BLOCK_SCRIBE, &format!("чанк {}: {} замечаний — круг правки", ci + 1, findings.len()));
            let repair = format!(
                "{user}\n\nПЕРВЫЙ ОТВЕТ НЕ ПРОШЁЛ ПРОВЕРКУ:\n{}\nТЕМА-СЛОВА (вплети ≥2 в POS КАЖДОГО слота как рисуемые теги): {}\nПерепиши НЕВАЛИДНЫЕ слоты (валидные не трогай), верни СТРОГО один JSON со ВСЕМИ слотами чанка.",
                findings.iter().map(|f| format!("· {f}")).collect::<Vec<_>>().join("\n"),
                s.theme_words.join(", ")
            );
            let content2 = llm_chat(SCRIBE_SYSTEM, &repair, false)?;
            slots_done = parse_chunk(&content2)?;
        }

        // вливание в драфт
        for item in slots_done.iter() {
            let pos = item.get("pos").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let Some(brick) = chunk.iter().find(|b| b.get("pos").and_then(|x| x.as_str()) == Some(pos.as_str())) else {
                continue;
            };
            let slot_meta = s.slots.iter().find(|sl| sl.get("pos").and_then(|x| x.as_str()) == Some(pos.as_str())).ok_or("ars: брикет без слота")?;
            let dress = slot_meta.get("dress").cloned().unwrap_or(json!({}));
            let slot_meta = s.slots.iter().find(|sl| sl.get("pos").and_then(|x| x.as_str()) == Some(pos.as_str())).ok_or("ars: брикет без слота")?;
            let dress = slot_meta.get("dress").cloned().unwrap_or(json!({}));
            let channel = dress.get("channel").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let rating = slot_meta.get("rating").and_then(|x| x.as_str()).unwrap_or("R+").to_string();
            let pos_tags_raw = item.get("pos_tags").and_then(|x| x.as_str()).unwrap_or("").trim();
            // МАШИННАЯ ГАРАНТИЯ КАНАЛА: недостающие hard-claims вплетает Rust
            // сразу после вещи (канал-механика принадлежит машине, не писцу).
            let mut claims: Vec<String> = dress
                .get("claims")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
                .unwrap_or_default();
            // R+ обязан нести ≥2 сигнала рецепта — если дресс дал один, добиваем
            if rating == "R+" && claims.len() < 2 && !claims.is_empty() {
                claims.push("extreme fanservice".into());
            }
            let pos_tags: String = {
                let low = pos_tags_raw.to_lowercase();
                let missing: Vec<&String> = claims.iter().filter(|c| !low.contains(&c.to_lowercase())).collect();
                if missing.is_empty() {
                    pos_tags_raw.to_string()
                } else {
                    let garment_low = dress.get("garment").and_then(|x| x.as_str()).unwrap_or("").to_lowercase();
                    let mut tags: Vec<String> = pos_tags_raw.split(", ").map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                    let mut insert_at: Option<usize> = tags.iter().position(|t| !garment_low.is_empty() && t.to_lowercase().contains(&garment_low)).map(|i| i + 1);
                    if insert_at.is_none() {
                        insert_at = tags.iter().position(|t| t.to_lowercase().starts_with("stylized 2d anime face"));
                    }
                    let at = insert_at.unwrap_or(tags.len().saturating_sub(5));
                    for (k, c) in missing.iter().enumerate() {
                        tags.insert(at + k, c.to_string());
                    }
                    tags.join(", ")
                }
            };
            // МАШИННАЯ ГАРАНТИЯ ЧИСТОТЫ: вырезаем целые теги с вечными флорами,
            // X-терминами и тирами выше заявленного (гейты floors/rating непреклонны).
            let pos_tags: String = {
                let mut banned: Vec<&str> = vec!["candle", "lamp", "lantern", "torch", "chandelier", "brazier", "loli", "shota", "signature", "watermark", "sex", "nude", "naked", "topless", "nipples through clothing", "sheer"];
                if rating != "R+" {
                    // R/PG-13 не несут R+-заявок
                    for t in ["visible pantyline", "taped nipples", "clothed nipples", "covered nipples", "see-through", "handbra", "wet clothes", "extreme fanservice", "tight clothes"] {
                        banned.push(t);
                    }
                }
                if rating == "PG-13" {
                    // PG-13 не несёт и R-сигналов (the underwear tier)
                    for t in ["bra", "lingerie", "panties", "underwear", "garter"] {
                        banned.push(t);
                    }
                }
                if channel == "bumps" {
                    // №28: bumps-канал запрещает просвет и влагу на вещи
                    for t in ["see-through", "wet clothes"] {
                        banned.push(t);
                    }
                }
                let low_chk = pos_tags.to_lowercase();
                if banned.iter().any(|b| low_chk.contains(b)) {
                    let kept: Vec<String> = pos_tags
                        .split(", ")
                        .map(|t| t.trim().to_string())
                        .filter(|t| {
                            let tl = t.to_lowercase();
                            !banned.iter().any(|b| tl.contains(b))
                        })
                        .collect();
                    kept.join(", ")
                } else {
                    pos_tags
                }
            };
            // МАШИННАЯ ГАРАНТИЯ ТЕМЫ: если тема-слов < 2 — досыпаем первыми
            // недостающими словами тегами (раскрытие темы — закон смены).
            let pos_tags: String = {
                let low = pos_tags.to_lowercase();
                let hits = s.theme_words.iter().filter(|w| low.contains(w.as_str())).count();
                if hits >= 2 {
                    pos_tags
                } else {
                    let need = 2 - hits;
                    let missing: Vec<String> = s.theme_words.iter().filter(|w| !low.contains(w.as_str())).take(need).cloned().collect();
                    if missing.is_empty() {
                        pos_tags
                    } else {
                        let mut tags: Vec<String> = pos_tags.split(", ").map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
                        let at = tags.len().saturating_sub(6);
                        for (k, w) in missing.iter().enumerate() {
                            tags.insert(at + k, w.clone());
                        }
                        tags.join(", ")
                    }
                }
            };
            if let Err(e) = validate_pos_tags(&pos, &pos_tags, brick, &s.theme_words) {
                return Err(format!("ars: писец — {e} (после круга правки)"));
            }
            // машинный NEG + neg_extra
            let channel = channel.as_str();
            let register = slot_meta.get("register").and_then(|x| x.as_str()).unwrap_or("student");
            let rating_s = rating.as_str();
            let mut neg = machine_neg(rating_s, channel, register);
            let extra: Vec<String> = item.get("neg_extra").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|v| v.as_str()).map(|t| t.to_string()).collect()).unwrap_or_default();
            for e in extra {
                if !neg.contains(&e) {
                    neg = format!("{neg}, {e}");
                }
            }
            draft = draft.replace(&format!("%%POS:{pos}%%"), &pos_tags);
            draft = draft.replace(&format!("%%NEG:{pos}%%"), &neg);
            s.scribe_log.push(format!("{pos}: ok ({} тегов)", pos_tags.split(',').count()));
        }

        s.progress = json!({ "step": "scribe", "chunk": ci + 1, "chunks": total_chunks });
        s.draft_md = Some(draft.clone()); // резюм: заполненные чанки не переписываем
        s.updated_at = crate::chain::iso_now();
        // sha10 обновляем на каждом чанке
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(draft.as_bytes());
        s.draft_sha10 = Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<Vec<String>>().join("")[..10].to_string());
        save_session(&s)?;
    }

    if draft.contains("%%POS:") || draft.contains("%%NEG:") {
        return Err("ars: в драфте остались незаполненные слоты — писец неполон".into());
    }
    s.draft_md = Some(draft);
    s.stage = "scribed".into();
    save_session(&s)?;
    crate::live::info(BLOCK_SCRIBE, "писец закончил: все 24 POS/NEG влиты");
    Ok(())
}

/* ================================================================== */
/* GATES — та же батарея 30 гейтов, in-process по драфту сессии        */
/* ================================================================== */

fn run_stage_gates(id: &str) -> Result<(), String> {
    let mut s = load_session(id)?;
    let draft = s.draft_md.clone().ok_or("ars: нет драфта — сначала scribe")?;
    if draft.contains("%%POS:") {
        return Err("ars: драфт с заглушками — гейты не запускают".into());
    }
    crate::live::info(crate::live::BLOCK_GATES, &format!("ARS NOVEAU: батарея {} гейтов по {}", crate::textgates::BATTERY_RUST.len(), s.slug));

    let batch = crate::textgates::parse_batch(&s.slug, &draft);
    let specs = crate::textgates::load_text_specs();
    let chron = crate::textgates::chronicle_state();
    let receipts = crate::textgates::run_text_gates(&batch, &specs, None, &chron);
    let hard_pass = receipts.iter().filter(|r| r.level == "hard").all(|r| r.verdict == "PASS");

    for r in receipts.iter() {
        let line = format!("гейт {}/{}: {} ({}): {}", receipts.iter().position(|x| std::ptr::eq(x, r)).map(|i| i + 1).unwrap_or(0), receipts.len(), r.gate, r.level, r.verdict);
        if r.verdict == "PASS" || r.verdict == "REPORT" {
            crate::live::info(BLOCK_GATES, &line);
        } else {
            crate::live::warn(BLOCK_GATES, &line);
        }
    }

    // scratch-летопись: свой коннект (worker-поток не делит Connection с accept-циклом)
    let scratch = crate::db::open_scratch_rw().map_err(|e| e.to_string())?;
    let outcome = crate::textgates::TextGatesOutcome {
        slug: s.slug.clone(),
        sha10: s.draft_sha10.clone().unwrap_or_default(),
        receipts: receipts.clone(),
        hard_pass,
        contract_theme: Some(s.theme.clone()),
        rebuild_of: None,
    };
    let (event_id, _seq, run_index) = crate::textgates::record_gate_run(&scratch, &outcome).map_err(|e| e.to_string())?;
    crate::live::info(BLOCK_GATES, &format!("записано: gate.run {event_id} в scratch (прогон #{run_index})"));

    s.gate_receipts = crate::textgates::receipts_json(&receipts);
    s.gate_hard_pass = Some(hard_pass);
    s.gate_run_index = Some(run_index);
    s.stage = "gated".into();
    save_session(&s)?;
    let hard_fails: Vec<&str> = outcome.hard_fails();
    crate::live::info(BLOCK_GATES, &format!("вердикт батареи: hard {} ({})", if hard_pass { "PASS" } else { "FAIL" }, hard_fails.join(", ") ));
    Ok(())
}

/* ================================================================== */
/* FURNACE — LLM-оценщик: обширный репорт без пиздежа                  */
/* ================================================================== */

const FURNACE_SYSTEM: &str = r#"Ты — FURNACE, финальный экзаменатор конвейера THREAD 4. Тебе дают: замысел (слот-карточки ARS NOVEAU), готовый батч (что налепили предыдущие инстанции), квитанции гейтов (машинный суд). Ты смотришь:
1. Недостатки гейтов: что машина пропустила или завысила (ложные PASS, поверхностные проверки).
2. Раскрытие темы: сделал ли каждый слот то, что обещал замысел? Тема читается через рисуемые образы, а не через название?
3. Работу писца: соблюл ли скелет POS (opener → тело → identity → вещь/канал → заявка → окружение/свет → поза/фрейм → регистр → лицо → квалити), вошли ли состояния канала дословно, кости ли учтены; если не сделал — почему (где именно сломал).
4. EXP-болванки: вне темы, одна переменная в паре, машины ли они по форме.

РЕПОРТ БЕЗ ПИЗДЕЖА: что получилось — а что нет. Никаких «в целом неплохо». Каждое проблема — слот + суть + severity. Хорошие решения тоже называй по слотам.

OUTPUT: СТРОГО один JSON:
{"verdict":"SHIP|HOLD","revelation_score":0-10,"summary":"2-4 предложения по-русски",
"scribe_done":true|false,"scribe_notes":"по-русски, честно",
"gate_flaws":[{"gate":"имя","issue":"что гейт пропустил/перегнул"}],
"problems":[{"slot":"P04","issue":"по-русски","severity":"high|mid|low"}],
"strengths":["по-русски, со слотами"],
"recommendations":["по-русски, конкретно"],
"report_md":"ОБШИРНЫЙ репорт по-русски в markdown: заголовок, вердикт, раскрытие темы по актам, работа писца, гейты, EXP, сильное/слабое, рекомендации — без воды"}"#;

fn run_stage_furnace(id: &str) -> Result<(), String> {
    let mut s = load_session(id)?;
    if s.gate_receipts.is_empty() {
        return Err("ars: furnace требует gates".into());
    }
    crate::live::info(crate::live::BLOCK_SYSTEM, "FURNACE: оцениваю работу всех инстанций…");

    // контекст: замысел + гейты + батч
    let mut intents = String::from("ЗАМЫСЕЛ (слот-карточки):\n");
    for slot in s.slots.iter() {
        intents.push_str(&format!(
            "{} · {} · {} · ARCH {} — reveal: {} | scene: {}\n",
            slot.get("pos").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("genre").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("rating").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("arch").and_then(|x| x.as_str()).unwrap_or("—"),
            slot.get("reveal").and_then(|x| x.as_str()).unwrap_or(""),
            slot.get("scene").and_then(|x| x.as_str()).unwrap_or("")
        ));
    }
    let mut gate_summary = format!("ГЕЙТЫ (прогон #{}): hard {}\n", s.gate_run_index.unwrap_or(0), if s.gate_hard_pass == Some(true) { "PASS" } else { "FAIL" });
    for r in s.gate_receipts.iter() {
        let verdict = r.get("verdict").and_then(|x| x.as_str()).unwrap_or("");
        if verdict != "PASS" && verdict != "REPORT" {
            gate_summary.push_str(&format!("· {} ({}): {}\n", r.get("gate").and_then(|x| x.as_str()).unwrap_or(""), r.get("level").and_then(|x| x.as_str()).unwrap_or(""), verdict));
            if let Some(findings) = r.get("findings").and_then(|x| x.as_array()) {
                for f in findings.iter().take(6) {
                    gate_summary.push_str(&format!("    - {}\n", f.as_str().unwrap_or("")));
                }
            }
        }
    }
    let user = format!(
        "ТЕМА: «{}» (ОС-темы: {})\n\n{}\n\n{}\n\nБАТЧ {}:\n{}",
        s.theme,
        s.oc_themes.iter().filter_map(|t| t.get("theme").and_then(|x| x.as_str())).collect::<Vec<_>>().join(" / "),
        intents,
        gate_summary,
        s.slug,
        s.draft_md.clone().unwrap_or_default()
    );

    let content = llm_chat(FURNACE_SYSTEM, &user, false)?;
    let report = extract_json(&content)?;
    let verdict = report.get("verdict").and_then(|x| x.as_str()).unwrap_or("HOLD").to_uppercase();

    // событие в scratch-цепь
    let scratch = crate::db::open_scratch_rw().map_err(|e| e.to_string())?;
    let tx = scratch.unchecked_transaction().map_err(|e| e.to_string())?;
    let _evt = crate::chain::append_event_tx(
        &tx,
        &crate::chain::AppendInput {
            typ: "experiment.logged",
            summary: &format!("FURNACE {}: {} «{}» — вердикт {}, раскрытие {}/10", s.id, s.slug, s.title.clone().unwrap_or_default(), verdict, report.get("revelation_score").and_then(|x| x.as_i64()).unwrap_or(0)),
            data: Some(&json!({ "sessionId": s.id, "slug": s.slug, "verdict": verdict })),
            batch_slug: None,
        },
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    s.furnace = Some(json!({
        "verdict": verdict,
        "revelationScore": report.get("revelation_score").cloned().unwrap_or(json!(0)),
        "summary": report.get("summary").cloned().unwrap_or(json!("")),
        "scribeDone": report.get("scribe_done").cloned().unwrap_or(json!(false)),
        "scribeNotes": report.get("scribe_notes").cloned().unwrap_or(json!("")),
        "gateFlaws": report.get("gate_flaws").cloned().unwrap_or(json!([])),
        "problems": report.get("problems").cloned().unwrap_or(json!([])),
        "strengths": report.get("strengths").cloned().unwrap_or(json!([])),
        "recommendations": report.get("recommendations").cloned().unwrap_or(json!([])),
        "reportMd": report.get("report_md").cloned().unwrap_or(json!("")),
        "at": crate::chain::iso_now(),
    }));
    s.stage = "done".into();
    save_session(&s)?;
    crate::live::info(crate::live::BLOCK_SYSTEM, &format!("FURNACE вердикт: {verdict} — репорт в сессии"));
    Ok(())
}

/* ================================================================== */
/* Стартовая обвязка: async-задачи (worker-поток, RPC не блокируется)  */
/* ================================================================== */

pub fn start_stage(id: &str, stage: &str, force: bool) -> Result<Value, String> {
    let s = load_session(id)?;
    if let Some(busy) = s.busy.as_deref() {
        if !force {
            return Err(format!("ars: сессия {id} занята (идёт {busy}) — перезапусти с force, если воркер умер с рестартом"));
        }
        // force: воркеры не переживают рестарт twin'а — заливший busy счищаем
        crate::live::warn(BLOCK_EXPAND, &format!("force: сброшен залипший busy «{busy}»"));
    }
    let allowed = match stage {
        "expand" => true, // всегда доступен: сам сбрасывает нижестоящие артефакты
        "assemble" => !s.slots.is_empty(),
        "scribe" => !s.bricks.is_empty() && s.draft_md.is_some(),
        "gates" => s.draft_md.is_some() && !s.draft_md.as_deref().unwrap_or("").contains("%%POS:"),
        "furnace" => !s.gate_receipts.is_empty(),
        _ => return Err(format!("ars: неизвестная стадия «{stage}»")),
    };
    if !allowed {
        return Err(format!("ars: стадия {stage} недоступна из состояния «{}»", s.stage));
    }
    let mut s = s;
    s.busy = Some(stage.to_string());
    s.error = None;
    s.updated_at = crate::chain::iso_now();
    save_session(&s)?;

    let id_own = id.to_string();
    let stage_own = stage.to_string();
    std::thread::spawn(move || {
        let result = match stage_own.as_str() {
            "expand" => run_stage_expand(&id_own),
            "assemble" => run_stage_assemble(&id_own),
            "scribe" => run_stage_scribe(&id_own),
            "gates" => run_stage_gates(&id_own),
            "furnace" => run_stage_furnace(&id_own),
            _ => Err("неизвестная стадия".to_string()),
        };
        if let Ok(mut s) = load_session(&id_own) {
            s.busy = None;
            if let Err(e) = result {
                s.error = Some(e);
            }
            s.updated_at = crate::chain::iso_now();
            let _ = save_session(&s);
        }
    });
    Ok(json!({ "id": id, "stage": stage, "status": "running" }))
}
