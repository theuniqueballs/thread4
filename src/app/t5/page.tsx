'use client'

/**
 * THREAD 5 — РАБОЧИЙ СТОЛ АВТОРА (эра T5, 2026-10-24).
 *
 * Простой, по приказу автора: батчи читаются из thread5/batches, слоты —
 * карточками, POS/NEG копируются одной кнопкой, вердикты ✅🔶❌ + проза
 * падают в thread5/verdicts.jsonl. Ни ключей, ни движков, ни мостов —
 * пишет чат-писец, рендерит автор, закон живёт в thread5/CANON.md.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ClipboardCopy, FileText, Loader2, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Типы и парсер формата CANON §2                                      */
/* ------------------------------------------------------------------ */

interface BatchMeta {
  slug: string
  title: string
  engine: string
}

interface Slot {
  position: number
  anchor: string
  genre: string
  who: string
  rating: string
  pose: string
  palette: string
  thesis: string
  pos: string
  neg: string
}

interface VerdictEntry {
  at: string
  slug: string
  position: number
  verdict: string
  note: string
}

const VERDICT_META: Record<string, { label: string; icon: string; tone: string }> = {
  good: { label: 'клёво', icon: '✅', tone: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  meh: { label: 'но', icon: '🔶', tone: 'border-amber-500/50 bg-amber-500/10 text-amber-300' },
  dead: { label: 'дохло', icon: '❌', tone: 'border-rose-500/50 bg-rose-500/10 text-rose-300' },
}

const GENRE_TONE: Record<string, string> = {
  NICHE: 'text-violet-300 border-violet-500/40 bg-violet-500/10',
  VOLT: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  EXQUISITE: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  OC: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  EXP: 'text-zinc-300 border-zinc-600/60 bg-zinc-800/40',
}

function parseBatch(markdown: string): { header: string[]; slots: Slot[] } {
  const header: string[] = []
  const slots: Slot[] = []
  const blocks = markdown.split(/^(?=P\d{2} — )/m)
  for (const block of blocks) {
    const head = /^# THREAD 5.*$/m
    if (head.test(block) || block.trim() === '') {
      for (const line of block.split('\n')) {
        if (/^(# |ДВИЖОК: |ТЕМА-СЛОВА: )/.test(line)) header.push(line)
      }
      continue
    }
    const m = /^P(\d{2}) — (.+?) \((.+)\)$/m.exec(block)
    if (m == null) continue
    const meta = m[3].split('·').map((x) => x.trim())
    const grab = (key: string): string => {
      const re = new RegExp(`^${key}:\\s*\\n?(.*)$`, 'm')
      const r = re.exec(block)
      return r ? r[1].trim() : ''
    }
    slots.push({
      position: Number(m[1]),
      anchor: m[2],
      genre: meta[0] ?? '?',
      who: meta[1] ?? '—',
      rating: meta[2] ?? '?',
      pose: meta[3] ?? '—',
      palette: meta[4] ?? '—',
      thesis: grab('THESIS'),
      pos: grab('POS'),
      neg: grab('NEG'),
    })
  }
  return { header, slots }
}

/* ------------------------------------------------------------------ */
/* Карточка слота                                                      */
/* ------------------------------------------------------------------ */

function CopyBlock({ label, text }: { label: string; text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70">
      <div className="flex items-center gap-2 border-b border-zinc-800/70 px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
        <button
          type="button"
          onClick={copy}
          className={cn(
            'ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
            copied
              ? 'border-emerald-500/50 text-emerald-300'
              : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
          )}
          aria-label={`скопировать ${label}`}
        >
          {copied ? <Check className="size-3" /> : <ClipboardCopy className="size-3" />}
          {copied ? 'скопировано' : 'копи'}
        </button>
      </div>
      <p className="t4-scroll max-h-28 overflow-y-auto px-2.5 py-2 font-term text-[11px] leading-relaxed text-zinc-300">
        {text}
      </p>
    </div>
  )
}

function SlotCard({
  slot,
  verdict,
  onVerdict,
}: {
  slot: Slot
  verdict: VerdictEntry | undefined
  onVerdict: (position: number, verdict: string, note: string) => void
}): React.JSX.Element {
  const [note, setNote] = useState(verdict?.note ?? '')
  const [seenVerdict, setSeenVerdict] = useState(verdict?.note ?? '')
  if (seenVerdict !== (verdict?.note ?? '')) {
    setSeenVerdict(verdict?.note ?? '')
    setNote(verdict?.note ?? '')
  }
  return (
    <article className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-term text-xs text-zinc-500">P{String(slot.position).padStart(2, '0')}</span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            GENRE_TONE[slot.genre] ?? GENRE_TONE.EXP
          )}
        >
          {slot.genre}
        </span>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300">{slot.rating}</span>
        {slot.who !== '—' ? <span className="text-[10px] text-zinc-500">{slot.who}</span> : null}
        <span className="ml-auto hidden font-term text-[10px] text-zinc-600 sm:inline">{slot.palette}</span>
      </div>
      {slot.thesis !== '' ? <p className="mt-1.5 text-xs italic leading-relaxed text-amber-200/80">{slot.thesis}</p> : null}
      <div className="mt-2 space-y-2">
        <CopyBlock label="POS" text={slot.pos} />
        <CopyBlock label="NEG" text={slot.neg} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {Object.entries(VERDICT_META).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            onClick={() => onVerdict(slot.position, key, note)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              verdict?.verdict === key
                ? meta.tone
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            )}
          >
            {meta.icon} {meta.label}
          </button>
        ))}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 2000))}
          placeholder="проза вердикта (что сработало / что умерло)"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-zinc-600"
        />
        {note !== (verdict?.note ?? '') ? (
          <button
            type="button"
            onClick={() => verdict != null && onVerdict(slot.position, verdict.verdict, note)}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-500"
          >
            записать прозу
          </button>
        ) : null}
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Страница                                                            */
/* ------------------------------------------------------------------ */

export default function T5Page(): React.JSX.Element {
  const [batches, setBatches] = useState<BatchMeta[]>([])
  const [slug, setSlug] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [verdicts, setVerdicts] = useState<VerdictEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/t5/batches', { cache: 'no-store' })
      const json = (await res.json()) as { ok?: boolean; data?: { batches: BatchMeta[] }; error?: string }
      if (!res.ok || json.ok !== true) throw new Error(json.error ?? `HTTP ${res.status}`)
      setBatches(json.data?.batches ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'не читается')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (slug == null && batches.length > 0) setSlug(batches[0].slug)
  }, [batches, slug])

  const loadBatch = useCallback(async (s: string) => {
    try {
      const [b, v] = await Promise.all([
        fetch(`/api/t5/batches?slug=${encodeURIComponent(s)}`, { cache: 'no-store' }),
        fetch(`/api/t5/verdict?slug=${encodeURIComponent(s)}`, { cache: 'no-store' }),
      ])
      const bj = (await b.json()) as { ok?: boolean; data?: { markdown: string }; error?: string }
      const vj = (await v.json()) as { ok?: boolean; data?: { verdicts: VerdictEntry[] } }
      if (bj.ok !== true) throw new Error(bj.error ?? 'батч не читается')
      setMarkdown(bj.data?.markdown ?? '')
      setVerdicts(vj.data?.verdicts ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'батч не читается')
    }
  }, [])

  useEffect(() => {
    if (slug != null) void loadBatch(slug)
  }, [slug, loadBatch])

  const parsed = useMemo(() => parseBatch(markdown), [markdown])
  const verdictOf = useMemo(() => {
    const m = new Map<number, VerdictEntry>()
    for (const v of verdicts) if (!m.has(v.position)) m.set(v.position, v)
    return m
  }, [verdicts])

  const sendVerdict = useCallback(
    async (position: number, verdict: string, note: string) => {
      if (slug == null) return
      try {
        const res = await fetch('/api/t5/verdict', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, position, verdict, note }),
        })
        const json = (await res.json()) as { ok?: boolean; error?: string }
        if (json.ok !== true) throw new Error(json.error ?? 'вердикт не записан')
        setVerdicts((prev) => [...prev.filter((v) => !(v.position === position)), ...(json.ok ? [{ at: new Date().toISOString(), slug, position, verdict, note }] : [])])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'вердикт не записан')
      }
    },
    [slug]
  )

  const good = verdicts.filter((v) => v.verdict === 'good').length
  const dead = verdicts.filter((v) => v.verdict === 'dead').length

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">
            THREAD 5 <span className="text-zinc-500">·</span>{' '}
            <span className="text-zinc-400">рабочий стол автора</span>
          </span>
          {parsed.slots.length > 0 ? (
            <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
              слотов {parsed.slots.length} · ✅ {good} · ❌ {dead}
            </span>
          ) : null}
          <span className="ml-auto" />
          <button
            type="button"
            onClick={() => void loadList()}
            className="flex items-center gap-1 rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            aria-label="обновить список батчей"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        {batches.length > 0 ? (
          <div className="t4-scroll mx-auto mt-2 flex max-w-5xl gap-1.5 overflow-x-auto pb-1">
            {batches.map((b) => (
              <button
                key={b.slug}
                type="button"
                onClick={() => setSlug(b.slug)}
                className={cn(
                  'shrink-0 rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                  slug === b.slug
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                )}
              >
                {b.slug}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mx-auto max-w-5xl px-4 py-4">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" /> читаю thread5/batches…
          </p>
        ) : error != null ? (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-xs text-rose-200">{error}</p>
        ) : parsed.slots.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <FileText className="size-4" /> батчей нет — чат-писец пишет в thread5/batches/T5-NN.md (формат — CANON §2)
          </p>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
              {parsed.header.map((h) => (
                <p key={h} className={cn('text-xs leading-relaxed', h.startsWith('#') ? 'mb-1 text-sm font-semibold text-amber-200' : 'text-zinc-400')}>
                  {h.replace(/^# /, '')}
                </p>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {parsed.slots.map((s) => (
                <SlotCard key={s.position} slot={s} verdict={verdictOf.get(s.position)} onVerdict={(p, v, n) => void sendVerdict(p, v, n)} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
