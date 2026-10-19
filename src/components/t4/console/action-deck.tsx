'use client'

/**
 * THREAD 4 — Action Deck (первый уровень, эра «МОЩНОСТЬ» 2026-10-18).
 *
 * Девять рабочих действий, каждое — честный workflow:
 *   idle (форма) → dry-run превью → подтверждение → шаги с логом →
 *   результат (success/error) + уведомление + перезарядка данных.
 * Кнопка не «стреляет в пустоту»: у каждого действия виден исход.
 *
 *   BURN & REBUILD — выбор батча + ОДНА переменная → полный ре-аудит
 *     цепи чанками (burn) → POST /v1/compile со слагом (rebuild)
 *   FORCE COMPILE — тема + опции + OC-темы (Zod-контракт движка) →
 *     POST /v1/compile с Idempotency-Key → квитанции построчно
 *   PURGE HEAP — предпросмотр «что уйдёт» → сброс буфера ленты →
 *     перечит (откат при ошибке: старый буфер возвращается)
 *   VERIFY — локальная проверка всех звеньев + авторитет движка
 *   VOID / DELIVER — выбор батча → подтверждение → POST движка
 *   REAPER — голос жнеца (LLM-оракул, файл-эра) с таймером ожидания
 *   SHORE-MERGE — честно: CLI-only, копирование команды
 *   ВЕРДИКТ — вердикт автора по батчу → POST /v1/verdicts (SSoT)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  Check,
  Copy,
  ExternalLink,
  Flame,
  Heart,
  History,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Skull,
  Sparkles,
  Trash2,
  Upload,
  PenLine,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Mono, Panel } from '@/components/t4/bits'
import { MarkdownView } from '@/components/t4/markdown'
import {
  asArray,
  asNum,
  asRecord,
  asStr,
  getCommanderKey,
  postJson,
  postScribeStream,
} from '@/components/t4/api'
import {
  h8,
  type EngineBatchRow,
  type EngineEvent,
  ledgerWriteError,
} from '@/components/t4/console/panels'
import {
  EngineError,
  engineGet,
  enginePost,
  genIdemKey,
  invalidateEngineBatches,
  notify,
  useEngineBatches,
  type ActionId,
  type DrawerId,
} from '@/components/t4/console/shared'

/* ------------------------------------------------------------------ */
/* Общие примитивы deck'а                                              */
/* ------------------------------------------------------------------ */

interface DeckCtx {
  onMutated: () => void
  onOpenBatch: (slug: string) => void
  onOpenDrawer: (id: DrawerId) => void
  onOpenSettings: () => void
}

interface Step {
  label: string
  state: 'idle' | 'active' | 'ok' | 'err'
  detail?: string
}

function StepLog({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-1.5" aria-label="лог шагов действия">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 font-mono text-xs">
          <span
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
              s.state === 'ok'
                ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-400'
                : s.state === 'active'
                  ? 'border-amber-500/60 bg-amber-950/40 text-amber-400'
                  : s.state === 'err'
                    ? 'border-rose-600/60 bg-rose-950/40 text-rose-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-600'
            )}
            aria-label={s.state === 'ok' ? 'готово' : s.state === 'active' ? 'выполняется' : s.state === 'err' ? 'ошибка' : 'ожидание'}
          >
            {s.state === 'ok' ? (
              <Check className="size-3" />
            ) : s.state === 'active' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : s.state === 'err' ? (
              <Skull className="size-3" />
            ) : (
              <span className="text-[9px]">{i + 1}</span>
            )}
          </span>
          <span
            className={cn(
              'min-w-0 break-words',
              s.state === 'ok'
                ? 'text-zinc-400'
                : s.state === 'active'
                  ? 'text-amber-200'
                  : s.state === 'err'
                    ? 'text-rose-300'
                    : 'text-zinc-600'
            )}
          >
            {s.label}
            {s.detail ? <span className="block text-[10px] text-zinc-600">{s.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

function ResultBanner({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      role="alert"
      className={cn(
        'rounded-md border px-3 py-2 font-mono text-xs leading-relaxed',
        ok
          ? 'border-emerald-700/60 bg-emerald-950/20 text-emerald-300'
          : 'border-rose-700/60 bg-rose-950/20 text-rose-300'
      )}
    >
      {children}
    </motion.div>
  )
}

/** Человекочитательный отказ: EngineError (код+подсказка) или файл-эра. */
function errText(e: unknown): string {
  if (e instanceof EngineError) {
    const hint = e.hint != null ? ` · ${e.hint}` : ''
    return `${e.message} [${e.code}]${hint}`
  }
  return ledgerWriteError(e)
}

/** Замок ключа для мутаций: панель честно говорит, что нужна настройка. */
function KeyGate({ onOpenSettings }: { onOpenSettings: () => void }) {
  if (getCommanderKey() !== '') return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/80">
      <KeyRound className="size-3" />
      <span>нужен ключ командира — мутации залочены (403)</span>
      <button
        type="button"
        onClick={onOpenSettings}
        className="rounded border border-amber-500/40 px-1.5 py-0.5 font-mono text-[10px] text-amber-200 transition-colors hover:bg-amber-500/10"
      >
        настроить
      </button>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{children}</p>
}

/** Селект батча движка: слаг · статус · метка пригодности. */
function BatchSelect({
  rows,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  rows: EngineBatchRow[]
  value: string
  onChange: (slug: string) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs text-zinc-200 outline-none transition-colors hover:border-zinc-700 focus-visible:border-amber-500/50 disabled:opacity-40"
    >
      <option value="">— выбери батч движка —</option>
      {rows.map((b) => (
        <option key={b.slug} value={b.slug}>
          {b.slug} · {b.status} · «{b.title}»
        </option>
      ))}
    </select>
  )
}

function DryRunPreview({ body, note }: { body: unknown; note?: string }) {
  return (
    <details className="group rounded-md border border-zinc-800 bg-zinc-950/60">
      <summary className="cursor-pointer select-none px-3 py-2 font-mono text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">
        dry-run: тело запроса ▾
      </summary>
      <div className="space-y-1 px-3 pb-2">
        <pre className="t4-scroll max-h-40 overflow-auto rounded bg-zinc-900/60 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
          {JSON.stringify(body, null, 2)}
        </pre>
        {note ? <p className="text-[10px] leading-relaxed text-zinc-600">{note}</p> : null}
      </div>
    </details>
  )
}

/** Квитанции гейтов компиляции — компактная таблица. */
function ReceiptTable({ receipts }: { receipts: unknown[] }) {
  const rows = receipts.map((r) => {
    const rec = asRecord(r)
    return {
      gate: asStr(rec.gate),
      level: asStr(rec.level),
      verdict: asStr(rec.verdict),
    }
  })
  if (rows.length === 0) return null
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800">
      <div className="grid grid-cols-[minmax(0,1fr)_70px_60px] bg-zinc-900/80 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
        <span>гейт</span>
        <span>уровень</span>
        <span>вердикт</span>
      </div>
      <div className="divide-y divide-zinc-900">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_70px_60px] items-center px-2.5 py-1.5 font-mono text-[11px]">
            <span className="truncate text-zinc-300" title={r.gate}>
              {r.gate}
            </span>
            <span
              className={cn(
                r.level === 'hard' ? 'text-rose-400' : r.level === 'warn' ? 'text-amber-400' : 'text-emerald-500'
              )}
            >
              {r.level}
            </span>
            <span
              className={cn(
                r.verdict === 'PASS'
                  ? 'text-emerald-400'
                  : r.verdict === 'WARN'
                    ? 'text-amber-400'
                    : 'text-rose-400'
              )}
            >
              {r.verdict}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · BURN & REBUILD                                                  */
/* ------------------------------------------------------------------ */

type BurnVar = 'theme' | 'engine' | 'exp' | 'abPairs' | 'notes'

const BURN_VARS: { id: BurnVar; label: string; kind: 'text' | 'number' | 'enum'; hint: string }[] = [
  { id: 'theme', label: 'тема', kind: 'text', hint: 'задаёт заголовок и сид планирования' },
  { id: 'engine', label: 'движок', kind: 'enum', hint: 'per-theme | per-theme raw-plus' },
  { id: 'exp', label: 'EXP-слоты', kind: 'number', hint: '0..9 (оверлей экспансии)' },
  { id: 'abPairs', label: 'A/B-пары', kind: 'number', hint: '2..3' },
  { id: 'notes', label: 'заметки', kind: 'text', hint: 'авторская нота к компиляции' },
]

interface BurnCard {
  slug: string
  title: string
  theme: string
  engine: string
  exp: number
  abPairs: number
  ocThemes: { theme: string; rating: string; position: number }[]
}

function planToCard(card: Record<string, unknown>): BurnCard | null {
  const plan = asRecord(card.plan)
  const slots = asArray(plan.slots)
  const oc = slots
    .map((s) => asRecord(s))
    .filter((s) => asStr(s.kind) === 'OC')
    .map((s, i) => ({
      theme: asStr(s.ocTheme),
      rating: asStr(s.rating) || 'R',
      position: Number(asNum(s.position) ?? i + 1),
    }))
    .filter((s) => s.theme !== '')
  if (oc.length === 0) return null
  return {
    slug: asStr(card.slug),
    title: asStr(card.title),
    theme: asStr(plan.theme) || asStr(card.theme),
    engine: asStr(plan.engine) || 'per-theme',
    exp: Number(asNum(plan.exp) ?? 8),
    abPairs: Number(asNum(plan.abPairs) ?? 2),
    ocThemes: oc,
  }
}

function BurnPanel({ rows, ctx }: { rows: EngineBatchRow[]; ctx: DeckCtx }) {
  const reduce = useReducedMotion() ?? false
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [slug, setSlug] = useState('')
  const [card, setCard] = useState<BurnCard | null>(null)
  const [cardErr, setCardErr] = useState<string | null>(null)
  const [variable, setVariable] = useState<BurnVar>('theme')
  const [value, setValue] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const busyRef = useRef(false)

  const row = rows.find((r) => r.slug === slug)

  /* карта батча — по выбору (обработчик, не эффект) */
  function pickBatch(s: string) {
    setSlug(s)
    setCard(null)
    setCardErr(null)
    if (s === '') return
    engineGet<Record<string, unknown>>(`batches/${s}`)
      .then((c) => {
        const parsed = planToCard(c)
        if (parsed == null) {
          setCardErr('в плане нет OC-слотов — запрос компиляции не восстановить (легаси-батч)')
        } else {
          setCard(parsed)
        }
      })
      .catch((e: unknown) => setCardErr(e instanceof Error ? e.message : 'карта не читается'))
  }

  const base = card
  const rebuilt =
    base != null
      ? {
          ...(slug !== '' ? { slug: base.slug } : {}),
          theme: base.theme,
          engine: base.engine,
          exp: base.exp,
          abPairs: base.abPairs,
          ocThemes: base.ocThemes,
          ...(variable === 'notes' && value.trim() !== '' ? { notes: value.trim() } : {}),
          ...(variable === 'theme' && value.trim() !== '' ? { theme: value.trim() } : {}),
          ...(variable === 'engine' && value.trim() !== '' ? { engine: value.trim() } : {}),
          ...(variable === 'exp' && value.trim() !== '' ? { exp: Number(value) } : {}),
          ...(variable === 'abPairs' && value.trim() !== '' ? { abPairs: Number(value) } : {}),
        }
      : null

  const varDef = BURN_VARS.find((v) => v.id === variable)
  const valueValid =
    varDef == null
      ? false
      : varDef.kind === 'number'
        ? value.trim() !== '' && Number.isFinite(Number(value))
        : value.trim() !== ''

  async function run() {
    if (busyRef.current || rebuilt == null) return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    const log: Step[] = [
      { label: 'burn: читаю полную цепь движка', state: 'active' },
      { label: 'burn: чанковый ре-аудит prev→hash', state: 'idle' },
      { label: 'rebuild: POST /v1/compile (одна переменная)', state: 'idle' },
    ]
    setSteps(log)
    try {
      const evs = (await engineGet<{ events: EngineEvent[] }>('events?after=0&limit=1000')).events ?? []
      const total = evs.length
      setProgress({ done: 0, total })
      const broken: number[] = []
      await new Promise<void>((resolve) => {
        const CHUNK = 48
        let i = 0
        const step = () => {
          const end = Math.min(i + CHUNK, total)
          for (; i < end; i++) {
            const e = evs[i]
            if (e == null) continue
            if (i > 0 && e.prev !== evs[i - 1]?.hash) broken.push(e.seq)
          }
          setProgress({ done: end, total })
          if (i < total) setTimeout(step, reduce ? 0 : 14)
          else resolve()
        }
        step()
      })
      log[0] = { label: 'burn: читаю полную цепь движка', state: 'ok', detail: `${total} звеньев` }
      log[1] = {
        label: 'burn: чанковый ре-аудит prev→hash',
        state: broken.length === 0 ? 'ok' : 'err',
        detail: broken.length === 0 ? 'разрывов нет' : `разрывы: seq ${broken.join(', ')}`,
      }
      setSteps([...log])
      if (broken.length > 0) {
        setResult({
          ok: false,
          text: <>ЦЕПЬ РАЗОРВАНА — rebuild отменён (нельзя строить на сломанной летописи). Лечение: bun thread4/cli.ts verify --heal</>,
        })
        notify('error', 'BURN & REBUILD', `цепь разорвана (${broken.length} разрывов) — rebuild отменён`)
        busyRef.current = false
        setPhase('done')
        return
      }
      const verify = await engineGet<{ ok: boolean; events: number; head: string | null; problems: string[] }>('chain/verify').catch(() => null)
      if (verify != null && !verify.ok) {
        log[1] = {
          label: 'burn: чанковый ре-аудит prev→hash',
          state: 'err',
          detail: `движок видит проблемы: ${verify.problems.slice(0, 2).join(' · ')}`,
        }
        setSteps([...log])
        setResult({ ok: false, text: <>Движок не SEAL: {verify.problems[0] ?? '—'} — rebuild отменён</> })
        notify('error', 'BURN & REBUILD', 'движок видит проблемы цепи — rebuild отменён')
        busyRef.current = false
        setPhase('done')
        return
      }
      log[2] = { label: 'rebuild: POST /v1/compile (одна переменная)', state: 'active' }
      setSteps([...log])
      const res = await enginePost<{ plan: unknown; event: unknown; receipts: unknown[]; idempotentReplay?: boolean }>(
        'compile',
        rebuilt,
        { idempotencyKey: genIdemKey('burn') }
      )
      const plan = asRecord(res.plan)
      const receipts = asArray(res.receipts)
      const hardFail = receipts.some((r) => asRecord(r).level === 'hard' && asStr(asRecord(r).verdict) === 'FAIL')
      log[2] = {
        label: 'rebuild: POST /v1/compile (одна переменная)',
        state: 'ok',
        detail: `${asStr(plan.slug)} «${asStr(plan.title)}» · ${receipts.length} квитанций${res.idempotentReplay === true ? ' · IDEMPOTENT REPLAY' : ''}`,
      }
      setSteps([...log])
      setResult({
        ok: !hardFail,
        text: (
          <div className="space-y-2">
            <div>
              {asStr(plan.slug)} «{asStr(plan.title)}» — {hardFail ? 'HARD FAIL планировочных гейтов' : 'CLEAN RUN'} · EXP{' '}
              {asStr(plan.exp)} · A/B {asStr(plan.abPairs)} · sha10 {asStr(plan.sha10)}
            </div>
            <ReceiptTable receipts={receipts} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => ctx.onOpenBatch(asStr(plan.slug))} className="h-7 bg-amber-500 text-xs text-zinc-950 hover:bg-amber-400">
                <ExternalLink className="mr-1 size-3" /> открыть в Батчах
              </Button>
            </div>
          </div>
        ),
      })
      notify(hardFail ? 'info' : 'success', 'BURN & REBUILD', `${asStr(plan.slug)} перестроен${hardFail ? ' (hard FAIL)' : ' · CLEAN RUN'}`)
      invalidateEngineBatches()
      ctx.onMutated()
    } catch (e) {
      const idx = log.findIndex((s) => s.state === 'active')
      if (idx >= 0) log[idx] = { ...log[idx], state: 'err', detail: errText(e).slice(0, 200) }
      setSteps([...log])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'BURN & REBUILD', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
    }
  }

  const running = phase === 'run'
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Ре-аудит всей цепи <Mono>prev→hash</Mono> (сотни звеньев, видимо, чанками), затем перестройка выбранного
        батча с <b className="text-zinc-300">одной переменной</b> через <Mono>POST /v1/compile</Mono>. Провенанс
        неприкосновенен: слаг пересборки должен быть void (или авто-номер).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>батч (источник базы)</FieldLabel>
          <BatchSelect rows={rows} value={slug} onChange={pickBatch} disabled={running} ariaLabel="батч для перестройки" />
          {row != null ? (
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-zinc-600">
              статус: <span className={row.status === 'void' ? 'text-emerald-400' : 'text-amber-400'}>{row.status}</span>
              {row.status !== 'void'
                ? ' — движок откажет (слаг занят); сначала VOID или выбери авто-слаг'
                : ' — слаг свободен для перестройки'}
            </p>
          ) : null}
        </div>
        <div>
          <FieldLabel>одна переменная</FieldLabel>
          <select
            value={variable}
            onChange={(e) => {
              setVariable(e.target.value as BurnVar)
              setValue('')
            }}
            disabled={running}
            aria-label="переменная перестройки"
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs text-zinc-200 outline-none transition-colors hover:border-zinc-700 focus-visible:border-amber-500/50 disabled:opacity-40"
          >
            {BURN_VARS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.hint}
              </option>
            ))}
          </select>
        </div>
      </div>
      {cardErr ? <p className="text-[11px] text-rose-400">{cardErr}</p> : null}
      {base != null ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 font-mono text-[10px] leading-relaxed text-zinc-500">
          база: {base.slug} · тема «{base.theme.slice(0, 60)}» · движок {base.engine} · EXP {base.exp} · A/B{' '}
          {base.abPairs} · OC×{base.ocThemes.length}
        </div>
      ) : null}
      {varDef != null ? (
        varDef.kind === 'enum' ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={running}
            aria-label="значение переменной"
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs text-zinc-200 outline-none focus-visible:border-amber-500/50"
          >
            <option value="">— значение —</option>
            <option value="per-theme">per-theme</option>
            <option value="per-theme raw-plus">per-theme raw-plus</option>
          </select>
        ) : (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={running}
            type={varDef.kind === 'number' ? 'number' : 'text'}
            placeholder={variable === 'theme' ? 'новая тема — «зеркальный ателье уснувших часов»…' : 'значение переменной'}
            className="h-9 border-zinc-800 bg-zinc-950 font-mono text-xs"
          />
        )
      ) : null}
      {rebuilt != null ? (
        <DryRunPreview
          body={rebuilt}
          note="species не переносится из плана (дефолт off); OC-темы восстанавливаются из слотов плана — wishes теряются"
        />
      ) : null}
      {phase !== 'run' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void run()}
            disabled={rebuilt == null || !valueValid || getCommanderKey() === ''}
            className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            <Flame className="mr-1.5 size-3.5" /> Жечь и перестроить
          </Button>
          <span className="font-mono text-[10px] text-zinc-600">read-only аудит + мутация compile</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative h-9 overflow-hidden rounded-md border border-amber-600/70 bg-amber-950/30">
            <div
              className="absolute inset-y-0 left-0 border-r border-emerald-500/40 bg-emerald-500/15 transition-[width] duration-100"
              style={{ width: `${pct}%` }}
              aria-hidden
            />
            <div className="relative flex h-full items-center justify-center gap-2 font-mono text-xs font-bold tracking-widest text-amber-300">
              <Loader2 className="size-3.5 animate-spin" />
              РЕ-АУДИТ {progress.done}/{progress.total || '…'}
            </div>
          </div>
        </div>
      )}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2 · FORCE COMPILE                                                   */
/* ------------------------------------------------------------------ */

const OC_RATINGS = ['PG-13', 'R', 'R+', 'X'] as const

interface OcRow {
  theme: string
  rating: (typeof OC_RATINGS)[number]
  wishes: string
}

const COMPILE_DRAFT_KEY = 't4-compile-draft'

function readCompileDraft(): { theme: string; notes: string; ocRows: OcRow[] } {
  try {
    const raw = window.localStorage.getItem(COMPILE_DRAFT_KEY)
    if (raw == null) throw new Error('no draft')
    const j = JSON.parse(raw) as Record<string, unknown>
    const oc = asArray(j.ocRows).map((r) => {
      const rec = asRecord(r)
      return {
        theme: asStr(rec.theme),
        rating: (OC_RATINGS as readonly string[]).includes(asStr(rec.rating)) ? (asStr(rec.rating) as OcRow['rating']) : 'R',
        wishes: asStr(rec.wishes),
      }
    })
    return {
      theme: asStr(j.theme),
      notes: asStr(j.notes),
      ocRows: oc.length > 0 ? oc.slice(0, 3) : [{ theme: '', rating: 'R', wishes: '' }],
    }
  } catch {
    return { theme: '', notes: '', ocRows: [{ theme: '', rating: 'R', wishes: '' }] }
  }
}

function CompilePanel({ ctx }: { ctx: DeckCtx }) {
  const [draft, setDraft] = useState(readCompileDraft)
  const [engineMode, setEngineMode] = useState<'per-theme' | 'per-theme raw-plus'>('per-theme')
  const [exp, setExp] = useState('8')
  const [abPairs, setAbPairs] = useState('2')
  const [speciesOn, setSpeciesOn] = useState(false)
  const [speciesList, setSpeciesList] = useState('')
  const [idem, setIdem] = useState(() => genIdemKey('compile'))
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const busyRef = useRef(false)

  /* черновик темы — localStorage (рекомендация ворклога №4) */
  useEffect(() => {
    try {
      window.localStorage.setItem(
        COMPILE_DRAFT_KEY,
        JSON.stringify({ theme: draft.theme, notes: draft.notes, ocRows: draft.ocRows })
      )
    } catch {
      /* приватный режим — черновик не переживёт перезагрузку */
    }
  }, [draft])

  const ocValid = draft.ocRows.filter((r) => r.theme.trim() !== '')
  const themeValid = draft.theme.trim() !== '' && draft.theme.trim().length <= 120
  const expN = Number(exp)
  const abN = Number(abPairs)
  const races = speciesList
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== '')
  const racesValid = races.every((r) => /^R\d{2}$/.test(r))
  const formValid =
    themeValid &&
    ocValid.length >= 1 &&
    ocValid.every((r) => r.theme.trim().length <= 120) &&
    Number.isInteger(expN) &&
    expN >= 0 &&
    expN <= 9 &&
    Number.isInteger(abN) &&
    abN >= 2 &&
    abN <= 3 &&
    (!speciesOn || (racesValid && races.length > 0 && races.length <= 24))

  const body: Record<string, unknown> = {
    theme: draft.theme.trim(),
    engine: engineMode,
    exp: expN,
    abPairs: abN,
    ocThemes: ocValid.map((r, i) => ({
      theme: r.theme.trim(),
      rating: r.rating,
      position: i + 1,
      ...(r.wishes.trim() !== '' ? { wishes: r.wishes.trim().slice(0, 600) } : {}),
    })),
    ...(speciesOn && races.length > 0
      ? { species: { on: true, count: races.length, list: races } }
      : {}),
    ...(draft.notes.trim() !== '' ? { notes: draft.notes.trim().slice(0, 2000) } : {}),
  }

  async function run() {
    if (busyRef.current || !formValid) return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    setSteps([{ label: 'POST /v1/compile → движок планирует 24 слота', state: 'active', detail: `Idempotency-Key ${idem}` }])
    try {
      const res = await enginePost<{ plan: unknown; event: unknown; receipts: unknown[]; idempotentReplay?: boolean }>(
        'compile',
        body,
        { idempotencyKey: idem }
      )
      const plan = asRecord(res.plan)
      const receipts = asArray(res.receipts)
      const steps: Step[] = [
        {
          label: 'POST /v1/compile → движок планирует 24 слота',
          state: 'ok',
          detail: `${asStr(plan.slug)} «${asStr(plan.title)}»${res.idempotentReplay === true ? ' · IDEMPOTENT REPLAY' : ''}`,
        },
        { label: 'квитанции гейтов планирования', state: 'active' },
      ]
      setSteps(steps)
      /* построчное «проживание» квитанций: гейты приходят одним ответом,
         движок выполнил их при планировании — показываем их работу */
      for (let i = 0; i < receipts.length; i++) {
        const r = asRecord(receipts[i])
        steps[1] = {
          label: 'квитанции гейтов планирования',
          state: 'active',
          detail: `${i + 1}/${receipts.length} · ${asStr(r.gate)} ${asStr(r.verdict)}`,
        }
        setSteps([...steps])
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      const hardFail = receipts.some((r) => asRecord(r).level === 'hard' && asStr(asRecord(r).verdict) === 'FAIL')
      steps[1] = { label: 'квитанции гейтов планирования', state: 'ok', detail: `${receipts.length} квитанций` }
      setSteps([...steps])
      setResult({
        ok: !hardFail,
        text: (
          <div className="space-y-2">
            <div>
              {asStr(plan.slug)} «{asStr(plan.title)}» — {hardFail ? 'HARD FAIL' : 'CLEAN RUN'} · слотов{' '}
              {asArray(plan.slots).length} · EXP {asStr(plan.exp)} · A/B {asStr(plan.abPairs)} · sha10 {asStr(plan.sha10)}
            </div>
            <ReceiptTable receipts={receipts} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => ctx.onOpenBatch(asStr(plan.slug))}
                className="h-7 bg-amber-500 text-xs text-zinc-950 hover:bg-amber-400"
              >
                <ExternalLink className="mr-1 size-3" /> открыть в Батчах
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(`Super Z, произведи ${asStr(plan.slug)}`)
                    .then(() => notify('info', 'Приказ скопирован', `«Super Z, произведи ${asStr(plan.slug)}»`))
                    .catch(() => notify('error', 'Копирование не удалось', ''))
                }}
                className="h-7 border-zinc-700 bg-zinc-900 text-xs text-zinc-300"
              >
                <Copy className="mr-1 size-3" /> приказ писцу
              </Button>
            </div>
          </div>
        ),
      })
      notify(hardFail ? 'info' : 'success', 'FORCE COMPILE', `${asStr(plan.slug)} ${hardFail ? 'HARD FAIL' : 'CLEAN RUN'}`)
      invalidateEngineBatches()
      ctx.onMutated()
      setIdem(genIdemKey('compile'))
    } catch (e) {
      setSteps([{ label: 'POST /v1/compile → движок планирует 24 слота', state: 'err', detail: errText(e).slice(0, 200) }])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'FORCE COMPILE', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
    }
  }

  const running = phase === 'run'

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Тема автора → детерминированный план 24 слотов (21 мейн + 3 OC). Движок — SSoT: событие{' '}
        <Mono>batch.compiled</Mono> ляжет в цепь сразу. Ретай кнопки не задвоит: <Mono>Idempotency-Key</Mono>.
      </p>
      <div>
        <FieldLabel>тема батча (обязательно, 1–120)</FieldLabel>
        <Textarea
          value={draft.theme}
          onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value }))}
          disabled={running}
          placeholder="«город, где усталость носят как меха»…"
          className="min-h-16 border-zinc-800 bg-zinc-950 text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel>движок</FieldLabel>
          <select
            value={engineMode}
            onChange={(e) => setEngineMode(e.target.value as 'per-theme' | 'per-theme raw-plus')}
            disabled={running}
            aria-label="режим движка"
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs text-zinc-200 focus-visible:border-amber-500/50"
          >
            <option value="per-theme">per-theme</option>
            <option value="per-theme raw-plus">per-theme raw-plus</option>
          </select>
        </div>
        <div>
          <FieldLabel>EXP-слоты (0–9)</FieldLabel>
          <Input
            value={exp}
            onChange={(e) => setExp(e.target.value)}
            disabled={running}
            type="number"
            min={0}
            max={9}
            className="h-9 border-zinc-800 bg-zinc-950 font-mono text-xs"
          />
        </div>
        <div>
          <FieldLabel>A/B-пары (2–3)</FieldLabel>
          <Input
            value={abPairs}
            onChange={(e) => setAbPairs(e.target.value)}
            disabled={running}
            type="number"
            min={2}
            max={3}
            className="h-9 border-zinc-800 bg-zinc-950 font-mono text-xs"
          />
        </div>
      </div>
      <div>
        <FieldLabel>OC-темы — минимум одна (позиции 1..3)</FieldLabel>
        <div className="space-y-2">
          {draft.ocRows.slice(0, 3).map((row, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_110px]">
              <Input
                value={row.theme}
                onChange={(e) =>
                  setDraft((d) => {
                    const ocRows = [...d.ocRows]
                    ocRows[i] = { ...ocRows[i], theme: e.target.value }
                    return { ...d, ocRows }
                  })
                }
                disabled={running}
                placeholder={i === 0 ? 'OC-тема: «Neon Shrine Maiden»…' : 'ещё OC-тема (необязательно)'}
                className="h-9 border-zinc-800 bg-zinc-950 text-xs"
              />
              <div className="flex gap-2">
                <select
                  value={row.rating}
                  onChange={(e) =>
                    setDraft((d) => {
                      const ocRows = [...d.ocRows]
                      ocRows[i] = { ...ocRows[i], rating: e.target.value as OcRow['rating'] }
                      return { ...d, ocRows }
                    })
                  }
                  disabled={running}
                  aria-label={`рейтинг OC ${i + 1}`}
                  className="h-9 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 font-mono text-[11px] text-zinc-200 focus-visible:border-amber-500/50"
                >
                  {OC_RATINGS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {i > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => {
                        const ocRows = d.ocRows.filter((_, j) => j !== i)
                        return { ...d, ocRows }
                      })
                    }
                    disabled={running}
                    aria-label="убрать OC-строку"
                    className="h-9 rounded-md border border-zinc-800 px-2 text-xs text-zinc-500 transition-colors hover:border-rose-500/40 hover:text-rose-300"
                  >
                    −
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {draft.ocRows.length < 3 ? (
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, ocRows: [...d.ocRows, { theme: '', rating: 'R', wishes: '' }] }))}
              disabled={running}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
            >
              + OC-тема
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-2 pt-1">
          <Switch checked={speciesOn} onCheckedChange={setSpeciesOn} disabled={running} aria-label="ограничить расы" />
          <span className="text-[11px] text-zinc-500">расы-хайджлайты</span>
        </div>
        {speciesOn ? (
          <div>
            <Input
              value={speciesList}
              onChange={(e) => setSpeciesList(e.target.value)}
              disabled={running}
              placeholder="R12, R37, R04 — из races.json"
              className="h-9 border-zinc-800 bg-zinc-950 font-mono text-xs"
            />
            {!racesValid ? <p className="mt-1 text-[10px] text-amber-400">формат: R## через запятую</p> : null}
          </div>
        ) : null}
      </div>
      <div>
        <FieldLabel>заметки (необязательно)</FieldLabel>
        <Textarea
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          disabled={running}
          placeholder="авторская нота к компиляции — уйдёт в запрос движка"
          className="min-h-14 border-zinc-800 bg-zinc-950 text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
        <span className="font-mono text-[10px] text-zinc-600">Idempotency-Key</span>
        <code className="font-mono text-[10px] text-amber-200/80">{idem}</code>
        <button
          type="button"
          onClick={() => setIdem(genIdemKey('compile'))}
          disabled={running}
          className="rounded border border-zinc-700 px-1.5 py-px font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
        >
          перегенерировать
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        className="font-mono text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {showPreview ? '▾' : '▸'} dry-run: тело запроса
      </button>
      {showPreview ? (
        <pre className="t4-scroll max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
          {JSON.stringify(body, null, 2)}
        </pre>
      ) : null}
      {phase !== 'run' ? (
        <Button
          onClick={() => void run()}
          disabled={!formValid || getCommanderKey() === ''}
          className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
        >
          <Zap className="mr-1.5 size-3.5" /> Скомпилировать
        </Button>
      ) : null}
      {!themeValid && draft.theme.trim() !== '' ? (
        <p className="text-[11px] text-amber-400">тема длиннее 120 символов</p>
      ) : null}
      {ocValid.length === 0 ? <p className="text-[11px] text-amber-400">нужна хотя бы одна OC-тема (Zod-контракт движка)</p> : null}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 3 · PURGE HEAP                                                      */
/* ------------------------------------------------------------------ */

function PurgePanel({
  heapCount,
  onPurgeHeap,
}: {
  heapCount: number
  onPurgeHeap: () => Promise<{ ok: boolean; refetched: number; error?: string }>
}) {
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const busyRef = useRef(false)

  async function run() {
    if (busyRef.current) return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    setSteps([
      { label: 'сброс буфера ленты вкладки', state: 'active', detail: `${heapCount} строк в памяти` },
      { label: 'перечит хвоста из движка', state: 'idle' },
    ])
    const res = await onPurgeHeap()
    if (res.ok) {
      setSteps([
        { label: 'сброс буфера ленты вкладки', state: 'ok', detail: `${heapCount} строк убрано` },
        { label: 'перечит хвоста из движка', state: 'ok', detail: `${res.refetched} звеньев вернулось` },
      ])
      setResult({ ok: true, text: `HEAP ЧИСТ · буфер ${heapCount} → ${res.refetched} звеньев (хвост) · летопись и движок не тронуты` })
      notify('info', 'PURGE HEAP', `буфер сброшен · перечитано ${res.refetched} звеньев`)
    } else {
      setSteps([
        { label: 'сброс буфера ленты вкладки', state: 'err' },
        { label: 'перечит хвоста из движка', state: 'err', detail: res.error ?? 'отказ' },
      ])
      setResult({ ok: false, text: `СБОЙ ПЕРЕЧИТА: ${res.error ?? '—'} · буфер восстановлен (откат)` })
      notify('error', 'PURGE HEAP', res.error ?? 'перечит не удался — буфер восстановлен')
    }
    busyRef.current = false
    setPhase('done')
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-zinc-500">
        Чистит локальный буфер ленты событий этой вкладки. <b className="text-zinc-300">Движок, летопись и цепь не
        трогаются</b> — это гигиена памяти UI, не вандализм.
      </p>
      <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
        уйдёт: {heapCount} строк буфера (память вкладки)<br />
        вернётся: хвост ленты после перечита (движок :3200)<br />
        не трогается: sqlite-летопись · chain.jsonl · черновики · сейф
      </div>
      {phase !== 'run' ? (
        <Button
          onClick={() => void run()}
          disabled={heapCount === 0}
          className="bg-zinc-200 font-semibold text-zinc-950 hover:bg-zinc-100 disabled:opacity-40"
        >
          <Trash2 className="mr-1.5 size-3.5" /> {heapCount === 0 ? 'буфер уже пуст' : 'Сбросить и перечитать'}
        </Button>
      ) : null}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>
        {result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 4 · VERIFY                                                          */
/* ------------------------------------------------------------------ */

function VerifyPanel() {
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const busyRef = useRef(false)

  async function run() {
    if (busyRef.current) return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    setSteps([
      { label: 'локальная проверка всех звеньев prev[i] === hash[i-1]', state: 'active' },
      { label: 'авторитет движка /v1/chain/verify', state: 'idle' },
    ])
    try {
      const evs = (await engineGet<{ events: EngineEvent[] }>('events?after=0&limit=1000')).events ?? []
      const broken: number[] = []
      evs.forEach((e, i) => {
        if (i > 0 && e.prev !== evs[i - 1]?.hash) broken.push(e.seq)
      })
      const head = evs[evs.length - 1]?.hash ?? ''
      setSteps([
        {
          label: 'локальная проверка всех звеньев prev[i] === hash[i-1]',
          state: broken.length === 0 ? 'ok' : 'err',
          detail: `${evs.length} звеньев · ${broken.length === 0 ? 'все связаны' : `разрывы: seq ${broken.join(', ')}`}`,
        },
        { label: 'авторитет движка /v1/chain/verify', state: 'active' },
      ])
      const verify = await engineGet<{ ok: boolean; events: number; head: string | null; problems: string[] }>('chain/verify')
      setSteps([
        {
          label: 'локальная проверка всех звеньев prev[i] === hash[i-1]',
          state: broken.length === 0 ? 'ok' : 'err',
          detail: `${evs.length} звеньев · ${broken.length === 0 ? 'все связаны' : `разрывы: seq ${broken.join(', ')}`}`,
        },
        {
          label: 'авторитет движка /v1/chain/verify',
          state: verify.ok ? 'ok' : 'err',
          detail: verify.ok ? `SEALED · ${verify.events} звеньев` : verify.problems.slice(0, 2).join(' · '),
        },
      ])
      const ok = broken.length === 0 && verify.ok
      setResult({
        ok,
        text: (
          <div>
            {evs.length}/{evs.length} звеньев проверены{broken.length > 0 ? ` · РАЗРЫВЫ: seq ${broken.join(', ')}` : ''} ·
            движок {verify.ok ? 'SEALED' : `ПРОБЛЕМ ×${verify.problems.length}`} · head {h8(head)}
            {!ok ? (
              <span className="mt-1 block text-zinc-400">лечение: bun thread4/cli.ts verify --heal</span>
            ) : null}
          </div>
        ),
      })
      notify(ok ? 'success' : 'error', 'VERIFY', ok ? `цепь цела · ${evs.length} звеньев · SEALED` : 'цепь или движок видит проблемы')
    } catch (e) {
      setSteps([{ label: 'локальная проверка всех звеньев prev[i] === hash[i-1]', state: 'err', detail: errText(e).slice(0, 160) }])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'VERIFY', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-zinc-500">
        Двойная проверка: каждое звено пересчитывается в браузере (<Mono>prev→hash</Mono>), затем сверяется с
        авторитетом движка. Read-only — летопись не трогается. Полная таблица со звеньями — в{' '}
        <span className="text-amber-300/80">Летописи</span>.
      </p>
      {phase !== 'run' ? (
        <Button
          onClick={() => void run()}
          className="bg-emerald-600 font-semibold text-zinc-50 hover:bg-emerald-500"
        >
          <Play className="mr-1.5 size-3.5" /> Прогнать проверку
        </Button>
      ) : null}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 5 · VOID                                                            */
/* ------------------------------------------------------------------ */

function VoidPanel({ rows, ctx }: { rows: EngineBatchRow[]; ctx: DeckCtx }) {
  const [slug, setSlug] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const busyRef = useRef(false)

  const row = rows.find((r) => r.slug === slug)
  const voidable = row != null && row.status !== 'void'

  async function run() {
    if (busyRef.current || slug === '') return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    setSteps([{ label: `POST /v1/batches/${slug}/void`, state: 'active' }])
    try {
      const res = await enginePost<{ slug: string; at: string; eventId: string }>(`batches/${slug}/void`, {})
      setSteps([{ label: `POST /v1/batches/${slug}/void`, state: 'ok', detail: `event ${h8(res.eventId)}` }])
      setResult({
        ok: true,
        text: (
          <div>
            {slug} закрыт (void) — провенанс неприкосновенен, слаг свободен для перестройки (BURN & REBUILD).
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => ctx.onOpenBatch(slug)} className="h-7 bg-amber-500 text-xs text-zinc-950 hover:bg-amber-400">
                <ExternalLink className="mr-1 size-3" /> открыть в Батчах
              </Button>
            </div>
          </div>
        ),
      })
      notify('success', 'VOID', `${slug} закрыт — слаг свободен для перестройки`)
      invalidateEngineBatches()
      ctx.onMutated()
    } catch (e) {
      setSteps([{ label: `POST /v1/batches/${slug}/void`, state: 'err', detail: errText(e).slice(0, 160) }])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'VOID', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Закрыть батч <b className="text-zinc-300">навсегда</b> (статус void). Слаг освобождается для перестройки,
        история остаётся в цепи — провенанс не стирается.
      </p>
      <BatchSelect rows={rows} value={slug} onChange={setSlug} disabled={phase === 'run'} ariaLabel="батч для закрытия" />
      {row != null && !voidable ? (
        <p className="font-mono text-[10px] text-amber-400">{slug} уже void — повторное закрытие бессмысленно</p>
      ) : null}
      {confirming ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          role="alertdialog"
          aria-label="Подтверждение void"
          className="rounded-md border border-rose-700/60 bg-rose-950/20 p-3"
        >
          <p className="text-sm font-medium text-rose-200">
            Закрыть <span className="font-mono">{slug}</span> «{row?.title}» навсегда?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Обратного нет: батч уйдёт в void, события останутся в цепи. Слаг можно будет перестроить через BURN & REBUILD.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void run()} className="h-9 bg-rose-600 font-semibold text-zinc-50 hover:bg-rose-500">
              <Skull className="mr-1 size-3.5" /> Закрыть
            </Button>
            <Button
              onClick={() => setConfirming(false)}
              variant="outline"
              className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300"
            >
              Отмена
            </Button>
          </div>
        </motion.div>
      ) : phase !== 'run' ? (
        <Button
          onClick={() => setConfirming(true)}
          disabled={!voidable || getCommanderKey() === ''}
          className="bg-rose-600 font-semibold text-zinc-50 hover:bg-rose-500 disabled:opacity-40"
        >
          <Skull className="mr-1.5 size-3.5" /> VOID
        </Button>
      ) : null}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 6 · DELIVER                                                         */
/* ------------------------------------------------------------------ */

function DeliverPanel({ rows, ctx }: { rows: EngineBatchRow[]; ctx: DeckCtx }) {
  const [slug, setSlug] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const busyRef = useRef(false)

  const row = rows.find((r) => r.slug === slug)
  const compilable = row != null && row.status === 'compiled'
  const hardPass = (row as unknown as { hardPass?: boolean } | undefined)?.hardPass === true

  async function run() {
    if (busyRef.current || slug === '') return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    setSteps([{ label: `POST /v1/batches/${slug}/deliver`, state: 'active' }])
    try {
      const res = await enginePost<{
        slug: string
        delivered: boolean
        at: string
        eventId: string
        result?: { slots?: number; exp?: number; diffUp?: number; diffDown?: number }
      }>(`batches/${slug}/deliver`, {})
      const r = asRecord(res.result)
      setSteps([{ label: `POST /v1/batches/${slug}/deliver`, state: 'ok', detail: `event ${h8(res.eventId)}` }])
      setResult({
        ok: true,
        text: (
          <div>
            {slug} «{row?.title}» сдан официально · {asStr(r.slots) || '—'} слотов · EXP {asStr(r.exp) || '—'} · diff ↑
            {asStr(r.diffUp) || '—'} ↓{asStr(r.diffDown) || '—'} — палитры залочены в окно ротации.
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => ctx.onOpenBatch(slug)} className="h-7 bg-amber-500 text-xs text-zinc-950 hover:bg-amber-400">
                <ExternalLink className="mr-1 size-3" /> открыть в Батчах
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => ctx.onOpenDrawer('chronicle')}
                className="h-7 border-zinc-700 bg-zinc-900 text-xs text-zinc-300"
              >
                <History className="mr-1 size-3" /> звено в летописи
              </Button>
            </div>
          </div>
        ),
      })
      notify('success', 'DELIVER', `${slug} сдан · окно ротации обновлено`)
      invalidateEngineBatches()
      ctx.onMutated()
    } catch (e) {
      setSteps([{ label: `POST /v1/batches/${slug}/deliver`, state: 'err', detail: errText(e).slice(0, 160) }])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'DELIVER', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Официальная сдача скомпилированного батча: событие <Mono>batch.delivered</Mono> в цепи, палитры лочатся в
        окно усталости. Требование §9: hard-гейты планирования должны быть пройдены.
      </p>
      <BatchSelect rows={rows} value={slug} onChange={setSlug} disabled={phase === 'run'} ariaLabel="батч для сдачи" />
      {compilable && !hardPass ? (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-amber-300/90">
          hard-гейты планирования НЕ пройдены — движка откажет (§9 first run clean). Перекомпилируй с другими
          параметрами (FORCE COMPILE / BURN & REBUILD).
        </p>
      ) : null}
      {confirming ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          role="alertdialog"
          aria-label="Подтверждение delivery"
          className="rounded-md border border-emerald-700/60 bg-emerald-950/20 p-3"
        >
          <p className="text-sm font-medium text-emerald-200">
            Сдать <span className="font-mono">{slug}</span> «{row?.title}»?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Событие ляжет в цепь, палитры батча залочатся в ротационное окно (анти-усталость). Обратной кнопки нет —
            только void.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void run()} className="h-9 bg-emerald-600 font-semibold text-zinc-50 hover:bg-emerald-500">
              <Upload className="mr-1 size-3.5" /> Сдать
            </Button>
            <Button onClick={() => setConfirming(false)} variant="outline" className="h-9 border-zinc-700 bg-zinc-900 text-zinc-300">
              Отмена
            </Button>
          </div>
        </motion.div>
      ) : phase !== 'run' ? (
        <Button
          onClick={() => setConfirming(true)}
          disabled={!compilable || getCommanderKey() === ''}
          className="bg-emerald-600 font-semibold text-zinc-50 hover:bg-emerald-500 disabled:opacity-40"
        >
          <Upload className="mr-1.5 size-3.5" /> DELIVER
        </Button>
      ) : null}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 7 · REAPER (оракул, файл-эра)                                       */
/* ------------------------------------------------------------------ */

function ReaperPanel({ ctx }: { ctx: DeckCtx }) {
  const [theme, setTheme] = useState('')
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [elapsed, setElapsed] = useState(0)
  const [steps, setSteps] = useState<Step[]>([])
  const [reply, setReply] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const busyRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    }
  }, [])

  async function run() {
    if (busyRef.current) return
    busyRef.current = true
    setResult(null)
    setReply(null)
    setPhase('run')
    setElapsed(0)
    const startedAt = Date.now()
    setSteps([{ label: 'POST /api/t4/oracle — жнец думает (LLM, до 45–60с)', state: 'active' }])
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    try {
      const res = await postJson<{ ok: boolean; reply: string; event?: { id?: string } }>(
        '/api/t4/oracle',
        theme.trim() !== '' ? { theme: theme.trim().slice(0, 300) } : {},
        {}
      )
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      const secs = Math.round((Date.now() - startedAt) / 1000)
      setSteps([
        {
          label: 'POST /api/t4/oracle — жнец думает (LLM, до 45–60с)',
          state: 'ok',
          detail: `ответ ${res.reply.length} симв. · ${secs}с${res.event?.id ? ` · event ${h8(res.event.id)}` : ''}`,
        },
      ])
      setReply(res.reply)
      setResult({ ok: true, text: 'жнец сказал — исповедь ниже (markdown)' })
      notify('success', 'REAPER', 'жнец ответил — смотри Action Deck')
    } catch (e) {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      setSteps([
        { label: 'POST /api/t4/oracle — жнец думает (LLM, до 45–60с)', state: 'err', detail: errText(e).slice(0, 160) },
      ])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'REAPER', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
    }
  }

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Голос жнеца: LLM читает летопись и говорит литературную исповедь о здоровье конвейера. Платный вызов — только
        с ключом командира. <span className="text-amber-300/70">Честная метка: событие пишет файл-эра (log.jsonl);
        миграция жнеца на движок — в плане (ворклог).</span>
      </p>
      <div>
        <FieldLabel>о чём спросить (необязательно)</FieldLabel>
        <Input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          disabled={phase === 'run'}
          placeholder="«поговори о палитрах» — пусто = жнец сам выберет тему"
          className="h-9 border-zinc-800 bg-zinc-950 text-xs"
        />
      </div>
      {phase === 'run' ? (
        <div className="flex items-center gap-3 rounded-md border border-amber-600/60 bg-amber-950/20 px-3 py-2.5 font-mono text-xs text-amber-300">
          <Loader2 className="size-4 animate-spin" />
          жнец думает… {elapsed}с {elapsed > 45 ? '· LLM долго — терпи, до 60с' : ''}
        </div>
      ) : (
        <Button
          onClick={() => void run()}
          disabled={getCommanderKey() === ''}
          className="bg-fuchsia-600 font-semibold text-zinc-50 hover:bg-fuchsia-500 disabled:opacity-40"
        >
          <Sparkles className="mr-1.5 size-3.5" /> Позвать жнеца
        </Button>
      )}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>
        {result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}
      </AnimatePresence>
      {reply != null ? (
        <div className="t4-scroll max-h-[50vh] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <MarkdownView>{reply}</MarkdownView>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 8 · SHORE-MERGE (CLI-only, честно)                                  */
/* ------------------------------------------------------------------ */

function ShorePanel() {
  const [stats, setStats] = useState<{ events: number; head: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    engineGet<{ events: number; head: string | null }>('chain/verify')
      .then((v) => setStats({ events: v.events, head: v.head }))
      .catch(() => setStats(null))
  }, [])

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-zinc-500">
        Слияние локальной летописи с origin: <Mono>git fetch</Mono> → дедупликация событий → пересборка цепи.
        Работает только из CLI на машине ядра (нужен git-доступ к origin) — из браузера не запускается, это граница,
        а не лень.
      </p>
      {stats != null ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
          сейчас: летопись {stats.events} звеньев · head {stats.head != null ? h8(stats.head) : '—'}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-amber-200/90">
          bun thread4/cli.ts shore-merge
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText('bun thread4/cli.ts shore-merge')
              .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2500)
                notify('info', 'SHORE-MERGE', 'команда скопирована — вставь в терминал машины ядра')
              })
              .catch(() => notify('error', 'SHORE-MERGE', 'копирование не удалось'))
          }}
          className="h-8 border-zinc-700 bg-zinc-900 text-xs text-zinc-300"
        >
          <Copy className="mr-1 size-3" /> {copied ? 'скопировано' : 'скопировать команду'}
        </Button>
        <span className="rounded-md border border-zinc-700/60 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          CLI-only
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 9 · ВЕРДИКТ (движок, SSoT)                                          */
/* ------------------------------------------------------------------ */

const QUICK_TAGS = [
  'позы однообразны',
  'палитра устала',
  'OC держит сцену',
  'мусор в деталях',
  'не по вкусу',
  'композиция живая',
]

function VerdictPanel({ rows, ctx }: { rows: EngineBatchRow[]; ctx: DeckCtx }) {
  const [slug, setSlug] = useState('')
  const [verdict, setVerdict] = useState<'PASS' | 'WARN' | 'FAIL' | null>(null)
  const [confidence, setConfidence] = useState<'direct' | 'described'>('direct')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: React.ReactNode } | null>(null)
  const busyRef = useRef(false)

  async function run() {
    if (busyRef.current || slug === '' || verdict == null) return
    busyRef.current = true
    setResult(null)
    setPhase('run')
    setSteps([{ label: `POST /v1/verdicts · ${slug} · ${verdict} (${confidence})`, state: 'active' }])
    const prose = [note.trim(), tags.length > 0 ? `Проблемы: ${tags.join(', ')}.` : ''].filter(Boolean).join('\n\n')
    try {
      const res = await enginePost<{ slug: string; kind: string; verdict: string; at: string; eventId: string; singleRecord: boolean }>(
        'verdicts',
        {
          slug,
          verdict,
          source: 'author-batch',
          confidence,
          note: prose !== '' ? prose.slice(0, 4000) : undefined,
        }
      )
      setSteps([
        {
          label: `POST /v1/verdicts · ${slug} · ${verdict} (${confidence})`,
          state: 'ok',
          detail: `event ${h8(res.eventId)} · kind ${res.kind}`,
        },
      ])
      setResult({
        ok: true,
        text: (
          <div>
            вердикт {verdict} записан в цепь движка (SSoT) — kind {res.kind}
            {res.singleRecord ? ' · один вердикт на батч+kind (перезапись)' : ''}
            . Вердикты кормят правки закона и вкус.
            <div className="mt-1">
              <Button size="sm" onClick={() => ctx.onOpenDrawer('verdicts')} className="h-7 bg-amber-500 text-xs text-zinc-950 hover:bg-amber-400">
                <Heart className="mr-1 size-3" /> цех вердиктов
              </Button>
            </div>
          </div>
        ),
      })
      notify('success', 'ВЕРДИКТ', `${slug}: ${verdict} (${confidence}) — в цепи`)
      ctx.onMutated()
    } catch (e) {
      setSteps([
        { label: `POST /v1/verdicts · ${slug} · ${verdict} (${confidence})`, state: 'err', detail: errText(e).slice(0, 160) },
      ])
      setResult({ ok: false, text: errText(e) })
      notify('error', 'ВЕРДИКТ', errText(e).slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
    }
  }

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Вердикт автора после рендера — пишется прямо в цепь движка (<Mono>render.verdict</Mono>, source{' '}
        <Mono>author-batch</Mono>). Один клик — и он в летописи: вердикты кодируются в право (T4-02 уже закон).
      </p>
      <BatchSelect rows={rows} value={slug} onChange={setSlug} disabled={phase === 'run'} ariaLabel="батч для вердикта" />
      <div className="flex flex-wrap gap-2">
        {(['PASS', 'WARN', 'FAIL'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVerdict(verdict === v ? null : v)}
            disabled={phase === 'run'}
            className={cn(
              'rounded-md border px-3 py-1.5 font-mono text-xs font-semibold transition-colors',
              verdict === v
                ? v === 'PASS'
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : v === 'WARN'
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-rose-500/60 bg-rose-500/15 text-rose-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-zinc-500">доказательная база:</span>
        {(['direct', 'described'] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setConfidence(c)}
            disabled={phase === 'run'}
            className={cn(
              'rounded-md border px-2 py-1 font-mono text-[10px] transition-colors',
              confidence === c
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
            )}
            title={c === 'direct' ? 'видел рендеры сам' : 'судит по описанию/VLM-сводке'}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
            disabled={phase === 'run'}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              tags.includes(t)
                ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={phase === 'run'}
        placeholder="детали: «на P07 колесо поехало», «Lyn лучше всех»…"
        className="min-h-20 border-zinc-800 bg-zinc-950 text-sm"
      />
      {phase !== 'run' ? (
        <Button
          onClick={() => void run()}
          disabled={slug === '' || verdict == null || getCommanderKey() === ''}
          className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
        >
          <Heart className="mr-1.5 size-3.5" /> Записать вердикт
        </Button>
      ) : null}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Deck: сетка карт + активный workflow                                */
/* ------------------------------------------------------------------ */

interface ActionCardMeta {
  id: ActionId
  label: string
  icon: React.ReactNode
  hint: string
  hotkey: string
  tone: 'amber' | 'emerald' | 'rose' | 'zinc' | 'fuchsia'
}

/* ------------------------------------------------------------------ */
/* 10 · SCRIBE — авто-писец: контракт → LLM → гейты → черновик        */
/* ------------------------------------------------------------------ */

interface ScribeResponse {
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

function ScribePanel({ ctx }: { ctx: DeckCtx }) {
  const [slug, setSlug] = useState('')
  const [phase, setPhase] = useState<'form' | 'run' | 'done'>('form')
  const [elapsed, setElapsed] = useState(0)
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [res, setRes] = useState<ScribeResponse | null>(null)
  const busyRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const slugOk = /^T4-\d{2}$/.test(slug.trim())

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    }
  }, [])

  async function run() {
    if (busyRef.current || !slugOk) return
    busyRef.current = true
    setResult(null)
    setRes(null)
    setPhase('run')
    setElapsed(0)
    const startedAt = Date.now()
    const target = slug.trim()
    setSteps([
      {
        label: `POST /api/t4/scribe (поток) — писец пишет ${target} (конституция+вкус+контракт → LLM: спайн → чанки → гейты → ремонт ≤3)`,
        state: 'active',
      },
    ])
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    /* Инцидент Т4-42/43/44: поток с heartbeat — шлюз не режет, прогресс виден живьём */
    try {
      const r = await postScribeStream<ScribeResponse>(
        '/api/t4/scribe',
        { slug: target, maxRepairRounds: 3 },
        (line) => {
          seen.push(line)
          setSteps([
            {
              label: `POST /api/t4/scribe (поток) — писец пишет ${target}`,
              state: 'active',
              detail: line.slice(0, 220),
            },
          ])
        }
      )
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      const secs = Math.round((Date.now() - startedAt) / 1000)
      setSteps([
        {
          label: `POST /api/t4/scribe — писец написал ${r.slug} «${r.title}»`,
          state: r.hardPass ? 'ok' : 'err',
          detail: `ремонт ${r.rounds} круг(а) · ${secs}с · sha10 ${r.sha10}${r.failedSlots.length > 0 ? ` · НЕ написаны: P${r.failedSlots.join(', P')}` : ''}`,
        },
      ])
      setRes(r)
      setResult({
        ok: r.hardPass,
        text: r.hardPass
          ? `черновик готов — batches/${r.slug}.md · гейты hard PASS · сдача — отдельное решение автора`
          : `hard FAIL остался (sha10 ${r.sha10}) — черновик записан с квитанциями; следующий шаг — polish (CLI) или ручная доводка`,
      })
      notify(r.hardPass ? 'success' : 'info', 'SCRIBE', `${r.slug}: ${r.hardPass ? 'hard PASS' : 'hard FAIL'} · ремонт ${r.rounds} · sha10 ${r.sha10}`)
      ctx.onMutated()
    } catch (e) {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      const reason = errText(e)
      setSteps([
        { label: `POST /api/t4/scribe — писец ${target}`, state: 'err', detail: reason.slice(0, 220) },
      ])
      setResult({ ok: false, text: reason })
      notify('error', 'SCRIBE', reason.slice(0, 120))
    } finally {
      busyRef.current = false
      setPhase('done')
    }
  }

  return (
    <div className="space-y-3">
      <KeyGate onOpenSettings={ctx.onOpenSettings} />
      <p className="text-xs leading-relaxed text-zinc-500">
        Авто-писец: машина пишет черновик батча по контракту — <span className="text-zinc-300">CONSTITUTION.md + TASTE.md + контракт слота</span> собираются в единый системный промпт, LLM пишет все слоты, гейты гоняют файл всухую, провалы уходят обратно в модель (до 3 кругов). Провайдер — из <Mono>.env</Mono> (<Mono>T4_SCRIBE_PROVIDER</Mono>: zai · openai · anthropic · custom). Результат — <Mono>batches/T4-NN.md</Mono> + событие в летопись.
      </p>
      <div>
        <FieldLabel>слаг батча (контракт обязан существовать)</FieldLabel>
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={phase === 'run'}
          placeholder="T4-41"
          aria-label="слаг батча для писца"
          className="h-9 w-40 border-zinc-800 bg-zinc-950 font-mono text-xs"
        />
        {!slugOk && slug.trim() !== '' ? (
          <p className="mt-1 font-mono text-[10px] text-rose-400/80">формат: T4-NN (две цифры)</p>
        ) : null}
      </div>
      <DryRunPreview
        body={{ slug: slugOk ? slug.trim() : 'T4-…', maxRepairRounds: 3 }}
        note="контракт — contracts/T4-NN.json (компиляция или gen-rawplus); сданный батч писец не перезапишет (first-run-clean)"
      />
      {phase === 'run' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-md border border-emerald-600/60 bg-emerald-950/20 px-3 py-2.5 font-mono text-xs text-emerald-300">
            <Loader2 className="size-4 animate-spin" />
            писец пишет… {elapsed}с
            {elapsed > 120 ? ' · это нормально: спайн + чанки + ремонт — минуты' : ' · LLM, обычно 2–6 минут'} · поток жив (heartbeat каждые 10с)
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Панель можно свернуть — прогон живёт на сервере (до 10 минут). Не перезапускай тот же слаг до конца прогона.
          </p>
        </div>
      ) : (
        <Button
          onClick={() => void run()}
          disabled={!slugOk || getCommanderKey() === ''}
          className="bg-emerald-600 font-semibold text-zinc-50 hover:bg-emerald-500 disabled:opacity-40"
        >
          <PenLine className="mr-1.5 size-3.5" /> Запустить писца
        </Button>
      )}
      {steps.length > 0 && phase !== 'form' ? <StepLog steps={steps} /> : null}
      <AnimatePresence>{result != null ? <ResultBanner ok={result.ok}>{result.text}</ResultBanner> : null}</AnimatePresence>
      {res != null ? (
        <div className="space-y-2">
          {res.log.length > 0 ? (
            <div className="t4-scroll max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              {res.log.map((l, i) => (
                <p key={i} className="font-mono text-[10px] leading-relaxed text-zinc-500">
                  {l}
                </p>
              ))}
            </div>
          ) : null}
          <ReceiptTable receipts={res.receipts as unknown[]} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => ctx.onOpenBatch(res.slug)}
              className="h-8 border-zinc-700 text-xs"
            >
              <ExternalLink className="mr-1 size-3" /> открыть {res.slug} в Батчах
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const CARDS: ActionCardMeta[] = [
  { id: 'burn', label: 'BURN & REBUILD', icon: <Flame className="size-4" />, hint: 'аудит цепи + перестройка', hotkey: 'B', tone: 'amber' },
  { id: 'compile', label: 'FORCE COMPILE', icon: <Zap className="size-4" />, hint: 'план из темы', hotkey: 'C', tone: 'amber' },
  { id: 'scribe', label: 'SCRIBE', icon: <PenLine className="size-4" />, hint: 'писец пишет батч', hotkey: 'I', tone: 'emerald' },
  { id: 'verify', label: 'VERIFY', icon: <Activity className="size-4" />, hint: 'цепь: браузер + движок', hotkey: 'T', tone: 'emerald' },
  { id: 'purge', label: 'PURGE HEAP', icon: <Trash2 className="size-4" />, hint: 'буфер ленты', hotkey: 'P', tone: 'zinc' },
  { id: 'deliver', label: 'DELIVER', icon: <Upload className="size-4" />, hint: 'сдать батч', hotkey: 'D', tone: 'emerald' },
  { id: 'void', label: 'VOID', icon: <Skull className="size-4" />, hint: 'закрыть навсегда', hotkey: 'X', tone: 'rose' },
  { id: 'reaper', label: 'REAPER', icon: <Sparkles className="size-4" />, hint: 'жнец говорит', hotkey: 'R', tone: 'fuchsia' },
  { id: 'shore', label: 'SHORE-MERGE', icon: <RefreshCw className="size-4" />, hint: 'слияние лога (CLI)', hotkey: 'S', tone: 'zinc' },
  { id: 'verdict', label: 'ВЕРДИКТ', icon: <Heart className="size-4" />, hint: 'вердикт автора в цепь', hotkey: 'W', tone: 'rose' },
]

const TONE_BORDER: Record<ActionCardMeta['tone'], string> = {
  amber: 'hover:border-amber-500/50',
  emerald: 'hover:border-emerald-500/50',
  rose: 'hover:border-rose-500/50',
  zinc: 'hover:border-zinc-600',
  fuchsia: 'hover:border-fuchsia-500/50',
}

const TONE_ACTIVE: Record<ActionCardMeta['tone'], string> = {
  amber: 'border-amber-500/60 bg-amber-500/10',
  emerald: 'border-emerald-500/60 bg-emerald-500/10',
  rose: 'border-rose-500/60 bg-rose-500/10',
  zinc: 'border-zinc-500 bg-zinc-500/10',
  fuchsia: 'border-fuchsia-500/60 bg-fuchsia-500/10',
}

const PANEL_TITLES: Record<ActionId, string> = {
  burn: 'BURN & REBUILD — аудит цепи + перестройка',
  compile: 'FORCE COMPILE — план 24 слотов',
  scribe: 'SCRIBE — авто-писец: контракт → LLM → гейты → черновик',
  purge: 'PURGE HEAP — гигиена буфера',
  verify: 'VERIFY — двойная проверка цепи',
  void: 'VOID — закрыть батч',
  deliver: 'DELIVER — официальная сдача',
  reaper: 'REAPER — голос жнеца',
  shore: 'SHORE-MERGE — слияние лога с origin',
  verdict: 'ВЕРДИКТ — слово автора в цепь',
}

export interface ActionDeckProps {
  active: ActionId | null
  onActiveChange: (id: ActionId | null) => void
  heapCount: number
  onPurgeHeap: () => Promise<{ ok: boolean; refetched: number; error?: string }>
  onMutated: () => void
  onOpenBatch: (slug: string) => void
  onOpenDrawer: (id: DrawerId) => void
  onOpenSettings: () => void
  engineUp: boolean
}

export function ActionDeck(props: ActionDeckProps) {
  const { rows } = useEngineBatches()
  const reduce = useReducedMotion() ?? false
  const ctx: DeckCtx = useMemo(
    () => ({
      onMutated: props.onMutated,
      onOpenBatch: props.onOpenBatch,
      onOpenDrawer: props.onOpenDrawer,
      onOpenSettings: props.onOpenSettings,
    }),
    [props.onMutated, props.onOpenBatch, props.onOpenDrawer, props.onOpenSettings]
  )

  const activeMeta = CARDS.find((c) => c.id === props.active)

  return (
    <div className="space-y-4" id="t4-action-deck">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-3">
        {CARDS.map((c) => {
          const isActive = props.active === c.id
          return (
            <motion.button
              key={c.id}
              type="button"
              whileTap={reduce ? undefined : { scale: 0.97 }}
              onClick={() => props.onActiveChange(isActive ? null : c.id)}
              aria-pressed={isActive}
              aria-label={`${c.label} — ${c.hint}`}
              className={cn(
                'group flex min-h-[64px] flex-col justify-between rounded-lg border p-3 text-left outline-none transition-all duration-150',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/70',
                isActive
                  ? TONE_ACTIVE[c.tone]
                  : cn('border-zinc-800 bg-zinc-900/60', TONE_BORDER[c.tone], 'hover:bg-zinc-900')
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className={cn(isActive ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200')}>{c.icon}</span>
                  <span className="font-mono text-xs font-bold tracking-wide text-zinc-200">{c.label}</span>
                </span>
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[9px] leading-4 text-zinc-500">
                  {c.hotkey}
                </kbd>
              </div>
              <span className="mt-1.5 text-[11px] leading-tight text-zinc-500">{c.hint}</span>
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence initial={false}>
        {activeMeta != null ? (
          <motion.div
            key={activeMeta.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
          >
            <Panel
              title={PANEL_TITLES[activeMeta.id]}
              icon={activeMeta.icon}
              action={
                <button
                  type="button"
                  onClick={() => props.onActiveChange(null)}
                  aria-label="свернуть панель действия"
                  className="rounded-md border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
                >
                  свернуть ✕
                </button>
              }
            >
              {activeMeta.id === 'burn' ? <BurnPanel rows={rows} ctx={ctx} /> : null}
              {activeMeta.id === 'compile' ? <CompilePanel ctx={ctx} /> : null}
              {activeMeta.id === 'scribe' ? <ScribePanel ctx={ctx} /> : null}
              {activeMeta.id === 'purge' ? <PurgePanel heapCount={props.heapCount} onPurgeHeap={props.onPurgeHeap} /> : null}
              {activeMeta.id === 'verify' ? <VerifyPanel /> : null}
              {activeMeta.id === 'void' ? <VoidPanel rows={rows} ctx={ctx} /> : null}
              {activeMeta.id === 'deliver' ? <DeliverPanel rows={rows} ctx={ctx} /> : null}
              {activeMeta.id === 'reaper' ? <ReaperPanel ctx={ctx} /> : null}
              {activeMeta.id === 'shore' ? <ShorePanel /> : null}
              {activeMeta.id === 'verdict' ? <VerdictPanel rows={rows} ctx={ctx} /> : null}
            </Panel>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
