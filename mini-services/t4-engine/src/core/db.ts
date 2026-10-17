/**
 * THREAD 4 ENGINE — bun:sqlite bootstrap (the ONE writer).
 *
 * WAL + NORMAL sync + 5s busy timeout: readers from other processes are
 * always safe; the single-writer doctrine (all mutations flow through
 * this process) means BEGIN transactions never fight each other.
 */
import fs from 'node:fs'
import { Database } from 'bun:sqlite'

import { DB_PATH, DATA_DIR } from '../lib/paths'
import { migrateSchema, SCHEMA_VERSION } from './ddl'

export interface MetaRow {
  key: string
  value: string
}

let _db: Database | null = null

export function openDatabase(): Database {
  if (_db != null) return _db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(DB_PATH, { create: true })
  // Hard durability doctrine: WAL survives process crash; NORMAL sync is
  // the documented safe pairing with WAL for this workload.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA wal_autocheckpoint = 1000')
  migrateSchema(db)
  _db = db
  return db
}

/** Test/introspection helper — production code uses openDatabase(). */
export function databaseHandle(): Database | null {
  return _db
}

export function schemaVersion(): number {
  return SCHEMA_VERSION
}

/** Fold WAL back into the main db file — called before git snapshots. */
export function checkpointWal(db: Database): boolean {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* meta kv                                                             */
/* ------------------------------------------------------------------ */

const metaGet = (db: Database, key: string): string | null => {
  const row = db.prepare('SELECT value FROM t4_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function getMeta(db: Database, key: string): string | null {
  return metaGet(db, key)
}

export function setMeta(db: Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO t4_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export interface ChainPointer {
  head: string
  height: number
}

export function readChainPointer(db: Database): ChainPointer {
  const head = metaGet(db, 'chain_head')
  const height = metaGet(db, 'chain_height')
  return { head: head ?? 'GENESIS', height: height ? Number(height) : 0 }
}

export function writeChainPointer(db: Database, p: ChainPointer): void {
  setMeta(db, 'chain_head', p.head)
  setMeta(db, 'chain_height', String(p.height))
}
