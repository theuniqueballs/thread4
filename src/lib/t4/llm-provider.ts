/**
 * THREAD 4 — LLM-PROVIDER: конфигурируемый провайдер писца (Задача 1, МОЩНОСТЬ).
 *
 * Провайдер выбирается переменной окружения T4_SCRIBE_PROVIDER:
 *   · zai       (ДЕФОЛТ) — платформенный z-ai-web-dev-sdk, ключ не нужен;
 *                используется и в CLI, и в API-роуте (SDK — только бэкенд).
 *   · openai    — POST {T4_SCRIBE_BASE_URL|https://api.openai.com}/v1/chat/completions,
 *                ключ T4_SCRIBE_API_KEY, модель T4_SCRIBE_MODEL (обязательны).
 *   · anthropic — POST {T4_SCRIBE_BASE_URL|https://api.anthropic.com}/v1/messages,
 *                ключ T4_SCRIBE_API_KEY, модель T4_SCRIBE_MODEL (обязательны).
 *   · custom    — OpenAI-совместимый эндпоинт: полный URL в T4_SCRIBE_BASE_URL,
 *                опциональный T4_SCRIBE_API_KEY (bearer), модель T4_SCRIBE_MODEL.
 *
 * Правила (спецификация автора):
 *   · НИКАКИХ ключей в коде — только .env (bun подхватывает .env из корня
 *     и для CLI, и для Next-роутов).
 *   · Ошибка конфигурации/сети — ПОНЯТНОЕ сообщение (what + which env var),
 *     а не падение стека. Переходящие сбои (429/5xx/сеть) ретраятся
 *     на уровне chat() писца (isTransientLlmError).
 */
import ZAI from 'z-ai-web-dev-sdk'

import { isTransientLlmError } from './llm-guard'

export interface LlmCompleteOpts {
  /** Номер попытки chat() (0 — первая): zai-провайдер на ретрае уходит
   *  на assistant-роль (капризы upstream, аудит 2026-10-12). */
  attempt: number
}

export interface LlmProvider {
  /** Имя провайдера — для логов и понятных ошибок. */
  name: string
  complete(system: string, user: string, opts: LlmCompleteOpts): Promise<string>
}

export type ProviderEnv = Record<string, string | undefined>

/* ------------------------------------------------------------------ */
/* Ошибки конфигурации — понятные, с именем переменной                */
/* ------------------------------------------------------------------ */

class ProviderConfigError extends Error {
  constructor(provider: string, what: string, envHint: string) {
    super(`LLM-провайдер «${provider}»: ${what}. ${envHint} Ключи и эндпоинты — ТОЛЬКО через .env (хардкод запрещён); дефолтный провайдер zai ключа не требует (T4_SCRIBE_PROVIDER=zai).`)
  }
}

function requiredEnv(env: ProviderEnv, provider: string, key: string, what: string): string {
  const v = env[key]?.trim()
  if (!v) throw new ProviderConfigError(provider, what, `Задай ${key} в .env.`)
  return v
}

/* ------------------------------------------------------------------ */
/* zai — дефолт платформы (SDK, без ключа)                            */
/* ------------------------------------------------------------------ */

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>

function zaiProvider(): LlmProvider {
  let client: ZaiClient | null = null
  return {
    name: 'zai',
    async complete(system, user, opts) {
      try {
        if (client == null) client = await ZAI.create()
        const completion = await client.chat.completions.create({
          messages: [
            /* Залп 3: system — системной ролью; при капризах upstream
             * первый ретрай откатывается на assistant-совместимость */
            { role: opts.attempt === 0 ? 'system' : 'assistant', content: system },
            { role: 'user', content: user },
          ],
          thinking: { type: 'disabled' },
        })
        return completion.choices[0]?.message?.content ?? ''
      } catch (e) {
        /* конфигурация zai не требует ключа — любые сбои здесь
         * сетевые/сервисные; оборачиваем с именем провайдера */
        if (e instanceof Error && isTransientLlmError(e)) throw e
        throw new Error(
          `zai-провайдер не ответил: ${e instanceof Error ? e.message : String(e)} (платформенный SDK, ключа не требует — проверь доступность LLM-сервиса; выбор другого провайдера — T4_SCRIBE_PROVIDER в .env)`
        )
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* HTTP-провайдеры (openai / anthropic / custom)                      */
/* ------------------------------------------------------------------ */

const HTTP_TIMEOUT_MS = 180_000

async function httpJson(provider: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
  } catch (e) {
    throw new Error(
      `${provider}: ${e instanceof Error ? e.message : String(e)} — эндпоинт ${url} недоступен (сеть/таймаут; проверь T4_SCRIBE_BASE_URL в .env)`
    )
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${provider}: HTTP ${res.status} от ${url}${body ? ` — ${body.slice(0, 300)}` : ''}`)
  }
  return res.json()
}

function openAiShapeProvider(name: string, url: string, apiKey: string | undefined, model: string): LlmProvider {
  return {
    name,
    async complete(system, user) {
      const json = (await httpJson(name, url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })) as { choices?: { message?: { content?: string } }[] }
      return json.choices?.[0]?.message?.content ?? ''
    },
  }
}

function anthropicProvider(base: string, apiKey: string, model: string): LlmProvider {
  return {
    name: 'anthropic',
    async complete(system, user) {
      const json = (await httpJson('anthropic', `${base.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })) as { content?: { text?: string }[] }
      return json.content?.map((c) => c.text ?? '').join('') ?? ''
    },
  }
}

/* ------------------------------------------------------------------ */
/* Резолвер                                                           */
/* ------------------------------------------------------------------ */

export function resolveLlmProvider(env: ProviderEnv = process.env): LlmProvider {
  const provider = (env['T4_SCRIBE_PROVIDER'] ?? 'zai').trim().toLowerCase()
  switch (provider) {
    case '':
    case 'zai':
      return zaiProvider()
    case 'openai': {
      const apiKey = requiredEnv(env, 'openai', 'T4_SCRIBE_API_KEY', 'не задан ключ')
      const model = requiredEnv(env, 'openai', 'T4_SCRIBE_MODEL', 'не задана модель')
      const base = (env['T4_SCRIBE_BASE_URL'] ?? 'https://api.openai.com').replace(/\/$/, '')
      return openAiShapeProvider('openai', `${base}/v1/chat/completions`, apiKey, model)
    }
    case 'anthropic': {
      const apiKey = requiredEnv(env, 'anthropic', 'T4_SCRIBE_API_KEY', 'не задан ключ')
      const model = requiredEnv(env, 'anthropic', 'T4_SCRIBE_MODEL', 'не задана модель')
      const base = (env['T4_SCRIBE_BASE_URL'] ?? 'https://api.anthropic.com').replace(/\/$/, '')
      return anthropicProvider(base, apiKey, model)
    }
    case 'custom': {
      const url = requiredEnv(env, 'custom', 'T4_SCRIBE_BASE_URL', 'не задан эндпоинт (полный URL OpenAI-совместимого /chat/completions)')
      const model = requiredEnv(env, 'custom', 'T4_SCRIBE_MODEL', 'не задана модель')
      return openAiShapeProvider('custom', url, env['T4_SCRIBE_API_KEY']?.trim(), model)
    }
    default:
      throw new ProviderConfigError(
        provider,
        'неизвестный провайдер',
        'Допустимо: zai (дефолт) | openai | anthropic | custom — проверь T4_SCRIBE_PROVIDER в .env.'
      )
  }
}
