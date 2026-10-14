/**
 * ДРЕССЕР — система дресс-кода (квитанция №29, приказ автора из вердикта
 * T4-31: «Предлагаю систему Дрессер, которая уже решит проблемы и с
 * сосками и с прозрачностью и с прочей хуйнёй»).
 *
 * Три роли:
 *  1) dressFor()       — сборка дресс-кода слота (канал тира №28 ×
 *     категория сцены × тон × состояние) для контракта gen-rawplus;
 *  2) frameLine()      — инструкция писцу (DRESS CODE в slotFrame);
 *  3) checkCoherence() — квитанции когерентности для гейта dresser
 *     (конфликты категорий, №28-нарушения канала, слои §7-бис).
 *
 * Спек: thread4/specs/dresser.json (данные закона); канал тира —
 * rating-recipes v1.9.0 (mechanisms). Один источник истины на закон.
 */
import { getDresser, type DresserSpec, type DressChannel } from './specs'

export type FabricTone = 'dark' | 'mid' | 'light'

export interface DressCode {
  channel: string
  channelName: string
  category: string
  tone: FabricTone
  garment: string
  stateTags: string[]
  underlayer: string
  weights: string[]
  receipts: string[]
  law: string
}

/** Канал по тиеру и тону (закон №28): R+ через-ткань = только dark-бугорки;
 *  light/mid верх — каналы вне-ткани; X — через-ткань цветом или bare. */
export function channelsForTier(tier: string, tone: FabricTone): string[] {
  if (tier === 'X') return ['through', 'bare']
  if (tier === 'R+') {
    if (tone === 'dark') return ['bumps', 'on_skin', 'pantyline', 'swim_wet']
    return ['swim_wet', 'on_skin', 'pantyline'] // light/mid: NO through-channels (№28)
  }
  return []
}

/** Детерминированный выбор из списка (seeded RNG уже применён снаружи
 *  к порядку кандидатов — здесь просто первый живой). */
function pickChannel(spec: DresserSpec, candidates: string[]): DressChannel | null {
  for (const c of candidates) {
    if (spec.channels[c]) return spec.channels[c]
  }
  return null
}

/** Собрать дресс-код слота. tone обязателен для R+/X (закон №27/№28:
 *  контракт назначает тон вещи); channel — явный выбор генератора
 *  (ротация по candidates), иначе первый живой. Возвращает null для
 *  PG-13/R (дресс-код политика не тянет заявку — обычная одежда). */
export function dressFor(args: {
  tier: string
  tone: FabricTone
  channel?: string
  sceneHint?: string
  garment?: string
  rng?: () => number
  wantWeights?: boolean
}): DressCode | null {
  const spec = getDresser()
  if (!spec) return null
  const candidates = args.channel
    ? [args.channel]
    : channelsForTier(args.tier, args.tone)
  if (candidates.length === 0) return null
  const channel = pickChannel(spec, candidates)
  if (!channel) return null
  // категория: сцена → подсказка; swim_wet всегда swim
  const hints = spec.scene_hints ?? {}
  let category = channel.name.includes('купальник') || channel === spec.channels['swim_wet'] ? 'swim' : (hints[args.sceneHint ?? ''] ?? 'street')
  if (!spec.categories[category]) category = 'street'
  const cat = spec.categories[category]
  // вещь: назначенная контрактом или из категории (детерминированно по rng)
  const garment =
    args.garment && args.garment.trim().length > 0
      ? args.garment
      : (cat.items.length > 0 ? cat.items[Math.floor((args.rng?.() ?? 0.42) * cat.items.length)] : 'named garment')
  const toneWord = args.tone === 'dark' ? 'тёмная' : args.tone === 'light' ? 'светлая' : 'средняя'
  const weights: string[] = []
  if (args.wantWeights) {
    // EXP-грамматика (v1.9.0 weights_raw): максимум 2 на слот от Дрессера
    if (channel === spec.channels['bumps']) weights.push('(covered nipples:1.1)', '(fabric clinging:1.2)')
    if (channel === spec.channels['through']) weights.push('(nipples through clothing:1.2)')
  }
  return {
    channel: Object.keys(spec.channels).find((k) => spec.channels[k] === channel) ?? 'bumps',
    channelName: channel.name,
    category,
    tone: args.tone,
    garment: `${toneWord} ${garment}`.trim(),
    stateTags: channel.state ?? [],
    underlayer: channel.underlayer ?? 'nothing underneath',
    weights,
    receipts: [channel.receipt ?? '', cat.receipts?.[0] ?? ''].filter(Boolean),
    law: channel.law ?? '',
  }
}

/** Строка инструкции писцу — DRESS CODE в slotFrame (вплетается ДОСЛОВНО). */
export function frameLine(d: DressCode): string {
  const parts = [
    `DRESS CODE (Дрессер, №29): канал «${d.channelName}» · категория «${d.category}» · ${d.garment}`,
    `состояние: ${d.stateTags.join(', ')}`,
    `подслой: ${d.underlayer}`,
  ]
  if (d.weights.length > 0) parts.push(`веса RAW (EXP): ${d.weights.join(' ')} — только эти, дословно`)
  parts.push(`конфликт-запрет категории смотри в спеке dresser.json; тон вещи НЕ оспаривается (№27/№28)`)
  return parts.join(' · ')
}

/** Квитанции когерентности по тег-рану слота (гейт dresser, warn).
 *  Проверяет: конфликты категорий (garter+swim — hard-Receipt автора),
 *  запрещённые теги канала на R+ (№28 — дублирует hard rating-recipe,
 *  здесь — как квитанция осознанности для EXP), слои §7-бис, P03-реквизит. */
export function checkCoherence(args: {
  tagRun: string
  tier: string
  isExploratory?: boolean
}): string[] {
  const spec = getDresser()
  const out: string[] = []
  if (!spec) return out
  const t = args.tagRun.toLowerCase()
  // 1. Конфликты категорий (receipt-материал вердикта T4-31)
  for (const conf of spec.conflicts ?? []) {
    const tags = (conf.tags ?? []).map((x) => x.toLowerCase())
    const groupA = tags.filter((x) => ['garter straps', 'garter belt', 'thighhighs', 'stockings', 'lingerie set', 'sheer nightgown'].includes(x))
    const groupB = tags.filter((x) => ['swimsuit', 'bikini'].includes(x))
    const aHit = groupA.length > 0 && groupA.some((x) => new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))
    const bHit = groupB.length > 0 && groupB.some((x) => new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))
    if (aHit && bHit) {
      out.push(`конфликт дресс-кода: ${conf.pair[0]} + ${conf.pair[1]} — ${conf.why}`)
    }
    // формальные/спортивные пары — осознанность
    const faHit = t.includes('gown') || t.includes('opera gloves')
    const fbHit = t.includes('gym leggings') || t.includes('tennis skirt') || t.includes('track shorts')
    if (conf.rule === 'warn' && ((faHit && fbHit) || (t.includes('sports bra') && (t.includes('garter belt') || t.includes('stockings'))))) {
      out.push(`смешение регистров (Дрессер, warn): ${conf.why}`)
    }
  }
  // 2. №28: через-теги на R+ вне EXP — квитанция (hard живёт в rating-recipe)
  if (args.tier === 'R+' && !args.isExploratory) {
    if (/\bnipples through clothing\b/.test(t)) {
      out.push('№28: через-заявка на R+ — это X-канал по определению (hard в rating-recipe; EXP-слот обязан флаг ⚗)')
    }
    if (/\bwet clothes\b/.test(t) && /\bsee-through\b/.test(t) && !/\bswimsuit\b/.test(t)) {
      out.push('№28: мокрое+сквозное на тканевом верхе = X-комбо (P12/P25/P26 T4-31); купальник — исключение (P21)')
    }
  }
  // 3. Слои §7-бис: грубая оценка по верхним предметам в тег-ране
  const upperItems = ['blouse', 'tee', 'shirt', 'knit top', 'cardigan', 'jacket', 'coat', 'parka', 'robe', 'vest', 'corset', 'sweater', 'kimono', 'crop top', 'halter']
  let upperHits = 0
  for (const u of upperItems) if (new RegExp(`\\b${u.replace(/ /g, '\\ ')}\\b`).test(t)) upperHits++
  if (upperHits >= 3) {
    out.push(`§7-бис: ${upperHits} верхних предметов в тег-ране — рендерер соберёт скромную комбинацию (RENDER LAW 3+ слоёв)`)
  }
  // 4. P03-реквизит: предмет-тема без контакт-глагола
  const propWords = ['measuring tape', 'ribbon', 'harness', 'bell', 'collar tag', 'ribbon choker']
  const contactVerbs = ['wraps', 'measures', 'holds', 'threads', 'winds', 'clips', 'ties', 'loop']
  for (const p of propWords) {
    if (t.includes(p) && !contactVerbs.some((v) => t.includes(v))) {
      out.push(`P03-правило: реквизит «${p}» без контакт-глагола (wraps/measures/holds…) — читается ошибкой, не темой (мерная лента T4-31)`)
    }
  }
  return out
}
