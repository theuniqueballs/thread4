/**
 * CONTRACT-FROM-BATCH — обобщение четырёх одноразовых генераторов
 * ретро-контрактов (ревизия 2026-10-14, категория 3.2):
 *   gen-t426-contract.ts · gen-t427-contract.ts · gen-t4272-contract.ts ·
 *   refresh-t425-v2.ts  (суммарно ~590 строк, каждая — копия механики
 *   «распарсить батч → собрать контракт» с новым захардкоженным слагом).
 *
 * Механика (80%, одинаковая у всех четырёх) здесь одна и параметризована;
 * bespoke-часть (движок, законы, A/B-лиды) передаётся аргументами.
 *
 * Назначение: data-repair БЕЗ переписывания летописи — у RAW-батчей
 * ручной эры нет контрактов, гейтам не с чем сверяться (окно, raw-plus,
 * contract-fidelity). Этот инструмент строит контракт ИЗ УЖЕ СДАННОГО
 * батча — как прецеденты T4-25/26/27/27.2, но одним вызовом.
 *
 * Запуск (из корня репо):
 *   bun thread4/tools/contract-from-batch.ts T4-NN [--theme "…"] \
 *     [--engine "…"] [--engine-law "…"] [--rebuild-of T4-MM] \
 *     [--ab "P25:P26:κ:лид-гипотеза;P27:P28:λ:…"] [--md] [--force]
 *
 * Без --md пишет только .json; существующий контракт не трогает (--force).
 * Событий НЕ пишет: ретро-контракт — ремонт данных, летопись неприкосновенна.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseBatch, tierOf, type ParsedBatch } from '../../src/lib/t4/gates'
import { writeJson, writeText } from '../../src/lib/t4/fsutil'
import { foldState, readEvents } from '../../src/lib/t4/events'

/* ---------------- чистое ядро (самотест гоняет без диска) ---------------- */

export interface BuildOptions {
  slug: string
  theme?: string
  engine?: string
  engineLaw?: string
  engineWhy?: string
  rebuildOf?: string
  /** "P25:P26:κ:лид" ; P27:P28:λ:… — A/B-пары EXP-слотов */
  abSpec?: string
  ocNote?: string
  carrierNote?: string
}

export interface BuiltContract {
  contract: Record<string, unknown>
  markdown: string
}

/** Палитра из шапки слота: «(VOLT · R+ · PL22 · P02_TEST_Y)» → P02_TEST_Y. */
export function paletteOfHeader(header: string): string {
  return (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(header) ?? [])[0] ?? ''
}

/** carriers.json: id → {id, name, cls} (механика всех четырёх генераторов). */
export function carrierIndex(
  carriersSpec: { classes: Record<string, unknown[]> }
): Map<string, { id: string; name: string; cls: string }> {
  const out = new Map<string, { id: string; name: string; cls: string }>()
  for (const list of Object.values(carriersSpec.classes)) {
    if (!Array.isArray(list)) continue
    for (const c of list as { id: string; name: string }[]) {
      out.set(c.id, { id: c.id, name: c.name, cls: /^CR-([A-Z])/.exec(c.id)?.[1] ?? '?' })
    }
  }
  return out
}

function parseAbSpec(abSpec: string): Record<number, { pair: string; half: string; withSlot: number; lead: string }> {
  const out: Record<number, { pair: string; half: string; withSlot: number; lead: string }> = {}
  for (const chunk of abSpec.split(';').map((s) => s.trim()).filter(Boolean)) {
    const m = /^P(\d{1,2}):P(\d{1,2}):([^:]+):(.+)$/.exec(chunk)
    if (!m) continue
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    const pair = m[3].trim()
    const lead = m[4].trim()
    out[a] = { pair, half: 'A', withSlot: b, lead }
    out[b] = { pair, half: 'B', withSlot: a, lead }
  }
  return out
}

export function buildContractFromBatch(
  parsed: ParsedBatch,
  carriers: Map<string, { id: string; name: string; cls: string }>,
  opts: BuildOptions
): BuiltContract {
  const slug = opts.slug
  const title = opts.theme ?? parsed.title ?? slug
  const AB = opts.abSpec ? parseAbSpec(opts.abSpec) : {}

  const slots = parsed.slots.map((s) => {
    const isExp = s.genre === 'EXP'
    const palette = paletteOfHeader(s.header)
    return {
      position: s.position,
      kind: s.genre,
      oc: s.genre === 'OC' ? (s.meta.split('·')[1] ?? '').trim() : '',
      rating: tierOf(s.meta),
      pose: '',
      poseName: s.anchor,
      poseRisk: '',
      palette,
      paletteName: palette,
      kinetics: [],
      carriers: s.stack
        .map((id) => carriers.get(id))
        .filter((x): x is { id: string; name: string; cls: string } => Boolean(x)),
      lead: '',
      register: s.genre === 'OC' ? 'oc' : isExp ? 'exp-blank' : 'student',
      closer: '',
      ...(isExp
        ? {
            exploratory: 'EXP-слот (болванка без темы): гипотеза названа в THESIS слота батча',
            ...(AB[s.position] ? { ab: AB[s.position] } : {}),
          }
        : {}),
    }
  })

  const spread = ['R+', 'R', 'PG-13', 'X']
    .map((rating) => ({ rating, count: slots.filter((s) => s.rating === rating).length }))
    .filter((x) => x.count > 0)

  const contract = {
    slug,
    theme: title,
    engine: opts.engine ?? 'retro-from-batch',
    ...(opts.engineLaw ? { engineLaw: opts.engineLaw } : {}),
    ...(opts.engineWhy ? { engineWhy: opts.engineWhy } : {}),
    ...(opts.rebuildOf ? { rebuildOf: opts.rebuildOf } : {}),
    seed: 0,
    createdAt: new Date().toISOString(),
    retroNote:
      'контракт собран ИЗ сданного батча (contract-from-batch, ревизия 2026-10-14): data-repair без переписывания летописи; окно ротации не заявляется — батч уже в истории',
    spread,
    slots,
    ...(opts.ocNote ? { ocRotation: { note: opts.ocNote, ocs: slots.filter((s) => s.kind === 'OC').map((s) => s.oc) } } : {}),
    abPairs: Object.entries(AB)
      .filter(([, v]) => v.half === 'A')
      .map(([pos, v]) => ({ pair: v.pair, a: parseInt(pos, 10), b: v.withSlot, lead: v.lead })),
    carrierStats: {
      ...(opts.carrierNote ? { note: opts.carrierNote } : {}),
      wSharePct: Math.round(
        (slots.flatMap((s) => s.carriers).filter((c) => c.cls === 'W').length /
          Math.max(1, slots.length * 4)) *
          100
      ),
    },
    windowSlugs: [],
  }

  const md = [
    `# ${slug} «${title}» — КОНТРАКТ (ретро, из батча)`,
    '',
    `**Собран**: contract-from-batch (ревизия 2026-10-14) · **Источник**: batches/${slug}.md${opts.rebuildOf ? ` · **Перестройка**: ${opts.rebuildOf}` : ''}`,
    `**Движок**: ${contract.engine}${opts.engineLaw ? ` — ${opts.engineLaw}` : ''}`,
    '',
    `Слоты: ${slots.length} · спред ${spread.map((s) => `${s.rating}×${s.count}`).join(' · ')} ·`,
    `палитр в шапках: ${slots.filter((s) => s.palette).length} · стеков: ${slots.filter((s) => s.carriers.length > 0).length} ·`,
    `A/B-пар: ${contract.abPairs.length}.`,
    '',
    '> Ретро-контракт: летопись не тронута, окно не заявляется. Гейтам',
    '> (window / raw-plus / contract-fidelity) теперь есть с чем сверяться.',
    '',
  ].join('\n')

  return { contract, markdown: md }
}

/* ---------------- CLI-обёртка ---------------- */

function main() {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const slug = args.find((a) => /^T4-[\dA-Za-z.-]+$/.test(a))
  if (!slug) {
    console.error('usage: bun thread4/tools/contract-from-batch.ts T4-NN [--theme "…"] [--engine "…"] [--engine-law "…"] [--rebuild-of T4-MM] [--ab "P25:P26:κ:лид;…"] [--md] [--force]')
    process.exit(1)
  }
  const file = `thread4/batches/${slug}.md`
  if (!fs.existsSync(file)) {
    console.error(`батча нет: ${file}`)
    process.exit(1)
  }
  const outJson = path.join('thread4/contracts', `${slug}.json`)
  if (fs.existsSync(outJson) && !args.includes('--force')) {
    console.error(`контракт уже есть: ${outJson} (риск перезаписать провенанс) — --force, если осознанно`)
    process.exit(1)
  }

  const parsed = parseBatch(slug, fs.readFileSync(file, 'utf-8'))
  if (!parsed || parsed.slots.length === 0) {
    console.error('батч не распарсился (0 слотов)')
    process.exit(1)
  }
  const carriers = carrierIndex(
    JSON.parse(fs.readFileSync('thread4/specs/carriers.json', 'utf-8'))
  )

  /* data-repair честен про окно: ретро-контракт не заявляет ротацию,
   * но записывает, ЧТО было в окне на момент сдачи (для чтения людьми) */
  const state = foldState(readEvents())
  const windowAtDelivery = state.batches
    .filter((b) => b.deliveredAt != null && b.slug !== slug)
    .map((b) => b.slug)
    .slice(-8)

  const built = buildContractFromBatch(parsed, carriers, {
    slug,
    theme: flag('theme'),
    engine: flag('engine'),
    engineLaw: flag('engine-law'),
    engineWhy: flag('engine-why'),
    rebuildOf: flag('rebuild-of'),
    abSpec: flag('ab'),
  })
  ;(built.contract as { windowAtDelivery?: string[] }).windowAtDelivery = windowAtDelivery

  writeJson(outJson, built.contract)
  const spreadText = (built.contract.spread as { rating: string; count: number }[])
    .map((s) => `${s.rating}×${s.count}`)
    .join(' · ')
  console.log(`контракт ${outJson}: ${parsed.slots.length} слотов, спред ${spreadText}`)
  if (args.includes('--md')) {
    writeText(path.join('thread4/contracts', `${slug}.md`), built.markdown)
    console.log(`+ ${slug}.md`)
  }
  console.log('летопись не тронута (ретро-контракт — data-repair, событий нет)')
}

if (import.meta.main) main()
