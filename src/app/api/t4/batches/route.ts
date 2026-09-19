import { NextResponse } from 'next/server'

import { BATCHES_DIR, listFiles, readJson } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET() {
  const items = listFiles(BATCHES_DIR, '.md').map((f) => {
    const meta = readJson<{ title?: string; date?: string; theme?: string }>(
      `${BATCHES_DIR}/${f.base}.json`
    )
    return {
      slug: f.base,
      title: meta?.title ?? meta?.theme ?? f.base,
      date: meta?.date ?? '',
    }
  })
  return NextResponse.json({ items: items.sort((a, b) => b.slug.localeCompare(a.slug)) })
}
