import { NextResponse } from 'next/server'

import { runGates } from '@/lib/t4/gates'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  if (!/^T4-\d{2}$/.test(slug)) {
    return NextResponse.json({ error: 'slug expected: T4-NN' }, { status: 400 })
  }
  const result = runGates(slug)
  if (!result) {
    return NextResponse.json({ error: 'batch file not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
