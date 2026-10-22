/**
 * THREAD 4 ENGINE — token-bucket rate limiting (per client IP).
 *
 * Buckets: compile is expensive (planning + transaction + git snapshot)
 * so it gets a narrow pipe; reads are wide. In-memory, single process —
 * bounded by construction: the map is pruned whenever it grows past
 * MAX_CLIENTS, so a spoofed-IP flood cannot grow memory unbounded.
 */

interface Bucket {
  tokens: number
  lastRefillMs: number
}

export interface BucketSpec {
  capacity: number
  refillPerSec: number
}

export const BUCKETS = {
  open: { capacity: 120, refillPerSec: 2 } as BucketSpec,
  read: { capacity: 240, refillPerSec: 4 } as BucketSpec,
  mutation: { capacity: 30, refillPerSec: 0.5 } as BucketSpec,
  compile: { capacity: 6, refillPerSec: 0.1 } as BucketSpec,
} as const

export type BucketName = keyof typeof BUCKETS

import { RpcError } from './errors'

const MAX_CLIENTS = 4096
const clients = new Map<string, Map<BucketName, Bucket>>()

/** Client IP: peer from the socket is the base; X-Forwarded-For first hop
 * (gateway :81) is trusted ONLY from a loopback peer — the gateway rewrites
 * XFF itself, so a direct client cannot spoof fresh buckets (аудит фазы 6).
 * peerIp == null → local call (CLI/healthcheck): XFF not expected, 'local'. */
export function clientIp(req: Request, peerIp?: string): string {
  if (peerIp != null && peerIp !== 'local') return peerIp
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return peerIp ?? 'local'
}

/** Consume one token; throws RpcError(429) when the bucket is empty. */
export function consume(name: BucketName, ip: string): void {
  const spec: BucketSpec = BUCKETS[name]
  let buckets = clients.get(ip)
  if (buckets == null) {
    if (clients.size >= MAX_CLIENTS) pruneStale()
    buckets = new Map()
    clients.set(ip, buckets)
  }
  const now = Date.now()
  const bucket = buckets.get(name) ?? { tokens: spec.capacity, lastRefillMs: now }
  const elapsedSec = (now - bucket.lastRefillMs) / 1000
  bucket.tokens = Math.min(spec.capacity, bucket.tokens + elapsedSec * spec.refillPerSec)
  bucket.lastRefillMs = now
  if (bucket.tokens < 1) {
    buckets.set(name, bucket)
    throwRateLimited(name)
  }
  bucket.tokens -= 1
  buckets.set(name, bucket)
}

function throwRateLimited(name: BucketName): never {
  throw new RpcError(
    'rateLimited',
    `rate limit: бакет «${name}» пуст — подожди пополнения`,
    'штрафа нет: ведро пополняется само, просто повтори позже'
  )
}

function pruneStale(): void {
  const now = Date.now()
  const deadline = 60_000
  for (const [ip, buckets] of clients) {
    let stale = true
    for (const b of buckets.values()) {
      if (now - b.lastRefillMs < deadline) {
        stale = false
        break
      }
    }
    if (stale) clients.delete(ip)
    if (clients.size < MAX_CLIENTS / 2) return
  }
  /* still too big — drop the oldest half */
  const entries = [...clients.entries()].sort(
    (a, b) =>
      Math.max(...[...a[1].values()].map((x) => x.lastRefillMs)) -
      Math.max(...[...b[1].values()].map((x) => x.lastRefillMs))
  )
  for (const [ip] of entries.slice(0, Math.floor(entries.length / 2))) clients.delete(ip)
}
