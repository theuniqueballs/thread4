'use client'

/**
 * THREAD 4 — WORKFLOW DECK (Фаза 3, Command Center, 2026-10-19).
 *
 * Единый воркфлоу без переходов по вкладкам: приказ → Theme Expansion
 * (якоря Rust-ядра, правимые автором) → Compile & SCRIBE → Review &
 * Deliver. Всё на scratch-летописи Rust twin'а (:3201): продакшн SSoT не
 * тронут (доктрина dual-DB), гейт №25 режет до транзакции.
 *
 * Пружинная анимация шагов (framer-motion), честные состояния
 * idle→busy→done/error, никаких скрытых прыжков.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  FileSignature,
  Lock,
  PenLine,
  Send,
  Sparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { commanderHeaders, withGatewayPort } from '@/components/t4/api'
import { notify } from '@/components/t4/console/shared'
import type { ActionId } from '@/components/t4/console/shared'

/* ------------------------------------------------------------------ */
/* типы (twin RPC)                                                     */
/* ------------------------------------------------------------------ */

interface OcInput {
  theme: string
  rating: 'R+' | 'R' | 'PG-13' | 'X'
}

interface Receipt {
  gate: string
  level: 'hard' | 'warn' | 'advisory'
  verdict: 'PASS' | 'FAIL' | 'WARN' | 'OFF' | 'REPORT'
  findings?: string[]
  notes?: string[]
}

interface AnchorsState {
  locale?: string
  timeOfDay?: string
  light?: string
  paletteMood?: string
  motifs?: string[]
  wardrobeFamily?: string
  poseFamily?: string
  camera?: string
  atmosphere?: string[]
  tokens?: string[]
  lexiconHits?: string[]
  seed?: string
  minAdherence?: number
}

interface CompileResult {
  slug: string
  sha10: string
  slots: number
  hardPass: boolean
  receipts: Receipt[]
  themeGate: Receipt | null
  themeAnchors: AnchorsState | null
  eventSeq: number
}

type Step = 0 | 1 | 2 | 3

const STEP_LABELS = ['Приказ', 'Theme Expansion', 'Compile & SCRIBE', 'Review & Deliver'] as const

const SPRING = { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 } as const

/* ------------------------------------------------------------------ */
/* мелкие блоки                                                        */
/* ------------------------------------------------------------------ */

function StepHead({
  n,
  title,
  state,
  hint,
}: {
  n: number
  title: string
  state: 'locked' | 'open' | 'done'
  hint?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]',
          state === 'locked' && 'border-zinc-800 bg-zinc-900 text-zinc-600',
          state === 'open' && 'border-amber-500/60 bg-amber-500/10 text-amber-300',
          state === 'done' && 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
        )}
      >
        {state === 'done' ? <CheckCircle2 className="size-3.5" /> : n + 1}
      </span>
      <span
        className={cn(
          'text-sm font-semibold tracking-tight',
          state === 'locked' ? 'text-zinc-600' : 'text-zinc-200'
        )}
      >
        {title}
      </span>
      {hint ? <span className="font-mono text-[10px] text-zinc-600">{hint}</span> : null}
      {state === 'locked' ? <Lock className="size-3 text-zinc-700" /> : null}
    </div>
  )
}

function ReceiptRow({ r }: { r: Receipt }) {
  return (
    <li className="flex items-start gap-2 py-0.5">
      <span
        className={cn(
          'w-[132px] shrink-0 font-mono text-[11px]',
          r.verdict === 'PASS' && 'text-emerald-400',
          r.verdict === 'FAIL' && 'text-rose-400',
          r.verdict === 'WARN' && 'text-amber-300',
          r.verdict === 'OFF' && 'text-zinc-500'
        )}
      >
        {r.gate}
      </span>
      <span
        className={cn(
          'w-[52px] shrink-0 font-mono text-[10px] uppercase',
          r.level === 'hard' ? 'text-rose-300/80' : 'text-zinc-600'
        )}
      >
        {r.level}
      </span>
      <span
        className={cn(
          'font-mono text-[11px]',
          r.verdict === 'PASS' && 'text-emerald-400',
          r.verdict === 'FAIL' && 'text-rose-400',
          r.verdict === 'WARN' && 'text-amber-300',
          r.verdict === 'OFF' && 'text-zinc-500'
        )}
      >
        {r.verdict}
      </span>
      {r.findings && r.findings.length > 0 ? (
        <ul className="min-w-0 space-y-0.5 pl-3">
          {r.findings.map((f, i) => (
            <li key={i} className="break-words text-[11px] text-rose-300/90">
              · {f}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function AnchorField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block min-w-0">
      <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60 focus:bg-zinc-900"
      />
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* главный компонент                                                   */
/* ------------------------------------------------------------------ */

export function WorkflowDeck({
  onFocusAction,
  onMutated,
}: {
  onFocusAction: (id: ActionId) => void
  onMutated: () => void
}) {
  const reduceMotion = useReducedMotion()
  const motionProps = useMemo(
    () =>
      reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 10 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -8 },
            transition: SPRING,
          },
    [reduceMotion]
  )

  /* шаг 0: приказ */
  const [theme, setTheme] = useState('')
  const [slug, setSlug] = useState('')
  const [exp, setExp] = useState(0)
  const [ab, setAb] = useState(2)
  const [engine, setEngine] = useState('per-theme')
  const [oc, setOc] = useState<OcInput[]>([
    { theme: '', rating: 'R+' },
    { theme: '', rating: 'R+' },
    { theme: '', rating: 'R+' },
  ])

  /* шаг 1: якоря + гейт №25 */
  const [anchors, setAnchors] = useState<AnchorsState | null>(null)
  const [themeGate, setThemeGate] = useState<Receipt | null>(null)

  /* правка якорей автором: превью гейта устарело — перепроверка на
   * компиляции (twin strict-валидирует themeAnchors и гоняет гейт №25 заново) */
  const editAnchors = useCallback((next: AnchorsState) => {
    setAnchors(next)
    setThemeGate(null)
  }, [])

  /* шаг 2: компиляция */
  const [compiled, setCompiled] = useState<CompileResult | null>(null)

  /* шаг 3: сдача */
  const [delivered, setDelivered] = useState<string | null>(null)
  const [voided, setVoided] = useState<string | null>(null)

  const [step, setStep] = useState<Step>(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const slugSuggested = useRef<string>('')

  const ocFilled = oc.filter((o) => o.theme.trim().length > 0).length
  const briefReady = theme.trim().length >= 3 && ocFilled >= 1

  /* подсказка следующего слага scratch-летописи twin'а */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(withGatewayPort('/api/t4/twin/state'), {
          headers: commanderHeaders(),
          cache: 'no-store',
        })
        const body = (await res.json()) as {
          data?: { scratch?: { nextSlug?: string } }
        }
        const s = body.data?.scratch?.nextSlug
        if (alive && s && !slug) {
          slugSuggested.current = s
          setSlug(s)
        }
      } catch {
        /* twin молчит — подсказка не критична */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const twinPost = useCallback(
    async <T,>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> => {
      const res = await fetch(withGatewayPort(`/api/t4/twin/${path}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...commanderHeaders(), ...extraHeaders },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      const json = (await res.json()) as { ok?: boolean; data?: T; error?: { message?: string } }
      if (!res.ok || json.ok === false) {
        throw new Error(json.error?.message ?? `twin: HTTP ${res.status}`)
      }
      return json.data as T
    },
    []
  )

  /* ── шаг 1: Theme Expansion ── */
  const runExpand = useCallback(async () => {
    if (!briefReady) return
    setBusy('expand')
    setError(null)
    try {
      const data = await twinPost<{ anchors?: AnchorsState; gate?: Receipt; disabled?: boolean }>(
        'theme/expand',
        {
          theme: theme.trim(),
          slug: slug.trim() || slugSuggested.current || 'T4-00',
          exp,
          ocThemes: oc.filter((o) => o.theme.trim()).map((o) => o.theme.trim()),
        }
      )
      if (data.disabled) {
        setAnchors(null)
        setThemeGate(data.gate ?? null)
      } else {
        setAnchors(data.anchors ?? null)
        setThemeGate(data.gate ?? null)
      }
      setCompiled(null)
      setDelivered(null)
      setVoided(null)
      setStep(1)
      notify('success', 'Тема раскрыта', exp > 0 ? 'EXP-батч — гейт №25 выключен' : 'Якоря готовы к правке')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'тема не разложилась'
      setError(msg)
      notify('error', 'Theme Expansion не прошёл', msg)
    } finally {
      setBusy(null)
    }
  }, [briefReady, theme, slug, exp, oc, twinPost])

  /* ── шаг 2: Compile (с якорями и гейтом №25) ── */
  const runCompile = useCallback(async () => {
    setBusy('compile')
    setError(null)
    try {
      const body: Record<string, unknown> = {
        theme: theme.trim(),
        slug: slug.trim() || slugSuggested.current || undefined,
        engine,
        exp,
        abPairs: ab,
        expandTheme: true,
        ocThemes: oc
          .filter((o) => o.theme.trim())
          .map((o, i) => ({ theme: o.theme.trim(), rating: o.rating, position: i + 1 })),
        species: { on: false, count: 0, list: [] },
      }
      if (anchors != null) {
        body.themeAnchors = anchors
      }
      const data = await twinPost<{
        plan?: { slug?: string; sha10?: string; slots?: unknown[]; receipts?: Receipt[] }
        event?: { seq?: number }
        themeGate?: Receipt
        themeAnchors?: AnchorsState
      }>('compile', body, {
        'Idempotency-Key': `wf-${Date.now().toString(36)}-${slug.trim() || 'auto'}`,
      })
      const plan = data.plan ?? {}
      setCompiled({
        slug: plan.slug ?? '—',
        sha10: plan.sha10 ?? '—',
        slots: Array.isArray(plan.slots) ? plan.slots.length : 0,
        hardPass: (plan.receipts ?? []).every(
          (r) => r.level !== 'hard' || r.verdict === 'PASS' || r.verdict === 'OFF'
        ),
        receipts: plan.receipts ?? [],
        themeGate: data.themeGate ?? null,
        themeAnchors: data.themeAnchors ?? null,
        eventSeq: data.event?.seq ?? 0,
      })
      setDelivered(null)
      setVoided(null)
      setStep(2)
      notify(
        'success',
        `План ${plan.slug ?? ''} готов`,
        `sha10 ${plan.sha10 ?? '—'} · scratch-летопись twin'а`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'компиляция не прошла'
      setError(msg)
      notify('error', 'Компиляция не прошла', msg)
    } finally {
      setBusy(null)
    }
  }, [theme, slug, engine, exp, ab, oc, anchors, twinPost])

  /* ── шаг 3: Deliver / Void (scratch twin'а) ── */
  const runDeliver = useCallback(async () => {
    if (compiled == null) return
    setBusy('deliver')
    setError(null)
    try {
      const data = await twinPost<{ slug?: string; deliveredAt?: string; summary?: string }>(
        `batches/${compiled.slug}/deliver`,
        {}
      )
      setDelivered(data.deliveredAt ?? 'сдано')
      setStep(3)
      onMutated()
      notify('success', `${compiled.slug} сдан (scratch)`, data.summary ?? '')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'сдача не прошла'
      setError(msg)
      notify('error', 'Сдача не прошла', msg)
    } finally {
      setBusy(null)
    }
  }, [compiled, twinPost, onMutated])

  const runVoid = useCallback(async () => {
    if (compiled == null) return
    if (!window.confirm(`Закрыть ${compiled.slug} навсегда? Провенанс останется, номер не переиспользуется.`)) {
      return
    }
    setBusy('void')
    try {
      await twinPost(`batches/${compiled.slug}/void`, {})
      setVoided('закрыт (void)')
      onMutated()
      notify('success', `${compiled.slug} закрыт (void)`, '')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'void не прошёл'
      setError(msg)
      notify('error', 'Void не прошёл', msg)
    } finally {
      setBusy(null)
    }
  }, [compiled, twinPost, onMutated])

  const stepState = (n: number): 'locked' | 'open' | 'done' => {
    if (step > n) return 'done'
    if (step === n) return 'open'
    return 'locked'
  }

  const panel =
    'rounded-xl border border-zinc-800/80 bg-zinc-950/70 backdrop-blur transition-colors'

  return (
    <div className="space-y-3">
      {/* ── шаг 0: приказ ─────────────────────────────────────── */}
      <motion.section {...motionProps} className={cn(panel, 'p-4 sm:p-5')}>
        <StepHead n={0} title={STEP_LABELS[0]} state={stepState(0)} hint="тема · слаг · OC · EXP" />
        {step === 0 ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_170px]">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                  тема батча (1..200)
                </span>
                <textarea
                  value={theme}
                  onChange={(e) => setTheme(e.target.value.slice(0, 200))}
                  rows={2}
                  placeholder="полночь в зимнем городе у рождественского рынка"
                  className="mt-1 w-full resize-none rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60 focus:bg-zinc-900"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">слаг</span>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toUpperCase().slice(0, 6))}
                    placeholder="T4-99"
                    className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase text-zinc-500">exp</span>
                    <input
                      type="number"
                      min={0}
                      max={9}
                      value={exp}
                      onChange={(e) => setExp(Math.max(0, Math.min(9, Number(e.target.value) || 0)))}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-amber-500/60"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase text-zinc-500">a/b</span>
                    <input
                      type="number"
                      min={2}
                      max={3}
                      value={ab}
                      onChange={(e) => setAb(Math.max(2, Math.min(3, Number(e.target.value) || 2)))}
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-amber-500/60"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {oc.map((o, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    value={o.theme}
                    onChange={(e) => {
                      const next = [...oc]
                      next[i] = { ...o, theme: e.target.value.slice(0, 120) }
                      setOc(next)
                    }}
                    placeholder={`OC-${i + 1} тема`}
                    className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 text-[12px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60"
                  />
                  <select
                    value={o.rating}
                    onChange={(e) => {
                      const next = [...oc]
                      next[i] = { ...o, rating: e.target.value as OcInput['rating'] }
                      setOc(next)
                    }}
                    aria-label={`рейтинг OC-${i + 1}`}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-1 py-1.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-amber-500/60"
                  >
                    {(['PG-13', 'R', 'R+', 'X'] as const).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!briefReady || busy != null}
                onClick={runExpand}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-rose-500 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-lg shadow-fuchsia-950/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                <Sparkles className="size-4" />
                {busy === 'expand' ? 'раскрываю…' : 'Раскрыть тему'}
                <ArrowRight className="size-4" />
              </button>
              <span className="font-mono text-[10px] text-zinc-600">
                слаг-подсказка: {slugSuggested.current || '—'} · движок: {engine}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-2 truncate font-mono text-[11px] text-zinc-500">
            «{theme}» · {slug} · EXP {exp} · A/B {ab} · OC {ocFilled}
          </p>
        )}
      </motion.section>

      {/* ── шаг 1: Theme Expansion ──────────────────────────── */}
      <AnimatePresence initial={false}>
        {step >= 1 ? (
          <motion.section
            key="expand"
            {...motionProps}
            className={cn(panel, 'p-4 sm:p-5')}
          >
            <StepHead n={1} title={STEP_LABELS[1]} state={stepState(1)} hint="якоря правятся — гейт №25" />
            {exp > 0 ? (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[12px] text-zinc-400">
                <AlertTriangle className="size-3.5 text-zinc-500" />
                EXP-батч — Theme Expansion и гейт №25 выключены (приказ автора, вердикт T4-34).
              </div>
            ) : anchors == null ? (
              <p className="mt-2 font-mono text-[11px] text-zinc-500">якоря не вычислены</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <AnchorField
                    label="локейшн"
                    value={anchors.locale ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, locale: v })}
                  />
                  <AnchorField
                    label="время"
                    value={anchors.timeOfDay ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, timeOfDay: v })}
                  />
                  <AnchorField
                    label="свет"
                    value={anchors.light ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, light: v })}
                  />
                  <AnchorField
                    label="палитральное настроение"
                    value={anchors.paletteMood ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, paletteMood: v })}
                  />
                  <AnchorField
                    label="гардероб"
                    value={anchors.wardrobeFamily ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, wardrobeFamily: v })}
                  />
                  <AnchorField
                    label="камера"
                    value={anchors.camera ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, camera: v })}
                  />
                  <AnchorField
                    label="позы"
                    value={anchors.poseFamily ?? ''}
                    onChange={(v) => editAnchors({ ...anchors, poseFamily: v })}
                  />
                  <AnchorField
                    label="мотивы (через /)"
                    value={(anchors.motifs ?? []).join(' / ')}
                    onChange={(v) =>
                      editAnchors({
                        ...anchors,
                        motifs: v.split('/').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                  <AnchorField
                    label="атмосфера (через /)"
                    value={(anchors.atmosphere ?? []).join(' / ')}
                    onChange={(v) =>
                      editAnchors({
                        ...anchors,
                        atmosphere: v.split('/').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </div>

                {anchors.lexiconHits && anchors.lexiconHits.length > 0 ? (
                  <p className="font-mono text-[10px] text-zinc-600">
                    лексикон: {anchors.lexiconHits.join(' · ')}
                  </p>
                ) : null}

                {themeGate ? (
                  <div
                    className={cn(
                      'rounded-md border px-3 py-2',
                      themeGate.verdict === 'PASS' && 'border-emerald-500/30 bg-emerald-500/5',
                      themeGate.verdict === 'FAIL' && 'border-rose-500/40 bg-rose-500/5',
                      themeGate.verdict === 'OFF' && 'border-zinc-800 bg-zinc-900/40'
                    )}
                  >
                    <p className="flex items-center gap-2 text-[12px]">
                      <span className="font-mono text-zinc-400">гейт №25 «theme»</span>
                      <span
                        className={cn(
                          'font-mono font-semibold',
                          themeGate.verdict === 'PASS' && 'text-emerald-400',
                          themeGate.verdict === 'FAIL' && 'text-rose-400',
                          themeGate.verdict === 'OFF' && 'text-zinc-500'
                        )}
                      >
                        {themeGate.verdict}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-600">
                        {themeGate.notes?.join(' · ')}
                      </span>
                    </p>
                    {themeGate.findings && themeGate.findings.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {themeGate.findings.map((f, i) => (
                          <li key={i} className="text-[11px] text-rose-300/90">
                            · {f}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 font-mono text-[10px] text-zinc-500">
                    якоря правлены — гейт №25 перепроверится на компиляции (strict)
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={runCompile}
                    className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition-all hover:bg-white active:scale-[0.98] disabled:opacity-40"
                  >
                    <FileSignature className="size-4" />
                    {busy === 'compile' ? 'компилирую…' : 'Compile → SCRIBE'}
                  </button>
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={runExpand}
                    title="пересчитать якоря по текущей теме (правки якорей применятся на компиляции)"
                    className="rounded-lg border border-zinc-800 px-3 py-2 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                  >
                    пересчитать по теме
                  </button>
                  {themeGate?.verdict === 'FAIL' ? (
                    <span className="font-mono text-[10px] text-rose-400">
                      гейт №25 FAIL — правь якоря выше или тему
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* ── шаг 2: Compile & SCRIBE ───────────────────────────── */}
      <AnimatePresence initial={false}>
        {step >= 2 && compiled != null ? (
          <motion.section key="compile" {...motionProps} className={cn(panel, 'p-4 sm:p-5')}>
            <StepHead
              n={2}
              title={STEP_LABELS[2]}
              state={stepState(2)}
              hint={`sha10 ${compiled.sha10}`}
            />
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
                <span className="text-amber-300">{compiled.slug}</span>
                <span className="text-zinc-500">слотов {compiled.slots}</span>
                <span className="text-zinc-500">событие seq {compiled.eventSeq}</span>
                <span className={compiled.hardPass ? 'text-emerald-400' : 'text-rose-400'}>
                  hard {compiled.hardPass ? 'PASS' : 'FAIL'}
                </span>
                <span className="text-zinc-600">scratch-летопись twin'а · SSoT не тронут</span>
              </div>

              <ul className="rounded-md border border-zinc-800/70 bg-zinc-900/30 px-3 py-2">
                {compiled.receipts.map((r) => (
                  <ReceiptRow key={r.gate} r={r} />
                ))}
                {compiled.themeGate ? <ReceiptRow r={compiled.themeGate} /> : null}
              </ul>

              {/* писец: честная граница LLM-слоя */}
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2">
                <PenLine className="size-3.5 text-fuchsia-300" />
                <span className="text-[11px] text-zinc-400">
                  SCRIBE — LLM-слой (z-ai) живёт в Node-мосту: батч-проза пишется через карточку
                  писца, Rust-ядро держит цепь и гейты.
                </span>
                <button
                  type="button"
                  onClick={() => onFocusAction('scribe')}
                  className="rounded-md border border-fuchsia-500/40 px-2 py-1 font-mono text-[10px] text-fuchsia-300 transition-colors hover:bg-fuchsia-500/10"
                >
                  карточка писца (I)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy != null || !compiled.hardPass}
                  onClick={runDeliver}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98]',
                    compiled.hardPass
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-zinc-950 hover:brightness-110'
                      : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                  )}
                >
                  <Send className="size-4" />
                  {busy === 'deliver' ? 'сдаю…' : 'Deliver'}
                </button>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={runVoid}
                  className="rounded-lg border border-rose-500/40 px-3 py-2 font-mono text-[11px] text-rose-300 transition-colors hover:bg-rose-500/10"
                >
                  Void
                </button>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* ── шаг 3: Review & Deliver ──────────────────────────── */}
      <AnimatePresence initial={false}>
        {step >= 3 && (delivered != null || voided != null) ? (
          <motion.section key="review" {...motionProps} className={cn(panel, 'p-4 sm:p-5')}>
            <StepHead n={3} title={STEP_LABELS[3]} state="done" />
            <p
              className={cn(
                'mt-2 font-mono text-[12px]',
                delivered != null ? 'text-emerald-400' : 'text-rose-300'
              )}
            >
              {delivered != null
                ? `${compiled?.slug} сдан в scratch-летопись twin'а (${delivered}) — цепь движка продакшн-эры не тронута`
                : `${compiled?.slug} ${voided}`}
            </p>
            <p className="mt-1 font-mono text-[10px] text-zinc-600">
              вердикт по рендеру и производственная сдача — решения автора (священные правила)
            </p>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* ── ошибка (честно, без масок) ────────────────────────── */}
      {error != null ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2.5"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-rose-300">настоящая причина (без масок):</p>
            <p className="break-words font-mono text-[11px] text-rose-200/80">{error}</p>
          </div>
        </div>
      ) : null}

      {/* ── степпер-подсказка ──────────────────────────────────── */}
      <p className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
        <ChevronDown className="size-3" />
        один поток без вкладок: приказ → якоря → компиляция → сдача ·{' '}
        <Compass className="size-3" /> следующий шаг открывается сам
      </p>
    </div>
  )
}
