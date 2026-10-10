/**
 * drift-report.ts — тег-дрейф счётчик батча (наследник motif_noun_counts 3.2 и
 * первый шаг ULTIMATE DICE для тег-стеков: ловит класс «повторка», который
 * прозой-эрой ловил simcheck, а в RAW-эре не ловит никто — прецедент: осьминог
 * ×2 в T4-23, замеченный глазом автора).
 *
 * Считает по POS-ранам слотов (parseBatch гейтов — тот же парсер, что судья):
 *   1. теги, живущие в ≥ --min слотах (по умолчанию 2) — дрейф словаря;
 *   2. биграммы (соседние пары тегов) в ≥ --min слотах — дрейф ФОРМУЛ
 *      (тот же носитель+поза с разными словами — simcheck такого не видит);
 *   3. бойлерплейт (≥ 90% слотов) отдельно: он ожидаем, не дрейф.
 *
 * Запуск (из корня репо):
 *   bun thread4/tools/drift-report.ts T4-27            # отчёт
 *   bun thread4/tools/drift-report.ts T4-26 --min 3    # порог слотов
 *   bun thread4/tools/drift-report.ts T4-27 --top 25   # потолок строк
 *   bun thread4/tools/drift-report.ts T4-27 --json
 *
 * Статус: REPORT, не гейт — чтение только своего батча, летопись не трогает,
 * ничего не канонизирует (§10). Писец читает перед сдачей; глаз автора решает.
 */
import fs from 'node:fs'
import { parseBatch } from '../../src/lib/t4/gates'

interface TagStat {
  tag: string
  slots: number[]
}
/** Точка входа для CLI (`thread4/cli.ts drift`) и прямого запуска. */
export function run(argv: string[]) {
  const args = argv
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug || !/^T4-[\d.]+(-EXP)?$/.test(slug)) {
    console.error('usage: bun thread4/tools/drift-report.ts T4-NN [--min N] [--top N] [--json]')
    process.exit(1)
  }
  const min = parseInt(args.find((_, i) => args[i - 1] === '--min') ?? '2', 10)
  const top = parseInt(args.find((_, i) => args[i - 1] === '--top') ?? '15', 10)
  const asJson = args.includes('--json')

  const path = `thread4/batches/${slug}.md`
  if (!fs.existsSync(path)) {
    console.error(`Нет батча: ${path}`)
    process.exit(1)
  }
  const batch = parseBatch(slug, fs.readFileSync(path, 'utf-8'))
  const perSlot = batch.slots
    .filter((s) => s.pos)
    .map((s) => ({ slot: `P${String(s.position).padStart(2, '0')}`, tags: slotTags(s.pos) }))
  if (perSlot.length === 0) {
    console.error('POS-слоты не найдены (формат батча?)')
    process.exit(1)
  }
  const n = perSlot.length

  const single = collect(perSlot, (t) => t)
  const pairs = collect(perSlot, (t) => t.slice(0, -1).map((x, i) => `${x} + ${t[i + 1]}`))

  const boilerSet = new Set(
    [...single].filter(([, slots]) => slots.length / n >= 0.9).map(([tag]) => tag)
  )

  const boiler: TagStat[] = []
  const drift: TagStat[] = []
  for (const [tag, slots] of single) {
    const entry = { tag, slots }
    if (slots.length / n >= 0.9) boiler.push(entry)
    else if (slots.length >= min) drift.push(entry)
  }
  drift.sort((a, b) => b.slots.length - a.slots.length)
  boiler.sort((a, b) => b.slots.length - a.slots.length)

  const pairDrift: TagStat[] = [...pairs]
    .filter(
      ([tag, slots]) =>
        slots.length >= min + 1 &&
        !tag.split(' + ').every((part) => boilerSet.has(part))
    )
    .map(([tag, slots]) => ({ tag, slots }))
    .sort((a, b) => b.slots.length - a.slots.length)

  if (asJson) {
    console.log(JSON.stringify({ slug, slots: n, min, drift, pairDrift, boiler }, null, 2))
    return
  }

  console.log(`\nDRIFT-REPORT · ${slug} · ${n} слотов · порог ${min}`)
  console.log('='.repeat(64))
  console.log(`\nДрейф тегов (живут в ≥${min} слотах, <90%):`)
  if (drift.length === 0) console.log('  — чисто')
  for (const d of drift.slice(0, top)) {
    console.log(`  ${String(d.slots.length).padStart(2)}×  ${d.tag}  [${d.slots.map((s) => 'P' + s).join(' ')}]`)
  }
  console.log(`\nДрейф формул (биграммы в ≥${min + 1} слотах):`)
  if (pairDrift.length === 0) console.log('  — чисто')
  for (const d of pairDrift.slice(0, top)) {
    console.log(`  ${String(d.slots.length).padStart(2)}×  ${d.tag}`)
  }
  console.log(`\nБойлерплейт (≥90% слотов, ожидаем):`)
  console.log('  ' + (boiler.map((b) => b.tag).join(', ') || '—'))
  console.log('\nСтатус: REPORT (не гейт) — повторка не всегда грех (тема-закон батча),\nглаз автора решает. §10: канонизация — только вердиктом.')
}

/* прямой запуск: bun thread4/tools/drift-report.ts T4-NN … */
if (import.meta.main) run(process.argv.slice(2))

function slotTags(pos: string): string[] {
  // тег-ран = первое предложение (до точки), разбитое по запятым;
  // скобочные группы (face-блок) снимаются целиком — их фрагменты не теги
  const firstSentence = pos.split(/[.。]/)[0] ?? ''
  return firstSentence
    .replace(/\([^)]*\)/g, '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && !/^\d+$/.test(t))
}

function collect(
  perSlot: { slot: string; tags: string[] }[],
  unit: (tags: string[]) => string[]
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const { slot, tags } of perSlot) {
    for (const u of new Set(unit(tags))) {
      const list = map.get(u) ?? []
      list.push(Number(slot.replace(/\D/g, '')))
      map.set(u, list)
    }
  }
  return map
}

