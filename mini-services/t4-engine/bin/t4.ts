/**
 * THREAD 4 ENGINE — CLI tool (RPC client, no local state).
 *
 * The CLI is a THIN operator: every command talks to the engine over
 * HTTP. No file reads, no direct sqlite handles — the Single Source of
 * Truth stays single.
 *
 * Usage (bun, from the engine dir or my-project root):
 *   bun mini-services/t4-engine/bin/t4.ts health
 *   bun mini-services/t4-engine/bin/t4.ts state
 *   bun mini-services/t4-engine/bin/t4.ts compile "WITCHCRAFT" \
 *     --oc "Sexy Swimsuit:R+|Drunk on the Beach:R+|Fishnet Avalanche:R+" \
 *     [--exp 8] [--ab 2] [--engine per-theme] [--slug T4-35] \
 *     [--species R37,R38,R39] [--idem key-2026-10-18-a]
 *   bun mini-services/t4-engine/bin/t4.ts deliver T4-35
 *   bun mini-services/t4-engine/bin/t4.ts verdict T4-35 PASS \
 *     --source author-batch --confidence direct [--note "..."]
 *   bun mini-services/t4-engine/bin/t4.ts events [--after 390]
 *   bun mini-services/t4-engine/bin/t4.ts verify
 *   bun mini-services/t4-engine/bin/t4.ts batch T4-34
 */
import { api, loadCommanderKey, EngineError } from '../client/sdk'

interface Args {
  cmd: string
  positional: string[]
  flags: Map<string, string>
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags = new Map<string, string>()
  let i = 0
  while (i < argv.length) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const name = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next)
        i += 2
      } else {
        flags.set(name, 'true')
        i += 1
      }
    } else {
      positional.push(a)
      i += 1
    }
  }
  return { cmd: positional[0] ?? 'help', positional: positional.slice(1), flags }
}

function keyOrDie(): string {
  const key = loadCommanderKey()
  if (key == null) {
    console.error('✗ commander-key не найден: создай ~/.t4/commander.key (32+ случайных символа)')
    process.exit(2)
  }
  return key
}

function fail(e: unknown): never {
  if (e instanceof EngineError) {
    console.error(`✗ [${e.code}] ${e.message}${e.hint ? `\n  подсказка: ${e.hint}` : ''}`)
  } else {
    console.error('✗', e instanceof Error ? e.message : String(e))
  }
  process.exit(1)
}

function printReceipts(receipts: Array<{ gate: string; level: string; verdict: string; findings: string[]; notes?: string[] }>): void {
  for (const r of receipts) {
    const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : r.verdict === 'WARN' ? '⚠' : '·'
    console.log(`  [${mark}] ${r.gate} (${r.level})`)
    for (const f of r.findings) console.log(`       ${f}`)
    for (const n of r.notes ?? []) console.log(`       · ${n}`)
  }
}

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2))
  const key = loadCommanderKey() ?? ''

  switch (cmd) {
    case 'health': {
      const h = await api.health()
      console.log(`✓ движок жив: ${h.engine} v${h.version} · канон ${h.canon} · аптайм ${h.uptimeSec}с`)
      return
    }

    case 'state': {
      const s = await api.state()
      console.log(`ЭРА:        ${s.era} (канон ${s.canon}, FAM ${s.fam})`)
      console.log(`ЦЕПЬ:       ${s.chain.height} звеньев · head ${s.chain.head?.slice(0, 10) ?? '—'} · ${s.chain.ok ? 'ЦЕЛА' : `ПРОБЛЕМ: ${s.chain.problems.length}`}`)
      console.log(`СЛЕДУЮЩИЙ:  ${s.nextSlug}`)
      if (s.lastDelivered) {
        console.log(`СДАН:       ${s.lastDelivered.slug} «${s.lastDelivered.title}» (${s.lastDelivered.deliveredAt?.slice(0, 10)}) · diff ↑${s.lastDelivered.diffUp} ↓${s.lastDelivered.diffDown}`)
      }
      console.log(`СЧЁТЧИКИ:   событий ${s.counts.events} · сдано ${s.counts.batchesDelivered} · компилировано ${s.counts.batchesCompiled} · вердиктов ${s.counts.verdicts}`)
      console.log(`БАЗА:       ${s.db.file} (${Math.round(s.db.bytes / 1024)} КБ, schema v${s.db.schemaVersion}) · аптайм движка ${s.uptimeSec}с`)
      if (!s.chain.ok) for (const p of s.chain.problems.slice(0, 5)) console.log(`  ⚠ ${p}`)
      return
    }

    case 'compile': {
      const theme = positional[0]
      if (theme === undefined || theme.trim() === '') {
        console.error('✗ compile: тема обязательна — bun bin/t4.ts compile "WITCHCRAFT" --oc "…:R+|…:R+|…:R+"')
        process.exit(2)
      }
      const ocRaw = flags.get('oc')
      if (ocRaw === undefined) {
        console.error('✗ compile: --oc обязателен (1..3 OC-темы, формат «Тема:Рейтинг» через |)')
        process.exit(2)
      }
      const ocThemes = ocRaw.split('|').map((chunk, i) => {
        const [themePart, ratingPart] = chunk.split(':')
        return {
          theme: (themePart ?? '').trim(),
          rating: (ratingPart ?? 'R+').trim() as 'PG-13' | 'R' | 'R+' | 'X',
          wishes: '',
          position: i + 1,
        }
      })
      const speciesRaw = flags.get('species')
      const draft: Record<string, unknown> = {
        theme: theme.trim(),
        ocThemes,
        engine: (flags.get('engine') ?? 'per-theme') as string,
        exp: flags.has('exp') ? Number(flags.get('exp')) : undefined,
        abPairs: flags.has('ab') ? Number(flags.get('ab')) : undefined,
        ...(flags.has('slug') ? { slug: flags.get('slug') } : {}),
        ...(speciesRaw
          ? {
              species: {
                on: true,
                count: speciesRaw.split(',').length,
                list: speciesRaw.split(',').map((r) => r.trim()).filter(Boolean),
              },
            }
          : {}),
        ...(flags.has('notes') ? { notes: flags.get('notes') } : {}),
      }
      for (const k of Object.keys(draft)) if (draft[k] === undefined) delete draft[k]
      const result = await api.compile(draft, keyOrDie(), flags.get('idem'))
      const plan = result.plan
      console.log(`КОМПИЛЯЦИЯ: ${plan.slug} «${plan.title}» · sha10 ${plan.sha10} · seed ${plan.seed}`)
      console.log(`СЛОТЫ:      ${plan.slots.length} (EXP ${plan.exp}, A/B ${plan.abPairs}) · палитры: окно ${plan.paletteWindow.union}, бюджет ${plan.paletteWindow.budget}`)
      console.log(`ДИФФ:       ↑${plan.diff.up} ↓${plan.diff.down}${plan.diff.against ? ` против ${plan.diff.against}` : ' (первый батч)'}`)
      console.log(`ГЕЙТЫ (планирование):`)
      printReceipts(plan.receipts)
      console.log(result.idempotentReplay ? 'ИДЕМПОТЕНТНЫЙ РЕПЛЕЙ (летопись не тронута)' : `ЛЕТОПИСЬ: событие #${result.event.seq} (${result.event.id}) записано`)
      return
    }

    case 'deliver': {
      const slug = positional[0]
      if (slug === undefined) {
        console.error('✗ deliver: слаг обязателен')
        process.exit(2)
      }
      const r = await api.deliver(slug, keyOrDie())
      console.log(`✓ ${r.slug} СДАН (${r.deliveredAt}) · событие ${r.eventId}`)
      return
    }

    case 'void': {
      const slug = positional[0]
      if (slug === undefined) {
        console.error('✗ void: слаг обязателен')
        process.exit(2)
      }
      const r = await api.voidBatch(slug, keyOrDie())
      console.log(`✓ ${r.slug} ЗАКРЫТ (void, ${r.at}) · событие ${r.eventId} — номер не переиспользуется`)
      return
    }

    case 'verdict': {
      const slug = positional[0]
      const verdict = positional[1]
      if (slug === undefined || verdict === undefined) {
        console.error('✗ verdict: bun bin/t4.ts verdict T4-35 PASS --source author-batch --confidence direct [--note "…"]')
        process.exit(2)
      }
      const body: Record<string, unknown> = {
        slug,
        verdict,
        source: flags.get('source') ?? 'author-batch',
        ...(flags.has('confidence') ? { confidence: flags.get('confidence') } : {}),
        ...(flags.has('note') ? { note: flags.get('note') } : {}),
      }
      const r = await api.verdict(body, keyOrDie())
      console.log(`✓ вердикт записан: ${r['slug']} ${r['kind']} = ${r['verdict']} (${r['at']}) · событие ${r['eventId']}`)
      return
    }

    case 'events': {
      const after = flags.has('after') ? Number(flags.get('after')) : Math.max(0, (await api.state()).counts.events - 15)
      const r = await api.events(after, 100)
      for (const e of r.events as Array<{ seq?: number; id?: string; at?: string; type?: string; summary?: string }>) {
        console.log(`#${String(e.seq ?? '?').padStart(4)} ${e.at?.slice(0, 16).replace('T', ' ')} ${String(e.type ?? '').padEnd(18)} ${e.summary?.slice(0, 100)}`)
      }
      console.log(`— показано ${r.returned} из ${r.total}`)
      return
    }

    case 'verify': {
      const v = await api.verify()
      console.log(v.ok ? `✓ ЦЕПЬ ЦЕЛА: ${v.events} звеньев, head ${v.head?.slice(0, 12)}…` : `✗ ЦЕПЬ НАРУШЕНА (${v.problems.length}):`)
      for (const p of v.problems.slice(0, 10)) console.log(`  ⚠ ${p}`)
      if (!v.ok) process.exit(1)
      return
    }

    case 'batch': {
      const slug = positional[0]
      if (slug === undefined) {
        console.error('✗ batch: слаг обязателен')
        process.exit(2)
      }
      const b = (await api.batch(slug)) as {
        slug: string; title: string; status: string; slotsTotal: number; expSlots: number;
        hardPass: boolean; sha10: string; createdAt: string; deliveredAt: string | null;
      }
      console.log(`${b.slug} «${b.title}» · ${b.status} · ${b.slotsTotal} слотов (EXP ${b.expSlots}) · sha10 ${b.sha10}`)
      console.log(`создан ${b.createdAt}${b.deliveredAt ? ` · сдан ${b.deliveredAt}` : ''} · hard ${b.hardPass ? 'PASS' : 'FAIL'}`)
      return
    }

    default:
      console.log(USAGE)
      process.exit(cmd === 'help' || cmd === '' ? 0 : 2)
  }
}

const USAGE = `t4-engine CLI (RPC-клиент движка — SSoT)

  health                      живость движка
  state                       состояние: цепь, счётчики, следующий слаг
  compile "ТЕМА" --oc "…:R+|…:R+|…:R+" [--exp 8] [--ab 2] [--engine per-theme]
                             [--slug T4-35] [--species R37,R38] [--idem ключ]
  deliver T4-NN               сдать батч (hard-гейты обязаны быть PASS)
  void T4-NN                  закрыть батч (провенанс сохранён)
  verdict T4-NN PASS|FAIL|WARN --source author-batch --confidence direct [--note]
  events [--after N]          хвост летописи
  verify                      полная проверка хеш-цепи
  batch T4-NN                 карточка батча

Ключ командира читается из ~/.t4/commander.key, летит заголовком x-commander-key.
Движок: T4_ENGINE_URL (по умолчанию http://127.0.0.1:3200).`

main().catch(fail)
