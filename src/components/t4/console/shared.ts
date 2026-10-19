'use client'

/**
 * THREAD 4 — console shared kernel (эра «МОЩНОСТЬ», 2026-10-18).
 *
 * Типы навигации новой консоли, движковый RPC-клиент поверх существующего
 * прокси /api/t4/engine (get/post с разбором ошибок движка), шина
 * уведомлений (тосты + колокол), хук видимого интервала для живых
 * обновлений и генератор Idempotency-Key. Ничего нового не изобретает —
 * только тонкий слой над тем, что уже работает.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { asArray, asRecord, asStr, commanderHeaders, fetchJson, getCommanderKey, withGatewayPort } from '@/components/t4/api'
import type { Envelope, EngineBatchRow } from '@/components/t4/console/panels'

/* ------------------------------------------------------------------ */
/* Навигация консоли                                                   */
/* ------------------------------------------------------------------ */

/** Рабочие действия первого уровня (Action Deck, главный экран). */
export type ActionId =
  | 'burn'
  | 'compile'
  | 'scribe'
  | 'purge'
  | 'verify'
  | 'void'
  | 'deliver'
  | 'reaper'
  | 'shore'
  | 'verdict'

/** Читальный зал второго уровня (drawer'ы). */
export type DrawerId =
  | 'docs'
  | 'specs'
  | 'chronicle'
  | 'batches'
  | 'verdicts'
  | 'vault'
  | 'archive'
  | 'file-era'

export const DRAWER_META: Record<DrawerId, { label: string; hint: string }> = {
  docs: { label: 'Документы', hint: 'конституция · вкус · факты · кузница · ниша' },
  specs: { label: 'Спеки', hint: 'палитры · позы · носители · OC-канон' },
  chronicle: { label: 'Летопись', hint: 'хеш-цепь chain.jsonl · поиск · экспорт' },
  batches: { label: 'Батчи', hint: 'список · детали · гейты · сравнение A↔B' },
  verdicts: { label: 'Вердикты', hint: 'TRIAL-радар · VLM-проход · приёмник' },
  vault: { label: 'Сейф', hint: 'браузерные снимки состояния' },
  archive: { label: 'Архив 3.2', hint: 'замороженная эра 3.2' },
  'file-era': { label: 'Файл-эра', hint: 'старый компилятор · писец · контракты' },
}

/* ------------------------------------------------------------------ */
/* Движковый RPC-клиент (через прокси /api/t4/engine, ключ в заголовке) */
/* ------------------------------------------------------------------ */

/** Ошибка RPC движка: {ok:false, error:{code,message,hint?}}. */
export class EngineError extends Error {
  status: number
  code: string
  hint: string | null

  constructor(message: string, status: number, code: string, hint: string | null) {
    super(message)
    this.name = 'EngineError'
    this.status = status
    this.code = code
    this.hint = hint
  }
}

/** POST в движок: прикладывает ключ командира, Idempotency-Key, честно
 *  разбирает конверт ошибок (код + сообщение + подсказка движка).
 *  3-b: opts.signal (опционально) прокидывается в fetch — долгие операции
 *  движка можно прервать оператору (AbortError ловится вызывающей стороной). */
export async function enginePost<T>(
  path: string,
  body: unknown,
  opts: { idempotencyKey?: string; signal?: AbortSignal } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...commanderHeaders(),
  }
  if (opts.idempotencyKey != null && opts.idempotencyKey !== '') {
    headers['Idempotency-Key'] = opts.idempotencyKey
  }
  const res = await fetch(withGatewayPort(`/api/t4/engine/${path}`), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: opts.signal,
  })
  if (!res.ok) {
    let code = 'http'
    let msg = `HTTP ${res.status}`
    let hint: string | null = null
    try {
      const j = (await res.json()) as Record<string, unknown>
      const err = asRecord(j.error)
      if (typeof err.message === 'string' && err.message.trim() !== '') msg = err.message
      if (typeof err.code === 'string') code = err.code
      if (typeof err.hint === 'string' && err.hint.trim() !== '') hint = err.hint
    } catch {
      /* тело не JSON — остаёмся с кодом статуса */
    }
    throw new EngineError(msg, res.status, code, hint)
  }
  const j = (await res.json()) as Record<string, unknown>
  /* конверт {ok,data} — разворачиваем data; сырой ответ оставляем как есть */
  if (j != null && typeof j === 'object' && 'data' in j && j.data != null) {
    return j.data as T
  }
  return j as T
}

/** GET из движка (чтение; ключ прикладывается — read.lock для автора). */
export async function engineGet<T>(path: string): Promise<T> {
  return fetchJson<Envelope<T>>(`/api/t4/engine/${path}`).then((env) => env.data)
}

/** Idempotency-Key: 8..128 символов [A-Za-z0-9._-] — ретрай кнопки
 *  никогда не задвоит compile (движок вернёт idempotentReplay). */
export function genIdemKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

/* ------------------------------------------------------------------ */
/* Шина уведомлений (тосты + колокол истории)                          */
/* ------------------------------------------------------------------ */

export interface NotifyEntry {
  id: number
  at: string
  kind: 'success' | 'error' | 'info'
  title: string
  text: string
}

type NotifyListener = (e: NotifyEntry) => void
const notifyListeners = new Set<NotifyListener>()
let notifySeq = 0

/** Пуш уведомления: колокол в шапке + тост (страница подписана). */
export function notify(kind: NotifyEntry['kind'], title: string, text = ''): void {
  const entry: NotifyEntry = {
    id: ++notifySeq,
    at: new Date().toISOString(),
    kind,
    title,
    text,
  }
  for (const l of notifyListeners) l(entry)
}

export function subscribeNotify(l: NotifyListener): () => void {
  notifyListeners.add(l)
  return () => {
    notifyListeners.delete(l)
  }
}

/* ------------------------------------------------------------------ */
/* Live-консоль: внешнее состояние + шина команд (3-b)                  */
/* ------------------------------------------------------------------ */

export type LiveConsoleStatus = 'live' | 'paused' | 'reconnect' | 'down'

/** Снимок live-консоли для тех, кто не может подписаться на её стейт
 *  (палитра команд): пишется консолью при монтировании и на каждом
 *  изменении статуса/seq. Модульный стор без реативности — читается
 *  по требованию, в момент команды. */
export interface LiveConsoleUiState {
  /** консоль смонтирована (вид «Воркфлоу» — правая колонка) */
  mounted: boolean
  status: LiveConsoleStatus
  /** последний seq SSE-кадра (0 — тишина в эфире) */
  lastSeq: number
  /** error-кадры в текущем буфере кадра (окно MAX_LINES) */
  errorCount: number
}

let liveConsoleUi: LiveConsoleUiState = {
  mounted: false,
  status: 'reconnect',
  lastSeq: 0,
  errorCount: 0,
}

export function setLiveConsoleUi(patch: Partial<LiveConsoleUiState>): void {
  liveConsoleUi = { ...liveConsoleUi, ...patch }
}

export function getLiveConsoleUi(): LiveConsoleUiState {
  return liveConsoleUi
}

/* Имена событий шины команд (CustomEvent на window): палитра
 * dispatch'ит — консоль/воркфлоу слушают. Строки — в одном месте,
 * чтобы не разъехались по файлам. */
export const LIVE_ABORT_EVENT = 't4:live-abort'
export const WORKFLOW_RESET_EVENT = 't4:workflow-reset'

/* ------------------------------------------------------------------ */
/* Буфер обмена с честным fallback (3-b)                                */
/* ------------------------------------------------------------------ */

/** navigator.clipboard.writeText, а в незащищённом контексте/отказе —
 *  textarea + document.execCommand('copy'). Возвращает true/false:
 *  вызывающая сторона честно тостит исход, не молчит. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard != null && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* Permissions API отказала — пробуем легаси-путь ниже */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Список батчей движка (общий кэш + шина сброса после мутаций)        */
/* ------------------------------------------------------------------ */

/** Строка сборки воркфлоу из scratch-летописи twin'а (:3201).
 * Полный двойник EngineBatchRow + sha10 плана — два пространства (прод и
 * scratch) делят формат слага T4-NN, sha10 отличает сборки байт-в-байт. */
export interface ScratchBatchRow {
  slug: string
  title: string
  status: string
  expSlots: number
  hardPass: boolean
  diffUp: number
  diffDown: number
  createdAt: string
  deliveredAt: string | null
  sha10: string
}

/** Кэш списка батчей на 60с — BURN/VOID/DELIVER/VERDICT/фокус-карта
 *  читают один и тот же заряд вместо пяти параллельных походов. */
const BATCH_TTL_MS = 60_000
let batchCache: { rows: EngineBatchRow[]; at: number } | null = null
const batchReloadListeners = new Set<() => void>()

/** Scratch-сборки twin'а — отдельный кэш того же семейства: инвалидируется
 *  тем же invalidateEngineBatches (мутация коснулась сборок — оба списка
 *  перевыгружаются). */
let scratchCache: { rows: ScratchBatchRow[]; at: number } | null = null
const scratchReloadListeners = new Set<() => void>()

export function invalidateEngineBatches(): void {
  batchCache = null
  scratchCache = null
  for (const l of batchReloadListeners) l()
  for (const l of scratchReloadListeners) l()
}

/** Хук: батчи движка (limit 50) + loading + reload. Обновляется во всех
 *  подписчиках разом после мутации (invalidateEngineBatches). */
export function useEngineBatches(): {
  rows: EngineBatchRow[]
  loading: boolean
  reload: () => void
} {
  const [rows, setRows] = useState<EngineBatchRow[]>(batchCache?.rows ?? [])
  const [loading, setLoading] = useState(batchCache == null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await engineGet<{ batches: EngineBatchRow[] }>('batches?limit=50')
      const fresh = asArray(data.batches).map((r) => {
        const rec = asRecord(r)
        return {
          slug: asStr(rec.slug),
          title: asStr(rec.title),
          status: asStr(rec.status),
          expSlots: Number(rec.expSlots ?? 0),
          hardPass: rec.hardPass === true,
          diffUp: Number(rec.diffUp ?? 0),
          diffDown: Number(rec.diffDown ?? 0),
          createdAt: asStr(rec.createdAt),
          deliveredAt: typeof rec.deliveredAt === 'string' ? rec.deliveredAt : null,
        } satisfies EngineBatchRow & { hardPass: boolean; diffUp: number; diffDown: number }
      })
      batchCache = { rows: fresh, at: Date.now() }
      setRows(fresh)
    } catch {
      /* движок молчит — показываем прошлый заряд, если был */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (batchCache != null && Date.now() - batchCache.at < BATCH_TTL_MS) return
    void load()
    batchReloadListeners.add(load)
    return () => {
      batchReloadListeners.delete(load)
    }
  }, [load])

  return { rows, loading, reload: () => void load() }
}

/* GET в twin через прокси: /api/t4/twin/scratch/batches (allowlist)
 * возвращает {data:{batches:[...]}} — разворачиваем и типизируем. */
async function fetchScratchBatches(): Promise<ScratchBatchRow[]> {
  const res = await fetch(withGatewayPort('/api/t4/twin/scratch/batches'), {
    headers: commanderHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) throw new EngineError(`twin scratch: HTTP ${res.status}`, res.status, `http-${res.status}`, null)
  const j = (await res.json()) as { data?: { batches?: unknown } }
  const rows = asArray(asRecord(j.data).batches).map((r) => {
    const rec = asRecord(r)
    return {
      slug: asStr(rec.slug),
      title: asStr(rec.title),
      status: asStr(rec.status),
      expSlots: Number(rec.expSlots ?? 0),
      hardPass: rec.hardPass === true,
      diffUp: Number(rec.diffUp ?? 0),
      diffDown: Number(rec.diffDown ?? 0),
      createdAt: asStr(rec.createdAt),
      deliveredAt: typeof rec.deliveredAt === 'string' ? rec.deliveredAt : null,
      sha10: asStr(rec.sha10),
    } satisfies ScratchBatchRow
  })
  return rows
}

/** Хук: сборки воркфлоу из scratch-летописи twin'а (limit 50) + loading +
 *  reload. Кэш 60с, инвалидация — invalidateEngineBatches (после мутаций). */
export function useScratchBatches(): {
  rows: ScratchBatchRow[]
  loading: boolean
  reload: () => void
} {
  const [rows, setRows] = useState<ScratchBatchRow[]>(scratchCache?.rows ?? [])
  const [loading, setLoading] = useState(scratchCache == null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fresh = await fetchScratchBatches()
      scratchCache = { rows: fresh, at: Date.now() }
      setRows(fresh)
    } catch {
      /* twin молчит — показываем прошлый заряд, если был */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (scratchCache != null && Date.now() - scratchCache.at < BATCH_TTL_MS) return
    void load()
    scratchReloadListeners.add(load)
    return () => {
      scratchReloadListeners.delete(load)
    }
  }, [load])

  return { rows, loading, reload: () => void load() }
}

/* ------------------------------------------------------------------ */
/* Ключ командира: внешний стор (localStorage + событие перерисовки)    */
/* ------------------------------------------------------------------ */

const KEY_EVENT = 't4-commander-key'

/** Панель ключа (настройки) зовет это после сохранения/стирания —
 *  статусные чипы консоли перекрашиваются без перезагрузки. */
export function announceCommanderKey(): void {
  window.dispatchEvent(new Event(KEY_EVENT))
}

/** Стор «ключ сохранён»: сервер-снимок false, клиент — из localStorage.
 *  useSyncExternalStore — канонический паттерн без set-state-in-effect. */
export function useCommanderKeySaved(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(KEY_EVENT, cb)
      window.addEventListener('storage', cb)
      window.addEventListener('focus', cb)
      return () => {
        window.removeEventListener(KEY_EVENT, cb)
        window.removeEventListener('storage', cb)
        window.removeEventListener('focus', cb)
      }
    },
    () => getCommanderKey() !== '',
    () => false
  )
}

/* ------------------------------------------------------------------ */
/* Живые обновления: интервал, уважающий скрытую вкладку               */
/* ------------------------------------------------------------------ */

/** setInterval, который спит, когда вкладка скрыта (document.hidden):
 *  фоновый таб не жжёт CPU и запросы. */
export function useVisibleInterval(cb: () => void, ms: number): void {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) ref.current()
    }, ms)
    return () => window.clearInterval(id)
  }, [ms])
}
