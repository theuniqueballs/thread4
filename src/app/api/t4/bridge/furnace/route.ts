/**
 * THREAD 4 — BRIDGE · FURNACE / ПЕЧЬ (эра ARS, приказ автора 2026-10-23).
 *
 * Последняя инстанция перед сдачей: LLM-оценщик смотрит, ЧТО налепили
 * предыдущие инстанции — (1) гейты: что поймали/что пропустили;
 * (2) тема: раскрыты ли истории в кадрах; (3) писец: сделал ли работу;
 * (4) итог. Составляет обширный репорт БЕЗ ПИЗДЕЖА: что получилось —
 * что нет. Машина (Rust) пишет артефакт и событие — роут compute-only.
 */
import path from 'node:path'
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { resolveLlmProvider } from '@/lib/t4/llm-provider'
import { chat } from '@/lib/t4/scribe'
import { readJson } from '@/lib/t4/fsutil'

import { bridgeSlug } from '@/lib/t4/bridge-serve'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

/** Брикеты сборщика — тот же репетиционный каталог, что читает Rust. */
const REHEARSALS_DIR = path.join(
  process.cwd(),
  'mini-services',
  't4-engine-rs',
  'data',
  'rehearsals'
)

const SYSTEM = `You are FURNACE — the evaluation agent of THREAD 4, an anime-prompt batch pipeline. You are the LAST instance before delivery. Every previous instance (theme expander ARS NOVEAU, mechanical compiler, briquette collector, the scribe, the machine gates) has already done its work. Your job: look at WHAT THEY BUILT and write an HONEST, EXTENSIVE report — no bullshit, no flattery, no hedging. The author reads you before deciding to render.

You evaluate FOUR areas:
1. GATES — the machine receipts below: what did the gates CATCH, what did they MISS (compare receipt findings against the actual batch text: a clean receipt over a broken slot is a gate miss — name the slot and the broken law).
2. THEME — the batch was born from per-slot STORIES (scene/environment/vibe/lighting/outfit/character per slot). For each briquetted slot: did the story survive into the POS tags? A story that lives only in THESIS or the header is LOST. Count stories delivered / lost, name the lost ones.
3. SCRIBE — the regulations: face block as tags in every POS; canon colors verbatim early; ONE tag run ending "masterpiece, best quality, anime artstyle."; no names in POS; no age words; tier budget respected (no higher-tier signals than the slot's rating); NEG-EXTRA guards without forbidden №25 terms; assigned pose/palette/carriers present; EXP slots theme-free but WITH their core-4 carriers and A/B discipline.
4. VERDICT — what worked, what didn't, and WHY. Be specific: slot numbers, exact tags, exact omissions.

Severity scale: critical (batch must not ship as-is) · warn (ships, author should know) · note (observation).
Verdict: PASS (clean) · WARN (ships with receipts) · FAIL (do not ship without author's explicit override; name the blockers).

OUTPUT: STRICT JSON ONLY, no markdown fences:
{"verdict":"PASS|WARN|FAIL","summary":"3-6 sentences, the honest bottom line","themeRead":"stories delivered X/N + the lost ones by slot and why","scribeWork":"regulation check results, broken slots by number","gatesEcho":"what gates caught vs missed","findings":[{"area":"gates|theme|scribe|structure","slot":"P07","severity":"critical|warn|note","note":"specific, quoted evidence"}],"strengths":["what genuinely worked"]}`

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: {
    slug?: unknown
    theme?: unknown
    batch?: unknown
    receipts?: unknown
    contract?: unknown
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
  const batch = typeof body.batch === 'string' ? body.batch : ''
  if (batch.trim() === '') {
    return NextResponse.json({ error: 'batch (текст черновика) expected' }, { status: 400 })
  }
  const theme = typeof body.theme === 'string' ? body.theme : ''

  const receipts = Array.isArray(body.receipts)
    ? (body.receipts as unknown[])
        .map((r) => {
          const rec = (r ?? {}) as Record<string, unknown>
          const gate = typeof rec['gate'] === 'string' ? rec['gate'] : '?'
          const level = typeof rec['level'] === 'string' ? rec['level'] : '?'
          const verdict = typeof rec['verdict'] === 'string' ? rec['verdict'] : '?'
          const findings = Array.isArray(rec['findings'])
            ? (rec['findings'] as unknown[]).filter((f) => typeof f === 'string').slice(0, 4)
            : []
          return `[${gate}/${level}] ${verdict}${findings.length > 0 ? ` — ${findings.join(' | ')}` : ''}`
        })
        .slice(0, 60)
    : []

  /* брикеты — сжатая выжимка историй по слотам (полный артефакт читает
   * Rust; печи нужны истории + механика, без законов) */
  const briquettes = readJson<{ briquettes?: unknown[] }>(
    path.join(REHEARSALS_DIR, 'briquettes', `${slug}.json`)
  )
  const storyLines = ((briquettes?.briquettes ?? []) as Record<string, unknown>[])
    .slice(0, 40)
    .map((b) => {
      const pos = b['position']
      const kind = b['kind']
      const rating = b['rating']
      const story = (b['story'] ?? {}) as Record<string, unknown>
      const bits = ['title', 'scene', 'environment', 'lighting', 'outfit', 'character', 'thesis']
        .map((k) => {
          const v = story[k]
          return typeof v === 'string' && v.trim() !== '' ? `${k}: ${v.trim()}` : ''
        })
        .filter(Boolean)
        .join(' · ')
      const mech = (b['mechanics'] ?? {}) as Record<string, unknown>
      const pose = typeof mech['poseName'] === 'string' ? mech['poseName'] : ''
      const palette = typeof mech['palette'] === 'string' ? mech['palette'] : ''
      return `P${String(pos).padStart(2, '0')} ${kind} ${rating} · pose ${pose} · ${palette}\n  story: ${bits}`
    })
    .join('\n')

  const user = `BATCH ${slug}${theme !== '' ? ` «${theme}»` : ''}

=== MACHINE GATE RECEIPTS (что поймала машина) ===
${receipts.length > 0 ? receipts.join('\n') : '(квитанций нет)'}

=== BRIQUETTES: stories the batch was born from (что ДОЛЖНО было доехать) ===
${storyLines !== '' ? storyLines : '(брикетов нет — батч писался без историй: это само по себе находка critical)'}

=== THE BATCH ITSELF (черновик, как он будет сдан) ===
${batch.slice(0, 90_000)}

Evaluate honestly. The author renders from this file; your report is the last chance to catch what the machine missed.`

  try {
    const provider = resolveLlmProvider()
    const raw = await chat(provider, SYSTEM, user, [])
    const text = raw.replace(/```(?:json)?/gi, '').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return NextResponse.json(
        { error: `печь: репорт не распарсился — сырой ответ (первые 300): ${text.replace(/\s+/g, ' ').slice(0, 300)}` },
        { status: 502 },
      )
    }
    const report = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    return NextResponse.json({ ok: true, data: { report } })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'furnace failed' },
      { status: 500 },
    )
  }
}
