import { NextResponse } from 'next/server'

import { foldState, nextBatchNumber, readEvents } from '@/lib/t4/events'
import { specInventory } from '@/lib/t4/specs'
import { GATES_TOTAL } from '@/lib/t4/gates'
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
  // следующий номер — по максимальному НЕзакрытому слагу (T4-06 void не считается)
  const nextNum = nextBatchNumber(state.batches, state.voidedSlugs)
  const nextStep =
    delivered.length === 0
      ? `T4-${String(nextNum).padStart(2, '0')} — ждёт тему от автора`
      : `T4-${String(nextNum).padStart(2, '0')} — следующий цикл`

  return NextResponse.json({
    era: 'THREAD 4',
    lastBatch: last ? `${last.slug}${last.title ? ` «${last.title}»` : ''}` : '— (эра только родилась)',
    nextStep,
    gateHealth: `hard / warn / advisory — ${GATES_TOTAL} гейтов (закон 24 слотов)`,
    gatesTotal: GATES_TOTAL,
    voidedSlugs: state.voidedSlugs,
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
