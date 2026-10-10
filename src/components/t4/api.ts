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

export interface T4Counts {
  batches: number
  events: number
  carriers: number
  poses: number
  palettes: number
}

export interface T4State {
  era: unknown
  lastBatch: unknown
  nextStep: unknown
  gateHealth: unknown
  counts: unknown
  openDebts: unknown
}

export interface DocPayload {
  title: string
  markdown: string
}

export interface SpecMeta {
  id: string
  name: string
  count: number
  version: string
}

export interface SpecListPayload {
  specs: SpecMeta[]
}

export interface ContractListItem {
  slug: string
  theme: string
  createdAt: string
}

export interface ContractsPayload {
  items: ContractListItem[]
}

export interface CompilePayload {
  slug: string
  markdown: string
  contract: unknown
}

export interface BatchListItem {
  slug: string
  title: string
  date: string
}

export interface BatchesPayload {
  items: BatchListItem[]
}

export type GateLevel = 'hard' | 'warn' | 'advisory'
export type GateVerdict = 'PASS' | 'FAIL' | 'WARN'

export interface GateReceipt {
  gate: string
  level: GateLevel
  verdict: GateVerdict
  findings: string[]
}

export interface GatesPayload {
  receipts: GateReceipt[]
  summary: unknown
}

export interface BatchDetail {
  slug: string
  title: string
  markdown: string
  receipts: GateReceipt[]
}

export interface T4Event {
  id: string
  at: string
  type: string
  summary: string
  data?: unknown
}

export interface EventsPayload {
  events: T4Event[]
}

export interface ArchiveItem {
  name: string
  size: number
}

export interface ArchivePayload {
  items: ArchiveItem[]
}

export interface ArchiveDetail {
  name: string
  markdown: string
}

export interface ContractDetail {
  slug: string
  theme: string
  createdAt: string
  markdown: string
  contract: unknown
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
  receipts: { gate: string; level: string; verdict: string; findings: string[] }[]
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

export interface CommanderProbe {
  probe: true
  /** серверный замок существует (~/.t4/commander.key на месте) */
  serverKey: boolean
  /** присланный браузерный ключ совпал с серверным */
  keyOk: boolean
}

/** Проверка ключа без записи в летопись (GET ?probe=1, Залп 1 не трогается). */
export async function probeCommanderKey(): Promise<CommanderProbe> {
  const res = await fetch('/api/t4/events?probe=1', {
    cache: 'no-store',
    headers: commanderHeaders(),
  })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
  return (await res.json()) as CommanderProbe
}

/* ------------------------------------------------------------------ */
/* Fetch primitives                                                    */
/* ------------------------------------------------------------------ */

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

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
  return (await res.json()) as T
}

export async function postJson<T>(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
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
