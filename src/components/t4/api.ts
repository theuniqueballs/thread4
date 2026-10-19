'use client'

/**
 * THREAD 4 dashboard — API layer.
 * Fetches against the /api/t4/* contract. All responses are treated
 * defensively (the core may not be wired yet): every accessor below
 * tolerates null / unexpected shapes and degrades to "нет данных".
 */

import { useCallback, useEffect, useState } from 'react'

/* ------------------------------------------------------------------ */
/* Contract types                                                      */
/* ------------------------------------------------------------------ */

/** Контрактные типы — только те, что реально текут по коду UI
 *  (webDevReview #9, 2026-10-12: 18 мёртвых экспортов-документалистов
 *  удалены — UI читает ядро через unknown + защитные аксессоры BY DESIGN,
 *  имена форм живут в git-истории, если понадобятся снова). */

export interface CompilePayload {
  slug: string
  markdown: string
  contract: unknown
}

export type GateLevel = 'hard' | 'warn' | 'advisory'
type GateVerdict = 'PASS' | 'FAIL' | 'WARN'

export interface GateReceipt {
  gate: string
  level: GateLevel
  verdict: GateVerdict
  findings: string[]
}

export interface T4Event {
  id: string
  at: string
  type: string
  summary: string
  data?: unknown
}

export interface ScribeResponse {
  ok: boolean
  slug: string
  title: string
  rounds: number
  hardPass: boolean
  sha10: string
  failedSlots: number[]
  log: string[]
  receipts: { gate: string; level: string; verdict: string; findings: string[]; notes?: string[] }[]
}

export interface DeliverResponse {
  ok: boolean
  delivered: boolean
  title: string
  result: { slug: string; runIndex: number; hardPass: boolean; firstRunClean: boolean; sha10: string }
}

/* ------------------------------------------------------------------ */
/* Commander key (browser half of Залп 1 «Правда»)                    */
/* ------------------------------------------------------------------ */

/** Преемник Фреда, 2026-10-10: ключ командира в браузере.
 *
 * Серверный замок — ~/.t4/commander.key на машине ядра (Залп 1). Браузерная
 * половина хранит копию в localStorage и прикладывает её заголовком
 * x-commander-key на мутации летописи (/api/t4/events POST). Ключ НЕ попадает
 * в URL, в логи консоли и в репо; из UI — только в поле «Стекло → Ключ
 * командира» и в память вкладки.
 */
const COMMANDER_KEY_STORAGE = 't4-commander-key'

export function getCommanderKey(): string {
  try {
    return window.localStorage.getItem(COMMANDER_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setCommanderKey(key: string): void {
  try {
    const v = key.trim()
    if (v === '') window.localStorage.removeItem(COMMANDER_KEY_STORAGE)
    else window.localStorage.setItem(COMMANDER_KEY_STORAGE, v)
  } catch {
    /* приватный режим браузера — ключ не переживает перезагрузку */
  }
}

export function clearCommanderKey(): void {
  try {
    window.localStorage.removeItem(COMMANDER_KEY_STORAGE)
  } catch {
    /* нет доступа — нет и ключа */
  }
}

/** Заголовки для мутаций летописи: ключ, если браузер его хранит. */
export function commanderHeaders(): Record<string, string> {
  const key = getCommanderKey()
  return key === '' ? {} : { 'x-commander-key': key }
}

interface CommanderProbe {
  probe: true
  /** серверный замок существует (~/.t4/commander.key на месте) */
  serverKey: boolean
  /** присланный браузерный ключ совпал с серверным */
  keyOk: boolean
}

/** Проверка ключа без записи в летопись (GET ?probe=1, Залп 1 не трогается). */
export async function probeCommanderKey(): Promise<CommanderProbe> {
  const res = await fetch(withGatewayPort('/api/t4/events?probe=1'), {
    cache: 'no-store',
    headers: commanderHeaders(),
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
  return (await res.json()) as CommanderProbe
}

/* ------------------------------------------------------------------ */
/* Fetch primitives                                                    */
/* ------------------------------------------------------------------ */

/**
 * Платформенный шлюз песочницы (Caddy :81) отдаёт этот дашборд на чужом
 * порту через ?XTransformPort=3100 — reverse_proxy localhost:{query}.
 * Клиентские fetch обязаны нести тот же query, иначе шлюз ушлёт их
 * дефолтному приложению (порт 3000). Прямой доступ (127.0.0.1:3100)
 * запроса не несёт — пути остаются как есть. Табы ходят по хэшу (#),
 * location.search не трогают — параметр живёт всю сессию вкладки.
 */
export function withGatewayPort(path: string): string {
  if (typeof window === 'undefined') return path
  const m = /[?&]XTransformPort=(\d+)/.exec(window.location.search)
  if (m == null) return path
  return `${path}${path.includes('?') ? '&' : '?'}XTransformPort=${m[1]}`
}

export class ApiError extends Error {
  status: number
  payload: Record<string, unknown> | null

  constructor(message: string, status: number, payload: Record<string, unknown> | null = null) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501)
}

/* Аудит №4 (2026-10-17, strict, perf): дашборд монтирует ДВА
 * useApi('/api/t4/state') — каждый state-зап previously платил полную
 * сверку цепи + fold + scan. In-flight dedupe: параллельные fetchJson
 * одного URL JOINят первый запрос (один ответ шарится обоим подписантам);
 * после завершения карта чистится — данные не кэшируются, только
 * двойной одновременно запущенный поход убран. */
const inflight = new Map<string, Promise<unknown>>()

export async function fetchJson<T>(path: string): Promise<T> {
  const existing = inflight.get(path)
  if (existing) return existing as Promise<T>
  const req = fetchJsonUncached<T>(path)
  inflight.set(path, req)
  try {
    return await req
  } finally {
    inflight.delete(path)
  }
}

async function fetchJsonUncached<T>(path: string): Promise<T> {
  /* ISSUE 15 / #47 (read.lock): GET несёт ключ командира, если браузер его
   * хранит. Без read.lock на сервере заголовок безвреден (игнорируется);
   * с read.lock — чтение конвейера открывается автору без отдельного
   * «ключа чтения»: один оператор, один секрет. Проба ключа (probe) идёт
   * отдельным вызовом и не зависит от этого заголовка. */
  const res = await fetch(withGatewayPort(path), { cache: 'no-store', headers: commanderHeaders() })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
  return (await res.json()) as T
}

export async function postJson<T>(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(withGatewayPort(path), {
    method: 'POST',
    /* Аудит 2026-10-12: ключ командира прикладывается КО ВСЕМ мутациям по
     * умолчанию (Залп 1 расширен на compile/gates/scribe/verdicts/vlm/zai).
     * Побочно это и CSRF-защита: кастомный заголовок нельзя поставить
     * кросс-доменно без preflight. */
    headers: { 'Content-Type': 'application/json', ...commanderHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // тело ошибки пробрасываем наверх: UI имеет право знать ПОЧЕМУ (а не только код)
    let payload: Record<string, unknown> | null = null
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as Record<string, unknown>
      payload = j
      if (typeof j.error === 'string' && j.error.trim() !== '') msg = j.error
    } catch {
      /* тело не JSON — остаёмся с кодом */
    }
    throw new ApiError(msg, res.status, payload)
  }
  return (await res.json()) as T
}

/* Инцидент «писец не дошёл: Не удалось записать» (2026-10-18, Т4-42/43/44):
 * писец пишет минуты, платформенный шлюз рвёт молчаливые соединения через
 * ~60–90с. /api/t4/scribe стал NDJSON-потоком: {t:'log'} — живой прогресс,
 * {t:'ping'} — heartbeat (шлюз видит жизнь и не режет), {t:'done'} —
 * результат, {t:'error'} — настоящая причина. Хелпер читает поток честно. */
export async function postScribeStream<T>(
  path: string,
  body: unknown,
  onLog: (line: string) => void,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(withGatewayPort(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commanderHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  })
  if (!res.ok || res.body == null) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as Record<string, unknown>
      if (typeof j.error === 'string' && j.error.trim() !== '') msg = j.error
    } catch {
      /* не JSON — код остаётся */
    }
    throw new ApiError(msg, res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: T | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line === '') continue
      try {
        const evt = JSON.parse(line) as { t?: string; line?: string; result?: T; error?: string }
        if (evt.t === 'log' && typeof evt.line === 'string') onLog(evt.line)
        else if (evt.t === 'done' && evt.result != null) result = evt.result
        else if (evt.t === 'error') throw new ApiError(evt.error ?? 'scribe failed', 500)
        /* {t:'ping'} — heartbeat, молча живём дальше */
      } catch (e) {
        if (e instanceof ApiError) throw e
        /* битая строка потока не роняет прогон — следующие строки живы */
      }
    }
  }
  if (result == null) {
    throw new ApiError(
      'поток писца оборвался без результата — сервер, скорее всего, всё ещё пишет; проверь Батчи/летопись перед ретраем',
      502
    )
  }
  return result
}

/** DELETE с телом ошибки наверх — симметрично postJson (удаление черновиков
 *  из UI, ревью 2026-10-11: отказ 409 «уже собран» должен быть читаем).
 *  Аудит 2026-10-12: ключ командира прикладывается по умолчанию. */
export async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(withGatewayPort(path), {
    method: 'DELETE',
    headers: { ...commanderHeaders() },
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as Record<string, unknown>
      if (typeof j.error === 'string' && j.error.trim() !== '') msg = j.error
    } catch {
      /* тело не JSON — остаёмся с кодом */
    }
    throw new ApiError(msg, res.status)
  }
  return (await res.json()) as T
}

export interface ApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * SWAN-style fetch hook: loads `path` (null = idle), aborts on
 * unmount/re-run, exposes loading / error / data / reload.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(path != null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (path == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      setError(null)
      setData(null)
      return
    }
    const ctrl = new AbortController()
    /* смена path — сброс данных СРАЗУ: пока грузится новый, таблица не
     * показывает слоты ПРОШЛОГО батча под шапкой нового (приёмник вердиктов
     * мигал чужими строками — webDevReview #8) */
     
    setData(null)
    setLoading(true)
    setError(null)
    fetchJson<T>(path)
      .then((json) => {
        if (ctrl.signal.aborted) return
        setData(json)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setData(null)
        setError(err instanceof Error ? err.message : 'ошибка сети')
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [path, tick])

  return { data, error, loading, reload }
}

/* ------------------------------------------------------------------ */
/* Defensive accessors — the core may return unexpected shapes         */
/* ------------------------------------------------------------------ */

export function asRecord(v: unknown): Record<string, unknown> {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return {}
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function asStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

export function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n) && v.trim() !== '') return n
  }
  return null
}

/** First string value found under any of the given keys. */
export function pickStr(src: unknown, ...keys: string[]): string {
  const rec = asRecord(src)
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim() !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return ''
}

/** First string-array value found under any of the given keys. */
export function pickStrArray(src: unknown, ...keys: string[]): string[] {
  const rec = asRecord(src)
  for (const k of keys) {
    const v = rec[k]
    if (Array.isArray(v)) {
      const strs = v.map(asStr).filter((s) => s !== '')
      if (strs.length > 0) return strs
    }
    if (typeof v === 'string' && v.trim() !== '') return [v]
  }
  return []
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

export function formatDate(v: unknown): string {
  const s = asStr(v)
  if (s === '') return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDay(v: unknown): string {
  const s = asStr(v)
  if (s === '') return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function formatSize(v: unknown): string {
  const n = asNum(v)
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Human label for a spec id / enum-ish token: oc-canon → OC canon. */
export function humanizeKey(k: string): string {
  return k
    .replace(/[_-]+/g, ' ')
    .replace(/\boc\b/gi, 'OC')
    .replace(/\bpg13\b/gi, 'PG-13')
    .replace(/\brplus\b/gi, 'R+')
    .replace(/\bxxx\b/gi, 'XXX')
    .replace(/^\w/, (c) => c.toUpperCase())
}
