'use client'

/**
 * THREAD 4 — PIPELINE CONSOLE (2026-10-18 redesign)
 * =====================================================================
 * Clean, high-contrast developer console for the THREAD 4 prompt-batch
 * pipeline. Every control is wired to the REAL t4-engine (RPC :3200 via
 * the /api/t4/engine proxy). Nothing decorative: every piece of state
 * below reflects live engine data.
 *
 *   · BURN & REBUILD — full genesis→head chain re-audit. Recomputes
 *     every prev→hash link in the browser in visible chunks and
 *     cross-checks against GET /v1/chain/verify (authority).
 *     Read-only on canon (a destructive rewrite of the author's
 *     chronicle would be vandalism — this is the honest rebuild: the
 *     validation state is rebuilt from scratch).
 *   · FORCE COMPILE — real POST /v1/compile (commander-key gated,
 *     Idempotency-Key protected, strict Zod body). Receipts drive the
 *     24-slot gate matrix; the verdict banner shows
 *     CLEAN RUN / DRIFT DETECTED / VOID DETECTED / AUTH LOCKED.
 *   · PURGE HEAP — flushes the local chronicle buffer (visible line
 *     count) and re-seeds the tail from the engine.
 *   · CHRONICLE & HASH-CHAIN — chain.jsonl stream as a legible log
 *     table: seq, time, type, summary, hash·prev, and a per-link
 *     validation tick (green check = prev[i] === hash[i-1],
 *     blinking red = mismatch). Live poll every 2.5s, follow mode,
 *     filters, pause.
 *   · ROTATION WINDOW — the last 3 DELIVERED batches as an explicit
 *     3-slot row: which palettes are locked out of the pool, union /
 *     free budget against the FUND of 120. Real plan data; legacy
 *     batches' palettes are extracted from their plan markdown.
 *   · SYSTEM — engine state snapshot (height, head, counts, db, uptime).
 *
 * Anime presence is intentionally minimal: tiny text tags only
 * ([T4-Core: ACTIVE], [OP: TSUBAKI]) — no mascots, no bubbles.
 */

import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CircleDot,
  Database,
  Eye,
  EyeOff,
  Flame,
  Hash,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal as TerminalIcon,
  Timer,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ApiError,
  asArray,
  asRecord,
  asStr,
  clearCommanderKey,
  fetchJson,
  getCommanderKey,
  postJson,
  probeCommanderKey,
  setCommanderKey,
} from '@/components/t4/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

interface Envelope<T> {
  ok?: boolean
  data: T
}

interface EngineState {
  era: string
  canon: string
  fam: string
  nextSlug: string
  lastDelivered: { slug: string; title: string; deliveredAt: string | null } | null
  counts: { events: number; batchesDelivered: number; batchesCompiled: number; verdicts: number }
  chain: { height: number; head: string; ok: boolean; problems: string[] }
  db: { file: string; bytes: number; schemaVersion: number }
  uptimeSec: number
}

interface EngineEvent {
  seq: number
  id: string
  at: string
  type: string
  summary: string
  hash: string
  prev: string
  data?: unknown
}

interface EventsData {
  events: EngineEvent[]
  returned: number
  total: number
}

interface VerifyData {
  ok: boolean
  events: number
  head: string | null
  problems: string[]
}

interface BatchRow {
  slug: string
  title: string
  status: string
  expSlots: number
  createdAt: string
  deliveredAt: string | null
}

interface BatchCardData {
  slug: string
  title: string
  status: string
  plan: unknown
}

interface CompileResponse {
  plan?: unknown
  receipts?: unknown
  idempotentReplay?: boolean
}

type RowLevel = 'chain' | 'sys'
type RowTone = 'ok' | 'warn' | 'err' | 'info'

interface Row {
  key: string
  level: RowLevel
  seq: number | null
  at: string
  type: string
  summary: string
  hash: string
  prev: string
  linkOk: boolean
  tone: RowTone
}

type CellStatus = 'standby' | 'assigned' | 'cycling' | 'sealed' | 'void'

interface GateCellData {
  pos: number
  kind: string
  rating: string
  register: string
  paletteId: string
  status: CellStatus
}

interface Receipt {
  gate: string
  level: string
  verdict: string
  findings: string[]
}

interface RotPalette {
  id: string
  name: string
  colors: string[]
}

interface RotCard {
  slot: number
  slug: string
  title: string
  deliveredAt: string
  palettes: RotPalette[]
}

interface BurnState {
  phase: 'idle' | 'running' | 'done'
  done: number
  total: number
  result: { ok: boolean; text: string } | null
}

type BannerKind = 'clean' | 'drift' | 'void' | 'locked' | 'error'

interface Banner {
  id: number
  kind: BannerKind
  title: string
  detail: string
}

interface ToastMsg {
  id: number
  kind: 'ok' | 'err' | 'info'
  title: string
  body: string
}

type KeyChip = 'checking' | 'ok' | 'mismatch' | 'noserver' | 'nokey'

/* ================================================================== */
/* Constants & pure helpers                                            */
/* ================================================================== */

const MAX_ROWS = 220
const PALETTE_FUND = 120

/** Terminal grid template shared by the table header and every row so
 *  the log-table structure never breaks. */
const ROW_GRID =
  'grid grid-cols-[22px_44px_60px_88px_minmax(0,1fr)] md:grid-cols-[26px_54px_78px_118px_minmax(0,1fr)_186px] items-center gap-1'

const h8 = (h: string): string => (h === '' ? '········' : h.slice(0, 8))

const pad = (n: number): string => String(n).padStart(2, '0')

const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const fmtClock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

const fmtDay = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`
}

const fmtUptime = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

const fmtKb = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toneForType(type: string): RowTone {
  if (type.includes('void')) return 'err'
  if (type.startsWith('batch.')) return 'ok'
  if (type.startsWith('render.') || type.startsWith('gate.') || type.startsWith('scribe.')) return 'warn'
  return 'info'
}

function isChainEvent(e: unknown): e is EngineEvent {
  const r = asRecord(e)
  return typeof r.seq === 'number' && typeof r.hash === 'string' && typeof r.prev === 'string'
}

function toRow(e: EngineEvent, linkOk: boolean): Row {
  return {
    key: `ev-${e.seq}`,
    level: 'chain',
    seq: e.seq,
    at: e.at,
    type: e.type,
    summary: e.summary,
    hash: e.hash,
    prev: e.prev,
    linkOk,
    tone: toneForType(e.type),
  }
}

/** Engine plan → 24 core slots + EXP overlay slots. */
function planSlotsToCells(plan: unknown): { cells: GateCellData[]; expCells: GateCellData[] } {
  const slots = asArray(asRecord(plan).slots).map((s) => {
    const r = asRecord(s)
    return {
      position: typeof r.position === 'number' ? r.position : 0,
      kind: asStr(r.kind) || 'MAIN',
      rating: asStr(r.rating) || '—',
      register: asStr(r.register) || '—',
      paletteId: asStr(r.paletteId) || '',
    }
  })
  const cells: GateCellData[] = []
  const expCells: GateCellData[] = []
  for (const s of slots) {
    if (s.position === 0) continue
    const cell: GateCellData = {
      pos: s.position,
      kind: s.kind,
      rating: s.rating,
      register: s.register,
      paletteId: s.paletteId,
      status: 'assigned',
    }
    if (s.position <= 24) cells.push(cell)
    else expCells.push(cell)
  }
  cells.sort((a, b) => a.pos - b.pos)
  expCells.sort((a, b) => a.pos - b.pos)
  return { cells, expCells }
}

function normReceipts(raw: unknown[]): Receipt[] {
  return raw
    .map((r) => {
      const rec = asRecord(r)
      return {
        gate: asStr(rec.gate) || '?',
        level: asStr(rec.level) || 'hard',
        verdict: asStr(rec.verdict) || 'PASS',
        findings: asArray(rec.findings).map(asStr).filter((s) => s !== ''),
      }
    })
    .filter((r) => r.gate !== '?')
}

/** Legacy batches (file-era) carry their locked palettes in the plan
 *  markdown — extract the real P### ids from there. */
function extractPaletteIds(markdown: string): string[] {
  const found = new Map<string, number>()
  const re = /\b(P\d{2,3})(?:_[A-Z0-9]+)*\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const base = m[1] ?? ''
    if (base !== '') found.set(base, (found.get(base) ?? 0) + 1)
  }
  return [...found.keys()].sort()
}

/* ---------------- palette spec → real swatch colors ---------------- */

const BASE_COLORS: Record<string, [number, number, number]> = {
  red: [4, 74, 50], crimson: [348, 74, 50], scarlet: [356, 78, 50], cherry: [345, 72, 52],
  pink: [330, 74, 62], magenta: [315, 76, 55], rose: [342, 72, 58], salmon: [12, 72, 60],
  coral: [16, 74, 60], peach: [20, 78, 66], apricot: [28, 80, 62], orange: [30, 86, 54],
  amber: [40, 88, 52], gold: [44, 84, 52], yellow: [50, 86, 54], lemon: [56, 84, 58],
  lime: [80, 70, 52], chartreuse: [86, 72, 52], olive: [70, 40, 34], forest: [140, 44, 30],
  green: [140, 52, 38], emerald: [152, 56, 40], jade: [160, 48, 42], mint: [162, 60, 62],
  teal: [172, 58, 40], turquoise: [176, 62, 50], aqua: [184, 60, 55], cyan: [186, 74, 52],
  lavender: [260, 40, 62], lilac: [270, 44, 64], violet: [272, 48, 54], plum: [290, 40, 44],
  purple: [282, 44, 50], mauve: [300, 34, 52], wine: [335, 48, 34], burgundy: [345, 52, 32],
  maroon: [0, 44, 30], brown: [24, 38, 30], chocolate: [18, 42, 26], coffee: [20, 40, 28],
  tan: [32, 42, 52], beige: [40, 38, 70], cream: [46, 60, 82], ivory: [48, 44, 88],
  white: [0, 0, 92], black: [0, 0, 8], charcoal: [0, 0, 18], slate: [210, 12, 34],
  steel: [200, 14, 42], silver: [0, 0, 70], pearl: [40, 30, 86], ash: [0, 0, 62],
  grey: [220, 4, 52], gray: [220, 4, 52], soft: [0, 0, 84],
}

function colorNameToHsl(name: string): string | null {
  const words = name.toLowerCase().split(/[\s-]+/).filter(Boolean)
  let base: [number, number, number] | null = null
  for (const w of words) {
    if (w in BASE_COLORS) {
      base = BASE_COLORS[w] ?? null
      break
    }
  }
  if (base == null) return null
  const [h, s, l] = base
  let ll = l
  let ss = s
  for (const w of words) {
    if (w === 'deep' || w === 'dark') ll = Math.max(7, ll - 16)
    if (w === 'pale' || w === 'pastel' || w === 'soft' || w === 'light') ll = Math.min(92, ll + 16)
    if (w === 'neon') {
      ss = 94
      ll = 62
    }
    if (w === 'dusty' || w === 'muted' || w === 'dust') ss = Math.max(12, ss - 22)
  }
  return `hsl(${h} ${ss}% ${ll}%)`
}

function fallbackColor(token: string): string {
  let h = 0
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 50% 46%)`
}

function specSwatches(p: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['dominant', 'secondary', 'accent1', 'accent2', 'shadow']) {
    for (const name of asArray(p[key]).map(asStr).filter((s) => s !== '')) {
      const hex = colorNameToHsl(name)
      if (hex != null && !out.includes(hex)) out.push(hex)
      if (out.length >= 5) return out
    }
  }
  return out
}

/* ---------------- framer variants (useful micro-motion only) ------- */

const staggerVars: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.028 } } }
const cellVars: Variants = { hidden: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1 } }

/* ================================================================== */
/* Atoms                                                               */
/* ================================================================== */

function TagChip({
  children,
  tone = 'zinc',
  className,
}: {
  children: React.ReactNode
  tone?: 'zinc' | 'ok' | 'warn' | 'err'
  className?: string
}) {
  return (
    <span
      className={cn(
        'font-mono text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap',
        tone === 'zinc' && 'border-zinc-700/70 bg-zinc-900/70 text-zinc-400',
        tone === 'ok' && 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
        tone === 'warn' && 'border-amber-800/60 bg-amber-950/30 text-amber-300',
        tone === 'err' && 'border-red-800/60 bg-red-950/30 text-red-300',
        className
      )}
    >
      {children}
    </span>
  )
}

function LedDot({ tone }: { tone: 'ok' | 'err' | 'warn' | 'zinc' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full shrink-0',
        tone === 'ok' && 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]',
        tone === 'err' && 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]',
        tone === 'warn' && 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.7)]',
        tone === 'zinc' && 'bg-zinc-600'
      )}
    />
  )
}

function ToastStack({ toasts, dismiss }: { toasts: ToastMsg[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(92vw,360px)]" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 32 }}
            transition={{ duration: 0.18 }}
            onClick={() => dismiss(t.id)}
            className={cn(
              'text-left rounded-md border px-3 py-2.5 backdrop-blur bg-zinc-950/95 shadow-lg cursor-pointer',
              t.kind === 'ok' && 'border-emerald-800/70',
              t.kind === 'err' && 'border-red-800/70',
              t.kind === 'info' && 'border-zinc-700'
            )}
          >
            <div
              className={cn(
                'font-mono text-[12px] font-semibold flex items-center gap-2',
                t.kind === 'ok' && 'text-emerald-300',
                t.kind === 'err' && 'text-red-300',
                t.kind === 'info' && 'text-zinc-200'
              )}
            >
              {t.kind === 'ok' ? <ShieldCheck size={13} /> : t.kind === 'err' ? <AlertTriangle size={13} /> : <CircleDot size={13} />}
              {t.title}
            </div>
            {t.body !== '' && <div className="font-mono text-[10.5px] text-zinc-400 mt-1 leading-snug break-words">{t.body}</div>}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Header                                                              */
/* ================================================================== */

function HeaderBar({
  stats,
  engineDown,
  verify,
  auditBroken,
  clock,
}: {
  stats: EngineState | null
  engineDown: boolean
  verify: VerifyData | null
  auditBroken: number
  clock: string
}) {
  const audit = engineDown
    ? { label: 'OFFLINE', tone: 'err' as const }
    : verify == null
      ? { label: 'UNVERIFIED', tone: 'zinc' as const }
      : verify.ok && auditBroken === 0
        ? { label: 'SEALED', tone: 'ok' as const }
        : { label: 'MISMATCH', tone: 'err' as const }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="max-w-[1500px] mx-auto px-3 sm:px-4 lg:px-6 h-14 flex items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-8 rounded border border-amber-700/60 bg-zinc-900 flex items-center justify-center text-amber-400 shrink-0">
            <Flame size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-wide text-zinc-100 leading-none truncate">
              THREAD 4 · PIPELINE CONSOLE
            </div>
            <div className="text-[10px] text-zinc-500 leading-none mt-1 truncate hidden sm:block">
              prompt-batch compiler · hash-chain chronicle · rotation window
            </div>
          </div>
        </div>

        <TagChip tone={engineDown ? 'warn' : 'ok'} className="hidden sm:inline-flex">
          [T4-Core: {engineDown ? 'DEGRADED' : 'ACTIVE'}]
        </TagChip>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span
            className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-400"
            title="t4-engine RPC :3200 (via /api/t4/engine proxy)"
          >
            <LedDot tone={engineDown ? 'err' : 'ok'} />
            <span className="hidden sm:inline">ENGINE</span>:{engineDown ? 'DOWN' : '3200'}
          </span>
          <span className="hidden md:flex items-center gap-1.5 font-mono text-[11px] text-zinc-400" title="chain.jsonl height">
            <Hash size={11} />
            {stats?.chain.height ?? '—'}
          </span>
          <span
            className="hidden lg:flex items-center gap-1.5 font-mono text-[11px]"
            title="hash-chain audit state (engine verify + browser re-check)"
          >
            <LedDot tone={audit.tone} />
            <span className={cn(audit.tone === 'ok' ? 'text-emerald-400' : audit.tone === 'err' ? 'text-red-400' : 'text-zinc-500')}>
              AUDIT {audit.label}
            </span>
          </span>
          <span className="hidden md:flex items-center gap-1.5 font-mono text-[11px] text-zinc-400" title="engine uptime">
            <Timer size={11} />
            {stats ? fmtUptime(stats.uptimeSec) : '--:--:--'}
          </span>
          <span className="font-mono text-[12px] text-zinc-300 tabular-nums" title="local time">
            {clock}
          </span>
        </div>
      </div>
    </header>
  )
}

/* ================================================================== */
/* Rotation Window — explicit 3-slot fatigue lock row                  */
/* ================================================================== */

function RotationWindow({
  cards,
  loading,
  nextSlug,
  onRefresh,
}: {
  cards: RotCard[]
  loading: boolean
  nextSlug: string
  onRefresh: () => void
}) {
  const union = useMemo(() => new Set(cards.flatMap((c) => c.palettes.map((p) => p.id))), [cards])
  const free = Math.max(0, PALETTE_FUND - union.size)

  return (
    <section aria-label="Rotation window" className="border border-zinc-800 bg-zinc-900/40 rounded-lg">
      <div className="p-3 border-b border-zinc-800 flex flex-wrap items-center gap-2">
        <Lock size={13} className="text-amber-400 shrink-0" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-zinc-100 leading-none">ROTATION WINDOW</div>
          <div className="text-[10px] text-zinc-500 mt-1">
            fatigue lock · last 3 delivered batches — these palettes are locked out of the pool
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-zinc-400">
          <span className="hidden sm:inline">
            FUND <b className="text-zinc-200 tabular-nums">{PALETTE_FUND}</b>
          </span>
          <span>
            ∪WIN <b className="text-amber-300 tabular-nums">{union.size}</b>
          </span>
          <span>
            FREE <b className="text-emerald-300 tabular-nums">{free}</b>
          </span>
          {nextSlug !== '' && <span className="hidden md:inline text-zinc-600">next {nextSlug}</span>}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="reload rotation window from engine"
            aria-label="reload rotation window"
            className="p-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-2">
        {[0, 1, 2].map((i) => {
          const card = cards[i]
          if (card == null) {
            return (
              <div key={`empty-${i}`} className="rounded border border-dashed border-zinc-800 bg-zinc-950/30 p-2 min-w-0">
                <div className="font-mono text-[9px] text-zinc-600">SLOT {i + 1}</div>
                <div className="text-[10px] text-zinc-600 mt-1">{loading ? 'loading…' : 'awaiting delivery'}</div>
              </div>
            )
          }
          return (
            <motion.div
              key={card.slug}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              className="rounded border bg-zinc-900/60 p-2 min-w-0"
            >
              <div className="flex items-center gap-1 mb-1 min-w-0">
                {i === 0 ? (
                  <span className="font-mono text-[9px] px-1 py-px rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 whitespace-nowrap">
                    SLOT 1 · ACTIVE
                  </span>
                ) : (
                  <span className="font-mono text-[9px] px-1 py-px rounded bg-zinc-800/60 text-zinc-400 border border-zinc-700/60">
                    SLOT {i + 1}
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-zinc-200 truncate" title={`${card.slug} «${card.title}»`}>
                {card.slug} <span className="text-zinc-500">«{card.title}»</span>
              </div>
              <div className="font-mono text-[9px] text-zinc-600 mt-0.5">
                {fmtDay(card.deliveredAt)} · {card.palettes.length} palettes locked
              </div>
              <div className="flex flex-wrap gap-0.5 mt-1.5 min-h-[14px]">
                {card.palettes.slice(0, 10).map((p) => (
                  <span
                    key={p.id}
                    title={`${p.id} — ${p.name}`}
                    className="size-3.5 rounded-sm border border-zinc-700/80"
                    style={{ background: p.colors[0] ?? '#52525b' }}
                  />
                ))}
                {card.palettes.length > 10 && <span className="text-[9px] text-zinc-500 self-center">+{card.palettes.length - 10}</span>}
                {card.palettes.length === 0 && <span className="text-[9px] text-zinc-600">no palette data</span>}
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

/* ================================================================== */
/* Control panel — BURN & REBUILD / FORCE COMPILE / PURGE HEAP         */
/* ================================================================== */

function SectionHead({
  icon,
  title,
  sub,
  right,
}: {
  icon: React.ReactNode
  title: string
  sub: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      {icon}
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-zinc-100 leading-none tracking-wide">{title}</div>
        <div className="text-[10px] text-zinc-500 mt-0.5 leading-none">{sub}</div>
      </div>
      {right != null && <div className="ml-auto">{right}</div>}
    </div>
  )
}

function BurnSection({
  burn,
  engineDown,
  onBurn,
  reduce,
}: {
  burn: BurnState
  engineDown: boolean
  onBurn: () => void
  reduce: boolean
}) {
  const pct = burn.total > 0 ? Math.round((burn.done / burn.total) * 100) : 0
  const running = burn.phase === 'running'
  return (
    <div className="p-3">
      <SectionHead
        icon={<Flame size={14} className="text-amber-400" />}
        title="BURN & REBUILD"
        sub="full chain re-audit · genesis → head"
        right={<TagChip tone={engineDown ? 'err' : 'zinc'}>{engineDown ? 'ENGINE OFFLINE' : 'READ-ONLY'}</TagChip>}
      />
      <motion.button
        whileTap={reduce || running ? undefined : { scale: 0.98 }}
        onClick={onBurn}
        disabled={engineDown || running}
        aria-label="Burn and rebuild — re-audit the whole hash chain"
        className={cn(
          'relative w-full h-16 rounded-lg border-2 font-mono font-bold tracking-[0.14em] text-[15px] overflow-hidden select-none',
          'flex items-center justify-center gap-3 transition-all duration-150',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400',
          running
            ? 'border-amber-500/70 bg-amber-950/30 text-amber-300 cursor-progress'
            : engineDown
              ? 'border-zinc-800 bg-zinc-900/50 text-zinc-600 cursor-not-allowed'
              : 'border-amber-600/70 bg-zinc-900 text-amber-300 hover:border-amber-400 hover:bg-amber-950/20 hover:shadow-[0_0_22px_rgba(245,158,11,0.18)] active:bg-amber-900/30'
        )}
      >
        {running ? (
          <>
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500/15 border-r border-emerald-500/40 transition-[width] duration-100"
              style={{ width: `${pct}%` }}
              aria-hidden
            />
            <Loader2 size={16} className="animate-spin relative shrink-0" />
            <span className="relative tabular-nums">
              RE-AUDITING {burn.done}/{burn.total || '…'}
            </span>
          </>
        ) : (
          <>
            <Flame size={18} className="shrink-0" />
            BURN & REBUILD
            <span className="absolute right-3 text-[9px] font-normal tracking-normal text-zinc-500">
              {engineDown ? 'ENGINE OFFLINE' : 'READY · 1 CLICK'}
            </span>
          </>
        )}
      </motion.button>
      <p className="text-[10px] text-zinc-500 mt-1.5 leading-snug">
        Recomputes every <span className="text-zinc-400">prev→hash</span> link of chain.jsonl in the browser (watch the amber sweep in
        the chronicle below), then cross-checks the engine authority{' '}
        <span className="font-mono text-zinc-400">/v1/chain/verify</span>. Canon-safe: audit only — the author&rsquo;s chronicle is
        never rewritten.
      </p>

      <AnimatePresence>
        {burn.phase === 'done' && burn.result != null && (
          <motion.div
            key={burn.result.text}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'mt-2 font-mono text-[11px] px-3 py-2 rounded border flex items-start gap-2 leading-snug',
              burn.result.ok
                ? 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300'
                : 'border-red-800/60 bg-red-950/20 text-red-300'
            )}
            role="alert"
          >
            {burn.result.ok ? (
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            ) : (
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            )}
            <span className="break-words">{burn.result.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function KeyChipView({ state }: { state: KeyChip }) {
  const map: Record<KeyChip, { cls: string; text: string }> = {
    checking: { cls: 'text-zinc-500', text: 'CHECKING…' },
    ok: { cls: 'text-emerald-400', text: 'KEY OK — mutations armed' },
    mismatch: { cls: 'text-red-400', text: 'KEY MISMATCH — mutations will 403' },
    noserver: { cls: 'text-amber-400', text: 'SERVER KEY ABSENT — mutations locked' },
    nokey: { cls: 'text-zinc-500', text: 'NO KEY — compile will be refused' },
  }
  const v = map[state]
  return (
    <span className={cn('font-mono text-[10px] flex items-center gap-1.5', v.cls)}>
      {state === 'checking' ? <Loader2 size={10} className="animate-spin" /> : <KeyRound size={10} />}
      {v.text}
    </span>
  )
}

const BANNER_CLS: Record<BannerKind, string> = {
  clean: 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300',
  drift: 'border-amber-800/60 bg-amber-950/20 text-amber-300',
  void: 'border-red-800/60 bg-red-950/20 text-red-300',
  locked: 'border-red-800/60 bg-red-950/20 text-red-300',
  error: 'border-red-800/60 bg-red-950/20 text-red-300',
}

function CompileSection({
  themeInput,
  setThemeInput,
  ocInputs,
  setOcInput,
  keyInput,
  setKeyInput,
  keyReveal,
  setKeyReveal,
  keyChip,
  onSaveKey,
  onClearKey,
  compiling,
  onCompile,
  banner,
  formError,
  shakeTick,
  reduce,
}: {
  themeInput: string
  setThemeInput: (v: string) => void
  ocInputs: string[]
  setOcInput: (i: number, v: string) => void
  keyInput: string
  setKeyInput: (v: string) => void
  keyReveal: boolean
  setKeyReveal: (v: boolean) => void
  keyChip: KeyChip
  onSaveKey: () => void
  onClearKey: () => void
  compiling: boolean
  onCompile: () => void
  banner: Banner | null
  formError: string
  shakeTick: number
  reduce: boolean
}) {
  return (
    <div className="p-3 border-t border-zinc-800">
      <SectionHead
        icon={<Zap size={14} className="text-amber-400" />}
        title="FORCE COMPILE"
        sub="real POST /v1/compile · Zod strict · idempotent"
        right={<TagChip tone={compiling ? 'warn' : 'zinc'}>{compiling ? 'RUNNING' : 'ARMED'}</TagChip>}
      />

      <label className="block mb-1 font-mono text-[10px] text-zinc-500" htmlFor="t4-theme">
        THEME (1–120 chars, required)
      </label>
      <Input
        id="t4-theme"
        value={themeInput}
        onChange={(e) => setThemeInput(e.target.value)}
        placeholder="e.g. NEON REQUIEM"
        maxLength={120}
        className="h-9 font-mono text-[12px] mb-2 bg-zinc-950 border-zinc-700"
      />

      <label className="block mb-1 font-mono text-[10px] text-zinc-500">OC SLOT THEMES (min 1, cycles to 3 slots)</label>
      <div className="flex flex-col gap-1.5 mb-2">
        {ocInputs.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 w-9 shrink-0 text-right">OC·{i + 1}</span>
            <Input
              value={v}
              onChange={(e) => setOcInput(i, e.target.value)}
              placeholder={i === 0 ? 'required — e.g. Neon Shrine Maiden' : 'optional'}
              maxLength={120}
              aria-label={`OC slot ${i + 1} theme`}
              className="h-8 font-mono text-[12px] bg-zinc-950 border-zinc-700"
            />
          </div>
        ))}
      </div>

      <label className="block mb-1 font-mono text-[10px] text-zinc-500" htmlFor="t4-key">
        COMMANDER KEY (localStorage only · sent as x-commander-key)
      </label>
      <div className="flex gap-1.5 mb-1">
        <div className="relative flex-1 min-w-0">
          <Input
            id="t4-key"
            type={keyReveal ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="~/.t4/commander.key value"
            autoComplete="off"
            className="h-8 font-mono text-[12px] pr-8 bg-zinc-950 border-zinc-700"
          />
          <button
            type="button"
            onClick={() => setKeyReveal(!keyReveal)}
            aria-label={keyReveal ? 'hide key' : 'reveal key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {keyReveal ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onSaveKey}
          className="h-8 px-2.5 font-mono text-[11px] border-zinc-700 bg-zinc-950 hover:border-emerald-600/60 hover:text-emerald-300"
        >
          SAVE
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearKey} className="h-8 px-2.5 font-mono text-[11px] text-zinc-500 hover:text-red-300">
          CLR
        </Button>
      </div>
      <div className="mb-2.5">
        <KeyChipView state={keyChip} />
      </div>

      <motion.div
        key={`compile-btn-${shakeTick}`}
        animate={shakeTick > 0 && !reduce ? { x: [0, -6, 6, -3, 3, 0] } : undefined}
        transition={{ duration: 0.35 }}
        whileTap={reduce || compiling ? undefined : { scale: 0.98 }}
      >
        <Button
          onClick={onCompile}
          disabled={compiling}
          className={cn(
            'w-full h-11 font-mono text-[13px] font-semibold tracking-wider border-2',
            compiling
              ? 'border-amber-700/60 bg-amber-950/30 text-amber-300'
              : 'border-amber-600/60 bg-zinc-900 text-amber-300 hover:border-amber-400 hover:bg-amber-950/20 hover:shadow-[0_0_18px_rgba(245,158,11,0.15)]'
          )}
          aria-label="Force compile the next batch"
        >
          {compiling ? (
            <>
              <Loader2 size={14} className="animate-spin" /> COMPILING…
            </>
          ) : (
            <>
              <Zap size={14} /> FORCE COMPILE
            </>
          )}
        </Button>
      </motion.div>

      {formError !== '' && (
        <p className="mt-1.5 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={11} /> {formError}
        </p>
      )}

      <AnimatePresence mode="wait">
        {banner != null && (
          <motion.div
            key={banner.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('mt-2.5 rounded border px-3 py-2.5', BANNER_CLS[banner.kind])}
            role="alert"
          >
            <div className="font-mono text-[12px] font-bold tracking-wider">{banner.title}</div>
            <div className="font-mono text-[10.5px] text-zinc-400 mt-1 leading-snug break-words">{banner.detail}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PurgeSection({
  onPurge,
  bufferCount,
  purgeFlash,
  busy,
}: {
  onPurge: () => void
  bufferCount: number
  purgeFlash: number | null
  busy: boolean
}) {
  return (
    <div className="p-3 border-t border-zinc-800">
      <SectionHead
        icon={<Trash2 size={14} className="text-red-400" />}
        title="PURGE HEAP"
        sub="flush local chronicle buffer · re-seed tail"
        right={<TagChip>{busy ? 'BUSY' : 'INSTANT'}</TagChip>}
      />
      <div className="flex items-center gap-3">
        <motion.div whileTap={{ scale: 0.96 }} className="flex-1 min-w-0">
          <Button
            onClick={onPurge}
            disabled={busy}
            variant="outline"
            className="w-full h-10 font-mono text-[12px] tracking-wider border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-red-500/60 hover:text-red-300 hover:bg-red-950/20"
            aria-label="Purge the local heap buffer"
          >
            <Trash2 size={13} /> PURGE HEAP
          </Button>
        </motion.div>
        <div className="text-right font-mono text-[10px] text-zinc-500 leading-tight shrink-0">
          <div>
            BUFFER <span className="tabular-nums text-zinc-300">{bufferCount}</span>/{MAX_ROWS}
          </div>
          <AnimatePresence>
            {purgeFlash != null && (
              <motion.div
                key={purgeFlash}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-red-400 tabular-nums"
              >
                −{purgeFlash} lines
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* System snapshot                                                     */
/* ================================================================== */

function StatCell({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="bg-zinc-900/50 px-2.5 py-2 min-w-0" title={title ?? label}>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500 leading-none">{label}</div>
      <div className="font-mono text-[12px] text-zinc-200 mt-1 truncate tabular-nums" title={value}>
        {value}
      </div>
    </div>
  )
}

function SystemPanel({ stats, engineDown }: { stats: EngineState | null; engineDown: boolean }) {
  return (
    <section aria-label="System snapshot" className="border border-zinc-800 bg-zinc-900/40 rounded-lg overflow-hidden">
      <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
        <Database size={13} className="text-zinc-400" />
        <div>
          <div className="text-[12px] font-semibold text-zinc-100 leading-none">SYSTEM</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">engine state · GET /v1/state</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
          <LedDot tone={engineDown ? 'err' : 'ok'} />
          {engineDown ? 'DEGRADED' : 'NOMINAL'}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-zinc-800/70">
        <StatCell label="Era" value={stats?.era ?? '—'} />
        <StatCell label="Canon / FAM" value={stats ? `${stats.canon} / ${stats.fam}` : '—'} />
        <StatCell label="Next slug" value={stats?.nextSlug ?? '—'} />
        <StatCell
          label="Last delivered"
          value={stats?.lastDelivered ? stats.lastDelivered.slug : '—'}
          title={stats?.lastDelivered ? `${stats.lastDelivered.slug} «${stats.lastDelivered.title}»` : '—'}
        />
        <StatCell label="Batches delivered" value={String(stats?.counts.batchesDelivered ?? '—')} />
        <StatCell label="Verdicts" value={String(stats?.counts.verdicts ?? '—')} />
        <StatCell label="DB" value={stats ? `${stats.db.file} · ${fmtKb(stats.db.bytes)}` : '—'} />
        <StatCell label="Uptime" value={stats ? fmtUptime(stats.uptimeSec) : '—'} />
      </div>
      <div className="px-2.5 py-1.5 border-t border-zinc-800/70 font-mono text-[9.5px] text-zinc-600 truncate">
        HEAD <span className="text-zinc-500">{stats ? h8(stats.chain.head) : '········'}</span> · events{' '}
        <span className="text-zinc-500 tabular-nums">{stats?.counts.events ?? '—'}</span>
      </div>
    </section>
  )
}

/* ================================================================== */
/* Gate matrix — 24 slots + EXP + planning gate receipts               */
/* ================================================================== */

function kindAbbr(kind: string): string {
  switch (kind) {
    case 'OC':
      return 'OC'
    case 'VOLT':
      return 'VLT'
    case 'NICHE':
      return 'NCH'
    case 'EXQUISITE':
      return 'EXQ'
    case 'MAIN':
      return 'MN'
    default:
      return kind.slice(0, 2).toUpperCase()
  }
}

const CELL_CLS: Record<CellStatus, string> = {
  standby: 'border-zinc-800 bg-zinc-950/40 text-zinc-600',
  assigned: 'border-zinc-700 bg-zinc-900/70 text-zinc-300',
  cycling: 'border-amber-700/70 bg-amber-950/25 text-amber-300',
  sealed: 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300',
  void: 'border-red-900/60 bg-red-950/25 text-red-300/80',
}

function GateCell({ cell, label }: { cell: GateCellData; label: string }) {
  return (
    <motion.div
      variants={cellVars}
      title={`#${cell.pos} · ${cell.kind} · ${cell.rating} · ${cell.register}${cell.paletteId !== '' ? ` · ${cell.paletteId}` : ''}`}
      className={cn('h-8 rounded border flex items-center justify-center gap-1 font-mono text-[10px] min-w-0', CELL_CLS[cell.status])}
    >
      <span className="text-[9px] opacity-50">{label}</span>
      <span className="truncate">{kindAbbr(cell.kind)}</span>
    </motion.div>
  )
}

function VerdictChip({ verdict }: { verdict: string }) {
  const cls =
    verdict === 'PASS'
      ? 'text-emerald-400 border-emerald-800/60 bg-emerald-950/30'
      : verdict === 'WARN'
        ? 'text-amber-400 border-amber-800/60 bg-amber-950/30'
        : 'text-red-400 border-red-800/60 bg-red-950/30'
  return <span className={cn('font-mono text-[9px] px-1.5 py-px rounded border shrink-0', cls)}>{verdict}</span>
}

function GateMatrix({
  cells,
  expCells,
  gates,
  planSource,
  reduce,
}: {
  cells: GateCellData[]
  expCells: GateCellData[]
  gates: Receipt[]
  planSource: string
  reduce: boolean
}) {
  const filled: GateCellData[] = [...cells]
  for (let p = cells.length + 1; p <= 24; p++) {
    filled.push({ pos: p, kind: 'MAIN', rating: '—', register: '—', paletteId: '', status: 'standby' })
  }
  const hardFail = gates.some((g) => g.verdict === 'FAIL')
  const warn = gates.some((g) => g.verdict === 'WARN')

  return (
    <section aria-label="Gate matrix" className="border border-zinc-800 bg-zinc-900/40 rounded-lg">
      <div className="p-3 border-b border-zinc-800 flex flex-wrap items-center gap-2">
        <Layers size={13} className="text-zinc-400" />
        <div>
          <div className="text-[12px] font-semibold text-zinc-100 leading-none">GATE MATRIX</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">slot plan · planning-gate receipts</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {gates.length > 0 &&
            (hardFail ? <TagChip tone="err">VOID</TagChip> : warn ? <TagChip tone="warn">DRIFT</TagChip> : <TagChip tone="ok">CLEAN</TagChip>)}
          <TagChip>{planSource === '' ? 'NO PLAN' : planSource}</TagChip>
        </div>
      </div>

      <div className="p-3 border-b border-zinc-800/70">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1.5 font-mono">24 core slots</div>
        <motion.div
          key={`core-${planSource}`}
          variants={staggerVars}
          initial={reduce ? false : 'hidden'}
          animate="show"
          className="grid grid-cols-8 gap-1"
        >
          {filled.map((c) => (
            <GateCell key={c.pos} cell={c} label={String(c.pos)} />
          ))}
        </motion.div>
        {expCells.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1.5 font-mono">
              EXP overlay · {expCells.length} slots
            </div>
            <motion.div
              key={`exp-${planSource}`}
              variants={staggerVars}
              initial={reduce ? false : 'hidden'}
              animate="show"
              className="grid grid-cols-8 gap-1"
            >
              {expCells.map((c) => (
                <GateCell key={c.pos} cell={c} label={`E${c.pos - 24}`} />
              ))}
            </motion.div>
          </div>
        )}
      </div>

      <div className="p-3">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1 font-mono">planning gates</div>
        {gates.length === 0 ? (
          <p className="font-mono text-[10.5px] text-zinc-600">no gate run in the plan yet — compile to fill receipts</p>
        ) : (
          <motion.ul key={`gates-${planSource}`} variants={staggerVars} initial={reduce ? false : 'hidden'} animate="show" className="flex flex-col">
            {gates.map((g) => (
              <motion.li
                key={`${g.gate}-${g.verdict}`}
                variants={cellVars}
                className="flex items-center gap-2 py-1 border-b border-zinc-900 last:border-0 min-w-0"
              >
                <span className="font-mono text-[11px] text-zinc-300 w-32 truncate shrink-0" title={g.gate}>
                  {g.gate}
                </span>
                <span className="font-mono text-[9px] text-zinc-600 w-14 shrink-0 uppercase">{g.level}</span>
                <VerdictChip verdict={g.verdict} />
                {g.findings[0] != null && (
                  <span className="text-[10px] text-zinc-500 truncate flex-1 min-w-0" title={g.findings.join('\n')}>
                    {g.findings[0]}
                  </span>
                )}
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800/70 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-zinc-600 font-mono">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm border border-emerald-800/70 bg-emerald-950/40" /> sealed
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm border border-red-900/60 bg-red-950/30" /> void
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm border border-amber-700/70 bg-amber-950/30" /> in-flight
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm border border-zinc-700 bg-zinc-900/70" /> assigned
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm border border-zinc-800 bg-zinc-950/50" /> standby
        </span>
      </div>
    </section>
  )
}

/* ================================================================== */
/* Chronicle & hash-chain — the log table                              */
/* ================================================================== */

const ChronicleRow = memo(function ChronicleRow({
  row,
  animateIn,
  sweep,
}: {
  row: Row
  animateIn: boolean
  sweep: boolean
}) {
  const broken = row.level === 'chain' && !row.linkOk
  const cls = cn(
    ROW_GRID,
    'px-3 py-[5px] text-[12px] font-mono border-b border-zinc-900/80 transition-colors',
    row.level === 'sys' ? 'bg-zinc-950/50' : 'bg-transparent',
    broken && 'bg-red-950/40',
    sweep && 't4-row-sweep'
  )

  const body = (
    <>
      <span className="flex items-center justify-center">
        {row.level === 'sys' ? (
          <Radio size={11} className="text-zinc-600" />
        ) : broken ? (
          <X size={13} className="text-red-400 t4-link-broken" aria-label="hash-chain link broken" />
        ) : (
          <Check size={13} className="text-emerald-500/90" aria-label="link verified" />
        )}
      </span>
      <span className="text-zinc-500 tabular-nums">{row.seq ?? '—'}</span>
      <span className="text-zinc-600 tabular-nums text-[11px]">{fmtTime(row.at)}</span>
      <span
        className={cn(
          'text-[11px] truncate',
          row.tone === 'ok' && 'text-emerald-400',
          row.tone === 'warn' && 'text-amber-400',
          row.tone === 'err' && 'text-red-400',
          row.tone === 'info' && 'text-zinc-500'
        )}
      >
        {row.type}
      </span>
      <span className="truncate text-zinc-300" title={row.summary}>
        {row.summary}
      </span>
      <span className="hidden md:block text-zinc-600 text-[11px] truncate" title={`hash ${row.hash}\nprev ${row.prev}`}>
        {row.level === 'chain' ? `${h8(row.hash)}·${h8(row.prev)}` : '—'}
      </span>
    </>
  )

  if (animateIn) {
    return (
      <motion.div initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className={cls}>
        {body}
      </motion.div>
    )
  }
  return <div className={cls}>{body}</div>
})

function ChroniclePanel({
  rows,
  engineDown,
  pollOn,
  onTogglePoll,
  stats,
  verify,
  booted,
  burnPhase,
  burnDone,
  freshKeys,
  reduce,
}: {
  rows: Row[]
  engineDown: boolean
  pollOn: boolean
  onTogglePoll: () => void
  stats: EngineState | null
  verify: VerifyData | null
  booted: boolean
  burnPhase: BurnState['phase']
  burnDone: number
  freshKeys: Set<string>
  reduce: boolean
}) {
  const [filter, setFilter] = useState<'all' | 'chain' | 'sys'>('all')
  const [follow, setFollow] = useState(true)
  const followRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const visible = useMemo(() => rows.filter((r) => filter === 'all' || r.level === filter), [rows, filter])

  useEffect(() => {
    const el = scrollRef.current
    if (el != null && followRef.current) el.scrollTop = el.scrollHeight
  }, [rows])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el == null) return
    const away = el.scrollHeight - el.scrollTop - el.clientHeight
    if (away > 80 && followRef.current) {
      followRef.current = false
      setFollow(false)
    }
  }, [])

  const resume = useCallback(() => {
    followRef.current = true
    setFollow(true)
    const el = scrollRef.current
    if (el != null) el.scrollTo({ top: el.scrollHeight })
  }, [])

  const brokenCount = useMemo(() => rows.filter((r) => r.level === 'chain' && !r.linkOk).length, [rows])

  const filterChip = (key: 'all' | 'chain' | 'sys', label: string) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={cn(
        'font-mono text-[10px] px-2 py-1 rounded border transition-colors',
        filter === key
          ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
          : 'border-zinc-800 bg-zinc-950/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
      )}
      aria-pressed={filter === key}
    >
      {label}
    </button>
  )

  return (
    <section
      aria-label="Chronicle and hash chain"
      className="border border-zinc-800 bg-zinc-900/40 rounded-lg flex flex-col lg:sticky lg:top-[72px] min-w-0"
    >
      {/* toolbar */}
      <div className="p-3 border-b border-zinc-800 flex flex-wrap items-center gap-2">
        <TerminalIcon size={14} className={cn(engineDown ? 'text-red-400' : 'text-emerald-400')} />
        <div className="min-w-0 mr-2">
          <div className="text-[13px] font-semibold text-zinc-100 leading-none">CHRONICLE & HASH-CHAIN</div>
          <div className="text-[10px] text-zinc-500 mt-1 font-mono">
            chain.jsonl · live poll 2.5s · browser-side prev→hash validation per link
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onTogglePoll}
            title={pollOn ? 'pause the live stream' : 'resume the live stream'}
            className={cn(
              'flex items-center gap-1.5 font-mono text-[10px] px-2 py-1 rounded border transition-colors',
              engineDown
                ? 'border-red-900/70 bg-red-950/30 text-red-300'
                : pollOn
                  ? 'border-emerald-900/70 bg-emerald-950/30 text-emerald-300 hover:border-emerald-700'
                  : 'border-amber-900/70 bg-amber-950/30 text-amber-300 hover:border-amber-700'
            )}
            aria-pressed={pollOn}
          >
            {pollOn ? <Pause size={11} /> : <Play size={11} />}
            {engineDown ? 'OFFLINE' : pollOn ? 'LIVE' : 'PAUSED'}
          </button>
          {filterChip('all', 'ALL')}
          {filterChip('chain', 'CHAIN')}
          {filterChip('sys', 'SYS')}
        </div>
      </div>

      {/* table head */}
      <div
        className={cn(
          ROW_GRID,
          'px-3 py-1.5 text-[9.5px] uppercase tracking-wider text-zinc-500 font-mono bg-zinc-900/80 border-b border-zinc-800'
        )}
      >
        <span className="text-center" title="link validation: prev[i] === hash[i-1]">
          ✓
        </span>
        <span>#</span>
        <span>TIME</span>
        <span>TYPE</span>
        <span>EVENT</span>
        <span className="hidden md:block">HASH·PREV</span>
      </div>

      {/* rows */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="t4-scroll overflow-y-auto h-[62vh] min-h-[360px] font-mono"
          role="log"
          aria-live="polite"
          aria-label="chain.jsonl event stream"
        >
          {visible.map((row) => (
            <ChronicleRow
              key={row.key}
              row={row}
              animateIn={!reduce && freshKeys.has(row.key)}
              sweep={burnPhase === 'running' && row.seq != null && row.seq <= burnDone}
            />
          ))}
          {visible.length === 0 && (
            <div className="p-6 text-center font-mono text-[11px] text-zinc-600">
              {booted ? 'stream cold — no events match the filter' : 'linking t4-engine…'}
            </div>
          )}
        </div>

        <AnimatePresence>
          {!follow && (
            <motion.button
              key="resume"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={resume}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1.5 rounded border border-amber-800/70 bg-zinc-950/95 text-amber-300 hover:border-amber-500 shadow-lg"
            >
              <ArrowDown size={11} /> FOLLOW LIVE
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* status line */}
      <div className="px-3 py-2 border-t border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <LedDot tone={engineDown ? 'err' : 'ok'} />
          <span className="tabular-nums text-zinc-400">{stats?.chain.height ?? '—'}</span> links
        </span>
        <span>
          local{' '}
          <span className={brokenCount === 0 ? 'text-emerald-400' : 'text-red-400'}>
            {brokenCount === 0 ? 'CLEAN' : `BROKEN ×${brokenCount}`}
          </span>
        </span>
        <span>
          engine{' '}
          <span className={verify == null ? 'text-zinc-500' : verify.ok ? 'text-emerald-400' : 'text-red-400'}>
            {verify == null ? '—' : verify.ok ? 'SEALED' : `PROBLEMS ×${verify.problems.length}`}
          </span>
        </span>
        <span className="ml-auto tabular-nums">
          buffer {rows.length}/{MAX_ROWS}
        </span>
      </div>
    </section>
  )
}

/* ================================================================== */
/* Footer                                                              */
/* ================================================================== */

function FooterBar({ stats }: { stats: EngineState | null }) {
  return (
    <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
      <div className="max-w-[1500px] mx-auto px-3 sm:px-4 lg:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-zinc-600">
        <span>
          THREAD 4 · canon <span className="text-zinc-500">{stats?.canon ?? '—'}</span>
        </span>
        <span className="hidden sm:inline">engine :3200 via /api/t4/engine</span>
        <span className="hidden md:inline">burn = read-only audit (canon never rewritten)</span>
        <span className="ml-auto flex items-center gap-1.5 text-zinc-600">
          <CircleDot size={10} /> [OP: TSUBAKI · gate watch]
        </span>
      </div>
    </footer>
  )
}

/* ================================================================== */
/* Page — state, loaders, pollers, actions                             */
/* ================================================================== */

export default function PipelineConsolePage() {
  const reduce = useReducedMotion() ?? false

  const [stats, setStats] = useState<EngineState | null>(null)
  const [verify, setVerify] = useState<VerifyData | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [engineDown, setEngineDown] = useState(false)
  const [booted, setBooted] = useState(false)
  const [pollOn, setPollOn] = useState(true)
  const [clock, setClock] = useState('--:--:--')

  const [burn, setBurn] = useState<BurnState>({ phase: 'idle', done: 0, total: 0, result: null })

  const [themeInput, setThemeInput] = useState('')
  const [ocInputs, setOcInputs] = useState<string[]>(['', '', ''])
  const [compiling, setCompiling] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [formError, setFormError] = useState('')
  const [shakeTick, setShakeTick] = useState(0)

  const [keyInput, setKeyInput] = useState('')
  const [keyReveal, setKeyReveal] = useState(false)
  const [keyChip, setKeyChip] = useState<KeyChip>('nokey')

  const [purgeFlash, setPurgeFlash] = useState<number | null>(null)

  const [rotation, setRotation] = useState<RotCard[]>([])
  const [rotationLoading, setRotationLoading] = useState(true)

  const [cells, setCells] = useState<GateCellData[]>([])
  const [expCells, setExpCells] = useState<GateCellData[]>([])
  const [gates, setGates] = useState<Receipt[]>([])
  const [planSource, setPlanSource] = useState('')

  const [toasts, setToasts] = useState<ToastMsg[]>([])

  const lastSeqRef = useRef(0)
  const lastHashRef = useRef('')
  const busyRef = useRef(false)
  const sysIdRef = useRef(0)
  const toastIdRef = useRef(0)
  const freshKeysRef = useRef<Set<string>>(new Set())
  const paletteMapRef = useRef<Record<string, { name: string; colors: string[] }>>({})

  const busy = burn.phase === 'running' || compiling

  /* ---------------- toasts & sys lines ---------------- */

  const pushToast = useCallback((kind: ToastMsg['kind'], title: string, body: string) => {
    toastIdRef.current += 1
    const id = toastIdRef.current
    setToasts((t) => [...t, { id, kind, title, body }].slice(-4))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const pushSys = useCallback((summary: string, tone: RowTone = 'info') => {
    sysIdRef.current += 1
    const id = sysIdRef.current
    const row: Row = {
      key: `sys-${id}`,
      level: 'sys',
      seq: null,
      at: new Date().toISOString(),
      type: 'SYS',
      summary,
      hash: '',
      prev: '',
      linkOk: true,
      tone,
    }
    freshKeysRef.current.add(row.key)
    setTimeout(() => freshKeysRef.current.delete(row.key), 1400)
    setRows((prev) => [...prev, row].slice(-MAX_ROWS))
  }, [])

  /* ---------------- loaders ---------------- */

  const loadChainBoot = useCallback(async () => {
    try {
      const r = await fetchJson<Envelope<EventsData>>('/api/t4/engine/events?after=0&limit=1000')
      const evs = (r.data.events ?? []).filter(isChainEvent)
      if (evs.length === 0) {
        pushSys('chronicle empty — no links in the stream', 'warn')
        return
      }
      const built = evs.map((e, i) => toRow(e, i === 0 || e.prev === evs[i - 1]?.hash))
      lastSeqRef.current = evs[evs.length - 1]?.seq ?? 0
      lastHashRef.current = evs[evs.length - 1]?.hash ?? ''
      const tail = built.slice(-140)
      for (const row of tail) freshKeysRef.current.add(row.key)
      setTimeout(() => {
        for (const row of tail) freshKeysRef.current.delete(row.key)
      }, 1400)
      setRows(tail)
      const broken = built.filter((r) => !r.linkOk).length
      pushSys(
        `chronicle synced · ${evs.length} links · local prev→hash check ${broken === 0 ? 'CLEAN' : `BROKEN ×${broken}`}`,
        broken === 0 ? 'ok' : 'err'
      )
    } catch {
      pushSys('chronicle fetch failed — chain.jsonl stream cold', 'err')
    }
  }, [pushSys])

  const pollEvents = useCallback(async () => {
    if (lastSeqRef.current === 0) {
      await loadChainBoot()
      return
    }
    try {
      const r = await fetchJson<Envelope<EventsData>>(`/api/t4/engine/events?after=${lastSeqRef.current}&limit=60`)
      const evs = (r.data.events ?? []).filter(isChainEvent)
      if (evs.length > 0) {
        const prevHash = lastHashRef.current
        const built = evs.map((e, i) => toRow(e, i === 0 ? e.prev === prevHash : e.prev === evs[i - 1]?.hash))
        lastSeqRef.current = evs[evs.length - 1]?.seq ?? lastSeqRef.current
        lastHashRef.current = evs[evs.length - 1]?.hash ?? lastHashRef.current
        for (const row of built) freshKeysRef.current.add(row.key)
        setTimeout(() => {
          for (const row of built) freshKeysRef.current.delete(row.key)
        }, 1400)
        setRows((prev) => [...prev, ...built].slice(-MAX_ROWS))
        const brokenSeqs = built.filter((r) => !r.linkOk).map((r) => r.seq)
        if (brokenSeqs.length > 0) {
          pushSys(`LINK MISMATCH ▸ seq ${brokenSeqs.join(', ')} — hash-chain broken`, 'err')
        }
      }
      setEngineDown(false)
    } catch {
      setEngineDown(true)
    }
  }, [loadChainBoot, pushSys])

  const pollState = useCallback(async () => {
    try {
      const st = await fetchJson<Envelope<EngineState>>('/api/t4/engine/state')
      setStats(st.data)
      setEngineDown(false)
    } catch {
      setEngineDown(true)
    }
    try {
      const v = await fetchJson<Envelope<VerifyData>>('/api/t4/engine/chain/verify')
      setVerify(v.data)
    } catch {
      /* keep the last authoritative verdict */
    }
  }, [])

  const loadPalettes = useCallback(async () => {
    try {
      const p = await fetchJson<{ palettes?: unknown[] }>('/api/t4/specs/palettes')
      const map: Record<string, { name: string; colors: string[] }> = {}
      for (const raw of asArray(p.palettes)) {
        const rec = asRecord(raw)
        const id = asStr(rec.id)
        if (id === '') continue
        const base = id.split('_')[0] ?? id
        map[base] = { name: asStr(rec.name) || base, colors: specSwatches(rec) }
      }
      paletteMapRef.current = map
    } catch {
      /* swatches fall back to deterministic hues */
    }
  }, [])

  const loadRotation = useCallback(async () => {
    setRotationLoading(true)
    try {
      const b = await fetchJson<Envelope<{ batches: BatchRow[] }>>('/api/t4/engine/batches?limit=20')
      const delivered = (b.data.batches ?? [])
        .filter((x) => x.status === 'delivered' && x.deliveredAt != null)
        .slice(0, 3)
      const cards: RotCard[] = []
      for (let idx = 0; idx < delivered.length; idx++) {
        const batchRow = delivered[idx]
        if (batchRow == null) continue
        let title = batchRow.title
        let pids: string[] = []
        try {
          const card = await fetchJson<Envelope<BatchCardData>>(`/api/t4/engine/batches/${batchRow.slug}`)
          title = asStr(card.data.title) || batchRow.title
          const slots = asArray(asRecord(card.data.plan).slots)
          if (slots.length > 0) {
            const counts = new Map<string, number>()
            for (const s of slots) {
              const pid = asStr(asRecord(s).paletteId)
              if (pid !== '') counts.set(pid, (counts.get(pid) ?? 0) + 1)
            }
            pids = [...counts.keys()].sort()
          }
        } catch {
          /* engine card unavailable — slug/title are still real */
        }
        if (pids.length === 0) {
          /* legacy (file-era) batches: locked palettes live in the plan markdown */
          try {
            const md = await fetchJson<{ markdown?: string }>(`/api/t4/batches/${batchRow.slug}`)
            pids = extractPaletteIds(asStr(md.markdown))
          } catch {
            /* no file-era record either — slot shows honest empty state */
          }
        }
        const palettes: RotPalette[] = pids.slice(0, 12).map((pid) => {
          const base = pid.split('_')[0] ?? pid
          const spec = paletteMapRef.current[base]
          return { id: pid, name: spec?.name ?? base, colors: spec?.colors ?? [fallbackColor(base)] }
        })
        cards.push({
          slot: idx,
          slug: batchRow.slug,
          title,
          deliveredAt: batchRow.deliveredAt ?? batchRow.createdAt,
          palettes,
        })
      }
      setRotation(cards)
    } catch {
      setRotation([])
    } finally {
      setRotationLoading(false)
    }
  }, [])

  const loadPlan = useCallback(async () => {
    try {
      const b = await fetchJson<Envelope<{ batches: BatchRow[] }>>('/api/t4/engine/batches?limit=20')
      const latest = (b.data.batches ?? [])[0]
      if (latest == null) return
      const card = await fetchJson<Envelope<BatchCardData>>(`/api/t4/engine/batches/${latest.slug}`)
      const plan = asRecord(card.data.plan)
      const parsed = planSlotsToCells(plan)
      const status: CellStatus = latest.status === 'void' ? 'void' : latest.status === 'delivered' ? 'sealed' : 'assigned'
      setCells(parsed.cells.map((c) => ({ ...c, status })))
      setExpCells(parsed.expCells.map((c) => ({ ...c, status })))
      setGates(normReceipts(asArray(plan.receipts)))
      setPlanSource(`${latest.slug} · ${latest.status.toUpperCase()}`)
    } catch {
      /* matrix stays on standby */
    }
  }, [])

  const probe = useCallback(async () => {
    setKeyChip('checking')
    if (getCommanderKey() === '') {
      setKeyChip('nokey')
      return
    }
    try {
      const p = await probeCommanderKey()
      if (!p.serverKey) setKeyChip('noserver')
      else setKeyChip(p.keyOk ? 'ok' : 'mismatch')
    } catch {
      setKeyChip('mismatch')
    }
  }, [])

  /* ---------------- boot ---------------- */

  useEffect(() => {
    let alive = true
    void (async () => {
      pushSys('console boot ▸ linking t4-engine :3200 through /api/t4/engine…')
      setKeyInput(getCommanderKey())
      void probe()
      try {
        const st = await fetchJson<Envelope<EngineState>>('/api/t4/engine/state')
        if (!alive) return
        setStats(st.data)
        setEngineDown(false)
        pushSys(`engine link OK · era ${st.data.era} · canon ${st.data.canon} · uptime ${fmtUptime(st.data.uptimeSec)}`, 'ok')
      } catch {
        if (!alive) return
        setEngineDown(true)
        pushSys('engine link FAILED — telemetry degraded, pollers keep retrying', 'err')
      }
      await loadChainBoot()
      try {
        const v = await fetchJson<Envelope<VerifyData>>('/api/t4/engine/chain/verify')
        if (!alive) return
        setVerify(v.data)
        pushSys(
          v.data.ok
            ? `engine audit ▸ SEALED — chronicle untampered (${v.data.events} links)`
            : `engine audit ▸ PROBLEMS ×${v.data.problems.length}`,
          v.data.ok ? 'ok' : 'err'
        )
      } catch {
        /* verify is optional at boot */
      }
      await loadPalettes()
      await loadRotation()
      await loadPlan()
      if (alive) setBooted(true)
    })()
    return () => {
      alive = false
    }
  }, [pushSys, probe, loadChainBoot, loadPalettes, loadRotation, loadPlan])

  /* ---------------- pollers & clock ---------------- */

  useEffect(() => {
    if (!pollOn) return
    const id = setInterval(() => void pollEvents(), 2500)
    return () => clearInterval(id)
  }, [pollOn, pollEvents])

  useEffect(() => {
    if (!pollOn) return
    const id = setInterval(() => void pollState(), 7000)
    void pollState()
    return () => clearInterval(id)
  }, [pollOn, pollState])

  useEffect(() => {
    const id = setInterval(() => setClock(fmtClock(new Date())), 1000)
    return () => clearInterval(id)
  }, [])

  /* ---------------- BURN & REBUILD ---------------- */

  const runBurn = useCallback(async () => {
    if (busyRef.current || engineDown) return
    busyRef.current = true
    setBurn({ phase: 'running', done: 0, total: 0, result: null })
    pushSys('BURN & REBUILD ▸ full chain re-audit requested (read-only on canon)', 'warn')
    try {
      const [evRes, verifyRes] = await Promise.all([
        fetchJson<Envelope<EventsData>>('/api/t4/engine/events?after=0&limit=1000'),
        fetchJson<Envelope<VerifyData>>('/api/t4/engine/chain/verify').catch(() => null),
      ])
      const evs = (evRes.data.events ?? []).filter(isChainEvent)
      const total = evs.length
      setBurn((b) => (b.phase === 'running' ? { ...b, total } : b))
      const broken: number[] = []

      /* visible chunked re-hash sweep: every link recomputed in-browser */
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
          setBurn((b) => (b.phase === 'running' ? { ...b, done: end } : b))
          if (i < total) setTimeout(step, reduce ? 0 : 14)
          else resolve()
        }
        step()
      })

      /* authoritative local verdicts pushed back into the table */
      const linkOkBySeq = new Map<number, boolean>()
      evs.forEach((e, i) => linkOkBySeq.set(e.seq, i === 0 || e.prev === evs[i - 1]?.hash))
      setRows((prev) =>
        prev.map((r) =>
          r.level === 'chain' && r.seq != null && linkOkBySeq.has(r.seq) ? { ...r, linkOk: linkOkBySeq.get(r.seq) ?? true } : r
        )
      )

      const engineOk = verifyRes == null ? null : verifyRes.data.ok
      const ok = broken.length === 0 && (engineOk ?? true)
      const text = ok
        ? `${total}/${total} LINKS VERIFIED · CHAIN INTACT${engineOk != null ? ' · ENGINE SEALED' : ''} · head ${h8(evs[evs.length - 1]?.hash ?? '')}`
        : `MISMATCH @ seq ${broken.join(', ')}${verifyRes != null && !verifyRes.data.ok ? ` · engine problems: ${verifyRes.data.problems[0] ?? '—'}` : ''}`

      setBurn({ phase: 'done', done: total, total, result: { ok, text } })
      pushSys(ok ? `BURN COMPLETE ▸ ${text}` : `BURN FOUND DRIFT ▸ ${text}`, ok ? 'ok' : 'err')
      pushToast(ok ? 'ok' : 'err', ok ? 'BURN & REBUILD — CLEAN' : 'CHAIN MISMATCH', text)
      if (verifyRes != null) setVerify(verifyRes.data)
    } catch {
      setBurn({ phase: 'idle', done: 0, total: 0, result: null })
      pushSys('BURN ABORTED ▸ engine unreachable — re-audit failed', 'err')
      pushToast('err', 'BURN FAILED', 'Engine unreachable — re-audit aborted.')
    } finally {
      busyRef.current = false
    }
  }, [engineDown, pushSys, pushToast, reduce])

  /* ---------------- FORCE COMPILE ---------------- */

  const runCompile = useCallback(async () => {
    if (busyRef.current) return
    const theme = themeInput.trim()
    const ocs = ocInputs.map((t) => t.trim()).filter((t) => t !== '')
    if (theme === '') {
      setFormError('theme required — 1–120 chars (strict Zod contract)')
      setShakeTick((t) => t + 1)
      pushToast('err', 'THEME REQUIRED', 'Type a batch theme (1–120 chars) before force-compiling.')
      return
    }
    if (ocs.length === 0) {
      setFormError('at least one OC slot theme required (ocThemes min 1)')
      setShakeTick((t) => t + 1)
      pushToast('err', 'OC THEME REQUIRED', 'The compiler needs at least one OC slot theme (OC·1–3).')
      return
    }
    busyRef.current = true
    setCompiling(true)
    setBanner(null)
    setFormError('')
    setCells((prev) => prev.map((c) => ({ ...c, status: 'cycling' })))
    setExpCells((prev) => prev.map((c) => ({ ...c, status: 'cycling' })))
    pushSys(`COMPILE REQUEST ▸ theme «${theme}» · oc×${ocs.length} · engine per-theme`, 'warn')

    const idem = `t4c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const res = await postJson<Envelope<CompileResponse>>(
        '/api/t4/engine/compile',
        {
          theme,
          engine: 'per-theme',
          ocThemes: ocs.map((t, i) => ({ theme: t, rating: 'R+', position: i + 1 })),
        },
        { 'Idempotency-Key': idem }
      )
      const plan = asRecord(res.data.plan)
      const rawReceipts = asArray(res.data.receipts)
      const receipts = normReceipts(rawReceipts.length > 0 ? rawReceipts : asArray(plan.receipts))
      const parsed = planSlotsToCells(plan)
      const hardFail = receipts.some((r) => r.verdict === 'FAIL')
      const hasWarn = receipts.some((r) => r.verdict === 'WARN')
      const status: CellStatus = hardFail ? 'void' : 'sealed'
      setCells(parsed.cells.map((c) => ({ ...c, status })))
      setExpCells(parsed.expCells.map((c) => ({ ...c, status })))
      setGates(receipts)
      const slug = asStr(plan.slug) || stats?.nextSlug || 'T4-??'
      setPlanSource(`${slug} · ${res.data.idempotentReplay ? 'REPLAY' : 'FRESH'}`)
      const slotCount = parsed.cells.length + parsed.expCells.length

      if (hardFail) {
        const f = receipts.find((r) => r.verdict === 'FAIL')
        setBanner({
          id: Date.now(),
          kind: 'void',
          title: 'VOID DETECTED',
          detail: `${slug} rejected at gate «${f?.gate ?? '?'}» — ${f?.findings[0] ?? 'planning gate rejection'}. Draft not persisted.`,
        })
        pushSys(`COMPILE VOID ▸ ${slug} rejected at gate ${f?.gate ?? '?'}`, 'err')
        pushToast('err', 'VOID DETECTED', `${slug}: gate ${f?.gate ?? '?'} rejected the plan.`)
      } else if (hasWarn) {
        const w = receipts.filter((r) => r.verdict === 'WARN')
        setBanner({
          id: Date.now(),
          kind: 'drift',
          title: 'DRIFT DETECTED',
          detail: `${slug} sealed with ${w.length} advisory finding(s) — first: ${w[0]?.findings[0] ?? w[0]?.gate ?? '—'}.`,
        })
        pushSys(`COMPILE SEALED WITH DRIFT ▸ ${slug} · ${w.length} WARN findings`, 'warn')
        pushToast('info', 'DRIFT DETECTED', `${slug} sealed with ${w.length} advisory finding(s).`)
      } else {
        setBanner({
          id: Date.now(),
          kind: 'clean',
          title: 'CLEAN RUN',
          detail: `${slug} compiled · ${receipts.length} planning gates PASS · ${slotCount} slots planned · plan persisted to the engine.`,
        })
        pushSys(`COMPILE CLEAN ▸ ${slug} · all planning gates PASS · ${slotCount} slots`, 'ok')
        pushToast('ok', 'CLEAN RUN', `${slug} — ${slotCount} slots planned, gates sealed.`)
      }
      void pollEvents()
      void pollState()
    } catch (e) {
      setCells((prev) => prev.map((c) => ({ ...c, status: 'standby' })))
      setExpCells((prev) => prev.map((c) => ({ ...c, status: 'standby' })))
      const err = e instanceof ApiError ? e : null
      const msg = e instanceof Error ? e.message : 'network error'
      if (err != null && err.status === 403) {
        setBanner({
          id: Date.now(),
          kind: 'locked',
          title: 'AUTH LOCKED',
          detail: 'x-commander-key missing or wrong — save the commander key above to arm mutations.',
        })
        pushSys('COMPILE REFUSED ▸ 403 commander key', 'err')
        pushToast('err', 'AUTH LOCKED', 'Commander key missing or wrong.')
      } else if (err != null && err.status === 503) {
        const setup = err.payload != null && 'setupRequired' in err.payload
        setBanner({
          id: Date.now(),
          kind: 'locked',
          title: setup ? 'SERVER KEY ABSENT' : 'ENGINE UNAVAILABLE',
          detail: setup
            ? '~/.t4/commander.key not created on the engine host — mutations are fail-closed.'
            : 't4-engine did not answer the compile RPC.',
        })
        pushSys('COMPILE REFUSED ▸ 503 fail-closed', 'err')
        pushToast('err', setup ? 'SERVER KEY ABSENT' : 'ENGINE UNAVAILABLE', msg)
      } else {
        setBanner({ id: Date.now(), kind: 'error', title: 'COMPILE FAILED', detail: msg })
        pushSys(`COMPILE FAILED ▸ ${msg}`, 'err')
        pushToast('err', 'COMPILE FAILED', msg)
      }
    } finally {
      setCompiling(false)
      busyRef.current = false
    }
  }, [themeInput, ocInputs, stats, pushSys, pushToast, pollEvents, pollState])

  /* ---------------- PURGE HEAP ---------------- */

  const runPurge = useCallback(async () => {
    if (busyRef.current) return
    const n = rows.length
    busyRef.current = true
    setRows([])
    setPurgeFlash(n)
    setTimeout(() => setPurgeFlash(null), 1500)
    pushSys(`HEAP PURGE ▸ local buffer flushed (−${n} lines) · re-seeding tail from engine`, 'warn')
    const seq = lastSeqRef.current
    if (seq > 0) {
      try {
        const after = Math.max(0, seq - 40)
        const r = await fetchJson<Envelope<EventsData>>(`/api/t4/engine/events?after=${after}&limit=60`)
        const evs = (r.data.events ?? []).filter(isChainEvent)
        if (evs.length > 0) {
          const built = evs.map((e, i) => toRow(e, i === 0 ? true : e.prev === evs[i - 1]?.hash))
          for (const row of built) freshKeysRef.current.add(row.key)
          setTimeout(() => {
            for (const row of built) freshKeysRef.current.delete(row.key)
          }, 1400)
          setRows(built)
        }
      } catch {
        /* empty buffer — the poller refills it */
      }
    }
    pushToast('info', 'HEAP PURGED', `−${n} buffer lines · tail re-seeded from engine.`)
    busyRef.current = false
  }, [rows.length, pushSys, pushToast])

  /* ---------------- key management ---------------- */

  const saveKey = useCallback(() => {
    setCommanderKey(keyInput)
    pushSys(keyInput.trim() === '' ? 'commander key cleared' : 'commander key saved to localStorage — probing…', 'info')
    void probe()
  }, [keyInput, pushSys, probe])

  const clearKey = useCallback(() => {
    clearCommanderKey()
    setKeyInput('')
    pushSys('commander key cleared', 'info')
    void probe()
  }, [pushSys, probe])

  const setOcInput = useCallback((i: number, v: string) => {
    setOcInputs((prev) => prev.map((x, j) => (j === i ? v : x)))
  }, [])

  /* ---------------- derived ---------------- */

  const auditBroken = useMemo(() => rows.filter((r) => r.level === 'chain' && !r.linkOk).length, [rows])

  /* ---------------- render ---------------- */

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-200">
      <HeaderBar stats={stats} engineDown={engineDown} verify={verify} auditBroken={auditBroken} clock={clock} />

      <main className="flex-1 w-full max-w-[1500px] mx-auto px-3 sm:px-4 lg:px-6 py-4 flex flex-col gap-4">
        <RotationWindow
          cards={rotation}
          loading={rotationLoading}
          nextSlug={stats?.nextSlug ?? ''}
          onRefresh={() => void loadRotation()}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(330px,380px)_minmax(0,1fr)] items-start">
          <div className="flex flex-col gap-4 min-w-0">
            <section aria-label="Pipeline control" className="border border-zinc-800 bg-zinc-900/40 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
                <Zap size={13} className="text-amber-400" />
                <span className="text-[12px] font-semibold text-zinc-100 tracking-wide">PIPELINE CONTROL</span>
                <span className="ml-auto font-mono text-[10px] text-zinc-500">{busy ? 'BUSY' : 'READY'}</span>
              </div>
              <BurnSection burn={burn} engineDown={engineDown} onBurn={() => void runBurn()} reduce={reduce} />
              <CompileSection
                themeInput={themeInput}
                setThemeInput={setThemeInput}
                ocInputs={ocInputs}
                setOcInput={setOcInput}
                keyInput={keyInput}
                setKeyInput={setKeyInput}
                keyReveal={keyReveal}
                setKeyReveal={setKeyReveal}
                keyChip={keyChip}
                onSaveKey={saveKey}
                onClearKey={clearKey}
                compiling={compiling}
                onCompile={() => void runCompile()}
                banner={banner}
                formError={formError}
                shakeTick={shakeTick}
                reduce={reduce}
              />
              <PurgeSection onPurge={() => void runPurge()} bufferCount={rows.length} purgeFlash={purgeFlash} busy={busy} />
            </section>

            <SystemPanel stats={stats} engineDown={engineDown} />

            <GateMatrix cells={cells} expCells={expCells} gates={gates} planSource={planSource} reduce={reduce} />
          </div>

          <ChroniclePanel
            rows={rows}
            engineDown={engineDown}
            pollOn={pollOn}
            onTogglePoll={() => setPollOn((p) => !p)}
            stats={stats}
            verify={verify}
            booted={booted}
            burnPhase={burn.phase}
            burnDone={burn.done}
            freshKeys={freshKeysRef.current}
            reduce={reduce}
          />
        </div>
      </main>

      <FooterBar stats={stats} />
      <ToastStack toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}
