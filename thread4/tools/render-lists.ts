/**
 * Генерирует рендер-листы (.txt) для пары батчей — тот же формат, что кнопка
 * «.txt» в Слотах дашборда (page.tsx → SlotStrip.downloadManifest), но файлом
 * в download/ для автора. Источник данных — парсер batch-md.ts (одна правда).
 *
 *   bun thread4/tools/render-lists.ts T4-27 T4-27.2-EXP
 */
import { parseBatchMd } from '../../src/lib/t4/batch-md'
import { readText, writeText } from '../../src/lib/t4/fsutil'
import path from 'node:path'

const slugs = process.argv.slice(2)
if (slugs.length === 0) {
  console.log('usage: bun thread4/tools/render-lists.ts T4-27 [T4-27.2-EXP …]')
  process.exit(0)
}

const outDir = '/home/z/my-project/download'
for (const slug of slugs) {
  const md = readText(path.join('thread4', 'batches', `${slug}.md`))
  if (!md) {
    /* readText: null — файла нет (проверка «=== ''» пропускала null молча) */
    console.log(`${slug}: файла нет — пропуск`)
    continue
  }
  const parsed = parseBatchMd(md)
  if (!parsed) {
    console.log(`${slug}: не распарсился — пропуск`)
    continue
  }
  const meta = (s: (typeof parsed.slots)[number]) =>
    [s.kind, s.who, s.rating, s.pose, s.palette, s.rehab].filter(Boolean).join(' · ')
  /* шапка батча уже несёт слаг («# T4-27 «…»») — не дублируем его в строке */
  let titleBody = parsed.title
  if (titleBody.startsWith(slug)) titleBody = titleBody.slice(slug.length).trim()
  const titleLine = titleBody !== '' ? ` — ${titleBody}` : ''
  const lines: string[] = [
    `THREAD 4 · рендер-лист · ${slug}${titleLine}`,
    `${parsed.slots.length} слота · сгенерировано ${new Date().toLocaleString('ru-RU')}`,
    '',
  ]
  for (const s of parsed.slots) {
    lines.push(`[${s.id}] ${s.slug}${meta(s) ? ` · ${meta(s)}` : ''}`)
    lines.push(`POS: ${s.pos}`)
    lines.push(`NEG: ${s.neg}`)
    lines.push('')
  }
  const out = path.join(outDir, `render-list-${slug}.txt`)
  writeText(out, lines.join('\n'))
  console.log(`${slug}: ${parsed.slots.length} слотов → ${out}`)
}
