/**
 * THREAD 4 — BRIDGE · ASSEMBLE (cutover-эра, 2026-10-20).
 *
 * Сборка файла батча из outputs писца: канон шапки/актов/спайнов/NEG —
 * дословно файловая эра (assembleBatch). Файл на диск пишет Rust; здесь
 * только текст. Название батча = тема автора (вердикт 2026-09-27).
 *
 * COMPUTE-ONLY: ни файлов, ни событий.
 */
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { assembleBatch, type ScribeSlotOutput } from '@/lib/t4/scribe'

import { bridgeContract, bridgeSlug, ctxWithBuild } from '@/lib/t4/bridge-serve'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: { slug?: unknown; build?: unknown; outputs?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const slug = bridgeSlug(body.slug)
  if (slug == null) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }
  if (!Array.isArray(body.outputs)) {
    return NextResponse.json({ error: 'outputs: массив слотов писца' }, { status: 400 })
  }

  const contract = bridgeContract(slug)
  if (contract == null) {
    return NextResponse.json({ error: `контракт ${slug} не найден — сначала «Компиляция»` }, { status: 404 })
  }

  const outputs = new Map<number, ScribeSlotOutput>()
  for (const raw of body.outputs as unknown[]) {
    if (raw == null || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const position = typeof rec.position === 'number' && Number.isInteger(rec.position) ? rec.position : -1
    if (position < 1 || position > 99) continue
    outputs.set(position, {
      position,
      anchor: typeof rec.anchor === 'string' ? rec.anchor : 'unnamed-frame',
      thesis: typeof rec.thesis === 'string' ? rec.thesis : '',
      pos: typeof rec.pos === 'string' ? rec.pos : '',
      negExtra: typeof rec.negExtra === 'string' ? rec.negExtra : '',
    })
  }
  if (outputs.size === 0) {
    return NextResponse.json({ error: 'outputs пуст — нечего собирать' }, { status: 422 })
  }

  try {
    const ctx = await ctxWithBuild(contract, (body.build ?? {}) as Record<string, unknown>)
    const markdown = assembleBatch(ctx, outputs, contract.theme)
    return NextResponse.json({ ok: true, data: { markdown } })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'assemble failed' },
      { status: 500 }
    )
  }
}
