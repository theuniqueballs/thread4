import { NextResponse } from 'next/server'

import { compileBatch } from '@/lib/t4/compiler'
import { contractMarkdown } from '@/lib/t4/compiler'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
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
    const contract = compileBatch(theme, {
      ocOrders: Array.isArray(body.ocOrders) ? body.ocOrders : undefined,
      ocThemes: Object.keys(ocThemes).length > 0 ? ocThemes : undefined,
      engine: typeof body.engine === 'string' && body.engine.trim() ? body.engine.trim() : undefined,
      exquisite: typeof body.exquisite === 'number' ? body.exquisite : undefined,
      exploratory: typeof body.exploratory === 'number' ? body.exploratory : undefined,
      // прицел автора (Залп 2, policy.author_pin): назначения вопреки статистике
      authorPin: Array.isArray(body.authorPin)
        ? body.authorPin.map(String).map((s) => s.trim()).filter(Boolean)
        : undefined,
    })
    return NextResponse.json({
      slug: contract.slug,
      markdown: contractMarkdown(contract),
      contract,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'compile failed' },
      { status: 500 }
    )
  }
}
