/**
 * stack-report.ts — концепт-валидатор стеков (порт ULTIMATE DICE §44 из
 * архива A5 / RULES_CORE 3.2 в RAW-эру). Дрейф-репорт считает СЛОВА; этот
 * считает КОНЦЕПТЫ: сигнатура слота = поза + палитра + сет носителей.
 *
 * Что ловит, чего не ловит никто:
 *   1. полный повтор концепта (поза+палитра+стек совпали с историей) —
 *      §56D «успех не лицензия на повтор»: на возврате ≥1 ось обязана
 *      мутировать; повтор без мутации — кандидат на грех;
 *   2. повторы ФОРМУЛ стеков (тот же сет CR-носителей в разных батчах) —
 *      слепая зона системы: окно ротации гейтит позы и палитры (3 батча),
 *      носители не окнаются НИКЕМ; simcheck ловит текст, не формулы;
 *   3. возвраты палитр из глубины (окно = 3 батча; что вернулось из
 *      глубины 4-8 — видит только этот отчёт);
 *   4. носители-любимцы: топ рецидивов и баланс мех-классов по глубине.
 *
 * Ребилды: переиспользование осей источника (rebuildOf) — задумано
 * перестройкой, помечается отдельно, нарушением не считается.
 *
 * Запуск (из корня репо):
 *   bun thread4/cli.ts stack T4-27.2-EXP            # отчёт (глубина 8)
 *   bun thread4/tools/stack-report.ts T4-26 --depth 5
 *   bun thread4/tools/stack-report.ts T4-27 --json
 *
 * Статус: REPORT, не гейт — летопись не трогает, ничего не канонизирует
 * (§10). Писец читает перед сдачей; глаз автора решает.
 */
import fs from 'node:fs'
import { parseBatch, tierOf, type ParsedSlot } from '../../src/lib/t4/gates'
import { foldState, readEvents } from '../../src/lib/t4/events'
import { getCarriers } from '../../src/lib/t4/specs'

interface SlotAxes {
  slug: string
  p: string
  pose: string
  palette: string
  carriers: string[]
  rating: string
  kind: string
}

type Appearance = SlotAxes

interface FormulaRepeat {
  carriers: string[]
  appearances: Appearance[]
  paletteMutated: boolean
  abPair: boolean
}

interface PaletteReturn {
  palette: string
  target: string[]
  from: Appearance[]
  inWindow: boolean
  carriersMutated: boolean
}

interface ConceptRepeat {
  target: SlotAxes
  from: Appearance[]
  rebuild: boolean
}

interface StackReport {
  slug: string
  delivered: boolean
  rebuildOf: string | null
  depth: number
  history: string[]
  skipped: string[]
  coverage: { slots: number; withPalette: number; withStack: number }
  repeats: ConceptRepeat[]
  rebuildReuse: ConceptRepeat[]
  formulaRepeats: FormulaRepeat[]
  inBatchDuplicates: FormulaRepeat[]
  paletteReturns: PaletteReturn[]
  carrierFavorites: { carrier: string; uses: number; slugs: string[] }[]
  classShare: Record<string, number>
  classFamilies: Record<string, number>
}

/** Точка входа для CLI (`thread4/cli.ts stack`) и прямого запуска. */
export function run(argv: string[]) {
  const args = argv
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug || !/^T4-[\d.]+(-EXP)?$/.test(slug)) {
    console.error('usage: bun thread4/tools/stack-report.ts T4-NN [--depth N] [--top N] [--json]')
    process.exit(1)
  }
  const depth = Math.max(1, parseInt(args.find((_, i) => args[i - 1] === '--depth') ?? '8', 10))
  const top = Math.max(1, parseInt(args.find((_, i) => args[i - 1] === '--top') ?? '10', 10))
  const asJson = args.includes('--json')

  const batchPath = `thread4/batches/${slug}.md`
  if (!fs.existsSync(batchPath)) {
    console.error(`Нет батча: ${batchPath}`)
    process.exit(1)
  }

  const report = buildReport(slug, depth)

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const cov = report.coverage
  console.log(`\nSTACK-REPORT · ${slug} · концепты: поза+палитра+стек`)
  console.log(`глубина ${report.depth} батчей: ${report.history.join(' · ') || '—'}`)
  if (report.skipped.length > 0) {
    console.log(`пропущены (нет .md, напр. переименован): ${report.skipped.join(' · ')}`)
  }
  console.log(
    `слотов ${cov.slots} · с палитрой ${cov.withPalette} · со стеком ${cov.withStack}` +
      (report.rebuildOf ? ` · rebuildOf ${report.rebuildOf}` : '')
  )
  console.log('='.repeat(64))

  console.log(`\nПолные повторы концепта (§56D: успех не лицензия на повтор):`)
  if (report.repeats.length === 0) console.log('  — чисто')
  for (const r of report.repeats.slice(0, top)) {
    console.log(`  ✗ ${r.target.p} ${r.target.pose} · ${r.target.palette} · ${r.target.carriers.join('+')}`)
    for (const a of r.from) console.log(`      был: ${a.slug} ${a.p} (${a.kind}${a.rating ? ' · ' + a.rating : ''})`)
  }

  console.log(`\nПереиспользование источника ребилда (задумано перестройкой):`)
  if (report.rebuildReuse.length === 0) console.log('  —')
  for (const r of report.rebuildReuse.slice(0, top)) {
    console.log(`  ↻ ${r.target.p} ${r.target.pose} · ${r.target.palette} · ${r.target.carriers.join('+')}`)
    for (const a of r.from) console.log(`      из: ${a.slug} ${a.p}`)
  }

  console.log(`\nПовторы формул стеков (тот же сет носителей — окном не гейтится):`)
  if (report.formulaRepeats.length === 0) console.log('  — чисто')
  for (const f of report.formulaRepeats.slice(0, top)) {
    const mut = f.paletteMutated ? 'палитра сменена ✓' : 'та же палитра ✗'
    console.log(`  ${f.appearances.length}× ${f.carriers.join('+')} — ${mut}`)
    for (const a of f.appearances) {
      console.log(`      ${a.slug} ${a.p} · ${a.palette || '—'} · ${a.kind}${a.rating ? ' ' + a.rating : ''}`)
    }
  }

  console.log(`\nДубли формул внутри батча (гейт моно-носителя считает ID, не сеты):`)
  if (report.inBatchDuplicates.length === 0) console.log('  — чисто')
  for (const f of report.inBatchDuplicates.slice(0, top)) {
    const tag = f.abPair ? 'A/B-пара — одна переменная (закон)' : '✗ дубль вне пары'
    const mut = f.paletteMutated ? 'палитра сменена ✓' : 'та же палитра ✗'
    console.log(`  ${f.appearances.length}× ${f.carriers.join('+')} — ${tag} · ${mut}`)
    for (const a of f.appearances) {
      console.log(`      ${a.p} · ${a.palette || '—'} · ${a.pose}`)
    }
  }

  console.log(`\nВозвраты палитр из истории (окно гейтит только 3 батча):`)
  if (report.paletteReturns.length === 0) console.log('  — чисто')
  for (const pr of report.paletteReturns.slice(0, top)) {
    const zone = pr.inWindow ? 'в окне — гейт поймает' : 'ЗА ОКНОМ — слепая зона'
    const mut = pr.carriersMutated ? 'стек сменён ✓' : 'тот же стек ✗'
    console.log(`  ${pr.palette}: ${pr.target.join(' ')} ← ${pr.from.map((a) => `${a.slug} ${a.p}`).join(', ')} · ${zone} · ${mut}`)
  }

  console.log(`\nНосители-любимцы (глубина ${report.depth}):`)
  for (const c of report.carrierFavorites.slice(0, top)) {
    console.log(`  ${String(c.uses).padStart(3)}×  ${c.carrier}  [${c.slugs.join(' ')}]`)
  }
  const share = Object.entries(report.classShare)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, n]) => `${cls} ${n}`)
    .join(' · ')
  const families = Object.entries(report.classFamilies)
    .sort((a, b) => b[1] - a[1])
    .map(([fam, n]) => `${fam} ${n}`)
    .join(' · ')
  console.log(`  классы: ${share}`)
  console.log(`  семейства: ${families}`)

  console.log(
    '\nСтатус: REPORT (не гейт) — повторка не всегда грех (тема-закон батча),\n' +
      'глаз автора решает. §56D — принцип A5, не закон T4: канонизация — только вердиктом (§10).'
  )
}

/* ------------------------------------------------------------------ */
/* Ядро                                                                */
/* ------------------------------------------------------------------ */

export function buildReport(slug: string, depth: number): StackReport {
  const state = foldState(readEvents())
  const delivered = state.batches
    .filter((b) => b.deliveredAt != null && !state.voidedSlugs.includes(b.slug))
    .sort((a, b) => (a.deliveredAt! < b.deliveredAt! ? -1 : 1))
    .map((b) => b.slug)

  const targetIdx = delivered.indexOf(slug)
  const deliveredFlag = targetIdx >= 0
  // ретро-аудит честен только по прошлому: батч не судим будущими повторами
  const historySlugs = (
    deliveredFlag ? delivered.slice(Math.max(0, targetIdx - depth), targetIdx) : delivered.slice(-depth)
  ).filter((s) => s !== slug)

  const contract = readContract(slug)
  const rebuildOf = contract?.rebuildOf ?? null

  const targetSlots = axesOf(slug, contract)
  const skipped: string[] = []
  const historySlots: SlotAxes[] = []
  for (const h of historySlugs) {
    if (!fs.existsSync(`thread4/batches/${h}.md`)) {
      skipped.push(h) // напр. T4-18 → T4-17 по приказу автора
      continue
    }
    historySlots.push(...axesOf(h, readContract(h)))
  }

  /* индексы истории */
  const byFullSig = new Map<string, Appearance[]>()
  const byCarriers = new Map<string, Appearance[]>()
  const byPalette = new Map<string, Appearance[]>()
  for (const s of historySlots) {
    push(byFullSig, sigKey(s), s)
    push(byCarriers, s.carriers.join('+'), s)
    if (s.palette) push(byPalette, s.palette, s)
  }

  const windowSlugs = state.windowSlugs

  const repeats: ConceptRepeat[] = []
  const rebuildReuse: ConceptRepeat[] = []
  for (const t of targetSlots) {
    const hits = byFullSig.get(sigKey(t)) ?? []
    if (hits.length === 0) continue
    const isRebuild = rebuildOf != null && hits.every((h) => h.slug === rebuildOf)
    const entry = { target: t, from: hits, rebuild: isRebuild }
    if (isRebuild) rebuildReuse.push(entry)
    else repeats.push(entry)
  }

  /* формулы: сет носителей встречался в истории ≥1 раза (не в источнике ребилда) */
  const formulaRepeats: FormulaRepeat[] = []
  for (const t of targetSlots) {
    if (t.carriers.length === 0) continue
    const hits = (byCarriers.get(t.carriers.join('+')) ?? []).filter(
      (h) => rebuildOf == null || h.slug !== rebuildOf
    )
    if (hits.length === 0) continue
    const appearances = [...hits, t]
    const paletteMutated = new Set(appearances.map((a) => a.palette)).size > 1
    if (formulaRepeats.some((f) => f.carriers.join('+') === t.carriers.join('+'))) continue
    formulaRepeats.push({ carriers: t.carriers, appearances, paletteMutated, abPair: false })
  }
  formulaRepeats.sort((a, b) => b.appearances.length - a.appearances.length)

  /* дубли внутри батча: один и тот же сет в ≥2 слотах таргета; A/B-пары
     (EXP · соседние позиции · общий стем позы) — закон одной переменной,
     помечаются, нарушением не считаются */
  const bySetInBatch = new Map<string, SlotAxes[]>()
  for (const t of targetSlots) {
    if (t.carriers.length === 0) continue
    push(bySetInBatch, t.carriers.join('+'), t)
  }
  const inBatchDuplicates: FormulaRepeat[] = []
  for (const [key, slots] of bySetInBatch) {
    if (slots.length < 2) continue
    const abPair = slots
      .slice(1)
      .every(
        (s, i) =>
          slots[i].kind === 'EXP' &&
          s.kind === 'EXP' &&
          Math.abs(parseInt(s.p.slice(1), 10) - parseInt(slots[i].p.slice(1), 10)) === 1
      )
    const paletteMutated = new Set(slots.map((s) => s.palette)).size > 1
    inBatchDuplicates.push({
      carriers: key.split('+'),
      appearances: slots,
      paletteMutated,
      abPair,
    })
  }
  inBatchDuplicates.sort((a, b) => b.appearances.length - a.appearances.length)

  /* палитры: вернулись из истории (окно vs за окном) */
  const paletteReturns: PaletteReturn[] = []
  for (const t of targetSlots) {
    if (!t.palette) continue
    const hits = (byPalette.get(t.palette) ?? []).filter((h) => rebuildOf == null || h.slug !== rebuildOf)
    if (hits.length === 0) continue
    const key = t.palette
    const existing = paletteReturns.find((p) => p.palette === key)
    if (existing) {
      if (!existing.target.includes(t.p)) existing.target.push(t.p)
      continue
    }
    const inWindow = hits.some((h) => windowSlugs.includes(h.slug))
    const carrierSets = new Set([...hits.map((h) => h.carriers.join('+')), t.carriers.join('+')])
    paletteReturns.push({
      palette: key,
      target: [t.p],
      from: hits,
      inWindow,
      carriersMutated: carrierSets.size > 1,
    })
  }

  /* носители-любимцы по истории (без таргета — это про конвейер в целом) */
  const carrierUses = new Map<string, { uses: number; slugs: Set<string> }>()
  for (const s of historySlots) {
    for (const c of s.carriers) {
      const e = carrierUses.get(c) ?? { uses: 0, slugs: new Set<string>() }
      e.uses += 1
      e.slugs.add(s.slug)
      carrierUses.set(c, e)
    }
  }
  const carrierFavorites = [...carrierUses.entries()]
    .map(([carrier, v]) => ({ carrier, uses: v.uses, slugs: [...v.slugs] }))
    .sort((a, b) => b.uses - a.uses)

  const classShare: Record<string, number> = {}
  const classFamilies: Record<string, number> = {}
  const mechNames = mechOfClass()
  for (const s of historySlots) {
    for (const c of s.carriers) {
      const cls = c.replace(/^CR-([A-Z])\d+$/, '$1')
      const label = mechNames[cls] ? `${cls}(${mechNames[cls]})` : cls
      classShare[label] = (classShare[label] ?? 0) + 1
      const fam = mechNames[cls] ?? cls
      classFamilies[fam] = (classFamilies[fam] ?? 0) + 1
    }
  }

  return {
    slug,
    delivered: deliveredFlag,
    rebuildOf,
    depth,
    history: historySlugs.filter((s) => !skipped.includes(s)),
    skipped,
    coverage: {
      slots: targetSlots.length,
      withPalette: targetSlots.filter((t) => t.palette).length,
      withStack: targetSlots.filter((t) => t.carriers.length > 0).length,
    },
    repeats,
    rebuildReuse,
    formulaRepeats,
    inBatchDuplicates,
    paletteReturns,
    carrierFavorites,
    classShare,
    classFamilies,
  }
}

/* ------------------------------------------------------------------ */
/* Данные                                                              */
/* ------------------------------------------------------------------ */

function sigKey(s: SlotAxes): string {
  return `${s.pose}|${s.palette}|${s.carriers.join('+')}`
}

function push(map: Map<string, Appearance[]>, key: string, slot: SlotAxes) {
  const list = map.get(key) ?? []
  list.push(slot)
  map.set(key, list)
}

function readContract(slug: string): { rebuildOf?: string; slots?: { position: number; palette?: string }[] } | null {
  const p = `thread4/contracts/${slug}.json`
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** Оси слота: поза-якорь, палитра (шапка → контракт-фолбэк), сет носителей. */
function axesOf(slug: string, contract: { slots?: { position: number; palette?: string }[] } | null): SlotAxes[] {
  const batch = parseBatch(slug, fs.readFileSync(`thread4/batches/${slug}.md`, 'utf-8'))
  const paletteByPos = new Map<number, string>()
  for (const s of contract?.slots ?? []) {
    if (s.palette) paletteByPos.set(s.position, s.palette)
  }
  return batch.slots.map((s: ParsedSlot) => {
    const headerPal = (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(s.header) ?? [])[0] ?? ''
    const palette = headerPal || paletteByPos.get(s.position) || ''
    const meta = s.meta
    return {
      slug,
      p: `P${String(s.position).padStart(2, '0')}`,
      pose: s.anchor,
      palette,
      carriers: [...new Set(s.stack)].sort(),
      rating: tierOf(meta),
      kind: meta.split('·')[0]?.trim() || '—',
    }
  })
}

function mechOfClass(): Record<string, string> {
  const cs = getCarriers()
  const out: Record<string, string> = {}
  for (const [cls, def] of Object.entries(cs?.class_defs ?? {})) {
    out[cls] = (def as { mech?: string }).mech ?? cls
  }
  return out
}

/* прямой запуск: bun thread4/tools/stack-report.ts T4-NN … */
if (import.meta.main) run(process.argv.slice(2))
