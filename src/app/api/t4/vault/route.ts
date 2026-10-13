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

import { requireCommander } from '@/lib/t4/apiguard'
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
import { appendEvent, bootstrapChain, readEvents, withEventLock, type T4Event } from '@/lib/t4/events'
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

/* thread4/docs/ — аналитические документы раундов («Анализ вердиктов»
 * 2026-10-11); раньше не собирались в сейф — единственный документ,
 *  переживший контейнер только в браузере, был бы потерян (9-c №18c) */
const ANALYTICS_DIR_NAME = 'docs'

export async function GET(req: Request) {
  /* Аудит 2026-10-12: GET отдаёт ПОЛНЫЙ бандл (батчи, контракты, спеки,
   * log.jsonl) — приравнен к записи, лочится тем же ключом командира.
   * Клиент (Стекло) уже хранит ключ и прикладывает его к обоим вызовам. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
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
  collectDir(path.join(DOCS_DIR, ANALYTICS_DIR_NAME), '.md', files)
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
const SAFE_DOC = /^thread4\/(docs\/)?[A-Z][A-Za-z0-9._-]*\.md$/
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
  /* восстановление переписывает диск — только с ключом командира
   * (аудит 2026-10-12: единый гвард apiguard, timing-safe) */
  const guard = requireCommander(request)
  if (!guard.ok) return guard.response

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
    /* Ревизия 2026-10-13: слияние лога — одна критическая секция под
     * событийным локом. Раньше writeText(EVENT_LOG) шёл ВНЕ лока, а
     * bootstrapChain — под ним: параллельный appendEvent из другого
     * процесса (CLI/дашборд) интерливился с переписыванием лога —
     * событие терялось молча. Чтение-слияние-запись-rebase атомарны. */
    const histEvents = withEventLock(() => {
      const diskEvents = readEvents()
      const diskIds = new Set(diskEvents.map((e) => e.id))
      const hist = parseLog(incomingLog).filter((e) => !diskIds.has(e.id))
      if (hist.length > 0) {
        /* события вставляем в хронологическом порядке (fold зависит от порядка) */
        const merged = [...diskEvents, ...hist].sort((a, b) =>
          a.at < b.at ? -1 : a.at > b.at ? 1 : 0
        )
        writeText(EVENT_LOG, merged.map((e) => JSON.stringify(e)).join('\n') + '\n')
        /* лог переписан (rebase) — хеш-цепь перебазируется объявленно,
           иначе verify орал бы на каждую перезаписанную строку */
        bootstrapChain()
      }
      return hist
    })
    mergedEvents = histEvents.length
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
