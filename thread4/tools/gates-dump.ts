import { runGates } from '../../src/lib/t4/gates'
const slug = process.argv[2] ?? 'T4-26'
const r = runGates(slug, true)
if (!r) { console.log('NO RESULT'); process.exit(1) }
for (const rec of r.receipts) {
  if (rec.findings.length > 0) {
    console.log(`\n### ${rec.gate} [${rec.verdict}] (${rec.findings.length}):`)
    for (const f of rec.findings) console.log('  -', f)
  }
}
console.log(`\nHARD: ${r.hardPass ? 'PASS' : 'FAIL'}`)
