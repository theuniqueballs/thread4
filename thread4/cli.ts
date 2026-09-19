/**
 * THREAD 4 CLI — seed / compile / gates / state.
 * Usage (bun):
 *   bun thread4/cli.ts seed          # era.born + spec.imported + law.ratified (once)
 *   bun thread4/cli.ts compile "тема" [engine] [oc1,oc2,oc3]
 *   bun thread4/cli.ts gates T4-01
 *   bun thread4/cli.ts state
 *   bun thread4/cli.ts selftest      # compiler + gates smoke test
 */
import { compileBatch, contractMarkdown } from '../src/lib/t4/compiler'
import { runGates, parseBatch } from '../src/lib/t4/gates'
import { appendEvent, foldState, readEvents } from '../src/lib/t4/events'
import { specInventory } from '../src/lib/t4/specs'
import { readText } from '../src/lib/t4/fsutil'
import path from 'node:path'

const cmd = process.argv[2] ?? ''

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

  if (cmd === 'gates') {
    const slug = process.argv[3]
    if (!slug) {
      console.error('usage: gates T4-01')
      process.exit(1)
    }
    const result = runGates(slug)
    if (!result) {
      console.error(`batch ${slug} not found`)
      process.exit(1)
    }
    for (const r of result.receipts) {
      const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : r.verdict === 'WARN' ? '⚠' : '·'
      console.log(`  [${mark}] ${r.gate} (${r.level})`)
      for (const f of r.findings.slice(0, 5)) console.log(`       ${f}`)
    }
    console.log(`\nrun #${result.runIndex} · hard ${result.hardPass ? 'PASS' : 'FAIL'}${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''}`)
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

    // compile determinism (dryRun — no events/files pollution)
    const c1 = compileBatch('selftest-тема', { seed: 42, exquisite: 1, exploratory: 0, ocOrders: ['Sue', 'Miyu', 'Yui'], dryRun: true })
    const c2 = compileBatch('selftest-тема', { seed: 42, exquisite: 1, exploratory: 0, ocOrders: ['Sue', 'Miyu', 'Yui'], dryRun: true })
    check('compile deterministic (same seed → same slots)', JSON.stringify(c1.slots) === JSON.stringify(c2.slots))
    check('21 slots', c1.slots.length === 21)
    check('3 OC first', c1.slots.slice(0, 3).every((s) => s.kind === 'OC'))
    const spread = Object.fromEntries(c1.spread.map((s) => [s.rating, s.count]))
    check('spread R7/R+12/X2', spread['R'] === 7 && spread['R+'] === 12 && spread['X'] === 2)
    check('21 distinct poses', new Set(c1.slots.map((s) => s.pose)).size === 21)
    check('21 distinct palettes', new Set(c1.slots.map((s) => s.palette)).size === 21)
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
    check('racial count 10', c1.slots.filter((s) => s.race).length === 10)
    const registers = c1.slots.reduce<Record<string, number>>((acc, s) => {
      acc[s.register] = (acc[s.register] ?? 0) + 1
      return acc
    }, {})
    check('no register >50%', Object.values(registers).every((n) => n <= 11))
    check('contract markdown rendered', contractMarkdown(c1).length > 2000)
    check('carrier stats present', c1.carrierStats.wSharePct <= 45)

    // parseBatch on a synthetic slot
    const synth = [
      '# THREAD 4 — Batch T4-99: "Test"',
      'P01 — test-anchor (OC: Rue · VOLT · R+ · PL01 · P21_VOID_BLACK)',
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

    console.log(`\nselftest: ${ok} pass, ${fail} fail`)
    process.exit(fail === 0 ? 0 : 1)
  }

  console.log('commands: seed | compile "theme" | gates T4-NN | state | selftest')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
