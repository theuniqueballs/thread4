import { NextResponse } from 'next/server'

import { requireCommander, requireRead } from '@/lib/t4/apiguard'

export const dynamic = 'force-dynamic'

/**
 * Фаза 2 (Rust-эра, 2026-10-19): RPC-мост дашборда → t4-engine-rs (:3201).
 *
 * Rust twin — читает продакшн-летопись RO, пишет свою scratch-летопись
 * (доктрина dual-DB). Воркфлоу «Тема → Expand → Compile → Deliver» живёт
 * на twin: полный цикл доказывается без риска для SSoT. SSE /live идёт
 * СТРИМОМ (ReadableStream passthrough) — heartbeat 15с от twin'а, шлюз
 * не рвёт молчаливые соединения (лекарство инцидента «Не удалось записать»).
 *
 * Мутации дважды заперты: локальный замок командира (requireCommander)
 * ДО проброса + замок самого twin'а (x-commander-key, timing-safe).
 */

const TWIN_ORIGIN = process.env.T4_RUST_ORIGIN ?? 'http://127.0.0.1:3201'

/** GET-пути (чтение): allowlist, никаких wildcard'ов. */
const GET_ALLOW = new Set(['health', 'meta', 'state', 'live', 'events', 'batches', 'chain/verify'])

/** POST-пути: theme (expand/check — чистые вычисления) + compile + gates
 * (батарея Review: twin гоняет квитанции по scratch-драфту, ключ командира
 * проксируется как у compile) + deliver/void + events. */
const POST_ALLOW_RE = [
  /^theme\/expand$/,
  /^theme\/check$/,
  /^compile$/,
  /^gates$/,
  /^events$/,
  /^batches\/T4-\d{2,3}\/deliver$/,
  /^batches\/T4-\d{2,3}\/void$/,
]

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,24}$/

function joinPath(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 4) return null
  for (const s of segments) {
    if (!SEGMENT_RE.test(s)) return null
  }
  return segments.join('/')
}

/** Прозрачный проброс ответа (для SSE — телом-стримом, без буферизации). */
function passthrough(res: Response, contentType: string): Response {
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const read = requireRead(req)
  if (!read.ok) return read.response
  const { path } = await params
  const twinPath = joinPath(path ?? [])
  const isBatchCard = twinPath != null && /^batches\/T4-\d{2,3}$/.test(twinPath)
  if (twinPath == null || (!GET_ALLOW.has(twinPath) && !isBatchCard)) {
    return NextResponse.json({ error: 'twin path не в allowlist' }, { status: 400 })
  }

  const qs = `?${new URL(req.url).searchParams.toString()}`

  /* SSE: долгоживущий поток — без таймаута, тело идёт стримом */
  if (twinPath === 'live') {
    try {
      const res = await fetch(`${TWIN_ORIGIN}/v1/live${qs}`, {
        headers: { accept: 'text/event-stream' },
        cache: 'no-store',
      })
      return passthrough(res, 'text/event-stream; charset=utf-8')
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'unavailable', message: 'twin live-поток недоступен' } },
        { status: 503 }
      )
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const res = await fetch(`${TWIN_ORIGIN}/v1/${twinPath}${qs}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'unavailable', message: 'twin недоступен (timeout)' } },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  const { path } = await params
  const twinPath = joinPath(path ?? [])
  if (twinPath == null || !POST_ALLOW_RE.some((re) => re.test(twinPath))) {
    return NextResponse.json({ error: 'twin path не в allowlist' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const key = req.headers.get('x-commander-key')
    if (key) headers['x-commander-key'] = key
    const idem = req.headers.get('idempotency-key')
    if (idem) headers['Idempotency-Key'] = idem
    const body = await req.text()
    const res = await fetch(`${TWIN_ORIGIN}/v1/${twinPath}`, {
      method: 'POST',
      headers,
      ...(body.length > 0 ? { body } : {}),
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'таймаут' : 'twin молчит'
    return NextResponse.json(
      { ok: false, error: { code: 'unavailable', message: `twin недоступен: ${reason}` } },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
