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
 */
import { NextResponse } from 'next/server'

import ZAI from 'z-ai-web-dev-sdk'

import { BLIND_PROMPT, isProviderBlocked, parseBlindCard } from '@/lib/t4/vlm'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  let body: { imageBase64?: string; mimeType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const b64 = (body.imageBase64 ?? '').replace(/^data:[^;]+;base64,/, '')
  if (!b64 || b64.length < 100) {
    return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
  }
  const mimeType = body.mimeType ?? 'image/png'

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: BLIND_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    if (raw.trim() === '') {
      return NextResponse.json({ ok: false, error: 'пустой ответ модели' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, card: parseBlindCard(raw), raw })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isProviderBlocked(msg)) {
      return NextResponse.json({ ok: false, blocked: true, error: msg.slice(0, 300) })
    }
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) }, { status: 500 })
  }
}
