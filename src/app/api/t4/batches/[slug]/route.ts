import { NextResponse } from 'next/server'

import { requireRead } from '@/lib/t4/apiguard'
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
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const read = requireRead(req)
  if (!read.ok) return read.response
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
  /* квитанции — нормализация на границе API: findings/level/verdict —
   * строки, findings — массив строк. Крэш T4-28 retro-fix #1 (receipts без
   * findings → TypeError → вкладка умерла) чинился правкой ДАННЫХ — теперь
   * код держит любую форму (webDevReview #8) */
  const receipts = (Array.isArray(meta?.receipts) ? meta.receipts : []).map((r) => {
    const rec = (r ?? {}) as Record<string, unknown>
    return {
      gate: String(rec.gate ?? ''),
      level: String(rec.level ?? ''),
      verdict: String(rec.verdict ?? ''),
      findings: Array.isArray(rec.findings) ? rec.findings.map((f) => String(f)) : [],
      /* аудит 2026-10-12: notes — не-фейлящие факты (видимость окна);
       * раньше стрипались маппингом и UI их не видел никогда */
      ...(Array.isArray(rec.notes) && rec.notes.length > 0
        ? { notes: rec.notes.map((n) => String(n)) }
        : {}),
    }
  })
  return NextResponse.json({
    slug,
    title,
    markdown,
    receipts,
  })
}
