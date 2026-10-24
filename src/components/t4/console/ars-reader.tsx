'use client'

/**
 * THREAD 4 — ARS READER (эра ARS NOVEAU, 2026-10-23).
 *
 * Свистоперделки конвейера: выдвижная читальня (ReaderDrawer) и панели
 * результатов новых этапов — StoriesGrid (21 история + 3 ОС + EXP-идеи),
 * BriquetteList (брикеты сборщика), FurnacePanel (вердикт печи).
 * Всё read-only: артефакты пишет Rust-движок, UI только показывает.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  FlaskConical,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/t4/markdown'
import { asArray, asRecord, asStr } from '@/components/t4/api'
import { writeClipboard } from '@/components/t4/console/shared'

/* ------------------------------------------------------------------ */
/* Читальня: выдвижная панель «посмотреть почитать»                    */
/* ------------------------------------------------------------------ */

const DRAWER_SPRING = { type: 'spring' as const, stiffness: 320, damping: 34 }

export interface ReaderState {
  title: string
  badge?: string
  markdown: string
}

export function ReaderDrawer({
  state,
  onClose,
}: {
  state: ReaderState | null
  onClose: () => void
}) {
  const reduce = useReducedMotion() ?? false

  useEffect(() => {
    if (state == null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, onClose])

  return (
    <AnimatePresence>
      {state != null ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label={`читальня: ${state.title}`}
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={DRAWER_SPRING}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60"
          >
            <header className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3">
              <BookOpen className="size-4 shrink-0 text-amber-300" />
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-zinc-100">
                {state.title}
              </h3>
              {state.badge != null && state.badge !== '' ? (
                <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-term text-[10px] uppercase tracking-wide text-amber-200">
                  {state.badge}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  void writeClipboard(state.markdown).then(() => undefined)
                }
                title="Скопировать текст"
                aria-label="скопировать текст читальни"
                className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                <ClipboardCopy className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Закрыть (Esc)"
                aria-label="закрыть читальню"
                className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-rose-500/60 hover:text-rose-300"
              >
                <X className="size-3.5" />
              </button>
            </header>
            <div className="t4-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <MarkdownView>{state.markdown}</MarkdownView>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ */
/* Истории ARS NOVEAU                                                  */
/* ------------------------------------------------------------------ */

const GENRE_TONE: Record<string, string> = {
  NICHE: 'border-violet-500/40 bg-violet-500/[0.07] text-violet-200',
  VOLT: 'border-rose-500/40 bg-rose-500/[0.07] text-rose-200',
  EXQUISITE: 'border-amber-500/40 bg-amber-500/[0.07] text-amber-200',
  OC: 'border-sky-500/40 bg-sky-500/[0.07] text-sky-200',
  EXP: 'border-zinc-600/60 bg-zinc-800/40 text-zinc-300',
}

const GENRE_DOT: Record<string, string> = {
  NICHE: 'bg-violet-400',
  VOLT: 'bg-rose-400',
  EXQUISITE: 'bg-amber-400',
  OC: 'bg-sky-400',
  EXP: 'bg-zinc-400',
}

function GenreChip({ genre }: { genre: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        GENRE_TONE[genre] ?? GENRE_TONE.EXP
      )}
    >
      <span className={cn('size-1 rounded-full', GENRE_DOT[genre] ?? GENRE_DOT.EXP)} />
      {genre}
    </span>
  )
}

function StoryRow({ k, v }: { k: string; v: string }): React.JSX.Element | null {
  if (v === '') return null
  return (
    <p className="text-[11px] leading-relaxed text-zinc-400">
      <span className="text-zinc-600">{k}: </span>
      {v}
    </p>
  )
}

function StoryCard({ story }: { story: Record<string, unknown> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const genre = asStr(story.genre) || 'VOLT'
  const pos = asStr(story.position) || '·'
  const title = asStr(story.title) || 'untitled'
  const thesis = asStr(story.thesis)
  const scene = asStr(story.scene)
  const env = asStr(story.environment)
  const vibe = asStr(story.vibe)
  const light = asStr(story.lighting)
  const outfit = asStr(story.outfit)
  const who = asStr(story.character)
  const pose = asStr(story.poseIdea)
  const witness = asStr(story.witness)
  const dice = asStr(story.dice)
  return (
    <motion.button
      type="button"
      layout
      onClick={() => setOpen((v) => !v)}
      className={cn(
        'group flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
        'border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-600',
        open && 'border-zinc-600 bg-zinc-900/70'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-term text-[11px] text-zinc-500">S{String(pos).padStart(2, '0')}</span>
        <GenreChip genre={genre} />
        <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-600 transition-colors group-hover:text-zinc-400">
          {open ? 'свернуть' : 'развернуть'}
          <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
        </span>
      </div>
      <p className="text-sm font-medium leading-snug text-zinc-100">{title}</p>
      {thesis !== '' ? <p className="text-xs italic leading-relaxed text-amber-200/80">{thesis}</p> : null}
      {scene !== '' ? <p className="text-xs leading-relaxed text-zinc-300">{scene}</p> : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 border-t border-zinc-800/70 pt-2">
              <StoryRow k="reveal" v={asStr(story.reveal)} />
              <StoryRow k="окружение" v={env} />
              <StoryRow k="вайб" v={vibe} />
              <StoryRow k="свет" v={light} />
              <StoryRow k="поза" v={pose} />
              <StoryRow k="одежда" v={outfit} />
              <StoryRow k="персонаж" v={who} />
              <StoryRow k="свидетель" v={witness} />
              <StoryRow k="dice" v={dice} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.button>
  )
}

export function StoriesGrid({ ars }: { ars: unknown }): React.JSX.Element | null {
  const build = asRecord(ars)
  const mains = asArray(build.mains)
  const ocs = asArray(build.ocs)
  const exp = asArray(build.exp)
  if (mains.length === 0 && ocs.length === 0) return null
  const engine = asStr(build.engineName)
  const law = asStr(build.engineLaw)
  const keywords = asArray(build.themeKeywords).map(asStr).filter((s) => s !== '')
  const acts = asArray(build.acts).map(asStr).filter((s) => s !== '')
  return (
    <div className="space-y-3">
      {engine !== '' ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
            <Sparkles className="size-3.5" />
            Движок: {engine}
          </p>
          {law !== '' ? <p className="mt-1 text-xs leading-relaxed text-zinc-300">{law}</p> : null}
          {acts.length > 0 ? (
            <p className="mt-1.5 font-term text-[10px] uppercase tracking-wide text-zinc-500">
              акты: {acts.join(' · ')}
            </p>
          ) : null}
          {keywords.length > 0 ? (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <span key={k} className="rounded border border-zinc-700/70 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {k}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
      {mains.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            21 история мейн-пула
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {mains.map((m, i) => (
              <StoryCard key={i} story={asRecord(m)} />
            ))}
          </div>
        </div>
      ) : null}
      {ocs.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Истории ОС
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {ocs.map((m, i) => (
              <StoryCard key={i} story={asRecord(m)} />
            ))}
          </div>
        </div>
      ) : null}
      {exp.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            <FlaskConical className="size-3.5" />
            EXP-идеи — вне темы, только проверка на успех
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {exp.map((m, i) => {
              const e = asRecord(m)
              return (
                <div key={i} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-term text-[11px] text-zinc-500">EXP №{asStr(e.id) || i + 1}</span>
                    <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {asStr(e.kind) || 'pose'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-200">{asStr(e.hypothesis)}</p>
                  {asStr(e.variables) !== '' ? (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      переменная A/B: {asStr(e.variables)}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Брикеты сборщика                                                    */
/* ------------------------------------------------------------------ */

export function BriquetteList({ briquettes }: { briquettes: unknown }): React.JSX.Element | null {
  const list = asArray(briquettes).map(asRecord)
  if (list.length === 0) return null
  return (
    <div className="t4-scroll max-h-56 space-y-1 overflow-y-auto pr-1">
      {list.map((b, i) => {
        const pos = asNumStr(b.position)
        const kind = asStr(b.kind) || '?'
        const story = asRecord(b.story)
        const mech = asRecord(b.mechanics)
        return (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-1.5"
          >
            <span className="font-term text-[11px] text-zinc-500">P{pos}</span>
            <GenreChip genre={kind} />
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
              {asStr(story.title) !== '' ? asStr(story.title) : asStr(story.thesis)}
            </span>
            <span className="hidden shrink-0 font-term text-[10px] text-zinc-600 sm:inline">
              {asStr(mech.poseName) || '—'} · {asStr(mech.palette) || '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function asNumStr(v: unknown): string {
  if (typeof v === 'number') return String(v).padStart(2, '0')
  return asStr(v).padStart(2, '0')
}

/* ------------------------------------------------------------------ */
/* Печь: вердикт + находки                                             */
/* ------------------------------------------------------------------ */

const VERDICT_TONE: Record<string, string> = {
  PASS: 'border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-300',
  WARN: 'border-amber-500/40 bg-amber-500/[0.07] text-amber-300',
  FAIL: 'border-rose-500/50 bg-rose-500/[0.08] text-rose-300',
}

const SEVERITY_TONE: Record<string, string> = {
  critical: 'border-rose-500/40 bg-rose-500/[0.06] text-rose-200',
  warn: 'border-amber-500/30 bg-amber-500/[0.05] text-amber-200',
  note: 'border-zinc-700/60 bg-zinc-800/30 text-zinc-300',
}

export function FurnacePanel({ report }: { report: unknown }): React.JSX.Element | null {
  const r = asRecord(report)
  const verdict = asStr(r.verdict)
  if (verdict === '') return null
  const findings = asArray(r.findings).map(asRecord)
  const strengths = asArray(r.strengths).map(asStr).filter((s) => s !== '')
  return (
    <div className="space-y-2.5">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2',
          VERDICT_TONE[verdict] ?? VERDICT_TONE.WARN
        )}
      >
        {verdict === 'PASS' ? (
          <CheckCircle2 className="size-4 shrink-0" />
        ) : (
          <ShieldAlert className="size-4 shrink-0" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide">{verdict}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-90">{asStr(r.summary)}</span>
      </div>
      {findings.length > 0 ? (
        <div className="space-y-1.5">
          {findings.slice(0, 6).map((f, i) => {
            const sev = asStr(f.severity) || 'note'
            return (
              <div
                key={i}
                className={cn('rounded-md border px-2.5 py-1.5', SEVERITY_TONE[sev] ?? SEVERITY_TONE.note)}
              >
                <p className="text-[11px] leading-relaxed">
                  <span className="font-term">[{asStr(f.area)}
                  {asStr(f.slot) !== '' ? ` ${asStr(f.slot)}` : ''}]</span>{' '}
                  {asStr(f.note)}
                </p>
              </div>
            )
          })}
          {findings.length > 6 ? (
            <p className="text-[11px] text-zinc-500">…и ещё {findings.length - 6} — полный список в репорте</p>
          ) : null}
        </div>
      ) : null}
      {strengths.length > 0 ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] px-2.5 py-1.5">
          {strengths.slice(0, 3).map((s, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-emerald-200/90">
              <Lightbulb className="mt-0.5 size-3 shrink-0" />
              {s}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
