/**
 * THREAD 4 ENGINE — the hash chain (Залп 1 «Правда», sqlite edition).
 *
 * Formula is INHERITED from the file era byte-for-byte:
 *   hash = sha256(prev + '|' + rawLine), genesis link = 'GENESIS'.
 * The legacy 399-link chronicle imports without a rebase; new links
 * extend the same chain. Every append is one IMMEDIATE transaction:
 * {read head → insert event → advance head}, so a crash mid-append
 * leaves either the old head or the new one — never a fork.
 */
import crypto from 'node:crypto'
import type { Database } from 'bun:sqlite'

import {
  canonicalEventLine,
  chainHash,
  type CanonicalEvent,
} from '../lib/canonical'
import { CANON, CONFIDENCE_LEVELS, EVENT_TYPES, VERDICT_SOURCES, type EventType } from '../config/canon'
import { readChainPointer, writeChainPointer } from './db'

export interface EventRow {
  seq: number
  id: string
  at: string
  type: string
  summary: string
  data: string | null
  raw: string
  prev_hash: string
  hash: string
  batch_slug: string | null
}

export interface ChainVerdict {
  ok: boolean
  events: number
  head: string | null
  problems: string[]
}

/* ------------------------------------------------------------------ */
/* Born-wounded checks (ported verbatim: the chronicle refuses scars)   */
/* ------------------------------------------------------------------ */

export function assertBornClean(summary: string): void {
  if (summary.includes('\uFFFD')) {
    throw new Error(
      'event born wounded: U+FFFD в summary — битая кодировка фиксируется на входе, не в истории (инцидент 2026-09-26)'
    )
  }
  if (summary.length > 4000) {
    throw new Error(`event born wounded: summary > 4000 симв (получено ${summary.length})`)
  }
}

export function assertBornSemantics(type: string, data?: Record<string, unknown>): void {
  if (!(EVENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`event born wounded: неизвестный тип «${type}» — летопись закрыта enum'ом`)
  }
  if (type === 'render.verdict') {
    const src = data?.['source']
    if (typeof src !== 'string' || !(VERDICT_SOURCES as readonly string[]).includes(src)) {
      throw new Error(
        `event born wounded: render.verdict требует data.source из enum [${VERDICT_SOURCES.join(', ')}] (Issue #1)`
      )
    }
    const conf = data?.['confidence']
    if (conf != null && (typeof conf !== 'string' || !(CONFIDENCE_LEVELS as readonly string[]).includes(conf))) {
      throw new Error(`event born wounded: confidence вне enum [${CONFIDENCE_LEVELS.join(', ')}] (Issue #4)`)
    }
    if ((src === 'author' || src === 'author-batch' || src === 'author-verbatim' || src === 'author-oc') && conf == null) {
      throw new Error(
        `event born wounded: author-вердикт требует confidence: ${CONFIDENCE_LEVELS.join(' | ')} (Issue #4)`
      )
    }
  }
  if (type === 'oracle.spoke') {
    const model = data?.['model']
    if (typeof model !== 'string' || model.trim() === '') {
      throw new Error('event born wounded: oracle.spoke требует data.model — анонимный оракул запрещён')
    }
    const reply = data?.['reply']
    if (typeof reply !== 'string' || reply.length < 50 || reply.length > 4000) {
      throw new Error('event born wounded: oracle.spoke требует data.reply 50..4000 симв')
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ids — 8 hex, collision-retried under the UNIQUE index               */
/* ------------------------------------------------------------------ */

function newEventId(db: Database): string {
  const exists = db.prepare('SELECT 1 FROM t4_events WHERE id = ?')
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = crypto.randomUUID().slice(0, 8)
    if (exists.get(id) == null) return id
  }
  /* astronomically unlikely; still deterministic failure, not corruption */
  throw new Error('event id space exhausted (8 попыток, все коллизии) — проверь целостность БД')
}

/* ------------------------------------------------------------------ */
/* Append (transactional core; callers wrap projections in the SAME tx) */
/* ------------------------------------------------------------------ */

export interface AppendInput {
  type: EventType
  summary: string
  data?: Record<string, unknown>
  batchSlug?: string
}

/**
 * Appends one event INSIDE an open transaction. The public entry point
 * is `appendEvent` (opens its own IMMEDIATE transaction); handlers that
 * also mutate projections call this within `withTransaction` so event +
 * projection commit atomically (state is derived, never half-written).
 */
export function appendEventTx(db: Database, input: AppendInput): EventRow {
  assertBornClean(input.summary)
  assertBornSemantics(input.type, input.data)
  const pointer = readChainPointer(db)
  const id = newEventId(db)
  const evt: CanonicalEvent = {
    id,
    at: new Date().toISOString(),
    type: input.type,
    summary: input.summary,
    ...(input.data !== undefined ? { data: input.data } : {}),
  }
  const raw = canonicalEventLine(evt)
  const hash = chainHash(pointer.head, raw)
  db.prepare(
    `INSERT INTO t4_events (id, at, type, summary, data, raw, prev_hash, hash, batch_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, evt.at, evt.type, evt.summary, evt.data === undefined ? null : JSON.stringify(input.data), raw, pointer.head, hash, input.batchSlug ?? null)
  writeChainPointer(db, { head: hash, height: pointer.height + 1 })
  return {
    seq: pointer.height + 1,
    id,
    at: evt.at,
    type: evt.type,
    summary: evt.summary,
    data: evt.data === undefined ? null : JSON.stringify(input.data),
    raw,
    prev_hash: pointer.head,
    hash,
    batch_slug: input.batchSlug ?? null,
  }
}

/** Transaction wrapper — Bun nests via savepoints when needed. */
export function withTransaction<T>(db: Database, fn: () => T): T {
  const tx = db.transaction(fn)
  return tx() as T
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

interface RawRow {
  seq: number
  id: string
  at: string
  type: string
  summary: string
  data: string | null
  raw: string
  prev_hash: string
  hash: string
  batch_slug: string | null
}

const toRow = (r: RawRow): EventRow => ({ ...r })

export function readEvents(
  db: Database,
  opts: { after?: number; limit?: number; type?: string } = {}
): EventRow[] {
  const after = opts.after ?? 0
  const limit = Math.min(opts.limit ?? 100, 1000)
  if (opts.type) {
    const rows = db
      .prepare(
        'SELECT * FROM t4_events WHERE seq > ? AND type = ? ORDER BY seq ASC LIMIT ?'
      )
      .all(after, opts.type, limit) as RawRow[]
    return rows.map(toRow)
  }
  const rows = db
    .prepare('SELECT * FROM t4_events WHERE seq > ? ORDER BY seq ASC LIMIT ?')
    .all(after, limit) as RawRow[]
  return rows.map(toRow)
}

export function countEvents(db: Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM t4_events').get() as { n: number }
  return row.n
}

/** Full chain audit — recomputes every hash from the stored raw lines.
 *  The auditor never trusts the cached head (same doctrine as the file
 *  era). O(n) over ~400 events = sub-millisecond per sha256. */
export function verifyChain(db: Database): ChainVerdict {
  const problems: string[] = []
  const rows = db
    .prepare('SELECT seq, id, raw, prev_hash, hash FROM t4_events ORDER BY seq ASC')
    .all() as { seq: number; id: string; raw: string; prev_hash: string; hash: string }[]

  if (rows.length === 0) {
    return { ok: true, events: 0, head: null, problems: ['цепь пуста — летопись ещё не родилась'] }
  }

  let prev: string = CANON.chain.genesis
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (r.prev_hash !== prev) {
      problems.push(`seq ${r.seq}: prev_hash не совпадает с хешем предыдущего звена (форк/правка)`)
    }
    const computed = chainHash(prev, r.raw)
    if (computed !== r.hash) {
      problems.push(`seq ${r.seq}: hash не воспроизводится из raw — летопись правлена руками`)
    }
    if (r.seq !== i + 1) {
      problems.push(`seq ${r.seq}: нумерация дырявая (ожидалась ${i + 1})`)
    }
    prev = r.hash
  }
  const pointer = readChainPointer(db)
  const last = rows[rows.length - 1]!
  if (pointer.head !== last.hash || pointer.height !== last.seq) {
    problems.push(
      `t4_meta head/height (${pointer.head.slice(0, 10)}…/${pointer.height}) отстал от таблицы (${last.hash.slice(0, 10)}…/${last.seq})`
    )
  }
  return { ok: problems.length === 0, events: rows.length, head: last.hash, problems }
}
