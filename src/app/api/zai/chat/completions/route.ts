/**
 * THREAD 4 — локальный Z.ai-мост (машина автора, 2026-09-25).
 *
 * SDK z-ai-web-dev-sdk зовёт ${baseUrl}/chat/completions — этот роут и есть
 * тот baseUrl. Зачем мост: (1) ключ автора живёт на coding-плане
 * (upstream из .z-ai-config), а не на паушальном контейнерном креде;
 * (2) glm-5.3 всегда думает — thinking:{type:'disabled'} переписывается в low;
 * (3) модель подставляется из конфига, если тело её не несёт.
 * Ключ читается из .z-ai-config (в gitignored) — в репо не попадает.
 *
 * Аудит 2026-10-17 (strict): конфиг и upstream-вызов ушли в общий слой
 * src/lib/t4/zai-bridge.ts (кэш size+mtime — без reparse на каждый вызов;
 * жёсткий дедлайн AbortSignal — повисший провайдер получает 504, а не
 * вечный висячий роут). Роут — тонкий валидатор + маппинг ошибок.
 */
import { NextResponse } from 'next/server'

import { requireCommander } from '@/lib/t4/apiguard'
import { isBridgeTimeout, loadZaiBridgeConfig, postChatCompletion, sdkBearerOk } from '@/lib/t4/zai-bridge'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  /* Аудит 2026-10-12 (High): роут — платный LLM-прокси с Bearer-ключом
   * автора из .z-ai-config; до раунда любой снаружи (через шлюз :81)
   * гонял модель за счёт автора. Ключ командира обязателен. */
  const guard = requireCommander(req)
  if (!guard.ok && !sdkBearerOk(req, 'text')) return guard.response
  const cfg = loadZaiBridgeConfig('text')
  if (!cfg) {
    return NextResponse.json(
      { error: '.z-ai-config не найден или неполон (нужны apiKey + upstream + textModel)' },
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
  if (!body.model) body.model = cfg.model
  // thinking не трогаем: glm-4.5-flash принимает disabled как есть

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
