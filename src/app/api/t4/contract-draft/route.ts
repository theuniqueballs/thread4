/**
 * THREAD 4 — CONTRACT DRAFT (без компиляции).
 *
 * Автор вписывает тему, три OC-темы с рейтингами, пожелания и раскладку
 * (кины, X, A/B, rehab) — UI сохраняет это как ЧЕРНОВИК с авто-номером.
 * Компилятор этот файл не читает (low-trust разделение, Issue #21):
 * черновик — письменный бриф для писца Чарли, а не машинный вход.
 */
import { NextResponse } from 'next/server'

import { appendEvent } from '@/lib/t4/events'
import { DRAFTS_DIR, BATCHES_DIR, CONTRACTS_DIR, listFiles, writeJson, writeText } from '@/lib/t4/fsutil'
import { getRaces } from '@/lib/t4/specs'

export const dynamic = 'force-dynamic'

interface OcTheme {
  theme?: string
  rating?: string
  wishes?: string
}

interface DraftBody {
  theme?: string
  ocThemes?: OcTheme[]
  mainWishes?: string
  speciesOn?: boolean
  speciesCount?: number
  speciesList?: string[]
  xSlots?: number
  abPairs?: number
  rehab?: boolean
  engine?: string
  notes?: string
}

const RATINGS = new Set(['PG-13', 'R', 'R+', 'X'])

function nextSlug(): string {
  let max = 0
  for (const dir of [BATCHES_DIR, CONTRACTS_DIR, DRAFTS_DIR]) {
    for (const f of listFiles(dir, '.md')) {
      const m = /^T4-(\d{2,3})([-.].*)?$/.exec(f.base)
      if (m) max = Math.max(max, Number(m[1]))
    }
    for (const f of listFiles(dir, '.json')) {
      const m = /^T4-(\d{2,3})([-.].*)?$/.exec(f.base)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return `T4-${String(max + 1).padStart(2, '0')}`
}

export async function GET() {
  const races = (getRaces()?.races ?? [])
    .filter((r) => r.status === 'active')
    .map((r) => ({ id: r.id, name: r.name }))
  return NextResponse.json({ nextSlug: nextSlug(), races })
}

export async function POST(req: Request) {
  let body: DraftBody
  try {
    body = (await req.json()) as DraftBody
  } catch {
    return NextResponse.json({ error: 'тело запроса не JSON' }, { status: 400 })
  }

  const theme = String(body.theme ?? '').trim()
  if (theme === '') {
    return NextResponse.json({ error: 'тема обязательна' }, { status: 400 })
  }
  const ocThemes = (body.ocThemes ?? []).slice(0, 3).map((o, i) => ({
    theme: String(o.theme ?? '').trim(),
    rating: RATINGS.has(String(o.rating)) ? String(o.rating) : 'R+',
    wishes: String(o.wishes ?? '').trim(),
    position: i + 1,
  }))

  const slug = nextSlug()
  const draft = {
    slug,
    kind: 'draft',
    status: 'draft — без компиляции (Issue #21: авто-входы low-trust; это письменный бриф писцу)',
    createdAt: new Date().toISOString(),
    theme,
    ocThemes,
    mainWishes: String(body.mainWishes ?? '').trim(),
    species: {
      on: body.speciesOn === true,
      count: Number(body.speciesCount ?? 0) || 0,
      list: Array.isArray(body.speciesList) ? body.speciesList.map(String) : [],
    },
    xSlots: Math.max(0, Math.min(2, Number(body.xSlots ?? 0) || 0)),
    abPairs: Math.max(0, Math.min(3, Number(body.abPairs ?? 0) || 0)),
    rehab: body.rehab === true,
    engine: String(body.engine ?? 'per-theme'),
    notes: String(body.notes ?? '').trim(),
  }

  const jsonPath = `${DRAFTS_DIR}/${slug}-draft.json`
  writeJson(jsonPath, draft)

  const ocLines = draft.ocThemes
    .map((o) => `- OC-${o.position}: ${o.theme || '—'} [${o.rating}]${o.wishes ? ` — ${o.wishes}` : ''}`)
    .join('\n')
  const md = [
    `# ${slug} — ЧЕРНОВИК КОНТРАКТА (авторский бриф)`,
    '',
    `**Статус**: черновик без компиляции. Писец (Чарли) читает это как бриф и компилирует контракт отдельно.`,
    '',
    `## Тема`,
    theme,
    '',
    `## Темы ОС`,
    ocLines,
    '',
    `## Пожелания к основной теме`,
    draft.mainWishes || '—',
    '',
    `## Раскладка от автора`,
    `- Кины (Species): ${draft.species.on ? `ON, ~${draft.species.count}` : 'OFF'}${draft.species.list.length ? ` — ${draft.species.list.join(', ')}` : ''}`,
    `- X-слоты: ${draft.xSlots}`,
    `- A/B-пары: ${draft.abPairs}`,
    `- REHAB: ${draft.rehab ? 'да' : 'по умолчанию'}`,
    `- Движок: ${draft.engine}`,
    draft.notes ? `- Заметки: ${draft.notes}` : '',
    '',
  ].join('\n')
  writeText(`${DRAFTS_DIR}/${slug}-draft.md`, md)

  appendEvent(
    'note',
    `${slug}: черновик контракта создан автором через UI (без компиляции) — тема «${theme}», OC-тем: ${ocThemes.filter((o) => o.theme).length}, кины ${draft.species.on ? `ON ×${draft.species.count}` : 'OFF'}, X=${draft.xSlots}`,
    { slug, kind: 'contract-draft', source: 'author' }
  )

  return NextResponse.json({ ok: true, slug, draftPath: jsonPath })
}
