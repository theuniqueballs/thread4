/**
 * THREAD 4 — VLM первый проход (Constitution §10-поправка): слепой
 * структурный прогон рендера ДО авторского вердикта.
 *
 * Протокол (доказан на T4-04: 24/24 матчинга слотов, все мутации
 * анатомии/вещей пойманы): модель НЕ получает заявку слота — кадр
 * читается фактом (сцена / персонаж / одежда+состояние ткани / поза /
 * видимые сигналы), автор сопоставляет прочитанное с заявкой ПОСЛЕ.
 *
 * Мета-законы, зашитые в контракт ответа:
 * - VLM СЛЕП К ТИРАМ В ОБЕ СТОРОНЫ (T4-03: R+ завышал 8/12 против глаза
 *   автора 1/15; T4-04: R занижал до PG-13) — поле `delivered` ниже есть
 *   ОРИЕНТИР, не вердикт; финальный тир — только глаз автора.
 * - X-кадры блокируются контент-фильтром провайдера НА ВХОДЕ в любой
 *   форме (полный кадр, ×0.5, кропы, мозаика — 12+ попыток, все 400/1301):
 *   ответ `blocked: true` = слот неверифицируем VLM-петлёй в принципе.
 * - Машинные прогоны НЕ пишутся в лог событий: лог хранит авторские
 *   вердикты; VLM-флаги уезжают внутри батч-вердикта через приёмник.
 */
import { NextResponse } from 'next/server'

import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SCALE = `HOUSE RATING SCALE (anime ecchi imagery, judge ONLY what is actually visible in the render):
- PG13 (tease): sexy outfit, bikini, cleavage, thighs, midriff, bare shoulders — no underwear focus.
- R (underwear): underwear visible AND a focus of the frame (panties, bra, upskirt, microbikini, erotic pose with underwear showing), but nothing beyond.
- R+ (edge): at least ONE hard edge signal actually VISIBLE: cameltoe (cleft/mound outline readable through a garment), visible pantyline, taped nipples, topless-with-tape, handbra, or nipples/cleft clearly readable THROUGH sheer/wet fabric.
- X (bare): bare breasts with visible nipples, or bare exposed genitals/buttocks.
Judge conservatively: if a signal is not clearly readable in the image, it did NOT happen.`

const PROMPT = `You are auditing a rendered anime ecchi image for a production pipeline. ${SCALE}

Answer in EXACTLY this format (plain text, no markdown):
SCENE: <one dense line: setting, lighting>
CHARACTER: <hair color+style; special anatomy if any (horns/ears/scales/vines/tail/wings/fire crest/ball joints/seams); skin tone>
WEAR: <every visible garment + its FABRIC STATE: dry / damp / soaked-wet / sheer-see-through / opaque>
POSE: <body position, camera angle, where the frame's attention sits>
SIGNALS_SEEN: <comma list of erotic signals ACTUALLY VISIBLE: e.g. cleavage, panties, upskirt, cameltoe, pantyline, taped nipples, nipples through fabric, wet see-through fabric, topless, bare breasts, none>
DELIVERED: <PG13 | R | R+ | X — the tier the render actually delivers>
WHY: <one short sentence justifying the tier>`

export interface VlmRead {
  scene: string
  character: string
  wear: string
  pose: string
  signals: string[]
  delivered: string
  why: string
}

function field(raw: string, key: string): string {
  const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im').exec(raw)
  return m ? m[1].trim() : ''
}

/** Строгий разбор анкеты: SCENE/CHARACTER/…/WHY → VlmRead. */
export function parseRead(raw: string): VlmRead {
  const signals = field(raw, 'SIGNALS_SEEN')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s.toLowerCase() !== 'none')
  const deliveredRaw = field(raw, 'DELIVERED').toUpperCase().replace(/[\s_-]+/g, '')
  const delivered =
    deliveredRaw === 'PG13'
      ? 'PG-13'
      : ['R', 'R+', 'X'].includes(deliveredRaw)
        ? deliveredRaw
        : field(raw, 'DELIVERED')
  return {
    scene: field(raw, 'SCENE'),
    character: field(raw, 'CHARACTER'),
    wear: field(raw, 'WEAR'),
    pose: field(raw, 'POSE'),
    signals,
    delivered,
    why: field(raw, 'WHY'),
  }
}

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
            { type: 'text', text: PROMPT },
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
    return NextResponse.json({ ok: true, read: parseRead(raw), raw })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Контент-фильтр провайдера: кадр не принят НА ВХОДЕ → слот
    // неверифицируем VLM-петлёй (X-кадры, T4-04: 12+ попыток, все 400/1301)
    if (/contentFilter|1301|系统检测|unsafe|sensitive/i.test(msg)) {
      return NextResponse.json({ ok: false, blocked: true, error: msg.slice(0, 300) })
    }
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) }, { status: 500 })
  }
}
