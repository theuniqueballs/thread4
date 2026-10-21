'use client'

/**
 * THREAD 4 — палитра команд (⌘K / Ctrl+K).
 *
 * Быстрый доступ ко всему: 10 рабочих действий, 8 разделов читального
 * зала, недавние батчи (прыжок в детали), live-команды воркфлоу (3-b:
 * прервать консоль, сброс воркфлоу, стейт-снимок, verify-цепи) и служебные
 * команды (обновить всё, настройки с ключом командира, экспорт летописи).
 * Построена на shadcn Command (cmdk): стрелки + Enter, Esc — закрыть.
 *
 * 3-b: глобальные хоткеи новых команд (A/N/J) живут здесь — page.tsx
 * (хозяин B/C/I/T/P/D/X/R/S/W) не трогается; стыковка с live-консолью —
 * через CustomEvent 't4:live-abort' и внешний стор shared.ts.
 */

import { useCallback, useEffect } from 'react'
import {
  Activity,
  Archive,
  BookOpen,
  Boxes,
  Braces,
  Command as CommandIcon,
  Download,
  FilePlus2,
  FileText,
  FlaskConical,
  Hammer,
  Heart,
  History,
  KeyRound,
  LayoutGrid,
  Compass,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Skull,
  Sparkles,
  Square,
  Trash2,
  Upload,
  PenLine,
  Zap,
} from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { toast } from '@/hooks/use-toast'
import type { EngineBatchRow } from '@/components/t4/console/panels'
import {
  DRAWER_META,
  LIVE_ABORT_EVENT,
  WORKFLOW_RESET_EVENT,
  getLiveConsoleUi,
  writeClipboard,
  type ActionId,
  type DrawerId,
} from '@/components/t4/console/shared'

export interface PaletteMisc {
  kind: 'refresh' | 'settings' | 'export-chronicle' | 'view'
  /** для kind:'view' — какая вкладка рабочего стола (старые имена видов маппятся) */
  view?: 'workflow' | 'console' | 'build' | 'score' | 'chain' | 'cycle'
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (id: ActionId) => void
  onDrawer: (id: DrawerId) => void
  onBatch: (slug: string) => void
  onMisc: (m: PaletteMisc) => void
  batches: EngineBatchRow[]
}

/** Клавиша ушла в поле ввода — глобальный перехват не мешает набору. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (el == null) return false
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  )
}

const ACTION_ITEMS: { id: ActionId; label: string; icon: React.ReactNode; hint: string; hotkey: string }[] = [
  { id: 'burn', label: 'BURN & REBUILD', icon: <FlaskConical className="size-4" />, hint: 'ре-аудит цепи + перестройка батча', hotkey: 'B' },
  { id: 'compile', label: 'FORCE COMPILE', icon: <Zap className="size-4" />, hint: 'план 24 слотов из темы', hotkey: 'C' },
  { id: 'scribe', label: 'SCRIBE', icon: <PenLine className="size-4" />, hint: 'писец пишет батч по контракту (LLM + гейты + ремонт)', hotkey: 'I' },
  { id: 'verify', label: 'VERIFY', icon: <ShieldCheck className="size-4" />, hint: 'хеш-цепь: движок + браузер', hotkey: 'T' },
  { id: 'purge', label: 'PURGE HEAP', icon: <Trash2 className="size-4" />, hint: 'буфер ленты: предпросмотр + сброс', hotkey: 'P' },
  { id: 'deliver', label: 'DELIVER', icon: <Upload className="size-4" />, hint: 'сдать батч официально', hotkey: 'D' },
  { id: 'void', label: 'VOID', icon: <Skull className="size-4" />, hint: 'закрыть батч навсегда', hotkey: 'X' },
  { id: 'reaper', label: 'REAPER', icon: <Sparkles className="size-4" />, hint: 'жнец говорит: исповедь конвейера', hotkey: 'R' },
  { id: 'shore', label: 'SHORE-MERGE', icon: <Activity className="size-4" />, hint: 'слияние лога с origin (CLI)', hotkey: 'S' },
  { id: 'verdict', label: 'ВЕРДИКТ', icon: <Heart className="size-4" />, hint: 'вердикт автора по батчу (движок)', hotkey: 'W' },
]

const DRAWER_ICONS: Record<DrawerId, React.ReactNode> = {
  docs: <BookOpen className="size-4" />,
  specs: <Boxes className="size-4" />,
  chronicle: <History className="size-4" />,
  batches: <FileText className="size-4" />,
  verdicts: <Heart className="size-4" />,
  vault: <ShieldCheck className="size-4" />,
  archive: <Archive className="size-4" />,
  'file-era': <ScrollText className="size-4" />,
}

const DRAWER_HOTKEYS: Record<DrawerId, string> = {
  docs: '1',
  specs: '2',
  chronicle: '3',
  batches: '4',
  verdicts: '5',
  vault: '6',
  archive: '7',
  'file-era': '8',
}

export function CommandPalette({
  open,
  onOpenChange,
  onAction,
  onDrawer,
  onBatch,
  onMisc,
  batches,
}: CommandPaletteProps) {
  /* ── live-команды (3-b): палитра — диспетчер, работа — в хозяевах ── */

  const abortLiveCmd = useCallback(() => {
    const live = getLiveConsoleUi()
    if (!live.mounted) {
      toast({
        title: 'Live-консоль не в эфире',
        description: 'консоль смонтирована только в виде «Воркфлоу» — прерывать нечего',
      })
      return
    }
    if (live.status === 'down') {
      toast({
        title: 'Live-консоль уже стоит',
        description: 'поток прерван ранее — RECONNECT на плашке, если нужен эфир',
      })
      return
    }
    window.dispatchEvent(new CustomEvent(LIVE_ABORT_EVENT))
    toast({
      title: 'Live-консоль прервана',
      description: 'ручное прерывание оператора — RECONNECT на плашке консоли',
    })
  }, [])

  const resetWorkflowCmd = useCallback(() => {
    /* слушатель — workflow.tsx (владелец степпера); вид переключаем
     * существующим механизмом onMisc — как служебная команда «Воркфлоу» */
    window.dispatchEvent(new CustomEvent(WORKFLOW_RESET_EVENT))
    onMisc({ kind: 'view', view: 'workflow' })
    toast({
      title: 'Новый батч — сброс воркфлоу',
      description: 'команда сброса отправлена, вид переключён на воркфлоу',
    })
  }, [onMisc])

  const snapshotCmd = useCallback(() => {
    const live = getLiveConsoleUi()
    const payload = {
      tool: 't4-state-snapshot',
      at: new Date().toISOString(),
      /* view выведен честно: live-консоль смонтирована только в правой
       * колонке Воркфлоу-вида (page.tsx) — выдумывать не приходится */
      view: live.mounted ? 'workflow' : 'console',
      lastSeq: live.lastSeq,
      status: live.status,
      errors: live.errorCount,
      note: 'THREAD 4 snapshot из палитры — lastSeq/status из live-консоли, view выведен из её монтирования',
    }
    void writeClipboard(JSON.stringify(payload, null, 2)).then((ok) =>
      ok
        ? toast({ title: 'Стейт-снимок скопирован', description: 'JSON в буфере — вставляй куда нужно' })
        : toast({
            title: 'Копирование не удалось',
            description: 'Буфер обмена недоступен',
            variant: 'destructive',
          })
    )
  }, [])

  const verifyCmd = useCallback(() => {
    /* verify-логика живёт в ActionDeck (VerifyPanel) — не дублируем,
     * переиспользуем существующий фокус действия (вид + карточка + скролл) */
    onAction('verify')
    toast({ title: 'Verify — карточка в ActionDeck', description: 'движок + браузер: двойная проверка цепи' })
  }, [onAction])

  /* глобальные хоткеи новых команд: A/N/J свободны (page.tsx владеет
   * B/C/I/T/P/D/X/R/S/W, 1–8, V, «/»); оверлеи Radix — модальны для нас */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (open) return // палитра открыта — клавиши читает cmdk
      if (isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') != null) return
      const k = e.key.toLowerCase()
      if (k === 'a') {
        e.preventDefault()
        abortLiveCmd()
        return
      }
      if (k === 'n') {
        e.preventDefault()
        resetWorkflowCmd()
        return
      }
      if (k === 'j') {
        e.preventDefault()
        snapshotCmd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, abortLiveCmd, resetWorkflowCmd, snapshotCmd])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Палитра команд THREAD 4"
      description="Действия, разделы, батчи — поиск и пуск"
      className="border-zinc-800 bg-zinc-950/95 backdrop-blur sm:max-w-xl"
    >
      <CommandInput placeholder="Команда, раздел, батч… (Esc — закрыть)" className="border-zinc-800 bg-zinc-950 text-sm" />
      <CommandList className="t4-scroll max-h-[60vh]">
        <CommandEmpty className="text-xs text-zinc-500">ничего не нашлось — попробуй «burn», «T4-34», «палитры»…</CommandEmpty>

        <CommandGroup heading="Действия (первый уровень)">
          {ACTION_ITEMS.map((a) => (
            <CommandItem
              key={a.id}
              value={`action ${a.id} ${a.label} ${a.hint}`}
              onSelect={() => {
                onAction(a.id)
                onOpenChange(false)
              }}
              className="text-sm text-zinc-200"
            >
              <span className="text-amber-500/80">{a.icon}</span>
              <span className="font-mono font-semibold">{a.label}</span>
              <span className="hidden text-xs text-zinc-600 sm:inline">— {a.hint}</span>
              <CommandShortcut className="font-mono text-[10px] text-zinc-600">{a.hotkey}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator className="bg-zinc-800" />

        <CommandGroup heading="Читальный зал (второй уровень)">
          {(Object.keys(DRAWER_META) as DrawerId[]).map((d) => (
            <CommandItem
              key={d}
              value={`drawer ${d} ${DRAWER_META[d].label} ${DRAWER_META[d].hint}`}
              onSelect={() => {
                onDrawer(d)
                onOpenChange(false)
              }}
              className="text-sm text-zinc-200"
            >
              <span className="text-zinc-500">{DRAWER_ICONS[d]}</span>
              <span>{DRAWER_META[d].label}</span>
              <span className="hidden text-xs text-zinc-600 sm:inline">— {DRAWER_META[d].hint}</span>
              <CommandShortcut className="font-mono text-[10px] text-zinc-600">{DRAWER_HOTKEYS[d]}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        {batches.length > 0 ? (
          <>
            <CommandSeparator className="bg-zinc-800" />
            <CommandGroup heading="Батчи — прыжок в детали">
              {batches.slice(0, 8).map((b) => (
                <CommandItem
                  key={b.slug}
                  value={`batch ${b.slug} ${b.title}`}
                  onSelect={() => {
                    onBatch(b.slug)
                    onOpenChange(false)
                  }}
                  className="text-sm text-zinc-200"
                >
                  <FileText className="size-4 text-zinc-600" />
                  <span className="font-mono text-xs text-amber-200/90">{b.slug}</span>
                  <span className="truncate text-xs text-zinc-400">{b.title}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{b.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator className="bg-zinc-800" />

        <CommandGroup heading="Live-консоль · воркфлоу (3-b)">
          <CommandItem
            value="live abort прервать консоль sse поток стоп оператор"
            onSelect={() => {
              abortLiveCmd()
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <Square className="size-4 text-rose-400/80" />
            <span>Прервать Live-консоль</span>
            <span className="hidden text-xs text-zinc-600 sm:inline">— SSE twin’а оборван руками · RECONNECT на плашке</span>
            <CommandShortcut className="font-mono text-[10px] text-zinc-600">A</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="workflow reset новый батч сброс воркфлоу тема якоря компиляция"
            onSelect={() => {
              resetWorkflowCmd()
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <FilePlus2 className="size-4 text-amber-500/80" />
            <span>Новый батч — сброс воркфлоу</span>
            <span className="hidden text-xs text-zinc-600 sm:inline">— чистый приказ: тема → якоря → компиляция</span>
            <CommandShortcut className="font-mono text-[10px] text-zinc-600">N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="snapshot стейт-снимок json копия lastseq буфер"
            onSelect={() => {
              snapshotCmd()
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <Braces className="size-4 text-cyan-300/80" />
            <span>Скопировать стейт-снимок (JSON)</span>
            <span className="hidden text-xs text-zinc-600 sm:inline">— at · view · lastSeq · note — честный срез</span>
            <CommandShortcut className="font-mono text-[10px] text-zinc-600">J</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="verify цепи движок проверка карточка action deck хеш"
            onSelect={() => {
              verifyCmd()
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <ShieldCheck className="size-4 text-emerald-400/80" />
            <span>Verify цепи — движок</span>
            <span className="hidden text-xs text-zinc-600 sm:inline">— карточка VERIFY в ActionDeck (глобальный T)</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator className="bg-zinc-800" />

        <CommandGroup heading="Служебное">
          <CommandItem
            value="view воркфлоу workflow тема якоря compile deliver rust"
            onSelect={() => {
              onMisc({ kind: 'view', view: 'workflow' })
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <Compass className="size-4 text-zinc-500" />
            <span>Воркфлоу — тема → якоря → компиляция → сдача (Rust twin)</span>
            <kbd className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] text-zinc-500">V</kbd>
          </CommandItem>
          <CommandItem
            value="view консоль console мощность action deck"
            onSelect={() => {
              onMisc({ kind: 'view', view: 'console' })
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <LayoutGrid className="size-4 text-zinc-500" />
            <span>Консоль «МОЩНОСТЬ» — action deck + лента + окно ротации</span>
            <kbd className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] text-zinc-500">V</kbd>
          </CommandItem>
          <CommandItem
            value="view сборка build витрина скомпилированные батчи batches compiled скретч прод дубль слаг"
            onSelect={() => {
              onMisc({ kind: 'view', view: 'build' })
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <Hammer className="size-4 text-amber-400/80" />
            <span>Сборка — витрина скомпилированных батчей (scratch + прод)</span>
            <kbd className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] text-zinc-500">G</kbd>
          </CommandItem>
          <CommandItem
            value="misc refresh обновить всё состояние"
            onSelect={() => {
              onMisc({ kind: 'refresh' })
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <RefreshCw className="size-4 text-zinc-500" />
            <span>Обновить всё (состояние · лента · окно · батчи)</span>
          </CommandItem>
          <CommandItem
            value="misc settings настройки ключ командира стекло"
            onSelect={() => {
              onMisc({ kind: 'settings' })
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <KeyRound className="size-4 text-zinc-500" />
            <span>Настройки — ключ командира · стекло движка</span>
          </CommandItem>
          <CommandItem
            value="misc export экспорт летописи jsonl"
            onSelect={() => {
              onMisc({ kind: 'export-chronicle' })
              onOpenChange(false)
            }}
            className="text-sm text-zinc-200"
          >
            <Download className="size-4 text-zinc-500" />
            <span>Экспорт летописи (JSONL, последние 1000 звеньев)</span>
          </CommandItem>
        </CommandGroup>

        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1 font-mono text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <CommandIcon className="size-3" /> THREAD 4 · консоль
          </span>
          <span>↑↓ выбор · Enter — пуск · Esc — закрыть · A/N/J live-команды</span>
        </div>
      </CommandList>
    </CommandDialog>
  )
}
