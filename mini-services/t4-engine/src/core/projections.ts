/**
 * THREAD 4 ENGINE — projections: read models derived from events.
 *
 * Constitution §2 unchanged: state is DERIVED, never hand-maintained.
 * Every mutation is one transaction = {append event + update projection};
 * a crash leaves either both or neither. Queries below are O(1)/O(log n)
 * index lookups — the file era re-parsed the whole log per request.
 */
import type { Database } from 'bun:sqlite'

import type { EventRow } from './chain'

export interface BatchRow {
  slug: string
  title: string
  theme: string
  engine: string
  status: string
  slots_total: number
  exp_slots: number
  ab_pairs: number
  hard_pass: number
  diff_up: number
  diff_down: number
  payload: string
  sha10: string
  created_at: string
  delivered_at: string | null
}

export interface VerdictRow {
  batch_slug: string
  kind: string
  source: string
  verdict: string
  confidence: string | null
  metrics: string | null
  note: string | null
  at: string
}

export function upsertBatchFromCompile(db: Database, plan: {
  slug: string
  title: string
  theme: string
  engine: string
  slots: unknown[]
  exp: number
  abPairs: number
  hardPass: boolean
  diffUp: number
  diffDown: number
  payloadJson: string
  sha10: string
  createdAt: string
  eventId: string
}): void {
  db.prepare(
    `INSERT INTO t4_batches
       (slug, title, theme, engine, status, slots_total, exp_slots, ab_pairs,
        hard_pass, diff_up, diff_down, payload, sha10, created_at, delivered_at, event_id)
     VALUES (?, ?, ?, ?, 'compiled', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(slug) DO UPDATE SET
       title = excluded.title, theme = excluded.theme, engine = excluded.engine,
       status = 'compiled', slots_total = excluded.slots_total, exp_slots = excluded.exp_slots,
       ab_pairs = excluded.ab_pairs, hard_pass = excluded.hard_pass,
       diff_up = excluded.diff_up, diff_down = excluded.diff_down,
       payload = excluded.payload, sha10 = excluded.sha10, created_at = excluded.created_at,
       delivered_at = NULL, event_id = excluded.event_id`
  ).run(
    plan.slug,
    plan.title,
    plan.theme,
    plan.engine,
    plan.slots.length,
    plan.exp,
    plan.abPairs,
    plan.hardPass ? 1 : 0,
    plan.diffUp,
    plan.diffDown,
    plan.payloadJson,
    plan.sha10,
    plan.createdAt,
    plan.eventId
  )
}

export function markDelivered(db: Database, slug: string, at: string, eventId: string): boolean {
  const res = db
    .prepare("UPDATE t4_batches SET status = 'delivered', delivered_at = ? WHERE slug = ? AND status = 'compiled'")
    .run(at, slug)
  if (res.changes === 0) return false
  void eventId
  return true
}

export function markVoid(db: Database, slug: string): boolean {
  const res = db
    .prepare("UPDATE t4_batches SET status = 'void' WHERE slug = ? AND status != 'void'")
    .run(slug)
  return res.changes > 0
}

/**
 * Boot-time reconciliation: projections are DERIVED state (constitution §2),
 * the event chain is the truth. Any write path that resets status/delivered_at
 * (migration rebuild, rematerialize, manual surgery) is healed here at boot —
 * batch.delivered / batch.void events in the chain always win over a stale
 * projection row. Idempotent: a healthy DB changes 0 rows.
 *
 * Находка фазы 6 (2026-10-24): T4-33 «сдан давно, а движок отвечает
 * compiled» — проекция могла отстать от цепи; состояние обязано выводиться
 * из событий, поэтому выведение теперь при каждом старте.
 */
export function reconcileProjectionsFromChain(db: Database): { delivered: number; voided: number } {
  const delivered = db
    .prepare(
      `UPDATE t4_batches SET
         status = 'delivered',
         delivered_at = COALESCE(delivered_at, (
           SELECT MAX(at) FROM t4_events
           WHERE type = 'batch.delivered' AND batch_slug = t4_batches.slug
         ))
       WHERE status != 'delivered' AND status != 'void'
         AND EXISTS (SELECT 1 FROM t4_events WHERE type = 'batch.delivered' AND batch_slug = t4_batches.slug)`
    )
    .run().changes
  const voided = db
    .prepare(
      `UPDATE t4_batches SET status = 'void'
       WHERE status != 'void'
         AND EXISTS (SELECT 1 FROM t4_events WHERE type = 'batch.void' AND batch_slug = t4_batches.slug)`
    )
    .run().changes
  if (delivered > 0 || voided > 0) {
    console.log(
      `[t4-engine] reconcile: проекция согласована с цепью — delivered +${delivered}, void +${voided} (§2: состояние выводится из событий)`
    )
  }
  return { delivered, voided }
}

export function upsertVerdict(
  db: Database,
  v: {
    slug: string
    kind: string
    source: string
    verdict: string
    confidence: string | null
    metricsJson: string | null
    note: string | null
    at: string
    eventId: string
  }
): void {
  db.prepare(
    `INSERT INTO t4_verdicts
       (batch_slug, kind, source, verdict, confidence, metrics, note, at, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(batch_slug, kind) DO UPDATE SET
       source = excluded.source,
       verdict = excluded.verdict,
       confidence = excluded.confidence,
       metrics = excluded.metrics,
       note = excluded.note,
       at = excluded.at,
       event_id = excluded.event_id`
  ).run(v.slug, v.kind, v.source, v.verdict, v.confidence, v.metricsJson, v.note, v.at, v.eventId)
}

export function getBatch(db: Database, slug: string): BatchRow | null {
  return (db.prepare('SELECT * FROM t4_batches WHERE slug = ?').get(slug) as BatchRow | undefined) ?? null
}

export function listBatches(db: Database, status?: string): BatchRow[] {
  if (status) {
    return db.prepare('SELECT * FROM t4_batches WHERE status = ? ORDER BY created_at DESC').all(status) as BatchRow[]
  }
  return db.prepare('SELECT * FROM t4_batches ORDER BY created_at DESC').all() as BatchRow[]
}

export function getVerdict(db: Database, slug: string, kind: string): VerdictRow | null {
  return (db.prepare('SELECT * FROM t4_verdicts WHERE batch_slug = ? AND kind = ?').get(slug, kind) as VerdictRow | undefined) ?? null
}

export function listVerdicts(db: Database, slug?: string): VerdictRow[] {
  if (slug) {
    return db.prepare('SELECT * FROM t4_verdicts WHERE batch_slug = ? ORDER BY at DESC').all(slug) as VerdictRow[]
  }
  return db.prepare('SELECT * FROM t4_verdicts ORDER BY at DESC').all() as VerdictRow[]
}

/** Last N delivered batches (palette window source), newest first. */
export function recentDelivered(db: Database, n: number): BatchRow[] {
  return db
    .prepare("SELECT * FROM t4_batches WHERE status = 'delivered' ORDER BY delivered_at DESC LIMIT ?")
    .all(n) as BatchRow[]
}

/** Max T4-NN ever compiled (void numbers are not reused — provenance). */
export function nextBatchNumber(db: Database): number {
  const rows = db.prepare('SELECT slug FROM t4_batches').all() as { slug: string }[]
  let max = 0
  for (const r of rows) {
    const m = /^T4-(\d{2,3})$/.exec(r.slug)
    if (m) max = Math.max(max, parseInt(m[1]!, 10))
  }
  return max + 1
}

/** Distinct palette ids used by the recent delivered window. */
export function paletteWindowUnion(db: Database, windowBatches: number): Set<string> {
  const union = new Set<string>()
  for (const b of recentDelivered(db, windowBatches)) {
    try {
      const payload = JSON.parse(b.payload) as { slots?: { paletteId?: string }[] }
      for (const s of payload.slots ?? []) {
        if (s.paletteId) union.add(s.paletteId)
      }
    } catch {
      /* legacy payload without palette ids — window simply skips it */
    }
  }
  return union
}

/** Deliverability: a compiled batch may be delivered only when its
 *  planning gates passed hard (first-run-clean doctrine, §9). */
export function batchHardPass(db: Database, slug: string): boolean {
  const row = db.prepare('SELECT hard_pass FROM t4_batches WHERE slug = ?').get(slug) as
    | { hard_pass: number }
    | undefined
  return row != null && row.hard_pass === 1
}

/**
 * Event row → public JSON shape. hash + prev are exposed (2026-10-18,
 * neon-dogma dashboard): the browser-side chronicle visualizer re-validates
 * every link client-side (prev[i] === hash[i-1]) so each JSONL row can carry
 * an honest crypto tick. raw bytes stay internal — only the engine
 * recomputes sha256 from raw (chain/verify remains the authority).
 */
export function eventToJson(e: EventRow): Record<string, unknown> {
  return {
    seq: e.seq,
    id: e.id,
    at: e.at,
    type: e.type,
    summary: e.summary,
    hash: e.hash,
    prev: e.prev_hash,
    ...(e.data ? { data: JSON.parse(e.data) as unknown } : {}),
  }
}
