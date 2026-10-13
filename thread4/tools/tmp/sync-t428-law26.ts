/**
 * Ретро-фикс №2 T4-28: закон №26 «тема — не тег».
 * 1) официальный прогон гейтов (gate.run #6, событие + git-фикс)
 * 2) синк delivery-записи batches/T4-28.json (sha, run, receipts, revision)
 * 3) событие law.ratified №26
 */
import { runGates } from '../../../src/lib/t4/gates'
import { appendEvent } from '../../../src/lib/t4/events'
import * as fs from 'fs'

const slug = 'T4-28'
const result = runGates(slug, false)
if (!result) throw new Error('batch not found')
console.log(`gates run #${result.runIndex}: hard ${result.hardPass ? 'PASS' : 'FAIL'} · sha ${result.sha10}`)
if (!result.hardPass) {
  console.error('HARD FAIL — синк отменён')
  process.exit(1)
}

const file = `batches/${slug}.json`
const prev = JSON.parse(fs.readFileSync(file, 'utf-8'))
prev.date = new Date().toISOString()
prev.sha10 = result.sha10
prev.hardPass = result.hardPass
prev.firstRunClean = false
prev.run = result.runIndex
prev.revision = 'law26-retrofix (закон №23 + №25 + №26, авторские приказы 2026-10-12)'
prev.note =
  'Ретро-фикс №2: из всех 24 POS убрано название темы «dead on the inside» и прозаические якоря-абстракции (phantom strain, study weight, waltz decay…) — всё из позитива уходит в рендер (закон №26). Тема живёт отрисуемым: staticky clothes, палитры, свет-на-зоне, выражения лиц. Слоты/темы/акты/спайны/стеки/каноны без изменений. Свежие квитанции — в летописи (gate.run).'
prev.receipts = result.receipts
fs.writeFileSync(file, JSON.stringify(prev, null, 1) + '\n', 'utf-8')
console.log(`delivery sync OK: ${file}`)

appendEvent(
  'law.ratified',
  'Закон №26 «тема — не тег» (авторский приказ из чата, ретро-фикс T4-28 №2): название темы никогда не появляется в POS — всё из позитива уходит в рендер. Т4-25/26/27/27.2/28 несли тайтл в POS («no normal options…», «the other version of…», «the extraordinary…», «dead on the inside» ×24) — вычищено из T4-28; T4-29+ рождается чистым (писец/полировщик/гейт). Гейт raw-plus ловит полную фразу и пробег ≥3 слов тайтла.',
  {
    law: 26,
    codename: 'тема — не тег',
    source: 'author-order-chat',
    appliedTo: slug,
    spec: 'specs/raw-plus.json v1.1.0 (theme_law)',
  }
)
console.log('law.ratified №26 OK')
