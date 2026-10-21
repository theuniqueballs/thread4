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
  // Фаза 2, итерация 3 (2026-10-21): квитанция осознанного переключения
  // источника сознания — фолд состояния гейтов/ротации читает ПРОД-цепь
  // живого движка (twin GET /v1/events, RO) с компенсацией файл-хвоста.
  // Позиция в каноне синхронна с Rust (canon.rs) и bun-движком (canon.ts).
  'consciousness.switched',
  'batch.compiled',
  // Фаза 2 (WRITE-мост, итерация 2): план живого движка → богатый контракт
  // писца. Квитанция источника: data.source ('prod'|'scratch'), data.sha10,
  // data.engineEvents — скелет уже заквитанцеван движком, летопись файл-эры
  // факт моста только фиксирует (окно/счётчики ОС не двигает — только сдача).
  'bridge.compiled',
  // Фаза 3 (оркестратор, 2026-10-22): квитанция шага цикла
  // ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER. Состояние конечного
  // автомата — СОБЫТИЯ в летописи (конституция §2): шаг, отработавший до
  // конца, пишет cycle.step (data.slug, data.step, data.theme, sha10-пины).
  // Позиция в каноне синхронна с Rust (canon.rs) и bun-движком (canon.ts).
  'cycle.step',
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
  'channel.retired',
  'scribe.objection',
  // Преемник Фреда, 2026-10-15: голос жнеца — литературный мета-комментатор
  // состояния конвейера. LLM-генерируемый, не авторский; data.model + data.reply
  // обязательны (семантика ниже). Событие пишется в летопись = становится
  // частью хеш-цепи навсегда. Один оператор (ключ командира), один канал.
  'oracle.spoke',
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

/** Уверенность author-вердикта (Issue #4 Кенни): direct — смотрел сейчас,
 *  described — пересказ по памяти. Плоской константы больше нет. */
export const CONFIDENCE_LEVELS = ['direct', 'described'] as const

function assertBornSemantics(type: string, data?: Record<string, unknown>): void {
  if (type === 'render.verdict') {
    const src = data?.source
    if (typeof src !== 'string' || !(VERDICT_SOURCES as readonly string[]).includes(src)) {
      throw new Error(
        `event born wounded: render.verdict требует data.source из enum [${VERDICT_SOURCES.join(', ')}] — проза-идентичность и пустота запрещены (Issue #1 Кенни)`
      )
    }
    const conf = data?.confidence
    if (conf != null && (typeof conf !== 'string' || !(CONFIDENCE_LEVELS as readonly string[]).includes(conf))) {
      throw new Error(
        `event born wounded: confidence вне enum [${CONFIDENCE_LEVELS.join(', ')}] (Issue #4 Кенни)`
      )
    }
    if (src === 'author' && conf == null) {
      throw new Error(
        `event born wounded: author-verdict требует confidence: ${CONFIDENCE_LEVELS.join(' | ')} (Issue #4 Кенни)`
      )
    }
  }
  /* oracle.spoke (2026-10-15): жнец говорит — обязательно data.model (какая
   * LLM сказала) и data.reply (что сказала, 50..4000 симв). data.prompt —
   * усечённый промпт для воспроизводимости. Семантика на рождении, как у
   * render.verdict: поле идентичности модели — enum-строка, не проза. */
  if (type === 'oracle.spoke') {
    const model = data?.model
    if (typeof model !== 'string' || model.trim() === '') {
      throw new Error(
        'event born wounded: oracle.spoke требует data.model (строка, какая LLM говорила) — анонимный оракул запрещён'
      )
    }
    const reply = data?.reply
    if (typeof reply !== 'string' || reply.length < 50 || reply.length > 4000) {
      throw new Error(
        `event born wounded: oracle.spoke требует data.reply 50..4000 симв (получено ${typeof reply === 'string' ? reply.length : 0}) — пустая или бесконечная исповедь жнеца не пишется в летопись`
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* Межпроцессный лок летописи (ISSUE 13 / #45, аудит 2026-10-12:         */
/* «appendEvent без лока — параллельные CLI и дашборд интерливят         */
/* log/chain»). Один оператор, но два процесса (CLI-прогон + браузерный  */
/* запрос) в одном окне реально ходят рядом. Секция лог+цепь атомарна     */
/* только ВНУТРИ процесса (sync-код не интерливится) — лок закрывает      */
/* межпроцессную гонку: дубль звена → ложная тампер-тревога → событие    */
/* отвергается. Замок обоюдоострый: владелец погиб (kill -9 между open    */
/* и unlink) → mtime старше 5с → следующий писатель взламывает. Без новых */
/* зависимостей.                                                          */
/* ------------------------------------------------------------------ */

const EVENT_LOCK = `${EVENT_LOG}.lock`
const LOCK_STALE_MS = 5_000
const LOCK_ATTEMPTS = 60
const LOCK_RETRY_MS = 100

/** Синхронный сон (retry-пауза): Atomics.wait — нулевая загрузка CPU;     */
/** если рантайм запрещает (главный поток без shared memory) — короткий    */
/** busy-wait как честный fallback редкой гонки.                          */
function syncSleep(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      /* spin — пауза 100мс, не дольше */
    }
  }
}

/* Read-through кэш readEvents (аудит 2026-10-16): ключ — size+mtime лога,
 * см. комментарий в теле. Массив заморожен на рантайме (мутация падает
 * громко), тип остаётся T4Event[] чтобы не ломать контракт всех читателей. */
let eventsReadCache: { size: number; mtimeMs: number; events: T4Event[] } | null = null

/** Выполняет fn под эксклюзивным событийным локом. Протухший замок       */
/** (владелец погиб посреди записи) взламывается по mtime; живой —       */
/** ждём до ~6с, потом внятный отказ (событие НЕ теряется — его просто    */
/** не записали, вызывающий видит исключение).                            */
/* Ревизия 2026-10-13 (TOCTOU повторной сдачи): лок реентерабелен
 * ВНУТРИ процесса — deliverBatch держит секцию и зовёт runGates, чей
 * appendEvent(gate.run) берёт тот же замок: без реентерабельности
 * вложенный вызов ждал бы сам себя до stale-break. Глубина >0 = мы уже
 * под замком: внешняя секция несёт эксклюзию, межпроцессная защита
 * (файл-замок) не меняется. */
let eventLockDepth = 0

export function withEventLock<T>(fn: () => T): T {
  if (eventLockDepth > 0) {
    eventLockDepth++
    try {
      return fn()
    } finally {
      eventLockDepth--
    }
  }
  for (let attempt = 0; ; attempt++) {
    let acquired = false
    try {
      const fd = fs.openSync(EVENT_LOCK, 'wx') // exclusive create — замок наш
      acquired = true
      eventLockDepth = 1
      try {
        return fn()
      } finally {
        eventLockDepth = 0
        fs.closeSync(fd)
        try {
          fs.unlinkSync(EVENT_LOCK)
        } catch {
          /* замок уже взломали (протух), пока мы работали — не ошибка */
        }
      }
    } catch (e) {
      /* acquired=true — исключение из НАШЕЙ критической секции (fn/close):
       * замок уже снят finally, ошибка идёт наружу как есть. Иначе — либо
       * гонка за замок (EEXIST), либо реальная ошибка I/O (наружу). */
      const code = (e as NodeJS.ErrnoException).code
      if (acquired || code !== 'EEXIST') throw e
      /* замок занят: протухший — взломать, живой — подождать */
      try {
        const st = fs.statSync(EVENT_LOCK)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try {
            fs.unlinkSync(EVENT_LOCK)
          } catch {
            /* уже взломали */
          }
          continue
        }
      } catch {
        continue // замок исчез между open и stat — сразу новая попытка
      }
      if (attempt >= LOCK_ATTEMPTS) {
        throw new Error(
          `appendEvent: событийный лок занят дольше ${Math.round((LOCK_ATTEMPTS * LOCK_RETRY_MS) / 1000)}с — другой процесс держит летопись; повтори команду`
        )
      }
      syncSleep(LOCK_RETRY_MS)
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
  /* ISSUE 13: запись лога и достройка цепи — одна критическая секция.
   * assertBorn* ДО лока: чистые проверки без I/O, ранний отказ не трогает
   * файл замка (и born-wounded-тесты selftest не должны оставлять .lock). */
  withEventLock(() => {
    /* Big-O (аудит 2026-10-16): снимок лога ДО записи — ключ честности
     * O(1)-пути extendChain. Обе статы под событийным локом: между ними
     * в лог не мог никто вписаться. */
    const pre = statLog()
    fs.appendFileSync(EVENT_LOG, rawLine + '\n', 'utf-8')
    extendChain(rawLine, evt.id, pre)
  })
  /* durability: событие записано — состояние меняется, фиксируем в git */
  scheduleSnapshot(`event:${type}`)
  return evt
}

export function readEvents(): T4Event[] {
  ensureDirs()
  let st: fs.Stats
  try {
    st = fs.statSync(EVENT_LOG)
  } catch {
    eventsReadCache = null
    return []
  }
  /* Big-O (аудит 2026-10-16): readEvents парсил ВЕСЬ лог на каждый запрос
   * (GET /events, /state, fold писца, deliver) — O(n) на опрос Стекла при
   * растущей навсегда летописи. Read-through кэш с ключом size+mtime:
   * чужая запись (CLI-процесс, другой бандл роута) меняет статы → полный
   * пересчёт, наша — нет. Массив заморожен: контракт «только чтение»,
   * случайный in-place reverse/push падает громко, а не портит кэш. */
  if (eventsReadCache && eventsReadCache.size === st.size && eventsReadCache.mtimeMs === st.mtimeMs) {
    return eventsReadCache.events
  }
  let raw: string
  try {
    raw = fs.readFileSync(EVENT_LOG, 'utf-8')
  } catch {
    eventsReadCache = null
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
  eventsReadCache = { size: st.size, mtimeMs: st.mtimeMs, events: Object.freeze(out) as T4Event[] }
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

/** Снимок статов лога (size+mtime) — null, если файла нет. */
function statLog(): { size: number; mtimeMs: number } | null {
  try {
    const st = fs.statSync(EVENT_LOG)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

/* Big-O (аудит 2026-10-16): extendChain звал computeChainOverLog на КАЖДОЙ
 * записи — полный реад лога + N sha256 на append (O(n) на событие,
 * O(n²) на батч писца: десятки событий за прогон, летопись только растёт).
 * Кэш вычисленной цепи, ключ — (size, mtime) ДО записи: рост ровно на
 * нашу строку под событийным локом → O(1) достройка одного звена от
 * кэшированного head; любое чужое изменение лога (CLI-процесс, другой
 * бандл, vault-слияние, in-place правка — mtime не обманешь) → честный
 * полный пересчёт. Кэш — только ускорение: verifyChain ВСЕГДА
 * пересчитывает с нуля (аудитор не верит кэшу). */
let chainCache: { logBytes: number; logMtimeMs: number; links: ChainLink[] } | null = null

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
  /* ISSUE 13: полный ребилд цепи — та же критическая секция, что и append:
   * vault-восстановление не должно интерливиться с живым appendEvent. */
  return withEventLock(() => {
    const { links } = computeChainOverLog()
    writeText(CHAIN_LOG, links.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const post = statLog()
    chainCache = post ? { logBytes: post.size, logMtimeMs: post.mtimeMs, links } : null
    return { links: links.length, head: links[links.length - 1]?.hash ?? '' }
  })
}

/** Продлить цепь новым звеном. Хвост цепи обязан совпадать с логом;
 *  расхождение = тампер-тревога, запись события отвергается.
 *  pre — статы лога ДО нашей записи (снят под локом в appendEvent):
 *  совпадает с кэшем → история не менялась с прошлого достроенного
 *  состояния → O(1) путь; иначе → полный пересчёт computeChainOverLog. */
function extendChain(rawLine: string, id: string, pre: { size: number; mtimeMs: number } | null): void {
  const stored = readChain()
  const grew = Buffer.byteLength(rawLine + '\n', 'utf-8')
  const post = statLog()
  let links: ChainLink[]
  let fastPath = false
  if (chainCache != null && pre != null && pre.size === chainCache.logBytes && pre.mtimeMs === chainCache.logMtimeMs) {
    /* лог не менялся с момента постройки кэша — новое звено от head,
     * без реада и перехеширования истории. */
    const prev = chainCache.links.length > 0 ? chainCache.links[chainCache.links.length - 1].hash : GENESIS
    links = [...chainCache.links, { seq: chainCache.links.length + 1, id, hash: chainHash(prev, rawLine) }]
    fastPath = true
  } else {
    links = computeChainOverLog().links // включает только что дописанное событие
  }
  if (stored.length === 0) {
    // цепи ещё нет (первый запуск после Залпа 1) — строим целиком
    writeText(CHAIN_LOG, links.map((l) => JSON.stringify(l)).join('\n') + '\n')
  } else {
    // хвост stored обязан быть префиксом computed
    for (let i = 0; i < stored.length; i++) {
      if (!links[i] || stored[i].hash !== links[i].hash) {
        throw new Error(
          `chain tamper detected at seq ${i + 1}: летопись правлена руками после записи цепи — событие отвергнуто (см. bun thread4/cli.ts verify)`
        )
      }
    }
    if (stored.length !== links.length - 1) {
      // дыра между цепью и логом (крах между двумя append) — достраиваем хвост честно.
      // Аудит 2026-10-12: при stored.length === links.length (гонка двух процессов:
      // событие уже в логе, звена ещё нет) хвост ПУСТ — прежний код писал пустую
      // строку в chain.jsonl, оставляя событие без звена. Пустой хвост не пишем:
      // следующее appendEvent достроит звено (хеш-цепь покроет лог целиком).
      const tail = links.slice(stored.length)
      if (tail.length > 0) {
        fs.appendFileSync(
          CHAIN_LOG,
          tail.map((l) => JSON.stringify(l)).join('\n') + '\n',
          'utf-8'
        )
      }
    } else {
      const last = links[links.length - 1]
      fs.appendFileSync(CHAIN_LOG, JSON.stringify({ seq: last.seq, id, hash: last.hash }) + '\n', 'utf-8')
    }
  }
  /* кэш обновляем ПОСЛЕ успешной записи звена: post-статы отражают лог
   * с нашим событием; links — полная цепь над этим логом (быстрый путь —
   * кэш+новое звено, медленный — полный пересчёт: оба корректны). */
  if (post != null) {
    chainCache = fastPath || links.length > 0 ? { logBytes: post.size, logMtimeMs: post.mtimeMs, links } : null
  } else {
    chainCache = null
  }
}

export interface ChainVerdict {
  events: number
  storedLinks: number
  ok: boolean
  head: string | null
  problems: string[]
}

/** Проверка целостности: эталон (log) vs хранимая цепь. */
/* Аудит №4 (2026-10-17, strict, Big-O): полный SHA-256 проход по летописи
 * (O(n) хешей + двойной reparse log+chain) на КАЖДЫЙ запрос
 * /api/t4/state — а дашборд монтирует два useApi(state) → две полные
 * сверки цепи на загрузку страницы, стоимость растёт с каждым звеном.
 * Кэш size+mtime обох файлов: appendEvent меняет оба стата — ключ
 * протухает сам, честность та же, стоимость хита — два statSync. */
let chainVerifyCache: { key: string; verdict: ChainVerdict } | null = null

function statKeyOf(p: string): string {
  try {
    const st = fs.statSync(p)
    return `${st.size}:${st.mtimeMs}`
  } catch {
    return 'none'
  }
}

export function verifyChain(): ChainVerdict {
  const key = `${statKeyOf(EVENT_LOG)}|${statKeyOf(CHAIN_LOG)}`
  if (chainVerifyCache && chainVerifyCache.key === key) return chainVerifyCache.verdict
  const verdict = verifyChainUncached()
  chainVerifyCache = { key, verdict }
  return verdict
}

function verifyChainUncached(): ChainVerdict {
  const { links, rawLines } = computeChainOverLog()
  const stored = readChain()
  const problems: string[] = []
  if (stored.length === 0) problems.push('цепь отсутствует — запусти: bun thread4/cli.ts chain')
  /* Аудит 2026-10-12: цепь хранит БАЙТЫ, но fold (readEvents) молча теряет
   * не-JSON строки — состояние расходится с летописью без тревоги. Теперь
   * verify видит бит-рот лога (цепь при этом может быть «ЦЕЛА»). */
  let unparseable = 0
  for (const l of rawLines) {
    try {
      JSON.parse(l)
    } catch {
      unparseable += 1
    }
  }
  if (unparseable > 0)
    problems.push(
      `${unparseable} строк(и) лога не парсятся как JSON — fold их молча теряет (восстановление: vault/git; chain хранит байты)`
    )
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
  /** Фидбек автора 2026-10-16 («хватит Люси в каждую ротацию»): имя → слаг
   *  ПОСЛЕДНЕГО сданного батча с её участием. Ротация ниже даёт OC
   *  cooldown — одного LRU-счётчика мало: он рос, но Lucy всё равно
   *  оставалась «наименее сервирована» и входила 4 батча подряд. */
  ocLastSeen: Record<string, string>
  voidedSlugs: string[] // batch.void — закрытые по приказу автора
  /** Алиасы слагов (ISSUE 17: физическое переименование T4-18→T4-17 без
   *  события оставило state с призрачным delivered-слагом): old → new. */
  slugAliases: Record<string, string>
  openDebts: string[]
  lastEventAt: string | null
}

/** Ранг слага для ocLastSeen: T4-NN монотонны; суффикс (.2-EXP и т.п.)
 *  добавляет вес после основной цифры. Неизвестный формат → −1 (слабее
 *  любого валидного). Экспорт — для selftest. */
export function ocSlugRank(slug: string | undefined): number {
  if (!slug) return -1
  const m = /^T4-(\d+)(.*)$/.exec(slug)
  if (!m) return -1
  return Number(m[1]) * 1000 + Math.min(999, m[2] ? m[2].length * 100 + m[2].charCodeAt(0) % 100 : 0)
}

export function foldState(events: T4Event[]): T4DerivedState {
  const batches = new Map<string, BatchRecord>()
  const ocAppearances: Record<string, number> = {}
  const ocLastSeen: Record<string, string> = {}
  const voidedSlugs: string[] = []
  const openDebts: string[] = []
  const debtIds = new Map<string, string>() // debtId → text (policy.debts, Залп 2)
  const slugAliases = new Map<string, { newSlug: string; dropVoid: boolean }>()
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
      /* Приказ автора 2026-10-17 («ты опять запихнул Люси на первый слот —
       * где ротация ОС»): lastSeen берётся по РАНГУ слага, а не по порядку
       * лога. События могут приходить задним числом (компенсация пропущенных
       * oc.appeared у T4-32 — сдан по старому пути без slots[].oc), и
       * «последний по порядку» затирал свежей(batch T4-34) записи старой
       * (T4-32) — кулдаун компилятора открывал только что показанную ОС.
       * Ранг: числовая часть T4-NN (+суффикс) — слаги монотонны. */
      if (typeof d.slug === 'string') {
        const cur = ocLastSeen[name]
        if (cur === undefined || ocSlugRank(d.slug) > ocSlugRank(cur)) {
          ocLastSeen[name] = d.slug as string
        }
      }
    }
    if (e.type === 'note' && d.kind === 'slug-alias') {
      /* ISSUE 17 / #49: алиас слага — переименование, приказанное автором
       * (T4-18 → T4-17, «а куда 17 делся лол» 2026-10-02). Прозапись 2026-10-02
       * существовала, но fold её не читал — state показывал призрачный T4-18
       * delivered при физическом T4-17.md. Машинное событие несёт oldSlug/
       * newSlug; replaces:'voided-dubl' — void на новом слаге принадлежал
       * ЗАМЕНЯЕМОМУ дублю (T4-17-дубль), не переименованному батчу. */
      const oldSlug = d.oldSlug
      const newSlug = d.newSlug
      if (typeof oldSlug === 'string' && typeof newSlug === 'string' && oldSlug !== newSlug) {
        slugAliases.set(oldSlug, { newSlug, dropVoid: d.replaces === 'voided-dubl' })
      }
    }
    if (e.type === 'note' && typeof d.debt === 'string') {
      openDebts.push(d.debt as string)
      if (typeof d.debtId === 'string') debtIds.set(d.debtId as string, d.debt as string)
    }
    if (e.type === 'debt.paid') {
      /* Залп 2 (policy.debts): долг с debtId гасится ТОЧНО по id;
         прозаический долг — fallback по подстроке (урок призрачного
         долга T4-06: истина, записанная прозой, гасится неточно) */
      if (typeof d.debtId === 'string') {
        const idx = openDebts.indexOf(debtIds.get(d.debtId as string) ?? '\u0000missing')
        if (idx >= 0) openDebts.splice(idx, 1)
      } else if (typeof d.debt === 'string') {
        const idx = openDebts.findIndex((x) => x.includes(d.debt as string))
        if (idx >= 0) openDebts.splice(idx, 1)
      }
    }
  }

  /* Аудит 2026-10-12: void выводит батч из окна ротации — CLI void пишет
   * «в ротации не участвует», а fold держал закрытый батч в окне: гейт
   * window проверял повторы против мёртвого батча. */

  /* ISSUE 17: алиасы применяются ПОСЛЕ всей истории (переименование
   * легализует уже сданный батч задним числом — событие алиаса пишется
   * позже факта, semantics как у vault-восстановления). Записи под
   * старым слагом переезжают на новый; дубль на новом слаге заменяется
   * (его провенанс — в git-истории и арейве контрактов). */
  for (const [oldSlug, a] of slugAliases) {
    const rec = batches.get(oldSlug)
    if (rec) {
      batches.delete(oldSlug)
      batches.set(a.newSlug, { ...rec, slug: a.newSlug })
    }
    if (a.dropVoid) {
      const vi = voidedSlugs.indexOf(a.newSlug)
      if (vi >= 0) voidedSlugs.splice(vi, 1)
    }
  }

  const delivered = [...batches.values()]
    .filter((b) => b.deliveredAt != null)
    .filter((b) => !voidedSlugs.includes(b.slug))
    /* строгий трёхпозиционный компаратор (аудит 2026-10-16): прежний
     * возвращал 1 на равных deliveredAt — нарушение контракта sort,
     * недетерминированный порядок окна ротации при двух сдачах в одну
     * миллисекунду. Tie-break по слагу — окно воспроизводимо. */
    .sort((a, b) =>
      a.deliveredAt! < b.deliveredAt! ? -1 : a.deliveredAt! > b.deliveredAt! ? 1 : a.slug.localeCompare(b.slug)
    )
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
    ocLastSeen,
    voidedSlugs,
    slugAliases: Object.fromEntries(
      [...slugAliases.entries()].map(([o, a]) => [o, a.newSlug])
    ),
    openDebts: openDebtsClean,
    lastEventAt,
  }
}

/** Next batch number: max+1 по ВСЕМ известным слагам.
 *  Аудит 2026-10-12: void-номера больше НЕ переиспользуются. Раньше
 *  nextBatchNumber пропускал void (по прозе «в нумерации не участвует»):
 *  после void ПОСЛЕДНЕГО батча следующая компиляция получила бы тот же
 *  номер и молча ПЕРЕЗАПИСАЛА бы контракт закрытого батча — провенанс
 *  жил бы только в git-истории. Номер занят навсегда. */
export function nextBatchNumber(batches: BatchRecord[]): number {
  let max = 0
  for (const b of batches) {
    const m = /^T4-(\d+)$/.exec(b.slug)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}
