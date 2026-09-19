'use client'

/**
 * THREAD 4 dashboard — shared UI bits.
 * Dark atelier design system: zinc surfaces, amber accent, rose for
 * verdicts/X-tier, emerald for PASS/gates. No blue, no indigo.
 */

import type { ReactNode } from 'react'
import { AlertTriangle, Inbox } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/* ------------------------------------------------------------------ */
/* Loading / empty / error states                                      */
/* ------------------------------------------------------------------ */

export function SkeletonBlock({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} data-testid="t4-skeleton">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 bg-zinc-800"
          // vary widths so it reads as text, not bars
          style={{ width: `${88 - ((i * 13) % 55)}%` }}
        />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  icon,
  className,
}: {
  title: string
  hint?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center',
        className
      )}
    >
      <div className="text-zinc-600">{icon ?? <Inbox className="size-6" />}</div>
      <div className="text-sm font-medium text-zinc-400">{title}</div>
      {hint ? <div className="max-w-md text-xs leading-relaxed text-zinc-600">{hint}</div> : null}
    </div>
  )
}

export function ErrorNote({ text = 'нет данных', hint }: { text?: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-200/90">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500/80" />
      <div>
        <span className="font-medium">{text}.</span>
        {hint ? <span className="text-amber-200/60"> {hint}</span> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cards & stats                                                       */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-6',
        className
      )}
    >
      {title != null ? (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-200">
            {icon ? <span className="text-amber-500">{icon}</span> : null}
            {title}
          </h2>
          {action}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  loading,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ReactNode
  loading?: boolean
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        {icon ? <span className="text-zinc-600">{icon}</span> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-14 bg-zinc-800" />
      ) : (
        <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{value}</div>
      )}
      {hint ? <div className="mt-1 text-xs text-zinc-600">{hint}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Badges                                                             */
/* ------------------------------------------------------------------ */

const badgeBase =
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap'

export function DegreeBadge({ degree }: { degree: string }) {
  const d = degree.trim().toUpperCase()
  let tone = 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
  if (d === 'L' || d === 'LOW') tone = 'border-emerald-600/40 bg-emerald-600/10 text-emerald-400'
  else if (d === 'M' || d === 'MED' || d === 'MEDIUM') tone = 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  else if (d === 'H' || d === 'HIGH') tone = 'border-rose-500/40 bg-rose-500/10 text-rose-400'
  return <span className={cn(badgeBase, tone)}>{d || '—'}</span>
}

export function LevelBadge({ level }: { level: string }) {
  const l = level.trim().toLowerCase()
  let tone = 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
  if (l === 'hard') tone = 'border-rose-500/40 bg-rose-500/10 text-rose-400'
  else if (l === 'warn') tone = 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  else if (l === 'advisory') tone = 'border-emerald-600/40 bg-emerald-600/10 text-emerald-400'
  return <span className={cn(badgeBase, tone)}>{level || '—'}</span>
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const v = verdict.trim().toUpperCase()
  let tone = 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
  if (v === 'PASS') tone = 'border-emerald-600/50 bg-emerald-600/15 text-emerald-400'
  else if (v === 'WARN') tone = 'border-amber-500/50 bg-amber-500/15 text-amber-400'
  else if (v === 'FAIL') tone = 'border-rose-500/50 bg-rose-500/15 text-rose-400'
  return <span className={cn(badgeBase, tone)}>{v || '—'}</span>
}

/** Event-type badge: batch=amber, verdict=rose, law=zinc, gate=green. */
export function TypeBadge({ type }: { type: string }) {
  const t = (type || '').toLowerCase()
  let tone = 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
  if (t.includes('batch')) tone = 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  else if (t.includes('verdict')) tone = 'border-rose-500/40 bg-rose-500/10 text-rose-400'
  else if (t.includes('gate')) tone = 'border-emerald-600/40 bg-emerald-600/10 text-emerald-400'
  else if (t.includes('law')) tone = 'border-zinc-600 bg-zinc-800/60 text-zinc-300'
  return <span className={cn(badgeBase, 'font-mono', tone)}>{type || '—'}</span>
}

/** Rating tier badge: PG-13 zinc, R amber, R+ amber-hot, X/XXX rose. */
export function RatingBadge({ rating }: { rating: string }) {
  const r = rating.trim().toUpperCase().replace(/^PG[- ]?13$/, 'PG-13')
  let tone = 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
  if (r === 'PG-13' || r === 'PG13') tone = 'border-zinc-600 bg-zinc-800/60 text-zinc-300'
  else if (r === 'R') tone = 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  else if (r === 'R+' || r === 'RPLUS' || r === 'R PLUS') tone = 'border-amber-500/60 bg-amber-500/20 text-amber-300'
  else if (r === 'X') tone = 'border-rose-500/50 bg-rose-500/15 text-rose-400'
  else if (r === 'XXX') tone = 'border-rose-600/60 bg-rose-600/20 text-rose-300'
  const label = r === 'RPLUS' ? 'R+' : r === 'PG13' ? 'PG-13' : r
  return <span className={cn(badgeBase, tone)}>{label || '—'}</span>
}

export function Chip({
  children,
  tone = 'zinc',
  className,
}: {
  children: ReactNode
  tone?: 'zinc' | 'amber' | 'rose' | 'emerald'
  className?: string
}) {
  const tones: Record<string, string> = {
    zinc: 'border-zinc-700/70 bg-zinc-800/50 text-zinc-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300/90',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300/90',
    emerald: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-400/90',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-4', tones[tone], className)}>
      {children}
    </span>
  )
}

/** Mono slug / code token. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[11px] text-amber-200/90', className)}>{children}</code>
}
