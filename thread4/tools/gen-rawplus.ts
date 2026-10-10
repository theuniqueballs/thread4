/**
 * gen-rawplus.ts — RAW+ генератор контрактов: кины возвращаются в конвейер
 * (закон №3 «race as mechanism, not costume») + порты практик A5, не доехавших
 * в RAW-миграцию: библиотека hair/eye (E3, A5P3F §III-C-2) и echo-мотивы
 * (F13, §IX: 8 типов, арка трёх актов, мутация ≥2 параметров из разных групп).
 *
 * Контекст (2026-10-11, приказ автора): расовый каст потерялся с T4-23 —
 * кастомные генераторы контрактов его не назначали, ни один закон расы не
 * отменён. Этот генератор — штатный путь RAW+ сборки: план по закону policy,
 * кины тег-блоками (kin-block.ts: POS + anti-shield NEG + свет/гардеробные
 * хуки), hair/eye из библиотеки (~50% следуют подсказке палитры — E3),
 * echo-мотивы с планом мутаций, палитры вне окна ротации (windowOthersFor,
 * вопрос №30), стеки core-4 (4 мех-группы из 5) на каждом слоте.
 *
 * Запуск (из корня репо):
 *   bun thread4/tools/gen-rawplus.ts T4-28 "THEME NAME" [флаги]
 *     --seed N        детерминизм (по умолчанию — из времени)
 *     --races N       квота рас на мейнах (по умолчанию policy.law.racialDefault)
 *     --echo 2|3      echo-мотивов на батч (по умолчанию 3; F13: 2-3)
 *     --oc A,B,C      заказ OC (по умолчанию — ротация по served-счётчику)
 *     --exquisite N   EXQUISITE-слотов в R+ пуле (по умолчанию policy)
 *     --rebuild-of T4-NN  ребилд-декларация: окно не конфликтует с источником
 *     --dry           только напечатать план, файлы не писать
 *     --force         перезаписать существующий контракт
 *   bun thread4/tools/gen-rawplus.ts --demo   # план по живому состоянию, без записи
 *
 * Квота рас по умолчанию — из policy.law (закон не отменялся); перебивается
 * флагом на приказе автора (§10). Генератор планирует КОНТРАКТ; текст батча
 * пишет сборщик (писец/автор) по контракту. BODY-SPECTRUM (H13) в план не
 * входит — гипотеза ждёт вердикта автора по рендеру T4-27.2.
 */
import fs from 'node:fs'
import path from 'node:path'

import { windowOthersFor } from '../../src/lib/t4/gates'
import { foldState, readEvents } from '../../src/lib/t4/events'
import { CONTRACTS_DIR, readJson, writeJson, writeText } from '../../src/lib/t4/fsutil'
import {
  getCarriers,
  getDeliveryStats,
  getHairEyeLibrary,
  getOCCanon,
  getPalettes,
  getPolicy,
} from '../../src/lib/t4/specs'
import { buildBlock, loadRaces, type RaceEntry } from './kin-block'

/* ------------------------------------------------------------------ */
/* RNG — детерминизм плана (тот же алгоритм, что и компилятор)         */
/* ------------------------------------------------------------------ */

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
/* Мостик палитра → hair/eye (E3: подсказка ~50%, не правило)          */
/* A5P2: hair — из dominant, eyes — из secondary палитры               */
/* ------------------------------------------------------------------ */

const HAIR_BRIDGE: [RegExp, string][] = [
  [/platinum|ice-white|frost-white/, 'platinum-white'],
  [/white|ivory|porcelain|alabaster|moonlit|pearl/, 'white'],
  [/silver|steel|pewter|chrome/, 'silver'],
  [/blonde|sand|wheat|butterm/, 'blonde'],
  [/gold|amber|honey|golden/, 'golden'],
  [/copper|rust|terra-?cotta/, 'copper'],
  [/ember|crimson|oxblood|scarlet|blood/, 'crimson'],
  [/wine|burgundy|plum/, 'burgundy'],
  [/auburn/, 'auburn'],
  [/chocolate|cocoa|espresso/, 'chocolate'],
  [/dark-?brown|mahogany|umber/, 'dark-brown'],
  [/chestnut|sienna/, 'chestnut'],
  [/brown|earth|soil|fawn|tan/, 'brown'],
  [/ash|smoke|grey|graphite|mist/, 'ash-brown'],
  [/pale-?green|seafoam|celadon/, 'pale-green'],
  [/teal|tide/, 'teal'],
  [/emerald|jade/, 'emerald'],
  [/sage|olive|moss|lichen/, 'sage'],
  [/mint|pistachio/, 'mint'],
  [/ice-?blue|glacier/, 'ice-blue'],
  [/sky|azure|cyan|day-?light/, 'sky-blue'],
  [/navy|midnight|indigo|deep-?blue/, 'navy'],
  [/violet|amethyst|purple|ultraviolet/, 'violet'],
  [/lavender|lilac|orchid/, 'lavender'],
  [/magenta|hot-?pink|neon-?pink/, 'pink'],
  [/rose|blush|salmon|dusty/, 'dusty-pink'],
  [/peach|apricot|coral/, 'peach'],
  [/orange|tangerine|sunset|fire/, 'orange'],
  [/red/, 'red'],
  [/green/, 'sage'],
  [/blue/, 'sky-blue'],
  [/black|obsidian|jet|raven|noir|void|ink|charcoal|soot/, 'black'],
]

const EYE_BRIDGE: [RegExp, string][] = [
  [/grey|graphite|smoke|ash/, 'grey'],
  [/silver|steel|pewter|chrome/, 'silver'],
  [/gold|golden|amber|honey/, 'gold'],
  [/amber|copper|rust/, 'amber'],
  [/hazel|sienna/, 'hazel'],
  [/emerald|jade/, 'emerald'],
  [/teal|tide/, 'teal'],
  [/pale-?blue|ice-?blue|glacier|frost/, 'pale-blue'],
  [/sky|azure|cyan|day-?light/, 'sky-blue'],
  [/navy|midnight|indigo|deep-?blue/, 'blue'],
  [/violet|amethyst|purple|ultraviolet|orchid/, 'violet'],
  [/red|crimson|oxblood|scarlet|ember/, 'red'],
  [/dark-?red|wine|burgundy|plum/, 'dark-red'],
  [/pink|rose|magenta|blush/, 'pink'],
  [/green|olive|moss|sage|lichen/, 'green'],
  [/black|obsidian|jet|raven|noir|void|ink|charcoal|soot|brown|earth|soil/, 'black'],
]

function bridgeColor(tokens: string[], table: [RegExp, string][], fallbackPool: string[], rng: Rng): string {
  const hay = tokens.join(' ').toLowerCase()
  for (const [re, color] of table) {
    if (re.test(hay)) {
      if (fallbackPool.includes(color)) return color
    }
  }
  return rng.pick(fallbackPool)
}

/* ------------------------------------------------------------------ */
/* Echo-мотивы (F13, A5 §IX): 8 типов, арка трёх актов,                */
/* мутация ≥2 параметров из разных групп (1 spatial + 1 narrative/     */
/* atmospheric). Арка A5 P1→P9→P17 на 24-слотовой шкале: I=1..8,       */
/* II=9..16, III=17..24.                                              */
/* ------------------------------------------------------------------ */

const ECHO_TYPES: { id: string; what: string }[] = [
  { id: 'color', what: 'акцент палитры' },
  { id: 'object', what: 'предмет-реквизит' },
  { id: 'compositional', what: 'геометрия кадра' },
  { id: 'textural', what: 'материальная пара' },
  { id: 'gaze', what: 'направление взгляда' },
  { id: 'pose', what: 'силуэт' },
  { id: 'clothing-state', what: 'состояние одежды' },
  { id: 'weather', what: 'атмосферное условие' },
]

const MUTATION_POOLS = {
  spatial: ['камера меняет дистанцию/ракурс', 'палитра сцены смещается по спектру', 'окружение/локация меняется'],
  narrative: ['состояние одежды эволюционирует', 'взгляд/выражение меняет отношение к мотиву', 'роль мотива в кадре меняется'],
  atmospheric: ['температура света меняется', 'время суток сдвигается', 'направление света поворачивается', 'погодное условие меняется'],
} as const

export interface EchoPlan {
  type: string
  motif: string
  appearances: { slot: number; act: string; mutation: string[] }[]
}

/* ------------------------------------------------------------------ */
/* План слота                                                          */
/* ------------------------------------------------------------------ */

export interface RawPlusSlot {
  position: number
  kind: 'OC' | 'NICHE' | 'VOLT' | 'EXQUISITE'
  oc?: string
  rating: 'PG-13' | 'R' | 'R+' | 'X'
  race?: string
  raceId?: string
  kinPos?: string
  kinNeg?: string
  kinHook?: string
  witnessHint?: string
  pose: string
  poseName: string
  poseRisk: string
  palette: string
  paletteName: string
  kinetics: string[]
  carriers: { id: string; name: string; cls: string }[]
  hair: string
  eyes: string
  hairEyeFrom: 'canon' | 'suggestion' | 'library'
  register: string
  echo?: string[]
}

export interface RawPlusPlan {
  contract: Record<string, unknown>
  slots: RawPlusSlot[]
  kinBlocks: { id: string; name: string; pos: string; neg: string; hook: string }[]
  echoMotifs: EchoPlan[]
  report: string[]
}

export interface PlanOptions {
  slug: string
  theme: string
  seed?: number
  races?: number
  echo?: number
  ocOrder?: string[]
  exquisite?: number
  rebuildOf?: string
  /** Живое состояние (main) или синтетика (selftest). Чистая функция. */
  windowSlugs: string[]
  ocAppearances: Record<string, number>
}

/* ------------------------------------------------------------------ */
/* Ядро плана                                                          */
/* ------------------------------------------------------------------ */

export function planRawPlus(opts: PlanOptions): RawPlusPlan {
  const law = getPolicy().law
  const rng = makeRng(opts.seed ?? Date.now())
  const report: string[] = []

  /* --- окно ротации: палитры чужих контрактов исключаются (№30) --- */
  const windowOthers = windowOthersFor(opts.slug, opts.windowSlugs, opts.rebuildOf)
  const bannedPalettes = new Set<string>()
  for (const w of windowOthers) {
    const wc = readJson<{ slots: { palette?: string }[] }>(path.join(CONTRACTS_DIR, `${w}.json`))
    for (const s of wc?.slots ?? []) {
      if (s.palette) bannedPalettes.add(s.palette)
    }
  }
  if (bannedPalettes.size > 0) {
    report.push(`окно ротации: ${windowOthers.join(' + ')} — ${bannedPalettes.size} палитр исключены из плана`)
  }
  if (opts.rebuildOf) {
    report.push(`ребилд-декларация: источник ${opts.rebuildOf} из окна исключён (переиспользование ≠ конфликт)`)
  }

  /* --- палитры: 24 уникальные вне окна --- */
  const palettes = getPalettes()?.palettes ?? []
  const pool = rng.shuffle(palettes.filter((p) => !bannedPalettes.has(p.id)))
  if (pool.length < law.paletteDistinct) {
    throw new Error(`палитр вне окна мало: ${pool.length} < ${law.paletteDistinct} — расширь окно или палитры`)
  }
  const chosenPalettes = pool.slice(0, law.slotsTotal)

  /* --- OC: канон + ротация по served --- */
  const ocCanon = getOCCanon()
  const ocNames = Object.keys(ocCanon?.ocs ?? {})
  let ocPicks: string[] = []
  if (opts.ocOrder?.length) {
    for (const name of opts.ocOrder) {
      if (!ocNames.includes(name)) throw new Error(`OC «${name}» не в каноне (oc-canon.json)`)
    }
    ocPicks = [...opts.ocOrder]
  }
  if (ocPicks.length < law.ocSlots) {
    const rest = rng.shuffle(
      ocNames
        .filter((n) => !ocPicks.includes(n))
        .sort(
          (a, b) =>
            (opts.ocAppearances[a] ?? 0) - (opts.ocAppearances[b] ?? 0) ||
            a.localeCompare(b)
        )
    )
    ocPicks = [...ocPicks, ...rest.slice(0, law.ocSlots - ocPicks.length)]
  }
  ocPicks = ocPicks.slice(0, law.ocSlots)
  /* OC-рейтинг — рефлекс статы доставки (oc-rplus): жив → R+, мёртв → R */
  const ocRplusLive =
    getDeliveryStats()?.channels.find((c) => c.id === 'oc-rplus')?.status !== 'dead'
  const ocRating: 'R' | 'R+' = ocRplusLive ? 'R+' : 'R'
  report.push(`OC-ротация: ${ocPicks.join(' · ')} — рейтинг ${ocRating} (oc-rplus ${ocRplusLive ? 'live' : 'dead'}, рефлекс)`)

  /* --- мейны: NICHE×N R + VOLT/EXQUISITE R+ с интерливом --- */
  const exquisite = Math.max(0, Math.min(opts.exquisite ?? law.exquisiteDefault, law.rplusMains - 1))
  const kinds: ('NICHE' | 'VOLT' | 'EXQUISITE')[] = [
    ...Array.from({ length: law.nicheCount }, () => 'NICHE' as const),
    ...Array.from({ length: law.rplusMains - exquisite }, () => 'VOLT' as const),
    ...Array.from({ length: exquisite }, () => 'EXQUISITE' as const),
  ]
  /* интерлив: не более 2 NICHE подряд (закон №22 на жанры) */
  let laid = rng.shuffle(kinds)
  for (let guard = 0; guard < 40; guard++) {
    let bad = -1
    for (let i = 2; i < laid.length; i++) {
      if (laid[i] === 'NICHE' && laid[i - 1] === 'NICHE' && laid[i - 2] === 'NICHE') {
        bad = i
        break
      }
    }
    if (bad < 0) break
    const swapWith = laid.findIndex((k, idx) => idx > bad && k !== 'NICHE')
    if (swapWith < 0) break
    ;[laid[bad], laid[swapWith]] = [laid[swapWith], laid[bad]]
  }

  /* --- расовый каст: N уникальных рас на мейнах (закон №3) --- */
  const raceQuota = Math.max(0, opts.races ?? law.racialDefault)
  const racePool = rng.shuffle(loadRaces())
  if (raceQuota > racePool.length) {
    throw new Error(`квота рас ${raceQuota} > пула ${racePool.length}`)
  }
  const pickedRaces: RaceEntry[] = racePool.slice(0, raceQuota)
  /* NICHE — природный носитель расы (гейт ниши требует расу-работу + свидетеля);
     распределяем: не менее половины квоты на NICHE, остальные по мейнам */
  const mainPositions = Array.from({ length: law.mainsTotal }, (_, i) => law.ocSlots + 1 + i)
  const nichePositions = mainPositions.filter((_, i) => laid[i] === 'NICHE')
  const otherPositions = mainPositions.filter((p) => !nichePositions.includes(p))
  const racePositions = [
    ...rng.shuffle(nichePositions).slice(0, Math.ceil(raceQuota / 2)),
    ...rng.shuffle(otherPositions).slice(0, Math.floor(raceQuota / 2)),
  ].sort((a, b) => a - b).slice(0, raceQuota)
  const raceByPosition = new Map<number, RaceEntry>()
  racePositions.forEach((p, i) => raceByPosition.set(p, pickedRaces[i]))
  if (raceQuota > 0) {
    report.push(
      `расовый каст: ${raceQuota} на мейнах — ${[...raceByPosition.values()].map((r) => r.id).join(', ')} (закон №3; квота из policy, судьба закона — вердикт автора)`
    )
  }

  /* --- hair/eye: канон для OC, библиотека E3 для мейнов --- */
  const lib = getHairEyeLibrary()
  if (!lib) throw new Error('hair-eye-library.json отсутствует — генератору нужна библиотека (E3)')
  const hairBag = rng.shuffle(lib.hair)
  const eyeBag = rng.shuffle(lib.eyes)
  let followed = 0
  let deviated = 0
  let prevHair = ''

  /* --- носители: мех-группа → список; стек = 4 группы из 5 --- */
  const carriersSpec = getCarriers()
  const mechToCarriers = new Map<string, { id: string; name: string; cls: string }[]>()
  for (const [cls, list] of Object.entries(carriersSpec?.classes ?? {})) {
    const mech = carriersSpec?.class_defs?.[cls]?.mech ?? '?'
    if (!mechToCarriers.has(mech)) mechToCarriers.set(mech, [])
    for (const c of (list as { id: string; name: string }[]) ?? []) {
      mechToCarriers.get(mech)!.push({ id: c.id, name: c.name, cls })
    }
  }
  const mechs = [...mechToCarriers.keys()].filter((m) => (mechToCarriers.get(m)?.length ?? 0) > 0)
  const seenStacks = new Set<string>()
  const stackFor = (): { id: string; name: string; cls: string }[] => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const groups = rng.shuffle(mechs).slice(0, law.core4Groups)
      const stack = groups.map((g) => rng.pick(mechToCarriers.get(g)!))
      const sig = stack.map((c) => c.id).sort().join('+')
      if (!seenStacks.has(sig)) {
        seenStacks.add(sig)
        return stack
      }
    }
    return rng.shuffle(mechs).slice(0, law.core4Groups).map((g) => rng.pick(mechToCarriers.get(g)!))
  }

  /* --- слоты --- */
  const slots: RawPlusSlot[] = []
  for (let i = 0; i < law.slotsTotal; i++) {
    const position = i + 1
    const palette = chosenPalettes[i]
    if (i < law.ocSlots) {
      const name = ocPicks[i]
      const canon = ocCanon?.ocs[name]
      slots.push({
        position,
        kind: 'OC',
        oc: name,
        rating: ocRating,
        pose: '',
        poseName: `${opts.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oc${position}`,
        poseRisk: '',
        palette: palette.id,
        paletteName: palette.name,
        kinetics: [],
        carriers: stackFor(),
        hair: canon?.hair ?? '',
        eyes: canon?.eyes ?? '',
        hairEyeFrom: 'canon',
        register: 'oc',
      })
      continue
    }
    const mainIdx = i - law.ocSlots
    const kind = laid[mainIdx]
    const rating: 'R' | 'R+' = kind === 'NICHE' ? 'R' : 'R+'
    const race = raceByPosition.get(position)
    const kin = race ? buildBlock(race) : undefined
    /* hair/eye: ~50% подсказка палитры (dominant→hair, secondary→eyes), ~50% библиотека */
    let hair: string
    let eyes: string
    let from: 'suggestion' | 'library'
    if (rng.next() < 0.5) {
      hair = bridgeColor(palette.dominant ?? [], HAIR_BRIDGE, lib.hair, rng)
      eyes = bridgeColor([...(palette.secondary ?? []), ...(palette.accent1 ?? [])], EYE_BRIDGE, lib.eyes, rng)
      from = 'suggestion'
      followed++
    } else {
      hair = hairBag[i % hairBag.length] ?? rng.pick(lib.hair)
      eyes = eyeBag[i % eyeBag.length] ?? rng.pick(lib.eyes)
      from = 'library'
      deviated++
    }
    if (hair === prevHair) {
      hair = hairBag.find((c) => c !== prevHair) ?? rng.pick(lib.hair)
      from = 'library'
    }
    prevHair = hair
    slots.push({
      position,
      kind,
      rating,
      ...(race
        ? {
            race: race.name,
            raceId: race.id,
            kinPos: kin?.pos,
            kinNeg: kin?.neg,
            kinHook: kin?.hook,
            ...(kind === 'NICHE'
              ? { witnessHint: 'свидетель в кадре обязателен (mirror/glass/monitor/phone/gauge…)' }
              : {}),
          }
        : {}),
      pose: '',
      poseName: `${opts.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-p${String(position).padStart(2, '0')}`,
      poseRisk: '',
      palette: palette.id,
      paletteName: palette.name,
      kinetics: [],
      carriers: stackFor(),
      hair,
      eyes,
      hairEyeFrom: from,
      register: 'student',
    })
  }
  const distinctHair = new Set(slots.filter((s) => s.kind !== 'OC').map((s) => s.hair)).size
  report.push(
    `hair/eye: ${followed} по подсказке палитры · ${deviated} независимо (E3 ~50/50); различных волос на мейнах ${distinctHair}/${law.mainsTotal}`
  )

  /* --- echo-мотивы: 2-3, арка трёх актов, мутации из разных групп --- */
  const echoCount = Math.max(2, Math.min(opts.echo ?? 3, 3))
  const echoTypes = rng.shuffle(ECHO_TYPES).slice(0, echoCount)
  const themeKey =
    opts.theme
      .toLowerCase()
      .split(/[^a-zа-яё]+/)
      .filter((w) => w.length > 4)
      .sort((a, b) => b.length - a.length)[0] ?? 'thread'
  const rplusMains = slots.filter((s) => s.kind !== 'OC' && s.rating === 'R+')
  const actRanges: [number, number][] = [
    [1, Math.round(law.slotsTotal / 3)],
    [Math.round(law.slotsTotal / 3) + 1, Math.round((2 * law.slotsTotal) / 3)],
    [Math.round((2 * law.slotsTotal) / 3) + 1, law.slotsTotal],
  ]
  const echoMotifs: EchoPlan[] = echoTypes.map((t) => {
    const appearances: EchoPlan['appearances'] = actRanges.map(([lo, hi], ai) => {
      const inAct = rplusMains.filter((s) => s.position >= lo && s.position <= hi)
      const anchor = (inAct.length ? rng.pick(inAct) : rng.pick(slots.filter((s) => s.position >= lo && s.position <= hi))).position
      const mut1 = rng.pick([...MUTATION_POOLS.spatial])
      const mut2 = rng.pick([
        ...MUTATION_POOLS.narrative,
        ...MUTATION_POOLS.atmospheric,
      ])
      return {
        slot: anchor,
        act: `${['I', 'II', 'III'][ai]} — ${['откровение', 'развитие', 'финал'][ai]}`,
        mutation: [mut1, mut2],
      }
    })
    const slot = slots.find((s) => s.position === appearances[0].slot)
    if (slot) slot.echo = [...(slot.echo ?? []), t.id]
    for (const a of appearances.slice(1)) {
      const s = slots.find((x) => x.position === a.slot)
      if (s) s.echo = [...(s.echo ?? []), t.id]
    }
    return {
      type: t.id,
      motif: `${t.what} (${themeKey})`,
      appearances,
    }
  })
  report.push(
    `echo-мотивы: ${echoMotifs.map((m) => `${m.type} ${m.appearances.map((a) => `P${a.slot}`).join('→')}`).join(' · ')} — мутация каждой рецидивной: 1 spatial + 1 narrative/atmospheric (F13)`
  )

  /* --- контракт (форма BatchContract) --- */
  const spread = [
    { rating: 'R+', count: slots.filter((s) => s.rating === 'R+').length },
    { rating: 'R', count: slots.filter((s) => s.rating === 'R').length },
  ]
  const wShare = Math.round(
    (slots.flatMap((s) => s.carriers).filter((c) => c.cls === 'W').length /
      (law.slotsTotal * law.core4Groups)) *
      100
  )
  const contract = {
    slug: opts.slug,
    theme: opts.theme,
    engine: 'per-theme raw-plus',
    engineLaw:
      'RAW+ сборка (№23) + расовый тег-блок (закон №3, kin-block: POS-теги + anti-shield NEG + свет/гардеробные хуки) + hair/eye из библиотеки E3 (A5P3F: независимо от палитры, подсказка ~50%) + echo-мотивы F13 (2-3 на батч, арка трёх актов, мутация ≥2 параметров из разных групп) + палитры вне окна ротации',
    engineWhy:
      'кины потеряны в RAW-миграции с T4-23 по небрежности генераторов (закон №3 не отменялся); практики A5 (hair/eye библиотека, echo-мотивы) не доехали в спеки RAW-эры — возвращены по приказу автора 2026-10-11',
    ...(opts.rebuildOf ? { rebuildOf: opts.rebuildOf } : {}),
    seed: opts.seed ?? Date.now(),
    createdAt: new Date().toISOString(),
    spread,
    slots: slots.map((s) => ({
      position: s.position,
      kind: s.kind,
      ...(s.oc ? { oc: s.oc } : {}),
      rating: s.rating,
      ...(s.race
        ? { race: s.race, raceId: s.raceId, kinPos: s.kinPos, kinNeg: s.kinNeg, ...(s.witnessHint ? { witnessHint: s.witnessHint } : {}) }
        : {}),
      pose: s.pose,
      poseName: s.poseName,
      poseRisk: s.poseRisk,
      palette: s.palette,
      paletteName: s.paletteName,
      kinetics: s.kinetics,
      carriers: s.carriers,
      hair: s.hair,
      eyes: s.eyes,
      hairEyeFrom: s.hairEyeFrom,
      register: s.register,
      ...(s.echo ? { echo: s.echo } : {}),
    })),
    ocRotation: ocPicks.map((n) => ({ name: n, served: opts.ocAppearances[n] ?? 0 })),
    racialCount: raceQuota,
    hairEye: {
      source: `specs/hair-eye-library.json (E3, A5P3F §III-C-2)`,
      ocCanonWins: true,
      suggestionFollowed: followed,
      suggestionDeviated: deviated,
      distinctHairOnMains: distinctHair,
    },
    echoMotifs,
    abPairs: [] as unknown[],
    carrierStats: { wSharePct: wShare },
    windowSlugs: opts.windowSlugs,
    channelStats: { note: 'RAW+ генератор: каналы доставки назначает сборщик по технике-карте' },
    platform: 'yodayo',
    laws: [
      `${law.slotsTotal}-слотовый закон (${law.ocSlots} OC + ${law.mainsTotal} мейн)`,
      `спред мейнов: R+×${law.rplusMains} · R×${law.nicheCount} (NICHE R · VOLT R+ · EXQUISITE R+)`,
      `расовый каст ${raceQuota} на мейнах (policy.law.racialDefault; закон №3 «race as mechanism»)`,
      'hair/eye E3: канон для OC, библиотека для мейнов, подсказка палитры ~50%',
      'echo-мотивы F13: 2-3, арка I→II→III, мутация 1 spatial + 1 narrative/atmospheric',
      `стеки core-4: ${law.core4Groups} мех-группы из ${mechs.length} на каждом слоте`,
    ],
  }

  const kinBlocks = [...raceByPosition.values()].map((r) => buildBlock(r))
  return { contract, slots, kinBlocks, echoMotifs, report }
}

/* ------------------------------------------------------------------ */
/* Отчёт-план (md для контракта)                                       */
/* ------------------------------------------------------------------ */

export function planMarkdown(plan: RawPlusPlan): string {
  const c = plan.contract as {
    slug: string
    theme: string
    spread: { rating: string; count: number }[]
    racialCount: number
    rebuildOf?: string
    hairEye: { suggestionFollowed: number; suggestionDeviated: number; distinctHairOnMains: number }
    seed: number
  }
  const L: string[] = []
  L.push(`# ${c.slug} «${c.theme}» — КОНТРАКТ RAW+ (генератор)`)
  L.push('')
  L.push(
    `**Сгенерировано**: ${new Date().toISOString().slice(0, 10)} · сид ${c.seed} · спред ${c.spread
      .map((s) => `${s.rating}×${s.count}`)
      .join(' · ')}${c.rebuildOf ? ` · ребилд ${c.rebuildOf}` : ''}`
  )
  L.push('')
  L.push('## Сводка плана')
  L.push('')
  for (const r of plan.report) L.push(`- ${r}`)
  L.push('')
  L.push('## Слоты')
  L.push('')
  L.push('| P | Вид | Рейтинг | Палитра | Волосы / Глаза | Раса | Стек | Echo |')
  L.push('|---|---|---|---|---|---|---|---|')
  for (const s of plan.slots) {
    const who = s.oc ? `OC ${s.oc}` : s.kind
    L.push(
      `| P${String(s.position).padStart(2, '0')} | ${who} | ${s.rating} | ${s.palette} | ${s.hairEyeFrom === 'canon' ? 'канон' : `${s.hair} / ${s.eyes}`} (${s.hairEyeFrom === 'suggestion' ? 'подск.' : s.hairEyeFrom === 'library' ? 'библ.' : '—'}) | ${s.race ? `${s.raceId} ${s.race}` : '—'} | ${s.carriers.map((x) => x.cls).join('')} | ${s.echo?.join(',') ?? ''} |`
    )
  }
  L.push('')
  if (plan.kinBlocks.length > 0) {
    L.push('## Расовые тег-блоки (закон №3 — вставляются в POS/NEG при сборке)')
    L.push('')
    for (const k of plan.kinBlocks) {
      L.push(`### ${k.id} ${k.name}`)
      L.push(`- POS: \`${k.pos}\``)
      L.push(`- NEG: \`${k.neg}\``)
      if (k.hook) L.push(`- HOOK (свет/гардероб): ${k.hook}`)
      L.push('')
    }
  }
  if (plan.echoMotifs.length > 0) {
    L.push('## Echo-мотивы (F13 — рецидив с мутацией)')
    L.push('')
    for (const m of plan.echoMotifs) {
      L.push(`### ${m.type} — ${m.motif}`)
      for (const a of m.appearances) {
        L.push(`- P${a.slot} (акт ${a.act}): мутация — ${a.mutation.join(' + ')}`)
      }
      L.push('')
    }
  }
  L.push('## Свидетели ниши')
  L.push('')
  const witnesses = plan.slots.filter((s) => s.witnessHint)
  if (witnesses.length > 0) {
    for (const s of witnesses) L.push(`- P${String(s.position).padStart(2, '0')} (${s.race}): ${s.witnessHint}`)
  } else {
    L.push('- рас на NICHE-слотах нет — гейт ниши спокоен')
  }
  L.push('')
  L.push('## Сборщику')
  L.push('')
  L.push('- POS: идентификационный сегмент = hair-тег + face-блок M17 (anime eyes (цвет), small nose, small mouth); кин-теги из блоков выше.')
  L.push('- NEG: anti-shield кинов + X Cut (рецепт v1.6.0) + фичи SOL-LOCKED не переносить в POS.')
  L.push('- Echo: каждая рецидивная явка мотива обязана нести ОБЕ мутации — иначе это повтор, не эхо (§56D-дух).')
  L.push('- BODY-SPECTRUM (H13) в план не входит — ждёт вердикта автора по рендеру T4-27.2 (§10).')
  L.push('- Якоря поз — болванки; при сборке уточняются, позы внутри батча уникальны.')
  return L.join('\n')
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(
      [
        'gen-rawplus — RAW+ генератор контрактов (кины + hair/eye E3 + echo F13 + окно)',
        '',
        '  bun thread4/tools/gen-rawplus.ts T4-28 "THEME NAME" [--seed N] [--races N] [--echo 2|3]',
        '                                     [--oc A,B,C] [--exquisite N] [--rebuild-of T4-NN] [--dry] [--force]',
        '  bun thread4/tools/gen-rawplus.ts --demo',
        '',
        'Квота рас — из policy.law.racialDefault (закон №3); перебивается --races на приказе автора (§10).',
      ].join('\n')
    )
    return
  }

  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const has = (name: string): boolean => args.includes(name)

  let slug: string
  let theme: string
  if (has('--demo')) {
    slug = 'T4-DEMO'
    theme = 'DEMO — песочница генератора (сухой план)'
  } else {
    slug = args[0]
    theme = args[1] ?? ''
    if (!/^T4-[\dA-Za-z.-]+$/.test(slug)) {
      console.error(`слаг «${slug}» не похож на T4-NN — смотри --help`)
      process.exit(1)
    }
    if (!theme) {
      console.error('тема обязательна: gen-rawplus.ts T4-28 "THE THEME"')
      process.exit(1)
    }
  }

  const seed = flag('--seed') ? Number(flag('--seed')) : Date.now()
  const races = flag('--races') ? Number(flag('--races')) : undefined
  const echo = flag('--echo') ? Number(flag('--echo')) : undefined
  const exquisite = flag('--exquisite') ? Number(flag('--exquisite')) : undefined
  const rebuildOf = flag('--rebuild-of')
  const ocOrder = flag('--oc') ? flag('--oc')!.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const dry = has('--demo') || has('--dry')

  /* живое состояние — только чтение, летопись не трогаем */
  const state = foldState(readEvents())

  const plan = planRawPlus({
    slug,
    theme,
    seed,
    ...(races !== undefined ? { races } : {}),
    ...(echo !== undefined ? { echo } : {}),
    ...(ocOrder ? { ocOrder } : {}),
    ...(exquisite !== undefined ? { exquisite } : {}),
    ...(rebuildOf ? { rebuildOf } : {}),
    windowSlugs: state.windowSlugs,
    ocAppearances: state.ocAppearances,
  })

  console.log(`\n${slug} «${theme}» — план RAW+`)
  for (const r of plan.report) console.log(`  · ${r}`)

  if (dry) {
    console.log('\n(сухой план — файлы не писаны)')
    return
  }

  const jsonPath = path.join(CONTRACTS_DIR, `${slug}.json`)
  const mdPath = path.join(CONTRACTS_DIR, `${slug}.md`)
  if (!has('--force') && fs.existsSync(jsonPath)) {
    console.error(`\nконтракт ${slug} уже существует — --force перезапишет`)
    process.exit(1)
  }
  writeJson(jsonPath, plan.contract)
  writeText(mdPath, planMarkdown(plan))
  console.log(`\nконтракт: ${jsonPath} + ${mdPath}`)
  console.log('дальше: сборка батча по плану (кины в POS/NEG, hair/eye в идентификацию, echo по аркам), затем check → deliver')
}

if (import.meta.main) main()
