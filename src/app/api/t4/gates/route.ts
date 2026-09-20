import { NextResponse } from 'next/server'

import { runGates } from '@/lib/t4/gates'
import { deliverBatch } from '@/lib/t4/deliver'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { slug?: string; deliver?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  if (!/^T4-\d{2}$/.test(slug)) {
    return NextResponse.json({ error: 'slug expected: T4-NN' }, { status: 400 })
  }

  if (body.deliver) {
    const delivered = deliverBatch(slug)
    if (!delivered) {
      return NextResponse.json({ error: 'batch file not found' }, { status: 404 })
    }
    return NextResponse.json({
      ok: delivered.ok,
      delivered: delivered.ok,
      title: delivered.title,
      result: delivered.result,
    })
  }

  const result = runGates(slug)
  if (!result) {
    return NextResponse.json({ error: 'batch file not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
