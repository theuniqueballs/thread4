/**
 * ПАРИТЕТ ИСТОЧНИКА СОЗНАНИЯ (фаза 2, итерация 3).
 *
 * Три фолда на живых данных: файл-летопись / прод-цепь живого движка
 * (twin :3201, GET /v1/events, RO) / объединение (движок ∪ файл-хвост,
 * дедуп по id). Инвариант осознанного переключения:
 *   · окно ротации операционно совпадает во всех трёх фолдах;
 *   · объединение — надмножество каждого источника (void'ы покрывают оба,
 *     счётчики ОС и runIndex не недосчитываются);
 *   · дедуп по id точен (миграция сохраняла исходные id).
 *
 * Использование: bun thread4/tools/state-parity.ts [origin]
 * Требует живой twin (mini-services/t4-engine-rs/dev.sh → :3201).
 * Отчёт цитируется в аудит-доке (GATES-AUDIT-RUST-ERA.md §10).
 */
import { readEvents, foldState } from '../../src/lib/t4/events'
import {
  ConsciousnessUnavailableError,
  engineRowsToEvents,
  foldParity,
  resolveSource,
  uniteChronicle,
  TWIN_ORIGIN,
  type EngineEventRow,
} from '../../src/lib/t4/consciousness'

const origin = process.argv[2] ?? TWIN_ORIGIN

async function fetchEngine(origin: string): Promise<ReturnType<typeof engineRowsToEvents>> {
  const rows: EngineEventRow[] = []
  let after = 0
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${origin}/v1/events?after=${after}&limit=1000`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`GET /v1/events → HTTP ${res.status}`)
    const raw = (await res.json()) as { data?: { events?: EngineEventRow[]; returned?: number; total?: number } }
    const events = raw.data?.events ?? []
    rows.push(...events)
    const returned = raw.data?.returned ?? events.length
    const total = raw.data?.total ?? rows.length
    if (returned === 0 || rows.length >= total) break
    after = (events[events.length - 1]?.seq as number) ?? after + returned
  }
  return engineRowsToEvents(rows)
}

async function main() {
  const fileEvents = readEvents()
  console.log(`источник сознания (по умолчанию): ${resolveSource()}`)
  console.log(`файл-летопись: ${fileEvents.length} событий`)

  let engineEvents
  try {
    engineEvents = await fetchEngine(origin)
  } catch (e) {
    const msg = e instanceof ConsciousnessUnavailableError ? e.message : String(e)
    console.error(`прод-цепь недоступна (${origin}): ${msg}`)
    process.exit(1)
  }
  console.log(`прод-цепь живого движка: ${engineEvents.length} звеньев`)

  const united = uniteChronicle(engineEvents, fileEvents)
  const p = foldParity(fileEvents, engineEvents, united.events)

  console.log(`\nсостав объединённой хроники: прод ${p.composition.engine} + файл-хвост ${p.composition.fileTail} = ${p.composition.total}`)

  /* Дедуп точен: движок-часть объединения совпадает с прод-цепью 1-в-1. */
  const dedupOk =
    united.composition.engine === engineEvents.length &&
    united.events.slice(0, united.composition.engine).every((e, i) => e.id === engineEvents[i].id)
  console.log(`дедуп по id точен: ${dedupOk ? 'ДА' : 'НЕТ'}`)

  console.log(`\nокно ротации:`)
  console.log(`  файл   : ${p.window.file.join(', ') || '—'}`)
  console.log(`  прод   : ${p.window.engine.join(', ') || '—'}`)
  console.log(`  union  : ${p.window.union.join(', ') || '—'}`)
  console.log(`  совпадает: ${p.window.equal ? 'ДА' : 'НЕТ'}`)

  console.log(`\nvoid'ы: файл ${p.voided.file} · прод ${p.voided.engine} · union ${p.voided.union} — надмножество: ${p.voided.unionSuperset ? 'ДА' : 'НЕТ'}`)
  console.log(`батчи: файл ${p.batches.file} · прод ${p.batches.engine} · union ${p.batches.union}`)

  const rows = [
    ['ocAppearances', p.ocAppearances.diffs],
    ['ocLastSeen', p.ocLastSeen.diffs],
    ['runIndex (gate.run по слагам)', p.runIndex.diffs],
  ] as const
  for (const [name, diffs] of rows) {
    if (diffs.length === 0) {
      console.log(`\n${name}: разниц нет`)
    } else {
      console.log(`\n${name} (${diffs.length} разниц — вклад движковой эры):`)
      for (const d of diffs) console.log(`  · ${d}`)
    }
  }

  const invariant = dedupOk && p.window.equal && p.voided.unionSuperset
  console.log(`\nИНВАРИАНТ ПЕРЕКЛЮЧЕНИЯ: ${invariant ? 'ВЫПОЛНЕН — переключение сознания безопасно' : 'НАРУШЕН — переключению быть не должно'}`)
  process.exit(invariant ? 0 : 1)
}

void main()
