//! THREAD 4 ENGINE (RUST TWIN) — LIVE CONSOLE (SSE /v1/live).
//!
//! Поток логов для Консоли «МОЩНОСТЬ»: блоки expand / compile / gates /
//! scribe / deliver / system, кадры `data: {seq,block,level,text,at}\n\n`.
//!
//! Лекарство инцидента «Не удалось записать» (2026-10-19): шлюз рвёт
//! молчаливые соединения — поэтому каждые 15с летит SSE-комментарий
//! `event: ping` (heartbeat), ошибки не маскируются (настоящая причина —
//! в кадре), а оборванный поток честно закрывается кадром `event: bye` с
//! последним seq — клиент (EventSource) переподключается с `?after=seq`.
//! Жизнь соединения ограничена 600с — читатель не течёт.

use std::collections::VecDeque;
use std::io::{self, Read};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;

pub const BLOCK_EXPAND: &str = "expand";
pub const BLOCK_COMPILE: &str = "compile";
pub const BLOCK_BUILD: &str = "build";
pub const BLOCK_GATES: &str = "gates";
pub const BLOCK_SCRIBE: &str = "scribe";
/// ARS NOVEAU-эра (2026-10-23): сборщик брикетов и печь-оценщик.
pub const BLOCK_COLLECTOR: &str = "collector";
pub const BLOCK_FURNACE: &str = "furnace";
pub const BLOCK_DELIVER: &str = "deliver";
pub const BLOCK_SYSTEM: &str = "system";
/// Cutover-эра: переходы этапов конвейера (старт/готово/провал этапа,
/// старт/финиш прогона) — консоль рисует полосу «PIPELINE» между блоками.
pub const BLOCK_PIPELINE: &str = "pipeline";

const RING_CAP: usize = 2000;
const HEARTBEAT_EVERY: Duration = Duration::from_secs(15);
const CONN_MAX_LIFE: Duration = Duration::from_secs(600);
const POLL_TICK: Duration = Duration::from_millis(250);
/// Каскад буферов обойдён конструктивно: чанковый энкодер tiny_http молчит
/// до 8КБ (chunks_size) — поэтому SSE идёт Identity-стримом с большим
/// Content-Length и with_chunked_threshold(usize::MAX): raw_print берёт
/// arm (Some(l), _) → io::copy ПРЯМО в BufWriter(1024) — flush каждые
/// ~1КБ кадров, задержка минимальна. Простой: 15с ping + паддинг
/// SSE-комментариями `: pad` (EventSource игнорирует их по RFC).
const FLUSH_THRESHOLD: usize = 2048;

struct BusState {
    next_seq: u64,
    ring: VecDeque<(u64, String)>,
}

pub struct Bus {
    state: Mutex<BusState>,
    cond: Condvar,
}

static BUS: OnceLock<Bus> = OnceLock::new();

pub fn bus() -> &'static Bus {
    BUS.get_or_init(|| {
        Bus {
            state: Mutex::new(BusState { next_seq: 1, ring: VecDeque::new() }),
            cond: Condvar::new(),
        }
    })
}

/// Опубликовать строку лога; возвращает присвоенный seq.
pub fn publish(block: &str, level: &str, text: &str) -> u64 {
    let mut st = match bus().state.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let seq = st.next_seq;
    st.next_seq += 1;
    let frame = format!(
        "data: {}\n\n",
        json!({
            "seq": seq,
            "block": block,
            "level": level,
            "text": text,
            "at": crate::chain::iso_now(),
        })
    );
    st.ring.push_back((seq, frame));
    while st.ring.len() > RING_CAP {
        st.ring.pop_front();
    }
    drop(st);
    bus().cond.notify_all();
    seq
}

/// Уровни для читабельности кадров.
pub fn info(block: &str, text: &str) -> u64 {
    publish(block, "info", text)
}

pub fn warn(block: &str, text: &str) -> u64 {
    publish(block, "warn", text)
}

pub fn error(block: &str, text: &str) -> u64 {
    publish(block, "error", text)
}

pub fn head_seq() -> u64 {
    bus()
        .state
        .lock()
        .map(|st| st.next_seq.saturating_sub(1))
        .unwrap_or(0)
}

/// Диагностика: сколько кадров в кольце (SSE-телеметрия).
pub fn ring_len() -> usize {
    bus().state.lock().map(|st| st.ring.len()).unwrap_or(0)
}

/* ---------------- SSE-reader (chunked, R: Read для tiny_http) ---------------- */

pub struct LiveReader {
    cursor: u64,
    pending: Vec<u8>,
    last_emit: Instant,
    born: Instant,
    closed: bool,
    /// Сколько байт ждать до отдачи (1 — тесты; 2048 — прод).
    min_flush: usize,
}

impl LiveReader {
    pub fn new(after: u64) -> Self {
        Self::with_threshold(after, FLUSH_THRESHOLD)
    }

    /// Тонкая настройка порога (батарея и тесты читают без порога).
    pub fn with_threshold(after: u64, min_flush: usize) -> Self {
        LiveReader {
            cursor: after,
            pending: Vec::new(),
            last_emit: Instant::now(),
            born: Instant::now(),
            closed: false,
            min_flush: min_flush.max(1),
        }
    }

    fn push_frame(&mut self, frame: &str) {
        self.pending.extend_from_slice(frame.as_bytes());
    }

    /// Паддинг SSE-комментариями до порога flush — EventSource их
    /// игнорирует (RFC: строки с ':' — комментарии), а BufWriter
    /// tiny_http гарантированно пробивается.
    fn pad_to_threshold(&mut self) {
        let mut i = 0;
        while self.pending.len() < self.min_flush {
            i += 1;
            let line = format!(": keepalive {i} seq={}\n", self.cursor);
            self.pending.extend_from_slice(line.as_bytes());
            if i > 1024 {
                break; // защита от теоретической петли
            }
        }
    }

    fn drain_new_frames(&mut self) {
        let frames: Vec<(u64, String)> = {
            let st = match bus().state.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            // с отставшего курсора; если читатель отстал сильнее RING_CAP —
            // прыгаем на самый старый доступный кадр (честная потеря хвоста)
            st.ring
                .iter()
                .filter(|(seq, _)| *seq > self.cursor)
                .cloned()
                .collect()
        };
        for (seq, frame) in frames {
            self.cursor = seq;
            self.push_frame(&frame);
        }
    }

    fn heartbeat_if_due(&mut self) {
        if self.last_emit.elapsed() >= HEARTBEAT_EVERY {
            let seq = self.cursor;
            self.push_frame(&format!("event: ping\ndata: {seq}\n\n"));
        }
    }
    fn life_check(&mut self) {
        if !self.closed && self.born.elapsed() >= CONN_MAX_LIFE {
            // честное прощание: клиент переподключится с ?after=cursor
            self.push_frame(&format!("event: bye\ndata: {}\n\n", self.cursor));
            self.closed = true;
        }
    }
}

impl Read for LiveReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            // отдаём накопленное: по порогу, по 15с тишине (с паддингом),
            // или при закрытии (после дренирования)
            if !self.pending.is_empty()
                && (self.pending.len() >= self.min_flush
                    || self.last_emit.elapsed() >= HEARTBEAT_EVERY
                    || self.closed)
            {
                if self.pending.len() < self.min_flush {
                    self.pad_to_threshold();
                }
                let n = buf.len().min(self.pending.len());
                buf[..n].copy_from_slice(&self.pending[..n]);
                self.pending.drain(..n);
                self.last_emit = Instant::now();
                return Ok(n);
            }
            if self.closed {
                return Ok(0); // поток завершён — tiny_http закрывает соединение
            }
            self.drain_new_frames();
            self.heartbeat_if_due();
            self.life_check();
            if !self.pending.is_empty() {
                continue; // кадры в буфере — решаем выше, отдавать или копить
            }
            // тишина: ждём уведомления (или тика) — Condvar, не цикл прожига
            let guard = match bus().state.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            let _ = bus().cond.wait_timeout(guard, POLL_TICK);
        }
    }
}

/* ---------------- тесты (battery: live-6) ---------------- */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_assigns_seq() {
        let a = publish(BLOCK_SYSTEM, "info", "тест-кадр A");
        let b = publish(BLOCK_SYSTEM, "info", "тест-кадр B");
        assert_eq!(b, a + 1, "seq растёт монотонно");
    }

    #[test]
    fn ring_is_bounded() {
        for i in 0..(RING_CAP + 50) {
            publish(BLOCK_SYSTEM, "info", &format!("заливка {i}"));
        }
        let st = bus().state.lock().unwrap();
        assert!(st.ring.len() <= RING_CAP, "кольцо ограничено");
        assert!(st.ring.front().unwrap().0 > 1, "хвост вытеснен");
    }

    #[test]
    fn reader_replays_after_cursor() {
        let s1 = publish(BLOCK_COMPILE, "info", "до подписки");
        let mut r = LiveReader::with_threshold(s1, 1);
        publish(BLOCK_GATES, "info", "после подписки");
        // ОДИН конечный read(): живой поток никогда не отдаст Ok(0) сам —
        // read_to_end висел бы вечно, ловим только кадры реплея.
        use std::io::Read;
        let mut buf = [0u8; 8192];
        let n = r.read(&mut buf).expect("live read");
        let s = String::from_utf8_lossy(&buf[..n]);
        assert!(s.contains("после подписки"), "кадр после курсора доставлен");
        assert!(!s.contains("до подписки"), "кадр до курсора не дублируется");
    }

    #[test]
    fn frames_are_sse_shaped() {
        publish(BLOCK_EXPAND, "info", "кадр-форма");
        let st = bus().state.lock().unwrap();
        let (_, frame) = st.ring.back().unwrap();
        assert!(frame.starts_with("data: {"));
        assert!(frame.ends_with("\n\n"));
    }

    #[test]
    fn head_seq_monotonic() {
        // Гонка тестов: шина ГЛОБАЛЬНАЯ, другие тесты публикуют параллельно
        // (cargo test мультипоточен) — head может уйти выше нашего seq.
        // Инвариант: seq монотонен и наш publish виден в head (≥), а не
        // «head == ровно наш seq» (гонка со соседним публикатором).
        let before = head_seq();
        let s = publish(BLOCK_SYSTEM, "info", "head-тест");
        assert!(s >= before);
        assert!(head_seq() >= s, "publish обязан попадать в голову не ниже своего seq");
    }
}
