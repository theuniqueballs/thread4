import { NextResponse } from 'next/server'

import { foldState, readEvents } from '@/lib/t4/events'
import { specInventory } from '@/lib/t4/specs'
import { listFiles, BATCHES_DIR } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET() {
  const events = readEvents()
  const state = foldState(events)
  const batches = listFiles(BATCHES_DIR, '.md')
  const inv = specInventory()
  const carriers = inv.find((s) => s.id === 'carriers')
  const poses = inv.find((s) => s.id === 'poses')
  const palettes = inv.find((s) => s.id === 'palettes')
  const delivered = state.batches.filter((b) => b.deliveredAt)
  const last = delivered[delivered.length - 1]

  return NextResponse.json({
    era: 'THREAD 4',
    lastBatch: last ? `${last.slug}${last.title ? ` «${last.title}»` : ''}` : '— (эра только родилась)',
    nextStep:
      delivered.length === 0
        ? 'T4-01 — ждёт тему от автора'
        : `T4-${String(delivered.length + 1).padStart(2, '0')} — следующий цикл`,
    gateHealth: 'hard / warn / advisory — 11 гейтов',
    counts: {
      batches: delivered.length,
      events: events.length,
      carriers: carriers?.count ?? 0,
      poses: poses?.count ?? 0,
      palettes: palettes?.count ?? 0,
    },
    openDebts: state.openDebts,
  })
}
