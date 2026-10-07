/**
 * T4-25 v2 — обновление записи сдачи после реструктуризации по приказ-уточнению
 * автора (2026-10-08: 21 тематический мейн + 9 EXP отдельно, без темы).
 * Паттерн data-repair (прецедент: title-фикс T4-23/T4-24): batches/T4-25.json
 * несёт актуальный слепок гейтов, летопись не переписывается — событие note
 * фиксирует реструктуризацию. Повторная batch.delivered не пишется (guard N-10).
 */
import { runGates, parseBatch } from '../../src/lib/t4/gates'
import { writeJson } from '../../src/lib/t4/fsutil'
import { appendEvent, verifyChain } from '../../src/lib/t4/events'
import path from 'node:path'

const slug = 'T4-25'
const result = runGates(slug, true) // dry: событие уже в летописи (run #4)
if (!result || !result.hardPass) {
  console.error('gates not clean — abort')
  process.exit(1)
}
const parsed = parseBatch(slug, '')
// title из H1 файла
const fs = await import('node:fs')
const text = fs.readFileSync(`thread4/batches/${slug}.md`, 'utf-8')
const h1 = /^#\s*(.+)$/m.exec(text)?.[1] ?? ''
const title = (/\u00AB(.+?)\u00BB/.exec(h1)?.[1]) ?? parsed.title ?? slug

writeJson(path.join('thread4/batches', `${slug}.json`), {
  slug,
  title,
  date: new Date().toISOString(),
  theme: title,
  engine: 'LAW OF THE ONLY DOOR',
  hardPass: result.hardPass,
  firstRunClean: false,
  sha10: result.sha10,
  run: result.runIndex,
  receipts: result.receipts,
})
console.log(`batch json refreshed: run #${result.runIndex}, sha10 ${result.sha10}, hard PASS`)

appendEvent(
  'note',
  `T4-25 «NO NORMAL OPTIONS» РЕСТРУКТУРИЗАЦИЯ v2 (приказ-уточнение автора 2026-10-08: «9 экспериментальных — отдельно от 21 промпта по теме; они могут быть вообще без темы, это чисто болванки для тестов»): 24 → 33 слота = 3 OC + 21 мейн NO NORMAL OPTIONS (12 VOLT R+ · 7 NICHE R · 2 EXQUISITE R+, спред канона T4-23: R+×14 · R×7) + 9 EXP (P25-P33) без темы. Новые мейны P16-P24: горячая стирка / ремень безопасности / страховка на балке / натурщица (шёлковый лист) / эскалатор / стеклянный дом (EXQUISITE) / созвон-курьер / комар в 3 ночи / сломанный каблук. Закон: policy.law.expSlotsMax=9 — EXP-оверлей поверх 24-слотового закона, 24-слотовый для тематической части не меняется. Гейты: прогон #4 hard PASS (2 warn — те же ловушки, что несла v1), sha ${result.sha10}. Запись сдачи обновлена по прецеденту data-repair; batch.delivered не дублируется (guard N-10), вердикт автора ожидается по v2.`,
  { slug: 'T4-25', kind: 'restructure-v2', source: 'fred', run: 4, sha10: result.sha10, slots: 33, structure: { oc: 3, mains: 21, exp: 9 } }
)
console.log('note event appended')
const v = verifyChain()
console.log('chain:', v.ok ? `OK (${v.events} events)` : `BROKEN: ${v.problems.slice(0, 3)}`)
