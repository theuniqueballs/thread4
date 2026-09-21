/**
 * THREAD 4 — AUTO-SCRIBE route (по приказу автора 2026-09-20).
 * POST { slug, maxRepairRounds? } → машина пишет черновик батча по
 * контракту, гейты гоняют его всухую, ремонт до N кругов. Официальная
 * сдача — отдельный шаг (/api/t4/gates { slug, deliver: true } или CLI).
 */
import { NextResponse } from 'next/server'

import { scribeBatch } from '@/lib/t4/scribe'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(req: Request) {
  let body: { slug?: string; maxRepairRounds?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  if (!/^T4-\d{2}$/.test(slug)) {
    return NextResponse.json({ error: 'slug expected: T4-NN' }, { status: 400 })
  }
  const maxRepairRounds =
    typeof body.maxRepairRounds === 'number' ? Math.max(0, Math.min(4, Math.floor(body.maxRepairRounds))) : 2

  try {
    const result = await scribeBatch(slug, { maxRepairRounds })
    return NextResponse.json({
      ok: true,
      slug: result.slug,
      title: result.title,
      rounds: result.rounds,
      hardPass: result.hardPass,
      sha10: result.sha10,
      failedSlots: result.failedSlots,
      log: result.log,
      receipts: result.receipts.map((r) => ({
        gate: r.gate,
        level: r.level,
        verdict: r.verdict,
        findings: r.findings,
      })),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'scribe failed' },
      { status: 500 }
    )
  }
}
