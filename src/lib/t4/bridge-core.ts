/**
 * THREAD 4 — WRITE-мост, исполняемое ядро (фаза 3, оркестратор).
 *
 * ДО: логика моста жила ТОЛЬКО в POST /api/t4/write-bridge (HTTP-край).
 * Оркестратору цикла (t4 auto / t4 expose) нужен тот же мост БЕЗ HTTP —
 * дублировать тело роута = два моста, которые разъезжаются (дрейф канона
 * итерации 2 уже показывал, чем кончается 21≠23).
 *
 * ПОСЛЕ: роут и CLI зовут ОДНО ядро runBridgeCore — то же поведение
 * байт-в-байт (план живого движка → богатый контракт, квитанция
 * bridge.compiled). Роут добавляет guard+HTTP, CLI — шаг цикла.
 *
 * Честность: план читается ТОЛЬКО у живого движка (scratch → prod);
 * движок недоступен → EngineDownError (роут мапит в 503, оркестратор —
 * в честный стоп с отчётом). Никаких файл-эровых выдумок планов.
 */
import { contractMarkdown, lastCompiledRoster } from './compiler'
import { appendEvent, foldState } from './events'
import { consciousnessEvents, warmConsciousness } from './consciousness'
import { CONTRACTS_DIR, listFiles, readJson, writeJson, writeText } from './fsutil'
import type { BatchContract } from './compiler'
import { planToContract, usedExpLettersOfContracts, type EnginePlan } from './write-bridge'

/** Origin twin'а читается НА КАЖДЫЙ вызов (CLI-бенч задаёт T4_RUST_ORIGIN
 *  до старта процесса; тесты могут подменять между вызовами). */
export function twinOrigin(): string {
  return process.env.T4_RUST_ORIGIN ?? 'http://127.0.0.1:3201'
}

/** Движок не отвечает / ответил не то — ЧЕСТНО (503-семантика эпохи). */
export class EngineDownError extends Error {
  readonly attempts: string[]
  constructor(message: string, attempts: string[]) {
    super(message)
    this.name = 'EngineDownError'
    this.attempts = attempts
  }
}

export function isEngineDownError(e: unknown): e is EngineDownError {
  return e instanceof EngineDownError
}

export interface EngineBatchDetail {
  slug?: string
  status?: string
  plan?: EnginePlan | null
}

/** GET плана у twin'а: prod (/v1/batches/:slug, RO) или scratch
 *  (/v1/scratch/batches/:slug, сборки воркфлоу). Чистый HTTP-адаптер. */
export async function fetchPlan(
  slug: string,
  source: 'prod' | 'scratch',
  timeoutMs = 8000
): Promise<{ res?: EngineBatchDetail; notFound?: boolean; error?: string }> {
  const pathSeg = source === 'scratch' ? 'scratch/batches' : 'batches'
  try {
    const res = await fetch(`${twinOrigin()}/v1/${pathSeg}/${slug}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404) return { notFound: true }
    if (!res.ok) {
      return { error: `движок ответил HTTP ${res.status} на /v1/${pathSeg}/${slug}` }
    }
    const raw: unknown = await res.json()
    const data = (raw as { data?: EngineBatchDetail }).data
    if (!data || typeof data !== 'object') return { error: 'движок вернул не envelope' }
    return { res: data }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'движок не отвечает' }
  }
}

/** План слага с живого движка (auto: scratch → prod). Не найден никуда —
 *  честный 404-подобный отказ; движок молчит — EngineDownError. */
export async function fetchPlanAuto(
  slug: string,
  source?: 'prod' | 'scratch'
): Promise<{ detail: EngineBatchDetail; resolvedSource: 'scratch' | 'prod' }> {
  const attempts: ('scratch' | 'prod')[] = source ? [source] : ['scratch', 'prod']
  let detail: EngineBatchDetail | null = null
  let resolvedSource: 'scratch' | 'prod' | null = null
  const errors: string[] = []
  for (const src of attempts) {
    const r = await fetchPlan(slug, src)
    if (r.res) {
      detail = r.res
      resolvedSource = src
      break
    }
    if (r.notFound) errors.push(`${src}: сборки нет`)
    else if (r.error) errors.push(`${src}: ${r.error}`)
  }
  if (errors.length > 0 && detail == null) {
    const engineDown = errors.some((e) => /не отвечает|ECONNREFUSED|fetch failed|timeout|aborted/i.test(e))
    throw new EngineDownError(
      engineDown
        ? `движок (twin ${twinOrigin()}) не поднят — WRITE-мост читает план только у живого движка (mini-services/t4-engine-rs/dev.sh)`
        : `план ${slug} не получен: ${errors.join(' · ')}`,
      errors
    )
  }
  if (detail == null || resolvedSource == null) {
    throw new EngineDownError(`план ${slug} не найден ни в scratch, ни в prod`, errors)
  }
  return { detail, resolvedSource }
}

export interface BridgeRunResult {
  slug: string
  source: 'scratch' | 'prod'
  contract: BatchContract
  markdown: string
  bridgeNote: string
  planSha10: string | null
  planSlots: number
  engineEvents: number | null
  event: { id: string; at: string; type: string; summary: string }
}

/**
 * Исполняемое ядро WRITE-моста: план движка → богатый контракт (json+md)
 * + квитанция bridge.compiled. Логика 1-в-1 с бывшим телом роута.
 */
export async function runBridgeCore(
  slugArg: string,
  opts: { source?: 'prod' | 'scratch' } = {}
): Promise<BridgeRunResult> {
  const slug = slugArg.trim().toUpperCase()
  if (!/^T4-\d{2,3}$/.test(slug)) {
    throw new Error('slug обязателен, канонический T4-NN')
  }

  /* --- план с живого движка (auto: scratch → prod) --- */
  const { detail, resolvedSource } = await fetchPlanAuto(slug, opts.source)
  if (detail.status !== 'compiled') {
    throw new Error(
      `батч ${slug} в статусе «${detail.status ?? '—'}» — мост перестраивает только compiled (сданный/закрытый контракт не трогаем)`
    )
  }
  const plan = detail.plan
  if (!plan || !Array.isArray(plan.slots) || plan.slots.length === 0) {
    throw new Error(`у батча ${slug} нет плана (payload пуст) — мосту нечего обогащать`)
  }

  /* Фаза 2, итерация 3: состояние моста — из хроники живого движка
   * (прод-цепь ∪ свежий файл-хвост): окно, счётчики ОС, каскад несданных.
   * Прогрев до фолда; движок недоступен — честный отказ (мост и так читает
   * план только у живого движка — единая доктрина эпохи). */
  await warmConsciousness()
  const state = foldState(consciousnessEvents())
  const cascade = lastCompiledRoster(state, slug)
  const existing = listFiles(CONTRACTS_DIR, '.json').map((f) =>
    readJson<BatchContract>(`${CONTRACTS_DIR}/${f.name}`)
  )
  /* Скан EXP-ряда — БЕЗ мостуемого слага: переподъём того же плана обязан
   * давать тот же контракт (референциальная прозрачность моста), иначе
   * второй прогон кормится буквами собственного прошлого прогона. */
  const usedExpLetters = usedExpLettersOfContracts(
    existing.filter(
      (c): c is BatchContract =>
        c != null && Array.isArray(c.slots) && c.slug !== slug
    )
  )

  /* --- адаптер (детерминированный) --- */
  const { contract, bridgeNote } = planToContract(plan, {
    slug,
    state,
    cascade,
    usedExpLetters,
  })

  /* --- высота прод-цепи движка на момент моста (квитанция источника) --- */
  let engineEvents: number | null = null
  try {
    const st = await fetch(`${twinOrigin()}/v1/state`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (st.ok) {
      const body2 = (await st.json()) as { data?: { production?: { events?: number } } }
      engineEvents = body2.data?.production?.events ?? null
    }
  } catch {
    /* высота — факультатив: основная квитанция уже в bridgeNote */
  }

  /* --- запись: контракт (json + md) + квитанция в летопись --- */
  writeJson(`${CONTRACTS_DIR}/${slug}.json`, contract)
  writeText(`${CONTRACTS_DIR}/${slug}.md`, contractMarkdown(contract))
  const evt = appendEvent(
    'bridge.compiled',
    `${slug}: WRITE-мост — план живого движка (sha10 ${plan.sha10 ?? '—'}, ${plan.slots.length} слотов, источник ${resolvedSource}) → богатый контракт писца (${contract.slots.length} слотов, законы ${Object.keys(contract.laws).length})`,
    {
      slug,
      source: resolvedSource,
      sha10: plan.sha10 ?? null,
      engineEvents,
      planSlots: plan.slots.length,
      contractSlots: contract.slots.length,
      ocRotation: contract.ocRotation.map((o) => o.name),
    }
  )

  return {
    slug,
    source: resolvedSource,
    contract,
    markdown: contractMarkdown(contract),
    bridgeNote,
    planSha10: plan.sha10 ?? null,
    planSlots: plan.slots.length,
    engineEvents,
    event: { id: evt.id, at: evt.at, type: evt.type, summary: evt.summary },
  }
}
