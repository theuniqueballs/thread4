import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { consciousnessEvents } from '@/lib/t4/consciousness'
import { appendEvent } from '@/lib/t4/events'
import { isSafeSlug } from '@/lib/t4/fsutil'
import {
  collectFacts,
  deriveCycleState,
  isCycleStep,
  runAuto,
  runCycleStep,
  stepOrder,
  stepPolish,
  StepStop,
  type CycleStep,
} from '@/lib/t4/orchestrator'
import type { T4Event } from '@/lib/t4/events'

export const dynamic = 'force-dynamic'

/**
 * ЦИКЛ НА РАБОЧЕМ СТОЛЕ (Фаза 5, UI v2) — HTTP-край оркестратора фазы 3.
 *
 * Рабочий стол показывает конечный автомат ORDER→COMPILE→EXPOSITION→WRITE→
 * GATES→DELIVER вместо двух видов воркфлоу; состояние автомата — события
 * cycle.step в летописи, факты — диск + движок. Роут тонкий: guard + маппинг,
 * вся семантика (идемпотентность, human-gates, честные стопы) живёт в
 * оркестраторе — CLI и UI зовут ОДИН код, дрейфа нет.
 *
 * GET  /api/t4/cycle            → открытые циклы (дёшево, только летопись)
 * GET  /api/t4/cycle?slug=T4-NN → полное состояние цикла (факты + шаги)
 * POST /api/t4/cycle            → мутации, замок командира:
 *   { action: 'order', theme, ocThemes[1..3] }      — заказ автора
 *   { action: 'step', slug, step }                  — ровно один шаг
 *   { action: 'auto', slug?|theme?, ..., approve? } — авто-цепочка
 *   { action: 'polish', slug, rounds? }             — МОСТ ГЕЙТОВ: гейт-починка
 *      черновика против контракта после hard FAIL (LLM-минуты; один код с CLI:
 *      t4 polish); после полиша — честный повтор GATES тем же POST step
 *   { action: 'void', slug, reason }                — закрыть цикл (приказ автора,
 *      текст квитанции — как у CLI t4 void)
 *
 * StepStop (refused/engine-down/hard-fail/gate-stop) — это ЧЕСТНЫЙ СТОП
 * рабочего процесса, а не ошибка сервера: 200 + { ok:false, stopped } —
 * рабочий стол показывает формулировку автору, не стек-трейс.
 */

interface OpenCycleLite {
  slug: string
  theme: string | null
  lastStep: string | null
}

/** Дешёвый список кандидатов: слаги с cycle.step без batch.delivered/void. */
function openCycleCandidates(events: T4Event[]): OpenCycleLite[] {
  const orderEvents = new Map<string, { theme: string | null; lastStep: string | null; at: string }>()
  const closed = new Set<string>()
  for (const e of events) {
    const slug = typeof e.data?.slug === 'string' ? e.data.slug : null
    if (slug == null) continue
    if (e.type === 'batch.delivered' || e.type === 'batch.void') closed.add(slug)
    if (e.type === 'cycle.step') {
      const step = typeof e.data?.step === 'string' ? e.data.step : null
      const theme = typeof e.data?.theme === 'string' ? e.data.theme : null
      const prev = orderEvents.get(slug)
      orderEvents.set(slug, {
        theme: theme ?? prev?.theme ?? null,
        lastStep: step ?? prev?.lastStep ?? null,
        at: e.at,
      })
    }
  }
  return [...orderEvents.entries()]
    .filter(([slug]) => !closed.has(slug))
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, 8)
    .map(([slug, v]) => ({ slug, theme: v.theme, lastStep: v.lastStep }))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  try {
    const events = consciousnessEvents()
    if (slug == null || slug === '') {
      return NextResponse.json({ ok: true, open: openCycleCandidates(events) })
    }
    if (!isSafeSlug(slug)) {
      return NextResponse.json({ ok: false, error: `слаг «${slug}» не канонический T4-NN` }, { status: 400 })
    }
    const facts = await collectFacts(slug)
    const state = deriveCycleState(events, slug, facts)
    const receipts = events
      .filter((e) => e.type === 'cycle.step' && e.data?.slug === slug)
      .slice(-12)
      .map((e) => ({
        at: e.at,
        step: typeof e.data?.step === 'string' ? e.data.step : '—',
        summary: e.summary,
        sha10:
          typeof e.data?.planSha10 === 'string'
            ? e.data.planSha10
            : typeof e.data?.draftSha10 === 'string'
              ? e.data.draftSha10
              : null,
      }))
    return NextResponse.json({ ok: true, slug, state, facts, receipts })
  } catch (e) {
    if (e instanceof StepStop) {
      return NextResponse.json({ ok: false, stopped: { kind: e.kind, message: e.message } })
    }
    return NextResponse.json({ ok: false, error: clientErrorMessage(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  /* шаги пишут в летопись и двигают конвейер — только командир */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response

  let body: {
    action?: string
    slug?: string
    step?: string
    theme?: string
    ocThemes?: unknown
    until?: string
    approve?: boolean
    rounds?: unknown
    reason?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  try {
    if (body.action === 'order') {
      const theme = typeof body.theme === 'string' ? body.theme : ''
      const ocs = Array.isArray(body.ocThemes) ? body.ocThemes.filter((o): o is string => typeof o === 'string') : []
      const out = await stepOrder(theme, ocs)
      return NextResponse.json({ ok: true, action: 'order', outcome: out })
    }
    if (body.action === 'step') {
      const slug = typeof body.slug === 'string' ? body.slug : ''
      if (!isSafeSlug(slug)) return NextResponse.json({ ok: false, error: 'слаг обязателен (канон T4-NN)' }, { status: 400 })
      const step = typeof body.step === 'string' ? body.step : ''
      if (!isCycleStep(step)) {
        return NextResponse.json({ ok: false, error: `шаг «${step}» вне канона цикла` }, { status: 400 })
      }
      const out = await runCycleStep(step as CycleStep, slug)
      return NextResponse.json({ ok: true, action: 'step', outcome: out })
    }
    if (body.action === 'auto') {
      const until = typeof body.until === 'string' && isCycleStep(body.until) ? body.until : undefined
      const single = typeof body.step === 'string' && isCycleStep(body.step) ? body.step : undefined
      const report = await runAuto({
        slug: typeof body.slug === 'string' && body.slug !== '' ? body.slug : undefined,
        theme: typeof body.theme === 'string' && body.theme !== '' ? body.theme : undefined,
        ocThemes: Array.isArray(body.ocThemes)
          ? body.ocThemes.filter((o): o is string => typeof o === 'string')
          : undefined,
        until,
        step: single,
        approve: body.approve === true,
      })
      return NextResponse.json({ ok: true, action: 'auto', report })
    }
    if (body.action === 'polish') {
      const slug = typeof body.slug === 'string' ? body.slug : ''
      if (!isSafeSlug(slug)) return NextResponse.json({ ok: false, error: 'слаг обязателен (канон T4-NN)' }, { status: 400 })
      const rawRounds = Number(body.rounds)
      const rounds = Number.isFinite(rawRounds) ? Math.min(4, Math.max(1, Math.trunc(rawRounds))) : 2
      const out = await stepPolish(slug, rounds)
      return NextResponse.json({ ok: true, action: 'polish', outcome: out })
    }
    if (body.action === 'void') {
      const slug = typeof body.slug === 'string' ? body.slug : ''
      if (!isSafeSlug(slug)) return NextResponse.json({ ok: false, error: 'слаг обязателен (канон T4-NN)' }, { status: 400 })
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length < 1 || reason.length > 200) {
        return NextResponse.json({ ok: false, error: 'причина обязательна (1..200 символов) — летопись не принимает безымянных приказов' }, { status: 400 })
      }
      /* Текст квитанции — ровно как у CLI (t4 void): одна формулировка приказа. */
      appendEvent(
        'batch.void',
        `${slug} закрыт по приказу автора: ${reason}. Контракт остаётся в архиве как провенанс; из окна ротации исключён; номер не забивается: авто-номер идёт max+1, рекомпиляция void-слага легальна (вердикт автора 2026-10-20).`,
        { slug, reason }
      )
      return NextResponse.json({ ok: true, action: 'void', slug })
    }
    return NextResponse.json({ ok: false, error: 'action обязан быть order | step | auto | polish | void' }, { status: 400 })
  } catch (e) {
    if (e instanceof StepStop) {
      return NextResponse.json({ ok: false, stopped: { kind: e.kind, message: e.message } })
    }
    return NextResponse.json({ ok: false, error: clientErrorMessage(e) }, { status: 500 })
  }
}
