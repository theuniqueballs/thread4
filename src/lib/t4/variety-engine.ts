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

/** Тур 5 (приём G01 от Коул) + раунд 2026-10-16 (фидбек автора «без
 *  негатив спейса»): класс дистанции камеры — ломает «cowboy на всех 28
 *  слотах». wide-shot — КОМПОЗИЦИЯ С ВОЗДУХОМ: субъект меньше, воздух
 *  вокруг, кадр дышит — ровно то, чего просил автор. Квота: 6 full-body /
 *  8 cowboy / 6 upper-body / 4 image-close / 2 face / 2 worm's-eye /
 *  2 top-down / 2 over-shoulder / 2 wide-shot = 32 на батч (26-28 берёт
 *  почти все). */
export type CameraClass =
  | 'full-body'
  | 'cowboy'
  | 'upper-body'
  | 'image-close'
  | 'face-focus'
  | 'worms-eye'
  | 'top-down'
  | 'over-shoulder'
  | 'wide-shot'

/** Тур 5 (приём G11 от Коул): named body plan для non-OC слотов.
 *  OC берут body_type из oc-canon; NICHE/VOLT/EXQUISITE/EXP —
 *  назначается план из пула, вплетается в POS (positions 6-10). */
export type BodyPlan =
  | 'petite'
  | 'slender'
  | 'athletic'
  | 'curvy'
  | 'full-figured'
  | 'hourglass'
  | 'slim'
  | 'toned'
  | 'voluptuous'
  | 'compact'

/** Тур 5 (приём G22 от Коул): занятые руки на VOLT/R+ — ломает
 *  «arms-at-sides default». ≥50% VOLT/R+ должны нести busy-hand тег. */
export type HandsHint =
  | 'holding-hem'
  | 'adjusting-strap'
  | 'gathering-hair'
  | 'pressing-fabric'
  | 'catching-waistband'
  | 'reaching-upward'
  | 'twisting-torso'
  | 'arms-at-sides'

export interface SlotVariety {
  posOrder: PosOrder
  register: PromptRegister
  lengthClass: LengthClass
  styleAnchor: StyleAnchor
  /** индекс в NEG_VARIANTS — у каждого слота свой NEG-шаблон */
  negVariant: number
  /** Тур 5: класс дистанции камеры (G01) */
  camera: CameraClass
  /** Тур 5: body plan для non-OC слотов (G11) — null для OC (берут из канона) */
  bodyPlan: BodyPlan | null
  /** Тур 5: занятость рук (G22) — только для VOLT/EXQUISITE/EXP non-OC */
  handsHint: HandsHint | null
  /** Тур 5: бюджет theme-слов (G30) — warn если theme-token count > claim-token count на R+ */
  themeWordBudget: number
  /** seed (для отладки — детерминизм виден) */
  seed: number
}

/* ------------------------------------------------------------------ */
/* Граница сериализации: контракт JSON несёт variety строками           */
/* (compiler кладёт каноничные значения, но писец читает файл с диска — */
/*  ключам словарей доверять нельзя, strict typing на границе).         */
/* ------------------------------------------------------------------ */

/** Loose-форма SlotVariety из контракта JSON (compiler.ts ContractSlot). */
export interface SlotVarietyLoose {
  posOrder: string
  register: string
  lengthClass: string
  styleAnchor: string
  negVariant: number
  camera: string
  bodyPlan: string | null
  handsHint: string | null
  themeWordBudget: number
  seed?: number
}

function pickKey<T extends string>(raw: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/** Нормализация loose-variety из JSON в строгий SlotVariety: неизвестные
 *  ключи → безопасные дефолты (varietyLine индексирует словари — мусорный
 *  ключ не должен ронять рендер слот-фрейма и протекать в подсказку
 *  писцу). Аудит-раунд 2026-10-16: до этого писец кормил varietyLine
 *  строками из JSON без всякой проверки. */
export function coerceSlotVariety(raw: SlotVarietyLoose): SlotVariety {
  const clampInt = (v: number, min: number, max: number, fallback: number): number =>
    Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback
  return {
    posOrder: pickKey(raw.posOrder, POS_ORDERS, 'body-first'),
    register: pickKey(raw.register, REGISTERS, 'casual'),
    lengthClass: pickKey(raw.lengthClass, LENGTHS, 'medium'),
    styleAnchor: pickKey(raw.styleAnchor, STYLES, 'none'),
    negVariant: clampInt(raw.negVariant, 0, Math.max(0, NEG_VARIANTS.length - 1), 0),
    camera: pickKey(raw.camera, Object.keys(CAMERA_QUOTA) as CameraClass[], 'cowboy'),
    bodyPlan: raw.bodyPlan == null ? null : pickKey(raw.bodyPlan, BODY_PLANS, 'athletic'),
    handsHint: raw.handsHint == null ? null : pickKey(raw.handsHint, HANDS_HINTS, 'arms-at-sides'),
    themeWordBudget: clampInt(raw.themeWordBudget, 0, 99, 6),
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed : 0,
  }
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

const BODY_PLANS: BodyPlan[] = [
  'petite',
  'slender',
  'athletic',
  'curvy',
  'full-figured',
  'hourglass',
  'slim',
  'toned',
  'voluptuous',
  'compact',
]

const HANDS_HINTS: HandsHint[] = [
  'holding-hem',
  'adjusting-strap',
  'gathering-hair',
  'pressing-fabric',
  'catching-waistband',
  'reaching-upward',
  'twisting-torso',
  'arms-at-sides',
]

/** G01 camera quota pool — 28 слотов примерно покрывают квоту Коул.
 *  Пул shuffle-ится по batchSlug, чтобы каждый батч получал своё
 *  распределение (но всегда ≈ 6 cowboy / 6 full-body / 6 upper / и т.д.). */
export const CAMERA_QUOTA: Record<CameraClass, number> = {
  cowboy: 8,
  'full-body': 6,
  'upper-body': 6,
  'image-close': 4,
  'face-focus': 2,
  'worms-eye': 2,
  'top-down': 2,
  'over-shoulder': 2,
  'wide-shot': 2,
}
const CAMERA_POOL: CameraClass[] = Object.entries(CAMERA_QUOTA).flatMap(
  ([c, n]) => Array(n).fill(c) as CameraClass[]
)

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

/** Seedable shuffle — детерминированная перестановка массива по seed.
 *  Fisher-Yates с PRNG, который seedится из FNV-1a. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed >>> 0
  const rng = () => {
    s = Math.imul(s ^ (s >>> 15), 0x85ebca6b)
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35)
    s ^= s >>> 16
    return ((s >>> 0) / 0x100000000) as number
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Собрать пакет разнообразия для слота. Детерминированно.
 *
 *  Внимание: camera и bodyPlan — батч-уровневые (нужна квота и interleave),
 *  в одиночном вызове proposeVariety они provisional — используй
 *  proposeBatchVariety для всего батча, там квота и interleave налаживаются. */
export function proposeVariety(
  slot: { position: number; kind?: string; rating?: string },
  batchSlug: string
): SlotVariety {
  const seed = hashSeed(batchSlug, slot.position)
  const isOC = slot.kind === 'OC'
  const isRplus = slot.rating === 'R+'
  const isX = slot.rating === 'X'
  const isVoltOrMain = !isOC && (slot.kind === 'VOLT' || slot.kind === 'EXQUISITE' || slot.kind === 'EXP')
  // G06: claim-first bias на R+ — ≥40% R+ слотов должны быть claim-first
  // (ломает hair-first дефолт, из-за которого claim тонет)
  let posOrder: PosOrder
  if (isRplus && (seed % 100) < 40) {
    posOrder = 'claim-first'
  } else {
    posOrder = POS_ORDERS[seed % POS_ORDERS.length]
  }
  return {
    posOrder,
    register: REGISTERS[(seed >>> 3) % REGISTERS.length],
    lengthClass: LENGTHS[(seed >>> 5) % LENGTHS.length],
    styleAnchor: STYLES[(seed >>> 7) % STYLES.length],
    negVariant: (seed >>> 9) % 4,
    camera: CAMERA_POOL[seed % CAMERA_POOL.length], // provisional — батч-уровень ниже
    bodyPlan: isOC ? null : BODY_PLANS[(seed >>> 11) % BODY_PLANS.length], // provisional
    handsHint: isVoltOrMain
      ? HANDS_HINTS[(seed >>> 13) % HANDS_HINTS.length]
      : null,
    themeWordBudget: isRplus ? 3 : 5, // R+: ≤3 theme-слов (claim приоритет), остальное: ≤5
    seed,
  }
}

/** Батч-уровневая сборка разнообразия — накладывает КВОТУ камеры (G01)
 *  и INTERLEAVE bodyPlan (G12 — запрет двум соседним слотам иметь
 *  одинаковый боди-план). Возвращает массив variety по слотам.
 *
 *  Принимает слоты с их kind/rating, чтобы знать где OC (там bodyPlan=null),
 *  где VOLT (там handsHint нужен), и т.д. */
export function proposeBatchVariety(
  slots: { position: number; kind?: string; rating?: string }[],
  batchSlug: string
): SlotVariety[] {
  const batchSeed = hashSeed(batchSlug, 0)
  // 1) базовая variety на каждый слот
  const result = slots.map((s) => proposeVariety(s, batchSlug))
  // 2) квота камеры: shuffle CAMERA_POOL по batchSeed, раздать по слотам
  const cameraOrder = seededShuffle(CAMERA_POOL, batchSeed).slice(0, result.length)
  // добираем если слотов больше чем пул (редкий кейс)
  while (cameraOrder.length < result.length) {
    cameraOrder.push(CAMERA_POOL[(cameraOrder.length - CAMERA_POOL.length + batchSeed) % CAMERA_POOL.length])
  }
  for (let i = 0; i < result.length; i++) {
    result[i].camera = cameraOrder[i]
  }
  // 3) interleave bodyPlan (G12): запрет двум соседним non-OC слотам
  // иметь одинаковый боди-план — переставляем на следующий в пуле
  let lastBodyPlan: BodyPlan | null = null
  for (let i = 0; i < result.length; i++) {
    const v = result[i]
    if (v.bodyPlan === null) {
      lastBodyPlan = null
      continue
    }
    if (v.bodyPlan === lastBodyPlan) {
      // rotate to next plan in pool (deterministic, не random — иначе
      // соседи снова могут совпасть)
      const idx = BODY_PLANS.indexOf(v.bodyPlan)
      const next = BODY_PLANS[(idx + 1 + (i % 3)) % BODY_PLANS.length]
      v.bodyPlan = next
    }
    lastBodyPlan = v.bodyPlan
  }
  return result
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
/* Тур 5: Camera tags (G01) — POS-тег дистанции/ракурса              */
/* ------------------------------------------------------------------ */

export const CAMERA_TAGS: Record<CameraClass, string> = {
  cowboy: 'cowboy shot',
  'full-body': 'full body',
  'upper-body': 'upper body',
  'image-close': 'close-up',
  'face-focus': 'face focus, extreme close-up',
  'worms-eye': "from below, worm's eye view",
  'top-down': 'from above, top-down view',
  'over-shoulder': 'over shoulder, from behind',
  'wide-shot':
    'wide shot, negative space, subject off-center, spacious composition, breathing room, depth of field background',
}

/** Коул G03: lead-zone = кадр, не подпись. Если lead=nape → камера
 *  фрагмент на nape/shoulders, не full-body. Override camera, если
 *  lead узкий. */
export function cameraForLead(lead: string | undefined, base: CameraClass): CameraClass {
  if (!lead) return base
  // узкие lead → фрагмент, не full-body
  const narrow = ['nape', 'throat', 'collarbone', 'shoulders', 'back']
  if (narrow.includes(lead.toLowerCase()) && base === 'full-body') {
    return 'upper-body'
  }
  return base
}

/* ------------------------------------------------------------------ */
/* Тур 5: Body plan tags (G11) — POS-теги плана тела для non-OC    */
/* ------------------------------------------------------------------ */

export const BODY_PLAN_TAGS: Record<BodyPlan, string> = {
  petite: 'petite body, small frame, compact',
  slender: 'slender body, slim form',
  athletic: 'athletic body, toned, defined',
  curvy: 'curvy body, soft curves',
  'full-figured': 'full-figured body, full chest, soft waist',
  hourglass: 'hourglass figure, wide hips, narrow waist',
  slim: 'slim body, slight build',
  toned: 'toned body, defined muscles',
  voluptuous: 'voluptuous body, generous figure',
  compact: 'compact body, small-waisted, softly mounded',
}

/* ------------------------------------------------------------------ */
/* Тур 5: Hands hint tags (G22) — POS-тег занятых рук              */
/* ------------------------------------------------------------------ */

export const HANDS_HINT_TAGS: Record<HandsHint, string> = {
  'holding-hem': 'holding hem',
  'adjusting-strap': 'adjusting strap',
  'gathering-hair': 'gathering hair',
  'pressing-fabric': 'pressing fabric',
  'catching-waistband': 'catching waistband',
  'reaching-upward': 'reaching upward',
  'twisting-torso': 'twisting torso, weight shifted',
  'arms-at-sides': 'arms at sides',
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
  // G01: camera tag (POS)
  parts.push(`CAMERA (G01): ${CAMERA_TAGS[v.camera]} — weave VERBATIM into POS as the framing tag`)
  // G11: body plan for non-OC (POS, between hair/eyes/skin and pose)
  if (v.bodyPlan) {
    parts.push(
      `BODY PLAN (G11): ${BODY_PLAN_TAGS[v.bodyPlan]} — weave into POS positions 6-10 (between skin and pose); NEVER on OC slots (they carry body_type from canon)`
    )
  }
  // G22: hands hint for VOLT/EXQUISITE/EXP (POS)
  if (v.handsHint) {
    parts.push(`HANDS (G22): ${HANDS_HINT_TAGS[v.handsHint]} — weave into POS as the action tag`)
  }
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
  // G30: theme-word budget
  parts.push(
    `THEME BUDGET (G30): ≤${v.themeWordBudget} theme-words in POS — claim-token count MUST exceed theme-token count on R+; if theme-word count > claim-token count, trim theme (theme eats body, T4-19/T4-32 pattern)`
  )
  return parts.join(' · ')
}
