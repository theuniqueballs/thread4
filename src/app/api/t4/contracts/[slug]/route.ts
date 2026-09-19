import { NextResponse } from 'next/server'
import path from 'node:path'

import { CONTRACTS_DIR, readJson, readText } from '@/lib/t4/fsutil'
import { contractMarkdown, type BatchContract } from '@/lib/t4/compiler'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!/^T4-\d{2}$/.test(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 })
  }
  const contract = readJson<BatchContract>(path.join(CONTRACTS_DIR, `${slug}.json`))
  const md = readText(path.join(CONTRACTS_DIR, `${slug}.md`))
  if (!contract && !md) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({
    slug,
    theme: contract?.theme ?? '',
    createdAt: contract?.createdAt ?? '',
    markdown: md ?? (contract ? contractMarkdown(contract) : ''),
    contract: contract ?? null,
  })
}
