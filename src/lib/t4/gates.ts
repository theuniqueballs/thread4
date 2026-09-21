/**
 * THREAD 4 core — THE GATES (constitution §4, §9).
 *
 * Three tiers: hard (a delivered batch passes these FIRST RUN — always),
 * warn (receipted, must be acknowledged in the batch worklog), advisory
 * (reports only). The rating gate grades every slot against its recipe;
 * the diversity gate reads the same constants the contract printed.
 */
import crypto from 'node:crypto'
import path from 'node:path'

import { BATCHES_DIR, CONTRACTS_DIR, readJson, readText } from './fsutil'
import { appendEvent, foldState, readEvents } from './events'
import { getBans, getCarriers, getOCCanon, getRaces, getRatingRecipes } from './specs'
import { LAWS } from './compiler'

export type GateLevel = 'hard' | 'warn' | 'advisory'
export type Verdict = 'PASS' | 'FAIL' | 'WARN' | 'REPORT'

export interface GateReceipt {
  gate: string
  level: GateLevel
  verdict: Verdict
  findings: string[]
}

export interface GatesResult {
  slug: string
  runIndex: number
  sha10: string
  receipts: GateReceipt[]
  hardPass: boolean
  firstRunClean: boolean
  at: string
}

/* ------------------------------------------------------------------ */
/* Batch file parsing                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedSlot {
  position: number
  header: string
  anchor: string
  meta: string
  genre: string // OC | NICHE | VOLT | EXQUISITE ('' if absent)
  thesis: string
  canon: string
  stack: string[]
  pos: string
  neg: string
}

export interface ParsedBatch {
  slug: string
  text: string
  title: string
  slots: ParsedSlot[]
}

const GENRES = ['OC', 'NICHE', 'VOLT', 'EXQUISITE'] as const

function genreOf(meta: string): string {
  const u = meta.toUpperCase()
  for (const g of GENRES) {
    if (new RegExp(`\\b${g}\\b`).test(u)) return g
  }
  return ''
}

export function parseBatch(slug: string, text: string): ParsedBatch {
  const titleMatch = /#\s*THREAD 4[^\n]*?Batch\s+(T4-\d+)[^\n]*?["«]([^"»]+)["»]/i.exec(text)
  const title = titleMatch ? titleMatch[2] : ''
  const slots: ParsedSlot[] = []
  const slotRe = /^P(\d{1,2})\s*—\s*(.+)$/gm
  const marks: { pos: number; n: number; anchor: string }[] = []
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(text)) !== null) {
    marks.push({ pos: m.index, n: parseInt(m[1], 10), anchor: m[2] })
  }
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].pos
    const to = i + 1 < marks.length ? marks[i + 1].pos : text.length
    const block = text.slice(from, to)
    const lines = block.split('\n')
    const header = lines[0] ?? ''
    const grab = (key: string): string => {
      const re = new RegExp(`^${key}:\\s*(.*)$`, 'm')
      const mm = re.exec(block)
      return mm ? mm[1].trim() : ''
    }
    const posMatch = /^POS:\s*\n([\s\S]*?)(?=\nNEG:|\n[^ \n]|\n*$)/m.exec(block)
    const negMatch = /^NEG:\s*\n([\s\S]*?)(?=\n[^ \n]|\n*$)/m.exec(block)
    const stackLine = grab('Stack')
    slots.push({
      position: marks[i].n,
      header,
      anchor: marks[i].anchor.replace(/\s*\(.*$/, ''),
      meta: header.replace(/^[^（(]*[（(]/, '').replace(/[)）]\s*$/, ''),
      genre: genreOf(header.replace(/^[^（(]*[（(]/, '').replace(/[)）]\s*$/, '')),
      thesis: grab('THESIS'),
      canon: grab('Canon'),
      stack: stackLine
        ? (stackLine.match(/CR-[A-Z]\d{2}/g) ?? [])
        : [],
      pos: posMatch ? posMatch[1].trim() : '',
      neg: negMatch ? negMatch[1].trim() : '',
    })
  }
  return { slug, text, title, slots }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TIER_ORDER: Record<string, number> = { 'PG-13': 0, PG13: 0, R: 1, 'R+': 2, RPLUS: 2, X: 3, XXX: 4 }

function tierOf(meta: string): string {
  const u = meta.toUpperCase()
  // order matters: XXX before X, R+ before R («R+ ·» — \b after '+' never fires)
  if (/\bXXX\b/.test(u)) return 'XXX'
  if (/\bR\+/.test(u) || /\bRPLUS\b/.test(u)) return 'R+'
  if (/\bPG-13\b/.test(u) || /\bPG13\b/.test(u)) return 'PG-13'
  if (/\bX\b/.test(u)) return 'X'
  if (/\bR\b/.test(u)) return 'R'
  return ''
}

function recipeKey(tier: string): string {
  if (tier === 'PG-13') return 'PG13'
  if (tier === 'R+') return 'RPLUS'
  return tier // R, X, XXX
}

function countSignals(haystackLower: string, signals: string[]): number {
  let n = 0
  for (const s of signals) {
    if (haystackLower.includes(s.toLowerCase())) n += 1
  }
  return n
}

const HEDGES = ['maybe', 'perhaps', 'slightly', 'almost', 'sort of', 'kind of', 'a bit']

const XXX_SIGNALS = [
  'sex', 'sexual act', 'intercourse', 'penetration', 'creampie', 'cum ',
  'cumshot', 'semen', 'blowjob', 'handjob', 'masturbat',
]

/* ------------------------------------------------------------------ */
/* Gate runner                                                         */
/* ------------------------------------------------------------------ */

export function runGates(slug: string, dryRun = false): GatesResult | null {
  const file = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (file == null) return null

  const batch = parseBatch(slug, file)
  const contract = readJson<{
    slots: { position: number; rating: string; race?: string; carriers: { id: string }[] }[]
  }>(path.join(CONTRACTS_DIR, `${slug}.json`))
  const recipes = getRatingRecipes()
  const bans = getBans()
  const carriers = getCarriers()
  const ocCanon = getOCCanon()

  const receipts: GateReceipt[] = []
  const hard = (gate: string, findings: string[]) =>
    receipts.push({ gate, level: 'hard', verdict: findings.length ? 'FAIL' : 'PASS', findings })
  const warn = (gate: string, findings: string[]) =>
    receipts.push({ gate, level: 'warn', verdict: findings.length ? 'WARN' : 'PASS', findings })
  const advisory = (gate: string, findings: string[]) =>
    receipts.push({ gate, level: 'advisory', verdict: 'REPORT', findings })

  /* ---------------- 1. structure (hard) ---------------- */
  {
    const f: string[] = []
    if (batch.slots.length !== LAWS.slotsTotal) {
      f.push(`слотов ${batch.slots.length}, ожидается ${LAWS.slotsTotal} (${LAWS.ocSlots} OC + ${LAWS.mainsTotal} мейнов — вердикт T4-02)`)
    }
    const mains = batch.slots.filter((s) => s.genre !== 'OC')
    const ocSlots = batch.slots.filter((s) => s.genre === 'OC')
    if (ocSlots.length !== LAWS.ocSlots) f.push(`OC-слотов ${ocSlots.length}, ожидается ${LAWS.ocSlots}`)
    if (mains.length !== LAWS.mainsTotal) f.push(`мейнов ${mains.length}, ожидается ${LAWS.mainsTotal}`)
    for (const s of batch.slots) {
      if (s.pos === '') f.push(`P${s.position}: пустой POS`)
      if (s.neg === '') f.push(`P${s.position}: пустой NEG`)
      if (s.thesis === '') f.push(`P${s.position}: нет THESIS`)
      if (s.genre === '') f.push(`P${s.position}: жанр не назван в шапке (OC/NICHE/VOLT/EXQUISITE — вердикт T4-02)`)
      if (s.pos && !/masterpiece/i.test(s.pos)) f.push(`P${s.position}: POS без quality-тегов`)
      if (s.pos && !/anime eyes/i.test(s.pos)) f.push(`P${s.position}: нет фейс-лока (anime eyes)`)
      if (s.pos && !/anime style/i.test(s.pos)) f.push(`P${s.position}: нет опенера (anime style)`)
    }
    // OC slots must carry canon lines
    for (const s of batch.slots.filter((x) => x.position <= 3)) {
      if (s.canon === '') f.push(`P${s.position} (OC): нет Canon-строки`)
    }
    hard('structure', f)
  }

  /* ---------------- 2. floors (hard) ---------------- */
  {
    const f: string[] = []
    const floors = recipes?.eternal_floors ?? {}
    for (const s of batch.slots) {
      const neg = s.neg.toLowerCase()
      for (const term of floors.genital_lock ?? []) {
        if (!neg.includes(term.toLowerCase())) {
          f.push(`P${s.position}: генитальный лок пропускает «${term}»`)
          break
        }
      }
      const loliTerms = floors.anti_loli ?? []
      const loliHits = loliTerms.filter((t) => neg.includes(t.toLowerCase())).length
      if (loliHits < 4) {
        f.push(`P${s.position}: анти-лоли флоор слаб (${loliHits}/${loliTerms.length} терминов) — нужно ≥4`)
      }
      for (const term of floors.leak_guard ?? []) {
        if (!neg.includes(term.toLowerCase())) {
          f.push(`P${s.position}: лика-гарда пропускает «${term}»`)
          break
        }
      }
      // candle guard: required unless the concept itself names the light source
      const posLower = s.pos.toLowerCase()
      const conceptCalls =
        /candle|lantern|torch|chandelier|lamp|brazier/.test(posLower)
      if (!conceptCalls) {
        for (const term of floors.candle_guard ?? []) {
          if (!neg.includes(term.toLowerCase())) {
            f.push(`P${s.position}: свечная гарда пропускает «${term}»`)
            break
          }
        }
      }
      // face guard
      for (const term of floors.face_guard ?? []) {
        if (!neg.includes(term.toLowerCase())) {
          f.push(`P${s.position}: фейс-гарда пропускает «${term}»`)
          break
        }
      }
      // maturity tags (N30): milf is ALWAYS banned in POS; adult woman /
      // mature female are warn-level (batch-wide MILF skew receipt)
      if (/\b(milf|milfs)\b/i.test(s.pos)) {
        f.push(`P${s.position}: тег зрелости в POS («milf») — N30: зрелость только нарративом`)
      }
      // XXX never
      const posLow = s.pos.toLowerCase()
      for (const t of XXX_SIGNALS) {
        if (posLow.includes(t)) {
          f.push(`P${s.position}: XXX-сигнал в POS («${t.trim()}») — вечный потолок`)
          break
        }
      }
    }
    hard('floors', f)
  }

  /* ---------------- 3. rating-recipe (hard) ---------------- */
  {
    const f: string[] = []
    const tiers = recipes?.tiers ?? {}
    const signalMinDefault: Record<string, number> = { 'PG-13': 2, R: 1, 'R+': 2, X: 2 }
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (!tier) {
        f.push(`P${s.position}: рейтинг не распознан в шапке («${s.meta}»)`)
        continue
      }
      const recipe = tiers[recipeKey(tier)]
      if (!recipe) continue
      // сигнал-теги считаются в POS — NEG границу держит, а не зарабатывает
      const posLower = s.pos.toLowerCase()
      const negLower = s.neg.toLowerCase()
      const signals = countSignals(posLower, recipe.signals)
      const min = recipe.signal_min ?? signalMinDefault[tier] ?? 1
      if (signals < min) {
        f.push(
          `P${s.position}: заявлен ${tier}, сигнал-тегов рецепта ${signals}/${min} — рейтинг не заработан (рецепт: ${recipe.signals.slice(0, 5).join(', ')}…)`
        )
      }
      // HARD-CLAIM (вердикт T4-03: 14/15 R+ слотов не дотянули): тир с
      // signals_hard обязан нести именованный edge-объект в POS — усилители
      // (see-through / wet clothes / tight clothes) рендерер решает в
      // безопасную сторону, объект — рисует
      const hardSignals = recipe.signals_hard ?? []
      if (hardSignals.length > 0) {
        const hard = countSignals(posLower, hardSignals)
        const hardMin = recipe.hard_min ?? 1
        if (hard < hardMin) {
          f.push(
            `P${s.position}: заявлен ${tier}, но HARD-сигнала нет (${hard}/${hardMin}) — edge назван объектом: ${hardSignals.slice(0, 4).join(', ')} (вердикт T4-03: «выглядит эротично, но ничего эротического не делает»)`
          )
        }
      }
      // механизм-осознанный контр-NEG (вердикт T4-03: «только купальник»):
      // активный механизм держит СВОЙ boundary — lifted-термины в NEG глушат
      for (const [mechName, m] of Object.entries(recipe.mechanisms ?? {})) {
        const mHard = m.hard ?? []
        if (!mHard.some((h) => posLower.includes(h.toLowerCase()))) continue
        for (const t of m.counter_neg ?? []) {
          if (!negLower.includes(t.toLowerCase())) {
            f.push(`P${s.position}: механизм «${mechName}» требует контр-NEG «${t}» в NEG`)
          }
        }
        for (const t of m.counter_neg_lifted ?? []) {
          if (negLower.includes(t.toLowerCase())) {
            f.push(
              `P${s.position}: механизм «${mechName}» заглушен — «${t}» в NEG закрывает грудь и душит сигнал (вердикт T4-03)`
            )
          }
        }
      }
      // counter-NEG: at least one boundary term present
      const counterHit = (recipe.counter_neg ?? []).some((t) => negLower.includes(t.toLowerCase()))
      if (!counterHit) {
        f.push(`P${s.position}: контр-NEG не держит границу тира (нужно ≥1 из: ${(recipe.counter_neg ?? []).slice(0, 3).join(', ')})`)
      }
      // no above-tier signals (overclaim) — but a higher-tier token that is a
      // SUBSTRING of this tier's own signal phrase is by design (e.g. R+ «taped
      // nipples» contains the X token «nipples») — not an overclaim
      const myOrder = TIER_ORDER[tier] ?? 0
      const mySignals = recipe?.signals ?? []
      for (const [otherKey, other] of Object.entries(tiers)) {
        const otherTier =
          otherKey === 'PG13' ? 'PG-13' : otherKey === 'RPLUS' ? 'R+' : otherKey
        if ((TIER_ORDER[otherTier] ?? 0) > myOrder && otherTier !== 'XXX') {
          const over = (other.signals ?? []).filter(
            (sig) =>
              s.pos.toLowerCase().includes(sig.toLowerCase()) &&
              !mySignals.some((m) => m.toLowerCase().includes(sig.toLowerCase()))
          )
          if (over.length >= 1 && tier !== 'X') {
            f.push(`P${s.position}: заявлен ${tier}, но несёт сигнал выше тиром: «${over[0]}»`)
          }
        }
      }
    }
    hard('rating-recipe', f)
  }

  /* ---------------- 4. canon (hard) ---------------- */
  {
    const f: string[] = []
    const ocText = (name: string) => {
      const oc = ocCanon?.ocs[name]
      if (!oc) return null
      return {
        hair: String(oc.hair ?? ''),
        eyes: String(oc.eyes ?? ''),
      }
    }
    for (const s of batch.slots.filter((x) => x.position <= 3)) {
      const nameMatch = /\b(Sue|Miyu|Yui|Sol|Noa|Doe|Lua|Nix|Vae|Ash|Mab|Lyn|Rue|Zia|Rin|Una|Vera)\b/.exec(
        s.header + ' ' + s.canon
      )
      if (!nameMatch) {
        f.push(`P${s.position}: OC не опознан в шапке`)
        continue
      }
      const oc = ocText(nameMatch[1])
      if (!oc) continue
      const hairWords = (oc.hair.match(/[a-z]+/gi) ?? []).filter(
        (w) => w.length > 3 && !['hair', 'with', 'held', 'long', 'into'].includes(w.toLowerCase())
      )
      const eyeWords = (oc.eyes.match(/[a-z]+/gi) ?? []).filter(
        (w) => w.length > 3 && !['eyes', 'with', 'held'].includes(w.toLowerCase())
      )
      const hay = (s.canon + ' ' + s.pos).toLowerCase()
      const hairHit = hairWords.some((w) => hay.includes(w.toLowerCase()))
      const eyeHit = eyeWords.some((w) => hay.includes(w.toLowerCase()))
      if (!hairHit) f.push(`P${s.position} (${nameMatch[1]}): канон-лок волос не виден`)
      if (!eyeHit) f.push(`P${s.position} (${nameMatch[1]}): канон-лок глаз не виден`)
    }
    hard('canon', f)
  }

  /* ---------------- 5. diversity (hard) ---------------- */
  {
    const f: string[] = []
    const mechOf = (cls: string) => carriers?.class_defs?.[cls]?.mech ?? ''
    const clsOf = (id: string) => (/^CR-([A-Z])/.exec(id) ?? [])[1] ?? '?'
    const allStacked: string[] = []
    let sheerFrames = 0
    let rplusCount = 0
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (tier === 'R+' || tier === 'X') {
        rplusCount += 1
        const groups = new Set(s.stack.map((id) => mechOf(clsOf(id))))
        const classes = new Set(s.stack.map((id) => clsOf(id)))
        if (s.stack.length < 4) {
          f.push(`P${s.position}: стек ${s.stack.length}/4 носителей (core-4)`)
        }
        if (groups.size < 4) {
          f.push(`P${s.position}: механо-групп ${groups.size}/4 (${[...groups].join(',') || 'пусто'})`)
        }
        if (classes.size < 4) {
          f.push(`P${s.position}: классов ${classes.size}/4`)
        }
        const sheerIds = (s.stack ?? []).filter((id) => {
          const c = Object.values(carriers?.classes ?? {})
            .flat()
            .find((x) => x.id === id)
          return c?.sheer_family === true
        })
        if (sheerIds.length > 2) {
          f.push(`P${s.position}: sheer-носителей ${sheerIds.length} > 2`)
        }
        if (sheerIds.length > 0) sheerFrames += 1
      }
      allStacked.push(...s.stack)
    }
    // моно-носитель N28 (фикс после T4-03: CR-W27 вставал во все 15 R+/X
    // слотов — lruPick не дедуплицировал внутри батча): один ID ≤4 слотов
    const perCarrier: Record<string, number> = {}
    for (const id of batch.slots.flatMap((s) => s.stack)) {
      perCarrier[id] = (perCarrier[id] ?? 0) + 1
    }
    for (const [id, n] of Object.entries(perCarrier)) {
      if (n > 4) f.push(`моно-носитель ${id} в ${n} слотах > 4 — моно-механизм N28`)
    }
    const wCount = allStacked.filter((id) => clsOf(id) === 'W').length
    const wShare = allStacked.length ? Math.round((wCount / allStacked.length) * 100) : 0
    if (wShare > 45) f.push(`W-класс ${wShare}% > 45% (моно-механизм)`)
    if (rplusCount > 0) {
      const sheerPct = Math.round((sheerFrames / rplusCount) * 100)
      if (sheerPct > 40) f.push(`sheer-кадры ${sheerPct}% > 40% R+ слотов (N28-ловушка)`)
    }
    const poseIds = batch.slots.map((s) => (/\bPL\d{1,3}\b/.exec(s.header) ?? [])[0]).filter(Boolean)
    if (new Set(poseIds).size !== poseIds.length) f.push('позы не уникальны в батче')
    // palette ids are the underscore form (P77_LATE_MILK) — the bare P\d+ form
    // would catch the slot's own position marker (P01…) and never fail
    const palIds = batch.slots
      .map((s) => (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(s.header) ?? [])[0])
      .filter(Boolean)
    if (poseIds.length === LAWS.slotsTotal && palIds.length !== LAWS.slotsTotal) {
      f.push(`слотов с палитрой в шапке: ${palIds.length}/${LAWS.slotsTotal}`)
    }
    if (palIds.length >= LAWS.slotsTotal && new Set(palIds).size < LAWS.slotsTotal) {
      f.push('палитры не уникальны в батче')
    }
    hard('diversity', f)
  }

  /* ---------------- 6. window (hard, vacuous on clean slate) ------- */
  {
    const f: string[] = []
    const state = foldState(readEvents())
    if (state.windowSlugs.length > 0 && contract) {
      const myPoses = new Set(
        batch.slots.map((s) => (/\bPL\d{1,3}\b/.exec(s.header) ?? [])[0]).filter(Boolean)
      )
      const myPals = new Set(
        batch.slots.map((s) => (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(s.header) ?? [])[0]).filter(Boolean)
      )
      for (const w of state.windowSlugs) {
        const wc = readJson<{ slots: { pose: string; palette: string }[] }>(
          path.join(CONTRACTS_DIR, `${w}.json`)
        )
        if (!wc) continue
        for (const s of wc.slots) {
          if (myPoses.has(s.pose)) f.push(`поза ${s.pose} конфликтует с окном (${w})`)
          if (myPals.has(s.palette)) f.push(`палитра ${s.palette} конфликтует с окном (${w})`)
        }
      }
    }
    hard('window', f)
  }

  /* ---------------- 7. budget (warn) ---------------- */
  {
    const f: string[] = []
    const target = bans?.word_budget.pos_target ?? 300
    const hardCap = bans?.word_budget.pos_hard ?? 400
    for (const s of batch.slots) {
      const words = s.pos.split(/\s+/).filter(Boolean).length
      if (words > hardCap) f.push(`P${s.position}: POS ${words} слов > ${hardCap}`)
      else if (words > target) f.push(`P${s.position}: POS ${words} слов (цель ${target}) — плотнее`)
      const hedges = HEDGES.filter((h) => s.pos.toLowerCase().includes(h)).length
      if (hedges > (bans?.hedge_budget ?? 2)) f.push(`P${s.position}: хеджей ${hedges} > 2`)
    }
    warn('budget', f)
  }

  /* ---------------- 8. cadence (warn) ---------------- */
  {
    const f: string[] = []
    const closers: Record<string, number> = { other: 0 }
    for (const s of batch.slots) {
      const sentences = s.pos.split(/(?<=[.!?…"\u00bb])\s+/).filter(Boolean)
      const last = sentences[sentences.length - 1] ?? ''
      if (/[«"„]/.test(last) || /"\s*$/.test(last)) closers.dialogue = (closers.dialogue ?? 0) + 1
      else if (/—\s*\S+[.,]?\s*$/.test(last)) closers['fragment-pair'] = (closers['fragment-pair'] ?? 0) + 1
      else if (/\b(waited|still|again|on)\.\s*$/i.test(last)) closers['image-close'] = (closers['image-close'] ?? 0) + 1
      else closers.other += 1
    }
    const total = batch.slots.length || 1
    for (const [cls, n] of Object.entries(closers)) {
      if (n / total > 0.6 && cls !== 'other') {
        f.push(`клоузер-формула: ${cls} ${Math.round((n / total) * 100)}% > 60% (N25-ловушка)`)
      }
    }
    warn('cadence', f)
  }

  /* ---------------- 8b. niche legibility (warn — вердикт T4-02) ----- */
  {
    // Автор не увидел NICHE в T4-02 → ниша обязана быть видна:
    // раса делает физическую работу (теги расы в POS) + свидетель в кадре.
    const f: string[] = []
    const racesSpec = getRaces()
    const nicheSlots = batch.slots.filter((s) => s.genre === 'NICHE')
    const WITNESS_WORDS = [
      'mirror', 'shop glass', 'security monitor', 'door gap', 'propped phone',
      'traffic mirror', 'level gauge', 'window pane', 'wet street', 'elevator brass',
      'photo frame', 'spoon', 'watch face', 'car hood', 'fountain edge', 'witness',
    ]
    for (const s of nicheSlots) {
      const posLower = s.pos.toLowerCase()
      // race legibility: tokens of the assigned race (name + features) in POS
      const slot = contract?.slots?.find((x) => x.position === s.position)
      const raceName = slot?.race ?? ''
      if (raceName) {
        const raceEntry = racesSpec?.races.find(
          (r) => raceName.toLowerCase().includes(r.name.toLowerCase().split(' (')[0]) ||
            r.name.toLowerCase().includes(raceName.toLowerCase().split(' (')[0])
        )
        const tokens = new Set(
          [
            ...raceName.toLowerCase().replace(/[()-]/g, ' ').split(/\s+/),
            ...(raceEntry?.features ?? []).join(' ').toLowerCase().replace(/[()-]/g, ' ').split(/\s+/),
          ].filter((w) => w.length > 3 && !['girl', 'kin', 'with'].includes(w))
        )
        const hits = [...tokens].filter((w) => posLower.includes(w)).length
        if (hits < 2) {
          f.push(`P${s.position}: NICHE-раса «${raceName}» не читается в POS (тегов расы ${hits}/2) — раса делает физическую работу в кадре`)
        }
      }
      const witnessHit = WITNESS_WORDS.some((w) => posLower.includes(w))
      if (!witnessHit && raceName) {
        f.push(`P${s.position}: NICHE без свидетеля в кадре (mirror/glass/monitor/phone/gauge…) — свидетель держит невозможное`)
      }
    }
    if (nicheSlots.length === 0 && batch.slots.length === LAWS.slotsTotal) {
      f.push('NICHE-слотов нет — жанровая структура батча сломана')
    }
    warn('niche-legibility', f)
  }

  /* ---------------- 8c. prop geometry (warn — вердикт T4-02) -------- */
  {
    // Штурвал в T4-02: «небольшая хуёвая геометрия расположения» —
    // сложный проп требует названных якорей контакта (руки/ноги/корпус).
    const f: string[] = []
    const COMPLEX_PROPS = [
      'wheel', 'helm', 'valve', 'ladder', 'stairs', 'staircase', 'railing', 'rail',
      'bicycle', 'handlebar', 'rope', 'pulley', 'crane', 'swing', 'scaffold',
      'scaffolding', 'mast', 'tiller', 'treadmill', 'steering', 'oar', 'winch',
    ]
    const ANCHORS = [
      'hand on', 'hands on', 'hands at', 'fingers around', 'fingers curled', 'grip',
      'gripping', 'grips', 'grip on', 'braced', 'brace', 'foot on', 'feet on',
      'feet braced', 'feet planted', 'palm flat', 'palm on', 'knee on', 'elbow on',
      'shoulder against', 'leaning against', 'lean against', 'arched against',
      'heels planted', 'toes on', 'fingertips on', 'wrapped around', 'wound around',
      'knuckles white', 'soles flat', 'held fast', 'anchored',
    ]
    for (const s of batch.slots) {
      // тег-блок — то, что рендерер обязан нарисовать (до первой точки);
      // метафоры прозы («her leg as its staircase») пропами не считаются
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const prop = COMPLEX_PROPS.find((p) => new RegExp(`\\b${p}\\b`).test(tagBlock))
      if (!prop) continue
      const posLower = s.pos.toLowerCase()
      const anchorHits = ANCHORS.filter((a) => posLower.includes(a)).length
      if (anchorHits < 2) {
        f.push(`P${s.position}: сложный проп «${prop}» с ${anchorHits}/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)`)
      }
    }
    warn('prop-geometry', f)
  }

  /* ---------------- 8d. claim visibility (warn — вердикт T4-03) ------ */
  {
    // Вердикт T4-03: R+ сигнал заявлен на зоне, которую стейджинг закрывает
    // (рубашка на талии, юбка, плащ), либо слоёв столько, что рендер путает
    // порядок («чулки сквозь джинсы, майка поверх рубашки»), либо OC-слот
    // ушёл позой от камеры. Зона сигнала = LEAD, открыта камере.
    const f: string[] = []
    const LOWER_COVERS = [
      'skirt', 'dress', 'cloak', 'cape', 'coat', 'apron', 'happi',
      'tied at waist', 'tied at the waist', 'shirt tied', 'towel around waist',
      'waist wrap', 'sarong', 'long shirt', 'untucked shirt', 'peplum',
    ]
    const CHEST_COVERS = [
      'buttoned shirt', 'buttoned-up', 'buttoned up', 'zipped up', 'zipped to',
      'closed jacket', 'buttoned jacket', 'turtleneck', 'high-neck', 'closed coat',
    ]
    const TOP_LAYERS = [
      'shirt', 'tee', 't-shirt', 'tank', 'camisole', 'blouse', 'sweater',
      'pullover', 'hoodie', 'jacket', 'coat', 'blazer', 'cardigan', 'happi',
      'tunic', 'turtleneck', 'button-down', 'flannel', 'jersey', 'varsity',
      'parka', 'poncho', 'robe', 'overalls',
    ]
    const GARMENT_NOUNS = new Set([
      ...TOP_LAYERS, 'leotard', 'bodysuit', 'swimsuit', 'bikini', 'microbikini',
      'bra', 'panties', 'thong', 'boyshorts', 'lingerie', 'garter belt',
      'stockings', 'thighhighs', 'socks', 'jeans', 'pants', 'trousers',
      'breeches', 'shorts', 'skirt', 'dress', 'apron', 'towel', 'nightgown',
      'slip', 'corset', 'harness', 'wrap', 'sarong', 'sash', 'obi', 'bolero',
      'kimono', 'happi', 'leggings', 'fishnets', 'jersey', 'uniform', 'cloak', 'cape',
    ])
    const POSE_AWAY = [
      'forward fold', 'prone', 'facedown', 'face down', 'from behind',
      'back to camera', 'back turned', 'bent away',
    ]
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (tier !== 'R+' && tier !== 'X') continue
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const posLower = s.pos.toLowerCase()
      // word-boundary матчинг: «escaped» не должен ловиться как «cape»
      const coverIn = (list: string[]) =>
        list.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tagBlock))
      // 1) нижняя зона сигнала закрыта верхним предметом
      const lowerClaim = ['cameltoe', 'camel toe', 'visible pantyline', 'pantyline'].some((c) =>
        tagBlock.includes(c)
      )
      if (lowerClaim) {
        const cover = coverIn(LOWER_COVERS)
        if (cover) {
          f.push(
            `P${s.position}: зона сигнала (низ) закрыта «${cover}» — cameltoe/pantyline не виден камере; открой зону или перевези claim (вердикт T4-03)`
          )
        }
      }
      // 2) грудная on-skin зона закрыта застёгнутым верхом
      const chestClaim = ['taped nipples', 'topless with tape', 'handbra'].some((c) =>
        tagBlock.includes(c)
      )
      if (chestClaim) {
        const cover = coverIn(CHEST_COVERS)
        if (cover) {
          f.push(
            `P${s.position}: зона сигнала (грудь) закрыта «${cover}» — tape/handbra не виден камере (вердикт T4-03)`
          )
        }
      }
      // 3) слоевой хаос: ≥5 предметов одежды в тег-блоке
      const garments = [...GARMENT_NOUNS].filter((g) => new RegExp(`\\b${g}\\b`).test(tagBlock))
      if (garments.length >= 5) {
        f.push(
          `P${s.position}: ${garments.length} предметов одежды в тег-блоке (${garments.slice(0, 5).join(', ')}) — ≤2 слоя на зону, зона сигнала ≤1 (вердикт T4-03: слои путают рендер)`
        )
      }
      // 3b) стопка верхних слоёв: ≥3 верхних предметов
      const tops = TOP_LAYERS.filter((g) => new RegExp(`\\b${g}\\b`).test(tagBlock))
      if (tops.length >= 3) {
        f.push(
          `P${s.position}: стопка верхних слоёв ${tops.length} (${tops.join(', ')}) — «майка поверх рубашки» ломает порядок слоёв (вердикт T4-03)`
        )
      }
      // 4) OC-слот позой уходит от камеры — зона сигнала не читается
      if (s.genre === 'OC') {
        const away = POSE_AWAY.find((p) => tagBlock.includes(p) || posLower.includes(p))
        if (away) {
          f.push(
            `P${s.position}: OC-слот с позой «${away}» — зона сигнала уходит от камеры; OC = любимые персонажи автора, камера-смотрящие позы (вердикт T4-03)`
          )
        }
      }
    }
    warn('claim-visibility', f)
  }

  /* ---------------- 9. simcheck (warn) ---------------- */
  {
    const f: string[] = []
    const state = foldState(readEvents())
    // бойлерплейт (quality-теги, фейс-лок N31) общий для всех промптов —
    // не считаем предложением автора, иначе J=1.00 на каждом кадре
    const isBoilerplate = (s: string) =>
      /masterpiece|best quality|anime artstyle/.test(s) ||
      /her face is rendered in stylized/.test(s)
    const sentencesOf = (batchParsed: ParsedBatch) =>
      batchParsed.slots.flatMap((s) =>
        s.pos
          .split(/[.!?]\s+/)
          .map((x) => x.trim().toLowerCase())
          .filter((x) => x.length > 40 && !isBoilerplate(x))
      )
    const mySentences = new Set(sentencesOf(batch))
    for (const w of state.windowSlugs) {
      const wText = readText(path.join(BATCHES_DIR, `${w}.md`))
      if (!wText) continue
      const wBatch = parseBatch(w, wText)
      const wSentences = sentencesOf(wBatch)
      for (const mine of mySentences) {
        for (const theirs of wSentences) {
          const j = jaccard(words(mine), words(theirs))
          if (j > 0.7) {
            f.push(`похоже на ${w}: «${mine.slice(0, 60)}…» (J=${j.toFixed(2)})`)
          }
        }
      }
    }
    if (f.length > 8) f.splice(8, f.length, `…и ещё ${f.length - 8} пар`)
    warn('simcheck', f)
  }

  /* ---------------- 10. freq report (advisory) ---------------- */
  {
    const f: string[] = []
    const STOP = new Set(
      'the a an and or of in on at to with her his its from into over under is are was were be been by as for that this it she they them their not no but all one two'.split(' ')
    )
    const freq: Record<string, number> = {}
    for (const s of batch.slots) {
      const seen = new Set<string>()
      for (const w of s.pos.toLowerCase().match(/[a-z']+/g) ?? []) {
        if (STOP.has(w) || w.length < 5 || seen.has(w)) continue
        seen.add(w)
        freq[w] = (freq[w] ?? 0) + 1
      }
    }
    const tics = Object.entries(freq)
      .filter(([, n]) => n >= 8)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([w, n]) => `${w} ${n}/21`)
    if (tics.length) f.push(`кандидаты в тики: ${tics.join(' · ')}`)
    else f.push('тиков не обнаружено')
    advisory('freq-report', f)
  }

  /* ---------------- 11. usage (advisory) ---------------- */
  {
    const f: string[] = []
    const stacked = batch.slots.flatMap((s) => s.stack)
    f.push(`носителей в стеках: ${stacked.length}; уникальных: ${new Set(stacked).size}`)
    f.push(`R+ слотов: ${batch.slots.filter((s) => tierOf(s.meta) === 'R+').length}; X: ${batch.slots.filter((s) => tierOf(s.meta) === 'X').length}`)
    advisory('usage', f)
  }

  /* ---------------- receipt + event ---------------- */
  const sha10 = crypto.createHash('sha256').update(file).digest('hex').slice(0, 10)
  const priorRuns = readEvents().filter(
    (e) => e.type === 'gate.run' && e.data?.slug === slug
  ).length
  const runIndex = priorRuns + 1
  const hardPass = receipts.filter((r) => r.level === 'hard').every((r) => r.verdict === 'PASS')
  const result: GatesResult = {
    slug,
    runIndex,
    sha10,
    receipts,
    hardPass,
    firstRunClean: hardPass && runIndex === 1,
    at: new Date().toISOString(),
  }
  if (!dryRun) {
    appendEvent(
      'gate.run',
      `${slug} гейты: прогон #${runIndex}, hard ${hardPass ? 'PASS' : 'FAIL'}${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''} (sha ${sha10})`,
      {
        slug,
        run: runIndex,
        sha10,
        hardPass,
        firstRunClean: result.firstRunClean,
        hardFails: receipts
          .filter((r) => r.level === 'hard' && r.verdict === 'FAIL')
          .map((r) => r.gate),
        warns: receipts.filter((r) => r.level === 'warn' && r.verdict === 'WARN').length,
      }
    )
  }
  return result
}

/* ------------------------------------------------------------------ */
/* utils                                                               */
/* ------------------------------------------------------------------ */

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 3))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}
