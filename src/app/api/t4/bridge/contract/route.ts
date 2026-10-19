/**
 * THREAD 4 — BRIDGE · CONTRACT (cutover-эра, 2026-10-20).
 *
 * Этап «Компиляция» единого конвейера: Rust собирает реестр канона сам
 * (byte-parity), а сюда приходит за БРИФОМ ПИСЦА — файловым контрактом
 * (позы/стеки/лиды/дресс/окна). Два прохода: первый — узнать, каких ОС
 * назначила ротация; второй — с авторскими углами OC (theme на позицию
 * привязывается к ИМЕНИ из ротации; детерминизм компилятора гарантирует
 * те же имена во втором проходе).
 *
 * COMPUTE-ONLY: dryRun-компиляция, НИКАКИХ файлов/событий — контракт на
 * диск пишет Rust (единый писатель летописи и артефактов).
 */
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { compileBatch, contractMarkdown, type BatchContract } from '@/lib/t4/compiler'

import { bridgeSlug } from '@/lib/t4/bridge-serve'

export const dynamic = 'force-dynamic'

interface OcThemeInput {
  position?: unknown
  theme?: unknown
  rating?: unknown
}

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: {
    slug?: unknown
    theme?: unknown
    engine?: unknown
    ocThemes?: unknown
    authorWishes?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const slug = bridgeSlug(body.slug)
  if (slug == null) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }
  const theme = typeof body.theme === 'string' ? body.theme.trim() : ''
  if (theme === '' || theme.length > 300) {
    return NextResponse.json({ error: 'theme обязателен (1..300 симв)' }, { status: 400 })
  }
  const engine = typeof body.engine === 'string' && body.engine.trim() !== ''
    ? body.engine.trim().slice(0, 80)
    : undefined
  const authorWishes = typeof body.authorWishes === 'string' ? body.authorWishes.trim().slice(0, 2000) : ''
  const ocInputs: OcThemeInput[] = Array.isArray(body.ocThemes) ? (body.ocThemes as OcThemeInput[]).slice(0, 3) : []

  try {
    /* проход 1: ротация ОС (детерминизм = те же имена в проходе 2) */
    const first = compileBatch(theme, { slug, engine, dryRun: true })

    /* авторские углы: позиция 1..3 → имя ОС из ротации */
    const ocThemes: Record<string, string> = {}
    for (const o of ocInputs) {
      const pos = typeof o.position === 'number' && o.position >= 1 && o.position <= 3 ? o.position : null
      const angle = typeof o.theme === 'string' ? o.theme.trim().slice(0, 300) : ''
      if (pos == null || angle === '') continue
      const name = first.ocRotation[pos - 1]?.name
      if (name) ocThemes[name] = angle
    }

    /* проход 2: контракт с углами автора на ротационных лицах */
    const contract: BatchContract = compileBatch(theme, {
      slug,
      engine,
      ocThemes: Object.keys(ocThemes).length > 0 ? ocThemes : undefined,
      dryRun: true,
    })
    if (authorWishes !== '') contract.authorWishes = authorWishes

    return NextResponse.json({
      ok: true,
      data: { contract, markdown: contractMarkdown(contract) },
    })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'contract compile failed' },
      { status: 500 }
    )
  }
}
