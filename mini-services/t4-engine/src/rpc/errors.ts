/**
 * THREAD 4 ENGINE — RPC error taxonomy.
 *
 * Every failure leaves the wire as {ok:false, error:{code,message}} with
 * an honest HTTP status. Internal details (absolute paths, stack traces)
 * never cross the boundary: the full text stays in the engine log.
 */

export type RpcErrorCode =
  | 'validation'
  | 'auth'
  | 'setupRequired'
  | 'notFound'
  | 'methodNotAllowed'
  | 'conflict'
  | 'unprocessable'
  | 'payloadTooLarge'
  | 'rateLimited'
  | 'internal'
  | 'unavailable'

const HTTP_BY_CODE: Record<RpcErrorCode, number> = {
  validation: 400,
  auth: 403,
  setupRequired: 503,
  notFound: 404,
  methodNotAllowed: 405,
  conflict: 409,
  unprocessable: 422,
  payloadTooLarge: 413,
  rateLimited: 429,
  internal: 500,
  unavailable: 503,
}

export class RpcError extends Error {
  readonly code: RpcErrorCode
  readonly status: number
  readonly hint?: string

  constructor(code: RpcErrorCode, message: string, hint?: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.status = HTTP_BY_CODE[code]
    if (hint !== undefined) this.hint = hint
  }
}

/** Strip machine internals from arbitrary errors before they hit the wire. */
export function sanitizeErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return (
    raw
      .replace(/\/home\/[^\s'"`,:)]+/g, (m) => m.slice(m.lastIndexOf('/') + 1))
      .replace(/\(node:\d+\)\s*/g, '')
      .slice(0, 500)
  )
}
