'use client'

/**
 * THREAD 4 — dashboard (the / route).
 * Dark atelier: zinc surfaces, amber accent, rose for verdicts/X, emerald
 * for gates. No blue, no indigo. Single-page tabbed SPA — no routing.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Archive as ArchiveIcon,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Crosshair,
  Download,
  FileText,
  FlaskConical,
  GitCompare,
  Heart,
  History,
  KeyRound,
  Layers,
  PenLine,
  Radar,
  RotateCcw,
  ScanEye,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Stamp,
  Upload,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  ApiError,
  asArray,
  asRecord,
  asStr,
  clearCommanderKey,
  commanderHeaders,
  formatDate,
  getCommanderKey,
  isNotFound,
  postJson,
  probeCommanderKey,
  setCommanderKey,
  useApi,
  type CompilePayload,
  type DeliverResponse,
  type ScribeResponse,
} from '@/components/t4/api'
import {
  Chip,
  EmptyState,
  ErrorNote,
  LevelBadge,
  Mono,
  Panel,
  RatingBadge,
  SkeletonBlock,
  StatCard,
  TypeBadge,
  VerdictBadge,
} from '@/components/t4/bits'
import { MarkdownView } from '@/components/t4/markdown'
import { SpecView } from '@/components/t4/spec-renderers'
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
import {
  cacheCurrentState,
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
  restoreSnapshot,
  type VaultMeta,
} from '@/components/t4/vault'
import {
  clearPendingSlotNav,
  navigateToSlot,
  pendingSlotNav,
  subscribeSlotNav,
} from '@/components/t4/nav'

/* ------------------------------------------------------------------ */
/* Tab model                                                           */
/* ------------------------------------------------------------------ */

/** Преемник Фреда, 2026-10-10: человеческое объяснение отказа замка Залпа 1
 *  для любой мутации летописи из UI. 403 = ключ не совпал/не приложен,
 *  503 = на сервере нет замка вовсе. Всё остальное — как было. */
function ledgerWriteError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) {
      return getCommanderKey() === ''
        ? 'ключ командира не сохранён в браузере — Стекло → «Ключ командира»'
        : 'ключ командира не совпал — проверь его в Стекле (сервер: ~/.t4/commander.key)'
    }
    if (e.status === 503) return 'на сервере нет замка (~/.t4/commander.key) — летопись залочена'
    if (isNotFound(e)) return 'API недоступен'
    return e.message
  }
  return 'Не удалось записать'
}

type TabId =
  | 'state'
  | 'constitution'
  | 'specs'
  | 'compile'
  | 'batches'
  | 'events'
  | 'verdicts'
  | 'glass'
  | 'vault'
  | 'archive'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'state', label: 'Состояние', icon: <Activity className="size-3.5" /> },
  { id: 'constitution', label: 'Документы', icon: <ScrollText className="size-3.5" /> },
  { id: 'specs', label: 'Спеки', icon: <Boxes className="size-3.5" /> },
  { id: 'compile', label: 'Сборка', icon: <FlaskConical className="size-3.5" /> },
  { id: 'batches', label: 'Батчи', icon: <FileText className="size-3.5" /> },
  { id: 'events', label: 'События', icon: <History className="size-3.5" /> },
  { id: 'verdicts', label: 'Вердикты', icon: <Heart className="size-3.5" /> },
  { id: 'glass', label: 'Стекло', icon: <ScanEye className="size-3.5" /> },
  { id: 'vault', label: 'Хранилище', icon: <ShieldCheck className="size-3.5" /> },
  { id: 'archive', label: 'Архив 3.2', icon: <ArchiveIcon className="size-3.5" /> },
]

/* ------------------------------------------------------------------ */
/* Tab: Стекло (Залп 3) — здоровье хрупкого, объявленное честно        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Стекло → ключ командира (браузерная половина замка Залпа 1)         */
/* ------------------------------------------------------------------ */

function CommanderKeyPanel() {
  const [input, setInput] = useState('')
  // ленивый инициализатор, не эффект: вкладка монтируется по клику — SSR-прохода нет,
  // а правило линтера (set-state-in-effect) требует читать localStorage здесь
  const [saved, setSaved] = useState<string | null>(() => getCommanderKey() || null)
  const [probe, setProbe] = useState<
    { state: 'idle' } | { state: 'busy' } | { state: 'ok'; serverKey: boolean; keyOk: boolean } | { state: 'err'; msg: string }
  >({ state: 'idle' })

  async function save() {
    setCommanderKey(input)
    setSaved(getCommanderKey() || null)
    setProbe({ state: 'idle' })
  }

  async function erase() {
    clearCommanderKey()
    setInput('')
    setSaved(null)
    setProbe({ state: 'idle' })
  }

  async function test() {
    setProbe({ state: 'busy' })
    try {
      const p = await probeCommanderKey()
      setProbe({ state: 'ok', serverKey: p.serverKey, keyOk: p.keyOk })
    } catch (e) {
      setProbe({ state: 'err', msg: e instanceof Error ? e.message : 'нет ответа' })
    }
  }

  const probeText =
    probe.state === 'busy'
      ? 'проверяю…'
      : probe.state === 'ok'
        ? probe.serverKey
          ? probe.keyOk
            ? 'ключ совпал — летопись откроется на запись'
            : 'ключ НЕ совпал — сверься с ~/.t4/commander.key на сервере'
          : 'на сервере нет замка (~/.t4/commander.key) — сначала создай его'
        : probe.state === 'err'
          ? `не достучался: ${probe.msg}`
          : null

  return (
    <Panel title="Ключ командира — браузер" icon={<KeyRound className="size-4" />}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-zinc-500">
          Замок летописи двусторонний (Залп 1 «Правда»): серверная половина —{' '}
          <code className="text-amber-300">~/.t4/commander.key</code> на машине ядра, браузерная —
          здесь. Ключ хранится в localStorage этого браузера, уходит только заголовком на запись
          в <code className="text-amber-300">/api/t4/events</code> и нигде не светится: ни в URL,
          ни в репо. Без него быстрые вердикты и VLM-сводки упираются в 403.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={saved ? 'сохранён — вводи новый для замены' : 'вставь ключ командира…'}
            className="h-8 min-w-52 flex-1 border-zinc-800 bg-zinc-950 font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            onClick={save}
            disabled={input.trim() === ''}
            size="sm"
            className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            Сохранить
          </Button>
          <Button
            onClick={test}
            size="sm"
            variant="outline"
            className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/40 hover:text-amber-200"
          >
            Проверить
          </Button>
          {saved ? (
            <Button
              onClick={erase}
              size="sm"
              variant="outline"
              className="border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-rose-500/40 hover:text-rose-300"
            >
              Стереть
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-zinc-500">
            состояние:{' '}
            {saved ? (
              <span className="font-medium text-emerald-400">
                сохранён в браузере · {saved.length} симв.
              </span>
            ) : (
              <span className="font-medium text-amber-400">не сохранён — запись залочена (403)</span>
            )}
          </span>
          {probeText ? (
            <span
              className={cn(
                'font-medium',
                probe.state === 'ok'
                  ? probe.serverKey && probe.keyOk
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                  : 'text-zinc-400'
              )}
            >
              проверка: {probeText}
            </span>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}

function GlassTab() {
  const { data, error, loading } = useApi<Record<string, unknown>>('/api/t4/state')
  const rec = asRecord(data)
  const glass = asRecord(rec.glass)
  const chain = asRecord(glass.chain)
  const debts = asArray(rec.openDebts).map(asStr).filter(Boolean)

  const row = (label: string, value: React.ReactNode, tone: 'ok' | 'bad' | 'neutral' = 'neutral') => (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-800/60 py-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span
        className={cn(
          'font-mono text-xs',
          tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-zinc-300'
        )}
      >
        {value}
      </span>
    </div>
  )

  const chainOk = chain.ok === true

  return (
    <div className="space-y-6">
      <Panel title="Стекло — честная хрупкость (П-8)" icon={<ScanEye className="size-4" />}>
        {loading ? (
          <SkeletonBlock lines={6} />
        ) : error ? (
          <p className="text-xs text-rose-400">state не читается: {typeof error === "string" ? error : (error as { message?: string }).message ?? "—"}</p>
        ) : (
          <div>
            {row(
              'commander-key (сервер)',
              glass.commanderKey === true ? 'на месте' : 'ОТСУТСТВУЕТ — замок',
              glass.commanderKey === true ? 'ok' : 'bad'
            )}
            {row(
              'хеш-цепь летописи',
              chainOk ? `ЦЕЛА · ${asStr(chain.events)} звеньев · head ${asStr(chain.head)}` : 'СЛОМАНА',
              chainOk ? 'ok' : 'bad'
            )}
            {row('атомарные записи', glass.atomicWrites === true ? 'tmp+rename' : '?', glass.atomicWrites === true ? 'ok' : 'bad')}
            {row(
              'grep-gate (live)',
              glass.grepGate === true ? 'чист — код не помнит чисел' : 'нарушения!',
              glass.grepGate === true ? 'ok' : 'bad'
            )}
            {row('писец: последний черновик', asStr(glass.scribeLastDraft)?.slice(0, 10) || 'ещё не писал', glass.scribeLastDraft ? 'ok' : 'neutral')}
            {row('последняя проверка восстановления', asStr(glass.lastRecoveryCheck)?.slice(0, 10) || '—')}
            {(() => {
              const cycle = asRecord(glass.authorCycle)
              const hours = cycle.hours
              const label = hours == null ? asStr(cycle.note) || '—' : `${hours} ч`
              const bad = hours != null && Number(hours) > 24
              return row(`цикл автора (${asStr(cycle.slug) || '—'})`, label, bad ? 'bad' : 'ok')
            })()}
            {row('граница чтения', asStr(glass.readBoundary) || '—')}
            {row('открытые долги', debts.length === 0 ? 'нет' : String(debts.length), debts.length === 0 ? 'ok' : 'bad')}
            {row('прошлые смерти', '3 — все пережиты из бандла/сейфа', 'neutral')}
          </div>
        )}
      </Panel>

      <CommanderKeyPanel />

      <Panel title="Как лечить стекло" icon={<Stamp className="size-4" />}>
        <div className="space-y-2 text-xs text-zinc-400">
          <p>· Обрыв питания — не страшно: записи атомарны, а истина лежит в git. Восстановление: git bundle + сейф браузера (Хранилище) + лог.</p>
          <p>· Сервер залочен (commander-key нет) — создай <code className="text-amber-300">~/.t4/commander.key</code>, состояние появится здесь зелёным; затем сохрани копию ключа в панели выше — и пиши вердикты прямо из браузера.</p>
          <p>· Цепь сломана — значит, летопись правили руками. Это громкий детектор, а не баг: разберись, кто и что правил, потом <code className="text-amber-300">bun thread4/cli.ts verify --heal</code>.</p>
          <p>· Внешний доступ к треду — только через read-key (см. границу чтения выше), не молчанием.</p>
        </div>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Состояние                                                      */
/* ------------------------------------------------------------------ */

function StateTab() {
  const { data, error, loading } = useApi<Record<string, unknown>>('/api/t4/state')
  const rec = asRecord(data)
  const counts = asRecord(rec.counts)
  const debts = asArray(rec.openDebts).map(asStr).filter(Boolean)

  return (
    <div className="space-y-6">
      <Panel title="Эпоха" icon={<Sparkles className="size-4" />}>
        {loading ? (
          <SkeletonBlock lines={3} />
        ) : error ? (
          <ErrorNote text="Ядро ещё не отвечает" hint="API /api/t4/state подключается на этапе интеграции ядра" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Эпоха" value={asStr(rec.era) || 'THREAD 4'} hint="чистый лист" />
            <StatCard label="Последний батч" value={asStr(rec.lastBatch) || '—'} hint="новая эра, имена с нуля" />
            <StatCard label="Следующий шаг" value={asStr(rec.nextStep) || 'T4-01'} hint="ждёт тему от автора" />
            <StatCard label="Гейты" value={asStr(rec.gateHealth) || '—'} hint="hard / warn / advisory" />
          </div>
        )}
      </Panel>

      <Panel title="Система в числах" icon={<Boxes className="size-4" />}>
        {loading ? (
          <SkeletonBlock lines={2} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Батчи" value={asStr(counts.batches) || '0'} />
            <StatCard label="События" value={asStr(counts.events) || '0'} />
            <StatCard
              label="Носители"
              value={asStr(counts.carriers) || '—'}
              hint={asStr(counts.carriers) ? 'carriers.json читается' : 'спека не читается — ДЕЙСТВУЙ'}
            />
            <StatCard
              label="Позы"
              value={asStr(counts.poses) || '—'}
              hint={asStr(counts.poses) ? 'poses.json читается' : 'спека не читается — ДЕЙСТВУЙ'}
            />
            <StatCard
              label="Палитры"
              value={asStr(counts.palettes) || '—'}
              hint={asStr(counts.palettes) ? 'palettes.json читается' : 'спека не читается — ДЕЙСТВУЙ'}
            />
          </div>
        )}
      </Panel>

      <Panel title="Открытые долги" icon={<History className="size-4" />}>
        {debts.length === 0 ? (
          <EmptyState
            title="Долгов нет"
            hint="Чистый лист эпохи. Долги появятся с первыми батчами и вердиктами."
          />
        ) : (
          <ul className="space-y-2">
            {debts.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                {d}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Документы (конституция / вкус / рендерер-факты)                */
/* ------------------------------------------------------------------ */

const DOCS = [
  { id: 'constitution', label: 'Конституция' },
  { id: 'taste', label: 'Вкус' },
  { id: 'facts', label: 'Рендерер-факты' },
  { id: 'forge', label: 'Кузница движков' },
  { id: 'niche', label: 'Ниша' },
] as const

function DocsTab() {
  const [doc, setDoc] = useState<(typeof DOCS)[number]['id']>('constitution')
  const { data, error, loading } = useApi<{ title: string; markdown: string }>(`/api/t4/docs/${doc}`)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {DOCS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDoc(d.id)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              doc === d.id
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <Panel bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll">
        {loading ? (
          <SkeletonBlock lines={12} />
        ) : error ? (
          <ErrorNote text="Документ недоступен" hint="API /api/t4/docs подключается на этапе интеграции ядра" />
        ) : (
          <MarkdownView>{data?.markdown ?? ''}</MarkdownView>
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Спеки                                                          */
/* ------------------------------------------------------------------ */

function SpecsTab() {
  const list = useApi<{ specs: { id: string; name: string; count: number; version: string }[] }>('/api/t4/specs')
  const [active, setActive] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const specs = list.data?.specs ?? []
  const current = active ?? specs[0]?.id ?? null
  const spec = useApi<unknown>(current ? `/api/t4/specs/${current}` : null)

  return (
    /* minmax(0,1fr): implicit auto-колонка раздувалась под min-content
     * таблиц спеки (+190px на 390px, QA webDevReview #3) — таблицы внутри
     * и так скроллятся своими overflow-x-auto контейнерами. */
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Panel title="Спеки" icon={<Boxes className="size-4" />} bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll">
        {list.loading ? (
          <SkeletonBlock lines={6} />
        ) : list.error ? (
          <ErrorNote text="Список спек недоступен" hint="ядро ещё не подключено" />
        ) : specs.length === 0 ? (
          <EmptyState title="Спеки не найдены" />
        ) : (
          <div className="space-y-1.5">
            {specs.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                  current === s.id
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
                )}
              >
                <span className="font-medium">{s.name}</span>
                <Chip tone={current === s.id ? 'amber' : 'zinc'}>{s.count}</Chip>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title={specs.find((s) => s.id === current)?.name ?? 'Спека'}
        icon={<BookOpen className="size-4" />}
        action={
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Фильтр…"
            className="h-8 w-40 border-zinc-800 bg-zinc-950 text-xs sm:w-56"
          />
        }
        bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll"
      >
        {spec.loading ? (
          <SkeletonBlock lines={10} />
        ) : spec.error ? (
          <ErrorNote text="Спека недоступна" />
        ) : (
          <SpecView id={current ?? ''} spec={spec.data} filter={filter.toLowerCase()} />
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Сборка (компилятор контрактов)                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Черновик контракта: авторский бриф БЕЗ компиляции (низкое доверие   */
/* к авто-входам — Issue #21; номер присваивается автоматически).       */
/* ------------------------------------------------------------------ */

const OC_RATINGS = ['PG-13', 'R', 'R+', 'X'] as const

function DraftComposer() {
  const meta = useApi<{ nextSlug: string; races: { id: string; name: string }[] }>(
    '/api/t4/contract-draft'
  )
  const [theme, setTheme] = useState('')
  const [oc, setOc] = useState([
    { theme: '', rating: 'R+', wishes: '' },
    { theme: '', rating: 'R+', wishes: '' },
    { theme: '', rating: 'R+', wishes: '' },
  ])
  const [mainWishes, setMainWishes] = useState('')
  const [speciesOn, setSpeciesOn] = useState(true)
  const [speciesCount, setSpeciesCount] = useState(10)
  const [speciesList, setSpeciesList] = useState<string[]>([])
  const [xSlots, setXSlots] = useState(0)
  const [abPairs, setAbPairs] = useState(3)
  const [rehab, setRehab] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function setOcRow(i: number, patch: Partial<{ theme: string; rating: string; wishes: string }>) {
    setOc((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function toggleSpecies(id: string) {
    setSpeciesList((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  }

  async function save() {
    setBusy(true)
    setSaved(null)
    setErr(null)
    try {
      const res = await postJson<{ ok: boolean; slug: string }>('/api/t4/contract-draft', {
        theme,
        ocThemes: oc,
        mainWishes,
        speciesOn,
        speciesCount,
        speciesList,
        xSlots,
        abPairs,
        rehab,
        engine: 'per-theme',
      })
      setSaved(res.slug)
      setTheme('')
      setOc([
        { theme: '', rating: 'R+', wishes: '' },
        { theme: '', rating: 'R+', wishes: '' },
        { theme: '', rating: 'R+', wishes: '' },
      ])
      setMainWishes('')
      meta.reload()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Сеть недоступна — черновик не сохранён')
    } finally {
      setBusy(false)
    }
  }

  const races = meta.data?.races ?? []

  return (
    <Panel
      title={`Черновик контракта — без компиляции · номер ${meta.data?.nextSlug ?? 'T4-??'}`}
      icon={<PenLine className="size-4" />}
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-zinc-500">
          Авторский бриф: тема, три темы для ОС с рейтингами, пожелания и раскладка.
          Номер присваивается автоматически. Компилятор этот файл не читает —
          бриф забирает писец (закон письма, DoD v1).
        </p>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Тема батча</p>
          <Input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Например: MAIN CHARACTER SYNDROME…"
            className="border-zinc-800 bg-zinc-950"
          />
        </div>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Три темы для ОС + рейтинг</p>
          {oc.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="w-14 justify-center border-fuchsia-800/60 text-fuchsia-400">
                OC-{i + 1}
              </Badge>
              <Input
                value={row.theme}
                onChange={(e) => setOcRow(i, { theme: e.target.value })}
                placeholder="Тема ОС…"
                className="min-w-40 flex-1 border-zinc-800 bg-zinc-950"
              />
              <div className="flex gap-1">
                {OC_RATINGS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setOcRow(i, { rating: r })}
                    className={cn(
                      'rounded-md border px-2 py-1 font-mono text-[11px] transition-colors',
                      row.rating === r
                        ? 'border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-300'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                value={row.wishes}
                onChange={(e) => setOcRow(i, { wishes: e.target.value })}
                placeholder="Пожелания к ОС…"
                className="min-w-40 flex-1 border-zinc-800 bg-zinc-950 text-xs"
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">
            Пожелания к основной теме
          </p>
          <Textarea
            value={mainWishes}
            onChange={(e) => setMainWishes(e.target.value)}
            placeholder="Акценты, реюз героинь, зоны, настроение…"
            className="min-h-16 border-zinc-800 bg-zinc-950 text-sm"
          />
        </div>

        <div className="grid gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">Кины (Species)</span>
            <Switch checked={speciesOn} onCheckedChange={setSpeciesOn} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">Сколько киновых слотов</span>
            <span className="w-8 text-right font-mono text-xs text-amber-400">{speciesCount}</span>
            <Slider
              value={[speciesCount]}
              onValueChange={(v) => setSpeciesCount(v[0] ?? speciesCount)}
              min={0}
              max={21}
              step={1}
              className="w-28"
              disabled={!speciesOn}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">X-слоты</span>
            <div className="flex gap-1">
              {[0, 1, 2].map((n) => (
                <button
                  key={n}
                  onClick={() => setXSlots(n)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors',
                    xSlots === n
                      ? 'border-rose-500/60 bg-rose-500/15 text-rose-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">A/B-пары</span>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setAbPairs(n)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors',
                    abPairs === n
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">REHAB-добор каналов</span>
            <Switch checked={rehab} onCheckedChange={setRehab} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-300">Движок</span>
            <Badge variant="outline" className="border-zinc-700 font-mono text-[11px] text-zinc-400">
              per-theme (одноразовый)
            </Badge>
          </div>
        </div>

        {speciesOn && races.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              Какие кины — отмечай любимых ({speciesList.length} выбрано)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {races.map((r) => (
                <button
                  key={r.id}
                  onClick={() => toggleSpecies(r.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    speciesList.includes(r.id)
                      ? 'border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                  )}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            onClick={save}
            disabled={busy || theme.trim() === ''}
            className="bg-gradient-to-r from-amber-500 to-fuchsia-600 font-medium text-zinc-950 hover:from-amber-400 hover:to-fuchsia-500"
          >
            {busy ? 'Сохраняю…' : `Сохранить черновик ${meta.data?.nextSlug ?? ''}`}
          </Button>
          {saved ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Check className="size-3.5" /> черновик {saved} записан — в thread4/drafts/
            </span>
          ) : null}
          {err ? <span className="text-xs text-rose-400">{err}</span> : null}
        </div>
      </div>
    </Panel>
  )
}

function CompileTab() {
  const [theme, setTheme] = useState('')
  const [engine, setEngine] = useState('')
  const [ocRows, setOcRows] = useState([
    { name: '', theme: '' },
    { name: '', theme: '' },
    { name: '', theme: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CompilePayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const contracts = useApi<{ items: { slug: string; theme: string; createdAt: string }[] }>('/api/t4/contracts')
  const [viewSlug, setViewSlug] = useState<string | null>(null)
  const detail = useApi<{ markdown: string }>(viewSlug ? `/api/t4/contracts/${viewSlug}` : null)

  /* авто-писец */
  const [scribe, setScribe] = useState<{
    slug: string
    busy: boolean
    err: string | null
    res: ScribeResponse | null
  } | null>(null)
  const [deliverNote, setDeliverNote] = useState<string | null>(null)

  async function compile() {
    const t = theme.trim()
    if (!t || busy) return
    setBusy(true)
    setErr(null)
    setResult(null)
    const ocOrders = ocRows.map((r) => r.name.trim()).filter(Boolean)
    const ocThemes: Record<string, string> = {}
    for (const r of ocRows) {
      const n = r.name.trim()
      const th = r.theme.trim()
      if (n && th) ocThemes[n] = th
    }
    const payload: Record<string, unknown> = { theme: t }
    if (ocOrders.length > 0) payload.ocOrders = ocOrders
    if (Object.keys(ocThemes).length > 0) payload.ocThemes = ocThemes
    if (engine.trim()) payload.engine = engine.trim()
    try {
      const res = await postJson<CompilePayload>('/api/t4/compile', payload)
      setResult(res)
      contracts.reload()
    } catch (e) {
      setErr(e instanceof ApiError ? `API: ${e.message}` : 'Сеть недоступна')
    } finally {
      setBusy(false)
    }
  }

  async function copyOrder(slug: string) {
    try {
      await navigator.clipboard.writeText(`Super Z, произведи ${slug}`)
      setCopied(slug)
      setTimeout(() => setCopied((c) => (c === slug ? null : c)), 2500)
    } catch {
      setCopied(null)
    }
  }

  async function runScribe(slug: string) {
    if (scribe?.busy) return
    setDeliverNote(null)
    setScribe({ slug, busy: true, err: null, res: null })
    try {
      const res = await postJson<ScribeResponse>('/api/t4/scribe', { slug })
      setScribe({ slug, busy: false, err: null, res })
    } catch (e) {
      setScribe({
        slug,
        busy: false,
        err: e instanceof ApiError ? `API: ${e.message}` : 'Сеть недоступна — писец не смог',
        res: null,
      })
    }
  }

  async function deliverOfficial(slug: string) {
    setDeliverNote(null)
    try {
      const res = await postJson<DeliverResponse>('/api/t4/gates', { slug, deliver: true })
      setDeliverNote(
        res.delivered
          ? `${slug} «${res.title}» сдан официально${res.result?.firstRunClean ? ' · FIRST RUN CLEAN' : ''} — батч, мета и ворклог во вкладке «Батчи»`
          : `${slug}: hard FAIL — черновик чини (см. квитанции во вкладке «Батчи»)`
      )
    } catch (e) {
      setDeliverNote(e instanceof ApiError ? `API: ${e.message}` : 'Сеть недоступна')
    }
  }

  const items = contracts.data?.items ?? []

  return (
    <div className="space-y-6">
      <DraftComposer />
      <Panel title="Компилятор батча" icon={<FlaskConical className="size-4" />}>
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            Тема от автора → слот-план 24 промпта (21 мейн + 3 OC — вердикт T4-02): жанры,
            рейтинги по рецептуре, назначенные носители, позы, палитры, расы, регистры.
            Диверсия назначается ДО письма. Контракт = экспозиция для автора + закон для писца.
          </p>
          <p className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
            Статус: experimental / low-trust (Issue #21). Авто-скелет и авто-писец дают черновик,
            требующий обязательной ручной переработки писцом — закон письма (вердикт T4-12).
            Качество измеряет вердикт автора после рендера, не FIRST RUN CLEAN (Issue #20).
          </p>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Тема батча — например: «город, где усталость носит как меха»…"
            className="min-h-20 border-zinc-800 bg-zinc-950 text-sm"
          />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
            <Input
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              placeholder="движок (пусто = ротация)"
              className="h-9 border-zinc-800 bg-zinc-950 text-xs"
            />
            <p className="self-center text-[11px] leading-tight text-zinc-600">
              tint · bespoke · counterfall · … — ключ из спеки движков; пусто = ротация.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-600">
              Заказ OC — до трёх · имя из канона (пусто = ротация) · тема по желанию
            </p>
            {ocRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                <Input
                  value={row.name}
                  onChange={(e) =>
                    setOcRows((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                  }
                  placeholder={i === 0 ? 'например: Lyn' : 'имя OC'}
                  className="h-9 border-zinc-800 bg-zinc-950 text-xs"
                />
                <Input
                  value={row.theme}
                  onChange={(e) =>
                    setOcRows((rows) => rows.map((r, j) => (j === i ? { ...r, theme: e.target.value } : r)))
                  }
                  placeholder="тема/сценарий для неё — пусто = писец выведет из темы батча"
                  className="h-9 border-zinc-800 bg-zinc-950 text-xs"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={compile}
              disabled={busy || theme.trim() === ''}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {busy ? 'Компилирую…' : 'Скомпилировать'}
            </Button>
            {err ? <span className="text-xs text-rose-400">{err}</span> : null}
          </div>
        </div>
      </Panel>

      {result ? (
        <Panel title={`Контракт ${result.slug}`} icon={<ScrollText className="size-4" />} bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll">
          <MarkdownView>{result.markdown ?? ''}</MarkdownView>
        </Panel>
      ) : null}

      <Panel title="Производство — от сборки к батчу" icon={<Sparkles className="size-4" />}>
        <ol className="space-y-2 text-xs leading-relaxed text-zinc-400">
          <li>
            <span className="text-amber-400">1 ·</span> Собери контракт выше — тема, при желании движок и заказ
            OC с их темами. Сборка занимает секунды и ни к чему не обязывает: это план, не батч.
          </li>
          <li>
            <span className="text-amber-400">2а ·</span> <span className="text-zinc-200">Приказ в чате:</span> кнопка
            «Приказ» у контракта копирует <Mono>{'«Super Z, произведи T4-NN»'}</Mono> — писец Super Z пишет
            21 мейн + 3 OC, самопроверка, сдача с ворклогом.
          </li>
          <li>
            <span className="text-amber-400">2б ·</span> <span className="text-zinc-200">Авто-писец:</span> кнопка
            «Писец» у контракта — машина пишет черновик по тому же контракту (2-5 минут), гейты
            гоняют его автоматически, ремонт до 2 кругов. Потом — «Сдать» или моя полировка.
          </li>
          <li>
            <span className="text-amber-400">3 ·</span> Батч и квитанции гейтов — во вкладке «Батчи»; твой
            вердикт — там же, одной панелью чипов.
          </li>
        </ol>
      </Panel>

      <Panel title="Контракты" icon={<FileText className="size-4" />}>
        {contracts.loading ? (
          <SkeletonBlock lines={3} />
        ) : items.length === 0 ? (
          <EmptyState title="Контрактов пока нет" hint="Первый контракт станет T4-01." />
        ) : (
          <div className="space-y-1.5">
            {items.map((c) => (
              <div key={c.slug} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                <button
                  onClick={() => setViewSlug(viewSlug === c.slug ? null : c.slug)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <Mono>{c.slug}</Mono>
                  <span className="truncate text-xs text-zinc-300">{c.theme}</span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => runScribe(c.slug)}
                    disabled={scribe?.busy === true}
                    title="Авто-писец: машина пишет черновик батча по этому контракту (2-5 минут)"
                    className={cn(
                      'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                      scribe?.busy && scribe.slug === c.slug
                        ? 'border-amber-500/60 bg-amber-500/20 text-amber-200'
                        : 'border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-200',
                      scribe?.busy === true ? 'cursor-wait opacity-60' : ''
                    )}
                  >
                    <PenLine className="size-3" />
                    {scribe?.busy && scribe.slug === c.slug ? 'Пишет…' : 'Писец'}
                  </button>
                  <button
                    onClick={() => copyOrder(c.slug)}
                    title="Скопировать приказ на производство"
                    className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
                  >
                    {copied === c.slug ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copied === c.slug ? 'Скопировано' : 'Приказ'}
                  </button>
                  <span className="text-[11px] text-zinc-600">{formatDate(c.createdAt)}</span>
                </div>
              </div>
            ))}
            {viewSlug ? (
              <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
                {detail.loading ? (
                  <SkeletonBlock lines={8} />
                ) : detail.error ? (
                  <ErrorNote text="Контракт недоступен" />
                ) : (
                  <div className="max-h-[50vh] overflow-y-auto t4-scroll">
                    <MarkdownView>{detail.data?.markdown ?? ''}</MarkdownView>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {scribe ? (
        <Panel
          title={`Авто-писец · ${scribe.slug}`}
          icon={<PenLine className="size-4" />}
          action={
            !scribe.busy ? (
              <button
                onClick={() => setScribe(null)}
                className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
              >
                скрыть
              </button>
            ) : null
          }
        >
          {scribe.busy ? (
            <div className="flex items-start gap-3">
              <span className="mt-1 size-3 shrink-0 animate-pulse rounded-full bg-amber-500" />
              <div className="space-y-1 text-xs leading-relaxed text-zinc-400">
                <p className="text-zinc-200">Машина пишет черновик: 24 слота против контракта, потом гейты всухую.</p>
                <p>Это занимает 2-5 минут — страница ждёт ответа, не закрывай вкладку.</p>
              </div>
            </div>
          ) : scribe.err ? (
            <ErrorNote text={scribe.err} hint="Черновик можно перезапустить кнопкой «Писец»" />
          ) : scribe.res ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100">{scribe.res.title}</span>
                {scribe.res.hardPass ? (
                  <Chip tone="emerald">гейты dry PASS</Chip>
                ) : (
                  <Chip tone="rose">гейты dry FAIL</Chip>
                )}
                <Chip>ремонт: {scribe.res.rounds}</Chip>
                <Chip>sha {scribe.res.sha10.slice(0, 6)}</Chip>
              </div>
              {scribe.res.failedSlots.length > 0 ? (
                <p className="text-xs text-rose-300">
                  Не написаны: P{scribe.res.failedSlots.join(', P')} — черновик нельзя сдавать, нужен ручной проход.
                </p>
              ) : null}
              <div className="space-y-1">
                {scribe.res.receipts
                  .filter((r) => r.verdict !== 'PASS')
                  .slice(0, 6)
                  .map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <Mono>{r.gate}</Mono>
                      <LevelBadge level={r.level} />
                      <VerdictBadge verdict={r.verdict} />
                      <span>{r.findings.slice(0, 2).join(' · ')}</span>
                    </div>
                  ))}
              </div>
              {scribe.res.hardPass && scribe.res.failedSlots.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => deliverOfficial(scribe.res!.slug)}
                    className="h-9 bg-emerald-600 text-zinc-50 hover:bg-emerald-500"
                  >
                    <Stamp className="mr-1 size-3.5" />
                    Сдать официально
                  </Button>
                  <span className="text-[11px] text-zinc-500">
                    Официальный прогон гейтов + мета + ворклог + batch.delivered. Или сначала полируй — файл уже в «Батчах».
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  Черновик записан в «Батчи». Хард-фейлы — в квитанциях выше: правь файл или зови Super Z.
                </p>
              )}
            </div>
          ) : null}
          {deliverNote ? (
            <p className="mt-3 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-300">
              {deliverNote}
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Батчи                                                          */
/* ------------------------------------------------------------------ */

const QUICK_VERDICTS = [
  { id: 'fire', label: '🔥 Огонь', tone: 'emerald' as const },
  { id: 'good', label: '👍 Хорош', tone: 'amber' as const },
  { id: 'fixes', label: '🩹 Правки', tone: 'amber' as const },
  { id: 'weak', label: '💀 Слабо', tone: 'rose' as const },
]

const QUICK_ISSUES = [
  'ниша не читается',
  'геометрия поехала',
  'скатилось в волт',
  'милф-штамп',
  'позы скучные',
  'счёт слотов',
  'тема не видна',
]

function QuickVerdict({ slug }: { slug: string }) {
  const [verdict, setVerdict] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  function toggleIssue(x: string) {
    setIssues((cur) => (cur.includes(x) ? cur.filter((i) => i !== x) : [...cur, x]))
  }

  async function submit() {
    if (busy || !verdict) return
    setBusy(true)
    setNote(null)
    const vLabel = QUICK_VERDICTS.find((v) => v.id === verdict)?.label ?? verdict
    const prose = [text.trim(), issues.length > 0 ? `Проблемы: ${issues.join(', ')}.` : '']
      .filter(Boolean)
      .join('\n\n')
    try {
      await postJson(
        '/api/t4/events',
        {
          type: 'render.verdict',
          summary: `${slug}: ${vLabel}${issues.length > 0 ? ` · ${issues.join(', ')}` : ''}${text.trim() ? ` — ${text.trim().slice(0, 90)}` : ''}`,
          data: { slug, verdict, tags: issues, prose, source: 'author-batch' },
        },
        commanderHeaders()
      )
      setNote('Вердикт записан в лог — он кормит правки закона и вкус.')
      setVerdict(null)
      setIssues([])
      setText('')
    } catch (e) {
      setNote(ledgerWriteError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={`Вердикт по ${slug}`} icon={<Heart className="size-4" />}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-zinc-500">
          Один клик — и вердикт в логе событий: он кодируется в право (T4-02 уже стал законом 24 слотов).
        </p>
        {getCommanderKey() === '' ? (
          <p className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/80">
            ключ командира не сохранён в этом браузере — запись залочена (403). Один раз сохрани его
            в Стекле → «Ключ командира», и эта кнопка оживёт.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {QUICK_VERDICTS.map((v) => (
            <button
              key={v.id}
              onClick={() => setVerdict(verdict === v.id ? null : v.id)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                verdict === v.id
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ISSUES.map((x) => (
            <button
              key={x}
              onClick={() => toggleIssue(x)}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] transition-colors',
                issues.includes(x)
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
              )}
            >
              {x}
            </button>
          ))}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Детали — как видишь: «на P07 колесо поехало», «Lyn лучше всех»…"
          className="min-h-20 border-zinc-800 bg-zinc-950 text-sm"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={submit}
            disabled={busy || !verdict}
            className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy ? 'Записываю…' : 'Записать вердикт'}
          </Button>
          {note ? <span className="text-xs text-zinc-400">{note}</span> : null}
        </div>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Батчи — просмотр файла + сравнение A↔B (webDevReview #2)        */
/* ------------------------------------------------------------------ */

type BatchRow = { slug: string; title: string; date: string }

interface BatchDetailData {
  slug: string
  title: string
  markdown: string
  receipts: { gate: string; level: string; verdict: string; findings: string[] }[]
}

/** Кнопка-копия с честной обратной связью (галочка 1.2с). */
function CopyBtn({ text, label, title }: { text: string; label: string; title: string }) {
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

function BatchesTab() {
  const list = useApi<{ items: BatchRow[] }>('/api/t4/batches')
  const [mode, setMode] = useState<'view' | 'compare'>('view')
  /* ленивый инициализатор (не эффект): вкладка монтируется ПОСЛЕ события
   *  глубокой навигации — sticky-намерение уже лежит в шине, батч открыт */
  const [slug, setSlug] = useState<string | null>(() => pendingSlotNav()?.slug ?? null)
  const [query, setQuery] = useState('')
  const [aSlug, setASlug] = useState('')
  const [bSlug, setBSlug] = useState('')
  const detail = useApi<BatchDetailData>(slug ? `/api/t4/batches/${slug}` : null)
  /* живой подписчик: радар кликнут при смонтированной вкладке — открываем
   *  батч прямо здесь (setState в обработчике события, не в теле эффекта) */
  useEffect(() => {
    const off = subscribeSlotNav((intent) => {
      setMode('view')
      setSlug(intent.slug)
    })
    return off
  }, [])
  /* «/» — фокус в поиск, классика; слушатель живёт только пока вкладка смонтирована */
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = list.data?.items ?? []
  const receipts = detail.data?.receipts ?? []

  /* Преемник Фреда, 2026-10-10: 29+ батчей — поиск по слагу/теме быстрее
   *  скролла; искомый батч подсвечивается, выбор не сбрасывается. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return items
    return items.filter(
      (b) => b.slug.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)
    )
  }, [items, query])

  /* Ленивый дефолт пары вместо эффекта (реакт-линт: без setState в эффекте):
   * пустая пара = два последних батча, старее → новее; сегодня это ровно
   * T4-27 ↔ T4-27.2-EXP, живой вопрос H13. */
  const effA = aSlug !== '' ? aSlug : items.length >= 2 ? items[1].slug : (items[0]?.slug ?? '')
  const effB = bSlug !== '' ? bSlug : items.length >= 2 ? items[0].slug : ''

  function onRowClick(s: string) {
    if (mode === 'view') {
      setSlug(slug === s ? null : s)
      return
    }
    if (aSlug === '') setASlug(s)
    else if (bSlug === '') setBSlug(s)
    else setBSlug(s)
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Батчи"
        icon={<FileText className="size-4" />}
        action={
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5" role="tablist" aria-label="Режим вкладки Батчи">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'view'}
              onClick={() => setMode('view')}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors',
                mode === 'view'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              Просмотр
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'compare'}
              onClick={() => setMode('compare')}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors',
                mode === 'compare'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              Сравнение A↔B
            </button>
          </div>
        }
      >
        {list.loading ? (
          <SkeletonBlock lines={3} />
        ) : items.length === 0 ? (
          <EmptyState title="Батчей пока нет" hint="Собери контракт во вкладке «Сборка» и жми «Писец» — черновик появится здесь с квитанциями гейтов." />
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600 transition-colors focus-within:text-amber-400/60" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Поиск: слаг или тема · ${items.length} батчей…`}
                title="«/» — фокус в поиск"
                className="h-8 border-zinc-800 bg-zinc-950 pl-8 pr-10 text-xs transition-colors focus-visible:border-amber-500/50"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[10px] leading-4 text-zinc-500">
                /
              </kbd>
            </div>
            {mode === 'compare' ? (
              <p className="px-1 text-[11px] leading-relaxed text-zinc-600">
                клик по батчу заполняет пару: сначала <span className="text-amber-300/80">A (база)</span>, затем{' '}
                <span className="text-amber-300/80">B (перестройка)</span>; дальше клики заменяют B.
              </p>
            ) : null}
            {/* minmax(0,1fr): колонка не раздувается под самую широкую строку —
                * иначе «T4-27.2-EXP + EXP-путь + дата» на 390px раскачивает страницу
                * вбок на 5px (QA webDevReview #3, мобильный обход). */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
              {visible.map((b) => (
                <button
                  key={b.slug}
                  onClick={() => onRowClick(b.slug)}
                  className={cn(
                    'group/batch flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left outline-none transition-colors',
                    mode === 'view' && slug === b.slug
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : mode === 'compare' && (effA === b.slug || effB === b.slug)
                        ? 'border-amber-500/50 bg-amber-500/10'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 focus-visible:border-amber-500/50'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Mono>{b.slug}</Mono>
                    <span className="truncate text-xs text-zinc-300 transition-colors group-hover/batch:text-zinc-100">{b.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {mode === 'compare' && effA === b.slug ? (
                      <Chip tone="amber">A</Chip>
                    ) : mode === 'compare' && effB === b.slug ? (
                      <Chip tone="emerald">B</Chip>
                    ) : null}
                    {!b.date ? (
                      <span title="EXP-путь: без гейт-доставки — даты нет (прецедент T4-20.x)">
                        <Chip tone="amber">EXP-путь</Chip>
                      </span>
                    ) : null}
                    <span
                      className="whitespace-nowrap text-[11px] tabular-nums text-zinc-600 transition-colors group-hover/batch:text-zinc-400"
                      title={b.date ? `${b.slug} · доставлен ${b.date}` : `${b.slug} · EXP-путь без даты`}
                    >
                      {formatDate(b.date) || '—'}
                    </span>
                  </span>
                </button>
              ))}
              {visible.length === 0 ? (
                <p className="px-1 py-3 text-center text-xs text-zinc-600">
                  ничего не нашлось — «{query.trim()}» ни в одном слаге/теме
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Panel>

      {mode === 'view' && slug ? (
        <>
          {receipts.length > 0 ? (
            <Panel title={`Гейты · ${slug}`} icon={<Activity className="size-4" />}>
              <div className="space-y-1.5">
                {receipts.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    <Mono>{r.gate}</Mono>
                    <LevelBadge level={r.level} />
                    <VerdictBadge verdict={r.verdict} />
                    {r.findings.slice(0, 3).map((f, j) => (
                      <span key={j} className="text-[11px] text-zinc-500">{f}</span>
                    ))}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel title={`Файл · ${slug}`} icon={<ScrollText className="size-4" />} bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll">
            {detail.loading ? (
              <SkeletonBlock lines={10} />
            ) : detail.error ? (
              <ErrorNote text="Батч недоступен" />
            ) : (
              <MarkdownView>{detail.data?.markdown ?? ''}</MarkdownView>
            )}
          </Panel>
          {/* key=slug: трекер рендера перемонтируется на смену батча — ленивый
           *  инициализатор перечитает свой localStorage без запрещённого
           *  set-state-in-effect. */}
          {detail.data && !detail.loading ? (
            <SlotStrip key={slug} slug={slug ?? ''} markdown={detail.data.markdown} />
          ) : null}
          <QuickVerdict slug={slug} />
        </>
      ) : null}

      {mode === 'compare' ? (
        <BatchCompare items={items} a={effA} b={effB} onA={setASlug} onB={setBSlug} loading={list.loading} />
      ) : null}
    </div>
  )
}

/* -------- Слоты: полоса рендера (трекер + копирование + манифест) ------ */

/** Черновая workflows-память: как приёмник батча и VLM-журнал, живёт в
 *  localStorage браузера. Летопись не трогаем — «слот отрендерен» не событие
 *  ядра, это счётчик руки автора. Ключ — по слагу батча. */
function loadRenderProgress(slug: string): string[] {
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
function saveRenderProgress(slug: string, ids: string[]) {
  window.localStorage.setItem(`t4-render-progress-${slug}`, JSON.stringify(ids))
}

/* -------- Глубокая навигация «радар → слот» (шина t4/nav) ----------- */

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

function SlotStrip({ slug, markdown }: { slug: string; markdown: string }) {
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

/* -------- Сравнение A↔B: послотовый дифф двух батчей ------------------ */

function BatchCompare({
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
/* Tab: События                                                        */
/* ------------------------------------------------------------------ */

function EventsTab() {
  const { data, error, loading } = useApi<{ events: { id: string; at: string; type: string; summary: string }[] }>(
    '/api/t4/events?limit=200'
  )
  const [typeFilter, setTypeFilter] = useState('')
  const [query, setQuery] = useState('')

  const events = data?.events ?? []

  /* Преемник Фреда, 2026-10-10: типы со счётчиками — летопись длинная,
   *  а вердикты/события батчей автор ищет по делу, а не скроллом. */
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [events])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      if (typeFilter !== '' && e.type !== typeFilter) return false
      if (q !== '' && !e.summary.toLowerCase().includes(q) && !e.id.toLowerCase().includes(q)) return false
      return true
    })
  }, [events, typeFilter, query])

  /* Точка таймлайна красится по типу — как TypeBadge: вердикт=роза,
   *  гейт=изумруд, батч=амбер, закон=цинк, внешка=тил. */
  const dotTone = (type: string): string => {
    const t = type.toLowerCase()
    if (t.includes('verdict')) return 'bg-rose-500'
    if (t.includes('gate')) return 'bg-emerald-500'
    if (t.includes('batch')) return 'bg-amber-500'
    if (t.includes('law')) return 'bg-zinc-400'
    if (t.includes('external')) return 'bg-teal-400'
    return 'bg-zinc-500'
  }

  return (
    <Panel title="Лог событий (append-only)" icon={<History className="size-4" />} bodyClassName="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по летописи: слаг, слово, id события…"
            className="h-8 border-zinc-800 bg-zinc-950 pl-8 text-xs"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Фильтр по типу события"
          className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none transition-colors hover:border-zinc-700 focus-visible:border-amber-500/50"
        >
          <option value="">все типы · {events.length}</option>
          {typeCounts.map(([t, n]) => (
            <option key={t} value={t}>
              {t} · {n}
            </option>
          ))}
        </select>
        {typeFilter !== '' || query.trim() !== '' ? (
          <button
            onClick={() => {
              setTypeFilter('')
              setQuery('')
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            сбросить · {filtered.length}
          </button>
        ) : null}
      </div>
      {loading ? (
        <SkeletonBlock lines={8} />
      ) : error ? (
        <ErrorNote text="Лог недоступен" hint="ядро ещё не подключено" />
      ) : events.length === 0 ? (
        <EmptyState title="Событий пока нет" hint="Первое событие — рождение эпохи — в log.jsonl." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Ничего не нашлось" hint="Смени фильтр или запрос — летопись append-only, ничего не пропало." />
      ) : (
        <div className="t4-scroll max-h-[70vh] overflow-y-auto">
          <div className="relative space-y-0 pl-4">
            <div className="absolute bottom-2 left-[7px] top-2 w-px bg-zinc-800" />
            {filtered.map((e, i) => (
              <div key={e.id ?? i} className="relative rounded-sm py-2.5 pl-5 pr-2 transition-colors hover:bg-zinc-900/40">
                <span className={cn('absolute left-[-2px] top-[15px] size-[9px] rounded-full border-2 border-zinc-950', dotTone(e.type))} />
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={e.type} />
                  <span className="font-mono text-[10px] text-zinc-700">{e.id}</span>
                  <span className="text-xs text-zinc-600">{formatDate(e.at)}</span>
                </div>
                <div className="mt-1 text-sm leading-relaxed text-zinc-300">{e.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Вердикты (форма автора + VLM first-pass)                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Tab: Вердикты — VLM первый проход (шаг 1) + Приёмник батча (шаг 2)  */
/* ------------------------------------------------------------------ */

interface ContractSlot {
  position: number
  kind: string
  rating: string
  pose: string
  poseName: string
  lead: string
  oc?: string
  race?: string
  ab?: { pair: string; half: string; withSlot: number; lead: string }
  exploratory?: string
}

interface ContractPayload {
  slug: string
  theme: string
  contract: { slots?: ContractSlot[] } | null
  /** Фред, 2026-10-08: фолбэк-контракт, синтезированный из шапок слотов батча
   *  (RAW/EXP живут без contracts/T4-NN.json). */
  synthesized?: boolean
}

/** Слепая структурная карточка (§10-поправка: машине не показывается заявка). */
interface BlindCard {
  scene?: string
  character?: string
  clothing?: string
  fabric_state?: string
  underlayer?: string
  pose?: string
  signals?: string[]
  nipple_read?: string
  mutation_drift?: string[]
  camera?: string
  light?: string
  rating_hint?: string
  notes?: string
}

type VlmFlag = 'ok' | 'mutation' | 'drift' | 'skipped'

interface JournalEntry {
  position: string
  flag: VlmFlag | ''
  tierHint: string
  drift: number
  ts: string
}

interface DraftSlot {
  myTier: string
  yodayoTier: string
  ph: string
  vlmFlag: VlmFlag | ''
  phText: string
  note: string
  tierHint?: string // ориентир VLM (не вердикт; принимается кнопкой автора)
  rolls?: string // число перекидок (roll-journal, аудит RC-4a)
  settings?: string // CFG/sampler/веса — факторы блока 10
  genreRead?: string // NICHE: жанр прочитан? (yes | no)
  wow?: string // NICHE: вау? (yes | no)
}

interface ReceiverDraft {
  slots: Record<string, DraftSlot>
  prose: string
  updatedAt: string
}

const TIER_OPTIONS = ['PG-13', 'R', 'R+', 'X'] as const
const PH_OPTIONS = ['PH', 'Raw', 'A', 'B'] as const
const VLM_FLAG_LABEL: Record<string, string> = {
  ok: 'ок',
  mutation: 'мутация',
  drift: 'дрейф',
  skipped: 'не прогонял',
}

function emptyDraftSlot(): DraftSlot {
  return { myTier: '', yodayoTier: '', ph: '', vlmFlag: '', phText: '', note: '', tierHint: '', rolls: '', settings: '', genreRead: '', wow: '' }
}

/** Авто-PH (приказ автора 2026-09-24): конвейер всегда PH ON — new slots
 *  рождаются с ph='PH', автор вправе поменять на Raw/A/B. */
function seededDraftSlot(): DraftSlot {
  return { ...emptyDraftSlot(), ph: 'PH' }
}

/** Угадывает слот по имени файла: P05, p12-, 07_… (аудит N/A: автору —
 *  кучей кидать, а не по одному; не угадано — назначается руками). */
function guessPosition(name: string): string {
  const m1 = /(?:^|[^a-z\d])p(\d{1,2})(?:[^a-z\d]|$)/i.exec(name)
  if (m1) {
    const n = parseInt(m1[1], 10)
    if (n >= 1 && n <= 24) return `P${String(n).padStart(2, '0')}`
  }
  const m2 = /^0?(\d{1,2})[-_.\s]/.exec(name.trim())
  if (m2) {
    const n = parseInt(m2[1], 10)
    if (n >= 1 && n <= 24) return `P${String(n).padStart(2, '0')}`
  }
  return ''
}

function readDraft(slug: string): ReceiverDraft {
  if (typeof window === 'undefined' || !slug) return { slots: {}, prose: '', updatedAt: '' }
  try {
    const raw = window.localStorage.getItem(`t4-receiver-draft-${slug}`)
    if (raw) {
      const parsed = JSON.parse(raw) as ReceiverDraft
      return { slots: parsed.slots ?? {}, prose: parsed.prose ?? '', updatedAt: parsed.updatedAt ?? '' }
    }
  } catch {
    /* битый черновик = новый черновик */
  }
  return { slots: {}, prose: '', updatedAt: '' }
}

function writeDraft(slug: string, draft: ReceiverDraft) {
  if (typeof window === 'undefined' || !slug) return
  draft.updatedAt = new Date().toISOString()
  window.localStorage.setItem(`t4-receiver-draft-${slug}`, JSON.stringify(draft))
  window.dispatchEvent(new CustomEvent('t4-receiver-updated', { detail: { slug } }))
}

function readJournal(slug: string): JournalEntry[] {
  if (typeof window === 'undefined' || !slug) return []
  try {
    const raw = window.localStorage.getItem(`t4-vlm-journal-${slug}`)
    if (raw) return (JSON.parse(raw) as JournalEntry[]) ?? []
  } catch {
    /* пусто */
  }
  return []
}

function writeJournal(slug: string, entries: JournalEntry[]) {
  if (typeof window === 'undefined' || !slug) return
  window.localStorage.setItem(`t4-vlm-journal-${slug}`, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent('t4-receiver-updated', { detail: { slug } }))
}

const TIER_ORDER_MAP: Record<string, number> = TIER_RANK

function tierDeltaIcon(a: string, b: string): string {
  const va = TIER_ORDER_MAP[a]
  const vb = TIER_ORDER_MAP[b]
  if (va === undefined || vb === undefined) return ''
  if (va > vb) return '↑'
  if (va < vb) return '↓'
  return '='
}

/** Уменьшает картинку до ≤1024px JPEG — VLM не нужен оригинал. */
function shrinkImage(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('read failed'))
    fr.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const max = 1024
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(String(fr.result))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(fr.result)
    }
    fr.readAsDataURL(file)
  })
}

/* ------------------------------------------------------------------ */
/* Панель 1: VLM первый проход (слепой структурный фильтр)             */
/* ------------------------------------------------------------------ */

/** Элемент очереди «Куча» (пересобрано 2026-09-24: прежняя версия погибла
 *  с контейнером 23.09 — чемодан 4.0 был упакован до её постройки). */
interface QueueItem {
  id: string
  name: string
  dataUrl: string
  position: string // 'P05' | '' — слот для вшивания в приёмник
  status: 'pending' | 'running' | 'done' | 'blocked' | 'error'
  card?: BlindCard
  flag: VlmFlag | ''
  autoFlagged: boolean
  error?: string
}

/** Автофлаг структурного провала ДО глаза автора (внешний вердикт №3):
 *  мутации → mutation; ориентир VLM ниже заявки → drift; иначе ок.
 *  Флаг — предложение, автор вправе перекрыть. Тир он ставит сам. */
function autoFlagFor(card: BlindCard, claim: string): VlmFlag | '' {
  const driftCount = Array.isArray(card.mutation_drift) ? card.mutation_drift.length : 0
  if (driftCount > 0) return 'mutation'
  const order: Record<string, number> = TIER_RANK
  const hintKey = (card.rating_hint ?? '').trim().replace('RPLUS', 'R+')
  const hint = order[hintKey]
  const cl = order[claim]
  if (hint !== undefined && cl !== undefined) return hint < cl ? 'drift' : 'ok'
  return ''
}

/* author-vision (Залп 3): глаз автора — основной канал вердикта
   (вердикт автора №4, 2026-09-26: VLM слеп, баланс — опция на потом) */
function AuthorVisionRow({ slug }: { slug: string }) {
  const [tier, setTier] = useState<string>('R+')
  const [pos, setPos] = useState<string>('')
  const [note, setNote] = useState('')
  const [confidence, setConfidence] = useState<'direct' | 'described'>('direct')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  async function submit() {
    if (busy || !slug) return
    setBusy(true)
    setDone('')
    try {
      await postJson(
        '/api/t4/events',
        {
          type: 'render.verdict',
          summary: `${slug}${pos.trim() ? ` ${pos.trim().toUpperCase()}` : ''}: ${tier} — author-vision (${confidence})${note.trim() ? ` · ${note.trim().slice(0, 80)}` : ''}`,
          data: {
            slug,
            verdict: tier,
            position: pos.trim() ? pos.trim().toUpperCase() : undefined,
            prose: note.trim(),
            source: 'author',
            confidence,
          },
        },
        commanderHeaders()
      )
      setDone(`вердикт записан (source=author, ${confidence}) — летопись видит твой глаз`)
      setNote('')
    } catch (e) {
      setDone(ledgerWriteError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-zinc-800/80 pt-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">
        Author-vision — основной канал вердикта
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Input
          value={pos}
          onChange={(e) => setPos(e.target.value)}
          placeholder="P07"
          className="h-7 w-20 text-xs"
        />
        {(['PG-13', 'R', 'R+', 'X'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
              tier === t
                ? 'border-amber-400 bg-amber-600/25 text-amber-200'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
            )}
          >
            {t}
          </button>
        ))}
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="что увидел — одной строкой"
          className="h-7 min-w-40 flex-1 text-xs"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
        >
          Записать вердикт
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[11px] text-zinc-500">уверенность:</span>
        {(
          [
            ['direct', 'direct — смотрел сейчас'],
            ['described', 'described — пересказ по памяти'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setConfidence(v)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
              confidence === v
                ? 'border-emerald-400 bg-emerald-600/20 text-emerald-200'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {done ? <p className="mt-1.5 text-[11px] text-emerald-400">{done}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Панель 0 (webDevReview #5): TRIAL-3 радар — законы и EXP-гипотезы   */
/* под вердиктом. Живой момент: T4-27 + T4-27.2-EXP закрывают M15-M20  */
/* → конституция; радар держит всю программу триала в одном месте —   */
/* статусы едят трекер рендера (Слоты) и записи приёмника (КУЧА ниже). */
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
       *  найти её без поиска (reduced-motion гасит через глобальный
       *  animate-pulse не гасится — потому своя проверка ниже) */}
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
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-zinc-500" title={half.thesis}>
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

function TrialRadarPanel() {
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
                    <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-zinc-500" title={l.note}>
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

function VlmFirstPassPanel() {
  const [slug, setSlug] = useState('')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flagNote, setFlagNote] = useState<string | null>(null)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [summaryNote, setSummaryNote] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [setupHint, setSetupHint] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const batches = useApi<{ items: { slug: string; title: string }[] }>('/api/t4/batches')
  const contract = useApi<ContractPayload>(slug ? `/api/t4/contracts/${slug}` : null)

  const items = batches.data?.items ?? []
  const slots = contract.data?.contract?.slots ?? []

  useEffect(() => {
    setJournal(readJournal(slug))
  }, [slug])

  useEffect(() => {
    const h = () => setJournal(readJournal(slug))
    window.addEventListener('t4-receiver-updated', h)
    return () => window.removeEventListener('t4-receiver-updated', h)
  }, [slug])

  // Ctrl+V скрином прямо с площадки — тоже в кучу
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (files.length > 0) void addFiles(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const journalFlags = journal.reduce<Record<string, number>>((acc, j) => {
    if (j.flag) acc[j.flag] = (acc[j.flag] ?? 0) + 1
    return acc
  }, {})
  const covered = new Set(journal.map((j) => j.position))
  const remaining = Math.max(0, slots.length - covered.size)
  const doneCount = queue.filter((q) => q.status === 'done' || q.status === 'blocked').length

  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length === 0) return
    setError(null)
    const added: QueueItem[] = []
    for (const f of imgs) {
      try {
        const dataUrl = await shrinkImage(f)
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.name,
          dataUrl,
          position: guessPosition(f.name),
          status: 'pending',
          flag: '',
          autoFlagged: false,
        })
      } catch {
        setError(`Не удалось прочитать ${f.name}`)
      }
    }
    if (added.length > 0) setQueue((q) => [...q, ...added])
  }

  function setItemFlag(id: string, flag: VlmFlag | '') {
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, flag, autoFlagged: false } : x)))
  }

  function setItemPosition(id: string, position: string) {
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, position } : x)))
  }

  function removeItem(id: string) {
    setQueue((q) => q.filter((x) => x.id !== id))
    if (selected === id) setSelected(null)
  }

  async function runQueue() {
    if (running) return
    const myRun = ++runIdRef.current
    setRunning(true)
    setError(null)
    setFlagNote(null)
    try {
      const pending = queue.filter((q) => q.status === 'pending' || q.status === 'error')
      for (const item of pending) {
        if (runIdRef.current !== myRun) return
        setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'running', error: undefined } : x)))
        try {
          const res = await postJson<{ ok: boolean; blocked?: boolean; message?: string; error?: string; card?: BlindCard }>(
            '/api/t4/feedback',
            { imageBase64: item.dataUrl, mimeType: 'image/jpeg', slug: slug.trim(), position: item.position, blind: true }
          )
          if (runIdRef.current !== myRun) return
          if (res.blocked) {
            // X-кадр: фильтр провайдера — слот неверифицируем машиной (мета-закон)
            setQueue((q) =>
              q.map((x) => (x.id === item.id ? { ...x, status: 'blocked', flag: x.flag || 'skipped', autoFlagged: true, error: res.message } : x))
            )
            continue
          }
          const card = res.card
          if (!card) {
            setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'error', error: res.error ?? 'пустая карточка' } : x)))
            continue
          }
          const claim = slots.find((s) => `P${String(s.position).padStart(2, '0')}` === item.position)?.rating ?? ''
          setQueue((q) =>
            q.map((x) => {
              if (x.id !== item.id) return x
              const flag = x.flag || autoFlagFor(card, claim)
              return { ...x, status: 'done', card, flag, autoFlagged: Boolean(flag) }
            })
          )
        } catch (e) {
          if (runIdRef.current !== myRun) return
          const msg = e instanceof Error ? e.message : 'VLM не ответил'
          // VLM не настроен (нет .z-ai-config): гасим всю очередь сразу —
          // иначе жжём по ошибке на каждый кадр (локальный запуск без ключа)
          const setup =
            (e instanceof ApiError && asRecord(e.payload).setupRequired === true) ||
            /Configuration file not found|z-ai-config/i.test(msg)
          if (setup) {
            setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'error', error: 'VLM не настроен' } : x)))
            setSetupHint(
              'VLM не поднят на этой машине: нет файла .z-ai-config (ключ Z.ai). Куча, авто-писец и VLM-прогоны оживут, как только ключ появится — всё остальное (гейты, приёмник, сдача) работает без него.'
            )
            return
          }
          // ключ жив, но на vision-модели (glm-4.5v) нет оплаченного баланса
          if (/Insufficient balance|no resource package|"code":"1113"/i.test(msg)) {
            setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, status: 'error', error: 'нет баланса на vision-модели' } : x)))
            setSetupHint(
              'Ключ Z.ai жив, но vision-модель (glm-4.5v) не оплачена на твоём счёте: пополни баланс в консоли z.ai — и Куча оживёт сама, без моего ведома. Пока — грейдь кадры в чате со мной: кидай картинки, я возвращаю структурные карточки.'
            )
            return
          }
          setQueue((q) =>
            q.map((x) => (x.id === item.id ? { ...x, status: 'error', error: msg } : x))
          )
        }
      }
    } finally {
      if (runIdRef.current === myRun) setRunning(false)
    }
  }

  /** Вшить всё прошедшее VLM в приёмник (приказ автора 2026-09-24):
   *  флаги + авто-PH + ориентир (myTier остаётся за глазом автора). */
  function fillReceiver() {
    if (!slug) return
    const draft = readDraft(slug)
    let n = 0
    for (const item of queue) {
      if (!item.position || (item.status !== 'done' && item.status !== 'blocked')) continue
      const d = draft.slots[item.position] ?? seededDraftSlot()
      if (item.status === 'blocked') {
        d.vlmFlag = 'skipped'
        d.note = (d.note ? `${d.note} · ` : '') + 'X — контент-фильтр, неверифицируем машиной'
      } else if (item.flag) {
        d.vlmFlag = item.flag
      }
      d.ph = d.ph || 'PH'
      d.tierHint = item.card?.rating_hint ?? d.tierHint ?? ''
      draft.slots[item.position] = d
      n += 1
      const entries = readJournal(slug).filter((j) => j.position !== item.position)
      entries.push({
        position: item.position,
        flag: (item.status === 'blocked' ? 'skipped' : item.flag) as VlmFlag | '',
        tierHint: item.card?.rating_hint ?? '',
        drift: Array.isArray(item.card?.mutation_drift) ? item.card.mutation_drift.length : 0,
        ts: new Date().toISOString(),
      })
      writeJournal(slug, entries)
    }
    writeDraft(slug, draft)
    setFlagNote(`Вшито в приёмник: ${n} слот(ов) — флаги + PH + ориентиры; тир ставишь ты.`)
  }

  async function writeSummary() {
    if (!slug || journal.length === 0) return
    setSummaryNote(null)
    try {
      await postJson(
        '/api/t4/events',
        {
          type: 'note',
          summary: `VLM-сводка ${slug}: прогонов ${journal.length}/${slots.length} — флаги: ок ${journalFlags.ok ?? 0} · мутация ${journalFlags.mutation ?? 0} · дрейф ${journalFlags.drift ?? 0} · не прогонял ${journalFlags.skipped ?? 0}${remaining > 0 ? ` · осталось ${remaining}` : ' · батч покрыт'}`,
          data: { slug, kind: 'vlm-summary', runs: journal.length, total: slots.length, flags: journalFlags, positions: journal.map((j) => j.position) },
        },
        commanderHeaders()
      )
      setSummaryNote('Сводка записана в лог событий (note).')
    } catch (e) {
      setSummaryNote(ledgerWriteError(e))
    }
  }

  const selectedItem = queue.find((q) => q.id === selected) ?? null
  const signals = Array.isArray(selectedItem?.card?.signals) ? selectedItem!.card!.signals : []
  const drift = Array.isArray(selectedItem?.card?.mutation_drift) ? selectedItem!.card!.mutation_drift : []

  return (
    <Panel title="VLM первый проход — КУЧА (шаг 1 воркфлоу)" icon={<ScanEye className="size-4" />}>
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-zinc-500">
          Кидай ВСЕ кадры сразу — дроп пачкой, клик или Ctrl+V. Очередь прогонит каждый вслепую, слоты
          расставятся по именам файлов (P05, 07-…), структурные провалы авто-отметятся (мутации/дрейф —
          внешний вердикт №3). Слепой протокол: машине НЕ показывается заявка слота;{' '}
          <span className="text-amber-300">вердикт по эротике выносит только глаз автора</span> (мета-закон
          T4-03). X-кадры машина не верифицирует в принципе (фильтр провайдера, 400/1301) — авто-флаг
          «не прогонял». Потом «Вшить в приёмник»: флаги + PH + ориентиры уедут сами, тир ставишь ты.
        </p>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void addFiles(Array.from(e.dataTransfer.files ?? []))
            }}
            className={cn(
              'flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs transition-colors',
              dragOver
                ? 'border-amber-500/70 bg-amber-500/10 text-amber-200'
                : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-amber-500/40 hover:text-amber-200'
            )}
            onClick={() => document.getElementById('vlm-first-file')?.click()}
            role="button"
            aria-label="Кинуть рендеры кучей: дроп, клик или Ctrl+V"
          >
            <input
              id="vlm-first-file"
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []))
                e.currentTarget.value = ''
              }}
            />
            <Upload className="size-3.5" />
            {queue.length > 0 ? `В очереди ${queue.length} кадр(ов) — можно добавить ещё` : 'Кинь кадры КУЧЕЙ: дроп, клик или Ctrl+V'}
          </div>
          <select
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setFlagNote(null)
            }}
            className="h-10 w-full min-w-0 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
            aria-label="Батч"
          >
            <option value="">— батч —</option>
            {items.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.slug} · {b.title}
              </option>
            ))}
          </select>
        </div>

        {setupHint ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
            {setupHint}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        {queue.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={runQueue}
                disabled={running || Boolean(setupHint) || queue.every((q) => q.status !== 'pending' && q.status !== 'error')}
                className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
              >
                {running
                  ? 'Слепые прогоны идут…'
                  : `Прогнать всё вслепую (${queue.filter((q) => q.status === 'pending' || q.status === 'error').length})`}
              </Button>
              <Button
                onClick={fillReceiver}
                disabled={!slug || doneCount === 0}
                variant="outline"
                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
              >
                Вшить в приёмник ({doneCount}){slug ? '' : ' — выбери батч'}
              </Button>
              <button
                onClick={() => {
                  setQueue([])
                  setSelected(null)
                }}
                className="text-[11px] text-zinc-500 transition-colors hover:text-rose-300"
              >
                очистить очередь
              </button>
            </div>
            {flagNote ? <p className="text-[11px] text-emerald-400">{flagNote}</p> : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {queue.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  className={cn(
                    'cursor-pointer rounded-md border p-1.5 transition-colors',
                    selected === item.id
                      ? 'border-amber-500/70 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                  )}
                >
                  <div className="relative">
                    <img src={item.dataUrl} alt={item.name} className="h-28 w-full rounded object-cover" />
                    {item.status === 'running' ? (
                      <span className="absolute inset-0 flex items-center justify-center rounded bg-zinc-950/70 text-[10px] text-amber-300">
                        прогон…
                      </span>
                    ) : null}
                    {item.status === 'blocked' ? (
                      <span className="absolute inset-x-1 top-1 rounded bg-rose-950/85 px-1 py-0.5 text-center text-[9px] text-rose-200">
                        X-фильтр · не прогонял
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <select
                      value={item.position}
                      onChange={(e) => setItemPosition(item.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 w-full rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-300"
                      aria-label={`Слот для ${item.name}`}
                    >
                      <option value="">— слот? —</option>
                      {(slots.length > 0
                        ? slots.map((s) => `P${String(s.position).padStart(2, '0')}`)
                        : Array.from({ length: 24 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
                      ).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <select
                      value={item.flag}
                      onChange={(e) => setItemFlag(item.id, e.target.value as VlmFlag | '')}
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 w-full rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-300"
                      aria-label={`Флаг для ${item.name}`}
                    >
                      <option value="">— флаг? —</option>
                      {(['ok', 'mutation', 'drift', 'skipped'] as const).map((f) => (
                        <option key={f} value={f}>
                          {VLM_FLAG_LABEL[f]}
                          {item.autoFlagged && item.flag === f ? ' (авто)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          'text-[9px]',
                          item.status === 'done'
                            ? 'text-emerald-400/80'
                            : item.status === 'error'
                              ? 'text-rose-400'
                              : 'text-zinc-600'
                        )}
                      >
                        {item.status === 'error' ? 'ошибка' : item.status === 'pending' ? 'ждёт' : item.status === 'done' ? item.card?.rating_hint || 'прогон' : item.status}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeItem(item.id)
                        }}
                        className="text-[9px] text-zinc-600 hover:text-rose-300"
                        aria-label="убрать из очереди"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {selectedItem ? (
              <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                    {selectedItem.position || '— слот не назначен'} · структурная карточка — факт, не вердикт
                  </p>
                  {selectedItem.position && slots.find((s) => `P${String(s.position).padStart(2, '0')}` === selectedItem.position) ? (
                    <span className="text-[11px] text-amber-200/80">
                      Заявка (видишь только ты):{' '}
                      <span className="font-mono">
                        {slots.find((s) => `P${String(s.position).padStart(2, '0')}` === selectedItem.position)!.rating}
                      </span>{' '}
                      · LEAD {slots.find((s) => `P${String(s.position).padStart(2, '0')}` === selectedItem.position)!.lead}
                    </span>
                  ) : null}
                </div>
                {selectedItem.error ? (
                  <p className="text-[11px] text-rose-300">{selectedItem.error}</p>
                ) : null}
                {selectedItem.card ? (
                  <>
                    <dl className="grid gap-2 text-xs sm:grid-cols-2">
                      {[
                        ['Сцена', selectedItem.card.scene],
                        ['Персонаж', selectedItem.card.character],
                        ['Одежда + ткань', `${selectedItem.card.clothing ?? '—'} [${selectedItem.card.fabric_state ?? '?'}]`],
                        ['Подслой', selectedItem.card.underlayer],
                        ['Поза', selectedItem.card.pose],
                        ['Камера', selectedItem.card.camera],
                        ['Свет', selectedItem.card.light],
                        ['Сосок', selectedItem.card.nipple_read],
                      ].map(([k, v]) => (
                        <div key={String(k)} className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1.5">
                          <dt className="text-[10px] uppercase tracking-wider text-zinc-600">{k}</dt>
                          <dd className="mt-0.5 leading-snug text-zinc-300">{v || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                    {signals.length > 0 ? (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">Видимые сигналы</p>
                        <div className="flex flex-wrap gap-1.5">
                          {signals.map((s, i) => (
                            <Chip key={i} tone="amber">
                              {s}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {drift.length > 0 ? (
                      <ul className="space-y-0.5 text-[11px] text-rose-300/90">
                        {drift.slice(0, 6).map((d, i) => (
                          <li key={i}>— {d}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
                      <span className="text-xs text-zinc-500">Тир-ориентир:</span>
                      <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                        {selectedItem.card.rating_hint ?? '—'}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        не вердикт — VLM слеп к тирам в обе стороны (завышал 8/12, занижал до PG-13)
                      </span>
                    </div>
                    {selectedItem.card.notes ? (
                      <p className="text-xs leading-relaxed text-zinc-400">{selectedItem.card.notes}</p>
                    ) : null}
                  </>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
                  <span className="text-xs text-zinc-500">Сравнил с заявкой → флаг:</span>
                  {(['ok', 'mutation', 'drift', 'skipped'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setItemFlag(selectedItem.id, f)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        selectedItem.flag === f
                          ? f === 'ok'
                            ? 'border-emerald-400 bg-emerald-600/25 text-emerald-200'
                            : f === 'skipped'
                              ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                              : 'border-rose-400 bg-rose-500/25 text-rose-200'
                          : f === 'ok'
                            ? 'border-emerald-600/50 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20'
                            : f === 'skipped'
                              ? 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                              : 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                      )}
                    >
                      {VLM_FLAG_LABEL[f]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {slug && slots.length > 0 ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                Журнал прогона · {slug}: {journal.length}/{slots.length}
              </p>
              <button
                onClick={writeSummary}
                disabled={journal.length === 0}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
              >
                Записать сводку в лог
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tone="emerald">ок {journalFlags.ok ?? 0}</Chip>
              <Chip tone="rose">мутация {journalFlags.mutation ?? 0}</Chip>
              <Chip tone="rose">дрейф {journalFlags.drift ?? 0}</Chip>
              <Chip>не прогонял {journalFlags.skipped ?? 0}</Chip>
              <Chip tone="amber">осталось {remaining}</Chip>
            </div>
            {journal.length > 0 ? (
              <div className="mt-2 max-h-28 space-y-0.5 overflow-y-auto t4-scroll">
                {[...journal]
                  .sort((a, b) => a.position.localeCompare(b.position))
                  .map((j) => (
                    <p key={j.position + j.ts} className="text-[11px] text-zinc-500">
                      <span className="font-mono text-zinc-400">{j.position}</span> ·{' '}
                      {VLM_FLAG_LABEL[j.flag] ?? '—'}
                      {j.tierHint ? ` · ориентир ${j.tierHint}` : ''}
                      {j.drift > 0 ? ` · дрейф ${j.drift}` : ''}
                    </p>
                  ))}
              </div>
            ) : null}
            {summaryNote ? <p className="mt-2 text-[11px] text-emerald-400">{summaryNote}</p> : null}
            {slug ? <AuthorVisionRow slug={slug} /> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Панель 2: Приёмник батча — одна запись на батч                      */
/* ------------------------------------------------------------------ */

interface BatchVerdictRecord {
  id: string
  at: string
  slug: string
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

function BatchReceiverPanel() {
  const [slug, setSlug] = useState('')
  const [draft, setDraft] = useState<ReceiverDraft>({ slots: {}, prose: '', updatedAt: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [curlCopied, setCurlCopied] = useState(false)
  const batches = useApi<{ items: { slug: string; title: string }[] }>('/api/t4/batches')
  const contract = useApi<ContractPayload>(slug ? `/api/t4/contracts/${slug}` : null)
  const records = useApi<{ records: BatchVerdictRecord[] }>('/api/t4/batch-verdict')

  const items = batches.data?.items ?? []
  const slots = contract.data?.contract?.slots ?? []

  useEffect(() => {
    setDraft(readDraft(slug))
  }, [slug])

  // авто-PH (приказ автора 2026-09-24): строки приёмника рождаются с ph='PH',
  // автор вправе поменять на Raw/A/B в любой момент
  const seededSlugRef = useRef('')
  useEffect(() => {
    if (!slug || slots.length === 0 || seededSlugRef.current === slug) return
    seededSlugRef.current = slug
    const d = readDraft(slug)
    let changed = false
    for (const s of slots) {
      const p = `P${String(s.position).padStart(2, '0')}`
      if (!d.slots[p]) {
        d.slots[p] = seededDraftSlot()
        changed = true
      }
    }
    if (changed) {
      writeDraft(slug, d)
      setDraft(readDraft(slug))
    }
  }, [slug, slots])

  useEffect(() => {
    function h(e: Event) {
      const detail = (e as CustomEvent<{ slug: string }>).detail
      if (!detail?.slug || detail.slug === slug) setDraft(readDraft(slug))
    }
    window.addEventListener('t4-receiver-updated', h)
    return () => window.removeEventListener('t4-receiver-updated', h)
  }, [slug])

  function slotDraft(position: string): DraftSlot {
    return draft.slots[position] ?? emptyDraftSlot()
  }

  function updateSlot(position: string, patch: Partial<DraftSlot>) {
    // next вычисляется вне апдейтера: writeDraft диспатчит событие, а
    // побочные эффекты внутри setDraft-рендера роняют React
    const next: ReceiverDraft = {
      ...draft,
      slots: {
        ...draft.slots,
        [position]: { ...emptyDraftSlot(), ...draft.slots[position], ...patch },
      },
    }
    writeDraft(slug, next)
    setDraft(next)
  }

  // скорборд на лету
  const live = useMemo(() => {
    const claimed: Record<string, number> = {}
    const delivered: Record<string, number> = {}
    let up = 0
    let down = 0
    let pUp = 0
    let pDown = 0
    let filled = 0
    for (const s of slots) {
      const p = `P${String(s.position).padStart(2, '0')}`
      if (s.rating) claimed[s.rating] = (claimed[s.rating] ?? 0) + 1
      const d = slotDraft(p)
      if (d.myTier) {
        filled += 1
        delivered[d.myTier] = (delivered[d.myTier] ?? 0) + 1
        const dc = TIER_ORDER_MAP[d.myTier] - TIER_ORDER_MAP[s.rating]
        if (dc > 0) up += 1
        else if (dc < 0) down += 1
        if (d.yodayoTier) {
          const dp = TIER_ORDER_MAP[d.myTier] - TIER_ORDER_MAP[d.yodayoTier]
          if (dp > 0) pUp += 1
          else if (dp < 0) pDown += 1
        }
      }
    }
    return { claimed, delivered, up, down, pUp, pDown, filled }
  }, [slots, draft])

  function buildPayload() {
    return {
      slug,
      prose: draft.prose,
      slots: slots.map((s) => {
        const p = `P${String(s.position).padStart(2, '0')}`
        const d = slotDraft(p)
        return {
          position: p,
          claim: s.rating,
          pose: `${s.pose} ${s.poseName}`,
          lead: s.lead,
          myTier: d.myTier,
          yodayoTier: d.yodayoTier,
          ph: d.ph,
          vlmFlag: d.vlmFlag,
          phText: d.phText,
          note: d.note,
          rolls: d.rolls ? Number(d.rolls) : undefined,
          settings: d.settings || undefined,
          genreRead: s.kind === 'NICHE' && d.genreRead ? d.genreRead : undefined,
          wow: s.kind === 'NICHE' && d.wow ? d.wow : undefined,
        }
      }),
    }
  }

  async function submitBatch() {
    if (busy || !slug || live.filled === 0) return
    setBusy(true)
    setNote(null)
    try {
      const res = await postJson<{ ok: boolean; scoreboard?: { claimDelta?: { up: number; down: number } } }>(
        '/api/t4/batch-verdict',
        buildPayload()
      )
      setNote(
        res.ok
          ? `Батч-вердикт ${slug} записан ОДНОЙ записью (render.verdict · author-batch): ${live.filled}/${slots.length} слотов · расхождения ↑${res.scoreboard?.claimDelta?.up ?? live.up} ↓${res.scoreboard?.claimDelta?.down ?? live.down}`
          : 'Не записано'
      )
      records.reload()
    } catch (e) {
      setNote(e instanceof ApiError ? `API: ${e.message}` : 'Сеть недоступна')
    } finally {
      setBusy(false)
    }
  }

  function downloadJson() {
    const payload = buildPayload()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-batch-verdict.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(
        `curl -X POST /api/t4/batch-verdict -H 'Content-Type: application/json' --data @${slug}-batch-verdict.json`
      )
      setCurlCopied(true)
      setTimeout(() => setCurlCopied(false), 2500)
    } catch {
      setCurlCopied(false)
    }
  }

  const recordList = records.data?.records ?? []

  return (
    <Panel title="Приёмник батча — одна запись на батч" icon={<Stamp className="size-4" />}>
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-zinc-500">
          Черновик живёт здесь — по одному на батч, переживает перезагрузку (localStorage). Выбери батч →
          24 слота уже с заявками из контракта, PH проставлен по умолчанию (авто, приказ 2026-09-24 —
          меняется на Raw/A/B), VLM-флаги и ориентиры вшивает «Куча» выше (кнопка «↔ ориентир» принимает
          ориентир как тир — решение всегда твоё). Роллы/CFG — журнал перекидок и настроек рендера
          (стохастика станет измеримой), Niche — жанр прочитан? вау? (только NICHE-слоты). «Записать
          одной записью» кладёт весь батч одним render.verdict (slots + scoreboard + A/B-атрибуция).
        </p>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          <select
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setNote(null)
            }}
            className="h-9 w-full min-w-0 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
            aria-label="Батч приёмника"
          >
            <option value="">— выбери батч —</option>
            {items.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.slug} · {b.title}
              </option>
            ))}
          </select>
          {slug ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {Object.entries(live.claimed).map(([t, n]) => (
                <Chip key={t} tone="zinc">
                  {t}: доставлено {live.delivered[t] ?? 0}/{n}
                </Chip>
              ))}
              <Chip tone={live.down > 0 ? 'rose' : 'emerald'}>
                заявка ↑{live.up} ↓{live.down}
              </Chip>
              <Chip tone="amber">площадка ↑{live.pUp} ↓{live.pDown}</Chip>
              <Chip>
                заполнено {live.filled}/{slots.length}
              </Chip>
            </div>
          ) : null}
        </div>

        {/* Фред, 2026-10-08: приёмник не молчит — объясняет, почему пусто.
            Раньше пик RAW/EXP-батча без контракта ронял панель в тишину. */}
        {slug && !contract.loading && contract.error ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            {slug}: контракт не найден и батч не разобран — приёмнику нечего показать. Проверь, что файл батча на месте.
          </div>
        ) : null}
        {slug && !contract.loading && !contract.error && slots.length === 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            {slug}: слоты не найдены ни в контракте, ни в шапках батча — таблице нечем кормиться.
          </div>
        ) : null}
        {slug && !contract.loading && !contract.error && contract.data?.synthesized && slots.length > 0 ? (
          <div className="rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
            Контракта у {slug} нет — заявки (тир) и жанры прочитаны из шапок слотов самого батча.
            A/B-атрибуция недоступна: пар в RAW/EXP-батче нет.
          </div>
        ) : null}

        {slug && slots.length > 0 ? (
          <>
            <div className="max-h-[26rem] overflow-auto rounded-md border border-zinc-800 t4-scroll">
              <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
                  <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="px-2 py-2 font-medium">P</th>
                    <th className="px-2 py-2 font-medium">Заявка (контракт)</th>
                    <th className="px-2 py-2 font-medium">Мой тир</th>
                    <th className="px-2 py-2 font-medium">Йодайо</th>
                    <th className="px-2 py-2 font-medium">PH/Raw/A-B</th>
                    <th className="px-2 py-2 font-medium">VLM</th>
                    <th className="px-2 py-2 font-medium">Роллы/CFG</th>
                    <th className="px-2 py-2 font-medium">Niche</th>
                    <th className="px-2 py-2 font-medium">PH-текст</th>
                    <th className="px-2 py-2 font-medium">Заметка</th>
                    <th className="px-2 py-2 font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => {
                    const p = `P${String(s.position).padStart(2, '0')}`
                    const d = slotDraft(p)
                    const dc = d.myTier ? tierDeltaIcon(d.myTier, s.rating) : ''
                    const dp = d.myTier && d.yodayoTier ? tierDeltaIcon(d.myTier, d.yodayoTier) : ''
                    return (
                      <tr key={p} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-amber-200/80">{p}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <RatingBadge rating={s.rating} />
                            <span className="text-[10px] text-zinc-500">
                              {s.pose} {s.poseName.slice(0, 24)} · LEAD {s.lead}
                              {s.ab ? ` · ${s.ab.half}/${s.ab.pair}` : ''}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={d.myTier}
                            onChange={(e) => updateSlot(p, { myTier: e.target.value })}
                            className="h-7 w-[74px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[11px] text-zinc-200"
                            aria-label={`Мой тир ${p}`}
                          >
                            <option value="">—</option>
                            {TIER_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={d.yodayoTier}
                            onChange={(e) => updateSlot(p, { yodayoTier: e.target.value })}
                            className="h-7 w-[74px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[11px] text-zinc-200"
                            aria-label={`Тир Йодайо ${p}`}
                          >
                            <option value="">—</option>
                            {TIER_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={d.ph}
                            onChange={(e) => updateSlot(p, { ph: e.target.value })}
                            className="h-7 w-[70px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[11px] text-zinc-200"
                            aria-label={`PH/Raw/A-B ${p}`}
                          >
                            <option value="">—</option>
                            {PH_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          {d.vlmFlag ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <Chip tone={d.vlmFlag === 'ok' ? 'emerald' : d.vlmFlag === 'skipped' ? 'zinc' : 'rose'}>
                                {VLM_FLAG_LABEL[d.vlmFlag] ?? d.vlmFlag}
                              </Chip>
                              {d.tierHint ? (
                                <button
                                  onClick={() => updateSlot(p, { myTier: d.tierHint ?? '' })}
                                  title={`Принять ориентир VLM (${d.tierHint}) как мой тир — решение всегда твоё`}
                                  className="rounded border border-zinc-700 bg-zinc-900 px-1 text-[9px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
                                >
                                  ↔ {d.tierHint}
                                </button>
                              ) : null}
                            </div>
                          ) : d.tierHint ? (
                            <button
                              onClick={() => updateSlot(p, { myTier: d.tierHint ?? '' })}
                              className="rounded border border-zinc-700 bg-zinc-900 px-1 text-[9px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
                            >
                              ориентир {d.tierHint}
                            </button>
                          ) : (
                            <span className="text-zinc-700">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-col gap-0.5">
                            <input
                              value={d.rolls ?? ''}
                              onChange={(e) => updateSlot(p, { rolls: e.target.value.replace(/[^\d]/g, '') })}
                              placeholder="перекидки"
                              className="h-6 w-[62px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-200 placeholder:text-zinc-700"
                              aria-label={`Перекидки ${p}`}
                            />
                            <input
                              value={d.settings ?? ''}
                              onChange={(e) => updateSlot(p, { settings: e.target.value })}
                              placeholder="cfg/sampler"
                              className="h-6 w-[62px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-200 placeholder:text-zinc-700"
                              aria-label={`Настройки ${p}`}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          {s.kind === 'NICHE' ? (
                            <div className="flex flex-col gap-0.5">
                              <select
                                value={d.genreRead ?? ''}
                                onChange={(e) => updateSlot(p, { genreRead: e.target.value })}
                                className="h-6 w-[64px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-200"
                                aria-label={`Жанр прочитан ${p}`}
                              >
                                <option value="">жанр?</option>
                                <option value="yes">читается</option>
                                <option value="no">не ниша</option>
                              </select>
                              <select
                                value={d.wow ?? ''}
                                onChange={(e) => updateSlot(p, { wow: e.target.value })}
                                className="h-6 w-[64px] rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-200"
                                aria-label={`Вау ${p}`}
                              >
                                <option value="">вау?</option>
                                <option value="yes">вау</option>
                                <option value="no">мимо</option>
                              </select>
                            </div>
                          ) : (
                            <span className="text-zinc-800">·</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={d.phText}
                            onChange={(e) => updateSlot(p, { phText: e.target.value })}
                            placeholder="что PH сделал с промптом…"
                            className="h-7 w-full min-w-[110px] rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-700"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={d.note}
                            onChange={(e) => updateSlot(p, { note: e.target.value })}
                            placeholder="заметка…"
                            className="h-7 w-full min-w-[90px] rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-700"
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px]">
                          <span
                            className={
                              dc === '↑'
                                ? 'text-emerald-400'
                                : dc === '↓'
                                  ? 'text-rose-400'
                                  : 'text-zinc-600'
                            }
                          >
                            {dc || '·'}
                          </span>
                          <span className="mx-0.5 text-zinc-700">/</span>
                          <span
                            className={
                              dp === '↑'
                                ? 'text-emerald-400'
                                : dp === '↓'
                                  ? 'text-rose-400'
                                  : 'text-zinc-600'
                            }
                          >
                            {dp || '·'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Textarea
              value={draft.prose}
              onChange={(e) => {
                const next = { ...draft, prose: e.target.value }
                setDraft(next)
                writeDraft(slug, next)
              }}
              placeholder="Проза вердикта по батчу — как есть: «мокрый шёлк решил всё, P07 пятно…» (переживёт перезагрузку)"
              className="min-h-20 border-zinc-800 bg-zinc-950 text-sm"
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={submitBatch}
                disabled={busy || live.filled === 0}
                className="bg-emerald-600 text-zinc-50 hover:bg-emerald-500 disabled:opacity-40"
              >
                <Stamp className="mr-1 size-3.5" />
                {busy ? 'Записываю…' : 'Записать одной записью'}
              </Button>
              <button
                onClick={downloadJson}
                className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-200"
              >
                <Download className="size-3" />
                Скачать JSON
              </button>
              <button
                onClick={copyCurl}
                className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-200"
              >
                {curlCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {curlCopied ? 'Скопировано' : 'curl одной командой'}
              </button>
              {note ? <span className="text-xs text-emerald-400">{note}</span> : null}
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">
            Записанные батч-вердикты · {recordList.length}
          </p>
          {records.loading ? (
            <SkeletonBlock lines={2} />
          ) : recordList.length === 0 ? (
            <p className="text-xs text-zinc-600">
              Пока пусто — первый батч-вердикт ляжет сюда одной строкой и раскроется в таблицу.
            </p>
          ) : (
            <div className="space-y-1.5">
              {recordList.map((r) => (
                <div key={r.id} className="rounded-md border border-zinc-800 bg-zinc-900/60">
                  <button
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Mono>{r.slug}</Mono>
                      <span className="truncate text-xs text-zinc-400">{r.summary.slice(0, 110)}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-600">{formatDate(r.at)}</span>
                  </button>
                  {expanded === r.id ? (
                    <div className="border-t border-zinc-800/60 p-3">
                      {r.scoreboard ? (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {Object.entries(r.scoreboard.claimed ?? {}).map(([t, n]) => (
                            <Chip key={t}>
                              {t}: {r.scoreboard?.delivered?.[t] ?? 0}/{n}
                            </Chip>
                          ))}
                          <Chip tone="amber">
                            заявка ↑{r.scoreboard.claimDelta?.up ?? 0} ↓{r.scoreboard.claimDelta?.down ?? 0}
                          </Chip>
                          <Chip tone="amber">
                            площадка ↑{r.scoreboard.platformDelta?.up ?? 0} ↓{r.scoreboard.platformDelta?.down ?? 0}
                          </Chip>
                        </div>
                      ) : null}
                      <div className="max-h-64 overflow-auto rounded-md border border-zinc-800 t4-scroll">
                        <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
                          <thead className="sticky top-0 bg-zinc-900/95">
                            <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                              <th className="px-2 py-1.5 font-medium">P</th>
                              <th className="px-2 py-1.5 font-medium">Заявка</th>
                              <th className="px-2 py-1.5 font-medium">Мой</th>
                              <th className="px-2 py-1.5 font-medium">Йодайо</th>
                              <th className="px-2 py-1.5 font-medium">PH</th>
                              <th className="px-2 py-1.5 font-medium">VLM</th>
                              <th className="px-2 py-1.5 font-medium">Заметка</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.slots.map((s) => (
                              <tr key={s.position} className="border-t border-zinc-800/60">
                                <td className="px-2 py-1 font-mono text-amber-200/70">{s.position}</td>
                                <td className="px-2 py-1 text-zinc-400">{s.claim || '—'}</td>
                                <td className="px-2 py-1 text-zinc-200">{s.myTier || '—'}</td>
                                <td className="px-2 py-1 text-zinc-400">{s.yodayoTier || '—'}</td>
                                <td className="px-2 py-1 text-zinc-500">{s.ph || '—'}</td>
                                <td className="px-2 py-1 text-zinc-500">
                                  {s.vlmFlag ? VLM_FLAG_LABEL[s.vlmFlag] ?? s.vlmFlag : '—'}
                                </td>
                                <td className="px-2 py-1 text-zinc-500">{s.note || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

function VerdictsTab() {
  return (
    <div className="space-y-6">
      <TrialRadarPanel />
      <VlmFirstPassPanel />
      <BatchReceiverPanel />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Хранилище (браузерный сейф — инцидент 2026-09-23)               */
/* ------------------------------------------------------------------ */

function VaultTab() {
  const [snaps, setSnaps] = useState<VaultMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [report, setReport] = useState<{ restored: string[]; skipped: string[]; mergedEvents: number } | null>(null)

  async function refresh() {
    setSnaps(await listSnapshots())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function snapshotNow() {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const meta = await cacheCurrentState()
      setNote(
        meta
          ? `Снимок в сейфе: ${meta.batches} батчей · ${(meta.bytes / 1024).toFixed(0)} КБ — переживёт любую смерть контейнера`
          : 'Состояние не изменилось — свежий снимок уже в сейфе'
      )
      await refresh()
    } catch {
      setNote('Не удалось снять снимок — API недоступен')
    } finally {
      setBusy(false)
    }
  }

  async function restore(meta: VaultMeta) {
    if (busy) return
    setBusy(true)
    setNote(null)
    setReport(null)
    try {
      const bundle = await getSnapshot(meta.key)
      if (!bundle) throw new Error('снимок не читается')
      setReport(await restoreSnapshot(bundle))
      await refresh()
    } catch {
      setNote('Восстановление не удалось — снимок не читается')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Браузерный сейф" icon={<ShieldCheck className="size-4" />}>
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            Полный снимок состояния THREAD 4 (батчи, контракты, спеки, документы, события) живёт в
            IndexedDB <Mono>твоего</Mono> браузера — сервер контейнера эфемерен, браузер нет.
            Инцидент 2026-09-23 (гибель T4-05 и T4-07 с контейнером) больше не повторится:
            достаточно один раз открыть Workflow после сдачи — и снимок уже здесь. Восстановление
            возвращает на диск только недостающее, события вливаются с дедупликацией по id.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={snapshotNow}
              disabled={busy}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              <ShieldCheck className="mr-1 size-3.5" />
              {busy ? 'Работаю…' : 'Снять снимок сейчас'}
            </Button>
            <span className="text-[11px] text-zinc-600">хранятся последние 5 снимков</span>
            {note ? <span className="text-xs text-emerald-300">{note}</span> : null}
          </div>
          {report ? (
            <div className="rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-300">
              Восстановлено файлов: {report.restored.length} · событий влито: {report.mergedEvents}
              {report.skipped.length > 0 ? ` · пропущено: ${report.skipped.length} (уже на диске)` : ''}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Снимки в сейфе" icon={<History className="size-4" />} bodyClassName="max-h-[60vh] overflow-y-auto t4-scroll">
        {snaps.length === 0 ? (
          <EmptyState
            title="Сейф пуст"
            hint="Сними первый снимок — он переживёт выключение компьютера, откат контейнера и смерть сессии."
          />
        ) : (
          <div className="space-y-1.5">
            {snaps.map((s) => (
              <div
                key={s.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Mono>{formatDate(s.savedAt)}</Mono>
                  <Chip>{s.batches} батчей</Chip>
                  <Chip>{(s.bytes / 1024).toFixed(0)} КБ</Chip>
                  <Chip tone="emerald">{s.counts.events ?? '—'} соб.</Chip>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => restore(s)}
                    disabled={busy}
                    className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-2 py-1 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-600/20 disabled:opacity-40"
                  >
                    Восстановить
                  </button>
                  <button
                    onClick={async () => {
                      await deleteSnapshot(s.key)
                      await refresh()
                    }}
                    className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-rose-500/40 hover:text-rose-300"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Архив 3.2                                                      */
/* ------------------------------------------------------------------ */

function ArchiveTab() {
  const list = useApi<{ items: { name: string; size: number }[] }>('/api/t4/archive')
  const [name, setName] = useState<string | null>(null)
  const detail = useApi<{ name: string; markdown: string }>(name ? `/api/t4/archive/${encodeURIComponent(name)}` : null)

  const items = useMemo(() => list.data?.items ?? [], [list.data])

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Panel title="Субстрат N12–N29" icon={<ArchiveIcon className="size-4" />} bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll">
        {list.loading ? (
          <SkeletonBlock lines={8} />
        ) : list.error ? (
          <ErrorNote text="Архив не подключён" hint="API /api/t4/archive появится с ядром" />
        ) : items.length === 0 ? (
          <EmptyState title="Архив пуст" />
        ) : (
          <div className="space-y-1.5">
            {items.map((a) => (
              <button
                key={a.name}
                onClick={() => setName(name === a.name ? null : a.name)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[11px] transition-colors',
                  name === a.name
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
                )}
              >
                <span className="truncate font-mono">{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {name ? (
        <Panel title={name} icon={<ScrollText className="size-4" />} bodyClassName="max-h-[70vh] overflow-y-auto t4-scroll">
          {detail.loading ? (
            <SkeletonBlock lines={10} />
          ) : detail.error ? (
            <ErrorNote text="Файл недоступен" />
          ) : (
            <MarkdownView>{detail.data?.markdown ?? ''}</MarkdownView>
          )}
        </Panel>
      ) : (
        <div className="hidden lg:flex items-center">
          <EmptyState
            className="w-full"
            title="Архив — субстрат, не писание"
            hint="N12–N29 кормят taste-майнинг и дедупликацию концептов. Ничего не связывают: окно гейтов — только T4-батчи."
          />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [tab, setTab] = useState<TabId>('state')
  const state = useApi<{ batches?: unknown[]; events?: number; glass?: { chain?: { ok?: boolean; events?: number } } }>(
    '/api/t4/state'
  )
  const chain = state.data?.glass?.chain
  const deliveredCount = Array.isArray(state.data?.batches) ? state.data?.batches.length : null
  const eventsCount = state.data?.events ?? chain?.events ?? null

  /* Клавиши 1–0 — вкладки под пальцы (автор живёт в дашборде, десять
   *  вкладок — десять клавиш). В полях ввода не мешаем: там цифры — текст. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      )
        return
      const idx = '1234567890'.indexOf(e.key)
      if (idx >= 0 && idx < TABS.length) setTab(TABS[idx].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Глубокая навигация (радар TRIAL-3 → слот): дом только переключает
   *  вкладку — батч открывает BatchesTab, скроллит SlotStrip. */
  useEffect(() => {
    const off = subscribeSlotNav(() => setTab('batches'))
    return off
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900 via-zinc-950/95 to-zinc-950/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 via-rose-500 to-fuchsia-600 shadow-lg shadow-fuchsia-950/40">
                <span className="font-mono text-base font-bold text-zinc-950">4</span>
                <span className="absolute -right-0.5 -top-0.5 size-2 animate-ping rounded-full bg-fuchsia-400" />
              </div>
              <div>
                <div className="bg-gradient-to-r from-amber-300 via-rose-300 to-fuchsia-300 bg-clip-text text-base font-bold tracking-tight text-transparent">
                  THREAD 4
                </div>
                <div className="text-[11px] text-zinc-500">
                  конвейер промпт-батчей · Tsubaki.2 Pro → Yodayo
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {deliveredCount != null ? (
                <Badge variant="outline" className="gap-1 border-amber-800/50 bg-amber-500/5 text-amber-300">
                  <Sparkles className="size-3" /> сдано {deliveredCount}
                </Badge>
              ) : null}
              {eventsCount != null ? (
                <Badge variant="outline" className="gap-1 border-fuchsia-800/50 bg-fuchsia-500/5 text-fuchsia-300">
                  <ScrollText className="size-3" /> событий {eventsCount}
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className={cn(
                  'gap-1',
                  chain?.ok
                    ? 'border-emerald-800/50 bg-emerald-500/5 text-emerald-300'
                    : 'border-rose-800/50 bg-rose-500/5 text-rose-300'
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    chain?.ok ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'
                  )}
                />
                {chain?.ok ? 'цепь цела' : 'цепь!'}
              </Badge>
            </div>
          </div>
          <ScrollArea className="whitespace-nowrap pb-px">
            <div className="flex gap-1 pb-2">
              {TABS.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={`${t.label} · клавиша ${(i + 1) % 10}`}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md border-b-2 px-3 py-1.5 text-xs font-medium transition-all outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50',
                    tab === t.id
                      ? 'border-fuchsia-500 bg-zinc-800/40 text-amber-300'
                      : 'border-transparent text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
                  )}
                >
                  {t.icon}
                  {t.label}
                  <span
                    className={cn(
                      'hidden rounded border border-zinc-700/70 bg-zinc-800/60 px-1 font-mono text-[9px] leading-4 text-zinc-500 sm:inline-block',
                      tab === t.id && 'border-fuchsia-500/30 text-amber-300/70'
                    )}
                  >
                    {(i + 1) % 10}
                  </span>
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="h-1" />
          </ScrollArea>
        </div>
        {/* нить: анимированная градиентная нить под шапкой — пряжа треда */}
        <div className="h-[2px] w-full overflow-hidden">
          <div className="h-full w-1/3 animate-[thread-slide_6s_linear_infinite] bg-gradient-to-r from-transparent via-fuchsia-500 to-transparent" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* key={tab}: смена вкладки — тихий подъём контента (t4-tab-enter),
            *  состав вкладок не меняется — рефетч не чаще прежнего условного рендера */}
        <div key={tab} className="t4-tab-enter">
          {tab === 'state' ? <StateTab /> : null}
          {tab === 'constitution' ? <DocsTab /> : null}
          {tab === 'specs' ? <SpecsTab /> : null}
          {tab === 'compile' ? <CompileTab /> : null}
          {tab === 'batches' ? <BatchesTab /> : null}
          {tab === 'events' ? <EventsTab /> : null}
          {tab === 'verdicts' ? <VerdictsTab /> : null}
          {tab === 'glass' ? <GlassTab /> : null}
          {tab === 'vault' ? <VaultTab /> : null}
          {tab === 'archive' ? <ArchiveTab /> : null}
        </div>
      </main>

      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
          <span>THREAD 4 · закон 24 слотов · Super Z × Автор</span>
          <span className="flex items-center gap-3">
            <span className="hidden items-center gap-1 md:flex">
              клавиши
              <kbd className="rounded border border-b-2 border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-900 px-1 font-mono text-[10px] text-zinc-400 shadow-sm">1</kbd>
              –
              <kbd className="rounded border border-b-2 border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-900 px-1 font-mono text-[10px] text-zinc-400 shadow-sm">0</kbd>
              — вкладки ·
              <kbd className="rounded border border-b-2 border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-900 px-1 font-mono text-[10px] text-zinc-400 shadow-sm">/</kbd>
              — поиск
            </span>
            <span className="font-mono">гейты — см. Состояние · салиенс + noun-lock + коллизия · приёмник батча · сейф</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
