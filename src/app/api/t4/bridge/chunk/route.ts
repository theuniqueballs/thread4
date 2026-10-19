/**
 * THREAD 4 — BRIDGE · CHUNK (cutover-эра, 2026-10-20).
 *
 * Этап «Писец» единого конвейера: LLM пишет СЛОТЫ (чанки по ≤6). Rust
 * оркестрирует: какие позиции, какой режим (write | repair | polish),
 * какие находки гейтов чинить. Здесь — ТОЛЬКО проза и парсер; гейты,
 * файл батча, летопись — на стороне Rust.
 *
 * COMPUTE-ONLY: ни файлов, ни событий. Ремонт/полировка пишут ТОЛЬКО
 * позиции своего набора (аудит 2026-10-12: модель не может затереть
 * здоровый слот «лишним» ответом).
 */
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { resolveLlmProvider } from '@/lib/t4/llm-provider'
import {
  REPAIR_BOILERPLATE,
  REPAIR_TIER_BUDGET,
  batchLawBlockOf,
  chat,
  parseSlots,
  slotFrame,
  systemPrompt,
  type ScribeSlotOutput,
} from '@/lib/t4/scribe'

import { bridgeContract, bridgeSlug, ctxWithBuild } from '@/lib/t4/bridge-serve'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

type Mode = 'write' | 'repair' | 'polish'

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: {
    slug?: unknown
    build?: unknown
    positions?: unknown
    mode?: unknown
    findings?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const slug = bridgeSlug(body.slug)
  if (slug == null) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }
  const mode: Mode = body.mode === 'repair' || body.mode === 'polish' ? body.mode : 'write'
  const positions: number[] = Array.isArray(body.positions)
    ? (body.positions as unknown[])
        .map((p) => (typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 99 ? p : -1))
        .filter((p) => p > 0)
        .slice(0, 40)
    : []
  if (positions.length === 0) {
    return NextResponse.json({ error: 'positions: массив номеров слотов (1..99)' }, { status: 400 })
  }
  const findings: string[] = Array.isArray(body.findings)
    ? (body.findings as unknown[])
        .map((f) => (typeof f === 'string' ? f : ''))
        .filter((f) => f.trim() !== '')
        .slice(0, 32)
    : []

  const contract = bridgeContract(slug)
  if (contract == null) {
    return NextResponse.json({ error: `контракт ${slug} не найден — сначала «Компиляция»` }, { status: 404 })
  }
  const byPos = new Map(contract.slots.map((s) => [s.position, s]))
  const slots = positions
    .map((p) => byPos.get(p))
    .filter((s): s is NonNullable<typeof s> => s != null)
  if (slots.length === 0) {
    return NextResponse.json({ error: 'в контракте нет ни одной из позиций' }, { status: 422 })
  }

  try {
    const ctx = await ctxWithBuild(contract, (body.build ?? {}) as Record<string, unknown>)
    const batchLawBlock = batchLawBlockOf(slug, ctx)
    const provider = resolveLlmProvider()

    const frames = () => slots.map((s) => slotFrame(s, ctx)).join('\n\n')
    const findingsBlock =
      mode === 'write'
        ? ''
        : `\n\n${mode === 'repair' ? 'GATE FAILURES TO FIX:' : 'QUALITY FINDINGS TO FIX:'}\n${findings
            .map((f) => `- ${f}`)
            .join('\n')}`

    const user =
      mode === 'write'
        ? `${batchLawBlock}\n\nSLOTS (write ALL of them, in order):\n\n${frames()}`
        : mode === 'repair'
          ? `${batchLawBlock}\n\nREWRITE THESE SLOTS — they failed the machine gates. Keep what worked, fix what is flagged. Same exact format.\n\n${REPAIR_BOILERPLATE}\n\n${REPAIR_TIER_BUDGET}\n\n${frames()}${findingsBlock}`
          : `${batchLawBlock}\n\nREWRITE THESE SLOTS — they carry WARN-level QUALITY findings (the batch already passed all HARD gates — do NOT introduce any new fabric/claim/underlayer that could break them, and NEVER import signals from the slot's FORBIDDEN tier list — T4-005). Keep the same anchor, pose, palette, canon and stack. Keep what worked, fix what is flagged. Same exact format.\n\n${REPAIR_TIER_BUDGET}\n\n${frames()}${findingsBlock}`

    const raw = await chat(provider, systemPrompt(), user, [])
    let parsed = parseSlots(raw)

    /* недописанные слоты — один повтор (зеркало scribeBatchInner) */
    const missing = slots.filter((s) => !(parsed.get(s.position)?.pos ?? '').trim())
    if (mode === 'write' && missing.length > 0) {
      const retry = await chat(
        provider,
        systemPrompt(),
        `${user}\n\nREMINDER: output EVERY slot above in the exact format. Do not skip any.`,
        []
      )
      for (const [n, o] of parseSlots(retry)) parsed.set(n, o)
    }

    /* только запрошенные позиции, только живые POS */
    const wanted = new Set(slots.map((s) => s.position))
    const outputs: ScribeSlotOutput[] = []
    for (const s of slots) {
      const o = parsed.get(s.position)
      if (o != null && o.pos.trim() !== '' && wanted.has(o.position)) {
        outputs.push(o)
      }
    }

    return NextResponse.json({ ok: true, data: { outputs } })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'chunk failed' },
      { status: 500 }
    )
  }
}
