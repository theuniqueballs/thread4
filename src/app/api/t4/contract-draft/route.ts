/**
 * THREAD 4 — CONTRACT DRAFT (без компиляции).
 *
 * Автор вписывает тему, три OC-темы с рейтингами, пожелания и раскладку
 * (кины, X, A/B, rehab) — UI сохраняет это как ЧЕРНОВИК с авто-номером.
 * Компилятор этот файл не читает (low-trust разделение, Issue #21):
 * черновик — письменный бриф для писца Чарли, а не машинный вход.
 *
 * 2026-10-11 (ревью UI по приказу автора «досмотри, чего нехватает»):
 * - GET отдаёт СПИСОК черновиков (+ флаг «собран» — батч/контракт существует):
 *   после сохранения бриф больше не исчезает из UI;
 * - POST принимает ТЕМА-СЛОВА автора (themeWords — отрисуемые теги через
 *   запятую): цепочка бриф → контракт → писец вплетает их в кадры ПЕРВЫМИ
 *   (точная привязка к теме, спайн дополняет хвост);
 * - DELETE (?slug=T4-NN) убирает несобранный черновик; собранный — отказ
 *   (409): летопись/контракт не трогаем;
 * - пикер кинов больше не предлагает Human (R01 — раса без признаков,
 *   слот не тратит: T4-29-находка, генератор теперь пропускает его молча,
 *   но список видов — источник истины и не должен врать).
 */
import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

import { appendEvent } from '@/lib/t4/events'
import { requireCommander, requireRead } from '@/lib/t4/apiguard'
import { DRAFTS_DIR, BATCHES_DIR, CONTRACTS_DIR, listFiles, writeJson, writeText } from '@/lib/t4/fsutil'
import { getPolicy, getRaces } from '@/lib/t4/specs'

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
  themeWords?: string
  speciesOn?: boolean
  speciesCount?: number
  speciesList?: string[]
  xSlots?: number
  abPairs?: number
  rehab?: boolean
  engine?: string
  notes?: string
  /** EXP-слоты поверх 24 — заказ автора (напоминание 2026-10-12: «у тебя
   *  если чё 9 слотов под EXP»); клампится по policy law.expSlotsMax. */
  exp?: number
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

export async function GET(req: Request) {
  const read = requireRead(req)
  if (!read.ok) return read.response

  // 2026-10-11: gold-расы (авторские: R17 jellyfish, R20 harpy) возвращены в
  // пикер — компилятор их всегда включал (compiler.ts: active || gold), а
  // фильтр «active» их молча выкидывал из UI. Статус уезжает на фронт для ★.
  // Human (R01) — НЕ кин: признаков нет, слот не тратит (races.json note;
  // генератор пропускает, бриф T4-29 это поймал) — из пикера убран, мейны
  // без кина уже люди по умолчанию.
  const races = (getRaces()?.races ?? [])
    .filter((r) => (r.status === 'active' || r.status === 'gold') && r.name.toLowerCase() !== 'human')
    .map((r) => ({ id: r.id, name: r.name, status: r.status }))
  /* EXP-бюджет из policy — UI показывает контрол честно (напоминание
   * автора 2026-10-12: «у тебя если чё 9 слотов под EXP») */
  const expSlotsMax = getPolicy()?.law?.expSlotsMax ?? 9
  /* список черновиков — бриф не исчезает после сохранения (ревью UI
   * 2026-10-11): слаг, тема, дата, кины, флаг «собран» (батч/контракт) */
  const drafts = listFiles(DRAFTS_DIR, '.json').map((f) => {
    const slug = f.base.replace(/-draft$/, '')
    let meta: {
      theme?: string
      createdAt?: string
      species?: { on?: boolean; count?: number; list?: string[] }
      ocThemes?: unknown[]
      abPairs?: number
      xSlots?: number
      themeWords?: string[]
      exp?: number
    } = {}
    try {
      meta = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f.name), 'utf-8')) as typeof meta
    } catch {
      /* битый черновик не должен ронять вкладку — показываем слаг без меты */
    }
    const assembled =
      fs.existsSync(path.join(BATCHES_DIR, `${slug}.md`)) || fs.existsSync(path.join(CONTRACTS_DIR, `${slug}.json`))
    return {
      slug,
      theme: meta.theme ?? '—',
      createdAt: meta.createdAt ?? '',
      kinCount: meta.species?.on ? (meta.species.list?.length ?? meta.species.count ?? 0) : 0,
      ocCount: Array.isArray(meta.ocThemes) ? meta.ocThemes.filter((o) => (o as OcTheme).theme).length : 0,
      abPairs: meta.abPairs ?? 0,
      themeWords: Array.isArray(meta.themeWords) ? meta.themeWords : [],
      exp: typeof meta.exp === 'number' ? meta.exp : null,
      assembled,
    }
  })
  return NextResponse.json({ nextSlug: nextSlug(), races, drafts, expSlotsMax })
}

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): черновик пишется на диск + note в летопись —
   * только с ключом командира. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
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
  /* аудит 2026-10-12: капы брифа — тема/пожелания/заметки идут в файлы
   * черновика и событие note в летопись (4000-гвард summary рвалась
   * нечитаемой 422-й на дальнем краю) */
  if (theme.length > 300) {
    return NextResponse.json({ error: 'тема длиннее 300 символов' }, { status: 413 })
  }
  const ocThemes = (body.ocThemes ?? []).slice(0, 3).map((o, i) => ({
    theme: String(o.theme ?? '').trim(),
    rating: RATINGS.has(String(o.rating)) ? String(o.rating) : 'R+',
    wishes: String(o.wishes ?? '').trim(),
    position: i + 1,
  }))

  /* EXP-слоты поверх 24 (напоминание автора 2026-10-12): бюджет policy
   * law.expSlotsMax — UI не может заказать больше закона; нечётное не
   * запрещаем — генератор сам выравнивает в пары (радар ждёт A/B-пары). */
  const expMax = getPolicy()?.law?.expSlotsMax ?? 9
  const exp = Math.max(0, Math.min(expMax, Math.floor(Number(body.exp ?? 2) || 0)))

  const slug = nextSlug()
  /* тема-слова автора (точная привязка к теме): отрисуемые теги через
   * запятую — писец вплетает их в кадры ПЕРВЫМИ, спайн дополняет хвост
   * до 8; каждое ≤40 знаков, не более 8 — гейт theme-presence меряет их
   * в ≥60% слотов, поэтому слова должны быть тег-безопасными */
  const themeWords = String(body.themeWords ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
    .map((w) => w.slice(0, 40))
  const draft = {
    slug,
    kind: 'draft',
    status: 'draft — без компиляции (Issue #21: авто-входы low-trust; это письменный бриф писцу)',
    createdAt: new Date().toISOString(),
    theme,
    ocThemes,
    mainWishes: String(body.mainWishes ?? '').trim().slice(0, 2000),
    ...(themeWords.length > 0 ? { themeWords } : {}),
    species: {
      on: body.speciesOn === true,
      count: Number(body.speciesCount ?? 0) || 0,
      list: Array.isArray(body.speciesList) ? body.speciesList.map(String) : [],
    },
    xSlots: Math.max(0, Math.min(2, Number(body.xSlots ?? 0) || 0)),
    abPairs: Math.max(0, Math.min(3, Number(body.abPairs ?? 0) || 0)),
    /* EXP-заказ автора фиксируется в брифе: генератор --from-draft читает
     * его как приказ (§10; сильнее — только явный флаг --exp в руки).
     * Двойку (умолчание policy) не пишем — пусть живёт в policy. */
    ...(exp !== 2 ? { exp } : {}),
    rehab: body.rehab === true,
    engine: String(body.engine ?? 'per-theme'),
    notes: String(body.notes ?? '').trim().slice(0, 1000),
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
    ...(themeWords.length > 0
      ? ['## Тема-слова автора (отрисуемые — вплетаются в кадры первыми)', themeWords.join(', '), '']
      : []),
    `## Раскладка от автора`,
    `- Кины (Species): ${draft.species.on ? `ON, ~${draft.species.count}` : 'OFF'}${draft.species.list.length ? ` — ${draft.species.list.join(', ')}` : ''}`,
    `- X-слоты: ${draft.xSlots}`,
    `- A/B-пары: ${draft.abPairs}`,
    `- EXP-слоты поверх 24: ${exp} (бюджет ${expMax}; парами — нечётное выровняется)`,
    `- REHAB: ${draft.rehab ? 'да' : 'по умолчанию'}`,
    `- Движок: ${draft.engine}`,
    draft.notes ? `- Заметки: ${draft.notes}` : '',
    '',
  ].join('\n')
  writeText(`${DRAFTS_DIR}/${slug}-draft.md`, md)

  appendEvent(
    'note',
    `${slug}: черновик контракта создан автором через UI (без компиляции) — тема «${theme}», OC-тем: ${ocThemes.filter((o) => o.theme).length}, кины ${draft.species.on ? `ON ×${draft.species.count}` : 'OFF'}, X=${draft.xSlots}, EXP=${exp}${themeWords.length > 0 ? `, тема-слова: ${themeWords.join('/')}` : ''}`,
    { slug, kind: 'contract-draft', source: 'author', exp }
  )

  return NextResponse.json({ ok: true, slug, draftPath: jsonPath })
}

export async function DELETE(req: Request) {
  /* удаление файла черновика + note в летопись — только с ключом (аудит
   * 2026-10-12; до раунда DELETE был открыт снаружи) */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  const slug = new URL(req.url).searchParams.get('slug') ?? ''
  if (!/^T4-[\dA-Za-z.-]+$/.test(slug)) {
    return NextResponse.json({ error: 'слаг обязателен: ?slug=T4-NN' }, { status: 400 })
  }
  /* собранный слог неприкосновенен: батч/контракт/летопись — не черновики */
  if (
    fs.existsSync(path.join(BATCHES_DIR, `${slug}.md`)) ||
    fs.existsSync(path.join(CONTRACTS_DIR, `${slug}.json`))
  ) {
    return NextResponse.json({ error: `${slug} уже собран (батч/контракт существует) — летопись не трогаем` }, { status: 409 })
  }
  const jsonPath = path.join(DRAFTS_DIR, `${slug}-draft.json`)
  const mdPath = path.join(DRAFTS_DIR, `${slug}-draft.md`)
  if (!fs.existsSync(jsonPath)) {
    return NextResponse.json({ error: `черновик ${slug} не найден` }, { status: 404 })
  }
  try {
    fs.unlinkSync(jsonPath)
    if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath)
  } catch {
    return NextResponse.json({ error: 'файл черновика не удаляется — смотри права на drafts/' }, { status: 500 })
  }
  appendEvent('note', `${slug}: несобранный черновик убран автором из UI (контракт/батч не существовали)`, {
    slug,
    kind: 'contract-draft-removed',
    source: 'author',
  })
  return NextResponse.json({ ok: true, slug })
}
