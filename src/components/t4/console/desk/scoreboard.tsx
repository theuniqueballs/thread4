'use client'

/**
 * РАБОЧИЙ СТОЛ: СКОРБОРД (Фаза 5, UI v2).
 *
 * Одна таблица вместо витрины «Сборка»: оба пространства (прод :3200 и
 * scratch twin'а :3201) в одном списке, пространство помечено, дубль-слаг
 * виден сразу. Сверху — счёт: сдано / в работе / закрыто / hard PASS.
 * Строки открываются в летописи (drawer Батчи) или в цикле рабочего стола.
 */

import { useMemo } from 'react'
import { Crown, Hammer, Rocket, ShieldCheck, Sparkles, Trash2, Zap } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  useEngineBatches,
  useScratchBatches,
  type ScratchBatchRow,
} from '@/components/t4/console/shared'
import type { EngineBatchRow } from '@/components/t4/console/panels'

type Row = {
  key: string
  slug: string
  title: string
  status: string
  space: 'prod' | 'scratch'
  slots: number | null
  exp: number | null
  ab: number | null
  hardPass: boolean | null
  sha10: string | null
  deliveredAt: string | null
  dupe: boolean
}

function fmtDay(at: string | null): string {
  if (at == null) return '—'
  try {
    return new Date(at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  } catch {
    return at
  }
}

function statusChip(status: string): string {
  if (status === 'delivered') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (status === 'void' || status === 'voided') return 'border-zinc-600 bg-zinc-800/60 text-zinc-400'
  return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
}

export function Scoreboard(props: { onOpenBatch: (slug: string) => void; onOpenInCycle: (slug: string) => void }) {
  const { rows: prod, loading: prodLoading } = useEngineBatches()
  const { rows: scratch, loading: scratchLoading } = useScratchBatches()

  const rows = useMemo<Row[]>(() => {
    const prodSlugs = new Set(prod.map((r) => r.slug))
    const fromProd: Row[] = prod.map((r: EngineBatchRow) => ({
      key: `prod:${r.slug}`,
      slug: r.slug,
      title: r.title,
      status: r.status,
      space: 'prod',
      slots: r.slotsTotal ?? null,
      exp: r.expSlots ?? null,
      ab: r.abPairs ?? null,
      hardPass: r.hardPass ?? null,
      sha10: r.sha10 ?? null,
      deliveredAt: r.deliveredAt ?? null,
      dupe: false,
    }))
    const fromScratch: Row[] = scratch.map((r: ScratchBatchRow) => ({
      key: `scratch:${r.slug}`,
      slug: r.slug,
      title: r.title,
      status: r.status,
      space: 'scratch',
      slots: r.slotsTotal ?? null,
      exp: r.expSlots ?? null,
      ab: r.abPairs ?? null,
      hardPass: r.hardPass ?? null,
      sha10: r.sha10 ?? null,
      deliveredAt: r.deliveredAt ?? null,
      dupe: prodSlugs.has(r.slug),
    }))
    const rank = (r: Row) => (r.status === 'compiled' ? 0 : r.status === 'delivered' ? 1 : 2)
    return [...fromProd, ...fromScratch].sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug))
  }, [prod, scratch])

  const score = useMemo(() => {
    const p = rows.filter((r) => r.space === 'prod')
    const delivered = p.filter((r) => r.status === 'delivered')
    const hard = delivered.filter((r) => r.hardPass === true)
    return {
      delivered: delivered.length,
      inWork: rows.filter((r) => r.status === 'compiled').length,
      closed: p.filter((r) => r.status === 'void').length,
      hardShare: delivered.length > 0 ? Math.round((hard.length / delivered.length) * 100) : null,
      scratch: rows.filter((r) => r.space === 'scratch' && r.status === 'compiled').length,
    }
  }, [rows])

  return (
    <div className="space-y-4" aria-label="скорборд: батчи обоих пространств">
      {/* ── счёт ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { icon: Crown, label: 'сдано в прод', value: score.delivered, tone: 'text-emerald-300' },
          { icon: Hammer, label: 'в работе (оба пространства)', value: score.inWork, tone: 'text-amber-300' },
          { icon: Trash2, label: 'закрыто (void)', value: score.closed, tone: 'text-zinc-400' },
          {
            icon: ShieldCheck,
            label: 'hard PASS среди сданных',
            value: score.hardShare != null ? `${score.hardShare}%` : '—',
            tone: 'text-amber-200',
          },
          { icon: Zap, label: 'сборок в scratch', value: score.scratch, tone: 'text-fuchsia-300' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-white/10 bg-zinc-900/50 p-3 backdrop-blur-xl">
            <p className={cn('flex items-center gap-1.5 font-mono text-lg font-bold', c.tone)}>
              <c.icon className="size-4" /> {c.value}
            </p>
            <p className="mt-0.5 text-[10px] leading-tight text-zinc-500">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── таблица ──────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-xl">
        <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-200">
            <Rocket className="size-4 text-amber-400" /> Батчи · прод :3200 + scratch twin&apos;а :3201
          </h2>
          <span className="font-mono text-[10px] text-zinc-600">{rows.length} строк</span>
        </header>
        {prodLoading && prod.length === 0 ? (
          <p className="px-4 py-6 font-mono text-xs text-zinc-500">читаю батчи движка…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 font-mono text-xs text-zinc-600">
            движок не отдал батчей (молчит или пусто) — скорборд наполнится, когда вернётся
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto t4-scroll">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-950/95 text-[10px] uppercase tracking-wider text-zinc-500 backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-mono font-medium">слаг</th>
                  <th className="px-3 py-2 font-mono font-medium">статус</th>
                  <th className="hidden px-3 py-2 font-mono font-medium sm:table-cell">слотов</th>
                  <th className="hidden px-3 py-2 font-mono font-medium md:table-cell">EXP / A-B</th>
                  <th className="hidden px-3 py-2 font-mono font-medium lg:table-cell">sha10</th>
                  <th className="px-3 py-2 font-mono font-medium">сдан</th>
                  <th className="px-3 py-2 font-mono font-medium text-right">действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-white/5 transition-colors hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => props.onOpenBatch(r.slug)}
                        className="font-term text-zinc-200 hover:text-amber-300"
                        title={`${r.slug} «${r.title}»`}
                      >
                        {r.slug}
                      </button>
                      {r.dupe ? (
                        <span className="ml-1.5 rounded border border-rose-500/50 px-1 font-mono text-[8px] uppercase text-rose-300" title="в проде другой батч с этим номером">
                          дубль
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'ml-1.5 rounded px-1 font-mono text-[8px] uppercase',
                          r.space === 'prod' ? 'border border-zinc-700 text-zinc-500' : 'border border-fuchsia-500/40 text-fuchsia-300'
                        )}
                      >
                        {r.space}
                      </span>
                      <p className="max-w-[180px] truncate text-[10px] text-zinc-600">{r.title}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase', statusChip(r.status))}>{r.status}</span>
                      {r.hardPass === true ? <ShieldCheck className="ml-1 inline size-3 text-emerald-400" aria-label="hard PASS" /> : null}
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-zinc-400 sm:table-cell">{r.slots ?? '—'}</td>
                    <td className="hidden px-3 py-2 font-mono text-zinc-500 md:table-cell">{r.exp ?? '—'} / {r.ab ?? '—'}</td>
                    <td className="hidden px-3 py-2 font-mono text-[10px] text-amber-500/70 lg:table-cell">{r.sha10 ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-zinc-500">{r.status === 'delivered' ? fmtDay(r.deliveredAt) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => props.onOpenInCycle(r.slug)}
                        title="открыть цикл этого слага на рабочем столе"
                        className="rounded border border-amber-500/40 px-1.5 py-0.5 font-mono text-[9px] text-amber-300 transition-colors hover:bg-amber-500/10"
                      >
                        <Sparkles className="inline size-2.5" /> в цикл
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {scratchLoading && scratch.length === 0 ? (
          <p className="border-t border-white/5 px-4 py-2 font-mono text-[10px] text-zinc-600">scratch twin&apos;а читается…</p>
        ) : null}
      </section>
    </div>
  )
}
