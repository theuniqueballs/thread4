//! THREAD 4 ENGINE (UNIFIED) — мост к Next-слою (cutover-эра).
//!
//! Приказ «МОЩНОСТЬ» (2026-10-20): единый движок = Rust. Но у платформы
//! есть железное ограничение: z-ai-web-dev-sdk (LLM-провайдер писца)
//! живёт ТОЛЬКО в Node-бэкенде. Поэтому конвейер делит труд честно:
//!
//!   · RUST  — вся машина: цепь, реестр, гейты, ротация, оркестрация,
//!             сборка батча, события, HTTP/SSE. Один писатель летописи.
//!   · BRIDGE (Next /api/t4/bridge/*) — два ИНСТРУМЕНТА, ни одного
//!             решения: (1) LLM-проза писца (спайн/чанки/ремонт —
//!             промпты и парсер scribe.ts), (2) файловый компилятор
//!             контрактов (compiler.ts — бриф писца, «инвентарь слотов»).
//!             Роуты compute-only: НИКАКИХ записей в файлы/летопись.
//!
//! Протокол: POST JSON {…} → 200 {ok:true, data:{…}} | 4xx/5xx {error}.
//! Ключ командира прикладывается заголовком (timing-safe проверка на
//! стороне Next, как у всех мутаций ядра).

use std::time::Duration;

use serde_json::{json, Value};

use crate::auth::KeyCache;

/// Origin Next-слоя. UI-прокси шлюза тут не нужен — движок и Next живут
/// на одной машине; переопределение — переменной окружения T4_BRIDGE_ORIGIN
/// (дефолт — dev-сервер :3000).
fn origin() -> String {
    std::env::var("T4_BRIDGE_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:3000".to_string())
}

/// Ключ командира — из того же ~/.t4/commander.key, что и RPC-замок
/// (Залп 1 «Правда»): один оператор, один секрет, оба слоя.
fn commander_key() -> Option<String> {
    let kc = KeyCache::new();
    kc.peek()
}

/// Один POST-выстрел: тело → data. Ошибка — ЧЕСТНЫМ текстом (без масок
/// «Не удалось записать»: тело ответа моста несёт причину).
pub fn post(path: &str, body: &Value, timeout: Duration) -> Result<Value, String> {
    let url = format!("{}{}", origin(), path);
    let mut req = ureq::post(&url)
        .timeout(timeout)
        .set("content-type", "application/json");
    if let Some(k) = commander_key() {
        req = req.set("x-commander-key", &k);
    }
    let res = req
        .send_json(body.clone())
        .map_err(|e| format!("мост {path}: {e}"))?;
    let status = res.status();
    let parsed: Value = res
        .into_json()
        .map_err(|e| format!("мост {path}: ответ не JSON ({e})"))?;
    if status != 200 {
        let msg = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("без текста");
        return Err(format!("мост {path}: HTTP {status} — {msg}"));
    }
    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let msg = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("ok=false без текста");
        return Err(format!("мост {path}: {msg}"));
    }
    Ok(parsed.get("data").cloned().unwrap_or(Value::Null))
}

/* ---------------- инструменты конвейера ---------------- */

/// Таймауты по типу вызова: файл-компилятор — секунды (CPU), LLM — минуты
/// (чанк писца пишет до 2–6 минут; сногсшибательное молчание шлюза здесь
/// не наш случай: движок ждёт сокетом, шлюз в игре не участвует).
const CPU_FAST: Duration = Duration::from_secs(60);
const LLM_LONG: Duration = Duration::from_secs(480);

/// Этап 2 · инструмент №2: файловый компилятор контрактов (compiler.ts).
/// Вход — черновик; выход — БОГАТЫЙ контракт писца (позы/стеки/лиды/дресс).
pub fn compile_contract(
    slug: &str,
    theme: &str,
    engine: &str,
    oc_themes: &Value,
    author_wishes: Option<&str>,
) -> Result<(Value, String), String> {
    let body = json!({
        "slug": slug,
        "theme": theme,
        "engine": engine,
        "ocThemes": oc_themes,
        "authorWishes": author_wishes.unwrap_or(""),
    });
    let data = post("/api/t4/bridge/contract", &body, CPU_FAST)?;
    let contract = data
        .get("contract")
        .cloned()
        .ok_or("мост contract: пустой контракт")?;
    let markdown = data
        .get("markdown")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok((contract, markdown))
}

/// Этап 3: спайн — одноразовый движок батча (LLM-проза: имя/закон/тезис/
/// акты/тема-слова). Контракт читает мост с диска (contracts/<slug>.json).
pub fn invent_spine(slug: &str) -> Result<Value, String> {
    let data = post("/api/t4/bridge/spine", &json!({ "slug": slug }), LLM_LONG)?;
    Ok(data
        .get("build")
        .cloned()
        .ok_or("мост spine: пустой движок")?)
}

/// Этап 4: чанк писца — LLM пишет слоты (mode: write | repair | polish).
/// Возвращает outputs: [{position, anchor, thesis, pos, negExtra}].
/// anchors — якоря темы (гейт №25): писец обязан видеть токены, которые
/// мерит гейт adherence — раньше они до промпта не доходили (0/12 всегда).
pub fn write_chunk(
    slug: &str,
    build: &Value,
    positions: &[u32],
    mode: &str,
    findings: &[String],
    anchors: Option<&Value>,
) -> Result<Vec<Value>, String> {
    let body = json!({
        "slug": slug,
        "build": build,
        "positions": positions,
        "mode": mode,
        "findings": findings,
        "anchors": anchors.cloned().unwrap_or(Value::Null),
    });
    let data = post("/api/t4/bridge/chunk", &body, LLM_LONG)?;
    let outputs = data
        .get("outputs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(outputs)
}

/// Этап 4: сборка файла батча из outputs (assembleBatch писца — канон
/// шапки/актов/спайнов/NEG идёт дословно, файл пишет уже Rust).
pub fn assemble_batch(slug: &str, build: &Value, outputs: &Value) -> Result<String, String> {
    let body = json!({ "slug": slug, "build": build, "outputs": outputs });
    let data = post("/api/t4/bridge/assemble", &body, CPU_FAST)?;
    data.get("markdown")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "мост assemble: пустой markdown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_default_is_local_next() {
        std::env::remove_var("T4_BRIDGE_ORIGIN");
        assert!(origin().starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn post_to_dead_port_fails_honestly() {
        std::env::set_var("T4_BRIDGE_ORIGIN", "http://127.0.0.1:3999");
        let r = post("/api/t4/bridge/contract", &json!({}), Duration::from_secs(2));
        assert!(r.is_err());
        let msg = r.unwrap_err();
        assert!(msg.contains("мост /api/t4/bridge/contract"), "честный префикс: {msg}");
        std::env::remove_var("T4_BRIDGE_ORIGIN");
    }
}
