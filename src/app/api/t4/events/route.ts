import { NextResponse } from 'next/server'

import { clientErrorMessage, commanderKeyMatches, requireCommander, requireRead } from '@/lib/t4/apiguard'
import { appendEvent, EVENT_TYPES, readEvents } from '@/lib/t4/events'
import { feedCorpusQueue } from '@/lib/t4/corpus'
import { readCommanderKey } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  /* ревизия 2026-10-13: parseInt('abc') → NaN → slice(-NaN) = slice(0) —
   * кап 500 пробивался и GET отдавал весь лог. NaN теперь = дефолт 100. */
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '100', 10)
  const limit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 100))

  /* Преемник Фреда, 2026-10-10: probe=1 — проверка ключа командира БЕЗ записи
     в летопись. Стекло (дашборд) зовёт это после сохранения ключа в браузере,
     чтобы автор узнал о рассинхроне до первого реального вердикта. Ответ
     не содержит ни ключа, ни его производных — только булевы факты. */
  if (url.searchParams.get('probe') === '1') {
    const serverKey = readCommanderKey()
    if (serverKey == null) {
      return NextResponse.json({ probe: true, serverKey: false, keyOk: false })
    }
    const provided = req.headers.get('x-commander-key') ?? ''
    /* timing-safe сравнение (аудит 2026-10-12): время ответа не различает
     * ни содержание, ни длину ключа */
    return NextResponse.json({ probe: true, serverKey: true, keyOk: commanderKeyMatches(provided, serverKey) })
  }

  /* ISSUE 15 / #47: граница чтения — read.lock опционален (файл есть → GET
   * летописи требует ключ командира). Probe выше — НЕ трогаем: иначе автор
   * не сможет проверить ключ, чтобы открыть чтение (курица и яйцо). */
  const read = requireRead(req)
  if (!read.ok) return read.response

  const events = readEvents()
  const slice = events.slice(-limit).reverse()
  return NextResponse.json({ events: slice })
}

export async function POST(req: Request) {
  /* Залп 1 «Правда»: запись в летопись — только с ключом командира.
     Без этого любой процесс на машине мог форжить хоть era.born.
     Аудит 2026-10-12: единый гвард apiguard (timing-safe сравнение) —
     семантика 503/403 сохранена. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response

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
    /* Corpus 2.0 (U6): взгляды автора ≥40 символов — в очередь золотого
       корпуса; ритуал кураторства решает попадание в спеку.
       Ревизия 2026-10-14: правило переехало в lib/t4/corpus.ts —
       батч-приёмник кормит ту же очередь (раньше только этот роут). */
    const queued = feedCorpusQueue(evt)
    return NextResponse.json({ ok: true, event: evt, queued })
  } catch (e) {
    /* рана при рождении (кодировка/размер) — отказ, а не битая история */
    return NextResponse.json({ error: clientErrorMessage(e) || 'append failed' }, { status: 422 })
  }
}
