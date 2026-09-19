import { NextResponse } from 'next/server'

import { appendEvent, EVENT_TYPES, readEvents } from '@/lib/t4/events'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)))
  const events = readEvents()
  const slice = events.slice(-limit).reverse()
  return NextResponse.json({ events: slice })
}

export async function POST(req: Request) {
  let body: { type?: string; summary?: string; data?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const type = (body.type ?? '').trim()
  const summary = (body.summary ?? '').trim()
  if (!type || !summary) {
    return NextResponse.json({ error: 'type and summary required' }, { status: 400 })
  }
  if (!(EVENT_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      { error: `unknown type; allowed: ${EVENT_TYPES.join(', ')}` },
      { status: 400 }
    )
  }
  const evt = appendEvent(type, summary, body.data)
  return NextResponse.json({ ok: true, event: evt })
}
