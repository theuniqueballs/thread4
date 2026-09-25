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
  Copy,
  Download,
  FileText,
  FlaskConical,
  Heart,
  History,
  PenLine,
  ScanEye,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Stamp,
  Upload,
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

const TIER_ORDER_MAP: Record<string, number> = { 'PG-13': 0, R: 1, 'R+': 2, X: 3 }

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
  const order: Record<string, number> = { 'PG-13': 0, PG13: 0, R: 1, 'R+': 2, X: 3 }
  const hintKey = (card.rating_hint ?? '').trim().replace('RPLUS', 'R+')
  const hint = order[hintKey]
  const cl = order[claim]
  if (hint !== undefined && cl !== undefined) return hint < cl ? 'drift' : 'ok'
  return ''
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
      await postJson('/api/t4/events', {
        type: 'note',
        summary: `VLM-сводка ${slug}: прогонов ${journal.length}/${slots.length} — флаги: ок ${journalFlags.ok ?? 0} · мутация ${journalFlags.mutation ?? 0} · дрейф ${journalFlags.drift ?? 0} · не прогонял ${journalFlags.skipped ?? 0}${remaining > 0 ? ` · осталось ${remaining}` : ' · батч покрыт'}`,
        data: { slug, kind: 'vlm-summary', runs: journal.length, total: slots.length, flags: journalFlags, positions: journal.map((j) => j.position) },
      })
      setSummaryNote('Сводка записана в лог событий (note).')
    } catch {
      setSummaryNote('Не удалось записать сводку.')
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

        <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
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
            className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
            aria-label="Батч"
          >
            <option value="">— батч —</option>
            {items.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.slug}
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
      claimed[s.rating] = (claimed[s.rating] ?? 0) + 1
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

        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <select
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setNote(null)
            }}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
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
        {tab === 'vault' ? <VaultTab /> : null}
        {tab === 'archive' ? <ArchiveTab /> : null}
      </main>

      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
          <span>THREAD 4 · закон 24 слотов · Super Z × Автор</span>
          <span className="font-mono">19 гейтов · салиенс + noun-lock + коллизия · приёмник батча · сейф</span>
        </div>
      </footer>
    </div>
  )
}
