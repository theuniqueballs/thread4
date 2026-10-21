import { NextResponse } from 'next/server'

import { readLocked, requireRead } from '@/lib/t4/apiguard'

import { foldState, nextBatchNumber, readEvents, verifyChain } from '@/lib/t4/events'
import { readChronicle, type Chronicle } from '@/lib/t4/consciousness'
import { specInventory } from '@/lib/t4/specs'
import { gatesHealthFromEvents, GATES_TOTAL } from '@/lib/t4/gates'
import { listFiles, BATCHES_DIR, readCommanderKey, readText } from '@/lib/t4/fsutil'
import { scanSource } from '@/lib/t4/hygiene'
import path from 'node:path'

export const dynamic = 'force-dynamic'

/* Движок-эра (2026-10-17): t4-engine (:3200, bun:sqlite + Bun.serve) —
 * SSoT. Стекло показывает его телеметрию рядом с файловой истиной —
 * честная миграция: движок молчит → строка честно говорит «молчит»,
 * дашборд не падает (degrade, не блокировка). */
const ENGINE_ORIGIN = process.env.T4_ENGINE_ORIGIN ?? 'http://127.0.0.1:3200'
/* Приказ автора 2026-10-19 («перенеси всё что можно на Rust — посмотрим
 * как поведёт себя»): t4-engine-rs (:3201) — Rust twin, полочная портировка
 * движка. Читает продакшн-летопись RO (верифицирует хеш-цепь), пишет свою
 * scratch-летопись. Стекло показывает его телеметрию рядом с bun-SSoT. */
const RUST_ORIGIN = process.env.T4_RUST_ORIGIN ?? 'http://127.0.0.1:3201'

async function engineTelemetry(): Promise<{
  up: boolean
  port: number
  chainHeight?: number
  chainOk?: boolean
  head10?: string | null
  events?: number
  nextSlug?: string
  uptimeSec?: number
  version?: string
  canon?: string
} | null> {
  try {
    const res = await fetch(`${ENGINE_ORIGIN}/v1/state`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })
    if (!res.ok) return { up: false, port: 3200 }
    const json = (await res.json()) as {
      data?: {
        chain?: { height?: number; ok?: boolean; head?: string | null }
        counts?: { events?: number }
        nextSlug?: string
        uptimeSec?: number
        canon?: string
      }
    }
    const d = json.data ?? {}
    return {
      up: true,
      port: 3200,
      chainHeight: d.chain?.height,
      chainOk: d.chain?.ok,
      head10: d.chain?.head?.slice(0, 10) ?? null,
      events: d.counts?.events,
      nextSlug: d.nextSlug,
      uptimeSec: d.uptimeSec,
      canon: d.canon,
    }
  } catch {
    return { up: false, port: 3200 }
  }
}

async function rustTwinTelemetry(): Promise<{
  up: boolean
  port: number
  prodChainHeight?: number
  prodChainOk?: boolean
  prodHead?: string | null
  nextSlug?: string
  lastDelivered?: string
  scratchChainHeight?: number
  uptimeSec?: number
} | null> {
  try {
    const res = await fetch(`${RUST_ORIGIN}/v1/state`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })
    if (!res.ok) return { up: false, port: 3201 }
    const json = (await res.json()) as {
      data?: {
        production?: { chain?: { height?: number; ok?: boolean; head?: string | null }; nextSlug?: string; lastDelivered?: { slug?: string } }
        scratch?: { chain?: { height?: number } }
        uptimeSec?: number
      }
    }
    const d = json.data ?? {}
    return {
      up: true,
      port: 3201,
      prodChainHeight: d.production?.chain?.height,
      prodChainOk: d.production?.chain?.ok,
      prodHead: d.production?.chain?.head?.slice(0, 10) ?? null,
      nextSlug: d.production?.nextSlug,
      lastDelivered: d.production?.lastDelivered?.slug,
      scratchChainHeight: d.scratch?.chain?.height,
      uptimeSec: d.uptimeSec,
    }
  } catch {
    return { up: false, port: 3201 }
  }
}

export async function GET(req: Request) {
  const read = requireRead(req)
  if (!read.ok) return read.response

  /* Фаза 2, итерация 3: сознание — живой движок. Панель состояния читает
   * объединённую хронику (прод-цепь живого движка ∪ свежий файл-хвост).
   * Движок недоступен — панель НЕ молчит: показывает файл-эру с честной
   * меткой деградации (consciousness.degraded=true) — отображение может
   * деградировать, РЕШЕНИЯ (гейты/сборка/сдача) — нет. */
  let chron: Chronicle
  try {
    chron = await readChronicle()
  } catch {
    chron = { events: readEvents(), source: 'file' }
  }
  const events = chron.events
  const state = foldState(events)
  const batches = listFiles(BATCHES_DIR, '.md')
  const inv = specInventory()
  const carriers = inv.find((s) => s.id === 'carriers')
  const poses = inv.find((s) => s.id === 'poses')
  const palettes = inv.find((s) => s.id === 'palettes')
  const delivered = state.batches.filter((b) => b.deliveredAt)
  /* Ревизия 2026-10-14 (категория 3.6): «последний» = последним СДАН по
   * времени, а не последний по алфавиту слагов — foldState сортирует по
   * слагу, и «T4-09» > «T4-10» лексически: будущие T4-100+/с ледяные
   * суффиксы переворачивали бы порядок молча. */
  const last = delivered.reduce<(typeof delivered)[number] | null>(
    (acc, b) => (!acc || (b.deliveredAt ?? '') > (acc.deliveredAt ?? '') ? b : acc),
    null
  )
  // следующий номер — max+1 по всем слагам (аудит 2026-10-12: void-номера
  // НЕ переиспользуются — провенанс закрытого батча неприкосновенен)
  const nextNum = nextBatchNumber(state.batches)
  const nextStep =
    delivered.length === 0
      ? `T4-${String(nextNum).padStart(2, '0')} — ждёт тему от автора`
      : `T4-${String(nextNum).padStart(2, '0')} — следующий цикл`

  /* Ревизия 2026-10-14 (категория 3.8/3.13): gateHealth пересчитывается из
   * receipts ПОСЛЕДНЕГО gate.run (слепки пишутся в каждый прогон — еда
   * Retirement Protocol #18 уже есть, Стекло теперь читает её же). Ручная
   * легенда «№23/№25/№26/№27 + 25–27 квитанций» протухла бы с первым же
   * новым гейтом/батчем — числа теперь живые, источник один: летопись. */
  const health = gatesHealthFromEvents(events)
  const engine = await engineTelemetry()
  const rustTwin = await rustTwinTelemetry()
  const gateHealth = health.lastRun
    ? `hard ${health.hard} · warn ${health.warn} · advisory ${health.advisory}${health.conditional ? ` · +${health.conditional} условных (RAW+/⚗)` : ''} = ${health.runTotal} квитанций — последний прогон ${health.lastRun.slug} #${health.lastRun.run} (${health.lastRun.at.slice(0, 16).replace('T', ' ')}, hard ${health.lastRun.hardPass ? 'PASS' : 'FAIL'}) — счёт из receipts, не из легенды`
    : `hard / warn / advisory — прогонов в летописи нет, база из кода: ${GATES_TOTAL}`

  return NextResponse.json({
    era: 'THREAD 4',
    /* Фаза 2/итерация 3: источник сознания панели — живой движок.
     * composition: { engine, fileTail, total } при живом движке; degraded —
     * движок недоступен, показан файл-эра (решения в это время 503). */
    consciousness: {
      source: chron.source,
      degraded: chron.source === 'file',
      composition: chron.composition ?? null,
      note:
        chron.source === 'engine'
          ? 'фолд состояния: прод-цепь живого движка ∪ свежий файл-хвост (идемпотентно по id)'
          : 'движок недоступен — показано состояние файл-эры; решения (гейты/сборка/сдача) требуют движка',
    },
    lastBatch: last ? `${last.slug}${last.title ? ` «${last.title}»` : ''}` : '— (эра только родилась)',
    nextStep,
    gateHealth,
    gatesTotal: health.lastRun ? health.base : GATES_TOTAL,
    voidedSlugs: state.voidedSlugs,
    counts: {
      batches: delivered.length,
      events: events.length,
      carriers: carriers?.count ?? 0,
      poses: poses?.count ?? 0,
      palettes: palettes?.count ?? 0,
    },
    openDebts: state.openDebts,
    /* Залп 1 «Правда» — здоровье стекла (полный таб «Стекло» — Залп 3) */
    glass: {
      /* Движок-эра: телеметрия RPC-ядра (SSoT) рядом с файловой истиной */
      engine,
      /* Rust twin (:3201) — полочная портировка движка; продакшн-цепь им
       * ПЕРЕЧИТАНА независимо (двойная верификация хеш-формулы) */
      rustTwin,
      commanderKey: readCommanderKey() != null,
      chain: (() => {
        const v = verifyChain()
        return { ok: v.ok, events: v.events, storedLinks: v.storedLinks, head: v.head?.slice(0, 10) ?? null, problems: v.problems }
      })(),
      atomicWrites: true,
      /* Issue #4 Кенни: grep-gate как живой булев (П-2 видно СЕЙЧАС), аптайм
         писца и последняя проверка восстановления — по чертежу Cortex */
      grepGate: scanSource(path.join(process.cwd(), 'src', 'lib', 't4')).length === 0,
      scribeLastDraft:
        events
          .filter((e) => e.type === 'scribe.drafted')
          .at(-1)?.at ?? null,
      /* 2026-10-15: фильтр по data.kind === 'vault-restore', а не по
       * summary.includes('VAULT'). Закрывает prose-matching Issue #1 Кенни:
       * любое событие со словом «VAULT» в summary (напр. oracle.spoke жнеца,
       * рассуждающего о браузерном сейфе) раньше ложно двигало метрику.
       * На старых событиях (до 2026-10-15) kind отсутствует — fallback на
       * summary-эвристику ради совместимости с историей. */
      lastRecoveryCheck:
        events
          .filter(
            (e) =>
              e.type === 'note' &&
              (e.data?.kind === 'vault-restore' ||
                /* legacy fallback: события до 2026-10-15 не несут data.kind */
                (!e.data?.kind && e.summary.includes('VAULT')))
          )
          .at(-1)?.at ?? null,
      /* Метрика 4.2 (ответ автора Q10/Q12): сколько времени жрёт система у
         автора. Цикл = batch.delivered → последний вердикт по этому слагу.
         Цель: 1.5 часа творчества — настройка нас не должна её превышать. */
      authorCycle: (() => {
        const delivered = events.filter((e) => e.type === 'batch.delivered').at(-1)
        if (!delivered) return null
        const slug = String(delivered.data?.slug ?? '')
        const last = events
          .filter((e) => e.type === 'render.verdict' && String(e.data?.slug ?? '') === slug)
          .at(-1)
        if (!last) return { slug, hours: null, note: 'вердиктов ещё нет — цикл не замкнут' }
        const hours =
          Math.round(((new Date(last.at).getTime() - new Date(delivered.at).getTime()) / 3600000) * 10) / 10
        return { slug, hours }
      })(),
      /* Issue #2 + #5 Кенни: доверенная граница чтения — объявлена, а не молчит.
         Слои границы: (1) dev слушает 127.0.0.1 (-H в package.json);
         (2) Caddyfile перед Next — XTransformPort (Issue #5).
         Преемник Фреда, 2026-10-10: слой (2) больше не захардкожен строкой —
         читается из фактического Caddyfile (зажат/штрокер wildcard), чтобы
         Стекло (П-8 «честная хрупкость») не врало при смене машины/сандбокса.
         Раунд 2026-10-12 (ISSUE 15 / #47): read-key РЕАЛИЗОВАН как файл-флаг
         ~/.t4/read.lock — есть файл → GET-роуты требуют ключ командира;
         нет файла → чтение открыто (локальная машина). Стекло репортит
         фактическое состояние флага — не декларацию. */
      readBoundary: (() => {
        const lock = readLocked()
          ? 'read.lock ВКЛЮЧЁН: GET требует x-commander-key'
          : 'read.lock отключён: чтение открыто (локальная машина; включи — коснись ~/.t4/read.lock)'
        const caddy = readText(path.join(process.cwd(), 'Caddyfile'))
        if (caddy == null) {
          return `Caddyfile не читается — граница НЕ объявлена (почини файл) · ${lock}`
        }
        if (/XTransformPort=\*/.test(caddy)) {
          return `gateway :81 → 3000 · XTransformPort=* (платформенный wildcard — режим мини-сервисов; шире замка Issue #5, ворота держит платформа) · dev bind проверять в package.json (-H 127.0.0.1) · ${lock}`
        }
        if (/XTransformPort=3000/.test(caddy)) {
          return `loopback-only: dev -H 127.0.0.1 + Caddyfile XTransformPort зажат на 3000 (проверять оба слоя) · ${lock}`
        }
        return `gateway :81 → 3000 · XTransformPort не распознан в Caddyfile — граница объявлена не полностью · ${lock}`
      })(),
    },
  })
}
