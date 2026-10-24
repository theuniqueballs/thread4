/**
 * THREAD 5 — BATCHES (эра T5, 2026-10-24).
 *
 * Чистое чтение thread5/batches/*.md. Ключа НЕТ сознательно: приложение
 * loopback-only (127.0.0.1), вся боль «ключ-мост-движок» похоронена вместе
 * с конвейером T4 — T5 = чат-писец + файлы + этот простой UI.
 * GET /api/t5/batches            → [{slug, title, engine}]
 * GET /api/t5/batches?slug=T5-01 → {slug, title, markdown}
 */
import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DIR = path.join(process.cwd(), 'thread5', 'batches')

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  try {
    if (slug != null && slug !== '') {
      if (!/^T5-\d{2}[-.A-Za-z0-9]*$/.test(slug)) {
        return NextResponse.json({ error: 'slug expected: T5-NN' }, { status: 400 })
      }
      const file = path.join(DIR, `${slug}.md`)
      const markdown = fs.readFileSync(file, 'utf-8')
      const title = /^# (.+)$/m.exec(markdown)?.[1] ?? slug
      return NextResponse.json({ ok: true, data: { slug, title, markdown } })
    }
    const files = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
    const batches = files.map((f) => {
      const md = fs.readFileSync(path.join(DIR, f), 'utf-8')
      return {
        slug: f.replace(/\.md$/, ''),
        title: /^# (.+)$/m.exec(md)?.[1] ?? f,
        engine: /^ДВИЖОК: (.+)$/m.exec(md)?.[1]?.slice(0, 120) ?? '',
      }
    })
    return NextResponse.json({ ok: true, data: { batches } })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'thread5/batches не читается' },
      { status: 500 }
    )
  }
}
