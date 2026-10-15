/**
 * THREAD 4 — Variety Engine (тура 4, 2026-10-15).
 *
 * Автор прямо приказал: «попробуй перелопатить систему так, чтобы были
 * разные картинки и сильно разные подходы к этому делу». Проблема: все
 * 28 слотов батча T4-32 были написаны по одному шаблону POS — модель
 * сходилась к одинаковым картинкам. NEG был boilerplate на всех слотах.
 *
 * Что делает:
 *  1) proposeVariety(slot, batchSlug) — детерминированно (хеш slug+position)
 *     выдаёт 5 осей разнообразия на слот:
 *       · posOrder      — порядок тегов в POS (body-first / pose-first / ...)
 *       · register      — регистр кадра (casual / dramatic / exotic / tense)
 *       · lengthClass   — класс длины промпта (short / medium / long)
 *       · styleAnchor   — стиль-якорь (watercolor / painterly / clean-lineart / ...)
 *       · negVariant    — индекс в NEG_VARIANTS (4 разных NEG-шаблона)
 *  2) детерминизм = одинаковый на реранах (один слот = одна судьба)
 *  3) распределение по батчу: 28 слотов × 5 осей =多样ное покрытие
 *
 * НЕ строгий закон — совет писцу (LLM), как СТРУКТУРИРОВАТЬ промпт СЕЙЧАС.
 * Писец по-прежнему решает, что теги означают; variety задаёт порядок и
 * фрейм. Цель — разойтись с шаблоном, не сломать канон.
 *
 * backend-only: зовётся из compiler.ts (контракт несёт variety) и из
 * dresser-map API (UI показывает предложения по слотам).
 */

export type PosOrder =
  | 'body-first'
  | 'pose-first'
  | 'env-first'
  | 'canon-first'
  | 'claim-first'

export type PromptRegister = 'casual' | 'dramatic' | 'exotic' | 'tense'

export type LengthClass = 'short' | 'medium' | 'long'

export type StyleAnchor =
  | 'watercolor'
  | 'painterly'
  | 'clean-lineart'
  | 'sketch'
  | 'detailed-ink'
  | 'none'

export interface SlotVariety {
  posOrder: PosOrder
  register: PromptRegister
  lengthClass: LengthClass
  styleAnchor: StyleAnchor
  /** индекс в NEG_VARIANTS — у каждого слота свой NEG-шаблон */
  negVariant: number
  /** seed (для отладки — детерминизм виден) */
  seed: number
}

const POS_ORDERS: PosOrder[] = [
  'body-first',
  'pose-first',
  'env-first',
  'canon-first',
  'claim-first',
]
const REGISTERS: PromptRegister[] = ['casual', 'dramatic', 'exotic', 'tense']
const LENGTHS: LengthClass[] = ['short', 'medium', 'long']
const STYLES: StyleAnchor[] = [
  'watercolor',
  'painterly',
  'clean-lineart',
  'sketch',
  'detailed-ink',
  'none',
]

/** FNV-1a хеш — детерминированный, без зависимостей. Тот же slug+position
 *  всегда даёт ту же ось; рераны не меняют судьбу слота. */
function hashSeed(slug: string, position: number): number {
  let h = 2166136261
  const s = `${slug}|${position}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Собрать пакет разнообразия для слота. Детерминированно. */
export function proposeVariety(
  slot: { position: number },
  batchSlug: string
): SlotVariety {
  const seed = hashSeed(batchSlug, slot.position)
  // 5 осей — каждая берёт свой кусок из хеша, чтобы оси были независимы
  return {
    posOrder: POS_ORDERS[seed % POS_ORDERS.length],
    register: REGISTERS[(seed >>> 3) % REGISTERS.length],
    lengthClass: LENGTHS[(seed >>> 5) % LENGTHS.length],
    styleAnchor: STYLES[(seed >>> 7) % STYLES.length],
    negVariant: (seed >>> 9) % 4,
    seed,
  }
}

/* ------------------------------------------------------------------ */
/* NEG-варианты — 4 разных NEG-шаблона (slot.negVariant выбирает один) */
/* ------------------------------------------------------------------ */

export const NEG_VARIANTS: { name: string; tags: string[]; why: string }[] = [
  {
    name: 'classic-anti-real',
    tags: [
      'photorealistic',
      '3D face',
      'realistic facial structure',
      'child',
      'loli',
      'shota',
      'chibi',
      'signature',
      'watermark',
      'artist name',
      'logo',
      'male',
      'man',
      '1boy',
      '2girls',
      'washed-out',
      'faded colors',
      'low contrast',
    ],
    why: 'классический anti-real — бьёт по фотореализму + детскому + подписям',
  },
  {
    name: 'anatomy-precision',
    tags: [
      'realistic facial proportions',
      'natural human nose bridge',
      'realistic lip shape',
      'semi-realistic anime face',
      '2.5D face',
      '3D face',
      'oversized head',
      'immature body',
      'childish',
      'young girl',
      'immature',
      'bad anatomy',
      'extra fingers',
      'mutated hands',
      'fused fingers',
      'signature',
      'watermark',
      'logo',
    ],
    why: 'анатом-фокус — бьёт по полу-реализму и анатомическим багам',
  },
  {
    name: 'lighting-color',
    tags: [
      'washed-out',
      'faded colors',
      'low contrast',
      'flat colors',
      'muddy colors',
      'gray palette',
      'dull',
      'overexposed',
      'underexposed',
      'harsh lighting',
      'bad lighting',
      'child',
      'loli',
      'chibi',
      'male',
      'man',
      '1boy',
      '2girls',
      'signature',
    ],
    why: 'свето-цвет-фокус — бьёт по блёклым палитрам и плохому свету',
  },
  {
    name: 'clothing-control',
    tags: [
      'bra',
      'camisole',
      'bandeau',
      'undershirt',
      'jeans',
      'denim',
      'leather skirt',
      'leather pants',
      'suit',
      'sweatpants',
      'breeches',
      'trousers',
      'slacks',
      'vinyl',
      'suede',
      'child',
      'loli',
      'photorealistic',
      '3D face',
      'signature',
    ],
    why: 'одежда-фокус — бьёт по dead fabrics и нижним слоям, которые лезут на канал',
  },
]

/* ------------------------------------------------------------------ */
/* Style anchors — POS-стиль-якорь (не NEG)                          */
/* ------------------------------------------------------------------ */

export const STYLE_ANCHOR_TAGS: Record<StyleAnchor, string> = {
  watercolor: 'watercolor style, soft brush strokes, pigment bleed, paper texture',
  painterly: 'painterly style, visible brushwork, soft blending, oil texture',
  'clean-lineart': 'clean lineart, crisp outlines, flat shading, vector style',
  sketch: 'pencil sketch style, hatching, rough lines, sketch texture',
  'detailed-ink': 'detailed ink style, cross-hatching, ink wash, traditional manga',
  none: '',
}

/* ------------------------------------------------------------------ */
/* Длина промпта → бюджет тегов                                     */
/* ------------------------------------------------------------------ */

export const LENGTH_TAG_BUDGET: Record<LengthClass, { min: number; max: number; hint: string }> = {
  short: {
    min: 18,
    max: 24,
    hint: 'КРОТКИЙ промпт — только ключевые теги, без лишних декораций (около 20 тегов)',
  },
  medium: {
    min: 25,
    max: 35,
    hint: 'СРЕДНИЙ промпт — стандартная плотность тегов (около 30 тегов)',
  },
  long: {
    min: 36,
    max: 50,
    hint: 'ДЛИННЫЙ промпт — rich environment + witness + props (около 42 тегов)',
  },
}

/* ------------------------------------------------------------------ */
/* Регистр → тон-инструкция для писца                              */
/* ------------------------------------------------------------------ */

export const REGISTER_HINT: Record<PromptRegister, string> = {
  casual: 'CASUAL register — natural light, everyday setting, relaxed mood',
  dramatic: 'DRAMATIC register — strong lighting, dynamic angle, intense mood',
  exotic: 'EXOTIC register — unusual palette, surreal light, otherworldly atmosphere',
  tense: 'TENSE register — high contrast, suspenseful angle, charged mood',
}

/* ------------------------------------------------------------------ */
/* Порядок POS → инструкция для писца                             */
/* ------------------------------------------------------------------ */

export const POS_ORDER_HINT: Record<PosOrder, string> = {
  'body-first':
    'BODY-FIRST — open the tag run with body tags (petite/slender/athletic/full-figured), THEN hair/eyes/skin, THEN pose, THEN garment',
  'pose-first':
    'POSE-FIRST — open the tag run with the pose (PL + pose name + lead zone), THEN body, THEN garment',
  'env-first':
    'ENV-FIRST — open the tag run with environment tags (location/light/witness), THEN body, THEN garment',
  'canon-first':
    'CANON-FIRST — open the tag run with OC canon locks (hair/eyes/skin/body_type), THEN body, THEN pose',
  'claim-first':
    'CLAIM-FIRST — open the tag run with the rating claim (covered nipples / wet clothes / visible pantyline / etc.), THEN body, THEN garment',
}

/* ------------------------------------------------------------------ */
/* Собрать slotFrame-инструкцию для писца из SlotVariety           */
/* ------------------------------------------------------------------ */

/** Строка-инструкция для slotFrame — говорит писцу, КАК структурировать
 *  промпт этого слота. Не закон — совет. Писец LLM читает и применяет. */
export function varietyLine(v: SlotVariety): string {
  const parts: string[] = []
  parts.push(POS_ORDER_HINT[v.posOrder])
  parts.push(REGISTER_HINT[v.register])
  parts.push(LENGTH_TAG_BUDGET[v.lengthClass].hint)
  if (v.styleAnchor !== 'none' && STYLE_ANCHOR_TAGS[v.styleAnchor]) {
    parts.push(
      `STYLE ANCHOR — weave VERBATIM into the tag run (between the body and quality tags): ${STYLE_ANCHOR_TAGS[v.styleAnchor]}`
    )
  }
  if (v.negVariant >= 0 && v.negVariant < NEG_VARIANTS.length) {
    const nv = NEG_VARIANTS[v.negVariant]
    parts.push(
      `NEG VARIANT (${nv.name}): use these as the NEG base (supplemented by OC anti-shield + slot-specific dresser negWeights): ${nv.tags.join(', ')}`
    )
  }
  return parts.join(' · ')
}
