/**
 * THREAD 4 — BATCH VERDICT RECEIVER (§10-поправка: дисциплина измерения).
 * One record per batch: the whole batch lands in the log as ONE
 * render.verdict event (slots + scoreboard). Discrepancies (↑↓) between
 * the author's tier, the contract's claim and the platform (Yodayo) tier
 * are computed server-side — the same numbers feed delivery-stats.
 */
import { NextResponse } from 'next/server'
import path from 'node:path'

import { appendEvent, readEvents } from '@/lib/t4/events'
import { BATCHES_DIR, CONTRACTS_DIR, readJson, readText } from '@/lib/t4/fsutil'
import { extractBatchTitle } from '@/lib/t4/gates'
import { TIER_RANK as TIERS } from '@/lib/t4/verdicts'

export const dynamic = 'force-dynamic'

/** Лёгкий вердикт-путь (приказ автора, раунд 2026-10-11): батч-уровень
 *  БЕЗ по-слотовой разметки — одна запись, три исхода, проза по желанию.
 *  Работает для любого батча (контракт не нужен — тема из меты/H1). */
export const LIGHT_VERDICTS: Record<string, string> = {
  keep: 'зашёл — держим курс',
  mixed: 'местами — половина решает',
  rework: 'мимо — переделать',
}

export interface BatchVerdictSlotInput {
  position: string // P01..P24
  claim?: string // заявка контракта (R+/R/X)
  pose?: string
  lead?: string
  myTier?: string // глаз автора
  yodayoTier?: string // тир площадки (Yodayo)
  ph?: string // PH | Raw | A | B | —
  vlmFlag?: string // ok | mutation | drift | skipped
  phText?: string
  note?: string
  rolls?: number // число перекидок слота (roll-journal, ауди́т RC-4a)
  settings?: string // CFG/sampler/веса — факторы блока 10 техники-карты
  genreRead?: string // NICHE: жанр прочитан? (yes | no | '')
  wow?: string // NICHE: вау? (yes | no | '')
}

function normPos(raw: unknown): string {
  const m = /^p?(\d{1,2})$/i.exec(String(raw ?? '').trim())
  return m ? `P${String(parseInt(m[1], 10)).padStart(2, '0')}` : ''
}

function normTier(raw: unknown): string {
  const t = String(raw ?? '').trim().toUpperCase()
  if (t === 'PG13') return 'PG-13'
  if (t === 'RPLUS' || t === 'R+') return 'R+'
  if (t in TIERS) return t
  return ''
}

/** ↑↓ между двумя тирами: +1 = выше, -1 = ниже, 0 = равны. */
function tierDelta(a: string, b: string): number {
  const va = TIERS[a] ?? -1
  const vb = TIERS[b] ?? -1
  if (va < 0 || vb < 0) return 0
  return Math.sign(va - vb)
}

export async function POST(req: Request) {
  let body: {
    slug?: string
    slots?: BatchVerdictSlotInput[]
    prose?: string
    /** Лёгкий путь: батч-уровень без по-слотовой разметки */
    mode?: string
    verdict?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  /* Фред, 2026-10-08: суффиксные слаги разрешены — вердикты по EXP-батчам
   * (T4-20-EXP и родня) раньше отбивались 400-й на этом же чеке. */
  if (!/^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: 'slug required (T4-NN)' }, { status: 400 })
  }

  /* --- лёгкий путь: одна запись, никаких слотов --- */
  if (body.mode === 'light') {
    const verdict = String(body.verdict ?? '').trim()
    if (!(verdict in LIGHT_VERDICTS)) {
      return NextResponse.json(
        { error: `verdict required (${Object.keys(LIGHT_VERDICTS).join(' | ')})` },
        { status: 400 }
      )
    }
    const prose = String(body.prose ?? '').trim().slice(0, 2000)
    const batchMetaL = readJson<{ title?: string; theme?: string }>(
      path.join(BATCHES_DIR, `${slug}.json`)
    )
    const batchMdL = readText(path.join(BATCHES_DIR, `${slug}.md`))
    const contractL = readJson<{ theme?: string }>(path.join(CONTRACTS_DIR, `${slug}.json`))
    const themeL =
      contractL?.theme ||
      (batchMetaL?.title && batchMetaL.title !== slug ? batchMetaL.title : '') ||
      batchMetaL?.theme ||
      (batchMdL ? extractBatchTitle(batchMdL) : '') ||
      ''
    const label = LIGHT_VERDICTS[verdict]
    const summaryL = `${slug}${themeL ? ` «${themeL}»` : ''} ЛЕГКИЙ ВЕРДИКТ (батч-уровень, без по-слотовой разметки): ${label}${prose ? ` — ${prose.slice(0, 140)}` : ''}`
    const evtL = appendEvent('render.verdict', summaryL, {
      slug,
      source: 'author-batch',
      mode: 'light',
      verdict,
      title: themeL,
      prose,
    })
    return NextResponse.json({ ok: true, event: evtL, light: true, verdict: label })
  }

  const rawSlots = Array.isArray(body.slots) ? body.slots : []
  if (rawSlots.length === 0) {
    return NextResponse.json({ error: 'slots required (одна запись на батч)' }, { status: 400 })
  }

  // заявки контракта — источник истины для ↑↓ (если слот не принёс свою)
  const contract = readJson<{
    theme?: string
    slots?: {
      position: number
      rating: string
      pose?: string
      poseName?: string
      lead?: string
      kind?: string
      ab?: { pair: string; half: string; withSlot: number; lead: string }
    }[]
  }>(path.join(CONTRACTS_DIR, `${slug}.json`))
  const contractByPos = new Map<number, { rating: string; pose: string; poseName: string; lead: string; kind: string; ab?: { pair: string; half: string; withSlot: number; lead: string } }>()
  for (const s of contract?.slots ?? []) {
    contractByPos.set(s.position, {
      rating: s.rating,
      pose: s.pose ?? '',
      poseName: s.poseName ?? '',
      lead: s.lead ?? '',
      kind: s.kind ?? '',
      ab: s.ab,
    })
  }

  const slots = rawSlots
    .map((s) => {
      const position = normPos(s.position)
      const n = position ? parseInt(position.slice(1), 10) : 0
      const c = contractByPos.get(n)
      return {
        position,
        claim: normTier(s.claim) || c?.rating || '',
        pose: String(s.pose ?? c?.pose ?? '').trim(),
        lead: String(s.lead ?? c?.lead ?? '').trim(),
        myTier: normTier(s.myTier),
        yodayoTier: normTier(s.yodayoTier),
        ph: String(s.ph ?? '').trim(),
        vlmFlag: String(s.vlmFlag ?? '').trim(),
        phText: String(s.phText ?? '').trim().slice(0, 500),
        note: String(s.note ?? '').trim().slice(0, 500),
        rolls: typeof s.rolls === 'number' && Number.isFinite(s.rolls) && s.rolls >= 0 ? Math.floor(s.rolls) : undefined,
        settings: String(s.settings ?? '').trim().slice(0, 200) || undefined,
        genreRead: ['yes', 'no'].includes(String(s.genreRead ?? '')) ? String(s.genreRead) : undefined,
        wow: ['yes', 'no'].includes(String(s.wow ?? '')) ? String(s.wow) : undefined,
      }
    })
    .filter((s) => s.position !== '')

  if (slots.length === 0) {
    return NextResponse.json({ error: 'no valid slots (P01..P24)' }, { status: 400 })
  }

  // скорборд: доставлено/заявлено по тирам + расхождения
  const claimed: Record<string, number> = {}
  const delivered: Record<string, number> = {}
  let up = 0
  let down = 0
  let platformUp = 0
  let platformDown = 0
  for (const s of slots) {
    if (s.claim) claimed[s.claim] = (claimed[s.claim] ?? 0) + 1
    if (s.myTier) delivered[s.myTier] = (delivered[s.myTier] ?? 0) + 1
    const d = tierDelta(s.myTier, s.claim)
    if (d > 0) up += 1
    else if (d < 0) down += 1
    const pd = tierDelta(s.myTier, s.yodayoTier)
    if (pd > 0) platformUp += 1
    else if (pd < 0) platformDown += 1
  }
  const scoreboard = {
    slots: slots.length,
    claimed,
    delivered,
    claimDelta: { up, down },
    platformDelta: { up: platformUp, down: platformDown },
    vlmFlags: slots.reduce<Record<string, number>>((acc, s) => {
      if (s.vlmFlag) acc[s.vlmFlag] = (acc[s.vlmFlag] ?? 0) + 1
      return acc
    }, {}),
  }
  const rollsLogged = slots.filter((s) => typeof s.rolls === 'number')
  const nicheRead = slots.filter((s) => s.genreRead || s.wow)

  // A/B-атрибуция (§10-поправка, внешний вердикт №3): пара = один канал
  // (LEAD-зона), подача разная. Таблица 2×2: полуслот × дельта доставки.
  // До этого момента поле ab контракта читалось и выбрасывалось (аудит N-3).
  const abAttribution = Object.values(
    contractByPos.size > 0
      ? slots.reduce<Record<string, { pair: string; lead: string; halves: Record<string, { position: string; myTier: string; claim: string; delta: number }> }>>((acc, s) => {
          const n = parseInt(s.position.slice(1), 10)
          const c = contractByPos.get(n)
          if (!c?.ab) return acc
          acc[c.ab.pair] ??= { pair: c.ab.pair, lead: c.ab.lead ?? c.lead, halves: {} }
          acc[c.ab.pair].halves[c.ab.half] = {
            position: s.position,
            myTier: s.myTier,
            claim: s.claim,
            delta: tierDelta(s.myTier, s.claim),
          }
          return acc
        }, {})
      : {}
  )

  const prose = String(body.prose ?? '').trim().slice(0, 2000)
  /* Фред, 2026-10-08: тема без контракта (RAW T4-23/24, EXP) — из меты
   * батча или его H1, чтобы запись вердикта не была безымянной. */
  const batchMeta = readJson<{ title?: string; theme?: string }>(
    path.join(BATCHES_DIR, `${slug}.json`)
  )
  const batchMd = readText(path.join(BATCHES_DIR, `${slug}.md`))
  const theme =
    contract?.theme ||
    (batchMeta?.title && batchMeta.title !== slug ? batchMeta.title : '') ||
    batchMeta?.theme ||
    (batchMd ? extractBatchTitle(batchMd) : '') ||
    ''
  const scoreText = Object.entries(claimed)
    .map(([t, n]) => `${t} ${delivered[t] ?? 0}/${n}`)
    .join(' · ')
  const summary = `${slug}${theme ? ` «${theme}»` : ''} БАТЧ-ВЕРДИКТ (глаз автора, одна запись): ${scoreText || '—'} · расхождения с заявкой ↑${up} ↓${down} · с площадкой ↑${platformUp} ↓${platformDown}${prose ? ` — ${prose.slice(0, 140)}` : ''}`

  const evt = appendEvent('render.verdict', summary, {
    slug,
    source: 'author-batch',
    mode: 'full',
    title: theme,
    slots,
    scoreboard,
    abAttribution,
    rollJournal: rollsLogged.length
      ? rollsLogged.map((s) => ({ position: s.position, rolls: s.rolls, settings: s.settings }))
      : undefined,
    nicheReport: nicheRead.length
      ? nicheRead.map((s) => ({ position: s.position, genreRead: s.genreRead, wow: s.wow }))
      : undefined,
    prose,
  })
  return NextResponse.json({ ok: true, event: evt, scoreboard })
}

export async function GET() {
  const events = readEvents()
  const records = events
    .filter(
      (e) =>
        e.type === 'render.verdict' &&
        (e.data as { source?: string } | undefined)?.source === 'author-batch'
    )
    .map((e) => {
      const d = e.data as { slug?: string; mode?: string; verdict?: string }
      return {
        id: e.id,
        at: e.at,
        slug: String(d?.slug ?? ''),
        mode: d?.mode === 'light' ? 'light' : 'full',
        verdict: d?.verdict ?? '',
        summary: e.summary,
        scoreboard: (e.data as { scoreboard?: unknown })?.scoreboard ?? null,
        slots: (e.data as { slots?: unknown })?.slots ?? [],
      }
    })
    .reverse()
  return NextResponse.json({ records })
}
