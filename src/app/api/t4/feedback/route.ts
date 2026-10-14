/**
 * THREAD 4 — VLM render-feedback loop (constitution §12 cycle step 8).
 * Backend-only z-ai-web-dev-sdk.
 *
 * Два режима:
 * - blind: true (панель «VLM первый проход» / «Куча») — слепой структурный
 *   прогон по единому протоколу src/lib/t4/vlm.ts: карточка-факт, детекция
 *   контент-фильтра (X-кадры неверифицирумы), БЕЗ записи в лог событий
 *   (лог хранит только авторские вердикты — флаги уезжают через приёмник).
 * - без blind — классический 5-осевой разбор (§56C) с записью render.verdict.
 */
import { NextResponse } from 'next/server'

import ZAI from 'z-ai-web-dev-sdk'

import { appendEvent } from '@/lib/t4/events'
import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { imagePayloadError, isProviderBlocked, runBlindVision } from '@/lib/t4/vlm'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const PROMPT = `You are the render analyst of an anime-art prompt pipeline. Analyze this rendered image honestly and return STRICT JSON only (no markdown fences, no prose):

{
  "silhouette": 0-2,   // 0 muddled mass, 1 readable, 2 iconic shape
  "lead_read": 0-2,    // 0 lead zone lost, 1 present, 2 first read
  "witness": 0-2,      // 0 absent, 1 present, 2 dominates frame (a witness object: mirror, monitor, glass...)
  "physics_read": 0-2, // 0 reads as filter, 1 reads as claim, 2 reads as law (the world-law visible?)
  "scroll_stop": 0-2,  // 0 scroll past, 1 pause, 2 stop + revisit
  "rating_rendered": "PG-13 | R | R+ | X",
  "pose_strong": true/false,   // is the pose striking or a standing default?
  "face_register": "student | young woman | milf | unclear",
  "notes": "one or two short sentences, the most important thing the author should know"
}

Judge only what is visible. Numbers are integers.`

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): платный VLM-вызов + запись render.verdict
   * в летопись — только с ключом командира. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: { imageBase64?: string; slug?: string; position?: string; mimeType?: string; blind?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const b64 = (body.imageBase64 ?? '').replace(/^data:[^;]+;base64,/, '')
  const mimeType = body.mimeType ?? 'image/png'
  /* Ревизия 2026-10-14 (2.23/3.7): капа + allowlist — общий гвард
   * imagePayloadError из lib/vlm (была копипастой между роутами) */
  const payloadError = imagePayloadError(b64, mimeType)
  if (payloadError === 'image too large (base64 ≤ 10M символов)') {
    return NextResponse.json({ error: payloadError }, { status: 413 })
  }
  if (payloadError) {
    return NextResponse.json({ error: payloadError }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  const position = (body.position ?? '').trim()

  try {
    const zai = await ZAI.create()

    /* ---- слепой режим: единый протокол, карточка, без лога.
       * Ревизия 2026-10-14: вызов консолидирован в runBlindVision (lib) —
       * один промпт, один парсер, одна детекция фильтра на оба роута. ---- */
    if (body.blind) {
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

    /* ---- классический 5-осевой разбор (с записью события) ---- */
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
          ],
        },
      ],
      model: 'glm-4.5v',
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonMatch = /\{[\s\S]*\}/.exec(raw)
    let analysis: Record<string, unknown> = { raw }
    if (jsonMatch) {
      try {
        analysis = JSON.parse(jsonMatch[0])
      } catch {
        analysis = { raw }
      }
    }
    const where = [slug, position].filter(Boolean).join(' · ') || 'render'
    const scores = [
      analysis.silhouette,
      analysis.lead_read,
      analysis.witness,
      analysis.physics_read,
      analysis.scroll_stop,
    ]
      .map((x) => (typeof x === 'number' ? x : 0))
      .reduce((a, b) => a + b, 0)
    appendEvent(
      'render.verdict',
      `VLM-разбор (${where}): оси ${scores}/10 · рендер-тир ${String(analysis.rating_rendered ?? '?')} · поза ${analysis.pose_strong ? 'сильная' : 'дефолт'} — ${String(analysis.notes ?? '').slice(0, 140)}`,
      { slug, position, source: 'vlm', analysis }
    )
    return NextResponse.json({ ok: true, analysis })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Контент-фильтр провайдера: кадр не принят НА ВХОДЕ → слот
    // неверифицируем VLM-петлёй (X-кадры, T4-04: 12+ попыток, все 400/1301)
    if (isProviderBlocked(msg)) {
      return NextResponse.json({ ok: false, blocked: true, message: 'Контент-фильтр провайдера (400/1301)' })
    }
    // VLM не настроен на этой машине (нет .z-ai-config) — структурированный
    // 503: UI гасит очередь и показывает setup-баннер, а не N одинаковых 500
    if (/Configuration file not found|z-ai-config/i.test(msg)) {
      return NextResponse.json(
        { ok: false, error: 'VLM не настроен: нет .z-ai-config (ключ Z.ai) на этой машине', setupRequired: true },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: clientErrorMessage(e).slice(0, 300) }, { status: 500 })
  }
}
