import { NextResponse } from 'next/server'

import { listFiles, CONTRACTS_DIR, readJson } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET() {
  const items = listFiles(CONTRACTS_DIR, '.json').map((f) => {
    const c = readJson<{ theme?: string; createdAt?: string }>(
      `${CONTRACTS_DIR}/${f.name}`
    )
    return {
      slug: f.base,
      theme: c?.theme ?? '',
      createdAt: c?.createdAt ?? '',
    }
  })
  return NextResponse.json({ items: items.sort((a, b) => b.slug.localeCompare(a.slug)) })
}
