'use client'

/**
 * THREAD 4 — dashboard (the / route).
 * Dark atelier: zinc surfaces, amber accent, rose for verdicts/X, emerald
 * for gates. No blue, no indigo. Single-page tabbed SPA — no routing.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Archive as ArchiveIcon,
  BookOpen,
  Boxes,
  Check,
  Copy,
  FileText,
  FlaskConical,
  Heart,
  History,
  PenLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Stamp,
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
import {
  cacheCurrentState,
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
  restoreSnapshot,
  type VaultMeta,
} from '@/components/t4/vault'

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
  { id: 'vault', label: 'Хранилище', icon: <ShieldCheck className="size-3.5" /> },
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
  { id: 'forge', label: 'Кузница движков' },
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
      <Panel title="Компилятор батча" icon={<FlaskConical className="size-4" />}>
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            Тема от автора → слот-план 24 промпта (21 мейн + 3 OC — вердикт T4-02): жанры,
            рейтинги по рецептуре, назначенные носители, позы, палитры, расы, регистры.
            Диверсия назначается ДО письма. Контракт = экспозиция для автора + закон для писца.
          </p>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Тема батча — например: «город, где усталость носит как меха»…"
            className="min-h-20 border-zinc-800 bg-zinc-950 text-sm"
          />
          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
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
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr]">
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
      await postJson('/api/t4/events', {
        type: 'render.verdict',
        summary: `${slug}: ${vLabel}${issues.length > 0 ? ` · ${issues.join(', ')}` : ''}${text.trim() ? ` — ${text.trim().slice(0, 90)}` : ''}`,
        data: { slug, verdict, tags: issues, prose },
      })
      setNote('Вердикт записан в лог — он кормит правки закона и вкус.')
      setVerdict(null)
      setIssues([])
      setText('')
    } catch (e) {
      setNote(e instanceof ApiError && isNotFound(e) ? 'API недоступен' : 'Не удалось записать')
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
          <EmptyState title="Батчей пока нет" hint="Собери контракт во вкладке «Сборка» и жми «Писец» — черновик появится здесь с квитанциями гейтов." />
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
          <QuickVerdict slug={slug} />
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

const VERDICT_PRESETS = [
  'Огонь, канонизирую',
  'Охуенная поза решила всё',
  'Скатилось в волт',
  'Ниша не прочиталась',
  'Геометрия поехала',
  'Милф-штамп вернулся',
  'Счёт слотов не тот',
  'Жадной эротики в волт',
]

function VerdictsTab() {
  const [slug, setSlug] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const batches = useApi<{ items: { slug: string; title: string }[] }>('/api/t4/batches')
  const items = batches.data?.items ?? []

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
            Авторская проза — самый сильный сигнал системы (конституция §1: вердикт — единственный
            законодатель). Быстрые вердикты по конкретному батчу — во вкладке «Батчи»; здесь — свободный
            текст с заготовками.
          </p>
          <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
            <select
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
              aria-label="Слаг батча"
            >
              <option value="">— без слага —</option>
              {items.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.slug} · {b.title}
                </option>
              ))}
            </select>
            <p className="self-center text-[11px] leading-tight text-zinc-600">
              {items.length > 0 ? 'Слаг подхватится из списка батчей.' : 'Слаг впишешь, когда появятся батчи.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {VERDICT_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setText((t) => (t.trim() === '' ? p : `${t.trim()} ${p}`))}
                className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-amber-500/40 hover:text-amber-200"
              >
                {p}
              </button>
            ))}
          </div>
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
          title="VLM-петля — готова к первому живому прогону"
          hint="Загрузи рендер любого промпта T4-03 — машина разобьёт его по осям (силуэт / первый считыв / свидетель / физика / scroll-stop) и запишет render.verdict. Первый живой тест — за тобой."
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
              <span className="hidden text-[11px] text-zinc-500 sm:inline">закон 24 · 10 движков · авто-писец готов</span>
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
          <span>THREAD 4 · закон 24 слотов · Super Z × Автор</span>
          <span className="font-mono">3.2 → откат · 21 мейн + 3 OC · 13 гейтов</span>
        </div>
      </footer>
    </div>
  )
}
