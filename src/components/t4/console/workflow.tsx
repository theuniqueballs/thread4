'use client'

/**
 * THREAD 4 — WORKFLOW DECK (Фаза 3, Command Center, 2026-10-19).
 *
 * Единый воркфлоу без переходов по вкладкам: приказ → Theme Expansion
 * (якоря Rust-ядра, правимые автором) → Compile & SCRIBE → Review &
 * Deliver. Всё на scratch-летописи Rust twin'а (:3201): продакшн SSoT не
 * тронут (доктрина dual-DB), гейт №25 режет до транзакции.
 *
 * Ревизия Task 3-a (2026-10-19) — закрытие разрывов карты 1-b:
 * · персист черновика: localStorage «t4-workflow-draft» (debounce 250мс +
 *   флеш на анмаунте — смена вида V не теряет правку), восстановление на
 *   монтировании с тостом; после успешного deliver ключ стирается;
 * · настоящий Review: единая таблица гейтов двух батарей (Rust twin
 *   POST /v1/gates + файл-эра POST /api/t4/gates), дедуп R·TS, сортировка
 *   hard → warn → advisory, раскрывающиеся findings; «нет драфта» до
 *   SCRIBE — нормальная плашка с прыжком к писцу; hard-FAIL где угодно
 *   блокирует Approve & Deliver;
 * · возврат «Отклонить и вернуться к якорям» без потери состояния — план
 *   помечается устаревшим до следующего compile;
 * · гейт №25 (превью) дизейблит Compile; поля engine/species/notes едут
 *   в compile-запрос (strict-контракт twin'а);
 * · сброс: кнопка «Новый батч» и событие палитры t4:workflow-reset;
 * · честность Review: notFound «нет драфта» — плашка до SCRIBE, другие
 *   ошибки twin — багровый баннер с ретраем + тост (use-toast), прогоны
 *   батарей обрываются AbortSignal'ом на сбросе/возврате;
 * · сортировка таблицы hard → warn → advisory → conditional.
 *
 * Пружинная анимация шагов (framer-motion, spring 260/26 + layoutId
 * индикатор степпера), честные состояния idle→busy→done/error, никаких
 * скрытых прыжков. useReducedMotion уважается везде.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Compass,
  FileSignature,
  Lock,
  Minus,
  PenLine,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { asArray, asRecord, asStr, commanderHeaders, withGatewayPort } from '@/components/t4/api'
import { notify, useEngineBatches, useScratchBatches, consumeWorkflowReassembly, invalidateEngineBatches } from '@/components/t4/console/shared'
import type { ActionId } from '@/components/t4/console/shared'
import { toast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'

/* ------------------------------------------------------------------ */
/* типы (twin RPC)                                                     */
/* ------------------------------------------------------------------ */

interface OcInput {
  theme: string
  rating: 'R+' | 'R' | 'PG-13' | 'X'
}

const OC_RATINGS = ['PG-13', 'R', 'R+', 'X'] as const

interface Receipt {
  gate: string
  level: 'hard' | 'warn' | 'advisory' | 'conditional'
  verdict: 'PASS' | 'FAIL' | 'WARN' | 'OFF' | 'REPORT'
  findings?: string[]
  notes?: string[]
}

/** Ошибка twin-прокси с RPC-кодом (notFound/unavailable/validation/…) —
 * Review различает честное «нет драфта» и живые сбои. */
class TwinError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'TwinError'
    this.code = code
  }
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

/** ENGINE_MODES движка (canon.rs:14 / config/canon.ts) — strict-enum compile. */
type EngineMode = 'per-theme' | 'per-theme raw-plus'
const ENGINE_MODES: readonly EngineMode[] = ['per-theme', 'per-theme raw-plus']

type Step = 0 | 1 | 2 | 3

const STEP_LABELS = ['Приказ', 'Theme Expansion', 'Compile & SCRIBE', 'Review & Deliver'] as const

const SPRING = { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 } as const

/* ------------------------------------------------------------------ */
/* Review: батарея гейтов (Rust twin + файл-эра TS → одна таблица)      */
/* ------------------------------------------------------------------ */

type BatterySource = 'R' | 'TS'

interface BatteryRow extends Receipt {
  /** источники, сработавшие на этот гейт: R (twin) / TS (файл-эра) */
  sources: BatterySource[]
}

interface BatteryState {
  status: 'idle' | 'running' | 'done' | 'nodraft'
  rows: BatteryRow[]
  /** null — батарея ответила; строка — почему квитанций нет (нет драфта и т.п.) */
  rustNote: string | null
  tsNote: string | null
  /** живой сбой twin (НЕ «нет драфта»): баннер + ретрай, сдача не блокируется */
  rustError: string | null
  /** «slug#eventSeq» — подпись компиляции, для которой прогнан прогон */
  ranFor: string | null
}

const BATTERY_IDLE: BatteryState = {
  status: 'idle',
  rows: [],
  rustNote: null,
  tsNote: null,
  rustError: null,
  ranFor: null,
}

const GATE_LEVELS = ['hard', 'warn', 'advisory', 'conditional'] as const
const GATE_VERDICTS = ['PASS', 'FAIL', 'WARN', 'OFF', 'REPORT'] as const

const LEVEL_RANK: Record<Receipt['level'], number> = {
  hard: 0,
  warn: 1,
  advisory: 2,
  conditional: 3,
}
const VERDICT_RANK: Record<Receipt['verdict'], number> = { FAIL: 0, WARN: 1, REPORT: 2, PASS: 3, OFF: 4 }

function parseLevel(v: unknown): Receipt['level'] {
  const s = asStr(v)
  return (GATE_LEVELS as readonly string[]).includes(s) ? (s as Receipt['level']) : 'advisory'
}

function parseVerdict(v: unknown): Receipt['verdict'] {
  const s = asStr(v)
  return (GATE_VERDICTS as readonly string[]).includes(s) ? (s as Receipt['verdict']) : 'REPORT'
}

/** Квитанции из любой батареи — только честные поля, мусор молча отбрасывается. */
function parseReceipts(v: unknown): Receipt[] {
  const out: Receipt[] = []
  for (const item of asArray(v)) {
    const rec = asRecord(item)
    const gate = asStr(rec.gate)
    if (gate === '') continue
    out.push({
      gate,
      level: parseLevel(rec.level),
      verdict: parseVerdict(rec.verdict),
      findings: asArray(rec.findings).map(asStr).filter((s) => s !== ''),
      notes: asArray(rec.notes).map(asStr).filter((s) => s !== ''),
    })
  }
  return out
}

/** Дедуп по имени гейта: квитанция Rust главнее, дублик метится «R·TS».
 * Сортировка: hard → warn → advisory → conditional; внутри уровня FAIL
 * всплывает первым, OFF опускается последним. */
function mergeBatteryRows(rust: Receipt[], ts: Receipt[]): BatteryRow[] {
  const byGate = new Map<string, BatteryRow>()
  const add = (r: Receipt, origin: BatterySource): void => {
    const cur = byGate.get(r.gate)
    if (cur == null) {
      byGate.set(r.gate, { ...r, sources: [origin] })
      return
    }
    if (!cur.sources.includes(origin)) cur.sources.push(origin)
  }
  for (const r of rust) add(r, 'R')
  for (const r of ts) add(r, 'TS')
  return [...byGate.values()].sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      a.gate.localeCompare(b.gate)
  )
}

/* ------------------------------------------------------------------ */
/* персист черновика (гэп B1 карты 1-b)                                */
/* ------------------------------------------------------------------ */

const DRAFT_KEY = 't4-workflow-draft'
const DRAFT_VERSION = 1

/** Событие сброса: палитра ⌘K и «после deliver» (detail: {reason}). */
const WORKFLOW_RESET_EVENT = 't4:workflow-reset'

type ResetReason = 'palette' | 'after-deliver'

interface WorkflowDraft {
  v: number
  at: number
  theme: string
  slug: string
  exp: number
  ab: number
  oc: OcInput[]
  engine: EngineMode
  speciesList: string
  notes: string
  anchors: AnchorsState | null
  step: Step
}

function writeDraft(entry: { draft: WorkflowDraft; empty: boolean }): void {
  try {
    if (entry.empty) window.localStorage.removeItem(DRAFT_KEY)
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(entry.draft))
  } catch {
    /* приватный режим — черновик не переживёт перезагрузку */
  }
}

function clearDraftKey(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* нет доступа — нет и ключа */
  }
}

/** Якоря из черновика: только известные поля, битые молча отбрасываются. */
function parseAnchors(v: unknown): AnchorsState | null {
  const rec = asRecord(v)
  if (Object.keys(rec).length === 0) return null
  const str = (k: string): string | undefined => {
    const val = rec[k]
    return typeof val === 'string' ? val : undefined
  }
  const arr = (k: string): string[] | undefined => {
    const val = rec[k]
    if (!Array.isArray(val)) return undefined
    return val.map(asStr).filter((s) => s !== '')
  }
  const a: AnchorsState = {
    locale: str('locale'),
    timeOfDay: str('timeOfDay'),
    light: str('light'),
    paletteMood: str('paletteMood'),
    wardrobeFamily: str('wardrobeFamily'),
    poseFamily: str('poseFamily'),
    camera: str('camera'),
    seed: str('seed'),
    motifs: arr('motifs'),
    atmosphere: arr('atmosphere'),
    tokens: arr('tokens'),
    lexiconHits: arr('lexiconHits'),
    minAdherence:
      typeof rec.minAdherence === 'number' && Number.isFinite(rec.minAdherence)
        ? rec.minAdherence
        : undefined,
  }
  const meaningful = Object.values(a).some((val) =>
    Array.isArray(val) ? val.length > 0 : val != null && val !== ''
  )
  return meaningful ? a : null
}

/** Чтение черновика: ручная защита типов, любое крушение = пустой черновик. */
function readWorkflowDraft(): WorkflowDraft & { restored: boolean } {
  const emptyOc = (): OcInput[] => [
    { theme: '', rating: 'R+' },
    { theme: '', rating: 'R+' },
    { theme: '', rating: 'R+' },
  ]
  const fallback: WorkflowDraft & { restored: boolean } = {
    v: DRAFT_VERSION,
    at: 0,
    theme: '',
    slug: '',
    exp: 0,
    ab: 2,
    oc: emptyOc(),
    engine: 'per-theme',
    speciesList: '',
    notes: '',
    anchors: null,
    step: 0,
    restored: false,
  }
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (raw == null) return fallback
    const parsed: unknown = JSON.parse(raw)
    const j = asRecord(parsed)
    if (Object.keys(j).length === 0) return fallback
    const clampNum = (v: unknown, def: number, min: number, max: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def
    const oc: OcInput[] = []
    for (const r of asArray(j.oc).slice(0, 3)) {
      const rec = asRecord(r)
      const rating = asStr(rec.rating)
      oc.push({
        theme: asStr(rec.theme).slice(0, 120),
        rating: ((OC_RATINGS as readonly string[]).includes(rating) ? rating : 'R+') as OcInput['rating'],
      })
    }
    while (oc.length < 3) oc.push({ theme: '', rating: 'R+' })
    const engineRaw = asStr(j.engine)
    const stepRaw = clampNum(j.step, 0, 0, 3)
    const anchors = parseAnchors(j.anchors)
    const theme = asStr(j.theme).slice(0, 200)
    const slug = asStr(j.slug).slice(0, 6).toUpperCase()
    const exp = clampNum(j.exp, 0, 0, 9)
    const ab = clampNum(j.ab, 2, 2, 3)
    const ocFilled = oc.filter((o) => o.theme.trim() !== '').length
    /* план НЕ персистится (живёт в twin) — шаги ≥ 2 честно сжимаются
     * к Theme Expansion: план придётся пересобрать, якоря сохранятся */
    const step = (stepRaw >= 2 ? 1 : stepRaw) as Step
    const restored =
      theme.trim() !== '' || ocFilled > 0 || anchors != null || step > 0 || slug !== ''
    return {
      v: DRAFT_VERSION,
      at: typeof j.at === 'number' && Number.isFinite(j.at) ? j.at : 0,
      theme,
      slug,
      exp,
      ab,
      oc,
      engine: (ENGINE_MODES as readonly string[]).includes(engineRaw)
        ? (engineRaw as EngineMode)
        : 'per-theme',
      speciesList: asStr(j.speciesList).slice(0, 200),
      notes: asStr(j.notes).slice(0, 2000),
      anchors,
      step,
      restored,
    }
  } catch {
    return fallback
  }
}

/** detail: {reason:'palette'|'after-deliver'} — любое крушение = палитра. */
function readResetReason(ev: Event): ResetReason {
  if (!(ev instanceof CustomEvent)) return 'palette'
  const detail: unknown = ev.detail
  if (detail != null && typeof detail === 'object') {
    const reason = asStr((detail as Record<string, unknown>).reason)
    if (reason === 'after-deliver') return 'after-deliver'
  }
  return 'palette'
}

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

/** Степпер с layoutId-индикатором: пилюля скользит между шагами (spring 260/26). */
function Stepper({ step }: { step: Step }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/70 px-2 py-1.5 backdrop-blur-xl">
      {STEP_LABELS.map((label, i) => {
        const active = step === i
        const done = step > i
        return (
          <div key={label} className="flex min-w-0 shrink-0 items-center">
            {i > 0 ? <span aria-hidden className="mx-1.5 h-px w-3 shrink-0 bg-zinc-800" /> : null}
            <span className="relative flex items-center rounded-md px-2 py-1">
              {active ? (
                <motion.span
                  layoutId={reduceMotion === true ? undefined : 'wf-step-pill'}
                  transition={SPRING}
                  className="absolute inset-0 rounded-md border border-white/10 bg-zinc-100/10"
                  aria-hidden
                />
              ) : null}
              <span
                className={cn(
                  'relative z-10 flex items-center gap-1.5 whitespace-nowrap font-term text-[10px] uppercase tracking-wide',
                  done && 'text-emerald-400',
                  active && 'text-zinc-100',
                  !done && !active && 'text-zinc-600'
                )}
              >
                {done ? <CheckCircle2 className="size-3" /> : <span className="font-mono">{i + 1}</span>}
                {label}
              </span>
            </span>
          </div>
        )
      })}
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

/* --- Review: строка единой таблицы гейтов --------------------------- */

function VerdictIcon({ verdict }: { verdict: Receipt['verdict'] }) {
  if (verdict === 'PASS') return <Check className="size-3.5 shrink-0 text-emerald-400" />
  if (verdict === 'FAIL') return <X className="size-3.5 shrink-0 text-red-500" />
  if (verdict === 'WARN') return <AlertTriangle className="size-3.5 shrink-0 text-amber-300" />
  return <Minus className="size-3.5 shrink-0 text-zinc-500" />
}

function LevelChip({ level }: { level: Receipt['level'] }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded border px-1 py-px font-term text-[9px] uppercase tracking-wide',
        level === 'hard' && 'border-red-600/60 bg-red-950/20 text-red-400',
        level === 'warn' && 'border-amber-500/50 bg-amber-950/20 text-amber-300',
        level === 'advisory' && 'border-zinc-700 bg-zinc-900 text-zinc-400',
        level === 'conditional' && 'border-dashed border-fuchsia-500/40 bg-zinc-900 text-fuchsia-300'
      )}
    >
      {level}
    </span>
  )
}

function SourceBadge({ sources }: { sources: BatterySource[] }) {
  const both = sources.includes('R') && sources.includes('TS')
  return (
    <span
      title={
        both
          ? 'гейт сработал в обеих батареях — показана квитанция Rust'
          : sources.includes('R')
            ? 'квитанция Rust twin (:3201)'
            : 'квитанция файл-эры TS'
      }
      className={cn(
        'shrink-0 rounded border px-1 py-px font-term text-[9px] uppercase',
        sources.includes('R') && 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300',
        !sources.includes('R') && 'border-zinc-700 bg-zinc-900 text-zinc-400'
      )}
    >
      {sources.join('·')}
    </span>
  )
}

/** Одна строка: имя гейта (font-term) · чип уровня · бейдж R/TS · вердикт
 * · раскрывающиеся findings (моноширинно, FAIL — багровый текст). */
function GateRow({ row, last }: { row: BatteryRow; last: boolean }) {
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const fail = row.verdict === 'FAIL'
  const findings = row.findings ?? []
  const notes = row.notes ?? []
  const expandable = findings.length + notes.length > 0
  return (
    <div className={cn('border-b border-white/5', last && 'border-b-0', fail && 'bg-red-950/10')}>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-100/5 disabled:cursor-default"
      >
        <VerdictIcon verdict={row.verdict} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-term text-[11px]',
            fail ? 'text-red-300' : 'text-zinc-200'
          )}
        >
          {row.gate}
        </span>
        <LevelChip level={row.level} />
        <SourceBadge sources={row.sources} />
        <span
          className={cn(
            'shrink-0 font-term text-[10px]',
            row.verdict === 'PASS' && 'text-emerald-400',
            row.verdict === 'FAIL' && 'text-red-400',
            row.verdict === 'WARN' && 'text-amber-300',
            (row.verdict === 'OFF' || row.verdict === 'REPORT') && 'text-zinc-500'
          )}
        >
          {row.verdict}
        </span>
        {expandable ? (
          <ChevronDown
            className={cn('size-3 shrink-0 text-zinc-600 transition-transform', open && 'rotate-180')}
          />
        ) : null}
      </button>
      <AnimatePresence initial={false}>
        {open && expandable ? (
          <motion.ul
            key="findings"
            {...(reduceMotion === true
              ? {}
              : {
                  initial: { height: 0, opacity: 0 },
                  animate: { height: 'auto', opacity: 1 },
                  exit: { height: 0, opacity: 0 },
                  transition: SPRING,
                })}
            className="overflow-hidden px-3 pb-2 pl-9"
          >
            {findings.map((f, i) => (
              <li
                key={`f${i}`}
                className={cn(
                  'break-words font-term text-[10px] leading-relaxed',
                  fail ? 'text-red-300' : row.verdict === 'WARN' ? 'text-amber-300/90' : 'text-zinc-400'
                )}
              >
                · {f}
              </li>
            ))}
            {notes.map((n, i) => (
              <li key={`n${i}`} className="break-words font-term text-[10px] leading-relaxed text-zinc-500">
                · {n}
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
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

function shortNote(n: string | null): string {
  return (n ?? '—').replace(/\s+/g, ' ').slice(0, 44)
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
  const [engine, setEngine] = useState<EngineMode>('per-theme')
  const [speciesList, setSpeciesList] = useState('')
  const [notes, setNotes] = useState('')
  const [oc, setOc] = useState<OcInput[]>([
    { theme: '', rating: 'R+' },
    { theme: '', rating: 'R+' },
    { theme: '', rating: 'R+' },
  ])

  /* шаг 1: якоря + гейт №25 */
  const [anchors, setAnchors] = useState<AnchorsState | null>(null)
  const [themeGate, setThemeGate] = useState<Receipt | null>(null)

  /* шаг 2: компиляция */
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [stale, setStale] = useState(false)

  /* шаг 3: Review & Deliver */
  const [delivered, setDelivered] = useState<string | null>(null)
  const [voided, setVoided] = useState<string | null>(null)
  const [battery, setBattery] = useState<BatteryState>(BATTERY_IDLE)

  const [step, setStep] = useState<Step>(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestTick, setSuggestTick] = useState(0)
  /* автор принял/вписал слаг рукой — только тогда он персистится; чистая
   * слаг-подсказка не сохраняется, чтобы при восстановлении twin выдал
   * свежий номер (старый мог уйти в летопись) */
  const [slugTouched, setSlugTouched] = useState(false)
  const slugSuggested = useRef<string>('')
  const slugRef = useRef<string>('')
  /* пересборка (2026-10-20, приказ «сборщика нет»): compiled-сборка в
   * scratch — репетиция, Compile с force:true заменяет её на месте.
   * Включается бейджем у слага, кнопкой «пересобрать» в витрине или
   * панелью выхода из коллизии; смена слага режим гасит. */
  const [reassembling, setReassembling] = useState<string | null>(null)
  const [collision, setCollision] = useState<{ slug: string; status: string } | null>(null)
  const batteryRunId = useRef(0)
  const batteryAbortRef = useRef<AbortController | null>(null)
  const batteryRetryRef = useRef<() => void>(() => {})
  const restoreNotified = useRef(false)
  const pendingDraft = useRef<{ draft: WorkflowDraft; empty: boolean } | null>(null)
  const deliveredFlagRef = useRef(false)

  const ocFilled = oc.filter((o) => o.theme.trim().length > 0).length
  const briefReady = theme.trim().length >= 3 && ocFilled >= 1

  /* занятость слага (честный бейдж у поля): scratch-сборки + прод-батчи.
   * Прод-занятость НЕ блокирует scratch-компиляцию — летописи разные,
   * бейдж лишь объясняет, почему в витрине два одинаковых номера. */
  const scratchList = useScratchBatches()
  const prodList = useEngineBatches()
  const slugOccupancy = useMemo(() => {
    const s = slug.trim().toUpperCase()
    if (!/^T4-\d{2,3}$/.test(s)) return null
    const inScratch = scratchList.rows.find((r) => r.slug === s)
    if (inScratch != null) return { space: 'scratch' as const, status: inScratch.status }
    const inProd = prodList.rows.find((r) => r.slug === s)
    if (inProd != null) return { space: 'prod' as const, status: inProd.status }
    return { space: 'free' as const, status: 'free' }
  }, [slug, scratchList.rows, prodList.rows])

  /* расы-хайджлайты: «R12, R37» → строгие токены R## (species strict twin'а) */
  const speciesTokens = useMemo(
    () =>
      speciesList
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s !== ''),
    [speciesList]
  )
  const speciesValid = speciesTokens.every((s) => /^R\d{2}$/.test(s))
  const speciesActive = speciesTokens.length > 0
  const speciesOk = !speciesActive || speciesValid

  /* гейт №25 (превью Theme Expansion) режет Compile до правки якорей/темы */
  const gate25Blocks = themeGate != null && themeGate.verdict === 'FAIL'

  const batteryHardFail = useMemo(
    () => battery.rows.some((r) => r.level === 'hard' && r.verdict === 'FAIL'),
    [battery.rows]
  )
  const rustRowsN = battery.rows.filter((r) => r.sources.includes('R')).length
  const tsRowsN = battery.rows.filter((r) => r.sources.includes('TS')).length

  /* ── восстановление черновика (гэп B1): сразу на монтировании,
   * чтобы тост объяснил автору появление данных ── */
  useEffect(() => {
    const snap = readWorkflowDraft()
    if (!snap.restored) return
    setTheme(snap.theme)
    setSlug(snap.slug)
    slugRef.current = snap.slug
    setExp(snap.exp)
    setAb(snap.ab)
    setEngine(snap.engine)
    setSpeciesList(snap.speciesList)
    setNotes(snap.notes)
    setOc(snap.oc)
    setAnchors(snap.anchors)
    setStep(snap.step)
    if (snap.slug !== '') setSlugTouched(true)
    restoreNotified.current = true
    const when =
      snap.at > 0
        ? ` · сохранён ${new Date(snap.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
        : ''
    /* Доставка на макротаске: Toaster (root layout) и колокол подписывают
     * слушателей СВОИМИ эффектами — те идут ПОСЛЕ эффектов контента, выстрел
     * из mount-эффекта теряется (подтверждено headless-браузером). Cleanup
     * гасит таймер — StrictMode-двойной монтаж даёт ровно один тост. */
    const fireToast = window.setTimeout(() => {
      notify('info', 'Черновик воркфлоу восстановлен', `шаг «${STEP_LABELS[snap.step]}»${when}`)
      toast({
        title: 'Черновик воркфлоу восстановлен',
        description: `шаг «${STEP_LABELS[snap.step]}» — вид V ничего не потерял${when}`,
      })
    }, 0)
    return () => window.clearTimeout(fireToast)
  }, [])

  /* подсказка следующего слага scratch-летописи twin'а; переподъём по
   * suggestTick — после сброса предлагается свежий номер */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(withGatewayPort('/api/t4/twin/state'), {
          headers: commanderHeaders(),
          cache: 'no-store',
        })
        const body = (await res.json()) as { data?: { scratch?: { nextSlug?: string } } }
        const s = body.data?.scratch?.nextSlug
        if (alive && s && slugRef.current === '') {
          slugSuggested.current = s
          slugRef.current = s
          setSlug(s)
        }
      } catch {
        /* twin молчит — подсказка не критична */
      }
    })()
    return () => {
      alive = false
    }
  }, [suggestTick])

  /* ── персист черновика: debounce 250мс + флеш на анмаунте (вид V) ── */
  useEffect(() => {
    const empty = theme.trim() === '' && ocFilled === 0 && anchors == null && step === 0
    const draft: WorkflowDraft = {
      v: DRAFT_VERSION,
      at: Date.now(),
      theme,
      slug: slugTouched ? slug : '',
      exp,
      ab,
      oc,
      engine,
      speciesList,
      notes,
      anchors,
      step,
    }
    pendingDraft.current = { draft, empty }
    const timer = window.setTimeout(() => {
      pendingDraft.current = null
      if (deliveredFlagRef.current) {
        clearDraftKey()
        return
      }
      writeDraft({ draft, empty })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [theme, slug, slugTouched, exp, ab, oc, engine, speciesList, notes, anchors, step, ocFilled])
  /* анмаунт (смена вида V / уход со страницы): хвост последних 250мс
   * уходит на диск сразу — правка не теряется на размонтировании;
   * висящий прогон батарей обрывается (фечи не живут дольше панели) */
  useEffect(() => {
    return () => {
      batteryAbortRef.current?.abort()
      const pending = pendingDraft.current
      if (pending == null) return
      if (deliveredFlagRef.current) {
        clearDraftKey()
        return
      }
      writeDraft(pending)
    }
  }, [])

  /* витрина «Сборка» → заказ на пересборку: кнопка «пересобрать» кладёт
   * запрос в модуль (воркфлоу в тот момент размонтирован); монтирование
   * после setView('workflow') забирает заказ и включает режим force.
 * Объявлен ПОСЛЕ эффекта восстановления — заказ перекрывает черновик. */
  useEffect(() => {
    const req = consumeWorkflowReassembly()
    if (req == null) return
    setSlug(req.slug)
    slugRef.current = req.slug
    setSlugTouched(true)
    if (req.theme !== '') setTheme(req.theme)
    setReassembling(req.slug)
    setCollision(null)
    setCompiled(null)
    setDelivered(null)
    setVoided(null)
    setAnchors(null)
    setThemeGate(null)
    setStale(false)
    setStep(0)
    batteryRunId.current++
    batteryAbortRef.current?.abort()
    notify(
      'info',
      `Пересборка ${req.slug}`,
      'Compile заменит compiled-сборку в scratch (force) — правь тему/якоря и собирай'
    )
  }, [])

  const twinPost = useCallback(
    async <T,>(
      path: string,
      body: unknown,
      extraHeaders?: Record<string, string>,
      signal?: AbortSignal
    ): Promise<T> => {
      const res = await fetch(withGatewayPort(`/api/t4/twin/${path}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...commanderHeaders(), ...extraHeaders },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal,
      })
      let json: { ok?: boolean; data?: T; error?: { code?: unknown; message?: string } }
      try {
        json = (await res.json()) as { ok?: boolean; data?: T; error?: { code?: unknown; message?: string } }
      } catch {
        throw new TwinError(`twin: HTTP ${res.status} (тело не JSON)`, `http-${res.status}`)
      }
      if (!res.ok || json.ok === false) {
        const err = json.error != null ? asRecord(json.error) : {}
        throw new TwinError(asStr(err.message) || `twin: HTTP ${res.status}`, asStr(err.code) || `http-${res.status}`)
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
      setStale(false)
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

  /* правка якорей автором: превью гейта устарело — перепроверка на
   * компиляции (twin strict-валидирует themeAnchors и гоняет гейт №25 заново) */
  const editAnchors = useCallback((next: AnchorsState) => {
    setAnchors(next)
    setThemeGate(null)
  }, [])

  /* ── шаг 2: Compile (якоря + гейт №25 + engine/species/notes) ──
   * opts.slugOverride — коллизия решена «взять следующий номер»;
   * opts.force — пересборка поверх compiled (сила режима reassembling). */
  const runCompile = useCallback(
    async (opts?: { slugOverride?: string; force?: boolean }) => {
    const targetSlug = (opts?.slugOverride ?? slug).trim() || slugSuggested.current || undefined
    const force = opts?.force ?? reassembling != null
    setBusy('compile')
    setError(null)
    setCollision(null)
    try {
      const body: Record<string, unknown> = {
        theme: theme.trim(),
        slug: targetSlug,
        engine,
        exp,
        abPairs: ab,
        expandTheme: true,
        ocThemes: oc
          .filter((o) => o.theme.trim())
          .map((o, i) => ({ theme: o.theme.trim(), rating: o.rating, position: i + 1 })),
        species: speciesActive
          ? { on: true, count: speciesTokens.length, list: speciesTokens }
          : { on: false, count: 0, list: [] },
      }
      if (force) body.force = true
      if (notes.trim() !== '') body.notes = notes.trim().slice(0, 2000)
      if (anchors != null) {
        body.themeAnchors = anchors
      }
      const data = await twinPost<{
        plan?: { slug?: string; sha10?: string; slots?: unknown[]; receipts?: Receipt[] }
        event?: { seq?: number }
        themeGate?: Receipt
        themeAnchors?: AnchorsState
        reassembly?: boolean
      }>('compile', body, {
        'Idempotency-Key': `wf-${Date.now().toString(36)}-${targetSlug ?? 'auto'}${force ? '-f' : ''}`,
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
      setStale(false)
      /* удачный compile = вход в Review: батареи гонятся автоматически;
       * scratch-списки (рельс + витрина) видят новую/заменённую сборку */
      invalidateEngineBatches()
      setStep(3)
      notify(
        'success',
        data.reassembly === true ? `План ${plan.slug ?? ''} ПЕРЕсобран` : `План ${plan.slug ?? ''} готов`,
        `sha10 ${plan.sha10 ?? '—'} · scratch-летопись twin'а · Review ниже`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'компиляция не прошла'
      setError(msg)
      /* коллизия слага — НЕ тупик: панель с пересборкой/следующим номером */
      const m = msg.match(/\u0441\u043b\u0430\u0433 (T4-\d{2,3}) \u0443\u0436\u0435 \u0437\u0430\u043d\u044f\u0442 \(status (\w+)\)/)
      if (m != null) setCollision({ slug: m[1], status: m[2] })
      notify('error', 'Компиляция не прошла', msg)
    } finally {
      setBusy(null)
    }
  }, [theme, slug, engine, exp, ab, oc, anchors, twinPost, speciesActive, speciesTokens, notes, reassembling])

  /* коллизия → «взять следующий номер»: свежий nextSlug у twin'а и сразу
   * повтор компиляции тем же содержимым — автор не вводит ничего дважды */
  const takeNextSlug = useCallback(async () => {
    setBusy('compile')
    try {
      const res = await fetch(withGatewayPort('/api/t4/twin/state'), {
        headers: commanderHeaders(),
        cache: 'no-store',
      })
      const body = (await res.json()) as { data?: { scratch?: { nextSlug?: string } } }
      const next = body.data?.scratch?.nextSlug
      if (next == null || next === '') throw new Error('twin не дал следующий номер')
      setSlug(next)
      slugRef.current = next
      setSlugTouched(true)
      setReassembling(null)
      setCollision(null)
      notify('info', `Номер → ${next}`, 'пробую собрать на свободном слоте')
      await runCompile({ slugOverride: next })
    } catch (e) {
      setBusy(null)
      const msg = e instanceof Error ? e.message : 'номер не взят'
      setError(msg)
      notify('error', 'Следующий номер не взят', msg)
    }
  }, [runCompile])

  /* ── Review: две батареи → одна таблица ── */

  interface TwinBatteryRun {
    rust: Receipt[]
    /** true — честное notFound «нет драфта» (норма до SCRIBE) */
    nodraft: boolean
    /** живой сбой twin (таймаут/503/422) — баннер + ретрай, НЕ «нет драфта» */
    error: string | null
  }

  /* Rust-батарея twin'а: POST /api/t4/twin/gates (ключ проксируется).
   * 404 «нет драфта» — нормальный случай до SCRIBE, плашка честная;
   * любые другие ошибки — живой сбой: ретрай + тост. */
  const fetchTwinBattery = useCallback(
    async (slug: string, signal?: AbortSignal): Promise<TwinBatteryRun> => {
      try {
        const data = await twinPost<{ receipts?: unknown }>('gates', { slug }, undefined, signal)
        const rust = parseReceipts(data.receipts)
        return { rust, nodraft: rust.length === 0, error: null }
      } catch (e) {
        if (e instanceof TwinError && (e.code === 'notFound' || e.message.includes('нет драфта'))) {
          return { rust: [], nodraft: true, error: null }
        }
        if (e instanceof DOMException && e.name === 'AbortError') {
          return { rust: [], nodraft: false, error: null } /* прогон отменён — ид-гвард отбросит */
        }
        return { rust: [], nodraft: false, error: e instanceof Error ? e.message : 'twin не ответил' }
      }
    },
    [twinPost]
  )

  /* TS-батарея файл-эры: POST /api/t4/gates (runGates, та же merge-таблица).
   * Драфта в файл-эре нет до SCRIBE → 404 «batch file not found» — норма. */
  const fetchFileBattery = useCallback(
    async (slug: string, signal?: AbortSignal): Promise<{ ts: Receipt[]; note: string | null }> => {
      try {
        const res = await fetch(withGatewayPort('/api/t4/gates'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...commanderHeaders() },
          body: JSON.stringify({ slug }),
          cache: 'no-store',
          signal,
        })
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null)
          const noteRaw = asStr(asRecord(raw).error)
          return {
            ts: [],
            note:
              res.status === 404
                ? 'нет драфта'
                : noteRaw !== ''
                  ? noteRaw
                  : `файл-эра: HTTP ${res.status}`,
          }
        }
        const raw: unknown = await res.json()
        return { ts: parseReceipts(asRecord(raw).receipts), note: null }
      } catch {
        return { ts: [], note: 'файл-эра молчит' }
      }
    },
    []
  )

  const runBatteries = useCallback(
    async (slug: string, eventSeq: number) => {
      const id = ++batteryRunId.current
      batteryAbortRef.current?.abort()
      const controller = new AbortController()
      batteryAbortRef.current = controller
      setBattery((b) => ({ ...b, status: 'running', rows: [], rustNote: null, tsNote: null, rustError: null }))
      const [twinR, fileR] = await Promise.all([
        fetchTwinBattery(slug, controller.signal),
        fetchFileBattery(slug, controller.signal),
      ])
      if (batteryRunId.current !== id) return /* сброс/возврат отменил прогон */
      /* доктрина dual-DB: пока Rust-тwin не видит драфта, квитанции файл-эры
       * с тем же слагом — ЧУЖОЙ исторический батч (scratch-слаги T4-01..41
       * коллизируют с файл-эрой до SCRIBE) — в таблицу и в блокировку сдачи
       * они не попадают, только честная пометка в статус-строке */
      const twinConfirmed = !twinR.nodraft && twinR.error == null
      const tsTrusted = twinConfirmed ? fileR.ts : []
      const tsNote =
        !twinConfirmed && fileR.ts.length > 0
          ? 'слог занят историческим батчем файл-эры'
          : fileR.note
      const rows = mergeBatteryRows(twinR.rust, tsTrusted)
      setBattery({
        status: rows.length > 0 ? 'done' : 'nodraft',
        rows,
        rustNote: twinR.nodraft ? 'нет драфта' : null,
        tsNote,
        rustError: twinR.error,
        ranFor: `${slug}#${eventSeq}`,
      })
      /* живой сбой twin ≠ «нет драфта»: тост с ретраем (use-toast — рабочий
       * канал проекта, sonner не смонтирован) + баннер в секции Review */
      if (twinR.error != null) {
        toast({
          title: 'Батарея Rust не ответила',
          description: twinR.error,
          variant: 'destructive',
          action: (
            <ToastAction altText="Перегнать батарею гейтов" onClick={() => batteryRetryRef.current()}>
              Перегнать батарею
            </ToastAction>
          ),
        })
      }
    },
    [fetchTwinBattery, fetchFileBattery]
  )

  /* ретрай из тоста берёт свежую компиляцию (после пересбора — новый слаг) */
  useEffect(() => {
    batteryRetryRef.current = () => {
      if (compiled != null) void runBatteries(compiled.slug, compiled.eventSeq)
    }
  }, [compiled, runBatteries])

  /* вход в Review (после успешного compile) — автоматический прогон батарей;
   * подпись «slug#eventSeq» гарантирует повтор на пересборке того же слага */
  useEffect(() => {
    if (step !== 3 || compiled == null) return
    if (battery.ranFor === `${compiled.slug}#${compiled.eventSeq}`) return
    void runBatteries(compiled.slug, compiled.eventSeq)
  }, [step, compiled, battery.ranFor, runBatteries])

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
      /* после сдачи черновик не восстанавливается слепо — ключ стёрт */
      deliveredFlagRef.current = true
      clearDraftKey()
      setReassembling(null)
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
      setReassembling(null)
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

  /* ── возврат автора без потери данных (требование 1-b/2d) ── */
  const rejectToAnchors = useCallback(() => {
    batteryRunId.current++ /* висящие прогоны батарей отменяются */
    batteryAbortRef.current?.abort()
    setStale(true)
    setBattery(BATTERY_IDLE)
    setStep(anchors != null ? 1 : 0)
    notify(
      'info',
      'Возврат к якорям',
      'тема, якоря и настройки сохранены — план помечен устаревшим'
    )
  }, [anchors])

  /* ── полный сброс («Новый батч» + событие палитры t4:workflow-reset) ── */
  const resetWorkflow = useCallback((reason: ResetReason) => {
    setTheme('')
    setSlug('')
    slugRef.current = ''
    slugSuggested.current = ''
    setSlugTouched(false)
    setReassembling(null)
    setCollision(null)
    setExp(0)
    setAb(2)
    setEngine('per-theme')
    setSpeciesList('')
    setNotes('')
    setOc([
      { theme: '', rating: 'R+' },
      { theme: '', rating: 'R+' },
      { theme: '', rating: 'R+' },
    ])
    setAnchors(null)
    setThemeGate(null)
    setCompiled(null)
    setDelivered(null)
    setVoided(null)
    setStale(false)
    setBattery(BATTERY_IDLE)
    batteryRunId.current++
    batteryAbortRef.current?.abort()
    setStep(0)
    setError(null)
    deliveredFlagRef.current = false
    pendingDraft.current = null
    clearDraftKey()
    setSuggestTick((t) => t + 1)
    notify(
      'info',
      'Воркфлоу сброшен',
      reason === 'palette' ? 'сброс из палитры команд ⌘K — черновик стёрт' : 'черновик стёрт — готов к новому приказу'
    )
    /* видимый тост — только с кнопки «Новый батч» (палитра шлёт свой тост,
     * двойных не плодим); колокол-история пишется notify() выше */
    if (reason === 'after-deliver') {
      toast({
        title: 'Воркфлоу сброшен',
        description: 'черновик стёрт — готов к новому приказу',
      })
    }
  }, [])

  /* палитра шлёт CustomEvent 't4:workflow-reset' (detail: {reason}) */
  useEffect(() => {
    const onWorkflowReset = (ev: Event) => {
      resetWorkflow(readResetReason(ev))
    }
    window.addEventListener(WORKFLOW_RESET_EVENT, onWorkflowReset)
    return () => window.removeEventListener(WORKFLOW_RESET_EVENT, onWorkflowReset)
  }, [resetWorkflow])

  const stepState = (n: number): 'locked' | 'open' | 'done' => {
    if (step > n) return 'done'
    if (step === n) return 'open'
    return 'locked'
  }

  const panel =
    'rounded-xl border border-zinc-800/80 bg-zinc-950/70 backdrop-blur transition-colors'

  const batteryRunning = battery.status === 'running' || battery.status === 'idle'

  /* бейдж режима пересборки — рядом с кнопкой Compile (обе ветки шага 1):
   * Compile сработает с force:true и заменит compiled-сборку на месте */
  const reassemblyBadge = reassembling != null ? (
    <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
      <RotateCcw className="size-3" />
      force · пересборка поверх {reassembling}
      <button
        type="button"
        onClick={() => setReassembling(null)}
        title="выйти из режима пересборки (обычный Compile)"
        aria-label="выйти из режима пересборки"
        className="rounded p-0.5 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
      >
        <X className="size-3" />
      </button>
    </span>
  ) : null

  return (
    <LayoutGroup>
      <div className="space-y-3">
        {/* ── степпер: layoutId-пилюля скользит по шагам ─────────── */}
        <Stepper step={step} />

        {/* ── шаг 0: приказ ─────────────────────────────────────── */}
        <motion.section {...motionProps} className={cn(panel, 'p-4 sm:p-5')}>
          <StepHead n={0} title={STEP_LABELS[0]} state={stepState(0)} hint="тема · слаг · OC · EXP" />
          <AnimatePresence mode="wait" initial={false}>
            {step === 0 ? (
              <motion.div key="s0-active" {...motionProps} className="mt-3 space-y-3">
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
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase().slice(0, 6)
                          slugRef.current = v
                          setSlugTouched(true)
                          setSlug(v)
                          if (v !== reassembling) setReassembling(null)
                          setCollision(null)
                        }}
                        placeholder="T4-99"
                        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 font-mono text-[12px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60"
                      />
                      {/* честная занятость слага: свободен/занят и где именно */}
                      {slugOccupancy != null ? (
                        slugOccupancy.space === 'free' ? (
                          <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                            свободен в обоих пространствах
                          </span>
                        ) : slugOccupancy.space === 'scratch' ? (
                          slugOccupancy.status === 'compiled' ? (
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-amber-400">
                              занят в scratch · собран
                              <button
                                type="button"
                                onClick={() => setReassembling(slug.trim().toUpperCase())}
                                title="Compile заменит эту compiled-сборку на месте (force)"
                                className="rounded border border-amber-500/40 px-1.5 py-px text-amber-300 transition-colors hover:bg-amber-500/10"
                              >
                                пересобрать поверх
                              </button>
                            </span>
                          ) : slugOccupancy.status === 'delivered' ? (
                            <span className="mt-1 block font-mono text-[10px] text-rose-400">
                              занят в scratch · сдан — нужен другой номер
                            </span>
                          ) : (
                            <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                              закрыт (void) в scratch — номер свободен
                            </span>
                          )
                        ) : (
                          <span className="mt-1 block font-mono text-[10px] text-emerald-500/80">
                            есть в проде ({slugOccupancy.status}) — другая летопись, сборке не мешает
                          </span>
                        )
                      ) : null}
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

                {/* движок · расы · заметки — компактный ряд (strict-контракт twin'а) */}
                <div className="grid gap-2 md:grid-cols-[168px_minmax(0,1fr)_minmax(0,1.4fr)]">
                  <label className="block min-w-0">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">движок</span>
                    <select
                      value={engine}
                      onChange={(e) => {
                        const v = e.target.value
                        setEngine(v === 'per-theme raw-plus' ? 'per-theme raw-plus' : 'per-theme')
                      }}
                      className="mt-1 h-[30px] w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-1.5 font-mono text-[11px] text-zinc-200 outline-none transition-colors focus:border-amber-500/60"
                    >
                      {ENGINE_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                      расы (необязательно)
                    </span>
                    <input
                      value={speciesList}
                      onChange={(e) => setSpeciesList(e.target.value)}
                      placeholder="R12, R37 — из races.json"
                      className="mt-1 h-[30px] w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-2 font-mono text-[11px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60"
                    />
                    {!speciesOk ? (
                      <span className="mt-0.5 block font-mono text-[9px] text-amber-400">
                        формат: R## через запятую
                      </span>
                    ) : null}
                  </label>
                  <label className="block min-w-0">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                      заметки (необязательно)
                    </span>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
                      rows={1}
                      placeholder="авторская нота к компиляции — уйдёт в запрос движка"
                      className="mt-1 h-[30px] w-full resize-none rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 text-[11px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/60"
                    />
                  </label>
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
                        {OC_RATINGS.map((r) => (
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
              </motion.div>
            ) : (
              <motion.p key="s0-summary" {...motionProps} className="mt-2 truncate font-mono text-[11px] text-zinc-500">
                «{theme}» · {slug}{reassembling != null ? ` · ПЕРЕсборка поверх ${reassembling}` : ''} · EXP {exp} · A/B {ab} · OC {ocFilled} · движок {engine}
                {speciesActive ? ` · расы ${speciesTokens.length}` : ''}
                {notes.trim() !== '' ? ' · заметки ✓' : ''}
              </motion.p>
            )}
          </AnimatePresence>
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
              <AnimatePresence mode="wait" initial={false}>
                {exp > 0 ? (
                  <motion.div key="s1-exp" {...motionProps} className="mt-3 space-y-3">
                    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[12px] text-zinc-400">
                      <AlertTriangle className="size-3.5 text-zinc-500" />
                      EXP-батч — Theme Expansion и гейт №25 выключены (приказ автора, вердикт
                      T4-34). Freeform-режим: компилируй без якорей.
                    </div>
                    {/* EXP-путь обязан иметь выход к компиляции — тот же ран, что у якорей
                        (баг-фикс: кнопка жила только в ветке anchors, EXP заходил в тупик) */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy != null || !speciesOk}
                        onClick={() => void runCompile()}
                        className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition-all hover:bg-white active:scale-[0.98] disabled:opacity-40"
                      >
                        <FileSignature className="size-4" />
                        {busy === 'compile'
                          ? 'компилирую…'
                          : reassembling != null
                            ? 'Пересобрать (force) → SCRIBE'
                            : 'Compile → SCRIBE'}
                      </button>
                      {reassemblyBadge}
                      {!speciesOk ? (
                        <span className="font-mono text-[10px] text-amber-400">
                          расы: формат R## через запятую
                        </span>
                      ) : null}
                    </div>
                  </motion.div>
                ) : anchors == null ? (
                  <motion.p key="s1-empty" {...motionProps} className="mt-2 font-mono text-[11px] text-zinc-500">
                    якоря не вычислены
                  </motion.p>
                ) : (
                  <motion.div key="s1-anchors" {...motionProps} className="mt-3 space-y-3">
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
                        disabled={busy != null || gate25Blocks || !speciesOk}
                        onClick={() => void runCompile()}
                        className="flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition-all hover:bg-white active:scale-[0.98] disabled:opacity-40"
                      >
                        <FileSignature className="size-4" />
                        {busy === 'compile'
                          ? 'компилирую…'
                          : reassembling != null
                            ? 'Пересобрать (force) → SCRIBE'
                            : 'Compile → SCRIBE'}
                      </button>
                      {reassemblyBadge}
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={runExpand}
                        title="пересчитать якоря по текущей теме (правки якорей применятся на компиляции)"
                        className="rounded-lg border border-zinc-800 px-3 py-2 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                      >
                        пересчитать по теме
                      </button>
                      {gate25Blocks ? (
                        <span className="font-mono text-[10px] text-rose-400">
                          гейт №25 FAIL — правь якоря выше или тему
                        </span>
                      ) : null}
                      {!speciesOk ? (
                        <span className="font-mono text-[10px] text-amber-400">
                          расы: формат R## через запятую
                        </span>
                      ) : null}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {/* ── шаг 2: Compile & SCRIBE ───────────────────────────── */}
        <AnimatePresence initial={false}>
          {compiled != null ? (
            <motion.section key="compile" {...motionProps} className={cn(panel, 'p-4 sm:p-5')}>
              <StepHead
                n={2}
                title={STEP_LABELS[2]}
                state={step > 2 ? 'done' : step === 2 ? 'open' : stale ? 'done' : 'locked'}
                hint={stale ? 'устарел — пересобрать' : `sha10 ${compiled.sha10}`}
              />
              <div className="mt-3 space-y-3">
                {stale ? (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                    <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
                    <span className="text-[12px] text-amber-300">
                      план устарел — правь якоря и пересобери (compile прогонит гейт №25 strict);
                      compiled-номер пересборщик заменит сам (force) — сдавать или закрывать ничего не нужно
                    </span>
                  </div>
                ) : null}
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
                    disabled={busy != null}
                    onClick={runVoid}
                    className="rounded-lg border border-rose-500/40 px-3 py-2 font-mono text-[11px] text-rose-300 transition-colors hover:bg-rose-500/10"
                  >
                    Void
                  </button>
                  {step >= 3 ? (
                    <span className="font-mono text-[10px] text-zinc-600">
                      сдача — в шаге «Review & Deliver» ниже
                    </span>
                  ) : null}
                </div>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {/* ── шаг 3: Review & Deliver (батареи · таблица · сдача) ── */}
        <AnimatePresence mode="wait" initial={false}>
          {step >= 3 && compiled != null ? (
            <motion.section key="review" {...motionProps} className={cn(panel, 'p-4 sm:p-5')}>
              <StepHead
                n={3}
                title={STEP_LABELS[3]}
                state={delivered != null || voided != null ? 'done' : stepState(3)}
                hint="батареи · вердикт · сдача"
              />
              <div className="mt-3 space-y-3">
                {/* источники + перегон */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p
                    className="min-w-0 flex-1 truncate font-term text-[10px] text-zinc-500"
                    title={`twin Rust (R): ${battery.rustNote ?? `квитанций ${rustRowsN}`}\nфайл-эра TS: ${battery.tsNote ?? `квитанций ${tsRowsN}`}`}
                  >
                    батареи · Rust twin:
                    <span className={rustRowsN > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                      {' '}
                      {rustRowsN > 0 ? `${rustRowsN}` : shortNote(battery.rustNote)}
                    </span>
                    {' · '}файл-эра TS:
                    <span className={tsRowsN > 0 ? 'text-zinc-300' : 'text-zinc-600'}>
                      {' '}
                      {tsRowsN > 0 ? `${tsRowsN}` : shortNote(battery.tsNote)}
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={busy != null || batteryRunning}
                    onClick={() => {
                      if (compiled != null) void runBatteries(compiled.slug, compiled.eventSeq)
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
                  >
                    <RefreshCw className={cn('size-3', batteryRunning && 'animate-spin')} />
                    перегнать батарею
                  </button>
                </div>

                {/* hard-FAIL где угодно → баннер + блокировка сдачи */}
                {batteryHardFail ? (
                  <div className="flex items-center gap-2 rounded-lg border border-red-600/60 bg-red-950/30 px-3 py-2.5 backdrop-blur-xl">
                    <X className="size-4 shrink-0 text-red-500" />
                    <p className="text-[12px] font-semibold text-red-400">
                      Hard-гейт провален — батч не готов к сдаче
                    </p>
                  </div>
                ) : null}

                {batteryRunning ? (
                  <p className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2 font-term text-[11px] text-zinc-400 backdrop-blur-xl">
                    <RefreshCw className="size-3.5 animate-spin" />
                    батарея гейтов гонится — квитанции подъезжают…
                  </p>
                ) : (
                  <>
                    {/* живой сбой twin (не «нет драфта») — честный баннер + ретрай;
                     * сдачу НЕ блокируем: недоступность батареи ≠ hard-FAIL */}
                    {battery.rustError != null ? (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/50 bg-rose-950/20 px-3 py-2.5 backdrop-blur-xl"
                      >
                        <X className="size-4 shrink-0 text-red-500" />
                        <span className="min-w-0 flex-1 break-words font-term text-[11px] text-rose-200/90">
                          батарея Rust: {battery.rustError}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (compiled != null) void runBatteries(compiled.slug, compiled.eventSeq)
                          }}
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-rose-500/50 px-2 py-1 font-mono text-[10px] text-rose-200 transition-colors hover:bg-rose-500/10"
                        >
                          <RefreshCw className="size-3" />
                          ретрай
                        </button>
                      </div>
                    ) : null}
                    {battery.rows.length > 0 ? (
                      <div className="t4-scroll max-h-[280px] overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-zinc-900/40 backdrop-blur-xl">
                        {battery.rows.map((row, i) => (
                          <GateRow key={`${row.gate}:${row.sources.join('+')}`} row={row} last={i === battery.rows.length - 1} />
                        ))}
                      </div>
                    ) : battery.rustError == null ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2.5 backdrop-blur-xl">
                        <PenLine className="size-3.5 shrink-0 text-fuchsia-300" />
                        <span className="text-[11px] text-zinc-400">
                          Драфт ещё не написан — текстовая батарея доступна после SCRIBE
                        </span>
                        <button
                          type="button"
                          onClick={() => onFocusAction('scribe')}
                          className="rounded-md border border-fuchsia-500/40 px-2 py-1 font-mono text-[10px] text-fuchsia-300 transition-colors hover:bg-fuchsia-500/10"
                        >
                          Открыть карточку писца (I)
                        </button>
                      </div>
                    ) : null}
                  </>
                )}

                {/* вердикт ветки: сдача/закрытие ИЛИ approve/reject */}
                {delivered != null || voided != null ? (
                  <div className="space-y-2">
                    <p
                      className={cn(
                        'font-mono text-[12px]',
                        delivered != null ? 'text-emerald-400' : 'text-red-300'
                      )}
                    >
                      {delivered != null
                        ? `${compiled.slug} сдан в scratch-летопись twin'а (${delivered}) — цепь движка продакшн-эры не тронута`
                        : `${compiled.slug} ${voided} — номер не переиспользуется, провенанс в летописи`}
                    </p>
                    <button
                      type="button"
                      onClick={() => resetWorkflow('after-deliver')}
                      className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 active:scale-[0.98]"
                    >
                      <RotateCcw className="size-4" />
                      Новый батч
                    </button>
                    <p className="font-mono text-[10px] text-zinc-600">
                      вердикт по рендеру и производственная сдача — решения автора (священные правила)
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy != null || !compiled.hardPass || batteryRunning || batteryHardFail}
                      onClick={runDeliver}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98]',
                        compiled.hardPass && !batteryHardFail
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-zinc-950 hover:brightness-110'
                          : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                      )}
                    >
                      <Send className="size-4" />
                      {busy === 'deliver' ? 'сдаю…' : 'Approve & Deliver'}
                    </button>
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={rejectToAnchors}
                      title="вернуться к Theme Expansion (или к приказу, если expand не делали) без потери состояния"
                      className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 font-mono text-[11px] text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-300"
                    >
                      <Undo2 className="size-3.5" />
                      Отклонить и вернуться к якорям
                    </button>
                    <p className="w-full font-mono text-[10px] text-zinc-600">
                      вердикт по рендеру и производственная сдача — решения автора (священные правила)
                    </p>
                  </div>
                )}
              </div>
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

        {/* ── коллизия слага: НЕ тупик — выходы одной кнопкой ────── */}
        <AnimatePresence initial={false}>
          {collision != null ? (
            <motion.div
              key="collision"
              role="region"
              aria-label="выход из коллизии слага"
              initial={reduceMotion === true ? undefined : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
              className="overflow-hidden"
            >
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/[0.04] px-3 py-2.5">
                <p className="text-[12px] font-semibold text-amber-300">
                  Слаг {collision.slug} уже занят ({collision.status}) — но это решается:
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {collision.status === 'compiled' ? (
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => {
                        setReassembling(collision.slug)
                        void runCompile({ force: true })
                      }}
                      title="Compile заменит compiled-сборку этого слага новым планом (force); прежний план уйдёт в supersedes события"
                      className="flex items-center gap-1.5 rounded-lg bg-amber-500/90 px-3 py-1.5 text-[12px] font-semibold text-zinc-950 transition-all hover:bg-amber-400 active:scale-[0.98] disabled:opacity-40"
                    >
                      <RotateCcw className="size-3.5" />
                      Пересобрать поверх {collision.slug}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() => void takeNextSlug()}
                    title="взять свежий свободный номер у twin'а и повторить компиляцию тем же содержимым"
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 transition-all hover:border-zinc-500 active:scale-[0.98] disabled:opacity-40"
                  >
                    <ArrowRight className="size-3.5" />
                    Взять следующий номер
                  </button>
                  <button
                    type="button"
                    disabled={busy != null}
                    onClick={() => {
                      setSlug('')
                      slugRef.current = ''
                      setSlugTouched(false)
                      setReassembling(null)
                      setCollision(null)
                      setSuggestTick((t) => t + 1)
                    }}
                    title="очистить поле слага — twin сам подставит свободный номер"
                    className="rounded-lg border border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
                  >
                    сбросить номер (авто)
                  </button>
                  {collision.status !== 'compiled' ? (
                    <span className="font-mono text-[10px] text-zinc-500">
                      {collision.slug} сдан/закрыт — номер неприкосновенен, пересборка недоступна
                    </span>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ── степпер-подсказка ──────────────────────────────────── */}
        <p className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
          <ChevronDown className="size-3" />
          один поток без вкладок: приказ → якоря → компиляция → review ·{' '}
          <Compass className="size-3" /> черновик живёт в localStorage — вид V ничего не теряет
        </p>
      </div>
    </LayoutGroup>
  )
}
