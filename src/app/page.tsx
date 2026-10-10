'use client'

/**
 * THREAD 4 — пусковая панель сандбокса (the / route · порт 3000).
 *
 * Источник правды — дашборд репо (/home/z/thread4, порт 3100): законы, гейты,
 * летопись с хеш-цепью, батчи, вердикты. Сюда автор попадает через
 * платформенный шлюз (Caddy :81), и кнопка ниже уводит его туда же:
 * /?XTransformPort=3100 — шлюз пробрасывает запрос на 3100, а дашборд
 * несёт параметр во все свои API-вызовы (api.ts → withGatewayPort).
 *
 * Эта страница сама записей не ведёт: только живой снимок /api/t4/state
 * (тоже через шлюз) и дверь. Летопись append-only не трогается, §10 соблюдён.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  BookOpen,
  ExternalLink,
  Github,
  Layers,
  ListTodo,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Живой снимок ядра                                                    */
/* ------------------------------------------------------------------ */

const STATE_URL = '/api/t4/state?XTransformPort=3100'
const DASHBOARD_URL = '/?XTransformPort=3100'
const REPO_URL = 'https://github.com/theuniqueballs/thread4'
const AUTO_REFRESH_MS = 30_000

interface ChainInfo {
  ok: boolean
  events: number
  storedLinks: number
  head: string | null
}

interface StateSnapshot {
  era: string
  lastBatch: string
  nextStep: string
  gateHealth: string
  gatesTotal: number
  counts: { batches: number; events: number; carriers: number; poses: number; palettes: number }
  chain: ChainInfo
  openDebts: number
}

function pickNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function pickStr(v: unknown, fallback = '—'): string {
  return typeof v === 'string' && v.trim() !== '' ? v : fallback
}

/** Ответ ядра читается защитно: форма может дрейфовать, пусковая не должна падать. */
function normalize(raw: unknown): StateSnapshot | null {
  if (raw == null || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const counts = (rec.counts ?? {}) as Record<string, unknown>
  const glass = (rec.glass ?? {}) as Record<string, unknown>
  const chain = (glass.chain ?? {}) as Record<string, unknown>
  return {
    era: pickStr(rec.era, 'THREAD 4'),
    lastBatch: pickStr(rec.lastBatch),
    nextStep: pickStr(rec.nextStep),
    gateHealth: pickStr(rec.gateHealth),
    gatesTotal: pickNum(rec.gatesTotal),
    counts: {
      batches: pickNum(counts.batches),
      events: pickNum(counts.events),
      carriers: pickNum(counts.carriers),
      poses: pickNum(counts.poses),
      palettes: pickNum(counts.palettes),
    },
    chain: {
      ok: chain.ok === true,
      events: pickNum(chain.events),
      storedLinks: pickNum(chain.storedLinks),
      head: typeof chain.head === 'string' ? chain.head : null,
    },
    openDebts: Array.isArray(rec.openDebts) ? (rec.openDebts as unknown[]).length : 0,
  }
}

/* ------------------------------------------------------------------ */
/* Страница                                                             */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(STATE_URL, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next = normalize(await res.json())
      if (next == null) throw new Error('ядро ответило не тем')
      setSnapshot(next)
      setUpdatedAt(new Date())
    } catch (err) {
      // старый снимок не выкидываем: лучше вчерашняя правда, чем пустота
      setError(err instanceof Error ? err.message : 'ошибка сети')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const chainOk = snapshot?.chain.ok === true
  const fresh = error == null && snapshot != null

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* мягкое янтарное свечение сверху — атмосфера мастерской, не декор ради декора */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(251,191,36,0.09),transparent)]"
      />

      <header className="relative z-10 border-b border-zinc-800/80">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex size-9 items-center justify-center rounded-md bg-amber-400 text-zinc-950">
            <Layers className="size-5" aria-hidden />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold tracking-tight">THREAD 4</span>
            <span className="text-xs text-zinc-500">пусковая панель сандбокса</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400 sm:inline-flex"
              title="Ядро живо — снимок обновляется каждые 30 секунд"
            >
              <span
                aria-hidden
                className={
                  fresh
                    ? chainOk
                      ? 'size-1.5 rounded-full bg-emerald-400'
                      : 'size-1.5 rounded-full bg-rose-400'
                    : loading
                      ? 'size-1.5 animate-pulse rounded-full bg-amber-400'
                      : 'size-1.5 rounded-full bg-zinc-600'
                }
              />
              {fresh ? (chainOk ? 'ядро живо' : 'цепь требует взгляда') : loading ? 'опрашиваю ядро…' : 'ядро молчит'}
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              aria-label="Репозиторий THREAD 4 на GitHub (откроется в новой вкладке)"
            >
              <Github className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">theuniqueballs/thread4</span>
              <span className="sm:hidden">репо</span>
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
        {/* герой */}
        <section aria-labelledby="t4-hero">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400/90">
            конвейер промпт-батчей · аниме-рендеры
          </p>
          <h1
            id="t4-hero"
            className="mt-3 max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            Мастерская <span className="text-amber-400">THREAD&nbsp;4</span>
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-zinc-400 sm:text-base">
            Законы, гейты и летопись с хеш-цепью. Батчи собираются, проходят ворота и сдаются —
            каждое событие прошито в цепь, ни одно решение не теряется.
          </p>
        </section>

        {/* живой снимок ядра */}
        <section aria-label="Живое состояние конвейера">
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-3 sm:px-5">
              <Activity className="size-4 text-amber-400" aria-hidden />
              <h2 className="text-sm font-medium text-zinc-200">Живое состояние ядра</h2>
              <span className="ml-auto font-mono text-[11px] text-zinc-500" aria-live="polite">
                {updatedAt
                  ? `обновлено ${updatedAt.toLocaleTimeString('ru-RU', { hour12: false })} · авто каждые 30 с`
                  : 'первый опрос…'}
              </span>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex size-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-50"
                aria-label="Обновить снимок состояния"
              >
                <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              </button>
            </div>

            {/* тело: снимок / скелет / ошибка */}
            {snapshot == null && loading && <StateSkeleton />}

            {snapshot == null && !loading && (
              <div className="px-4 py-6 sm:px-5">
                <div className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose-400" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-rose-200">Ядро не отвечает</p>
                    <p className="mt-1 break-words text-xs leading-relaxed text-zinc-400">
                      {error ?? 'неизвестная ошибка'} — проверь, что дашборд поднят (порт 3100).
                      Дверь ниже всё равно открыта: если ядро ожило, дашборд загрузится сам.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {snapshot != null && (
              <div className="flex flex-col gap-4 px-4 py-5 sm:px-5" aria-live="polite">
                {error != null && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                    Последнее обновление не удалось ({error}) — показан прошлый снимок.
                  </p>
                )}

                {/* хеш-цепь */}
                <div className="flex flex-wrap items-center gap-3">
                  {chainOk ? (
                    <ShieldCheck className="size-5 text-emerald-400" aria-hidden />
                  ) : (
                    <ShieldAlert className="size-5 text-rose-400" aria-hidden />
                  )}
                  <p className={chainOk ? 'text-sm text-zinc-200' : 'text-sm text-rose-200'}>
                    {chainOk ? 'Хеш-цепь цела' : 'Хеш-цепь требует внимания'}
                    <span className="text-zinc-500">
                      {' '}
                      — {snapshot.chain.events} событий · {snapshot.chain.storedLinks} звеньев
                    </span>
                  </p>
                  {snapshot.chain.head != null && (
                    <code
                      className="rounded bg-zinc-950/80 px-2 py-0.5 font-mono text-[11px] text-amber-300/90"
                      title="Голова цепи (10 символов)"
                    >
                      {snapshot.chain.head.slice(0, 10)}
                    </code>
                  )}
                </div>

                {/* последние события конвейера */}
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-start gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3.5">
                    <BookOpen className="mt-0.5 size-4 shrink-0 text-amber-400/90" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Последний сданный</dt>
                      <dd className="mt-1 break-words text-sm text-zinc-200">{snapshot.lastBatch}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3.5">
                    <ListTodo className="mt-0.5 size-4 shrink-0 text-amber-400/90" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Следующий шаг</dt>
                      <dd className="mt-1 break-words text-sm text-zinc-200">{snapshot.nextStep}</dd>
                    </div>
                  </div>
                </dl>

                {/* счётчики */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <CountChip label="батчи сдано" value={snapshot.counts.batches} />
                  <CountChip label="события" value={snapshot.counts.events} />
                  <CountChip label="гейты" value={snapshot.gatesTotal} />
                  <CountChip label="носители" value={snapshot.counts.carriers} />
                  <CountChip label="позы" value={snapshot.counts.poses} />
                  <CountChip label="палитры" value={snapshot.counts.palettes} />
                </div>

                <p className="text-xs leading-relaxed text-zinc-500">
                  {snapshot.gateHealth}
                  {snapshot.openDebts > 0 ? ` · открытых долгов: ${snapshot.openDebts}` : ''}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* дверь в дашборд */}
        <section aria-label="Вход в дашборд" className="mt-auto">
          <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="min-w-0">
              <h2 className="text-base font-medium text-zinc-100">Дашборд конвейера</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                Состояние · Спеки · Сборка · Батчи · Вердикты · Летопись · Стекло — всё ядро в одной вкладке.
              </p>
              <p className="mt-2 font-mono text-[11px] text-zinc-600">
                шлюз: ?XTransformPort=3100 → localhost:3100 · назад — кнопкой браузера
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
              <a
                href={DASHBOARD_URL}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(251,191,36,0.15)] transition-colors hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              >
                Открыть дашборд
                <ExternalLink className="size-4" aria-hidden />
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              >
                <Github className="size-4" aria-hidden />
                GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mt-auto border-t border-zinc-800/80">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5 px-4 py-4 text-[11px] leading-relaxed text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Летопись append-only · законы меняет только вердикт автора (§10) · пусковая страница
            своих записей не ведёт
          </p>
          <p className="font-mono">github.com/theuniqueballs/thread4 · порт дашборда 3100</p>
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Мелкие части                                                        */
/* ------------------------------------------------------------------ */

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
      <p className="font-mono text-xl font-semibold text-amber-300">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  )
}

function StateSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-5" aria-hidden>
      <div className="h-5 w-72 animate-pulse rounded bg-zinc-800/70" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-16 animate-pulse rounded-lg bg-zinc-800/50" />
        <div className="h-16 animate-pulse rounded-lg bg-zinc-800/50" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-lg bg-zinc-800/40" />
        ))}
      </div>
    </div>
  )
}
