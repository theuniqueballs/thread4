/**
 * THREAD 4 ENGINE — typed RPC client (shared by the CLI and the
 * Next.js dashboard bridge).
 *
 * Server-side consumers point T4_ENGINE_URL at the engine directly
 * (default http://127.0.0.1:3200). Browser code must go through the
 * Caddy gateway with a RELATIVE url + ?XTransformPort=3200 — set
 * T4_ENGINE_URL to '' and pass gatewayPath instead.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ENGINE_URL = process.env['T4_ENGINE_URL'] ?? 'http://127.0.0.1:3200'

export class EngineError extends Error {
  readonly code: string
  readonly status: number
  readonly hint?: string

  constructor(code: string, message: string, status: number, hint?: string) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.status = status
    if (hint !== undefined) this.hint = hint
  }
}

interface WireError {
  ok: false
  error: { code: string; message: string; hint?: string }
}

export interface RpcOptions {
  key?: string
  body?: unknown
  timeoutMs?: number
  idempotencyKey?: string
}

export async function rpc<T>(
  method: 'GET' | 'POST',
  route: string,
  opts: RpcOptions = {}
): Promise<T> {
  const url = `${ENGINE_URL}${route.startsWith('/') ? '' : '/'}${route}`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.key !== undefined && opts.key !== '') headers['x-commander-key'] = opts.key
  if (opts.idempotencyKey !== undefined) headers['Idempotency-Key'] = opts.idempotencyKey

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new EngineError('unavailable', `движок не отвечает (${ENGINE_URL}): ${reason}`, 503)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new EngineError('internal', `движок вернул не-JSON (HTTP ${res.status})`, res.status)
  }

  const wire = json as { ok: boolean; data?: T } | WireError
  if (!wire.ok) {
    const err = (json as WireError).error
    throw new EngineError(err.code, err.message, res.status, err.hint)
  }
  return (wire as { ok: true; data: T }).data
}

/* ------------------------------------------------------------------ */
/* Typed surface                                                       */
/* ------------------------------------------------------------------ */

export interface EngineHealth {
  ok: boolean
  era: string
  engine: string
  version: string
  canon: string
  uptimeSec: number
}

export interface EngineState {
  era: string
  canon: string
  fam: string
  nextSlug: string
  lastDelivered: { slug: string; title: string; deliveredAt: string | null; diffUp: number; diffDown: number } | null
  counts: { events: number; batchesDelivered: number; batchesCompiled: number; verdicts: number }
  chain: { height: number; head: string | null; ok: boolean; problems: string[] }
  db: { file: string; bytes: number; schemaVersion: number }
  uptimeSec: number
}

export interface CompilePlan {
  slug: string
  title: string
  theme: string
  engine: string
  seed: string
  slots: Array<{
    position: number
    kind: string
    rating: string
    register: string
    ocTheme?: string
    race?: string
    paletteId: string
    ab?: { pair: number; half: string }
    exp?: { letter: string; half: string; pairWith?: number; hypothesis: string }
  }>
  exp: number
  abPairs: number
  paletteWindow: { union: number; budget: number; extensionFree: number }
  receipts: Array<{ gate: string; level: string; verdict: string; findings: string[]; notes?: string[] }>
  diff: { up: number; down: number; against: string | null }
  sha10: string
  createdAt: string
}

export const api = {
  health: () => rpc<EngineHealth>('GET', '/v1/health', { timeoutMs: 2500 }),
  meta: () => rpc<Record<string, unknown>>('GET', '/v1/meta'),
  state: () => rpc<EngineState>('GET', '/v1/state'),
  events: (after = 0, limit = 100) =>
    rpc<{ events: Array<Record<string, unknown>>; returned: number; total: number }>('GET', `/v1/events?after=${after}&limit=${limit}`),
  batches: () => rpc<{ batches: Array<Record<string, unknown>>; returned: number }>('GET', '/v1/batches'),
  batch: (slug: string) => rpc<Record<string, unknown>>('GET', `/v1/batches/${slug}`),
  verify: () => rpc<{ ok: boolean; events: number; head: string | null; problems: string[] }>('GET', '/v1/chain/verify'),
  compile: (draft: Record<string, unknown>, key: string, idempotencyKey?: string) =>
    rpc<{ plan: CompilePlan; event: { id: string; at: string; seq: number }; receipts: unknown[]; idempotentReplay: boolean }>(
      'POST',
      '/v1/compile',
      { key, body: draft, timeoutMs: 15000, ...(idempotencyKey ? { idempotencyKey } : {}) }
    ),
  deliver: (slug: string, key: string) =>
    rpc<{ slug: string; status: string; deliveredAt: string; eventId: string }>('POST', `/v1/batches/${slug}/deliver`, { key, timeoutMs: 10000 }),
  voidBatch: (slug: string, key: string) =>
    rpc<{ slug: string; status: string; at: string; eventId: string }>('POST', `/v1/batches/${slug}/void`, { key, timeoutMs: 10000 }),
  verdict: (body: Record<string, unknown>, key: string) =>
    rpc<Record<string, unknown>>('POST', '/v1/verdicts', { key, body }),
  note: (summary: string, key: string, data?: Record<string, unknown>) =>
    rpc<{ id: string; at: string; type: string }>('POST', '/v1/events', { key, body: { type: 'note', summary, ...(data ? { data } : {}) } }),
}

/* ------------------------------------------------------------------ */
/* CLI key loading (operator machine only)                             */
/* ------------------------------------------------------------------ */

export function loadCommanderKey(): string | null {
  const p = path.join(os.homedir(), '.t4', 'commander.key')
  try {
    const key = fs.readFileSync(p, 'utf-8').trim()
    return key.length > 0 ? key : null
  } catch {
    return null
  }
}
