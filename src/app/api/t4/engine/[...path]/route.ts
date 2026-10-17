import { NextResponse } from 'next/server'

import { requireCommander, requireRead } from '@/lib/t4/apiguard'

export const dynamic = 'force-dynamic'

/**
 * Движок-эра (2026-10-17): RPC-мост дашборда → t4-engine (:3200).
 *
 * t4-engine (bun:sqlite + Bun.serve) — ЕДИНСТВЕННЫЙ источник истины для
 * состояния конвейера; файловая эра объявлена устаревшей. Этот роут —
 * тонкий, типизированный прокси с allowlist'ом путей: браузер говорит с
 * движком ТОЛЬКО через относительный `/api/t4/engine/<path>` (никаких
 * абсолютных URL и прямых портов во фронте — граница шлюза :81 объявлена
 * в Стекле). Мутации проходят локальный замок командира ДО проброса:
 * ключ живёт в заголовке и не оседает в чужих логах.
 */

const ENGINE_ORIGIN = process.env.T4_ENGINE_ORIGIN ?? 'http://127.0.0.1:3200'

/** GET-пути (чтение): allowlist, никаких wildcard'ов. */
const GET_ALLOW = new Set(['health', 'meta', 'state', 'events', 'batches', 'chain/verify'])

/** POST-пути (мутации): compile / verdicts / events / batches/:slug/deliver|void. */
const POST_ALLOW_RE = [
  /^compile$/,
  /^verdicts$/,
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

async function proxy(
  method: 'GET' | 'POST',
  enginePath: string,
  req: Request
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), method === 'POST' ? 15_000 : 5_000)
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const key = req.headers.get('x-commander-key')
    if (key) headers['x-commander-key'] = key
    const idem = req.headers.get('idempotency-key')
    if (idem) headers['Idempotency-Key'] = idem
    const body = method === 'POST' ? await req.text() : undefined
    const qs = method === 'GET' ? `?${new URL(req.url).searchParams.toString()}` : ''
    const res = await fetch(`${ENGINE_ORIGIN}/v1/${enginePath}${qs}`, {
      method,
      headers,
      ...(body !== undefined && body.length > 0 ? { body } : {}),
      signal: controller.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'таймаут' : 'движок молчит'
    return NextResponse.json(
      { ok: false, error: { code: 'unavailable', message: `t4-engine недоступен: ${reason}` } },
      { status: 503 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const read = requireRead(req)
  if (!read.ok) return read.response
  const { path } = await params
  const enginePath = joinPath(path ?? [])
  const isBatchCard =
    enginePath != null && /^batches\/T4-\d{2,3}$/.test(enginePath)
  if (enginePath == null || (!GET_ALLOW.has(enginePath) && !isBatchCard)) {
    return NextResponse.json({ error: 'engine path не в allowlist' }, { status: 400 })
  }
  return proxy('GET', enginePath, req)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  const { path } = await params
  const enginePath = joinPath(path ?? [])
  if (enginePath == null || !POST_ALLOW_RE.some((re) => re.test(enginePath))) {
    return NextResponse.json({ error: 'engine path не в allowlist' }, { status: 400 })
  }
  return proxy('POST', enginePath, req)
}
