import { NextResponse } from 'next/server'
import path from 'node:path'

import { ARCHIVE_DIR, listFiles, readText } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  // path traversal guard: the name must be an existing archive file name
  const allowed = new Set(listFiles(ARCHIVE_DIR, '.md').map((f) => f.name))
  if (!allowed.has(name)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const markdown = readText(path.join(ARCHIVE_DIR, name))
  if (markdown == null) {
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
  return NextResponse.json({ name, markdown })
}
