import { NextResponse } from 'next/server'
import path from 'node:path'

import { BATCHES_DIR, readJson, readText } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!/^T4-\d{2}$/.test(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 })
  }
  const markdown = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (markdown == null) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const meta = readJson<{ title?: string; receipts?: unknown[] }>(
    path.join(BATCHES_DIR, `${slug}.json`)
  )
  return NextResponse.json({
    slug,
    title: meta?.title ?? slug,
    markdown,
    receipts: meta?.receipts ?? [],
  })
}
