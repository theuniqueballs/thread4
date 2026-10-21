'use client'

/**
 * РАБОЧИЙ СТОЛ: ХЕШ-ЦЕПЬ (Фаза 5, UI v2).
 *
 * Летопись как цепь, а не как лента: клиент сам перешивает звенья
 * (prev[i] === hash[i-1], генезис GENESIS) и честно называет вердикт —
 * ЦЕЛА или номер первого битого звена. Аудитору движок не верим на слово;
 * полный крипто-аудит по raw-строкам остаётся за /v1/chain/verify —
 * здесь сшивка, читаемая глазом.
 */

import { useMemo, useState } from 'react'
import { Download, Link2, ShieldCheck, ShieldX } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { EngineEvent } from '@/components/t4/console/panels'
import type { EventsFeed } from '@/components/t4/console/chrome'
import { validateChain } from '@/lib/t4/chain-view'

function fmtTime(at: string): string {
  try {
    return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return at
  }
}

const TYPE_TONE: Record<string, string> = {
  'batch.compiled': 'border-sky-500/40 text-sky-300',
  'batch.delivered': 'border-emerald-500/40 text-emerald-300',
  'batch.void': 'border-zinc-600 text-zinc-400',
  'gate.run': 'border-amber-500/40 text-amber-300',
  'cycle.step': 'border-fuchsia-500/40 text-fuchsia-300',
  'scribe.drafted': 'border-rose-500/40 text-rose-300',
  'payload.migrated': 'border-lime-500/40 text-lime-300',
  'bridge.compiled': 'border-teal-500/40 text-teal-300',
  'law.amended': 'border-orange-500/40 text-orange-300',
}

export function ChainView(props: {
  feed: EventsFeed
  onExport: () => void
}) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  /* фильтр НЕ рвёт цепь: валидируется всегда полный массив событий */
  const verdict = useMemo(() => validateChain(props.feed.events), [props.feed.events])

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of props.feed.events) m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [props.feed.events])

  const shown = useMemo(
    () => (typeFilter == null ? props.feed.events : props.feed.events.filter((e) => e.type === typeFilter)),
    [props.feed.events, typeFilter]
  )

  const brokenSet = useMemo(() => new Set(verdict.breaks), [verdict.breaks])

  return (
    <div className="space-y-4" aria-label="рабочий стол: хеш-цепь">
      {/* ── вердикт ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 backdrop-blur-xl">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-200">
            <Link2 className="size-4 text-amber-400" /> Хеш-цепь
            <span className="font-mono text-[10px] font-normal text-zinc-500">клиентская перевалидация сшивки</span>
          </h2>
          <button
            type="button"
            onClick={props.onExport}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
            title="выгрузить виденные звенья в JSONL"
          >
            <Download className="size-3" /> экспорт JSONL
          </button>
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {props.feed.events.length === 0 ? (
            <span className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 font-mono text-xs text-zinc-500">
              звеньев не прочитано — движок молчит или лента пуста
            </span>
          ) : verdict.ok ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-300">
              <ShieldCheck className="size-4" /> ЦЕЛА · {verdict.checked} звеньев · head {verdict.head?.slice(0, 10)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-300">
              <ShieldX className="size-4" /> СЛОМАНА · битых звеньев {verdict.breaks.length} · первое — seq{' '}
              {props.feed.events[verdict.breaks[0]!]?.seq ?? '—'} ·{verdict.genesisOk ? '' : ' генезис не GENESIS ·'} аудит: /v1/chain/verify
            </span>
          )}
          <span className="font-mono text-[10px] text-zinc-600">
            сшивка: prev[i] === hash[i−1], генезис GENESIS · sha256-аудит по raw — у движка
          </span>
        </div>

        {/* фильтр типов */}
        {typeCounts.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                typeFilter == null ? 'border-zinc-100 bg-zinc-100 text-zinc-950' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              )}
            >
              все · {props.feed.events.length}
            </button>
            {typeCounts.map(([t, n]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t === typeFilter ? null : t)}
                className={cn(
                  'rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                  typeFilter === t ? 'border-zinc-100 bg-zinc-100 text-zinc-950' : TYPE_TONE[t] ?? 'border-zinc-700 text-zinc-500',
                  'hover:bg-white/5'
                )}
              >
                {t} · {n}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── звенья ──────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-xl">
        {shown.length === 0 ? (
          <p className="px-4 py-6 font-mono text-xs text-zinc-600">звеньев нет — лента не читается или фильтр пуст</p>
        ) : (
          <ol className="max-h-[32rem] overflow-y-auto t4-scroll">
            {shown.map((e) => {
              const idx = props.feed.events.indexOf(e)
              const broken = idx >= 0 && brokenSet.has(idx)
              return (
                <li
                  key={e.id ?? `${e.seq}`}
                  className={cn(
                    'border-t border-white/5 px-3 py-2 first:border-t-0',
                    broken ? 'bg-rose-500/[0.06]' : 'hover:bg-white/[0.02]'
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">#{e.seq}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">{fmtTime(e.at)}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1 py-px font-mono text-[9px]',
                        TYPE_TONE[e.type] ?? 'border-zinc-700 text-zinc-400'
                      )}
                    >
                      {e.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300" title={e.summary}>
                      {e.summary}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[9px]',
                        broken ? 'text-rose-300' : 'text-zinc-700'
                      )}
                      title={broken ? 'сшивка порвана: prev ≠ предыдущему hash' : `hash ${e.hash} ← prev ${e.prev}`}
                    >
                      {e.hash.slice(0, 8)} ← {e.prev.slice(0, 8)} {broken ? '⚡ РАЗРЫВ' : ''}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
