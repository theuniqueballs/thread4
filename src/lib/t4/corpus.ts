/**
 * THREAD 4 — CORPUS QUEUE (U6, Corpus 2.0): очередь взглядов автора →
 * золотой корпус. Ритуал кураторства (`cli.ts corpus take/drop`) решает,
 * что из очереди уходит в specs/golden-corpus.json.
 *
 * Ревизия 2026-10-14 (категория 3.5): правило «взгляд автора ≥40 символов»
 * жило инлайном ТОЛЬКО в events/route.ts — вердикты, записанные батч-приёмником
 * (batch-verdict, «одной записью», source=author-batch), в очередь НЕ попадали:
 * слепая зона ровно там, где автор теперь пишет вердикты. Правило переехало
 * в lib — обе точки входа кормят одну очередь.
 *
 * Best-effort: сбой записи очереди никогда не роняет запись вердикта
 * (очередь не критична для летописи — критично не потерять вердикт).
 */
import fs from 'node:fs'
import path from 'node:path'

import { withEventLock, type T4Event } from './events'

/** Порог «взгляда» (U6): короче — это клик, не высказывание. */
export const AUTHOR_GAZE_MIN = 40

/** Вердикт автора с взглядом: render.verdict, source author*, проза ≥ порога. */
export function authorGazeWorthy(evt: T4Event): { worthy: boolean; prose: string; source: string } {
  const d = (evt.data ?? {}) as { prose?: unknown; source?: unknown }
  const prose = typeof d.prose === 'string' ? d.prose.trim() : ''
  const source = typeof d.source === 'string' ? d.source : ''
  return {
    worthy: evt.type === 'render.verdict' && source.startsWith('author') && prose.length >= AUTHOR_GAZE_MIN,
    prose,
    source,
  }
}

/** Положить взгляд в очередь (batch-уровень — position пустой, слотовой —
 *  с позицией). true = записано. Событие летописи НЕ трогаем. */
export function feedCorpusQueue(
  evt: T4Event,
  queuePath: string = path.join(process.cwd(), 'thread4', 'corpus-queue.jsonl')
): boolean {
  const { worthy, prose, source } = authorGazeWorthy(evt)
  if (!worthy) return false
  try {
    const d = (evt.data ?? {}) as Record<string, unknown>
    /* Аудит №4 (2026-10-17, strict, race): запись очереди шла ВНЕ
     * событийного лока — параллельные batch-verdict/feedback POSTы могли
     * интерливить строки, а читатель CLI (`corpus`) падал жёстким
     * JSON.parse на разорванной строке. Теперь под withEventLock: append
     * сериализуется с летописью и с себе подобными; читатель
     * терпи́м к хвосту (cli.ts). */
    withEventLock(() => {
      fs.appendFileSync(
        queuePath,
        JSON.stringify({
          id: evt.id,
          at: evt.at,
          slug: String(d.slug ?? ''),
          position: String(d.position ?? ''),
          verdict: String(d.verdict ?? (d.mode === 'light' ? 'light' : 'batch')),
          source,
          confidence: String(d.confidence ?? ''),
          prose: prose.slice(0, 400),
        }) + '\n',
        'utf-8'
      )
    })
    return true
  } catch {
    /* очередь не критична для записи вердикта (U6) */
    return false
  }
}
