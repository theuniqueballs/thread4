/**
 * WRITE-BRIDGE — фаза 2 (движковая эра), итерация 2.
 *
 * Детерминированный адаптер: план живого движка (plan_json — payload
 * t4_batches twin'а, отдаётся RPC /v1/batches/:slug и
 * /v1/scratch/batches/:slug) → богатый контракт писца (BatchContract
 * файл-эры, contracts/T4-NN.json).
 *
 * ЗАЧЕМ (сирота WRITE-моста, ворклог фазы 1): писец и текстовые гейты
 * едят БОГАТЫЙ контракт (позы, стеки, лиды, расы, OC-имена, EXP-программа),
 * а движковая эра компилирует ПЛАН-СКЕЛЕТ (жанр/рейтинг/палитра/A-B/OC-темы).
 * Rich-компилятор файл-эры (compileBatch) скелет ПЕРЕсобирает — его нельзя
 * пускать на движковый план: он нарушит волю автора, уже заквитанцеванную
 * движком (structure/exp-purity/floors/window/ab-single-variable PASS).
 *
 * ДОКТРИНА АДАПТЕРА:
 *  — Скелет движка НЕ ТРОНУТ 1-в-1: жанры (MAIN→VOLT — жанровый словарь
 *    файл-эры, gates.ts GENRES), рейтинги, палитры, OC-темы, A/B-пары,
 *    состав слотов — зеркалируются, не пересобираются.
 *  — Обогащение детерминировано: сид = hash(slug::sha10); один RNG-поток,
 *    та же механика LRU/ротаций, что у compileBatch (позы без PL01 + риск-
 *    закон R+/X, core-4/tier-стеки с sheer-бюджетом и батч-дедупом,
 *    лид-цикл с ASS-квотой, клоузеры, witness/arch для NICHE, расовый каст,
 *    кинетика, variety-пакет, реабилитация каналов).
 *  — OC-имена: ротация канона с кулдауном окна и каскадом несданных —
 *    та же дисциплина compileBatch; темы ОС — из плана.
 *  — EXP-программа: буквы продолжают греческий ряд по живым контрактам;
 *    гипотезы — детерминированные заглушки под редактуру автора (мост не
 *    придумывает закон — он оставляет слот болванкой и говорит об этом).
 *  — A/B-пары: лид-зона общая (гейт ab-single-variable), стек B = стек A
 *    с ровно одной детерминированной заменой носителя (дифф 2 ≤ 2).
 *
 * Состояние (окно, OC-счётчики, каскад) приходит АРГУМЕНТОМ — ядро чистое,
 * самотест гоняет его без диска. Событие bridge.compiled (квитанция
 * «источник плана — живой движок») пишет ВЫЗЫВАЮЩИЙ (API-маршрут), не ядро.
 */
import type { BatchContract, SlotPlan } from './compiler'
import {
  CLOSER_CLASSES,
  LEAD_ZONES,
  WITNESS_TYPES,
  cameraForLead,
  foldWindowUsage,
  hashSeed,
  LAWS,
  lruPick,
  makeRng,
  registerFromBody,
} from './compiler'
import {
  allCarrierIds,
  getCarriers,
  getDeliveryStats,
  getFacts,
  getNicheArchetypes,
  getOCCanon,
  getPalettes,
  getPools,
  getPolicy,
  getPoses,
  getRaces,
  getRatingRecipes,
  type Carrier,
} from './specs'
import { proposeBatchVariety } from './variety-engine'

/* ------------------------------------------------------------------ */
/* Формы входа: план движка (как его отдаёт RPC twin'а)                 */
/* ------------------------------------------------------------------ */

export interface EnginePlanSlot {
  position: number
  kind: string
  rating: string
  register: string
  ocTheme?: string
  race?: string
  paletteId: string
  exp?: { letter?: string; half?: string; pairWith?: number; hypothesis?: string }
  ab?: { pair: number | string; half: string }
}

export interface EnginePlan {
  slug: string
  title?: string
  theme?: string
  engine?: string
  seed?: string | number
  slots: EnginePlanSlot[]
  exp?: number
  abPairs?: number
  paletteWindow?: { union?: number; budget?: number; extensionFree?: number }
  receipts?: { gate: string; level: string; verdict: string }[]
  diff?: { up?: number; down?: number; against?: string }
  sha10?: string
  createdAt?: string
}

export interface BridgeStateInput {
  batches: { slug: string; deliveredAt: string | null }[]
  windowSlugs: string[]
  ocAppearances: Record<string, number>
  ocLastSeen: Record<string, string>
  voidedSlugs: string[]
}

export interface BridgeOptions {
  slug: string
  state: BridgeStateInput
  /** Ростер последней несданной компиляции (lastCompiledRoster) — каскад. */
  cascade?: { slug: string; ocs: string[] } | null
  /** Буквы EXP уже использованных контрактов — продолжение ряда α-ω. */
  usedExpLetters?: string[]
  /** Инъекция часов (детерминизм самотеста); по умолчанию — сейчас. */
  now?: string
}

export interface BridgeResult {
  contract: BatchContract
  bridgeNote: string
}

const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω'
const AB_PAIR_NAMES = ['α', 'β', 'γ', 'δ', 'ε']

/** Жанр контракта из жанра плана: MAIN — движковый синоним тематического
 *  мейна (VOLT); NICHE/OC/EXP живут в обоих словарях без перевода. */
export function genreOfPlan(kind: string): string {
  if (kind === 'MAIN') return 'VOLT'
  return kind
}

/** Индекс следующей буквы EXP-ряда по уже использованным (α-ω, цикл). */
export function nextExpLetterIndex(used: string[]): number {
  let max = -1
  for (const l of used) {
    const i = GREEK.indexOf(l)
    if (i > max) max = i
  }
  return max + 1
}

/** Буквы EXP из живых контрактов (сканирует contracts/*.json — вызывавший
 *  отдаёт список, чтобы ядро оставалось чистым). */
export function usedExpLettersOfContracts(
  contracts: { slots?: { exp?: { letter?: string } }[] }[]
): string[] {
  const out: string[] = []
  for (const c of contracts) {
    for (const s of c.slots ?? []) {
      if (s.exp?.letter) out.push(s.exp.letter)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Ядро                                                                */
/* ------------------------------------------------------------------ */

export function planToContract(plan: EnginePlan, opts: BridgeOptions): BridgeResult {
  const slug = opts.slug
  if (!/^(T4-\d{2,3})(?:[-.][A-Za-z0-9.]+)?$/.test(slug)) {
    throw new Error(`write-bridge: слаг «${slug}» не канонический (T4-NN)`)
  }
  if (plan.slug !== slug) {
    throw new Error(`write-bridge: слаг плана ${plan.slug} ≠ заказанному ${slug}`)
  }
  const slots = [...plan.slots].sort((a, b) => a.position - b.position)
  if (slots.length === 0) throw new Error(`write-bridge: план ${slug} без слотов`)

  /* --- спеки --- */
  const carriers = getCarriers()
  const poses = getPoses()
  const palettes = getPalettes()
  const ocCanon = getOCCanon()
  const races = getRaces()
  const recipes = getRatingRecipes()
  if (!carriers || !poses || !palettes || !ocCanon || !races || !recipes) {
    throw new Error('write-bridge: спеки не загружены — импорт пулов не выполнялся')
  }
  const paletteById = new Map(palettes.palettes.map((p) => [p.id, p]))
  /* Движок ссылается на палитры КОРОТКИМИ НОМЕРАМИ (pid(n) = «P089»), спек
   * файл-эры — полными id («P89_THRESHOLD_GOLD»). Фонд один — 120 палитр;
   * мост резолвит номер по цифровому префиксу, контракт несёт ПОЛНЫЙ id
   * (окно ротации и contract-fidelity сверяют полные id по шапкам батча). */
  const paletteByNum = new Map<number, (typeof palettes.palettes)[number]>()
  for (const p of palettes.palettes) {
    const m = /^P(\d{1,3})_/.exec(p.id)
    if (m) paletteByNum.set(parseInt(m[1], 10), p)
  }
  const resolvePalette = (planId: string): (typeof palettes.palettes)[number] | null => {
    const full = paletteById.get(planId)
    if (full) return full
    const num = /^P0*(\d{1,3})$/.exec(planId)
    if (num) return paletteByNum.get(parseInt(num[1], 10)) ?? null
    return null
  }
  for (const s of slots) {
    if (!resolvePalette(s.paletteId)) {
      throw new Error(
        `write-bridge: P${String(s.position).padStart(2, '0')} — палитра ${s.paletteId} не резолвится в фонд спеков (120 номеров; план движка ссылается на чужой номер?)`
      )
    }
  }

  /* --- сид и единый RNG-поток (детерминизм от плана, не от часов) --- */
  const seed = hashSeed(`${slug}::${plan.sha10 ?? String(plan.seed ?? '')}`)
  const rng = makeRng(seed)

  /* --- окно ротации --- */
  const { usage, opaque: windowOpaque } = foldWindowUsage(opts.state.windowSlugs)

  /* --- pools --- */
  const posePool = lruPick(
    poses.poses.filter((p) => p.id !== 'PL01'),
    usage.poses,
    rng
  )
  const poolsK: { id: string; name?: string }[] =
    (getPools()?.sections?.kinetics_k as { id: string; name?: string }[] | undefined) ?? []
  const kPool = lruPick(poolsK, usage.kinetics, rng)
  const racePool = lruPick(
    races.races.filter(
      (r) =>
        (r.status === 'active' || r.status === 'gold') &&
        r.name.toLowerCase() !== 'human'
    ),
    usage.races,
    rng
  )

  /* --- OC-имена: ротация с кулдауном окна и каскадом несданных --- */
  const ocSlotCount = slots.filter((s) => s.kind === 'OC').length
  const activeOcs = Object.entries(ocCanon.ocs)
    .filter(([, o]) => (o.active ?? true) !== false)
    .map(([name]) => name)
  const served = (n: string) => opts.state.ocAppearances[n] ?? 0
  const lastSeenIn = (n: string) => opts.state.ocLastSeen[n] ?? ''
  const windowTail = (n: number): string[] =>
    opts.state.windowSlugs.slice(-Math.max(1, n)).filter(Boolean)
  const cascade = opts.cascade?.ocs ?? []
  const coolPool = activeOcs.filter(
    (n) => !windowTail(3).includes(lastSeenIn(n)) && !cascade.includes(n)
  )
  const fallbackPool = activeOcs.filter((n) => !cascade.includes(n))
  const rotationSource = coolPool.length >= ocSlotCount ? coolPool : fallbackPool
  const rotationPool = rng.shuffle(rotationSource).sort((a, b) => served(a) - served(b))
  const ocNames = rotationPool.slice(0, ocSlotCount)
  if (ocNames.length < ocSlotCount) {
    throw new Error(
      `write-bridge: активных ОС в каноне ${ocNames.length}, плану нужно ${ocSlotCount}`
    )
  }

  /* --- носители: core-4 / tier с sheer-бюджетом и батч-дедупом --- */
  const byClass = carriers.classes
  const groupOf = (cls: string) => carriers.class_defs[cls]?.mech ?? ''
  const carrierUsage = usage.carriers
  const batchUse: Record<string, number> = {}
  const lruPickBatch = <T extends { id: string }>(
    poolArr: T[],
    usageMap: Record<string, number>
  ): T[] =>
    rng.shuffle(poolArr).sort(
      (a, b) =>
        (usageMap[a.id] ?? 0) + (batchUse[a.id] ?? 0) * 50 -
        ((usageMap[b.id] ?? 0) + (batchUse[b.id] ?? 0) * 50)
    )
  const clsOfCarrier = (id: string): string => /^CR-([A-Z])/.exec(id)?.[1] ?? '?'
  const rplusTotal = slots.filter((s) => s.rating === 'R+').length
  const maxSheerFrames = Math.floor((rplusTotal * LAWS.sheerFrameCapPct) / 100)
  let sheerFramesUsed = 0

  interface StackCarrier {
    id: string
    name: string
    cls: string
    deg: string
  }

  function assignCore4(rating: 'R+' | 'X'): StackCarrier[] {
    const groupsNeeded = ['FABRIC', 'BODY', 'POSITION', 'PHYSICS'] as const
    const recipe = recipes.tiers[rating === 'R+' ? 'RPLUS' : 'X']
    const prefer = recipe?.carrier_classes ?? []
    const out: StackCarrier[] = []
    let sheerInPrompt = 0
    let frameIsSheer = false
    const sheerBudgetLeft = () =>
      sheerInPrompt < LAWS.sheerPerPrompt && sheerFramesUsed < maxSheerFrames
    for (const g of groupsNeeded) {
      const classes = Object.keys(byClass).filter((c) => groupOf(c) === g)
      const preferred = classes.filter((c) => prefer.includes(c))
      const ordered = [
        ...lruPickBatch(preferred.flatMap((c) => byClass[c] ?? []), carrierUsage),
        ...lruPickBatch(
          classes.filter((c) => !preferred.includes(c)).flatMap((c) => byClass[c] ?? []),
          carrierUsage
        ),
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

  function assignTierCarriers(rating: 'R' | 'PG-13'): StackCarrier[] {
    const recipe = recipes.tiers[rating === 'R' ? 'R' : 'PG13']
    const prefer = recipe?.carrier_classes ?? ['S', 'E', 'W', 'B']
    const tierPool = lruPickBatch(
      prefer.flatMap((c) => byClass[c] ?? []),
      carrierUsage
    )
    return tierPool.slice(0, 3).map((c: Carrier) => {
      batchUse[c.id] = (batchUse[c.id] ?? 0) + 1
      return { id: c.id, name: c.name, cls: clsOfCarrier(c.id), deg: c.deg }
    })
  }

  /* --- A/B-пары плана: числовой id → канонное имя, лид общий --- */
  const abByPos = new Map<number, { pair: number | string; half: string }>()
  for (const s of slots) if (s.ab) abByPos.set(s.position, s.ab)
  const pairIds = [...new Set([...abByPos.values()].map((v) => String(v.pair)))]
  const pairNameOf = new Map(pairIds.map((id, i) => [id, AB_PAIR_NAMES[i] ?? `pair-${id}`]))

  /* --- EXP-программа: буквы продолжают ряд живых контрактов --- */
  let letterIdx = nextExpLetterIndex(opts.usedExpLetters ?? [])

  /* --- расовый каст: позиции детерминированы сидом --- */
  const nonOcPositions = slots.filter((s) => s.kind !== 'OC').map((s) => s.position)
  const racialCountTarget = Math.min(
    LAWS.racialDefault,
    Math.max(0, Math.floor(nonOcPositions.length / 2))
  )
  const racialPositions = new Set(
    rng.shuffle(nonOcPositions).slice(0, racialCountTarget)
  )

  /* --- циклы лидов (ASS-квота ×2) и клоузеров --- */
  const leads = lruPick(LEAD_ZONES.map((id) => ({ id })), usage.leads, rng)
  const ASS_FAMILY = new Set(['seat', 'cheeks', 'hamstrings'])
  const leadCycle = [...leads, ...leads.filter((l) => ASS_FAMILY.has(l.id))]
  const closers = lruPick(CLOSER_CLASSES.map((id) => ({ id })), usage.closers, rng)
  const witnesses = lruPick(WITNESS_TYPES.map((id) => ({ id })), usage.witnesses, rng)

  let poseIdx = 0
  let kIdx = 0
  let raceIdx = 0
  let leadIdx = 0
  let closerIdx = 0
  let witnessIdx = 0
  let ocIdx = 0
  const leadByPos = new Map<number, string>()
  const pickPose = (rating: string): { id: string; name: string; risk: string } => {
    const calm = rating === 'R+' || rating === 'X'
    for (let i = 0; i < posePool.length; i++) {
      const cand = posePool[poseIdx++ % posePool.length]
      if (calm && cand.risk === 'HIGH') continue
      return cand
    }
    return posePool[poseIdx++ % posePool.length]
  }

  const out: SlotPlan[] = []
  for (const s of slots) {
    const pos = s.position
    /* лид: A/B-пара делит зону — половина B берёт лид уже назначенной A */
    const partnerPos = s.ab
      ? [...abByPos.entries()].find(
          ([p, v]) => p !== pos && String(v.pair) === String(s.ab!.pair)
        )?.[0]
      : undefined
    let lead: string
    if (partnerPos != null && leadByPos.has(partnerPos)) {
      lead = leadByPos.get(partnerPos) as string
    } else {
      lead = leadCycle[leadIdx % leadCycle.length].id
      leadIdx += 1
    }
    leadByPos.set(pos, lead)
    const closer = closers[closerIdx % closers.length].id
    closerIdx += 1
    const palette = resolvePalette(s.paletteId)
    if (!palette) throw new Error(`write-bridge: палитра ${s.paletteId} исчезла`) // проверено выше
    const pose = pickPose(s.rating)

    let slot: SlotPlan
    if (s.kind === 'OC') {
      const ocName = ocNames[ocIdx++]
      const ocData = ocCanon.ocs[ocName]
      const ocBodyType =
        typeof ocData?.body_type === 'string' && ocData.body_type.trim() !== ''
          ? ocData.body_type.trim()
          : undefined
      slot = {
        position: pos,
        kind: 'OC',
        oc: ocName,
        ocTheme: s.ocTheme,
        rating: s.rating as SlotPlan['rating'],
        pose: pose.id,
        poseName: pose.name,
        poseRisk: pose.risk,
        palette: palette.id,
        paletteName: palette.name,
        kinetics: [kPool[kIdx++ % kPool.length]?.id].filter(Boolean) as string[],
        carriers:
          s.rating === 'R+' || s.rating === 'X'
            ? assignCore4('R+')
            : assignTierCarriers(s.rating === 'R' ? 'R' : 'PG-13'),
        lead,
        register: registerFromBody(ocBodyType, 'young'),
        closer,
        ...(ocBodyType ? { bodyType: ocBodyType } : {}),
      }
    } else {
      const race = racialPositions.has(pos)
        ? racePool[raceIdx++ % racePool.length]
        : undefined
      const kind = genreOfPlan(s.kind) as SlotPlan['kind']
      slot = {
        position: pos,
        kind,
        rating: s.rating as SlotPlan['rating'],
        ...(race ? { race: race.name, raceFeature: race.features?.[0] } : {}),
        pose: pose.id,
        poseName: pose.name,
        poseRisk: pose.risk,
        palette: palette.id,
        paletteName: palette.name,
        kinetics: [kPool[kIdx++ % kPool.length]?.id].filter(Boolean) as string[],
        carriers:
          s.rating === 'R+' || s.rating === 'X'
            ? assignCore4(s.rating === 'X' ? 'X' : 'R+')
            : assignTierCarriers(s.rating === 'R' ? 'R' : 'PG-13'),
        lead,
        register: s.register as SlotPlan['register'],
        closer,
        witness:
          s.kind === 'NICHE' ? witnesses[witnessIdx++ % witnesses.length].id : undefined,
      }
    }

    /* EXP-болванка: буква ряда, половина/пара — из плана, гипотеза-заглушка */
    if (s.kind === 'EXP') {
      const letter = GREEK[letterIdx % GREEK.length] ?? 'α'
      letterIdx += 1
      slot.exp = {
        hypothesis: `Проба ${letter}: канал «${lead}» на ${s.rating}-кадре — одна переменная, план identical (мост-заглушка: уточни гипотезу перед писцом)`,
        letter,
      }
      if (s.ab) {
        slot.exp.half = (s.ab.half === 'B' ? 'B' : 'A') as 'A' | 'B'
        if (partnerPos != null) slot.exp.pairWith = partnerPos
      }
    }

    /* A/B-пара (§10): план даёт пары — контракт даёт имена и кросс-ссылки */
    if (s.ab) {
      const name = pairNameOf.get(String(s.ab.pair)) ?? 'α'
      slot.ab = {
        pair: name,
        half: (s.ab.half === 'B' ? 'B' : 'A') as 'A' | 'B',
        withSlot: partnerPos ?? pos,
        lead,
      }
    }

    out.push(slot)
  }

  /* --- НИША-50: архетип на каждый NICHE-слот, ротация без повторов --- */
  {
    const archPool = getNicheArchetypes()?.archetypes ?? []
    const nicheSlots = out.filter((s) => s.kind === 'NICHE')
    if (archPool.length > 0 && nicheSlots.length > 0) {
      rng
        .shuffle(archPool.map((a) => a.id))
        .slice(0, nicheSlots.length)
        .forEach((id, i) => {
          nicheSlots[i].arch = id
        })
    }
  }

  /* --- A/B: стек половины B = стек A с ровно одной заменой носителя ---
   *  (дифф стеков ровно 2 — гейт ab-single-variable требует ≤ 2) --- */
  const abPairs: { pair: string; a: number; b: number; lead: string }[] = []
  for (const s of out) {
    if (!s.ab || s.ab.half !== 'A') continue
    const b = out.find((x) => x.ab?.pair === s.ab?.pair && x.ab?.half === 'B')
    if (!b) continue
    abPairs.push({ pair: s.ab.pair, a: s.position, b: b.position, lead: s.ab.lead })
    if (s.carriers.length > 0 && b.carriers.length === s.carriers.length) {
      const idxInA = Math.floor(rng.next() * s.carriers.length)
      const outgoing = s.carriers[idxInA]
      const idsInPair = new Set([...s.carriers, ...b.carriers].map((c) => c.id))
      const flat = allCarrierIds(carriers).filter(
        (c) => c.id !== outgoing.id && !idsInPair.has(c.id)
      )
      const replacement = rng.pick(flat.length > 0 ? flat : allCarrierIds(carriers))
      b.carriers = s.carriers.map((c, i) =>
        i === idxInA
          ? {
              id: replacement.id,
              name: replacement.name,
              cls: clsOfCarrier(replacement.id),
              deg: replacement.deg,
            }
          : c
      )
      batchUse[replacement.id] = (batchUse[replacement.id] ?? 0) + 1
    }
  }

  /* --- реабилитация каналов (Залп 3): R+ мейны по политике --- */
  {
    const chPolicy = getPolicy().channels as {
      rehab_channels?: string[]
      rehab_quota_per_batch?: number
    }
    const rehab = chPolicy.rehab_channels ?? []
    const quota = Math.min(chPolicy.rehab_quota_per_batch ?? 0, rehab.length || 1)
    if (rehab.length > 0 && quota > 0) {
      rng
        .shuffle(out.filter((s) => s.kind !== 'OC' && s.rating === 'R+'))
        .slice(0, quota)
        .forEach((s, i) => {
          s.targetChannel = rehab[i % rehab.length]
        })
    }
  }

  /* --- variety-пакет (тура 4/5) --- */
  const batchVariety = proposeBatchVariety(out, slug)
  for (let i = 0; i < out.length; i++) {
    const v = batchVariety[i]
    if (!v) continue
    const adjustedCamera = cameraForLead(out[i].lead, v.camera)
    out[i].variety = {
      posOrder: v.posOrder,
      register: v.register,
      lengthClass: v.lengthClass,
      styleAnchor: v.styleAnchor,
      negVariant: v.negVariant,
      camera: adjustedCamera,
      bodyPlan: v.bodyPlan,
      handsHint: v.handsHint,
      themeWordBudget: v.themeWordBudget,
      seed: v.seed,
    }
  }

  /* --- статы, окно, законы --- */
  const spreadMap: Record<string, number> = {}
  for (const s of out) spreadMap[s.rating] = (spreadMap[s.rating] ?? 0) + 1
  const allAssigned = out.flatMap((s) => s.carriers)
  const wShare = allAssigned.length
    ? Math.round((allAssigned.filter((c) => c.cls === 'W').length / allAssigned.length) * 100)
    : 0
  const sheerById = new Map(
    allCarrierIds(carriers).map((c) => [c.id, c.sheer_family === true])
  )
  const rplusSlots = out.filter((s) => s.rating === 'R+')
  const sheerFramesCount = rplusSlots.filter((s) =>
    s.carriers.some((c) => sheerById.get(c.id) === true)
  ).length
  const sheerPct = rplusSlots.length
    ? Math.round((sheerFramesCount / rplusSlots.length) * 100)
    : 0

  const ds = getDeliveryStats()
  const dsChannels = ds?.channels ?? []
  const ocStillRplus = out.some((s) => s.kind === 'OC' && s.rating === 'R+')
  const deadClaims: { zone: string; channel: string; evidence: string }[] = []
  if (dsChannels.some((c) => c.id === 'oc-rplus' && c.status === 'dead') && ocStillRplus) {
    const oc = dsChannels.find((c) => c.id === 'oc-rplus')
    deadClaims.push({
      zone: 'OC R+',
      channel: 'oc-rplus',
      evidence: oc?.evidence?.join('; ') ?? '0/N по вердиктам',
    })
  }

  const receiptsText = (plan.receipts ?? [])
    .map((r) => `${r.gate} ${r.verdict}`)
    .join(' · ')
  const now = opts.now ?? new Date().toISOString()
  const bridgeNote =
    `WRITE-мост итерация 2 (${now}): план ${slug} живого движка (sha10 ${plan.sha10 ?? '—'}) → богатый контракт писца. ` +
    `Скелет движка не тронут 1-в-1: жанры (MAIN→VOLT — жанровый словарь файл-эры), рейтинги, палитры, OC-темы, A/B-пары, EXP-программа. ` +
    `Квитанции движка: ${receiptsText || '—'}. Палитры: номера движка → полные id спеков (один фонд 120). ` +
    `Обогащение детерминировано сидом плана: позы (риск-закон R+/X), стеки core-4/tier с sheer-бюджетом, лиды (ASS-квота, пары делят зону), ` +
    `клоузеры, расовый каст, кинетика, witness/arch NICHE, OC-имена (ротация+кулдаун+каскад), variety. Гипотезы EXP — заглушки под редактуру автора.`

  const contract: BatchContract = {
    slug,
    theme: plan.theme ?? plan.title ?? slug,
    engine: plan.engine ?? 'per-theme',
    engineLaw:
      'план живого движка (Rust twin): скелет заквитанцеван движком' +
      (receiptsText ? ` — ${receiptsText}` : ''),
    engineWhy:
      `WRITE-мост: план ${plan.sha10 ?? ''} twin'а → контракт. Скелет (жанры/рейтинги/палитры/A-B/EXP) зеркалирует движок 1-в-1; ` +
      `обогащение — детерминированный адаптер по сиду плана. compileBatch файл-эры скелет НЕ пересобирал.`,
    seed,
    createdAt: now,
    spread: Object.entries(spreadMap).map(([rating, count]) => ({ rating, count })),
    slots: out,
    ocRotation: ocNames.map((n) => ({ name: n, served: served(n) })),
    ...(opts.cascade
      ? { ocCascade: { from: opts.cascade.slug, excluded: [...opts.cascade.ocs] } }
      : {}),
    racialCount: out.filter((s) => s.race).length,
    abPairs,
    carrierStats: {
      wSharePct: wShare,
      sheerRplusPct: sheerPct,
      wCapPct: LAWS.wCapPct,
      sheerFrameCapPct: LAWS.sheerFrameCapPct,
    },
    windowSlugs: opts.state.windowSlugs,
    ...(windowOpaque.length ? { windowOpaque } : {}),
    channelStats: {
      version: ds?.version ?? '—',
      live: dsChannels.filter((c) => c.status === 'live').map((c) => c.id),
      candidate: dsChannels.filter((c) => c.status === 'candidate').map((c) => c.id),
      dead: dsChannels.filter((c) => c.status === 'dead').map((c) => c.id),
      deadClaims,
    },
    ...((): { platform?: Record<string, unknown> } => {
      const f = getFacts()
      return f
        ? {
            platform: {
              platform: f.platform,
              economics: f.economics,
              proven: f.proven_facts,
              ph_behavior: f.ph_behavior,
            },
          }
        : {}
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
      rplusHardClaim:
        'RENDER LAW v1.2.0: R+ несёт ≥1 РЕНДЕР-ДОКАЗАННУЮ заявку (словарь файл-эры — см. contracts/T4-41.json laws.rplusHardClaim; мост его не переписывал)',
      abDiscipline:
        'A/B-дисциплина (§10): пары из плана движка; лид-зона общая, стек B = стек A с ровно одной заменой носителя, подача разная',
      bridge: bridgeNote,
    },
  }

  return { contract, bridgeNote }
}
