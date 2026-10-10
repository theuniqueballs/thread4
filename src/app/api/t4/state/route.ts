import { NextResponse } from 'next/server'

import { foldState, nextBatchNumber, readEvents, verifyChain } from '@/lib/t4/events'
import { specInventory } from '@/lib/t4/specs'
import { GATES_TOTAL } from '@/lib/t4/gates'
import { listFiles, BATCHES_DIR, readCommanderKey, readText } from '@/lib/t4/fsutil'
import { scanSource } from '@/lib/t4/hygiene'
import path from 'node:path'

export const dynamic = 'force-dynamic'

export async function GET() {
  const events = readEvents()
  const state = foldState(events)
  const batches = listFiles(BATCHES_DIR, '.md')
  const inv = specInventory()
  const carriers = inv.find((s) => s.id === 'carriers')
  const poses = inv.find((s) => s.id === 'poses')
  const palettes = inv.find((s) => s.id === 'palettes')
  const delivered = state.batches.filter((b) => b.deliveredAt)
  const last = delivered[delivered.length - 1]
  // следующий номер — по максимальному НЕзакрытому слагу (T4-06 void не считается)
  const nextNum = nextBatchNumber(state.batches, state.voidedSlugs)
  const nextStep =
    delivered.length === 0
      ? `T4-${String(nextNum).padStart(2, '0')} — ждёт тему от автора`
      : `T4-${String(nextNum).padStart(2, '0')} — следующий цикл`

  return NextResponse.json({
    era: 'THREAD 4',
    lastBatch: last ? `${last.slug}${last.title ? ` «${last.title}»` : ''}` : '— (эра только родилась)',
    nextStep,
    gateHealth: `hard / warn / advisory — ${GATES_TOTAL} гейтов (закон 24 слотов)`,
    gatesTotal: GATES_TOTAL,
    voidedSlugs: state.voidedSlugs,
    counts: {
      batches: delivered.length,
      events: events.length,
      carriers: carriers?.count ?? 0,
      poses: poses?.count ?? 0,
      palettes: palettes?.count ?? 0,
    },
    openDebts: state.openDebts,
    /* Залп 1 «Правда» — здоровье стекла (полный таб «Стекло» — Залп 3) */
    glass: {
      commanderKey: readCommanderKey() != null,
      chain: (() => {
        const v = verifyChain()
        return { ok: v.ok, events: v.events, storedLinks: v.storedLinks, head: v.head?.slice(0, 10) ?? null, problems: v.problems }
      })(),
      atomicWrites: true,
      /* Issue #4 Кенни: grep-gate как живой булев (П-2 видно СЕЙЧАС), аптайм
         писца и последняя проверка восстановления — по чертежу Cortex */
      grepGate: scanSource(path.join(process.cwd(), 'src', 'lib', 't4')).length === 0,
      scribeLastDraft:
        events
          .filter((e) => e.type === 'scribe.drafted')
          .at(-1)?.at ?? null,
      lastRecoveryCheck:
        events
          .filter((e) => e.type === 'note' && e.summary.includes('VAULT'))
          .at(-1)?.at ?? null,
      /* Метрика 4.2 (ответ автора Q10/Q12): сколько времени жрёт система у
         автора. Цикл = batch.delivered → последний вердикт по этому слагу.
         Цель: 1.5 часа творчества — настройка нас не должна её превышать. */
      authorCycle: (() => {
        const delivered = events.filter((e) => e.type === 'batch.delivered').at(-1)
        if (!delivered) return null
        const slug = String(delivered.data?.slug ?? '')
        const last = events
          .filter((e) => e.type === 'render.verdict' && String(e.data?.slug ?? '') === slug)
          .at(-1)
        if (!last) return { slug, hours: null, note: 'вердиктов ещё нет — цикл не замкнут' }
        const hours =
          Math.round(((new Date(last.at).getTime() - new Date(delivered.at).getTime()) / 3600000) * 10) / 10
        return { slug, hours }
      })(),
      /* Issue #2 + #5 Кенни: доверенная граница чтения — объявлена, а не молчит.
         Слои границы: (1) dev слушает 127.0.0.1 (-H в package.json);
         (2) Caddyfile перед Next — XTransformPort (Issue #5).
         Преемник Фреда, 2026-10-10: слой (2) больше не захардкожен строкой —
         читается из фактического Caddyfile (зажат/штрокер wildcard), чтобы
         Стекло (П-8 «честная хрупкость») не врало при смене машины/сандбокса.
         Внешний доступ = read-key, не молчание. */
      readBoundary: (() => {
        const caddy = readText(path.join(process.cwd(), 'Caddyfile'))
        if (caddy == null) {
          return 'Caddyfile не читается — граница НЕ объявлена (внешний доступ = read-key, не молчание; почини файл)'
        }
        if (/XTransformPort=\*/.test(caddy)) {
          return 'gateway :81 → 3000 · XTransformPort=* (платформенный wildcard — режим мини-сервисов; шире замка Issue #5, ворота держит платформа) · dev bind проверять в package.json (-H 127.0.0.1) · внешний доступ = read-key, не молчание'
        }
        if (/XTransformPort=3000/.test(caddy)) {
          return 'loopback-only: dev -H 127.0.0.1 + Caddyfile XTransformPort зажат на 3000 (проверять оба слоя; внешний доступ = read-key, не молчание)'
        }
        return 'gateway :81 → 3000 · XTransformPort не распознан в Caddyfile — граница объявлена не полностью (внешний доступ = read-key, не молчание)'
      })(),
    },
  })
}
