import { NextResponse } from 'next/server'

import { appendEvent, EVENT_TYPES, readEvents } from '@/lib/t4/events'
import { readCommanderKey } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)))
  const events = readEvents()
  const slice = events.slice(-limit).reverse()
  return NextResponse.json({ events: slice })
}

export async function POST(req: Request) {
  /* Залп 1 «Правда»: запись в летопись — только с ключом командира.
     Без этого любой процесс на машине мог форжить хоть era.born. */
  const key = readCommanderKey()
  if (key == null) {
    return NextResponse.json(
      {
        error: 'commander-key не создан — летопись залочена',
        setupRequired: true,
        hint: 'создай ~/.t4/commander.key (32+ случайных символа) и передавай его в заголовке x-commander-key',
      },
      { status: 503 }
    )
  }
  const provided = req.headers.get('x-commander-key') ?? ''
  if (provided !== key) {
    return NextResponse.json(
      { error: 'чужой или пустой commander-key — запись в летопись запрещена' },
      { status: 403 }
    )
  }

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
  try {
    const evt = appendEvent(type, summary, body.data)
    return NextResponse.json({ ok: true, event: evt })
  } catch (e) {
    /* рана при рождении (кодировка/размер) — отказ, а не битая история */
    return NextResponse.json({ error: e instanceof Error ? e.message : 'append failed' }, { status: 422 })
  }
}
