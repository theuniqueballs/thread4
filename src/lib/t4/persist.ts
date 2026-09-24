/**
 * THREAD 4 — DURABILITY LAYER (инцидент 2026-09-23: T4-05 и T4-07 погибли
 * вместе с эфемерным слоем контейнера при выключении компьютера автора).
 *
 * Доктрина: каждое изменение состояния (событие, батч, контракт, спека,
 * документ) фиксируется в git в течение секунды. Платформа хранит чекпоинты
 * как git-коммиты и восстанавливает рабочее дерево из них; всё, что было
 * закоммичено ДО аварийной остановки, переживает откат и поднимается
 * командой `bun thread4/cli.ts recover --apply`.
 *
 * Правила безопасности:
 *  - снапшот НИКОГДА не стейджит удаления (—ignore-removal): откат платформы
 *    нельзя «зацементировать» случайным коммитом;
 *  - снапшот идемпотентен (нет изменений — нет коммита) и не мешает
 *    чекпоинтам платформы (add -A + amend поглощает его без потерь);
 *  - сбой git (lock, нет .git) — тихий false, следующая запись повторит.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

/** Что защищаем: состояние THREAD 4 + записи работы + загруженное автором. */
const STAGE_PATHS = [
  'thread4',
  'worklog.md',
  'upload',
  'src/lib/t4',
  'src/app/api/t4',
  'src/components/t4',
]

const DEBOUNCE_MS = 600

let timer: ReturnType<typeof setTimeout> | null = null
let pendingReasons: string[] = []
let lastError: string | null = null

function gitOk(): boolean {
  try {
    return fs.existsSync(path.join(ROOT, '.git'))
  } catch {
    return false
  }
}

function run(
  args: string[],
  timeoutMs = 30_000
): { ok: boolean; out: string; err: string } {
  try {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8', timeout: timeoutMs })
    return {
      ok: r.status === 0,
      out: (r.stdout ?? '').trim(),
      err: (r.stderr ?? '').trim(),
    }
  } catch {
    return { ok: false, out: '', err: 'spawn failed' }
  }
}

/** Синхронный снапшот: add (без удалений) + commit. true = коммит создан. */
export function snapshotNow(reason: string): boolean {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const reasons = [...pendingReasons, reason]
  pendingReasons = []
  if (!gitOk() || process.env.T4_PERSIST === 'off') return false

  const add = run(['add', '--ignore-removal', '--', ...STAGE_PATHS])
  if (!add.ok) {
    lastError = add.err
    return false
  }
  /* ничего не изменилось — тихий выход */
  const staged = run(['diff', '--cached', '--name-only'])
  if (!staged.ok || staged.out === '') return false

  const msg =
    `persist: ${reasons.slice(0, 5).join(' + ')}` +
    (reasons.length > 5 ? ` (+${reasons.length - 5})` : '')
  const commit = run([
    '-c',
    'user.name=Z User',
    '-c',
    'user.email=z@container',
    'commit',
    '-m',
    msg,
  ])
  if (!commit.ok) {
    lastError = commit.err
    return false
  }
  return true
}

/** Отложенный снапшот (дебаунс): для частых записей (писец, события). */
export function scheduleSnapshot(reason: string): void {
  pendingReasons.push(reason)
  if (pendingReasons.length > 32) pendingReasons = pendingReasons.slice(-32)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    snapshotNow('debounce')
  }, DEBOUNCE_MS)
}

/** Последняя ошибка git (диагностика). */
export function snapshotLastError(): string | null {
  return lastError
}

/* CLI-процессы живут секунды: флешим недоиндексированное на выходе. */
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('exit', () => {
    if (pendingReasons.length > 0) snapshotNow('exit-flush')
  })
}

/* ------------------------------------------------------------------ */
/* FORENSICS: recover — undo для откатов платформы                     */
/* ------------------------------------------------------------------ */

export interface RecoverCandidate {
  path: string
  commit: string
  commitTime: number
  inHead: boolean
  kind: 'missing' | 'rolled-back'
}

export interface RecoverReport {
  head: string
  candidates: RecoverCandidate[]
  diskDiffers: { path: string; commit: string }[]
  scannedCommits: number
}

interface HistEntry {
  commit: string
  time: number
  inHead: boolean
  blob: string
}

function commitTime(hash: string): number {
  const r = run(['show', '-s', '--format=%ct', hash])
  return r.ok ? parseInt(r.out, 10) || 0 : 0
}

/**
 * Сканирует ВСЮ историю (включая осиротевшие коммиты из reflog — именно там
 * живут версии, «съеденные» откатом) и находит файлы thread4/**, которых
 * нет на диске или чья новейшая версия осталась только в истории.
 */
export function recoverReport(): RecoverReport | null {
  if (!gitOk()) return null
  const head = run(['rev-parse', 'HEAD'])
  if (!head.ok) return null

  const headSet = new Set(
    run(['rev-list', 'HEAD'])
      .out.split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  )

  const hashes = new Set<string>()
  for (const src of [
    run(['reflog', '--format=%H']).out,
    run(['rev-list', '--all']).out,
  ]) {
    for (const h of src.split('\n')) {
      const t = h.trim()
      if (t) hashes.add(t)
    }
  }

  /* путь → новейшая версия в истории */
  const best = new Map<string, HistEntry>()
  let scanned = 0
  for (const h of hashes) {
    scanned++
    const time = commitTime(h)
    const inHead = headSet.has(h)
    const ls = run(['ls-tree', '-r', h])
    if (!ls.ok) continue
    for (const line of ls.out.split('\n')) {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(line.trim())
      if (!m) continue
      const p = m[4]
      if (!p.startsWith('thread4/')) continue
      const prev = best.get(p)
      if (!prev || time >= prev.time) {
        best.set(p, { commit: h, time, inHead, blob: m[3] })
      }
    }
  }

  const candidates: RecoverCandidate[] = []
  const diskDiffers: { path: string; commit: string }[] = []
  for (const [p, entry] of best) {
    const disk = path.join(ROOT, p)
    if (!fs.existsSync(disk)) {
      candidates.push({
        path: p,
        commit: entry.commit,
        commitTime: entry.time,
        inHead: entry.inHead,
        kind: 'missing',
      })
      continue
    }
    const hash = run(['hash-object', disk])
    if (hash.ok && hash.out !== entry.blob) {
      if (entry.inHead) {
        /* диск отличается от HEAD-версии — вероятно, свежая незакоммиченная правка */
        diskDiffers.push({ path: p, commit: entry.commit })
      } else {
        /* новейшая версия живёт только в осиротевшем коммите — её съел откат */
        candidates.push({
          path: p,
          commit: entry.commit,
          commitTime: entry.time,
          inHead: false,
          kind: 'rolled-back',
        })
      }
    }
  }

  candidates.sort((a, b) => b.commitTime - a.commitTime)
  return { head: head.out, candidates, diskDiffers, scannedCommits: scanned }
}

/** Восстановление: недостающие/откаченные файлы из истории + снапшот. */
export function recoverApply(
  onLine?: (line: string) => void
): { report: RecoverReport | null; restored: string[] } {
  const report = recoverReport()
  if (!report) return { report: null, restored: [] }
  const restored: string[] = []
  for (const c of report.candidates) {
    const show = run(['show', `${c.commit}:${c.path}`])
    if (!show.ok) continue
    const target = path.join(ROOT, c.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, show.out, 'utf-8')
    restored.push(c.path)
    onLine?.(`восстановлен ${c.path} ← ${c.commit.slice(0, 8)} (${c.kind})`)
  }
  if (restored.length > 0) snapshotNow('recover')
  return { report, restored }
}

