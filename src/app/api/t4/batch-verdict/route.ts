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
import { CONTRACTS_DIR, readJson } from '@/lib/t4/fsutil'
import { TIER_RANK as TIERS } from '@/lib/t4/verdicts'

export const dynamic = 'force-dynamic'

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
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  if (!/^T4-\d{2}$/.test(slug)) {
    return NextResponse.json({ error: 'slug required (T4-NN)' }, { status: 400 })
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
  const theme = contract?.theme ?? ''
  const scoreText = Object.entries(claimed)
    .map(([t, n]) => `${t} ${delivered[t] ?? 0}/${n}`)
    .join(' · ')
  const summary = `${slug}${theme ? ` «${theme}»` : ''} БАТЧ-ВЕРДИКТ (глаз автора, одна запись): ${scoreText || '—'} · расхождения с заявкой ↑${up} ↓${down} · с площадкой ↑${platformUp} ↓${platformDown}${prose ? ` — ${prose.slice(0, 140)}` : ''}`

  const evt = appendEvent('render.verdict', summary, {
    slug,
    source: 'author-batch',
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
    .map((e) => ({
      id: e.id,
      at: e.at,
      slug: String((e.data as { slug?: string })?.slug ?? ''),
      summary: e.summary,
      scoreboard: (e.data as { scoreboard?: unknown })?.scoreboard ?? null,
      slots: (e.data as { slots?: unknown })?.slots ?? [],
    }))
    .reverse()
  return NextResponse.json({ records })
}
