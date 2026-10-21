import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { contractMarkdown, lastCompiledRoster } from '@/lib/t4/compiler'
import { appendEvent, foldState, readEvents } from '@/lib/t4/events'
import { CONTRACTS_DIR, listFiles, readJson, writeJson, writeText } from '@/lib/t4/fsutil'
import type { BatchContract } from '@/lib/t4/compiler'
import {
  planToContract,
  usedExpLettersOfContracts,
  type EnginePlan,
} from '@/lib/t4/write-bridge'

export const dynamic = 'force-dynamic'

/**
 * WRITE-мост (фаза 2, итерация 2): план живого движка → богатый контракт
 * писца. Источник плана — RPC twin'а (t4-engine-rs :3201): prod-планы
 * читаются из прод-летописи RO (/v1/batches/:slug), сборки воркфлоу — из
 * scratch (/v1/scratch/batches/:slug). Это и есть осознанный шаг «источник
 * сознания — живой движок» для WRITE-слоя: у файл-эры движковых планов НЕТ.
 *
 * Квитанция — событие bridge.compiled в файл-летописи (data.source, sha10,
 * engineEvents — высота прод-цепи движка на момент моста).
 *
 * Тело: { slug: 'T4-NN', source?: 'prod' | 'scratch' } — без source мост
 * пробует scratch, затем prod (порядок честный: сборки воркфлоу младше).
 * Слот со статусом отличным от compiled — 422 (сданный/закрытый батч
 * контракта не перестраивается).
 */

const TWIN_ORIGIN = process.env.T4_RUST_ORIGIN ?? 'http://127.0.0.1:3201'
const SLUG_RE = /^T4-\d{2,3}$/

interface EngineBatchDetail {
  slug?: string
  status?: string
  plan?: EnginePlan | null
}

async function fetchPlan(
  slug: string,
  source: 'prod' | 'scratch'
): Promise<{ res?: EngineBatchDetail; notFound?: boolean; error?: string }> {
  const pathSeg = source === 'scratch' ? 'scratch/batches' : 'batches'
  try {
    const res = await fetch(`${TWIN_ORIGIN}/v1/${pathSeg}/${slug}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
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

export async function POST(req: Request) {
  /* Мост пишет контракт на диск и квитанцию в летопись — только командир */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response

  let body: { slug?: string; source?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim().toUpperCase()
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug обязателен, канонический T4-NN' }, { status: 400 })
  }
  const source = body.source === 'prod' || body.source === 'scratch' ? body.source : null

  /* --- план с живого движка (auto: scratch → prod) --- */
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
    const engineDown = errors.some((e) => /не отвечает|ECONNREFUSED|fetch failed/i.test(e))
    return NextResponse.json(
      {
        error: engineDown
          ? 'движок (twin :3201) не поднят — WRITE-мост читает план только у живого движка (mini-services/t4-engine-rs/dev.sh)'
          : `план ${slug} не получен: ${errors.join(' · ')}`,
        attempts: errors,
      },
      { status: engineDown ? 503 : 404 }
    )
  }
  if (detail == null || resolvedSource == null) {
    return NextResponse.json(
      { error: `план ${slug} не найден ни в scratch, ни в prod` },
      { status: 404 }
    )
  }
  if (detail.status !== 'compiled') {
    return NextResponse.json(
      {
        error: `батч ${slug} в статусе «${detail.status ?? '—'}» — мост перестраивает только compiled (сданный/закрытый контракт не трогаем)`,
        status: detail.status,
      },
      { status: 422 }
    )
  }
  const plan = detail.plan
  if (!plan || !Array.isArray(plan.slots) || plan.slots.length === 0) {
    return NextResponse.json(
      { error: `у батча ${slug} нет плана (payload пуст) — мосту нечего обогащать` },
      { status: 422 }
    )
  }

  try {
    /* --- состояние файл-эры: окно, счётчики ОС, каскад несданных --- */
    const state = foldState(readEvents())
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
      const st = await fetch(`${TWIN_ORIGIN}/v1/state`, {
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

    return NextResponse.json({
      slug,
      source: resolvedSource,
      markdown: contractMarkdown(contract),
      contract,
      bridgeNote,
      event: { id: evt.id, at: evt.at, type: evt.type, summary: evt.summary },
    })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'bridge failed' },
      { status: 500 }
    )
  }
}
