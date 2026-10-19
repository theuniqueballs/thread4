'use client'

/**
 * THREAD 4 — LIVE CONSOLE (Фаза 2, Rust-эра, 2026-10-19; 3-b — abort-эра).
 *
 * Терминал живой консоли: SSE-стрим из Rust-ядра (t4-engine-rs :3201 через
 * twin-прокси), блоки expand / compile / gates / scribe / deliver / system.
 *
 * 3-b (карта разрывов 1-b, часть C):
 *   · ABORT — ручное прерывание потока оператором: закрывает EventSource,
 *     abort'ит in-flight контроллеры, статус 'down' + плашка «прервано
 *     оператором»; onerror после ручного прерывания НЕ переподключается
 *     молча (флаг manualAbort), RECONNECT — решение оператора;
 *   · сворачиваемые группы: последовательные строки одного блока собираются
 *     под заголовок (имя блока · счётчик · самая тяжёлая level-точка);
 *     новые группы длиннее 12 строк сжимаются сами, error-группы — никогда;
 *   · новые строки — fade-in + slide-up (spring 260/26), при
 *     prefers-reduced-motion — только прозрачность, без transform;
 *   · «Copy for AI» — структурированный JSON (ошибки первым делом,
 *     slugHint, seq), кнопка багровеет при наличии error-кадров.
 *
 * Управление: Pause/Intercept (заморозить отрисовку), палитра ⌘K шлёт
 * 't4:live-abort' на window — консоль делает тот же ручной abort.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { AlertTriangle, ChevronDown, ClipboardCopy, Pause, Play, Radio, RotateCcw, Square, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { withGatewayPort } from '@/components/t4/api'
import { toast } from '@/hooks/use-toast'
import {
  LIVE_ABORT_EVENT,
  setLiveConsoleUi,
  writeClipboard,
  type LiveConsoleStatus,
} from '@/components/t4/console/shared'
import { pushFrame } from '@/components/t4/console/frame-ring'

export type LiveBlock =
    | 'expand'
    | 'compile'
    | 'build'
    | 'gates'
    | 'scribe'
    | 'deliver'
    | 'pipeline'
    | 'system'

interface LiveFrame {
  seq: number
  block: LiveBlock
  level: 'info' | 'warn' | 'error'
  text: string
  at: string
}

const MAX_LINES = 400

/** Автосворачивание: НОВЫЕ группы длиннее этого порога сжимаются сами
 *  (старые, уже показанные развёрнутыми, — нет); error-группы — исключение. */
const AUTO_COLLAPSE_LINES = 12

/** Слаг-подсказка из кадра: T4-41 · T4-27.2 · T4-27.2-EXP — последний
 *  встретившийся в буфере (самый свежий контекст). */
const SLUG_HINT_RE = /\bT4-\d{2,}(?:\.\d+)?(?:-EXP)?\b/

const BLOCK_STYLE: Record<LiveBlock, string> = {
  expand: 'text-cyan-300',
  compile: 'text-zinc-200',
  build: 'text-orange-300',
  gates: 'text-amber-300',
  scribe: 'text-fuchsia-300',
  deliver: 'text-emerald-300',
  pipeline: 'text-teal-300',
  system: 'text-zinc-500',
}

const BLOCK_LABEL: Record<LiveBlock, string> = {
  expand: 'EXPAND',
  compile: 'COMPILE',
  build: 'BUILD',
  gates: 'GATES',
  scribe: 'SCRIBE',
  deliver: 'DELIVER',
  pipeline: 'PIPELINE',
  system: 'SYSTEM',
}

const LEVEL_RANK: Record<LiveFrame['level'], number> = { info: 0, warn: 1, error: 2 }

/** Группа последовательных кадров одного блока. key = seq первого кадра —
 *  стабильный «индекс» (позиция в массиве съезжает при слайде буфера,
 *  seq — никогда), поэтому collapse-стейт живёт в Set<number> ключей. */
interface FrameGroup {
  key: number
  block: LiveBlock
  frames: LiveFrame[]
  worst: LiveFrame['level']
  hasError: boolean
}

/** Русская плюрализация счётчика строк заголовка группы. */
function linesWord(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'строка'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'строки'
  return 'строк'
}

export function LiveConsole({ className }: { className?: string }) {
  const [frames, setFrames] = useState<LiveFrame[]>([])
  const [status, setStatus] = useState<LiveConsoleStatus>('reconnect')
  const [lastSeq, setLastSeq] = useState(0)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const [abortedByOperator, setAbortedByOperator] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())
  const [expandedManually, setExpandedManually] = useState<Set<number>>(() => new Set())
  const pausedRef = useRef(false)
  const manualAbortRef = useRef(false)
  const lastSeqRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  /* in-flight операции консоли (собственные POST-ходки, если заведутся):
   * ABORT честно обрывает и их — контроллеры копятся в наборе. */
  const abortersRef = useRef<Set<AbortController>>(new Set())
  const paused = status === 'paused'
  const reduce = useReducedMotion() ?? false

  /* появление строк: fade-in + slide-up (spring 260/26); reduced motion —
   * только прозрачность, без transform (уважение к оператору). */
  const enterMotion = useMemo<HTMLMotionProps<'li'>>(
    () =>
      reduce
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.18 } }
        : {
            initial: { opacity: 0, y: 6 },
            animate: { opacity: 1, y: 0 },
            transition: { type: 'spring', stiffness: 260, damping: 26 },
          },
    [reduce]
  )

  /* SSE-подписка: живая шина twin'а, честный reconnect по ?after=seq.
   * reconnectNonce поднимает подписку заново после ручного прерывания —
   * сама консоль после abort'а никогда не лезет в эфир без оператора. */
  useEffect(() => {
    let closed = false
    const connect = () => {
      if (closed) return
      esRef.current?.close()
      const es = new EventSource(
        withGatewayPort(`/api/t4/twin/live?after=${lastSeqRef.current}`)
      )
      esRef.current = es
      es.onopen = () => {
        if (!pausedRef.current) setStatus('live')
      }
      es.onmessage = (ev) => {
        try {
          const f = JSON.parse(ev.data) as LiveFrame
          pushFrame(f)
          if (typeof f.seq === 'number' && f.seq > lastSeqRef.current) {
            lastSeqRef.current = f.seq
            setLastSeq(f.seq)
          }
          if (pausedRef.current) {
            setStatus((s) => (s === 'down' ? s : 'paused'))
            return
          }
          setStatus('live')
          setFrames((cur) => {
            const next = [...cur, f]
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
          })
        } catch {
          /* кадр битый — не роняем поток */
        }
      }
      /* прощание twin'а: жизнь соединения вышла — переподключаемся без дыры */
      es.addEventListener('bye', (ev) => {
        try {
          lastSeqRef.current = Number((ev as MessageEvent).data) || lastSeqRef.current
        } catch {
          /* seq не разобрался — держим прошлый */
        }
        es.close()
        if (closed || manualAbortRef.current) return
        timerRef.current = window.setTimeout(connect, 700)
      })
      es.onerror = () => {
        es.close()
        if (closed) return
        /* ручное прерывание оператора: onerror не переподключается молча —
         * иначе RECONNECT на плашке потерял бы смысл */
        if (manualAbortRef.current) return
        setStatus((s) => (pausedRef.current && s !== 'down' ? 'paused' : 'reconnect'))
        timerRef.current = window.setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      closed = true
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
      esRef.current?.close()
      esRef.current = null
    }
  }, [reconnectNonce])

  /* палитра ⌘K шлёт 't4:live-abort' — консоль делает тот же ручной abort */
  const abortLive = useCallback(() => {
    if (manualAbortRef.current) return
    manualAbortRef.current = true
    esRef.current?.close()
    esRef.current = null
    for (const c of abortersRef.current) c.abort()
    abortersRef.current.clear()
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pausedRef.current = false
    setStatus('down')
    setAbortedByOperator(true)
  }, [])

  useEffect(() => {
    const onAbort = () => abortLive()
    window.addEventListener(LIVE_ABORT_EVENT, onAbort)
    return () => window.removeEventListener(LIVE_ABORT_EVENT, onAbort)
  }, [abortLive])

  const reconnectLive = useCallback(() => {
    manualAbortRef.current = false
    setAbortedByOperator(false)
    setStatus('reconnect')
    setReconnectNonce((n) => n + 1)
  }, [])

  /* автоскролл, если пользователь у края */
  useEffect(() => {
    const el = listRef.current
    if (el == null) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [frames])

  const togglePause = useCallback(() => {
    setStatus((s) => {
      if (s === 'down') return s // поток прерван — сначала RECONNECT
      if (s === 'paused') {
        pausedRef.current = false
        return 'live'
      }
      pausedRef.current = true
      return 'paused'
    })
  }, [])

  const clearLog = useCallback(() => {
    setFrames([])
    setCollapsed(new Set())
    setExpandedManually(new Set())
  }, [])

  /* группы: ПОСЛЕДОВАТЕЛЬНЫЕ кадры одного блока собираются под один
   * заголовок; новая группа — при смене блока. */
  const groups = useMemo<FrameGroup[]>(() => {
    const out: FrameGroup[] = []
    for (const f of frames) {
      const last = out[out.length - 1]
      if (last != null && last.block === f.block) {
        last.frames.push(f)
        if (LEVEL_RANK[f.level] > LEVEL_RANK[last.worst]) last.worst = f.level
        if (f.level === 'error') last.hasError = true
      } else {
        out.push({
          key: f.seq,
          block: f.block,
          frames: [f],
          worst: f.level,
          hasError: f.level === 'error',
        })
      }
    }
    return out
  }, [frames])

  const isGroupCollapsed = useCallback(
    (g: FrameGroup): boolean => {
      if (expandedManually.has(g.key)) return false
      if (collapsed.has(g.key)) return true
      /* автосворачивание: НОВЫЕ длинные группы сжимаются сами (момент
       * пересечения порога — группа всегда последняя/растущая); старые
       * развёрнутые руками — не трогаем; error-группы — никогда сами. */
      return !g.hasError && g.frames.length > AUTO_COLLAPSE_LINES
    },
    [collapsed, expandedManually]
  )

  const toggleGroup = useCallback(
    (g: FrameGroup) => {
      const wasCollapsed = !expandedManually.has(g.key) && (
        collapsed.has(g.key) || (!g.hasError && g.frames.length > AUTO_COLLAPSE_LINES)
      )
      if (wasCollapsed) {
        setCollapsed((cur) => {
          if (!cur.has(g.key)) return cur
          const next = new Set(cur)
          next.delete(g.key)
          return next
        })
        setExpandedManually((cur) => {
          if (cur.has(g.key)) return cur
          const next = new Set(cur)
          next.add(g.key)
          return next
        })
      } else {
        setCollapsed((cur) => {
          if (cur.has(g.key)) return cur
          const next = new Set(cur)
          next.add(g.key)
          return next
        })
        setExpandedManually((cur) => {
          if (!cur.has(g.key)) return cur
          const next = new Set(cur)
          next.delete(g.key)
          return next
        })
      }
    },
    [collapsed, expandedManually]
  )

  /* «Copy for AI»: структурированный JSON — ошибки первым делом,
   * последние 12 строк хвостом, если ошибок нет; слаг-подсказка из кадров. */
  const copyForAi = useCallback(() => {
    const errors = frames
      .filter((f) => f.level === 'error')
      .map((f) => ({ block: f.block, text: f.text }))
    const recent =
      errors.length === 0
        ? frames.slice(-12).map((f) => ({ block: f.block, level: f.level, text: f.text, seq: f.seq }))
        : []
    let slugHint = ''
    for (let i = frames.length - 1; i >= 0; i--) {
      const m = SLUG_HINT_RE.exec(frames[i].text)
      if (m != null) {
        slugHint = m[0]
        break
      }
    }
    /* 'reconnect' в дампе честнее схлопнуть в 'down' — живых кадров нет;
     * контракт пейлоада описан в палитре и рассчитан на ИИ-разбор */
    const payload = {
      tool: 't4-live-console',
      at: new Date().toISOString(),
      status: status === 'reconnect' ? 'down' : status,
      lastSeq,
      slugHint,
      errors,
      recent,
      note: 'THREAD 4 live console dump — errors first',
    }
    void writeClipboard(JSON.stringify(payload, null, 2))
      .then((ok) =>
        ok
          ? toast({
              title: 'Copy for AI',
              description:
                errors.length > 0
                  ? `скопировано для AI: ${errors.length} ошибок`
                  : 'скопировано для AI: 0 ошибок — приложен хвост 12 строк',
            })
          : toast({
              title: 'Копирование не удалось',
              description: 'Буфер обмена недоступен',
              variant: 'destructive',
            })
      )
  }, [frames, status, lastSeq])

  const errorCount = frames.reduce((n, f) => (f.level === 'error' ? n + 1 : n), 0)

  /* внешний снимок для палитры команд: mounted/статус/seq/ошибки */
  useEffect(() => {
    setLiveConsoleUi({ mounted: true })
    return () => setLiveConsoleUi({ mounted: false })
  }, [])
  useEffect(() => {
    setLiveConsoleUi({ status, lastSeq, errorCount })
  }, [status, lastSeq, errorCount])

  return (
    <section
      aria-label="живая консоль Rust-ядра"
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur',
        className
      )}
    >
      {/* шапка терминала */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/50 px-3 py-2">
        <span
          className={cn(
            'flex size-2 shrink-0 rounded-full',
            status === 'live' && 'animate-pulse bg-emerald-400',
            status === 'paused' && 'bg-amber-400',
            status === 'reconnect' && 'animate-pulse bg-zinc-500',
            status === 'down' && 'bg-rose-500'
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          live · rust twin :3201
        </span>
        {errorCount > 0 ? (
          <span className="flex items-center gap-1 font-mono text-[10px] text-rose-400">
            <AlertTriangle className="size-3" /> {errorCount}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10px] text-zinc-600">
          seq {lastSeq || '—'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={togglePause}
            title={paused ? 'Возобновить поток' : 'Pause/Intercept — заморозить отрисовку (поток копится)'}
            aria-label={paused ? 'возобновить поток' : 'заморозить поток'}
            className={cn(
              'rounded-md border p-1.5 transition-colors',
              paused
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            )}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
          {status !== 'down' ? (
            <button
              type="button"
              onClick={abortLive}
              title="ABORT — оборвать SSE-поток twin'а и in-flight запросы; RECONNECT — руками"
              aria-label="прервать поток (abort)"
              className="flex items-center gap-1.5 rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-rose-600/60 hover:text-rose-300"
            >
              <Square className="size-3.5" />
              <span className="hidden font-mono text-[10px] uppercase tracking-wide sm:inline">
                abort
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={copyForAi}
            title="Copy for AI — JSON-срез кадров (ошибки приоритетно) в буфер"
            aria-label="скопировать JSON-срез для ИИ"
            className={cn(
              'flex items-center gap-1.5 rounded-md border p-1.5 transition-colors',
              errorCount > 0
                ? 'border-rose-600/60 bg-rose-950/30 text-rose-300 hover:border-rose-500 hover:text-rose-200'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            )}
          >
            <ClipboardCopy className="size-3.5" />
            <span className="hidden font-mono text-[10px] uppercase tracking-wide sm:inline">
              {errorCount > 0 ? `copy for ai (${errorCount} err)` : 'copy for ai'}
            </span>
          </button>
          <button
            type="button"
            onClick={clearLog}
            title="очистить вид (летопись не тронута)"
            aria-label="очистить лог"
            className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* плашка ручного прерывания: RECONNECT — решение оператора */}
      {abortedByOperator ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rose-900/60 bg-rose-950/30 px-3 py-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-rose-300">
            <Square className="size-3 fill-rose-400 text-rose-400" /> прервано оператором
          </span>
          <button
            type="button"
            onClick={reconnectLive}
            title="RECONNECT — поднять SSE-подписку заново с последнего seq"
            aria-label="переподключить поток"
            className="ml-auto flex items-center gap-1.5 rounded-md border border-rose-600/50 bg-rose-600/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-rose-200 transition-colors hover:border-rose-500 hover:bg-rose-600/20"
          >
            <RotateCcw className="size-3" /> reconnect
          </button>
        </div>
      ) : null}

      {/* полотно терминала (JetBrains Mono — строки лога) */}
      <div
        ref={listRef}
        className="t4-live-scroll font-term min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed"
        style={{ maxHeight: 'min(52vh, 480px)' }}
      >
        {frames.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 py-8 text-center font-mono text-[11px] text-zinc-600">
            <Radio className="size-3.5" />
            {abortedByOperator
              ? 'поток прерван оператором — RECONNECT на плашке'
              : status === 'reconnect'
                ? 'подключаюсь к шине twin’а…'
                : 'тишина в эфире — двинь воркфлоу, кадры пойдут сюда'}
          </div>
        ) : (
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {groups.map((g) => {
                const isCollapsed = isGroupCollapsed(g)
                const errorInGroup = g.frames.reduce((n, f) => (f.level === 'error' ? n + 1 : n), 0)
                const lastError = g.hasError
                  ? (g.frames.findLast((f) => f.level === 'error')?.text ?? '')
                  : ''
                return (
                  <motion.li key={g.key} {...enterMotion} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleGroup(g)}
                      aria-expanded={!isCollapsed}
                      title={isCollapsed ? 'раскрыть группу' : 'свернуть группу'}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-zinc-900/60"
                    >
                      <ChevronDown
                        className={cn(
                          'size-3 shrink-0 text-zinc-500',
                          !reduce && 'transition-transform',
                          isCollapsed ? '' : 'rotate-180'
                        )}
                      />
                      <span className={cn('shrink-0 font-semibold', BLOCK_STYLE[g.block] ?? 'text-zinc-400')}>
                        {BLOCK_LABEL[g.block] ?? g.block}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-600">
                        {g.frames.length} {linesWord(g.frames.length)}
                      </span>
                      {/* самая тяжёлая level-точка группы: error > warn > info */}
                      <span
                        aria-label={`тяжелейший уровень: ${g.worst}`}
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          g.worst === 'error' ? 'bg-rose-500' : g.worst === 'warn' ? 'bg-amber-400' : 'bg-zinc-700'
                        )}
                      />
                      {g.hasError ? (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-rose-400">
                          <AlertTriangle className="size-3" /> {errorInGroup}
                        </span>
                      ) : null}
                      {isCollapsed && g.hasError ? (
                        <span className="min-w-0 truncate text-[10px] text-rose-300/80">{lastError}</span>
                      ) : null}
                    </button>
                    {!isCollapsed ? (
                      <ul className="mt-0.5 space-y-0.5 pl-1">
                        <AnimatePresence initial={false}>
                          {g.frames.map((f) => (
                            <motion.li key={f.seq} {...enterMotion} className="flex gap-2">
                              <span className="w-[54px] shrink-0 text-right text-zinc-700">
                                {String(f.seq).padStart(3, '0')}
                              </span>
                              <span
                                className={cn(
                                  'min-w-0 break-words',
                                  f.level === 'error' && 'text-rose-400',
                                  f.level === 'warn' && 'text-amber-300',
                                  f.level === 'info' && (BLOCK_STYLE[f.block] ?? 'text-zinc-300')
                                )}
                              >
                                {f.text}
                              </span>
                            </motion.li>
                          ))}
                        </AnimatePresence>
                      </ul>
                    ) : null}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  )
}
