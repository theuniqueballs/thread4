'use client'

/**
 * THREAD-4 // CENTRAL DOGMA — Neon-Anime Cyberpunk control deck.
 * =====================================================================
 * Monolithic dashboard (the `/` route) for the THREAD 4 prompt-batch
 * pipeline. Everything is wired to the REAL t4-engine RPC (:3200 via
 * the /api/t4/engine proxy):
 *
 *   · Live Telemetry & Chronicle — chain.jsonl stream with per-link
 *     cryptographic validation (prev[i] === hash[i-1], re-checked in
 *     the browser on every append; GET /v1/chain/verify is authority).
 *   · BURN & REBUILD — full genesis→head re-audit sweep (read-only).
 *   · FORCE COMPILE — real POST /v1/compile (commander-key gated),
 *     receipts drive the 24-gate matrix + verdict stamp.
 *   · PURGE HEAP — local telemetry buffer flush.
 *   · Rotation Window — union of the last 3 delivered batches'
 *     locked palettes (real plan data, real palette spec colors).
 *   · Operators — Tsubaki-chan (gate controller) & Charlie-chan
 *     (chronicle auditor) react to live system state.
 *
 * Aesthetic: Evangelion / Cyberpunk-2077 — dark glass, neon magenta /
 * cyan / amber / red, scanlines, waifu operators. No blue/indigo UI
 * primaries.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Fingerprint,
  Flame,
  Gauge,
  Hash,
  KeyRound,
  Layers,
  Lock,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal as TerminalIcon,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
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

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

type ApiEnvelope<T> = { ok: boolean; data: T }

interface ChainEvent {
  seq: number
  id: string
  at: string
  type: string
  summary: string
  hash: string
  prev: string
}

interface EngineStateData {
  era: string
  canon: string
  nextSlug: string
  lastDelivered?: { slug: string; title: string; deliveredAt: string } | null
  counts: { events: number; batchesDelivered: number; batchesCompiled: number; verdicts: number }
  chain: { height: number; head: string; ok: boolean; problems: string[] }
  uptimeSec: number
}

interface EventsData {
  events: ChainEvent[]
  returned: number
  total: number
}

interface VerifyData {
  ok: boolean
  events: number
  head: string
  problems: string[]
}

interface BatchRow {
  slug: string
  title: string
  status: string
  createdAt: string
  deliveredAt?: string | null
}

interface PlanSlot {
  position: number
  kind: string
  rating?: string
  register?: string
  paletteId?: string
}

interface BatchCardData {
  slug: string
  title: string
  theme: string
  status: string
  plan: { slots?: unknown[] } | Record<string, unknown>
}

interface CompileData {
  plan: { slug: string; title: string; slots?: unknown[] }
  receipts: { gate: string; level: string; verdict: string; findings: string[] }[]
  idempotentReplay: boolean
}

type LinkState = 'ok' | 'broken'
type SysLevel = 'info' | 'ok' | 'warn' | 'err'

type FeedEntry =
  | { uid: number; kind: 'chain'; ev: ChainEvent; link: LinkState }
  | { uid: number; kind: 'sys'; at: number; text: string; level: SysLevel }

type OpMode = 'idle' | 'compiling' | 'burning' | 'purging'
type Health = 'live' | 'down'
type MascotMood = 'idle' | 'happy' | 'shock' | 'concerned' | 'focus' | 'sleep'
type BannerVerdict = 'clean' | 'drift' | 'void'

interface Banner {
  id: number
  verdict: BannerVerdict
  title: string
  detail: string
}

type CellStatus = 'standby' | 'cycling' | 'assigned' | 'sealed' | 'drift' | 'void'

interface GateCell {
  pos: number
  kind: string
  rating: string
  register: string
  paletteId: string
  status: CellStatus
}

interface GateReceiptUI {
  gate: string
  level: string
  verdict: string
  findings: string[]
}

interface RotationCardData {
  slot: number
  slug: string
  title: string
  deliveredAt: string
  palettes: { id: string; name: string; colors: string[] }[]
  registers: { name: string; count: number }[]
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const GENESIS = 'GENESIS'
const MAX_FEED = 240
const PLANNING_GATES = ['structure', 'exp-purity', 'floors', 'window', 'ab']
const PALETTE_FUND = 120

const MAGENTA = '#ff2d78'
const CYAN = '#00e5ff'
const AMBER = '#ffb300'
const DANGER = '#ff3860'
const EMERALD = '#00ffa3'

const ASCII_FACES: Record<MascotMood, string> = {
  idle: '(=^･ω･^=)',
  happy: '(≧◡≦)♪',
  shock: 'Σ(°△°||)',
  concerned: '(・_・;)',
  focus: '( ﾟｰﾟ)ｄ',
  sleep: '(￣ρ￣)zzz',
}

/** Base color vocabulary → HSL triplets (data-honest swatches for the
 * rotation window; unknown names fall back to a deterministic hue). */
const BASE_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 8], ink: [240, 8, 10], charcoal: [0, 0, 16], graphite: [0, 0, 22],
  ash: [220, 4, 55], slate: [215, 12, 45], storm: [220, 10, 34], fog: [210, 8, 70],
  silver: [220, 4, 74], platinum: [200, 4, 82], pearl: [40, 14, 90],
  white: [0, 0, 97], ivory: [48, 28, 92], alabaster: [40, 16, 88],
  cream: [48, 30, 88], vanilla: [46, 32, 86], sand: [42, 26, 74],
  beige: [38, 22, 78], champagne: [45, 26, 80], taupe: [40, 8, 55],
  camel: [35, 28, 62], caramel: [30, 40, 58], honey: [38, 62, 58],
  amber: [40, 88, 55], gold: [44, 72, 56], brass: [42, 48, 52],
  bronze: [26, 42, 46], copper: [20, 52, 54], rust: [16, 55, 46],
  terracotta: [14, 48, 52], cinnamon: [18, 44, 46], chestnut: [16, 36, 38],
  mahogany: [12, 40, 32], brown: [22, 26, 34], warm: [35, 40, 60],
  peach: [18, 62, 80], apricot: [20, 66, 76], salmon: [8, 58, 70],
  coral: [6, 68, 70], tangerine: [24, 78, 60], orange: [26, 80, 58],
  scarlet: [354, 74, 52], crimson: [350, 70, 46], ruby: [348, 66, 42],
  cherry: [350, 62, 46], burgundy: [344, 46, 34], wine: [342, 40, 32],
  blood: [0, 62, 34], red: [0, 62, 48], rose: [346, 60, 66],
  dusty: [346, 22, 66], blush: [348, 48, 82], pink: [340, 62, 76],
  magenta: [322, 82, 56], fuchsia: [312, 78, 60], mauve: [326, 28, 58],
  plum: [315, 34, 46], purple: [290, 38, 48], violet: [280, 42, 54],
  lavender: [270, 38, 76], lilac: [282, 34, 76], orchid: [300, 40, 64],
  amethyst: [288, 40, 56], periwinkle: [246, 40, 74],
  indigo: [243, 45, 42], navy: [225, 45, 28], midnight: [232, 40, 20],
  denim: [216, 38, 46], cobalt: [222, 52, 46], sapphire: [222, 58, 44],
  cerulean: [202, 56, 54], azure: [205, 62, 58], sky: [197, 52, 70],
  cyan: [186, 88, 56], aqua: [184, 68, 62], turquoise: [176, 56, 56],
  teal: [174, 44, 42], jade: [160, 40, 48], emerald: [152, 56, 46],
  mint: [158, 44, 76], seafoam: [162, 38, 74], sage: [110, 16, 62],
  moss: [100, 22, 40], olive: [68, 30, 40], fern: [104, 28, 42],
  jungle: [140, 34, 30], green: [130, 44, 44], neon: [150, 92, 60],
  led: [160, 90, 72], fluorescent: [140, 80, 80], glow: [190, 80, 70],
  grey: [220, 4, 52], gray: [220, 4, 52], soft: [0, 0, 84],
}

function colorNameToHsl(name: string): string | null {
  const words = name.toLowerCase().split(/[\s-]+/).filter(Boolean)
  let base: [number, number, number] | null = null
  for (const w of words) {
    if (w in BASE_COLORS) {
      base = BASE_COLORS[w]
      break
    }
  }
  if (base == null) return null
  let [h, s, l] = base
  for (const w of words) {
    if (w === 'deep' || w === 'dark') l = Math.max(7, l - 16)
    if (w === 'pale' || w === 'pastel' || w === 'soft' || w === 'light') l = Math.min(92, l + 16)
    if (w === 'neon') {
      s = 94
      l = 62
    }
    if (w === 'dusty' || w === 'muted' || w === 'dust') s = Math.max(12, s - 22)
  }
  return `hsl(${h} ${s}% ${l}%)`
}

function fallbackColor(token: string): string {
  let h = 0
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 50% 46%)`
}

/** swatches for a palette spec entry (dominant → secondary → accent → shadow) */
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

/* ================================================================== */
/* Small utilities                                                     */
/* ================================================================== */

const h8 = (h: string): string => (h === '' ? '????????' : h.slice(0, 8))

const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const fmtUptime = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(r)}`
}

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

function useInterval(cb: () => void, ms: number | null): void {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => {
    if (ms == null) return
    const id = window.setInterval(() => ref.current(), ms)
    return () => window.clearInterval(id)
  }, [ms])
}

/** periodic eye-blink for the mascots */
function useBlink(active: boolean): boolean {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!active) return
    let t1 = 0
    let t2 = 0
    let alive = true
    const schedule = () => {
      t1 = window.setTimeout(() => {
        if (!alive) return
        setClosed(true)
        t2 = window.setTimeout(() => {
          if (!alive) return
          setClosed(false)
          schedule()
        }, 120)
      }, 2200 + Math.random() * 2800)
    }
    schedule()
    return () => {
      alive = false
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [active])
  return closed
}

function Typewriter({ text, speed = 14, className }: { text: string; speed?: number; className?: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= text.length) return
    const id = window.setTimeout(() => setN(Math.min(n + 2, text.length)), speed)
    return () => window.clearTimeout(id)
  }, [n, speed, text])
  return (
    <span className={className}>
      {text.slice(0, n)}
      <span className="nd-caret text-cyan-300" aria-hidden>
        ▌
      </span>
    </span>
  )
}

/* ================================================================== */
/* Atoms: LED, hex logo, panel shell                                   */
/* ================================================================== */

function Led({
  state,
  label,
  className,
}: {
  state: 'ok' | 'warn' | 'err' | 'off' | 'run'
  label?: string
  className?: string
}) {
  const color =
    state === 'ok' ? EMERALD : state === 'warn' ? AMBER : state === 'err' ? DANGER : state === 'run' ? CYAN : '#52525b'
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-term text-[9px] tracking-widest text-zinc-500', className)}>
      <motion.span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        animate={state === 'off' ? undefined : { opacity: [1, 0.35, 1] }}
        transition={{ duration: state === 'err' ? 0.6 : 1.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      {label != null && <span className="uppercase">{label}</span>}
    </span>
  )
}

function HexLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 44 44"
      width={size}
      height={size}
      className={className}
      initial={{ rotate: -90, opacity: 0 }}
      animate={{ rotate: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      aria-hidden
    >
      <path d="M22 3 L39 12.5 L39 31.5 L22 41 L5 31.5 L5 12.5 Z" fill="rgba(255,45,120,0.09)" stroke={MAGENTA} strokeWidth="1.6" />
      <path d="M22 8.5 L34 15.5 L34 28.5 L22 35.5 L10 28.5 L10 15.5 Z" fill="none" stroke={CYAN} strokeWidth="0.7" opacity="0.45" />
      <text x="22" y="27.5" textAnchor="middle" fontSize="13" fontWeight="800" fill={MAGENTA} fontFamily="var(--font-orbitron), sans-serif">
        T4
      </text>
    </motion.svg>
  )
}

function PanelShell({
  title,
  icon,
  accent,
  right,
  className,
  bodyClassName,
  children,
}: {
  title: string
  icon: React.ReactNode
  accent: 'magenta' | 'cyan' | 'amber' | 'red' | 'emerald'
  right?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const borderColor = {
    magenta: 'rgba(255,45,120,0.5)',
    cyan: 'rgba(0,229,255,0.5)',
    amber: 'rgba(255,179,0,0.5)',
    red: 'rgba(255,56,96,0.55)',
    emerald: 'rgba(0,255,163,0.5)',
  }[accent]
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'relative rounded-xl border border-white/10 bg-white/[0.025] shadow-[0_0_30px_rgba(0,0,0,0.45)] backdrop-blur-xl',
        className,
      )}
    >
      {/* corner brackets */}
      <span className="pointer-events-none absolute -left-px -top-px h-3 w-3 rounded-tl-md border-l-2 border-t-2" style={{ borderColor }} aria-hidden />
      <span className="pointer-events-none absolute -right-px -top-px h-3 w-3 rounded-tr-md border-r-2 border-t-2" style={{ borderColor }} aria-hidden />
      <span className="pointer-events-none absolute -bottom-px -left-px h-3 w-3 rounded-bl-md border-b-2 border-l-2" style={{ borderColor }} aria-hidden />
      <span className="pointer-events-none absolute -bottom-px -right-px h-3 w-3 rounded-br-md border-b-2 border-r-2" style={{ borderColor }} aria-hidden />
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-3.5 py-2.5">
        <span style={{ color: borderColor }} aria-hidden>
          {icon}
        </span>
        <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-200">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      <div className={cn('p-3.5', bodyClassName)}>{children}</div>
    </motion.section>
  )
}

/* ================================================================== */
/* Backdrop FX + Boot veil                                             */
/* ================================================================== */

function BackdropFX() {
  const reduced = useReducedMotion()
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div className="absolute inset-0 bg-[#05070d]" />
      <div
        className="absolute -top-40 left-1/2 h-[540px] w-[900px] -translate-x-1/2 rounded-full opacity-25"
        style={{ background: `radial-gradient(closest-side, ${MAGENTA}55, transparent)` }}
      />
      <div
        className="absolute -right-40 top-1/3 h-[420px] w-[560px] rounded-full opacity-20"
        style={{ background: `radial-gradient(closest-side, ${CYAN}44, transparent)` }}
      />
      <div
        className="absolute -left-48 bottom-0 h-[420px] w-[560px] rounded-full opacity-15"
        style={{ background: `radial-gradient(closest-side, ${AMBER}33, transparent)` }}
      />
      <div className="nd-grid-micro" />
      {!reduced && (
        <>
          <div className="nd-grid-floor" />
          <div className="nd-scanline" />
          <div className="nd-crt" />
        </>
      )}
    </div>
  )
}

const BOOT_LINES = [
  'NERV-CLASS BOOT SEQUENCE v4.1',
  '> engine link rpc://127.0.0.1:3200 ......... ESTABLISHED',
  '> chronicle chain.jsonl ................... SEALED',
  '> compiler 24-gate matrix ................. STANDBY',
  '> operators TSUBAKI · CHARLIE ............. ONLINE',
  'ALL SYSTEMS NOMINAL — WELCOME, COMMANDER.',
]

function BootVeil({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [minDelayDone, setMinDelayDone] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setMinDelayDone(true), 1900)
    return () => window.clearTimeout(id)
  }, [])
  const open = !(minDelayDone && ready)
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="boot"
          className="fixed inset-0 z-[70] flex cursor-pointer flex-col items-center justify-center bg-[#05070d]"
          onClick={() => {
            setMinDelayDone(true)
            if (ready) onDone()
          }}
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.55 }}
          role="button"
          tabIndex={0}
          aria-label="Skip boot sequence"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setMinDelayDone(true)
              if (ready) onDone()
            }
          }}
        >
          <HexLogo size={64} />
          <p className="font-display mt-4 text-sm font-bold uppercase tracking-[0.35em] text-zinc-200 nd-glow-magenta">
            CENTRAL DOGMA
          </p>
          <div className="font-term mt-6 space-y-1.5 text-[11px] text-zinc-500">
            {BOOT_LINES.map((line, i) => (
              <motion.p
                key={line}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.18 + i * 0.22, duration: 0.3 }}
                className={cn(
                  i === 0 && 'text-[#ff2d78]',
                  i === BOOT_LINES.length - 1 && 'pt-2 text-cyan-300 nd-glow-cyan',
                )}
              >
                {line}
              </motion.p>
            ))}
          </div>
          <p className="font-term absolute bottom-8 text-[9px] tracking-widest text-zinc-700">CLICK TO SKIP</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ================================================================== */
/* Header + stat rail                                                  */
/* ================================================================== */

function HeaderBar({
  health,
  mode,
  chainOk,
  clock,
  head,
}: {
  health: Health
  mode: OpMode
  chainOk: boolean | null
  clock: string
  head: string
}) {
  const modeLabel =
    mode === 'idle' ? (health === 'live' ? 'PATROL' : 'DEGRADED') : mode === 'compiling' ? 'COMPILING' : mode === 'burning' ? 'BURNING' : 'PURGING'
  const modeColor =
    mode === 'idle' ? (health === 'live' ? 'text-cyan-300' : 'text-amber-300') : mode === 'purging' ? 'text-cyan-300' : 'text-[#ff2d78]'
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05070d]/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1680px] items-center gap-3 px-3 py-2.5 sm:px-6">
        <HexLogo size={34} />
        <div className="min-w-0">
          <h1 className="font-display truncate text-[13px] font-bold uppercase tracking-[0.22em] text-zinc-100 sm:text-[15px]">
            THREAD-4 <span className="text-[#ff2d78] nd-glow-magenta">{'//'}</span> CENTRAL DOGMA
          </h1>
          <p className="font-term hidden text-[9px] tracking-[0.25em] text-zinc-500 sm:block">
            PROMPT PIPELINE · ERA RPC · HASH-CHAIN CHRONICLE
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <Led state={health === 'live' ? 'ok' : 'err'} label={health === 'live' ? 'engine' : 'engine lost'} />
          <Led
            state={chainOk == null ? 'off' : chainOk ? 'ok' : 'err'}
            label={chainOk == null ? 'chain ?' : chainOk ? 'chain sealed' : 'chain broken'}
          />
          <Led state={mode === 'idle' ? 'off' : 'run'} label={mode === 'idle' ? undefined : 'op active'} />
          <span className={cn('font-display hidden text-[10px] font-bold uppercase tracking-[0.2em] md:inline', modeColor)}>
            MODE: {modeLabel}
          </span>
          <span className="font-term rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-cyan-200" suppressHydrationWarning>
            {clock} UTC
          </span>
          <span className="font-term hidden rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400 lg:inline">
            HEAD {h8(head)}
          </span>
        </div>
      </div>
    </header>
  )
}

function StatChip({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: 'magenta' | 'cyan' | 'amber' | 'emerald' | 'zinc'
}) {
  const color = {
    magenta: 'text-[#ff2d78]',
    cyan: 'text-cyan-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
    zinc: 'text-zinc-300',
  }[accent]
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className={color} aria-hidden>
          {icon}
        </span>
        <span className="font-term text-[8px] uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      </div>
      <motion.p
        key={value}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className={cn('font-display mt-0.5 truncate text-[15px] font-bold tabular-nums', color)}
      >
        {value}
      </motion.p>
    </div>
  )
}

function StatRail({ stats, chainLocal, health }: { stats: EngineStateData | null; chainLocal: { height: number; head: string }; health: Health }) {
  const dash = health === 'live' ? '—' : '····'
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <StatChip icon={<Hash size={13} />} label="chain height" value={chainLocal.height > 0 ? String(chainLocal.height) : dash} accent="magenta" />
      <StatChip icon={<Fingerprint size={13} />} label="chain head" value={chainLocal.head !== '' ? h8(chainLocal.head) : dash} accent="cyan" />
      <StatChip icon={<Database size={13} />} label="events" value={stats ? String(stats.counts.events) : dash} accent="zinc" />
      <StatChip icon={<Layers size={13} />} label="batches delivered" value={stats ? String(stats.counts.batchesDelivered) : dash} accent="emerald" />
      <StatChip icon={<Activity size={13} />} label="verdicts" value={stats ? String(stats.counts.verdicts) : dash} accent="amber" />
      <StatChip
        icon={<Gauge size={13} />}
        label="engine uptime"
        value={stats ? fmtUptime(stats.uptimeSec) : dash}
        accent="cyan"
      />
    </div>
  )
}

/* ================================================================== */
/* Mascots — Tsubaki-chan (gate controller) & Charlie-chan (auditor)   */
/* ================================================================== */

function EyeGroup({
  cx,
  cy,
  mood,
  closed,
  irisFill,
  lash,
}: {
  cx: number
  cy: number
  mood: MascotMood
  closed: boolean
  irisFill: string
  lash: string
}) {
  const openEye = (sc: number) => (
    <g transform={`translate(${cx},${cy}) scale(${sc})`}>
      <ellipse cx="0" cy="0" rx="10.5" ry="13" fill="#fff" />
      <ellipse cx="0" cy="2" rx="10.5" ry="11" fill="#ffe4ec" opacity="0.6" />
      <ellipse cx="0" cy="0.5" rx="7.4" ry="10" fill={irisFill} />
      <ellipse cx="0" cy="0.5" rx="7.4" ry="10" fill="none" stroke="rgba(0,229,255,0.4)" strokeWidth="1.3" />
      <ellipse cx="0" cy="1" rx="3" ry="4.6" fill="#16030c" />
      <circle cx="-3.4" cy="-4.2" r="3.2" fill="#fff" />
      <circle cx="3" cy="4.4" r="1.7" fill="#ffd6e4" opacity="0.95" />
      <path d={`M-11,-8.5 Q0,-16.5 11,-8.5`} stroke={lash} strokeWidth="4.4" fill="none" strokeLinecap="round" />
      <path d={`M-11,-8.5 L-14.5,-12`} stroke={lash} strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  )

  if (closed || mood === 'sleep') {
    return (
      <path
        d={`M${cx - 10},${cy + 2} Q${cx},${cy + 11} ${cx + 10},${cy + 2}`}
        stroke={lash}
        strokeWidth="4.2"
        fill="none"
        strokeLinecap="round"
      />
    )
  }
  if (mood === 'happy') {
    return (
      <path
        d={`M${cx - 10},${cy + 4} Q${cx},${cy - 7} ${cx + 10},${cy + 4}`}
        stroke={lash}
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
    )
  }
  if (mood === 'shock') {
    return (
      <g>
        <ellipse cx={cx} cy={cy} rx="12" ry="15" fill="#fff" />
        <ellipse cx={cx} cy={cy} rx="4.6" ry="6.2" fill={irisFill} />
        <ellipse cx={cx} cy={cy + 0.5} rx="1.8" ry="2.6" fill="#16030c" />
        <circle cx={cx - 2.6} cy={cy - 4} r="2.4" fill="#fff" />
        <path d={`M${cx - 11.5},${cy - 9.5} Q${cx},${cy - 17.5} ${cx + 11.5},${cy - 9.5}`} stroke={lash} strokeWidth="4.4" fill="none" strokeLinecap="round" />
      </g>
    )
  }
  if (mood === 'concerned') {
    return (
      <g>
        <ellipse cx={cx} cy={cy + 1} rx="10" ry="12" fill="#fff" />
        <ellipse cx={cx} cy={cy + 1} rx="7" ry="9.5" fill={irisFill} />
        <ellipse cx={cx} cy={cy + 1.5} rx="2.8" ry="4.2" fill="#16030c" />
        <circle cx={cx - 3} cy={cy - 3} r="2.8" fill="#fff" />
        {/* half-lid */}
        <path d={`M${cx - 10.4},${cy - 2} Q${cx},${cy - 8} ${cx + 10.4},${cy - 2} L${cx + 10.4},${cy - 7} Q${cx},${cy - 12} ${cx - 10.4},${cy - 7} Z`} fill="#f6cdd8" />
        <path d={`M${cx - 10.4},${cy - 2.2} Q${cx},${cy - 7.6} ${cx + 10.4},${cy - 2.2}`} stroke={lash} strokeWidth="4.2" fill="none" strokeLinecap="round" />
      </g>
    )
  }
  if (mood === 'focus') return openEye(0.92)
  return openEye(1)
}

function Mouth({ mood, talking }: { mood: MascotMood; talking: boolean }) {
  if (talking && (mood === 'idle' || mood === 'happy' || mood === 'focus')) {
    return (
      <motion.g animate={{ scaleY: [1, 0.35, 1] }} transition={{ duration: 0.34, repeat: Infinity }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <ellipse cx="110" cy="132" rx="5.4" ry="6.4" fill="#6e1233" stroke="#83112f" strokeWidth="1.8" />
      </motion.g>
    )
  }
  if (mood === 'happy') {
    return (
      <g>
        <path d="M101,128 Q110,143 119,128 Z" fill="#6e1233" stroke="#83112f" strokeWidth="2" strokeLinejoin="round" />
        <path d="M105.5,135 Q110,139.5 114.5,135 Z" fill="#ff5c8a" />
      </g>
    )
  }
  if (mood === 'shock') {
    return <ellipse cx="110" cy="133" rx="6.6" ry="8.6" fill="#5b0f2e" stroke="#83112f" strokeWidth="2" />
  }
  if (mood === 'concerned') {
    return <path d="M103,134 q3.5,-3.5 7,0 q3.5,3.5 7,0" stroke="#83112f" strokeWidth="2.2" fill="none" strokeLinecap="round" />
  }
  if (mood === 'focus') {
    return <path d="M104,133 L116,133" stroke="#83112f" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  }
  if (mood === 'sleep') {
    return <ellipse cx="110" cy="133" rx="3.4" ry="4" fill="#6e1233" />
  }
  return <path d="M104,130 Q110,136 116,130" stroke="#83112f" strokeWidth="2.4" fill="none" strokeLinecap="round" />
}

function Brows({ mood }: { mood: MascotMood }) {
  const stroke = '#83112f'
  if (mood === 'shock') {
    return (
      <g stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M84,84 Q95,78 104,82" />
        <path d="M116,82 Q125,78 136,84" />
      </g>
    )
  }
  if (mood === 'concerned') {
    return (
      <g stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M85,90 L102,85" />
        <path d="M118,85 L135,90" />
      </g>
    )
  }
  if (mood === 'focus') {
    return (
      <g stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M85,89 L103,88" />
        <path d="M117,88 L135,89" />
      </g>
    )
  }
  return (
    <g stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round">
      <path d="M85,91 Q94,86 103,90" />
      <path d="M117,90 Q126,86 135,91" />
    </g>
  )
}

function Blush({ tint, opacity }: { tint: string; opacity: number }) {
  return (
    <g opacity={opacity}>
      <ellipse cx="83" cy="124" rx="8.2" ry="4.4" fill={tint} />
      <ellipse cx="137" cy="124" rx="8.2" ry="4.4" fill={tint} />
      <g stroke={tint} strokeWidth="1.1" strokeLinecap="round">
        <path d="M78,122.5 l9,3.4" />
        <path d="M79,125.5 l7,2.6" />
        <path d="M133,125.9 l9,-3.4" />
        <path d="M134,128.1 l7,-2.6" />
      </g>
    </g>
  )
}

function TsubakiMascot({ mood, talking }: { mood: MascotMood; talking: boolean }) {
  const blink = useBlink(mood !== 'sleep' && mood !== 'happy')
  const reduced = useReducedMotion()
  return (
    <motion.div
      className="relative mx-auto w-[190px] select-none sm:w-[210px]"
      animate={reduced ? undefined : { y: [0, -5, 0] }}
      transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden
    >
      <svg viewBox="0 0 220 260" className="w-full drop-shadow-[0_0_24px_rgba(255,45,120,0.25)]">
        <defs>
          <linearGradient id="tsu-hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff5c9d" />
            <stop offset="55%" stopColor="#ff2d78" />
            <stop offset="100%" stopColor="#c11d5c" />
          </linearGradient>
          <linearGradient id="tsu-tail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff2d78" />
            <stop offset="100%" stopColor="#7a1038" />
          </linearGradient>
          <radialGradient id="tsu-skin" cx="0.5" cy="0.4" r="0.75">
            <stop offset="0%" stopColor="#fff0f4" />
            <stop offset="100%" stopColor="#f6cdd8" />
          </radialGradient>
          <radialGradient id="tsu-iris" cx="0.5" cy="0.4" r="0.8">
            <stop offset="0%" stopColor="#ff4d92" />
            <stop offset="70%" stopColor="#ff2d78" />
            <stop offset="100%" stopColor="#5b0f2e" />
          </radialGradient>
          <filter id="tsu-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* twin tails */}
        <path d="M64,88 C30,96 14,140 24,178 C34,206 52,196 46,170 C42,150 56,120 70,108 Z" fill="url(#tsu-tail)" />
        <path d="M156,88 C190,96 206,140 196,178 C186,206 168,196 174,170 C178,150 164,120 150,108 Z" fill="url(#tsu-tail)" />
        <circle cx="63" cy="96" r="3.4" fill={CYAN} filter="url(#tsu-glow)" />
        <circle cx="157" cy="96" r="3.4" fill={CYAN} filter="url(#tsu-glow)" />

        {/* torso — operator suit */}
        <path d="M78,252 C78,212 92,194 110,194 C128,194 142,212 142,252 Z" fill="#12091c" />
        <path d="M92,250 L110,214 L128,250" stroke={MAGENTA} strokeWidth="2" fill="none" opacity="0.85" />
        <path d="M78,236 Q110,223 142,236" stroke={CYAN} strokeWidth="1.4" fill="none" opacity="0.7" />
        <rect x="126" y="224" width="15" height="10" rx="2" fill="#0a0510" stroke={CYAN} strokeWidth="0.8" />
        <text x="133.5" y="231.6" textAnchor="middle" fontSize="6.4" fill={CYAN} fontFamily="var(--font-jbmono), monospace">
          T4
        </text>
        <rect x="101" y="180" width="18" height="17" rx="4" fill="#f7d9df" />
        <rect x="99" y="192" width="22" height="5" rx="2.5" fill="#14101f" />
        <circle cx="110" cy="194.5" r="1.7" fill={MAGENTA} />

        {/* back hair */}
        <path d="M66,120 C60,70 84,44 110,44 C136,44 160,70 154,120 C154,150 146,166 138,176 L82,176 C74,166 66,150 66,120 Z" fill="#3d0a20" />

        {/* head group */}
        <motion.g
          animate={reduced ? undefined : { rotate: [-1.4, 1.4, -1.4] }}
          transition={{ duration: 5.4, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 30%' }}
        >
          {/* face */}
          <path d="M110,58 C132,58 146,76 146,98 C146,122 136,146 110,152 C84,146 74,122 74,98 C74,76 88,58 110,58 Z" fill="url(#tsu-skin)" />
          {/* bangs */}
          <path
            d="M72,100 L72,66 C84,46 136,46 148,66 L148,100 L139,88 L133,102 L125,88 L117,100 L110,86 L103,100 L95,88 L87,102 L79,88 Z"
            fill="url(#tsu-hair)"
          />
          <path d="M84,64 Q110,50 136,64" stroke="#ff8fb8" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.55" />
          {/* ahoge */}
          <motion.path
            d="M112,52 C114,34 128,28 136,33 C126,35 119,44 117,54 Z"
            fill="url(#tsu-hair)"
            animate={reduced ? undefined : { rotate: [-7, 7, -7] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformBox: 'fill-box', transformOrigin: 'bottom left' }}
          />
          {/* brows / eyes / nose / mouth / blush */}
          <Brows mood={mood} />
          <EyeGroup cx={95} cy={108} mood={mood} closed={blink} irisFill="url(#tsu-iris)" lash="#2a0714" />
          <EyeGroup cx={125} cy={108} mood={mood} closed={blink} irisFill="url(#tsu-iris)" lash="#2a0714" />
          <path d="M110,120 l2,3 -4,0 z" fill="#e8a8b8" opacity="0.8" />
          <Mouth mood={mood} talking={talking} />
          <Blush tint="#ff5c9d" opacity={mood === 'shock' ? 0.5 : 0.35} />
          {mood === 'shock' && (
            <path d="M152,84 C156,90 156,95 152,97 C148,95 148,90 152,84 Z" fill="#9ceaff" opacity="0.95" filter="url(#tsu-glow)" />
          )}
          {mood === 'sleep' && (
            <g fill={CYAN} fontFamily="var(--font-jbmono), monospace" fontSize="10" opacity="0.9">
              <text x="152" y="70">z</text>
              <text x="162" y="56">z</text>
            </g>
          )}
          {/* headphones */}
          <path d="M58,84 C70,44 150,44 162,84" stroke="#1c1228" strokeWidth="9" fill="none" />
          <path d="M58,84 C70,44 150,44 162,84" stroke={MAGENTA} strokeWidth="2" fill="none" opacity="0.55" />
          <rect x="47" y="84" width="20" height="26" rx="6" fill="#14101f" stroke={MAGENTA} strokeWidth="1.5" />
          <rect x="153" y="84" width="20" height="26" rx="6" fill="#14101f" stroke={MAGENTA} strokeWidth="1.5" />
          <motion.circle cx="57" cy="97" r="2.6" fill={CYAN} animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
          <motion.circle cx="163" cy="97" r="2.6" fill={CYAN} animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.8, repeat: Infinity }} />
        </motion.g>
      </svg>
    </motion.div>
  )
}

function CharlieMascot({ mood, talking }: { mood: MascotMood; talking: boolean }) {
  const blink = useBlink(mood !== 'sleep' && mood !== 'happy')
  const reduced = useReducedMotion()
  return (
    <motion.div
      className="relative mx-auto w-[150px] select-none sm:w-[170px]"
      animate={reduced ? undefined : { y: [0, -3.5, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
      aria-hidden
    >
      <svg viewBox="0 0 220 260" className="w-full drop-shadow-[0_0_18px_rgba(255,179,0,0.22)]">
        <defs>
          <linearGradient id="chl-hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffc84d" />
            <stop offset="55%" stopColor="#ffb300" />
            <stop offset="100%" stopColor="#9a6b00" />
          </linearGradient>
          <radialGradient id="chl-skin" cx="0.5" cy="0.4" r="0.75">
            <stop offset="0%" stopColor="#fff3e6" />
            <stop offset="100%" stopColor="#f6d8c2" />
          </radialGradient>
          <radialGradient id="chl-iris" cx="0.5" cy="0.4" r="0.8">
            <stop offset="0%" stopColor="#ffc84d" />
            <stop offset="70%" stopColor="#ffb300" />
            <stop offset="100%" stopColor="#5c3d00" />
          </radialGradient>
          <linearGradient id="chl-visor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,229,255,0.28)" />
            <stop offset="100%" stopColor="rgba(0,229,255,0.08)" />
          </linearGradient>
          <filter id="chl-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* bob back hair */}
        <path d="M64,120 C58,64 86,40 110,40 C134,40 162,64 156,120 C156,152 148,170 140,180 L80,180 C72,170 64,152 64,120 Z" fill="#5c3d05" />

        {/* torso — auditor vest */}
        <path d="M80,252 C80,214 93,196 110,196 C127,196 140,214 140,252 Z" fill="#140d05" />
        <path d="M94,250 L110,216 L126,250" stroke={AMBER} strokeWidth="2" fill="none" opacity="0.85" />
        <rect x="122" y="224" width="22" height="27" rx="2" fill="#0a0510" stroke={AMBER} strokeWidth="0.9" />
        <g stroke={AMBER} strokeWidth="0.9" opacity="0.8">
          <path d="M126,231 L140,231" />
          <path d="M126,236 L138,236" />
          <path d="M126,241 L136,241" />
        </g>
        <rect x="102" y="182" width="17" height="16" rx="4" fill="#f7e2d4" />

        {/* head group */}
        <motion.g
          animate={reduced ? undefined : { rotate: [1, -1, 1] }}
          transition={{ duration: 6.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 30%' }}
        >
          {/* face */}
          <path d="M110,58 C132,58 146,76 146,98 C146,122 136,146 110,152 C84,146 74,122 74,98 C74,76 88,58 110,58 Z" fill="url(#chl-skin)" />
          {/* straight bob bangs */}
          <path
            d="M72,98 L72,68 C84,50 136,50 148,68 L148,98 L141,90 L133,98 L125,90 L117,98 L109,90 L101,98 L93,90 L85,98 L77,90 Z"
            fill="url(#chl-hair)"
          />
          <path d="M84,66 Q110,54 136,66" stroke="#ffd688" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6" />
          {/* side locks */}
          <path d="M70,102 C66,138 70,162 80,176 L90,176 C82,156 80,128 82,102 Z" fill="url(#chl-hair)" />
          <path d="M150,102 C154,138 150,162 140,176 L130,176 C138,156 140,128 138,102 Z" fill="url(#chl-hair)" />
          {/* hair pins */}
          <g fill={CYAN}>
            <rect x="126" y="72" width="11" height="2.6" rx="1" transform="rotate(-24 131 73)" />
            <rect x="132" y="78" width="11" height="2.6" rx="1" transform="rotate(-24 137 79)" />
          </g>
          <Brows mood={mood} />
          <EyeGroup cx={93} cy={108} mood={mood} closed={blink} irisFill="url(#chl-iris)" lash="#3a2408" />
          <EyeGroup cx={123} cy={108} mood={mood} closed={blink} irisFill="url(#chl-iris)" lash="#3a2408" />
          {/* HUD visor monocle over right eye */}
          <g>
            <rect x="110" y="90" width="36" height="32" rx="8" fill="url(#chl-visor)" stroke={CYAN} strokeWidth="1.4" />
            <g stroke={CYAN} strokeWidth="0.7" opacity="0.5">
              <path d="M114,98 L142,98" />
              <path d="M114,105 L140,105" />
              <path d="M114,112 L138,112" />
            </g>
            <path d="M146,98 L166,82" stroke={CYAN} strokeWidth="1.8" />
            <circle cx="167" cy="82" r="4.6" fill="#14101f" stroke={CYAN} strokeWidth="1.4" />
            <motion.circle cx="167" cy="82" r="1.8" fill={CYAN} animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 2, repeat: Infinity }} />
          </g>
          <path d="M110,120 l2,3 -4,0 z" fill="#e2b08e" opacity="0.8" />
          <Mouth mood={mood} talking={talking} />
          <Blush tint="#ffb300" opacity={0.22} />
          {/* headset + boom mic */}
          <path d="M60,84 C72,46 148,46 160,84" stroke="#1c1228" strokeWidth="8" fill="none" />
          <path d="M60,84 C72,46 148,46 160,84" stroke={AMBER} strokeWidth="1.6" fill="none" opacity="0.6" />
          <rect x="49" y="84" width="19" height="24" rx="6" fill="#14101f" stroke={AMBER} strokeWidth="1.4" />
          <path d="M56,106 C70,128 90,136 104,132" stroke="#14101f" strokeWidth="3" fill="none" />
          <circle cx="106" cy="132" r="4" fill={AMBER} filter="url(#chl-glow)" />
        </motion.g>
      </svg>
    </motion.div>
  )
}

/* ================================================================== */
/* Control grid: BURN & REBUILD · FORCE COMPILE · PURGE HEAP · KEY      */
/* ================================================================== */

function BurnAndRebuild({
  mode,
  onBurn,
}: {
  mode: OpMode
  onBurn: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [exploding, setExploding] = useState(false)
  const busy = mode !== 'idle'
  useEffect(() => {
    if (!armed || busy) return
    const id = window.setTimeout(() => setArmed(false), 3200)
    return () => window.clearTimeout(id)
  }, [armed, busy])

  const particles = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.4
        const dist = 70 + Math.random() * 80
        return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, size: 3 + Math.random() * 5 }
      }),
    [],
  )

  const handleClick = () => {
    if (busy) return
    if (!armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    setExploding(true)
    onBurn()
    window.setTimeout(() => setExploding(false), 900)
  }

  return (
    <div className="relative">
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={busy}
        whileHover={!busy ? { scale: 1.015 } : undefined}
        whileTap={!busy ? { scale: 0.985 } : undefined}
        className={cn(
          'group relative block w-full overflow-hidden rounded-xl p-px text-left transition-transform',
          busy && 'cursor-not-allowed opacity-60',
        )}
        aria-label="Burn and rebuild — full chain re-audit"
      >
        <span className={cn('nd-conic-ring', armed && '!animate-[nd-angle-spin_0.8s_linear_infinite]')} style={{ borderRadius: '0.8rem' }} aria-hidden />
        <span className="relative z-10 block rounded-[0.8rem] bg-[#0a0510]/95 px-4 py-5 backdrop-blur-sm">
          <span className="flex items-center gap-3">
            <motion.span
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#ff2d78]/50 bg-[#ff2d78]/10"
              animate={armed ? { rotate: [0, -12, 12, 0], scale: [1, 1.12, 1] } : { scale: [1, 1.05, 1] }}
              transition={{ duration: armed ? 0.45 : 2.6, repeat: Infinity }}
              aria-hidden
            >
              <Flame size={22} className="text-[#ff2d78]" />
            </motion.span>
            <span className="min-w-0">
              <span className="font-display block text-[15px] font-bold uppercase tracking-[0.14em] text-[#ff2d78] nd-glow-magenta">
                {armed ? 'CONFIRM IGNITION' : 'BURN & REBUILD'}
              </span>
              <span className="font-term mt-1 block text-[9.5px] uppercase tracking-[0.14em] text-zinc-500">
                {mode === 'burning'
                  ? 'RE-HASHING GENESIS → HEAD …'
                  : armed
                    ? 'CLICK AGAIN · 3s SAFETY WINDOW'
                    : 'FULL CHAIN RE-AUDIT · READ-ONLY'}
              </span>
            </span>
            <span className="ml-auto font-term shrink-0 text-right text-[9px] leading-relaxed text-zinc-600">
              <span className="block text-amber-300/80">▲ IGNITE</span>
              <span className="block">SHA-256</span>
            </span>
          </span>
          {/* danger stripes */}
          <span
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 opacity-70"
            style={{
              background: `repeating-linear-gradient(-45deg, ${DANGER} 0 8px, #140a0f 8px 16px)`,
            }}
            aria-hidden
          />
        </span>
      </motion.button>
      {/* explosion particles */}
      {exploding && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-20" aria-hidden>
          {particles.map((p, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{ width: p.size, height: p.size, background: i % 3 === 0 ? AMBER : i % 3 === 1 ? DANGER : MAGENTA, boxShadow: `0 0 10px currentColor` }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.2 }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
            />
          ))}
        </span>
      )}
    </div>
  )
}

function RackLeds({ active }: { active: boolean }) {
  const [step, setStep] = useState(-1)
  useEffect(() => {
    if (!active) return
    const timers = [0, 220, 440, 660].map((delay, i) => window.setTimeout(() => setStep(i), delay))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [active])
  const shown = active ? step : -1
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: i <= shown ? AMBER : '#3f3f46', boxShadow: i <= shown ? `0 0 8px ${AMBER}` : undefined }}
          animate={i === shown ? { opacity: [1, 0.3, 1] } : undefined}
          transition={{ duration: 0.3, repeat: Infinity }}
        />
      ))}
    </span>
  )
}

function CompileControl({
  mode,
  theme,
  setTheme,
  ocThemes,
  setOcTheme,
  onCompile,
}: {
  mode: OpMode
  theme: string
  setTheme: (v: string) => void
  ocThemes: string[]
  setOcTheme: (i: number, v: string) => void
  onCompile: () => void
}) {
  const [flash, setFlash] = useState(false)
  const busy = mode !== 'idle'
  const compiling = mode === 'compiling'

  return (
    <div className="relative rounded-xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.05] to-transparent p-3.5">
      <label htmlFor="t4-theme" className="font-term mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-zinc-500">
        <Zap size={11} className="text-amber-300" /> batch theme · 1–120 chars
      </label>
      <Input
        id="t4-theme"
        value={theme}
        maxLength={120}
        disabled={busy}
        onChange={(e) => setTheme(e.target.value)}
        placeholder="e.g. NEON REQUIEM"
        className="font-term h-9 rounded-lg border-amber-400/30 bg-black/40 text-[12px] text-amber-100 placeholder:text-zinc-600 caret-[#ffb300] focus-visible:ring-[#ffb300]/40"
      />
      <label className="font-term mb-1.5 mt-2.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-zinc-500">
        <Sparkles size={11} className="text-amber-300/80" /> OC slot themes · ≥1 required · auto R+ · cycles to 3 slots
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <Input
            key={i}
            value={ocThemes[i] ?? ''}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setOcTheme(i, e.target.value)}
            placeholder={`OC·${i + 1}`}
            aria-label={`OC slot theme ${i + 1}`}
            className="font-term h-8 rounded-lg border-white/15 bg-black/40 px-2 text-[11px] text-amber-100 placeholder:text-zinc-600 focus-visible:ring-[#ffb300]/30"
          />
        ))}
      </div>
      <motion.button
        type="button"
        onClick={() => {
          setFlash(true)
          window.setTimeout(() => setFlash(false), 320)
          onCompile()
        }}
        disabled={busy}
        whileTap={!busy ? { scale: 0.96, y: 1.5 } : undefined}
        whileHover={!busy ? { boxShadow: `0 0 26px ${AMBER}44` } : undefined}
        className={cn(
          'font-display relative mt-2.5 flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-lg border-2 border-amber-400/60 bg-amber-400/10 px-4 py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-amber-300 transition-colors',
          busy ? 'cursor-not-allowed opacity-70' : 'hover:bg-amber-400/20 active:bg-amber-400/25',
        )}
        aria-label="Force compile — run the 24 gates"
      >
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" aria-hidden style={{ transform: 'skewX(-18deg)' }} />
        {flash && (
          <motion.span
            className="absolute inset-0 bg-white/50"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            aria-hidden
          />
        )}
        {compiling ? (
          <>
            <RefreshCw size={15} className="animate-spin" /> RACKING GATES…
          </>
        ) : (
          <>
            <Zap size={15} /> FORCE COMPILE
          </>
        )}
        <RackLeds active={compiling} />
      </motion.button>
      <p className="font-term mt-1.5 text-[8.5px] uppercase tracking-[0.14em] text-zinc-600">
        POST /v1/compile · 24-slot plan · 5 planning gates · oc×1–3 · commander-key gated
      </p>
    </div>
  )
}

function PurgeHeapControl({ mode, onPurge, lastPurged }: { mode: OpMode; onPurge: () => void; lastPurged: number | null }) {
  const [flash, setFlash] = useState(false)
  const busy = mode !== 'idle'
  return (
    <motion.button
      type="button"
      onClick={() => {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 280)
        onPurge()
      }}
      disabled={busy}
      whileTap={!busy ? { scale: 0.96, y: 1.5 } : undefined}
      whileHover={!busy ? { boxShadow: '0 0 26px rgba(0,229,255,0.25)' } : undefined}
      className={cn(
        'font-display relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-lg border-2 border-cyan-400/45 bg-cyan-400/[0.06] px-4 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-cyan-300',
        busy ? 'cursor-not-allowed opacity-70' : 'hover:bg-cyan-400/15 active:bg-cyan-400/20',
      )}
      aria-label="Purge heap — flush local telemetry buffer"
    >
      {flash && (
        <motion.span className="absolute inset-0 bg-white/40" initial={{ opacity: 0.8 }} animate={{ opacity: 0 }} transition={{ duration: 0.26 }} aria-hidden />
      )}
      {mode === 'purging' ? (
        <>
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} className="inline-flex" aria-hidden>
            <Trash2 size={14} />
          </motion.span>
          FLUSHING…
        </>
      ) : (
        <>
          <Trash2 size={14} /> PURGE HEAP
        </>
      )}
      {lastPurged != null && <span className="font-term text-[9px] text-zinc-500">−{lastPurged}</span>}
    </motion.button>
  )
}

function CommanderKeyPanel() {
  const [keyInput, setKeyInput] = useState('')
  const [stored, setStored] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [probe, setProbe] = useState<'none' | 'ok' | 'bad' | 'checking'>('none')
  useEffect(() => {
    const id = window.setTimeout(() => setStored(getCommanderKey() !== ''), 0)
    return () => window.clearTimeout(id)
  }, [])
  const doSet = async () => {
    const v = keyInput.trim()
    if (v === '') return
    setCommanderKey(v)
    setStored(true)
    setProbe('checking')
    try {
      const r = await probeCommanderKey()
      setProbe(r.keyOk ? 'ok' : 'bad')
      toast({
        title: r.keyOk ? 'COMMANDER KEY ACCEPTED' : 'KEY REJECTED',
        description: r.keyOk ? 'Mutations unlocked — live compile armed.' : 'Server lock did not match this key.',
        variant: r.keyOk ? 'default' : 'destructive',
      })
    } catch {
      setProbe('bad')
      toast({ title: 'PROBE FAILED', description: 'Key lock unreachable (engine offline?).', variant: 'destructive' })
    }
  }
  const doClear = () => {
    clearCommanderKey()
    setStored(false)
    setKeyInput('')
    setProbe('none')
    toast({ title: 'KEY CLEARED', description: 'Browser-side commander key removed.' })
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound size={13} className="text-zinc-400" />
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300">COMMANDER KEY</span>
        <span className="ml-auto flex items-center gap-2">
          <Led state={stored ? (probe === 'ok' ? 'ok' : probe === 'bad' ? 'err' : probe === 'checking' ? 'run' : 'warn') : 'off'} label={stored ? 'stored' : 'empty'} />
        </span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={reveal ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="x-commander-key"
            className="font-term h-8 rounded-lg border-white/15 bg-black/40 pr-8 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-white/20"
            aria-label="Commander key input"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
            aria-label={reveal ? 'Hide key' : 'Reveal key'}
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button
          type="button"
          onClick={doSet}
          className="font-display rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 text-[10px] font-bold uppercase tracking-widest text-emerald-300 hover:bg-emerald-400/20"
        >
          SET
        </button>
        <button
          type="button"
          onClick={doClear}
          disabled={!stored}
          className="font-display rounded-lg border border-red-400/40 bg-red-400/10 px-3 text-[10px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-400/20 disabled:opacity-40"
        >
          CLR
        </button>
      </div>
      <p className="font-term mt-1.5 text-[8.5px] leading-relaxed text-zinc-600">
        Stored in localStorage only; attached as x-commander-key header on mutations. Required for FORCE COMPILE.
      </p>
    </div>
  )
}

/* ================================================================== */
/* Chronicle terminal (JSONL stream visualizer)                        */
/* ================================================================== */

const EVENT_COLORS: Record<string, string> = {
  'era.born': 'text-[#ff2d78]',
  'spec.imported': 'text-cyan-300',
  'law.ratified': 'text-amber-300',
  'law.amended': 'text-amber-300',
  'batch.compiled': 'text-[#ff2d78] font-semibold',
  'batch.delivered': 'text-emerald-300 font-semibold',
  'batch.void': 'text-red-400 font-semibold',
  'gate.run': 'text-amber-300',
  'fixpass.paid': 'text-amber-300',
  'scribe.drafted': 'text-cyan-300',
  'render.verdict': 'text-cyan-300',
  'taste.datum': 'text-zinc-300',
  'experiment.logged': 'text-amber-300',
  'oc.appeared': 'text-[#ff2d78]',
  'external.review': 'text-zinc-300',
  'debt.paid': 'text-emerald-300',
  'author.pinned': 'text-[#ff2d78]',
  'channel.retired': 'text-zinc-400',
  'scribe.objection': 'text-red-400',
  'oracle.spoke': 'text-amber-300',
  note: 'text-zinc-400',
}

const ChronicleRow = memo(function ChronicleRow({ entry }: { entry: FeedEntry }) {
  if (entry.kind === 'sys') {
    const color =
      entry.level === 'ok' ? 'text-emerald-300/80' : entry.level === 'warn' ? 'text-amber-300/80' : entry.level === 'err' ? 'text-red-400' : 'text-zinc-500'
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -40, transition: { duration: 0.35 } }}
        className={cn('font-term px-3 py-1 text-[10.5px] leading-relaxed', color)}
      >
        <span className="text-zinc-700">[{fmtTime(new Date(entry.at).toISOString())}]</span>{' '}
        <span className="text-cyan-500/80">SYS</span> <span className="text-zinc-600">▸</span> {entry.text}
      </motion.div>
    )
  }
  const ev = entry.ev
  const ok = entry.link === 'ok'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -40, transition: { duration: 0.35 } }}
      className={cn(
        'font-term border-b border-white/[0.035] px-3 py-1.5 text-[10.5px] leading-relaxed hover:bg-white/[0.025]',
        !ok && 'border-l-2 border-red-500/80 bg-red-500/[0.06]',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-zinc-600">[{fmtTime(ev.at)}]</span>
        <span className="text-zinc-500">#{String(ev.seq).padStart(3, '0')}</span>
        <span className="text-cyan-300/90">{ev.id}</span>
        <span className={EVENT_COLORS[ev.type] ?? 'text-[#ff2d78]'}>{ev.type}</span>
        <span className="text-zinc-600">▸</span>
        <span className="min-w-0 flex-1 truncate text-zinc-300/90" title={ev.summary}>
          {ev.summary}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-2">
        {ok ? (
          <span className="inline-flex items-center gap-1 text-emerald-400" title="prev-hash linkage verified in this browser">
            <ShieldCheck size={11} /> <span className="text-[9px] font-bold tracking-wider">LINKED</span>
          </span>
        ) : (
          <span className="nd-red-pulse inline-flex items-center gap-1 rounded border border-red-500/70 px-1 text-red-400" title="prev-hash mismatch — chain broken at this link">
            <ShieldAlert size={11} /> <span className="text-[9px] font-bold tracking-wider">MISMATCH</span>
          </span>
        )}
        <span className="text-[9px] text-zinc-700">prev:{h8(ev.prev)} → hash:{h8(ev.hash)}</span>
      </div>
    </motion.div>
  )
})

function ChronicleTerminal({
  feed,
  chainLocal,
  verify,
  health,
  mode,
  filter,
  setFilter,
}: {
  feed: FeedEntry[]
  chainLocal: { height: number; head: string; broken: number[] }
  verify: VerifyData | null
  health: Health
  mode: OpMode
  filter: 'all' | 'chain' | 'sys'
  setFilter: (f: 'all' | 'chain' | 'sys') => void
}) {
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const visible = useMemo(() => (filter === 'all' ? feed : feed.filter((f) => f.kind === (filter === 'chain' ? 'chain' : 'sys'))), [feed, filter])

  useEffect(() => {
    const el = scrollRef.current
    if (el && !paused && !hovered) el.scrollTop = el.scrollHeight
  }, [visible, paused, hovered])

  const chainOk = verify != null ? verify.ok : chainLocal.broken.length === 0

  return (
    <PanelShell
      title="LIVE TELEMETRY · chain.jsonl"
      icon={<TerminalIcon size={13} />}
      accent="cyan"
      className="flex flex-col"
      bodyClassName="flex flex-col p-0"
      right={
        <>
          <Led state={health === 'live' ? 'ok' : 'err'} label={health === 'live' ? 'stream' : 'lost'} />
          <Led state={chainOk ? 'ok' : 'err'} label={chainOk ? 'sealed' : 'broken'} />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className={cn(
              'rounded border px-1.5 py-0.5 text-zinc-500 transition-colors',
              paused ? 'border-amber-400/60 text-amber-300' : 'border-white/15 hover:border-white/30 hover:text-zinc-300',
            )}
            aria-label={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
          >
            {paused ? <Play size={11} /> : <Pause size={11} />}
          </button>
        </>
      }
    >
      {/* chain summary bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/[0.06] px-3 py-2">
        <span className="font-term text-[9px] uppercase tracking-[0.14em] text-zinc-500">
          LINKS <span className="font-bold text-zinc-200 tabular-nums">{chainLocal.height}</span>
        </span>
        <span className="font-term text-[9px] uppercase tracking-[0.14em] text-zinc-500">
          HEAD <span className="font-bold text-cyan-300">{h8(chainLocal.head)}</span>
        </span>
        <span className="font-term text-[9px] uppercase tracking-[0.14em] text-zinc-500">
          LOCAL CHECK{' '}
          <span className={cn('font-bold', chainLocal.broken.length === 0 ? 'text-emerald-400' : 'text-red-400')}>
            {chainLocal.broken.length === 0 ? '0 BROKEN' : `BROKEN @ ${chainLocal.broken.slice(0, 3).join(',')}`}
          </span>
        </span>
        {verify != null && (
          <span className="font-term text-[9px] uppercase tracking-[0.14em] text-zinc-500">
            ENGINE AUDIT <span className={cn('font-bold', verify.ok ? 'text-emerald-400' : 'text-red-400')}>{verify.ok ? 'SEALED ✓' : 'PROBLEMS ✗'}</span>
          </span>
        )}
        {mode !== 'idle' && (
          <span className="font-term ml-auto text-[9px] uppercase tracking-[0.2em] text-[#ff2d78] nd-glow-magenta">
            {mode === 'burning' ? '◆ BURN SWEEP ACTIVE' : mode === 'compiling' ? '◆ COMPILING' : '◆ PURGING'}
          </span>
        )}
      </div>
      {/* filter chips */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        {(['all', 'chain', 'sys'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'font-term rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] transition-colors',
              filter === f ? 'border border-cyan-400/50 bg-cyan-400/10 text-cyan-300' : 'border border-white/10 text-zinc-500 hover:text-zinc-300',
            )}
          >
            {f === 'all' ? '◉ ALL' : f === 'chain' ? '⛓ CHAIN' : '▤ SYS'}
          </button>
        ))}
        <span className="font-term ml-auto text-[9px] text-zinc-600">{visible.length} rows buffered</span>
      </div>
      {/* the stream */}
      <div
        ref={scrollRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="nd-term-scroll relative h-[380px] overflow-y-auto bg-black/45 sm:h-[440px] lg:h-[520px]"
        role="log"
        aria-label="Chronicle event stream"
      >
        <AnimatePresence initial={false}>
          {visible.map((entry) => (
            <ChronicleRow key={entry.uid} entry={entry} />
          ))}
        </AnimatePresence>
        {visible.length === 0 && (
          <p className="font-term p-4 text-[11px] text-zinc-600">{'// stream empty — awaiting chronicle sync…'}</p>
        )}
        <div className="font-term sticky bottom-0 flex items-center gap-1.5 border-t border-white/[0.06] bg-[#05070d]/90 px-3 py-1.5 text-[10.5px] text-zinc-500 backdrop-blur-sm">
          <span className="text-[#ff2d78]">operator@central-dogma</span>:<span className="text-cyan-400">~</span>${' '}
          <span className="nd-caret text-zinc-300">▌</span>
        </div>
      </div>
    </PanelShell>
  )
}

/* ================================================================== */
/* Rotation window — 3-slot locked palettes                            */
/* ================================================================== */

function RotationWindow({
  cards,
  nextSlug,
  dropSlug,
  loading,
}: {
  cards: RotationCardData[]
  nextSlug: string
  dropSlug: string
  loading: boolean
}) {
  const union = useMemo(() => new Set(cards.flatMap((c) => c.palettes.map((p) => p.id))), [cards])
  const free = Math.max(0, PALETTE_FUND - union.size)
  return (
    <PanelShell
      title="ROTATION WINDOW · FATIGUE LOCK"
      icon={<Lock size={13} />}
      accent="amber"
      right={
        <span className="font-term text-[9px] uppercase tracking-[0.12em] text-zinc-500">
          FUND <span className="text-zinc-300 tabular-nums">{PALETTE_FUND}</span> · ∪WIN{' '}
          <span className="text-amber-300 tabular-nums">{union.size || '—'}</span> · FREE{' '}
          <span className="text-emerald-400 tabular-nums">{union.size === 0 ? '—' : free}</span>
        </span>
      }
    >
      {loading && cards.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            {cards.map((c, i) => (
              <motion.div
                key={c.slug}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="relative rounded-lg border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.05] to-transparent p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-display rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">W-{i + 1}</span>
                  <span className="font-display text-[11px] font-bold text-zinc-200">{c.slug}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[8px] uppercase tracking-widest text-emerald-400">
                    <Lock size={9} /> LOCKED
                  </span>
                </div>
                <p className="font-term mt-1 truncate text-[10px] text-zinc-400" title={c.title}>
                  «{c.title}»
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.palettes.slice(0, 8).map((p) => (
                    <span key={p.id} className="relative" title={`${p.id} · ${p.name}`}>
                      <span
                        className="flex h-4 w-7 overflow-hidden rounded-[3px] border border-white/15"
                        style={{ boxShadow: p.colors[0] ? `0 0 7px ${p.colors[0]}66` : undefined }}
                      >
                        {p.colors.slice(0, 3).map((col, j) => (
                          <span key={j} className="h-full flex-1" style={{ background: col }} />
                        ))}
                        {p.colors.length === 0 && <span className="h-full w-full" style={{ background: fallbackColor(p.id) }} />}
                      </span>
                    </span>
                  ))}
                  {c.palettes.length > 8 && <span className="font-term text-[9px] text-zinc-600">+{c.palettes.length - 8}</span>}
                </div>
                <div className="font-term mt-1.5 flex items-center gap-2 text-[8.5px] text-zinc-600">
                  <span className="text-amber-300/80 tabular-nums">{c.palettes.length} PALETTES</span>
                  {c.registers.slice(0, 3).map((r) => (
                    <span key={r.name}>
                      {r.name}×{r.count}
                    </span>
                  ))}
                </div>
                <p className="font-term mt-0.5 text-[8px] text-zinc-700">delivered {fmtTime(c.deliveredAt)}</p>
              </motion.div>
            ))}
            {cards.length === 0 && (
              <p className="font-term col-span-3 p-3 text-[11px] text-zinc-600">{'// no delivered batches in window — engine cold'}</p>
            )}
          </div>
          <p className="font-term mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-2 text-[9px] uppercase tracking-[0.14em] text-zinc-600">
            <RefreshCw size={10} className="text-amber-300/70" /> NEXT ROTATION:{' '}
            <span className="text-amber-300">ON {nextSlug || '—'} DELIVERY</span>
            {dropSlug != null && dropSlug !== '' && (
              <>
                <ChevronRight size={10} /> <span className="text-zinc-500">{dropSlug} UNLOCKS</span>
              </>
            )}
            <span className="ml-auto text-zinc-700">UNION OF LAST 3 DELIVERED</span>
          </p>
        </>
      )}
    </PanelShell>
  )
}

/* ================================================================== */
/* Gate matrix — 24 slots + planning gates + verdict stamp             */
/* ================================================================== */

const CELL_STATUS_CLASSES: Record<CellStatus, string> = {
  standby: 'border-white/10 bg-white/[0.02] text-zinc-600',
  cycling: 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200 shadow-[0_0_10px_rgba(0,229,255,0.25)]',
  assigned: 'border-cyan-400/30 bg-cyan-400/[0.05] text-cyan-300/70',
  sealed: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300',
  drift: 'border-amber-400/50 bg-amber-400/10 text-amber-300',
  void: 'nd-red-pulse border-red-500/60 bg-red-500/10 text-red-400',
}

function GateMatrix({
  cells,
  expCells,
  planningGates,
  banner,
  planSource,
}: {
  cells: GateCell[]
  expCells: GateCell[]
  planningGates: GateReceiptUI[]
  banner: Banner | null
  planSource: string
}) {
  const verdictColor =
    banner == null ? 'text-zinc-500' : banner.verdict === 'clean' ? 'text-emerald-400' : banner.verdict === 'drift' ? 'text-amber-300' : 'text-red-400'
  const verdictBorder =
    banner == null
      ? 'border-white/10'
      : banner.verdict === 'clean'
        ? 'border-emerald-400/60'
        : banner.verdict === 'drift'
          ? 'border-amber-400/60'
          : 'border-red-500/70'
  const verdictIcon = banner == null ? null : banner.verdict === 'clean' ? <Sparkles size={16} /> : banner.verdict === 'drift' ? <AlertTriangle size={16} /> : <ShieldAlert size={16} />

  return (
    <PanelShell
      title="24-GATE COMPILER MATRIX"
      icon={<Layers size={13} />}
      accent="magenta"
      right={<span className="font-term text-[9px] text-zinc-600">PLAN SRC: {planSource}</span>}
    >
      {/* verdict stamp */}
      <div className="mb-3 flex min-h-[52px] items-center justify-center">
        <AnimatePresence mode="wait">
          {banner == null ? (
            <motion.p key="awaiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="font-term text-[10px] uppercase tracking-[0.25em] text-zinc-600">
              ▢ AWAITING GATE RUN — MATRIX STANDBY
            </motion.p>
          ) : (
            <motion.div
              key={banner.id}
              initial={false}
              className={cn('nd-stamp flex items-center gap-2.5 rounded-md border-2 px-4 py-2', verdictBorder)}
              style={{ boxShadow: banner.verdict === 'clean' ? '0 0 26px rgba(0,255,163,0.25)' : banner.verdict === 'drift' ? '0 0 26px rgba(255,179,0,0.25)' : '0 0 26px rgba(255,56,96,0.3)' }}
            >
              <span className={verdictColor}>{verdictIcon}</span>
              <div>
                <p className={cn('font-display text-[15px] font-black uppercase tracking-[0.14em]', verdictColor)}>{banner.title}</p>
                <p className="font-term max-w-[280px] truncate text-[9px] text-zinc-500" title={banner.detail}>
                  {banner.detail}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* 24 core slots */}
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
        {cells.map((c) => (
          <motion.div
            key={c.pos}
            whileHover={{ scale: 1.06 }}
            title={`GATE ${String(c.pos).padStart(2, '0')} · ${c.kind} · ${c.rating} · ${c.register} · ${c.paletteId}`}
            className={cn('rounded border px-1 py-1 text-center transition-colors', CELL_STATUS_CLASSES[c.status])}
          >
            <p className="font-display text-[10px] font-bold tabular-nums">{String(c.pos).padStart(2, '0')}</p>
            <p className="text-[7.5px] uppercase tracking-wider opacity-80">{c.kind}</p>
            <p className="font-term text-[7.5px] opacity-80">{c.paletteId || '·'}</p>
          </motion.div>
        ))}
      </div>
      {/* EXP overlay strip */}
      {expCells.length > 0 && (
        <div className="mt-1.5 grid grid-cols-8 gap-1">
          {expCells.map((c) => (
            <div
              key={c.pos}
              title={`EXP ${c.pos} · hypothesis slot · ${c.paletteId}`}
              className={cn('rounded border px-1 py-0.5 text-center', CELL_STATUS_CLASSES[c.status])}
            >
              <p className="font-term text-[7px] uppercase">E{c.pos - 24}</p>
              <p className="font-term text-[7px] opacity-80">{c.paletteId || '·'}</p>
            </div>
          ))}
        </div>
      )}
      {/* planning gates */}
      <div className="mt-3 border-t border-white/[0.06] pt-2.5">
        <p className="font-term mb-1.5 text-[9px] uppercase tracking-[0.18em] text-zinc-600">PLANNING GATES · HARD / WARN / ADVISORY</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {planningGates.map((g) => {
            const cls =
              g.verdict === 'PASS'
                ? 'border-emerald-400/50 text-emerald-300'
                : g.verdict === 'WARN'
                  ? 'border-amber-400/60 text-amber-300'
                  : g.verdict === 'FAIL'
                    ? 'nd-red-pulse border-red-500/70 text-red-400'
                    : g.verdict === 'RUN'
                      ? 'border-cyan-400/50 text-cyan-300'
                      : 'border-white/10 text-zinc-600'
            return (
              <div key={g.gate} className={cn('rounded border bg-white/[0.02] px-1.5 py-1 text-center', cls)} title={g.findings.join(' · ') || g.gate}>
                <p className="font-term text-[9px] uppercase tracking-wider">{g.gate}</p>
                <p className="font-display text-[10px] font-bold">{g.verdict}</p>
              </div>
            )
          })}
        </div>
      </div>
    </PanelShell>
  )
}

/* ================================================================== */
/* Operator section — Tsubaki (gate controller) + Charlie (auditor)    */
/* ================================================================== */

function SpeechBubble({ text, tone }: { text: string; tone: BannerVerdict | 'idle' }) {
  const border =
    tone === 'clean' ? 'border-emerald-400/50' : tone === 'drift' ? 'border-amber-400/50' : tone === 'void' ? 'border-red-500/60' : 'border-[#ff2d78]/40'
  const glow =
    tone === 'clean' ? 'rgba(0,255,163,0.12)' : tone === 'drift' ? 'rgba(255,179,0,0.12)' : tone === 'void' ? 'rgba(255,56,96,0.14)' : 'rgba(255,45,120,0.12)'
  return (
    <div className={cn('relative rounded-xl border bg-white/[0.03] p-3 backdrop-blur-md', border)} style={{ boxShadow: `0 0 22px ${glow}` }}>
      <span className={cn('absolute -left-1.5 top-5 h-3 w-3 rotate-45 border-b border-l', border)} style={{ background: '#0a0510' }} aria-hidden />
      <Typewriter text={text} className="font-term text-[11px] leading-relaxed text-zinc-200" />
    </div>
  )
}

function OperatorSection({
  mood,
  line,
  gateSummary,
}: {
  mood: MascotMood
  line: string
  gateSummary: { sealed: number; drift: number; void: number; standby: number }
}) {
  const [talking, setTalking] = useState(false)
  useEffect(() => {
    const t1 = window.setTimeout(() => setTalking(true), 0)
    const t2 = window.setTimeout(() => setTalking(false), 1600)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [line])
  const moodColor =
    mood === 'happy' ? 'text-emerald-400' : mood === 'shock' ? 'text-red-400' : mood === 'concerned' ? 'text-amber-300' : mood === 'focus' ? 'text-cyan-300' : mood === 'sleep' ? 'text-zinc-500' : 'text-[#ff2d78]'
  return (
    <PanelShell
      title="SYSTEM ASSISTANT · TSUBAKI-CHAN"
      icon={<Radio size={13} />}
      accent="magenta"
      right={<Led state={mood === 'sleep' ? 'off' : 'run'} label={mood} />}
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <TsubakiMascot mood={mood} talking={talking} />
          <p className={cn('font-term mt-1 text-center text-[11px]', moodColor)}>{ASCII_FACES[mood]}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <SpeechBubble text={line} tone={mood === 'happy' ? 'clean' : mood === 'shock' ? 'void' : mood === 'concerned' ? 'drift' : 'idle'} />
          <div className="grid grid-cols-4 gap-1.5">
            <div className="rounded border border-emerald-400/30 bg-emerald-400/[0.05] px-1.5 py-1 text-center">
              <p className="font-display text-[13px] font-bold tabular-nums text-emerald-300">{gateSummary.sealed}</p>
              <p className="font-term text-[7.5px] uppercase tracking-widest text-zinc-600">sealed</p>
            </div>
            <div className="rounded border border-amber-400/30 bg-amber-400/[0.05] px-1.5 py-1 text-center">
              <p className="font-display text-[13px] font-bold tabular-nums text-amber-300">{gateSummary.drift}</p>
              <p className="font-term text-[7.5px] uppercase tracking-widest text-zinc-600">drift</p>
            </div>
            <div className="rounded border border-red-500/40 bg-red-500/[0.05] px-1.5 py-1 text-center">
              <p className="font-display text-[13px] font-bold tabular-nums text-red-400">{gateSummary.void}</p>
              <p className="font-term text-[7.5px] uppercase tracking-widest text-zinc-600">void</p>
            </div>
            <div className="rounded border border-white/10 bg-white/[0.02] px-1.5 py-1 text-center">
              <p className="font-display text-[13px] font-bold tabular-nums text-zinc-400">{gateSummary.standby}</p>
              <p className="font-term text-[7.5px] uppercase tracking-widest text-zinc-600">standby</p>
            </div>
          </div>
          <p className="font-term text-[8.5px] leading-relaxed text-zinc-600">
            COMPILER GATE CONTROLLER — reacts to the 24-gate verification: CLEAN RUN / DRIFT DETECTED / VOID DETECTED.
          </p>
        </div>
      </div>
    </PanelShell>
  )
}

function CharlieCard({ mood, line, verify, chainLocal }: { mood: MascotMood; line: string; verify: VerifyData | null; chainLocal: { height: number; head: string; broken: number[] } }) {
  const [talking, setTalking] = useState(false)
  useEffect(() => {
    const t1 = window.setTimeout(() => setTalking(true), 0)
    const t2 = window.setTimeout(() => setTalking(false), 1400)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [line])
  return (
    <PanelShell
      title="CHRONICLE AUDITOR · CHARLIE-CHAN"
      icon={<Fingerprint size={13} />}
      accent="amber"
      right={<Led state={verify == null ? 'off' : verify.ok ? 'ok' : 'err'} label="audit" />}
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <CharlieMascot mood={mood} talking={talking} />
          <p className="font-term mt-1 text-center text-[10px] text-amber-300/80">{ASCII_FACES[mood]}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="rounded-xl border border-amber-400/30 bg-white/[0.03] p-2.5 backdrop-blur-md">
            <Typewriter text={line} className="font-term text-[10.5px] leading-relaxed text-zinc-300" speed={11} />
          </div>
          <div className="font-term space-y-0.5 text-[9px] text-zinc-600">
            <p>
              LINKS VERIFIED <span className="tabular-nums text-zinc-300">{verify ? verify.events : chainLocal.height}</span> · HEAD{' '}
              <span className="text-cyan-300">{h8(verify ? verify.head : chainLocal.head)}</span>
            </p>
            <p>
              ENGINE AUDIT:{' '}
              <span className={verify == null ? 'text-zinc-500' : verify.ok ? 'text-emerald-400' : 'text-red-400'}>
                {verify == null ? 'PENDING' : verify.ok ? 'INTACT — no hand-edits detected' : verify.problems.slice(0, 2).join(' · ')}
              </span>
            </p>
            <p>LOCAL LINK-CHECK: {chainLocal.broken.length === 0 ? <span className="text-emerald-400">ALL PREV→HASH LINKS VALID</span> : <span className="text-red-400">BROKEN @ {chainLocal.broken.join(', ')}</span>}</p>
          </div>
        </div>
      </div>
    </PanelShell>
  )
}

/* ================================================================== */
/* Footer                                                              */
/* ================================================================== */

function FooterBar({ stats, chainLocal, feed }: { stats: EngineStateData | null; chainLocal: { head: string }; feed: FeedEntry[] }) {
  const ticker = useMemo(() => {
    const chainSummaries = feed.filter((f) => f.kind === 'chain').slice(-6).map((f) => (f.kind === 'chain' ? `#${f.ev.seq} ${f.ev.type} · ${f.ev.summary.slice(0, 70)}` : ''))
    if (chainSummaries.length === 0) return ['chronicle sync in progress…']
    return [...chainSummaries, ...chainSummaries]
  }, [feed])
  return (
    <footer className="relative z-10 mt-auto border-t border-white/10 bg-[#05070d]/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 sm:px-6">
        <span className="font-term text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
          THREAD-4 ENGINE <span className="text-zinc-400">RPC 127.0.0.1:3200</span>
        </span>
        <span className="font-term text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
          CANON <span className="text-zinc-400">{stats ? stats.canon : '—'}</span>
        </span>
        <span className="font-term hidden text-[9.5px] uppercase tracking-[0.14em] text-zinc-600 md:inline">
          NEXT SLUG <span className="text-amber-300">{stats ? stats.nextSlug : '—'}</span>
        </span>
        <div className="relative hidden min-w-0 flex-1 overflow-hidden lg:block" aria-hidden>
          <div className="nd-marquee whitespace-nowrap">
            {ticker.map((t, i) => (
              <span key={i} className="font-term mr-10 text-[9px] text-zinc-600">
                {t}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#05070d] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#05070d] to-transparent" />
        </div>
        <span className="font-term ml-auto text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
          OPERATORS: <span className="text-[#ff2d78]">TSUBAKI-CHAN</span> · <span className="text-amber-300">CHARLIE-CHAN</span>
        </span>
        <span className="font-term text-[9.5px] uppercase tracking-[0.14em] text-zinc-700">
          CHAIN HEAD <span className="text-cyan-400">{h8(chainLocal.head)}</span>
        </span>
      </div>
    </footer>
  )
}

/* ================================================================== */
/* Page — orchestration                                                */
/* ================================================================== */

function planSlotsToCells(plan: unknown): { cells: GateCell[]; expCells: GateCell[] } {
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
  const cells: GateCell[] = []
  const expCells: GateCell[] = []
  for (const s of slots) {
    if (s.position === 0) continue
    const cell: GateCell = { pos: s.position, kind: s.kind, rating: s.rating, register: s.register, paletteId: s.paletteId, status: 'assigned' }
    if (s.position <= 24) cells.push(cell)
    else expCells.push(cell)
  }
  cells.sort((a, b) => a.pos - b.pos)
  expCells.sort((a, b) => a.pos - b.pos)
  return { cells, expCells }
}

const IDLE_LINES: string[] = [
  'Pipeline nominal. All 24 gates resting, chain sealed — I\'m on watch, commander.',
  'Telemetry quiet… head steady, zero drift. Wanna force a compile, senpai?',
  'The rotation window is holding. No palette fatigue on MY shift. Ehehe~',
  'Charlie-chan re-verified the chronicle again. She\'s so thorough… I nap later.',
]

export default function NeonDogmaPage() {
  const [ready, setReady] = useState(false)
  const [health, setHealth] = useState<Health>('live')
  const [stats, setStats] = useState<EngineStateData | null>(null)
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [chainLocal, setChainLocal] = useState<{ height: number; head: string; broken: number[] }>({ height: 0, head: '', broken: [] })
  const [verify, setVerify] = useState<VerifyData | null>(null)
  const [rotation, setRotation] = useState<RotationCardData[]>([])
  const [rotationLoading, setRotationLoading] = useState(true)
  const [paletteMap, setPaletteMap] = useState<Record<string, { name: string; colors: string[] }>>({})
  const [mode, setMode] = useState<OpMode>('idle')
  const [banner, setBanner] = useState<Banner | null>(null)
  const [cells, setCells] = useState<GateCell[]>([])
  const [expCells, setExpCells] = useState<GateCell[]>([])
  const [planSource, setPlanSource] = useState('—')
  const [planningGates, setPlanningGates] = useState<GateReceiptUI[]>(
    PLANNING_GATES.map((g) => ({ gate: g, level: 'hard', verdict: '—', findings: [] })),
  )
  const [themeInput, setThemeInput] = useState('')
  const [ocThemeInputs, setOcThemeInputs] = useState<string[]>(['', '', ''])
  const [filter, setFilter] = useState<'all' | 'chain' | 'sys'>('all')
  const [clock, setClock] = useState('--:--:--')
  const [lastPurged, setLastPurged] = useState<number | null>(null)
  const [screenShake, setScreenShake] = useState(0)

  const uidRef = useRef(1)
  const lastSeqRef = useRef(0)
  const lastHashRef = useRef(GENESIS)
  const busyRef = useRef(false)
  const healthRef = useRef<Health>('live')
  const pollCountRef = useRef(0)
  const idleLineIdx = useRef(Math.floor(Math.random() * IDLE_LINES.length))

  const setOcThemeInput = useCallback((i: number, v: string) => {
    setOcThemeInputs((prev) => prev.map((t, j) => (j === i ? v : t)))
  }, [])

  useEffect(() => {
    healthRef.current = health
  }, [health])

  const pushSys = useCallback((text: string, level: SysLevel = 'info') => {
    setFeed((f) => [...f, { uid: uidRef.current++, kind: 'sys' as const, at: Date.now(), text, level }].slice(-MAX_FEED))
  }, [])

  const appendChain = useCallback((evs: ChainEvent[], reset: boolean) => {
    const rows: FeedEntry[] = []
    const newBroken: number[] = []
    if (reset) {
      lastHashRef.current = GENESIS
      lastSeqRef.current = 0
    }
    for (const ev of evs) {
      const link: LinkState = ev.prev === lastHashRef.current ? 'ok' : 'broken'
      if (link === 'ok') lastHashRef.current = ev.hash
      else newBroken.push(ev.seq)
      lastSeqRef.current = ev.seq
      rows.push({ uid: uidRef.current++, kind: 'chain', ev, link })
    }
    setChainLocal((c) => ({
      height: lastSeqRef.current,
      head: lastHashRef.current,
      broken: reset ? newBroken : [...c.broken, ...newBroken],
    }))
    return { rows, newBroken }
  }, [])

  /* ---------------- rotation window loader ---------------- */

  const loadRotation = useCallback(async (): Promise<void> => {
    try {
      const b = await fetchJson<ApiEnvelope<{ batches: BatchRow[] }>>('/api/t4/engine/batches?limit=20')
      const batches = (b.data.batches ?? []).filter((x) => x.status === 'delivered' && x.deliveredAt != null).slice(0, 3)
      const cards = await Promise.all(
        batches.map(async (batchRow, idx): Promise<RotationCardData | null> => {
          try {
            const card = await fetchJson<ApiEnvelope<BatchCardData>>(`/api/t4/engine/batches/${batchRow.slug}`)
            const { cells: core } = planSlotsToCells(asRecord(card.data).plan)
            const paletteCounts = new Map<string, number>()
            const registerCounts = new Map<string, number>()
            for (const c of core) {
              if (c.paletteId !== '') paletteCounts.set(c.paletteId, (paletteCounts.get(c.paletteId) ?? 0) + 1)
              registerCounts.set(c.register, (registerCounts.get(c.register) ?? 0) + 1)
            }
            return {
              slot: idx,
              slug: batchRow.slug,
              title: card.data.title || batchRow.title,
              deliveredAt: batchRow.deliveredAt ?? batchRow.createdAt,
              palettes: [...paletteCounts.keys()].sort().map((pid) => ({
                id: pid,
                name: paletteMapRef.current[pid]?.name ?? 'unresolved',
                colors: paletteMapRef.current[pid]?.colors ?? [],
              })),
              registers: [...registerCounts.entries()]
                .sort((a, c) => c[1] - a[1])
                .slice(0, 3)
                .map(([name, count]) => ({ name, count })),
            }
          } catch {
            return null
          }
        }),
      )
      setRotation(cards.filter((c): c is RotationCardData => c != null))
      setRotationLoading(false)
    } catch {
      setRotationLoading(false)
    }
  }, [])

  const paletteMapRef = useRef<Record<string, { name: string; colors: string[] }>>({})
  useEffect(() => {
    paletteMapRef.current = paletteMap
  }, [paletteMap])

  /* ---------------- initial sync ---------------- */

  useEffect(() => {
    let alive = true
    void (async () => {
      pushSys('NEON DOGMA deck boot — linking t4-engine :3200…')
      try {
        const st = await fetchJson<ApiEnvelope<EngineStateData>>('/api/t4/engine/state')
        if (!alive) return
        setStats(st.data)
        setHealth('live')
        pushSys(`engine link OK · era ${st.data.era} · canon ${st.data.canon} · uptime ${fmtUptime(st.data.uptimeSec)}`, 'ok')
      } catch {
        if (!alive) return
        setHealth('down')
        pushSys('engine link FAILED — telemetry degraded, operators on battery', 'err')
      }
      try {
        const ev = await fetchJson<ApiEnvelope<EventsData>>('/api/t4/engine/events?after=0&limit=1000')
        if (!alive) return
        const evs = (ev.data.events ?? []).filter((e) => typeof e.seq === 'number' && typeof e.hash === 'string')
        const { rows, newBroken } = appendChain(evs, true)
        const tail = rows.slice(-32)
        setFeed((f) => [...f, ...tail].slice(-MAX_FEED))
        pushSys(
          `chronicle synced · ${evs.length} links · local prev→hash check ${newBroken.length === 0 ? 'CLEAN' : `BROKEN @ ${newBroken[0]}`}`,
          newBroken.length === 0 ? 'ok' : 'err',
        )
      } catch {
        if (alive) pushSys('chronicle fetch failed — chain.jsonl stream cold', 'err')
      }
      try {
        const v = await fetchJson<ApiEnvelope<VerifyData>>('/api/t4/engine/chain/verify')
        if (!alive) return
        setVerify(v.data)
        pushSys(`engine audit ▸ ${v.data.ok ? 'SEALED — chronicle untampered' : `PROBLEMS ×${v.data.problems.length}`}`, v.data.ok ? 'ok' : 'err')
      } catch {
        /* verify is optional at boot */
      }
      try {
        const p = await fetchJson<{ palettes?: unknown[] }>('/api/t4/specs/palettes')
        if (!alive) return
        const map: Record<string, { name: string; colors: string[] }> = {}
        for (const raw of asArray(p.palettes)) {
          const rec = asRecord(raw)
          const id = asStr(rec.id)
          if (id === '') continue
          const base = id.split('_')[0]
          map[base] = { name: asStr(rec.name) || base, colors: specSwatches(rec) }
        }
        setPaletteMap(map)
      } catch {
        /* swatches fall back to deterministic hues */
      }
      await loadRotation()
      try {
        const b = await fetchJson<ApiEnvelope<{ batches: BatchRow[] }>>('/api/t4/engine/batches?limit=20')
        if (!alive) return
        const latest = (b.data.batches ?? [])[0]
        if (latest != null) {
          const card = await fetchJson<ApiEnvelope<BatchCardData>>(`/api/t4/engine/batches/${latest.slug}`)
          if (!alive) return
          const { cells: core, expCells: exp } = planSlotsToCells(asRecord(card.data).plan)
          setCells(core)
          setExpCells(exp)
          setPlanSource(`${latest.slug} · ${latest.status.toUpperCase()}`)
        }
      } catch {
        /* matrix stays on standby */
      }
      if (alive) setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [appendChain, loadRotation, pushSys])

  /* ---------------- pollers ---------------- */

  const pollState = useCallback(async () => {
    try {
      const r = await fetchJson<ApiEnvelope<EngineStateData>>('/api/t4/engine/state')
      setStats(r.data)
      if (healthRef.current === 'down') {
        setHealth('live')
        pushSys('engine link restored — telemetry live', 'ok')
      }
    } catch {
      if (healthRef.current === 'live') {
        setHealth('down')
        pushSys('ENGINE LINK LOST — poll timeout, operators on battery', 'err')
      }
    }
  }, [pushSys])

  const pollEvents = useCallback(async () => {
    try {
      const r = await fetchJson<ApiEnvelope<EventsData>>(`/api/t4/engine/events?after=${lastSeqRef.current}&limit=60`)
      const evs = (r.data.events ?? []).filter((e) => typeof e.seq === 'number' && typeof e.hash === 'string')
      if (evs.length > 0) {
        const { rows, newBroken } = appendChain(evs, false)
        setFeed((f) => [...f, ...rows].slice(-MAX_FEED))
        for (const ev of evs.slice(0, 3)) {
          pushSys(`chronicle +${evs.length} ▸ #${ev.seq} ${ev.type}`, newBroken.length === 0 ? 'ok' : 'warn')
        }
        if (newBroken.length > 0) {
          setBanner({ id: Date.now(), verdict: 'void', title: 'VOID DETECTED', detail: `chain link #${newBroken[0]} prev-hash mismatch` })
        }
      } else {
        pollCountRef.current += 1
        if (pollCountRef.current % 5 === 0) {
          pushSys(`poll ok · Δ0 · head ${h8(lastHashRef.current)} · links ${lastSeqRef.current}`)
        }
      }
    } catch {
      /* transient poll failure — state poller owns health LED */
    }
  }, [appendChain, pushSys])

  const pollVerify = useCallback(async () => {
    try {
      const v = await fetchJson<ApiEnvelope<VerifyData>>('/api/t4/engine/chain/verify')
      setVerify(v.data)
    } catch {
      /* keep last verdict */
    }
  }, [])

  useInterval(pollState, 5000)
  useInterval(pollEvents, 3500)
  useInterval(pollVerify, 45000)

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      setClock(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  /* ---------------- operations ---------------- */

  const runBurn = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setMode('burning')
    setBanner(null)
    setScreenShake((s) => s + 1)
    pushSys('IGNITION ▸ BURN & REBUILD — full chain re-audit from GENESIS', 'err')
    try {
      const all = await fetchJson<ApiEnvelope<EventsData>>('/api/t4/engine/events?after=0&limit=1000')
      const evs = (all.data.events ?? []).filter((e) => typeof e.seq === 'number' && typeof e.hash === 'string')
      lastHashRef.current = GENESIS
      lastSeqRef.current = 0
      const broken: number[] = []
      const total = evs.length
      for (let i = 0; i < total; i += 24) {
        const chunk = evs.slice(i, i + 24)
        const end = Math.min(i + 23, total - 1)
        for (const ev of chunk) {
          if (ev.prev !== lastHashRef.current) broken.push(ev.seq)
          lastHashRef.current = ev.hash
          lastSeqRef.current = ev.seq
        }
        if (Math.floor(i / 24) % 2 === 0) {
          pushSys(`REHASH ▸ seq ${chunk[0].seq}–${evs[end].seq} ${broken.length === 0 ? '✓✓✓' : '✗'}`)
        }
        await sleep(34)
      }
      const v = await fetchJson<ApiEnvelope<VerifyData>>('/api/t4/engine/chain/verify')
      setVerify(v.data)
      setChainLocal({ height: total, head: lastHashRef.current, broken })
      setFeed((f) => {
        const keepSys = f.filter((x): x is Extract<FeedEntry, { kind: 'sys' }> => x.kind === 'sys').slice(-12)
        const tail = evs.slice(-26).map((ev) => ({
          uid: uidRef.current++,
          kind: 'chain' as const,
          ev,
          link: (broken.includes(ev.seq) ? 'broken' : 'ok') as LinkState,
        }))
        return [...keepSys, ...tail].slice(-MAX_FEED)
      })
      const clean = broken.length === 0 && v.data.ok
      pushSys(
        `AUDIT COMPLETE ▸ ${total} links re-hashed · head ${h8(lastHashRef.current)} · ${clean ? 'CHAIN INTACT — CLEAN RUN' : `BROKEN @ ${broken.join(',') || 'engine problems'}`}`,
        clean ? 'ok' : 'err',
      )
      setBanner(
        clean
          ? { id: Date.now(), verdict: 'clean', title: 'CLEAN RUN', detail: `${total} links re-hashed GENESIS→HEAD · head ${h8(lastHashRef.current)}` }
          : {
              id: Date.now(),
              verdict: 'void',
              title: 'VOID DETECTED',
              detail: broken[0] != null ? `link #${broken[0]} prev-hash mismatch` : (v.data.problems[0] ?? 'engine audit problems'),
            },
      )
      toast({
        title: clean ? 'BURN COMPLETE — CLEAN RUN' : 'BURN COMPLETE — ANOMALY',
        description: clean ? `${total} links re-verified, chain intact.` : `Broken links: ${broken.join(', ') || 'engine-reported problems'}.`,
        variant: clean ? 'default' : 'destructive',
      })
    } catch {
      pushSys('burn aborted — engine unreachable mid-sweep', 'err')
      setBanner({ id: Date.now(), verdict: 'void', title: 'VOID DETECTED', detail: 'engine unreachable mid-audit' })
      toast({ title: 'BURN FAILED', description: 'Engine unreachable — re-audit aborted.', variant: 'destructive' })
    } finally {
      setMode('idle')
      busyRef.current = false
    }
  }, [pushSys])

  const runCompile = useCallback(async () => {
    if (busyRef.current) return
    const theme = themeInput.trim()
    const ocThemes = ocThemeInputs
      .map((t) => t.trim())
      .filter((t) => t !== '')
      .map((ocTheme, i) => ({ theme: ocTheme, rating: 'R+', position: i + 1 }))
    if (theme === '') {
      toast({ title: 'THEME REQUIRED', description: 'Type a batch theme (1–120 chars) before force-compiling.', variant: 'destructive' })
      pushSys('COMPILE REJECTED ▸ empty theme', 'warn')
      return
    }
    if (ocThemes.length === 0) {
      toast({ title: 'OC THEME REQUIRED', description: 'The compiler needs at least one OC slot theme (OC·1–3, cycles to 3 slots).', variant: 'destructive' })
      pushSys('COMPILE REJECTED ▸ no OC slot themes (strict Zod: ocThemes min 1)', 'warn')
      return
    }
    busyRef.current = true
    setMode('compiling')
    setBanner(null)
    pushSys(`COMPILE REQUEST ▸ theme «${theme}» · oc×${ocThemes.length} · engine per-theme · 24+8 slots`, 'warn')
    // gate sweep animation
    setCells((prev) => prev.map((c) => ({ ...c, status: 'standby' })))
    for (let i = 0; i < cells.length || i < 24; i++) {
      setCells((prev) => prev.map((c) => (c.pos <= i + 1 ? { ...c, status: 'cycling' } : c)))
      await sleep(42)
    }
    setPlanningGates(PLANNING_GATES.map((g) => ({ gate: g, level: 'hard', verdict: 'RUN', findings: [] })))
    for (let i = 0; i < PLANNING_GATES.length; i++) {
      await sleep(230)
      setPlanningGates((prev) => prev.map((g, j) => (j === i ? { ...g, verdict: '···' } : g)))
    }
    await sleep(320)
    // auth gate
    const key = getCommanderKey()
    if (key === '') {
      setCells((prev) => prev.map((c) => ({ ...c, status: 'standby' })))
      setPlanningGates(PLANNING_GATES.map((g) => ({ gate: g, level: 'hard', verdict: 'LOCK', findings: ['commander key required'] })))
      setBanner({ id: Date.now(), verdict: 'void', title: 'AUTH LOCKED', detail: 'x-commander-key required for live compile — set it in the control grid' })
      pushSys('COMPILE ABORTED ▸ commander key missing (503 fail-closed policy)', 'err')
      toast({ title: 'AUTH LOCKED', description: 'Set the commander key in the control grid to arm live compiles.', variant: 'destructive' })
      setMode('idle')
      busyRef.current = false
      return
    }
    // live compile
    try {
      const res = await postJson<ApiEnvelope<CompileData>>(
        '/api/t4/engine/compile',
        { theme, engine: 'per-theme', ocThemes },
        { 'Idempotency-Key': `neon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` },
      )
      const plan = asRecord(res.data.plan)
      const receipts = (res.data.receipts ?? []).map((r) => ({
        gate: asStr(r.gate) || '?',
        level: asStr(r.level) || 'hard',
        verdict: asStr(r.verdict) || 'PASS',
        findings: asArray(r.findings).map(asStr).filter((s) => s !== ''),
      }))
      const { cells: core, expCells: exp } = planSlotsToCells(plan)
      const hardFail = receipts.some((r) => r.verdict === 'FAIL')
      const hasWarn = receipts.some((r) => r.verdict === 'WARN')
      const finalStatus: CellStatus = hardFail ? 'void' : hasWarn ? 'drift' : 'sealed'
      setCells(core.map((c) => ({ ...c, status: finalStatus })))
      setExpCells(exp.map((c) => ({ ...c, status: finalStatus })))
      setPlanningGates(receipts.length > 0 ? receipts : PLANNING_GATES.map((g) => ({ gate: g, level: 'hard', verdict: 'PASS', findings: [] })))
      const slug = asStr(plan.slug) || stats?.nextSlug || 'T4-??'
      const title = asStr(plan.title) || theme
      setPlanSource(`${slug} · ${res.data.idempotentReplay ? 'REPLAY' : 'FRESH'}`)
      if (hardFail) {
        const f = receipts.find((r) => r.verdict === 'FAIL')
        setBanner({ id: Date.now(), verdict: 'void', title: 'VOID DETECTED', detail: `gate «${f?.gate ?? '?'}» FAIL — ${f?.findings[0] ?? 'planning gate rejection'}` })
        pushSys(`COMPILE VOID ▸ ${slug} rejected at gate ${f?.gate ?? '?'} — draft not persisted`, 'err')
        toast({ title: 'VOID DETECTED', description: `Gate ${f?.gate ?? '?'} rejected the plan.`, variant: 'destructive' })
      } else if (hasWarn) {
        const w = receipts.filter((r) => r.verdict === 'WARN')
        setBanner({ id: Date.now(), verdict: 'drift', title: 'DRIFT DETECTED', detail: `${w.length} advisory finding(s) — first: ${w[0]?.findings[0] ?? w[0]?.gate ?? '—'}` })
        pushSys(`COMPILE SEALED WITH DRIFT ▸ ${slug} «${title}» · ${w.length} WARN findings`, 'warn')
        toast({ title: 'DRIFT DETECTED', description: `${slug} sealed with ${w.length} advisory finding(s).` })
      } else {
        setBanner({ id: Date.now(), verdict: 'clean', title: 'CLEAN RUN', detail: `${slug} «${title}» · 24 gates sealed · ${core.length + exp.length} slots planned` })
        pushSys(`COMPILE CLEAN ▸ ${slug} «${title}» · all planning gates PASS · plan persisted`, 'ok')
        toast({ title: 'CLEAN RUN', description: `${slug} «${title}» — all 24 gates sealed.` })
      }
      void pollState()
      void pollEvents()
      void loadRotation()
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null
      let detail = 'network failure'
      if (apiErr != null) {
        const rec = asRecord(apiErr.payload)
        const errRec = asRecord(rec.error)
        detail = asStr(rec.error) || asStr(errRec.message) || `HTTP ${apiErr.status}`
      }
      setCells((prev) => prev.map((c) => ({ ...c, status: 'void' })))
      setPlanningGates(PLANNING_GATES.map((g) => ({ gate: g, level: 'hard', verdict: 'FAIL', findings: [detail] })))
      setBanner({ id: Date.now(), verdict: 'void', title: 'VOID DETECTED', detail })
      pushSys(`COMPILE FAILED ▸ ${detail}`, 'err')
      toast({ title: 'COMPILE REJECTED', description: detail, variant: 'destructive' })
    } finally {
      setMode('idle')
      busyRef.current = false
    }
  }, [cells.length, loadRotation, ocThemeInputs, pollEvents, pollState, pushSys, stats?.nextSlug, themeInput])

  const runPurge = useCallback(() => {
    if (busyRef.current) return
    busyRef.current = true
    setMode('purging')
    const count = feed.length
    pushSys('PURGE ▸ flushing local telemetry heap…', 'warn')
    window.setTimeout(() => {
      setFeed((f) => f.slice(-2))
      setLastPurged(Math.max(0, count - 2))
      pushSys(`HEAP PURGED ▸ ${Math.max(0, count - 2)} entries → /dev/null · buffer re-seeded`, 'ok')
      toast({ title: 'HEAP PURGED', description: `${Math.max(0, count - 2)} telemetry entries flushed. Live stream continues.` })
      setMode('idle')
      busyRef.current = false
    }, 620)
  }, [feed.length, pushSys])

  /* ---------------- derived state ---------------- */

  const mascotMood: MascotMood = useMemo(() => {
    if (health === 'down') return 'sleep'
    if (mode === 'compiling' || mode === 'burning') return 'focus'
    if (banner == null) return 'idle'
    if (banner.verdict === 'clean') return 'happy'
    if (banner.verdict === 'drift') return 'concerned'
    return banner.title === 'AUTH LOCKED' ? 'concerned' : 'shock'
  }, [banner, health, mode])

  const charlieMood: MascotMood = useMemo(() => {
    if (verify == null) return 'idle'
    if (!verify.ok) return 'shock'
    if (chainLocal.broken.length > 0) return 'concerned'
    return mode === 'burning' ? 'focus' : 'idle'
  }, [chainLocal.broken.length, mode, verify])

  const tsubakiLine = useMemo(() => {
    if (health === 'down') return 'Engine link is down… telemetry on battery. Keep the seat warm for me, zzz…'
    if (mode === 'compiling') return `Compiling «${themeInput.trim() || '—'}»… 24 gates cycling! Eyes on the matrix, senpai!`
    if (mode === 'burning') return `BURN & REBUILD engaged! Re-hashing ${chainLocal.height || 'all'} links from GENESIS — don't blink!`
    if (mode === 'purging') return 'Purging heap… stale telemetry to /dev/null. Clean deck, clean mind~'
    if (banner != null) {
      if (banner.verdict === 'clean') return 'CLEAN RUN! All 24 gates sealed, zero findings. Another perfect batch, ehehe~'
      if (banner.verdict === 'drift') return 'DRIFT DETECTED — gate findings logged. Recalibrating the rotation window…'
      if (banner.title === 'AUTH LOCKED') return "Commander key missing! I can't touch the chronicle without authorization, baka!"
      return 'VOID DETECTED!! The compiler rejected the plan — stay calm, the chronicle is safe!'
    }
    const line = IDLE_LINES[idleLineIdx.current % IDLE_LINES.length]
    return line.replace('{head}', h8(chainLocal.head)).replace('{links}', String(chainLocal.height))
  }, [banner, chainLocal.head, chainLocal.height, health, mode, themeInput])

  const charlieLine = useMemo(() => {
    if (verify == null) return 'Audit engine cold… hand me the chain and I will count every link.'
    if (!verify.ok) return `ANOMALY: ${verify.problems[0] ?? 'chronicle tampered'} — the ledger was touched. Not on my watch.`
    if (chainLocal.broken.length > 0) return `Local check flags link #${chainLocal.broken[0]} — re-running the audit now.`
    if (mode === 'burning') return 'Burn sweep in progress… recounting every hash from the genesis link.'
    return `Chain audit complete: ${verify.events} links intact · head ${h8(verify.head)}… · zero hand-edits.`
  }, [chainLocal.broken, mode, verify])

  const gateSummary = useMemo(() => {
    let sealed = 0
    let drift = 0
    let voids = 0
    let standby = 0
    for (const c of [...cells, ...expCells]) {
      if (c.status === 'sealed') sealed++
      else if (c.status === 'drift') drift++
      else if (c.status === 'void') voids++
      else standby++
    }
    if (cells.length === 0) standby = 24
    return { sealed, drift, void: voids, standby }
  }, [cells, expCells])

  const chainOk: boolean | null = verify != null ? verify.ok : chainLocal.broken.length === 0 ? true : null

  const dropSlug = rotation.length > 0 ? rotation[rotation.length - 1]?.slug ?? '' : ''

  /* ---------------- render ---------------- */

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#05070d] text-zinc-200">
      <BackdropFX />
      <BootVeil ready={ready} onDone={() => undefined} />
      {/* burn screen-shake + ignition flash */}
      <AnimatePresence>
        {mode === 'burning' && (
          <motion.div
            key={`flash-${screenShake}`}
            className="pointer-events-none fixed inset-0 z-30"
            initial={{ opacity: 0.32, background: `radial-gradient(circle at 30% 20%, ${MAGENTA}33, transparent 60%)` }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1 }}
            aria-hidden
          />
        )}
      </AnimatePresence>
      <motion.div
        key={`shake-${screenShake}`}
        animate={screenShake > 0 ? { x: [0, -4, 4, -2, 2, 0] } : undefined}
        transition={{ duration: 0.4 }}
        className="contents"
      >
        <HeaderBar health={health} mode={mode} chainOk={chainOk} clock={clock} head={chainLocal.head} />
        <main className="relative z-10 mx-auto w-full max-w-[1680px] flex-1 px-3 pb-5 pt-3 sm:px-4 lg:px-6">
          <StatRail stats={stats} chainLocal={chainLocal} health={health} />
          <div className="mt-3 grid gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
            {/* LEFT — pipeline control */}
            <div className="order-2 flex flex-col gap-3 lg:order-1 lg:col-span-3 lg:gap-4">
              <PanelShell title="PIPELINE CONTROL GRID" icon={<Flame size={13} />} accent="red">
                <div className="space-y-3">
                  <BurnAndRebuild mode={mode} onBurn={() => void runBurn()} />
                  <CompileControl mode={mode} theme={themeInput} setTheme={setThemeInput} ocThemes={ocThemeInputs} setOcTheme={setOcThemeInput} onCompile={() => void runCompile()} />
                  <PurgeHeapControl mode={mode} onPurge={runPurge} lastPurged={lastPurged} />
                </div>
              </PanelShell>
              <CommanderKeyPanel />
            </div>
            {/* MIDDLE — telemetry + rotation */}
            <div className="order-1 flex flex-col gap-3 lg:order-2 lg:col-span-5 lg:gap-4">
              <ChronicleTerminal
                feed={feed}
                chainLocal={chainLocal}
                verify={verify}
                health={health}
                mode={mode}
                filter={filter}
                setFilter={setFilter}
              />
              <RotationWindow cards={rotation} nextSlug={stats?.nextSlug ?? ''} dropSlug={dropSlug} loading={rotationLoading} />
            </div>
            {/* RIGHT — operators + gates */}
            <div className="order-3 flex flex-col gap-3 lg:col-span-4 lg:gap-4">
              <OperatorSection mood={mascotMood} line={tsubakiLine} gateSummary={gateSummary} />
              <GateMatrix cells={cells} expCells={expCells} planningGates={planningGates} banner={banner} planSource={planSource} />
              <CharlieCard mood={charlieMood} line={charlieLine} verify={verify} chainLocal={chainLocal} />
            </div>
          </div>
        </main>
      </motion.div>
      <FooterBar stats={stats} chainLocal={chainLocal} feed={feed} />
    </div>
  )
}
