'use client'

/**
 * THREAD 4 — палитра команд (⌘K / Ctrl+K).
 *
 * Быстрый доступ ко всему: 9 рабочих действий, 8 разделов читального
 * зала, недавние батчи (прыжок в детали), служебные команды (обновить
 * всё, настройки с ключом командира, экспорт летописи). Построена на
 * shadcn Command (cmdk): стрелки + Enter, Esc — закрыть.
 */

import {
  Activity,
  Archive,
  BookOpen,
  Boxes,
  Command as CommandIcon,
  Download,
  FileText,
  FlaskConical,
  Heart,
  History,
  KeyRound,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Skull,
  Sparkles,
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
import type { EngineBatchRow } from '@/components/t4/console/panels'
import {
  DRAWER_META,
  type ActionId,
  type DrawerId,
} from '@/components/t4/console/shared'

export interface PaletteMisc {
  kind: 'refresh' | 'settings' | 'export-chronicle'
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

        <CommandGroup heading="Служебное">
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
          <span>↑↓ выбор · Enter — пуск · Esc — закрыть</span>
        </div>
      </CommandList>
    </CommandDialog>
  )
}
