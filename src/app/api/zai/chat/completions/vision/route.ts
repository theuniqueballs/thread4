/**
 * THREAD 4 — локальный Z.ai-мост, vision-ветка.
 *
 * SDK зовёт ${baseUrl}/chat/completions/vision — публичный z.ai API такого
 * пути не знает (404), поэтому роут переписывает на обычный
 * /chat/completions с vision-моделью из конфига (glm-4.5v) и thinking=low.
 * Модель требует оплаченного баланса: пока его нет, z.ai отвечает 1113 —
 * роут пробрасывает это наверх как есть (UI показывает понятный баннер).
 *
 * Аудит 2026-10-17 (strict): общий слой src/lib/t4/zai-bridge.ts — кэш
 * конфига по size+mtime + жёсткий дедлайн upstream-вызова (504 вместо
 * вечного висячего роута). Роут — тонкий валидатор + маппинг ошибок.
 */
import { NextResponse } from 'next/server'

import { requireCommander } from '@/lib/t4/apiguard'
import { isBridgeTimeout, loadZaiBridgeConfig, postChatCompletion } from '@/lib/t4/zai-bridge'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  /* Аудит 2026-10-12 (High): платный vision-прокси — только с ключом командира. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  const cfg = loadZaiBridgeConfig('vision')
  if (!cfg) {
    return NextResponse.json(
      { error: '.z-ai-config не найден или неполон (нужны apiKey + visionUpstream + visionModel)' },
      { status: 503 }
    )
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  if (!body.model) body.model = cfg.model
  const thinking = body.thinking as { type?: string } | undefined
  if (thinking && (thinking.type === 'disabled' || thinking.type === 'max')) thinking.type = 'low'

  try {
    const upstream = await postChatCompletion(cfg, body)
    return new NextResponse(upstream.text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isBridgeTimeout(e)) {
      return NextResponse.json(
        { error: 'upstream не ответил за дедлайн моста — прокси закрыл соединение' },
        { status: 504 }
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `upstream: ${msg.slice(0, 300)}` }, { status: 502 })
  }
}
