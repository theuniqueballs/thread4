import { NextResponse } from 'next/server'
import path from 'node:path'

import { BATCHES_DIR, CONTRACTS_DIR, readJson, readText } from '@/lib/t4/fsutil'
import { contractMarkdown, type BatchContract, type SlotPlan } from '@/lib/t4/compiler'
import { extractBatchTitle, genreOf, parseBatch, tierOf } from '@/lib/t4/gates'

export const dynamic = 'force-dynamic'

/**
 * Фред, 2026-10-08: слаг ослаблен (T4-20-EXP и прочие суффиксы) и добавлен
 * фолбэк-контракт: RAW-батчи (T4-23/T4-24) и EXP-батчи живут в batches/
 * БЕЗ contracts/T4-NN.json — приёмник и VLM-куча получали пустой slots[]
 * и в панели не высвечивалось ничего. Фолбэк синтезирует слоты из шапок
 * слотов батча «P01 — anchor (OC · Sue · R+)» тем же парсером, что и гейты:
 * kind=жанр (OC/NICHE/VOLT/EXQUISITE/EXP), rating=tierOf, poseName=anchor.
 * Никаких выдуманных данных: только то, что написано в батче.
 */
const SLUG_RE = /^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/

function synthesizeFromBatch(
  slug: string
): { theme: string; engine: string; slots: SlotPlan[] } | null {
  const md = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (md == null) return null
  const parsed = parseBatch(slug, md)
  if (parsed.slots.length === 0) return null
  const rawFormat = /^#\s*T4-[\dA-Za-z.-]+[^\n]*\bRAW\b/m.test(md)
  const slots = parsed.slots.map((s) => {
    const parts = s.meta.split('·').map((p) => p.trim())
    const kind = s.genre || (parts[0]?.toUpperCase().startsWith('EXP') ? 'EXP' : '')
    return {
      position: s.position,
      kind,
      oc: kind === 'OC' ? parts[1] || undefined : undefined,
      rating: tierOf(s.meta),
      pose: '',
      poseName: s.anchor,
      poseRisk: '',
      palette: '',
      paletteName: '',
      kinetics: [],
      carriers: [],
      lead: '',
      register: 'young',
      closer: '',
    } as SlotPlan
  })
  return {
    theme: extractBatchTitle(md),
    engine: rawFormat ? 'raw-danbooru' : '',
    slots,
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 })
  }
  const contract = readJson<BatchContract>(path.join(CONTRACTS_DIR, `${slug}.json`))
  const md = readText(path.join(CONTRACTS_DIR, `${slug}.md`))
  if (!contract && !md) {
    /* контракта нет — батч есть? синтезируем слоты из его шапок */
    const synth = synthesizeFromBatch(slug)
    if (synth && synth.slots.length > 0) {
      return NextResponse.json({
        slug,
        theme: synth.theme,
        createdAt: '',
        markdown: '',
        contract: {
          slug,
          theme: synth.theme,
          engine: synth.engine,
          slots: synth.slots,
        },
        synthesized: true, // приёмнику полезно знать, что это фолбэк
      })
    }
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({
    slug,
    theme: contract?.theme ?? '',
    createdAt: contract?.createdAt ?? '',
    markdown: md ?? (contract ? contractMarkdown(contract) : ''),
    contract: contract ?? null,
  })
}
