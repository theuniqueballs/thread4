'use client'

/**
 * THREAD 4 — ЕДИНЫЙ РАБОЧИЙ СТОЛ (the / route; Фаза 5, UI v2 — 2026-10-23).
 *
 * Три вида (воркфлоу файл-эры / консоль / сборка) слились в ОДИН рабочий
 * стол, организованный вокруг конечного автомата цикла фазы 3:
 *   · ЦИКЛ — ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER: состояние из
 *     летописи, руки автора (заказ/шаг/одобрение human-gate), честные стопы;
 *   · СКОРБОРД — счёт конвейера + обе таблицы батчей (прод + scratch) одной;
 *   · ХЕШ-ЦЕПЬ — летопись как цепь с клиентской перевалидацией сшивки.
 *
 * Сохранено: статус-ряд, окно ротации, Action Deck (инструменты — в
 * раскрытии), текущий батч, лента, читальный зал (8 разделов), ⌘K-палитра,
 * Live Console (теперь глобальная), горячие клавиши. Ретired-модули
 * (workflow.tsx, build.tsx) больше не монтируются — файлы остаются в репо
 * до фазы гигиены (модульный сплит гигантов).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Command as CommandIcon, Link2, Rocket, Settings, Sparkles, Workflow, Zap } from 'lucide-react'

import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useApi } from '@/components/t4/api'
import { asRecord } from '@/components/t4/api'
import { subscribeSlotNav } from '@/components/t4/nav'
import { navigateToSlot } from '@/components/t4/nav'
import {
  isEngineTele,
  RotationWindowPanel,
  type EngineBatchRow,
  type EngineTele,
} from '@/components/t4/console/panels'
import { ActionDeck } from '@/components/t4/console/action-deck'
import { LiveConsole } from '@/components/t4/console/live-console'
import { CycleBoard } from '@/components/t4/console/desk/cycle-board'
import { Scoreboard } from '@/components/t4/console/desk/scoreboard'
import { ChainView } from '@/components/t4/console/desk/chain-view'
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
  getLiveConsoleUi,
  invalidateEngineBatches,
  subscribeNotify,
  useCommanderKeySaved,
  useEngineBatches,
  useScratchBatches,
  useVisibleInterval,
  type ActionId,
  type DrawerId,
  type NotifyEntry,
} from '@/components/t4/console/shared'

/* ------------------------------------------------------------------ */
/* Layout E: нижняя выдвижная Live Console                             */
/* ------------------------------------------------------------------ */

const LIVE_DRAWER_KEY = 't4-live-drawer'

type LiveUiSnapshot = ReturnType<typeof getLiveConsoleUi>

const LIVE_STATUS_WORD: Record<LiveUiSnapshot['status'], string> = {
  live: 'эфир',
  paused: 'пауза',
  reconnect: 'переподключение',
  down: 'молчит',
}

function liveStatusDot(status: LiveUiSnapshot['status']): string {
  if (status === 'live') return 'bg-emerald-500 animate-pulse'
  if (status === 'down') return 'bg-rose-500'
  return 'bg-amber-400'
}

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
  /* Фаза 5: единый рабочий стол — три вкладки одного экрана (вместо трёх видов) */
  const [desk, setDesk] = useState<'cycle' | 'score' | 'chain'>('cycle')
  const [focusSlug, setFocusSlug] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const keySaved = useCommanderKeySaved()

  /* Layout E: нижняя выдвижная Live Console (состояние переживает перезагрузку) */
  const [liveOpen, setLiveOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try {
      return window.localStorage.getItem(LIVE_DRAWER_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const toggleLiveDrawer = useCallback(() => {
    setLiveOpen((v) => {
      const next = !v
      try {
        window.localStorage.setItem(LIVE_DRAWER_KEY, next ? 'open' : 'closed')
      } catch {
        /* приватный режим — просто без персиста */
      }
      return next
    })
  }, [])
  /* снимок live-шины для свёрнутой плашки (2с, дёшево) */
  const [liveUi, setLiveUi] = useState<LiveUiSnapshot>(() => getLiveConsoleUi())
  useVisibleInterval(() => setLiveUi(getLiveConsoleUi()), 2_000)

  /* данные: состояние ядра (poll 15с) + живая лента движка (poll 4с) */
  const state = useApi<Record<string, unknown>>('/api/t4/state')
  const feed = useEventsFeed()
  const { rows: engineRows } = useEngineBatches()
  const { rows: scratchRows } = useScratchBatches()

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
    setDesk('cycle')
    setToolsOpen(true)
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
      } else if (m.kind === 'view') {
        /* старые имена видов → вкладки рабочего стола (палитра жива) */
        const v = m.view
        setDesk(v === 'build' ? 'score' : v === 'chain' ? 'chain' : 'cycle')
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
      if (k === 'v') {
        e.preventDefault()
        setDesk((v) => (v === 'cycle' ? 'score' : v === 'score' ? 'chain' : 'cycle'))
        return
      }
      if (k === 'g') {
        e.preventDefault()
        setDesk('score')
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
      <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-gradient-to-b from-zinc-900 via-zinc-950/95 to-zinc-950/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-fuchsia-600 shadow-lg shadow-fuchsia-950/40">
                <span className="font-mono text-sm font-bold text-zinc-950">4</span>
              </div>
              <div className="min-w-0">
                <div className="whitespace-nowrap bg-gradient-to-r from-amber-300 via-rose-300 to-fuchsia-300 bg-clip-text text-sm font-bold tracking-tight text-transparent">
                  THREAD 4
                </div>
                <div className="hidden truncate text-[11px] text-zinc-500 sm:block">конвейер промпт-батчей · рабочий стол</div>
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
              {/* Фаза 5: вкладки ЕДИНОГО рабочего стола (V — цикл вкладок) */}
              <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800/60 bg-zinc-900/60 p-0.5">
                <button
                  type="button"
                  onClick={() => setDesk('cycle')}
                  aria-pressed={desk === 'cycle'}
                  title="цикл ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER"
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
                    desk === 'cycle'
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  )}
                >
                  <Workflow className="size-3.5" />
                  <span className="hidden sm:inline">Цикл</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDesk('score')}
                  aria-pressed={desk === 'score'}
                  title="скорборд: счёт конвейера + батчи обоих пространств (G)"
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
                    desk === 'score'
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  )}
                >
                  <Rocket className="size-3.5" />
                  <span className="hidden sm:inline">Скорборд</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDesk('chain')}
                  aria-pressed={desk === 'chain'}
                  title="хеш-цепь: летопись с клиентской перевалидацией сшивки"
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
                    desk === 'chain'
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  )}
                >
                  <Link2 className="size-3.5" />
                  <span className="hidden sm:inline">Хеш-цепь</span>
                </button>
              </div>

              <BellMenu entries={bell} onClear={() => setBell([])} />
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="палитра команд (⌘K)"
                title="палитра команд — ⌘K / Ctrl+K / «/»"
                className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-800/60 bg-zinc-900/60 px-2.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
              >
                <CommandIcon className="size-3.5" />
                <span className="hidden sm:inline">команды</span>
                <kbd className="hidden rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] leading-3 text-zinc-500 sm:inline">⌘K</kbd>
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="настройки: ключ командира и стекло"
                title="настройки — ключ командира · стекло движка"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800/60 bg-zinc-900/60 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
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
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <StatusBar stateData={state.data} keySaved={keySaved} onOpenSettings={() => setSettingsOpen(true)} />

        <AnimatePresence mode="wait" initial={false}>
          {desk === 'cycle' ? (
            <motion.div
              key="desk-cycle"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="mt-4 space-y-4"
            >
              <CycleBoard
                focusSlug={focusSlug}
                onSlugConsumed={() => setFocusSlug(null)}
                onMutated={onMutated}
              />

              <RotationWindowPanel refreshSignal={rotSignal} />

              {/* инструменты (Action Deck): файл-эра и обслуживание — в раскрытии,
               * основная работа цикла живёт выше; горячие клавиши действий работают */}
              <div className="overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-950/70 backdrop-blur-xl">
                <button
                  type="button"
                  onClick={() => setToolsOpen((v) => !v)}
                  aria-expanded={toolsOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:bg-zinc-900/40"
                >
                  <span className="flex items-center gap-2">
                    <Zap className="size-3 text-amber-400" /> инструменты · обслуживание и файл-эра
                    <span className="text-zinc-600">{toolsOpen ? 'свёрнуты' : 'раскрыть'}</span>
                  </span>
                  <ChevronDown className={cn('size-4 text-zinc-500 transition-transform', toolsOpen && 'rotate-180')} />
                </button>
                {toolsOpen ? (
                  <div className="border-t border-zinc-800/60 p-2">
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
                  </div>
                ) : null}
              </div>

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
            </motion.div>
          ) : desk === 'score' ? (
            <motion.div
              key="desk-score"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="mt-4 min-w-0"
            >
              <Scoreboard
                onOpenBatch={openBatch}
                onOpenInCycle={(slug) => {
                  setFocusSlug(slug)
                  setDesk('cycle')
                }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="desk-chain"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="mt-4 min-w-0"
            >
              <ChainView feed={feed} onExport={exportChronicle} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live Console — глобальная выдвижная плашка (SSE twin'а :3201) */}
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-950/70 backdrop-blur-xl">
          <button
            type="button"
            onClick={toggleLiveDrawer}
            aria-expanded={liveOpen}
            className="flex w-full items-center justify-between gap-3 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:bg-zinc-900/40"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('size-1.5 shrink-0 rounded-full', liveStatusDot(liveUi.status))} aria-hidden />
              <span className="shrink-0">live console · twin :3201</span>
              <span className="shrink-0 text-zinc-600">
                {liveOpen ? `seq ${liveUi.lastSeq} · ${LIVE_STATUS_WORD[liveUi.status]}` : 'свёрнута — развернуть'}
              </span>
              {liveUi.errorCount > 0 ? (
                <span className="shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 text-rose-300">
                  {liveUi.errorCount} err
                </span>
              ) : null}
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-zinc-500 transition-transform', liveOpen && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {liveOpen ? (
              <motion.div
                key="live-console-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                className="overflow-hidden"
              >
                <div className="border-t border-zinc-800/60 px-2 pb-2">
                  <LiveConsole />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </main>

      {/* ── футер: прижат к низу, микро-теги и подсказки ────────── */}
      <footer className="mt-auto border-t border-zinc-800/60 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
          <span>
            THREAD 4 · закон 24 слотов · Super Z × Автор{' '}
            <span className="hidden font-mono text-zinc-700 sm:inline">
              [T4-Core: {tele ? (tele.up ? 'Active' : 'Degraded') : 'File-Era'}]
            </span>
          </span>
          <span className="font-mono">
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">⌘K</kbd> палитра ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">V</kbd> вкладка ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">G</kbd> скорборд ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">B C T P</kbd>{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">D X R S W</kbd> действия ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">1–8</kbd> доки ·{' '}
            <kbd className="rounded border border-zinc-800 bg-zinc-900/80 px-1 py-px text-[10px] text-zinc-500">A N J</kbd> live-команды
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
