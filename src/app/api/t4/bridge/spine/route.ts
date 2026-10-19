/**
 * THREAD 4 — BRIDGE · SPINE (cutover-эра, 2026-10-20).
 *
 * Этап «Сборка» единого конвейера: одноразовый движок батча. LLM (спайн)
 * изобретает имя/закон/тезис/акты/тема-слова — вся остальная машина
 * (архив движка, событие engine.built, t4_builds) живёт в Rust.
 *
 * COMPUTE-ONLY: ни файлов, ни летописи. Контракт читается с диска — его
 * туда положил Rust на этапе «Компиляция».
 */
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { inventSpine } from '@/lib/t4/scribe'

import { bridgeContract, bridgeSlug } from '@/lib/t4/bridge-serve'

export const dynamic = 'force-dynamic'

/** LLM пишет минуты — маршрут живёт долго и молчит; шлюз тут не режет
 * (движок ждёт напрямую, без браузерного прокси). */
export const maxDuration = 600

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: { slug?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = bridgeSlug(body.slug)
  if (slug == null) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }
  const contract = bridgeContract(slug)
  if (contract == null) {
    return NextResponse.json({ error: `контракт ${slug} не найден — сначала «Компиляция»` }, { status: 404 })
  }

  try {
    const spine = await inventSpine(slug, contract, [], () => {})
    return NextResponse.json({
      ok: true,
      data: {
        build: {
          engineName: spine.engineName,
          engineLaw: spine.engineLaw,
          themeKeywords: spine.themeKeywords,
          thesis: spine.batchThesis,
          acts: spine.acts,
          parseWarning: spine.parseWarning,
        },
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'spine failed' },
      { status: 500 }
    )
  }
}
