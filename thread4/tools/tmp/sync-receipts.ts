import { runGates } from '../../../src/lib/t4/gates'
import { readJson, writeText } from '../../../src/lib/t4/fsutil'
import path from 'node:path'

const slug = 'T4-28'
/* dry-прогон гейтов в памяти: квитанции с полными findings — в витрину
 * delivery-записи (событие их стрипает, UI ждёт findings[]). */
const res = runGates(slug, true)
if (!res) throw new Error('runGates null')
console.log('run', res.run, 'hardPass', res.hardPass, 'receipts', res.receipts.length)
const jp = path.join('thread4', 'batches', `${slug}.json`)
const meta = readJson<Record<string, unknown>>(jp) ?? {}
const fixed = res.receipts.map((r) => ({
  gate: r.gate,
  level: r.level,
  verdict: r.verdict,
  findings: Array.isArray(r.findings) ? r.findings : [],
}))
meta.receipts = fixed
meta.run = res.run
meta.hardPass = res.hardPass
writeText(jp, JSON.stringify(meta, null, 1) + '\n')
console.log('receipts synced with findings:', fixed.filter((r) => r.findings.length > 0).length, 'non-empty')
