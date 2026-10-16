/**
 * THREAD 4 — ORACLE OF THE REAPER (Залп 3, раунд 2026-10-15).
 *
 * POST /api/t4/oracle — голос жнеца: LLM читает летопись и говорит
 * литературную исповедь о здоровье конвейера. Каждое слово — звено хеш-цепи.
 *
 * Поток:
 *  1. requireCommander (Залп 1: только автор просит жнеца говорить)
 *  2. buildOracleContext() — собрать фактический снимок состояния
 *  3. verifyChain() — подписать целость цепи в контексте
 *  4. ZAI.create() + zai.chat.completions.create (text, glm-4.5-flash)
 *  5. appendEvent('oracle.spoke', reply.slice(0,4000), {model, prompt, reply, chainOk, ...})
 *  6. вернуть {ok, event, reply} для UI
 *
 * Не падает молча:
 *  - 503 setupRequired: нет .z-ai-config (VLM/LLM не настроен на машине)
 *  - 502 blocked: контент-фильтр провайдера (модель отказалась говорить)
 *  - 429 rate-limited: повтори через минуту (модель устала)
 *  - 500: что-то непонятное — клиенту уходит короткое сообщение
 */
import { NextResponse } from 'next/server'

import ZAI from 'z-ai-web-dev-sdk'

import { appendEvent, verifyChain } from '@/lib/t4/events'
import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { isProviderBlocked } from '@/lib/t4/vlm'
import { isTransientLlmError, withTimeout } from '@/lib/t4/scribe'
import { buildOracleContext, buildOraclePrompt, REAPER_SYSTEM_PROMPT } from '@/lib/t4/oracle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ORACLE_MODEL = 'glm-4.5-flash'
const ORACLE_MAX_TOKENS = 1200
/* Аудит-раунд №2 (2026-10-16): у писца LLM-вызовы ограничены с фикса #37,
 * оракул жил БЕЗ таймаута — повисший upstream держал роут до maxDuration,
 * переходящий 429/сетевой сбой отдавался автору как 500 «жнец не ответил»
 * без единого ретрая. Теперь: таймаут 45с + один ретрай переходящих. */
const ORACLE_TIMEOUT_MS = 45_000
const ORACLE_RETRIES = 1

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): платный LLM-вызов + запись oracle.spoke
   * в летопись — только с ключом командира. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response

  let body: { theme?: string }
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    body = {}
  }

  /* author-подсказка теме (опционально): автор может попросить жнеца
   * «поговори о палитрах» — мы вшиваем в конец промпта как авторскую ноту.
   * Без неё — жнец говорит о том, о чём сам считает нужным. */
  const themeHint = typeof body.theme === 'string' ? body.theme.trim().slice(0, 300) : ''

  /* собираем контекст — один раз, синхронно. дёшево: readEvents + foldState +
   * buildReaperDraft. Оракул видит: последние 15 событий, драфт жнеца,
   * прошлые свои исповеди (3), состояние, долги. */
  let ctx
  try {
    ctx = buildOracleContext()
  } catch (e) {
    return NextResponse.json(
      { error: 'не удалось собрать контекст оракула', detail: clientErrorMessage(e).slice(0, 200) },
      { status: 500 }
    )
  }
  ctx.chainOk = verifyChain().ok

  const prompt = buildOraclePrompt(ctx) + (themeHint ? `\n\nАвторская нота: «${themeHint}».` : '')

  try {
    const zai = await ZAI.create()
    /* таймаут + ретрай переходящих (аудит №2): непереходящие (нет ключа,
     * контент-фильтр) падают сразу — вниз по прежним веткам 502/503 */
    let completion: Awaited<ReturnType<typeof zai.chat.completions.create>> | null = null
    let lastErr: unknown = null
    for (let attempt = 0; attempt <= ORACLE_RETRIES; attempt++) {
      try {
        completion = await withTimeout(
          zai.chat.completions.create({
            messages: [
              { role: 'system', content: REAPER_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            model: ORACLE_MODEL,
            thinking: { type: 'disabled' },
            max_tokens: ORACLE_MAX_TOKENS,
          }),
          ORACLE_TIMEOUT_MS,
          'oracle LLM-вызов'
        )
        break
      } catch (e) {
        lastErr = e
        if (!isTransientLlmError(e)) break
      }
    }
    if (completion == null) throw lastErr instanceof Error ? lastErr : new Error('жнец не ответил (LLM)')
    const reply = (completion.choices[0]?.message?.content ?? '').trim()
    if (reply.length < 50) {
      return NextResponse.json(
        { ok: false, error: 'жнец промолчал — ответ короче 50 символов, повтори запрос', raw: reply.slice(0, 200) },
        { status: 502 }
      )
    }
    const clean = reply.slice(0, 4000)

    /* запись в летопись — звено цепи. data.model + data.reply обязательны
     * (assertBornSemantics в events.ts отвергнет иначе). data.prompt — для
     * воспроизводимости (усечённый до 500 симв, как у render.verdict). */
    const summary = `ORACLE: ${clean.split('\n')[0]?.slice(0, 180) ?? 'исповедь жнеца'}${clean.length > 180 ? '…' : ''}`
    const event = appendEvent('oracle.spoke', summary, {
      model: ORACLE_MODEL,
      reply: clean,
      prompt: prompt.slice(0, 500),
      chainOk: ctx.chainOk,
      themeHint: themeHint || null,
      context: {
        totalEvents: ctx.totalEvents,
        lastDeliveredSlug: ctx.lastDeliveredSlug,
        openDebts: ctx.openDebtsCount,
        reaperDraftItems: ctx.reaperDraft.items.length,
        pastOraclesSeen: ctx.pastOracles.length,
      },
    })

    return NextResponse.json({ ok: true, event, reply: clean, model: ORACLE_MODEL })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    /* Контент-фильтр провайдера: модель отказалась говорить на данном промпте.
     * Возвращаем 502 + blocked: UI показывает «жнец не хочет говорить об этом
     * теме — смени ноту или повтори позже». */
    if (isProviderBlocked(msg)) {
      return NextResponse.json(
        { ok: false, blocked: true, error: 'контент-фильтр провайдера — жнец не высказался' },
        { status: 502 }
      )
    }
    /* LLM не настроен на этой машине (нет .z-ai-config) — структурированный
     * 503: UI гасит кнопку и показывает setup-баннер, а не N одинаковых 500. */
    if (/Configuration file not found|z-ai-config/i.test(msg)) {
      return NextResponse.json(
        { ok: false, error: 'LLM не настроен: нет .z-ai-config (ключ Z.ai) на этой машине', setupRequired: true },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: 'жнец не ответил', detail: clientErrorMessage(e).slice(0, 300) },
      { status: 500 }
    )
  }
}
