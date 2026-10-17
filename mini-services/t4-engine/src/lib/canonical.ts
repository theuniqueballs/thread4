/**
 * THREAD 4 ENGINE — canonical serialization.
 *
 * The hash chain commits to the EXACT raw line (legacy formula:
 * sha256(prev + '|' + rawLine)). Storing `raw` in the events table makes
 * verification byte-exact; stable stringify makes REGENERATION of the
 * line from structured fields deterministic as well (idempotent folds,
 * reproducible audits).
 */
import crypto from 'node:crypto'

/** Stable JSON: object keys sorted recursively, UTF-8, no whitespace. */
export function stableStringify(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value) as string
  }
  if (typeof value === 'string') return JSON.stringify(value) as string
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`
  }
  /* undefined at top level — legacy JSON.stringify gives 'null' */
  return 'null'
}

/** The event line shape is frozen history: {id,at,type,summary,data?} in
 *  that key order, data omitted when absent — identical to the file era. */
export interface CanonicalEvent {
  id: string
  at: string
  type: string
  summary: string
  data?: Record<string, unknown>
}

export function canonicalEventLine(evt: CanonicalEvent): string {
  const parts = [
    `"id":${JSON.stringify(evt.id)}`,
    `"at":${JSON.stringify(evt.at)}`,
    `"type":${JSON.stringify(evt.type)}`,
    `"summary":${JSON.stringify(evt.summary)}`,
  ]
  if (evt.data !== undefined) parts.push(`"data":${stableStringify(evt.data)}`)
  return `{${parts.join(',')}}`
}

/** sha256(prev + '|' + line) — the «Правда» chain formula, unchanged. */
export function chainHash(prev: string, rawLine: string): string {
  return crypto
    .createHash('sha256')
    .update(`${prev}|${rawLine.replace(/[\r\n]+$/, '')}`, 'utf-8')
    .digest('hex')
}

/** Short sha (sha10) of any canonical payload — batch fingerprints. */
export function payloadSha10(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf-8').digest('hex').slice(0, 10)
}

/** timing-safe string equality (compares sha256 digests, never lengths). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf-8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf-8').digest()
  return crypto.timingSafeEqual(ha, hb)
}
