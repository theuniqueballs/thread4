'use client'

/**
 * THREAD 4 — BUILD DECK «СБОРКА» (2026-10-19, приказ автора).
 *
 * Отдельная кнопка сборки: витрина СКОМПИЛИРОВАННЫХ батчей обоих
 * пространств. Движок живёт в двух эрах одновременно, и слаг T4-NN
 * делится между ними — оттого «два T4-42 ебутся в глаза»:
 *   · ВОРКФЛОУ (scratch twin :3201) — тема → якоря → гейт №25 → compile,
 *     репетиция с полным разбором темы («собираются не сразу»);
 *   · КОНСОЛЬ (прод :3200) — FORCE COMPILE, план пишется сразу в
 *     производственную цепь («собираются сразу»).
 * Оба списка здесь рядышком, с честной меткой пространства, sha10 и
 * статусом; дубль-слаг поднимает багровый баннер с разбором коллизии.
 * Сдать/закрыть можно каждую сборку на её родном движке — кнопки те же,
 * что в воркфлоу и Action Deck, никакой новой мутации не изобретено.
 */

import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  Copy,
  FileSignature,
  Hammer,
  Layers,
  RefreshCw,
  Send,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { asRecord, asStr, commanderHeaders, withGatewayPort } from '@/components/t4/api'
import { formatDate } from '@/components/t4/api'
import {
  enginePost,
  invalidateEngineBatches,
  notify,
  useEngineBatches,
  useScratchBatches,
  writeClipboard,
  type ScratchBatchRow,
} from '@/components/t4/console/shared'
import type { EngineBatchRow } from '@/components/t4/console/panels'

const SPRING = { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 } as const

/* ------------------------------------------------------------------ */
/* статусы · метки пространств                                        */
/* ------------------------------------------------------------------ */

const STATUS_WORD: Record<string, string> = {
  compiled: 'собран',
  delivered: 'сдан',
  void: 'закрыт',
}

function statusDot(status: string): string {
  if (status === 'delivered') return 'bg-emerald-500'
  if (status === 'void') return 'bg-zinc-600'
  return 'bg-amber-400 animate-pulse'
}

function statusText(status: string): string {
  if (status === 'delivered') return 'text-emerald-400'
  if (status === 'void') return 'text-zinc-500'
  return 'text-amber-300'
}

/** twin POST через прокси (ключ прикладывается, конверт {ok,data,error}). */
async function twinPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withGatewayPort(`/api/t4/twin/${path}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commanderHeaders() },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: { message?: unknown } }
    | null
  if (json == null) throw new Error(`twin: HTTP ${res.status} (тело не JSON)`)
  if (!res.ok || json.ok === false) {
    const rec = asRecord(json.error)
    throw new Error(asStr(rec.message) || `twin: HTTP ${res.status}`)
  }
  return json.data as T
}

/* ------------------------------------------------------------------ */
/* строка сборки                                                       */
/* ------------------------------------------------------------------ */

interface RowProps {
  slug: string
  title: string
  status: string
  meta: string
  sha10: string | null
  space: 'scratch' | 'prod'
  busy: string | null
  onDeliver: () => void
  onVoid: () => void
  onOpen?: () => void
}

function BuildRow({ slug, title, status, meta, sha10, space, busy, onDeliver, onVoid, onOpen }: RowProps) {
  const reduceMotion = useReducedMotion()
  const [copied, setCopied] = useState(false)
  const compiled = status === 'compiled'
  const busyRow = busy != null

  const copySha = useCallback(async () => {
    if (sha10 == null || sha10 === '') return
    const ok = await writeClipboard(sha10)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [sha10])

  return (
    <motion.li
      layout={reduceMotion === true ? false : true}
      initial={reduceMotion === true ? undefined : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5',
        space === 'scratch'
          ? 'border-amber-500/20 bg-amber-500/[0.03] hover:border-amber-500/40'
          : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-600'
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(status))} aria-hidden />
      <button
        type="button"
        disabled={onOpen == null}
        onClick={onOpen ?? undefined}
        title={
          onOpen != null
            ? `${slug} — открыть в Батчах`
            : space === 'scratch'
              ? `${slug} — сборка воркфлоу (scratch twin)`
              : `${slug} — план собран, карточка в Батчах появится после сдачи`
        }
        className={cn(
          'flex min-w-0 flex-1 items-baseline gap-2 text-left',
          onOpen != null && 'transition-colors hover:text-amber-200'
        )}
      >
        <span className="shrink-0 font-term text-[12px] text-zinc-200">{slug}</span>
        <span className="truncate text-[12px] text-zinc-500">{title}</span>
      </button>
      <span className={cn('shrink-0 font-term text-[10px] uppercase', statusText(status))}>
        {STATUS_WORD[status] ?? status}
      </span>
      <span className="w-full truncate font-mono text-[10px] text-zinc-600 sm:w-auto">{meta}</span>
      {sha10 != null && sha10 !== '' ? (
        <button
          type="button"
          onClick={() => void copySha()}
          title={`sha10 ${sha10} — скопировать`}
          className="flex shrink-0 items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-px font-mono text-[10px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
        >
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          {sha10}
        </button>
      ) : null}
      {compiled ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={busyRow}
            onClick={onDeliver}
            className="flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-1 font-mono text-[10px] font-semibold text-zinc-950 transition-all hover:bg-emerald-400 active:scale-[0.97] disabled:opacity-40"
          >
            <Send className="size-3" />
            {busy === 'deliver' ? 'сдаю…' : 'сдать'}
          </button>
          <button
            type="button"
            disabled={busyRow}
            onClick={onVoid}
            title="закрыть сборку навсегда — провенанс останется, номер не переиспользуется"
            className="rounded-md border border-rose-500/40 px-2 py-1 font-mono text-[10px] text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
          >
            {busy === 'void' ? '…' : 'void'}
          </button>
        </span>
      ) : null}
    </motion.li>
  )
}

/* ------------------------------------------------------------------ */
/* секция пространства                                                 */
/* ------------------------------------------------------------------ */

function SpacePanel(props: {
  space: 'scratch' | 'prod'
  title: string
  hint: string
  loading: boolean
  children: React.ReactNode
  count: number
  total: number
}) {
  const { space } = props
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-zinc-950/70 backdrop-blur-xl">
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        {space === 'scratch' ? (
          <FileSignature className="size-3.5 shrink-0 text-amber-300" />
        ) : (
          <Zap className="size-3.5 shrink-0 text-emerald-400" />
        )}
        <h2 className="font-term text-[11px] uppercase tracking-wide text-zinc-200">{props.title}</h2>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
          {props.loading ? '…' : `${props.count}/${props.total}`}
        </span>
      </header>
      <p className="px-4 pt-2 text-[11px] leading-relaxed text-zinc-500">{props.hint}</p>
      <ul className="t4-scroll max-h-[420px] min-h-[64px] space-y-1.5 overflow-y-auto p-3">{props.children}</ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* главный компонент                                                   */
/* ------------------------------------------------------------------ */

export function BuildDeck({ onOpenBatch }: { onOpenBatch: (slug: string) => void }) {
  const reduceMotion = useReducedMotion()
  const scratch = useScratchBatches()
  const prod = useEngineBatches()

  const [onlyCompiled, setOnlyCompiled] = useState(true)
  const [busy, setBusy] = useState<{ slug: string; space: 'scratch' | 'prod'; action: 'deliver' | 'void' } | null>(null)

  const scratchRows = useMemo(
    () => (onlyCompiled ? scratch.rows.filter((r) => r.status === 'compiled') : scratch.rows),
    [scratch.rows, onlyCompiled]
  )
  const prodRows = useMemo(
    () => (onlyCompiled ? prod.rows.filter((r) => r.status === 'compiled') : prod.rows),
    [prod.rows, onlyCompiled]
  )

  /* дубль-слаги: один T4-NN собран в обоих пространствах (разные батчи!) */
  const dupes = useMemo(() => {
    const prodSlugs = new Set(prod.rows.map((r) => r.slug))
    return scratch.rows.filter((r) => prodSlugs.has(r.slug))
  }, [scratch.rows, prod.rows])

  const refresh = useCallback(() => {
    invalidateEngineBatches()
    scratch.reload()
    prod.reload()
  }, [scratch.reload, prod.reload])

  /* ── мутации: каждая сборка сдаётся/закрывается на РОДНОМ движке ── */

  const deliverScratch = useCallback(
    async (row: ScratchBatchRow) => {
      setBusy({ slug: row.slug, space: 'scratch', action: 'deliver' })
      try {
        const data = await twinPost<{ deliveredAt?: string; summary?: string }>(`batches/${row.slug}/deliver`, {})
        notify('success', `${row.slug} сдан (scratch twin)`, data.summary ?? data.deliveredAt ?? '')
      } catch (e) {
        notify('error', 'Сдача в scratch не прошла', e instanceof Error ? e.message : '')
      } finally {
        setBusy(null)
        refresh()
      }
    },
    [refresh]
  )

  const voidScratch = useCallback(
    async (row: ScratchBatchRow) => {
      if (!window.confirm(`Закрыть ${row.slug} «${row.title}» (scratch twin) навсегда? Провенанс останется, номер не переиспользуется.`)) {
        return
      }
      setBusy({ slug: row.slug, space: 'scratch', action: 'void' })
      try {
        await twinPost(`batches/${row.slug}/void`, {})
        notify('success', `${row.slug} закрыт (void, scratch)`, '')
      } catch (e) {
        notify('error', 'Void в scratch не прошёл', e instanceof Error ? e.message : '')
      } finally {
        setBusy(null)
        refresh()
      }
    },
    [refresh]
  )

  const deliverProd = useCallback(
    async (row: EngineBatchRow) => {
      setBusy({ slug: row.slug, space: 'prod', action: 'deliver' })
      try {
        const res = await enginePost<{
          slug: string
          at: string
          result?: { slots?: number; exp?: number; diffUp?: number; diffDown?: number }
        }>(`batches/${row.slug}/deliver`, {})
        const r = asRecord(res.result)
        notify(
          'success',
          `${row.slug} сдан официально (прод)`,
          `слотов ${asStr(r.slots) || '—'} · EXP ${asStr(r.exp) || '—'} · diff ↑${asStr(r.diffUp) || '—'} ↓${asStr(r.diffDown) || '—'}`
        )
      } catch (e) {
        notify('error', 'Сдача в прод не прошла', e instanceof Error ? e.message : '')
      } finally {
        setBusy(null)
        refresh()
      }
    },
    [refresh]
  )

  const voidProd = useCallback(
    async (row: EngineBatchRow) => {
      if (!window.confirm(`Закрыть ${row.slug} «${row.title}» (прод-цепь) навсегда? Провенанс останется, номер не переиспользуется.`)) {
        return
      }
      setBusy({ slug: row.slug, space: 'prod', action: 'void' })
      try {
        const res = await enginePost<{ slug: string; at: string; eventId: string }>(`batches/${row.slug}/void`, {})
        notify('success', `${row.slug} закрыт (void, прод)`, `событие ${res.eventId}`)
      } catch (e) {
        notify('error', 'Void в прод не прошёл', e instanceof Error ? e.message : '')
      } finally {
        setBusy(null)
        refresh()
      }
    },
    [refresh]
  )

  const rowBusy = (slug: string, space: 'scratch' | 'prod'): string | null =>
    busy != null && busy.slug === slug && busy.space === space ? busy.action : null

  const motionProps = useMemo(
    () =>
      reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 10 },
            animate: { opacity: 1, y: 0 },
            transition: SPRING,
          },
    [reduceMotion]
  )

  return (
    <div className="space-y-4">
      {/* ── шапка витрины ─────────────────────────────────────────── */}
      <motion.section
        {...motionProps}
        className="rounded-xl border border-white/10 bg-zinc-950/70 p-4 backdrop-blur-xl sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-fuchsia-600 shadow-lg shadow-fuchsia-950/40">
              <Hammer className="size-4 text-zinc-950" />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-bold tracking-tight text-zinc-100">Сборка · витрина скомпилированных батчей</h1>
              <p className="truncate text-[11px] text-zinc-500">
                два конвейера делят слаг T4-NN — здесь они рядышком, с меткой пространства и sha10
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              role="group"
              aria-label="фильтр статуса сборок"
              className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5"
            >
              <button
                type="button"
                onClick={() => setOnlyCompiled(true)}
                aria-pressed={onlyCompiled}
                className={cn(
                  'rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-all',
                  onlyCompiled ? 'bg-zinc-100 text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                собранные
              </button>
              <button
                type="button"
                onClick={() => setOnlyCompiled(false)}
                aria-pressed={!onlyCompiled}
                className={cn(
                  'rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-all',
                  !onlyCompiled ? 'bg-zinc-100 text-zinc-950 shadow' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                все
              </button>
            </div>
            <button
              type="button"
              onClick={refresh}
              title="перечитать оба пространства"
              className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
            >
              <RefreshCw className={cn('size-3.5', (scratch.loading || prod.loading) && 'animate-spin')} />
              <span className="hidden sm:inline">перечитать</span>
            </button>
          </div>
        </div>
      </motion.section>

      {/* ── дубль-слаг баннер: коллизия пространств ────────────────── */}
      <AnimatePresence initial={false}>
        {dupes.length > 0 ? (
          <motion.div
            key="dupes"
            role="alert"
            initial={reduceMotion === true ? undefined : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-rose-500/50 bg-rose-950/20 p-4 backdrop-blur-xl">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-rose-300">
                <AlertTriangle className="size-4 shrink-0" />
                Дубль-слаг{dupes.length > 1 ? 'и' : ''}: {dupes.map((d) => d.slug).join(', ')} собран{dupes.length > 1 ? 'ы' : ''} в двух пространствах
              </p>
              <ul className="mt-2 space-y-1">
                {dupes.map((d) => {
                  const prodRow = prod.rows.find((r) => r.slug === d.slug)
                  return (
                    <li key={d.slug} className="break-words font-term text-[11px] text-rose-200/80">
                      · {d.slug}: scratch «{d.title}» (sha10 {d.sha10 || '—'}, {formatDate(d.createdAt)}) ≠ прод «
                      {prodRow?.title ?? '—'}» ({formatDate(prodRow?.createdAt ?? '')}) — это{' '}
                      <span className="text-rose-300">разные батчи</span> с одним номером; судьба каждого решается
                      отдельно (сдать/закрыть на родном движке)
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-[11px] text-zinc-500">
                прод и scratch — независимые летописи; номер переиспользуется между ними, sha10 различает сборки
                байт-в-байт
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── два пространства ──────────────────────────────────────── */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <SpacePanel
          space="scratch"
          title="воркфлоу · scratch twin :3201"
          hint="Полный конвейер: тема → якоря → гейт №25 → compile. Сборки «не сразу» — с правкой якорей и Theme Expansion; репетиция, прод-цепь не тронута."
          loading={scratch.loading}
          count={scratchRows.length}
          total={scratch.rows.length}
        >
          {scratch.loading && scratch.rows.length === 0 ? (
            <li className="px-1 py-3 font-mono text-[11px] text-zinc-600">заряжаю scratch-летопись…</li>
          ) : scratchRows.length === 0 ? (
            <li className="flex items-center gap-2 px-1 py-3 text-[11px] text-zinc-600">
              <Layers className="size-3.5 shrink-0" />
              {onlyCompiled
                ? 'непогашенных сборок нет — воркфлоу ещё компилирует или всё сдано'
                : 'scratch пуст — воркфлоу ещё ничего не собирал'}
            </li>
          ) : (
            scratchRows.map((r) => (
              <BuildRow
                key={r.slug}
                slug={r.slug}
                title={r.title}
                status={r.status}
                sha10={r.sha10}
                space="scratch"
                busy={rowBusy(r.slug, 'scratch')}
                meta={`EXP ${r.expSlots} · hard ${r.hardPass ? 'PASS' : 'FAIL'} · ${formatDate(r.createdAt)}`}
                onDeliver={() => void deliverScratch(r)}
                onVoid={() => void voidScratch(r)}
              />
            ))
          )}
        </SpacePanel>

        <SpacePanel
          space="prod"
          title="консоль · прод :3200"
          hint="FORCE COMPILE из Action Deck — план собирается сразу в производственную цепь (событие batch.compiled в SSoT). Сдача официальна: палитры залочены в окно ротации."
          loading={prod.loading}
          count={prodRows.length}
          total={prod.rows.length}
        >
          {prod.loading && prod.rows.length === 0 ? (
            <li className="px-1 py-3 font-mono text-[11px] text-zinc-600">заряжаю прод-летопись…</li>
          ) : prodRows.length === 0 ? (
            <li className="flex items-center gap-2 px-1 py-3 text-[11px] text-zinc-600">
              <Layers className="size-3.5 shrink-0" />
              {onlyCompiled ? 'в проде не собрано ничего непогашенного' : 'прод молчит — батчей нет'}
            </li>
          ) : (
            prodRows.map((r) => (
              <BuildRow
                key={r.slug}
                slug={r.slug}
                title={r.title}
                status={r.status}
                sha10={null}
                space="prod"
                busy={rowBusy(r.slug, 'prod')}
                meta={`EXP ${r.expSlots} · hard ${r.hardPass ? 'PASS' : 'FAIL'} · ${formatDate(r.createdAt)}`}
                /* карточка в Батчах существует только для сданного корпуса;
                 * compiled ещё не в летописи сдач — линк честно не даём */
                onOpen={r.status === 'delivered' ? () => onOpenBatch(r.slug) : undefined}
                onDeliver={() => void deliverProd(r)}
                onVoid={() => void voidProd(r)}
              />
            ))
          )}
        </SpacePanel>
      </div>

      <p className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
        <Zap className="size-3" />
        сдать = deliver на родном движке (scratch — репетиция автора, прод — официальная цепь) · void закрывает номер
        навсегда · ключ командира нужен для обеих кнопок
      </p>
    </div>
  )
}
