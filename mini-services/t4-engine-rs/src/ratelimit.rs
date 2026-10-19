//! THREAD 4 ENGINE (RUST TWIN) — token-bucket rate limiting (per client IP).
//!
//! Same buckets as the TS engine: compile is expensive (planning +
//! transaction) so it gets a narrow pipe; reads are wide. In-memory,
//! single process, pruned when the map grows past MAX_CLIENTS.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum BucketName {
    Open,
    Read,
    Mutation,
    Compile,
}

pub struct BucketSpec {
    pub capacity: f64,
    pub refill_per_sec: f64,
}

pub fn bucket_spec(name: BucketName) -> BucketSpec {
    match name {
        BucketName::Open => BucketSpec { capacity: 120.0, refill_per_sec: 2.0 },
        BucketName::Read => BucketSpec { capacity: 240.0, refill_per_sec: 4.0 },
        BucketName::Mutation => BucketSpec { capacity: 30.0, refill_per_sec: 0.5 },
        BucketName::Compile => BucketSpec { capacity: 6.0, refill_per_sec: 0.1 },
    }
}

struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

const MAX_CLIENTS: usize = 4096;

pub struct Limiter {
    clients: Mutex<HashMap<String, HashMap<BucketName, Bucket>>>,
}

impl Limiter {
    pub fn new() -> Self {
        Limiter { clients: Mutex::new(HashMap::new()) }
    }

    /// Client IP: X-Forwarded-For first hop (gateway), else "local".
    pub fn client_ip(headers: &[(String, String)]) -> String {
        for (field, value) in headers {
            if field.eq_ignore_ascii_case("x-forwarded-for") {
                let first = value.split(',').next().unwrap_or("").trim();
                if !first.is_empty() {
                    return first.to_string();
                }
            }
        }
        "local".to_string()
    }

    /// Consume one token; Err(name) when the bucket is empty → HTTP 429.
    pub fn consume(&self, name: BucketName, ip: &str) -> Result<(), BucketName> {
        let mut clients = self.clients.lock().unwrap();
        if clients.len() >= MAX_CLIENTS {
            clients.clear(); // prune — bounded by construction
        }
        let buckets = clients
            .entry(ip.to_string())
            .or_insert_with(HashMap::new);
        let spec = bucket_spec(name);
        let now = Instant::now();
        let bucket = buckets
            .entry(name)
            .or_insert(Bucket { tokens: spec.capacity, last_refill: now });
        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * spec.refill_per_sec).min(spec.capacity);
        bucket.last_refill = now;
        if bucket.tokens < 1.0 {
            return Err(name);
        }
        bucket.tokens -= 1.0;
        Ok(())
    }
}

impl Default for Limiter {
    fn default() -> Self {
        Self::new()
    }
}
