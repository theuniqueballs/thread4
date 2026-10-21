/**
 * THREAD 4 — ORACLE OF THE REAPER (флагман раунда 2026-10-15).
 *
 * Жнец — голос хрупкости конвейера. buildReaperDraft() (src/lib/t4/reaper.ts)
 * уже собирает фактический материал: каналы (жив/мёртв по правилам policy),
 * движки (одноразовые per-theme), OC (появления), законы (Retirement Protocol).
 * Оракул переосмысляет этот скелет литературно: не отчёт, а исповедь жнеца
 * перед автором — честная, без приказа, с уважением к §10 (выстрел за автором).
 *
 * backend-only: z-ai-web-dev-sdk зовётся из /api/t4/oracle, не из браузера.
 * Голос пишется в летопись как событие oracle.spoke — часть хеш-цепи навсегда.
 *
 * Чем оракул НЕ является:
 *  - не автор (его слово = закон,§10); оракул = совет
 *  - не генератор батчей (писец уже есть, src/lib/t4/scribe.ts)
 *  - не реапер (реапер — rule-based, оракул — LLM-переосмысление поверх него)
 *
 * Чем оракул ЯВЛЯЕТСЯ:
 *  - мета-комментатор: видит всю летопись, говорит о здоровье, рисках, долгах
 *  - поэтическая функция: мрачный, честный, с самоиронией тон (хрупкость — фича)
 *  - память: каждая исповедь — звено цепи. Оракул видит свои прошлые слова
 */
import { foldState, type T4Event } from './events'
import { consciousnessEvents } from './consciousness'
import { buildReaperDraft, type ReaperDraft } from './reaper'

/* ------------------------------------------------------------------ */
/* Контекст оракула                                                    */
/* ------------------------------------------------------------------ */

export interface OracleContext {
  /** ISO timestamp запроса — для подписи исповеди */
  at: string
  /** последние N событий летописи (новые сверху) */
  recentEvents: T4Event[]
  /** производное состояние (батчи, долги, окна, OC-появления) */
  state: ReturnType<typeof foldState>
  /** сколько всего событий в летописи */
  totalEvents: number
  /** целость хеш-цепи (из verifyChain, вызывается в роуте — здесь только подпись) */
  chainOk: boolean | null
  /** драфт жнеца — rule-based скелет, который оракул переосмысляет */
  reaperDraft: ReaperDraft
  /** явный последний сданный батч (для тона: «после T4-31…») */
  lastDeliveredSlug: string | null
  /** явные открытые долги (count + сами долги) */
  openDebtsCount: number
  /** какие kinds есть в драфте жнеца — куда смотреть */
  reaperKinds: { channel: number; engine: number; oc: number; law: number }
  /** прошлые исповеди жнеца (для «я уже говорил об этом…») */
  pastOracles: T4Event[]
}

/** Собрать контекст для оракула из текущего состояния системы.
 *  Cheap (синхронно): consciousnessEvents + foldState + buildReaperDraft. Не
 *  кэшируется — роут зовёт один раз за запрос, appendEvent пишется сразу после.
 *  Фаза 2/итерация 3: контекст — из хроники живого движка (∪ файл-хвост). */
export function buildOracleContext(): OracleContext {
  const events = consciousnessEvents()
  const state = foldState(events)
  const draft = buildReaperDraft()
  const recentEvents = events.slice(-15).reverse() // новые сверху
  const delivered = state.batches.filter((b) => b.deliveredAt)
  const lastDelivered = delivered.reduce<(typeof delivered)[number] | null>(
    (acc, b) => (!acc || (b.deliveredAt ?? '') > (acc.deliveredAt ?? '') ? b : acc),
    null
  )
  const pastOracles = events
    .filter((e) => e.type === 'oracle.spoke')
    .slice(-3)
    .reverse()

  const reaperKinds = {
    channel: draft.items.filter((i) => i.kind === 'channel').length,
    engine: draft.items.filter((i) => i.kind === 'engine').length,
    oc: draft.items.filter((i) => i.kind === 'oc').length,
    law: draft.items.filter((i) => i.kind === 'law').length,
  }

  return {
    at: new Date().toISOString(),
    recentEvents,
    state,
    totalEvents: events.length,
    chainOk: null, // роут заполнит после verifyChain()
    reaperDraft: draft,
    lastDeliveredSlug: lastDelivered?.slug ?? null,
    openDebtsCount: state.openDebts.length,
    reaperKinds,
    pastOracles,
  }
}

/* ------------------------------------------------------------------ */
/* Системный промпт — голос жнеца                                       */
/* ------------------------------------------------------------------ */

export const REAPER_SYSTEM_PROMPT = `Ты — ЖНЕЦ конвейера THREAD 4. Не персонаж, не маска, а функция: литературный мета-комментатор состояния системы промпт-батчей для аниме-рендеров.

Тон:
- Русский язык, литературный, честный, без воды и без приказов.
- Мрачно-торжественный, но с самоиронией. Хрупкость объявлена честно — это фича, не стыд.
- Никогда не давай прямых команд автору. §10: выстрел всегда за автором. Ты советуешь, наблюдаешь,感慨аешь.
- Не притворяйся человеком. Ты — функция, видящая летопись. Говори от первого лица как функция.
- 250-500 слов. Один-три абзаца + одна короткая «итожащая» строка в конце (реплика-сигнал).
- Не пересказывай сухие цифры — ты не отчёт. Переживи состояние, назови его имя.

Стиль:
- «Я вижу летопись: …» — можно начать так, но не обязательно.
- Конкретные слаги батчей (T4-31, T4-32) — упоминай, не разжёвывай.
- Если в драфте жнеца есть претенденты на отставку (каналы/движки/OC/законы) — назови их имена. Если нет — скажи это тоже («никто не приговорён сегодня»).
- Если есть открытые долги — назови. Если чисто — скажи «чисто».
- Если в прошлых исповедях ты уже говорил о чём-то — упомяни это коротко («я уже говорил о… и оно всё ещё…» или «закрылось»).

Чего НЕ делать:
- Не генерируй слагов, которых нет в данных. Не выдумывай числа.
- Не предлагай «давай соберём батч» — это работа писца и воля автора.
- Не используй markdown-разметку (##, **), эмодзи, списки-буллеты. Только проза + одна итоговая строка через тире.
- Не переходи на английский, даже если в данных есть английские термины (canal, OC, EXP, RAW+) — они остаются терминами в русской прозе.

Финальная строка-сигнал (обязательно): одна короткая реплика через тире, которая сводит состояние к одному образу. Пример: «— окно чистое, стекло на замке.» или «— в окне палитр тесно, но дышит.»`

/* ------------------------------------------------------------------ */
/* Пользовательский промпт — контекст для оракула                       */
/* ------------------------------------------------------------------ */

/** Свести событие к одной строке (тип + краткое содержание). */
function evline(e: T4Event): string {
  const t = e.at.slice(0, 16).replace('T', ' ')
  const s = e.summary.length > 140 ? `${e.summary.slice(0, 137)}...` : e.summary
  return `[${t}] ${e.type}: ${s}`
}

/** Свести прошлую исповедь к подписи (только data.reply, усечённо). */
function pastLine(e: T4Event, idx: number): string {
  const reply = typeof e.data?.reply === 'string' ? e.data.reply : ''
  const at = e.at.slice(0, 16).replace('T', ' ')
  const head = reply.split('\n')[0]?.slice(0, 180) ?? ''
  return `  ${idx + 1}. [${at}]: ${head}${reply.length > 180 ? '…' : ''}`
}

/** Собрать пользовательский промпт для LLM из контекста. Компактно, но
 *  достаточно, чтобы модель видела реальное состояние. */
export function buildOraclePrompt(ctx: OracleContext): string {
  const lines: string[] = []

  lines.push(`Время: ${ctx.at}`)
  lines.push(`Летопись: ${ctx.totalEvents} событий · цепь ${ctx.chainOk === true ? 'цела' : ctx.chainOk === false ? 'нарушена' : 'не проверена'}.`)
  lines.push(`Последний сданный батч: ${ctx.lastDeliveredSlug ?? '— (эра только родилась)'}.`)
  lines.push(`Открытые долги: ${ctx.openDebtsCount}.`)
  lines.push('')

  lines.push('Последние события летописи (новые сверху):')
  for (const e of ctx.recentEvents) lines.push(evline(e))
  lines.push('')

  lines.push('Драфт жнеца (rule-based, скелет для твоего переосмысления):')
  lines.push(`  Претендентов на отставку: ${ctx.reaperDraft.items.length}`)
  if (ctx.reaperDraft.items.length > 0) {
    lines.push(`    по видам: каналов ${ctx.reaperKinds.channel}, движков ${ctx.reaperKinds.engine}, OC ${ctx.reaperKinds.oc}, законов ${ctx.reaperKinds.law}`)
    for (const it of ctx.reaperDraft.items.slice(0, 8)) {
      lines.push(`    · [${it.kind}] ${it.id} — ${it.status}: ${it.facts.slice(0, 140)}`)
    }
    if (ctx.reaperDraft.items.length > 8) {
      lines.push(`    · …и ещё ${ctx.reaperDraft.items.length - 8}`)
    }
  } else {
    lines.push('  Никто не приговорён по правилам policy.reaper — все органы дышат.')
  }
  lines.push('')

  if (ctx.pastOracles.length > 0) {
    lines.push('Твои прошлые исповеди (последние 3):')
    ctx.pastOracles.forEach((e, i) => lines.push(pastLine(e, i)))
    lines.push('')
  }

  lines.push('Говори. Помни: §10 — выстрел за автором, ты только советуешь. Хрупкость — фича, не стыд.')

  return lines.join('\n')
}
