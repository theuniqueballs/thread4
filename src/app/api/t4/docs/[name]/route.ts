import { NextResponse } from 'next/server'
import path from 'node:path'

import { readText, DOCS_DIR } from '@/lib/t4/fsutil'

export const dynamic = 'force-dynamic'

const TITLES: Record<string, string> = {
  constitution: 'Конституция',
  taste: 'Вкус',
  facts: 'Рендерер-факты',
  forge: 'Кузница движков',
  niche: 'Ниша (доктрина)',
}

const FILES: Record<string, string> = {
  constitution: 'CONSTITUTION.md',
  taste: 'TASTE.md',
  facts: 'RENDERER_FACTS.md',
  forge: 'ENGINE_FORGE.md',
  niche: 'NICHE.md',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
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
