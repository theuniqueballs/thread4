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
import { getOCCanon } from './specs'
import { proposeVariety, proposeBatchVariety, NEG_VARIANTS } from './variety-engine'

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
  /** Тур 3 (2026-10-15): контр-контракт — советник следующего батча на
   *  основе исторических delivery rates + недостающих bodyType. */
  counterContract: CounterContract
  /** Тур 4 (2026-10-15): матрица разнообразия — для каждого слота контракта
   *  его пакет (posOrder / register / length / styleAnchor / negVariant).
   *  Берётся из contract.slot.variety (назначается в compiler.ts). */
  varietyMatrix: VarietyRow[]
}

/** Корневая карта БЕЗ поздних надстроек (varietyMatrix строится после
 *  partial — ей нужны slots + fallback; lessons/counter — после всего).
 *  Аудит-раунд 2026-10-16: единая истина для buildLessons,
 *  buildCounterContract и partialWithoutLessons — раньше три разных
 *  Omit-выражения разъехались (tsc ловил). */
export type DresserMapCore = Omit<
  DresserMap,
  'lessonsForNextBatch' | 'counterContract' | 'varietyMatrix'
>

/** Строка матрицы разнообразия — что получил слот от Variety Engine. */
export interface VarietyRow {
  position: string
  claim: string
  posOrder: string
  register: string
  lengthClass: string
  styleAnchor: string
  negVariant: number
  negVariantName: string
  /** Тур 5 (аудит Коул): camera (G01), bodyPlan (G11), handsHint (G22),
   *  themeWordBudget (G30) — расширение Variety Engine. */
  camera: string
  bodyPlan: string | null
  handsHint: string | null
  themeWordBudget: number
  seed: number
}

/* ------------------------------------------------------------------ */
/* Контр-Контракт (тура 3, 2026-10-15)                                  */
/* ------------------------------------------------------------------ */

/** Один OC в текущем контракте, у которого контракта НЕ тащит body_type
 *  из канона в слот — писец пишет без него, рендер «стерилен». */
export interface BodyTypeGap {
  position: string
  oc: string
  /** реальный body_type из oc-canon.json — то, что писец ДОЛЖЕН вплести */
  bodyType: string
  /** что говорит канон про breast_size / family — для веса */
  family?: string
}

/** Усиленные веса для канала Дрессера (автор: «добавлять веса 1.2, 1.3»). */
export interface ProposedWeights {
  channel: string
  channelName: string
  /** текущие веса из dresser.ts dressFor wantWeights */
  current: string[]
  /** предложенные усиленные веса (1.2/1.3 вместо 1.1/1.2) */
  proposed: string[]
  /** почему именно эти — receipts из verdict + oc-canon */
  why: string
}

/** Контр-контракт: «на основе этого батча вот что менять в следующем». */
export interface CounterContract {
  /** исторический R+ delivery rate (последние 5 author-batch вердиктов) */
  historicalDelivery: {
    sampleSize: number
    rPlusClaimed: number
    rPlusDelivered: number
    rPlusDeliveryRate: number // 0..1
    rClaimed: number
    rDelivered: number
    rDeliveryRate: number
  }
  /** рекомендованное распределение рейтингов для следующего батча */
  recommendedSpread: {
    rating: string
    count: number
    why: string
  }[]
  /** OC-слоты в этом батче, у которых body_type не попал в контракт */
  bodyTypeGaps: BodyTypeGap[]
  /** усиленные веса по каналам Дрессера */
  proposedWeights: ProposedWeights[]
  /** markdown-сводка для UI */
  markdown: string
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
function buildLessons(map: DresserMapCore): string {
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
/* Контр-Контракт — советник следующего батча                          */
/* ------------------------------------------------------------------ */

/** Прочитать исторические delivery rates по последним N author-batch
 *  вердиктам. Агрегат: по claim/delivery на R+ и R (X — отдельный разговор,
 *  редко). */
function computeHistoricalDelivery(
  events: import('./events').T4Event[],
  sampleSize = 5
): CounterContract['historicalDelivery'] {
  const verdicts = events.filter(
    (e) => e.type === 'render.verdict' && String(e.data?.source ?? '') === 'author-batch'
  )
  const sample = verdicts.slice(-sampleSize)
  let rPlusClaimed = 0
  let rPlusDelivered = 0
  let rClaimed = 0
  let rDelivered = 0
  for (const v of sample) {
    const sb = (v.data?.scoreboard ?? {}) as {
      claimed?: Record<string, number>
      delivered?: Record<string, number>
    }
    rPlusClaimed += Number(sb.claimed?.['R+'] ?? 0)
    rPlusDelivered += Number(sb.delivered?.['R+'] ?? 0)
    rClaimed += Number(sb.claimed?.['R'] ?? 0)
    rDelivered += Number(sb.delivered?.['R'] ?? 0)
  }
  return {
    sampleSize: sample.length,
    rPlusClaimed,
    rPlusDelivered,
    rPlusDeliveryRate: rPlusClaimed > 0 ? rPlusDelivered / rPlusClaimed : 0,
    rClaimed,
    rDelivered,
    rDeliveryRate: rClaimed > 0 ? rDelivered / rClaimed : 0,
  }
}

/** Пройтись по OC-слотам контракта и найти body_type в каноне — писец
 *  должен вплетать, но контракт его не несёт (T4-32 P01 Lucy без боди). */
function findBodyTypeGaps(contractSlots: { position: number; kind?: string; oc?: string }[]): BodyTypeGap[] {
  const ocCanon = getOCCanon()
  if (!ocCanon?.ocs) return []
  const gaps: BodyTypeGap[] = []
  for (const cs of contractSlots) {
    if (cs.kind !== 'OC' || !cs.oc) continue
    // OC name в контракте может быть с заглавной («Lucy») — oc-canon хранит как есть
    const ocData =
      ocCanon.ocs[cs.oc] ??
      ocCanon.ocs[cs.oc.toLowerCase()] ??
      ocCanon.ocs[Object.keys(ocCanon.ocs).find((k) => k.toLowerCase() === cs.oc!.toLowerCase()) ?? '']
    if (!ocData) continue
    const bodyType = String(ocData.body_type ?? '')
    if (bodyType === '') continue
    gaps.push({
      position: `P${String(cs.position).padStart(2, '0')}`,
      oc: cs.oc,
      bodyType: bodyType.slice(0, 200),
      family: ocData.family ? String(ocData.family) : undefined,
    })
  }
  return gaps
}

/** Усиленные веса для каналов — автор прямо приказал «1.2, 1.3 на теги».
 *  Читаем dresser.ts dressFor wantWeights (контракт несёт в поле dress.weights),
 *  предлагаем усиление: 1.1 → 1.2, 1.2 → 1.3, и доп. теги. */
function proposeWeights(channelMatrix: ChannelStat[]): ProposedWeights[] {
  const out: ProposedWeights[] = []
  for (const c of channelMatrix) {
    let current: string[] = []
    let proposed: string[] = []
    let why = ''
    if (c.channel === 'bumps') {
      current = ['(covered nipples:1.1)', '(fabric clinging:1.2)']
      proposed = [
        '(covered nipples:1.3)',
        '(fabric clinging:1.3)',
        '(dark garment:1.2)',
        '(sweat glistening:1.2)',
        '(nothing underneath:1.2)',
      ]
      why = `автор T4-32: «модель играла безопасно» — bumps единственный R+ через-ткань, веса 1.1/1.2 слабы. Усилить ключевые теги канала + добавить weights на dark garment/sweat (state теги). ${c.failures}/${c.total} провалов = ${(c.failRate * 100).toFixed(0)}% — необходима дожим.`
    } else if (c.channel === 'swim_wet') {
      current = []
      proposed = [
        '(wet clothes:1.3)',
        '(swimsuit:1.3)',
        '(covered nipples:1.2)',
        '(nothing underneath:1.2)',
        '(fabric clinging:1.2)',
      ]
      why = `swim_wet — 0 весов в dresser.ts, но ${c.failures}/${c.total} провалов (${(c.failRate * 100).toFixed(0)}% — самый высокий). wet clothes + swimsuit — ключевые сигналы канала, без весов модель их не уважает.`
    } else if (c.channel === 'on_skin') {
      current = []
      proposed = ['(taped nipples:1.3)', '(topless with tape:1.2)', '(handbra:1.2)']
      why = `on_skin — 0 весов. ${c.failures}/${c.total} провалов. tape-конструкции хрупки (вердикт T4-03), веса усиливают сигнал.`
    } else if (c.channel === 'pantyline') {
      current = []
      proposed = ['(visible pantyline:1.3)', '(tight:1.2)', '(nothing underneath:1.2)']
      why = `pantyline — 0 весов, ${c.failures}/${c.total} провалов. Visible pantyline — заявка канала, без веса модель часто теряет.`
    } else if (c.channel === 'through' || c.channel === 'bare') {
      // X-каналы — автор пока не жаловался, пропускаем
      continue
    } else {
      continue
    }
    out.push({ channel: c.channel, channelName: c.channelName, current, proposed, why })
  }
  return out
}

/** Собрать контр-контракт — советник следующего батча. */
function buildCounterContract(
  map: DresserMapCore,
  events: import('./events').T4Event[]
): CounterContract {
  const hd = computeHistoricalDelivery(events, 5)

  // рекомендованное распределение: на основе исторического R+ delivery rate
  // если исторически R+ delivery = 43%, а цель — получить ~9 R+ delivered,
  // claim должен быть ceil(9 / 0.43) = 21 (как сейчас). Если цель 12 R+ —
  // claim должен быть ceil(12 / 0.43) = 28. НО 28 — это весь батч, нереально.
  // Реальный совет: СНИЗИТЬ R+ claim до того, что reliably deliverится,
  // излишек переложить в R (delivery ~100%).
  const targetTotal = 28 // закон 24 слотов + 4 EXP болванки
  const rPlusDeliveryPct = Math.max(hd.rPlusDeliveryRate, 0.1) // защита от 0
  // сколько R+ заявить, чтобы получить ~9 delivered (как в среднем)
  const targetRPlusDelivered = Math.max(7, Math.round((hd.rPlusDelivered / Math.max(hd.sampleSize, 1))))
  const recommendedRPlus = Math.min(21, Math.ceil(targetRPlusDelivered / rPlusDeliveryPct))
  // остаток — R (надёжный delivery)
  const recommendedR = Math.max(0, targetTotal - recommendedRPlus)
  const recommendedSpread = [
    {
      rating: 'R+',
      count: recommendedRPlus,
      why: `исторически R+ delivery ${(hd.rPlusDeliveryRate * 100).toFixed(0)}% (${hd.rPlusDelivered}/${hd.rPlusClaimed} в ${hd.sampleSize} батчах). Чтобы доставить ~${targetRPlusDelivered} R+ — заявить ${recommendedRPlus}. Больше — систематический провал.`,
    },
    {
      rating: 'R',
      count: recommendedR,
      why: `исторически R delivery ${(hd.rDeliveryRate * 100).toFixed(0)}% (${hd.rDelivered}/${hd.rClaimed}). R — надёжный канал, излишек с R+ ложим сюда.`,
    },
  ]

  // body_type gaps — берём из контракта (нужен доступ к слотам)
  // передаём через map.slots — там уже есть oc + position
  const contractSlotsForGaps = map.slots
    .filter((s) => s.oc)
    .map((s) => ({
      position: parseInt(s.position.slice(1), 10),
      kind: 'OC' as const,
      oc: s.oc!,
    }))
  const bodyTypeGaps = findBodyTypeGaps(contractSlotsForGaps)

  // предложенные веса
  const proposedWeights = proposeWeights(map.channelMatrix)

  // markdown-сводка
  const md: string[] = []
  md.push(`# Контр-Контракт для следующего батча (после ${map.slug} «${map.title}»)
`)
  md.push(`## Исторический delivery rate (последние ${hd.sampleSize} батчей)
`)
  md.push(
    `- **R+**: доставлено ${hd.rPlusDelivered}/${hd.rPlusClaimed} = **${(hd.rPlusDeliveryRate * 100).toFixed(0)}%**`
  )
  md.push(`- **R**: доставлено ${hd.rDelivered}/${hd.rClaimed} = **${(hd.rDeliveryRate * 100).toFixed(0)}%**`)
  md.push('')
  md.push(`## Рекомендованное распределение рейтингов (закон 28 слотов)
`)
  for (const r of recommendedSpread) {
    md.push(`- **${r.rating}** × ${r.count} — ${r.why}`)
  }
  md.push('')
  if (bodyTypeGaps.length > 0) {
    md.push(`## OC body_type — писец обязан вплести (T4-32 P01 провал)
`)
    md.push(`Контракт несёт только \`oc: "Lucy"\`, но НЕ тащит \`body_type\` из oc-canon.json.`)
    md.push(`Писец пишет без тела — модель играет стерильно. ДОБАВИТЬ в контракт поле bodyType:`)
    md.push('')
    for (const g of bodyTypeGaps) {
      md.push(`- **${g.position} OC ${g.oc}**: \`${g.bodyType}\``)
    }
    md.push('')
  }
  if (proposedWeights.length > 0) {
    md.push(`## Усиленные веса каналов (автор: «1.2, 1.3 на теги»)
`)
    for (const w of proposedWeights) {
      md.push(`### ${w.channelName} (\`${w.channel}\`)
`)
      md.push(`**Текущие**: ${w.current.length > 0 ? w.current.join(' ') : '— нет весов —'}`)
      md.push('')
      md.push(`**Предложенные** (добавить в dressFor wantWeights):`)
      for (const p of w.proposed) md.push(`- \`${p}\``)
      md.push('')
      md.push(`_Почему_: ${w.why}`)
      md.push('')
    }
  }
  md.push(`## Что автор приказал дословно
`)
  md.push('> ' + map.authorProse.split('\n').join('\n> '))

  return {
    historicalDelivery: hd,
    recommendedSpread,
    bodyTypeGaps,
    proposedWeights,
    markdown: md.join('\n'),
  }
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

  /* Тур 4/5 (тип-фикс аудита 2026-10-16): varietyMatrix строится ПОЗДЕЕ
   *  partial (нужны slots + fallback пересчёт) — корневой тип без него;
   *  прежде Omit требовал varietyMatrix у partialWithoutLessons, которого
   *  там физически нет — tsc ловил, в прод не доходило только потому, что
   *  дев-режим не гоняет typecheck. */
  const partialWithoutLessons: DresserMapCore = {
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

  /* Тур 3: контр-контракт — советник следующего батча на основе
   *  исторических delivery rates + недостающих bodyType. Строится ПОСЛЕ
   *  partial (ему нужны slots + channelMatrix + authorProse). */
  const counterContract = buildCounterContract(partialWithoutLessons, events)

  /* Тур 4: матрица разнообразия — для каждого слота контракта его пакет
   *  variety (posOrder / register / length / style / negVariant). Берётся
   *  из contract.slot.variety если есть; иначе пересчитывается через
   *  proposeBatchVariety (батч-уровень — квота камеры + interleave bodyPlan).
   *  Тур 5: расширено — camera (G01), bodyPlan (G11), handsHint (G22),
   *  themeWordBudget (G30). */
  const hasVarietyInContract = contract.slots.some((cs) => cs.variety)
  let fallbackVariety: ReturnType<typeof proposeBatchVariety> = []
  if (!hasVarietyInContract) {
    // старый контракт без variety (T4-32) — пересчитываем батч-уровнево,
    // чтобы interleave работал в UI-предпросмотре
    fallbackVariety = proposeBatchVariety(
      contract.slots.map((cs) => ({
        position: cs.position,
        kind: cs.kind,
        rating: cs.rating,
      })),
      slug
    )
  }
  const varietyMatrix: VarietyRow[] = contract.slots.map((cs, idx) => {
    const v =
      cs.variety ??
      fallbackVariety[idx] ??
      proposeVariety(
        { position: cs.position, kind: cs.kind, rating: cs.rating },
        slug
      )
    const negVariantName =
      v.negVariant >= 0 && v.negVariant < NEG_VARIANTS.length
        ? NEG_VARIANTS[v.negVariant].name
        : `variant-${v.negVariant}`
    return {
      position: `P${String(cs.position).padStart(2, '0')}`,
      claim: cs.rating,
      posOrder: v.posOrder,
      register: v.register,
      lengthClass: v.lengthClass,
      styleAnchor: v.styleAnchor,
      negVariant: v.negVariant,
      negVariantName,
      camera: v.camera,
      bodyPlan: v.bodyPlan,
      handsHint: v.handsHint,
      themeWordBudget: v.themeWordBudget,
      seed: v.seed,
    }
  })

  const partial: Omit<DresserMap, 'lessonsForNextBatch'> = {
    ...partialWithoutLessons,
    counterContract,
    varietyMatrix,
  }

  return { ...partial, lessonsForNextBatch: buildLessons(partialWithoutLessons) }
}
