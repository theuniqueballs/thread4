/**
 * THREAD 4 core — append-only event store (constitution §2: state is
 * DERIVED from events, never hand-maintained).
 *
 * Event: { id, at, type, summary, data? }. The log is JSONL, append-only.
 * Fold functions derive every piece of state the compiler and gates need.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

import { ensureDirs, EVENT_LOG } from './fsutil'

export interface T4Event {
  id: string
  at: string
  type: string
  summary: string
  data?: Record<string, unknown>
}

export const EVENT_TYPES = [
  'era.born',
  'spec.imported',
  'law.ratified',
  'law.amended',
  'batch.compiled',
  'batch.delivered',
  'gate.run',
  'fixpass.paid',
  'scribe.drafted',
  'render.verdict',
  'taste.datum',
  'experiment.logged',
  'oc.appeared',
  'note',
] as const

export function appendEvent(
  type: string,
  summary: string,
  data?: Record<string, unknown>
): T4Event {
  ensureDirs()
  const evt: T4Event = {
    id: crypto.randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    type,
    summary,
    ...(data ? { data } : {}),
  }
  fs.appendFileSync(EVENT_LOG, JSON.stringify(evt) + '\n', 'utf-8')
  return evt
}

export function readEvents(): T4Event[] {
  ensureDirs()
  let raw: string
  try {
    raw = fs.readFileSync(EVENT_LOG, 'utf-8')
  } catch {
    return []
  }
  const out: T4Event[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as T4Event)
    } catch {
      // a corrupted line never kills the fold — append-only resilience
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Derived state (the fold)                                            */
/* ------------------------------------------------------------------ */

export interface BatchRecord {
  slug: string
  theme: string
  title?: string
  deliveredAt?: string
}

export interface T4DerivedState {
  batches: BatchRecord[] // compiled batches in slug order
  windowSlugs: string[] // last 3 delivered (or fewer)
  ocAppearances: Record<string, number> // OC name -> times served
  openDebts: string[]
  lastEventAt: string | null
}

/** Delivered = batch.delivered present; window = last 3 delivered. */
export function foldState(events: T4Event[]): T4DerivedState {
  const batches = new Map<string, BatchRecord>()
  const ocAppearances: Record<string, number> = {}
  const openDebts: string[] = []
  let lastEventAt: string | null = null

  for (const e of events) {
    lastEventAt = e.at
    const d = e.data ?? {}
    if (e.type === 'batch.compiled' && typeof d.slug === 'string') {
      const slug = d.slug as string
      const existing = batches.get(slug)
      batches.set(slug, {
        slug,
        theme: (d.theme as string) ?? existing?.theme ?? '',
        title: (d.title as string) ?? existing?.title,
        deliveredAt: existing?.deliveredAt,
      })
    }
    if (e.type === 'batch.delivered' && typeof d.slug === 'string') {
      const slug = d.slug as string
      const existing = batches.get(slug)
      batches.set(slug, {
        slug,
        theme: (d.theme as string) ?? existing?.theme ?? '',
        title: (d.title as string) ?? existing?.title,
        deliveredAt: e.at,
      })
    }
    if (e.type === 'oc.appeared' && typeof d.name === 'string') {
      const name = d.name as string
      ocAppearances[name] = (ocAppearances[name] ?? 0) + 1
    }
    if (e.type === 'note' && typeof d.debt === 'string') {
      openDebts.push(d.debt as string)
    }
  }

  const delivered = [...batches.values()]
    .filter((b) => b.deliveredAt != null)
    .sort((a, b) => (a.deliveredAt! < b.deliveredAt! ? -1 : 1))
  const windowSlugs = delivered.slice(-3).map((b) => b.slug)

  return {
    batches: [...batches.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    windowSlugs,
    ocAppearances,
    openDebts,
    lastEventAt,
  }
}

/** Next batch number: T4-01 if none, else max+1. */
export function nextBatchNumber(batches: BatchRecord[]): number {
  let max = 0
  for (const b of batches) {
    const m = /^T4-(\d+)$/.exec(b.slug)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}
