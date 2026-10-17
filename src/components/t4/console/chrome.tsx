'use client'

/**
 * THREAD 4 — console chrome (шапка/статус/уведомления/док-зона).
 *
 * Первый уровень: компактный статус-ряд, живая лента последних событий
 * (poll после lastSeq, пауза в скрытой вкладке), карточка текущего
 * батча, колокол истории уведомлений, диалог настроек с ключом
 * командира и Стеклом. Второй уровень: боковой drawer читального зала
 * (Sheet справа) с восемью разделами из panels.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { cn } from '@/lib/utils'
import {
  Archive as ArchiveIcon,
  Bell,
  BookOpen,
  Boxes,
  Check,
  ChevronRight,
  FileText,
  Heart,
  History,
  KeyRound,
  Radio,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Chip, Mono } from '@/components/t4/bits'
import {
  asArray,
  asRecord,
  asStr,
  getCommanderKey,
} from '@/components/t4/api'
import {
  fmtTime,
  h8,
  type EngineEvent,
  type EngineTele,
  isEngineTele,
  ArchiveTab,
  BatchesTab,
  CommanderKeyPanel,
  CompileTab,
  DocsTab,
  EventsTab,
  GlassTab,
  SpecsTab,
  VaultTab,
  VerdictsTab,
} from '@/components/t4/console/panels'
import {
  DRAWER_META,
  engineGet,
  notify,
  useEngineBatches,
  useVisibleInterval,
  type DrawerId,
  type NotifyEntry,
} from '@/components/t4/console/shared'

/* ------------------------------------------------------------------ */
/* Живая лента событий: единый заряд для стрипа + PURGE HEAP           */
/* ------------------------------------------------------------------ */

export interface EventsFeed {
  events: EngineEvent[]
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
  poll: () => Promise<void>
  purge: () => Promise<{ ok: boolean; refetched: number; error?: string }>
}

export function useEventsFeed(): EventsFeed {
  const [events, setEvents] = useState<EngineEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const lastSeqRef = useRef(0)
  const wasErrorRef = useRef(false)
  const eventsRef = useRef<EngineEvent[]>([])

  useEffect(() => {
    eventsRef.current = events
  }, [events])

  const refresh = useCallback(async () => {
    try {
      const data = await engineGet<{ events: EngineEvent[] }>('events?after=0&limit=1000')
      const evs = (data.events ?? []).filter(
        (e) => typeof e.seq === 'number' && typeof e.hash === 'string' && typeof e.prev === 'string'
      )
      lastSeqRef.current = evs.length > 0 ? evs[evs.length - 1].seq : 0
      setEvents(evs)
      setError(null)
      if (wasErrorRef.current) {
        wasErrorRef.current = false
        notify('info', 'Движок вернулся', 'лента снова читается')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'движок молчит'
      setError(msg)
      if (!wasErrorRef.current) {
        wasErrorRef.current = true
        notify('error', 'Движок молчит', 'лента событий не читается (:3200)')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const poll = useCallback(async () => {
    if (lastSeqRef.current === 0) {
      await refresh()
      return
    }
    try {
      const data = await engineGet<{ events: EngineEvent[] }>(`events?after=${lastSeqRef.current}&limit=25`)
      const fresh = (data.events ?? []).filter(
        (e) => typeof e.seq === 'number' && typeof e.hash === 'string' && typeof e.prev === 'string'
      )
      if (fresh.length > 0) {
        lastSeqRef.current = Math.max(lastSeqRef.current, fresh[fresh.length - 1].seq)
        /* дедупликация по seq: параллельный refresh уже мог принести эти
         * звенья — дубль ключа ломает список (QA «МОЩНОСТЬ», live-полигон) */
        setEvents((cur) => {
          const seen = new Set(cur.map((e) => e.seq))
          const add = fresh.filter((e) => !seen.has(e.seq))
          return add.length > 0 ? [...cur, ...add].slice(-1000) : cur
        })
      }
      setError(null)
      if (wasErrorRef.current) {
        wasErrorRef.current = false
        notify('info', 'Движок вернулся', 'лента снова читается')
      }
    } catch {
      /* следующий poll попробует снова; полный отказ ловит refresh */
    }
  }, [refresh])

  const purge = useCallback(async () => {
    const old = eventsRef.current
    setEvents([])
    try {
      const data = await engineGet<{ events: EngineEvent[] }>('events?after=0&limit=1000')
      const evs = (data.events ?? []).filter(
        (e) => typeof e.seq === 'number' && typeof e.hash === 'string' && typeof e.prev === 'string'
      )
      lastSeqRef.current = evs.length > 0 ? evs[evs.length - 1].seq : 0
      setEvents(evs)
      setError(null)
      return { ok: true, refetched: evs.length }
    } catch (e) {
      /* откат: буфер восстановлен прежним зарядом */
      setEvents(old)
      lastSeqRef.current = old.length > 0 ? old[old.length - 1].seq : 0
      const msg = e instanceof Error ? e.message : 'перечит не удался'
      setError(msg)
      return { ok: false, refetched: 0, error: msg }
    }
  }, [])

  /* первый заряд — сразу; poll дергает инкрементально */
  useEffect(() => {
    void refresh()
  }, [refresh])

  return { events, error, loading, refresh, poll, purge }
}

/* ------------------------------------------------------------------ */
/* Статусный ряд (компактный, один ряд)                                */
/* ------------------------------------------------------------------ */

export function StatusBar({
  stateData,
  keySaved,
  onOpenSettings,
}: {
  stateData: Record<string, unknown> | null
  keySaved: boolean
  onOpenSettings: () => void
}) {
  const rec = asRecord(stateData)
  const glass = asRecord(rec.glass)
  const tele: EngineTele | null = isEngineTele(glass.engine) ? (glass.engine as EngineTele) : null
  const counts = asRecord(rec.counts)

  const pill = (label: string, value: string, tone: 'ok' | 'warn' | 'err' | 'zinc' = 'zinc', title?: string) => (
    <span
      title={title ?? `${label}: ${value}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] leading-none',
        tone === 'ok'
          ? 'border-emerald-800/50 bg-emerald-500/5 text-emerald-300'
          : tone === 'warn'
            ? 'border-amber-800/50 bg-amber-500/5 text-amber-300'
            : tone === 'err'
              ? 'border-rose-800/50 bg-rose-500/5 text-rose-300'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
      )}
    >
      <span className="text-zinc-600">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  )

  return (
    <div className="t4-scroll-x flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5" role="status" aria-label="статус конвейера">
      {pill('эпоха', asStr(rec.era) || 'THREAD 4', 'zinc')}
      {pill('последний', asStr(rec.lastBatch) || '—', 'zinc', `последний батч: ${asStr(rec.lastBatch)}`)}
      {pill('следующий', asStr(rec.nextStep) || '—', 'ok')}
      {counts.batches != null ? pill('батчей', asStr(counts.batches), 'zinc') : null}
      {counts.events != null ? pill('событий', asStr(counts.events), 'zinc') : null}
      {tele != null
        ? pill(
            'движок',
            `:${tele.port} · ${tele.chainHeight ?? '—'} зв.`,
            tele.up ? (tele.chainOk === false ? 'err' : 'ok') : 'err',
            `t4-engine :${tele.port}${tele.up ? ` · цепь ${tele.chainHeight ?? '—'} · ${tele.chainOk === true ? 'SEALED' : 'нет данных'}` : ' не отвечает'}`
          )
        : pill('движок', 'молчит', 'err')}
      {glass.commanderKey === true
        ? pill('ключ', keySaved ? 'вооружён' : 'на сервере', keySaved ? 'ok' : 'warn', keySaved ? 'ключ командира сохранён в браузере — мутации открыты' : 'серверный замок есть, браузерного ключа нет — настрой')
        : pill('ключ', 'нет замка', 'err')}
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[10px] leading-none text-zinc-500 transition-colors hover:border-amber-500/50 hover:text-amber-300"
        aria-label="настройки: ключ командира, стекло движка"
      >
        <Settings className="size-3" /> настройки
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Колокол уведомлений (история)                                       */
/* ------------------------------------------------------------------ */

export function BellMenu({ entries, onClear }: { entries: NotifyEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`уведомления${entries.length > 0 ? ` (${entries.length} новых)` : ''}`}
          className="relative rounded-md border border-zinc-800 bg-zinc-900/60 p-1.5 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
        >
          <Bell className="size-4" />
          {entries.length > 0 ? (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-rose-600 font-mono text-[9px] font-bold text-zinc-50">
              {Math.min(entries.length, 9)}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-zinc-800 bg-zinc-950 p-0">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <span className="font-mono text-xs text-zinc-300">история уведомлений</span>
          {entries.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="font-mono text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
            >
              очистить
            </button>
          ) : null}
        </div>
        <div className="t4-scroll max-h-72 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-600">пока тихо — действия сами расскажут</p>
          ) : (
            [...entries].reverse().map((e) => (
              <div key={e.id} className="flex items-start gap-2 border-b border-zinc-900 px-3 py-2 last:border-0">
                <span
                  className={cn(
                    'mt-1 size-1.5 shrink-0 rounded-full',
                    e.kind === 'success' ? 'bg-emerald-500' : e.kind === 'error' ? 'bg-rose-500' : 'bg-zinc-500'
                  )}
                />
                <div className="min-w-0">
                  <p className={cn('font-mono text-[11px] font-semibold', e.kind === 'error' ? 'text-rose-300' : e.kind === 'success' ? 'text-emerald-300' : 'text-zinc-300')}>
                    {e.title}
                  </p>
                  {e.text !== '' ? <p className="break-words font-mono text-[10px] leading-relaxed text-zinc-500">{e.text}</p> : null}
                  <p className="font-mono text-[9px] text-zinc-700">{fmtTime(e.at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Диалог настроек: ключ командира + стекло                            */
/* ------------------------------------------------------------------ */

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="t4-scroll w-full overflow-y-auto border-zinc-800 bg-zinc-950 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-zinc-800 px-4 py-3">
          <SheetTitle className="flex items-center gap-2 font-mono text-sm text-zinc-200">
            <Settings className="size-4 text-amber-500" /> Настройки · Стекло
          </SheetTitle>
          <SheetDescription className="font-mono text-[10px] text-zinc-600">
            ключ командира (мутации) · здоровье хрупкого конвейера
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <CommanderKeyPanel />
          <GlassTab />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ */
/* Живая лента: последние 5 событий + тик валидации                    */
/* ------------------------------------------------------------------ */

export function EventsStrip({
  feed,
  onOpenChronicle,
}: {
  feed: EventsFeed
  onOpenChronicle: () => void
}) {
  useVisibleInterval(() => void feed.poll(), 4000)

  const tail = useMemo(() => feed.events.slice(-5).reverse(), [feed.events])
  const idxOf = useMemo(() => {
    const m = new Map<number, number>()
    feed.events.forEach((e, i) => m.set(e.seq, i))
    return m
  }, [feed.events])

  return (
    <section className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5" aria-label="живая лента событий">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-200">
          <Radio className="size-4 text-amber-500" />
          Лента — последние 5
          <span className="flex items-center gap-1 font-mono text-[9px] text-zinc-600">
            <span className={cn('size-1.5 rounded-full', feed.error == null ? 'animate-pulse bg-emerald-500' : 'bg-rose-500')} />
            {feed.error == null ? 'live · poll 4с' : 'движок молчит'}
          </span>
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void feed.refresh()}
            aria-label="перечитать ленту"
            title="перечитать ленту из движка"
            className="rounded-md border border-zinc-700 p-1 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
          >
            <RefreshCw className="size-3" />
          </button>
          <button
            type="button"
            onClick={onOpenChronicle}
            className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
          >
            вся летопись <ChevronRight className="size-3" />
          </button>
        </div>
      </header>
      {feed.loading && feed.events.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-5 w-full bg-zinc-800" />
          ))}
        </div>
      ) : feed.error != null && feed.events.length === 0 ? (
        <p className="rounded-md border border-rose-800/50 bg-rose-950/20 px-3 py-2 font-mono text-xs text-rose-300">
          движок :3200 молчит — {feed.error}. Подними: mini-services/t4-engine → bun run dev
        </p>
      ) : tail.length === 0 ? (
        <p className="font-mono text-xs text-zinc-600">событий нет — цепь ждёт генезиса</p>
      ) : (
        <ul className="space-y-1">
          {tail.map((e, i) => {
            const idx = idxOf.get(e.seq) ?? -1
            const linkOk = idx > 0 ? e.prev === feed.events[idx - 1]?.hash : e.prev === 'GENESIS'
            return (
              <motion.li
                key={e.seq}
                initial={i === 0 ? { opacity: 0, y: -4 } : undefined}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-baseline gap-2 font-mono text-[11px] leading-relaxed"
              >
                <span title={linkOk ? 'звено связано (prev === hash[i-1])' : 'разрыв цепи!'}>
                  {linkOk ? <Check className="size-3 shrink-0 self-center text-emerald-500" /> : <X className="size-3 shrink-0 self-center animate-pulse text-rose-500" />}
                </span>
                <span className="shrink-0 text-right tabular-nums text-zinc-600" title={`seq ${e.seq}`}>{e.seq}</span>
                <span className="shrink-0 text-zinc-600" title={e.at}>{fmtTime(e.at)}</span>
                <span className="max-w-24 shrink-0 truncate text-amber-400/80" title={e.type}>{e.type}</span>
                <span className="min-w-0 truncate text-zinc-300" title={e.summary}>{e.summary}</span>
                <span className="ml-auto hidden shrink-0 text-[10px] text-zinc-700 sm:inline" title={`hash ${e.hash} · prev ${e.prev}`}>
                  {h8(e.hash)}·{h8(e.prev)}
                </span>
              </motion.li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Фокус-батч: текущая работа (последний батч движка)                  */
/* ------------------------------------------------------------------ */

export function BatchFocus({
  onOpenBatch,
  onVerdict,
}: {
  onOpenBatch: (slug: string) => void
  onVerdict: (slug: string) => void
}) {
  const { rows, loading } = useEngineBatches()
  const batch = rows[0]

  return (
    <section className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 p-4 sm:p-5" aria-label="текущий батч">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-200">
          <FileText className="size-4 text-amber-500" /> Текущий батч
        </h2>
        {batch != null ? (
          <Chip tone={batch.status === 'delivered' ? 'emerald' : batch.status === 'void' ? 'zinc' : 'amber'}>
            {batch.status}
          </Chip>
        ) : null}
      </header>
      {loading && batch == null ? (
        <Skeleton className="h-12 w-full bg-zinc-800" />
      ) : batch == null ? (
        <p className="font-mono text-xs text-zinc-600">движок не отдал батчи — окно и действия живут, когда вернётся</p>
      ) : (
        <div className="space-y-2.5">
          <div className="font-mono text-sm text-zinc-100">
            <Mono>{batch.slug}</Mono> <span className="text-zinc-400">«{batch.title}»</span>
          </div>
          <div className="font-mono text-[10px] leading-relaxed text-zinc-600">
            EXP {batch.expSlots} · создан {fmtTime(batch.createdAt)}
            {batch.deliveredAt != null ? ` · сдан ${fmtTime(batch.deliveredAt)}` : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => onOpenBatch(batch.slug)}
              className="h-7 bg-amber-500 text-xs text-zinc-950 hover:bg-amber-400"
            >
              <FileText className="mr-1 size-3" /> детали · гейты · файл
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onVerdict(batch.slug)}
              className="h-7 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:border-rose-500/40 hover:text-rose-300"
            >
              <Heart className="mr-1 size-3" /> вердикт
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`Super Z, произведи ${batch.slug}`)
                  .then(() => notify('info', 'Приказ скопирован', `«Super Z, произведи ${batch.slug}»`))
                  .catch(() => notify('error', 'Копирование не удалось', ''))
              }}
              className="h-7 border-zinc-700 bg-zinc-900 text-xs text-zinc-300"
            >
              ⧉ приказ
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Читальный зал: ряд разделов + правый drawer                         */
/* ------------------------------------------------------------------ */

const DOCS_ICONS: Record<DrawerId, React.ReactNode> = {
  docs: <BookOpen className="size-3.5" />,
  specs: <Boxes className="size-3.5" />,
  chronicle: <History className="size-3.5" />,
  batches: <FileText className="size-3.5" />,
  verdicts: <Heart className="size-3.5" />,
  vault: <ShieldCheck className="size-3.5" />,
  archive: <ArchiveIcon className="size-3.5" />,
  'file-era': <ScrollText className="size-3.5" />,
}

const DOCS_HOTKEYS: Record<DrawerId, string> = {
  docs: '1',
  specs: '2',
  chronicle: '3',
  batches: '4',
  verdicts: '5',
  vault: '6',
  archive: '7',
  'file-era': '8',
}

export function DocsZone({
  onOpen,
}: {
  onOpen: (id: DrawerId) => void
}) {
  return (
    <section aria-label="читальный зал" className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-2.5">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">читальный зал — всё почитать</span>
        <span className="font-mono text-[9px] text-zinc-700">клавиши 1–8 · ⌘K</span>
      </div>
      <div className="t4-scroll-x flex gap-1.5 overflow-x-auto pb-0.5">
        {(Object.keys(DRAWER_META) as DrawerId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            title={DRAWER_META[id].hint}
            className="group flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-200"
          >
            <span className="text-zinc-500 group-hover:text-amber-400/80">{DOCS_ICONS[id]}</span>
            {DRAWER_META[id].label}
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[9px] leading-3 text-zinc-600">
              {DOCS_HOTKEYS[id]}
            </kbd>
          </button>
        ))}
      </div>
    </section>
  )
}

export function ReadingDrawer({
  drawer,
  onOpenChange,
}: {
  drawer: DrawerId | null
  onOpenChange: (id: DrawerId | null) => void
}) {
  return (
    <Sheet open={drawer != null} onOpenChange={(o) => (o ? undefined : onOpenChange(null))}>
      <AnimatePresence>
        {drawer != null ? (
          <SheetContent
            key={drawer}
            side="right"
            className="t4-scroll flex w-full flex-col overflow-y-auto border-zinc-800 bg-zinc-950 p-0 sm:max-w-2xl"
          >
            <SheetHeader className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
              <SheetTitle className="flex items-center gap-2 font-mono text-sm text-zinc-200">
                {DOCS_ICONS[drawer]}
                {DRAWER_META[drawer].label}
              </SheetTitle>
              <SheetDescription className="font-mono text-[10px] text-zinc-600">{DRAWER_META[drawer].hint}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 p-4">
              {drawer === 'docs' ? <DocsTab /> : null}
              {drawer === 'specs' ? <SpecsTab /> : null}
              {drawer === 'chronicle' ? <EventsTab /> : null}
              {drawer === 'batches' ? <BatchesTab /> : null}
              {drawer === 'verdicts' ? <VerdictsTab /> : null}
              {drawer === 'vault' ? <VaultTab /> : null}
              {drawer === 'archive' ? <ArchiveTab /> : null}
              {drawer === 'file-era' ? <CompileTab /> : null}
            </div>
          </SheetContent>
        ) : null}
      </AnimatePresence>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ */
/* Шапка-заголовок для читального зала в мобильном виде                */
/* ------------------------------------------------------------------ */

export function ConsoleHeaderBadge() {
  return (
    <span className="hidden items-center gap-1 font-mono text-[9px] text-zinc-600 md:inline-flex">
      <KeyRound className="size-3" /> [T4-Core: Active]
    </span>
  )
}
