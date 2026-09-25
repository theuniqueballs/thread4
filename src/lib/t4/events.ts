/**
 * THREAD 4 core — append-only event store (constitution §2: state is
 * DERIVED from events, never hand-maintained).
 *
 * Event: { id, at, type, summary, data? }. The log is JSONL, append-only.
 * Fold functions derive every piece of state the compiler and gates need.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

import { ensureDirs, EVENT_LOG, CHAIN_LOG, readText, writeText } from './fsutil'
import { scheduleSnapshot } from './persist'

export interface T4Event {
  id: string
  at: string
  type: string
  summary: string
  data?: Record<string, unknown>
}

export const EVENT_TYPES = [
  'era.born',
  'spec.imported',
  'law.ratified',
  'law.amended',
  'batch.compiled',
  'batch.delivered',
  'batch.void',
  'gate.run',
  'fixpass.paid',
  'scribe.drafted',
  'render.verdict',
  'taste.datum',
  'experiment.logged',
  'oc.appeared',
  'external.review',
  'debt.paid',
  'author.pinned',
  'note',
] as const

/** Рана при рождении (инцидент 2026-09-26): событие с U+FFFD не допускается
 *  в летопись — битая кодировка фиксируется на входе, а не в истории. */
function assertBornClean(summary: string): void {
  if (summary.includes('\uFFFD')) {
    throw new Error(
      'event born wounded: U+FFFD в summary — командный интерфейс передал кириллицу мимо UTF-8; событие отвергнуто'
    )
  }
  if (summary.length > 4000) {
    throw new Error('event born wounded: summary > 4000 символов')
  }
}

/** Источники вердиктов — enum вместо прозы (Issue #1 Кенни 2026-09-26):
 *  12 событий, 7 написаний, приёмник видел 1/12 — рана идентичности
 *  закрывается на рождении. 'author' — основной канал author-vision
 *  (вердикт автора №4). Единственное место истины для всех потребителей. */
export const VERDICT_SOURCES = [
  'vlm',
  'author',
  'author-batch',
  'author-verbatim',
  'author-oc',
] as const

function assertBornSemantics(type: string, data?: Record<string, unknown>): void {
  if (type === 'render.verdict') {
    const src = data?.source
    if (typeof src !== 'string' || !(VERDICT_SOURCES as readonly string[]).includes(src)) {
      throw new Error(
        `event born wounded: render.verdict требует data.source из enum [${VERDICT_SOURCES.join(', ')}] — проза-идентичность и пустота запрещены (Issue #1 Кенни)`
      )
    }
  }
}

export function appendEvent(
  type: string,
  summary: string,
  data?: Record<string, unknown>
): T4Event {
  assertBornClean(summary)
  assertBornSemantics(type, data)
  ensureDirs()
  const evt: T4Event = {
    id: crypto.randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    type,
    summary,
    ...(data ? { data } : {}),
  }
  const rawLine = JSON.stringify(evt)
  fs.appendFileSync(EVENT_LOG, rawLine + '\n', 'utf-8')
  extendChain(rawLine, evt.id)
  /* durability: событие записано — состояние меняется, фиксируем в git */
  scheduleSnapshot(`event:${type}`)
  return evt
}

export function readEvents(): T4Event[] {
  ensureDirs()
  let raw: string
  try {
    raw = fs.readFileSync(EVENT_LOG, 'utf-8')
  } catch {
    return []
  }
  const out: T4Event[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as T4Event)
    } catch {
      // a corrupted line never kills the fold — append-only resilience
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Хеш-цепь летописи (Залп 1 «Правда»)                                 */
/*                                                                     */
/* log.jsonl — истина; chain.jsonl — append-only индекс:               */
/*   { seq, id, hash }, hash = sha256(prevHash + '|' + rawLine).       */
/* Ручная правка старой строки ломает ВСЮ последующую цепь — громко.   */
/* Цепь только удлиняется; rebase (bootstrap) — объявленная операция,  */
/* легальна после vault-восстановления.                                */
/* ------------------------------------------------------------------ */

const GENESIS = 'GENESIS'

function normLine(l: string): string {
  return l.replace(/[\r\n]+$/, '')
}

function chainHash(prev: string, rawLine: string): string {
  return crypto.createHash('sha256').update(`${prev}|${normLine(rawLine)}`, 'utf-8').digest('hex')
}

export interface ChainLink {
  seq: number
  id: string
  hash: string
}

export function readChain(): ChainLink[] {
  const raw = readText(CHAIN_LOG)
  if (raw == null) return []
  const out: ChainLink[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const p = JSON.parse(t) as ChainLink
      if (typeof p.seq === 'number' && typeof p.hash === 'string') out.push(p)
    } catch {
      // битая строка цепи — сама по себе сигнал; verifyChain её увидит
    }
  }
  return out
}

/** Вычислить эталонную цепь поверх текущего log.jsonl (без записи). */
function computeChainOverLog(): { links: ChainLink[]; rawLines: string[] } {
  let raw = ''
  try {
    raw = fs.readFileSync(EVENT_LOG, 'utf-8')
  } catch {
    return { links: [], rawLines: [] }
  }
  const rawLines = raw.split('\n').map(normLine).filter((l) => l.length > 0)
  const links: ChainLink[] = []
  let prev = GENESIS
  for (let i = 0; i < rawLines.length; i++) {
    const hash = chainHash(prev, rawLines[i])
    let id = '?'
    try {
      id = (JSON.parse(rawLines[i]) as { id?: string }).id ?? '?'
    } catch {
      // не-parse строка остаётся в цепи как сырое звено — tamper-detector
    }
    links.push({ seq: i + 1, id, hash })
    prev = hash
  }
  return { links, rawLines }
}

/** Rebase: построить chain.jsonl с нуля поверх текущего лога.
 *  Легальна только как объявленная операция (vault-восстановление, bootstrap). */
export function bootstrapChain(): { links: number; head: string } {
  const { links } = computeChainOverLog()
  writeText(CHAIN_LOG, links.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return { links: links.length, head: links[links.length - 1]?.hash ?? '' }
}

/** Продлить цепь новым звеном. Хвост цепи обязан совпадать с логом;
 *  расхождение = тампер-тревога, запись события отвергается. */
function extendChain(rawLine: string, id: string): void {
  const stored = readChain()
  const { links } = computeChainOverLog() // включает только что дописанное событие
  if (stored.length === 0) {
    // цепи ещё нет (первый запуск после Залпа 1) — строим целиком
    writeText(CHAIN_LOG, links.map((l) => JSON.stringify(l)).join('\n') + '\n')
    return
  }
  // хвост stored обязан быть префиксом computed
  for (let i = 0; i < stored.length; i++) {
    if (!links[i] || stored[i].hash !== links[i].hash) {
      throw new Error(
        `chain tamper detected at seq ${i + 1}: летопись правлена руками после записи цепи — событие отвергнуто (см. bun thread4/cli.ts verify)`
      )
    }
  }
  if (stored.length !== links.length - 1) {
    // дыра между цепью и логом (крах между двумя append) — достраиваем хвост честно
    const tail = links.slice(stored.length)
    fs.appendFileSync(
      CHAIN_LOG,
      tail.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf-8'
    )
    return
  }
  const last = links[links.length - 1]
  fs.appendFileSync(CHAIN_LOG, JSON.stringify({ seq: last.seq, id, hash: last.hash }) + '\n', 'utf-8')
}

export interface ChainVerdict {
  events: number
  storedLinks: number
  ok: boolean
  head: string | null
  problems: string[]
}

/** Проверка целостности: эталон (log) vs хранимая цепь. */
export function verifyChain(): ChainVerdict {
  const { links } = computeChainOverLog()
  const stored = readChain()
  const problems: string[] = []
  if (stored.length === 0) problems.push('цепь отсутствует — запусти: bun thread4/cli.ts chain')
  const n = Math.min(stored.length, links.length)
  for (let i = 0; i < n; i++) {
    if (stored[i].hash !== links[i].hash) {
      problems.push(`расхождение на seq ${i + 1} (id ${stored[i].id}): событие правлено после записи`)
      break
    }
  }
  if (stored.length > links.length) problems.push('цепь длиннее лога — звенья из ниоткуда')
  if (stored.length < links.length && problems.length === 0)
    problems.push(`хвост цепи короче лога на ${links.length - stored.length} (лечится: bun thread4/cli.ts verify --heal)`)
  return {
    events: links.length,
    storedLinks: stored.length,
    ok: problems.length === 0,
    head: links[links.length - 1]?.hash ?? null,
    problems,
  }
}

/** Достроить хвост цепи, ЕСЛИ хранимый префикс совпадает с эталоном. */
export function healChainTail(): { healed: number; ok: boolean; problems: string[] } {
  const stored = readChain()
  const { links } = computeChainOverLog()
  for (let i = 0; i < stored.length; i++) {
    if (!links[i] || stored[i].hash !== links[i].hash) {
      return {
        healed: 0,
        ok: false,
        problems: [`расхождение на seq ${i + 1} — heal невозможен, летопись правлена (или это tamper)`],
      }
    }
  }
  if (stored.length >= links.length) return { healed: 0, ok: true, problems: [] }
  const tail = links.slice(stored.length)
  fs.appendFileSync(
    CHAIN_LOG,
    tail.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf-8'
  )
  return { healed: tail.length, ok: true, problems: [] }
}

/* ------------------------------------------------------------------ */
/* Derived state (the fold)                                            */
/* ------------------------------------------------------------------ */

export interface BatchRecord {
  slug: string
  theme: string
  title?: string
  deliveredAt?: string
}

export interface T4DerivedState {
  batches: BatchRecord[] // compiled batches in slug order
  windowSlugs: string[] // last 3 delivered (or fewer)
  ocAppearances: Record<string, number> // OC name -> times served
  voidedSlugs: string[] // batch.void — закрытые по приказу автора
  openDebts: string[]
  lastEventAt: string | null
}

/** Delivered = batch.delivered present; window = last 3 delivered. */
export function foldState(events: T4Event[]): T4DerivedState {
  const batches = new Map<string, BatchRecord>()
  const ocAppearances: Record<string, number> = {}
  const voidedSlugs: string[] = []
  const openDebts: string[] = []
  let lastEventAt: string | null = null

  for (const e of events) {
    lastEventAt = e.at
    const d = e.data ?? {}
    if (e.type === 'batch.compiled' && typeof d.slug === 'string') {
      const slug = d.slug as string
      const existing = batches.get(slug)
      batches.set(slug, {
        slug,
        theme: (d.theme as string) ?? existing?.theme ?? '',
        title: (d.title as string) ?? existing?.title,
        deliveredAt: existing?.deliveredAt,
      })
    }
    if (e.type === 'batch.delivered' && typeof d.slug === 'string') {
      const slug = d.slug as string
      const existing = batches.get(slug)
      batches.set(slug, {
        slug,
        theme: (d.theme as string) ?? existing?.theme ?? '',
        title: (d.title as string) ?? existing?.title,
        deliveredAt: e.at,
      })
    }
    if (e.type === 'batch.void' && typeof d.slug === 'string') {
      const slug = d.slug as string
      if (!voidedSlugs.includes(slug)) voidedSlugs.push(slug)
    }
    if (e.type === 'oc.appeared' && typeof d.name === 'string') {
      const name = d.name as string
      ocAppearances[name] = (ocAppearances[name] ?? 0) + 1
    }
    if (e.type === 'note' && typeof d.debt === 'string') {
      openDebts.push(d.debt as string)
    }
    // долг погашен: гасим первый долг, содержащий строку из data.debt
    if (e.type === 'debt.paid' && typeof d.debt === 'string') {
      const idx = openDebts.findIndex((x) => x.includes(d.debt as string))
      if (idx >= 0) openDebts.splice(idx, 1)
    }
  }

  const delivered = [...batches.values()]
    .filter((b) => b.deliveredAt != null)
    .sort((a, b) => (a.deliveredAt! < b.deliveredAt! ? -1 : 1))
  const windowSlugs = delivered.slice(-3).map((b) => b.slug)

  /* Залп 1: batch.void гасит долги — закрытый слот не может числиться
     открытым вопросом (призрачный долг T4-06, найден 2026-09-26). */
  const openDebtsClean = openDebts.filter(
    (x) => !voidedSlugs.some((slug) => x.includes(slug))
  )

  return {
    batches: [...batches.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    windowSlugs,
    ocAppearances,
    voidedSlugs,
    openDebts: openDebtsClean,
    lastEventAt,
  }
}

/** Next batch number: max+1 среди НЕ закрытых (void) слагов. */
export function nextBatchNumber(batches: BatchRecord[], voidedSlugs: string[] = []): number {
  let max = 0
  for (const b of batches) {
    if (voidedSlugs.includes(b.slug)) continue
    const m = /^T4-(\d+)$/.exec(b.slug)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}
