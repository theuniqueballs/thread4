/**
 * Генерирует дифф-документ (.md) пары батчей — тот же формат, что кнопка
 * «дифф .md» в Сравнении A↔B дашборда (page.tsx → BatchCompare), но файлом
 * в download/ для автора. Источник данных — парсер batch-md.ts (одна правда).
 *
 *   bun thread4/tools/diff-export.ts T4-27 T4-27.2-EXP
 */
import { parseBatchMd, buildDiffMarkdown } from '../../src/lib/t4/batch-md'
import { readText, writeText } from '../../src/lib/t4/fsutil'
import path from 'node:path'

const [aSlug, bSlug] = process.argv.slice(2)
if (!aSlug || !bSlug) {
  console.log('usage: bun thread4/tools/diff-export.ts <A-база> <B-перестройка>')
  process.exit(0)
}

function load(slug: string) {
  const md = readText(path.join('thread4', 'batches', `${slug}.md`))
  if (!md) {
    console.log(`${slug}: файла нет — пропуск`)
    process.exit(1)
  }
  const parsed = parseBatchMd(md)
  if (!parsed) {
    console.log(`${slug}: не распарсился — пропуск`)
    process.exit(1)
  }
  return parsed
}

const a = load(aSlug)
const b = load(bSlug)
const out = path.join('/home/z/my-project/download', `diff-${aSlug}_to_${bSlug}.md`)
writeText(out, buildDiffMarkdown(aSlug, bSlug, a, b))
console.log(
  `${aSlug} → ${bSlug}: ${a.slots.length}↔${b.slots.length} слотов → ${out}`
)
