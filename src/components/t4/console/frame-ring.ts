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

export function pushFrame(f: RingFrame): void {
  ring.push(f)
  if (ring.length > CAP) ring.splice(0, ring.length - CAP)
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
