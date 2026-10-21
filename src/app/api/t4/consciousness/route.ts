/**
 * THREAD 4 — источник сознания (фаза 2, итерация 3).
 *
 * GET  /api/t4/consciousness — диагностика: источник, состав объединённой
 *      хроники (прод-цепь живого движка ∪ файл-хвост) и полный паритет
 *      трёх фолдов (окно ротации, void'ы, счётчики ОС, runIndex по слагам).
 *      Граница чтения — как у /api/t4/state (read-key).
 *
 * POST /api/t4/consciousness — КВИТАНЦИЯ переключения (командирский замок,
 *      Залп 1 «Правда»): событие consciousness.switched рождается в
 *      файл-летописи с полным составом и паритетом на момент переключения.
 *      Идемпотентно по engineHead: та же голова прод-цепи — повторная
 *      квитанция не пишется (ответ already:true).
 *
 * Движок недоступен: GET отдаёт честный статус engine.up=false; POST — 503
 * (квитанция переключения требует живой прод-цепи — переключаться «вслепую»
 * значит лгать эпохе).
 */
import { NextResponse } from 'next/server'

import { requireCommander, requireRead } from '@/lib/t4/apiguard'
import { appendEvent, readEvents, type T4Event } from '@/lib/t4/events'
import {
  ConsciousnessUnavailableError,
  foldParity,
  readChronicle,
  resolveSource,
  TWIN_ORIGIN,
  type ParityReport,
} from '@/lib/t4/consciousness'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const read = requireRead(req)
  if (!read.ok) return read.response

  const source = resolveSource()
  const fileEvents = readEvents()
  if (source === 'file') {
    return NextResponse.json({
      source,
      origin: TWIN_ORIGIN,
      engine: { up: false, error: 'T4_STATE_SOURCE=file — аварийный источник файл-эры' },
      fileEvents: fileEvents.length,
      parity: null,
    })
  }

  try {
    const chron = await readChronicle()
    /* uniteChronicle кладёт прод-цепь ПЕРВОЙ: префикс длиной composition.engine —
     * точное восстановление массива прод-цепи без повторного запроса. */
    const comp = chron.composition ?? { engine: 0, fileTail: 0, total: 0 }
    const engineEvents = chron.events.slice(0, comp.engine)
    const parity = foldParity(fileEvents, engineEvents, chron.events)
    return NextResponse.json({
      source,
      origin: TWIN_ORIGIN,
      engine: { up: true },
      fileEvents: fileEvents.length,
      parity,
    })
  } catch (e) {
    const error = e instanceof ConsciousnessUnavailableError ? e.message : String(e)
    return NextResponse.json({
      source,
      origin: TWIN_ORIGIN,
      engine: { up: false, error },
      fileEvents: fileEvents.length,
      parity: null,
    })
  }
}

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response

  const source = resolveSource()
  if (source === 'file') {
    return NextResponse.json(
      { error: 'T4_STATE_SOURCE=file — квитанция не пишется: система сознательно в файл-эре' },
      { status: 409 }
    )
  }

  let chron: Awaited<ReturnType<typeof readChronicle>>
  let parity: ParityReport
  let engineEvents: T4Event[]
  const fileEvents = readEvents()
  try {
    chron = await readChronicle()
    const comp = chron.composition ?? { engine: 0, fileTail: 0, total: 0 }
    engineEvents = chron.events.slice(0, comp.engine)
    parity = foldParity(fileEvents, engineEvents, chron.events)
  } catch (e) {
    const msg = e instanceof ConsciousnessUnavailableError ? e.message : String(e)
    return NextResponse.json({ error: msg, consciousness: 'unavailable' }, { status: 503 })
  }

  const engineHead = parity.heads.engineLastId

  /* Идемпотентность: та же голова прод-цепи — квитанция уже живёт. */
  const existing = readEvents().find(
    (e) => e.type === 'consciousness.switched' && e.data?.engineHead === engineHead
  )
  if (existing) {
    return NextResponse.json({ already: true, event: existing, parity })
  }

  const evt = appendEvent(
    'consciousness.switched',
    `источник сознания переключён: прод-цепь живого движка (${parity.composition.engine} звеньев) ∪ файл-хвост (${parity.composition.fileTail}) — окно ротации ${parity.window.equal ? 'совпадает' : 'расширено'}, объединение — надмножество`,
    {
      from: 'file',
      to: 'engine+file-tail',
      origin: TWIN_ORIGIN,
      composition: parity.composition,
      engineHead,
      fileHead: parity.heads.fileLastId,
      window: parity.window,
      voided: parity.voided,
      batches: parity.batches,
      ocAppearancesDiffs: parity.ocAppearances.diffs,
      ocLastSeenDiffs: parity.ocLastSeen.diffs,
      runIndexDiffs: parity.runIndex.diffs,
      escapeHatch: 'T4_STATE_SOURCE=file — аварийный источник файл-эры',
    }
  )

  return NextResponse.json({ ok: true, event: evt, parity })
}
