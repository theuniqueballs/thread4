/**
 * THREAD 4 — LLM-GUARD: единая защита внешних вызовов модели.
 *
 * Аудит №3 (2026-10-16): withTimeout/isTransientLlmError жили в scribe.ts
 * и защищали писца и оракула — но VLM-ветка (vlm.ts: createVision) и
 * классический разбор feedback-роута ходили к upstream БЕЗ таймаута:
 * повисший провайдер держал роут бесконечно (тот же класс бага, что
 * закрыт у оракула в аудите №2 — там просто забыли вторую дверь).
 * Защита переносится сюда — общий модуль без тяжёлых зависимостей,
 * доступный и scribe, и vlm, и роутам.
 *
 * SDK не несёт AbortSignal наружу — таймаут «перестаём ждать»
 * (промис висит дальше в фоне, но роут отвечает; Node прибьёт
 * зависший сокет по своему keep-alive).
 */

/** Ошибка, которую стоит повторить (сеть/таймаут/4xx/5xx переходящие) — не «нет ключа». */
export function isTransientLlmError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  if (/network|fetch failed|timeout|timed out|aborted|socket|ECONN|EAI_AGAIN|ETIMEDOUT|ENOTFOUND|EPIPE/i.test(msg)) return true
  if (/empty completion/i.test(msg)) return true
  if (/\b(408|425|429|500|502|503|504)\b/.test(msg)) return true
  return false
}

/** Обещание с дедлайном: rejects `«что: timeout Nms»` по истечении.
 *  Таймер unref-ится — не держит живой процесс при exit-flush. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: timeout ${ms}ms`)), ms)
    if (t && typeof t === 'object' && 'unref' in t) (t as { unref: () => void }).unref()
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** Лимиты вызовов (одна точка правды): текст — быстрее, картинка — щедрее. */
export const LLM_TIMEOUT_TEXT_MS = 45_000
export const LLM_TIMEOUT_VISION_MS = 120_000
export const LLM_TIMEOUT_INIT_MS = 15_000
