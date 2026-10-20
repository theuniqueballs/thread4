'use client'

/**
 * THREAD 4 — консоль «МОЩНОСТЬ» (the / route, 2026-10-18).
 *
 * Первый уровень — рабочий: один экран без вложенных табов.
 *   · компактный статус-ряд (эпоха/батчи/движок/цепь/ключ)
 *   · окно ротации (3 слота усталости)
 *   · Action Deck — 9 действий с честными workflow (idle→pending→
 *     success/error, лог шагов, подтверждения, dry-run)
 *   · текущий батч + живая лента последних 5 событий (poll 4с)
 *   · читальный зал (второй уровень): 8 разделов в боковом drawer'е
 *
 * Палитра команд ⌘K — доступ ко всему; клавиши B/C/T/P/D/X/R/S/W —
 * действия, 1–8 — разделы. Уведомления: тосты + колокол истории.
 * Бэкенд не тронут: useApi/postJson/delJson/commanderHeaders живы,
 * мутации идут через движок :3200 (SSoT) и существующий прокси.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Command as CommandIcon, Settings, Sparkles, Zap } from 'lucide-react'

import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useApi } from '@/components/t4/api'
import { asRecord, asStr } from '@/components/t4/api'
import { subscribeSlotNav } from '@/components/t4/nav'
import { navigateToSlot } from '@/components/t4/nav'
import {
  isEngineTele,
  RotationWindowPanel,
  type EngineTele,
} from '@/components/t4/console/panels'
import { ActionDeck } from '@/components/t4/console/action-deck'
import { PipelineScreen } from '@/components/t4/console/pipeline'
import {
  BatchFocus,
  BellMenu,
  DocsZone,
  EventsStrip,
  ReadingDrawer,
  SettingsDialog,
  StatusBar,
  useEventsFeed,
} from '@/components/t4/console/chrome'
import { CommandPalette, type PaletteMisc } from '@/components/t4/console/palette'
import {
  invalidateEngineBatches,
  subscribeNotify,
  useCommanderKeySaved,
  useEngineBatches,
  useVisibleInterval,
  type ActionId,
  type DrawerId,
  type NotifyEntry,
} from '@/components/t4/console/shared'

/* ------------------------------------------------------------------ */
/* Горячие клавиши                                                     */
/* ------------------------------------------------------------------ */

const ACTION_HOTKEYS: Record<string, ActionId> = {
  b: 'burn',
  c: 'compile',
  i: 'scribe',
  t: 'verify',
  p: 'purge',
  d: 'deliver',
  x: 'void',
  r: 'reaper',
  s: 'shore',
  w: 'verdict',
}

const DRAWER_HOTKEYS: Record<string, DrawerId> = {
  1: 'docs',
  2: 'specs',
  3: 'chronicle',
  4: 'batches',
  5: 'verdicts',
  6: 'vault',
  7: 'archive',
  8: 'file-era',
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (el == null) return false
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  )
}

/* ------------------------------------------------------------------ */
/* Консоль                                                             */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [activeAction, setActiveAction] = useState<ActionId | null>(null)
  const [drawer, setDrawer] = useState<DrawerId | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bell, setBell] = useState<NotifyEntry[]>([])
  const [rotSignal, setRotSignal] = useState(0)
  const keySaved = useCommanderKeySaved()

  /* данные: состояние ядра (poll 15с) + живая лента движка (poll 4с) */
  const state = useApi<Record<string, unknown>>('/api/t4/state')
  const feed = useEventsFeed()
  const { rows: engineRows } = useEngineBatches()

  useVisibleInterval(() => state.reload(), 15_000)

  const tele: EngineTele | null = useMemo(() => {
    const engine = asRecord(asRecord(state.data).glass).engine
    return isEngineTele(engine) ? (engine as EngineTele) : null
  }, [state.data])
  const chainOk = asRecord(asRecord(asRecord(state.data).glass).chain).ok === true
  const deliveredCount = Array.isArray(asRecord(state.data).batches)
    ? (asRecord(state.data).batches as unknown[]).length
    : null

  /* уведомления → колокол + тост (авто-скрытие 4.5с, ошибки — 8с) */
  useEffect(() => {
    return subscribeNotify((e) => {
      setBell((cur) => [...cur.slice(-29), e])
      const t = toast({
        title: e.title,
        description: e.text !== '' ? e.text : undefined,
        variant: e.kind === 'error' ? 'destructive' : 'default',
      })
      window.setTimeout(() => t.dismiss(), e.kind === 'error' ? 8000 : 4500)
    })
  }, [])

  /* мутация состоялась: перезарядить всё живое */
  const feedRefresh = feed.refresh
  const stateReload = state.reload
  const onMutated = useCallback(() => {
    void feedRefresh()
    stateReload()
    setRotSignal((s) => s + 1)
  }, [feedRefresh, stateReload])

  const feedPurge = feed.purge
  const purgeHeap = feedPurge

  /* глубокая навигация (TRIAL-радар → слот) открывает Батчи в drawer'е */
  useEffect(() => subscribeSlotNav(() => setDrawer('batches')), [])

  const openBatch = useCallback((slug: string) => {
    setDrawer('batches')
    /* sticky-намерение: BatchesTab смонтируется в drawer'е и откроет батч */
    navigateToSlot(slug, '')
  }, [])

  const focusAction = useCallback((id: ActionId) => {
    setActiveAction(id)
    requestAnimationFrame(() => {
      document.getElementById('t4-action-deck')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [])

  const exportChronicle = useCallback(() => {
    const lines = feed.events
      .map((e) =>
        JSON.stringify({ seq: e.seq, id: e.id, at: e.at, type: e.type, summary: e.summary, hash: e.hash, prev: e.prev })
      )
      .join('\n')
    const blob = new Blob([`${lines}\n`], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `t4-chronicle-${feed.events.length}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }, [feed.events])

  const feedRefresh2 = feed.refresh
  const stateReload2 = state.reload
  const onPaletteMisc = useCallback(
    (m: PaletteMisc) => {
      if (m.kind === 'refresh') {
        void feedRefresh2()
        stateReload2()
        invalidateEngineBatches()
        setRotSignal((s) => s + 1)
      } else if (m.kind === 'settings') {
        setSettingsOpen(true)
      } else if (m.kind === 'export-chronicle') {
        exportChronicle()
      }
    },
    [feedRefresh2, stateReload2, exportChronicle]
  )

  /* клавиатура: ⌘K — палитра; буквы — действия; 1–8 — разделы; «/» — палитра */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (paletteOpen || settingsOpen || drawer != null) return
      if (isTypingTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === '/') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (k === 'escape') return
      const action = ACTION_HOTKEYS[k]
      if (action != null) {
        e.preventDefault()
        focusAction(action)
        return
      }
      const dr = DRAWER_HOTKEYS[k]
      if (dr != null) {
        e.preventDefault()
        setDrawer(dr)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, settingsOpen, drawer, focusAction])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ── шапка: один компактный ряд ─────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900 via-zinc-950/95 to-zinc-950/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-fuchsia-600 shadow-lg shadow-fuchsia-950/40">
                <span className="font-mono text-sm font-bold text-zinc-950">4</span>
              </div>
              <div className="min-w-0">
                <div className="bg-gradient-to-r from-amber-300 via-rose-300 to-fuchsia-300 bg-clip-text text-sm font-bold tracking-tight text-transparent">
                  THREAD 4
                </div>
                <div className="truncate text-[11px] text-zinc-500">конвейер промпт-батчей · консоль «МОЩНОСТЬ»</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="mr-1 hidden items-center gap-1.5 font-mono text-[10px] text-zinc-500 lg:flex">
                {deliveredCount != null ? (
                  <span className="flex items-center gap-1 text-amber-300/80">
                    <Sparkles className="size-3" /> {deliveredCount}
                  </span>
                ) : null}
                <span className={cn('flex items-center gap-1', tele?.up ? 'text-zinc-400' : 'text-rose-400')}>
                  <Zap className="size-3" /> {tele?.up ? `:${tele.port}` : 'молчит'}
                </span>
                <span className={chainOk ? 'text-emerald-400' : 'text-rose-400'}>цепь {chainOk ? 'цела' : '!'}</span>
              </div>
              <BellMenu entries={bell} onClear={() => setBell([])} />
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="палитра команд (⌘K)"
                title="палитра команд — ⌘K / Ctrl+K / «/»"
                className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
              >
                <CommandIcon className="size-3.5" />
                <span className="hidden sm:inline">команды</span>
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] leading-3 text-zinc-500">⌘K</kbd>
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="настройки: ключ командира и стекло"
                title="настройки — ключ командира · стекло движка"
                className="rounded-md border border-zinc-800 bg-zinc-900/60 p-1.5 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
              >
                <Settings className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {/* нить: тонкая анимированная нить под шапкой */}
        <div className="h-[2px] w-full overflow-hidden">
          <div className="h-full w-1/3 animate-[thread-slide_6s_linear_infinite] bg-gradient-to-r from-transparent via-fuchsia-500 to-transparent" />
        </div>
      </header>

      {/* ── рабочая зона ───────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        <StatusBar stateData={state.data} keySaved={keySaved} onOpenSettings={() => setSettingsOpen(true)} />

        {/* Конвейер 5 этапов — главный поток автора: авто-кнопка 1→5 и ручной
         * ▶ на каждом этапе, оба режима на этом же экране (приказ Фазы 3).
         * Репетиции twin'а :3201 — прод-мутации остаются в Action Deck (:3200). */}
        <section aria-label="конвейер">
          <PipelineScreen embed />
        </section>

        <RotationWindowPanel refreshSignal={rotSignal} />

        <ActionDeck
          active={activeAction}
          onActiveChange={setActiveAction}
          heapCount={feed.events.length}
          onPurgeHeap={purgeHeap}
          onMutated={onMutated}
          onOpenBatch={openBatch}
          onOpenDrawer={(id) => setDrawer(id)}
          onOpenSettings={() => setSettingsOpen(true)}
          engineUp={tele?.up ?? false}
        />

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <BatchFocus
            onOpenBatch={openBatch}
            onVerdict={(slug) => {
              openBatch(slug)
              focusAction('verdict')
            }}
          />
          <EventsStrip feed={feed} onOpenChronicle={() => setDrawer('chronicle')} />
        </div>

        <DocsZone onOpen={(id) => setDrawer(id)} />
      </main>

      {/* ── футер: прижат к низу, микро-теги и подсказки ────────── */}
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
          <span>
            THREAD 4 · закон 24 слотов · Super Z × Автор{' '}
            <span className="hidden font-mono text-zinc-700 sm:inline">
              [T4-Core: {tele ? (tele.up ? 'Active' : 'Degraded') : 'File-Era'}]
            </span>
          </span>
          <span className="font-mono">
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px text-[10px]">⌘K</kbd> палитра ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px text-[10px]">B C T P</kbd>{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px text-[10px]">D X R S W</kbd> действия ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px text-[10px]">1–8</kbd> доки
          </span>
        </div>
      </footer>

      {/* ── оверлеи: палитра, drawer'ы, настройки ───────────────── */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onAction={focusAction}
        onDrawer={(id) => setDrawer(id)}
        onBatch={openBatch}
        onMisc={onPaletteMisc}
        batches={engineRows}
      />
      <ReadingDrawer drawer={drawer} onOpenChange={setDrawer} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
