import { NextResponse } from 'next/server'

import { requireRead } from '@/lib/t4/apiguard'
import path from 'node:path'

import { readText, DOCS_DIR } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

const TITLES: Record<string, string> = {
  constitution: 'Конституция',
  taste: 'Вкус',
  facts: 'Рендерер-факты',
  forge: 'Кузница движков',
  niche: 'Ниша (доктрина)',
  'verdict-analysis': 'Анализ вердиктов (24 записи, T4-02 → T4-28)',
}

const FILES: Record<string, string> = {
  constitution: 'CONSTITUTION.md',
  taste: 'TASTE.md',
  facts: 'RENDERER_FACTS.md',
  forge: 'ENGINE_FORGE.md',
  niche: 'NICHE.md',
  'verdict-analysis': 'docs/VERDICT-ANALYSIS-2026-10-11.md',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
)
  const read = requireRead(req)
  if (!read.ok) return read.response {
  const { name } = await params
  const file = FILES[name]
  if (!file) {
    return NextResponse.json({ error: 'unknown doc' }, { status: 404 })
  }
  const markdown = readText(path.join(DOCS_DIR, file))
  if (markdown == null) {
    return NextResponse.json({ error: 'doc missing' }, { status: 404 })
  }
  return NextResponse.json({ title: TITLES[name], markdown })
}
