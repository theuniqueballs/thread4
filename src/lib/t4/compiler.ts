/**
 * THREAD 4 core — THE COMPILER (constitution §3).
 *
 * Diversity is ASSIGNED at compile time (the Verbalized Sampling
 * inversion), not caught by lints afterwards. The compiler reads specs +
 * the event fold, plans all 21+3 slots, and emits the batch contract:
 *   - machine half: contracts/T4-XX.json (gates read it back)
 *   - human half:   contracts/T4-XX.md   (the exposition the author
 *     receives BEFORE the batch: what I decided, by which rating, why)
 *
 * Deterministic: seed = hash(theme + slug). Same theme → same plan.
 */
import crypto from 'node:crypto'
import path from 'node:path'

import { CONTRACTS_DIR, ensureDirs, writeJson, writeText, readJson } from './fsutil'
import {
  appendEvent,
  foldState,
  nextBatchNumber,
  readEvents,
  type T4Event,
} from './events'
import {
  allCarrierIds,
  getCarriers,
  getDeliveryStats,
  getFacts,
  getNicheArchetypes,
  getOCCanon,
  getPalettes,
  getPolicy,
  getPoses,
  getRaces,
  getRatingRecipes,
  type Carrier,
} from './specs'

/* ------------------------------------------------------------------ */
/* Seeded RNG (deterministic compiles)                                 */
/* ------------------------------------------------------------------ */

function hashSeed(s: string): number {
  const h = crypto.createHash('sha256').update(s).digest()
  return h.readUInt32LE(0)
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Rng {
  next(): number
  pick<T>(arr: T[]): T
  shuffle<T>(arr: T[]): T[]
}

function makeRng(seed: number): Rng {
  const rand = mulberry32(seed)
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return { next: rand, pick, shuffle }
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface SlotPlan {
  position: number // 1..21
  kind: 'OC' | 'NICHE' | 'VOLT' | 'EXQUISITE'
  oc?: string
  ocTheme?: string // author's OC theme/angle for this slot (optional)
  rating: 'PG-13' | 'R' | 'R+' | 'X'
  race?: string
  raceFeature?: string
  pose: string // PL id
  poseName: string
  poseRisk: string
  palette: string // palette id
  paletteName: string
  kinetics: string[] // K ids
  carriers: { id: string; name: string; cls: string; deg: string }[]
  lead: string
  register: 'student' | 'young' | 'milf'
  witness?: string // NICHE/engine witness object
  closer: string
  exploratory?: string
  /** A/B-пара (§10-поправка): один канал доставки (LEAD-зона), разная подача */
  ab?: { pair: string; half: 'A' | 'B'; withSlot: number; lead: string }
  /** author_pin (Залп 2): назначение вопреки статистике — помечено прицелом */
  pinned?: string[]
  /** rehab-добор (Залп 3): канал доставки, который этот слот пытается оживить */
  targetChannel?: string
  /** НИША-50: архетип невозможного композиции (ротация без повторов в батче) */
  arch?: string
}

export interface BatchContract {
  slug: string
  theme: string
  engine: string
  engineLaw: string
  engineWhy: string
  seed: number
  createdAt: string
  spread: { rating: string; count: number }[]
  slots: SlotPlan[]
  ocRotation: { name: string; served: number }[]
  racialCount: number
  /** A/B-пары (§10-поправка): 2-3 пары R+-слотов — один канал, разная подача */
  abPairs: { pair: string; a: number; b: number; lead: string }[]
  /** author_pin (Залп 2): каналы, назначенные вопреки статистике — прицел автора */
  authorPin?: string[]
  carrierStats: {
    wSharePct: number
    sheerRplusPct: number
    wCapPct: number
    sheerFrameCapPct: number
  }
  windowSlugs: string[]
  /** Стата доставки (внешний вердикт №3, Claude): живые/кандидатные/мёртвые
   *  каналы контракта — экспозиция для автора, поведение не меняет (§10). */
  channelStats: {
    version: string
    live: string[]
    candidate: string[]
    dead: string[]
    /** каналы, ЗАЯВЛЕННЫЕ этим контрактом, но мёртвые по стате */
    deadClaims: { zone: string; channel: string; evidence: string }[]
  }
  /** Факты мира (Залп 3): платформа/экономика/доказанное — планируем с потерями */
  platform?: Record<string, unknown>
  laws: Record<string, string | number>
}

export interface CompileOptions {
  ocOrders?: string[] // author-named OCs (up to 3); rest filled by rotation
  ocThemes?: Record<string, string> // author's per-OC theme/angle, keyed by OC name
  engine?: string // engine key override
  exquisite?: number // 0..4, default 1
  exploratory?: number // 0..2, default 1
  seed?: number
  slug?: string // recompile override (T4-NN) — recompiles an existing slug under the current law
  dryRun?: boolean // no events, no files — for selftests
  /** Прицел автора (Залп 2, policy.author_pin): каналы, назначаемые ВОПРЕКИ
   *  статистике — 'oc-rplus', 'engine:<key>'. Помечаются событием author.pinned
   *  и флагом pinned — данные рефлекса не смешиваются с прицелом. */
  authorPin?: string[]
}

/* ------------------------------------------------------------------ */
/* Window usage (rotation memory)                                      */
/* ------------------------------------------------------------------ */

interface WindowUsage {
  carriers: Record<string, number>
  poses: Record<string, number>
  palettes: Record<string, number>
  kinetics: Record<string, number>
  races: Record<string, number>
  leads: Record<string, number>
  closers: Record<string, number>
  witnesses: Record<string, number>
}

function emptyUsage(): WindowUsage {
  return {
    carriers: {},
    poses: {},
    palettes: {},
    kinetics: {},
    races: {},
    leads: {},
    closers: {},
    witnesses: {},
  }
}

function foldWindowUsage(windowSlugs: string[]): WindowUsage {
  const usage = emptyUsage()
  for (const slug of windowSlugs) {
    const c = readJson<BatchContract>(path.join(CONTRACTS_DIR, `${slug}.json`))
    if (!c) continue
    for (const s of c.slots) {
      usage.poses[s.pose] = (usage.poses[s.pose] ?? 0) + 1
      usage.palettes[s.palette] = (usage.palettes[s.palette] ?? 0) + 1
      usage.races[s.race ?? ''] = (usage.races[s.race ?? ''] ?? 0) + 1
      usage.leads[s.lead] = (usage.leads[s.lead] ?? 0) + 1
      usage.closers[s.closer] = (usage.closers[s.closer] ?? 0) + 1
      if (s.witness) usage.witnesses[s.witness] = (usage.witnesses[s.witness] ?? 0) + 1
      for (const k of s.kinetics) usage.kinetics[k] = (usage.kinetics[k] ?? 0) + 1
      for (const cr of s.carriers) usage.carriers[cr.id] = (usage.carriers[cr.id] ?? 0) + 1
    }
  }
  return usage
}

/** Least-recently-used picker: prefer never-used, then least used, tie → rng order. */
function lruPick<T extends { id: string }>(
  pool: T[],
  usage: Record<string, number>,
  rng: Rng
): T[] {
  return rng.shuffle(pool).sort((a, b) => (usage[a.id] ?? 0) - (usage[b.id] ?? 0))
}

/* ------------------------------------------------------------------ */
/* Constants (Залп 2 «Рефлекс»: числа треда живут в specs/policy.json — */
/* П-2 чертежа T4.2: код не знает чисел. Отсутствие политики = краш).   */
/* ------------------------------------------------------------------ */

export const LAWS = getPolicy().law

const LEAD_ZONES = [
  'hands', 'throat', 'collarbone', 'breasts', 'waist', 'hips', 'seat',
  'thighs', 'hamstrings', 'nape', 'cheeks', 'shoulders', 'back',
]

const CLOSER_CLASSES = ['dialogue', 'long-fused', 'fragment-pair', 'image-close', 'action-close']

const WITNESS_TYPES = [
  'mirror', 'shop glass', 'security monitor', 'door gap', 'propped phone',
  'traffic mirror', 'level gauge', 'window pane', 'wet street', 'elevator brass',
  'photo frame', 'spoon', 'watch face', 'car hood', 'fountain edge',
]

interface PoolsFile {
  sections: Record<string, { id: string; name?: string }[]>
}

/* ------------------------------------------------------------------ */
/* The compiler                                                        */
/* ------------------------------------------------------------------ */

export function compileBatch(theme: string, options: CompileOptions = {}): BatchContract {
  ensureDirs()

  const events = readEvents()
  const state = foldState(events)
  const slugOverride = options.slug && /^T4-\d{2}$/.test(options.slug) ? options.slug : null
  const num = slugOverride
    ? parseInt(slugOverride.slice(3), 10)
    : nextBatchNumber(state.batches)
  const slug = `T4-${String(num).padStart(2, '0')}`
  const seed = options.seed ?? hashSeed(`${slug}::${theme}`)
  const rng = makeRng(seed)

  /* specs */
  const carriers = getCarriers()
  const poses = getPoses()
  const palettes = getPalettes()
  const ocCanon = getOCCanon()
  const races = getRaces()
  const recipes = getRatingRecipes()
  if (!carriers || !poses || !palettes || !ocCanon || !races || !recipes) {
    throw new Error('specs not loaded — run the pool import first')
  }

  const usage = foldWindowUsage(state.windowSlugs)

  /* Одноразовые движки (3.2-традиция, вердикт автора Issue #11 Q3): движок
     пишется писцом ПОД ТЕМУ на этапе спайна и утилизируется после батча.
     Никакой библиотеки, ротации, дебютов и ренты — интерпретация темы живёт
     один батч. Контракт несёт только намерение; закон появится в батче. */
  const engineKey = 'per-theme'
  const engine = {
    status: 'per-theme',
    first_batch: '',
    law: 'одноразовый движок: писец выводит физический закон ТЕМЫ на этапе спайна; после батча утилизируется',
  }

  /* OC rotation: author orders first, then longest-rested actives */
  const activeOcs = Object.entries(ocCanon.ocs)
    .filter(([, o]) => (o.active ?? true) !== false)
    .map(([name]) => name)
  const served = (n: string) => state.ocAppearances[n] ?? 0
  const rotationPool = rng
    .shuffle(activeOcs)
    .sort((a, b) => served(a) - served(b))
  const ocNames: string[] = []
  for (const o of options.ocOrders ?? []) {
    if (ocCanon.ocs[o] && ocNames.length < 3) ocNames.push(o)
  }
  for (const o of rotationPool) {
    if (ocNames.length >= 3) break
    if (!ocNames.includes(o)) ocNames.push(o)
  }

  /* genre skeleton (закон 24): P01-P03 OC (R+) · P04-P24 = 21 мейн:
     7 NICHE R + 12 R+ мейнов (вкл. EXQUISITE) + 2 X — спред мейнов R+×12/R×7/X×2 */
  const exquisiteN = Math.max(0, Math.min(4, options.exquisite ?? LAWS.exquisiteDefault))
  const mains: { kind: SlotPlan['kind']; rating: SlotPlan['rating'] }[] = []
  for (let i = 0; i < LAWS.nicheCount; i++) mains.push({ kind: 'NICHE', rating: 'R' })
  for (let i = 0; i < LAWS.rplusMains - exquisiteN; i++) mains.push({ kind: 'VOLT', rating: 'R+' })
  for (let i = 0; i < exquisiteN; i++) mains.push({ kind: 'EXQUISITE', rating: 'R+' })
  for (let i = 0; i < LAWS.xSlots; i++) mains.push({ kind: 'VOLT', rating: 'X' })
  if (mains.length !== LAWS.mainsTotal) {
    throw new Error(`genre skeleton broken: ${mains.length} mains, expected ${LAWS.mainsTotal}`)
  }
  const orderedMains = rng.shuffle(mains)

  /* pools for assignment */
  // PL01 Neutral Stand отставлен навсегда («standing lineup» — анти-канон,
  // N26; «Охуенная поза решила всё» — RF-001): сто́ящий дефолт не выбирается
  const posePool = lruPick(
    poses.poses.filter((p) => p.id !== 'PL01'),
    usage.poses,
    rng
  )
  const palettePool = lruPick(palettes.palettes, usage.palettes, rng)
  // расовый каст — только нечеловеческие расы: Human ничего не делает в кадре
  // (memorability from NR features — races.json R01), слот не тратим
  const racePool = lruPick(
    races.races.filter(
      (r) =>
        (r.status === 'active' || r.status === 'gold') &&
        r.name.toLowerCase() !== 'human'
    ),
    usage.races,
    rng
  )
  /* kinetics from the pools spec */
  const poolsSpec = readJson<PoolsFile>(
    path.join(process.cwd(), 'thread4', 'specs', 'pools.json')
  )
  const poolsK: { id: string; name?: string }[] = poolsSpec?.sections?.kinetics_k ?? []
  const kPool = lruPick(poolsK, usage.kinetics, rng)

  /* carrier assignment helpers */
  const byClass = carriers.classes
  const groupOf = (cls: string) => carriers.class_defs[cls]?.mech ?? ''
  const carrierUsage = usage.carriers
  // Внутрисборочная дедупликация (фикс после T4-03): lruPick смотрел только в
  // окно ротации, и «свежий» носитель (CR-W27) выбирался первым во ВСЕ слоты —
  // моно-носитель N28, тик на каждом кадре. Теперь каждый выбор маркируется
  // и отодвигается в конец очереди до исчерпания пула.
  const batchUse: Record<string, number> = {}
  const lruPickBatch = <T extends { id: string }>(pool: T[], usage: Record<string, number>): T[] =>
    rng.shuffle(pool).sort(
      (a, b) =>
        (usage[a.id] ?? 0) + (batchUse[a.id] ?? 0) * 50 - ((usage[b.id] ?? 0) + (batchUse[b.id] ?? 0) * 50)
    )
  // batch-level sheer budget: ≤40% of R+ frames (12 mains + 3 OC = 15) may carry a sheer carrier
  const rplusTotal = LAWS.rplusMains + LAWS.ocSlots
  const maxSheerFrames = Math.floor((rplusTotal * LAWS.sheerFrameCapPct) / 100)
  let sheerFramesUsed = 0

  function assignCore4(rating: 'R+' | 'X', position: number): SlotPlan['carriers'] {
    const groupsNeeded = ['FABRIC', 'BODY', 'POSITION', 'PHYSICS'] as const
    const recipe = recipes!.tiers[rating === 'R+' ? 'RPLUS' : 'X']
    const prefer = recipe?.carrier_classes ?? []
    const out: SlotPlan['carriers'] = []
    let sheerInPrompt = 0
    let frameIsSheer = false
    const sheerBudgetLeft = () => sheerInPrompt < LAWS.sheerPerPrompt && sheerFramesUsed < maxSheerFrames
    for (const g of groupsNeeded) {
      const classes = Object.keys(byClass).filter((c) => groupOf(c) === g)
      // prefer recipe classes within the group when possible
      const preferred = classes.filter((c) => prefer.includes(c))
      const ordered = [
        ...lruPickBatch(preferred.flatMap((c) => byClass[c] ?? []), carrierUsage),
        ...lruPickBatch(classes.filter((c) => !preferred.includes(c)).flatMap((c) => byClass[c] ?? []), carrierUsage),
      ]
      const nonSheer = ordered.filter((c) => !c.sheer_family || sheerBudgetLeft())
      const chosen = nonSheer[0] ?? ordered[0]
      if (chosen) {
        batchUse[chosen.id] = (batchUse[chosen.id] ?? 0) + 1
        if (chosen.sheer_family) {
          sheerInPrompt += 1
          frameIsSheer = true
        }
        out.push({
          id: chosen.id,
          name: chosen.name,
          cls: clsOfCarrier(chosen.id),
          deg: chosen.deg,
        })
      }
    }
    if (frameIsSheer) sheerFramesUsed += 1
    return out
  }

  function clsOfCarrier(id: string): string {
    // CR-W01 → W ; CR-B03 → B
    const m = /^CR-([A-Z])/.exec(id)
    return m ? m[1] : '?'
  }

  function assignTierCarriers(rating: 'R' | 'PG-13'): SlotPlan['carriers'] {
    const key = rating === 'R' ? 'R' : 'PG13'
    const recipe = recipes!.tiers[key]
    const prefer = recipe?.carrier_classes ?? ['S', 'E', 'W', 'B']
    const pool = lruPickBatch(prefer.flatMap((c) => byClass[c] ?? []), carrierUsage)
    return pool.slice(0, 3).map((c: Carrier) => {
      batchUse[c.id] = (batchUse[c.id] ?? 0) + 1
      return {
        id: c.id, name: c.name, cls: clsOfCarrier(c.id), deg: c.deg,
      }
    })
  }

  /* slot assembly */
  const slots: SlotPlan[] = []
  const leads = lruPick(LEAD_ZONES.map((id) => ({ id })), usage.leads, rng)
  const closers = lruPick(CLOSER_CLASSES.map((id) => ({ id })), usage.closers, rng)
  const witnesses = lruPick(WITNESS_TYPES.map((id) => ({ id })), usage.witnesses, rng)
  const registers: SlotPlan['register'][] = []
  const regPlan = ['student', 'young', 'milf'] as const
  // balanced registers: exact thirds of 24, no register > 50%
  for (let i = 0; i < LAWS.slotsTotal; i++) registers.push(regPlan[i % 3])
  const shuffledRegisters = rng.shuffle(registers)
  // racial cast: 10 of 21 MAINS (P04-P24) — race does physical work in frame
  const racialSlots = new Set(
    rng.shuffle([...Array(LAWS.mainsTotal).keys()].map((i) => i + 4)).slice(0, LAWS.racialDefault)
  )
  const exploratoryN = Math.max(0, Math.min(2, options.exploratory ?? 1))
  const exploratorySlots = new Set(
    rng.shuffle([...Array(LAWS.mainsTotal).keys()]).slice(0, exploratoryN).map((i) => i + 4)
  )

  let poseIdx = 0
  let paletteIdx = 0
  let kIdx = 0
  let raceIdx = 0
  let leadIdx = 0
  let closerIdx = 0
  let witnessIdx = 0

  /* Залп 2 «Рефлекс» (policy.channels): компилятор слушает стату смертей.
     oc-rplus dead (0/9) и не пиннут → OC-слоты получают R: бюджет 3 R+
     больше не хоронится заранее (аудит I-2). Реабилитация канала — только
     прицел автора (authorPin 'oc-rplus'), и тогда OC снова R+. */
  const ocRplusChannel = getDeliveryStats()?.channels.find((c) => c.id === 'oc-rplus')
  const ocRplusPinned = options.authorPin?.includes('oc-rplus') ?? false
  const ocRating: 'R+' | 'R' =
    ocRplusChannel?.status === 'dead' && !ocRplusPinned ? 'R' : 'R+'
  const ocPinnedChannels = (options.authorPin ?? []).filter((c) => !c.startsWith('engine:'))

  for (let pos = 1; pos <= LAWS.slotsTotal; pos++) {
    const lead = leads[leadIdx % leads.length].id
    leadIdx += 1
    const closer = closers[closerIdx % closers.length].id
    closerIdx += 1
    const register = shuffledRegisters[pos - 1]
    /* RENDER LAW v1.3.0 (вердикт T4-05, §9-септима POSE-RISK): R+/X
       получают только LOW/MID позы — HIGH × R+ = амплификатор мутаций
       (P04 дрейф · P22 мутация · P17 недолёт). R-слоты могут брать HIGH. */
    const pickPose = (rating: string) => {
      const calm = rating === 'R+' || rating === 'X'
      for (let i = 0; i < posePool.length; i++) {
        const cand = posePool[poseIdx++ % posePool.length]
        if (calm && cand.risk === 'HIGH') continue
        return cand
      }
      return posePool[poseIdx++ % posePool.length]
    }
    const palette = palettePool[paletteIdx++ % palettePool.length]

    if (pos <= 3) {
      const ocName = ocNames[pos - 1]
      const ocCarriers = ocRating === 'R+' ? assignCore4('R+', pos) : assignTierCarriers('R')
      const ocPose = pickPose(ocRating)
      slots.push({
        position: pos,
        kind: 'OC',
        oc: ocName,
        ocTheme: options.ocThemes?.[ocName]?.trim() || undefined,
        rating: ocRating,
        ...(ocRplusPinned ? { pinned: ['oc-rplus'] } : {}),
        pose: ocPose.id,
        poseName: ocPose.name,
        poseRisk: ocPose.risk,
        palette: palette.id,
        paletteName: palette.name,
        kinetics: [kPool[kIdx++ % kPool.length]?.id].filter(Boolean) as string[],
        carriers: ocCarriers,
        lead,
        register: ocName === 'Sue' ? 'milf' : register,
        closer,
      })
      continue
    }

    const main = orderedMains[pos - 4]
    const race = racialSlots.has(pos) ? racePool[raceIdx++ % racePool.length] : undefined
    const isNiche = main.kind === 'NICHE'
    const carriersList =
      main.rating === 'R+' || main.rating === 'X'
        ? assignCore4(main.rating, pos)
        : assignTierCarriers(main.rating)
    const mainPose = pickPose(main.rating)

    slots.push({
      position: pos,
      kind: main.kind,
      rating: main.rating,
      race: race?.name,
      raceFeature: race?.features?.[0],
      pose: mainPose.id,
      poseName: mainPose.name,
      poseRisk: mainPose.risk,
      palette: palette.id,
      paletteName: palette.name,
      kinetics: [kPool[kIdx++ % kPool.length]?.id].filter(Boolean) as string[],
      carriers: carriersList,
      lead,
      register,
      closer,
      witness: isNiche ? witnesses[witnessIdx++ % witnesses.length].id : undefined,
      exploratory: exploratorySlots.has(pos)
        ? 'EXPLORATORY slot — the law it probes is named in the batch worklog at delivery'
        : undefined,
    })
  }

  /* НИША-50 (вердикт автора): каждый NICHE-слот несёт ровно один архетип
     невозможного композиции — ротация без повторов в батче */
  {
    const pool = getNicheArchetypes()?.archetypes ?? []
    const nicheSlots = slots.filter((s) => s.kind === 'NICHE')
    if (pool.length > 0 && nicheSlots.length > 0) {
      rng
        .shuffle(pool.map((a) => a.id))
        .slice(0, nicheSlots.length)
        .forEach((id, i) => {
          nicheSlots[i].arch = id
        })
    }
  }

  const spreadMap: Record<string, number> = {}
  for (const s of slots) spreadMap[s.rating] = (spreadMap[s.rating] ?? 0) + 1

  /* Залп 3 «Мир» (policy.channels.rehab): добор каналов по вердикту автора
     («надо добрать, чтобы было сильно разнообразней») — R+ мейны получают
     targetChannel ротацией по rehab-списку; с abandons и verdicts статистика
     набирает n до порога. Реабилитация dead-каналов вне списка — только pin. */
  {
    const chPolicy = getPolicy().channels as {
      rehab_channels?: string[]
      rehab_quota_per_batch?: number
    }
    const rehab = chPolicy.rehab_channels ?? []
    const quota = Math.min(chPolicy.rehab_quota_per_batch ?? 0, rehab.length || 1)
    if (rehab.length > 0 && quota > 0) {
      /* Issue #4 Кенни: выбираем те же mulberry32-потоком, что и всё остальное —
         детерминировано по сиду и без позиционного смещения ранних слотов */
      rng
        .shuffle(slots.filter((s) => s.kind !== 'OC' && s.rating === 'R+'))
        .slice(0, quota)
        .forEach((s, i) => {
          s.targetChannel = rehab[i % rehab.length]
        })
    }
  }

  /* A/B-дисциплина (§10-поправка, рекомендация Claude №3): 2-3 пары R+-
     слотов на батч — СИСТЕМНО, а не случайно как P10. Пара = одна
     LEAD-зона (один канал доставки: зона заявки одна и та же), подача
     разная (поза/камера/палитра назначены разные). Вердикт приёмника
     атрибутирует канал, а не случайность. */
  const abPairs: { pair: string; a: number; b: number; lead: string }[] = []
  {
    const rplusAll = slots.filter((s) => s.rating === 'R+')
    const byLead = new Map<string, SlotPlan[]>()
    for (const s of rplusAll) {
      const list = byLead.get(s.lead) ?? []
      list.push(s)
      byLead.set(s.lead, list)
    }
    const pairNames = ['α', 'β', 'γ']
    const used = new Set<number>()
    // сперва пары среди мейнов (OC — как запас для третьей пары: OC R+ 0/3,
    // канал на OC-слоте тоже заслуживает атрибуции)
    for (const mainsFirst of [true, false]) {
      for (const [lead, list] of byLead) {
        if (abPairs.length >= LAWS.abPairsMax) break
        const free = list.filter(
          (s) => !used.has(s.position) && (mainsFirst ? s.kind !== 'OC' : true)
        )
        if (free.length >= 2) {
          const a = free[0]
          /* A/B одной переменной (policy.ab, аудит I-4): пара отличается
             ровно одной заменой носителя — предпочитаем b с минимальным
             diff стека по id; гейт ab-single-variable добивает нарушение */
          const stackDiff = (x: SlotPlan, y: SlotPlan): number => {
            const xi = new Set(x.carriers.map((c) => c.id))
            const yi = new Set(y.carriers.map((c) => c.id))
            let d = 0
            for (const id of xi) if (!yi.has(id)) d++
            for (const id of yi) if (!xi.has(id)) d++
            return d
          }
          const b = free.slice(1).sort((x, y) => stackDiff(a, x) - stackDiff(a, y))[0]
          const name = pairNames[abPairs.length]
          abPairs.push({ pair: name, a: a.position, b: b.position, lead })
          used.add(a.position)
          used.add(b.position)
        }
      }
      if (abPairs.length >= LAWS.abPairsMin) break
    }
    for (const p of abPairs) {
      const sa = slots.find((s) => s.position === p.a)
      const sb = slots.find((s) => s.position === p.b)
      if (sa) sa.ab = { pair: p.pair, half: 'A', withSlot: p.b, lead: p.lead }
      if (sb) sb.ab = { pair: p.pair, half: 'B', withSlot: p.a, lead: p.lead }
    }
  }

  /* batch-level carrier stats — the same numbers the diversity gate reads */
  const allAssigned = slots.flatMap((s) => s.carriers)
  const wShare = allAssigned.length
    ? Math.round((allAssigned.filter((c) => c.cls === 'W').length / allAssigned.length) * 100)
    : 0
  const sheerFrames = slots.filter((s) =>
    s.carriers.some((c) => {
      const carrier = allCarrierIds(carriers).find((x) => x.id === c.id)
      return carrier?.sheer_family === true
    })
  )
  const rplusSlots = slots.filter((s) => s.rating === 'R+')
  const sheerPct = rplusSlots.length
    ? Math.round((rplusSlots.filter((s) => sheerFrames.includes(s)).length / rplusSlots.length) * 100)
    : 0

  /* стата доставки: экспозиция каналов (внешний вердикт №3, Claude 2026-09-24).
     Поведение не меняет (§10: только вердикт автора меняет законы) — но
     контракт обязан показывать, какие заявки статистика считает мёртвыми. */
  const ds = getDeliveryStats()
  const dsChannels = ds?.channels ?? []
  const channelLive = dsChannels.filter((c) => c.status === 'live').map((c) => c.id)
  const channelCandidate = dsChannels.filter((c) => c.status === 'candidate').map((c) => c.id)
  const channelDead = dsChannels.filter((c) => c.status === 'dead').map((c) => c.id)
  const deadClaims: { zone: string; channel: string; evidence: string }[] = []
  /* Залп 2-консистентность: oc-rplus мёртв — но заявка существует, только если
     OC-слоты реально несут R+. Дауншифт (OC → R) сам и есть ответ рефлекса,
     dead-claim не дублирует его (иначе scribe.objection кричит ложную тревогу). */
  const ocStillRplus = slots.some((s) => s.kind === 'OC' && s.rating === 'R+')
  if (dsChannels.some((c) => c.id === 'oc-rplus' && c.status === 'dead') && ocStillRplus) {
    const oc = dsChannels.find((c) => c.id === 'oc-rplus')
    deadClaims.push({
      zone: 'P01-P03 OC R+',
      channel: 'oc-rplus',
      evidence: oc?.evidence?.join('; ') ?? '0/N по вердиктам',
    })
  }

  const contract: BatchContract = {
    slug,
    theme,
    engine: engineKey,
    engineLaw: engine.law,
    engineWhy: 'одноразовый движок: писец выведет физический закон ТЕМЫ на этапе спайна (3.2-традиция — движок под тему, утилизация после батча)',
    seed,
    createdAt: new Date().toISOString(),
    spread: Object.entries(spreadMap).map(([rating, count]) => ({ rating, count })),
    slots,
    ocRotation: ocNames.map((n) => ({ name: n, served: served(n) })),
    racialCount: slots.filter((s) => s.race).length,
    abPairs,
    ...(options.authorPin?.length ? { authorPin: options.authorPin } : {}),
    carrierStats: {
      wSharePct: wShare,
      sheerRplusPct: sheerPct,
      wCapPct: LAWS.wCapPct,
      sheerFrameCapPct: LAWS.sheerFrameCapPct,
    },
    windowSlugs: state.windowSlugs,
    channelStats: {
      version: ds?.version ?? '—',
      live: channelLive,
      candidate: channelCandidate,
      dead: channelDead,
      deadClaims,
    },
    platform: ((): Record<string, unknown> | undefined => {
      const f = getFacts()
      return f
        ? { platform: f.platform, economics: f.economics, proven: f.proven_facts, ph_behavior: f.ph_behavior }
        : undefined
    })(),
    laws: {
      core4: 'R+/X слоты: 4 носителя из 4 механо-групп (FABRIC/BODY/POSITION/PHYSICS), ≥4 классов',
      wCapPct: LAWS.wCapPct,
      sheerPerPrompt: LAWS.sheerPerPrompt,
      sheerFrameCapPct: LAWS.sheerFrameCapPct,
      poseDistinct: LAWS.poseDistinct,
      paletteDistinct: LAWS.paletteDistinct,
      posTarget: LAWS.posTarget,
      posHard: LAWS.posHard,
      hedgeBudget: LAWS.hedgeBudget,
      leadMax: LAWS.leadMax,
      registerCapPct: LAWS.registerCapPct,
      signalMin: JSON.stringify(LAWS.signalMin),
      rplusHardClaim: 'RENDER LAW v1.2.0 (рендер-вердикт T4-03: R 7/7, X 2/2, R+ 1/15): R+ несёт ≥1 РЕНДЕР-ДОКАЗАННУЮ заявку — visible pantyline / nipples through clothing / clothed nipples / see-through / taped nipples / topless with tape / handbra. cameltoe НЕ заявка (тег рендер-мёртв — 0 отрисовок). Сквозь-ткань заявка ТРЕБУЕТ состояния ткани (wet clothes / see-through) на ОДНОЙ тонкой светлой вещи, БЕЗ подслоя (bra/camisole/bandeau под sheer = рендерер рисует подслой, тир падает в R); мёртвые ткани (джинсы/деним/кожа/бархат/свитпаны/бриджи/костюм) заявку не несут',
      mechanismNeg: 'контр-NEG механизм-осознан: сквозь-ткань (pantyline/nipples through/see-through) держит «nipples exposed, naked breasts, topless»; on-skin (tape/handbra) — эти два ПОДНЯТЫ из NEG, иначе рендер закрывает грудь (вердикт T4-03); X — блок покрытия («covered breasts, bra, clothing on chest») заставляет рендерер взять тир (доказано 2/2)',
      layerClarity: '≤2 слоя одежды на зону; зона сигнала = LEAD-зона, несёт ≤1 слой + цель сигнала, открыта камере (без юбок/плащей/завязанных рубашек над pantyline, без застёгнутого верха над tape); OC-слоты — камера-смотрящие позы; ИМЕНА ОС В POS ЗАПРЕЩЕНЫ (приказ автора, T4-04) — только дескрипторы',
      faceLock: 'Her face is rendered in stylized 2D anime style: anime eyes ([color/state]), small nose, small mouth [state], [tone] skin.',
      posShape: 'POS = [тег-блок] → [проза] → [quality-теги] — PH-форма, проходит дословно',
      counters: 'экспозиция = сигнал-тег + контр-NEG (N31-рецепт); рейтинг зарабатывается тегами, не прозой',
      abDiscipline: 'A/B-дисциплина (§10-поправка): 2-3 пары R+-слотов на батч, пары по LEAD-зоне — заявка одна (тот же канал доставки), подача разная; вердикт приёмника атрибутирует канал (системно, а не случайно как P10)',
      salienceLaw: 'закон салиенса (§9-секста): PRESENT ≠ VISIBLE ≠ LEGIBLE; цепочка OBJECT → EXPOSURE → CAMERA → CONTRAST → SALIENCE → INTERPRETATION — провал звена роняет тир; свет на зоне заявки, не в декорациях (мокрая тёмная ткань без света = пятно; светлое на светлом = слияние)',
      underlayerLock: 'noun-lock (§10-поправка): сквозь-ткань заявка лочится на именованную тонкую светлую вещь; подслой лочится в NEG (bra/camisole/bandeau/undershirt) — тишина по подслою = дыра, рендерер дорисует его сам',
    },
  }

  if (!options.dryRun) {
    writeJson(path.join(CONTRACTS_DIR, `${slug}.json`), contract)
    writeText(path.join(CONTRACTS_DIR, `${slug}.md`), contractMarkdown(contract))
    appendEvent(
      'batch.compiled',
      `${slug} «${theme}» — контракт ${slugOverride ? 'ПЕРЕкомпилирован (закон 24 слотов) · ' : ''}скомпилирован (движок ${engineKey}, мейны ${mainsSpreadText(contract)})`,
      { slug, theme, engine: engineKey, seed, recompile: Boolean(slugOverride) }
    )
    if (options.authorPin?.length) {
      appendEvent(
        'author.pinned',
        `${slug}: прицел автора — [${options.authorPin.join(', ')}] назначены вопреки статистике, помечены pinned (защита рефлекса: прицел не смешивается с данными)`,
        { slug, channels: options.authorPin, pinned: true }
      )
    }
    // oc.appeared НЕ пишется при сборке: рекурсивные перекомпиляции засоряли
    // бы ротацию. Ростер финален только при сдаче — deliverBatch записывает.
  }

  return contract
}

/** Мейн-спред слотами (без OC): «R+×12 · R×7 · X×2». */
export function mainsSpreadText(c: BatchContract): string {
  const m: Record<string, number> = {}
  for (const s of c.slots) {
    if (s.kind === 'OC') continue
    m[s.rating] = (m[s.rating] ?? 0) + 1
  }
  return Object.entries(m).map(([rating, count]) => `${rating}×${count}`).join(' · ')
}

/* ------------------------------------------------------------------ */
/* Contract markdown (the exposition)                                  */
/* ------------------------------------------------------------------ */

export function contractMarkdown(c: BatchContract): string {
  const lines: string[] = []
  lines.push(`# ${c.slug} «${c.theme}» — КОНТРАКТ`)
  lines.push('')
  lines.push(`**Скомпилировано**: ${c.createdAt.slice(0, 10)} · сид ${c.seed} · окно ротации: ${c.windowSlugs.length ? c.windowSlugs.join(' + ') : 'чистый лист'}`)
  lines.push('')
  lines.push('## Экспозиция — как и что решено')
  lines.push('')
  lines.push(`**Движок**: \`${c.engine}\` — ${c.engineLaw}`)
  lines.push('')
  lines.push(c.engineWhy)
  lines.push('')

  /* НИША-50: раскладка архетипов по слотам — писец драфтирует DEVICE, автор правит */
  const archSlots = c.slots.filter((s) => s.arch)
  if (archSlots.length > 0) {
    lines.push(
      `**НИША-ARCH** (пул 50, вердикт автора): ${archSlots
        .map((s) => `P${String(s.position).padStart(2, '0')} → ${s.arch}`)
        .join(', ')} — каждый слот открывает THESIS строкой «ARCH: <id> · DEVICE: <невозможное устройство кадра>».`
    )
    lines.push('')
  }

  /* Залп 3 «Мир»: платформа как элемент модели — планируем с потерями */
  if (c.platform) {
    const pf = c.platform as {
      platform?: { gallery?: string; renderer?: string; content_filter?: { codes?: string[] } }
      proven?: { id: string; fact: string; n?: number }[]
    }
    const p = pf.platform ?? {}
    const cf = p.content_filter ?? {}
    const stoch = (pf.proven ?? []).find((f) => f.id === 'stochastic-reroll')
    lines.push(
      `**Мир**: ${p.gallery ?? '—'} ← ${p.renderer ?? '—'} · фильтр [${(cf.codes ?? []).join(', ')}] душит X (проверка судьбы) · стохастика рероллов n=${stoch?.n ?? '—'} — планируем с потерями (specs/facts.json)`
    )
    lines.push('')
  }

  /* Залп 3: rehab-добор каналов — вердикт приёмника кормит статистику */
  const rehabTargets = c.slots.filter((s) => s.targetChannel)
  if (rehabTargets.length > 0) {
    lines.push(
      `**REHAB-добор** (policy.channels.rehab): ${rehabTargets
        .map((s) => `P${String(s.position).padStart(2, '0')} → ${s.targetChannel}`)
        .join(', ')} — слоты пытаются оживить каналы, добор до n=15.`
    )
    lines.push('')
  }
  /* спред OC-слотов из контракта (дауншифт делает их R — строка честная) */
  const ocSpread = (() => {
    const m: Record<string, number> = {}
    for (const s of c.slots.filter((x) => x.kind === 'OC')) m[s.rating] = (m[s.rating] ?? 0) + 1
    return Object.entries(m).map(([r, n]) => `${r}×${n}`).join(' + ') || '—'
  })()
  lines.push(`**Спред рейтингов (мейны P04-P24)**: ${mainsSpreadText(c)} + OC ${ocSpread} = ${c.slots.length} промпта — NICHE-слоты зарабатывают R эротической позой (честный тег), VOLT несёт R+ по рецептуре (сигнал-теги + контр-NEG), X — 2 слота (Yadayo душит алгоритмически, это art-for-art).`)
  lines.push('')
  lines.push(`**Жанры — как читать план** (вердикт T4-02: ниша/волт должны быть видны): **OC** — канон-локи персонажа, его тема в слоте; **NICHE** — невозможный образ: раса/природа делает ФИЗИЧЕСКУЮ работу в кадре (механизм, не костюм), свидетель держит кадр, невозможное — первое считывание силуэта; **VOLT** — плоть: камера-участник, тело в движении, взгляд-вектор, экспозиция тегом; **EXQUISITE** — ультра своего жанра. Жанр пишется в шапку КАЖДОГО промпта — это структурный идентификатор, гейтится.`)
  lines.push('')
  lines.push(`**Ротация OC**: ${c.ocRotation.map((o) => `${o.name} (было ${o.served})`).join(', ')} — по longest-rested.`)
  lines.push('')
  if ((c.abPairs ?? []).length > 0) {
    lines.push(`**A/B-дисциплина (§10-поправка)**: ${c.abPairs.map((p) => `пара ${p.pair} = P${String(p.a).padStart(2, '0')} × P${String(p.b).padStart(2, '0')} (LEAD ${p.lead})`).join(' · ')} — один канал доставки (заявка одна и та же), подача разная; вердикт приёмника атрибутирует канал, а не случай (системно, а не как P10).`)
    lines.push('')
  }
  const themed = c.slots.filter((s) => s.oc && s.ocTheme)
  if (themed.length > 0) {
    lines.push(`**Темы OC (заказ автора)**: ${themed.map((s) => `${s.oc} — ${s.ocTheme}`).join(' · ')}`)
    lines.push('')
  }
  lines.push(`**Расовый каст**: ${c.racialCount}/${LAWS.mainsTotal} мейнов — раса делает физическую работу в кадре (механизм, не костюм).`)
  lines.push('')
  const cs = c.channelStats
  if (cs && cs.version !== '—') {
    lines.push(`**Каналы доставки (delivery-stats ${cs.version})**: live — ${cs.live.join(', ') || '—'}; candidate (n<3, доверия меньше) — ${cs.candidate.join(', ') || '—'}; dead — ${cs.dead.join(', ') || '—'}.`)
    for (const dc of cs.deadClaims) {
      lines.push(`  ⚠ dead-канал в контракте: ${dc.zone} (${dc.channel}) — ${dc.evidence}. Заявка законна по скелету 24 слотов, но статистика доставок её не подтверждает.`)
    }
    lines.push('')
  }
  lines.push('**Диверсия назначена до письма** (ядро §3): носители, позы, палитры, K, LEAD-зоны, клоузеры, регистры зрелости, свидетели — всё разложено по слотам ниже. Писец пишет ПРОТИВ этого плана; гейты проверяют те же числа, что здесь напечатаны.')
  lines.push('')
  lines.push('## Слот-план (24: P01-P03 OC · P04-P24 мейны)')
  lines.push('')
  lines.push('| P | Жанр | Рейтинг | OC/раса | Поза | Палитра | K | Носители | LEAD | Регистр | Клоузер |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of c.slots) {
    const who = s.oc ?? s.race ?? '—'
    const abMark = s.ab ? ` · ${s.ab.half}/${s.ab.pair}` : ''
    lines.push(
      `| P${String(s.position).padStart(2, '0')} | ${s.kind}${s.exploratory ? ' ⚗' : ''}${abMark} | ${s.rating} | ${who} | ${s.pose} ${s.poseName} (${s.poseRisk}) | ${s.palette} | ${s.kinetics.join(',') || '—'} | ${s.carriers.map((x) => x.id).join(' + ') || '—'} | ${s.lead} | ${s.register} | ${s.closer} |`
    )
  }
  lines.push('')
  if (c.slots.some((s) => s.exploratory)) {
    lines.push(`⚗ — EXPLORATORY-слоты (конституция §10): легализованные эксперименты против нежёстких законов. Что именно щупаем — фиксируется в ворклоге батча при сдаче.`)
    lines.push('')
  }
  lines.push('## Законы письма (числа гейтов — те же константы)')
  lines.push('')
  lines.push(`- **структура**: ${LAWS.slotsTotal} промпта = ${LAWS.ocSlots} OC (P01-P03) + ${LAWS.mainsTotal} мейн (P04-P24); жанр — в шапке каждого промпта (вердикт T4-02)`)
  for (const [k, v] of Object.entries(c.laws)) {
    lines.push(`- **${k}**: ${v}`)
  }
  lines.push('')
  lines.push('## Вечные флооры (§8 — не расслабляются никогда)')
  lines.push('')
  lines.push('- Генитальный лок в NEG каждого промпта; XXX никогда.')
  lines.push('- Анти-лоли флоор в NEG (child/chibi/young girl/immature body/oversized head).')
  lines.push('- Канон-локи OC; лика-гард (signature/watermark/artist/logo).')
  lines.push('- Свечной гарда (candle/lamp/lantern/torch/chandelier/brazier) — кроме случаев, когда концепт зовёт.')
  lines.push('- Регистры зрелости — только нарративом, НИКОГДА тегами (`adult woman`/`mature female` в POS = батчевый MILF-перекос, N30-квиток).')
  lines.push('')
  lines.push('## Ловушки (оплаченные грабли 3.2 + N30/N31)')
  lines.push('')
  lines.push('- **T1**: заявленный рейтинг без сигнал-тегов рецепта → гейт честно скажет PG-13. Проза не заменяет теги.')
  lines.push('- **T2**: verb-led носители — PH съедает; существительное несёт клейм, глагол может быть скучным.')
  lines.push('- **T3**: под-бретелька наружу из закрытой одежды — если лямка выходит, маршрут назван (off-shoulder/scoop/…).')
  lines.push('- **T4**: standing-lineup — позы назначены, не менять на нейтральные.')
  lines.push('- **T5**: theme-opacity — мировой закон должен быть первым считыванием силуэта, без прозы.')
  lines.push('- **T6**: моно-носитель (N28) — sheer ≤2/промпт; W ≤45%; ядро core-4.')
  lines.push('- **T7**: фейс-лок — точно в форме N31 (anime eyes, без large/expressive, без cel-shaded).')
  lines.push('- **T8**: лики PH (artist/character токены) — гарда в NEG.')
  lines.push('- **T9**: хеджи ≤2; бюджет 300/400 — плотность, не лепёшка.')
  lines.push('- **T10**: дубли-close (N25: 18/21 триплетов) — клоузеры назначены, вертеть.')
  lines.push('- **T11** (вердикт T4-02, штурвал): сложный проп (wheel/лестница/перила/канат) ломает геометрию рендера — каждая контактная конечность названа (руки на…, ноги в…), ≥2 якоря; лучше один контактный проп, чем три.')
  lines.push('- **T12** (вердикт T4-02): жанр виден — NICHE первым считыванием (раса работает), VOLT — плоть; если автор не понял, где ниша, — её нет.')
  lines.push('- **T13** (вердикт T4-03 + рендер-вердикт: R+ 1/15): R+ = ДЕЛО в кадре — РЕНДЕР-ДОКАЗАННАЯ заявка (pantyline / nipples through / see-through / tape) на тонкой светлой вещи с состоянием ткани (wet/sheer), без подслоя; cameltoe — только флэйвор, заявку не зарабатывает.')
  lines.push('- **T14** (вердикт T4-03, «чулки сквозь джинсы, майка поверх рубашки»): слоевой хаос — ≥3 верхних слоя или ≥5 предметов путают порядок; зона сигнала ≤1 слой.')
  lines.push('- **T15** (приказ автора, T4-04): имена ОС никогда не входят в POS — ни тегом, ни прозой; имена триггерят чужих персонажей у рендерера. Только дескрипторы.')
  lines.push('- **T16** (§9-секста, закон салиенса): PRESENT ≠ VISIBLE ≠ LEGIBLE — тег в POS ≠ сигнал в кадре; цепочка OBJECT → EXPOSURE → CAMERA → CONTRAST → SALIENCE → INTERPRETATION, провал звена роняет тир (мокрая тёмная ткань без света = пятно, T4-04 P05; светлое на светлом = слияние, T4-04 P03). Анти-тиран: подавай сигнал светом на зоне заявки, не декорациями.')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Производство — как пустить сборку в дело')
  lines.push('')
  lines.push('Контракт готов. Два пути производства:')
  lines.push('')
  lines.push(`> **«Super Z, произведи ${c.slug}»** — писец в чате: пишет ${LAWS.slotsTotal} промпта против контракта, самопроверка, сдача с ворклогом.`)
  lines.push('')
  lines.push(`> **«Писец» в дашборде** — авто-писец: машина пишет черновик по контракту (те же законы), гейты гоняют его автоматически; финальная полировка и сдача — как обычно.`)
  lines.push('')
  lines.push('Темы ОС, если нужны свои, дописываются в приказ: «произведи ' + c.slug + ', темы ОС: Lyn — …, Sue — …»; пусто = писец выводит темы из темы батча и движка. Батч и квитанции гейтов появятся во вкладке «Батчи».')
  lines.push('')
  lines.push('*Контракт — единственный документ писца. Право (конституция) и спеки — фон; всё, что нужно для чистого первого прогона, — выше.*')
  return lines.join('\n')
}

/* Silence unused import warnings for types used only in signatures. */
export type { T4Event }
