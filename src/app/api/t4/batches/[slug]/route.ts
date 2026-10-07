import { NextResponse } from 'next/server'
import path from 'node:path'

import { BATCHES_DIR, readJson, readText } from '@/lib/t4/fsutil'
import { extractBatchTitle } from '@/lib/t4/gates'

export const dynamic = 'force-dynamic'

/**
 * Фред, 2026-10-08: слаг ослаблен до T4-NN + суффиксы (T4-20-EXP,
 * T4-20.1-EXP, T4-22-EXP) — раньше EXP-батчи из списка открывались
 * 400-й и в просмотре была пустота. Каждый сегмент после T4-NN —
 * только [A-Za-z0-9], траверса путей нет.
 */
const SLUG_RE = /^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 })
  }
  const markdown = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (markdown == null) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const meta = readJson<{ title?: string; receipts?: unknown[] }>(
    path.join(BATCHES_DIR, `${slug}.json`)
  )
  /* title: JSON → H1 батча (RAW/EXP без контракта) → слаг */
  const jsonTitle = meta?.title && meta.title !== slug ? meta.title : ''
  const title = jsonTitle || extractBatchTitle(markdown) || slug
  return NextResponse.json({
    slug,
    title,
    markdown,
    receipts: meta?.receipts ?? [],
  })
}
