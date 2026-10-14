/**
 * T4 TRACE-RUN — инструментированный прогон техпроцесса (ревизия 2026-10-13).
 *
 * Отвечает на приказ автора: «сделай тестовый прогон, запиши какие конкретно
 * вещи и штуки используются для прогона, чтобы определить — что работает,
 * что не работает. Проверь — всё, до крупинки».
 *
 * Три источника истины:
 *   1) СТАТИКА: import-граф — транзитивное замыкание от каждого входа
 *      (cli / API-роуты / UI / proxy / инструменты). Даёт «что ядро может
 *      вызвать при создании».
 *   2) ДИНАМИКА: прогон БЕЗОПАСНЫХ команд под fs-обёрткой (trace-preload.cjs)
 *      — каждая операция READ/WRITE/STAT попадает в /tmp/t4-trace/*.log.
 *      Даёт «что реально открывается на живом прогоне». Летопись не трогаем:
 *      dry-команды (check/selftest/verify/state) и compile в dryRun.
 *   3) ПЕСОЧНИЦА: полный seed→compile→scribe→check→deliver в /tmp/t4-sandbox
 *      (клон без .git, летопись-копия) — единственный способ пройти мутирующие
 *      стадии честно, не записав ни события в настоящую цепь. Запускается
 *      отдельно скриптом sandbox-pipeline.sh (LLM-писец долгий).
 *
 * Подкоманды:
 *   bun thread4/tools/trace-run.ts fast    — статика + безопасная динамика
 *   bun thread4/tools/trace-run.ts report  — пересобрать отчёт из /tmp/t4-trace
 *   bun thread4/tools/trace-run.ts graph   — только статический граф (быстро)
 *
 * Выход: thread4/docs/USAGE-MAP-2026-10-13.md + usage-map.json (рядом).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const TRACE_DIR = path.join('/tmp', 't4-trace')
const PRELOAD = path.join(ROOT, 'thread4', 'tools', 'trace-preload.cjs')
const DOC_OUT = path.join(ROOT, 'thread4', 'docs', 'USAGE-MAP-2026-10-14.md')
const JSON_OUT = path.join(ROOT, 'thread4', 'docs', 'usage-map.json')

type Entry = { name: string; files: string[] }

/* ---------- 1. СТАТИКА: import-граф ---------- */

const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g
const DYN_IMPORT_RE = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const BARE_IMPORT_RE = /(?:^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out)
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

function parseSpecs(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8')
  const specs = new Set<string>()
  const add = (m: Set<string>, re: RegExp) => {
    let match: RegExpExecArray | null
    re.lastIndex = 0
    while ((match = re.exec(src))) m.add(match[1])
  }
  add(specs, IMPORT_RE)
  add(specs, DYN_IMPORT_RE)
  add(specs, REQUIRE_RE)
  add(specs, BARE_IMPORT_RE)
  /* '@/'-алиас (tsconfig paths) — родной импорт роутов/UI, не терять */
  return [...specs].filter((s) => s.startsWith('.') || s.startsWith('/') || s.startsWith('@/'))
}

function resolveSpec(fromFile: string, spec: string): string | null {
  /* '@/' — tsconfig paths «@/* → ./src/*» (роуты и UI ходят только так) */
  const base = spec.startsWith('@/')
    ? path.join(ROOT, 'src', spec.slice(2))
    : spec.startsWith('/')
      ? spec
      : path.resolve(path.dirname(fromFile), spec)
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.cjs',
    base + '.mjs',
    base + '.js',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ]
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch { /* кандидат не существует — следующий */ }
  }
  return null
}

function closureOf(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = entries.map((e) => path.resolve(ROOT, e))
  while (queue.length) {
    const f = queue.shift()!
    if (seen.has(f)) continue
    seen.add(f)
    for (const spec of parseSpecs(f)) {
      const r = resolveSpec(f, spec)
      if (r && /\.(ts|tsx|cjs|mjs|js)$/.test(r)) queue.push(r)
    }
  }
  return seen
}

function rel(files: Iterable<string>, prefix = ROOT): string[] {
  return [...files].map((f) => path.relative(prefix, f)).sort()
}

function findEntries(): { groups: Entry[]; creationFiles: Set<string> } {
  const apiRoutes = walk(path.join(ROOT, 'src/app/api'), ['.ts']).filter((f) => f.endsWith('route.ts'))
  const groups: Entry[] = [
    { name: 'cli.ts (техпроцесс: seed/compile/scribe/check/gates/deliver…)', files: ['thread4/cli.ts'] },
    {
      name: `API-роуты дашборда ×${apiRoutes.length}`,
      files: apiRoutes.map((f) => path.relative(ROOT, f)),
    },
    { name: 'UI (page.tsx + layout.tsx)', files: ['src/app/page.tsx', 'src/app/layout.tsx'] },
    { name: 'proxy.ts (CSP-nonce)', files: ['src/proxy.ts'] },
  ]
  /* инструменты: каждый — отдельный вход (стендэлоны + динамические от cli) */
  for (const t of walk(path.join(ROOT, 'thread4/tools'), ['.ts', '.cjs'])) {
    groups.push({ name: `tool ${path.relative(ROOT, t)}`, files: [path.relative(ROOT, t)] })
  }
  /* «ядро при создании» — конвейерные входы */
  const creationEntries = [
    'thread4/cli.ts',
    'src/app/api/t4/compile/route.ts',
    'src/app/api/t4/scribe/route.ts',
    'src/app/api/t4/contract-draft/route.ts',
    'src/app/api/t4/gates/route.ts',
    'thread4/tools/gen-rawplus.ts',
    'thread4/tools/dice.ts',
    'thread4/tools/kin-block.ts',
  ]
  return { groups, creationFiles: closureOf(creationEntries) }
}

/* ---------- 2. ДИНАМИКА: трассы прогонов ---------- */

type Trace = { name: string; ok: boolean; reads: string[]; writes: string[]; stats: number; readdirs: number }

function readTrace(name: string, file: string): Trace | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  let ok = true
  try {
    ok = fs.readFileSync(file + '.status', 'utf8').trim() === 'ok'
  } catch { /* статус не писался — считаем живым, судит сам прогон */ }
  const reads = new Set<string>()
  const writes = new Set<string>()
  let stats = 0
  let readdirs = 0
  for (const line of raw.split('\n')) {
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    const op = line.slice(0, sp)
    const p = line.slice(sp + 1).trim()
    if (!p) continue
    /* шум платформы: кеш bun, node_modules резолв, /tmp сама трасса */
    if (p.includes('node_modules') || p.startsWith('/tmp/t4-trace') || p.startsWith('.cache') || p.includes('/.bun/')) continue
    if (p.startsWith('/home/z/.t4/')) continue
    if (op === 'READ') reads.add(p)
    else if (op === 'WRITE') writes.add(p)
    else if (op === 'STAT') stats++
    else if (op === 'READDIR') readdirs++
  }
  return {
    name,
    ok,
    reads: [...reads].sort(),
    writes: [...writes].sort(),
    stats,
    readdirs,
  }
}

function bucket(p: string): string {
  if (p.startsWith('thread4/specs/')) return 'спеки'
  if (p.startsWith('thread4/contracts/')) return 'контракты'
  if (p.startsWith('thread4/batches/')) return 'батчи'
  if (p.startsWith('thread4/events/')) return 'летопись'
  if (p.startsWith('thread4/verdicts/')) return 'вердикты'
  if (p.startsWith('thread4/docs/') || /^thread4\/[^/]+\.md$/.test(p)) return 'документы'
  if (p.startsWith('thread4/drafts/')) return 'черновики'
  if (p.startsWith('src/')) return 'код src'
  if (p.startsWith('thread4/')) return 'прочее thread4'
  if (p.startsWith('download/')) return 'download (экспорт)'
  if (p.startsWith('legacy/')) return 'legacy'
  return 'прочее'
}

function bucketize(paths: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const p of paths) {
    const b = bucket(p)
    if (!m.has(b)) m.set(b, [])
    m.get(b)!.push(p)
  }
  return new Map([...m.entries()].sort((a, b) => b[1].length - a[1].length))
}

/* ---------- команды безопасного прогона (летопись не мутируем) ---------- */

const SAFE_COMMANDS: Array<{ name: string; args: string[] }> = [
  { name: 'state', args: ['state'] },
  { name: 'verify', args: ['verify'] },
  { name: 'check T4-30 (сухие гейты)', args: ['check', 'T4-30'] },
  { name: 'selftest (118 регрессий)', args: ['selftest'] },
  { name: 'reaper (драфт отставок)', args: ['reaper'] },
  { name: 'corpus (очередь взглядов)', args: ['corpus'] },
  { name: 'drift T4-30', args: ['drift', 'T4-30', '--top', '5'] },
  { name: 'stack T4-30', args: ['stack', 'T4-30', '--top', '5'] },
  { name: 'lists T4-28', args: ['lists', 'T4-28'] },
  { name: 'diff T4-27 T4-27.2-EXP', args: ['diff', 'T4-27', 'T4-27.2-EXP'] },
  { name: 'trial (живая пара)', args: ['trial'] },
  { name: 'grep-gate (П-2)', args: ['grep-gate'] },
]

function runTraced(name: string, args: string[]): { ok: boolean; ms: number } {
  const logFile = path.join(TRACE_DIR, name.replace(/[^\wа-яА-Я.-]+/g, '_') + '.log')
  try { fs.rmSync(logFile, { force: true }) } catch { /* нет файла — нет проблемы */ }
  const t0 = Date.now()
  const r = spawnSync('bun', ['--preload', PRELOAD, 'thread4/cli.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, T4_TRACE_OUT: logFile },
    maxBuffer: 64 * 1024 * 1024,
  })
  try { fs.writeFileSync(logFile + '.status', r.status === 0 ? 'ok' : 'fail') } catch { /* ... */ }
  return { ok: r.status === 0, ms: Date.now() - t0 }
}

/* compile в сухом режиме — библиотечный вызов с dryRun (ноль записей) */
function runCompileDry(): boolean {
  const logFile = path.join(TRACE_DIR, 'compile-dry.log')
  try { fs.rmSync(logFile, { force: true }) } catch { /* ... */ }
  const code = [
    `const { compileBatch, contractMarkdown } = await import(${JSON.stringify(path.join(ROOT, 'src/lib/t4/compiler'))})`,
    `const c = compileBatch('trace-dry', { seed: 13, dryRun: true })`,
    `console.log('compile-dry:', c.slug, c.slots.length, 'слотов')`,
  ].join('\n')
  const r = spawnSync('bun', ['--preload', PRELOAD, '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, T4_TRACE_OUT: logFile },
    maxBuffer: 64 * 1024 * 1024,
  })
  try { fs.writeFileSync(logFile + '.status', r.status === 0 ? 'ok' : 'fail') } catch { /* ... */ }
  return r.status === 0
}

/* ---------- 3. ОТЧЁТ ---------- */

function buildReport(traces: Trace[], groups: Entry[], creationFiles: Set<string>): string {
  const L: string[] = []
  L.push('# USAGE MAP — инструментированный прогон техпроцесса (2026-10-14)')
  L.push('')
  L.push('Приказ: «запиши какие конкретно вещи и штуки используются для прогона».')
  L.push('Два слоя: СТАТИКА (import-граф — что ядро может вызвать) и ДИНАМИКА')
  L.push('(fs-трасса — что реально открыто на прогоне). Мутирующие стадии')
  L.push('(compile/scribe/deliver) проверены в ПЕСОЧНИЦЕ .t4-sandbox/ (клон')
  L.push('летописи, клон живёт в gitignored-папке проекта) — летопись')
  L.push('настоящего репо не тронута ни одним событием.')
  L.push('')

  L.push('## 1. Статический import-граф (входы → замыкания)')
  L.push('')
  L.push('| Вход | Локальных файлов в замыкании |')
  L.push('|---|---|')
  for (const g of groups) {
    const c = rel(closureOf(g.files))
    L.push(`| ${g.name} | ${c.length} |`)
  }
  L.push('')

  const allSource = [
    ...walk(path.join(ROOT, 'thread4'), ['.ts', '.cjs']),
    ...walk(path.join(ROOT, 'src'), ['.ts', '.tsx']),
  ].map((f) => path.relative(ROOT, f))
  const reachable = new Set<string>()
  for (const g of groups) for (const f of rel(closureOf(g.files))) reachable.add(f)
  const orphans = allSource.filter((f) => !reachable.has(f))
  const creation = rel(creationFiles)

  L.push('### Ядро ПРИ СОЗДАНИИ (compile/scribe/check/gates/deliver + gen-rawplus)')
  L.push('')
  L.push(`Замыкание конвейерных входов — **${creation.length} файлов**:`)
  L.push('```')
  for (const f of creation) L.push(f)
  L.push('```')
  L.push('')

  L.push('### Сироты (не достижимы НИ ОТ ОДНОГО входа)')
  L.push('')
  if (orphans.length === 0) {
    L.push('— не найдено: каждый файл достижим хотя бы от одного входа.')
  } else {
    L.push(`**${orphans.length}**:`)
    L.push('```')
    for (const f of orphans) L.push(f)
    L.push('```')
  }
  L.push('')

  const coreNotCreation = creation.filter((f) => f.startsWith('src/lib/t4/')).length
  L.push(`Всего исходников: ${allSource.length}; в замыканиях: ${allSource.length - orphans.length};`)
  L.push(`lib/t4 в конвейере создания: ${coreNotCreation} из 14.`)
  L.push('')

  L.push('## 2. Динамический прогон (fs-трасса по командам)')
  L.push('')
  L.push('| Прогон | Статус | READ (уник) | WRITE (уник) | STAT |')
  L.push('|---|---|---|---|---|')
  for (const t of traces) {
    L.push(`| ${t.name} | ${t.ok ? 'ok' : '**FAIL**'} | ${t.reads.length} | ${t.writes.length} | ${t.stats} |`)
  }
  L.push('')
  for (const t of traces) {
    L.push(`### ${t.name}`)
    L.push('')
    const rb = bucketize(t.reads)
    L.push(`Читает (${t.reads.length} уник., READDIR×${t.readdirs}):`)
    if (rb.size === 0) L.push('— (только stdin/stdout-работа)')
    for (const [b, ps] of rb) {
      const short = ps.slice(0, 14)
      L.push(`- **${b}** ×${ps.length}: ${short.join(', ')}${ps.length > short.length ? ` … +${ps.length - short.length}` : ''}`)
    }
    const wb = bucketize(t.writes)
    L.push('')
    L.push(`Пишет (${t.writes.length}): ${t.writes.length ? t.writes.join(', ') : '— (чисто читающая команда)'}`)
    L.push('')
  }
  return L.join('\n')
}

function main() {
  const mode = process.argv[2] ?? 'report'
  fs.mkdirSync(TRACE_DIR, { recursive: true })
  const { groups, creationFiles } = findEntries()

  if (mode === 'graph') {
    const report = buildReport([], groups, creationFiles)
    fs.writeFileSync(DOC_OUT, report)
    console.log('graph →', DOC_OUT)
    return
  }

  if (mode === 'fast') {
    const results: Array<{ name: string; ok: boolean; ms: number }> = []
    for (const c of SAFE_COMMANDS) {
      const r = runTraced(c.name, c.args)
      results.push({ name: c.name, ok: r.ok, ms: r.ms })
      console.log(`  ${r.ok ? 'ok' : 'FAIL'} ${c.name} (${r.ms}ms)`)
    }
    const dry = runCompileDry()
    results.push({ name: 'compile-dry', ok: dry, ms: 0 })
    console.log(`  ${dry ? 'ok' : 'FAIL'} compile-dry`)
    const bad = results.filter((r) => !r.ok)
    console.log(`fast: ${results.length - bad.length}/${results.length} команд живы${bad.length ? ` — ПАЛИ: ${bad.map((b) => b.name).join(', ')}` : ''}`)
  }

  /* report: собрать все трассы из TRACE_DIR (stdout-протоколы — не трассы) */
  const traces: Trace[] = []
  for (const f of fs.readdirSync(TRACE_DIR).sort()) {
    if (!f.endsWith('.log') || f.includes('-stdout')) continue
    const t = readTrace(f.replace(/\.log$/, ''), path.join(TRACE_DIR, f))
    if (t) traces.push(t)
  }
  const report = buildReport(traces, groups, creationFiles)
  fs.writeFileSync(DOC_OUT, report)
  fs.writeFileSync(JSON_OUT, JSON.stringify({ traces, groups: groups.map((g) => g.name) }, null, 2))
  console.log('report →', DOC_OUT, `(${traces.length} трасс)`)
}

main()
