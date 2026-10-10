/**
 * Генерирует сводку триала (.md) — тот же формат, что кнопка «.md» в радаре
 * TRIAL-3 дашборда (TrialRadarPanel), но файлом в download/ для автора.
 * Источник данных — парсер batch-md.ts (одна правда); вердикт-статус
 * читается из летописи событий (render.verdict · author-batch), трекер
 * рендера живёт в браузере автора — в шапке честная пометка.
 *
 *   bun thread4/cli.ts trial [T4-27 T4-27.2-EXP ...]
 *   bun thread4/tools/trial-export.ts T4-27 [T4-27.2-EXP ...]
 *
 * Без аргументов — живая пара момента (T4-27 + T4-27.2-EXP).
 * Порт из fred-legacy (2026-10-12, преемник): путь вывода — репо-относительный
 * download/; логика без изменений.
 */
import { parseBatchMd, extractTrialLaws, extractHypotheses, buildTrialRadarMarkdown } from '../../src/lib/t4/batch-md'
import { readEvents } from '../../src/lib/t4/events'
import { readText, writeText } from '../../src/lib/t4/fsutil'
import path from 'node:path'

export function run(args: string[]) {
  const slugs = args.length > 0 ? args : ['T4-27', 'T4-27.2-EXP']

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
    return { md, parsed }
  }

  /* вердикт записан? — та же выборка, что GET /api/t4/batch-verdict */
  const verdictSlugs = new Set(
    readEvents()
      .filter(
        (e) =>
          e.type === 'render.verdict' &&
          (e.data as { source?: string } | undefined)?.source === 'author-batch'
      )
      .map((e) => String((e.data as { slug?: string })?.slug ?? ''))
  )

  for (const slug of slugs) {
    const b = load(slug)
    if (!b) continue
    const laws = extractTrialLaws(b.md)
    const hypos = extractHypotheses(b.md, b.parsed)
    if (laws.length === 0 && hypos.length === 0) {
      console.log(`${slug}: ни законов, ни EXP-слотов — сводка пуста, пропуск`)
      continue
    }

    /* перестройка не повторяет список законов родителя — берём из стороны
     *  пары по T4-NN-базе (та же логика, что радар на экране) */
    let lawSource = ''
    let effLaws = laws
    if (effLaws.length === 0) {
      const base = slug.match(/^T4-\d+/)?.[0] ?? ''
      if (base !== '' && base !== slug) {
        const parent = load(base)
        if (parent) {
          effLaws = extractTrialLaws(parent.md)
          lawSource = base
        }
      }
    }

    /* H13 BODY-SPECTRUM: пара по базе, маркер в файле любой стороны */
    const base = slug.match(/^T4-\d+/)?.[0] ?? ''
    const pairSlug = base !== '' && base !== slug ? base : undefined
    const pairData = pairSlug ? load(pairSlug) : null
    const hasBodySpectrum = b.md.includes('BODY-SPECTRUM') || (pairData?.md.includes('BODY-SPECTRUM') ?? false)
    const pair =
      pairSlug && pairData && hasBodySpectrum
        ? {
            a: pairSlug,
            b: slug,
            /* трекер рендера — память браузера, CLI не знает; честные нули */
            aRendered: 0,
            aTotal: pairData.parsed.slots.length,
            bRendered: 0,
            bTotal: b.parsed.slots.length,
            verdictB: verdictSlugs.has(slug),
          }
        : undefined

    const out = path.join('download', `trial-${slug}.md`)
    writeText(
      out,
      buildTrialRadarMarkdown({
        slug,
        title: b.parsed.title,
        lawSource: lawSource !== '' ? lawSource : undefined,
        laws: effLaws,
        hypos,
        rendered: [],
        verdictRecord: verdictSlugs.has(slug),
        renderedUnknown: true,
        pair,
      })
    )
    console.log(
      `${slug}: законов ${effLaws.length}${lawSource ? ` (из ${lawSource})` : ''} · гипотез ${hypos.length}${pair ? ' · H13 BODY-SPECTRUM' : ''} → ${out}`
    )
  }
}

/* прямой запуск: bun thread4/tools/trial-export.ts … */
if (process.argv[1] && process.argv[1].endsWith('trial-export.ts')) {
  run(process.argv.slice(2))
}
