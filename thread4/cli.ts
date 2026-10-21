/**
 * THREAD 4 CLI — seed / цикл (авто И вручную) / compile / check / gates / deliver / state.
 * Usage (bun):
 *   bun thread4/cli.ts help            # полная шпаргалка обоих режимов цикла
 *
 * ── ЦИКЛ ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER (фаза 3) ──
 *   Авто-цепочка (конечный автомат, состояние — события cycle.step в летописи):
 *   bun thread4/cli.ts auto --theme "тема" --oc "OC-тема1" [--oc "OC-тема2"] [--oc "OC-тема3"] [--until STEP] [--step STEP] [--approve] [--slug T4-NN]
 *     · возобновление после падения — сам находит открытый цикл в летописи;
 *     · идемпотентность: повтор шага в том же состоянии не плодит событий;
 *     · human-gate: после EXPOSITION цепочка останавливается (экспозиция —
 *       EXP-заглушки ждут твоей руки); продолжение — --approve или шаг вручную;
 *     · любой hard FAIL гейтов — остановка с полным отчётом;
 *     · движок молчит — таймаут шага + N повторов, потом честный стоп.
 *   Ручной режим (каждый шаг рукой; существующие примитивы не тронуты):
 *   bun thread4/cli.ts order "тема" "OC-тема1" ["OC-тема2"] ["OC-тема3"]  # ORDER (OC-темы — крафтовый вход, канон движка)
 *   bun thread4/cli.ts plan T4-NN                 # COMPILE: план у живого движка
 *   bun thread4/cli.ts expose T4-NN               # EXPOSITION: мост план→контракт
 *   bun thread4/cli.ts write T4-NN                # WRITE: писец (LLM-мост)
 *   bun thread4/cli.ts gates T4-NN                # GATES (существующий примитив)
 *   bun thread4/cli.ts deliver T4-NN              # DELIVER (существующий примитив)
 *
 * ── Примитивы вне цикла (работают как работали) ──
 *   bun thread4/cli.ts seed          # era.born + spec.imported + law.ratified (once)
 *   bun thread4/cli.ts compile "тема" [oc1,oc2,oc3] [--pin oc-rplus,engine:key]
 *     (позиция [engine] ещё принимается для совместимости, но игнорируется —
 *      Issue #44: ротация всегда per-theme, судьба движков за автором/жнецом)
 *   bun thread4/cli.ts recompile T4-NN "тема"  # пересборка слага под текущий закон
 *   bun thread4/cli.ts check T4-01   # писец: сухой прогон гейтов (без событий)
 *   bun thread4/cli.ts polish T4-01  # гейт-починка черновика (LLM, таймауты)
 *   bun thread4/cli.ts gates T4-01   # официальный прогон гейтов (gate.run в лог)
 *   bun thread4/cli.ts deliver T4-01 # официальный прогон + сдача батча
 *   bun thread4/cli.ts scribe T4-01  # авто-писец: черновик батча по контракту (LLM)
 *   bun thread4/cli.ts drift T4-NN      # тег-дрейф отчёт (REPORT, не гейт)
 *   bun thread4/cli.ts stack T4-NN      # концепты стеков против истории (REPORT)
 *   bun thread4/cli.ts lists T4-NN ...  # рендер-листы .txt в download/ (порт fred-legacy)
 *   bun thread4/cli.ts diff A B         # дифф пары батчей .md в download/ (порт fred-legacy)
 *   bun thread4/cli.ts trial [T4-NN...] # сводка триала .md в download/ (порт fred-legacy)
 *   bun thread4/cli.ts state
 *   bun thread4/cli.ts selftest      # compiler + gates smoke test
 */
import { compileBatch, contractMarkdown, lastCompiledRoster } from '../src/lib/t4/compiler'
import { runGates, parseBatch } from '../src/lib/t4/gates'
import { deliverBatch } from '../src/lib/t4/deliver'
import { chat, scribeBatch, systemPrompt } from '../src/lib/t4/scribe'
import { resolveLlmProvider, type LlmProvider } from '../src/lib/t4/llm-provider'
import fs from 'node:fs'
import path from 'node:path'
import { appendEvent, bootstrapChain, foldState, healChainTail, nextBatchNumber, readEvents, verifyChain, type T4Event } from '../src/lib/t4/events'
import { getDeliveryStats, getPolicy, specInventory, type TierRecipe } from '../src/lib/t4/specs'
import { buildReaperDraft } from '../src/lib/t4/reaper'
import { scanSource } from '../src/lib/t4/hygiene'
import { isSafeSlug, writeText } from '../src/lib/t4/fsutil'
import { readChronicle, warmConsciousness } from '../src/lib/t4/consciousness'

const cmd = process.argv[2] ?? ''

function printGates(result: NonNullable<ReturnType<typeof runGates>>) {
  for (const r of result.receipts) {
    const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : r.verdict === 'WARN' ? '⚠' : '·'
    console.log(`  [${mark}] ${r.gate} (${r.level})`)
    /* непрохождение = полный список находок: срез 5 прятал хвост
     * (check T4-28 показывал P7-P17, а P19/P21 и кластер — нет) */
    const shown = r.verdict === 'PASS' ? r.findings.slice(0, 5) : r.findings
    for (const f of shown) console.log(`       ${f}`)
    /* аудит-2026-10-12: не-фейлящие факты прогонa (видимость окна) — видны,
     * вердикт не меняют */
    for (const n of r.notes ?? []) console.log(`       · ${n}`)
  }
  console.log(`\nrun #${result.runIndex} · hard ${result.hardPass ? 'PASS' : 'FAIL'}${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''}`)
  /* Issue #20: FRC — согласие гейтов с текстом, не качество.
     Единственный честный сигнал качества — вердикт автора после рендера. */
  console.log('  (FRC = гейты согласны с текстом; качество измеряет вердикт автора после рендера — Issue #20)')
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
      console.error('usage: compile "тема" [oc1,oc2,oc3] [--pin oc-rplus,engine:key]')
      process.exit(1)
    }
    const engine = args[1] && !args[1].includes(',') ? args[1] : undefined
    /* Issue #44 (аудит 2026-10-12): позиция принималась, но компилятор
       игнорировал её — ротация всегда per-theme. Честность вместо мёртвого
       параметра: аргумент не ломаем (совместимость мышечной памяти),
       но врать в usage больше не будем. */
    if (engine) {
      console.log(`(движок «${engine}» принят, но ротация всегда per-theme — Issue #44; судьба движков за автором/жнецом)`)
    }
    const ocArg = args[1] && args[1].includes(',') ? args[1] : args[2]
    const ocOrders = ocArg ? ocArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    /* Фаза 2, итерация 3: ротация ОС — из хроники живого движка. Прогрев;
     * недоступен — честная ошибка (не молчаливая файл-эра). */
    try {
      await warmConsciousness()
    } catch (e) {
      console.error(`${(e as Error).message}`)
      process.exit(1)
    }
    const contract = compileBatch(theme, { engine, ocOrders, authorPin })
    console.log(contractMarkdown(contract))
    return
  }

  if (cmd === 'polish') {
    /* Ревизия 2026-10-14 (2.6): гейт-починка существующего черновика —
       замена осиротевшего polish-batch.ts (собственный LLM-цикл без
       таймаутов). Ремонт hard-фейлов + полировка WARN-гейтов тем же
       машинерием писца: таймауты 180с, откат полировки, ремонт только
       своего набора позиций. Сданный батч не трогает. */
    const slug = process.argv[3]
    if (!slug || !/^T4-[\dA-Za-z.-]+$/.test(slug)) {
      console.error('usage: polish T4-NN [maxRepairRounds]')
      process.exit(1)
    }
    /* Фаза 2, итерация 3: гейты починки фолдят хронику живого движка. */
    try {
      await warmConsciousness()
    } catch (e) {
      console.error(`${(e as Error).message}`)
      process.exit(1)
    }
    const rounds = process.argv[4] ? parseInt(process.argv[4], 10) : 2
    const { polishBatch } = await import('../src/lib/t4/scribe')
    polishBatch(slug, {
      maxRepairRounds: Number.isFinite(rounds) ? rounds : 2,
      onLog: (line) => console.log(line),
    })
      .then((res) => {
        console.log(`\npolish: ${res.slug} «${res.title}» — ремонт ${res.rounds} круг(а), гейты ${res.hardPass ? 'PASS' : 'FAIL'} (sha ${res.sha10})${res.hardPass ? ` — сдача открыта: bun thread4/cli.ts deliver ${res.slug}` : ' — черновик записан с квитанциями'}`)
        process.exit(res.hardPass ? 0 : 1)
      })
      .catch((e) => {
        console.error(e instanceof Error ? e.message : e)
        process.exit(1)
      })
    return
  }

  if (cmd === 'scribe') {
    const slug = process.argv[3]
    if (!slug || !/^T4-\d{2}$/.test(slug)) {
      console.error('usage: scribe T4-NN [maxRepairRounds]')
      process.exit(1)
    }
    /* Фаза 2, итерация 3: охраны писца фолдят хронику живого движка. */
    try {
      await warmConsciousness()
    } catch (e) {
      console.error(`${(e as Error).message}`)
      process.exit(1)
    }
    const maxRepairRounds = process.argv[4] ? parseInt(process.argv[4], 10) : 3
    scribeBatch(slug, {
      maxRepairRounds: Number.isFinite(maxRepairRounds) ? maxRepairRounds : 3,
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

  /* ================= ФАЗА 3: ОРКЕСТРАТОР — ручные шаги цикла ============
   * Каждый шаг цикла доступен рукой автора; существующие примитивы
   * (compile/scribe/check/gates/deliver) не тронуты — шаги их ВЫЗЫВАЮТ.
   * Состояние автомата — события cycle.step в летописи; повтор шага в
   * том же состоянии не плодит событий-дублей. */
  if (cmd === 'order' || cmd === 'plan' || cmd === 'expose' || cmd === 'write' || cmd === 'auto') {
    const { runAuto, runCycleStep, stepOrder, StepStop, isCycleStep, CYCLE_STEPS } = await import('../src/lib/t4/orchestrator')
    const flag = (name: string): string | undefined => {
      const i = process.argv.indexOf(name)
      return i >= 0 ? process.argv[i + 1] : undefined
    }
    const hasFlag = (name: string): boolean => process.argv.includes(name)
    try {
      if (cmd === 'order') {
        const theme = process.argv[3]
        if (!theme) {
          console.error('usage: order "тема" "OC-тема1" ["OC-тема2"] ["OC-тема3"]')
          process.exit(1)
        }
        const ocs = process.argv.slice(4).filter((s) => s && !s.startsWith('--'))
        const out = await stepOrder(theme, ocs)
        for (const l of out.lines) console.log(l)
        console.log(`следующий шаг: bun thread4/cli.ts plan ${out.slug}   # или вся цепочка: t4 auto --theme "${theme}"`)
        return
      }
      if (cmd === 'plan' || cmd === 'expose' || cmd === 'write') {
        const slug = process.argv[3]
        if (!slug || !/^T4-[A-Za-z0-9][A-Za-z0-9.-]{0,30}$/.test(slug)) {
          console.error(`usage: ${cmd} T4-NN`)
          process.exit(1)
        }
        const step = cmd === 'plan' ? 'COMPILE' : cmd === 'expose' ? 'EXPOSITION' : 'WRITE'
        const out = await runCycleStep(step, slug, undefined)
        for (const l of out.lines) console.log(l)
        console.log(`следующий шаг: ${step === 'COMPILE' ? `expose ${slug}` : step === 'EXPOSITION' ? `write ${slug} (human-gate: экспозиция ждёт твоей руки)` : `gates ${slug}`}`)
        return
      }
      /* t4 auto --theme "…" --oc "OC-тема1" [--oc …] [--until STEP] [--step STEP] [--approve] [--slug T4-NN] */
      const theme = flag('--theme')
      const slug = flag('--slug')
      const untilArg = flag('--until')
      const stepArg = flag('--step')
      const approve = hasFlag('--approve')
      const ocThemes = process.argv
        .reduce<{ acc: string[]; next: boolean }>((s, a) => {
          if (a === '--oc') return { acc: s.acc, next: true }
          /* каждый --oc — РОВНО ОДНА OC-тема (запятая внутри темы — законна,
           * дробить нельзя; несколько ОС = несколько --oc) */
          if (s.next) return { acc: [...s.acc, a.trim()].filter(Boolean), next: false }
          return s
        }, { acc: [], next: false })
        .acc
      if (!theme && !slug) {
        console.error('usage: auto --theme "тема" [--until STEP] [--step STEP] [--approve] | auto --slug T4-NN [--until STEP] [--step STEP] [--approve]')
        console.error(`шаги цикла: ${CYCLE_STEPS.join('→')}`)
        process.exit(1)
      }
      for (const [name, val] of [['--until', untilArg], ['--step', stepArg]] as const) {
        if (val != null && !isCycleStep(val)) {
          console.error(`${name}: «${val}» вне канона цикла (${CYCLE_STEPS.join('→')})`)
          process.exit(1)
        }
      }
      const report = await runAuto({
        theme,
        ocThemes,
        slug,
        until: untilArg as never,
        step: stepArg as never,
        approve,
        onLog: (l) => console.log(l),
      })
      console.log('')
      for (const ex of report.executed) {
        for (const l of ex.lines) console.log(l)
      }
      if (report.stopped) {
        if (report.stopped.kind === 'hard-fail' || report.stopped.kind === 'engine-down' || report.stopped.kind === 'refused') {
          console.error(`\nСТОП (${report.stopped.kind}): ${report.stopped.message}`)
        } else {
          console.log(`\nСТОП (${report.stopped.kind}): ${report.stopped.message}`)
        }
        if (report.nextHint) console.log(`далее:\n${report.nextHint}`)
      }
      const bad = report.stopped && (report.stopped.kind === 'hard-fail' || report.stopped.kind === 'engine-down' || report.stopped.kind === 'refused')
      process.exit(bad ? 1 : 0)
    } catch (e) {
      if (e instanceof StepStop) {
        console.error(`СТОП (${e.kind}): ${e.message}`)
        process.exit(e.kind === 'gate-stop' ? 0 : 1)
      }
      const { isConsciousnessError } = await import('../src/lib/t4/consciousness')
      if (isConsciousnessError(e)) {
        console.error(`СТОП (engine-down): ${(e as Error).message}`)
        process.exit(1)
      }
      throw e
    }
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
      `${slug} закрыт по приказу автора: ${reason}. Контракт остаётся в архиве как провенанс; из окна ротации исключён; номер не забивается: авто-номер идёт max+1, рекомпиляция void-слага легальна (вердикт автора 2026-10-20).`,
      { slug, reason }
    )
    console.log(`void: ${slug} закрыт (${reason}) — из окна ротации исключён, номер закреплён навсегда`)
    return
  }

  if (cmd === 'check' || cmd === 'gates' || cmd === 'deliver') {
    const slug = process.argv[3]
    /* аудит 2026-10-12: slug шёл в path.join без валидации — у кромки CLI
     * отбиваем traversal до вызова ядра (ядро валидирует независимо) */
    if (!slug || !isSafeSlug(slug)) {
      console.error(`usage: ${cmd} T4-NN[/суффикс] (только буквы/цифры/точка/дефис)`)
      process.exit(1)
    }
    /* Фаза 2, итерация 3: сознание — живой движок. Прогрев прод-цепи до
     * синхронных конвейеров; недоступен — честная ошибка (не файл-эра). */
    try {
      await warmConsciousness()
    } catch (e) {
      console.error(`${(e as Error).message}`)
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
    /* Фаза 2, итерация 3: панель состояния CLI — из хроники живого движка;
     * недоступен — честная метка деградации и файл-эра (отображение может
     * деградировать, решения — нет). */
    let events
    try {
      events = (await readChronicle()).events
    } catch (e) {
      console.error(`(${(e as Error).message.split('.')[0]} — показана файл-эра)`)
      events = readEvents()
    }
    console.log(JSON.stringify(foldState(events), null, 2))
    return
  }

  if (cmd === 'drift') {
    /* Тег-дрейф счётчик (2026-10-11, преемник): REPORT, не гейт — наследник
     * motif_noun_counts 3.2, первый шаг ULTIMATE DICE для тег-стеков RAW-эры. */
    const rest = process.argv.slice(3)
    if (rest.length === 0) {
      console.error('usage: drift T4-NN [--min N] [--top N] [--json]')
      process.exit(1)
    }
    await import('./tools/drift-report').then((m) => m.run(rest))
    return
  }

  if (cmd === 'stack') {
    /* Концепт-валидатор стеков (2026-10-11, преемник): REPORT, не гейт —
     * порт ULTIMATE DICE §44 из архива A5: сигнатуры поза+палитра+сет
     * носителей по истории сдач, §56D мутация-на-возврате, rebuildOf-метка. */
    const rest = process.argv.slice(3)
    if (rest.length === 0) {
      console.error('usage: stack T4-NN [--depth N] [--top N] [--json]')
      process.exit(1)
    }
    await import('./tools/stack-report').then((m) => m.run(rest))
    return
  }

  if (cmd === 'lists') {
    /* Рендер-листы .txt (порт fred-legacy, 2026-10-12): те же файлы, что
     *  кнопка «.txt» в Слотах — но из репо, для автора руками. */
    const rest = process.argv.slice(3)
    if (rest.length === 0) {
      console.error('usage: lists T4-NN [T4-NN …]')
      process.exit(1)
    }
    await import('./tools/render-lists').then((m) => m.run(rest))
    return
  }

  if (cmd === 'diff') {
    /* Дифф пары .md (порт fred-legacy): A — база, B — перестройка. */
    const rest = process.argv.slice(3)
    if (rest.length !== 2) {
      console.error('usage: diff <A-база> <B-перестройка>')
      process.exit(1)
    }
    await import('./tools/diff-export').then((m) => m.run(rest))
    return
  }

  if (cmd === 'trial') {
    /* Сводка триала .md (порт fred-legacy): без аргументов — живая пара момента. */
    await import('./tools/trial-export').then((m) => m.run(process.argv.slice(3)))
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

  if (cmd === 'shore-merge') {
    /* Решение аудита V3 №5 (Issue #16): слияние берегов одной командой.
       fetch → union лога (дедуп по id) → bootstrap цепи → verify → отчёт.
       Пуш после слияния — осознанное действие оператора. */
    const { execSync } = await import('node:child_process')
    try {
      execSync('git fetch origin', { stdio: 'pipe' })
    } catch {
      console.error('shore-merge: git fetch не удался — нет сети или origin; продолжаю только с локальным логом')
    }
    let remoteRaw = ''
    try {
      remoteRaw = execSync('git show origin/main:thread4/events/log.jsonl', { encoding: 'utf8' })
    } catch {
      console.log('shore-merge: удалённого лога нет — слияние не требуется, локальный лог уже главный')
      return
    }
    const localLines = fs.readFileSync('thread4/events/log.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => l.trim())
    const remoteLines = remoteRaw.split('\n').filter(Boolean).map((l) => l.trim())
    const seen = new Set<string>()
    const merged: Array<{ at: string; line: string }> = []
    let dupes = 0
    for (const line of [...localLines, ...remoteLines]) {
      try {
        const obj = JSON.parse(line) as { id?: string; at?: string }
        const key = obj.id ?? line
        if (seen.has(key)) {
          dupes += 1
          continue
        }
        seen.add(key)
        merged.push({ at: obj.at ?? '', line: line.trim() })
      } catch {
        /* битая строка не переносится — гвард рождения такие не пропускал */
      }
    }
    merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    writeText('thread4/events/log.jsonl', merged.map((m) => m.line).join('\n') + '\n')
    const rebuilt = bootstrapChain()
    const v = verifyChain()
    const localOnly = localLines.filter((l) => !remoteLines.includes(l)).length
    const remoteOnly = remoteLines.filter((l) => !localLines.includes(l)).length
    console.log(`shore-merge: локальных новых ${localOnly}, удалённых новых ${remoteOnly}, дублей снято ${dupes}`)
    console.log(`shore-merge: лог ${merged.length} событий, цепь ${rebuilt.links} звеньев, head ${rebuilt.head.slice(0, 10)}`)
    console.log(`shore-merge: verify — ${v.ok ? 'ЦЕЛА' : 'СЛОМАНА: ' + v.problems.join('; ')}`)
    console.log('shore-merge: следующее — осознанный git add thread4/events && git commit && git push')
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

  if (cmd === 'corpus') {
    /* Corpus 2.0 (U6): очередь взглядов автора → кураторство ритуалом.
       corpus               — показать очередь
       corpus take <N>      — кандидат N → golden-corpus (author_note = взгляд)
       corpus drop <N>      — кандидат N → мусор */
    const qPath = path.join(process.cwd(), 'thread4', 'corpus-queue.jsonl')
    /* Аудит №4 (2026-10-17, strict, race): жёсткий JSON.parse на строке
     * очереди ронял всю команду `corpus`, если роут дописывал хвост в
     * момент чтения (разорванная строка). Терпи́мый парсер: битые строки
     * пропускаются с предупреждением, нумерация честная (по сырому
     * индексу — команды take/drop не сдвигаются). */
    const queue = fs.existsSync(qPath)
      ? fs
          .readFileSync(qPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((l, i): ({ n: number } & Record<string, unknown>)[] => {
            try {
              return [{ n: i + 1, ...(JSON.parse(l) as Record<string, unknown>) }]
            } catch {
              console.error(`  очередь: строка №${i + 1} битая (параллельная запись) — пропущена`)
              return []
            }
          })
      : []
    const act = process.argv[3]
    if (!act) {
      for (const q of queue) console.log(`  ${q.n}. [${q.slug}] (${q.source}) ${String(q.prose).slice(0, 90)}`)
      console.log(`очередь: ${queue.length} — take <N> в корпус, drop <N> в мусор`)
      return
    }
    const num = parseInt(process.argv[4] ?? '', 10)
    const entry = queue.find((q) => q.n === num)
    if (!entry) {
      console.error(`corpus: кандидата №${process.argv[4]} нет в очереди`)
      process.exit(1)
    }
    if (act === 'take') {
      const cPath = path.join(process.cwd(), 'thread4', 'specs', 'golden-corpus.json')
      const corpus = JSON.parse(fs.readFileSync(cPath, 'utf8'))
      corpus.entries.push({
        slot: String(entry.slug ?? '') + (entry.position ? ' ' + String(entry.position) : ''),
        claim: String(entry.verdict ?? ''),
        delivered: String(entry.verdict ?? ''),
        author_note: String(entry.prose ?? ''),
        ph_text: '(author-vision: PH-текст слота см. в батче)',
      })
      corpus.version = `${Math.floor(parseFloat(String(corpus.version)) + 1)}.0.0`.replace(/^1\./, '1.')
      fs.writeFileSync(cPath, JSON.stringify(corpus, null, 2) + '\n')
      appendEvent(
        'spec.imported',
        `Corpus 2.0: взгляд автора по ${entry.slug} уходит в золотой корпус (очередь ${queue.length} → ${queue.length - 1})`,
        { spec: 'golden-corpus', version: corpus.version }
      )
      const rest = queue.filter((q) => q.n !== num)
      fs.writeFileSync(qPath, rest.map((q) => JSON.stringify(q)).join('\n') + (rest.length ? '\n' : ''))
      console.log(`corpus: взят (всего записей: ${corpus.entries.length})`)
      return
    }
    if (act === 'drop') {
      const rest = queue.filter((q) => q.n !== num)
      fs.writeFileSync(qPath, rest.map((q) => JSON.stringify(q)).join('\n') + (rest.length ? '\n' : ''))
      console.log(`corpus: кандидат №${num} выброшен (осталось ${rest.length})`)
      return
    }
    console.error('usage: corpus | corpus take <N> | corpus drop <N>')
    return
  }

  if (cmd === 'recover') {
    /* Ревизия 2026-10-14 (категория 3.1): FORENSICS-блок persist.ts
       (recoverReport/recoverApply, ~120 строк) был мёртвым грузом с
       2026-09-23 — ценные функции без входа. Теперь вход есть:
         recover          — сухой отчёт: что съедено откатами платформы
         recover --apply  — восстановить недостающее + note в летопись
       Сканирует reflog + rev-list --all (включая осиротевшие коммиты):
       откат платформы не удаляет историю — он лишь уводит её за HEAD. */
    const { recoverReport, recoverApply } = await import('../src/lib/t4/persist')
    const apply = process.argv[3] === '--apply'
    if (apply) {
      const { report, restored } = recoverApply((line) => console.log(`  ${line}`))
      if (!report) {
        console.error('recover: git-корня нет — восстанавливать не из чего')
        process.exit(1)
      }
      if (restored.length === 0) {
        console.log(`recover: нечего восстанавливать — ${report.candidates.length} кандидатов, все на месте (head ${report.head.slice(0, 10)}, просканировано ${report.scannedCommits} коммитов)`)
        return
      }
      appendEvent(
        'note',
        `recover --apply: восстановлено ${restored.length} файл(ов) из git-истории после отката платформы — ${restored.slice(0, 8).join(', ')}${restored.length > 8 ? ` … +${restored.length - 8}` : ''}`,
        { kind: 'recover', restored, head: report.head, candidates: report.candidates.length }
      )
      console.log(`recover: восстановлено ${restored.length}, снапшот-коммит persist, note в летописи`)
      return
    }
    const report = recoverReport()
    if (!report) {
      console.error('recover: git-корня нет — восстанавливать не из чего')
      process.exit(1)
    }
    if (report.candidates.length === 0 && report.diskDiffers.length === 0) {
      console.log(`recover: чисто — летопись и файлы целы против всей истории (head ${report.head.slice(0, 10)}, просканировано ${report.scannedCommits} коммитов, включая осиротевшие из reflog)`)
      return
    }
    console.log(`recover: head ${report.head.slice(0, 10)}, просканировано ${report.scannedCommits} коммитов (reflog + all refs)`)
    for (const c of report.candidates) {
      console.log(`  [${c.kind === 'missing' ? 'ПРОПАЛ' : 'ОТКАЧЕН'}] ${c.path} ← ${c.commit.slice(0, 8)} (${new Date(c.commitTime * 1000).toISOString().slice(0, 16).replace('T', ' ')})`)
    }
    for (const d of report.diskDiffers) {
      console.log(`  [ДРУГОЕ] ${d.path} — диск отличается от HEAD (свежая правка? коммить)`)
    }
    console.log(`recover: ${report.candidates.length} кандидат(ов) на восстановление — применить: bun thread4/cli.ts recover --apply`)
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
    /* Фаза 2, итерация 3: самотест — ЭТАЛОН файл-эры. Пины живых прогонов
     * рождены фолдом файл-летописи; их контракты не переписываются.
     * Живой движок-сознание доказывается отдельно: tools/state-parity.ts
     * + E2E (аудит-док §10). Здесь источник сознания пинится ЯВНО. */
    process.env.T4_STATE_SOURCE = 'file'
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
    const hairEye = inv.find((s) => s.id === 'hair-eye-library')
    check('библиотека hair/eye (E3, A5P3F): 31 hair + 20 eye + подсказки A5P2', hairEye?.count === 51 && hairEye?.version === '1.0.0')

    // техника-карта (таблица автора, 2026-09-21)
    const tech = inv.find((s) => s.id === 'rating-techniques')
    check('техника-карта в инвентаре (>=100 приёмов)', (tech?.count ?? 0) >= 100)
    const recipes = inv.find((s) => s.id === 'rating-recipes')
    check('рецепт v1.9.0 (закон №28 ПРИНЯТ: через-ткань = X-канал; R+ bumps = P30-коктейль DRY dark covered-first; веса RAW легализованы; X несёт through_fabric)', recipes?.version === '1.9.0')
    // статa доставки (рекомендация Claude №2, external.review 2026-09-23;
    // v0.2.0 — вердикт T4-05: 13 → 18 каналов)
    const dstats = inv.find((s) => s.id === 'delivery-stats')
    check('стата доставки в инвентаре (23 канала, v0.7.0: tape-only канон 4/4, handbra live 4/4, wet-sheer воскрешён, fabric-tension + pantyline-lower рождены)', dstats?.count === 23 && dstats?.version === '0.7.0')
    {
      const { getRatingRecipes, getRatingTechniques, getDeliveryStats } = await import('../src/lib/t4/specs')
      const rt = getRatingTechniques()
      const rr = getRatingRecipes()
      const ds = getDeliveryStats()
      check('каналы доставки v0.7.0: wet-sheer+подача 8 доставлено (воскрешен конфигурацией §9-цепи), cameltoe 0/15 (dead), OC R+ 2/12 (P02+handbra), handbra live 4/4, оракул 159/159',
        ds?.channels.find((c) => c.id === 'wet-sheer-delivery')?.delivered === 8 &&
        ds?.channels.find((c) => c.id === 'cameltoe')?.delivered === 0 &&
        ds?.channels.find((c) => c.id === 'oc-rplus')?.delivered === 2 &&
        ds?.channels.find((c) => c.id === 'handbra-open-palms')?.status === 'live' &&
        ds?.channels.find((c) => c.id === 'handbra-open-palms')?.delivered === 4 &&
        ds?.channels.find((c) => c.id === 'platform-tier-oracle')?.delivered === 159)
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
      check('§9-септима: bare-under маркеры в рецепте bumps (№28-переименование through_fabric)',
        Array.isArray(rr?.tiers.RPLUS?.mechanisms?.bumps?.bare_under_marker) &&
        (rr?.tiers.RPLUS?.mechanisms?.bumps?.bare_under_marker?.length ?? 0) >= 5)
      check('закон №28: через-теги ушли в X — R+ signals_hard без «nipples through clothing», X signals с ним',
        !(rr?.tiers.RPLUS?.signals_hard ?? []).includes('nipples through clothing') &&
        (rr?.tiers.X?.signals ?? []).includes('nipples through clothing') &&
        (rr?.tiers.X?.mechanisms?.through_fabric?.hard ?? []).includes('nipples through clothing'))
      check('закон №28: bumps forbidden_tags (nipples through clothing / wet clothes / sheer) + risk_tags (see-through) + weights_raw 0.8–1.2',
        (rr?.tiers.RPLUS?.mechanisms?.bumps?.forbidden_tags ?? []).includes('wet clothes') &&
        (rr?.tiers.RPLUS?.mechanisms?.bumps?.forbidden_tags ?? []).includes('sheer') &&
        (rr?.tiers.RPLUS?.mechanisms?.bumps?.risk_tags ?? []).includes('see-through') &&
        (rr?.weights_raw?.weights_allowed ?? []).includes(1.2))
      check('ДРЕССЕР №29: спек в инвентаре (каналы+категории ≥ 13), garter+swim конфликт живёт',
        (inv.find((s) => s.id === 'dresser')?.count ?? 0) >= 13)
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

    /* T4-004 (Issues/thread4): закон посадки видов — гвард брифа и UI
     * клэмпят speciesMax из policy; инвариант генератора (ceil(q/2) ≤
     * niche) обязан выполняться на максимуме, иначе стена сборки вернётся */
    {
      const { speciesLawMax } = await import('../src/lib/t4/specs')
      const smax = speciesLawMax()
      const lawNow = getPolicy().law
      check(
        `T4-004: закон видов = min(2×niche ${lawNow.nicheCount}, mains ${lawNow.mainsTotal}) = ${smax}`,
        smax === Math.min(2 * lawNow.nicheCount, lawNow.mainsTotal)
      )
      check(
        `T4-004: инвариант посадки ceil(${smax}/2) ≤ niche ${lawNow.nicheCount} (генератор не откажет на максимуме)`,
        Math.ceil(smax / 2) <= lawNow.nicheCount && smax <= lawNow.mainsTotal
      )
    }

    /* T4-005 (Issues/thread4): бюджет сигналов тира — писец видит ПОЛНЫЙ
     * запретный список (до фикса slice(0,8): «visible pantyline» был за
     * срезом, ремонт перекатывал один сверхтировый сигнал в другой) */
    {
      const { higherTierSignals, tierBudgetLine } = await import('../src/lib/t4/scribe')
      const { getRatingRecipes } = await import('../src/lib/t4/specs')
      const rrNow = getRatingRecipes()
      const tiers = (rrNow?.tiers ?? {}) as unknown as Record<string, TierRecipe>
      const forbiddenR = higherTierSignals('R', tiers)
      check(
        'T4-005: запрет R полный — covered nipples И visible pantyline в списке (whack-a-mole закрыт)',
        forbiddenR.includes('covered nipples') && forbiddenR.includes('visible pantyline')
      )
      check(
        'T4-005: X-сигналы в запрете R (nipples, topless, nsfw), нижние тиры — нет (bikini не запрещён для R)',
        forbiddenR.includes('nipples') && forbiddenR.includes('topless') && forbiddenR.includes('nsfw') && !forbiddenR.includes('bikini')
      )
      const rSignals = (rrNow?.tiers?.R?.signals ?? []).filter(
        (s) => !/almost naked|torn clothes|clothes pull|covering breasts|hair covering|undressing|bath|onsen|braless|tight clothes/i.test(s)
      )
      const budgetR = tierBudgetLine('R', tiers, rSignals, [])
      check(
        'T4-005: строка бюджета R в промпте — ALLOWED (lingerie…) + FORBIDDEN + «same failure»',
        budgetR.includes('lingerie') && budgetR.includes('FORBIDDEN') && budgetR.includes('SAME failure')
      )
      const budgetRplus = tierBudgetLine(
        'R+',
        tiers,
        (rrNow?.tiers?.RPLUS?.signals ?? []).filter(
          (s) => !/almost naked|torn clothes|clothes pull|covering breasts|hair covering|undressing|bath|onsen|braless|tight clothes/i.test(s)
        ),
        rrNow?.tiers?.RPLUS?.signals_hard ?? []
      )
      check(
        'T4-005: бюджет R+ — claims в ALLOWED-строке, X-сигналы в FORBIDDEN (nipples, topless)',
        budgetRplus.includes('covered nipples') && budgetRplus.includes('nipples, topless')
      )
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
      mainsSpread['R'] === mainsR && mainsSpread['R+'] === law.rplusMains && (mainsSpread['X'] ?? 0) === law.xSlots
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
      allSpread['R'] === expectedAllR && allSpread['R+'] === expectedAllRplus && (allSpread['X'] ?? 0) === law.xSlots
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
      check('contract channelStats: dead-каналы видимы (cameltoe), oc-rplus воскрешён P01 — не в dead, дауншифт погас, deadClaims 0 (рефлекс)',
        (c1.channelStats?.dead ?? []).includes('cameltoe') &&
        !(c1.channelStats?.dead ?? []).includes('oc-rplus') &&
        (c1.channelStats?.deadClaims?.length ?? 0) === 0)
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
      /* ISSUE 13 / #45 (аудит 2026-10-12 + раунд Super Z): событийный лок
       * (appendEvent под withEventLock) не должен оставлять мусор после
       * отказа ДО входа в критическую секцию, а протухший замок (владелец
       * погиб) — взламываться следующим писателем. */
      const { withEventLock } = await import('../src/lib/t4/events')
      check(
        'событийный лок: после born-wounded-отказов замка не осталось (файл чист)',
        !fsMod.existsSync('thread4/events/log.jsonl.lock')
      )
      fsMod.writeFileSync('thread4/events/log.jsonl.lock', 'stale-owner-died')
      const staleOld = new Date(Date.now() - 60_000)
      fsMod.utimesSync('thread4/events/log.jsonl.lock', staleOld, staleOld)
      let staleBroken = false
      let staleClean = false
      try {
        withEventLock(() => {
          staleBroken = true
          return 0
        })
        staleClean = !fsMod.existsSync('thread4/events/log.jsonl.lock')
      } catch {
        /* не должен падать — замок протух */
      }
      check(
        'событийный лок: протухший замок взламывается и снимается после работы (ISSUE 13)',
        staleBroken && staleClean
      )
      let enumThrew = false
      try { appendEvent('render.verdict', 'T4-99: test', { source: 'дичь' }) } catch { enumThrew = true }
      check('guard рождения: render.verdict с source вне enum отвергается (Issue #1 Кенни)', enumThrew)
      let noSrcThrew = false
      try { appendEvent('render.verdict', 'T4-99: test') } catch { noSrcThrew = true }
      check('guard рождения: render.verdict без source отвергается (Issue #1 Кенни)', noSrcThrew)
      /* аудит-2026-10-12: нормализация ошибок на API-краю (остаток #47) —
       * доменный текст проходит, служебные пути ОС снимаются */
      {
        const { clientErrorMessage } = await import('../src/lib/t4/apiguard')
        const domain = 'слишком длинная тема (макс 200 символов)'
        const leak = new Error(
          `ENOENT: no such file or directory, open '${process.cwd()}/thread4/contracts/T4-99.json'`
        )
        const homeLeak = new Error(
          "EACCES: permission denied, open '/home/z/.t4/commander.key'"
        )
        check(
          'apiguard: доменный текст ошибки проходит как есть; абсолютные пути ОС снимаются',
          clientErrorMessage(domain) === domain &&
            clientErrorMessage(leak).includes('thread4/contracts') &&
            !clientErrorMessage(leak).includes('/home/') &&
            !clientErrorMessage(homeLeak).includes('/home/') &&
            clientErrorMessage(homeLeak).includes('commander.key')
        )
      }
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
      const effQuota = Math.min(chPolicy.rehab_quota_per_batch ?? 0, rehab.length || 1)
      check(
        `rehab-добор: min(квота ${chPolicy.rehab_quota_per_batch}, rehab ${rehab.length}) = ${effQuota} R+ слота несут targetChannel из policy (карта T4-26: wet-sheer воскрешён — выведен из rehab; остался dry-sheer)`,
        targets.length === effQuota &&
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

    // Одноразовые движки (вердикт автора Issue #11 Q3): per-theme вместо библиотеки
    {
      const { getEngines } = await import('../src/lib/t4/specs')
      const engines = getEngines()
      check(
        'движки одноразовые: контракт per-theme, engines.json — архив с арендой-наследием',
        c1.engine === 'per-theme' && Boolean(engines?.engines)
      )
      let confThrew = false
      try { appendEvent('render.verdict', 'T4-99: author probe', { source: 'author' }) } catch { confThrew = true }
      check('guard рождения: author-verdict без confidence отвергается (Issue #4 Кенни)', confThrew)
    }

    // Ребилды (вопрос №30 → приказ автора 2026-10-11): окно знает rebuildOf
    {
      const { windowOthersFor, runGates } = await import('../src/lib/t4/gates')
      check(
        'window-гейт: rebuildOf-источник исключается из окна, чужие остаются',
        JSON.stringify(windowOthersFor('B2', ['A', 'B1', 'B2'], 'B1')) === JSON.stringify(['A'])
      )
      const contract272 = JSON.parse(
        (await import('node:fs')).readFileSync('thread4/contracts/T4-27.2-EXP.json', 'utf-8')
      )
      check(
        'контракт перестройки объявляет rebuildOf источника (провенанс)',
        contract272.rebuildOf === 'T4-27'
      )
      /* ревизия 2026-10-13 (симметрия #48 долечена в simcheck): окно для
       * ИСТОЧНИКА обязано исключать его перестройки (двусторонний rebuild-
       * плюс) — на живых контрактах: T4-27 в окне без T4-27.2-EXP */
      check(
        'simcheck/window-симметрия: перестройка исключается из окна ИСТОЧНИКА (двусторонний rebuild-плюс, T4-27 без T4-27.2-EXP)',
        !windowOthersFor('T4-27', ['T4-27', 'T4-27.2-EXP', 'T4-28'], undefined).includes('T4-27.2-EXP') &&
          windowOthersFor('T4-27', ['T4-27', 'T4-27.2-EXP', 'T4-28'], undefined).includes('T4-28')
      )
      const g272 = runGates('T4-27.2-EXP', true)
      check(
        'window-гейт: перестройка проходит окно (переиспользование источника ≠ конфликт ротации)',
        g272?.receipts.find((r) => r.gate === 'window')?.verdict === 'PASS'
      )
      /* аудит-2026-10-12: асимметрия ребилд↔источник (хвост #48) + RAW-видимость */
      const { sentenceDots, closerClassOf, historicalWindowFor } = await import('../src/lib/t4/gates')
      /* ревизия 2026-10-14 (сдача T4-31): ретроактивное окно — регрессия на
       * живом случае: T4-27.2-EXP ронялся будущим членом T4-31 (4 палитры) */
      const hwState = {
        batches: [
          { slug: 'OLD', deliveredAt: '2026-10-11T00:00:00.000Z' },
          { slug: 'FUT', deliveredAt: '2026-10-14T00:00:00.000Z' },
          { slug: 'PAST', deliveredAt: '2026-10-10T00:00:00.000Z' },
          { slug: 'NODEL' },
        ],
        windowSlugs: ['FUT', 'PAST', 'NODEL'],
      }
      check(
        'ретроактивное окно: сданный батч не судится будущими членами; несданный видит всё (T4-27.2-EXP × T4-31, сдача 2026-10-14)',
        JSON.stringify(historicalWindowFor('OLD', hwState)) === JSON.stringify(['PAST', 'NODEL']) &&
          JSON.stringify(historicalWindowFor('NEW', hwState)) === JSON.stringify(['FUT', 'PAST', 'NODEL'])
      )
      const g27 = runGates('T4-27', true)
      check(
        'window-гейт: исключение двустороннее — источник не фейлит на материале собственной перестройки',
        !(g27?.receipts.find((r) => r.gate === 'window')?.findings ?? []).some((x) =>
          x.includes('T4-27.2-EXP')
        )
      )
      check(
        'GATES_TOTAL: живой прогон держит 30 безусловных квитанций (7 hard + 20 warn + 3 advisory) — дрейф счётчика пойман (аудит Rust-эры 2026-10-19)',
        g27
          ? g27.receipts.filter(
                (r) =>
                  !['raw-plus', 'rating-recipe-exploratory', 'raw-plus-exploratory'].includes(r.gate)
              ).length === 30
          : false
      )
      const g24 = runGates('T4-24', true)
      check(
        'window-гейт: RAW-батч получает явную квитанцию о неприменимости (не молчаливый пропуск)',
        (
          g24?.receipts.find((r) => r.gate === 'window')?.notes ?? []
        ).some((n) => n.includes('без контракта'))
      )
      check(
        'закон №23: десятичные в тегах («2.5d») не считаются прозой; предложения считаются',
        sentenceDots('2.5d, 0.8 opacity, tag.') === 1 && sentenceDots('one. two.') === 2
      )
      check(
        'cadence: типографские кавычки “ ” — диалог; прежние классы не сломаны',
        closerClassOf('— сказала она.”') === 'dialogue' &&
          closerClassOf('waited.') === 'image-close' &&
          closerClassOf('— есть,') === 'fragment-pair'
      )
      const fsMod = await import('node:fs')
      const c29 = JSON.parse(fsMod.readFileSync('thread4/contracts/T4-29.json', 'utf-8'))
      const mdPlain = contractMarkdown(c29)
      const mdOpaque = contractMarkdown({ ...c29, windowOpaque: ['T4-25', 'T4-26'] })
      check(
        'экспозиция: окно без наблюдаемых поз/палитр печатается фактом только когда есть',
        !mdPlain.includes('Окно без наблюдаемых') &&
          mdOpaque.includes('Окно без наблюдаемых поз/палитр**: T4-25, T4-26')
      )
      /* webDevReview: наблюдаемость ≠ наличие файла контракта — RAW-компиляция
       * (T4-25/26) пишет контракты с пустыми pose/palette; usage[''] не пачкаем */
      const { observableSlotCount, foldWindowUsage } = await import('../src/lib/t4/compiler')
      check(
        'окно: контракт без единого id (T4-25) ненаблюдаем; контракт с id (T4-29) наблюдаем',
        observableSlotCount([{ pose: '', palette: '' }, { pose: 'PL84', palette: '' }]) === 1 &&
          observableSlotCount([{ pose: '', palette: '' }]) === 0 &&
          foldWindowUsage(['T4-25']).opaque.includes('T4-25') &&
          foldWindowUsage(['T4-29']).opaque.length === 0
      )
    }

    // Закон №27 «канал R+: бугорок да, розовое нет» (вердикт T4-28,
    // 2026-10-11): доказательная пара — гейт ловит ИСТОРИЮ (7 X-слайдов
    // автора: through-заявка на мокрой светлой/средней ткани), золото
    // P20/P08 (тёмная ткань + through) не задето — ложных срабатываний нет.
    {
      const g28 = runGates('T4-28', true)
      const rp28 = g28?.receipts.find((r) => r.gate === 'raw-plus')
      const f27 = (rp28?.findings ?? []).filter((x) => x.includes('закон №27'))
      check(
        `закон №27: гейт ловит исторический X-слайд T4-28 — 7 слотов автора (${f27.length} находок), вердикт истины`,
        rp28?.verdict === 'FAIL' && f27.length >= 7
      )
      check(
        'закон №27: P20/P08 (тёмная ткань + through-заявка — золото автора) чисты, ложных срабатываний нет',
        !(rp28?.findings ?? []).some((x) => /^P(08|20):/.test(x))
      )
    }

    // Закон №28 (ПРИНЯТ вердиктом T4-31, EXP-изоляция тона 7/8 X):
    // доказательная пара — гейт ловит ИСТОРИЮ (через-теги на R+ из 25
    // заявок — ↑14 X-слайдов автора), P30-выживший (бугорки, тёмный, DRY)
    // не задет жёсткими запретами. Дрессер №29 — квитанции каналов.
    {
      const g31 = runGates('T4-31', true)
      const rp31 = g31?.receipts.find((r) => r.gate === 'rating-recipe')
      const f28 = (rp31?.findings ?? []).filter((x) => x.includes('закон №28'))
      check(
        `закон №28: гейт ловит исторический X-слайд T4-31 — ↑14 вердикта автора (${f28.length} находок through/combo/sheer/бугорки-без-тёмного), вердикт истины`,
        rp31?.verdict === 'FAIL' && f28.length >= 10
      )
      const p30finds = (f28 ?? []).filter((x) => /^P30:/.test(x))
      check(
        'закон №28: P30-формула чиста — combo/sheer/бугорки-без-тёмного НЕ флагают (задет только остаточный через-тег, пережиток удачи: dark+dry+covered-first его пересилили)',
        p30finds.length <= 1 &&
          !p30finds.some((x) => x.includes('X-комбо') || x.includes('sheer') || x.includes('без тёмного слова'))
      )
      const d31 = g31?.receipts.find((r) => r.gate === 'dresser')
      check(
        `Дрессер №29: квитанции когерентности по T4-31 (see-through/wet-риски + garter-история; ${d31?.findings?.length ?? 0} квитанций)`,
        (d31?.findings?.length ?? 0) >= 3
      )
    }

    // Ревизия 2026-10-14: contract-fidelity — кино-сдвиг ловится (дефект T4-30)
    {
      const { contractFidelity } = await import('../src/lib/t4/gates')
      const { getRaces } = await import('../src/lib/t4/specs')
      const races = getRaces()
      const cfContract = {
        slots: [
          {
            position: 1,
            kind: 'NICHE',
            rating: 'R',
            pose: 'PL175',
            palette: 'P01_TEST_X',
            carriers: [{ id: 'CR-W01' }, { id: 'CR-B03' }],
          },
          { position: 2, kind: 'VOLT', rating: 'R+', race: 'Cat', pose: 'PL22', palette: 'P02_TEST_Y', carriers: [{ id: 'CR-W02' }] },
        ],
      }
      const mdShift = [
        '# T4-96 — тест',
        '',
        'P01 — anchor-one (NICHE · R · PL22 · P01_TEST_X)',
        'THESIS: t',
        'Stack: CR-W01 + CR-E05',
        'POS:',
        'tags, tags',
        'NEG:',
        'bad',
        '',
        'P02 — anchor-two (VOLT · R+ · PL22 · P02_TEST_Y)',
        'THESIS: t',
        'Stack: CR-W02',
        'POS:',
        'girl, standing, smile',
        'NEG:',
        'bad',
      ].join('\n')
      const fid = contractFidelity(cfContract, parseBatch('T4-96', mdShift), races)
      check(
        'contract-fidelity: ловит сдвиг позы PL175→PL22, расхождение стека и пропавший кин-блок (дефект T4-30)',
        fid.some((x) => x.includes('PL175')) &&
          fid.some((x) => x.includes('CR-B03')) &&
          fid.some((x) => x.includes('раса «Cat»'))
      )
      const goodSlot = {
        position: 1,
        kind: 'NICHE',
        rating: 'R',
        race: 'Cat',
        pose: 'PL175',
        palette: 'P01_TEST_X',
        carriers: [{ id: 'CR-W01' }, { id: 'CR-B03' }],
      }
      const mdGood = [
        '# T4-97 — тест',
        '',
        'P01 — anchor-one (NICHE · R · PL175 · P01_TEST_X)',
        'THESIS: t',
        'Stack: CR-W01 + CR-B03',
        'POS:',
        'cat girl, cat ears, cat tail, scene',
        'NEG:',
        'bad',
      ].join('\n')
      const fidGood = contractFidelity({ slots: [goodSlot] }, parseBatch('T4-97', mdGood), races)
      check(
        'contract-fidelity: верный слот (поза/палитра/стек/кин на месте) не шумит',
        fidGood.length === 0
      )
      /* polish (ревизия 2026-10-14): выходы из существующего батча —
       * замена polish-batch.ts (2.6); чистая функция без LLM */
      const { outputsFromBatchText } = await import('../src/lib/t4/scribe')
      const outs = outputsFromBatchText('T4-96', mdShift)
      check(
        'polish: outputsFromBatchText читает слоты черновика обратно в выходы писца (anchor/thesis/pos на месте)',
        outs.size === 2 && (outs.get(1)?.anchor ?? '').startsWith('anchor-one') &&
          (outs.get(2)?.pos ?? '').includes('standing') && (outs.get(1)?.thesis ?? '') === 't'
      )
    }

    // Ревизия 2026-10-14: contract-from-batch — ретро-контракт одним вызовом
    // (обобщение gen-t426/27/272 + refresh-t425, ~590 строк одноразовок)
    {
      const { buildContractFromBatch, carrierIndex, paletteOfHeader } = await import('./tools/contract-from-batch')
      const miniCarriers = carrierIndex({
        classes: {
          W: [{ id: 'CR-W01', name: 'blouse' }],
          B: [{ id: 'CR-B03', name: 'bra-top' }],
        },
      })
      check(
        'contract-from-batch: carrierIndex строит id→{name,cls} по классам',
        miniCarriers.get('CR-W01')?.cls === 'W' && miniCarriers.get('CR-B03')?.name === 'bra-top'
      )
      check(
        'contract-from-batch: палитра из шапки — регекс P###_NAME, не режет составные',
        paletteOfHeader('(VOLT · R+ · PL22 · P02_TEST_Y)') === 'P02_TEST_Y' &&
          paletteOfHeader('(NICHE · R · PL01)') === ''
      )
      const mdRetro = [
        '# T4-95 — тест',
        '',
        'P01 — anchor-one (OC · Rue · R+ · PL01 · P01_X)',
        'THESIS: t',
        'Stack: CR-W01 + CR-B03',
        'POS:',
        'pos',
        'NEG:',
        'neg',
        '',
        'P02 — anchor-two (EXP · — · R+ · PL02 · P02_Y)',
        'THESIS: t',
        'Stack: CR-W01',
        'POS:',
        'pos',
        'NEG:',
        'neg',
        '',
        'P03 — anchor-three (NICHE · R · PL03 · P03_Z)',
        'THESIS: t',
        'POS:',
        'pos',
        'NEG:',
        'neg',
      ].join('\n')
      const built = buildContractFromBatch(parseBatch('T4-95', mdRetro), miniCarriers, {
        slug: 'T4-95',
        theme: 'ретро-тема',
        engine: 'retro-engine',
        abSpec: 'P2:P3:κ:тест-пара',
      })
      const c = built.contract as {
        slots: { position: number; kind: string; oc: string; rating: string; palette: string; carriers: { id: string }[]; exploratory?: string; ab?: { pair: string; half: string } }[]
        spread: { rating: string; count: number }[]
        abPairs: { pair: string; a: number; b: number; lead: string }[]
        retroNote: string
      }
      check(
        'contract-from-batch: слоты — жанр/OC-имя/тир/палитра/стек из батча; EXP-слот несёт exploratory',
        c.slots.length === 3 &&
          c.slots[0].kind === 'OC' && c.slots[0].oc === 'Rue' && c.slots[0].rating === 'R+' &&
          c.slots[0].palette === 'P01_X' && c.slots[0].carriers.length === 2 &&
          c.slots[2].kind === 'NICHE' && c.slots[2].carriers.length === 0
      )
      check(
        'contract-from-batch: spread считается по тирам, abSpec → пары с лидом',
        c.spread.length === 2 && c.spread.find((s) => s.rating === 'R+')?.count === 2 &&
          c.spread.find((s) => s.rating === 'R')?.count === 1 &&
          c.abPairs.length === 1 && c.abPairs[0].pair === 'κ' && c.abPairs[0].a === 2 && c.abPairs[0].b === 3
      )
      check(
        'contract-from-batch: ретро-нота честна (летопись не тронута, окно не заявляется)',
        c.retroNote.includes('data-repair') && built.markdown.includes('ретро, из батча')
      )
    }

    // Ревизия 2026-10-14: corpus-очередь в lib — батч-вердикт кормит её же
    // (категория 3.5: правило «взгляд ≥40» жило инлайном в events-роуте)
    {
      const { authorGazeWorthy, feedCorpusQueue } = await import('../src/lib/t4/corpus')
      const fsMod = await import('node:fs')
      const mkEvt = (type: string, data: Record<string, unknown>): T4Event => ({
        id: '999',
        at: '2026-10-14T00:00:00Z',
        type,
        summary: type,
        data,
      })
      check(
        'corpus: взгляд автора = render.verdict + source author* + проза ≥40 (порог AUTHOR_GAZE_MIN)',
        authorGazeWorthy(mkEvt('render.verdict', { source: 'author-batch', prose: 'Вот это кадр: мокрая ткань легла как вторая кожа, сосок читается сквозь блузку — канон.' })).worthy &&
          !authorGazeWorthy(mkEvt('render.verdict', { source: 'author-batch', prose: 'норм' })).worthy &&
          !authorGazeWorthy(mkEvt('render.verdict', { source: 'vlm', prose: 'Длинная проза машины не считается взглядом автора — это аналитика, не высказывание автора о кадре.' })).worthy
      )
      const tmpQ = `thread4/.selftest-corpus-${Date.now()}.jsonl`
      try { fsMod.rmSync(tmpQ, { force: true }) } catch { /* ... */ }
      const fed = feedCorpusQueue(
        mkEvt('render.verdict', { source: 'author-batch', slug: 'T4-94', mode: 'light', verdict: 'keep', prose: 'Мокрая ткань легла как вторая кожа — держим канал, это золото для корпуса.' }),
        tmpQ
      )
      const notFed = feedCorpusQueue(
        mkEvt('render.verdict', { source: 'author-batch', slug: 'T4-94', prose: 'коротко' }),
        tmpQ
      )
      const lines = fsMod.existsSync(tmpQ) ? fsMod.readFileSync(tmpQ, 'utf8').split('\n').filter(Boolean) : []
      try { fsMod.rmSync(tmpQ, { force: true }) } catch { /* ... */ }
      check(
        'corpus: очередь пишет batch-вердикт с лейблом, короткую прозу не пишет (U6 без дублей мусора)',
        fed && !notFed && lines.length === 1 &&
          JSON.parse(lines[0]).slug === 'T4-94' &&
          JSON.parse(lines[0]).verdict === 'keep' &&
          JSON.parse(lines[0]).source === 'author-batch'
      )
    }

    // RAW+ генератор (кины в конвейер, закон №3 + A5: hair/eye E3, echo F13)
    {
      const { planRawPlus } = await import('./tools/gen-rawplus')
      const law2 = getPolicy().law
      const demo = { slug: 'T4-98', theme: 'SELFTEST RAW+ KIN ECHO', seed: 4242, windowSlugs: ['T4-27'], ocAppearances: {} as Record<string, number> }
      const p1 = planRawPlus(demo)
      const expDemo = p1.slots.filter((s) => s.kind === 'EXP')
      const thematic = p1.slots.filter((s) => s.kind !== 'EXP')
      check(
        `gen-rawplus: ${law2.slotsTotal} слотов по закону (${law2.ocSlots} OC + ${law2.mainsTotal} мейн) + EXP-оверлей`,
        thematic.length === law2.slotsTotal &&
          thematic.slice(0, law2.ocSlots).every((s) => s.kind === 'OC')
      )
      check(
        'gen-rawplus: EXP-оверлей — 2 A/B-болванки №27 по умолчанию (вердикт T4-28 «не забывай про EXP промпты»)',
        expDemo.length === 2 &&
          expDemo.every((s) => s.rating === 'R+' && s.exp && s.fabricTone) &&
          expDemo[0].fabricTone === 'light' &&
          expDemo[1].fabricTone === 'dark' &&
          expDemo[0].exp?.half === 'A' &&
          expDemo[1].exp?.half === 'B' &&
          expDemo[0].exp?.pairWith === expDemo[1].position &&
          expDemo[0].hair === expDemo[1].hair
      )
      check(
        'gen-rawplus: спред мейнов из policy (NICHE R ×7 + R+ мейны ×14) — EXP отдельно',
        p1.slots.filter((s) => s.kind === 'NICHE').length === law2.nicheCount &&
          p1.slots.filter((s) => s.kind !== 'OC' && s.kind !== 'EXP' && s.rating === 'R+').length === law2.rplusMains
      )
      const kinSlots = p1.slots.filter((s) => s.race)
      check(
        `gen-rawplus: расовый каст ${law2.racialDefault} на мейнах — уникальные расы, POS+anti-shield NEG у каждой`,
        kinSlots.length === law2.racialDefault &&
          new Set(kinSlots.map((s) => s.race)).size === kinSlots.length &&
          kinSlots.every((s) => (s.kinPos ?? '').length > 0 && (s.kinNeg ?? '').length > 0) &&
          kinSlots.every((s) => s.position > law2.ocSlots)
      )
      /* Приказ автора 2026-10-17 («ты опять запихнул Люси на первый слот —
       * где ротация ОС»): кулдаун-окно ОС в генераторе RAW+. T4-30..34
       * шли путём --from-draft без окна (куулдаун жил только в компиляторе)
       * + счётчик Люси отставал на 1 (T4-32 без oc.appeared) — она
       * держала P01 пять батчей подряд. Инвариант: ОС последних 2 батчей
       * окна не попадают в тройку, счётчик на это не влияет. */
      {
        const p2 = planRawPlus({
          slug: 'T4-97',
          theme: 'SELFTEST OC COOLDOWN',
          seed: 777,
          windowSlugs: ['T4-95', 'T4-96'],
          ocAppearances: { Lucy: 0, Noa: 0, Yui: 0 },
          ocLastSeen: { Lucy: 'T4-95', Noa: 'T4-96' },
        })
        const ocNames2 = p2.slots.filter((s) => s.kind === 'OC').map((s) => s.oc as string)
        check(
          'gen-rawplus: OC-кулдаун — ОС последних 2 батчей вне тройки даже при нулевом served (приказ 2026-10-17 «где ротация ОС»)',
          ocNames2.length === law2.ocSlots &&
            !ocNames2.includes('Lucy') &&
            !ocNames2.includes('Noa') &&
            p2.report.some((r) => r.includes('OC-кулдаун'))
        )
      }
      /* Инцидент «Доу на P01 × 3» (2026-10-18): каскад компиляций. Память
       * ротации (served/lastSeen) двигается ТОЛЬКО сдачей (oc.appeared на
       * deliver), а сборки идут чаще сдач — подряд собранные батчи получали
       * одну и ту же ОС на первом слоте (строгий минимум served
       * детерминирован, шаффл его не двигает). Инвариант: ростер новейшей
       * НЕсданной компиляции исключается из тройки даже при нулевом served. */
      {
        const p3 = planRawPlus({
          slug: 'T4-98',
          theme: 'SELFTEST OC CASCADE',
          seed: 778,
          windowSlugs: ['T4-95', 'T4-96'],
          ocAppearances: { Doe: 0, Noa: 0, Yui: 0 },
          ocLastSeen: {},
          recentCompiledOcs: ['Doe', 'Noa', 'Yui'],
        })
        const ocNames3 = p3.slots.filter((s) => s.kind === 'OC').map((s) => s.oc as string)
        check(
          'gen-rawplus: OC-каскад — ростер новейшей несданной компиляции вне тройки даже при нулевом served (инцидент «Доу на P01 × 3»)',
          ocNames3.length === law2.ocSlots &&
            !ocNames3.includes('Doe') &&
            !ocNames3.includes('Noa') &&
            !ocNames3.includes('Yui') &&
            p3.report.some((r) => r.includes('OC-каскад'))
        )
        /* деградация: каскад не имеет права завалить сборку — пул < нужного
         * снимает уровень (17 активных ОС из 20 исключить нельзя) */
        const p4 = planRawPlus({
          slug: 'T4-99',
          theme: 'SELFTEST OC CASCADE DEGRADE',
          seed: 779,
          windowSlugs: [],
          ocAppearances: {},
          ocLastSeen: {},
          recentCompiledOcs: Object.keys((await import('../src/lib/t4/specs')).getOCCanon()?.ocs ?? {}),
        })
        const ocNames4 = p4.slots.filter((s) => s.kind === 'OC').map((s) => s.oc as string)
        check(
          'gen-rawplus: OC-каскад деградирует честно — весь канон в ростере всё равно даёт тройку (сборку не завалить)',
          ocNames4.length === law2.ocSlots
        )
      }
      /* Живой инвариант компилятора: если на диске есть несданная компиляция
       * с ростером — сухой прогон обязан исключить её тройку (это и есть
       * лекарство от «Доу × 3» в API-пути). Пропускается, когда таких нет
       * (все сдано/закрыто) — инвариант про состояние, а не про дату. */
      {
        const liveRoster = lastCompiledRoster(foldState(readEvents()))
        if (liveRoster == null) {
          check('compiler: OC-каскад живой — n/a (нет несданных компиляций с ростером)', true)
        } else {
          const cx = compileBatch(`selftest-каскад-${liveRoster.slug}`, {
            dryRun: true,
          })
          const trio = cx.slots.filter((s) => s.kind === 'OC').map((s) => s.oc as string)
          check(
            `compiler: OC-каскад живой — ростер ${liveRoster.slug} (${liveRoster.ocs.join(', ')}) вне тройки сухого прогона`,
            trio.length === 3 && trio.every((n) => !liveRoster.ocs.includes(n))
          )
          check(
            'compiler: OC-каскад в контракте — ocCascade несёт источник и исключённых',
            cx.ocCascade?.from === liveRoster.slug &&
              JSON.stringify(cx.ocCascade.excluded) === JSON.stringify(liveRoster.ocs)
          )
        }
      }
      /* A3P5-двери (ревизия 2026-10-14): 15 дверей + 6 операторов из легаси
       * (legacy/a3/A3P5_Core.txt:20 + QUICK REFERENCE) — NICHE-слот несёт
       * дверь (момент входа в кадр) и оператора камеры (ракурс) ротацией */
      {
        const { getNicheDoors } = await import('../src/lib/t4/specs')
        const doorsSpec = getNicheDoors()
        const doors = p1.slots.filter((s) => s.door).map((s) => s.door)
        const spatials = p1.slots.filter((s) => s.spatial).map((s) => s.spatial)
        const nicheCount = p1.slots.filter((s) => s.kind === 'NICHE').length
        check(
          'A3P5: спека дверей — 15 дверей + 6 операторов (последний непереплавленный кусок A3 в конвейере)',
          (doorsSpec?.doors.length ?? 0) === 15 && (doorsSpec?.operators.length ?? 0) === 6
        )
        check(
          'A3P5: каждый NICHE-слот несёт дверь и оператора камеры, двери без повторов',
          doors.length === nicheCount && spatials.length === nicheCount &&
            new Set(doors).size === doors.length &&
            doors.every((d) => (doorsSpec?.doors ?? []).some((x) => x.name === d))
        )
      }
      const c27 = JSON.parse(
        (await import('node:fs')).readFileSync('thread4/contracts/T4-27.json', 'utf-8')
      ) as { slots: { palette?: string }[] }
      const windowPals = new Set(c27.slots.map((s) => s.palette).filter(Boolean))
      /* EXP-пары одной переменной делят палитру (закон №27-эксперимент):
       * уникальность — внутри мейнов; пара — сознательное клонирование */
      const expPalettes = p1.slots.filter((s) => s.kind === 'EXP').map((s) => s.palette)
      check(
        'gen-rawplus: 24 уникальные палитры мейнов + EXP-пары делят одну на пару, ни одна в окне ротации (T4-27 исключён)',
        new Set(p1.slots.filter((s) => s.kind !== 'EXP').map((s) => s.palette)).size === law2.slotsTotal &&
          (expPalettes.length === 0 || new Set(expPalettes).size === expPalettes.length / 2) &&
          p1.slots.every((s) => !windowPals.has(s.palette))
      )
      const mains = p1.slots.filter((s) => s.kind !== 'OC' && s.kind !== 'EXP')
      check(
        'gen-rawplus: hair анти-дрейф соседей + 12+ различных на мейнах (E3; EXP-пара — одна девка, вне проверки)',
        mains.every((s, i) => i === 0 || s.hair !== mains[i - 1].hair) &&
          new Set(mains.map((s) => s.hair)).size >= 12
      )
      const toneCounts = {
        dark: thematic.filter((s) => s.rating === 'R+' && s.fabricTone === 'dark').length,
        mid: thematic.filter((s) => s.rating === 'R+' && s.fabricTone === 'mid').length,
        light: thematic.filter((s) => s.rating === 'R+' && s.fabricTone === 'light').length,
      }
      check(
        `gen-rawplus: закон №27 — тон вещи на R+-слотах: dark ≥1/3 (${toneCounts.dark}), светлых ≤3 (${toneCounts.light}), все R+ имеют тон`,
        thematic.filter((s) => s.rating === 'R+').every((s) => s.fabricTone) &&
          toneCounts.dark >= Math.ceil(thematic.filter((s) => s.rating === 'R+').length / 3) &&
          toneCounts.light <= 3
      )
      check(
        'gen-rawplus: OC несут канон hair/eyes (канон старше библиотеки)',
        p1.slots.slice(0, law2.ocSlots).every((s) => s.hairEyeFrom === 'canon' && s.hair.length > 0 && s.eyes.length > 0)
      )
      check(
        'gen-rawplus: echo-мотивы 2-3, арка 3 явки, мутация 1 spatial + 1 narrative/atmospheric (F13)',
        p1.echoMotifs.length >= 2 && p1.echoMotifs.length <= 3 &&
          p1.echoMotifs.every(
            (m) => m.appearances.length === 3 && m.appearances.every((a) => a.mutation.length === 2)
          )
      )
      const { getCarriers: gc } = await import('../src/lib/t4/specs')
      const cs = gc()
      const mechOf = (cls: string) => cs?.class_defs?.[cls]?.mech ?? '?'
      check(
        `gen-rawplus: стеки core-4 — ${law2.core4Groups} мех-группы на каждом слоте`,
        p1.slots.every((s) => {
          const g = new Set(s.carriers.map((c) => mechOf(c.cls)))
          return s.carriers.length >= law2.core4Groups && g.size >= law2.core4Groups
        })
      )
      const p2 = planRawPlus(demo)
      check('gen-rawplus: детерминизм (тот же сид → тот же план)', JSON.stringify(p1.slots) === JSON.stringify(p2.slots))
      /* бриф автора из UI (draft → контракт, §10): виды списком, OC-темы,
       * abPairs, rehab — квитанции компиляции брифа */
      const draftBrief = {
        slug: 'T4-98',
        theme: 'SELFTEST DRAFT BRIEF',
        ocThemes: [{ theme: 'Draft Theme One', rating: 'R+', position: 1 }],
        mainWishes: 'проверка брифа: круто и ещё круче',
        species: { on: true, count: 2, list: ['R02', 'R06'] },
        xSlots: 0,
        abPairs: 3,
        rehab: true,
        engine: 'per-theme',
      }
      const p3 = planRawPlus({ ...demo, draft: draftBrief })
      const kin3 = p3.slots.filter((s) => s.race)
      check(
        'gen-rawplus: бриф — виды ТОЧНО списком автора (§10), не ротацией пула',
        kin3.length === 2 &&
          new Set(kin3.map((s) => s.raceId)).size === 2 &&
          kin3.every((s) => ['R02', 'R06'].includes(s.raceId ?? ''))
      )
      const oc1 = p3.slots[0]
      check(
        'gen-rawplus: бриф — OC-тема по позиции + рейтинг из брифа',
        (oc1.ocTheme ?? '').includes('Draft Theme One') && oc1.rating === 'R+'
      )
      const c3 = p3.contract as { authorWishes?: string; abPairs: { a: number; b: number }[] }
      check(
        'gen-rawplus: бриф — пожелания автора едут в контракт (authorWishes)',
        (c3.authorWishes ?? '').includes('круче')
      )
      check(
        'gen-rawplus: бриф — abPairs по счёту брифа, стек пар = одна замена носителя',
        c3.abPairs.length === 3 &&
          c3.abPairs.every((p) => {
            const sa = p3.slots.find((s) => s.position === p.a)
            const sb = p3.slots.find((s) => s.position === p.b)
            if (!sa || !sb) return false
            const d = new Set([...sa.carriers.map((x) => x.id), ...sb.carriers.map((x) => x.id)])
            const inter = sa.carriers.filter((x) => sb.carriers.some((y) => y.id === x.id)).length
            return d.size === sa.carriers.length + 1 && inter === sa.carriers.length - 1
          })
      )
      check(
        'gen-rawplus: бриф — rehab несёт конфиг оживления (Залп 3)',
        p3.slots.some((s) => s.targetChannel && (s.targetChannelNote ?? '').length > 0)
      )
      check(
        'gen-rawplus: спайн полон — позы PL/лиды/клоузеры/регистры назначены (не болванки)',
        p3.slots.every((s) => /^PL\d+$/.test(s.pose)) &&
          p3.slots.every((s) => s.lead.length > 0) &&
          p3.slots.every((s) => s.closer.length > 0) &&
          p3.slots.filter((s) => s.kind === 'NICHE').every((s) => (s.arch ?? '').length > 0 && (s.witness ?? '').length > 0)
      )
      check(
        'gen-rawplus: регистры мейнов третями (student/young/milf — N30 формой, не тегами; EXP-болванки вне закона)',
        ['student', 'young', 'milf'].every((r) => p3.slots.filter((s) => s.kind !== 'EXP' && s.register === r).length === 7)
      )
      /* ULTIMATE DICE (A5P6 §3 → RAW-эра): 5 костей, сигнатуры уникальны
       * в батче, межбатчевая дисциплина через dice-archive */
      const diceSigs = p3.slots.map((s) => s.diceSig ?? '').filter(Boolean)
      check(
        'dice: каждый слот несёт сигнатуру скелета (A·B·C·D·E) — 24 закона + EXP-болванки',
        diceSigs.length === p3.slots.length && diceSigs.every((s) => /^[A-E]\d·[A-E]\d·[A-E]\d·[A-E]\d·[A-E]\d$/.test(s))
      )
      check(
        'dice: скелеты уникальны в батче — два слота не делят структуру (клонируют только EXP-пары одной переменной)',
        new Set(diceSigs).size === p3.slots.length - Math.floor(p3.slots.filter((s) => s.kind === 'EXP').length / 2)
      )
      check(
        'dice: инструкции кубиков едут в контракт (писец обязывается)',
        p3.slots.every((s) => (s.dice ?? '').length > 40)
      )
      const { rollBatch: rb, usedSignatures } = await import('./tools/dice')
      const usedBefore = usedSignatures()
      const rollA = rb(777, [1, 2, 3, 4, 5, 6], { avoidArchive: true })
      const freshSigs = [...rollA.signatures.values()].filter((s) => !usedBefore.has(s))
      check(
        'dice: межбатчевая дисциплина — новый бросок обходит архив сигнатур',
        freshSigs.length === 6
      )
      const rollB = rb(777, [1, 2, 3, 4, 5, 6], { avoidArchive: true })
      check('dice: детерминизм (тот же сид → тот же бросок)', JSON.stringify([...rollA.signatures.values()]) === JSON.stringify([...rollB.signatures.values()]))
    }

    // Концепт-валидатор стеков (ULTIMATE DICE §44 из архива A5 → RAW-эра)
    {
      const { buildReport } = await import('./tools/stack-report')
      const r272 = buildReport('T4-27.2-EXP', 8)
      check(
        'stack-report: история = 8 батчей ПОСЛЕДНЕЙ сдачи, ретро-аудит только по прошлому (T4-27 в хвосте)',
        r272.history.length === 8 && r272.history.at(-1) === 'T4-27' && !r272.history.includes('T4-27.2-EXP')
      )
      check(
        'stack-report: полные повторы концепта (поза+палитра+стек) вне rebuildOf — 0 у T4-27.2-EXP',
        r272.repeats.length === 0
      )
      check(
        'stack-report: переиспользование источника ребилда помечено, не считается грехом (33 стека из T4-27)',
        r272.rebuildReuse.length === 33 && r272.rebuildReuse.every((x) => x.from.every((a) => a.slug === 'T4-27'))
      )
      check(
        'stack-report: дубли формул внутри батча распознают A/B-пары (одна переменная — закон №12)',
        r272.inBatchDuplicates.length === 3 && r272.inBatchDuplicates.every((d) => d.abPair)
      )
      check(
        'stack-report: возвраты палитр из-за окна несут мутацию стека (§56D: ≥1 ось на возврате)',
        r272.paletteReturns.length === 22 &&
          r272.paletteReturns.every((p) => p.carriersMutated && !p.inWindow)
      )
      check(
        'stack-report: носители-любимцы считаются по истории (топ ≥ 2 использований)',
        (r272.carrierFavorites[0]?.uses ?? 0) >= 2
      )
      const r26 = buildReport('T4-26', 8)
      check(
        'stack-report: алиас T4-18→T4-17 вернул переименованный батч в историю осей (ISSUE 17) — призрачного слага нет',
        r26.history.includes('T4-17') && !r26.history.includes('T4-18') && !r26.skipped.includes('T4-18')
      )
      check(
        'stack-report: RAW-поворот честен — T4-26 без палитр (0 с палитрой), стеки на месте (33)',
        r26.coverage.withPalette === 0 && r26.coverage.withStack === 33
      )
    }

    // Порт fred-legacy (2026-10-12): парсер .md-батчей + диффы + триал-разбор
    {
      const { parseBatchMd, diffTokens, extractTrialLaws, extractHypotheses, buildDiffMarkdown, buildTrialRadarMarkdown, stackIds } = await import('../src/lib/t4/batch-md')
      const { readText } = await import('../src/lib/t4/fsutil')
      const path = await import('node:path')
      const md27 = readText(path.join('thread4', 'batches', 'T4-27.md')) ?? ''
      const md272 = readText(path.join('thread4', 'batches', 'T4-27.2-EXP.md')) ?? ''
      const p27 = parseBatchMd(md27)
      const p272 = parseBatchMd(md272)
      check('batch-md: T4-27 парсится — 33 слота, шапка на месте', p27 != null && p27.slots.length === 33 && p27.title.includes('T4-27'))
      check('batch-md: T4-27.2-EXP парсится — 33 слота, перестройка', p272 != null && p272.slots.length === 33 && p272.title.includes('BODY-SPECTRUM'))
      check(
        'batch-md: мета эры RAW+ — kind/rating/палитра из скобки (P01 T4-27)',
        p27?.slots[0]?.kind === 'OC' && p27?.slots[0]?.palette.startsWith('P') === true && p27?.slots[0]?.pos.length > 0
      )
      check(
        'batch-md: эра прозы — PL-позы и R+/R на месте (T4-08)',
        (() => {
          const md08 = readText(path.join('thread4', 'batches', 'T4-08.md'))
          const p08 = md08 ? parseBatchMd(md08) : null
          return p08 != null && p08.slots.length === 24 && p08.slots.some((s) => s.pose.startsWith('PL'))
        })()
      )
      check(
        'batch-md: токен-дифф — общее/добавлено/убрано считаются точно (разделитель — запятая)',
        (() => {
          const d = diffTokens('a, b, c, d', 'a, c, d, e')
          return d.kept.join(',') === 'a,c,d' && d.added.join(',') === 'e' && d.removed.join(',') === 'b'
        })()
      )
      check(
        'batch-md: скобко-осознанный дифф не режет составные теги (запятая внутри скобок)',
        (() => {
          const d = diffTokens('cecaelia (upper), tail', 'cecaelia (upper), fins')
          return d.kept.join(',') === 'cecaelia (upper)' && d.added.join(',') === 'fins' && d.removed.join(',') === 'tail'
        })()
      )
      const laws27 = extractTrialLaws(md27)
      const h27 = extractHypotheses(md27, p27!)
      const h272 = extractHypotheses(md272, p272!)
      check('batch-md: законы TRIAL-3 из T4-27 — 6 (M15-M20)', laws27.length === 6 && laws27[0]?.id === 'M15' && laws27[5]?.id === 'M20')
      check(
        'batch-md: EXP-гипотезы T4-27 — пары κ/λ/μ + одиночки ν/ξ/ρ (грек-lookahead, не \\b)',
        h27.filter((x) => x.kind === 'pair').length === 3 && h27.filter((x) => x.kind === 'single').length === 3 && h27.some((x) => x.greek === 'κ' && x.a && x.b)
      )
      check(
        'batch-md: ⚗ осознанные нарушители распознаются в EXP-половинках (λ-B, μ-B)',
        (() => {
          const lam = h272.find((x) => x.greek === 'λ') ?? h27.find((x) => x.greek === 'λ')
          const mu = h272.find((x) => x.greek === 'μ') ?? h27.find((x) => x.greek === 'μ')
          return Boolean(lam?.b?.alchemy) && Boolean(mu?.b?.alchemy)
        })()
      )
      check(
        'batch-md: дифф перестройки — POS +116 тегов в T4-27.2-EXP (тело против дефолта)',
        (() => {
          let add = 0
          for (const b of p272!.slots) {
            const a = p27!.slots.find((s) => s.id === b.id)
            add += diffTokens(a?.pos ?? '', b.pos).added.length
          }
          return add === 116
        })()
      )
      const diffMd = buildDiffMarkdown('T4-27', 'T4-27.2-EXP', p27!, p272!)
      check('batch-md: дифф-документ пары — обе шапки + статистика POS', diffMd.includes('# THREAD 4 · дифф перестройки') && diffMd.includes('T4-27.2-EXP') && diffMd.includes('POS +'))
      const trialMd = buildTrialRadarMarkdown({ slug: 'T4-27', title: p27!.title, laws: laws27, hypos: h27, rendered: [], verdictRecord: false })
      check('batch-md: сводка триала — шапка + законы + гипотезы', trialMd.includes('сводка триала') && trialMd.includes('M15') && trialMd.includes('κ'))
      check(
        'batch-md: стеки читаются из Stack-секции (core-4)',
        (() => {
          const withStack = p27?.slots.filter((s) => s.stack.length > 0) ?? []
          return withStack.length >= 30 && stackIds(withStack[0].stack).length >= 2
        })()
      )
      /* Вердикт T4-34 («в рендере законов пишет, что в батче нет ехп
       * слотов»): полный греческий ряд радара + восстановление программы
       * из контракта + механическая чистота болванок (три слоя защиты). */
      const md31 = readText(path.join('thread4', 'batches', 'T4-31.md')) ?? ''
      const md34 = readText(path.join('thread4', 'batches', 'T4-34.md')) ?? ''
      const p31 = parseBatchMd(md31)
      const p34 = parseBatchMd(md34)
      const { contractExpProgram, stripThemeTokens } = await import('../src/lib/t4/batch-md')
      const fsMod = await import('node:fs')
      const c34Exp = contractExpProgram(
        JSON.parse(fsMod.readFileSync('thread4/contracts/T4-34.json', 'utf-8'))
      )
      check(
        'batch-md: σ-пара T4-31 читается радаром (греческий ряд полный, не κλμνξρ)',
        (() => {
          const h31 = extractHypotheses(md31, p31!)
          const sigma = h31.find((h) => h.greek === 'σ')
          return Boolean(sigma && sigma.kind === 'pair' && sigma.a && sigma.b && sigma.lawNo === '27')
        })()
      )
      check(
        'batch-md: σ-пара T4-34 (маркер P31 уцелел) — читается без контракта',
        (() => {
          const h34 = extractHypotheses(md34, p34!)
          const sigma = h34.find((h) => h.greek === 'σ')
          return Boolean(sigma && sigma.a && !sigma.a.recovered)
        })()
      )
      check(
        'batch-md: программа T4-34 восстанавливается из контракта — 4 пары (ν ξ ρ σ), потерянные половины помечены ⚑',
        (() => {
          const h34 = extractHypotheses(md34, p34!, c34Exp)
          const greeks = new Set(h34.map((h) => h.greek))
          const sigma = h34.find((h) => h.greek === 'σ')
          return (
            ['ν', 'ξ', 'ρ', 'σ'].every((g) => greeks.has(g)) &&
            h34.filter((h) => h.kind === 'pair').length === 4 &&
            Boolean(sigma?.b?.recovered) &&
            h34.some((h) => h.lawNo === '27')
          )
        })()
      )
      check(
        'batch-md: stripThemeTokens вычищает тему из POS болванки, честные теги живы',
        (() => {
          const polluted =
            'anime style, 1girl, theft-gold-bright sweater, covered nipples, glowing runes, arcane energy, spellcasting, streetlamp_goldslice_hard lighting, masterpiece, best quality, anime artstyle.'
          const clean = stripThemeTokens(polluted, [
            'runes', 'glowing', 'spellcasting', 'energy', 'incantation', 'arcane', 'ethereal', 'magical',
          ])
          return (
            !/runes|glowing|spellcasting|arcane/i.test(clean) &&
            clean.includes('covered nipples') &&
            clean.includes('streetlamp_goldslice_hard') &&
            clean.includes('masterpiece')
          )
        })()
      )
    }

    // Вердикт T4-34: гейт exp-purity ловит загрязнение живого батча
    {
      const g34 = runGates('T4-34', true)
      const ep34 = g34?.receipts.find((r) => r.gate === 'exp-purity')
      const markerFinds = (ep34?.findings ?? []).filter((x) => x.includes('не открывается маркером'))
      const themeFinds = (ep34?.findings ?? []).filter((x) => x.includes('тема-слова в POS'))
      check(
        `exp-purity: T4-34 (сдан до фикса) — гейт видит историю: ${markerFinds.length} потерянных маркеров THESIS, вердикт истины`,
        ep34?.verdict === 'FAIL' && markerFinds.length >= 6
      )
      check(
        `exp-purity: тема-слова в POS болванок T4-34 — ${themeFinds.length} слотов с witchcraft-тегами (то, что видел автор)`,
        themeFinds.length >= 5
      )
      const g27 = runGates('T4-27', true)
      const ep27 = g27?.receipts.find((r) => r.gate === 'exp-purity')
      const markerFinds27 = (ep27?.findings ?? []).filter((x) => x.includes('не открывается маркером'))
      check(
        'exp-purity: канон T4-27 — маркеры гипотез целы (0 потерянных); тема-проза в POS болванок ловится как история («the art of the extraordinary harvest» — та же болезнь, mild-форма)',
        markerFinds27.length === 0 &&
          (ep27?.findings ?? []).every((x) => x.includes('тема-слова')) &&
          (ep27?.findings?.length ?? 0) > 0
      )
    }

    // Аудит 2026-10-12: регрессии целостности летописи и окна ротации
    {
      const mk = (at: string, type: string, data: Record<string, unknown>): T4Event => ({
        id: at.replace(/[^0-9]/g, ''),
        at,
        type,
        summary: type,
        data,
      })
      const st = foldState([
        mk('2026-01-01T00:00:01Z', 'batch.compiled', { slug: 'T4-91', theme: 'a' }),
        mk('2026-01-01T00:00:02Z', 'batch.delivered', { slug: 'T4-91' }),
        mk('2026-01-01T00:00:03Z', 'batch.compiled', { slug: 'T4-92', theme: 'b' }),
        mk('2026-01-01T00:00:04Z', 'batch.delivered', { slug: 'T4-92' }),
        mk('2026-01-01T00:00:05Z', 'batch.void', { slug: 'T4-91' }),
        mk('2026-01-01T00:00:06Z', 'batch.compiled', { slug: 'T4-93', theme: 'c' }),
        mk('2026-01-01T00:00:07Z', 'batch.delivered', { slug: 'T4-93' }),
      ])
      check(
        'окно ротации: void-батч покидает окно (заявлено в cli void — консистентность fold)',
        !st.windowSlugs.includes('T4-91') && st.windowSlugs.join(',') === 'T4-92,T4-93'
      )
      /* ISSUE 17 / #49: алиас слага (физическое переименование T4-18→T4-17
       * 2026-10-02 без машинного события оставил state с призрачным delivered
       * под старым слагом при физическом новом .md). Сценарий: дубль под
       * T4-95 воидится, настоящий батч сдаётся как T4-96, переименовывается
       * в T4-95 — fold обязан показать delivered T4-95, дубль из voided уйти. */
      const st2 = foldState([
        mk('2026-01-02T00:00:01Z', 'batch.compiled', { slug: 'T4-95', theme: 'dubl' }),
        mk('2026-01-02T00:00:02Z', 'batch.void', { slug: 'T4-95' }),
        mk('2026-01-02T00:00:03Z', 'batch.compiled', { slug: 'T4-96', theme: 'real' }),
        mk('2026-01-02T00:00:04Z', 'batch.delivered', { slug: 'T4-96' }),
        mk('2026-01-02T00:00:05Z', 'note', { kind: 'slug-alias', oldSlug: 'T4-96', newSlug: 'T4-95', replaces: 'voided-dubl' }),
      ])
      check(
        'алиас слага: delivered переезжает под новый слаг, призрачного старого нет (ISSUE 17)',
        st2.batches.some((b) => b.slug === 'T4-95' && b.deliveredAt != null) &&
          !st2.batches.some((b) => b.slug === 'T4-96')
      )
      check(
        'алиас слага: void ЗАМЕНЯЕМОГО дубля не хоронит переименованный батч (ISSUE 17)',
        st2.windowSlugs.includes('T4-95') && !st2.voidedSlugs.includes('T4-95')
      )
      check(
        'нумерация: авто-номер идёт max+1 — void не забивает очередь, рекомпиляция void-слага легальна (вердикт автора 2026-10-20)',
        nextBatchNumber(st.batches) === 94
      )
      check('нумерация: чистый лист стартует с T4-01', nextBatchNumber([]) === 1)
      /* Ревизия 2026-10-14 (3.8/3.13): Стекло считает гейты из летописи,
       * не из легенды — receipts последнего gate.run единственный источник */
      {
        const { gatesHealthFromEvents } = await import('../src/lib/t4/gates')
        const gh = gatesHealthFromEvents([
          mk('2026-01-03T00:00:01Z', 'gate.run', {
            slug: 'T4-91',
            run: 1,
            hardPass: false,
            receipts: [
              { gate: 'structure', level: 'hard', verdict: 'FAIL' },
              { gate: 'raw-plus', level: 'hard', verdict: 'PASS' },
              { gate: 'simcheck', level: 'warn', verdict: 'WARN' },
              { gate: 'freq-report', level: 'advisory', verdict: 'REPORT' },
            ],
          }),
        ])
        check(
          'gateHealth: из receipts последнего прогона — hard/warn/advisory/условные/база считаются (3.8)',
          gh.hard === 1 && gh.warn === 1 && gh.advisory === 1 && gh.conditional === 1 &&
            gh.base === 3 && gh.runTotal === 4 && gh.lastRun?.slug === 'T4-91' &&
            gh.lastRun.hardPass === false
        )
        check(
          'gateHealth: прогонов нет — фолбэк на кодовую базу GATES_TOTAL (не ноль, не легенда; аудит Rust-эры → 30)',
          gatesHealthFromEvents([]).base === 30 && gatesHealthFromEvents([]).lastRun === null
        )
      }
      const { isSafeSlug } = await import('../src/lib/t4/fsutil')
      check(
        'slug-гвард: легальные слаги T4-29 / T4-27.2-EXP проходят, ../ и абсолютные пути — нет',
        isSafeSlug('T4-29') && isSafeSlug('T4-27.2-EXP') &&
        !isSafeSlug('../etc/passwd') && !isSafeSlug('/etc/passwd') && !isSafeSlug('T4-..') && !isSafeSlug('T4-a/b')
      )
      /* аудит 2026-10-12: многострочные POS/NEG раньше тихо обрезались до
       * первой строки (lookahead \n[^ \n]) — гейты судили по неполным данным */
      const pbMulti = parseBatch(
        'T4-98',
        '# T4-98 — тест\n\nP01 — anchor (NICHE · R · PL01 · P01_TEST)\nTHESIS: t\nPOS:\ntag1, tag2\ntag3, tag4\nNEG:\nbad1\nbad2\n'
      )
      check(
        'parseBatch: многострочный POS/NEG не теряет хвост (floors видит 2-ю строку)',
        pbMulti.slots.length === 1 &&
          pbMulti.slots[0].pos.includes('tag3') &&
          pbMulti.slots[0].pos.includes('tag4') &&
          pbMulti.slots[0].neg.includes('bad2')
      )
      check(
        'parseBatch: однострочный формат писца парсится как раньше (без регрессии)',
        (() => {
          const p = parseBatch(
            'T4-99',
            '# T4-99 — тест\n\nP01 — anchor (NICHE · R · PL01 · P01_TEST)\nTHESIS: t\nPOS:\n\none, two, three\n\nNEG:\n\nno-four, no-five\n'
          )
          return p.slots.length === 1 && p.slots[0].pos === 'one, two, three' && p.slots[0].neg === 'no-four, no-five'
        })()
      )
      /* Аудит 2026-10-17 «двойной парсер»: гейты и радар читают ОДИН разбор
       * (parseBatch — адаптер над parseBatchMd). Инварианты на живом классе
       * бага: 55 NEG с мусором (═══/ACT/EXP OVERLAY/---) и 33 THESIS,
       * обрезанных до первой строки. */
      {
        const { parseBatchMd } = await import('../src/lib/t4/batch-md')
        const dirty = [
          '# T4-97 — тест',
          '',
          'P01 — anchor-one (NICHE · R · PL01 · P01_TEST_X)',
          'THESIS: первая строка тезиса',
          'вторая строка тезиса — гейты обязаны видеть её целиком',
          'POS:',
          'tag1, tag2',
          'NEG:',
          'bad1, bad2',
          '══════════════════════════════════════════',
          'ACT II — THE LAW WORN IN',
          '══════════════════════════════════════════',
          '',
          'P02 — anchor-two (EXP · — · R+ · PL02 · P02_TEST_Y)',
          'THESIS: EXP σ-A · гипотеза пары',
          'POS:',
          'plain, pose, only',
          'NEG:',
          'boring, neg',
          '══════════════════════════════════════════',
          'EXP OVERLAY — 2 болванки (без темы; policy expSlotsMax)',
          '══════════════════════════════════════════',
          '---',
        ].join('\n')
        const g = parseBatch('T4-97', dirty)
        const b = parseBatchMd(dirty)
        const g1 = g.slots.find((s) => s.position === 1)
        const g2 = g.slots.find((s) => s.position === 2)
        const b1 = b?.slots.find((s) => s.id === 'P01')
        const b2 = b?.slots.find((s) => s.id === 'P02')
        check(
          'одна правда: NEG гейтов не несёт структурный мусор (═══/ACT/EXP OVERLAY/---) — 55 слотов живой истории',
          Boolean(g1 && g2) &&
            !/═|ACT\s+[IVX]+\b|EXP OVERLAY|---/.test(g1!.neg) &&
            !/═|ACT\s+[IVX]+\b|EXP OVERLAY|---/.test(g2!.neg) &&
            !/═|ACT\s+[IVX]+\b|EXP OVERLAY|---/.test(g2!.pos)
        )
        check(
          'одна правда: POS/NEG/THESIS гейтов == радару (parseBatch ≡ parseBatchMd, слот к слоту)',
          Boolean(b1 && b2) &&
            g1!.pos === b1!.pos && g1!.neg === b1!.neg && g1!.thesis === b1!.thesis &&
            g2!.pos === b2!.pos && g2!.neg === b2!.neg && g2!.thesis === b2!.thesis
        )
        check(
          'одна правда: многострочный THESIS не обрезается до первой строки (33 слота живой истории)',
          g1 != null && g1.thesis.includes('вторая строка тезиса')
        )
        check(
          'одна правда: шапка слота сохранена сырьём (rawHeader) — маркеры ⚗/PL##/палитры читаются гейтами как раньше',
          g2 != null && g2.header.includes('(EXP ·') && /PL02/.test(g2.header) &&
            g1 != null && /P01_TEST_X/.test(g1.header) && g1.meta === 'NICHE · R · PL01 · P01_TEST_X'
        )
      }
    }

    /* ---- Задача 1 «МОЩНОСТЬ»: писец-автоматизация (mock-API, без сети) ---- */
    {
      /* резолвер провайдера: дефолт zai, конфиг-ошибки — понятные,
       * с именем переменной окружения (хардкод ключей запрещён) */
      const zaiDefault = resolveLlmProvider({})
      check('llm-provider: дефолт zai без ключа (T4_SCRIBE_PROVIDER не задан)', zaiDefault.name === 'zai')
      let msgKey = ''
      try { resolveLlmProvider({ T4_SCRIBE_PROVIDER: 'openai' }) } catch (e) { msgKey = (e as Error).message }
      check('llm-provider: openai без ключа — понятная ошибка с именем переменной', msgKey.includes('T4_SCRIBE_API_KEY'))
      let msgModel = ''
      try { resolveLlmProvider({ T4_SCRIBE_PROVIDER: 'openai', T4_SCRIBE_API_KEY: 'k' }) } catch (e) { msgModel = (e as Error).message }
      check('llm-provider: openai без модели — ошибка называет T4_SCRIBE_MODEL', msgModel.includes('T4_SCRIBE_MODEL'))
      const openai = resolveLlmProvider({ T4_SCRIBE_PROVIDER: 'openai', T4_SCRIBE_API_KEY: 'k', T4_SCRIBE_MODEL: 'm' })
      check('llm-provider: openai собирается с ключом из env (bearer, не хардкод)', openai.name === 'openai')
      let msgCustom = ''
      try { resolveLlmProvider({ T4_SCRIBE_PROVIDER: 'custom', T4_SCRIBE_MODEL: 'm' }) } catch (e) { msgCustom = (e as Error).message }
      check('llm-provider: custom без эндпоинта — ошибка называет T4_SCRIBE_BASE_URL', msgCustom.includes('T4_SCRIBE_BASE_URL'))
      let msgUnknown = ''
      try { resolveLlmProvider({ T4_SCRIBE_PROVIDER: 'grok' }) } catch (e) { msgUnknown = (e as Error).message }
      check('llm-provider: неизвестный провайдер — перечислены допустимые и переменная', msgUnknown.includes('zai') && msgUnknown.includes('T4_SCRIBE_PROVIDER'))

      /* retry-петля chat(): переходящие сбои ретраятся (максимум retries+1),
       * непереходящие падают сразу без траты кругов — mock-API, сеть не трогаем */
      const attempts: number[] = []
      const flaky: LlmProvider = {
        name: 'mock-flaky',
        complete: async (_s, _u, opts) => {
          attempts.push(opts.attempt)
          if (opts.attempt < 2) throw new Error('HTTP 429 от mock — переходящий')
          return 'ok-content'
        },
      }
      const chatLog: string[] = []
      const chatOut = await chat(flaky, 'sys', 'usr', chatLog, 2)
      check('chat(): переходящий 429 ретраится — успех на 3-й попытке', chatOut === 'ok-content' && attempts.length === 3)
      check('chat(): ретрай логируется с именем провайдера и номером попытки', chatLog.some((l) => l.includes('mock-flaky') && l.includes('1/3')))

      let hardErr = ''
      let hardCalls = 0
      const hard: LlmProvider = {
        name: 'mock-hard',
        complete: async () => {
          hardCalls++
          throw new Error('LLM-провайдер «openai»: T4_SCRIBE_API_KEY не задан')
        },
      }
      try { await chat(hard, 's', 'u', [], 2) } catch (e) { hardErr = (e as Error).message }
      check('chat(): непереходящая ошибка НЕ ретраится (1 вызов, исходное сообщение)', hardCalls === 1 && hardErr.includes('T4_SCRIBE_API_KEY'))

      /* системный промпт: конституция и вкус читаются с диска при прогоне */
      const sp = systemPrompt()
      check('systemPrompt(): конституция читается с диска (блок-маркеры)', sp.includes('--- CONSTITUTION') && sp.includes('--- END CONSTITUTION'))
      check('systemPrompt(): вкус читается с диска (блок-маркеры + канон-сигналы)', sp.includes('--- TASTE') && sp.includes('--- END TASTE') && sp.includes('CANON'))
      check('systemPrompt(): дистилляция законов на месте (роль писца + формат выдачи)', sp.includes('THE HOUSE SCRIBE') && sp.includes('OUTPUT FORMAT'))
    }

    /* ---- Фаза 2, итерация 2: WRITE-мост (детерминированный адаптер
     *      план движка → богатый контракт). Ядро чистое: синтетический
     *      план T4-43-формы (32 слота: 3 OC + 14 MAIN + 7 NICHE + 8 EXP,
     *      2 A/B-пары) гоняется без диска и без живого движка. ---- */
    {
      const {
        planToContract,
        genreOfPlan,
        nextExpLetterIndex,
        usedExpLettersOfContracts,
      } = await import('../src/lib/t4/write-bridge')
      const { LAWS } = await import('../src/lib/t4/compiler')

      const mkPlan = () => ({
        slug: 'T4-43',
        title: 'Trove of Terror (Halloween theme)',
        theme: 'Trove of Terror (Halloween theme)',
        engine: 'per-theme',
        seed: '531022c766e91bcb',
        sha10: '96a88693e6',
        exp: 8,
        abPairs: 2,
        receipts: [
          { gate: 'structure', level: 'hard', verdict: 'PASS' },
          { gate: 'exp-purity', level: 'hard', verdict: 'PASS' },
          { gate: 'floors', level: 'hard', verdict: 'PASS' },
          { gate: 'window', level: 'hard', verdict: 'PASS' },
          { gate: 'ab-single-variable', level: 'hard', verdict: 'PASS' },
        ],
        slots: [
          { position: 1, kind: 'OC', rating: 'R+', register: 'student', ocTheme: 'Caught changing', paletteId: 'P089' },
          { position: 2, kind: 'OC', rating: 'R+', register: 'young', ocTheme: 'Executioner', paletteId: 'P052' },
          { position: 3, kind: 'OC', rating: 'R+', register: 'milf', ocTheme: 'Tentacles tease', paletteId: 'P074' },
          { position: 4, kind: 'MAIN', rating: 'R+', register: 'young', paletteId: 'P088', ab: { pair: 1, half: 'A' } },
          { position: 5, kind: 'MAIN', rating: 'R+', register: 'young', paletteId: 'P024', ab: { pair: 1, half: 'B' } },
          { position: 6, kind: 'MAIN', rating: 'R+', register: 'student', paletteId: 'P051', ab: { pair: 2, half: 'A' } },
          { position: 7, kind: 'MAIN', rating: 'R+', register: 'student', paletteId: 'P053', ab: { pair: 2, half: 'B' } },
          ...Array.from({ length: 10 }, (_, i) => ({
            position: 8 + i,
            kind: 'MAIN',
            rating: 'R+',
            register: (['milf', 'student', 'young'] as const)[i % 3],
            paletteId: `P0${(17 + i).toString().padStart(2, '0')}`,
          })),
          ...Array.from({ length: 7 }, (_, i) => ({
            position: 18 + i,
            kind: 'NICHE',
            rating: (['R', 'PG-13', 'R', 'PG-13', 'R', 'R+', 'R+'] as const)[i],
            register: (['young', 'student', 'milf', 'young', 'student', 'young', 'milf'] as const)[i],
            paletteId: `P1${(0 + i).toString().padStart(2, '0')}`,
          })),
          ...Array.from({ length: 8 }, (_, i) => ({
            position: 25 + i,
            kind: 'EXP',
            rating: 'R+',
            register: 'student',
            paletteId: `P1${(10 + i).toString().padStart(2, '0')}`,
          })),
        ] as Parameters<typeof planToContract>[0]['slots'],
      })
      const mkState = () => ({
        batches: [],
        windowSlugs: [],
        ocAppearances: {},
        ocLastSeen: {},
        voidedSlugs: [],
      })
      const bridgeOpts = () => ({
        slug: 'T4-43',
        state: mkState(),
        cascade: null,
        usedExpLetters: ['α', 'β'] as string[],
        now: '2026-10-20T12:00:00.000Z',
      })

      const r1 = planToContract(mkPlan(), bridgeOpts())
      const r2 = planToContract(mkPlan(), bridgeOpts())
      const c = r1.contract

      check('мост: детерминизм — тот же план → байт-в-байт тот же контракт', JSON.stringify(r1) === JSON.stringify(r2))
      check('мост: жанры — движковый MAIN → VOLT, OC/NICHE/EXP зеркалятся', genreOfPlan('MAIN') === 'VOLT' && genreOfPlan('NICHE') === 'NICHE' && genreOfPlan('OC') === 'OC' && genreOfPlan('EXP') === 'EXP')
      check('мост: структура — 3 OC + 21 мейн (VOLT+NICHE) + 8 EXP = 24 + оверлей', c.slots.filter((s) => s.kind === 'OC').length === 3 && c.slots.filter((s) => s.kind === 'NICHE').length === 7 && c.slots.filter((s) => s.kind === 'EXP').length === 8 && c.slots.filter((s) => s.kind === 'VOLT').length === 14)
      check('мост: рейтинги — зеркало плана (R+ 27, R 3, PG-13 2)', JSON.stringify(c.spread) === JSON.stringify([{ rating: 'R+', count: 27 }, { rating: 'R', count: 3 }, { rating: 'PG-13', count: 2 }]))
      check('мост: палитры — номера движка резолвятся в полные id спеков (P089 → P89_*)', c.slots[0].palette === 'P89_THRESHOLD_GOLD' && c.slots[0].paletteName !== '' && c.slots.every((s) => /^P\d{1,3}_/.test(s.palette)))
      check('мост: OC-имена назначены из канона (3, активные), темы ОС сохранены дословно', c.slots.slice(0, 3).every((s) => typeof s.oc === 'string' && s.oc !== '') && c.slots[0].ocTheme === 'Caught changing' && c.ocRotation.length === 3)
      check('мост: позы — формат PL, PL01 отставлен, R+ без HIGH-риска', c.slots.every((s) => /^PL\d{2,3}$/.test(s.pose) && s.pose !== 'PL01') && c.slots.filter((s) => s.rating === 'R+').every((s) => s.poseRisk !== 'HIGH'))
      check('мост: стеки — R+ несут core-4 (4 носителя), R/PG-13 — tier-3', c.slots.filter((s) => s.rating === 'R+').every((s) => s.carriers.length === 4) && c.slots.filter((s) => s.rating === 'R' || s.rating === 'PG-13').every((s) => s.carriers.length === 3))
      {
        const sheerIds = new Set(
          (await import('../src/lib/t4/specs')).allCarrierIds(
            JSON.parse(fs.readFileSync('thread4/specs/carriers.json', 'utf-8')) as never
          ).filter((x) => x.sheer_family === true).map((x) => x.id)
        )
        const sheerFrames = c.slots.filter((s) => s.carriers.some((cr) => sheerIds.has(cr.id))).length
        const cap = Math.floor(27 * (LAWS.sheerFrameCapPct / 100))
        check(`мост: sheer-бюджет батча честен (${sheerFrames} ≤ cap ${cap})`, sheerFrames <= cap)
      }
      {
        const p4 = c.slots.find((s) => s.position === 4)!
        const p5 = c.slots.find((s) => s.position === 5)!
        const diff = new Set([...p4.carriers.map((x) => x.id), ...p5.carriers.map((x) => x.id)])
        check('мост: A/B-пара — лид общий, дифф стеков ровно 2 (одна замена носителя)', p4.lead === p5.lead && p4.ab?.pair === p5.ab?.pair && p4.ab?.half === 'A' && p5.ab?.half === 'B' && p4.ab?.withSlot === 5 && p5.ab?.withSlot === 4 && diff.size === p4.carriers.length + 1 && c.abPairs.length === 2 && c.abPairs[0].pair === 'α' && c.abPairs[0].lead === p4.lead)
      }
      {
        const expSlots = c.slots.filter((s) => s.kind === 'EXP')
        const letters = expSlots.map((s) => s.exp?.letter ?? '')
        const greek = 'αβγδεζηθικλμνξοπρστυφχψω'
        check('мост: EXP — буквы продолжают ряд после использованных (α,β → γ..η), без повторов, гипотезы непусты', letters[0] === 'γ' && new Set(letters).size === letters.length && letters.every((l) => greek.includes(l)) && expSlots.every((s) => (s.exp?.hypothesis ?? '').length > 10) && nextExpLetterIndex(['ω']) === 0 && nextExpLetterIndex(['β']) === 2)
        check('мост: EXP-болванка — half A для одиночек (маркер радара EXP γ-A читаем)', expSlots.every((s) => s.exp?.half === undefined || s.exp.half === 'A' || s.exp.half === 'B'))
      }
      check('мост: расовый каст — закону, без human, фича расы несётся', c.racialCount > 0 && c.racialCount <= LAWS.racialDefault && c.slots.every((s) => s.race !== 'human') && c.slots.filter((s) => s.race).every((s) => typeof s.raceFeature === 'string' && s.raceFeature !== ''))
      check('мост: NICHE — witness и arch на каждом нишевом слоте', c.slots.filter((s) => s.kind === 'NICHE').every((s) => typeof s.witness === 'string' && s.witness !== '' && typeof s.arch === 'string' && s.arch !== ''))
      check('мост: провенанс — engineLaw несёт sha10, laws.bridge непуст, OC-каскад не путает пустое состояние', c.engineLaw.includes('96a88693e6') && typeof c.laws.bridge === 'string' && c.laws.bridge.includes('WRITE-мост') && c.ocCascade === undefined)
      check('мост: usedExpLetters из контрактов читаются (машинальный парсер)', usedExpLettersOfContracts([{ slots: [{ exp: { letter: 'κ' } }] }, { slots: [] }]).join(',') === 'κ')
      check('мост: окно пустое → windowSlugs зеркалят state, windowOpaque не пишется', JSON.stringify(c.windowSlugs) === '[]' && c.windowOpaque === undefined)

      let errSlug = ''
      try { planToContract(mkPlan(), { ...bridgeOpts(), slug: 'T4-XX' }) } catch (e) { errSlug = (e as Error).message }
      check('мост: чужой слаг плана — отказ на входе', errSlug.includes('не канонический') || errSlug.includes('≠ заказанному'))
      let errPalette = ''
      try {
        const bad = mkPlan()
        bad.slots[0] = { ...bad.slots[0], paletteId: 'P999_NOPE' }
        planToContract(bad, bridgeOpts())
      } catch (e) { errPalette = (e as Error).message }
      check('мост: палитра плана вне фонда — отказ с позицией слота', errPalette.includes('P01') && errPalette.includes('P999_NOPE'))
    }

    /* ============ Фаза 2, итерация 3: СОЗНАНИЕ — ЖИВОЙ ДВИЖОК ============
     * Ядро сознания — чистые функции (selftest без сети); живой паритет
     * прод-цепи доказывает tools/state-parity.ts + E2E (аудит-док §10). */
    {
      const C = await import('../src/lib/t4/consciousness')
      const { EVENT_TYPES } = await import('../src/lib/t4/events')
      const mk = (id: string, type: string, data?: Record<string, unknown>): T4Event => ({
        id,
        at: '2026-10-21T00:00:00.000Z',
        type,
        summary: `s:${id}`,
        data,
      })

      // адаптер строк прод-цепи: data JSON-строкой парсится, служебные поля цепи отброшены
      const adapted = C.engineRowsToEvents([
        { seq: 1, id: 'e1', at: '2026-10-21T00:00:00.000Z', type: 'oc.appeared', summary: 'a', data: JSON.stringify({ slug: 'T4-40', name: 'Mab' }), hash: 'h1', prev: 'p0' },
        { seq: 2, id: 'e2', at: '2026-10-21T00:00:01.000Z', type: 'note', summary: 'b', data: null },
      ])
      check(
        'сознание: адаптер прод-цепи — data-строка парсится, hash/seq в фолд не идут',
        adapted.length === 2 && adapted[0].data?.name === 'Mab' && adapted[1].data === undefined && !('hash' in adapted[0])
      )

      // объединение: дедуп по id (миграция сохраняла id — 399 общих), порядок движок→хвост
      const fileEv = [mk('e1', 'oc.appeared', { slug: 'T4-40', name: 'Mab' }), mk('t1', 'gate.run', { slug: 'T4-44' }), mk('t2', 'batch.delivered', { slug: 'T4-44' })]
      const engEv = [mk('e1', 'oc.appeared', { slug: 'T4-40', name: 'Mab' }), mk('e2', 'batch.void', { slug: 'T4-36' })]
      const united = C.uniteChronicle(engEv, fileEv)
      check(
        'сознание: объединение — общий id считается ОДИН раз (oc.appeared не двойнится)',
        united.composition.engine === 2 && united.composition.fileTail === 2 && united.events.filter((e) => e.id === 'e1').length === 1
      )
      check(
        'сознание: порядок объединения — прод-цепь первым, файл-хвост в хвосте',
        united.events.map((e) => e.id).join(',') === 'e1,e2,t1,t2'
      )

      // паритет: миграционная разница runIndex (случай §7: T4-04 — файл 5, прод 3) + void-надмножество + окно
      const fileRun5 = [1, 2, 3, 4, 5].map((i) => mk(`r${i}`, 'gate.run', { slug: 'T4-04' }))
      const engRun3 = [1, 2, 3].map((i) => mk(`r${i}`, 'gate.run', { slug: 'T4-04' }))
      const fileEvents = [...fileRun5, mk('d1', 'batch.delivered', { slug: 'T4-41' })]
      const engineEvents = [...engRun3, mk('d2', 'batch.delivered', { slug: 'T4-41' }), mk('v1', 'batch.void', { slug: 'T4-35' })]
      const parity = C.foldParity(fileEvents, engineEvents, C.uniteChronicle(engineEvents, fileEvents).events)
      check(
        'сознание: паритет ловит разницу runIndex (§7, миграция 399/421: T4-04 — файл 5 · прод 3 · union 5)',
        parity.runIndex.diffs.some((d) => d.includes('T4-04: file 5 · engine 3 · union 5'))
      )
      check(
        'сознание: паритет — void движковой эры закрывает слот в union (надмножество)',
        parity.voided.union === 1 && parity.voided.unionSuperset === true
      )
      check(
        'сознание: паритет — окно ротации совпадает во всех трёх фолдах',
        parity.window.equal && parity.window.union.join(',') === 'T4-41'
      )

      // resolveSource: по умолчанию движок (осознанное переключение), file — аварийный выход
      check(
        'сознание: resolveSource — по умолчанию движок, T4_STATE_SOURCE=file — аварийный выход',
        C.resolveSource({}) === 'engine' && C.resolveSource({ T4_STATE_SOURCE: 'engine' }) === 'engine' && C.resolveSource({ T4_STATE_SOURCE: 'file' }) === 'file' && C.resolveSource({ T4_STATE_SOURCE: 'мусор' }) === 'file'
      )

      // квитанция эпохи в каноне
      check('сознание: consciousness.switched в каноне событий (квитанция переключения)', (EVENT_TYPES as readonly string[]).includes('consciousness.switched'))

      // непрогретый синхронный фолд при source=engine — ЧЕСТНЫЙ отказ, не тихий файл
      process.env.T4_STATE_SOURCE = 'engine'
      let unwarmed = ''
      try {
        C.consciousnessEvents()
      } catch (e) {
        unwarmed = (e as Error).name
      }
      process.env.T4_STATE_SOURCE = 'file'
      check(
        'сознание: непрогретый синхронный фолд — ConsciousnessUnavailableError, не молчаливый файл',
        unwarmed === 'ConsciousnessUnavailableError'
      )
    }

    /* ============ ФАЗА 3: ОРКЕСТРАТОР — цикл как конечный автомат ==========
     * Чистое ядро (без сети): вывод состояния из летописи + фактов,
     * идемпотентность повтора (события-дубли невозможны), human-gates.
     * Синхрон канона cycle.step по трём движкам проверяется ПО ФАЙЛАМ. */
    {
      const O = await import('../src/lib/t4/orchestrator')
      const { EVENT_TYPES } = await import('../src/lib/t4/events')
      const fsMod = await import('node:fs')
      const mk = (id: string, type: string, data?: Record<string, unknown>): T4Event => ({
        id,
        at: '2026-10-22T00:00:00.000Z',
        type,
        summary: `s:${id}`,
        data,
      })

      // канон: cycle.step синхронно в трёх движках (TS events.ts == canon.ts == canon.rs)
      const canonTsEngine = (() => {
        const src = fsMod.readFileSync('mini-services/t4-engine/src/config/canon.ts', 'utf-8')
        const m = /export const EVENT_TYPES = \[([\s\S]*?)\] as const/.exec(src)
        return (m?.[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => /^'[a-z.]+'[, ]*$/.test(l) || /^'[\w.]+',$/.test(l)).map((l) => l.replace(/['",]/g, ''))
      })()
      const canonRust = (() => {
        const src = fsMod.readFileSync('mini-services/t4-engine-rs/src/canon.rs', 'utf-8')
        const m = /pub const EVENT_TYPES: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(src)
        return (m?.[1] ?? '').split('\n').map((l) => l.trim()).filter((l) => /^"[a-z.]+",?$/.test(l)).map((l) => l.replace(/["",]/g, ''))
      })()
      const tsCanon = EVENT_TYPES as readonly string[]
      check(
        'цикл: канон трёх движков синхронен (events.ts == canon.ts == canon.rs) — 24 типа',
        canonTsEngine.length === 24 && canonRust.length === 24 && tsCanon.length === 24 &&
        JSON.stringify(tsCanon) === JSON.stringify(canonTsEngine) &&
        JSON.stringify(tsCanon) === JSON.stringify(canonRust)
      )
      check('цикл: cycle.step в каноне (квитанция шага конечного автомата)', tsCanon.includes('cycle.step'))

      // вывод состояния: план есть → COMPILE закрыт; контракт есть → EXPOSITION закрыт
      const factsEmpty = { plan: { found: false }, contractOnDisk: false, draftOnDisk: false, draftSha10: null, lastGateRun: null } as const
      const st0 = O.deriveCycleState([], 'T4-44', factsEmpty)
      check('цикл: пустые факты — следующий шаг ORDER, ничего не закрыто', st0.next === 'ORDER' && !st0.done.ORDER && !st0.staleHardFail)

      const stPlan = O.deriveCycleState([], 'T4-44', { ...factsEmpty, plan: { found: true, source: 'scratch', status: 'compiled', sha10: 'aa11bb22cc', slots: 32 } })
      check('цикл: план compiled у движка — ORDER+COMPILE закрыты, следующий EXPOSITION', stPlan.next === 'EXPOSITION' && stPlan.done.ORDER && stPlan.done.COMPILE)

      const stContract = O.deriveCycleState([], 'T4-44', { ...factsEmpty, plan: { found: true, source: 'scratch', status: 'compiled' }, contractOnDisk: true, draftOnDisk: true, draftSha10: 'deadbeef01' })
      check('цикл: черновик на диске без прогонов — WRITE закрыт, следующий GATES', stContract.next === 'GATES' && stContract.done.WRITE && !stContract.done.GATES)

      // идемпотентность GATES: прогон по ТОМУ ЖЕ черновику PASS — шаг пропускается (дубля gate.run не будет)
      const stGates = O.deriveCycleState([], 'T4-44', { ...factsEmpty, plan: { found: true, source: 'scratch', status: 'compiled' }, contractOnDisk: true, draftOnDisk: true, draftSha10: 'deadbeef01', lastGateRun: { sha10: 'deadbeef01', hardPass: true, run: 2 } })
      check('цикл: gate.run PASS по текущему черновику — GATES закрыт, следующий DELIVER', stGates.next === 'DELIVER' && stGates.done.GATES)
      // ...а FAIL по НЕизменённому черновику — честный стоп, а не повторный прогон
      const stFail = O.deriveCycleState([], 'T4-44', { ...factsEmpty, plan: { found: true, source: 'scratch', status: 'compiled' }, contractOnDisk: true, draftOnDisk: true, draftSha10: 'deadbeef01', lastGateRun: { sha10: 'deadbeef01', hardPass: false, run: 2 } })
      check('цикл: hard FAIL по неизменённому черновику — staleHardFail (повтор не задублирует gate.run)', stFail.staleHardFail && !stFail.done.GATES)
      // починка меняет sha → прогон честный
      const stFixed = O.deriveCycleState([], 'T4-44', { ...factsEmpty, plan: { found: true, source: 'scratch', status: 'compiled' }, contractOnDisk: true, draftOnDisk: true, draftSha10: 'fixed00002', lastGateRun: { sha10: 'deadbeef01', hardPass: false, run: 2 } })
      check('цикл: черновик перечекан (новый sha) — GATES перезапускается честно', stFixed.next === 'GATES' && !stFixed.staleHardFail)

      // DELIVER закрыт → цикл завершён, next=null (повтор auto ничего не сделает)
      const delivered = [mk('o1', 'cycle.step', { slug: 'T4-44', step: 'ORDER', theme: 'тест' }), mk('d1', 'batch.delivered', { slug: 'T4-44' })]
      const stDone = O.deriveCycleState(delivered, 'T4-44', { ...factsEmpty, draftOnDisk: true })
      check('цикл: batch.delivered в летописи — цикл ЗАВЕРШЁН (повтор не родит шагов)', stDone.next === null && stDone.done.DELIVER && stDone.theme === 'тест')

      // void закрывает цикл
      const voided = [mk('o1', 'cycle.step', { slug: 'T4-44', step: 'ORDER', theme: 'тест' }), mk('v1', 'batch.void', { slug: 'T4-44' })]
      check('цикл: void закрыл цикл — next=null', O.deriveCycleState(voided, 'T4-44', factsEmpty).next === null)

      // открытый цикл по теме: возобновление после падения
      const openChain = [
        mk('d1', 'batch.delivered', { slug: 'T4-43' }),
        mk('o2', 'cycle.step', { slug: 'T4-44', step: 'ORDER', theme: 'Тестовая тема фазы 3' }),
        mk('c2', 'cycle.step', { slug: 'T4-44', step: 'COMPILE', planSha10: 'aa11bb22cc' }),
      ]
      const open = O.findOpenCycle(openChain, 'Тестовая тема фазы 3')
      check('цикл: авто-возобновление — открытый цикл найден по теме (падение не теряется)', open != null && !('mismatch' in open) && open!.slug === 'T4-44')
      const mismatch = O.findOpenCycle(openChain, 'другая тема')
      check('цикл: другая тема на открытом цикле — честный mismatch, не тихий новый заказ', mismatch != null && 'mismatch' in mismatch && mismatch.slug === 'T4-44')

      // квитанции: идентичность по sha — починка рождает НОВУЮ квитанцию, повтор — нет
      check('цикл: квитанция шага одна на slug×step+sha (stepReceipted)', O.stepReceipted(openChain, 'T4-44', 'COMPILE') && !O.stepReceipted(openChain, 'T4-44', 'WRITE'))
    }

    console.log(`\nselftest: ${ok} pass, ${fail} fail`)
    process.exit(fail === 0 ? 0 : 1)
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`THREAD 4 — цикл ORDER→COMPILE→EXPOSITION→WRITE→GATES→DELIVER (фаза 3)

АВТО-РЕЖИМ (конечный автомат, состояние — события cycle.step в летописи):
  t4 auto --theme "тема" --oc "OC-тема1" [--oc "OC-тема2"] [--oc "OC-тема3"] [--until STEP] [--step STEP] [--approve] [--slug T4-NN]
    · идёт по шагам до DELIVER (или до --until), останавливается:
        - на HUMAN-GATE после EXPOSITION — экспозиция (EXP-заглушки контракта)
          ждёт твоей руки; продолжение — только командой автора (--approve
          или следующий шаг вручную);
        - на ЛЮБОМ hard FAIL гейтов — полный отчёт, чинить (polish/руками);
        - честно, если движок молчит (таймаут шага + N повторов, потом стоп);
    · возобновление после падения — запусти ещё раз, автомат сам найдёт
      открытый цикл в летописи и продолжит с текущего шага;
    · идемпотентность: повтор шага в том же состоянии не плодит событий.

РУЧНОЙ РЕЖИМ (каждый шаг рукой; примитивы scribe/gates/deliver не тронуты):
  t4 order "тема" "OC-тема1" ["OC-тема2"] ["OC-тема3"]
                                 ORDER — закрепить следующий слаг за темой
  t4 plan T4-NN                  COMPILE — план соберёт живой движок (scratch twin'а)
  t4 expose T4-NN                EXPOSITION — WRITE-мост: план → богатый контракт
  t4 write T4-NN                 WRITE — писец по контракту (существующий LLM-мост)
  t4 gates T4-NN                 GATES — официальный прогон (существующий примитив)
  t4 deliver T4-NN               DELIVER — сдача (существующий примитив)

Переменные: T4_RUST_ORIGIN (twin, дефолт :3201) · T4_CYCLE_TIMEOUT_MS (8000) ·
T4_CYCLE_RETRIES (2) · T4_STATE_SOURCE=file — аварийный источник файл-эры.

Прочие команды: seed | compile | recompile | check | polish | gates | deliver |
scribe | void | state | drift | stack | lists | diff | trial | chain | verify |
shore-merge | reaper | corpus | recover | grep-gate | selftest`)
    return
  }

  console.log('commands: seed | auto --theme "тема" --oc "OC-тема" [--until STEP] [--step STEP] [--approve] | order | plan | expose | write | compile "theme" [engine] [oc1,oc2,oc3] [--pin x,y] | recompile T4-NN "theme" | scribe T4-NN | polish T4-NN | check T4-NN | gates T4-NN | deliver T4-NN | void T4-NN "reason" | state | drift T4-NN | stack T4-NN | lists | diff | trial | chain | verify [--heal] | shore-merge | reaper | corpus | recover [--apply] | grep-gate | selftest | help')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
