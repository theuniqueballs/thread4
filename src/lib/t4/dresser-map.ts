/**
 * THREAD 4 — Dresser Map (флагман тура 2, 2026-10-15).
 *
 * Карта Дрессера по рейтингу — структурный анализ расхождения между
 * заявкой контракта и фактом вердикта автора. Автор прямо приказал:
 *   «построить карту дрессера который будет следовал рейтингу, либо
 *    перелопатить рейтинг полностью и дрессер вместе с ним»
 * (из вердикта T4-32, render.verdict · author-batch).
 *
 * Что делает:
 *  1) читает контракт слага (fabricTone + rating + OC + pose + palette)
 *  2) пересчитывает канал Дрессера через dressFor(tier, tone) — даже если
 *     контракт не нёс поле `dress` (T4-32 — эксперимент, без dressFor embed)
 *  3) читает последний author-batch вердикт по слагу, мержит myTier + delta
 *  4) классифицирует failure mode по note автора (sterile / weak / body-
 *     missing / tag-issue / pose-miss / ok)
 *  5) агрегирует матрицу канал × рейтинг: заявлено/доставлено/failRate
 *  6) генерирует markdown «Уроки для следующего батча» — что менять
 *
 * backend-only: зовётся из /api/t4/dresser-map/[slug], не из браузера.
 */
import path from 'node:path'

import { readJson, CONTRACTS_DIR } from './fsutil'
import { readEvents } from './events'
import { dressFor, type FabricTone } from './dresser'
import { type SlotPlan, type BatchContract } from './compiler'

/* ------------------------------------------------------------------ */
/* Типы (то, что уезжает в UI)                                          */
/* ------------------------------------------------------------------ */

export type FailureMode =
  | 'sterile' // «стерильно», «обычно», «дефолтно» — модель играла безопасно
  | 'weak' // «слабенько», «мило», «просто девчонка» — жанр не доехал
  | 'body-missing' // «параметры тела», «сиськи», «боди» — не определён боди-тип
  | 'tag-issue' // «соски», «сквозь», «цвет», «вес» — технический промах по тегу
  | 'pose-miss' // поза не сработала (редкий кейс — обычно поза ок, интенсивность нет)
  | 'pass' // myTier === claim — доехало
  | 'no-verdict' // вердикта по слоту нет

export interface DresserMapSlot {
  position: string // "P01"
  claim: string // "R+"
  myTier: string | null // "R" — что поставил автор
  yodayoTier: string | null // что отдала площадка
  delta: number // -2 = R+→PG-13, -1 = R+→R, 0 = match, +1 = upgrade
  /** канал Дрессера, пересчитанный из tier+tone (или null для R/PG-13 —
   *  для них dressFor возвращает null по политике) */
  channel: string | null
  channelName: string | null
  tone: FabricTone | null
  oc: string | null
  pose: string | null
  poseName: string | null
  palette: string | null
  paletteName: string | null
  lead: string | null
  note: string
  genreRead?: 'yes' | 'no'
  wow?: 'yes' | 'no'
  failureMode: FailureMode
}

export interface ChannelStat {
  channel: string
  channelName: string
  claimed: Record<string, number> // tier → count
  delivered: Record<string, number>
  total: number
  passes: number
  failures: number // delta < 0
  failRate: number // failures / total (0..1)
}

export interface FailureModeStat {
  mode: FailureMode
  count: number
  slots: string[]
  recommendation: string
}

export interface DresserMap {
  slug: string
  title: string
  verdictAt: string | null
  verdictSource: string | null
  slots: DresserMapSlot[]
  channelMatrix: ChannelStat[]
  ratingDistribution: {
    claimed: Record<string, number>
    delivered: Record<string, number>
  }
  failureModes: FailureModeStat[]
  lessonsForNextBatch: string // markdown
  authorProse: string
}

/* ------------------------------------------------------------------ */
/* Хелперы                                                              */
/* ------------------------------------------------------------------ */

const TIER_ORDER = ['PG-13', 'R', 'R+', 'X'] as const
const TIER_INDEX: Record<string, number> = { 'PG-13': 0, R: 1, 'R+': 2, X: 3 }

function tierDelta(claim: string, myTier: string): number {
  return (TIER_INDEX[myTier] ?? -1) - (TIER_INDEX[claim] ?? -1)
}

/** Классифицировать failure mode по prose автора. Эвристики намеренно
 *  прозрачны — автор может оспорить, но для начала система видит
 *  паттерн. Это НЕ гейт — наблюдение. */
function classifyFailureMode(note: string, delta: number, myTier: string | null): FailureMode {
  if (myTier == null) return 'no-verdict'
  if (delta === 0) return 'pass'
  if (delta > 0) return 'pass' // upgrade — не провал
  const n = note.toLowerCase()
  // body-missing — автор прямо говорит про тело/сиськи/параметры
  if (/параметр|тело|сиськ|боди|грудь|форм|телослож/.test(n)) return 'body-missing'
  // sterile — модель играла безопасно, общая оценка
  if (/стерильн|обычн|дефолт|стандарт|ничего удивител|просто|обычная/.test(n)) return 'sterile'
  // weak — жанр/тема не доехал, мягкая оценка
  if (/слаб|мило|миленьк|слабеньк|слабоват/.test(n)) return 'weak'
  // tag-issue — конкретный технический промах по тегу
  if (/соск|сквозь|цвет|вес|через|палитр|свет|ткань|волос/.test(n)) return 'tag-issue'
  // pose-miss — поза не сработала
  if (/поз|позиц/.test(n) && /плох|не то|не сработ/.test(n)) return 'pose-miss'
  // дефолт — если delta<0 но note нейтральный/положительный — поза ок, интенсивность нет
  if (/круто|охуенн|супер|класс|прикольн|красот|шикар/.test(n)) return 'sterile'
  return 'sterile' // unknown downgrade — относим к sterile как к дефолту
}

const FAILURE_RECOMMENDATIONS: Record<FailureMode, string> = {
  sterile:
    'модель играла безопасно — усилить веса (1.2/1.3) на ключевые теги канала, добавить saliency-цепочку, явно позвать канал в POS (не в NEG)',
  weak:
    'жанр/тема не доехал — проверить witness-объект (третий глаз кадра), усилить тематический якорь в POS',
  'body-missing':
    'боди-тип не определён — добавить в контракт поле bodyType из OC-канона (breast_size, body_type, waist, hips), писец обязан вплести дословно',
  'tag-issue':
    'технический промах по тегу — проверить dressFor weights_raw, сверить с rating-recipe v1.9.0 mechanisms',
  'pose-miss':
    'поза не сработала — заменить PL-план на альтернативу из poses.json того же семейства',
  pass: 'доехало — оставить как есть, не трогать',
  'no-verdict': 'вердикта по слоту нет — ждём автора',
}

/** Собрать рекомендацию в markdown «Уроки для следующего батча». */
function buildLessons(map: Omit<DresserMap, 'lessonsForNextBatch'>): string {
  const lines: string[] = []
  lines.push(`# Уроки для следующего батча (после ${map.slug} «${map.title}»)
`)
  lines.push(`## Сводка
`)
  const claimed = map.ratingDistribution.claimed
  const delivered = map.ratingDistribution.delivered
  for (const t of TIER_ORDER) {
    if ((claimed[t] ?? 0) > 0 || (delivered[t] ?? 0) > 0) {
      lines.push(
        `- **${t}**: заявлено ${claimed[t] ?? 0} · доставлено ${delivered[t] ?? 0} · дельта ${
          (delivered[t] ?? 0) - (claimed[t] ?? 0)
        }`
      )
    }
  }
  lines.push('')
  if (map.channelMatrix.length > 0) {
    lines.push(`## Каналы Дрессера (claim → delivery)
`)
    for (const c of map.channelMatrix) {
      const arrow = c.failRate >= 0.5 ? '🔴' : c.failRate >= 0.25 ? '🟡' : '🟢'
      lines.push(
        `${arrow} **${c.channelName}** (${c.channel}): ${c.failures}/${c.total} провалов (${(c.failRate * 100).toFixed(0)}%) · pass ${c.passes}`
      )
    }
    lines.push('')
  }
  if (map.failureModes.length > 0) {
    lines.push(`## Отказы по типу
`)
    for (const f of map.failureModes) {
      lines.push(`- **${f.mode}** ×${f.count} — слоты ${f.slots.join(', ')}`)
      lines.push(`  ${f.recommendation}`)
    }
    lines.push('')
  }
  lines.push(`## Приказ автора (из вердикта)
`)
  lines.push('> ' + map.authorProse.split('\n').join('\n> '))
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Главная сборка                                                      */
/* ------------------------------------------------------------------ */

interface ContractSlotRaw extends SlotPlan {
  position: number
}

/** Собрать карту Дрессера по слагу. null если нет контракта. */
export function buildDresserMap(slug: string): DresserMap | null {
  /* 1) контракт */
  const contract = readJson<BatchContract & { slots: ContractSlotRaw[]; theme?: string }>(
    path.join(CONTRACTS_DIR, `${slug}.json`)
  )
  if (!contract || !Array.isArray(contract.slots)) return null

  /* 2) последний вердикт author-batch по слагу (или author — legacy) */
  const events = readEvents()
  const verdict = events
    .filter(
      (e) =>
        e.type === 'render.verdict' &&
        String(e.data?.slug ?? '') === slug &&
        (String(e.data?.source ?? '') === 'author-batch' ||
          String(e.data?.source ?? '') === 'author')
    )
    .at(-1)
  const verdictSlots = (verdict?.data?.slots ?? []) as Array<{
    position: string
    claim?: string
    myTier?: string
    yodayoTier?: string
    ph?: string
    note?: string
    genreRead?: 'yes' | 'no'
    wow?: 'yes' | 'no'
  }>
  const verdictByPos = new Map(verdictSlots.map((s) => [s.position, s]))

  /* 3) для каждого слота контракта — собрать запись */
  const slots: DresserMapSlot[] = []
  const claimedTally: Record<string, number> = {}
  const deliveredTally: Record<string, number> = {}
  const channelTally = new Map<
    string,
    { channelName: string; claimed: Record<string, number>; delivered: Record<string, number>; total: number; passes: number; failures: number }
  >()

  for (const cs of contract.slots) {
    const pos = `P${String(cs.position).padStart(2, '0')}`
    const claim = cs.rating
    const tone = cs.fabricTone ?? null
    /* пересчитать канал Дрессера — даже если контракт не нёс поле dress */
    const dress =
      claim === 'R+' || claim === 'X'
        ? dressFor({ tier: claim, tone: tone ?? 'dark' })
        : null
    const channel = dress?.channel ?? null
    const channelName = dress?.channelName ?? null
    const v = verdictByPos.get(pos)
    const myTier = v?.myTier ?? null
    const yodayoTier = v?.yodayoTier ?? null
    const delta = myTier ? tierDelta(claim, myTier) : 0
    const note = v?.note ?? ''
    const genreRead = v?.genreRead
    const wow = v?.wow
    const failureMode = classifyFailureMode(note, delta, myTier)

    slots.push({
      position: pos,
      claim,
      myTier,
      yodayoTier,
      delta,
      channel,
      channelName,
      tone,
      oc: cs.oc ?? null,
      pose: cs.pose ?? null,
      poseName: cs.poseName ?? null,
      palette: cs.palette ?? null,
      paletteName: cs.paletteName ?? null,
      lead: cs.lead ?? null,
      note,
      genreRead,
      wow,
      failureMode,
    })

    /* агрегация рейтинга */
    claimedTally[claim] = (claimedTally[claim] ?? 0) + 1
    if (myTier) deliveredTally[myTier] = (deliveredTally[myTier] ?? 0) + 1

    /* агрегация канала */
    if (channel) {
      const t = channelTally.get(channel) ?? {
        channelName: channelName ?? channel,
        claimed: {} as Record<string, number>,
        delivered: {} as Record<string, number>,
        total: 0,
        passes: 0,
        failures: 0,
      }
      t.total += 1
      t.claimed[claim] = (t.claimed[claim] ?? 0) + 1
      if (myTier) t.delivered[myTier] = (t.delivered[myTier] ?? 0) + 1
      if (myTier) {
        if (delta === 0) t.passes += 1
        else if (delta < 0) t.failures += 1
      }
      channelTally.set(channel, t)
    }
  }

  /* 4) канал × рейтинг матрица */
  const channelMatrix: ChannelStat[] = []
  for (const [channel, t] of channelTally) {
    channelMatrix.push({
      channel,
      channelName: t.channelName,
      claimed: t.claimed,
      delivered: t.delivered,
      total: t.total,
      passes: t.passes,
      failures: t.failures,
      failRate: t.total > 0 ? t.failures / t.total : 0,
    })
  }
  channelMatrix.sort((a, b) => b.failRate - a.failRate)

  /* 5) failure modes агрегация */
  const fmTally = new Map<FailureMode, { count: number; slots: string[] }>()
  for (const s of slots) {
    if (s.failureMode === 'pass' || s.failureMode === 'no-verdict') continue
    const t = fmTally.get(s.failureMode) ?? { count: 0, slots: [] }
    t.count += 1
    t.slots.push(s.position)
    fmTally.set(s.failureMode, t)
  }
  const failureModes: FailureModeStat[] = []
  for (const [mode, t] of fmTally) {
    failureModes.push({
      mode,
      count: t.count,
      slots: t.slots,
      recommendation: FAILURE_RECOMMENDATIONS[mode],
    })
  }
  failureModes.sort((a, b) => b.count - a.count)

  /* 6) author prose — что автор сказал о всём батче */
  const authorProse =
    typeof verdict?.data?.prose === 'string' ? (verdict.data.prose as string) : ''

  const partial: Omit<DresserMap, 'lessonsForNextBatch'> = {
    slug,
    title: contract.theme ?? slug,
    verdictAt: verdict?.at ?? null,
    verdictSource: verdict ? String(verdict.data?.source ?? '') : null,
    slots,
    channelMatrix,
    ratingDistribution: { claimed: claimedTally, delivered: deliveredTally },
    failureModes,
    authorProse,
  }

  return { ...partial, lessonsForNextBatch: buildLessons(partial) }
}
