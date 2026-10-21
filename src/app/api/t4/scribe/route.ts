/**
 * THREAD 4 — AUTO-SCRIBE route (по приказу автора 2026-09-20).
 * POST { slug, maxRepairRounds? } → машина пишет черновик батча по
 * контракту, гейты гоняют его всухую, ремонт до N кругов. Официальная
 * сдача — отдельный шаг (/api/t4/gates { slug, deliver: true } или CLI).
 *
 * ИНЦИДЕНТ «писец не дошёл: Не удалось записать» (2026-10-18, Т4-42/43/44):
 * писец пишет 2–6 минут, ответ приходил ОДНИМ куском в конце — платформенный
 * шлюз рвёт молчаливые соединения через ~60–90с, клиент получал network-error,
 * а невымаскированный текст умирал в ledgerWriteError → «Не удалось записать»
 * без причины. Тем временем СЕРВЕР продолжал писать — ретрай автора поверх
 * встречал «уже существует» или дубль: рождались призраки.
 *
 * Лекарство (2026-10-19, восстановлено после отката платформы): маршрут —
 * NDJSON-ПОТОК: {t:'log'} — живой прогресс писца, {t:'ping'} — heartbeat
 * каждые 10с тишины (шлюз видит живое соединение и не режет), {t:'done'} —
 * результат, {t:'error'} — настоящая причина отказа. Прогон живёт на
 * сервере даже если клиент ушёл — файлы и события пишет scribeBatch.
 */
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { scribeBatch } from '@/lib/t4/scribe'
import { warmConsciousness } from '@/lib/t4/consciousness'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

const HEARTBEAT_MS = 10_000

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): писец жгёт LLM-квоту, пишет batches/*.md
   * и событие scribe.drafted — только с ключом командира. */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: { slug?: string; maxRepairRounds?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = (body.slug ?? '').trim()
  /* аудит 2026-10-12: суффиксные слаги (T4-27.2-EXP) легальны — как в
   * batch-verdict; [A-Za-z0-9] после разделителя исключает '..' и '/' */
  if (!/^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }
  const maxRepairRounds =
    typeof body.maxRepairRounds === 'number' ? Math.max(0, Math.min(4, Math.floor(body.maxRepairRounds))) : 3

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
        } catch {
          closed = true /* клиент ушёл — сервер дописывает молча */
        }
      }
      /* heartbeat: шлюз рвёт молчаливые потоки — писец молчит минутами
       * (LLM), поток обязан тикать (инцидент Т4-42/43/44) */
      const beat = setInterval(() => send({ t: 'ping' }), HEARTBEAT_MS)
      try {
        /* Фаза 2/итерация 3: сознание — живой движок. Прогрев прод-цепи до
         * писца: охраны «уже сдан» и гейты фолдят хронику движка. Недоступен —
         * настоящая причина на проводе ({t:'error'}), не молчаливый откат. */
        await warmConsciousness()
        const result = await scribeBatch(slug, {
          maxRepairRounds,
          onLog: (line: string) => send({ t: 'log', line }),
        })
        clearInterval(beat)
        send({
          t: 'done',
          result: {
            ok: true,
            slug: result.slug,
            title: result.title,
            rounds: result.rounds,
            hardPass: result.hardPass,
            sha10: result.sha10,
            failedSlots: result.failedSlots,
            log: result.log,
            receipts: result.receipts.map((r) => ({
              gate: r.gate,
              level: r.level,
              verdict: r.verdict,
              findings: r.findings,
            })),
          },
        })
      } catch (e) {
        clearInterval(beat)
        /* настоящая причина — на проводе, не «Не удалось записать» */
        send({ t: 'error', error: clientErrorMessage(e) || 'scribe failed' })
      } finally {
        clearInterval(beat)
        closed = true
        try {
          controller.close()
        } catch {
          /* уже закрыт */
        }
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      /* прокси не буферизует поток — байты идут клиенту сразу */
      'x-accel-buffering': 'no',
    },
  })
}
