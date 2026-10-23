/**
 * DRESS-PLAN — общий проход Дрессера над ГОТОВЫМ планом слотов.
 *
 * ПЕРВОПРИЧИНА (ворклог 2026-10-23, разбор hard-фейла T4-45 у автора):
 * gen-rawplus (файловая эра) одевал R+/X-слоты (тон-план №28, канальная
 * ротация G17, dressFor), а write-bridge (движковая эра) — НЕТ: контракт,
 * собранный из плана живого движка, приходил к писцу БЕЗ дресс-кода →
 * LLM сам выбирал вещь/тон/состояние → «suit» при bumps, бугорки без
 * тёмного слова, мокрое+сквозное — ровно тот класс hard-фейлов
 * rating-recipe (P4/P5/P27), который ремонт не может закрыть за 3 круга:
 * чинить нечего, контракт не нёс формулы канала.
 *
 * Этот проход — ЕДИНЫЙ источник дресс-кода для обоих путей: тон-план
 * (dark-квота ≥ bumps-квоты, light ≤ 3), каналы на ЕДИНИЦУ слота (§10-пара
 * и EXP-пара делят канал — вердикт атрибутирует канал, не случай), bumps
 * первым пока квота не закрыта (G17 ≥ 40%), garment из категории спеки
 * (мёртвых тканей в пулах нет — «suit» из LLM больше не приходит).
 *
 * Чистое ядро: без диска и летописи; rng приходит снаружи (детерминизм
 * сидом вызывающего — write-bridge: hash(slug::sha10), gen-rawplus: свой).
 */
import { channelsForTier, dressFor, type FabricTone } from './dresser'

/** Минимальный срез слота, достаточный для дресс-прохода (обе эры
 *  удовлетворяют этой форме — write-bridge SlotPlan и gen-rawplus RawSlot). */
export interface DressableSlot {
  position: number
  kind: string
  rating: string
  ab?: { pair: string | number; half?: string } | null
  exp?: { pairWith?: number; half?: string; letter?: string } | null
  fabricTone?: FabricTone
  dress?: {
    channel: string
    channelName: string
    category: string
    tone: string
    garment: string
    state: string[]
    underlayer: string
    weights: string[]
    negWeights?: string[]
    law: string
  }
}

export interface DressPlanOpts {
  theme: string
  /** детерминированный генератор (compiler makeRng().next) */
  rng?: () => number
  /** EXP-грамматика v1.9.0: веса RAW в POS (≤4 слота на батч, bumps/through) */
  weights?: boolean
  onReport?: (line: string) => void
}

const SCENE_WORDS = [
  'beach', 'pool', 'onsen', 'gym', 'stage', 'street', 'hotel', 'bedroom', 'home', 'void',
  'пляж', 'бассейн', 'зал', 'сцена', 'улица', 'отель', 'спальня', 'дом',
]

export function sceneHintOf(theme: string): string {
  return (
    theme
      .toLowerCase()
      .split(/[^a-zа-яё]+/)
      .map((w) => w.trim())
      .find((w) => SCENE_WORDS.includes(w)) ?? ''
  )
}

/** Канал — на ЕДИНИЦУ слота: §10-пара (ab) и EXP-пара (pairWith) делят канал. */
function unitOf(s: DressableSlot): string {
  if (s.ab) return `ab:${s.ab.pair}`
  if (s.exp?.pairWith) return `exp:${s.exp.pairWith}`
  return `solo:${s.position}`
}

/** Проход Дрессера. Мутирует слоты на месте (fabricTone + dress). */
export function dressPlan(slots: DressableSlot[], opts: DressPlanOpts): void {
  const rng = opts.rng ?? Math.random
  const rplusSlots = slots.filter((s) => s.rating === 'R+' || s.rating === 'X')
  /* тон-план строится ПО МЕЙНАМ (OC без дресс-кода №29 — их тон mid и
   * dark-места на OC не тратятся: демо 2026-10-16 вскрыл недобор, когда
   * OC съедали dark-места плана) */
  const rplusMainsT = rplusSlots.filter((s) => s.kind !== 'OC')
  const n = rplusMainsT.length
  if (n === 0) {
    for (const s of rplusSlots) if (!s.fabricTone) s.fabricTone = 'mid'
    return
  }
  const bumpsQuota = Math.min(n, Math.ceil(n * 0.4))
  const darkCount = Math.min(n, Math.max(Math.max(1, Math.ceil(n / 3)), bumpsQuota))
  const lightCount = Math.min(3, Math.max(1, Math.floor(n / 5)))
  const tonePlan: FabricTone[] = []
  for (let i = 0; i < n; i++) {
    if (i < darkCount) tonePlan.push('dark')
    else if (i < darkCount + lightCount) tonePlan.push('light')
    else tonePlan.push('mid')
  }
  /* shuffle Фишера-Йетса по rng — детерминизм сидом вызывающего */
  for (let i = tonePlan.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[tonePlan[i], tonePlan[j]] = [tonePlan[j] as FabricTone, tonePlan[i] as FabricTone]
  }
  /* пары первыми: одна единица плана — на обе половины (§10: тон на пару;
   * EXP-пара — полюса №27: dry-dark ↔ wet-light из одного плана) */
  let toneIdx = 0
  const pairedDone = new Set<string>()
  for (const s of rplusMainsT) {
    const unit = unitOf(s)
    if (unit.startsWith('solo:')) continue
    if (pairedDone.has(unit)) continue
    pairedDone.add(unit)
    const tone = tonePlan[toneIdx++] ?? 'mid'
    for (const half of rplusMainsT.filter((x) => unitOf(x) === unit)) {
      half.fabricTone = tone
    }
  }
  for (const s of rplusMainsT) {
    if (!unitOf(s).startsWith('solo:')) continue
    s.fabricTone = tonePlan[toneIdx++] ?? 'mid'
  }
  /* OC — явный mid в контракте (G17-инвариант «все R+ имеют тон» честный) */
  for (const s of rplusSlots) {
    if (s.kind === 'OC' && !s.fabricTone) s.fabricTone = 'mid'
  }
  /* квоты после парной раздачи: dark ≥ max(⌈n/3⌉, bumps-квоты), light ≤ 3 */
  const toneCount = (t: FabricTone) =>
    rplusMainsT.filter((s) => (s.fabricTone ?? 'mid') === t).length
  const soloRplus = rplusMainsT.filter((s) => unitOf(s).startsWith('solo:'))
  while (toneCount('dark') < Math.max(Math.ceil(n / 3), bumpsQuota)) {
    const cand = soloRplus.find((s) => (s.fabricTone ?? 'mid') === 'mid')
    if (!cand) break
    cand.fabricTone = 'dark'
  }
  while (toneCount('light') > 3) {
    const cand = soloRplus.find((s) => s.fabricTone === 'light')
    if (!cand) break
    cand.fabricTone = 'mid'
  }
  /* --- каналы + dressFor --- */
  const sceneHint = sceneHintOf(opts.theme)
  let weightsBudget = opts.weights ? 4 : 0 // максимум 4 весовых слота на батч
  const channelRot = new Map<string, number>()
  /* G17: bumps-квота в СЛОТАХ; EXP-слоты квоту не тратят (их канал — часть
   * гипотезы полюсов №27), но bumps им доступен на общем ротационном праве */
  let bumpsLeft = bumpsQuota
  const unitChannel = new Map<string, string>()
  for (const s of slots) {
    const tier = s.rating
    if (tier !== 'R+' && tier !== 'X') continue
    const tone: FabricTone = s.fabricTone ?? (tier === 'X' ? 'mid' : 'dark')
    const unit = unitOf(s)
    let channel = unitChannel.get(unit)
    if (!channel) {
      const candidates = channelsForTier(tier, tone)
      if (candidates.length === 0) continue
      /* G17: bumps — первым в очереди, пока квота не исчерпана (только R+
       * не-EXP: у X кандидаты through/bare — bumps там физически нет) */
      const slotCount = unit.startsWith('solo:') ? 1 : 2
      if (tier === 'R+' && s.kind !== 'EXP' && bumpsLeft >= slotCount && candidates.includes('bumps')) {
        channel = 'bumps'
        bumpsLeft -= slotCount
      } else {
        const rest = candidates.filter((c) => c !== 'bumps')
        const idx = channelRot.get(tier) ?? 0
        channelRot.set(tier, idx + 1)
        channel = (rest.length > 0 ? rest : candidates)[idx % Math.max(rest.length, 1)] as string
      }
      unitChannel.set(unit, channel)
    }
    const wantWeights =
      weightsBudget > 0 && (channel === 'bumps' || channel === 'through') && s.kind === 'EXP'
    if (wantWeights) weightsBudget--
    const code = dressFor({ tier, tone, channel, sceneHint, rng, wantWeights })
    if (code) {
      s.dress = {
        channel: code.channel,
        channelName: code.channelName,
        category: code.category,
        tone: code.tone,
        garment: code.garment,
        state: code.stateTags,
        underlayer: code.underlayer,
        weights: code.weights,
        /* Тур 4: веса NEG — rejection tags на всех R+/X, писец вплетает в NEG */
        negWeights: code.negWeights,
        law: code.law,
      }
      s.fabricTone = code.tone
    }
  }
  if (opts.onReport) {
    const dressedCount = slots.filter((s) => s.dress).length
    const channelCounts: Record<string, number> = {}
    for (const s of slots) if (s.dress) channelCounts[s.dress.channel] = (channelCounts[s.dress.channel] ?? 0) + 1
    opts.onReport(
      `ДРЕССЕР №29 (dress-plan): ${dressedCount} слотов одеты по политике — ${Object.entries(channelCounts)
        .map(([k, v]) => `${k} ×${v}`)
        .join(' · ')} (тон-план: dark ${toneCount('dark')} / mid ${toneCount('mid')} / light ${toneCount('light')}; G17: bumps-квота ${channelCounts['bumps'] ?? 0} ≥ 40% через-ткань-R+; сцена${sceneHint ? ` «${sceneHint}»` : ' — street по умолчанию'})`
    )
  }
}
