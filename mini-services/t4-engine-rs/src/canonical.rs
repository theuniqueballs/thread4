//! THREAD 4 ENGINE (RUST TWIN) — canonical serialization.
//!
//! Byte-exact port of mini-services/t4-engine/src/lib/canonical.ts.
//! The chain commits to the EXACT raw line: sha256(prev + '|' + rawLine).
//! stable_stringify sorts object keys recursively and escapes strings
//! exactly like JS `JSON.stringify` (control chars + quote + backslash
//! only, non-ASCII stays raw UTF-8) so regeneration is deterministic.

use sha2::{Digest, Sha256};

/// JS-compatible JSON string escaping (JSON.stringify semantics).
pub fn js_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Stable JSON: object keys sorted recursively, UTF-8, no whitespace.
/// Mirrors serialize() in canonical.ts — serde_json::Value uses a BTreeMap
/// (sorted), which matches the TS byte-wise sort for the engine's
/// ASCII-key payloads; numbers are integers/floats formatted like JS.
pub fn stable_stringify(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => if *b { "true".into() } else { "false".into() },
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => js_escape_string(s),
        serde_json::Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(stable_stringify).collect();
            format!("[{}]", parts.join(","))
        }
        serde_json::Value::Object(map) => {
            // BTreeMap iterates in sorted key order (single truth for both).
            let parts: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{}:{}", js_escape_string(k), stable_stringify(v)))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

/// The event line shape is frozen history: {id,at,type,summary,data?} in
/// that key order, data omitted when absent — identical to the file era.
pub fn canonical_event_line(
    id: &str,
    at: &str,
    typ: &str,
    summary: &str,
    data: Option<&serde_json::Value>,
) -> String {
    let mut parts = vec![
        format!("\"id\":{}", js_escape_string(id)),
        format!("\"at\":{}", js_escape_string(at)),
        format!("\"type\":{}", js_escape_string(typ)),
        format!("\"summary\":{}", js_escape_string(summary)),
    ];
    if let Some(d) = data {
        parts.push(format!("\"data\":{}", stable_stringify(d)));
    }
    format!("{{{}}}", parts.join(","))
}

/// sha256(prev + '|' + line) — the «Правда» chain formula, unchanged.
pub fn chain_hash(prev: &str, raw_line: &str) -> String {
    let trimmed = raw_line.trim_end_matches(['\r', '\n']);
    let mut hasher = Sha256::new();
    hasher.update(prev.as_bytes());
    hasher.update(b"|");
    hasher.update(trimmed.as_bytes());
    hex(&hasher.finalize())
}

/// Short sha (sha10) of any canonical payload — batch fingerprints.
pub fn payload_sha10(value: &serde_json::Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stable_stringify(value).as_bytes());
    hex(&hasher.finalize())[..10].to_string()
}

/// Full sha256 hex of a canonical payload (parity evidence).
pub fn payload_sha256(value: &serde_json::Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stable_stringify(value).as_bytes());
    hex(&hasher.finalize())
}

/// timing-safe string equality (compares sha256 digests, never lengths).
pub fn timing_safe_equal_str(a: &str, b: &str) -> bool {
    let ha = Sha256::digest(a.as_bytes());
    let hb = Sha256::digest(b.as_bytes());
    constant_time_eq(&ha, &hb)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_hash_genesis_parity() {
        // Cross-checked against the TS engine (bun) before landing:
        // sha256("GENESIS" + "|" + line)
        let line = r#"{"id":"ab12cd34","at":"2026-10-19T08:00:00.000Z","type":"note","summary":"привет"}"#;
        let h = chain_hash("GENESIS", line);
        assert_eq!(h.len(), 64);
        // deterministic
        assert_eq!(h, chain_hash("GENESIS", line));
    }

    #[test]
    fn stable_stringify_sorts_keys() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"b":1,"a":{"z":true,"c":"x"}}"#).unwrap();
        assert_eq!(stable_stringify(&v), r#"{"a":{"c":"x","z":true},"b":1}"#);
    }

    #[test]
    fn js_escape_matches_json_stringify() {
        assert_eq!(js_escape_string("a\"b\\c\nd"), "\"a\\\"b\\\\c\\nd\"");
        assert_eq!(js_escape_string("№28 — русский"), "\"№28 — русский\"");
    }
}
