/**
 * THREAD 4 ENGINE — boot sequence.
 *
 *   1. Code-as-Config validation (Zod + canon arithmetic) — a broken
 *      canon kills the boot BEFORE the port opens;
 *   2. bun:sqlite open + idempotent DDL migration;
 *   3. one-time legacy chronicle import (chain preserved, no rebase);
 *   4. Bun.serve() on 127.0.0.1:3200 — the Single Source of Truth.
 *
 * Crash doctrine: uncaught exceptions are logged, the process survives
 * (Bun isolates request failures); SIGTERM flushes the git snapshot so
 * the last mutation is never lost to a shutdown race.
 */
import { validateCanon } from './src/config/canon'
import { openDatabase, schemaVersion } from './src/core/db'
import { countEvents, verifyChain } from './src/core/chain'
import { migrateLegacyChronicle } from './src/core/migrate-jsonl'
import { serve } from './src/rpc/server'
import { flushSnapshotNow } from './src/lib/persist'

function boot(): void {
  const { canon } = validateCanon()
  console.log(
    `[t4-engine] canon ok: era=${canon.era} v${canon.version} FAM ${canon.fam} · slots=${canon.slots.total}+EXP≤${canon.slots.expMax} · палитры: фонд ${canon.palette.fund} + резерв ${canon.palette.extensionLastId - canon.palette.extensionFirstId + 1}`
  )

  const db = openDatabase()
  console.log(`[t4-engine] sqlite open (WAL, busy_timeout 5s) · schema v${schemaVersion()}`)

  const migration = migrateLegacyChronicle(db)
  if (migration.skipped) {
    console.log(`[t4-engine] летопись: импорт не нужен (${migration.problems[0] ?? 'уже импортирована'})`)
  } else {
    console.log(
      `[t4-engine] летопись: импортировано ${migration.imported} событий · цепь ${migration.chainVerified ? 'ЦЕЛА' : 'С РАЗНОГЛАСИЯМИ'} · батчей ${migration.batchesFolded} · вердиктов ${migration.verdictsFolded}`
    )
    for (const p of migration.problems.slice(0, 5)) console.warn(`[t4-engine] migration: ${p}`)
  }

  const chain = verifyChain(db)
  console.log(
    `[t4-engine] chain: ${chain.events} звеньев · head ${chain.head?.slice(0, 10) ?? '—'} · ${chain.ok ? 'ЦЕЛА' : `ПРОБЛЕМ: ${chain.problems.length}`}`
  )
  if (!chain.ok) for (const p of chain.problems.slice(0, 5)) console.warn(`[t4-engine] chain: ${p}`)

  const server = serve(db)
  console.log(
    `[t4-engine] LISTENING http://${canon.serve.hostname}:${canon.serve.port} (шлюз :81 → ?XTransformPort=${canon.serve.port}) · событий в базе: ${countEvents(db)}`
  )
  console.log(`[t4-engine] SSoT для дашборда Next.js и CLI. Мутации: только x-commander-key (Залп 1 «Правда»).`)

  process.on('SIGTERM', () => {
    console.log('[t4-engine] SIGTERM — flush git snapshot и выход')
    flushSnapshotNow('sigterm')
    server.stop(true)
    process.exit(0)
  })
  process.on('SIGINT', () => {
    flushSnapshotNow('sigint')
    server.stop(true)
    process.exit(0)
  })
  process.on('uncaughtException', (e) => {
    console.error('[t4-engine] uncaughtException (процесс живёт):', e)
  })
  process.on('unhandledRejection', (e) => {
    console.error('[t4-engine] unhandledRejection (процесс живёт):', e)
  })
}

boot()
