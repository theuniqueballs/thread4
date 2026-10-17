/**
 * THREAD 4 ENGINE — commander lock (Залп 1 «Правда»).
 *
 * Mutations are commander-only; the key rides the x-commander-key HEADER
 * (never a query param — logs and referrers must not see secrets).
 * Comparison is timing-safe over sha256 digests of BOTH sides. Fail
 * closed: no key file → mutations locked with 503 setupRequired.
 * Read boundary: ~/.t4/read.lock present → GET requires the key too
 * (one operator, one secret — Issue #2/#47 semantics, ported).
 */
import fs from 'node:fs'

import { timingSafeEqualStr } from '../lib/canonical'
import { COMMANDER_KEY_PATH, READ_LOCK_PATH } from '../lib/paths'
import { RpcError } from './errors'

let keyCache: { mtimeMs: number; key: string | null } | null = null

/** Read the commander key with mtime caching (read boundary declared). */
export function readCommanderKey(): string | null {
  try {
    const st = fs.statSync(COMMANDER_KEY_PATH)
    if (keyCache && keyCache.mtimeMs === st.mtimeMs) return keyCache.key
    const key = fs.readFileSync(COMMANDER_KEY_PATH, 'utf-8').trim()
    keyCache = { mtimeMs: st.mtimeMs, key: key.length > 0 ? key : null }
    return keyCache.key
  } catch {
    keyCache = null
    return null
  }
}

export function readLocked(): boolean {
  try {
    return fs.existsSync(READ_LOCK_PATH)
  } catch {
    return false
  }
}

/** Extract the presented key — header only, by doctrine. */
export function presentedKey(req: Request): string {
  return req.headers.get('x-commander-key') ?? ''
}

/** Mutation guard. Throws RpcError on failure (403 / 503). */
export function requireCommander(req: Request): void {
  const expected = readCommanderKey()
  if (expected == null) {
    throw new RpcError(
      'setupRequired',
      'commander-key не создан — мутации залочены (Залп 1 «Правда»)',
      'создай ~/.t4/commander.key (32+ случайных символа) и передавай в заголовке x-commander-key'
    )
  }
  const provided = presentedKey(req)
  if (provided === '' || !timingSafeEqualStr(provided, expected)) {
    throw new RpcError('auth', 'чужой или пустой commander-key — операция запрещена')
  }
}

/** Read guard: open reads unless read.lock is present. */
export function requireRead(req: Request): void {
  if (!readLocked()) return
  requireCommander(req)
}
