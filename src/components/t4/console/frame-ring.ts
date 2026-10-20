'use client'

/**
 * THREAD 4 — КОЛЬЦО КАДРОВ живой консоли (cutover-эра, 2026-10-20).
 *
 * LiveConsole копирует сюда каждый SSE-кадр; карточки этапов и «Copy for AI»
 * читают структурированный хвост без лезанья во внутренности консоли.
 * Один процесс вкладки, без проброса пропсов — модуль-синглтон.
 */

export interface RingFrame {
  seq: number
  block: string
  level: 'info' | 'warn' | 'error'
  text: string
  at: string
}

const CAP = 400
const ring: RingFrame[] = []
/* Дедуп по seq: реплей истории при каждом новом монтировании консоли
 * (?after=0 — twin честно перепосылает весь хвост) раньше раздувал кольцо
 * копиями (инцидент 2026-10-20: дамп автора нёс hard-фейл ×5 при одном
 * реальном провале). Seq уникален в пределах жизни шины — дублей внутри
 * одной шины не бывает; чистка сета при вытеснении держит память в узде. */
const seenSeqs = new Set<number>()

export function pushFrame(f: RingFrame): void {
  if (seenSeqs.has(f.seq)) return
  seenSeqs.add(f.seq)
  ring.push(f)
  if (ring.length > CAP) {
    ring.splice(0, ring.length - CAP)
    seenSeqs.clear()
    for (const x of ring) seenSeqs.add(x.seq)
  }
}

export function recentFrames(n: number): RingFrame[] {
  return ring.slice(-Math.max(1, n))
}

export function errorFrames(): RingFrame[] {
  return ring.filter((f) => f.level === 'error')
}

export function ringStats(): { total: number; errors: number } {
  return { total: ring.length, errors: ring.filter((f) => f.level === 'error').length }
}
