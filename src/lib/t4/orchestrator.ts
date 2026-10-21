/**
 * THREAD 4 — ОРКЕСТРАТОР цикла (фаза 3, 2026-10-22).
 *
 * ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER — конечный автомат,
 * состояние которого живут СОБЫТИЯМИ в летописи (конституция §2: state is
 * DERIVED from events, never hand-maintained). Каждый отработавший шаг
 * пишет ровно ОДНУ квитанцию cycle.step (data.slug, data.step); повторный
 * запуск шага не плодит событий-дублей — решение «делать/пропустить»
 * выводится из летописи и фактов (чистые функции decideNext/stepReceipted).
 *
 * Два режима — один и тот же код шагов:
 *   · ручной:  t4 order | plan | expose | write (+ существующие gates/deliver);
 *   · цепочка: t4 auto --theme "…" [--until STEP] [--step STEP] [--approve].
 * Существующие примитивы (compile/scribe/polish/check/gates/deliver) не
 * тронуты — оркестратор их ВЫЗЫВАЕТ, не переопределяет.
 *
 * Human-gates (остановка с полным отчётом, продолжение — командой автора):
 *   · EXPOSITION перед WRITE (автор читает экспозицию контракта — EXP-
 *     заглушки ждут его руки; цепочка идёт дальше только с --approve или
 *     явной одиночной командой следующего шага);
 *   · любой hard FAIL гейтов (чинить — polish/руками; повторный прогон
 *     гейтов по НЕизменённому черновику не дублирует gate.run — честный
 *     стоп «черновик не менялся»).
 *
 * Честность эпохи: план компилируется ТОЛЬКО живым движком (twin RPC,
 * таймаут шага + N повторов → стоп с отчётом, не бесконечное ожидание);
 * сознание недоступно → ConsciousnessUnavailableError → стоп (503-семантика).
 * Append-only: всё письмо — через appendEvent; ничего не переписывается.
 */
import crypto from 'node:crypto'

import { appendEvent, foldState, nextBatchNumber, readEvents, type T4Event } from './events'
import { warmConsciousness, consciousnessEvents, isConsciousnessError } from './consciousness'
import { runGates, type GatesResult } from './gates'
import { deliverBatch } from './deliver'
import { scribeBatch } from './scribe'
import { BATCHES_DIR, CONTRACTS_DIR, readText, isSafeSlug } from './fsutil'
import path from 'node:path'
import {
  fetchPlan,
  isEngineDownError,
  runBridgeCore,
  twinOrigin,
} from './bridge-core'

/* ------------------------------------------------------------------ */
/* Канон цикла                                                          */
/* ------------------------------------------------------------------ */

export const CYCLE_STEPS = ['ORDER', 'COMPILE', 'EXPOSITION', 'WRITE', 'GATES', 'DELIVER'] as const
export type CycleStep = (typeof CYCLE_STEPS)[number]

export function isCycleStep(s: string): s is CycleStep {
  return (CYCLE_STEPS as readonly string[]).includes(s)
}

/** sha10 черновика/контракта — та же формула, что у гейтов (gates.ts). */
export function sha10Of(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* Чистое ядро вывода состояния (selftest без сети)                     */
/* ------------------------------------------------------------------ */

export interface CycleFacts {
  /** План слага у живого движка (статус compiled = шаг COMPILE закрыт). */
  plan: { found: boolean; source?: 'scratch' | 'prod'; status?: string; sha10?: string | null; slots?: number }
  /** contracts/<slug>.json на диске. */
  contractOnDisk: boolean
  /** batches/<slug>.md на диске. */
  draftOnDisk: boolean
  /** sha10 ТЕКУЩЕГО черновика (для сравнения с последним gate.run). */
  draftSha10: string | null
  /** Последний gate.run слага в хронике. */
  lastGateRun: { sha10: string; hardPass: boolean; run: number } | null
}

export interface CycleState {
  slug: string
  /** Тема заказа (cycle.step ORDER; для усыновлённых слагов — из плана движка). */
  theme: string | null
  done: Record<CycleStep, boolean>
  /** Первый незакрытый шаг; null — цикл завершён (DELIVER закрыт). */
  next: CycleStep | null
  voided: boolean
  /** Текущий черновик уже фейлил гейты и с тех пор НЕ менялся — повторный
   *  прогон даст дубль gate.run; честный стоп вместо повтора. */
  staleHardFail: boolean
}

const emptyDone = (): Record<CycleStep, boolean> => ({
  ORDER: false,
  COMPILE: false,
  EXPOSITION: false,
  WRITE: false,
  GATES: false,
  DELIVER: false,
})

/** Шаг заквитанцеван? (ровно одна квитанция на slug×step). Чистая функция. */
export function stepReceipted(events: T4Event[], slug: string, step: CycleStep): boolean {
  return events.some(
    (e) => e.type === 'cycle.step' && e.data?.slug === slug && e.data?.step === step
  )
}

/** Вывод состояния цикла из летописи и фактов. Чистая функция. */
export function deriveCycleState(events: T4Event[], slug: string, facts: CycleFacts): CycleState {
  const done = emptyDone()
  const orderEvt = [...events]
    .reverse()
    .find((e) => e.type === 'cycle.step' && e.data?.slug === slug && e.data?.step === 'ORDER')
  const theme = typeof orderEvt?.data?.theme === 'string' ? (orderEvt.data.theme as string) : null

  done.ORDER =
    orderEvt != null || facts.plan.found || facts.contractOnDisk || facts.draftOnDisk
  done.COMPILE = facts.plan.found && facts.plan.status === 'compiled'
  done.EXPOSITION = facts.contractOnDisk
  done.WRITE = facts.draftOnDisk
  const gateMatchesDraft =
    facts.lastGateRun != null &&
    facts.draftSha10 != null &&
    facts.lastGateRun.sha10 === facts.draftSha10
  done.GATES = gateMatchesDraft && facts.lastGateRun!.hardPass
  done.DELIVER = events.some((e) => e.type === 'batch.delivered' && e.data?.slug === slug)
  const voided = events.some((e) => e.type === 'batch.void' && e.data?.slug === slug)

  const staleHardFail = gateMatchesDraft && !facts.lastGateRun!.hardPass

  let next: CycleStep | null = null
  if (!voided && !done.DELIVER) {
    next = CYCLE_STEPS.find((s) => !done[s]) ?? null
  }
  return { slug, theme, done, next, voided, staleHardFail }
}

/** Открытый цикл по теме: последняя квитанция ORDER, чей слаг не сдан и
 *  не закрыт. Чистая функция. */
export function findOpenCycle(
  events: T4Event[],
  theme?: string
): { slug: string; theme: string } | { mismatch: string; slug: string; theme: string } | null {
  const closed = new Set(
    events
      .filter((e) => (e.type === 'batch.delivered' || e.type === 'batch.void') && typeof e.data?.slug === 'string')
      .map((e) => String(e.data?.slug))
  )
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.type !== 'cycle.step' || e.data?.step !== 'ORDER') continue
    const slug = typeof e.data?.slug === 'string' ? e.data.slug : null
    const ordTheme = typeof e.data?.theme === 'string' ? e.data.theme : null
    if (!slug || !ordTheme || closed.has(slug)) continue
    if (theme != null && theme !== ordTheme) {
      return { mismatch: `открытый цикл ${slug} заказан с другой темой («${ordTheme}»)`, slug, theme: ordTheme }
    }
    return { slug, theme: ordTheme }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Факты (диск + живой движок)                                          */
/* ------------------------------------------------------------------ */

/** Таймаут шага и число повторов (инвариант фазы 3: авто-цикл обязан
 *  остановиться с отчётом, а не ждать бесконечно). */
export function cycleHttpOpts(): { timeoutMs: number; retries: number } {
  const timeoutMs = Number.parseInt(process.env.T4_CYCLE_TIMEOUT_MS ?? '', 10)
  const retries = Number.parseInt(process.env.T4_CYCLE_RETRIES ?? '', 10)
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000,
    retries: Number.isFinite(retries) && retries >= 0 ? retries : 2,
  }
}

export class StepStop extends Error {
  readonly kind: 'gate-stop' | 'hard-fail' | 'engine-down' | 'refused'
  readonly detail?: unknown
  constructor(kind: StepStop['kind'], message: string, detail?: unknown) {
    super(message)
    this.name = 'StepStop'
    this.kind = kind
    this.detail = detail
  }
}

/** HTTP-вызов движка с таймаутом шага и N повторами (инвариант: стоп с
 *  отчётом, а не бесконечное ожидание). Ретраятся переходящие сбои
 *  (сеть/таймаут/429/5xx); честные отказы не ретраятся: 404 — refused,
 *  401/403 — замок командира, 422 — движок отказал по существу. */
async function twinFetchJson(
  method: 'GET' | 'POST',
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const { timeoutMs, retries } = cycleHttpOpts()
  const isCommander = method === 'POST'
  let lastErr = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${twinOrigin()}${pathName}`, {
        method,
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(isCommander && body != null ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        ...(method === 'POST' && body != null ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        const raw: unknown = await res.json()
        const data = (raw as { data?: unknown }).data
        if (data == null || typeof data !== 'object') {
          throw new StepStop('engine-down', `движок вернул не envelope на ${pathName}`)
        }
        return data as Record<string, unknown>
      }
      const txt = await res.text().catch(() => '')
      if (res.status === 404) {
        throw new StepStop('refused', `движок ответил 404 на ${pathName}${txt ? `: ${txt.slice(0, 200)}` : ''}`)
      }
      if (res.status === 401 || res.status === 403) {
        throw new StepStop(
          'refused',
          `движок ответил HTTP ${res.status} на ${pathName} — замок командира: ключ в ~/.t4/commander.key (общий с движками), в репо не хранится`
        )
      }
      if (res.status === 422) {
        throw new StepStop(
          'hard-fail',
          `движок отказал по существу (HTTP 422) на ${pathName}: ${txt.slice(0, 400)}`
        )
      }
      lastErr = `HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ''}`
    } catch (e) {
      if (e instanceof StepStop) throw e // честные отказы не ретраятся
      lastErr = e instanceof Error ? e.message : String(e)
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  throw new StepStop(
    'engine-down',
    `движок (twin ${twinOrigin()}) не отвечает после ${retries + 1} попыток (таймаут шага ${timeoutMs}мс): ${lastErr} — авто-цикл остановлен, продолжение после подъёма движка`
  )
}

/** План слага в движке: scratch → prod. found=false — и это честный ответ. */
export async function planOfEngine(slug: string): Promise<CycleFacts['plan']> {
  for (const src of ['scratch', 'prod'] as const) {
    const r = await fetchPlan(slug, src, cycleHttpOpts().timeoutMs)
    if (r.res && r.res.plan) {
      return {
        found: true,
        source: src,
        status: r.res.status ?? '—',
        sha10: r.res.plan.sha10 ?? null,
        slots: Array.isArray(r.res.plan.slots) ? r.res.plan.slots.length : undefined,
      }
    }
    if (r.error && /не отвечает|ECONNREFUSED|fetch failed|timeout|aborted/i.test(r.error)) {
      throw new StepStop(
        'engine-down',
        `движок (twin ${twinOrigin()}) не отвечает (${r.error}) — авто-цикл остановлен с отчётом, а не ждёт бесконечно`
      )
    }
  }
  return { found: false }
}

/** Собрать факты цикла (диск + хроника + движок). */
export async function collectFacts(slug: string): Promise<CycleFacts> {
  const events = consciousnessEvents()
  const draft = readText(path.join(BATCHES_DIR, `${slug}.md`))
  const contract = readText(path.join(CONTRACTS_DIR, `${slug}.json`))
  const runs = events
    .filter((e) => e.type === 'gate.run' && e.data?.slug === slug)
    .map((e) => ({
      sha10: String(e.data?.sha10 ?? ''),
      hardPass: Boolean(e.data?.hardPass),
      run: Number(e.data?.run ?? 0),
    }))
  const lastGateRun = runs.length > 0 ? runs[runs.length - 1]! : null
  const plan = await planOfEngine(slug)
  return {
    plan,
    contractOnDisk: contract != null,
    draftOnDisk: draft != null,
    draftSha10: draft != null ? sha10Of(draft) : null,
    lastGateRun,
  }
}

/* ------------------------------------------------------------------ */
/* Квитанция шага (ровно одна на slug×step)                             */
/* ------------------------------------------------------------------ */

/** Идентичность квитанции: sha результата (новая починка = новая работа —
 *  квитанция честна), для усыновлений/одноразовых — метка. Повтор шага в
 *  ТОМ ЖЕ состоянии не плодит событий-дублей. */
function receiptIdentity(data: Record<string, unknown>): string {
  const sha = data.planSha10 ?? data.draftSha10 ?? data.contractSha10 ?? null
  if (typeof sha === 'string' && sha) return sha
  if (data.adopted === true) return 'adopted'
  return 'once'
}

function receiptedIdentity(events: T4Event[], slug: string, step: CycleStep): string[] {
  return events
    .filter((e) => e.type === 'cycle.step' && e.data?.slug === slug && e.data?.step === step)
    .map((e) => receiptIdentity(e.data ?? {}))
}

function receipt(slug: string, step: CycleStep, summary: string, data: Record<string, unknown>): void {
  const identity = receiptIdentity(data)
  if (receiptedIdentity(readEvents(), slug, step).includes(identity)) return // дубля нет
  appendEvent('cycle.step', `${slug}: цикл ${step} — ${summary}`, { slug, step, ...data })
}

/* ------------------------------------------------------------------ */
/* Шаги (каждый = примитив + квитанция + честный отчёт)                 */
/* ------------------------------------------------------------------ */

export interface StepOutcome {
  slug: string
  step: CycleStep
  action: 'done' | 'skip'
  lines: string[]
  sha10?: string | null
  hardPass?: boolean
}

export async function stepOrder(
  theme: string,
  ocOrders?: string[],
  onLog?: (s: string) => void
): Promise<StepOutcome> {
  const lines: string[] = []
  const t = theme.trim()
  if (t.length < 1 || t.length > 200) {
    throw new StepStop('refused', `тема обязательна (1..200 символов — канон движка), получено ${t.length}`)
  }
  await warmConsciousness()
  const state = foldState(consciousnessEvents())
  const num = nextBatchNumber(state.batches)
  const slug = `T4-${String(num).padStart(2, '0')}`
  const ocs = ocOrders?.map((s) => s.trim()).filter(Boolean)
  appendEvent(
    'cycle.step',
    `${slug}: цикл ORDER — заказ автора «${t}»${ocs?.length ? ` · ОС-прицел: ${ocs.join(', ')}` : ''} (следующий шаг: t4 plan ${slug} у живого движка)`,
    { slug, step: 'ORDER', theme: t, ...(ocs?.length ? { ocOrders: ocs } : {}) }
  )
  lines.push(`ORDER: слаг ${slug} закреплён за темой «${t}» (номер по union-хронике: max+1)`)
  onLog?.(lines[lines.length - 1]!)
  return { slug, step: 'ORDER', action: 'done', lines }
}

export async function stepCompile(slug: string, onLog?: (s: string) => void): Promise<StepOutcome> {
  if (!isSafeSlug(slug)) throw new StepStop('refused', `слаг «${slug}» не канонический T4-NN`)
  await warmConsciousness()
  const events = consciousnessEvents()
  const facts = await collectFacts(slug)
  const lines: string[] = []
  if (facts.plan.found && facts.plan.status === 'compiled') {
    lines.push(`COMPILE: план уже в движке (источник ${facts.plan.source}, sha10 ${facts.plan.sha10 ?? '—'}, слотов ${facts.plan.slots ?? '—'}) — шаг пропущен без дубля`)
    receipt(slug, 'COMPILE', `план уже у движка (${facts.plan.source}) — шаг пропущен`, {
      planSha10: facts.plan.sha10 ?? null,
      planSlots: facts.plan.slots ?? null,
      source: facts.plan.source ?? null,
      adopted: !stepReceipted(events, slug, 'COMPILE'),
    })
    onLog?.(lines[lines.length - 1]!)
    return { slug, step: 'COMPILE', action: 'skip', lines, sha10: facts.plan.sha10 ?? null }
  }
  const orderEvt = [...events]
    .reverse()
    .find((e) => e.type === 'cycle.step' && e.data?.slug === slug && e.data?.step === 'ORDER')
  const theme = typeof orderEvt?.data?.theme === 'string' ? (orderEvt.data.theme as string) : null
  if (!theme) {
    throw new StepStop('refused', `у ${slug} нет квитанции ORDER с темой — сначала t4 order «тема»`)
  }
  /* Idempotency-Key: ретрай сети не рождает второй план — twin отдаёт
   * закэшированный ответ компиляции (t4_idempotency). */
  const data = await twinFetchJson(
    'POST',
    '/v1/compile',
    { slug, theme },
    { 'idempotency-key': `cycle-${slug}-compile` }
  )
  const plan = data.plan as { sha10?: string; slots?: unknown[] } | undefined
  const planSha10 = plan?.sha10 ?? null
  const slots = Array.isArray(plan?.slots) ? plan.slots.length : null
  lines.push(`COMPILE: движок собрал план ${slug} (scratch-летопись twin'а, sha10 ${planSha10 ?? '—'}, слотов ${slots ?? '—'}, прод не тронут)`)
  receipt(slug, 'COMPILE', `план живого движка собран (sha10 ${planSha10 ?? '—'}, слотов ${slots ?? '—'})`, {
    planSha10,
    planSlots: slots,
    source: 'scratch',
  })
  onLog?.(lines[lines.length - 1]!)
  return { slug, step: 'COMPILE', action: 'done', lines, sha10: planSha10 }
}

export async function stepExposition(slug: string, onLog?: (s: string) => void): Promise<StepOutcome> {
  if (!isSafeSlug(slug)) throw new StepStop('refused', `слаг «${slug}» не канонический T4-NN`)
  const lines: string[] = []
  if (readText(path.join(CONTRACTS_DIR, `${slug}.json`)) != null) {
    lines.push(`EXPOSITION: контракт contracts/${slug}.json уже на диске — шаг пропущен без дубля`)
    receipt(slug, 'EXPOSITION', `контракт уже на диске — шаг пропущен`, { adopted: true })
    onLog?.(lines[lines.length - 1]!)
    return { slug, step: 'EXPOSITION', action: 'skip', lines }
  }
  const r = await runBridgeCore(slug)
  const contractSha10 = sha10Of(JSON.stringify(r.contract))
  lines.push(`EXPOSITION: мост собрал богатый контракт contracts/${slug}.json + .md (план sha10 ${r.planSha10 ?? '—'}, ${r.contract.slots.length} слотов, законы ${Object.keys(r.contract.laws).length}, источник ${r.source})`)
  lines.push(`  EXP-гипотезы контракта — детерминированные заглушки под редактуру автора: human-gate перед WRITE`)
  receipt(slug, 'EXPOSITION', `мост: план → контракт (${r.contract.slots.length} слотов, plan sha10 ${r.planSha10 ?? '—'})`, {
    planSha10: r.planSha10,
    contractSha10,
    source: r.source,
    contractSlots: r.contract.slots.length,
  })
  onLog?.(lines[0]!)
  return { slug, step: 'EXPOSITION', action: 'done', lines, sha10: r.planSha10 }
}

export async function stepWrite(slug: string, onLog?: (s: string) => void): Promise<StepOutcome> {
  if (!isSafeSlug(slug)) throw new StepStop('refused', `слаг «${slug}» не канонический T4-NN`)
  const lines: string[] = []
  if (readText(path.join(BATCHES_DIR, `${slug}.md`)) != null) {
    lines.push(`WRITE: черновик batches/${slug}.md уже на диске — шаг пропущен без дубля (переписать — существующий примитив t4 scribe ${slug})`)
    receipt(slug, 'WRITE', `черновик уже на диске — шаг пропущен`, { adopted: true })
    onLog?.(lines[lines.length - 1]!)
    return { slug, step: 'WRITE', action: 'skip', lines }
  }
  if (readText(path.join(CONTRACTS_DIR, `${slug}.json`)) == null) {
    throw new StepStop('refused', `контракта ${slug} нет — сначала EXPOSITION (t4 expose ${slug})`)
  }
  await warmConsciousness()
  const res = await scribeBatch(slug, { maxRepairRounds: 3, onLog })
  lines.push(`WRITE: писец написал batches/${slug}.md (слоты ${res.failedSlots.length === 0 ? 'все' : `НЕ написаны P${res.failedSlots.join(', P')}`}, ремонт ${res.rounds}, dry-гейты ${res.hardPass ? 'PASS' : 'FAIL'}, sha10 ${res.sha10})`)
  receipt(slug, 'WRITE', `черновик писца (sha10 ${res.sha10}, ремонт ${res.rounds})`, {
    draftSha10: res.sha10,
    hardPassDry: res.hardPass,
    failedSlots: res.failedSlots,
  })
  if (res.failedSlots.length > 0) {
    throw new StepStop(
      'hard-fail',
      `писец не написал слоты P${res.failedSlots.join(', P')} — батч нельзя гейтить; чини: bun thread4/cli.ts polish ${slug} (полировка — существующий примитив, цикл остановлен с отчётом)`,
      res
    )
  }
  return { slug, step: 'WRITE', action: 'done', lines, sha10: res.sha10 }
}

export async function stepGates(slug: string, onLog?: (s: string) => void): Promise<StepOutcome & { result?: GatesResult }> {
  if (!isSafeSlug(slug)) throw new StepStop('refused', `слаг «${slug}» не канонический T4-NN`)
  await warmConsciousness()
  const facts = await collectFacts(slug)
  const lines: string[] = []
  if (!facts.draftOnDisk || facts.draftSha10 == null) {
    throw new StepStop('refused', `черновика ${slug} нет — сначала WRITE (t4 write ${slug})`)
  }
  if (facts.lastGateRun && facts.lastGateRun.sha10 === facts.draftSha10) {
    if (facts.lastGateRun.hardPass) {
      lines.push(`GATES: этот черновик (sha10 ${facts.draftSha10}) уже прошёл гейты (прогон #${facts.lastGateRun.run}) — шаг пропущен без дубля gate.run`)
      receipt(slug, 'GATES', `гейты уже пройдены этим черновиком (sha10 ${facts.draftSha10}) — шаг пропущен`, {
        draftSha10: facts.draftSha10,
        hardPass: true,
        adopted: true,
      })
      onLog?.(lines[lines.length - 1]!)
      return { slug, step: 'GATES', action: 'skip', lines, sha10: facts.draftSha10, hardPass: true }
    }
    throw new StepStop(
      'hard-fail',
      `черновик ${slug} (sha10 ${facts.draftSha10}) уже фейлил гейты (прогон #${facts.lastGateRun.run}) и с тех пор НЕ менялся — повторный прогон даст дубль gate.run. Чини против контракта (t4 polish ${slug} или руками), потом повтори шаг`,
      facts.lastGateRun
    )
  }
  let result: GatesResult | null = null
  try {
    result = runGates(slug, false)
  } catch (e) {
    throw new StepStop('refused', `гейты ${slug} не запустились: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!result) throw new StepStop('refused', `батч ${slug} не распарсился — гейты не запускались`)
  for (const r of result.receipts) {
    const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : r.verdict === 'WARN' ? '⚠' : '·'
    lines.push(`  [${mark}] ${r.gate} (${r.level})`)
    const shown = r.verdict === 'PASS' ? r.findings.slice(0, 3) : r.findings
    for (const f of shown) lines.push(`       ${f}`)
  }
  lines.push(`GATES: прогон #${result.runIndex} · hard ${result.hardPass ? 'PASS' : 'FAIL'} · sha10 ${result.sha10}${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''}`)
  receipt(slug, 'GATES', `официальные гейты: прогон #${result.runIndex}, hard ${result.hardPass ? 'PASS' : 'FAIL'} (sha10 ${result.sha10})`, {
    draftSha10: result.sha10,
    hardPass: result.hardPass,
    run: result.runIndex,
  })
  onLog?.(lines[lines.length - 1]!)
  if (!result.hardPass) {
    throw new StepStop(
      'hard-fail',
      `HARD FAIL гейтов (${result.receipts.filter((r) => r.level === 'hard' && r.verdict === 'FAIL').map((r) => r.gate).join(', ')}) — human-gate: цикл остановлен с полным отчётом, продолжение только командой автора после починки`,
      result
    )
  }
  return { slug, step: 'GATES', action: 'done', lines, sha10: result.sha10, hardPass: true, result }
}

export async function stepDeliver(slug: string, onLog?: (s: string) => void): Promise<StepOutcome> {
  if (!isSafeSlug(slug)) throw new StepStop('refused', `слаг «${slug}» не канонический T4-NN`)
  await warmConsciousness()
  const events = consciousnessEvents()
  const lines: string[] = []
  if (events.some((e) => e.type === 'batch.delivered' && e.data?.slug === slug)) {
    lines.push(`DELIVER: ${slug} уже сдан — шаг пропущен без дубля (охрана окна ротации)`)
    receipt(slug, 'DELIVER', `батч уже сдан — шаг пропущен`, { adopted: true })
    onLog?.(lines[lines.length - 1]!)
    return { slug, step: 'DELIVER', action: 'skip', lines }
  }
  const delivered = deliverBatch(slug)
  if (!delivered) throw new StepStop('refused', `батч ${slug} не найден (нужен thread4/batches/${slug}.md)`)
  if (!delivered.ok) {
    if (delivered.alreadyDelivered) {
      lines.push(`DELIVER: ${slug} уже сдан (охрана пересдачи) — шаг пропущен`)
      receipt(slug, 'DELIVER', `батч уже сдан (охрана пересдачи) — шаг пропущен`, {})
      return { slug, step: 'DELIVER', action: 'skip', lines }
    }
    throw new StepStop(
      'hard-fail',
      `HARD FAIL при сдаче ${slug} — human-gate: цикл остановлен с полным отчётом`,
      delivered.result
    )
  }
  lines.push(`DELIVER: ${slug} «${delivered.title}» сдан — гейты, мета, ворклог и batch.delivered записаны. ЦИКЛ ЗАВЕРШЁН`)
  receipt(slug, 'DELIVER', `батч сдан — цикл завершён`, { title: delivered.title })
  onLog?.(lines[lines.length - 1]!)
  return { slug, step: 'DELIVER', action: 'done', lines }
}

export async function runCycleStep(step: CycleStep, slug: string, onLog?: (s: string) => void): Promise<StepOutcome> {
  switch (step) {
    case 'ORDER':
      throw new StepStop('refused', 'ORDER — команда автора с темой: t4 order «тема» (или t4 auto --theme «тема»)')
    case 'COMPILE':
      return stepCompile(slug, onLog)
    case 'EXPOSITION':
      return stepExposition(slug, onLog)
    case 'WRITE':
      return stepWrite(slug, onLog)
    case 'GATES':
      return stepGates(slug, onLog)
    case 'DELIVER':
      return stepDeliver(slug, onLog)
  }
}

/* ------------------------------------------------------------------ */
/* Авто-цепочка                                                         */
/* ------------------------------------------------------------------ */

export interface AutoOptions {
  theme?: string
  slug?: string
  /** Выполнить до шага включительно (по умолчанию DELIVER). */
  until?: CycleStep
  /** Выполнить РОВНО ОДИН шаг (команда автора — проходит human-gate). */
  step?: CycleStep
  /** Явное одобрение автора экспозиции — продолжить цепочку за human-gate. */
  approve?: boolean
  onLog?: (s: string) => void
}

export interface AutoReport {
  slug: string
  theme: string | null
  executed: { step: CycleStep; action: 'done' | 'skip'; lines: string[]; sha10?: string | null }[]
  stopped: null | { kind: StepStop['kind'] | 'gate-stop' | 'complete'; message: string; lines: string[] }
  nextHint: string | null
}

export async function runAuto(opts: AutoOptions): Promise<AutoReport> {
  const onLog = opts.onLog
  const report: AutoReport = { slug: '', theme: null, executed: [], stopped: null, nextHint: null }

  /* --- цель цикла --- */
  let slug: string
  if (opts.slug) {
    if (!isSafeSlug(opts.slug)) throw new StepStop('refused', `слаг «${opts.slug}» не канонический T4-NN`)
    slug = opts.slug
  } else {
    await warmConsciousness()
    const open = findOpenCycle(consciousnessEvents(), opts.theme)
    if (open && 'mismatch' in open) {
      throw new StepStop('refused', `тема «${opts.theme}»: ${open.mismatch} — продолжи её (t4 auto --slug ${open.slug}) или закрой (t4 void ${open.slug} «причина»)`)
    }
    if (open) {
      slug = open.slug
      report.theme = open.theme
      onLog?.(`AUTO: открытый цикл найден в летописи — ${slug} «${open.theme}», продолжаю с текущего шага (возобновление после падения)`)
    } else {
      if (!opts.theme) {
        throw new StepStop('refused', 'нет ни открытого цикла, ни темы — t4 auto --theme «тема»')
      }
      const ord = await stepOrder(opts.theme, undefined, onLog)
      slug = ord.slug
      report.theme = opts.theme
      report.executed.push({ step: 'ORDER', action: 'done', lines: ord.lines, sha10: null })
    }
  }
  report.slug = slug
  await warmConsciousness()
  if (report.theme == null) {
    const orderEvt = [...consciousnessEvents()]
      .reverse()
      .find((e) => e.type === 'cycle.step' && e.data?.slug === slug && e.data?.step === 'ORDER')
    report.theme = typeof orderEvt?.data?.theme === 'string' ? (orderEvt.data.theme as string) : null
  }

  /* --- прогон шагов --- */
  const lastStep = opts.step ?? opts.until ?? 'DELIVER'
  const single = opts.step != null
  const lastIdx = CYCLE_STEPS.indexOf(lastStep)
  if (lastIdx < 0) throw new StepStop('refused', `шаг «${lastStep}» вне канона цикла (${CYCLE_STEPS.join('→')})`)

  let idx = 0
  for (;;) {
    const facts = await collectFacts(slug)
    const state = deriveCycleState(consciousnessEvents(), slug, facts)
    if (state.next == null) {
      report.stopped = {
        kind: 'complete',
        message: state.voided ? `цикл ${slug} закрыт (void) — делать нечего` : `цикл ${slug} ЗАВЕРШЁН (batch.delivered в летописи)`,
        lines: [],
      }
      report.nextHint = null
      return report
    }
    if (CYCLE_STEPS.indexOf(state.next) > lastIdx) {
      report.stopped = { kind: 'complete', message: `достигнут --${single ? 'step' : 'until'} ${lastStep}`, lines: [] }
      return report
    }
    const step = state.next

    /* human-gate EXPOSITION: цепочка останавливается ПЕРЕД WRITE —
     * автор читает экспозицию (EXP-заглушки ждут его руки). Продолжение —
     * только явная команда автора (--approve или одиночный --step WRITE). */
    if (step === 'WRITE' && !single && !opts.approve) {
      report.stopped = {
        kind: 'gate-stop',
        message: `HUMAN-GATE: экспозиция ${slug} готова и ждёт твоей руки (EXP-гипотезы контракта — детерминированные заглушки под редактуру). Продолжение — только командой автора: t4 auto --theme … --approve (или пошагово: t4 write ${slug})`,
        lines: [],
      }
      report.nextHint = `bun thread4/cli.ts auto --theme "…" --approve   # продолжить до DELIVER\nbun thread4/cli.ts write ${slug}            # или пошагово: WRITE`
      return report
    }

    try {
      const out = await runCycleStep(step, slug, onLog)
      report.executed.push({ step, action: out.action, lines: out.lines, sha10: out.sha10 })
    } catch (e) {
      if (e instanceof StepStop) {
        report.stopped = { kind: e.kind, message: e.message, lines: [] }
        if (e.kind === 'hard-fail') report.nextHint = `почини черновик и повтори: bun thread4/cli.ts auto --slug ${slug} --step GATES`
        if (e.kind === 'engine-down') report.nextHint = `подними twin (mini-services/t4-engine-rs/dev.sh) и повтори: bun thread4/cli.ts auto --slug ${slug}`
        if (e.kind === 'refused') report.nextHint = null
        return report
      }
      if (isConsciousnessError(e)) {
        report.stopped = { kind: 'engine-down', message: e.message, lines: [] }
        report.nextHint = `подними twin (mini-services/t4-engine-rs/dev.sh, :3201) или задай T4_STATE_SOURCE=file — аварийный источник файл-эры`
        return report
      }
      if (isEngineDownError(e)) {
        report.stopped = { kind: 'engine-down', message: e.message, lines: [] }
        report.nextHint = `подними twin (mini-services/t4-engine-rs/dev.sh) и повтори: bun thread4/cli.ts auto --slug ${slug}`
        return report
      }
      throw e
    }
    idx++
    if (idx > CYCLE_STEPS.length + 1) {
      /* страховка от зацикливания на некорректном состоянии */
      report.stopped = { kind: 'refused', message: `состояние цикла ${slug} не продвигается — смотри летопись`, lines: [] }
      return report
    }
  }
}
