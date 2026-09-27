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
import { appendEvent, bootstrapChain, foldState, healChainTail, readEvents, verifyChain } from '../src/lib/t4/events'
import { getDeliveryStats, getPolicy, specInventory } from '../src/lib/t4/specs'
import { buildReaperDraft } from '../src/lib/t4/reaper'
import { scanSource } from '../src/lib/t4/hygiene'
import { writeText } from '../src/lib/t4/fsutil'
import path from 'node:path'

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
    /* Залп 2: --pin oc-rplus,engine:heldhour — прицел автора вопреки статистике */
    const rawArgs = process.argv.slice(3)
    const pinIdx = rawArgs.indexOf('--pin')
    const authorPin =
      pinIdx >= 0
        ? String(rawArgs[pinIdx + 1] ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
    const args = pinIdx >= 0 ? rawArgs.filter((_, i) => i !== pinIdx && i !== pinIdx + 1) : rawArgs
    const theme = args[0]
    if (!theme) {
      console.error('usage: compile "тема" [engine] [oc1,oc2,oc3] [--pin oc-rplus,engine:key]')
      process.exit(1)
    }
    const engine = args[1] && !args[1].includes(',') ? args[1] : undefined
    const ocArg = args[1] && args[1].includes(',') ? args[1] : args[2]
    const ocOrders = ocArg ? ocArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    const contract = compileBatch(theme, { engine, ocOrders, authorPin })
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

  if (cmd === 'void') {
    const slug = process.argv[3]
    const reason = process.argv[4] ?? 'решение автора'
    if (!slug || !/^T4-\d{2}$/.test(slug)) {
      console.error('usage: void T4-NN "причина"')
      process.exit(1)
    }
    appendEvent(
      'batch.void',
      `${slug} закрыт по приказу автора: ${reason}. Контракт остаётся в архиве как провенанс; в нумерации и ротации не участвует.`,
      { slug, reason }
    )
    console.log(`void: ${slug} закрыт (${reason})`)
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
        if (delivered.alreadyDelivered) {
          console.error(`\n${slug} уже сдан — повторная сдача не производится (охрана окна ротации).`)
        } else {
          console.error('\nHARD FAIL — батч не сдаётся. Чини против контракта, потом снова deliver.')
        }
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

  if (cmd === 'chain') {
    /* Залп 1 «Правда»: rebase хеш-цепи поверх текущего лога (объявленная операция) */
    const r = bootstrapChain()
    console.log(`chain: ${r.links} звеньев построено, head ${r.head.slice(0, 10)} — проверка: bun thread4/cli.ts verify`)
    return
  }

  if (cmd === 'verify') {
    let v = verifyChain()
    if (process.argv[3] === '--heal' && !v.ok && v.storedLinks < v.events) {
      const h = healChainTail()
      console.log(`verify --heal: достроено ${h.healed} звеньев${h.ok ? '' : ` — ${h.problems.join('; ')}`}`)
      v = verifyChain()
    }
    for (const p of v.problems) console.log(`  ! ${p}`)
    console.log(
      `verify: ${v.events} событий, ${v.storedLinks} звеньев цепи, head ${v.head?.slice(0, 10) ?? '—'} — ${v.ok ? 'ЦЕЛА' : 'СЛОМАНА'}`
    )
    process.exit(v.ok ? 0 : 1)
    return
  }

  if (cmd === 'reaper') {
    /* Залп 2 «Рефлекс»: жнец собирает ДРАФТ-отставки по каналам, движкам и OC.
       Ни одного события, ни одного удаления — доклад автору, выстрел за ним (§10). */
    const draft = buildReaperDraft()
    const file = `thread4/reaper-draft-${new Date().toISOString().slice(0, 10)}.md`
    writeText(file, draft.report + '\n')
    console.log(`reaper: ${draft.items.length} претендент(ов) — драфт записан в ${file}`)
    for (const it of draft.items) console.log(`  [${it.kind}] ${it.id} — ${it.status}`)
    console.log('выстрел за автором (§10): по каждому пункту — дебют, подтверждение или отставка')
    return
  }

  if (cmd === 'grep-gate') {
    /* П-2: код не знает чисел треда — сканер ловит возврат хардкода */
    const violations = scanSource(path.join(process.cwd(), 'src', 'lib', 't4'))
    if (violations.length === 0) {
      console.log('grep-gate: чисто — код не помнит чисел треда (П-2)')
      process.exit(0)
      return
    }
    for (const v of violations) console.log(`  ! ${v.file}:${v.line} [${v.rule}] ${v.text}`)
    console.log(`grep-gate: ${violations.length} нарушений — код опять помнит`)
    process.exit(1)
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
    check('рецепт v1.4.0 (X Cut hold + §9-септима: bare-under/framing/pose)', recipes?.version === '1.4.0')
    // статa доставки (рекомендация Claude №2, external.review 2026-09-23;
    // v0.2.0 — вердикт T4-05: 13 → 18 каналов)
    const dstats = inv.find((s) => s.id === 'delivery-stats')
    check('стата доставки в инвентаре (19 каналов, v0.5.0: contact-physics рождён, X изъят)', dstats?.count === 19 && dstats?.version === '0.5.0')
    {
      const { getRatingRecipes, getRatingTechniques, getDeliveryStats } = await import('../src/lib/t4/specs')
      const rt = getRatingTechniques()
      const rr = getRatingRecipes()
      const ds = getDeliveryStats()
      check('каналы доставки v0.4.0: wet-sheer+подача 5 доставлено, cameltoe 0/15, OC R+ 0/9 (retired), площадка-оракул 69/69',
        ds?.channels.find((c) => c.id === 'wet-sheer-delivery')?.delivered === 5 &&
        ds?.channels.find((c) => c.id === 'cameltoe')?.delivered === 0 &&
        ds?.channels.find((c) => c.id === 'oc-rplus')?.delivered === 0 &&
        ds?.channels.find((c) => c.id === 'platform-tier-oracle')?.delivered === 69)
      check('maturity law: n<3 каналы — candidate, не live (внешний вердикт №3)',
        ['threadbare-sheer', 'named-underlayer-display', 'breast-environment-contact'].every(
          (id) => ds?.channels.find((c) => c.id === id)?.status === 'candidate'
        ) && ds?.channels.find((c) => c.id === 'wet-sheer-delivery')?.status === 'live')
      check('сумма факторов: R+ = 3+ сигнала через 2+ слоя',
        rt?.sum_rules.rplus_floor.signals_min === 3 && rt?.sum_rules.rplus_floor.layers_min === 2)
      check('X Cut hold: 5 новых терминов NEG в рецепте X',
        ['penis', 'cum', 'uncensored', 'spread legs', 'nude lower body'].every((t) =>
          (rr?.tiers.X.counter_neg ?? []).includes(t)))
      check('cameltoe в карта не сигнал (рендер-мёртв)',
        rt?.techniques.find((e) => e.tag.startsWith('cameltoe'))?.rplus === '')
      check('техника-карта v1.1.0 = 108 приёмов (+4 моста delivery-stats v0.2.0)',
        rt?.version === '1.1.0' && rt?.techniques.length === 108)
      check('§9-септима: bare-under маркеры в рецепте through_fabric',
        Array.isArray(rr?.tiers.RPLUS?.mechanisms?.through_fabric?.bare_under_marker) &&
        (rr?.tiers.RPLUS?.mechanisms?.through_fabric?.bare_under_marker?.length ?? 0) >= 5)
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
    /* Залп 2 «Рефлекс»: selftest сверяет компилятор с ПОЛИТИКОЙ, а не с
       зашитыми числами — сознательный рост закона не ломает тест (критерий) */
    const law = getPolicy().law
    const mainsR = law.mainsTotal - law.rplusMains - law.xSlots
    check(`slots == policy.law (${law.slotsTotal})`, c1.slots.length === law.slotsTotal)
    check(`OC first ×${law.ocSlots}`, c1.slots.slice(0, law.ocSlots).every((s) => s.kind === 'OC'))
    const mainsSpread = Object.fromEntries(
      c1.slots.filter((s) => s.kind !== 'OC').map((s) => [s.rating, 0])
    )
    for (const s of c1.slots) {
      if (s.kind !== 'OC') mainsSpread[s.rating] = (mainsSpread[s.rating] ?? 0) + 1
    }
    check(
      `mains spread из policy (R${mainsR}/R+${law.rplusMains}/X${law.xSlots})`,
      mainsSpread['R'] === mainsR && mainsSpread['R+'] === law.rplusMains && mainsSpread['X'] === law.xSlots
    )
    const allSpread = Object.fromEntries(c1.spread.map((s) => [s.rating, s.count]))
    /* поведение-рефлекс (policy.channels): oc-rplus dead (0/9) → OC-слоты R,
       бюджет R+ не хоронится заранее; реабилитация — только author_pin */
    const ocRplusDead = getDeliveryStats()?.channels.find((c) => c.id === 'oc-rplus')?.status === 'dead'
    const expectedOcRating = ocRplusDead ? 'R' : 'R+'
    check(
      `OC-дауншифт: OC-слоты ${expectedOcRating} при oc-rplus ${ocRplusDead ? 'dead' : 'live'} (рефлекс)`,
      c1.slots.slice(0, law.ocSlots).every((s) => s.rating === expectedOcRating)
    )
    const expectedAllRplus = law.rplusMains + (ocRplusDead ? 0 : law.ocSlots)
    const expectedAllR = mainsR + (ocRplusDead ? law.ocSlots : 0)
    check(
      `all-slot spread из policy (R${expectedAllR}/R+${expectedAllRplus}/X${law.xSlots})`,
      allSpread['R'] === expectedAllR && allSpread['R+'] === expectedAllRplus && allSpread['X'] === law.xSlots
    )
    check('24 distinct poses', new Set(c1.slots.map((s) => s.pose)).size === 24)
    check('24 distinct palettes', new Set(c1.slots.map((s) => s.palette)).size === 24)
    const rplus = c1.slots.filter((s) => s.rating === 'R+' || s.rating === 'X')
    check('every R+/X slot has 4 carriers', rplus.every((s) => s.carriers.length >= 4))
    // карта класс→мех читается ИЗ СПЕКА (аудит RC-2: selftest не держит копию)
    {
      const { getCarriers } = await import('../src/lib/t4/specs')
      const cs = getCarriers()
      const mechOf = (cls: string) => cs?.class_defs?.[cls]?.mech ?? ''
      const groupsOk = rplus.every((s) => {
        const gs = new Set(s.carriers.map((c) => mechOf(c.cls)))
        return gs.size >= 4
      })
      check('core-4 groups on every R+/X slot (мех из carriers.json)', groupsOk)
      check('contract channelStats: dead-каналы видимы, дауншифт погасил dead-claim (рефлекс)',
        (c1.channelStats?.dead ?? []).includes('oc-rplus') && (c1.channelStats?.deadClaims?.length ?? 0) === 0)
    }
    check('racial count 10 (на мейнах)', c1.slots.filter((s) => s.race).length === 10)
    check('races only on mains', c1.slots.slice(0, 3).every((s) => !s.race))
    // A/B-дисциплина (§10-поправка): 2-3 пары R+-слотов по LEAD-зоне
    check('A/B-пары: 2-3 на батч (§10-поправка)',
      c1.abPairs.length >= 2 && c1.abPairs.length <= 3)
    check('A/B-пары: обе половины в одной LEAD-зоне, R+',
      c1.abPairs.every((p) => {
        const sa = c1.slots.find((s) => s.position === p.a)
        const sb = c1.slots.find((s) => s.position === p.b)
        return sa && sb && sa.lead === p.lead && sa.rating === 'R+' && sb.rating === 'R+' &&
          sa.ab?.pair === sb.ab?.pair && sa.ab?.half !== sb.ab?.half
      }))
    const registers = c1.slots.reduce<Record<string, number>>((acc, s) => {
      acc[s.register] = (acc[s.register] ?? 0) + 1
      return acc
    }, {})
    check('no register >50% (≤12 of 24)', Object.values(registers).every((n) => n <= 12))
    check('contract markdown rendered', contractMarkdown(c1).length > 2000)
    check('carrier stats present', c1.carrierStats.wSharePct <= 45)

    // parseBatch on a synthetic slot (имена ОС в POS запрещены законом —
    // пример сам соблюдает name law; аудит RC-2: selftest не учит неправильному)
    const synth = [
      '# THREAD 4 — Batch T4-99: "Test"',
      'P01 — test-anchor (OC · Rue · R+ · PL01 · P21_VOID_BLACK)',
      'THESIS: a test thesis line',
      'Canon: Rue — dusty-rose crown braid, haunted ruby eyes',
      'Stack: CR-W01 + CR-B03 + CR-E05 + CR-D12',
      'POS:',
      'anime style, ecchi anime style, 1girl, solo, dusty-rose hair, ruby eyes.',
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

    // Залп 1 «Правда»: хеш-цепь, атомарность записи, guard рождения
    {
      let v = verifyChain()
      if (v.storedLinks === 0) {
        bootstrapChain()
        v = verifyChain()
      } else if (!v.ok && v.storedLinks < v.events && v.problems.every((p) => p.startsWith('хвост'))) {
        healChainTail()
        v = verifyChain()
      }
      check('хеш-цепь летописи цела (log ↔ chain.jsonl)', v.ok)
      const fsMod = await import('node:fs')
      const { writeText, readText } = await import('../src/lib/t4/fsutil')
      const tmpPath = `thread4/.selftest-atomic-${Date.now()}.tmp`
      writeText(tmpPath, 'atomic-roundtrip')
      const round = readText(tmpPath) === 'atomic-roundtrip'
      try { fsMod.rmSync(tmpPath, { force: true }) } catch { /* переживаем */ }
      check('атомарная запись: tmp+rename roundtrip', round)
      let guardThrew = false
      try { appendEvent('note', 'wounded \uFFFD wound') } catch { guardThrew = true }
      check('guard рождения: U+FFFD в summary отвергается до записи', guardThrew)
      let enumThrew = false
      try { appendEvent('render.verdict', 'T4-99: test', { source: 'дичь' }) } catch { enumThrew = true }
      check('guard рождения: render.verdict с source вне enum отвергается (Issue #1 Кенни)', enumThrew)
      let noSrcThrew = false
      try { appendEvent('render.verdict', 'T4-99: test') } catch { noSrcThrew = true }
      check('guard рождения: render.verdict без source отвергается (Issue #1 Кенни)', noSrcThrew)
    }

    // Залп 2 «Рефлекс»: жнец и гигиенист
    {
      const draft = buildReaperDraft()
      check('reaper: драфт-отставки строится и несёт отчёт', draft.report.length > 100)
      check(
        'grep-gate: src/lib/t4 не помнит чисел треда (П-2)',
        scanSource(path.join(process.cwd(), 'src', 'lib', 't4')).length === 0
      )
    }

    // Залп 3 «Ученик и мир»: rehab-добор, факты мира, golden corpus
    {
      const { getFacts, getGoldenCorpus } = await import('../src/lib/t4/specs')
      const facts = getFacts()
      check('facts.json: платформа как элемент модели (П-7)', Boolean(facts?.platform && Array.isArray(facts.proven_facts) && facts.proven_facts.length >= 3))
      const corpus = getGoldenCorpus()
      check('golden corpus: T4-04 запечатан (>=20 записей PH-текстов с вердиктами)', (corpus?.entries.length ?? 0) >= 20)
      const chPolicy = getPolicy().channels as { rehab_channels?: string[]; rehab_quota_per_batch?: number }
      const rehab = chPolicy.rehab_channels ?? []
      const targets = c1.slots.filter((s) => s.targetChannel)
      check(
        `rehab-добор: ${chPolicy.rehab_quota_per_batch} R+ слота несут targetChannel из policy`,
        targets.length === (chPolicy.rehab_quota_per_batch ?? 0) &&
          targets.every((s) => rehab.includes(String(s.targetChannel)))
      )
      // НИША-50 (вердикт автора): каждый NICHE-слот несёт архетип, ротация без повторов
      const { getNicheArchetypes } = await import('../src/lib/t4/specs')
      const archPool = getNicheArchetypes()?.archetypes ?? []
      const arches = c1.slots.filter((s) => s.arch).map((s) => s.arch)
      check(
        'НИША-50: пул архетипов ≥50, все NICHE-слоты несут ARCH без повторов',
        archPool.length >= 50 && arches.length === c1.slots.filter((s) => s.kind === 'NICHE').length &&
          new Set(arches).size === arches.length
      )
      check('X-слоты изъяты из плана (вердикт «эччи > порно»)', c1.slots.filter((s) => s.rating === 'X').length === 0)
    }

    // Issue #3 Кенни: аренда движков — bespoke пол, у трёх движков rent
    {
      const { getEngines } = await import('../src/lib/t4/specs')
      const engines = getEngines()
      check('bespoke = пол (role floor), не участник ротации', engines?.engines.bespoke?.role === 'floor')
      check(
        'аренда сформулирована: limen/heldhour/glamour-tax имеют rent',
        ['limen', 'heldhour', 'glamour-tax'].every((k) => (engines?.engines[k]?.rent?.length ?? 0) > 0)
      )
      let confThrew = false
      try { appendEvent('render.verdict', 'T4-99: author probe', { source: 'author' }) } catch { confThrew = true }
      check('guard рождения: author-verdict без confidence отвергается (Issue #4 Кенни)', confThrew)
    }

    console.log(`\nselftest: ${ok} pass, ${fail} fail`)
    process.exit(fail === 0 ? 0 : 1)
  }

  console.log('commands: seed | compile "theme" [engine] [oc1,oc2,oc3] [--pin x,y] | recompile T4-NN "theme" | scribe T4-NN | check T4-NN | gates T4-NN | deliver T4-NN | void T4-NN "reason" | state | chain | verify [--heal] | reaper | grep-gate | selftest')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
