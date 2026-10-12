/**
 * THREAD 4 — командный замок API (Залп 1 «Правда», расширен аудитом
 * 2026-10-12).
 *
 * ДО этого раунда замок стоял только на POST /api/t4/events и POST
 * /api/t4/vault — остальные мутирующие роуты (compile, gates+deliver,
 * scribe, contract-draft, batch-verdict, feedback, vlm, zai-мост) писали
 * диск и летопись и жгли LLM-квоту БЕЗ ключа, при том что дашборд
 * достижим снаружи через шлюз :81 (Caddyfile, Issue #5). Единый гвард
 * закрывает весь класс: любая запись состояния или платный вызов —
 * только с ключом командира.
 *
 * GET-роуты не лочатся: граница чтения объявлена честно в /api/t4/state
 * («внешний доступ = read-key, не молчание», Issue #2) и выполняется
 * следующим шагом. Исключение — GET /api/t4/vault: он отдаёт ПОЛНЫЙ
 * бандл (батчи, контракты, спеки, log.jsonl), приравнен к записи.
 *
 * Сравнение — timing-safe: timingSafeEqual по sha256 ОБЕИХ сторон, чтобы
 * ни содержание, ни длина ключа не различались временем ответа.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { NextResponse } from 'next/server'

import { readCommanderKey } from './fsutil'

export function commanderKeyMatches(provided: string, expected: string): boolean {
  const ha = crypto.createHash('sha256').update(provided, 'utf-8').digest()
  const hb = crypto.createHash('sha256').update(expected, 'utf-8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

export type CommanderGuard = { ok: true } | { ok: false; response: NextResponse }

/** Единый замок для всех мутирующих хендлеров (fail-closed: нет ключа
 *  на сервере — мутации закрыты с 503 setupRequired, как и раньше на
 *  POST /events — менять семантику «Залп 1» нельзя). */
export function requireCommander(req: Request): CommanderGuard {
  const key = readCommanderKey()
  if (key == null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'commander-key не создан — мутации залочены (Залп 1 «Правда»)',
          setupRequired: true,
          hint: 'создай ~/.t4/commander.key (32+ случайных символа) и передавай его в заголовке x-commander-key',
        },
        { status: 503 }
      ),
    }
  }
  const provided = req.headers.get('x-commander-key') ?? ''
  if (!commanderKeyMatches(provided, key)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'чужой или пустой commander-key — операция запрещена' },
        { status: 403 }
      ),
    }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Граница чтения — read.lock (ISSUE 15 / #47, аудит 2026-10-12:        */
/* «read-key не реализован, Issue #2 закрыт декларативно»).              */
/*                                                                      */
/* Файл-флаг ~/.t4/read.lock — ОПЦИОНАЛЕН (спорное решение через         */
/* фичу-флаг, умолчание = прежнее поведение):                           */
/*   файла нет  → GET /api/t4/* открыты (локальная машина автора,       */
/*                дашборд loopback-only — читает сам автор);            */
/*   файл есть  → чтение конвейера = привилегия командира: все GET      */
/*                требуют валидный x-commander-key.                     */
/* Отдельного read.key НЕТ намеренно: один оператор — один секрет       */
/* (меньше поверхностей утечки); отделить ключ просмотра можно будет,   */
/* когда появится второй читатель. Стекло (glass.readBoundary) честно   */
/* репортит фактическое состояние флага.                                 */
/* ------------------------------------------------------------------ */

export function readLocked(): boolean {
  try {
    return fs.existsSync(path.join(os.homedir(), '.t4', 'read.lock'))
  } catch {
    return false
  }
}

/** Гвард чтения: без read.lock — свободно; с read.lock — ключ командира. */
export function requireRead(req: Request): CommanderGuard {
  if (!readLocked()) return { ok: true }
  const guard = requireCommander(req)
  if (!guard.ok) {
    /* ответ сохраняет статус/тело Залпа 1, но с внятным для чтения текстом */
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'чтение залочено (~/.t4/read.lock) — вставь ключ командира в Стекле',
          readLocked: true,
        },
        { status: 403 }
      ),
    }
  }
  return { ok: true }
}
