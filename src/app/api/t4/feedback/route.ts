/**
 * THREAD 4 — VLM render-feedback loop (constitution §12 cycle step 8).
 * The author said «если хочешь — можем попробовать» — trying.
 * Backend-only z-ai-web-dev-sdk. Upload a render → structured frame read
 * on the 3.2 §56C five axes → render.verdict event.
 */
import { NextResponse } from 'next/server'

import ZAI from 'z-ai-web-dev-sdk'

import { appendEvent } from '@/lib/t4/events'

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
  let body: { imageBase64?: string; slug?: string; position?: string; mimeType?: string }
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
  const slug = (body.slug ?? '').trim()
  const position = (body.position ?? '').trim()

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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'VLM failed' },
      { status: 500 }
    )
  }
}
