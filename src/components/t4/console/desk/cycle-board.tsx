'use client'

/**
 * РАБОЧИЙ СТОЛ: ЦИКЛ (Фаза 5, UI v2).
 *
 * Конечный автомат ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER — главный
 * экран вместо двух видов (воркфлоу файл-эры + консоль действий). Состояние
 * автомата живут СОБЫТИЯМИ в летописи (фаза 3) — здесь только честное
 * отображение и руки автора: заказ (тема + OC-темы), шаг, одобрение
 * экспозиции (human-gate), повтор гейтов. Вся семантика — в оркестраторе;
 * UI и CLI зовут ОДИН код через /api/t4/cycle, дрейфа нет.
 *
 * Честность: движок молчит / гейты режут / замок командира — формулировка
 * стопа показывается автору как есть (kind-цвет + текст), ничего не маскируется.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { notify, useVisibleInterval } from '@/components/t4/console/shared'
import { postJson, useApi } from '@/components/t4/api'

const CYCLE_STEPS = ['ORDER', 'COMPILE', 'EXPOSITION', 'WRITE', 'GATES', 'DELIVER'] as const
type CycleStep = (typeof CYCLE_STEPS)[number]

const STEP_LABEL: Record<CycleStep, string> = {
  ORDER: 'Приказ',
  COMPILE: 'Сборка плана',
  EXPOSITION: 'Экспозиция',
  WRITE: 'Письмо',
  GATES: 'Гейты',
  DELIVER: 'Сдача',
}

const STEP_HINT: Record<CycleStep, string> = {
  ORDER: 'тема автора + 1..3 OC-темы — крафтовый вход заказа (канон движка)',
  COMPILE: 'план соберёт живой движок (зрячее окно, гейты планировки)',
  EXPOSITION: 'мост: план → богатый контракт; EXP-заглушки ждут твоей руки',
  WRITE: 'human-gate: контракт читает автор; продолжение — только одобрением',
  GATES: 'официальный прогон; hard FAIL — стоп с отчётом, не тихая починка',
  DELIVER: 'сдача в прод-летопись; окно ротации исключит батч из свежих палитр',
}

interface CycleState {
  done: Record<string, boolean>
  next: CycleStep | null
  theme: string | null
  voided: boolean
  staleHardFail: boolean
}

interface CycleFacts {
  plan: { found: boolean; source?: string; status?: string; sha10?: string | null; slots?: number }
  contractOnDisk: boolean
  draftOnDisk: boolean
  draftSha10: string | null
  lastGateRun: { sha10: string; hardPass: boolean; run: number } | null
}

interface CycleReceipt {
  at: string
  step: string
  summary: string
  sha10: string | null
}

interface CycleDetail {
  ok: boolean
  slug: string
  state: CycleState
  facts: CycleFacts
  receipts: CycleReceipt[]
}

interface OpenCycleLite {
  slug: string
  theme: string | null
  lastStep: string | null
}

interface StopPayload {
  kind: string
  message: string
}

interface StepOutcomeLite {
  slug: string
  step: string
  action: string
  lines: string[]
  sha10?: string | null
  hardPass?: boolean
}

interface AutoReportLite {
  slug: string
  theme: string | null
  executed: { step: string; action: string; lines: string[]; sha10?: string | null }[]
  stopped: StopPayload | null
  nextHint: string | null
}

function fmtTime(at: string): string {
  try {
    return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return at
  }
}

function stepDotState(step: CycleStep, detail: CycleDetail | null): 'done' | 'next' | 'wait' | 'stale' | 'void' {
  if (detail == null) return 'wait'
  if (detail.state.voided) return 'void'
  if (detail.state.done[step]) return 'done'
  if (detail.state.next === step) return detail.state.staleHardFail && step === 'GATES' ? 'stale' : 'next'
  return 'wait'
}

const DOT_STYLE: Record<ReturnType<typeof stepDotState>, string> = {
  done: 'bg-emerald-500 text-emerald-300',
  next: 'bg-amber-400 text-amber-300 animate-pulse',
  wait: 'bg-zinc-700 text-zinc-500',
  stale: 'bg-rose-500 text-rose-300',
  void: 'bg-zinc-600 text-zinc-400',
}

function StepIcon({ state }: { state: ReturnType<typeof stepDotState> }) {
  if (state === 'done') return <CheckCircle2 className="size-4" />
  if (state === 'next') return <CircleDot className="size-4" />
  if (state === 'stale') return <ShieldAlert className="size-4" />
  if (state === 'void') return <Ban className="size-4" />
  return <Circle className="size-4" />
}

export function CycleBoard(props: {
  focusSlug: string | null
  onSlugConsumed: () => void
  onMutated: () => void
}) {
  const [slugInput, setSlugInput] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  const [theme, setTheme] = useState('')
  const [oc1, setOc1] = useState('')
  const [oc2, setOc2] = useState('')
  const [oc3, setOc3] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [report, setReport] = useState<{
    title: string
    lines: string[]
    stopped: StopPayload | null
    nextHint: string | null
    tone: 'ok' | 'stop' | 'fail'
  } | null>(null)

  const openList = useApi<{ ok: boolean; open: OpenCycleLite[] }>(slug == null ? '/api/t4/cycle' : null)
  const detail = useApi<CycleDetail>(slug != null ? `/api/t4/cycle?slug=${encodeURIComponent(slug)}` : null)

  /* фокус из скорборда («открыть в цикле») */
  useEffect(() => {
    if (props.focusSlug != null && props.focusSlug !== '') {
      setSlug(props.focusSlug)
      props.onSlugConsumed()
    }
  }, [props.focusSlug, props.onSlugConsumed])

  const detailRef = detail
  const openListRef = openList
  const reloadAll = useCallback(() => {
    detailRef.reload()
    openListRef.reload()
    props.onMutated()
  }, [detailRef, openListRef, props])

  useVisibleInterval(() => {
    detail.reload()
    if (slug == null) openList.reload()
  }, 10_000)

  const runAction = useCallback(
    async (
      key: string,
      body: Record<string, unknown>,
      onDone: (data: { outcome?: StepOutcomeLite; report?: AutoReportLite }) => void
    ) => {
      setBusy(key)
      try {
        const res = await postJson<{ ok: boolean; outcome?: StepOutcomeLite; report?: AutoReportLite; stopped?: StopPayload; error?: string }>(
          '/api/t4/cycle',
          body
        )
        if (res.ok) {
          onDone(res)
          reloadAll()
        } else if (res.stopped != null) {
          setReport({
            title: `честный стоп (${res.stopped.kind})`,
            lines: [],
            stopped: res.stopped,
            nextHint: null,
            tone: res.stopped.kind === 'hard-fail' ? 'fail' : 'stop',
          })
          notify(res.stopped.kind === 'hard-fail' ? 'error' : 'info', `Цикл: ${res.stopped.kind}`, res.stopped.message.slice(0, 160))
        } else {
          setReport({ title: 'отказ', lines: [res.error ?? 'причина не названа'], stopped: null, nextHint: null, tone: 'fail' })
        }
      } catch (e) {
        setReport({ title: 'сеть/движок', lines: [e instanceof Error ? e.message : String(e)], stopped: null, nextHint: null, tone: 'fail' })
      } finally {
        setBusy(null)
      }
    },
    [reloadAll]
  )

  const doOrder = useCallback(
    async (untilExposition: boolean) => {
      const ocs = [oc1, oc2, oc3].map((s) => s.trim()).filter(Boolean)
      await runAction(
        'order',
        { action: 'auto', theme: theme.trim(), ocThemes: ocs, until: untilExposition ? 'EXPOSITION' : 'ORDER' },
        (data) => {
          if (data.report != null) {
            const rep = data.report
            if (rep.slug !== '') setSlug(rep.slug)
            setReport({
              title: `авто-заказ: ${rep.slug} «${rep.theme ?? theme.trim()}»`,
              lines: rep.executed.flatMap((x) => x.lines),
              stopped: rep.stopped,
              nextHint: rep.nextHint,
              tone: rep.stopped != null && rep.stopped.kind === 'hard-fail' ? 'fail' : 'ok',
            })
            notify('success', 'Заказ заквитанцеван', `${rep.slug} — цикл открыт в летописи`)
          }
        }
      )
    },
    [theme, oc1, oc2, oc3, runAction]
  )

  const doStep = useCallback(
    async (step: CycleStep) => {
      if (slug == null) return
      await runAction(step, { action: 'step', slug, step }, (data) => {
        if (data.outcome != null) {
          const out = data.outcome
          setReport({
            title: `${out.slug}: ${step} — ${out.action === 'skip' ? 'пропущен (идемпотентность)' : 'выполнен'}`,
            lines: out.lines,
            stopped: null,
            nextHint: null,
            tone: 'ok',
          })
          notify('success', `Цикл: ${step}`, out.lines[0]?.slice(0, 140) ?? 'шаг отработал')
        }
      })
    },
    [slug, runAction]
  )

  const doApproveWrite = useCallback(async () => {
    if (slug == null) return
    await runAction('WRITE', { action: 'auto', slug, step: 'WRITE' }, (data) => {
      if (data.report != null) {
        const rep = data.report
        setReport({
          title: `${rep.slug}: WRITE по одобрению автора`,
          lines: rep.executed.flatMap((x) => x.lines),
          stopped: rep.stopped,
          nextHint: rep.nextHint,
          tone: rep.stopped != null && rep.stopped.kind === 'hard-fail' ? 'fail' : 'ok',
        })
      }
    })
  }, [slug, runAction])

  const d = detail.data ?? null
  const next = d?.state.next ?? null

  return (
    <div className="space-y-4" aria-label="рабочий стол: цикл">
      {/* ── выбор цикла ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 backdrop-blur-xl">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-200">
            <Zap className="size-4 text-amber-400" /> Цикл батча
            <span className="font-mono text-[10px] font-normal text-zinc-500">ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER</span>
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                detail.reload()
                openList.reload()
              }}
              title="перечитать состояние цикла из летописи"
              className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-300"
            >
              <RefreshCw className="size-3" /> перечитать
            </button>
          </div>
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && /^T4-[\d.]+(-EXP)?$/i.test(slugInput.trim())) {
                setSlug(slugInput.trim().toUpperCase())
              }
            }}
            placeholder="T4-NN — открыть цикл по слагу"
            className="w-44 rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1.5 font-term text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
            aria-label="слаг цикла"
          />
          <button
            type="button"
            onClick={() => {
              if (/^T4-[\d.]+(-EXP)?$/i.test(slugInput.trim())) setSlug(slugInput.trim().toUpperCase())
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[10px] uppercase text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-300"
          >
            открыть
          </button>
          {slug != null ? (
            <button
              type="button"
              onClick={() => {
                setSlug(null)
                setSlugInput('')
                setReport(null)
              }}
              className="rounded-md border border-zinc-800 px-2 py-1.5 font-mono text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
            >
              ✕ закрыть
            </button>
          ) : null}
          {(openList.data?.open ?? []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-zinc-600">открытые:</span>
              {openList.data!.open.map((o) => (
                <button
                  key={o.slug}
                  type="button"
                  onClick={() => setSlug(o.slug)}
                  title={`тема «${o.theme ?? '—'}» · последний шаг ${o.lastStep ?? '—'}`}
                  className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 font-term text-[11px] text-amber-200 transition-colors hover:bg-amber-500/15"
                >
                  {o.slug}
                </button>
              ))}
            </div>
          ) : slug == null ? (
            <span className="font-mono text-[10px] text-zinc-600">открытых циклов в летописи нет</span>
          ) : null}
        </div>

        {/* ── форма заказа (когда цикл не выбран) ────────────────── */}
        {slug == null ? (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-3">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
              <Sparkles className="size-3" /> новый заказ
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="тема батча (1..200 символов)"
                className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
                aria-label="тема батча"
              />
              <div className="grid grid-cols-3 gap-2">
                <input value={oc1} onChange={(e) => setOc1(e.target.value)} placeholder="OC-тема 1" className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none" aria-label="OC-тема 1" />
                <input value={oc2} onChange={(e) => setOc2(e.target.value)} placeholder="OC-тема 2 (опц.)" className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none" aria-label="OC-тема 2" />
                <input value={oc3} onChange={(e) => setOc3(e.target.value)} placeholder="OC-тема 3 (опц.)" className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none" aria-label="OC-тема 3" />
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={theme.trim() === '' || oc1.trim() === '' || busy != null}
                onClick={() => void doOrder(false)}
                className="rounded-md bg-amber-500 px-3 py-1.5 font-mono text-[11px] font-semibold text-zinc-950 transition-opacity hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'order' ? 'заказ идёт…' : 'заказать (ORDER)'}
              </button>
              <button
                type="button"
                disabled={theme.trim() === '' || oc1.trim() === '' || busy != null}
                onClick={() => void doOrder(true)}
                className="rounded-md border border-amber-500/50 px-3 py-1.5 font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                title="ORDER → COMPILE → EXPOSITION одной цепочкой (стоп перед WRITE — human-gate)"
              >
                {busy === 'order' ? 'идёт…' : 'заказ + сборка + экспозиция'}
              </button>
              <span className="self-center font-mono text-[10px] text-zinc-600">
                OC-темы обязательны: 1..3 — вкус автора, система его не выдумывает (§1)
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── степпер цикла ───────────────────────────────────────── */}
      {slug != null ? (
        <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 backdrop-blur-xl" aria-label="степпер цикла">
          {detail.loading && d == null ? (
            <p className="font-mono text-xs text-zinc-500">читаю факты цикла (диск + летопись + движок)…</p>
          ) : detail.error != null ? (
            <p className="font-mono text-xs text-rose-300">{detail.error}</p>
          ) : d != null ? (
            <>
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-term text-sm text-zinc-100">
                    {d.slug} <span className="text-zinc-500">«{d.state.theme ?? '—'}»</span>
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                    {d.facts.plan.found
                      ? `план: ${d.facts.plan.source} · ${d.facts.plan.status} · sha10 ${d.facts.plan.sha10 ?? '—'}${d.facts.plan.slots != null ? ` · ${d.facts.plan.slots} слотов` : ''}`
                      : 'плана у движка нет'}
                    {d.facts.contractOnDisk ? ' · контракт на диске' : ''}
                    {d.facts.draftOnDisk ? ` · черновик sha10 ${d.facts.draftSha10 ?? '—'}` : ''}
                    {d.facts.lastGateRun != null ? ` · гейты: прогон ${d.facts.lastGateRun.run}, ${d.facts.lastGateRun.hardPass ? 'PASS' : 'FAIL'}` : ''}
                  </p>
                </div>
                {d.state.voided ? (
                  <span className="rounded border border-zinc-600 px-2 py-0.5 font-mono text-[10px] uppercase text-zinc-400">закрыт (void)</span>
                ) : d.state.next == null ? (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-emerald-300">завершён</span>
                ) : (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                    следующий: {d.state.next}
                  </span>
                )}
              </header>

              {/* степпер: горизонтально на md+, вертикально на мобильном */}
              <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-6">
                {CYCLE_STEPS.map((step, i) => {
                  const st = stepDotState(step, d)
                  const rec = d.receipts.filter((r) => r.step === step).slice(-1)[0]
                  return (
                    <li
                      key={step}
                      className={cn(
                        'rounded-lg border p-2.5 transition-colors',
                        st === 'next' ? 'border-amber-500/40 bg-amber-500/5' : st === 'done' ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : st === 'stale' ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/40'
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={cn('shrink-0', DOT_STYLE[st])}>
                          <StepIcon state={st} />
                        </span>
                        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-wide text-zinc-400">
                          {i + 1}. {STEP_LABEL[step]}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[9px] leading-snug text-zinc-600">{rec != null ? `${fmtTime(rec.at)} · ${rec.sha10 ?? ''}` : STEP_HINT[step]}</p>
                    </li>
                  )
                })}
              </ol>

              {/* ── зона действия следующего шага ─────────────────── */}
              <div className="mt-4">
                {d.state.voided ? (
                  <p className="rounded-lg border border-zinc-700 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-400">
                    Цикл закрыт (void) — делать нечего. Номер не переиспользуется; следующий заказ — новый слаг.
                  </p>
                ) : next == null ? (
                  <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 font-mono text-xs text-emerald-300">
                    Цикл ЗАВЕРШЁН: batch.delivered в летописи. Повтор шагов ничего не родит (идемпотентность).
                  </p>
                ) : next === 'WRITE' && !d.state.voided ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-3">
                    <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-300">
                      <ShieldAlert className="size-3.5" /> human-gate: экспозиция готова
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                      Контракт собран и ждёт твоей руки: EXP-гипотезы — детерминированные заглушки под редактуру
                      (contracts/{d.slug}.json). WRITE запускается только явным одобрением автора.
                    </p>
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => void doApproveWrite()}
                      className="mt-2.5 rounded-md bg-amber-500 px-3 py-1.5 font-mono text-[11px] font-semibold text-zinc-950 transition-opacity hover:bg-amber-400 disabled:opacity-40"
                    >
                      {busy === 'WRITE' ? 'писец работает…' : 'одобряю — писать (WRITE)'}
                    </button>
                  </div>
                ) : next === 'GATES' && d.state.staleHardFail ? (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-3">
                    <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-rose-300">
                      <ShieldAlert className="size-3.5" /> гейты ловили hard FAIL по неизменённому черновику
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                      Почини черновик против контракта (polish или руками) — новый sha10 откроет честный повторный прогон.
                      Повтор по неизменённому тексту гейты не примут (дубля gate.run не будет).
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => void doStep(next!)}
                      className="flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 font-mono text-[11px] font-semibold text-zinc-950 transition-opacity hover:bg-amber-400 disabled:opacity-40"
                    >
                      <Play className="size-3" /> {busy === next ? `${STEP_LABEL[next!]} идёт…` : `${STEP_LABEL[next!]} (${next})`}
                    </button>
                    <span className="font-mono text-[10px] text-zinc-600">{STEP_HINT[next!]}</span>
                  </div>
                )}
              </div>

              {/* ── отчёт последнего действия ─────────────────────── */}
              {report != null ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'mt-3 rounded-lg border p-3',
                    report.tone === 'fail' ? 'border-rose-500/30 bg-rose-500/[0.04]' : report.tone === 'stop' ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-emerald-500/25 bg-emerald-500/[0.04]'
                  )}
                >
                  <p className={cn('font-mono text-[11px] uppercase tracking-wider', report.tone === 'fail' ? 'text-rose-300' : report.tone === 'stop' ? 'text-amber-300' : 'text-emerald-300')}>
                    {report.title}
                  </p>
                  {report.stopped != null ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{report.stopped.message}</p>
                  ) : null}
                  {report.lines.length > 0 ? (
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-term text-[10px] leading-relaxed text-zinc-500 t4-scroll">{report.lines.join('\n')}</pre>
                  ) : null}
                  {report.nextHint != null ? <p className="mt-1.5 font-mono text-[10px] text-zinc-600">{report.nextHint}</p> : null}
                </motion.div>
              ) : null}

              {/* ── квитанции шагов ───────────────────────────────── */}
              {d.receipts.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
                    квитанции cycle.step ({d.receipts.length})
                  </summary>
                  <div className="mt-2 max-h-44 space-y-1 overflow-y-auto t4-scroll">
                    {d.receipts.map((r, i) => (
                      <p key={`${r.at}-${i}`} className="font-mono text-[10px] leading-relaxed text-zinc-600">
                        <span className="text-zinc-500">{fmtTime(r.at)}</span> · {r.step}
                        {r.sha10 != null ? <span className="text-amber-500/70"> · {r.sha10}</span> : null} · {r.summary}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {/* ── факты (когда цикл открыт, но план ещё не собран) ────── */}
      {slug != null && d?.facts.draftOnDisk ? (
        <p className="flex items-center gap-1.5 px-1 font-mono text-[10px] text-zinc-600">
          <FileText className="size-3" /> черновик batches/{d.slug}.md на диске · sha10 {d.facts.draftSha10 ?? '—'}
        </p>
      ) : null}
    </div>
  )
}
