//! THREAD 4 ENGINE (RUST TWIN) — storage.
//!
//! DUAL-DB doctrine, declared on the box:
//!   · PRODUCTION  (../t4-engine/data/t4.db) — READ-ONLY handle. The twin
//!     verifies the real chronicle and reads real state; it never writes
//!     the SSoT (the bun engine stays the ONE writer).
//!   · SCRATCH     (data/t4-rs-scratch.db) — read-write chronicle of the
//!     twin itself: compiles, appended events, the Rust chain extending.
//! DDL mirrors t4-engine/src/core/ddl.ts statement-for-statement.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

pub const SCHEMA_VERSION: u32 = 1;

pub const DDL: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS t4_meta (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )",
    "CREATE TABLE IF NOT EXISTS t4_events (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       id         TEXT    NOT NULL UNIQUE,
       at         TEXT    NOT NULL,
       type       TEXT    NOT NULL,
       summary    TEXT    NOT NULL,
       data       TEXT,
       raw        TEXT    NOT NULL,
       prev_hash  TEXT    NOT NULL,
       hash       TEXT    NOT NULL UNIQUE,
       batch_slug TEXT
     )",
    "CREATE INDEX IF NOT EXISTS idx_events_type  ON t4_events (type)",
    "CREATE INDEX IF NOT EXISTS idx_events_slug  ON t4_events (batch_slug)",
    "CREATE TABLE IF NOT EXISTS t4_batches (
       slug         TEXT PRIMARY KEY,
       title        TEXT NOT NULL,
       theme        TEXT NOT NULL,
       engine       TEXT NOT NULL,
       status       TEXT NOT NULL DEFAULT 'compiled'
                    CHECK (status IN ('compiled', 'delivered', 'void')),
       slots_total  INTEGER NOT NULL,
       exp_slots    INTEGER NOT NULL DEFAULT 0,
       ab_pairs     INTEGER NOT NULL DEFAULT 0,
       hard_pass    INTEGER NOT NULL DEFAULT 0,
       diff_up      INTEGER NOT NULL DEFAULT 0,
       diff_down    INTEGER NOT NULL DEFAULT 0,
       payload      TEXT NOT NULL,
       sha10        TEXT NOT NULL,
       created_at   TEXT NOT NULL,
       delivered_at TEXT,
       event_id     TEXT NOT NULL UNIQUE
     )",
    "CREATE INDEX IF NOT EXISTS idx_batches_status ON t4_batches (status)",
    "CREATE TABLE IF NOT EXISTS t4_gate_runs (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       batch_slug TEXT NOT NULL,
       run_index  INTEGER NOT NULL,
       hard_pass  INTEGER NOT NULL,
       receipts   TEXT NOT NULL,
       at         TEXT NOT NULL,
       event_id   TEXT NOT NULL UNIQUE,
       UNIQUE (batch_slug, run_index)
     )",
    "CREATE TABLE IF NOT EXISTS t4_verdicts (
       batch_slug TEXT NOT NULL,
       kind       TEXT NOT NULL CHECK (kind IN ('render.verdict', 'author-batch')),
       source     TEXT NOT NULL,
       verdict    TEXT NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'WARN')),
       confidence TEXT,
       metrics    TEXT,
       note       TEXT,
       at         TEXT NOT NULL,
       event_id   TEXT NOT NULL UNIQUE,
       PRIMARY KEY (batch_slug, kind)
     )",
    "CREATE TABLE IF NOT EXISTS t4_drafts (
       slug       TEXT PRIMARY KEY,
       body       TEXT NOT NULL,
       sha        TEXT NOT NULL,
       created_at TEXT NOT NULL,
       event_id   TEXT NOT NULL UNIQUE
     )",
    "CREATE TABLE IF NOT EXISTS t4_idempotency (
       key        TEXT PRIMARY KEY,
       endpoint   TEXT NOT NULL,
       response    TEXT NOT NULL,
       created_at TEXT NOT NULL
     )",
    "CREATE INDEX IF NOT EXISTS idx_idem_created ON t4_idempotency (created_at)",
];

pub fn production_db_path() -> PathBuf {
    // twin lives at mini-services/t4-engine-rs → sibling t4-engine/data/t4.db
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../t4-engine/data/t4.db")
}

pub fn scratch_db_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("data/t4-rs-scratch.db")
}

/// Read-only production handle (immutable flags + busy timeout).
pub fn open_production_ro() -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        production_db_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

/// Read-write scratch handle (WAL + NORMAL — same doctrine as the engine).
pub fn open_scratch_rw() -> rusqlite::Result<Connection> {
    let path = scratch_db_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(&path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    migrate_schema(&conn)?;
    Ok(conn)
}

pub fn migrate_schema(conn: &Connection) -> rusqlite::Result<()> {
    for stmt in DDL {
        conn.execute_batch(stmt)?;
    }
    let version: Option<String> = conn
        .query_row("SELECT value FROM t4_meta WHERE key = 'schema_version'", [], |r| {
            r.get(0)
        })
        .ok();
    match version {
        None => {
            conn.execute(
                "INSERT INTO t4_meta (key, value) VALUES ('schema_version', ?1)",
                [SCHEMA_VERSION.to_string()],
            )?;
        }
        Some(v) if v.parse::<u32>().unwrap_or(0) > SCHEMA_VERSION => {
            return Err(rusqlite::Error::ToSqlConversionFailure(
                format!("schema downgrade refused: db is v{v}, twin is v{SCHEMA_VERSION}").into(),
            ));
        }
        Some(_) => {}
    }
    Ok(())
}

/* ---------------- meta kv / chain pointer ---------------- */

pub fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM t4_meta WHERE key = ?1", [key], |r| r.get(0))
        .ok()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO t4_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
}

#[derive(Clone, Debug)]
pub struct ChainPointer {
    pub head: String,
    pub height: u32,
}

pub fn read_chain_pointer(conn: &Connection) -> ChainPointer {
    let head = get_meta(conn, "chain_head").unwrap_or_else(|| "GENESIS".to_string());
    let height = get_meta(conn, "chain_height")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    ChainPointer { head, height }
}

pub fn write_chain_pointer(conn: &Connection, p: &ChainPointer) -> rusqlite::Result<()> {
    set_meta(conn, "chain_head", &p.head)?;
    set_meta(conn, "chain_height", &p.height.to_string())?;
    Ok(())
}

pub fn count_events(conn: &Connection) -> u32 {
    conn.query_row("SELECT COUNT(*) FROM t4_events", [], |r| r.get::<_, i64>(0))
        .map(|n| n.max(0) as u32)
        .unwrap_or(0)
}
