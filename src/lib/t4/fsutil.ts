/**
 * THREAD 4 core — filesystem utilities (server-only).
 * Single source of truth for all paths. Everything lives under thread4/.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scheduleSnapshot } from './persist'

export const T4_ROOT = path.join(process.cwd(), 'thread4')
export const SPECS_DIR = path.join(T4_ROOT, 'specs')
export const EVENTS_DIR = path.join(T4_ROOT, 'events')
export const EVENT_LOG = path.join(EVENTS_DIR, 'log.jsonl')
/** Хеш-цепь летописи (Залп 1 «Правда»): append-only индекс поверх log.jsonl. */
export const CHAIN_LOG = path.join(EVENTS_DIR, 'chain.jsonl')
/** Ключ командира: мутирующие POST-ы летописи. Вне репо, в git не попадает. */
export const COMMANDER_KEY = path.join(os.homedir(), '.t4', 'commander.key')
export const BATCHES_DIR = path.join(T4_ROOT, 'batches')
export const CONTRACTS_DIR = path.join(T4_ROOT, 'contracts')
export const DRAFTS_DIR = path.join(T4_ROOT, 'drafts')
export const DOCS_DIR = T4_ROOT

/** 3.2 archive — read-only substrate (the rollback stays in chemodan/). */
export const ARCHIVE_DIR = path.join(
  process.cwd(),
  'chemodan',
  'CHEMODAN_THREAD_3.2-EXP_V21',
  'download'
)

export function ensureDirs(): void {
  for (const d of [T4_ROOT, SPECS_DIR, EVENTS_DIR, BATCHES_DIR, CONTRACTS_DIR, DRAFTS_DIR]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

export function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8')
  } catch {
    return null
  }
}

export function readJson<T>(p: string): T | null {
  const txt = readText(p)
  if (txt == null) return null
  try {
    return JSON.parse(txt) as T
  } catch {
    return null
  }
}

export function writeText(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  /* Залп 1 «Правда»: атомарная запись (tmp+rename) — обрыв питания не оставляет
     битый JSON, который readJson молча превратит в null. Fallback — прямой write,
     если rename не прошёл (блокировка антивирусом и т.п.), лучше целая запись,
     чем упавшая. */
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tmp, content, 'utf-8')
    fs.renameSync(tmp, p)
  } catch {
    try { fs.rmSync(tmp, { force: true }) } catch { /* переживаем */ }
    fs.writeFileSync(p, content, 'utf-8')
  }
  /* durability: каждая запись состояния — кандидат на git-снапшот */
  scheduleSnapshot(`write:${path.relative(process.cwd(), p)}`)
}

/** Ключ командира: строка из ~/.t4/commander.key или null, если ключа нет. */
export function readCommanderKey(): string | null {
  const raw = readText(COMMANDER_KEY)
  if (raw == null) return null
  const key = raw.trim()
  return key.length >= 16 ? key : null
}

export function writeJson(p: string, data: unknown): void {
  writeText(p, JSON.stringify(data, null, 2) + '\n')
}

export function listFiles(dir: string, ext: string): { name: string; base: string; size: number }[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => {
        const full = path.join(dir, e.name)
        return { name: e.name, base: e.name.replace(ext, ''), size: fs.statSync(full).size }
      })
      .sort((a, b) => a.base.localeCompare(b.base))
  } catch {
    return []
  }
}
