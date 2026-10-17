/**
 * THREAD 4 ENGINE — durability layer (snapshot doctrine, sqlite edition).
 *
 * Every state change (event append, compile, verdict, delivery) lands in
 * git within a second: WAL is checkpointed into the main db file, then
 * `git add` (+commit, idempotent) runs in a CHILD process — the event
 * loop of Bun.serve is never blocked (spawn, not spawnSync).
 *
 * Safety rules (inherited from the file era, incident 2026-09-23):
 *  - the snapshot never stages deletions (--ignore-removal: a platform
 *    rollback must not be cemented by an accidental commit);
 *  - idempotent: no changes → no commit;
 *  - git failure (lock, no .git, T4_PERSIST=off) → silent false, the
 *    next mutation retries.
 *  - in-flight serialization (snapBusy) excludes self-inflicted
 *    index.lock; a re-request during flight is queued, reasons survive.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { CANON } from '../config/canon'
import { checkpointWal, databaseHandle } from '../core/db'
import { DB_PATH, PROJECT_ROOT } from './paths'

const DEBOUNCE_MS = CANON.persist.debounceMs
const STAGE_PATH = CANON.persist.stagePath

let timer: ReturnType<typeof setTimeout> | null = null
let pendingReasons: string[] = []
let snapBusy = false
let snapQueuedAgain = false
let lastError: string | null = null

function gitOk(): boolean {
  try {
    return fs.existsSync(path.join(PROJECT_ROOT, '.git'))
  } catch {
    return false
  }
}

function runAsync(
  args: string[],
  timeoutMs = 30_000
): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', args, { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve({ ok: false, out: '', err: 'spawn failed' })
      return
    }
    let out = ''
    let err = ''
    let settled = false
    const finish = (ok: boolean, e: string): void => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve({ ok, out: out.trim(), err: e })
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
      finish(false, `timeout ${timeoutMs}ms`)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf-8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString('utf-8')
    })
    child.on('error', () => finish(false, 'spawn failed'))
    child.on('close', (code) => finish(code === 0, err))
  })
}

async function snapshotAsync(reason: string): Promise<boolean> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (snapBusy) {
    snapQueuedAgain = true
    return false
  }
  snapBusy = true
  try {
    const reasons = [...pendingReasons, reason]
    pendingReasons = []
    if (!gitOk() || process.env['T4_PERSIST'] === 'off') return false

    /* fold WAL into the db file so git stores ONE consistent artifact */
    const db = databaseHandle()
    if (db != null) checkpointWal(db)

    const add = await runAsync(['add', '--ignore-removal', '--', STAGE_PATH])
    if (!add.ok) {
      lastError = add.err
      return false
    }
    const staged = await runAsync(['diff', '--cached', '--name-only'])
    if (!staged.ok || staged.out === '') return false

    const msg =
      `persist(t4-engine): ${reasons.slice(0, 5).join(' + ')}` +
      (reasons.length > 5 ? ` (+${reasons.length - 5})` : '')
    const commit = await runAsync([
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
  } finally {
    snapBusy = false
    if (snapQueuedAgain) {
      snapQueuedAgain = false
      void snapshotAsync('debounce+')
    }
  }
}

/** Debounced snapshot for frequent writes (events, compiles). */
export function scheduleSnapshot(reason: string): void {
  pendingReasons.push(reason)
  if (pendingReasons.length > 32) pendingReasons = pendingReasons.slice(-32)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void snapshotAsync('debounce')
  }, DEBOUNCE_MS)
}

/** Synchronous flush (process exit). */
export function flushSnapshotNow(reason: string): boolean {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const reasons = [...pendingReasons, reason]
  pendingReasons = []
  if (!gitOk() || process.env['T4_PERSIST'] === 'off') return false
  const db = databaseHandle()
  if (db != null) checkpointWal(db)
  const run = (args: string[]): { ok: boolean; out: string } => {
    try {
      const r = spawnSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 })
      return { ok: r.status === 0, out: (r.stdout ?? '').trim() }
    } catch {
      return { ok: false, out: '' }
    }
  }
  const add = run(['add', '--ignore-removal', '--', STAGE_PATH])
  if (!add.ok) return false
  if (run(['diff', '--cached', '--name-only']).out === '') return false
  const commit = run([
    '-c',
    'user.name=Z User',
    '-c',
    'user.email=z@container',
    'commit',
    '-m',
    `persist(t4-engine): ${reasons.slice(0, 5).join(' + ')}`,
  ])
  return commit.ok
}

export function snapshotLastError(): string | null {
  return lastError
}

/** DB artifact facts for /v1/state (no absolute paths leak to clients). */
export function dbFacts(): { file: string; bytes: number } {
  try {
    const st = fs.statSync(DB_PATH)
    return { file: path.basename(DB_PATH), bytes: st.size }
  } catch {
    return { file: path.basename(DB_PATH), bytes: 0 }
  }
}
