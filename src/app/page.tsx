'use client'

/**
 * THREAD 4 — dashboard (the / route).
 * Dark atelier: zinc surfaces, amber accent, rose for verdicts/X, emerald
 * for gates. No blue, no indigo. Single-page tabbed SPA — no routing.
 */

import { useMemo, useState } from 'react'
import {
  Activity,
  Archive as ArchiveIcon,
  BookOpen,
  Boxes,
  FileText,
  FlaskConical,
  Heart,
  History,
  ScrollText,
  Sparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  ApiError,
  asArray,
  asRecord,
  asStr,
  formatDate,
  isNotFound,
  postJson,
  useApi,
  type CompilePayload,
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

/* ------------------------------------------------------------------ */
/* Tab model                                                           */
/* ------------------------------------------------------------------ */

type TabId =
  | 'state'
  | 'constitution'
  | 'specs'
  | 'compile'
  | 'batches'
  | 'events'
  | 'verdicts'
  | 'archive'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'state', label: 'Состояние', icon: <Activity className="size-3.5" /> },
  { id: 'constitution', label: 'Документы', icon: <ScrollText className="size-3.5" /> },
  { id: 'specs', label: 'Спеки', icon: <Boxes className="size-3.5" /> },
  { id: 'compile', label: 'Сборка', icon: <FlaskConical className="size-3.5" /> },
  { id: 'batches', label: 'Батчи', icon: <FileText className="size-3.5" /> },
  { id: 'events', label: 'События', icon: <History className="size-3.5" /> },
  { id: 'verdicts', label: 'Вердикты', icon: <Heart className="size-3.5" /> },
  { id: 'archive', label: 'Архив 3.2', icon: <ArchiveIcon className="size-3.5" /> },
]

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
            <StatCard label="Носители" value={asStr(counts.carriers) || '280'} hint="14 классов × 4 механизма" />
            <StatCard label="Позы" value={asStr(counts.poses) || '240'} hint="standing-default в отставке" />
            <StatCard label="Палитры" value={asStr(counts.palettes) || '105'} />
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
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
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

function CompileTab() {
  const [theme, setTheme] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CompilePayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const contracts = useApi<{ items: { slug: string; theme: string; createdAt: string }[] }>('/api/t4/contracts')
  const [viewSlug, setViewSlug] = useState<string | null>(null)
  const detail = useApi<{ markdown: string }>(viewSlug ? `/api/t4/contracts/${viewSlug}` : null)

  async function compile() {
    const t = theme.trim()
    if (!t || busy) return
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      const res = await postJson<CompilePayload>('/api/t4/compile', { theme: t })
      setResult(res)
      contracts.reload()
    } catch (e) {
      setErr(e instanceof ApiError ? `API: ${e.message}` : 'Сеть недоступна')
    } finally {
      setBusy(false)
    }
  }

  const items = contracts.data?.items ?? []

  return (
    <div className="space-y-6">
      <Panel title="Компилятор батча" icon={<FlaskConical className="size-4" />}>
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            Тема от автора → слот-план 21+3 OC: жанры, рейтинги по рецептуре, назначенные носители, позы,
            палитры, расы, регистры. Диверсия назначается ДО письма (не ловится линтами после).
            Контракт = экспозиция для автора + закон для писца.
          </p>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Тема батча — например: «город, где усталость носит как меха»…"
            className="min-h-20 border-zinc-800 bg-zinc-950 text-sm"
          />
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
                <span className="shrink-0 text-[11px] text-zinc-600">{formatDate(c.createdAt)}</span>
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
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Батчи                                                          */
/* ------------------------------------------------------------------ */

function BatchesTab() {
  const list = useApi<{ items: { slug: string; title: string; date: string }[] }>('/api/t4/batches')
  const [slug, setSlug] = useState<string | null>(null)
  const detail = useApi<{
    slug: string
    title: string
    markdown: string
    receipts: { gate: string; level: string; verdict: string; findings: string[] }[]
  }>(slug ? `/api/t4/batches/${slug}` : null)

  const items = list.data?.items ?? []
  const receipts = detail.data?.receipts ?? []

  return (
    <div className="space-y-4">
      <Panel title="Батчи" icon={<FileText className="size-4" />}>
        {list.loading ? (
          <SkeletonBlock lines={3} />
        ) : items.length === 0 ? (
          <EmptyState title="Батчей пока нет" hint="T4-01 соберётся после заказа темы." />
        ) : (
          <div className="grid gap-1.5">
            {items.map((b) => (
              <button
                key={b.slug}
                onClick={() => setSlug(slug === b.slug ? null : b.slug)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                  slug === b.slug
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Mono>{b.slug}</Mono>
                  <span className="truncate text-xs text-zinc-300">{b.title}</span>
                </span>
                <span className="shrink-0 text-[11px] text-zinc-600">{formatDate(b.date)}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {slug ? (
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
        </>
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
  const events = data?.events ?? []

  return (
    <Panel title="Лог событий (append-only)" icon={<History className="size-4" />} bodyClassName="max-h-[75vh] overflow-y-auto t4-scroll">
      {loading ? (
        <SkeletonBlock lines={8} />
      ) : error ? (
        <ErrorNote text="Лог недоступен" hint="ядро ещё не подключено" />
      ) : events.length === 0 ? (
        <EmptyState title="Событий пока нет" hint="Первое событие — рождение эпохи — в log.jsonl." />
      ) : (
        <div className="relative space-y-0 pl-4">
          <div className="absolute bottom-2 left-[7px] top-2 w-px bg-zinc-800" />
          {events.map((e, i) => (
            <div key={e.id ?? i} className="relative py-2.5 pl-5">
              <span className="absolute left-[-2px] top-[15px] size-[9px] rounded-full border-2 border-zinc-950 bg-amber-500" />
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={e.type} />
                <span className="text-xs text-zinc-600">{formatDate(e.at)}</span>
              </div>
              <div className="mt-1 text-sm leading-relaxed text-zinc-300">{e.summary}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Tab: Вердикты (форма + VLM-заглушка)                                */
/* ------------------------------------------------------------------ */

function VerdictsTab() {
  const [slug, setSlug] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function submit() {
    if (busy || text.trim() === '') return
    setBusy(true)
    setNote(null)
    try {
      await postJson('/api/t4/events', {
        type: 'render.verdict',
        summary: `${slug.trim() || 'batch'}: ${text.trim().slice(0, 120)}`,
        data: { slug: slug.trim(), prose: text.trim() },
      })
      setNote('Вердикт записан в лог событий.')
      setText('')
    } catch (e) {
      setNote(e instanceof ApiError && isNotFound(e) ? 'API появится после интеграции ядра' : 'Не удалось записать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Panel title="Вердикт автора" icon={<Heart className="size-4" />}>
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            Авторская проза — самый сильный сигнал системы. Пиши как видишь; структура извлекается при
            кодировании в taste-лог.
          </p>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Слаг батча — T4-01"
            className="border-zinc-800 bg-zinc-950 text-sm"
          />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="«Охуенная поза решила всё…», «скатились в волт…» — как есть"
            className="min-h-32 border-zinc-800 bg-zinc-950 text-sm"
          />
          <div className="flex items-center gap-3">
            <Button
              onClick={submit}
              disabled={busy || text.trim() === ''}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {busy ? 'Записываю…' : 'Записать вердикт'}
            </Button>
            {note ? <span className="text-xs text-zinc-400">{note}</span> : null}
          </div>
        </div>
      </Panel>

      <Panel title="VLM-разбор рендера" icon={<Sparkles className="size-4" />}>
        <EmptyState
          title="VLM-петля — скоро"
          hint="Загрузка рендера → автоматический разбор (силуэт / первый считыв / носители / scroll-stop). Автор разрешил попробовать — ядро подключит."
        />
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
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
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

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10">
                <span className="font-mono text-sm font-bold text-amber-400">4</span>
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight">THREAD 4</div>
                <div className="text-[11px] text-zinc-500">конвейер промпт-батчей · Tsubaki.2 Pro → Yodayo</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="hidden text-[11px] text-zinc-500 sm:inline">эпоха чистого листа</span>
            </div>
          </div>
          <ScrollArea className="whitespace-nowrap pb-px">
            <div className="flex gap-1 pb-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === t.id
                      ? 'border-amber-500 text-amber-300'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="h-1" />
          </ScrollArea>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {tab === 'state' ? <StateTab /> : null}
        {tab === 'constitution' ? <DocsTab /> : null}
        {tab === 'specs' ? <SpecsTab /> : null}
        {tab === 'compile' ? <CompileTab /> : null}
        {tab === 'batches' ? <BatchesTab /> : null}
        {tab === 'events' ? <EventsTab /> : null}
        {tab === 'verdicts' ? <VerdictsTab /> : null}
        {tab === 'archive' ? <ArchiveTab /> : null}
      </main>

      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
          <span>THREAD 4 · эпоха чистого листа · Super Z × Автор</span>
          <span className="font-mono">3.2 → откат · T4-01 → ждёт тему</span>
        </div>
      </footer>
    </div>
  )
}
