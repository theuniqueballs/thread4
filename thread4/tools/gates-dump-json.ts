/**
 * Паритет-батарея (Фаза 1, аудит №9): полный слепок квитанций эталонного
 * runGates в JSON, байт-сравнимый с `t4 gates <slug> --text --json`.
 * dry-run (dry = true): событие gate.run не пишется. Форма квитанции —
 * 1-в-1 с textgates::receipt_json (notes — только непустые).
 */
import { runGates } from '../../src/lib/t4/gates'

/* ЭТАЛОН ФАЙЛ-ЭРЫ (фаза 2, итерация 3): слепок пинится к файл-летописи —
 * после осознанного переключения источника сознания живой runGates фолдит
 * прод-цепь движка (∪ файл-хвост); аудит-паритет №9 сравнивал ЭТУ сторону,
 * её контракт не переписывается. */
process.env.T4_STATE_SOURCE = 'file'

const slug = process.argv[2] ?? 'T4-41'
const r = runGates(slug, true)
if (!r) {
  console.log('NO RESULT')
  process.exit(1)
}
const receipts = r.receipts.map((rec) => {
  const m: Record<string, unknown> = {
    gate: rec.gate,
    level: rec.level,
    verdict: rec.verdict,
    findings: rec.findings,
  }
  if (rec.notes && rec.notes.length > 0) m.notes = rec.notes
  return m
})
console.log(
  JSON.stringify({ slug, sha10: r.sha10, hardPass: r.hardPass, receipts }, null, 2)
)
