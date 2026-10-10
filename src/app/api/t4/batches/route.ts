import { NextResponse } from 'next/server'

import { BATCHES_DIR, CONTRACTS_DIR, listFiles, readJson, readText } from '@/lib/t4/fsutil'
import { extractBatchTitle } from '@/lib/t4/gates'

export const dynamic = 'force-dynamic'

/**
 * Список батчей для дропдаунов (Батчи / Вердикты / Приёмник).
 * Фред, 2026-10-08: тайтл больше не падает в голый слаг —
 * у RAW-батчей (T4-23/24) delivery записал title=slug из-за старого
 * парсера H1, у EXP-батчей JSON нет вовсе. Порядок: честный title из
 * JSON (не селф-слаг) → theme → тайтл из H1 батча → слаг.
 * Преемник, 2026-10-11: rebuildOf из контракта — маркер перестройки в UI.
 */
export async function GET() {
  const items = listFiles(BATCHES_DIR, '.md').map((f) => {
    const meta = readJson<{ title?: string; date?: string; theme?: string }>(
      `${BATCHES_DIR}/${f.base}.json`
    )
    const jsonTitle = meta?.title && meta.title !== f.base ? meta.title : ''
    const md = readText(`${BATCHES_DIR}/${f.base}.md`)
    const headerTitle = md ? extractBatchTitle(md) : ''
    const contract = readJson<{ rebuildOf?: string }>(`${CONTRACTS_DIR}/${f.base}.json`)
    return {
      slug: f.base,
      title: jsonTitle || meta?.theme || headerTitle || f.base,
      date: meta?.date ?? '',
      rebuildOf: contract?.rebuildOf ?? '',
    }
  })
  return NextResponse.json({ items: items.sort((a, b) => b.slug.localeCompare(a.slug)) })
}
