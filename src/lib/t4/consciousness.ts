/**
 * THREAD 4 — источник сознания (фаза 2, итерация 3, 2026-10-21).
 *
 * ДО: состояние гейтов/ротации фолдило ТОЛЬКО файл-летопись
 * (thread4/events/log.jsonl — readEvents). Прод-SQLite живого движка
 * существовал отдельно (миграция 399/421 звеньев, см. аудит-док §7) —
 * система «думала» файл-эрой и не видела историю движковой эры.
 *
 * ПОСЛЕ (осознанное переключение): фолд состояния читает ПРОД-цепь живого
 * движка (twin :3201 GET /v1/events, READ-ONLY) как БАЗУ и компенсирует
 * файл-хвост (события файл-летописи, которых в прод-цепи ещё нет — id
 * мигрированных звеньев совпадают 1-в-1, проверено на живых 399). Объединение
 * — строгое надмножество каждого источника: окно ротации не сужается,
 * счётчики ОС и runIndex не недосчитываются (паритет-батарея + инструмент
 * tools/state-parity.ts — доказательство на живой цепи).
 *
 * Честность: движок недоступен → ConsciousnessUnavailableError (роуты
 * отдают 503, НЕ молча откатываются на файл). Аварийный источник файл-эры —
 * только явным T4_STATE_SOURCE=file (задокументирован в аудит-доке §10).
 * Самотест и исторические инструменты (gates-dump, дрифт-отчёт) пинят
 * 'file' — они эталоны файл-эры, их контракты не переписываются.
 *
 * Пишущая сторона НЕ тронута: события рождаются в файл-летописи
 * (appendEvent, git-снапшоты persist-слоя); прод-цепь растёт своими
 * потоками движковой эры. Сходимость эпох — следующий шаг (§10 «что дальше»).
 */
import { foldState, readEvents, type T4Event } from './events'

export type ChronicleSource = 'file' | 'engine'

export const TWIN_ORIGIN = process.env.T4_RUST_ORIGIN ?? 'http://127.0.0.1:3201'

/** Строка источника из env. Только 'engine' включает движок; всё прочее
 *  (включая unset→engine-по-умолчанию путь ниже) — явный выбор. */
function sourceFromEnv(raw: string | undefined): ChronicleSource | null {
  if (raw === 'engine' || raw === 'file') return raw
  return null
}

/** Разрешить источник сознания. Без переменной — движок (само переключение
 *  эпохи зашито в код и заквитанцевано событием consciousness.switched);
 *  T4_STATE_SOURCE=file — аварийный выход файл-эры. НЕИЗВЕСТНОЕ значение —
 *  fail-safe в файл-эру: оператор, пинивший источник с опечаткой, не должен
 *  получить молчаливое «движок» (диагностика GET /api/t4/consciousness
 *  покажет source: 'file' — несоответствие ожиданию видно сразу). */
export function resolveSource(env: Record<string, string | undefined> = process.env): ChronicleSource {
  const raw = env.T4_STATE_SOURCE
  if (raw === undefined) return 'engine'
  return sourceFromEnv(raw) ?? 'file'
}

/** Движок недоступен, когда сознание требует живой движок. Роуты мапят
 *  в честный 503 (см. isConsciousnessError); CLI печатает подсказку. */
export class ConsciousnessUnavailableError extends Error {
  readonly origin: string
  constructor(origin: string, cause: string) {
    super(
      `сознание — живой движок (${origin}), но он недоступен: ${cause}. ` +
        `Подними twin (mini-services/t4-engine-rs/dev.sh, :3201) или задай T4_STATE_SOURCE=file — аварийный источник файл-эры`
    )
    this.name = 'ConsciousnessUnavailableError'
    this.origin = origin
  }
}

export function isConsciousnessError(e: unknown): e is ConsciousnessUnavailableError {
  return e instanceof ConsciousnessUnavailableError
}

/** Строка звена из GET /v1/events twin'а (envelope data.events). */
export interface EngineEventRow {
  seq?: number
  id: string
  at: string
  type: string
  summary: string
  hash?: string
  prev?: string
  data?: unknown
}

/** Адаптер: строка прод-цепи → T4Event файл-эры. data приходит JSON-строкой
 *  из SQLite (rpc.rs отдаёт уже распарсенный Value, но защитимся от string).
 *  hash/prev/seq — служебные поля цепи, в T4Event не переносятся (фолд
 *  состояния их не читает), порядок сохраняется 1-в-1. Чистая функция. */
export function engineRowsToEvents(rows: EngineEventRow[]): T4Event[] {
  return rows.map((r) => {
    let data: Record<string, unknown> | undefined
    if (typeof r.data === 'string' && r.data.length > 0) {
      try {
        data = JSON.parse(r.data) as Record<string, unknown>
      } catch {
        data = undefined
      }
    } else if (r.data != null && typeof r.data === 'object') {
      data = r.data as Record<string, unknown>
    }
    return { id: r.id, at: r.at, type: r.type, summary: r.summary, data }
  })
}

export interface ChronicleComposition {
  engine: number
  fileTail: number
  total: number
}

export interface Chronicle {
  events: T4Event[]
  source: ChronicleSource
  /** Заполнено только при source='engine'. */
  composition?: ChronicleComposition
}

/** Объединение хроник (чистая функция): прод-цепь базой (порядок seq) +
 *  файл-хвост в порядке файла. Дедуп по id — миграция сохраняла исходные
 *  id (399 общих звеньев на живой цепи), поэтому событие считается ОДИН
 *  раз: oc.appeared не двойнится, runIndex не раздувается. */
export function uniteChronicle(
  engineEvents: T4Event[],
  fileEvents: T4Event[]
): { events: T4Event[]; composition: ChronicleComposition } {
  const seen = new Set<string>()
  for (const e of engineEvents) seen.add(e.id)
  const tail = fileEvents.filter((e) => !seen.has(e.id))
  return {
    events: [...engineEvents, ...tail],
    composition: { engine: engineEvents.length, fileTail: tail.length, total: engineEvents.length + tail.length },
  }
}

/* ------------------------------------------------------------------ */
/* Чтение хроники                                                      */
/* ------------------------------------------------------------------ */

/** Кэш прод-цепи: append-only журнал, TTL короткий — внешние POST /v1/events
 *  (потоки движковой эры) видны с лагом ≤ TTL, файл-хвост всегда свежий
 *  (readEvents инвалидируется size+mtime). */
const ENGINE_TTL_MS = 15_000
let engineCache: { at: number; events: T4Event[] } | null = null

async function fetchEngineEvents(origin: string): Promise<T4Event[]> {
  const events: T4Event[] = []
  let after = 0
  /* Пагинация twin'а: after=seq, limit ≤ 1000, total в ответе. 10 страниц
   * × 1000 — потолок на цепь (защита от зацикливания при битом total). */
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${origin}/v1/events?after=${after}&limit=1000`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      throw new ConsciousnessUnavailableError(origin, `GET /v1/events ответил HTTP ${res.status}`)
    }
    const raw: unknown = await res.json()
    const data = (raw as { data?: { events?: EngineEventRow[]; returned?: number; total?: number } }).data
    if (!data || !Array.isArray(data.events)) {
      throw new ConsciousnessUnavailableError(origin, 'GET /v1/events вернул не envelope с events')
    }
    events.push(...engineRowsToEvents(data.events))
    const returned = data.returned ?? data.events.length
    const total = data.total ?? events.length
    if (returned === 0 || events.length >= total) break
    after = (data.events[data.events.length - 1]?.seq as number) ?? after + returned
  }
  return events
}

/** Хроника для фолда состояния. source=file — файл-летопись (эталоны
 *  файл-эры); source=engine — прод-цепь живого движка + файл-хвост;
 *  движок недоступен → ConsciousnessUnavailableError (честный 503). */
export async function readChronicle(): Promise<Chronicle> {
  const source = resolveSource()
  if (source === 'file') {
    return { events: readEvents(), source }
  }
  try {
    await warmConsciousness()
  } catch (e) {
    if (e instanceof ConsciousnessUnavailableError) throw e
    const cause = e instanceof Error ? e.message : String(e)
    throw new ConsciousnessUnavailableError(TWIN_ORIGIN, cause)
  }
  const united = uniteChronicle(engineCache!.events, readEvents())
  return { events: united.events, source, composition: united.composition }
}

/** Прогрев прод-цепи. Роуты и CLI-команды зовут ЕГО перед синхронными
 *  конвейерами (runGates/compileBatch/deliverBatch — синхронные, глубокие
 *  вызовы consciousnessEvents() внутри). Не молчит: недоступный движок —
 *  ConsciousnessUnavailableError ещё здесь. */
export async function warmConsciousness(): Promise<void> {
  if (resolveSource() === 'file') return
  if (engineCache && Date.now() - engineCache.at < ENGINE_TTL_MS) return
  try {
    const events = await fetchEngineEvents(TWIN_ORIGIN)
    engineCache = { at: Date.now(), events }
  } catch (e) {
    if (e instanceof ConsciousnessUnavailableError) throw e
    const cause = e instanceof Error ? e.message : String(e)
    throw new ConsciousnessUnavailableError(TWIN_ORIGIN, cause)
  }
}

/** Синхронное чтение хроники для фолда внутри синхронных конвейеров
 *  (runGates: window/simcheck/runIndex; compileBatch: ротация ОС;
 *  deliver/scribe-гарды). source=file — файл-летопись. source=engine —
 *  прод-цепь ИЗ КЭША ПРОГРЕВА (warmConsciousness в начале запроса/команды)
 *  ∪ СВЕЖИЙ файл-хвост (appendEvent событие, рождённое в этом же запросе,
 *  видно сразу). Не прогрето → ConsciousnessUnavailableError — НЕ молчаливый
 *  откат на файл. */
export function consciousnessEvents(): T4Event[] {
  const source = resolveSource()
  if (source === 'file') return readEvents()
  if (!engineCache || Date.now() - engineCache.at >= ENGINE_TTL_MS) {
    throw new ConsciousnessUnavailableError(
      TWIN_ORIGIN,
      'кэш прод-цепи не прогрет — сначала await warmConsciousness() в этом запросе/команде'
    )
  }
  return uniteChronicle(engineCache.events, readEvents()).events
}

/* ------------------------------------------------------------------ */
/* Паритет (инструмент доказательства)                                 */
/* ------------------------------------------------------------------ */

export interface ParityReport {
  composition: ChronicleComposition
  window: { file: string[]; engine: string[]; union: string[]; equal: boolean }
  voided: { file: number; engine: number; union: number; unionSuperset: boolean }
  batches: { file: number; engine: number; union: number }
  ocAppearances: { diffs: string[] }
  ocLastSeen: { diffs: string[] }
  runIndex: { diffs: string[] }
  heads: { engineLastId: string | null; fileLastId: string | null; unionLastId: string | null }
}

function runIndexOf(events: T4Event[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const e of events) {
    if (e.type === 'gate.run') {
      const slug = e.data?.slug
      if (typeof slug === 'string') m[slug] = (m[slug] ?? 0) + 1
    }
  }
  return m
}

function mapDiffs(file: Record<string, number>, engine: Record<string, number>, union: Record<string, number>): string[] {
  const keys = new Set([...Object.keys(file), ...Object.keys(engine), ...Object.keys(union)])
  return [...keys]
    .filter((k) => (file[k] ?? 0) !== (union[k] ?? 0) || (engine[k] ?? 0) !== (union[k] ?? 0))
    .sort()
    .map((k) => `${k}: file ${file[k] ?? 0} · engine ${engine[k] ?? 0} · union ${union[k] ?? 0}`)
}

function lastId(events: T4Event[]): string | null {
  return events.length > 0 ? events[events.length - 1].id : null
}

/** Паритет трёх фолдов на одних и тех же событиях. Инвариант переключения:
 *  union — надмножество каждого источника (окно равное или шире, счётчики
 *  не меньше), и окно ротации операционно совпадает. Чистая функция. */
export function foldParity(fileEvents: T4Event[], engineEvents: T4Event[], unionEvents: T4Event[]): ParityReport {
  const sf = foldState(fileEvents)
  const se = foldState(engineEvents)
  const su = foldState(unionEvents)

  const windowEqual =
    sf.windowSlugs.length === su.windowSlugs.length &&
    se.windowSlugs.length === su.windowSlugs.length &&
    sf.windowSlugs.every((s, i) => s === su.windowSlugs[i]) &&
    se.windowSlugs.every((s, i) => s === su.windowSlugs[i])

  /* Инвариант надмножества: void'ы объединения покрывают ОБА источника —
   * закрытый слот не может вернуться в окно ротации с той стороны,
   * где его void ещё не виден. */
  const unionSuperset =
    se.voidedSlugs.every((s) => su.voidedSlugs.includes(s)) &&
    sf.voidedSlugs.every((s) => su.voidedSlugs.includes(s))

  const ocKeys = new Set([...Object.keys(sf.ocAppearances), ...Object.keys(se.ocAppearances), ...Object.keys(su.ocAppearances)])
  const ocDiffs = [...ocKeys]
    .filter((k) => (sf.ocAppearances[k] ?? 0) !== (su.ocAppearances[k] ?? 0) || (se.ocAppearances[k] ?? 0) !== (su.ocAppearances[k] ?? 0))
    .sort()
    .map((k) => `${k}: file ${sf.ocAppearances[k] ?? 0} · engine ${se.ocAppearances[k] ?? 0} · union ${su.ocAppearances[k] ?? 0}`)

  const lsKeys = new Set([...Object.keys(sf.ocLastSeen), ...Object.keys(se.ocLastSeen), ...Object.keys(su.ocLastSeen)])
  const lsDiffs = [...lsKeys]
    .filter((k) => sf.ocLastSeen[k] !== su.ocLastSeen[k] || se.ocLastSeen[k] !== su.ocLastSeen[k])
    .sort()
    .map((k) => `${k}: file ${sf.ocLastSeen[k] ?? '—'} · engine ${se.ocLastSeen[k] ?? '—'} · union ${su.ocLastSeen[k] ?? '—'}`)

  const ri = mapDiffs(runIndexOf(fileEvents), runIndexOf(engineEvents), runIndexOf(unionEvents))

  const comp = uniteChronicle(engineEvents, fileEvents).composition

  return {
    composition: comp,
    window: { file: sf.windowSlugs, engine: se.windowSlugs, union: su.windowSlugs, equal: windowEqual },
    voided: { file: sf.voidedSlugs.length, engine: se.voidedSlugs.length, union: su.voidedSlugs.length, unionSuperset },
    batches: { file: sf.batches.length, engine: se.batches.length, union: su.batches.length },
    ocAppearances: { diffs: ocDiffs },
    ocLastSeen: { diffs: lsDiffs },
    runIndex: { diffs: ri },
    heads: { engineLastId: lastId(engineEvents), fileLastId: lastId(fileEvents), unionLastId: lastId(unionEvents) },
  }
}
