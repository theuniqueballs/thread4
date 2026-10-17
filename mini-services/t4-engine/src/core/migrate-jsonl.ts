/**
 * THREAD 4 ENGINE — one-time legacy chronicle import.
 *
 * The file era (thread4/events/{log,chain}.jsonl, 399 links at freeze)
 * migrates into t4_events with ZERO rebase: original seq/id/hash/prev are
 * preserved verbatim, the stored `raw` column carries the exact bytes the
 * legacy chain committed to. Idempotent: guarded by t4_meta.legacy_import.
 *
 * Projections (batches/verdicts) are folded from the imported events so
 * the read models boot warm — history stays the truth, tables stay views.
 */
import fs from 'node:fs'
import type { Database } from 'bun:sqlite'

import { chainHash } from '../lib/canonical'
import { LEGACY_CHAIN, LEGACY_LOG } from '../lib/paths'
import { getMeta, readChainPointer, setMeta, writeChainPointer } from './db'

interface LegacyLink {
  seq: number
  id: string
  hash: string
}

interface LegacyEvent {
  id: string
  at: string
  type: string
  summary: string
  data?: Record<string, unknown>
}

export interface MigrationReport {
  imported: number
  skipped: boolean
  chainVerified: boolean
  problems: string[]
  batchesFolded: number
  verdictsFolded: number
}

const GENESIS = 'GENESIS'

function readLegacyLog(): { rawLines: string[]; events: (LegacyEvent | null)[] } {
  let raw = ''
  try {
    raw = fs.readFileSync(LEGACY_LOG, 'utf-8')
  } catch {
    return { rawLines: [], events: [] }
  }
  const rawLines = raw.split('\n').map((l) => l.replace(/[\r\n]+$/, '')).filter((l) => l.length > 0)
  const events = rawLines.map((l) => {
    try {
      return JSON.parse(l) as LegacyEvent
    } catch {
      return null
    }
  })
  return { rawLines, events }
}

function readLegacyChain(): LegacyLink[] {
  let raw = ''
  try {
    raw = fs.readFileSync(LEGACY_CHAIN, 'utf-8')
  } catch {
    return []
  }
  const out: LegacyLink[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const p = JSON.parse(t) as LegacyLink
      if (typeof p.seq === 'number' && typeof p.hash === 'string') out.push(p)
    } catch {
      /* битая строка — отчёт ниже скажет честно */
    }
  }
  return out
}

/** Fold imported events into the read models (best effort, additive).
 *  Semantics mirror the legacy foldState: a recompile refreshes the row,
 *  a delivery CREATES the batch if no compile event exists (batches
 *  T4-23+ were delivered through the late pipeline without separate
 *  compiled events in the log — history is history). */
function foldLegacyProjections(db: Database): { batches: number; verdicts: number } {
  const rows = db
    .prepare('SELECT seq, id, at, type, summary, data FROM t4_events ORDER BY seq ASC')
    .all() as { seq: number; id: string; at: string; type: string; summary: string; data: string | null }[]

  let batches = 0
  let verdicts = 0
  const upsertCompiled = db.prepare(
    `INSERT INTO t4_batches
       (slug, title, theme, engine, status, slots_total, exp_slots, ab_pairs,
        hard_pass, diff_up, diff_down, payload, sha10, created_at, delivered_at, event_id)
     VALUES (?, ?, ?, ?, 'compiled', ?, ?, ?, 0, 0, 0, ?, 'legacy', ?, NULL, ?)
     ON CONFLICT(slug) DO UPDATE SET
       title = excluded.title, theme = excluded.theme, engine = excluded.engine,
       payload = excluded.payload, event_id = excluded.event_id,
       slots_total = excluded.slots_total, exp_slots = excluded.exp_slots,
       ab_pairs = excluded.ab_pairs`
  )
  const upsertDelivered = db.prepare(
    `INSERT INTO t4_batches
       (slug, title, theme, engine, status, slots_total, exp_slots, ab_pairs,
        hard_pass, diff_up, diff_down, payload, sha10, created_at, delivered_at, event_id)
     VALUES (?, ?, ?, ?, 'delivered', 24, 0, 0, 0, 0, 0, ?, 'legacy', ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       status = 'delivered', delivered_at = excluded.delivered_at, event_id = excluded.event_id`
  )
  const setVoid = db.prepare(
    `INSERT INTO t4_batches
       (slug, title, theme, engine, status, slots_total, exp_slots, ab_pairs,
        hard_pass, diff_up, diff_down, payload, sha10, created_at, delivered_at, event_id)
     VALUES (?, ?, ?, 'per-theme', 'void', 24, 0, 0, 0, 0, 0, ?, 'legacy', ?, NULL, ?)
     ON CONFLICT(slug) DO UPDATE SET status = 'void'`
  )
  const insVerdict = db.prepare(
    `INSERT OR IGNORE INTO t4_verdicts
       (batch_slug, kind, source, verdict, confidence, metrics, note, at, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const seen = new Set<string>()
  for (const r of rows) {
    let data: Record<string, unknown> = {}
    if (r.data) {
      try {
        data = JSON.parse(r.data) as Record<string, unknown>
      } catch {
        data = {}
      }
    }
    const slug = typeof data['slug'] === 'string' ? (data['slug'] as string) : null
    if (r.type === 'batch.compiled' && slug) {
      const before = seen.has(slug)
      upsertCompiled.run(
        slug,
        String(data['title'] ?? r.summary.slice(0, 80)),
        String(data['theme'] ?? ''),
        String(data['engine'] ?? 'per-theme'),
        typeof data['slots'] === 'number' ? (data['slots'] as number) : 24,
        typeof data['exp'] === 'number' ? (data['exp'] as number) : 0,
        typeof data['abPairs'] === 'number' ? (data['abPairs'] as number) : 0,
        JSON.stringify({ legacy: true, summary: r.summary, data }),
        r.at,
        r.id
      )
      seen.add(slug)
      if (!before) batches++
    } else if (r.type === 'batch.delivered' && slug) {
      const before = seen.has(slug)
      upsertDelivered.run(
        slug,
        String(data['title'] ?? r.summary.slice(0, 80)),
        String(data['theme'] ?? ''),
        String(data['engine'] ?? 'per-theme'),
        JSON.stringify({ legacy: true, summary: r.summary, data }),
        r.at,
        r.at,
        r.id
      )
      seen.add(slug)
      if (!before) batches++
    } else if (r.type === 'batch.void' && slug) {
      const before = seen.has(slug)
      setVoid.run(slug, r.summary.slice(0, 80), '', JSON.stringify({ legacy: true, summary: r.summary }), r.at, r.id)
      seen.add(slug)
      if (!before) batches++
    } else if (r.type === 'render.verdict' && slug) {
      const source = String(data['source'] ?? 'author')
      const kind = source === 'author-batch' ? 'author-batch' : 'render.verdict'
      const res = insVerdict.run(
        slug,
        kind,
        source,
        String(data['verdict'] ?? 'FAIL').toUpperCase().slice(0, 4),
        typeof data['confidence'] === 'string' ? (data['confidence'] as string) : null,
        data['metrics'] ? JSON.stringify(data['metrics']) : null,
        typeof data['note'] === 'string' ? (data['note'] as string).slice(0, 4000) : null,
        r.at,
        r.id
      )
      if (res.changes > 0) verdicts++
    }
  }
  return { batches, verdicts }
}

export function migrateLegacyChronicle(db: Database): MigrationReport {
  const already = getMeta(db, 'legacy_imported')
  const pointer = readChainPointer(db)
  if (already != null || pointer.height > 0) {
    return {
      imported: 0,
      skipped: true,
      chainVerified: true,
      problems: [],
      batchesFolded: 0,
      verdictsFolded: 0,
    }
  }

  const { rawLines, events } = readLegacyLog()
  const links = readLegacyChain()
  const problems: string[] = []

  if (rawLines.length === 0) {
    return { imported: 0, skipped: true, chainVerified: true, problems: ['legacy log не найден — начинаю с чистой цепи'], batchesFolded: 0, verdictsFolded: 0 }
  }

  /* Verify the legacy chain INDEPENDENTLY before import: compute over the
   * log, compare to the stored chain.jsonl. A tampered legacy chain is
   * imported AS-IS with honest problems (history is inviolable — we do
   * not heal it, we report it). */
  let prev = GENESIS
  let verified = true
  const computed: { seq: number; id: string; hash: string }[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const hash = chainHash(prev, rawLines[i]!)
    let id = '?'
    const evt = events[i]
    if (evt && typeof evt.id === 'string') id = evt.id
    computed.push({ seq: i + 1, id, hash })
    prev = hash
  }
  for (let i = 0; i < computed.length; i++) {
    const stored = links[i]
    if (!stored || stored.hash !== computed[i]!.hash) {
      verified = false
      problems.push(`legacy seq ${i + 1}: chain.jsonl не совпадает с логом (сохранено как есть — история неприкосновенна)`)
      if (problems.length > 10) break
    }
  }
  if (links.length > 0 && links.length !== rawLines.length) {
    problems.push(`legacy chain короче лога: ${links.length} звеньев против ${rawLines.length} строк`)
  }

  /* Import inside one transaction: 399 rows + head pointer, atomically. */
  let imported = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const ins = db.prepare(
      `INSERT INTO t4_events (seq, id, at, type, summary, data, raw, prev_hash, hash, batch_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    let p = GENESIS
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]!
      const evt = events[i]
      const link = computed[i]!
      const slug =
        evt && evt.data && typeof evt.data['slug'] === 'string' ? (evt.data['slug'] as string) : null
      ins.run(
        link.seq,
        link.id,
        evt?.at ?? '',
        evt?.type ?? 'note',
        evt?.summary ?? '',
        evt?.data ? JSON.stringify(evt.data) : null,
        line,
        p,
        link.hash,
        slug
      )
      p = link.hash
      imported++
    }
    writeChainPointer(db, { head: p, height: imported })
    setMeta(db, 'legacy_imported', new Date().toISOString())
    setMeta(db, 'legacy_imported_count', String(imported))
    const folded = foldLegacyProjections(db)
    db.exec('COMMIT')
    return {
      imported,
      skipped: false,
      chainVerified: verified,
      problems,
      batchesFolded: folded.batches,
      verdictsFolded: folded.verdicts,
    }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
