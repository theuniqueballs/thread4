import { NextResponse } from 'next/server'

import { ARCHIVE_DIR, listFiles } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET() {
  const items = listFiles(ARCHIVE_DIR, '.md')
  return NextResponse.json({
    items: items.map((f) => ({ name: f.name, size: f.size })),
  })
}
