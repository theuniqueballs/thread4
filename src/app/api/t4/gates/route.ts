import { NextResponse } from 'next/server'

import { requireCommander } from '@/lib/t4/apiguard'
import { runGates } from '@/lib/t4/gates'
import { deliverBatch } from '@/lib/t4/deliver'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): deliver пишет batches/*.md+json, события
   * batch.delivered/oc.appeared и git-снапшот; сам прогон гейтов — чтение,
   * но роут один на оба режима — лочится целиком (дешевле и предсказуемей). */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: { slug?: string; deliver?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  /* аудит 2026-10-12: регэксп расширен до суффиксных слагов (T4-27.2-EXP и
   * родня EXP/RAW легальны — раньше API отбивал их 400-й); [A-Za-z0-9]
   * после разделителя исключает '..' и любые разделители пути */
  if (!/^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }

  if (body.deliver) {
    const delivered = deliverBatch(slug)
    if (!delivered) {
      return NextResponse.json({ error: 'batch file not found' }, { status: 404 })
    }
    return NextResponse.json({
      ok: delivered.ok,
      delivered: delivered.ok,
      title: delivered.title,
      result: delivered.result,
    })
  }

  const result = runGates(slug)
  if (!result) {
    return NextResponse.json({ error: 'batch file not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
