/**
 * THREAD 5 — VERDICTS (эра T5, 2026-10-24).
 *
 * Вердикт автора — единственный источник закона (§4 CANON). Append-only
 * JSONL: thread5/verdicts.jsonl. Ключа НЕТ: приложение loopback-only,
 * T5 отказался от инфраструктуры доступа (вердикт- author 2026-10-24).
 * GET  /api/t5/verdict?slug=T5-01 → [{at, slug, position, verdict, note}]
 * POST /api/t5/verdict {slug, position, verdict: good|meh|dead, note}
 */
import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FILE = path.join(process.cwd(), 'thread5', 'verdicts.jsonl')
const VERDICTS = new Set(['good', 'meh', 'dead'])

interface VerdictEntry {
  at: string
  slug: string
  position: number
  verdict: string
  note: string
}

function readAll(): VerdictEntry[] {
  try {
    return fs
      .readFileSync(FILE, 'utf-8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as VerdictEntry)
      .filter((v) => v && typeof v.slug === 'string')
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug')
  const all = readAll()
  return NextResponse.json({
    ok: true,
    data: { verdicts: slug != null && slug !== '' ? all.filter((v) => v.slug === slug) : all },
  })
}

export async function POST(req: Request) {
  let body: { slug?: unknown; position?: unknown; verdict?: unknown; note?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const slug = typeof body.slug === 'string' ? body.slug : ''
  const position = typeof body.position === 'number' && Number.isInteger(body.position) ? body.position : -1
  const verdict = typeof body.verdict === 'string' ? body.verdict : ''
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : ''
  if (!/^T5-\d{2}[-.A-Za-z0-9]*$/.test(slug) || position < 1 || position > 99 || !VERDICTS.has(verdict)) {
    return NextResponse.json(
      { error: 'нужно: slug T5-NN, position 1..99, verdict good|meh|dead' },
      { status: 400 }
    )
  }
  const entry: VerdictEntry = { at: new Date().toISOString(), slug, position, verdict, note }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.appendFileSync(FILE, `${JSON.stringify(entry)}\n`, 'utf-8')
    return NextResponse.json({ ok: true, data: { entry } })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'verdicts.jsonl не пишется' },
      { status: 500 }
    )
  }
}
