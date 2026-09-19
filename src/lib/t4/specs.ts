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

export interface Engine {
  first_batch: string
  status: string
  law: string
  on_body: string
  strong_pairs: string
  failure_modes: string[]
}

export interface EngineSpec {
  version: string
  engines: Record<string, Engine>
  open_seeds: string[]
  lineage_note: string
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
  carrier_classes: string[]
  carrier_note?: string
  counter_neg: string[]
  prose_floor?: string
  typical_genres?: string[]
  opener?: string
  platform_note?: string
}

export interface RatingRecipesSpec {
  version: string
  tiers: Record<string, TierRecipe>
  eternal_floors: Record<string, string[]>
  default_spread: { mains_21: Record<string, number>; note: string }
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
  cache.set(file, data)
  return data
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
export function getOCCanon(): OCCanonSpec | null {
  return load<OCCanonSpec>('oc-canon.json')
}
export function getRaces(): RaceSpec | null {
  return load<RaceSpec>('races.json')
}
export function getRatingRecipes(): RatingRecipesSpec | null {
  return load<RatingRecipesSpec>('rating-recipes.json')
}
export function getBans(): BansSpec | null {
  return load<BansSpec>('bans.json')
}
export function getPools(): PoolsSpec | null {
  return load<PoolsSpec>('pools.json')
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
  const o = getOCCanon()
  if (o) out.push({ id: 'oc-canon', name: 'OC канон', count: Object.keys(o.ocs).length, version: o.canon_version })
  const r = getRaces()
  if (r) out.push({ id: 'races', name: 'Расы', count: r.races.length, version: r.version })
  const rr = getRatingRecipes()
  if (rr) out.push({ id: 'rating-recipes', name: 'Рейтинг-рецепты', count: Object.keys(rr.tiers).length, version: rr.version })
  const b = getBans()
  if (b) out.push({ id: 'bans', name: 'Баны и форма', count: b.banned_patterns.length, version: b.version })
  const po = getPools()
  if (po) {
    const n = Object.values(po.sections).reduce(
      (acc, v) => acc + (Array.isArray(v) ? v.length : typeof v === 'object' && v ? Object.keys(v as object).length : 0),
      0
    )
    out.push({ id: 'pools', name: 'Пулы (K/FET/H/GAR…)', count: n, version: po.version })
  }
  return out
}
