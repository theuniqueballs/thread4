/**
 * THREAD 4 — Dresser Map API (флагман тура 2, 2026-10-15).
 *
 * GET /api/t4/dresser-map/[slug] — структурный анализ расхождения
 * заявки контракта vs вердикта автора по слагу. Читает контракт +
 * последний author-batch вердикт, пересчитывает каналы Дрессера,
 * классифицирует отказы, генерирует уроки для следующего батча.
 *
 * Залп 1: requireRead (карта несёт prose автора — его нужно прятать).
 */
import { NextResponse } from 'next/server'

import { requireRead } from '@/lib/t4/apiguard'
import { assertSafeSlug } from '@/lib/t4/fsutil'
import { buildDresserMap } from '@/lib/t4/dresser-map'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const read = requireRead(req)
  if (!read.ok) return read.response

  const { slug } = await params
  try {
    assertSafeSlug(slug)
  } catch {
    return NextResponse.json({ error: 'плохой слаг' }, { status: 400 })
  }

  const map = buildDresserMap(slug)
  if (!map) {
    return NextResponse.json(
      { error: `контракт ${slug} не найден или не содержит слотов` },
      { status: 404 }
    )
  }
  return NextResponse.json(map)
}
