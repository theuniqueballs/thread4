/**
 * THREAD 4 ENGINE — route handlers (the domain surface).
 *
 * Handlers are pure: (db, ctx) → JSON-able data. They never see raw
 * Request parsing (server.ts validates body/params via Zod BEFORE the
 * handler runs) and never format HTTP themselves.
 */
import type { Database } from 'bun:sqlite'

import { CANON, EVENT_TYPES, VERDICT_SOURCES } from '../config/canon'
import {
  AppendEventRequestSchema,
  CompileRequestSchema,
  EventsQuerySchema,
  SlugSchema,
  VerdictRequestSchema,
} from '../config/schema'
import { CompileError, compileBatch, findIdempotentCompile } from '../core/compile'
import { migratePayloads } from '../core/rematerialize-run'
import { appendEventTx, countEvents, readEvents, verifyChain, withTransaction } from '../core/chain'
import { readChainPointer, schemaVersion } from '../core/db'
import {
  batchHardPass,
  eventToJson,
  getBatch,
  getVerdict,
  listBatches,
  listVerdicts,
  markDelivered,
  markVoid,
  nextBatchNumber,
  upsertVerdict,
} from '../core/projections'
import { dbFacts, scheduleSnapshot } from '../lib/persist'
import { RpcError } from './errors'

export interface HandlerCtx {
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
  headers: Record<string, string>
}

/* ------------------------------------------------------------------ */
/* Boot facts                                                          */
/* ------------------------------------------------------------------ */

export const BOOT_AT = Date.now()

/* ------------------------------------------------------------------ */
/* GET /v1/health — open                                               */
/* ------------------------------------------------------------------ */

export function health(): Record<string, unknown> {
  return {
    ok: true,
    era: CANON.era,
    engine: 't4-engine',
    version: '1.0.0',
    canon: CANON.version,
    uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
  }
}

/* ------------------------------------------------------------------ */
/* GET /v1/meta — open (canon as declared config, not hidden files)     */
/* ------------------------------------------------------------------ */

export function meta(): Record<string, unknown> {
  return {
    era: CANON.era,
    canon: CANON.version,
    fam: CANON.fam,
    constitution: CANON.constitution,
    laws: CANON.laws,
    slots: CANON.slots,
    ab: CANON.ab,
    palette: CANON.palette,
    eventTypes: EVENT_TYPES,
    verdictSources: VERDICT_SOURCES,
    serve: CANON.serve,
  }
}

/* ------------------------------------------------------------------ */
/* GET /v1/state — read                                                */
/* ------------------------------------------------------------------ */

export function state(db: Database): Record<string, unknown> {
  const pointer = readChainPointer(db)
  const chain = verifyChain(db)
  const delivered = listBatches(db, 'delivered')
  const compiled = listBatches(db, 'compiled')
  const verdicts = listVerdicts(db)
  const last = delivered[0] ?? null
  return {
    era: CANON.era,
    canon: CANON.version,
    fam: CANON.fam,
    nextSlug: `T4-${String(nextBatchNumber(db)).padStart(2, '0')}`,
    lastDelivered: last
      ? { slug: last.slug, title: last.title, deliveredAt: last.delivered_at, diffUp: last.diff_up, diffDown: last.diff_down }
      : null,
    counts: {
      events: countEvents(db),
      batchesDelivered: delivered.length,
      batchesCompiled: compiled.length,
      verdicts: verdicts.length,
    },
    chain: {
      height: pointer.height,
      head: pointer.head === 'GENESIS' ? null : pointer.head,
      ok: chain.ok,
      problems: chain.problems,
    },
    db: { ...dbFacts(), schemaVersion: schemaVersion() },
    uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000),
  }
}

/* ------------------------------------------------------------------ */
/* GET /v1/events — read                                               */
/* ------------------------------------------------------------------ */

export function events(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const parsed = EventsQuerySchema.safeParse({
    after: ctx.query.get('after') ?? undefined,
    limit: ctx.query.get('limit') ?? undefined,
    type: ctx.query.get('type') ?? undefined,
  })
  if (!parsed.success) {
    throw new RpcError('validation', 'events: параметры запроса не прошли Zod', parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '))
  }
  const rows = readEvents(db, parsed.data)
  return {
    events: rows.map(eventToJson),
    returned: rows.length,
    total: countEvents(db),
  }
}

/* ------------------------------------------------------------------ */
/* GET /v1/batches, /v1/batches/:slug — read                           */
/* ------------------------------------------------------------------ */

export function batches(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  if (ctx.params['slug'] !== undefined) {
    const slug = parseSlug(ctx.params['slug'] ?? '')
    const row = getBatch(db, slug)
    if (row == null) throw new RpcError('notFound', `batch ${slug} не найден`)
    return {
      slug: row.slug,
      title: row.title,
      theme: row.theme,
      engine: row.engine,
      status: row.status,
      slotsTotal: row.slots_total,
      expSlots: row.exp_slots,
      abPairs: row.ab_pairs,
      hardPass: row.hard_pass === 1,
      diff: { up: row.diff_up, down: row.diff_down },
      sha10: row.sha10,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
      plan: JSON.parse(row.payload) as unknown,
      verdict: getVerdict(db, slug, 'render.verdict') ?? getVerdict(db, slug, 'author-batch'),
    }
  }
  const status = ctx.query.get('status')
  const rows = listBatches(db, status ?? undefined)
  return {
    batches: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      status: r.status,
      expSlots: r.exp_slots,
      hardPass: r.hard_pass === 1,
      diffUp: r.diff_up,
      diffDown: r.diff_down,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
    })),
    returned: rows.length,
  }
}

function parseSlug(raw: string): string {
  const parsed = SlugSchema.safeParse(raw)
  if (!parsed.success) {
    throw new RpcError('validation', `slug «${raw}» не лезет в канон T4-NN`, parsed.error.issues[0]?.message)
  }
  return parsed.data
}

/* ------------------------------------------------------------------ */
/* POST /v1/compile — commander                                        */
/* ------------------------------------------------------------------ */

export function compile(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const parsed = CompileRequestSchema.safeParse(ctx.body)
  if (!parsed.success) {
    throw new RpcError(
      'validation',
      'compile: тело запроса не прошло Zod (strict — лишние поля запрещены)',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 400)
    )
  }
  const idemRaw = ctx.headers['idempotency-key'] ?? ctx.headers['Idempotency-Key']
  let idemKey: string | undefined
  if (typeof idemRaw === 'string' && idemRaw.length > 0) {
    const idem = /^[A-Za-z0-9._-]{8,128}$/.test(idemRaw)
    if (!idem) {
      throw new RpcError('validation', 'Idempotency-Key: 8..128 символов [A-Za-z0-9._-]')
    }
    idemKey = idemRaw
    const replay = findIdempotentCompile(db, idemKey)
    if (replay != null) {
      return { plan: replay.plan, event: replay.event, idempotentReplay: true }
    }
  }
  try {
    const result = compileBatch(db, parsed.data, idemKey)
    return {
      plan: result.plan,
      event: result.event,
      receipts: result.receipts,
      idempotentReplay: result.idempotentReplay,
    }
  } catch (e) {
    if (e instanceof CompileError) throw new RpcError('unprocessable', e.message)
    throw e
  }
}

/* ------------------------------------------------------------------ */
/* POST /v1/batches/:slug/deliver — commander                          */
/* ------------------------------------------------------------------ */

export function deliver(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const slug = parseSlug(ctx.params['slug'] ?? '')
  const row = getBatch(db, slug)
  if (row == null) throw new RpcError('notFound', `batch ${slug} не найден`)
  if (row.status === 'void') throw new RpcError('conflict', `batch ${slug} закрыт (void) — провенанс неприкосновенен`)
  if (row.status === 'delivered') throw new RpcError('conflict', `batch ${slug} уже сдан ${row.delivered_at}`)
  if (!batchHardPass(db, slug)) {
    throw new RpcError(
      'unprocessable',
      `batch ${slug}: hard-гейты планирования НЕ пройдены — сдача запрещена (first run clean, §9)`,
      'перекомпилируй батч с параметрами, которые проходят structure/exp-purity/floors/window'
    )
  }
  const at = new Date().toISOString()
  let eventId = ''
  withTransaction(db, () => {
    const evt = appendEventTx(db, {
      type: 'batch.delivered',
      summary: `Сдан ${slug} «${row.title}»: ${row.slots_total} слотов (EXP ${row.exp_slots}), diff ↑${row.diff_up} ↓${row.diff_down}`,
      data: { slug, slots: row.slots_total, exp: row.exp_slots, sha10: row.sha10 },
      batchSlug: slug,
    })
    eventId = evt.id
    const ok = markDelivered(db, slug, at, evt.id)
    if (!ok) throw new RpcError('conflict', `batch ${slug}: статус сменился под руками — повтори запрос`)
  })
  scheduleSnapshot(`deliver:${slug}`)
  return { slug, status: 'delivered', deliveredAt: at, eventId }
}

/* ------------------------------------------------------------------ */
/* POST /v1/batches/:slug/void — commander (provenance stays, delivery undone) */
/* ------------------------------------------------------------------ */

export function voidBatch(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const slug = parseSlug(ctx.params['slug'] ?? '')
  const row = getBatch(db, slug)
  if (row == null) throw new RpcError('notFound', `batch ${slug} не найден`)
  if (row.status === 'void') throw new RpcError('conflict', `batch ${slug} уже закрыт (void)`)
  const at = new Date().toISOString()
  let eventId = ''
  withTransaction(db, () => {
    const evt = appendEventTx(db, {
      type: 'batch.void',
      summary: `Закрыт ${slug} «${row.title}»: провенанс сохранён, номер не забивается — рекомпиляция void-слага легальна (вердикт автора 2026-10-20)`,
      data: { slug, priorStatus: row.status },
      batchSlug: slug,
    })
    eventId = evt.id
    if (!markVoid(db, slug)) {
      throw new RpcError('conflict', `batch ${slug}: статус сменился под руками — повтори запрос`)
    }
  })
  scheduleSnapshot(`void:${slug}`)
  return { slug, status: 'void', at, eventId }
}

/* ------------------------------------------------------------------ */
/* POST /v1/verdicts — commander (single record per batch+kind)        */
/* ------------------------------------------------------------------ */

export function verdicts(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const parsed = VerdictRequestSchema.safeParse(ctx.body)
  if (!parsed.success) {
    throw new RpcError(
      'validation',
      'verdicts: тело не прошло Zod (strict)',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 400)
    )
  }
  const v = parsed.data
  const batch = getBatch(db, v.slug)
  if (batch == null) throw new RpcError('notFound', `batch ${v.slug} не найден — вердикт без батча не пишется`)
  const kind = v.source === 'author-batch' ? 'author-batch' : 'render.verdict'
  const at = new Date().toISOString()
  const metrics =
    v.metrics !== undefined
      ? { slots: v.metrics.slots ?? batch.slots_total, diffUp: v.metrics.diffUp ?? batch.diff_up, diffDown: v.metrics.diffDown ?? batch.diff_down }
      : { slots: batch.slots_total, diffUp: batch.diff_up, diffDown: batch.diff_down }
  let eventId = ''
  withTransaction(db, () => {
    const evt = appendEventTx(db, {
      type: 'render.verdict',
      summary: `Вердикт ${v.slug} (${kind}/${v.source}): ${v.verdict}${v.note ? ` — ${v.note.slice(0, 200)}` : ''}`,
      data: {
        slug: v.slug,
        kind,
        source: v.source,
        verdict: v.verdict,
        ...(v.confidence !== undefined ? { confidence: v.confidence } : {}),
        metrics,
        ...(v.note !== undefined ? { note: v.note } : {}),
      },
      batchSlug: v.slug,
    })
    eventId = evt.id
    upsertVerdict(db, {
      slug: v.slug,
      kind,
      source: v.source,
      verdict: v.verdict,
      confidence: v.confidence ?? null,
      metricsJson: JSON.stringify(metrics),
      note: v.note ?? null,
      at,
      eventId: evt.id,
    })
  })
  scheduleSnapshot(`verdict:${v.slug}`)
  return { slug: v.slug, kind, verdict: v.verdict, at, eventId, singleRecord: CANON.verdict.singleRecord }
}

/* ------------------------------------------------------------------ */
/* POST /v1/events — commander (generic chronicle append)              */
/* ------------------------------------------------------------------ */

export function appendEvent(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const parsed = AppendEventRequestSchema.safeParse(ctx.body)
  if (!parsed.success) {
    throw new RpcError(
      'validation',
      'events: тело не прошло Zod (strict)',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 400)
    )
  }
  const req = parsed.data
  let eventId = ''
  let at = ''
  withTransaction(db, () => {
    const evt = appendEventTx(db, {
      type: req.type,
      summary: req.summary,
      ...(req.data !== undefined ? { data: req.data } : {}),
    })
    eventId = evt.id
    at = evt.at
  })
  scheduleSnapshot(`event:${req.type}`)
  return { id: eventId, at, type: req.type }
}

/* ------------------------------------------------------------------ */
/* GET /v1/chain/verify — read                                         */
/* ------------------------------------------------------------------ */

export function chainVerify(db: Database): Record<string, unknown> {
  const v = verifyChain(db)
  return { ok: v.ok, events: v.events, head: v.head, problems: v.problems }
}

/* ------------------------------------------------------------------ */
/* POST /v1/payloads/migrate — commander (Фаза 4 «зрячее окно»)         */
/* ------------------------------------------------------------------ */

/** Рематериализация планов файл-эры: легаси-заглушки payload → полные планы
 *  из файл-истины, квитанции payload.migrated в прод-цепь. Тело опционально:
 *  {slug} — один батч, пусто — все легаси. Идемпотентно: повтор ничего
 *  не плодит (легаси-проверка + дедуп квитанции по slug). */
export function payloadsMigrate(db: Database, ctx: HandlerCtx): Record<string, unknown> {
  const body = (ctx.body ?? {}) as { slug?: unknown }
  const slug = typeof body.slug === 'string' && body.slug.trim() !== '' ? body.slug.trim() : undefined
  if (slug != null && !/^T4-[\d.]+(-EXP)?$/.test(slug)) {
    throw new RpcError('validation', `payloads/migrate: слаг «${slug}» не канонический T4-NN`)
  }
  const report = migratePayloads(db, slug ? { slug } : {})
  scheduleSnapshot(`payloads.migrate:${report.migrated.length}`)
  return { ...report }
}
