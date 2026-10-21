/**
 * THREAD 4 ENGINE — rematerialization RUNNER (Фаза 4 «зрячее окно»).
 *
 * Транзакционная половина рематериализации: скан легаси-заглушек,
 * чтение файл-истины (contracts → batches), квитанция payload.migrated +
 * обновление projection payload в ОДНОЙ транзакции на батч. Идемпотентно:
 * легаси-проверка + дедуп квитанции по slug — повтор ничего не плодит,
 * краш посреди прогона дочитывается следующим вызовом.
 * Чистое ядро маппинга — rematerialize.ts (его типчекает и корень).
 */
import fs from 'node:fs'
import type { Database } from 'bun:sqlite'

import { CONTRACTS_DIR, LEGACY_BATCHES_DIR } from '../lib/paths'
import { appendEventTx, countEvents, withTransaction } from './chain'
import { readChainPointer } from './db'
import { buildPlanFromContract, isLegacyPayload } from './rematerialize'

export interface MigrateOptions {
  /** только один слаг (административно), иначе все легаси-заглушки */
  slug?: string
}

export interface MigrateReport {
  migrated: { slug: string; sha10: string; source: string; slots: number; palettes: number }[]
  skipped: { slug: string; reason: string }[]
  missing: { slug: string; reason: string }[]
  events: number
  head: string
}

function readSourceContract(slug: string): { contract: Record<string, unknown>; source: string } | null {
  for (const [dir, label] of [
    [CONTRACTS_DIR, 'contracts'],
    [LEGACY_BATCHES_DIR, 'batches'],
  ] as const) {
    const file = `${dir}/${slug}.json`
    try {
      const raw = fs.readFileSync(file, 'utf-8')
      const contract = JSON.parse(raw) as Record<string, unknown>
      return { contract, source: `${label}/${slug}.json` }
    } catch {
      /* нет файла или битый json — пробуем следующий источник */
    }
  }
  return null
}

export function migratePayloads(db: Database, opts: MigrateOptions = {}): MigrateReport {
  const report: MigrateReport = { migrated: [], skipped: [], missing: [], events: 0, head: '' }
  const rows = (
    opts.slug
      ? db.prepare('SELECT slug, payload FROM t4_batches WHERE slug = ?').all(opts.slug)
      : db.prepare('SELECT slug, payload FROM t4_batches ORDER BY slug').all()
  ) as { slug: string; payload: string }[]

  const receiptExists = db.prepare(
    "SELECT 1 FROM t4_events WHERE type = 'payload.migrated' AND batch_slug = ? LIMIT 1",
  )

  for (const row of rows) {
    if (!isLegacyPayload(row.payload)) {
      report.skipped.push({ slug: row.slug, reason: 'payload не легаси-заглушка (уже зрячий)' })
      continue
    }
    if (receiptExists.get(row.slug) != null) {
      report.skipped.push({ slug: row.slug, reason: 'квитанция payload.migrated уже в цепи' })
      continue
    }
    const src = readSourceContract(row.slug)
    if (!src) {
      report.missing.push({ slug: row.slug, reason: 'файл-истины нет (contracts/batches *.json отсутствуют)' })
      continue
    }
    const at = new Date().toISOString()
    const built = buildPlanFromContract(row.slug, src.contract, at, src.source)
    withTransaction(db, () => {
      /* projection: payload + sha10 + счётчики канона согласуются с планом
       * (проекция — производное состояние; append-only неприкосновенность —
       * у СОБЫТИЙ цепи, квитанция несёт sha10 записанного) */
      db.prepare(
        'UPDATE t4_batches SET payload = ?, sha10 = ?, slots_total = ?, exp_slots = ?, ab_pairs = ? WHERE slug = ?',
      ).run(built.payloadJson, built.sha10, built.slots, built.exp, built.abPairs, row.slug)
      appendEventTx(db, {
        type: 'payload.migrated',
        summary: `План ${row.slug} рематериализован из файл-истины (${src.source}): ${built.slots} слотов, палитр ${built.palettes} — окно движка зряче (фаза 4)`,
        data: {
          slug: row.slug,
          source: src.source,
          sourceSha10:
            built.payload['migrated'] != null
              ? (built.payload['migrated'] as Record<string, unknown>)['sourceSha10']
              : null,
          slots: built.slots,
          exp: built.exp,
          abPairs: built.abPairs,
          palettes: built.palettes,
          payloadSha10: built.sha10,
        },
        batchSlug: row.slug,
      })
    })
    report.migrated.push({
      slug: row.slug,
      sha10: built.sha10,
      source: src.source,
      slots: built.slots,
      palettes: built.palettes,
    })
  }

  report.events = countEvents(db)
  report.head = readChainPointer(db).head
  return report
}
