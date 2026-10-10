/**
 * Генерирует дифф-документ (.md) пары батчей — тот же формат, что кнопка
 * «дифф .md» в Сравнении A↔B дашборда (BatchCompare), но файлом в download/
 * для автора. Источник данных — парсер batch-md.ts (одна правда).
 *
 *   bun thread4/cli.ts diff T4-27 T4-27.2-EXP
 *   bun thread4/tools/diff-export.ts <A-база> <B-перестройка>
 *
 * Порт из fred-legacy (2026-10-12, преемник): путь вывода — репо-относительный
 * download/; логика без изменений.
 */
import { parseBatchMd, buildDiffMarkdown } from '../../src/lib/t4/batch-md'
import { readText, writeText } from '../../src/lib/t4/fsutil'
import path from 'node:path'

export function run(args: string[]) {
  const [aSlug, bSlug] = args
  if (!aSlug || !bSlug) {
    console.log('usage: bun thread4/tools/diff-export.ts <A-база> <B-перестройка>')
    return
  }

  function load(slug: string) {
    const md = readText(path.join('thread4', 'batches', `${slug}.md`))
    if (!md) {
      console.log(`${slug}: файла нет — пропуск`)
      return null
    }
    const parsed = parseBatchMd(md)
    if (!parsed) {
      console.log(`${slug}: не распарсился — пропуск`)
      return null
    }
    return parsed
  }

  const a = load(aSlug)
  const b = load(bSlug)
  if (!a || !b) return
  const out = path.join('download', `diff-${aSlug}_to_${bSlug}.md`)
  writeText(out, buildDiffMarkdown(aSlug, bSlug, a, b))
  console.log(`${aSlug} → ${bSlug}: ${a.slots.length}↔${b.slots.length} слотов → ${out}`)
}

/* прямой запуск: bun thread4/tools/diff-export.ts … */
if (process.argv[1] && process.argv[1].endsWith('diff-export.ts')) {
  run(process.argv.slice(2))
}
