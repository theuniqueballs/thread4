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
  getEngines,
  getOCCanon,
  getPalettes,
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
  carrierStats: {
    wSharePct: number
    sheerRplusPct: number
    wCapPct: number
    sheerFrameCapPct: number
  }
  windowSlugs: string[]
  laws: Record<string, string | number>
}

export interface CompileOptions {
  ocOrders?: string[] // author-named OCs (up to 3); rest filled by rotation
  ocThemes?: Record<string, string> // author's per-OC theme/angle, keyed by OC name
  engine?: string // engine key override
  exquisite?: number // 0..4, default 1
  exploratory?: number // 0..2, default 1
  seed?: number
  dryRun?: boolean // no events, no files — for selftests
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
/* Constants (shared with gates — the contract prints these very values)*/
/* ------------------------------------------------------------------ */

export const LAWS = {
  slotsTotal: 21,
  ocSlots: 3,
  nicheCount: 7,
  rplusMains: 9, // 9 R+ mains (incl. EXQUISITE) + 3 OC R+ = 12 R+ total
  exquisiteDefault: 1,
  xSlots: 2,
  core4Groups: 4,
  wCapPct: 45,
  sheerPerPrompt: 2,
  sheerFrameCapPct: 40,
  poseDistinct: 21,
  paletteDistinct: 21,
  racialDefault: 10,
  posTarget: 300,
  posHard: 400,
  hedgeBudget: 2,
  leadMax: 3,
  closerCapPct: 40,
  registerCapPct: 50,
  signalMin: { 'PG-13': 2, R: 1, 'R+': 2, X: 2 } as Record<string, number>,
} as const

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
  const num = nextBatchNumber(state.batches)
  const slug = `T4-${String(num).padStart(2, '0')}`
  const seed = options.seed ?? hashSeed(`${slug}::${theme}`)
  const rng = makeRng(seed)

  /* specs */
  const carriers = getCarriers()
  const poses = getPoses()
  const palettes = getPalettes()
  const engines = getEngines()
  const ocCanon = getOCCanon()
  const races = getRaces()
  const recipes = getRatingRecipes()
  if (!carriers || !poses || !palettes || !engines || !ocCanon || !races || !recipes) {
    throw new Error('specs not loaded — run the pool import first')
  }

  const usage = foldWindowUsage(state.windowSlugs)

  /* engine: explicit override, else least-recently-used among usable */
  const engineEntries = Object.entries(engines.engines).filter(
    ([, e]) => e.status !== 'retired'
  )
  const usedEngines = new Set(
    events
      .filter((e: T4Event) => e.type === 'batch.compiled')
      .map((e) => String(e.data?.engine ?? ''))
  )
  const engineKey =
    options.engine ??
    (engineEntries.find(([k]) => !usedEngines.has(k)) ?? engineEntries[0])[0]
  const engine = engines.engines[engineKey] ?? Object.values(engines.engines)[0]

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

  /* genre skeleton: P01-P03 OC (R+), P04-P21 = 7 NICHE + 9 R+ mains (incl. EXQ) + 2 X */
  const exquisiteN = Math.max(0, Math.min(4, options.exquisite ?? LAWS.exquisiteDefault))
  const mains: { kind: SlotPlan['kind']; rating: SlotPlan['rating'] }[] = []
  for (let i = 0; i < LAWS.nicheCount; i++) mains.push({ kind: 'NICHE', rating: 'R' })
  for (let i = 0; i < LAWS.rplusMains - exquisiteN; i++) mains.push({ kind: 'VOLT', rating: 'R+' })
  for (let i = 0; i < exquisiteN; i++) mains.push({ kind: 'EXQUISITE', rating: 'R+' })
  for (let i = 0; i < LAWS.xSlots; i++) mains.push({ kind: 'VOLT', rating: 'X' })
  const orderedMains = rng.shuffle(mains)

  /* pools for assignment */
  const posePool = lruPick(poses.poses, usage.poses, rng)
  const palettePool = lruPick(palettes.palettes, usage.palettes, rng)
  const racePool = lruPick(
    races.races.filter((r) => r.status === 'active' || r.status === 'gold'),
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
  // batch-level sheer budget: ≤40% of R+ frames may carry a sheer carrier
  const rplusTotal = LAWS.rplusMains + LAWS.ocSlots
  const maxSheerFrames = Math.floor((rplusTotal * LAWS.sheerFrameCapPct) / 100)
  let sheerFramesUsed = 0

  function assignCore4(rating: 'R+' | 'X', position: number): SlotPlan['carriers'] {
    const groupsNeeded = ['FABRIC', 'BODY', 'POSITION', 'PHYSICS'] as const
    const recipe = recipes.tiers[rating === 'R+' ? 'RPLUS' : 'X']
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
        ...lruPick(preferred.flatMap((c) => byClass[c] ?? []), carrierUsage, rng),
        ...lruPick(classes.filter((c) => !preferred.includes(c)).flatMap((c) => byClass[c] ?? []), carrierUsage, rng),
      ]
      const nonSheer = ordered.filter((c) => !c.sheer_family || sheerBudgetLeft())
      const chosen = nonSheer[0] ?? ordered[0]
      if (chosen) {
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
    const recipe = recipes.tiers[key]
    const prefer = recipe?.carrier_classes ?? ['S', 'E', 'W', 'B']
    const pool = lruPick(prefer.flatMap((c) => byClass[c] ?? []), carrierUsage, rng)
    return pool.slice(0, 3).map((c: Carrier) => ({
      id: c.id, name: c.name, cls: clsOfCarrier(c.id), deg: c.deg,
    }))
  }

  /* slot assembly */
  const slots: SlotPlan[] = []
  const leads = lruPick(LEAD_ZONES.map((id) => ({ id })), usage.leads, rng)
  const closers = lruPick(CLOSER_CLASSES.map((id) => ({ id })), usage.closers, rng)
  const witnesses = lruPick(WITNESS_TYPES.map((id) => ({ id })), usage.witnesses, rng)
  const registers: SlotPlan['register'][] = []
  const regPlan = ['student', 'young', 'milf']
  // balanced registers: roughly equal thirds, no register > 50%
  for (let i = 0; i < 21; i++) registers.push(regPlan[i % 3])
  const shuffledRegisters = rng.shuffle(registers)
  const racialSlots = new Set(
    rng.shuffle([...Array(18).keys()].map((i) => i + 4)).slice(0, LAWS.racialDefault)
  )
  const exploratoryN = Math.max(0, Math.min(2, options.exploratory ?? 1))
  const exploratorySlots = new Set(
    rng.shuffle([...Array(18).keys()]).slice(0, exploratoryN).map((i) => i + 4)
  )

  let poseIdx = 0
  let paletteIdx = 0
  let kIdx = 0
  let raceIdx = 0
  let leadIdx = 0
  let closerIdx = 0
  let witnessIdx = 0

  for (let pos = 1; pos <= 21; pos++) {
    const lead = leads[leadIdx % leads.length].id
    leadIdx += 1
    const closer = closers[closerIdx % closers.length].id
    closerIdx += 1
    const register = shuffledRegisters[pos - 1]
    const pose = posePool[poseIdx++ % posePool.length]
    const palette = palettePool[paletteIdx++ % palettePool.length]

    if (pos <= 3) {
      const ocName = ocNames[pos - 1]
      const carriers4 = assignCore4('R+', pos)
      slots.push({
        position: pos,
        kind: 'OC',
        oc: ocName,
        ocTheme: options.ocThemes?.[ocName]?.trim() || undefined,
        rating: 'R+',
        pose: pose.id,
        poseName: pose.name,
        poseRisk: pose.risk,
        palette: palette.id,
        paletteName: palette.name,
        kinetics: [kPool[kIdx++ % kPool.length]?.id].filter(Boolean) as string[],
        carriers: carriers4,
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

    slots.push({
      position: pos,
      kind: main.kind,
      rating: main.rating,
      race: race?.name,
      raceFeature: race?.features?.[0],
      pose: pose.id,
      poseName: pose.name,
      poseRisk: pose.risk,
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

  const spreadMap: Record<string, number> = {}
  for (const s of slots) spreadMap[s.rating] = (spreadMap[s.rating] ?? 0) + 1

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

  const contract: BatchContract = {
    slug,
    theme,
    engine: engineKey,
    engineLaw: engine.law,
    engineWhy: engineWhyText(engineKey, engine, engines),
    seed,
    createdAt: new Date().toISOString(),
    spread: Object.entries(spreadMap).map(([rating, count]) => ({ rating, count })),
    slots,
    ocRotation: ocNames.map((n) => ({ name: n, served: served(n) })),
    racialCount: slots.filter((s) => s.race).length,
    carrierStats: {
      wSharePct: wShare,
      sheerRplusPct: sheerPct,
      wCapPct: LAWS.wCapPct,
      sheerFrameCapPct: LAWS.sheerFrameCapPct,
    },
    windowSlugs: state.windowSlugs,
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
      faceLock: 'Her face is rendered in stylized 2D anime style: anime eyes ([color/state]), small nose, small mouth [state], [tone] skin.',
      posShape: 'POS = [тег-блок] → [проза] → [quality-теги] — PH-форма, проходит дословно',
      counters: 'экспозиция = сигнал-тег + контр-NEG (N31-рецепт); рейтинг зарабатывается тегами, не прозой',
    },
  }

  if (!options.dryRun) {
    writeJson(path.join(CONTRACTS_DIR, `${slug}.json`), contract)
    writeText(path.join(CONTRACTS_DIR, `${slug}.md`), contractMarkdown(contract))
    appendEvent(
      'batch.compiled',
      `${slug} «${theme}» — контракт скомпилирован (движок ${engineKey}, спред ${contract.spread
        .map((s) => `${s.rating}×${s.count}`)
        .join(' ')})`,
      { slug, theme, engine: engineKey, seed }
    )
    for (const oc of ocNames) {
      appendEvent('oc.appeared', `OC ${oc} назначен в ${slug}`, { slug, name: oc })
    }
  }

  return contract
}

function engineWhyText(key: string, engine: { status: string; first_batch: string }, spec: { open_seeds: string[] }): string {
  const seeds = spec.open_seeds.length
  return `Ротация движков: ${key} (${engine.status}, дебют ${engine.first_batch}). ` +
    `Семена на подъёмной сетке: ${seeds}. Движок — мировой закон, который носится на теле; ` +
    `тема автора ложится на его ось, NICHE-слоты несут невозможное, VOLT — плоть.`
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
  lines.push(`**Спред рейтингов**: ${c.spread.map((s) => `${s.rating}×${s.count}`).join(' · ')} — NICHE-слоты зарабатывают R эротической позой (честный тег), VOLT несёт R+ по рецептуре (сигнал-теги + контр-NEG), X — 2 слота (Yodayo душит алгоритмически, это art-for-art).`)
  lines.push('')
  lines.push(`**Ротация OC**: ${c.ocRotation.map((o) => `${o.name} (было ${o.served})`).join(', ')} — по longest-rested.`)
  lines.push('')
  const themed = c.slots.filter((s) => s.oc && s.ocTheme)
  if (themed.length > 0) {
    lines.push(`**Темы OC (заказ автора)**: ${themed.map((s) => `${s.oc} — ${s.ocTheme}`).join(' · ')}`)
    lines.push('')
  }
  lines.push(`**Расовый каст**: ${c.racialCount}/18 мейнов — раса делает физическую работу в кадре (механизм, не костюм).`)
  lines.push('')
  lines.push('**Диверсия назначена до письма** (ядро §3): носители, позы, палитры, K, LEAD-зоны, клоузеры, регистры зрелости, свидетели — всё разложено по слотам ниже. Писец пишет ПРОТИВ этого плана; гейты проверяют те же числа, что здесь напечатаны.')
  lines.push('')
  lines.push('## Слот-план')
  lines.push('')
  lines.push('| P | Жанр | Рейтинг | OC/раса | Поза | Палитра | K | Носители | LEAD | Регистр | Клоузер |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of c.slots) {
    const who = s.oc ?? s.race ?? '—'
    lines.push(
      `| P${String(s.position).padStart(2, '0')} | ${s.kind}${s.exploratory ? ' ⚗' : ''} | ${s.rating} | ${who} | ${s.pose} ${s.poseName} (${s.poseRisk}) | ${s.palette} | ${s.kinetics.join(',') || '—'} | ${s.carriers.map((x) => x.id).join(' + ') || '—'} | ${s.lead} | ${s.register} | ${s.closer} |`
    )
  }
  lines.push('')
  if (c.slots.some((s) => s.exploratory)) {
    lines.push(`⚗ — EXPLORATORY-слоты (конституция §10): легализованные эксперименты против нежёстких законов. Что именно щупаем — фиксируется в ворклоге батча при сдаче.`)
    lines.push('')
  }
  lines.push('## Законы письма (числа гейтов — те же константы)')
  lines.push('')
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
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Производство — как пустить сборку в дело')
  lines.push('')
  lines.push('Контракт готов. Производство батча — приказ писцу, в чате:')
  lines.push('')
  lines.push(`> **«Super Z, произведи ${c.slug}»**`)
  lines.push('')
  lines.push('Писец читает этот контракт, пишет 21 промпт + 3 OC в одном файле, самопроверка по гейтам (dry-run), официальный прогон, сдача с батч-ворклогом — батч и квитанции гейтов появятся во вкладке «Батчи». Темы ОС, если нужны свои, дописываются в приказ: «произведи ' + c.slug + ', темы ОС: Lyn — …, Sue — …»; пусто = писец выводит темы из темы батча и движка.')
  lines.push('')
  lines.push('*Контракт — единственный документ писца. Право (конституция) и спеки — фон; всё, что нужно для чистого первого прогона, — выше.*')
  return lines.join('\n')
}

/* Silence unused import warnings for types used only in signatures. */
export type { T4Event }
