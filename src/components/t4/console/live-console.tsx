'use client'

/**
 * THREAD 4 — LIVE CONSOLE (Фаза 2, Rust-эра, 2026-10-19).
 *
 * Терминал живой консоли: SSE-стрим из Rust-ядра (t4-engine-rs :3201 через
 * twin-прокси), блоки expand / compile / gates / scribe / deliver / system.
 * Heartbeat 15с держит поток живым (лекарство «Не удалось записать»);
 * оборванный поток честно переподключается с ?after=последний seq.
 *
 * Управление: Pause/Intercept (заморозить отрисовку, поток копится),
 * «Copy for AI» — кадровый срез ошибок в буфер для разбора с ИИ.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ClipboardCopy, Pause, Play, Radio, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { withGatewayPort } from '@/components/t4/api'
import { toast } from '@/hooks/use-toast'

export type LiveBlock = 'expand' | 'compile' | 'gates' | 'scribe' | 'deliver' | 'system'

interface LiveFrame {
  seq: number
  block: LiveBlock
  level: 'info' | 'warn' | 'error'
  text: string
  at: string
}

const MAX_LINES = 400

const BLOCK_STYLE: Record<LiveBlock, string> = {
  expand: 'text-cyan-300',
  compile: 'text-zinc-200',
  gates: 'text-amber-300',
  scribe: 'text-fuchsia-300',
  deliver: 'text-emerald-300',
  system: 'text-zinc-500',
}

const BLOCK_LABEL: Record<LiveBlock, string> = {
  expand: 'EXPAND',
  compile: 'COMPILE',
  gates: 'GATES',
  scribe: 'SCRIBE',
  deliver: 'DELIVER',
  system: 'SYSTEM',
}

export function LiveConsole({ className }: { className?: string }) {
  const [frames, setFrames] = useState<LiveFrame[]>([])
  const [status, setStatus] = useState<'live' | 'paused' | 'reconnect' | 'down'>('reconnect')
  const [lastSeq, setLastSeq] = useState(0)
  const pausedRef = useRef(false)
  const paused = status === 'paused'
  const lastSeqRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)

  /* SSE-подписка: живая шина twin'а, честный reconnect по ?after=seq */
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
        if (!closed) {
          timerRef.current = window.setTimeout(connect, 700)
        }
      })
      es.onerror = () => {
        es.close()
        if (closed) return
        setStatus((s) => (pausedRef.current && s !== 'down' ? 'paused' : 'reconnect'))
        timerRef.current = window.setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      closed = true
      if (timerRef.current) window.clearTimeout(timerRef.current)
      esRef.current?.close()
    }
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
  }, [])

  /* «Copy for AI»: кадры ошибок + контекст — готовый срез для разбора */
  const copyForAi = useCallback(() => {
    const slice = frames.slice(-40)
    const errors = slice.filter((f) => f.level === 'error')
    const chosen = errors.length > 0 ? errors : slice.slice(-12)
    const text = [
      'Живая консоль THREAD 4 (Rust twin :3201) — срез для разбора.',
      chosen.length === 0 ? 'Ошибок в последних кадрах нет — приложен хвост.' : `Ошибочных кадров: ${errors.length}.`,
      '',
      ...chosen.map((f) => `[${BLOCK_LABEL[f.block] ?? f.block}] ${f.level.toUpperCase()} ${f.text}`),
    ].join('\n')
    void navigator.clipboard
      .writeText(text)
      .then(() =>
        toast({ title: 'Срез скопирован', description: `${chosen.length} кадров — вставляй в ИИ` })
      )
      .catch(() =>
        toast({ title: 'Копирование не удалось', description: 'Буфер обмена недоступен', variant: 'destructive' })
      )
  }, [frames])

  const errorCount = frames.filter((f) => f.level === 'error').length

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
          <button
            type="button"
            onClick={copyForAi}
            title="Copy for AI — срез кадров (ошибки приоритетно) в буфер"
            aria-label="скопировать срез для ИИ"
            className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            <ClipboardCopy className="size-3.5" />
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

      {/* полотно терминала */}
      <div
        ref={listRef}
        className="t4-live-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2"
        style={{ maxHeight: 'min(52vh, 480px)' }}
      >
        {frames.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 py-8 text-center font-mono text-[11px] text-zinc-600">
            <Radio className="size-3.5" />
            {status === 'reconnect'
              ? 'подключаюсь к шине twin’а…'
              : 'тишина в эфире — двинь воркфлоу, кадры пойдут сюда'}
          </div>
        ) : (
          <ul className="space-y-0.5 font-mono text-[11px] leading-relaxed">
            {frames.map((f) => (
              <li key={f.seq} className="flex gap-2">
                <span className="w-[54px] shrink-0 text-right text-zinc-700">
                  {String(f.seq).padStart(3, '0')}
                </span>
                <span
                  className={cn(
                    'w-[62px] shrink-0 font-semibold',
                    BLOCK_STYLE[f.block] ?? 'text-zinc-400'
                  )}
                >
                  {BLOCK_LABEL[f.block] ?? f.block}
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
