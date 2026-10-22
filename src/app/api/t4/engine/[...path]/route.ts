import { NextResponse } from 'next/server'

import { requireCommander, requireRead } from '@/lib/t4/apiguard'
import { readChronicle } from '@/lib/t4/consciousness'

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
    if (method === 'GET' && res.ok && /^batches(\/T4-\d{2,3})?$/.test(enginePath)) {
      return new Response(await reconcileBatchStatus(enginePath, text), {
        status: res.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
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

/**
 * Сверка статусов с летописью на краю (фаза 6, §2 — состояние выводится из
 * событий). Находка: сданный слаг (T4-33, файл-эра) отображался «Compiled» —
 * проекция движка может отставать от цепи (пересборка БД, миграции).
 * Кромка обогащает ответ движка union-летописью: batch.delivered/batch.void
 * в хронике — СТАРШЕ проекции (только вверх: compiled→delivered/void; вниз
 * ничего не понижаем). Сверка best-effort: летопись недоступна — ответ
 * движка идёт как есть (честная деградация, не подмена).
 */
async function reconcileBatchStatus(enginePath: string, rawText: string): Promise<string> {
  try {
    const chron = await readChronicle()
    const delivered = new Map<string, string>()
    const voided = new Set<string>()
    for (const e of chron.events) {
      const slug = typeof e.data?.slug === 'string' ? e.data.slug : null
      if (slug == null) continue
      if (e.type === 'batch.delivered') delivered.set(slug, e.at)
      else if (e.type === 'batch.void') voided.add(slug)
    }
    const patchRow = (row: Record<string, unknown>): void => {
      const slug = typeof row['slug'] === 'string' ? row['slug'] : null
      if (slug == null) return
      if (delivered.has(slug) && row['status'] !== 'delivered') {
        row['status'] = 'delivered'
        row['deliveredAt'] = delivered.get(slug) ?? null
      } else if (voided.has(slug) && row['status'] !== 'void') {
        row['status'] = 'void'
      }
    }
    const raw = JSON.parse(rawText) as { data?: unknown }
    const data = raw.data
    if (enginePath === 'batches' && data != null && typeof data === 'object' && Array.isArray((data as { batches?: unknown }).batches)) {
      for (const r of (data as { batches: unknown[] }).batches) {
        if (r != null && typeof r === 'object') patchRow(r as Record<string, unknown>)
      }
    } else if (data != null && typeof data === 'object' && typeof (data as { slug?: unknown }).slug === 'string') {
      patchRow(data as Record<string, unknown>)
    }
    return JSON.stringify(raw)
  } catch {
    /* летопись недоступна (twin молчит) — проекция движка идёт как есть */
    return rawText
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
