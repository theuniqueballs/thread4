import { NextResponse } from 'next/server'
import path from 'node:path'

import { readJson, SPECS_DIR } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 })
  }
  const data = readJson(path.join(SPECS_DIR, `${id}.json`))
  if (data == null) {
    return NextResponse.json({ error: 'spec not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}
