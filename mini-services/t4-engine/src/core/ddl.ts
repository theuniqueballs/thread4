/**
 * THREAD 4 ENGINE — DB schema setup script (bun:sqlite DDL).
 *
 * Fully idempotent: CREATE IF NOT EXISTS everywhere; migrations are
 * additive and versioned via t4_meta.schema_version. The events table is
 * the append-only truth (hash-chained); every other table is a PROJECTION
 * rebuilt transactionally from events — never hand-maintained
 * (constitution §2, unchanged from the file era).
 *
 * Concurrency doctrine: exactly ONE writer process (this engine — it is
 * the Single Source of Truth; CLI and dashboard speak RPC). WAL mode +
 * busy_timeout make concurrent READERS safe even from other processes
 * (e.g. forensic `bun` scripts with readonly handles).
 */
import type { Database } from 'bun:sqlite'

export const SCHEMA_VERSION = 1

export const DDL: readonly string[] = [
  /* ---- meta: schema version, chain head, boot facts ---------------- */
  `CREATE TABLE IF NOT EXISTS t4_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  /* ---- events: the append-only, hash-chained chronicle -------------- */
  `CREATE TABLE IF NOT EXISTS t4_events (
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
   )`,
  `CREATE INDEX IF NOT EXISTS idx_events_type  ON t4_events (type)`,
  `CREATE INDEX IF NOT EXISTS idx_events_slug  ON t4_events (batch_slug)`,

  /* ---- batches: projection of batch.compiled/delivered/void --------- */
  `CREATE TABLE IF NOT EXISTS t4_batches (
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
   )`,
  `CREATE INDEX IF NOT EXISTS idx_batches_status ON t4_batches (status)`,

  /* ---- gate runs: projection of gate.run --------------------------- */
  `CREATE TABLE IF NOT EXISTS t4_gate_runs (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     batch_slug TEXT NOT NULL,
     run_index  INTEGER NOT NULL,
     hard_pass  INTEGER NOT NULL,
     receipts   TEXT NOT NULL,
     at         TEXT NOT NULL,
     event_id   TEXT NOT NULL UNIQUE,
     UNIQUE (batch_slug, run_index)
   )`,

  /* ---- verdicts: projection of render.verdict ----------------------- */
  /* Single record per (batch, kind) — the T4-34 author-batch verdict
   * shape: «одна запись, не журнал». UPSERT keeps it that way. */
  `CREATE TABLE IF NOT EXISTS t4_verdicts (
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
   )`,

  /* ---- drafts: intake ledger for compile requests ------------------- */
  `CREATE TABLE IF NOT EXISTS t4_drafts (
     slug       TEXT PRIMARY KEY,
     body       TEXT NOT NULL,
     sha        TEXT NOT NULL,
     created_at TEXT NOT NULL,
     event_id   TEXT NOT NULL UNIQUE
   )`,

  /* ---- idempotency: replay cache for POST /v1/compile --------------- */
  `CREATE TABLE IF NOT EXISTS t4_idempotency (
     key        TEXT PRIMARY KEY,
     endpoint   TEXT NOT NULL,
     response   TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_idem_created ON t4_idempotency (created_at)`,
]

/** Apply the DDL + record schema version. Safe to run on every boot. */
export function migrateSchema(db: Database): { applied: number; version: number } {
  db.exec('BEGIN')
  try {
    for (const stmt of DDL) db.exec(stmt)
    const version = db
      .prepare('SELECT value FROM t4_meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined
    if (version == null) {
      db.prepare('INSERT INTO t4_meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(SCHEMA_VERSION))
    } else if (Number(version.value) !== SCHEMA_VERSION) {
      // Additive-only policy: a higher version row means a NEWER engine
      // already migrated this file — refuse to downgrade silently.
      if (Number(version.value) > SCHEMA_VERSION) {
        throw new Error(
          `schema downgrade refused: db is v${version.value}, engine is v${SCHEMA_VERSION}`
        )
      }
      db.prepare('UPDATE t4_meta SET value = ? WHERE key = ?')
        .run(String(SCHEMA_VERSION), 'schema_version')
    }
    db.exec('COMMIT')
    return { applied: DDL.length, version: SCHEMA_VERSION }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
