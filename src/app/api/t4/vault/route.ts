/**
 * THREAD 4 — BROWSER VAULT (инцидент 2026-09-23).
 *
 * GET  /api/t4/vault — полный бандл состояния THREAD 4 (батчи, контракты,
 *   спеки, документы, журнал событий) одним файлом. Клиент складывает его
 *   в IndexedDB СВОЕГО браузера: сервер контейнера эфемерен, браузер автора — нет.
 *
 * POST /api/t4/vault — восстановление после отката: принимает бандл из
 *   браузерного хранилища и возвращает на диск ТОЛЬКО то, чего не хватает
 *   (существующие файлы никогда не перезаписываются), а события вливает
 *   в журнал с дедупликацией по id.
 */
import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

import {
  BATCHES_DIR,
  CONTRACTS_DIR,
  DOCS_DIR,
  EVENT_LOG,
  SPECS_DIR,
  ensureDirs,
  listFiles,
  readText,
  writeText,
} from '@/lib/t4/fsutil'
import { appendEvent, readEvents, type T4Event } from '@/lib/t4/events'
import { snapshotNow } from '@/lib/t4/persist'

export const dynamic = 'force-dynamic'

/* ------------------------------------------------------------------ */
/* GET — бандл состояния                                               */
/* ------------------------------------------------------------------ */

function collectDir(dir: string, ext: string, files: Record<string, string>): void {
  for (const f of listFiles(dir, ext)) {
    const rel = path.relative(process.cwd(), path.join(dir, f.name))
    const content = readText(path.join(dir, f.name))
    if (content != null) files[rel] = content
  }
}

const DOC_FILES = [
  'CONSTITUTION.md',
  'TASTE.md',
  'RENDERER_FACTS.md',
  'ENGINE_FORGE.md',
]

export async function GET() {
  ensureDirs()
  const files: Record<string, string> = {}

  collectDir(BATCHES_DIR, '.md', files)
  collectDir(BATCHES_DIR, '.json', files)
  collectDir(CONTRACTS_DIR, '.md', files)
  collectDir(CONTRACTS_DIR, '.json', files)
  collectDir(SPECS_DIR, '.json', files)
  for (const d of DOC_FILES) {
    const content = readText(path.join(DOCS_DIR, d))
    if (content != null) files[`thread4/${d}`] = content
  }
  const log = readText(EVENT_LOG)
  if (log != null) files['thread4/events/log.jsonl'] = log

  const counts = {
    batches: Object.keys(files).filter((p) => p.startsWith('thread4/batches/') && p.endsWith('.md')).length,
    contracts: Object.keys(files).filter((p) => p.startsWith('thread4/contracts/') && p.endsWith('.md')).length,
    specs: Object.keys(files).filter((p) => p.startsWith('thread4/specs/')).length,
    events: readEvents().length,
  }

  return NextResponse.json({ savedAt: new Date().toISOString(), counts, files })
}

/* ------------------------------------------------------------------ */
/* POST — восстановление недостающего                                  */
/* ------------------------------------------------------------------ */

const SAFE_PATH = /^thread4\/(batches|contracts|specs)\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_DOC = /^thread4\/[A-Z][A-Z_]+\.md$/
const LOG_PATH = 'thread4/events/log.jsonl'

function parseLog(text: string): T4Event[] {
  const out: T4Event[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as T4Event)
    } catch {
      /* битая строка не убивает восстановление */
    }
  }
  return out
}

export async function POST(request: Request) {
  let body: { files?: Record<string, string>; savedAt?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const incoming = body.files ?? {}
  if (Object.keys(incoming).length === 0) {
    return NextResponse.json({ error: 'пустой бандл' }, { status: 400 })
  }

  ensureDirs()
  const restored: string[] = []
  const skipped: string[] = []
  let mergedEvents = 0

  /* события обрабатываем отдельно: слияние по id, а не перезапись */
  const incomingLog = incoming[LOG_PATH]
  delete incoming[LOG_PATH]

  for (const [rel, content] of Object.entries(incoming)) {
    if (!SAFE_PATH.test(rel) && !SAFE_DOC.test(rel)) {
      skipped.push(`${rel} (путь отклонён)`)
      continue
    }
    const diskPath = path.join(process.cwd(), rel)
    if (fs.existsSync(diskPath)) {
      skipped.push(`${rel} (уже на диске)`)
      continue
    }
    writeText(diskPath, content)
    restored.push(rel)
  }

  if (typeof incomingLog === 'string' && incomingLog.trim() !== '') {
    const diskEvents = readEvents()
    const diskIds = new Set(diskEvents.map((e) => e.id))
    const histEvents = parseLog(incomingLog).filter((e) => !diskIds.has(e.id))
    if (histEvents.length > 0) {
      /* события вставляем в хронологическом порядке (fold зависит от порядка) */
      const merged = [...diskEvents, ...histEvents].sort((a, b) =>
        a.at < b.at ? -1 : a.at > b.at ? 1 : 0
      )
      writeText(EVENT_LOG, merged.map((e) => JSON.stringify(e)).join('\n') + '\n')
      mergedEvents = histEvents.length
    }
  }

  if (restored.length > 0 || mergedEvents > 0) {
    appendEvent(
      'note',
      `VAULT: восстановление после сбоя — файлов: ${restored.length}, событий влито: ${mergedEvents} (снимок браузера от ${body.savedAt ?? '—'})`,
      { restored, mergedEvents, source: 'browser-vault' }
    )
    snapshotNow('vault-restore')
  }

  return NextResponse.json({ restored, skipped, mergedEvents })
}
