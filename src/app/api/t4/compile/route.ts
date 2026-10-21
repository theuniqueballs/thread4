import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { compileBatch, contractMarkdown } from '@/lib/t4/compiler'
import { isConsciousnessError, warmConsciousness } from '@/lib/t4/consciousness'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  /* Залп 1 (аудит 2026-10-12): компиляция пишет контракты на диск и событие
   * batch.compiled в летопись — только с ключом командира (до раунда
   * роут был открыт, хотя дашборд достижим через шлюз :81). */
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: {
    theme?: string
    ocOrders?: string[]
    ocThemes?: Record<string, string>
    engine?: string
    exquisite?: number
    exploratory?: number
    authorPin?: string[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const theme = (body.theme ?? '').trim()
  if (!theme) {
    return NextResponse.json({ error: 'theme required' }, { status: 400 })
  }
  /* аудит 2026-10-12: капы входа — тема течёт в контракт, летопись и
   * промпты писца; безлимитная тема = раздувание летописи и токенов */
  if (theme.length > 500) {
    return NextResponse.json({ error: 'theme too long (≤500 символов)' }, { status: 413 })
  }
  // author's OC themes: keep only sane string→string pairs (≤300 chars each)
  const ocThemes: Record<string, string> = {}
  if (body.ocThemes && typeof body.ocThemes === 'object' && !Array.isArray(body.ocThemes)) {
    for (const [k, v] of Object.entries(body.ocThemes)) {
      const name = k.trim()
      if (name && typeof v === 'string' && v.trim()) {
        ocThemes[name] = v.trim().slice(0, 300)
      }
    }
  }
  try {
    /* Фаза 2/итерация 3: сознание — живой движок. Прогрев прод-цепи ДО
     * компиляции: ротация ОС фолдит хронику движка (∪ файл-хвост).
     * Недоступен — честный 503 (ниже), не молчаливый откат на файл. */
    await warmConsciousness()
    const contract = compileBatch(theme, {
      ocOrders: Array.isArray(body.ocOrders)
        ? body.ocOrders.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8).map((s) => s.slice(0, 60))
        : undefined,
      ocThemes: Object.keys(ocThemes).length > 0 ? ocThemes : undefined,
      engine: typeof body.engine === 'string' && body.engine.trim() ? body.engine.trim().slice(0, 80) : undefined,
      exquisite: typeof body.exquisite === 'number' ? body.exquisite : undefined,
      exploratory: typeof body.exploratory === 'number' ? body.exploratory : undefined,
      // прицел автора (Залп 2, policy.author_pin): назначения вопреки статистике
      authorPin: Array.isArray(body.authorPin)
        ? body.authorPin.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 12).map((s) => s.slice(0, 120))
        : undefined,
    })
    return NextResponse.json({
      slug: contract.slug,
      markdown: contractMarkdown(contract),
      contract,
    })
  } catch (e) {
    if (isConsciousnessError(e)) {
      return NextResponse.json({ error: e.message, consciousness: 'unavailable' }, { status: 503 })
    }
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'compile failed' },
      { status: 500 }
    )
  }
}
