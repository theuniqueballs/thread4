/**
 * THREAD 4 — локальный Z.ai-мост, vision-ветка.
 *
 * SDK зовёт ${baseUrl}/chat/completions/vision — публичный z.ai API такого
 * пути не знает (404), поэтому роут переписывает на обычный
 * /chat/completions с vision-моделью из конфига (glm-4.5v) и thinking=low.
 * Модель требует оплаченного баланса: пока его нет, z.ai отвечает 1113 —
 * роут пробрасывает это наверх как есть (UI показывает понятный баннер).
 */
import { NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface ZaiConfig {
  apiKey: string
  visionUpstream: string
  visionModel: string
}

function loadConfig(): ZaiConfig | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.z-ai-config'), 'utf-8')
    const cfg = JSON.parse(raw) as ZaiConfig
    if (cfg.apiKey && cfg.visionUpstream) return cfg
    return null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const cfg = loadConfig()
  if (!cfg) {
    return NextResponse.json(
      { error: '.z-ai-config не найден или неполон (нужны apiKey + visionUpstream)' },
      { status: 503 }
    )
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  if (!body.model) body.model = cfg.visionModel
  const thinking = body.thinking as { type?: string } | undefined
  if (thinking && (thinking.type === 'disabled' || thinking.type === 'max')) thinking.type = 'low'

  try {
    const upstream = await fetch(`${cfg.visionUpstream}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `upstream: ${msg.slice(0, 300)}` }, { status: 502 })
  }
}
