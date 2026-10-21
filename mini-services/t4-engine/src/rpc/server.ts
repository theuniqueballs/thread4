/**
 * THREAD 4 ENGINE — server.ts: the Bun.serve() routing core.
 *
 * THE Single Source of Truth. Both the Next.js dashboard (through the
 * Caddy gateway, `?XTransformPort=3200`) and the CLI tool speak THIS
 * process; nothing else writes state. Request lifecycle, in order:
 *
 *   1. body size guard (Content-Length + Bun maxRequestBodySize)
 *   2. route match (method + pattern, :params extracted & validated)
 *   3. rate limit (token bucket per client IP)
 *   4. auth (open | read | commander — header-only key, timing-safe)
 *   5. body parse (JSON only, content-type enforced)
 *   6. Zod validation happens inside handlers via schemas (strict)
 *   7. handler → {ok:true,data} envelope
 *   8. failures → RpcError taxonomy, sanitized, logged server-side only
 *
 * Compile safety: idempotency (Idempotency-Key), strict body schemas,
 * single-writer transactions, deterministic planning — a retried or
 * replayed compilation can NEVER double-append the chronicle.
 */
import type { Database } from 'bun:sqlite'

import { CANON } from '../config/canon'
import { RpcError, sanitizeErrorText } from './errors'
import { requireCommander, requireRead } from './auth'
import { clientIp, consume, type BucketName } from './ratelimit'
import {
  appendEvent,
  batches,
  chainVerify,
  compile,
  deliver,
  events,
  health,
  meta,
  payloadsMigrate,
  state,
  verdicts,
  voidBatch,
  type HandlerCtx,
} from './handlers'

/* ------------------------------------------------------------------ */
/* Route table                                                         */
/* ------------------------------------------------------------------ */

type AuthLevel = 'open' | 'read' | 'commander'

interface RouteDef {
  method: 'GET' | 'POST'
  /** Pattern segments; ':name' captures one segment. */
  pattern: string[]
  auth: AuthLevel
  bucket: BucketName
  handler: (db: Database, ctx: HandlerCtx) => Record<string, unknown> | Promise<Record<string, unknown>>
}

const ROUTES: readonly RouteDef[] = [
  { method: 'GET', pattern: ['v1', 'health'], auth: 'open', bucket: 'open', handler: () => health() },
  { method: 'GET', pattern: ['v1', 'meta'], auth: 'open', bucket: 'open', handler: () => meta() },
  { method: 'GET', pattern: ['v1', 'state'], auth: 'read', bucket: 'read', handler: (db) => state(db) },
  { method: 'GET', pattern: ['v1', 'events'], auth: 'read', bucket: 'read', handler: (db, ctx) => events(db, ctx) },
  { method: 'GET', pattern: ['v1', 'batches'], auth: 'read', bucket: 'read', handler: (db, ctx) => batches(db, ctx) },
  { method: 'GET', pattern: ['v1', 'batches', ':slug'], auth: 'read', bucket: 'read', handler: (db, ctx) => batches(db, ctx) },
  {
    method: 'GET',
    pattern: ['v1', 'chain', 'verify'],
    auth: 'read',
    bucket: 'read',
    handler: (db) => chainVerify(db),
  },
  {
    method: 'POST',
    pattern: ['v1', 'compile'],
    auth: 'commander',
    bucket: 'compile',
    handler: (db, ctx) => compile(db, ctx),
  },
  {
    method: 'POST',
    pattern: ['v1', 'batches', ':slug', 'deliver'],
    auth: 'commander',
    bucket: 'mutation',
    handler: (db, ctx) => deliver(db, ctx),
  },
  {
    method: 'POST',
    pattern: ['v1', 'batches', ':slug', 'void'],
    auth: 'commander',
    bucket: 'mutation',
    handler: (db, ctx) => voidBatch(db, ctx),
  },
  {
    method: 'POST',
    pattern: ['v1', 'verdicts'],
    auth: 'commander',
    bucket: 'mutation',
    handler: (db, ctx) => verdicts(db, ctx),
  },
  {
    method: 'POST',
    pattern: ['v1', 'events'],
    auth: 'commander',
    bucket: 'mutation',
    handler: (db, ctx) => appendEvent(db, ctx),
  },
  {
    method: 'POST',
    pattern: ['v1', 'payloads', 'migrate'],
    auth: 'commander',
    bucket: 'mutation',
    handler: (db, ctx) => payloadsMigrate(db, ctx),
  },
]

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-engine': 't4-engine/1.0.0',
}

function ok(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: JSON_HEADERS })
}

function fail(e: RpcError): Response {
  const errObj: Record<string, unknown> = { code: e.code, message: e.message }
  if (e.hint !== undefined) errObj['hint'] = e.hint
  return new Response(JSON.stringify({ ok: false, error: errObj }), { status: e.status, headers: JSON_HEADERS })
}

/* ------------------------------------------------------------------ */
/* Body handling                                                       */
/* ------------------------------------------------------------------ */

async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > CANON.serve.maxBodyBytes) {
    throw new RpcError('payloadTooLarge', `compile: тело ${declared} байт > лимита ${CANON.serve.maxBodyBytes}`)
  }
  const ctype = (req.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  if (ctype !== '' && ctype !== 'application/json') {
    throw new RpcError('validation', `content-type «${ctype}» не поддерживается — application/json only`)
  }
  const raw = await req.text()
  if (raw.length === 0) return null /* param-only endpoints (deliver/void) post no body */
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new RpcError('validation', 'тело не парсится как JSON')
  }
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

interface MatchResult {
  route: RouteDef
  params: Record<string, string>
}

function matchRoute(method: string, segments: string[]): MatchResult | 'notFound' | 'methodNotAllowed' {
  let sawPath = false
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue
    if (route.pattern.some((seg, i) => seg.startsWith(':') ? false : seg !== segments[i])) continue
    sawPath = true
    if (route.method !== method) continue
    const params: Record<string, string> = {}
    for (let i = 0; i < route.pattern.length; i++) {
      const seg = route.pattern[i]!
      if (seg.startsWith(':')) {
        const value = segments[i] ?? ''
        if (!/^[A-Za-z0-9._-]{1,16}$/.test(value)) {
          throw new RpcError('validation', `параметр «${seg.slice(1)}» содержит недопустимые символы`)
        }
        params[seg.slice(1)] = value
      }
    }
    return { route, params }
  }
  return sawPath ? 'methodNotAllowed' : 'notFound'
}

/** Request log line — method, path, status, duration. No bodies, no keys. */
function logLine(method: string, path: string, status: number, ms: number): void {
  console.log(`[t4-engine] ${new Date().toISOString()} ${method} ${path} → ${status} (${ms.toFixed(1)}ms)`)
}

export function createRouter(db: Database): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const started = performance.now()
    const url = new URL(req.url)
    const path = url.pathname
    let status = 500
    try {
      /* root: honest pointer for wanderers */
      if (path === '/' || path === '') {
        status = 200
        return ok({
          engine: 't4-engine',
          era: CANON.era,
          canon: CANON.version,
          endpoints: ROUTES.map((r) => `${r.method} /${r.pattern.map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s)).join('/')}`),
        })
      }

      const segments = path.split('/').map((s) => decodeURIComponent(s)).filter((s) => s.length > 0)
      const match = matchRoute(req.method, segments)

      if (match === 'notFound') {
        status = 404
        throw new RpcError('notFound', `роута нет: ${req.method} ${path} — смотри GET /`)
      }
      if (match === 'methodNotAllowed') {
        status = 405
        throw new RpcError('methodNotAllowed', `${req.method} не разрешён на ${path}`)
      }

      const { route, params } = match

      /* rate limit BEFORE auth: brute-force key guessing pays the bucket */
      const ip = clientIp(req)
      consume(route.bucket, ip)

      if (route.auth === 'commander') requireCommander(req)
      else if (route.auth === 'read') requireRead(req)

      const ctx: HandlerCtx = {
        params,
        query: url.searchParams,
        body: route.method === 'POST' ? await readJsonBody(req) : null,
        headers: Object.fromEntries(req.headers.entries()),
      }

      const data = await route.handler(db, ctx)
      status = 200
      return ok(data)
    } catch (e) {
      if (e instanceof RpcError) {
        status = e.status
        return fail(e)
      }
      /* unknown — sanitized on the wire, full text in the engine log */
      status = 500
      const message = sanitizeErrorText(e)
      console.error(`[t4-engine] internal ${req.method} ${path}:`, e)
      return fail(new RpcError('internal', `внутренняя ошибка движка: ${message}`))
    } finally {
      logLine(req.method, path, status, performance.now() - started)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Server bootstrap                                                    */
/* ------------------------------------------------------------------ */

export function serve(db: Database): ReturnType<typeof Bun.serve> {
  const router = createRouter(db)
  const server = Bun.serve({
    port: CANON.serve.port,
    hostname: CANON.serve.hostname,
    idleTimeout: 30,
    maxRequestBodySize: CANON.serve.maxBodyBytes,
    fetch: (req) => router(req),
  })
  return server
}
