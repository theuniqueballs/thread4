/**
 * THREAD 4 — общий слой Z.ai-моста (аудит 2026-10-17, strict).
 *
 * ДО этого раунда оба роута моста (/api/zai/chat/completions и …/vision)
 * несли по СВОЕЙ копии loadConfig + upstream-fetch — и обе копии ходили к
 * провайдеру БЕЗ таймаута и БЕЗ отмены: повисший upstream держал роут
 * бесконечно (maxDuration — serverless-понятие, dev-серверу оно ничего
 * не говорит), а клиентский withTimeout в scribe/oracle лишь переставал
 * ЖДАТЬ — сам fetch моста продолжал гореть в фоне. Плюс конфиг читался и
 * парсился с диска на каждый вызов.
 *
 * Здесь: одна точка правды для (1) конфига .z-ai-config — кэш по
 * size+mtime (паттерн specs.ts: сбой чтения не кэшируется, правка файла
 * видна живому процессу без рестарта) и (2) upstream-вызова — жёсткий
 * дедлайн AbortSignal.timeout: мост отвечает 504, а не виснет; сокет
 * закрывается, квота не тлеет.
 *
 * Ключ НЕ хранится нигде, кроме .z-ai-config (gitignored).
 */
import fs from 'node:fs'
import path from 'node:path'

export type ZaiBridgeKind = 'text' | 'vision'

export interface ZaiBridgeConfig {
  apiKey: string
  upstream: string
  model: string
}

const CONFIG_PATH = path.join(process.cwd(), '.z-ai-config')

/** Жёсткий потолок моста: 5 минут — потолок maxDuration роутов; висеть
 *  дольше мост не имеет права ни при каком провайдере. */
export const BRIDGE_TIMEOUT_MS = 300_000

/** Авторизация сервер-сервер: платформенный SDK (z-ai-web-dev-sdk) ходит
 *  на ${baseUrl}/chat/completions с `Authorization: Bearer <apiKey>` и
 *  НИЧЕГО больше не несёт — заголовка x-commander-key у него нет (провайдер
 *  zai у писца/ARS/Печи). Ключ живёт только в .z-ai-config на сервере
 *  (gitignored), клиент его не видит — совпадение Bearer с конфигом
 *  легитимирует звонок как внутренний. Внешний контур не меняется:
 *  браузер по-прежнему проходит x-commander-key. */
export function sdkBearerOk(req: Request, kind: ZaiBridgeKind): boolean {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  const cfg = loadZaiBridgeConfig(kind)
  if (cfg == null || cfg.apiKey === '') return false
  return auth.slice('Bearer '.length).trim() === cfg.apiKey
}

interface ZaiConfigFile {
  apiKey?: unknown
  upstream?: unknown
  textModel?: unknown
  visionUpstream?: unknown
  visionModel?: unknown
}

interface BridgeCache {
  size: number
  mtimeMs: number
  text: ZaiBridgeConfig | null
  vision: ZaiBridgeConfig | null
}

/* Аудит 2026-10-17: парсинг файла — только при промахе по (size, mtime);
 * успешный парс кэширует ОБЕ ветки, включая честный null ветки с неполными
 * полями (это свойство содержимого файла, не сбой I/O). Сбой чтения/JSON —
 * не кэшируется (доктрина specs.ts: единичный сбой не портит конфиг навсегда). */
let bridgeCache: BridgeCache | null = null

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function parseKinds(raw: ZaiConfigFile): { text: ZaiBridgeConfig | null; vision: ZaiBridgeConfig | null } {
  const apiKey = isStr(raw.apiKey) ? raw.apiKey : ''
  return {
    text:
      apiKey && isStr(raw.upstream) && isStr(raw.textModel)
        ? { apiKey, upstream: raw.upstream, model: raw.textModel }
        : null,
    vision:
      apiKey && isStr(raw.visionUpstream) && isStr(raw.visionModel)
        ? { apiKey, upstream: raw.visionUpstream, model: raw.visionModel }
        : null,
  }
}

/** Конфиг моста по ветке. null = файл отсутствует/бит или поля ветки неполны
 *  (роут отвечает 503 setupRequired — как раньше, семантика не менялась). */
export function loadZaiBridgeConfig(kind: ZaiBridgeKind): ZaiBridgeConfig | null {
  let st: fs.Stats | null = null
  try {
    st = fs.statSync(CONFIG_PATH)
  } catch {
    bridgeCache = null
    return null
  }
  if (bridgeCache && bridgeCache.size === st.size && bridgeCache.mtimeMs === st.mtimeMs) {
    return bridgeCache[kind]
  }
  let kinds: { text: ZaiBridgeConfig | null; vision: ZaiBridgeConfig | null }
  try {
    kinds = parseKinds(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as ZaiConfigFile)
  } catch {
    /* читается, но не парсится — не кэшируем сбой */
    bridgeCache = null
    return null
  }
  bridgeCache = { size: st.size, mtimeMs: st.mtimeMs, ...kinds }
  return bridgeCache[kind]
}

export interface BridgeUpstreamResponse {
  status: number
  text: string
}

/** POST /chat/completions наверх с жёстким дедлайном. Кидает при сетевом
 *  сбое/таймауте — классифицируй isBridgeTimeout; текст ошибки наверх
 *  отдаёт роут (короткий, без ключа — ключ только в заголовке). */
export async function postChatCompletion(
  cfg: ZaiBridgeConfig,
  body: Record<string, unknown>
): Promise<BridgeUpstreamResponse> {
  const res = await fetch(`${cfg.upstream}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  })
  return { status: res.status, text: await res.text() }
}

/** Таймаут дедлайна моста (AbortSignal.timeout → DOMException TimeoutError;
 *  ручная отмена → AbortError — обе значит «дедлайн», не «сетевой сбой»). */
export function isBridgeTimeout(e: unknown): boolean {
  const err = e as { name?: unknown; message?: unknown } | null
  if (!err) return false
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true
  return typeof err.message === 'string' && /timeout|timed out|aborted/i.test(err.message)
}
