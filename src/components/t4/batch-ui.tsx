'use client'

/**
 * THREAD 4 — кластер работы с батчами: трекер рендера, Слоты, Сравнение A↔B,
 * TRIAL-радар. Порт из ветки fred-legacy (Фред, webDevReview #2-#5,
 * 2026-10-10) на конвейерную линию main — преемник, 2026-10-12.
 *
 * Источник данных — парсер batch-md.ts (одна правда): и эти панели, и
 * CLI-инструменты (lists / diff / trial) читают батчи одинаково.
 * Трекер рендера — черновая память браузера (localStorage): «слот
 * отрендерен» не событие ядра, летопись не трогаем.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Crosshair,
  Download,
  GitCompare,
  Layers,
  Radar,
  RotateCcw,
  Search,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDate, useApi } from '@/components/t4/api'
import { Chip, EmptyState, ErrorNote, Mono, Panel, SkeletonBlock } from '@/components/t4/bits'
import { TIER_RANK } from '@/lib/t4/verdicts'
import {
  buildDiffMarkdown,
  buildTrialRadarMarkdown,
  diffTokens,
  extractHypotheses,
  extractTrialLaws,
  parseBatchMd,
  stackIds,
  type BatchMd,
  type Hypothesis,
  type SlotMd,
  type TokenDiff,
} from '@/lib/t4/batch-md'
import { navigateToSlot, pendingSlotNav, clearPendingSlotNav, subscribeSlotNav } from '@/components/t4/nav'

/* ------------------------------------------------------------------ */
/* Общие типы (строки батчей, детали, приёмник)                        */
/* ------------------------------------------------------------------ */

export interface BatchRow {
  slug: string
  title: string
  date?: string
  rebuildOf?: string
}

export interface BatchDetailData {
  slug: string
  title: string
  markdown: string
  receipts: { gate: string; level: string; verdict: string; findings: string[] }[]
}

export interface BatchVerdictRecord {
  id: string
  at: string
  slug: string
  mode?: 'light' | 'full'
  verdict?: string
  summary: string
  scoreboard: {
    slots?: number
    claimed?: Record<string, number>
    delivered?: Record<string, number>
    claimDelta?: { up: number; down: number }
    platformDelta?: { up: number; down: number }
    vlmFlags?: Record<string, number>
  } | null
  slots: {
    position: string
    claim?: string
    myTier?: string
    yodayoTier?: string
    ph?: string
    vlmFlag?: string
    note?: string
  }[]
}

/* ------------------------------------------------------------------ */
/* Копирование                                                         */
/* ------------------------------------------------------------------ */

export function CopyBtn({ text, label, title }: { text: string; label: string; title: string }) {
  const [done, setDone] = useState(false)
  async function go() {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    } catch {
      /* тихо: как остальные копирующие кнопки дашборда */
    }
  }
  return (
    <button
      type="button"
      onClick={go}
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-4 transition-all outline-none focus-visible:ring-1 focus-visible:ring-amber-500/60 active:scale-95',
        done
          ? 'border-emerald-600/50 bg-emerald-600/10 text-emerald-400'
          : 'border-zinc-700/70 bg-zinc-800/50 text-zinc-400 hover:border-amber-500/50 hover:text-amber-300'
      )}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Трекер рендера (localStorage — черновая память, летопись не трогаем) */
/* ------------------------------------------------------------------ */

/** Как приёмник батча и VLM-журнал, живёт в localStorage браузера.
 *  «Слот отрендерен» не событие ядра — это счётчик руки автора.
 *  Ключ — по слагу батча. */
export function loadRenderProgress(slug: string): string[] {
  try {
    const raw = window.localStorage.getItem(`t4-render-progress-${slug}`)
    if (!raw) return []
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Единая точка записи трекера рендера — режим Просмотра и Сравнение
 *  пишут одни и те же ключи, счётчики не расходятся. */
export function saveRenderProgress(slug: string, ids: string[]) {
  window.localStorage.setItem(`t4-render-progress-${slug}`, JSON.stringify(ids))
}

/* ------------------------------------------------------------------ */
/* Глубокая навигация «радар → слот» (шина t4/nav)                     */
/* ------------------------------------------------------------------ */

/** Скролл к строке слота + янтарная вспышка. Модульная функция без
 *  реакт-состояния — её зовут и живой подписчик SlotStrip, и эффект,
 *  разбирающий sticky-намерение при позднем монтаже. */
function focusSlotRow(slug: string, slotId: string) {
  const el = document.getElementById(`slot-${slug}-${slotId}`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('t4-slot-flash')
  window.setTimeout(() => el.classList.remove('t4-slot-flash'), 3200)
}

/** Слот «отрендерен в паре»: отмечен в сторах всех сторон, где он есть
 *  (рендер пары — тот же слот из A и из B под одним сидом). */
function loadPairDone(aSlug: string, bSlug: string, a: BatchMd, b: BatchMd): string[] {
  const aStore = aSlug !== '' ? new Set(loadRenderProgress(aSlug)) : new Set<string>()
  const bStore = bSlug !== '' ? new Set(loadRenderProgress(bSlug)) : new Set<string>()
  const done: string[] = []
  const seen = new Set<string>()
  for (const s of [...a.slots, ...b.slots]) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    const inA = !a.slots.some((x) => x.id === s.id) || aStore.has(s.id)
    const inB = !b.slots.some((x) => x.id === s.id) || bStore.has(s.id)
    if (inA && inB) done.push(s.id)
  }
  return done
}

/* ------------------------------------------------------------------ */
/* Слоты: полоса рендера (трекер + копирование + манифест)             */
/* ------------------------------------------------------------------ */

export function SlotStrip({ slug, markdown }: { slug: string; markdown: string }) {
  const parsed = useMemo(() => parseBatchMd(markdown), [markdown])
  const [doneIds, setDoneIds] = useState<string[]>(() => loadRenderProgress(slug))

  useEffect(() => {
    saveRenderProgress(slug, doneIds)
  }, [slug, doneIds])

  /* Глубокая навигация (радар TRIAL-3 → слот): живой подписчик скроллит
   *  сразу; поздно смонтировавшийся трекер разбирает sticky-намерение,
   *  когда разбор батча уже готов (маркдаун приезжает асинхронно). */
  useEffect(() => {
    const off = subscribeSlotNav((intent) => {
      if (intent.slug !== slug) return
      focusSlotRow(slug, intent.slotId)
    })
    return off
  }, [slug])

  useEffect(() => {
    const intent = pendingSlotNav()
    if (!intent || intent.slug !== slug) return
    clearPendingSlotNav()
    const t = window.setTimeout(() => focusSlotRow(slug, intent.slotId), 90)
    return () => window.clearTimeout(t)
  }, [parsed, slug])

  if (!parsed) return null

  const total = parsed.slots.length
  const done = doneIds.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const doneSet = new Set(doneIds)

  function toggle(id: string) {
    setDoneIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  /* Копия «всё разом»: слоты пронумерованы шапками — очередь читается глазами. */
  const allPos = parsed.slots.map((s) => `${s.id} · ${s.slug}\n${s.pos}`).join('\n\n')
  const allNeg = parsed.slots.map((s) => `${s.id} · ${s.slug}\n${s.neg}`).join('\n\n')

  /* Манифест рендера: файл-квиток под руку — рендерить можно и без дашборда. */
  function downloadManifest() {
    const meta = (s: (typeof parsed.slots)[number]) =>
      [s.kind, s.who, s.rating, s.pose, s.palette, s.rehab].filter(Boolean).join(' · ')
    /* шапка батча уже несёт слаг («# T4-27 «…»») — не дублируем его в строке */
    let titleBody = parsed.title
    if (titleBody.startsWith(slug)) titleBody = titleBody.slice(slug.length).trim()
    const titleLine = titleBody !== '' ? ` — ${titleBody}` : ''
    const lines = [
      `THREAD 4 · рендер-лист · ${slug}${titleLine}`,
      `${total} слота · экспорт из дашборда · ${new Date().toLocaleString('ru-RU')}`,
      '',
    ]
    for (const s of parsed.slots) {
      lines.push(`[${s.id}] ${s.slug}${meta(s) ? ` · ${meta(s)}` : ''}`)
      lines.push(`POS: ${s.pos}`)
      lines.push(`NEG: ${s.neg}`)
      lines.push('')
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `render-list-${slug}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel
      title={`Слоты · ${total} промптов`}
      icon={<Layers className="size-4" />}
      bodyClassName="max-h-96 space-y-1 overflow-y-auto t4-scroll"
      action={
        <div className="flex items-center gap-1.5">
          <Chip tone={done >= total && total > 0 ? 'emerald' : done > 0 ? 'amber' : 'zinc'}>
            рендер {done}/{total}
          </Chip>
          {done > 0 ? (
            <button
              type="button"
              onClick={() => setDoneIds([])}
              title="Сбросить счётчик рендера этого батча (localStorage, летопись не трогается)"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-800/50 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-zinc-400 transition-colors hover:border-rose-500/50 hover:text-rose-300"
            >
              <RotateCcw className="size-3" />
              сброс
            </button>
          ) : null}
        </div>
      }
    >
      <p className="pb-1 text-[11px] leading-relaxed text-zinc-500">
        рендер 1 кадр/промпт: ⧉ копирует POS и NEG слота раздельно — вставляй в поля PixAI/Tsubaki
        по очереди; галочка отмечает отрендеренное — счётчик живёт в этом браузере и переживает
        перезагрузку.
      </p>
      <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
        <div
          className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-zinc-800"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`Отрендерено ${done} из ${total} слотов`}
        >
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              done >= total && total > 0
                ? 'bg-emerald-500'
                : 'bg-gradient-to-r from-amber-500 to-amber-300'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <CopyBtn
          text={allPos}
          label="все POS"
          title={`Скопировать POS всех ${total} слотов — пронумерованные шапками P01…`}
        />
        <CopyBtn
          text={allNeg}
          label="все NEG"
          title={`Скопировать NEG всех ${total} слотов — пронумерованные шапками P01…`}
        />
        <button
          type="button"
          onClick={downloadManifest}
          title="Скачать рендер-лист .txt — все слоты с POS/NEG одним файлом"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-800/50 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
        >
          <Download className="size-3" />
          .txt
        </button>
      </div>
      {parsed.slots.map((s) => {
        const isDone = doneSet.has(s.id)
        return (
          <div
            key={s.id}
            id={`slot-${slug}-${s.id}`}
            className={cn(
              'flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors',
              isDone
                ? 'border-emerald-700/50 bg-emerald-950/30 hover:border-emerald-600/50'
                : 'border-zinc-800/70 bg-zinc-950/60 hover:border-zinc-700'
            )}
          >
            <Checkbox
              checked={isDone}
              onCheckedChange={() => toggle(s.id)}
              aria-label={`${s.id} отрендерен`}
              title={isDone ? `Снять отметку ${s.id}` : `Отметить ${s.id} отрендеренным`}
              className="size-3.5 rounded-[4px] border-zinc-700 bg-zinc-900 transition-colors hover:border-emerald-500/60 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-zinc-950"
            />
            <Mono className={isDone ? 'text-emerald-300/80' : undefined}>{s.id}</Mono>
            {s.kind ? <Chip tone="zinc">{s.kind}</Chip> : null}
            {s.who ? <Chip tone="zinc">{s.who}</Chip> : null}
            {s.rating ? (
              <span className="shrink-0 font-mono text-[11px] text-amber-300/80">{s.rating}</span>
            ) : null}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[11px] transition-colors',
                isDone ? 'text-zinc-600' : 'text-zinc-400'
              )}
            >
              {s.slug}
              {s.palette ? <span className="text-zinc-600"> · {s.palette}</span> : null}
            </span>
            <CopyBtn text={s.pos} label="POS" title={`Скопировать POS ${s.id} (${s.slug})`} />
            <CopyBtn text={s.neg} label="NEG" title={`Скопировать NEG ${s.id} (${s.slug})`} />
          </div>
        )
      })}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Сравнение A↔B: послотовый дифф двух батчей                          */
/* ------------------------------------------------------------------ */

export function BatchCompare({
  items,
  a,
  b,
  onA,
  onB,
  loading,
}: {
  items: BatchRow[]
  a: string
  b: string
  onA: (s: string) => void
  onB: (s: string) => void
  loading: boolean
}) {
  const detailA = useApi<BatchDetailData>(a !== '' ? `/api/t4/batches/${a}` : null)
  const detailB = useApi<BatchDetailData>(b !== '' ? `/api/t4/batches/${b}` : null)
  const parsedA = useMemo(() => (detailA.data ? parseBatchMd(detailA.data.markdown) : null), [detailA.data])
  const parsedB = useMemo(() => (detailB.data ? parseBatchMd(detailB.data.markdown) : null), [detailB.data])
  /* Сторона копирования ⧉POS/⧉NEG в строках: рендер пары — это тот же слот
   *  из A и из B под одним сидом; по умолчанию копируем B (перестройка на
   *  суде автора), но с одного клика можно утянуть базу. */
  const [copySide, setCopySide] = useState<'a' | 'b'>('b')

  /* Трекер рендера пары: чекбокс строки отмечает слот в ОБОИХ сторонах
   *  (те же ключи, что трекер режима Просмотра — счётчики едины). Пара
   *  меняется — память перечитывается (присвоение при рендере, не эффект:
   *  реакт-линт запрещает set-state-in-effect). */
  const [pairKey, setPairKey] = useState('')
  const [pairDone, setPairDone] = useState<string[]>([])
  /* Фильтр строк: 33 слота — «P25» или хвост слага находит строку быстрее
   *  скролла; пустой фильтр — все строки (как раньше). */
  const [slotQuery, setSlotQuery] = useState('')
  const ready = parsedA != null && parsedB != null && a !== '' && b !== '' && a !== b
  const curPair = ready ? `${a}::${b}` : ''
  if (curPair !== pairKey) {
    setPairKey(curPair)
    setPairDone(curPair === '' ? [] : loadPairDone(a, b, parsedA!, parsedB!))
  }

  function togglePairDone(id: string) {
    const willDone = !pairDone.includes(id)
    setPairDone((cur) => (willDone ? [...cur, id] : cur.filter((x) => x !== id)))
    /* пишем только стороны, где слот есть; ключи те же, что в Просмотре */
    for (const [slug, parsed] of [
      [a, parsedA],
      [b, parsedB],
    ] as const) {
      if (!parsed || !parsed.slots.some((s) => s.id === id)) continue
      const cur = loadRenderProgress(slug)
      saveRenderProgress(slug, willDone ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id))
    }
  }

  /* Счётчики прогресса пары — те же числа, что трекер Просмотра каждой стороны */
  const aTotal = parsedA?.slots.length ?? 0
  const bTotal = parsedB?.slots.length ?? 0
  const aDoneN = a !== '' && aTotal > 0 ? loadRenderProgress(a).length : 0
  const bDoneN = b !== '' && bTotal > 0 ? loadRenderProgress(b).length : 0
  const pairDoneSet = new Set(pairDone)

  /* Дифф-документ пары — квиток одним файлом (сгенерировано buildDiffMarkdown,
   *  тот же разбор, что на экране). */
  function downloadDiff() {
    if (!ready || !parsedA || !parsedB) return
    const md = buildDiffMarkdown(a, b, parsedA, parsedB)
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const el = document.createElement('a')
    el.href = url
    el.download = `diff-${a}_to_${b}.md`
    el.click()
    URL.revokeObjectURL(url)
  }

  /* Слоты, выровненные по позиции: объединение id обеих сторон. */
  const rows = useMemo(() => {
    const map = new Map<string, { id: string; a?: SlotMd; b?: SlotMd }>()
    for (const s of parsedA?.slots ?? []) map.set(s.id, { id: s.id, a: s })
    for (const s of parsedB?.slots ?? []) {
      const cur = map.get(s.id)
      if (cur) cur.b = s
      else map.set(s.id, { id: s.id, b: s })
    }
    return [...map.values()].sort((x, y) => x.id.localeCompare(y.id))
  }, [parsedA, parsedB])

  /* Фильтр: позиция или слаг любой стороны; регистр не важен. */
  const visibleRows = useMemo(() => {
    const q = slotQuery.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.a?.slug.toLowerCase().includes(q) ||
        r.b?.slug.toLowerCase().includes(q)
    )
  }, [rows, slotQuery])

  const stats = useMemo(() => {
    let posAdd = 0
    let posRem = 0
    let negAdd = 0
    let negRem = 0
    let onlyA = 0
    let onlyB = 0
    const perSlot: { id: string; add: number; rem: number }[] = []
    for (const r of rows) {
      if (r.a && !r.b) {
        onlyA++
        continue
      }
      if (!r.a && r.b) {
        onlyB++
        continue
      }
      const dP = diffTokens(r.a!.pos, r.b!.pos)
      const dN = diffTokens(r.a!.neg, r.b!.neg)
      posAdd += dP.added.length
      posRem += dP.removed.length
      negAdd += dN.added.length
      negRem += dN.removed.length
      perSlot.push({ id: r.id, add: dP.added.length, rem: dP.removed.length })
    }
    perSlot.sort((x, y) => y.add + y.rem - (x.add + x.rem))
    return {
      posAdd,
      posRem,
      negAdd,
      negRem,
      onlyA,
      onlyB,
      top: perSlot.filter((p) => p.add + p.rem > 0).slice(0, 3),
    }
  }, [rows])

  const selectCls =
    'h-8 max-w-[220px] rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 focus-visible:outline-none focus-visible:border-amber-500/50'

  return (
    <Panel title="Сравнение A↔B — что перестроено, слот к слоту" icon={<GitCompare className="size-4" />} bodyClassName="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={a} onChange={(e) => onA(e.target.value)} aria-label="Батч A (база)" className={selectCls}>
          <option value="">— A · база —</option>
          {items.map((i) => (
            <option key={i.slug} value={i.slug}>{i.slug} · {i.title}</option>
          ))}
        </select>
        <span className="text-zinc-600" aria-hidden>→</span>
        <select value={b} onChange={(e) => onB(e.target.value)} aria-label="Батч B (перестройка)" className={selectCls}>
          <option value="">— B · перестройка —</option>
          {items.map((i) => (
            <option key={i.slug} value={i.slug}>{i.slug} · {i.title}</option>
          ))}
        </select>
        <div
          className="flex shrink-0 rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
          role="group"
          aria-label="Сторона копирования POS/NEG в строках"
          title="⧉POS/⧉NEG в строках ниже копируют эту сторону (слот есть только с одной — копируется она)"
        >
          {(['a', 'b'] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => setCopySide(side)}
              aria-pressed={copySide === side}
              className={cn(
                'rounded-[5px] px-2 py-1 text-[11px] font-medium uppercase tracking-wide transition-all active:scale-95',
                copySide === side
                  ? side === 'a'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-emerald-600/15 text-emerald-400'
                  : 'text-zinc-600 hover:text-zinc-300'
              )}
            >
              ⧉ из {side}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={downloadDiff}
          disabled={!ready}
          title="Скачать дифф пары одним .md-документом — та же перестройка, что на экране, файлом"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-800/50 px-1.5 py-1 text-[10px] font-medium leading-4 text-zinc-400 transition-all outline-none hover:border-amber-500/50 hover:text-amber-300 focus-visible:ring-1 focus-visible:ring-amber-500/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="size-3" />
          дифф .md
        </button>
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-zinc-600" />
          <input
            value={slotQuery}
            onChange={(e) => setSlotQuery(e.target.value)}
            placeholder="P25 / slug"
            aria-label="Фильтр строк сравнения: позиция или слаг"
            title="Фильтр строк: позиция (P25) или слаг любой стороны; пусто — все строки"
            className="h-6 w-36 rounded-md border border-zinc-800 bg-zinc-950 pl-7 pr-6 text-[11px] text-zinc-300 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:border-amber-500/50"
          />
          {slotQuery !== '' ? (
            <button
              type="button"
              onClick={() => setSlotQuery('')}
              aria-label="Сбросить фильтр строк"
              title="Сбросить фильтр"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-zinc-600 transition-colors hover:text-amber-300"
            >
              <RotateCcw className="size-3" />
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        роза — убрано из A · изумруд — добавлено в B · цинк — общее (в порядке B). Чекбокс строки
        отмечает слот отрендеренным в обеих сторонах — счётчики те же, что трекер Просмотра.
        Чтение диффа — глазами, не верой: это разбор текста промпта, а не рендера.
      </p>

      {loading || detailA.loading || detailB.loading ? (
        <SkeletonBlock lines={4} />
      ) : a === '' || b === '' ? (
        <EmptyState
          title="Выбери пару"
          hint="A — база (что было), B — перестройка (что стало). По умолчанию — два последних батча."
        />
      ) : a === b ? (
        <ErrorNote text="A и B — один и тот же батч" hint="дифф пустой по определению; выбери пару разных." />
      ) : !parsedA || !parsedB ? (
        <ErrorNote text="Батч не распарсился" hint="формат файла отличается от канона «P0X — … (мета)» — глянь файл руками." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="zinc">A: {parsedA.slots.length} слотов</Chip>
            <Chip tone="zinc">B: {parsedB.slots.length}</Chip>
            {slotQuery.trim() !== '' ? (
              <Chip tone="amber">
                фильтр: {visibleRows.length} из {rows.length}
              </Chip>
            ) : null}
            <Chip tone={aDoneN >= aTotal && aTotal > 0 ? 'emerald' : aDoneN > 0 ? 'amber' : 'zinc'}>
              рендер A {aDoneN}/{aTotal}
            </Chip>
            <Chip tone={bDoneN >= bTotal && bTotal > 0 ? 'emerald' : bDoneN > 0 ? 'amber' : 'zinc'}>
              рендер B {bDoneN}/{bTotal}
            </Chip>
            {stats.onlyA > 0 ? <Chip tone="rose">только в A: {stats.onlyA}</Chip> : null}
            {stats.onlyB > 0 ? <Chip tone="emerald">новых в B: {stats.onlyB}</Chip> : null}
            <Chip tone="amber">POS +{stats.posAdd} · −{stats.posRem}</Chip>
            <Chip tone="amber">NEG +{stats.negAdd} · −{stats.negRem}</Chip>
          </div>
          {stats.top.length > 0 ? (
            <p className="text-[11px] leading-relaxed text-zinc-500">
              самые перестроенные (POS):{' '}
              {stats.top.map((t, i) => (
                <span key={t.id}>
                  {i > 0 ? ' · ' : ''}
                  <span className="font-mono text-amber-300/90">{t.id}</span>
                  <span className="text-zinc-600"> +{t.add}/−{t.rem}</span>
                </span>
              ))}
            </p>
          ) : null}
          <div className="space-y-1.5">
            {visibleRows.length === 0 ? (
              <EmptyState
                title="Фильтр ничего не нашёл"
                hint={`«${slotQuery.trim()}» не встречается ни в позиции, ни в слаге — сбрось фильтр или попробуй короче.`}
              />
            ) : (
              visibleRows.map((r) => (
                <SlotDiff
                  key={r.id}
                  a={r.a}
                  b={r.b}
                  copySide={copySide}
                  done={pairDoneSet.has(r.id)}
                  onToggleDone={() => togglePairDone(r.id)}
                />
              ))
            )}
          </div>
        </>
      )}
    </Panel>
  )
}

/** Чип мета-поля A→B: одинаково — цинк, появилось в B — изумруд,
 *  исчезло из A — роза, поменялось — янтарь со стрелкой. */
function MetaChip({ va, vb }: { va: string; vb: string }) {
  if (va === '' && vb === '') return null
  if (va === vb) return <Chip tone="zinc">{va}</Chip>
  if (vb === '') return <Chip tone="rose">{`${va} —`}</Chip>
  if (va === '') return <Chip tone="emerald">{vb}</Chip>
  return <Chip tone="amber">{`${va} → ${vb}`}</Chip>
}

/** Одна строка сравнения: шапка (свёрнуто/развернуто) + тело диффа.
 *  copySide — сторона для ⧉POS/⧉NEG: обе есть — выбранная, одна — она сама.
 *  done/onToggleDone — трекер рендера пары: чекбокс отмечает слот в обеих сторонах. */
function SlotDiff({
  a,
  b,
  copySide,
  done,
  onToggleDone,
}: {
  a?: SlotMd
  b?: SlotMd
  copySide: 'a' | 'b'
  done?: boolean
  onToggleDone?: () => void
}) {
  /* null = авто: развёрнуто, если есть структурная перестройка */
  const [open, setOpen] = useState<boolean | null>(null)
  const dP: TokenDiff = diffTokens(a?.pos ?? '', b?.pos ?? '')
  const dN: TokenDiff = diffTokens(a?.neg ?? '', b?.neg ?? '')
  const stackA = a ? stackIds(a.stack) : []
  const stackB = b ? stackIds(b.stack) : []
  const stackChanged = Boolean(a && b && a.stack !== b.stack)
  const metaChanged = Boolean(
    a && b && (a.kind !== b.kind || a.who !== b.who || a.rating !== b.rating || a.pose !== b.pose || a.palette !== b.palette)
  )
  const thesisChanged = Boolean(a && b && a.thesis !== b.thesis)
  const canonChanged = Boolean(a && b && a.canon !== b.canon)
  const structural =
    dP.added.length + dP.removed.length + dN.added.length + dN.removed.length > 0 || stackChanged || metaChanged
  const expanded = open ?? structural
  const onlyIn = !b ? 'A' : !a ? 'B' : null
  const nChanges = dP.added.length + dP.removed.length + dN.added.length + dN.removed.length
  const src = a && b ? (copySide === 'a' ? a : b) : (a ?? b)
  const srcSide = a && b ? (copySide === 'a' ? 'A' : 'B') : onlyIn
  const copyPos = src?.pos ?? ''
  const copyNeg = src?.neg ?? ''

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        done
          ? 'border-emerald-800/50 bg-emerald-950/20 hover:border-emerald-700/50'
          : onlyIn
            ? 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-700/80'
            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700/80'
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 sm:px-3">
        {onToggleDone ? (
          <Checkbox
            checked={done ?? false}
            onCheckedChange={onToggleDone}
            aria-label={`${a?.id ?? b?.id ?? ''} отрендерен в паре`}
            title={done ? `Снять отметку ${a?.id ?? b?.id ?? ''} (обе стороны)` : `Отметить ${a?.id ?? b?.id ?? ''} отрендеренным в обеих сторонах`}
            className="size-3.5 shrink-0 rounded-[4px] border-zinc-700 bg-zinc-900 transition-colors hover:border-emerald-500/60 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-zinc-950"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(!(open ?? structural))}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50"
        >
          <ChevronRight
            className={cn('size-3.5 shrink-0 text-zinc-600 transition-transform', expanded && 'rotate-90')}
          />
          <Mono className={done ? 'text-emerald-300/80' : undefined}>{a?.id ?? b?.id}</Mono>
          {a && b && a.slug !== b.slug ? (
            <span className="truncate text-[11px] text-zinc-500">
              {a.slug} <span className="text-amber-500/70">→</span> {b.slug}
            </span>
          ) : (
            <span className={cn('truncate text-[11px]', done ? 'text-zinc-600' : 'text-zinc-400')}>
              {(a ?? b)?.slug}
            </span>
          )}
          {onlyIn === 'A' ? <Chip tone="rose">только в A</Chip> : null}
          {onlyIn === 'B' ? <Chip tone="emerald">новый в B</Chip> : null}
          {thesisChanged && !structural ? <Chip tone="zinc">тезис изменён</Chip> : null}
          <span
            className={cn(
              'ml-auto shrink-0 font-mono text-[10px]',
              nChanges > 0 ? 'text-amber-400/90' : 'text-zinc-600'
            )}
          >
            {nChanges > 0
              ? `+${dP.added.length + dN.added.length}/−${dP.removed.length + dN.removed.length}`
              : 'без изм.'}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <CopyBtn
            text={copyPos}
            label={`POS·${srcSide}`}
            title={`Скопировать POS ${(b ?? a)?.id ?? ''} со стороны ${srcSide} (${src?.slug ?? ''}) — сторона меняется тумблером «⧉ из»`}
          />
          <CopyBtn
            text={copyNeg}
            label={`NEG·${srcSide}`}
            title={`Скопировать NEG ${(b ?? a)?.id ?? ''} со стороны ${srcSide} (${src?.slug ?? ''}) — сторона меняется тумблером «⧉ из»`}
          />
        </div>
      </div>
      {expanded ? (
        <div className="space-y-2.5 border-t border-zinc-800/70 px-2 py-2.5 sm:px-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {a && b ? (
              <>
                <MetaChip va={a.kind} vb={b.kind} />
                <MetaChip va={a.who} vb={b.who} />
                <MetaChip va={a.rating} vb={b.rating} />
                <MetaChip va={a.pose} vb={b.pose} />
                <MetaChip va={a.palette} vb={b.palette} />
                {a.rehab || b.rehab ? <Chip tone="amber">{a.rehab || b.rehab}</Chip> : null}
              </>
            ) : (
              (a ?? b) && (
                <>
                  {(a ?? b)!.kind ? <Chip tone={onlyIn === 'B' ? 'emerald' : 'zinc'}>{(a ?? b)!.kind}</Chip> : null}
                  {(a ?? b)!.who ? <Chip tone="zinc">{(a ?? b)!.who}</Chip> : null}
                  {(a ?? b)!.rating ? <Chip tone="amber">{(a ?? b)!.rating}</Chip> : null}
                  {(a ?? b)!.palette ? <Chip tone="zinc">{(a ?? b)!.palette}</Chip> : null}
                </>
              )
            )}
          </div>
          {stackChanged && a && b ? (
            <p className="text-[11px] leading-relaxed text-zinc-500">
              <span className="text-zinc-600">Stack A:</span>{' '}
              <span className="font-mono text-rose-300/80">{stackA.join(' + ') || '—'}</span>
              {' → '}
              <span className="text-zinc-600">B:</span>{' '}
              <span className="font-mono text-emerald-400/90">{stackB.join(' + ') || '—'}</span>
            </p>
          ) : null}
          {thesisChanged && b ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500" title={b.thesis}>
              <span className="text-zinc-600">тезис B:</span> {b.thesis}
            </p>
          ) : null}
          {canonChanged && b && b.canon ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500" title={b.canon}>
              <span className="text-zinc-600">канон B:</span> {b.canon}
            </p>
          ) : null}
          <DiffChips label="POS" d={dP} />
          <DiffChips label="NEG" d={dN} />
        </div>
      ) : null}
    </div>
  )
}

/** Поток тегов одного поля: общее (цинк) + добавлено (изумруд), убрано (роза). */
function DiffChips({ label, d }: { label: 'POS' | 'NEG'; d: TokenDiff }) {
  if (d.kept.length === 0 && d.added.length === 0 && d.removed.length === 0) {
    return <p className="text-[11px] text-zinc-600">{label}: пусто в обоих</p>
  }
  const tone = (kind: 'kept' | 'added' | 'removed') =>
    cn(
      'inline-block max-w-[240px] truncate rounded border px-1.5 py-0.5 text-[11px] leading-4 sm:max-w-[420px]',
      kind === 'kept' && 'border-zinc-800 bg-zinc-900 text-zinc-500',
      kind === 'added' && 'border-emerald-600/40 bg-emerald-600/10 text-emerald-400',
      kind === 'removed' && 'border-rose-500/30 bg-rose-500/5 text-rose-300/80 line-through'
    )
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{label}</span>
        {d.added.length + d.removed.length > 0 ? (
          <span className="font-mono text-[10px] text-amber-400/90">
            +{d.added.length} · −{d.removed.length}
          </span>
        ) : (
          <span className="text-[10px] text-zinc-600">без изменений</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {d.kept.map((t, i) => (
          <span key={`k${i}`} className={tone('kept')} title={t}>{t}</span>
        ))}
        {d.added.map((t, i) => (
          <span key={`a${i}`} className={tone('added')} title={t}>{t}</span>
        ))}
      </div>
      {d.removed.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          <span className="mr-0.5 font-mono text-[10px] uppercase leading-5 tracking-wider text-zinc-600">
            убрано из A
          </span>
          {d.removed.map((t, i) => (
            <span key={`r${i}`} className={tone('removed')} title={t}>{t}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Панель 0 (Вердикты): TRIAL-3 радар — законы и EXP-гипотезы           */
/* ------------------------------------------------------------------ */

/** Статус гипотезы: куда двигается рука автора. */
type HypoStatus = 'render' | 'verdict' | 'done'

function TrialStatusPill({ status, rendered, total }: { status: HypoStatus; rendered: number; total: number }) {
  const map: Record<HypoStatus, { cls: string; dot: string; label: string }> = {
    render: {
      cls: 'border-zinc-700/70 bg-zinc-800/50 text-zinc-400',
      dot: 'bg-zinc-500',
      label: `ждёт рендер · ${rendered}/${total}`,
    },
    verdict: {
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      dot: 'bg-amber-400',
      label: 'отрендерена — ждёт вердикт',
    },
    done: {
      cls: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-400',
      dot: 'bg-emerald-500',
      label: 'вердикт записан',
    },
  }
  const m = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium', m.cls)}>
      {/* янтарная точка «ждёт вердикт» пульсирует — рука автора должна
       *  найти её без поиска (reduced-motion гасится ниже) */}
      <span className={cn('size-1.5 rounded-full', m.dot, status === 'verdict' && 't4-pulse')} />
      {m.label}
    </span>
  )
}

/** ↑↓ тиров пары по глазу автора: чья половинка доставила выше. */
function tierDeltaLabel(ta?: string, tb?: string): string {
  if (!ta || !tb) return ''
  const va = TIER_RANK[ta] ?? -1
  const vb = TIER_RANK[tb] ?? -1
  if (va < 0 || vb < 0) return ''
  if (va > vb) return 'A выше'
  if (va < vb) return 'B выше'
  return 'A = B'
}

/** Чип слота с глубокой навигацией: клик — Батчи → батч → строка слота. */
function SlotNavChip({
  slug,
  slotId,
  side,
  alchemy,
}: {
  slug: string
  slotId: string
  side: 'A' | 'B' | ''
  alchemy: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigateToSlot(slug, slotId)
      }}
      title={`${slotId} · ${side ? `половинка ${side}` : 'одиночка'} — открыть строку слота в Батчах${alchemy ? ' · ⚗ осознанный нарушитель' : ''}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-4 transition-all hover:border-amber-500/50 hover:text-amber-300 active:scale-95',
        alchemy
          ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300/90'
          : 'border-zinc-700/70 bg-zinc-800/50 text-zinc-300'
      )}
    >
      {slotId}
      {side ? <span className="font-sans text-[9px] text-zinc-500">{side}</span> : null}
      {alchemy ? <span aria-hidden>⚗</span> : null}
    </button>
  )
}

/** Строка гипотезы: шапка-кнопка (грек/H-ид/закон/чипы/статус) + раскрытие
 *  с тезисами половинок, POS-дельтой и тирами вердикта. */
function RadarHypoRow({
  h,
  effSlug,
  rendered,
  record,
  tierByPos,
  open,
  onToggle,
}: {
  h: Hypothesis
  effSlug: string
  rendered: Set<string>
  record: BatchVerdictRecord | null
  tierByPos: Map<string, string>
  open: boolean
  onToggle: () => void
}) {
  const halves: { half: NonNullable<Hypothesis['a']>; side: 'A' | 'B' | '' }[] =
    h.kind === 'pair'
      ? [
          { half: h.a, side: 'A' as const },
          { half: h.b, side: 'B' as const },
        ]
      : [{ half: h.single, side: '' }]
  const present = halves.filter((x) => x.half != null) as { half: NonNullable<Hypothesis['a']>; side: 'A' | 'B' | '' }[]
  const doneCount = present.filter((x) => rendered.has(x.half.slotId)).length
  const status: HypoStatus = record
    ? 'done'
    : doneCount === present.length && doneCount > 0
      ? 'verdict'
      : 'render'
  const tierA = h.a ? tierByPos.get(h.a.slotId) : undefined
  const tierB = h.b ? tierByPos.get(h.b.slotId) : undefined
  const tierSingle = h.single ? tierByPos.get(h.single.slotId) : undefined
  const delta = record && h.kind === 'pair' ? tierDeltaLabel(tierA, tierB) : ''
  const dP = h.kind === 'pair' && h.a && h.b ? diffTokens(h.a.pos, h.b.pos) : null

  return (
    <div
      className={cn(
        'rounded-md border bg-zinc-950/60 transition-colors hover:border-zinc-700/80',
        open ? 'border-amber-500/25 bg-amber-500/[0.02]' : 'border-zinc-800'
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`Гипотеза ${h.greek}${h.hid ? ` (${h.hid})` : ''} — ${h.title || 'EXP'}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2 transition-colors hover:bg-zinc-900/70"
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs',
            h.kind === 'pair'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
          )}
        >
          {h.greek}
        </span>
        {h.hid ? <Chip tone="amber">{h.hid}</Chip> : null}
        <span className="min-w-0 basis-24 text-xs font-medium text-zinc-200">
          {h.title || (h.kind === 'pair' ? 'A/B-пара' : 'одиночка')}
        </span>
        {h.lawNo ? (
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 font-mono text-[10px] text-zinc-500">
            закон №{h.lawNo}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {present.map(({ half, side }) => (
            <SlotNavChip key={half.slotId} slug={effSlug} slotId={half.slotId} side={side} alchemy={half.alchemy} />
          ))}
          {record && h.kind === 'pair' && tierA && tierB ? (
            <Chip tone="emerald" className="font-mono">
              {tierA} ↔ {tierB}
            </Chip>
          ) : null}
          {record && h.kind === 'single' && tierSingle ? (
            <Chip tone="emerald" className="font-mono">
              {tierSingle}
            </Chip>
          ) : null}
          {delta && delta !== 'A = B' ? <Chip tone="emerald">{delta}</Chip> : null}
          <TrialStatusPill status={status} rendered={doneCount} total={present.length} />
          <ChevronDown className={cn('size-3.5 shrink-0 text-zinc-600 transition-transform', open && 'rotate-180')} />
        </span>
      </div>
      {open ? (
        <div className="space-y-2 border-t border-zinc-800/70 px-3 py-2.5">
          {present.map(({ half, side }) => (
            <div key={half.slotId} className="rounded-md border border-zinc-800/70 bg-zinc-950/50 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Mono>{half.slotId}</Mono>
                <span className="font-mono text-[10px] text-zinc-500">{half.slotSlug}</span>
                {side ? (
                  <Chip tone={side === 'A' ? 'amber' : 'emerald'}>
                    {h.greek}-{side}
                  </Chip>
                ) : (
                  <Chip>{h.greek} · одиночка</Chip>
                )}
                {half.alchemy ? <Chip tone="rose">⚗ осознанный нарушитель</Chip> : null}
                {record && tierByPos.get(half.slotId) ? (
                  <Chip tone="emerald" className="font-mono">
                    глаз автора: {tierByPos.get(half.slotId)}
                  </Chip>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-zinc-400" title={half.thesis}>
                {half.thesis}
              </p>
            </div>
          ))}
          {dP ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <span>POS A→B:</span>
              <Chip tone="amber">+{dP.added.length}</Chip>
              <Chip tone="rose">−{dP.removed.length}</Chip>
              <span className="text-zinc-600">разница половинок — ровно одна переменная (§10)</span>
            </div>
          ) : null}
          {record ? (
            <p className="text-[11px] text-emerald-400/80">
              вердикт записан {formatDate(record.at)} — тиры половинок выше; A/B-атрибуция решает судьбу закона.
            </p>
          ) : (
            <p className="text-[11px] text-zinc-600">
              рендер пары — тот же слот из A и из B под одним сидом; галочки трекера (Слоты) двигают статус.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function TrialRadarPanel() {
  const batches = useApi<{ items: { slug: string; title: string }[] }>('/api/t4/batches')
  const records = useApi<{ records: BatchVerdictRecord[] }>('/api/t4/batch-verdict')
  const [slug, setSlug] = useState('')
  /* 'ALL' — режим «развернуть всё» (кнопка в шапке EXP-программы);
   *  клик по строке в этом режиме сворачивает остальные — аккордеон
   *  остаётся одно-открытым, кнопка вернёт всё сразу. */
  const [open, setOpen] = useState<string | null>(null)
  const items = batches.data?.items ?? []
  /* дефолт — новейший батч (сегодня T4-27.2-EXP, живая пара момента) */
  const effSlug = slug !== '' ? slug : items[0]?.slug ?? ''
  const detail = useApi<BatchDetailData>(effSlug !== '' ? `/api/t4/batches/${effSlug}` : null)
  const parsed = useMemo(() => (detail.data ? parseBatchMd(detail.data.markdown) : null), [detail.data])
  const ownLaws = useMemo(() => (detail.data ? extractTrialLaws(detail.data.markdown) : []), [detail.data])
  const hypos = useMemo(
    () => (parsed && detail.data ? extractHypotheses(detail.data.markdown, parsed) : []),
    [parsed, detail.data]
  )
  /* трекер рендера — та же черновая память, что Слоты и Сравнение.
   *  Читается прямым вычислением (не useMemo): чтение localStorage —
   *  нечистое, реактовский компилятор такое memo не сохраняет; массив
   *  мал (десятки id) — на каждый рендер не жалко. */
  const rendered = effSlug !== '' ? new Set(loadRenderProgress(effSlug)) : new Set<string>()
  const record = (records.data?.records ?? []).find((r) => r.slug === effSlug) ?? null
  const tierByPos = new Map<string, string>()
  for (const s of record?.slots ?? []) if (s.myTier) tierByPos.set(s.position, s.myTier)

  /* H13 BODY-SPECTRUM: перестройка — тот же T4-NN базой под другим слагом;
   *  карта пары видна, когда вторая сторона несёт BODY-SPECTRUM в файле. */
  const base = effSlug.match(/^T4-\d+/)?.[0] ?? ''
  const pairOther =
    base !== '' ? items.find((i) => i.slug !== effSlug && i.slug.startsWith(base)) : undefined
  const pairOtherDetail = useApi<BatchDetailData>(pairOther ? `/api/t4/batches/${pairOther.slug}` : null)
  const isRebuild = effSlug !== base && effSlug !== ''
  const pairA = isRebuild ? (pairOther?.slug ?? '') : effSlug
  const pairB = isRebuild ? effSlug : (pairOther?.slug ?? '')
  const otherParsed = useMemo(
    () => (pairOtherDetail.data ? parseBatchMd(pairOtherDetail.data.markdown) : null),
    [pairOtherDetail.data]
  )
  /* перестройка (T4-27.2-EXP) не повторяет список законов родителя —
   *  радар берёт их из стороны пары (источник подписан) */
  const otherLaws = useMemo(
    () => (pairOtherDetail.data ? extractTrialLaws(pairOtherDetail.data.markdown) : []),
    [pairOtherDetail.data]
  )
  const laws = ownLaws.length > 0 ? ownLaws : otherLaws
  const lawSource = ownLaws.length > 0 ? '' : pairOther?.slug ?? ''
  const h13 =
    pairOther && pairOtherDetail.data?.markdown &&
    (pairOtherDetail.data.markdown.includes('BODY-SPECTRUM') ||
      detail.data?.markdown?.includes('BODY-SPECTRUM'))
      ? {
          a: pairA,
          b: pairB,
          aDone: loadRenderProgress(pairA).length,
          bDone: loadRenderProgress(pairB).length,
          aTotal: (isRebuild ? otherParsed?.slots.length : parsed?.slots.length) ?? 0,
          bTotal: (isRebuild ? parsed?.slots.length : otherParsed?.slots.length) ?? 0,
          verdictB: (records.data?.records ?? []).some((r) => r.slug === pairB),
        }
      : null

  const loading = batches.loading || (effSlug !== '' && detail.loading)

  /* Сводка триала файлом — те же законы/гипотезы/статусы, что на экране
   *  (buildTrialRadarMarkdown — чистая функция, её же зовёт CLI-инструмент). */
  function downloadTrial() {
    if (!detail.data) return
    const md = buildTrialRadarMarkdown({
      slug: effSlug,
      title: detail.data.title,
      lawSource: lawSource !== '' ? lawSource : undefined,
      laws,
      hypos,
      rendered: [...rendered],
      verdictRecord: record != null,
      pair: h13 ?? undefined,
    })
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const el = document.createElement('a')
    el.href = url
    el.download = `trial-${effSlug}.md`
    el.click()
    URL.revokeObjectURL(url)
  }

  /* Полоса прогресса рендера батча — те же числа, что трекер Слотов:
   *  янтарь с шиммером в пути, изумруд на 100%. */
  const renderTotal = parsed?.slots.length ?? 0
  const renderDone = [...rendered].length
  const renderPct = renderTotal > 0 ? Math.min(100, Math.round((renderDone / renderTotal) * 100)) : 0

  return (
    <Panel
      title="TRIAL-3 · радар законов"
      icon={<Radar className="size-4" />}
      action={
        <div className="flex items-center gap-1.5">
          <select
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setOpen(null)
            }}
            aria-label="Батч радара TRIAL-3"
            className="h-8 max-w-[220px] rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 focus-visible:outline-none focus-visible:border-amber-500/50"
          >
            {items.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.slug}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadTrial}
            disabled={loading || !detail.data}
            title="Скачать сводку триала одним .md — законы, гипотезы, тезисы и статусы; тот же файл даёт CLI-инструмент"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-800/50 px-1.5 py-1 text-[10px] font-medium leading-4 text-zinc-400 transition-all outline-none hover:border-amber-500/50 hover:text-amber-300 focus-visible:ring-1 focus-visible:ring-amber-500/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="size-3" />
            .md
          </button>
        </div>
      }
    >
      {loading ? (
        <SkeletonBlock lines={6} />
      ) : !detail.data ? (
        <EmptyState
          title="Батч не читается"
          hint="Радар берёт программу триала из файла батча — выбери другой слаг."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-500">
            T4-27 закрывает цикл TRIAL-3: вердикт автора переводит законы{' '}
            <span className="font-mono text-amber-300/80">M15-M20</span> в конституцию, а A/B-пары
            EXP решают судьбу кандидатов. Радар собирает законы, гипотезы и статусы в одном месте:
            статусы едят трекер рендера (вкладка Батчи → Слоты) и записи приёмника (панель ниже).
          </p>

          {/* Полоса момента: рендер батча + вердикт — глаз автора видит
           *  одну строку вместо сверки счётчиков по панелям. */}
          <div className="rounded-md border border-zinc-800/80 bg-zinc-950/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-zinc-600">момент</span>
              <Chip tone={renderDone >= renderTotal && renderTotal > 0 ? 'emerald' : renderDone > 0 ? 'amber' : 'zinc'}>
                рендер {renderDone}/{renderTotal}
              </Chip>
              <Chip tone={record ? 'emerald' : 'zinc'}>{record ? 'вердикт записан' : 'вердикт ждёт'}</Chip>
              {h13 ? (
                <Chip tone="rose">
                  H13: {h13.a} {h13.aDone}/{h13.aTotal} ↔ {h13.b} {h13.bDone}/{h13.bTotal}
                </Chip>
              ) : null}
              <span className="ml-auto font-mono text-[10px] text-zinc-600">{renderPct}%</span>
            </div>
            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800/80"
              role="progressbar"
              aria-label="Прогресс рендера батча"
              aria-valuenow={renderDone}
              aria-valuemin={0}
              aria-valuemax={renderTotal}
            >
              <div
                style={{ width: `${renderPct}%` }}
                className={cn(
                  'h-full rounded-full transition-[width] duration-500',
                  renderPct >= 100
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                    : 't4-shimmer bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400'
                )}
              />
            </div>
          </div>

          {laws.length > 0 ? (
            <div>
              <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600">
                Законы триала · {laws.length}
                {lawSource !== '' ? (
                  <span className="font-mono normal-case text-zinc-700">из {lawSource}</span>
                ) : null}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {laws.map((l) => (
                  <div
                    key={l.id}
                    title={l.note}
                    className="relative rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 transition-all duration-200 hover:-translate-y-px hover:border-zinc-700 hover:shadow-md hover:shadow-zinc-950/60"
                  >
                    {/* фуксиевая волосинка сверху — законы выделяются из
                     *  общего цинкового фона сетки */}
                    <span
                      aria-hidden
                      className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-fuchsia-500/50 via-fuchsia-500/15 to-transparent"
                    />
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 font-mono text-[10px] text-fuchsia-300">
                        {l.id}
                      </span>
                      <span className="min-w-0 truncate text-xs font-medium text-zinc-200">{l.name}</span>
                      {l.ref ? (
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-amber-300/70">{l.ref}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-zinc-400" title={l.note}>
                      {l.note}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {hypos.length > 0 ? (
            <div>
              <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600">
                EXP-программа · {hypos.length}
                <span className="font-mono normal-case text-zinc-700">
                  {hypos.filter((x) => x.kind === 'pair').length} пары +{' '}
                  {hypos.filter((x) => x.kind === 'single').length} одиночки
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(open === 'ALL' ? null : 'ALL')}
                  aria-pressed={open === 'ALL'}
                  title={open === 'ALL' ? 'Свернуть все гипотезы' : 'Развернуть все гипотезы сразу — вся программа перед вердиктом'}
                  className={cn(
                    'ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] normal-case leading-4 transition-all outline-none hover:border-amber-500/50 hover:text-amber-300 focus-visible:ring-1 focus-visible:ring-amber-500/60 active:scale-95',
                    open === 'ALL'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-700/70 bg-zinc-800/50 text-zinc-500'
                  )}
                >
                  <ChevronsUpDown className="size-3" />
                  {open === 'ALL' ? 'свернуть всё' : 'развернуть всё'}
                </button>
              </p>
              <div className="space-y-1.5">
                {hypos.map((h) => (
                  <RadarHypoRow
                    key={h.greek}
                    h={h}
                    effSlug={effSlug}
                    rendered={rendered}
                    record={record}
                    tierByPos={tierByPos}
                    open={open === 'ALL' || open === h.greek}
                    onToggle={() => setOpen(open === h.greek ? null : h.greek)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="В этом батче нет EXP-слотов"
              hint="Радар читает маркеры гипотез из THESIS EXP-слотов — выбери батч с программой (T4-25 и новее)."
            />
          )}

          {h13 ? (
            <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 font-mono text-[10px] text-fuchsia-300">
                  H13
                </span>
                <span className="text-xs font-medium text-zinc-200">BODY-SPECTRUM — названное тело против дефолта</span>
                <span className="font-mono text-[10px] text-zinc-500">перестройка · единственная переменная — тело</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <SlotNavChip slug={h13.a} slotId="P01" side="A" alchemy={false} />
                <span className="font-mono text-[10px] text-zinc-500">
                  рендер {h13.aDone}/{h13.aTotal}
                </span>
                <span className="text-zinc-700" aria-hidden>
                  ↔
                </span>
                <SlotNavChip slug={h13.b} slotId="P01" side="B" alchemy={false} />
                <span className="font-mono text-[10px] text-zinc-500">
                  рендер {h13.bDone}/{h13.bTotal}
                </span>
                <span className="ml-auto">
                  <TrialStatusPill
                    status={h13.verdictB ? 'done' : h13.bDone > 0 && h13.bDone >= h13.bTotal && h13.bTotal > 0 ? 'verdict' : 'render'}
                    rendered={h13.bDone}
                    total={h13.bTotal}
                  />
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                «назови тело, или рендер решит за тебя» — тот же состав, что сторона A; разница только
                в теле. Решает глаз автора на рендере B против A; держит — закон в TASTE (форма, не
                возраст — N30) и приказ «охуенный прорыв в промптостроении» закрыт. Чипы ведут к
                первым строкам обеих сторон, полный разбор — Сравнение A↔B.
              </p>
            </div>
          ) : null}

          <p className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/60 pt-2 text-[11px] text-zinc-600">
            <Crosshair className="size-3" />
            чипы слотов — глубокие ссылки: открывают батч, скроллят к строке и вспыхивают её.
            Места по-прежнему пусты? Стекло помнит цикл автора.
          </p>
        </div>
      )}
    </Panel>
  )
}
