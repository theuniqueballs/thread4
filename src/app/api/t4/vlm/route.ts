/**
 * THREAD 4 — VLM первый проход (Constitution §10-поправка): слепой
 * структурный прогон рендера ДО авторского вердикта.
 *
 * Протокол (доказан на T4-04: 24/24 матчинга слотов, все мутации
 * анатомии/вещей пойманы): модель НЕ получает заявку слота — кадр
 * читается фактом, автор сопоставляет прочитанное с заявкой ПОСЛЕ.
 *
 * Мета-законы, зашитые в контракт ответа:
 * - VLM СЛЕП К ТИРАМ В ОБЕ СТОРОНЫ (T4-03: R+ завышал 8/12 против глаза
 *   автора 1/15) — RATING_HINT есть ОРИЕНТИР, не вердикт; финальный тир —
 *   только глаз автора.
 * - X-кадры блокируются контент-фильтром провайдера НА ВХОДЕ в любой
 *   форме (полный кадр, ×0.5, кропы, мозаика — 12+ попыток, все 400/1301):
 *   ответ `blocked: true` = слот неверифицируем VLM-петлёй в принципе.
 * - Машинные прогоны НЕ пишутся в лог событий: лог хранит авторские
 *   вердикты; VLM-флаги уезжают внутри батч-вердикта через приёмник.
 *
 * Ревизия 2026-10-14 (2.23/3.7): роут-«сирота» больше не дублирует слепую
 * логику feedback?blind=true — оба зовут один lib-вызов runBlindVision
 * (один промпт, один парсер, одна детекция фильтра). Этот роут остаётся
 * отладочным входом слепого протокола с полной карточкой в ответе.
 */
import { NextResponse } from 'next/server'

import { requireCommander } from '@/lib/t4/apiguard'
import { imagePayloadError, runBlindVision } from '@/lib/t4/vlm'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): платный VLM-вызов — только с ключом командира. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: { imageBase64?: string; mimeType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const b64 = (body.imageBase64 ?? '').replace(/^data:[^;]+;base64,/, '')
  const mimeType = body.mimeType ?? 'image/png'
  const payloadError = imagePayloadError(b64, mimeType)
  if (payloadError === 'image too large (base64 ≤ 10M символов)') {
    return NextResponse.json({ error: payloadError }, { status: 413 })
  }
  if (payloadError) {
    return NextResponse.json({ error: payloadError }, { status: 400 })
  }

  const r = await runBlindVision(b64, mimeType)
  if (r.ok) {
    return NextResponse.json({ ok: true, card: r.card, raw: r.raw })
  }
  if (r.setupRequired) {
    return NextResponse.json({ ok: false, error: r.error, setupRequired: true }, { status: 503 })
  }
  return NextResponse.json(
    { ok: false, ...(r.blocked ? { blocked: true } : {}), error: r.error },
    { status: r.blocked ? 200 : 502 }
  )
}
