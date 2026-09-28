/**
 * THREAD 4 — локальный Z.ai-мост (машина автора, 2026-09-25).
 *
 * SDK z-ai-web-dev-sdk зовёт ${baseUrl}/chat/completions — этот роут и есть
 * тот baseUrl. Зачем мост: (1) ключ автора живёт на coding-плане
 * (upstream из .z-ai-config), а не на паушальном контейнерном креде;
 * (2) glm-5.3 всегда думает — thinking:{type:'disabled'} переписывается в low;
 * (3) модель подставляется из конфига, если тело её не несёт.
 * Ключ читается из .z-ai-config (в gitignored) — в репо не попадает.
 */
import { NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface ZaiConfig {
  apiKey: string
  upstream: string
  textModel: string
}

function loadConfig(): ZaiConfig | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.z-ai-config'), 'utf-8')
    const cfg = JSON.parse(raw) as ZaiConfig
    if (cfg.apiKey && cfg.upstream) return cfg
    return null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const cfg = loadConfig()
  if (!cfg) {
    return NextResponse.json(
      { error: '.z-ai-config не найден или неполон (нужны apiKey + upstream)' },
      { status: 503 }
    )
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  // модель из конфига, если запрос её не назвал
  if (!body.model) body.model = cfg.textModel
  // thinking не трогаем: glm-4.5-flash принимает disabled как есть

  try {
    const upstream = await fetch(`${cfg.upstream}/chat/completions`, {
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
