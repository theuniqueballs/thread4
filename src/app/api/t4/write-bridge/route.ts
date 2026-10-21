import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { isConsciousnessError } from '@/lib/t4/consciousness'
import { isEngineDownError, runBridgeCore } from '@/lib/t4/bridge-core'

export const dynamic = 'force-dynamic'

/**
 * WRITE-мост (фаза 2, итерация 2; фаза 3 — ядро вынесено в bridge-core):
 * план живого движка → богатый контракт писца. Источник плана — RPC twin'а
 * (t4-engine-rs :3201): prod-планы читаются из прод-летописи RO
 * (/v1/batches/:slug), сборки воркфлоу — из scratch (/v1/scratch/batches/:slug).
 * Это и есть осознанный шаг «источник сознания — живой движок» для
 * WRITE-слоя: у файл-эры движковых планов НЕТ.
 *
 * Фаза 3 (оркестратор): исполняемое ядро переехало в
 * src/lib/t4/bridge-core.ts (runBridgeCore) — тот же код обслуживает и CLI
 * (t4 expose / t4 auto), дрейфа между HTTP-край и циклом нет. Здесь остались
 * только guard + маппинг ошибок в HTTP.
 *
 * Квитанция — событие bridge.compiled в файл-летописи (data.source, sha10,
 * engineEvents — высота прод-цепи движка на момент моста).
 *
 * Тело: { slug: 'T4-NN', source?: 'prod' | 'scratch' } — без source мост
 * пробует scratch, затем prod (порядок честный: сборки воркфлоу младше).
 * Слот со статусом отличным от compiled — 422 (сданный/закрытый батч
 * контракта не перестраивается).
 */
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
  const source = body.source === 'prod' || body.source === 'scratch' ? body.source : undefined

  try {
    const r = await runBridgeCore((body.slug ?? '').trim(), { source })
    return NextResponse.json({
      slug: r.slug,
      source: r.source,
      markdown: r.markdown,
      contract: r.contract,
      bridgeNote: r.bridgeNote,
      event: r.event,
    })
  } catch (e) {
    if (e instanceof Error && /slug обязателен/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    if (e instanceof Error && /статусе/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    if (e instanceof Error && /нет плана/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    if (isEngineDownError(e)) {
      const engineDown = !/не найден/.test(e.message)
      return NextResponse.json(
        { error: e.message, attempts: e.attempts },
        { status: engineDown ? 503 : 404 }
      )
    }
    if (isConsciousnessError(e)) {
      return NextResponse.json({ error: e.message, consciousness: 'unavailable' }, { status: 503 })
    }
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'bridge failed' },
      { status: 500 }
    )
  }
}
