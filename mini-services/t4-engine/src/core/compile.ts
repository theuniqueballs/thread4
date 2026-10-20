/**
 * THREAD 4 ENGINE — THE COMPILER (constitution §3, sqlite edition).
 *
 * Diversity is ASSIGNED at compile time, not linted afterwards. The
 * request is Zod-validated BEFORE it reaches this module; the compiler
 * runs the planning gates (structure / exp-purity / floors / window / ab)
 * and commits {batch.compiled event + t4_batches projection + draft} in
 * ONE transaction. Deterministic: seed = sha256(theme + '|' + slug) —
 * same theme + same slug → same plan, forever.
 */
import crypto from 'node:crypto'
import type { Database } from 'bun:sqlite'

import { CANON, REGISTERS, type Rating, type SlotKind } from '../config/canon'
import type { BatchPlan, CompileRequest, SlotPlan } from '../config/schema'
import { payloadSha10 } from '../lib/canonical'
import { appendEventTx, withTransaction } from './chain'
import {
  getBatch,
  nextBatchNumber,
  paletteWindowUnion,
  upsertBatchFromCompile,
} from './projections'
import { scheduleSnapshot } from '../lib/persist'

/* ------------------------------------------------------------------ */
/* Seeded RNG — deterministic compiles (mulberry32, ported verbatim)   */
/* ------------------------------------------------------------------ */

function hashSeed(s: string): number {
  return crypto.createHash('sha256').update(s, 'utf-8').digest().readUInt32LE(0)
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
  pick<T>(arr: readonly T[]): T
  shuffle<T>(arr: readonly T[]): T[]
}

function makeRng(seed: number): Rng {
  const rand = mulberry32(seed)
  return {
    next: rand,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T,
    shuffle: <T>(arr: readonly T[]): T[] => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        const tmp = out[i]!
        out[i] = out[j]!
        out[j] = tmp
      }
      return out
    },
  }
}

/* ------------------------------------------------------------------ */
/* Domain error (maps to HTTP 422 — born wounded, nothing was written)  */
/* ------------------------------------------------------------------ */

export class CompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompileError'
  }
}

/* ------------------------------------------------------------------ */
/* Token bans — the eternal floors (rating-recipes.json)               */
/* ------------------------------------------------------------------ */

function floorFindings(texts: string[]): Receipt {
  const findings: string[] = []
  const joined = texts.join('\n').toLowerCase()
  for (const [group, tokens] of Object.entries(CANON.floors)) {
    for (const token of tokens) {
      if (joined.includes(token.toLowerCase())) {
        findings.push(`floors/${group}: banned token «${token}» в плане (eternal floors)`)
      }
    }
  }
  return hard('floors', findings)
}

/* ------------------------------------------------------------------ */
/* Palette assignment                                                  */
/* ------------------------------------------------------------------ */

const paletteId = (n: number): string => `P${String(n).padStart(3, '0')}`

function assignPalettes(
  rng: Rng,
  count: number,
  range: { first: number; last: number },
  exclude: Set<string>
): string[] {
  const pool: number[] = []
  for (let n = range.first; n <= range.last; n++) {
    if (!exclude.has(paletteId(n))) pool.push(n)
  }
  if (pool.length < count) {
    throw new CompileError(
      `window: доступно палитр ${pool.length}, нужно ${count} — фонд исчерпан окном (расширь палитру или сократи батч)`
    )
  }
  const shuffled = rng.shuffle(pool)
  return shuffled.slice(0, count).map(paletteId)
}

/* ------------------------------------------------------------------ */
/* The planning gates                                                  */
/* ------------------------------------------------------------------ */

interface Receipt {
  gate: string
  level: 'hard' | 'warn' | 'advisory'
  verdict: 'PASS' | 'FAIL' | 'WARN' | 'REPORT'
  findings: string[]
  notes?: string[]
}

const hard = (gate: string, findings: string[], notes?: string[]): Receipt => ({
  gate,
  level: 'hard',
  verdict: findings.length === 0 ? 'PASS' : 'FAIL',
  findings,
  ...(notes ? { notes } : {}),
})

const warn = (gate: string, findings: string[], notes?: string[]): Receipt => ({
  gate,
  level: 'warn',
  verdict: findings.length === 0 ? 'PASS' : 'WARN',
  findings,
  ...(notes ? { notes } : {}),
})

function gateStructure(slots: SlotPlan[], exp: number): Receipt {
  const f: string[] = []
  const oc = slots.filter((s) => s.kind === 'OC')
  const mains = slots.filter((s) => s.kind === 'MAIN')
  const niche = slots.filter((s) => s.kind === 'NICHE')
  const expSlots = slots.filter((s) => s.kind === 'EXP')
  if (slots.length !== CANON.slots.total + exp) {
    f.push(`слотов ${slots.length}, ожидается ${CANON.slots.total + exp} (ядро ${CANON.slots.total} + EXP ${exp})`)
  }
  if (oc.length !== CANON.slots.ocSlots) f.push(`OC-слотов ${oc.length}, ожидается ${CANON.slots.ocSlots}`)
  if (mains.length !== CANON.slots.rplusMains) {
    f.push(`R+-мейнов ${mains.length}, ожидается ${CANON.slots.rplusMains}`)
  }
  if (niche.length !== CANON.slots.nicheCount) {
    f.push(`NICHE-слотов ${niche.length}, ожидается ${CANON.slots.nicheCount}`)
  }
  if (expSlots.length !== exp) f.push(`EXP-слотов ${expSlots.length}, заявлено ${exp}`)
  const seenPalette = new Set<string>()
  for (const s of slots) {
    if (seenPalette.has(s.paletteId)) {
      f.push(`P${s.position}: палитра ${s.paletteId} повторяется в батче (ротация без повторов)`)
    }
    seenPalette.add(s.paletteId)
  }
  return hard('structure', f)
}

/** EXP-purity (batch verdict T4-34) — the plan-level invariants:
 *  (1) every EXP slot carries its radar marker program;
 *  (2) the program carries NO theme words (болванка без темы);
 *  (3) a pair shares the plan — pairWith resolves to an EXP slot. */
function gateExpPurity(slots: SlotPlan[], theme: string, exp: number): Receipt {
  const f: string[] = []
  const notes: string[] = []
  const expSlots = slots.filter((s) => s.kind === 'EXP')
  if (expSlots.length === 0) {
    notes.push('EXP-оверлея нет — гейт молчит (0 — только явным приказом)')
    return hard('exp-purity', f, notes)
  }
  const themeWords = theme
    .split(/[\s_-]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3)
  for (const s of expSlots) {
    if (s.exp == null) {
      f.push(`P${s.position}: EXP-слот без программы (letter/half/hypothesis) — радар не увидит`)
      continue
    }
    if (!/^[α-ω]$/.test(s.exp.letter)) {
      f.push(`P${s.position}: маркер не греческая буква (${s.exp.letter})`)
    }
    if (s.exp.pairWith != null) {
      const other = slots.find((x) => x.position === s.exp!.pairWith)
      if (!other || other.kind !== 'EXP') {
        f.push(`P${s.position}: пара EXP указывает на P${s.exp.pairWith}, которого нет или он не EXP`)
      }
    }
    if (themeWords.length > 0 && themeWords.some((w) => s.exp!.hypothesis.toLowerCase().includes(w))) {
      f.push(`P${s.position}: тема-слово в гипотезе EXP-болванки — EXP без темы (вердикт T4-34)`)
    }
  }
  notes.push(`EXP-слотов ${expSlots.length} (заявлено ${exp}) · тема-слов для фильтра ${themeWords.length}`)
  return hard('exp-purity', f, notes)
}

/** Window (закон №28 «ПРОСВЕТ-ЧЁТКОСТЬ»): the palette budget is honest. */
function gateWindow(
  windowUnion: number,
  freshNeeded: number,
  extensionPool: number,
  expNeeded: number
): Receipt {
  const f: string[] = []
  const notes: string[] = []
  const budget = CANON.palette.fund - windowUnion
  if (budget < freshNeeded) {
    f.push(
      `window: фонд ${CANON.palette.fund} − окно ${windowUnion} = ${budget} свежих палитр, нужно ${freshNeeded} — расширь фонд или очисти окно`
    )
  }
  if (extensionPool < expNeeded) {
    f.push(
      `EXP-бюджет: свободных extension-палитр ${extensionPool}, нужно ${expNeeded} (P106–P${CANON.palette.extensionLastId} — резерв EXP)`
    )
  }
  if (expNeeded > 0 && expNeeded < CANON.slots.expMax) {
    notes.push(
      `EXP ${expNeeded}/${CANON.slots.expMax}: вердикт T4-32 ждёт расширение до ${CANON.slots.expMax} (нужно 28 / окно ${windowUnion} / фонд ${CANON.palette.fund})`
    )
  }
  notes.push(`окно = ${windowUnion} палитр из ${CANON.palette.windowBatches} батчей · бюджет ${budget}`)
  return hard('window', f, notes)
}

/** A/B (policy ab.*): pairs within canon bounds, exactly one variable. */
function gateAb(slots: SlotPlan[], abPairs: number): Receipt {
  const f: string[] = []
  if (abPairs > 0 && (abPairs < CANON.ab.min || abPairs > CANON.ab.max)) {
    f.push(`A/B-пар ${abPairs}, канон ${CANON.ab.min}..${CANON.ab.max}`)
  }
  const byPair = new Map<number, SlotPlan[]>()
  for (const s of slots) {
    if (s.ab) {
      const list = byPair.get(s.ab.pair) ?? []
      list.push(s)
      byPair.set(s.ab.pair, list)
    }
  }
  for (const [pair, members] of byPair) {
    if (members.length !== 2) {
      f.push(`A/B-пара ${pair}: ${members.length} участников — ровно два (полы A и B)`)
      continue
    }
    const [a, b] = [members[0]!, members[1]!]
    if (a.ab?.half === b.ab?.half) f.push(`A/B-пара ${pair}: обе половины ${a.ab?.half}`)
    /* exactly-one-variable: same kind/rating/register, palette differs */
    if (a.kind !== b.kind || a.rating !== b.rating || a.register !== b.register) {
      f.push(`A/B-пара ${pair}: различается больше одной переменной (kind/rating/register общие)`)
    }
    if (a.paletteId === b.paletteId) {
      f.push(`A/B-пара ${pair}: палитра общая — единственная переменная обязана отличаться`)
    }
  }
  return warn('ab-single-variable', f)
}

/* ------------------------------------------------------------------ */
/* Diff vs previous delivered batch                                    */
/* ------------------------------------------------------------------ */

const RATING_ORDER: readonly Rating[] = ['PG-13', 'R', 'R+', 'X']
const ratingRank = (r: Rating): number => RATING_ORDER.indexOf(r)

function diffAgainstPrevious(prevPayload: string | null, slots: SlotPlan[]): { up: number; down: number; against: string | null } {
  if (prevPayload == null) return { up: 0, down: 0, against: null }
  let prevSlug: string | null = null
  let prevRatings: Rating[] = []
  try {
    const parsed = JSON.parse(prevPayload) as { slug?: string; slots?: { rating?: string }[] }
    prevSlug = typeof parsed.slug === 'string' ? parsed.slug : null
    prevRatings = (parsed.slots ?? [])
      .map((s) => s.rating)
      .filter((r): r is Rating => typeof r === 'string' && (RATING_ORDER as readonly string[]).includes(r))
  } catch {
    return { up: 0, down: 0, against: null }
  }
  const mine = slots.map((s) => s.rating)
  const n = Math.min(prevRatings.length, mine.length)
  let up = 0
  let down = 0
  for (let i = 0; i < n; i++) {
    const d = ratingRank(mine[i]!) - ratingRank(prevRatings[i]!)
    if (d > 0) up++
    if (d < 0) down++
  }
  return { up, down, against: prevSlug }
}

/* ------------------------------------------------------------------ */
/* The compiler                                                        */
/* ------------------------------------------------------------------ */

export interface CompileResult {
  plan: BatchPlan
  event: { id: string; at: string; seq: number }
  receipts: Receipt[]
  idempotentReplay: boolean
}

export function compileBatch(
  db: Database,
  req: CompileRequest,
  idempotencyKey?: string
): CompileResult {
  /* ---- slug resolution & duplicate guard --------------------------- */
  let slug: string
  if (req.slug) {
    slug = req.slug
  } else {
    slug = `T4-${String(nextBatchNumber(db)).padStart(2, '0')}`
  }
  const existing = getBatch(db, slug)
  if (existing != null && existing.status !== 'void') {
    throw new CompileError(
      `batch.compiled: слаг ${slug} уже существует (status ${existing.status}) — провенанс неприкосновенен: следующий номер свободен, void-слаг рекомпилируем (вердикт автора 2026-10-20)`
    )
  }

  /* ---- deterministic plan ------------------------------------------- */
  const seedInt = hashSeed(`${req.theme}|${slug}`)
  const rng = makeRng(seedInt)
  const createdAt = new Date().toISOString()

  const windowUnion = paletteWindowUnion(db, CANON.palette.windowBatches)
  const coreFresh = CANON.slots.total
  const expFresh = req.exp
  const extensionFree =
    CANON.palette.extensionLastId - CANON.palette.extensionFirstId + 1
  /* theme words must not leak into EXP programs — pre-computed ban set */
  const corePalettes = assignPalettes(
    rng,
    coreFresh,
    { first: CANON.palette.firstId, last: CANON.palette.lastId },
    windowUnion
  )
  const expPalettes = assignPalettes(
    rng,
    expFresh,
    { first: CANON.palette.extensionFirstId, last: CANON.palette.extensionLastId },
    new Set()
  )

  /* ---- slot assembly -------------------------------------------------- */
  const slots: SlotPlan[] = []
  const registers = REGISTERS
  const raceList = req.species.on && req.species.list.length > 0 ? req.species.list : null
  let raceCursor = 0

  /* 3 OC slots (positions 1..3) — author's OC themes, interleave law. */
  for (let i = 0; i < CANON.slots.ocSlots; i++) {
    const oc = req.ocThemes[i] ?? req.ocThemes[req.ocThemes.length - 1]!
    slots.push({
      position: i + 1,
      kind: 'OC' as SlotKind,
      rating: oc.rating,
      register: registers[i % registers.length]!,
      ocTheme: oc.theme,
      ...(raceList ? { race: raceList[raceCursor++ % raceList.length]! } : {}),
      paletteId: corePalettes[i]!,
    })
  }

  /* 21 mains: 14 R+ MAIN + 7 NICHE (law: mainsTotal/nicheCount). */
  let paletteCursor = CANON.slots.ocSlots
  for (let i = 0; i < CANON.slots.rplusMains; i++) {
    slots.push({
      position: slots.length + 1,
      kind: 'MAIN' as SlotKind,
      rating: 'R+',
      register: registers[(slots.length + 1) % registers.length]!,
      ...(raceList ? { race: raceList[raceCursor++ % raceList.length]! } : {}),
      paletteId: corePalettes[paletteCursor++]!,
    })
  }
  for (let i = 0; i < CANON.slots.nicheCount; i++) {
    /* NICHE ladder: PG-13 → R → R+ mix, deterministic rotation */
    const ladder: Rating[] = ['R', 'PG-13', 'R', 'R+', 'R', 'PG-13', 'R+']
    slots.push({
      position: slots.length + 1,
      kind: 'NICHE' as SlotKind,
      rating: ladder[i % ladder.length]!,
      register: registers[(slots.length + 1) % registers.length]!,
      ...(raceList ? { race: raceList[raceCursor++ % raceList.length]! } : {}),
      paletteId: corePalettes[paletteCursor++]!,
    })
  }

  /* EXP overlay (machine stubs — zero scribe discretion, verdict T4-34).
   * Pairs share the plan: pairWith links α-A ↔ α-B etc. */
  for (let i = 0; i < expFresh; i++) {
    const letter = CANON.expProgram.letters[i % CANON.expProgram.letters.length]!
    const hypothesis = CANON.expProgram.hypothesisTemplates[i % CANON.expProgram.hypothesisTemplates.length]!
    const half: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B'
    slots.push({
      position: CANON.slots.total + i + 1,
      kind: 'EXP' as SlotKind,
      rating: 'R+',
      register: 'young',
      paletteId: expPalettes[i]!,
      exp: {
        letter,
        half,
        ...(half === 'B' && i > 0 ? { pairWith: CANON.slots.total + i } : {}),
        hypothesis: `EXP ${letter}-${half} · ${hypothesis}`,
      },
    })
  }

  /* A/B pairs: one variable = palette (law ab.one_variable). The machine
   * syncs register so the pair differs in EXACTLY one field. */
  const mainPool = slots.filter((s) => s.kind === 'MAIN')
  for (let p = 1; p <= req.abPairs; p++) {
    const a = mainPool[(p * 2 - 2) % mainPool.length]!
    const b = mainPool[(p * 2 - 1) % mainPool.length]!
    b.register = a.register
    b.rating = a.rating
    a.ab = { pair: p, half: 'A' }
    b.ab = { pair: p, half: 'B' }
  }

  /* ---- planning gates -------------------------------------------------- */
  const receipts: Receipt[] = [
    gateStructure(slots, expFresh),
    gateExpPurity(slots, req.theme, expFresh),
    floorFindings([
      req.theme,
      req.notes ?? '',
      ...slots.map((s) => `${s.kind} ${s.ocTheme ?? ''} ${s.exp?.hypothesis ?? ''}`),
    ]),
    gateWindow(windowUnion.size, coreFresh, extensionFree, expFresh),
    gateAb(slots, req.abPairs),
  ]
  const hardPass = receipts.filter((r) => r.level === 'hard').every((r) => r.verdict === 'PASS')

  /* ---- diff vs previous delivered -------------------------------------- */
  const prev = recentDeliveredPayload(db)
  const diff = diffAgainstPrevious(prev, slots)

  const seedHex = crypto
    .createHash('sha256')
    .update(`${req.theme}|${slug}`, 'utf-8')
    .digest('hex')
    .slice(0, 16)
  const plan: BatchPlan = {
    slug,
    title: req.theme,
    theme: req.theme,
    engine: req.engine,
    seed: seedHex,
    slots,
    exp: expFresh,
    abPairs: req.abPairs,
    paletteWindow: {
      union: windowUnion.size,
      budget: CANON.palette.fund - windowUnion.size,
      extensionFree,
    },
    receipts,
    diff,
    sha10: '0000000000', /* set after canonical payload below */
    createdAt,
  }
  const payloadForHash: Record<string, unknown> = { ...plan }
  delete payloadForHash['sha10']
  payloadForHash['slots'] = slots.length
  const sha10 = payloadSha10(payloadForHash)
  plan.sha10 = sha10

  /* ---- atomic commit: event + projections + draft ---------------------- */
  const summary = `Скомпилирован ${slug} «${req.theme}»: ${slots.length} слотов (EXP ${expFresh}, A/B ${req.abPairs}), движок ${req.engine}${hardPass ? '' : ' — HARD FAIL планировочных гейтов'}`
  const data: Record<string, unknown> = {
    slug,
    theme: req.theme,
    engine: req.engine,
    slots: slots.length,
    exp: expFresh,
    abPairs: req.abPairs,
    hardPass,
    sha10,
    diffUp: diff.up,
    diffDown: diff.down,
    windowUnion: windowUnion.size,
    paletteBudget: CANON.palette.fund - windowUnion.size,
    receipts: receipts.map((r) => ({ gate: r.gate, level: r.level, verdict: r.verdict })),
  }

  let eventOut: { id: string; at: string; seq: number } = { id: '', at: '', seq: 0 }
  withTransaction(db, () => {
    const row = appendEventTx(db, {
      type: 'batch.compiled',
      summary,
      data,
      batchSlug: slug,
    })
    upsertBatchFromCompile(db, {
      slug,
      title: plan.title,
      theme: plan.theme,
      engine: plan.engine,
      slots,
      exp: expFresh,
      abPairs: req.abPairs,
      hardPass,
      diffUp: diff.up,
      diffDown: diff.down,
      payloadJson: JSON.stringify(plan),
      sha10,
      createdAt,
      eventId: row.id,
    })
    db.prepare(
      `INSERT INTO t4_drafts (slug, body, sha, created_at, event_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         body = excluded.body, sha = excluded.sha, created_at = excluded.created_at,
         event_id = excluded.event_id`
    ).run(
      slug,
      JSON.stringify({ ...req, slug, compiledAt: createdAt }),
      sha10,
      createdAt,
      row.id
    )
    if (idempotencyKey) {
      db.prepare(
        'INSERT OR REPLACE INTO t4_idempotency (key, endpoint, response, created_at) VALUES (?, ?, ?, ?)'
      ).run(
        idempotencyKey,
        'compile',
        JSON.stringify({ ok: true, data: { plan, event: { id: row.id, at: row.at, seq: row.seq } } }),
        createdAt
      )
    }
    eventOut = { id: row.id, at: row.at, seq: row.seq }
  })

  scheduleSnapshot(`compile:${slug}`)
  return { plan, event: eventOut, receipts, idempotentReplay: false }
}

function recentDeliveredPayload(db: Database): string | null {
  const rows = db
    .prepare("SELECT payload FROM t4_batches WHERE status = 'delivered' ORDER BY delivered_at DESC LIMIT 1")
    .all() as { payload: string }[]
  return rows[0]?.payload ?? null
}

/** Idempotency replay lookup (compile only — the one expensive POST). */
export function findIdempotentCompile(
  db: Database,
  key: string
): { plan: BatchPlan; event: { id: string; at: string; seq: number } } | null {
  const row = db
    .prepare("SELECT response FROM t4_idempotency WHERE key = ? AND endpoint = 'compile'")
    .get(key) as { response: string } | undefined
  if (row == null) return null
  try {
    const parsed = JSON.parse(row.response) as {
      data: { plan: BatchPlan; event: { id: string; at: string; seq: number } }
    }
    return parsed.data
  } catch {
    return null
  }
}
