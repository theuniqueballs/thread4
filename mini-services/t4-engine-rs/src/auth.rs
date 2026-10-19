//! THREAD 4 ENGINE (RUST TWIN) — commander lock (Залп 1 «Правда»).
//!
//! Mutations are commander-only; the key rides the x-commander-key HEADER
//! only. Comparison is timing-safe over sha256 digests — same doctrine as
//! the TS engine. The key file is shared with the bun engine
//! (~/.t4/commander.key) with an mtime cache on the read boundary.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use crate::canonical::timing_safe_equal_str;

pub struct KeyCache {
    path: PathBuf,
    state: Mutex<(Option<SystemTime>, Option<String>)>,
}

impl KeyCache {
    pub fn new() -> Self {
        let path = std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(".t4/commander.key"))
            .unwrap_or_else(|_| PathBuf::from("/home/z/.t4/commander.key"));
        KeyCache {
            path,
            state: Mutex::new((None, None)),
        }
    }

    fn read_key(&self) -> Option<String> {
        let meta = std::fs::metadata(&self.path).ok()?;
        let mtime = meta.modified().ok();
        let mut guard = self.state.lock().ok()?;
        if guard.0 == mtime && guard.1.is_some() {
            return guard.1.clone();
        }
        let key = std::fs::read_to_string(&self.path)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        *guard = (mtime, key.clone());
        key
    }

    /// 503 when the lock is absent, 403-flavored false on mismatch.
    pub fn check(&self, presented: &str) -> Result<(), crate::rpc::AuthFailure> {
        let key = self
            .read_key()
            .ok_or(crate::rpc::AuthFailure::NoLock)?;
        if presented.is_empty() || !timing_safe_equal_str(presented, &key) {
            return Err(crate::rpc::AuthFailure::Forbidden);
        }
        Ok(())
    }
}

impl Default for KeyCache {
    fn default() -> Self {
        Self::new()
    }
}
