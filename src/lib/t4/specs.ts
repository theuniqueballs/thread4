/**
 * THREAD 4 core — typed spec loaders (constitution §2: specs are the one
 * source of truth for pools/recipes/laws-data). Cached per process.
 */
import path from 'node:path'

import { readJson, SPECS_DIR } from './fsutil'

/* ----------------------------- carriers ---------------------------- */

export interface Carrier {
  id: string
  name: string
  carrier: string
  deg: 'L' | 'M' | 'H' | string
  note?: string
  mat?: string | null
  sheer_family?: boolean
}

export interface CarrierSpec {
  version: string
  mech_groups: Record<string, string[]>
  class_defs: Record<string, { name: string; mech: string }>
  classes: Record<string, Carrier[]>
  core4_law: string
}

/* ------------------------------ poses ------------------------------ */

export interface Pose {
  id: string
  name: string
  sd: string
  category: string
  risk: string
  pairs?: string
}

export interface PoseSpec {
  version: string
  poses: Pose[]
}

/* ----------------------------- palettes ---------------------------- */

export interface Palette {
  id: string
  name: string
  dominant: string[]
  secondary?: string[]
  accent1?: string[]
  accent2?: string[]
  accent?: string[]
  shadow?: string
  forbidden?: string[]
  light_type?: string
  sd_fragment?: string
  mood?: string
  family?: string
}

export interface PaletteSpec {
  version: string
  palettes: Palette[]
}

/* ------------------------------ engines ---------------------------- */

export interface EngineRent {
  kind: 'witness-noun' | 'kinetics-lock' | 'kinetics-unique'
  count?: string
  allow?: string[]
  ranges?: number[][]
  mustDifferFrom?: string
  source?: string
  note?: string
}

export interface Engine {
  first_batch: string
  status: string
  status_note?: string
  law: string
  on_body: string
  strong_pairs: string
  failure_modes: string[]
  /** Кузница v1.1.0: регистр свидетеля + жанровый раскол + генеалогия */
  witness_register?: string
  genre_split?: string
  parents?: string[]
  generation?: number
  /** Issue #3 (Кенни, 2026-09-26): bespoke — не движок, а пол (общая аксиома) */
  role?: 'floor' | string
  role_note?: string
  /** Залп 3 + Issue #3: аренда движка — машиночитаемые механизмы, которые
   *  реально читают компилятор/гейты/писца. Нет аренды → это тема (TASTE). */
  rent?: EngineRent[]
}

export interface EngineSpec {
  version: string
  engines: Record<string, Engine>
  open_seeds: string[]
  lineage_note: string
}

export interface EngineForgeSpec {
  version: string
  born: string
  what: string
  complexity_ladder: Record<string, string>
  schema: Record<string, string>
  components: Record<string, unknown>
  assembly_protocol: string[]
  forged: string[]
  [k: string]: unknown
}

/* ------------------------------ oc canon --------------------------- */

export interface OCLocks {
  name: string
  hair?: string
  eyes?: string
  skin?: string
  body?: string
  features?: string
  wardrobe?: string
  register?: string
  anti_shield?: string[]
  status?: string
  [k: string]: unknown
}

export interface OCCanonSpec {
  version: string
  canon_version: string
  ocs: Record<string, OCLocks>
  notes?: string[]
}

/* ------------------------------ races ------------------------------ */

export interface Race {
  id: string
  name: string
  features?: string[]
  status: string
  note?: string
}

export interface RaceSpec {
  version: string
  races: Race[]
}

/* -------------------------- rating recipes ------------------------- */

export interface TierRecipe {
  name: string
  signals: string[]
  signal_min: number
  /** Вердикт T4-03: R+ обязан нести ≥1 hard-сигнал — именованный edge-объект.
   *  v1.2.0 (рендер-вердикт T4-03): hard-сигналы = только рендер-доказанные
   *  заявки; cameltoe выведен (тег рендер-мёртв: 0 отрисовок из всех попыток). */
  signals_hard?: string[]
  hard_min?: number
  /** Механизм-осознанный контр-NEG (вердикт T4-03): on-skin механизмы
   *  поднимают «topless, naked breasts» из NEG, сквозь-ткань — держат полный.
   *  v1.2.0: through_fabric несёт RENDER LAW — состояние ткани обязательно и
   *  ранним тегом, подслой глушится, мёртвые ткани не несут заявку. */
  mechanisms?: Record<
    string,
    {
      hard?: string[]
      amplifiers?: string[]
      counter_neg?: string[]
      counter_neg_lifted?: string[]
      note?: string
      render_risk?: string
      /** ≥1 обязан быть в тег-блоке (wet clothes / see-through) */
      required_state?: string[]
      /** подслой, который рендерер рисует вместо edge → тиры падают в R */
      underlayer_block?: string[]
      /** к каким hard-заявкам применяется underlayer_block */
      underlayer_block_applies_to?: string[]
      /** мёртвые ткани нижней зоны (джинсы/кожа/бархат…) — рендер-вердикт T4-03 */
      dead_fabrics_lower?: string[]
      /** мёртвые ткани верхней зоны */
      dead_fabrics_upper?: string[]
      /** lower-заявки (зона низа) */
      lower_claims?: string[]
      /** upper-заявки (зона груди) */
      upper_claims?: string[]
      /** bare-under маркеры (braless-позитивы, §9-септима) */
      bare_under_marker?: string[]
    }
  >
  carrier_classes: string[]
  carrier_note?: string
  counter_neg: string[]
  prose_floor?: string
  typical_genres?: string[]
  opener?: string
  platform_note?: string
  /** рендер-статус тира (X: 2/2 доказан рендером T4-03) */
  render_note?: string
}

export interface RatingRecipesSpec {
  version: string
  tiers: Record<string, TierRecipe>
  eternal_floors: Record<string, string[]>
  default_spread: { mains_21: Record<string, number>; note: string }
}

/* ------------------------- rating techniques ----------------------- */

/** Одна строка таблицы приёмов автора (блоки 1–7): куда тег обычно попадает.
 *  ●/○ — efficacy из таблицы, перенесена дословно; пусто = не работает. */
export interface TechniqueEntry {
  tag: string
  /** альтернативы; внутри альтернативы — подстроки через И */
  match: string[][]
  block: number
  /** 1 что видно · 2 как показано · 3 зачем показано · 4 модель дорисовывает */
  layer: number
  pg13: string
  r: string
  rplus: string
  x: string
  note?: string
  /** мост из рецепта v1.2.0 (таблица автора этого тега не знает) */
  bridge?: boolean
  /** ловушка: модель часто дорисовывает сосок/низ сама */
  trap?: boolean
  /** супрессор: держит кадр в PG-13/R */
  suppressor?: boolean
}

export interface RatingTechniquesSpec {
  version: string
  born: string
  source: string
  relation: string
  principle: {
    for_idiots: string
    layers: { n: number; name: string; blocks: number[]; note: string }[]
    x_cut_one_fact: string
  }
  efficacy_legend: Record<string, string>
  blocks: Record<string, string>
  match_semantics: string
  techniques: TechniqueEntry[]
  sum_rules: {
    born: string
    note: string
    rplus_floor: { signals_min: number; layers_min: number; why: string }
    rows: { combo: string; tiers: string }[]
  }
  xcut_hold: {
    born: string
    definition: string
    framing: string[]
    lower_cover: string[]
    poses: string[]
    pos_ban: string[]
    neg_block: string[]
    neg_block_note: string
    solo: string
    neutral_bg: string
  }
  outside_prompt: {
    born: string
    factors: { factor: string; effect: string }[]
  }
  cheat_sheet: {
    born: string
    rows: { tier: string; delta: string }[]
    note: string
  }
}

/* -------------------------- delivery stats ------------------------- */

/** Канал доставки рейтинга (delivery-stats.json, рекомендация Claude №2):
 *  частота измерена глазом автора — PRESENT ≠ VISIBLE ≠ LEGIBLE. */
export interface DeliveryChannel {
  id: string
  name: string
  status: 'live' | 'dead' | 'artifact' | 'special' | string
  tier: string
  attempts?: number
  delivered?: number
  evidence?: string[]
  note?: string
  /** рождение живым вердиктом автора (grace от жнеца) */
  born?: string
  /** канал в доборе до n=15 */
  rehab?: boolean
}

export interface DeliveryStatsSpec {
  version: string
  born: string
  source: string
  law: string
  chain: string
  channel_schema: Record<string, string>
  channels: DeliveryChannel[]
  compiler_directive: string
  update_protocol: string
}

/* ------------------------------- bans ------------------------------ */

export interface BansSpec {
  version: string
  banned_patterns: { pattern: string; replace: string; cap?: number }[]
  face_lock: string
  pos_shape: string[]
  word_budget: { pos_target: number; pos_hard: number; note: string }
  hedge_budget: number
  quality_tags: string
}

/* ------------------------------ pools ------------------------------ */

export interface PoolsSpec {
  version: string
  sections: Record<string, unknown>
}

/* --------------------------- load + cache -------------------------- */

const cache = new Map<string, unknown>()

function load<T>(file: string): T | null {
  if (cache.has(file)) return cache.get(file) as T | null
  const data = readJson<T>(path.join(SPECS_DIR, file))
  /* Залп 2: null не кэшируется — единичный сбой чтения больше не портит
     спеку на весь жизнь процесса (аудит: кэш кэшировал и null) */
  if (data !== null) cache.set(file, data)
  return data
}

export interface PolicySpec {
  id: string
  name: string
  version: string
  born: string
  born_from: string
  law: {
    slotsTotal: number
    ocSlots: number
    mainsTotal: number
    nicheCount: number
    rplusMains: number
    exquisiteDefault: number
    xSlots: number
    core4Groups: number
    wCapPct: number
    sheerPerPrompt: number
    sheerFrameCapPct: number
    poseDistinct: number
    paletteDistinct: number
    racialDefault: number
    posTarget: number
    posHard: number
    hedgeBudget: number
    leadMax: number
    closerCapPct: number
    registerCapPct: number
    signalMin: Record<string, number>
    abPairsMin: number
    abPairsMax: number
  }
  channels: Record<string, unknown>
  engines: Record<string, unknown>
  ab: Record<string, unknown>
  reaper: Record<string, unknown>
  author_pin: Record<string, unknown>
  debts: Record<string, unknown>
}

/** Политика треда (Залп 2 «Рефлекс») — числа треда живут в policy.json,
 *  не в коде (принцип П-2 чертежа T4.2). Отсутствие = громкий краш. */
export function getPolicy(): PolicySpec {
  const p = load<PolicySpec>('policy.json')
  if (!p || !p.law) {
    throw new Error('policy.json отсутствует или бит — компилятор без политики не работает (П-2: код не знает чисел). ДЕЙСТВУЙ: восстанови thread4/policy.json')
  }
  return p
}

export function getCarriers(): CarrierSpec | null {
  return load<CarrierSpec>('carriers.json')
}
export function getPoses(): PoseSpec | null {
  return load<PoseSpec>('poses.json')
}
export function getPalettes(): PaletteSpec | null {
  return load<PaletteSpec>('palettes.json')
}
export function getEngines(): EngineSpec | null {
  return load<EngineSpec>('engines.json')
}
export function getEngineForge(): EngineForgeSpec | null {
  return load<EngineForgeSpec>('engine-forge.json')
}
export function getOCCanon(): OCCanonSpec | null {
  return load<OCCanonSpec>('oc-canon.json')
}
export function getRaces(): RaceSpec | null {
  return load<RaceSpec>('races.json')
}
export function getRatingRecipes(): RatingRecipesSpec | null {
  return load<RatingRecipesSpec>('rating-recipes.json')
}
export function getRatingTechniques(): RatingTechniquesSpec | null {
  return load<RatingTechniquesSpec>('rating-techniques.json')
}
export function getDeliveryStats(): DeliveryStatsSpec | null {
  return load<DeliveryStatsSpec>('delivery-stats.json')
}
export function getBans(): BansSpec | null {
  return load<BansSpec>('bans.json')
}
export function getPools(): PoolsSpec | null {
  return load<PoolsSpec>('pools.json')
}

export interface FactsSpec {
  id: string
  version: string
  platform: Record<string, unknown>
  economics: Record<string, unknown>
  proven_facts: { id: string; fact: string; n?: number }[]
  ph_behavior: string[]
}

/** Факты мира (Залп 3 «Мир»): платформа/экономика/доказанное — элемент модели. */
export function getFacts(): FactsSpec | null {
  return load<FactsSpec>('facts.json')
}

export interface GoldenCorpusEntry {
  slot: string
  claim: string
  delivered: string
  author_note: string
  ph_text: string
}

export interface GoldenCorpusSpec {
  id: string
  version: string
  source_batch: string
  entries: GoldenCorpusEntry[]
}

/** Golden corpus (Залп 3 «Ученик»): пары «что PH реально отправил → что увидел
 *  автор» — писец учится на отрендеренной реальности, а не на самооценке. */
export function getGoldenCorpus(): GoldenCorpusSpec | null {
  return load<GoldenCorpusSpec>('golden-corpus.json')
}

export interface NicheArchetype {
  id: string
  name: string
  hint: string
}

export interface NicheArchetypesSpec {
  id: string
  version: string
  archetypes: NicheArchetype[]
}

/** НИША-50 (вердикт автора 2026-09-27): пул архетипов невозможного
 *  композиции — NICHE-слот несёт ровно один ARCH, ротация без повторов. */
export function getNicheArchetypes(): NicheArchetypesSpec | null {
  return load<NicheArchetypesSpec>('niche-archetypes.json')
}

export function allCarrierIds(spec: CarrierSpec): Carrier[] {
  return Object.values(spec.classes).flat()
}

export function specInventory(): { id: string; name: string; count: number; version: string }[] {
  const out: { id: string; name: string; count: number; version: string }[] = []
  const c = getCarriers()
  if (c) out.push({ id: 'carriers', name: 'Носители', count: allCarrierIds(c).length, version: c.version })
  const p = getPoses()
  if (p) out.push({ id: 'poses', name: 'Позы', count: p.poses.length, version: p.version })
  const pa = getPalettes()
  if (pa) out.push({ id: 'palettes', name: 'Палитры', count: pa.palettes.length, version: pa.version })
  const e = getEngines()
  if (e) out.push({ id: 'engines', name: 'Движки', count: Object.keys(e.engines).length, version: e.version })
  const ef = getEngineForge()
  if (ef) out.push({ id: 'engine-forge', name: 'Кузница движков', count: ef.forged?.length ?? 0, version: ef.version })
  const o = getOCCanon()
  if (o) out.push({ id: 'oc-canon', name: 'OC канон', count: Object.keys(o.ocs).length, version: o.canon_version })
  const r = getRaces()
  if (r) out.push({ id: 'races', name: 'Расы', count: r.races.length, version: r.version })
  const rr = getRatingRecipes()
  if (rr) out.push({ id: 'rating-recipes', name: 'Рейтинг-рецепты', count: Object.keys(rr.tiers).length, version: rr.version })
  const rt = getRatingTechniques()
  if (rt) out.push({ id: 'rating-techniques', name: 'Техника-карта рейтинга', count: rt.techniques.length, version: rt.version })
  const ds = getDeliveryStats()
  if (ds) out.push({ id: 'delivery-stats', name: 'Стата доставки рейтинга', count: ds.channels.length, version: ds.version })
  const b = getBans()
  if (b) out.push({ id: 'bans', name: 'Баны и форма', count: b.banned_patterns.length, version: b.version })
  const po = getPools()
  if (po) {
    const n = Object.values(po.sections).reduce(
      (acc: number, v: unknown): number => acc + (Array.isArray(v) ? v.length : typeof v === 'object' && v ? Object.keys(v as object).length : 0),
      0
    )
    out.push({ id: 'pools', name: 'Пулы (K/FET/H/GAR…)', count: n, version: po.version })
  }
  return out
}
