/**
 * THREAD 4 CLI — seed / compile / check / gates / deliver / state.
 * Usage (bun):
 *   bun thread4/cli.ts seed          # era.born + spec.imported + law.ratified (once)
 *   bun thread4/cli.ts compile "тема" [engine] [oc1,oc2,oc3]
 *   bun thread4/cli.ts recompile T4-NN "тема" [engine]  # пересборка слага под текущий закон
 *   bun thread4/cli.ts check T4-01   # писец: сухой прогон гейтов (без событий)
 *   bun thread4/cli.ts gates T4-01   # официальный прогон гейтов (gate.run в лог)
 *   bun thread4/cli.ts deliver T4-01 # официальный прогон + сдача батча
 *   bun thread4/cli.ts scribe T4-01  # авто-писец: черновик батча по контракту (LLM)
 *   bun thread4/cli.ts state
 *   bun thread4/cli.ts selftest      # compiler + gates smoke test
 */
import { compileBatch, contractMarkdown } from '../src/lib/t4/compiler'
import { runGates, parseBatch } from '../src/lib/t4/gates'
import { deliverBatch } from '../src/lib/t4/deliver'
import { scribeBatch } from '../src/lib/t4/scribe'
import { appendEvent, foldState, readEvents } from '../src/lib/t4/events'
import { specInventory } from '../src/lib/t4/specs'

const cmd = process.argv[2] ?? ''

function printGates(result: NonNullable<ReturnType<typeof runGates>>) {
  for (const r of result.receipts) {
    const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : r.verdict === 'WARN' ? '⚠' : '·'
    console.log(`  [${mark}] ${r.gate} (${r.level})`)
    for (const f of r.findings.slice(0, 5)) console.log(`       ${f}`)
  }
  console.log(`\nrun #${result.runIndex} · hard ${result.hardPass ? 'PASS' : 'FAIL'}${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''}`)
}

async function main() {
  if (cmd === 'seed') {
    const events = readEvents()
    if (events.some((e) => e.type === 'era.born')) {
      console.log('seed: era already born — skip')
      return
    }
    appendEvent(
      'era.born',
      'THREAD 4 рождена: чистый лист, 3.2 заморожена как откат. Движок: Tsubaki.2 Pro (Tsubaki.3 — «полное говно», N30-тест). Конституция ратифицирована.',
      { engine: 'Tsubaki.2 Pro', supersedes: 'THREAD 3.2-EXP-V21', author: 'заказ 2026-09-19' }
    )
    const inv = specInventory()
    appendEvent(
      'spec.imported',
      `Пулы 3.2 импортированы в типизированные спеки: ${inv.map((s) => `${s.name} ${s.count}`).join(', ')} — каждый ID сохранён, аномалии в PARSE_REPORT.md`,
      { inventory: inv }
    )
    appendEvent(
      'law.ratified',
      'Конституция v1.0 (12 §): контракт прежде прозы, рейтинг зарабатывается рецептом, VOLT на теле / NICHE где угодно, PH-форма как форма доставки, диверсия назначается до письма, флооры не расслабляются, first run clean, фидбек — единственный законодатель, архив — субстрат, всё видно автору.',
      { version: '1.0.0', doc: 'thread4/CONSTITUTION.md' }
    )
    appendEvent(
      'taste.datum',
      'Taste-профиль основан: 6 канонизаций + N18 9.2/10 + «Охуенная поза решила всё» + wet-sheer в копилку + анти-канон (милф-штамп, моно-носитель, стойло, theme-opacity, NICHE-эрозия, фикспасс-культура).',
      { doc: 'thread4/TASTE.md' }
    )
    console.log('seed: era.born + spec.imported + law.ratified + taste.datum — OK')
    return
  }

  if (cmd === 'recompile') {
    const slug = process.argv[3]
    const theme = process.argv[4]
    if (!slug || !/^T4-\d{2}$/.test(slug) || !theme) {
      console.error('usage: recompile T4-NN "тема" [engine]')
      process.exit(1)
    }
    const engine = process.argv[5]
    const contract = compileBatch(theme, { engine: engine || undefined, slug })
    console.log(contractMarkdown(contract))
    return
  }

  if (cmd === 'compile') {
    const theme = process.argv[3]
    if (!theme) {
      console.error('usage: compile "тема" [engine] [oc1,oc2,oc3]')
      process.exit(1)
    }
    const engine = process.argv[4] && !process.argv[4].includes(',') ? process.argv[4] : undefined
    const ocArg = process.argv[4] && process.argv[4].includes(',')
      ? process.argv[4]
      : process.argv[5]
    const ocOrders = ocArg ? ocArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    const contract = compileBatch(theme, { engine, ocOrders })
    console.log(contractMarkdown(contract))
    return
  }

  if (cmd === 'scribe') {
    const slug = process.argv[3]
    if (!slug || !/^T4-\d{2}$/.test(slug)) {
      console.error('usage: scribe T4-NN [maxRepairRounds]')
      process.exit(1)
    }
    const maxRepairRounds = process.argv[4] ? parseInt(process.argv[4], 10) : 2
    scribeBatch(slug, {
      maxRepairRounds: Number.isFinite(maxRepairRounds) ? maxRepairRounds : 2,
      onLog: (line) => console.log(line),
    })
      .then((res) => {
        console.log(`\nписец: ${res.slug} «${res.title}»`)
        console.log(`слоты написаны, ремонт: ${res.rounds}, гейты dry: ${res.hardPass ? 'PASS' : 'FAIL'} (sha ${res.sha10})`)
        if (res.failedSlots.length > 0) {
          console.log(`НЕ написаны: P${res.failedSlots.join(', P')} — батч нельзя сдавать`)
        }
        for (const r of res.receipts.filter((x) => x.verdict !== 'PASS')) {
          console.log(`  [${r.verdict}] ${r.gate} (${r.level})`)
          for (const f of r.findings.slice(0, 4)) console.log(`       ${f}`)
        }
        console.log(`\nчерновик в batches/${res.slug}.md — сдача: bun thread4/cli.ts deliver ${res.slug}`)
        process.exit(res.hardPass && res.failedSlots.length === 0 ? 0 : 1)
      })
      .catch((e) => {
        console.error(e)
        process.exit(1)
      })
    return
  }

  if (cmd === 'check' || cmd === 'gates' || cmd === 'deliver') {
    const slug = process.argv[3]
    if (!slug) {
      console.error(`usage: ${cmd} T4-01`)
      process.exit(1)
    }
    if (cmd === 'deliver') {
      const delivered = deliverBatch(slug)
      if (!delivered) {
        console.error(`batch ${slug} not found (нужен thread4/batches/${slug}.md)`)
        process.exit(1)
      }
      printGates(delivered.result)
      if (!delivered.ok) {
        console.error('\nHARD FAIL — батч не сдаётся. Чини против контракта, потом снова deliver.')
        process.exit(1)
      }
      console.log(`\ndelivered: ${slug} «${delivered.title}» — гейты, мета, ворклог и batch.delivered записаны`)
      process.exit(0)
    }
    const result = runGates(slug, cmd === 'check')
    if (!result) {
      console.error(`batch ${slug} not found (нужен thread4/batches/${slug}.md)`)
      process.exit(1)
    }
    printGates(result)
    process.exit(result.hardPass ? 0 : 1)
  }

  if (cmd === 'state') {
    const state = foldState(readEvents())
    console.log(JSON.stringify(state, null, 2))
    return
  }

  if (cmd === 'selftest') {
    let ok = 0
    let fail = 0
    const check = (name: string, cond: boolean) => {
      console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}`)
      if (cond) { ok++ } else { fail++ }
    }

    // specs load
    const inv = specInventory()
    check('specs inventory non-empty', inv.length >= 8)
    const carriers = inv.find((s) => s.id === 'carriers')
    check('carriers == 280', carriers?.count === 280)
    const poses = inv.find((s) => s.id === 'poses')
    check('poses == 240', poses?.count === 240)

    // техника-карта (таблица автора, 2026-09-21)
    const tech = inv.find((s) => s.id === 'rating-techniques')
    check('техника-карта в инвентаре (>=100 приёмов)', (tech?.count ?? 0) >= 100)
    const recipes = inv.find((s) => s.id === 'rating-recipes')
    check('рецепт v1.3.0 (X Cut hold вшит)', recipes?.version === '1.3.0')
    {
      const { getRatingRecipes, getRatingTechniques } = await import('../src/lib/t4/specs')
      const rt = getRatingTechniques()
      const rr = getRatingRecipes()
      check('сумма факторов: R+ = 3+ сигнала через 2+ слоя',
        rt?.sum_rules.rplus_floor.signals_min === 3 && rt?.sum_rules.rplus_floor.layers_min === 2)
      check('X Cut hold: 5 новых терминов NEG в рецепте X',
        ['penis', 'cum', 'uncensored', 'spread legs', 'nude lower body'].every((t) =>
          (rr?.tiers.X.counter_neg ?? []).includes(t)))
      check('cameltoe в карта не сигнал (рендер-мёртв)',
        rt?.techniques.find((e) => e.tag.startsWith('cameltoe'))?.rplus === '')
      // слой-скорер на синтетическом тег-блоке (T4-04 P01-подобный кадр)
      const synth = 'student, steam damp blouse, wet clothes, see-through, nipples through clothing, tight clothes, steam press room, kneeling forward reach, brass key'
      const boilerRe = /\b(?:hentai anime style|ecchi anime style|anime style|masterpiece|best quality|anime artstyle|1girl|solo)\b/gi
      const tb = synth.toLowerCase().replace(boilerRe, ' ')
      const hit = (m: string[][]) => m.some((alt) => alt.every((s) => new RegExp(`\\b${s}\\b`).test(tb)))
      const hits = (rt?.techniques ?? []).filter((e) => e.match.length > 0 && hit(e.match))
      const ladder = hits.filter((e) => e.r === '●' || e.rplus === '●' || e.x === '●')
      const layers = new Set(ladder.map((e) => e.layer))
      check('синтет-скорер: wet+see-through кадр = 3+ сигнала через 2+ слоя',
        ladder.length >= 3 && layers.size >= 2)
    }

    // compile determinism (dryRun — no events/files pollution)
    const c1 = compileBatch('selftest-тема', { seed: 42, exquisite: 1, exploratory: 0, ocOrders: ['Sue', 'Miyu', 'Yui'], dryRun: true })
    const c2 = compileBatch('selftest-тема', { seed: 42, exquisite: 1, exploratory: 0, ocOrders: ['Sue', 'Miyu', 'Yui'], dryRun: true })
    check('compile deterministic (same seed → same slots)', JSON.stringify(c1.slots) === JSON.stringify(c2.slots))
    check('24 slots (закон T4-02: 21 мейн + 3 OC)', c1.slots.length === 24)
    check('3 OC first', c1.slots.slice(0, 3).every((s) => s.kind === 'OC'))
    const mainsSpread = Object.fromEntries(
      c1.slots.filter((s) => s.kind !== 'OC').map((s) => [s.rating, 0])
    )
    for (const s of c1.slots) {
      if (s.kind !== 'OC') mainsSpread[s.rating] = (mainsSpread[s.rating] ?? 0) + 1
    }
    check('mains spread R7/R+12/X2 (21 мейн)', mainsSpread['R'] === 7 && mainsSpread['R+'] === 12 && mainsSpread['X'] === 2)
    const allSpread = Object.fromEntries(c1.spread.map((s) => [s.rating, s.count]))
    check('all-slot spread R7/R+15/X2 (24)', allSpread['R'] === 7 && allSpread['R+'] === 15 && allSpread['X'] === 2)
    check('24 distinct poses', new Set(c1.slots.map((s) => s.pose)).size === 24)
    check('24 distinct palettes', new Set(c1.slots.map((s) => s.palette)).size === 24)
    const rplus = c1.slots.filter((s) => s.rating === 'R+' || s.rating === 'X')
    check('every R+/X slot has 4 carriers', rplus.every((s) => s.carriers.length >= 4))
    const groupsOk = rplus.every((s) => {
      const gs = new Set(
        s.carriers.map((c) => {
          const cls = c.cls
          return cls === 'W' ? 'FABRIC' : 'ABCS'.includes(cls) ? 'BODY' : 'ELUF'.includes(cls) ? 'POSITION' : 'PHYSICS'
        })
      )
      return gs.size >= 4
    })
    check('core-4 groups on every R+/X slot', groupsOk)
    check('racial count 10 (на мейнах)', c1.slots.filter((s) => s.race).length === 10)
    check('races only on mains', c1.slots.slice(0, 3).every((s) => !s.race))
    const registers = c1.slots.reduce<Record<string, number>>((acc, s) => {
      acc[s.register] = (acc[s.register] ?? 0) + 1
      return acc
    }, {})
    check('no register >50% (≤12 of 24)', Object.values(registers).every((n) => n <= 12))
    check('contract markdown rendered', contractMarkdown(c1).length > 2000)
    check('carrier stats present', c1.carrierStats.wSharePct <= 45)

    // parseBatch on a synthetic slot
    const synth = [
      '# THREAD 4 — Batch T4-99: "Test"',
      'P01 — test-anchor (OC · Rue · R+ · PL01 · P21_VOID_BLACK)',
      'THESIS: a test thesis line',
      'Canon: Rue — dusty-rose crown braid, haunted ruby eyes',
      'Stack: CR-W01 + CR-B03 + CR-E05 + CR-D12',
      'POS:',
      'anime style, ecchi anime style, 1girl, solo, Rue, dusty-rose hair, ruby eyes.',
      'Her face is rendered in stylized 2D anime style: anime eyes (haunted ruby, level), small nose, small mouth set, ash-grey skin.',
      'The taut weave of her shirt across the chest. Masterpiece, best quality, anime artstyle.',
      'NEG:',
      'exposed genitals, vulva, pubic hair, child, childish, chibi, young girl, immature body, oversized head, signature, watermark, artist name, logo, candle, lamp, lantern, torch, chandelier, brazier, realistic facial structure, semi-realistic anime face, 3d face, nipples, areola',
    ].join('\n')
    const parsed = parseBatch('T4-99', synth)
    check('parseBatch: 1 slot', parsed.slots.length === 1)
    check('parseBatch: stack 4 carriers', parsed.slots[0].stack.length === 4)
    check('parseBatch: thesis grabbed', parsed.slots[0].thesis.includes('test thesis'))
    check('parseBatch: genre OC распознан', parsed.slots[0].genre === 'OC')

    console.log(`\nselftest: ${ok} pass, ${fail} fail`)
    process.exit(fail === 0 ? 0 : 1)
  }

  console.log('commands: seed | compile "theme" | recompile T4-NN "theme" | scribe T4-NN | check T4-NN | gates T4-NN | deliver T4-NN | state | selftest')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
