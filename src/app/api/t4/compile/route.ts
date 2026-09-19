import { NextResponse } from 'next/server'

import { compileBatch } from '@/lib/t4/compiler'
import { contractMarkdown } from '@/lib/t4/compiler'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { theme?: string; ocOrders?: string[]; engine?: string; exquisite?: number; exploratory?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const theme = (body.theme ?? '').trim()
  if (!theme) {
    return NextResponse.json({ error: 'theme required' }, { status: 400 })
  }
  try {
    const contract = compileBatch(theme, {
      ocOrders: Array.isArray(body.ocOrders) ? body.ocOrders : undefined,
      engine: typeof body.engine === 'string' ? body.engine : undefined,
      exquisite: typeof body.exquisite === 'number' ? body.exquisite : undefined,
      exploratory: typeof body.exploratory === 'number' ? body.exploratory : undefined,
    })
    return NextResponse.json({
      slug: contract.slug,
      markdown: contractMarkdown(contract),
      contract,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'compile failed' },
      { status: 500 }
    )
  }
}
