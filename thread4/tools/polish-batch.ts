/**
 * polish-batch.ts — полировщик качества готового черновика (не переписывает
 * батч целиком): находит WARN-квитации гейтов, переписывает ТОЛЬКО
 * поражённые слоты (THESIS + POS), NEG/шапку/структуру не трогает.
 *
 * Зачем: писец чинит hard-гейты в ремонтных кругах, но WARN-гейты качества
 * (noun-lock, claim-visibility, prop-geometry, simcheck-близнецы,
 * salience-контраст) остаются автору. Приказ «на 500%» (T4-28) требует
 * большего: полировка поднимает черновик до сдачи.
 *
 * Гарантии:
 *  - hard PASS обязателен на входе и обязателен на выходе: полировка,
 *    уронившая hard, ОТКАТЫВАЕТСЯ целиком (черно­вик важнее полировки);
 *  - хирургия: заменяются только THESIS/POS поражённых слотов, всё
 *    остальное (NEG, Canon, Spine, Stack, шапка) — нетронуто;
 *  - детерминизм событий: летопись не трогается (полировка — не событие
 *    конвейера, а доводка черновика до сдачи; сдача — отдельный deliver).
 *
 * Запуск (из корня репо):
 *   bun thread4/tools/polish-batch.ts T4-28 [--max-slots 8] [--dry]
 *     --dry   показать план полировки, ничего не менять
 */
import fs from 'node:fs'
import path from 'node:path'

import ZAI from 'z-ai-web-dev-sdk'

import { runGates } from '../../src/lib/t4/gates'
import { readText } from '../../src/lib/t4/fsutil'
import { BATCHES_DIR, CONTRACTS_DIR, readJson } from '../../src/lib/t4/fsutil'
import type { BatchContract } from '../../src/lib/t4/compiler'

/* WARN-гейты, чинящиеся переписыванием POS/THESIS слота */
const POLISH_GATES = new Set(['noun-lock', 'claim-visibility', 'prop-geometry', 'simcheck'])

/* слоты, которые никогда не переписываются полировщиком */
const MAX_SLOTS_DEFAULT = 10

interface SlotSection {
  position: number
  header: string
  start: number
  end: number
  thesis: string
  pos: string
}

function splitSlots(md: string): { head: string; slots: SlotSection[]; tail: string } {
  const lines = md.split('\n')
  const starts: number[] = []
  lines.forEach((l, i) => {
    if (/^P\d{2}\s+—\s/.test(l)) starts.push(i)
  })
  const slots: SlotSection[] = []
  for (let si = 0; si < starts.length; si++) {
    const from = starts[si]
    const to = si + 1 < starts.length ? starts[si + 1] : lines.length
    const section = lines.slice(from, to)
    const header = section[0]
    const m = /^P(\d{2})\s+—/.exec(header)
    if (!m) continue
    const position = parseInt(m[1], 10)
    const text = section.join('\n')
    const thesisMatch = /^THESIS:\s*(.+)$/m.exec(text)
    const posMatch = /\nPOS:\s*\n\n([\s\S]*?)\n\nNEG:/.exec(text)
    slots.push({
      position,
      header,
      start: from,
      end: to,
      thesis: (thesisMatch?.[1] ?? '').trim(),
      pos: (posMatch?.[1] ?? '').trim(),
    })
  }
  const firstSlot = starts.length > 0 ? starts[0] : lines.length
  return {
    head: lines.slice(0, firstSlot).join('\n'),
    slots,
    tail: '',
  }
}

async function chat(zai: Awaited<ReturnType<typeof ZAI.create>>, system: string, user: string): Promise<string> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: attempt === 0 ? 'system' : 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
      return String(completion.choices[0]?.message?.content ?? '')
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 1200))
    }
  }
  return ''
}

const SYSTEM = `You are the polish scribe of THREAD 4 — an ecchi prompt-batch forge. You rewrite INDIVIDUAL slots of a finished draft to fix QUALITY findings, never breaking the hard-won structure. Laws you must obey in every rewrite:
- POS opens with the identification tags, carries the claim EARLY in the tag run (the renderer reads the head of the run strongest), ends with the face-block (stylized 2D anime face, anime eyes (color), small nose, small mouth) and quality tail (Masterpiece, best quality, anime artstyle).
- Through-fabric claims REQUIRE a NAMED thin garment NOUN (blouse/tee/crop top/shirt/knit/swimsuit/leotard/sheet/towel/slip) + the fabric state (wet clothes / see-through) + "nothing underneath" asserted POSITIVELY + light ON the zone (law 21) + a camera tag (close-up / from below).
- Lower claims (visible pantyline) live ONLY on named lower garments (skirt/shorts/leggings) that are OPEN to camera; if the zone is closed by the garment, MOVE the claim to the chest instead.
- CONTRAST: one light/white garment or explicit light falling on the claim zone — a wet dark fabric without light is a dead blob.
- INTERPRETATION: the claim must be WANTED — a micro-expression (half-lidded eyes, seductive smile, bedroom eyes) reads the delivery.
- NO duplicate prose: never reuse sentences from other slots of this batch (twins are a quality failure).
- Keep the slot's anchor, pose, palette, canon, stack and genre EXACTLY as given. Keep it 150-300 words of POS.
Return EXACTLY:
THESIS: <one sentence>
POS:
<the full rewritten POS>`

async function main() {
  const args = process.argv.slice(2)
  const slug = args[0] ?? ''
  if (!/^T4-[\dA-Za-z.-]+$/.test(slug)) {
    console.error('usage: bun thread4/tools/polish-batch.ts T4-NN [--max-slots 8] [--dry]')
    process.exit(1)
  }
  const dry = args.includes('--dry')
  const maxSlotsIdx = args.indexOf('--max-slots')
  const maxSlots = maxSlotsIdx >= 0 ? Number(args[maxSlotsIdx + 1] ?? MAX_SLOTS_DEFAULT) : MAX_SLOTS_DEFAULT

  const mdPath = path.join(BATCHES_DIR, `${slug}.md`)
  const md = readText(mdPath)
  if (!md) {
    console.error(`batches/${slug}.md не найден`)
    process.exit(1)
  }
  const contract = readJson<BatchContract>(path.join(CONTRACTS_DIR, `${slug}.json`))
  if (!contract) {
    console.error(`contracts/${slug}.json не найден`)
    process.exit(1)
  }

  const before = runGates(slug, true)
  if (!before) {
    console.error('гейты не нашли батч')
    process.exit(1)
  }
  if (!before.hardPass) {
    console.error(`черно­вик ${slug} в hard FAIL — сначала ремонт (scribe), потом полировка`)
    process.exit(1)
  }
  const warnBefore = before.receipts
    .filter((r) => r.level === 'warn' && r.verdict === 'WARN')
    .reduce((n, r) => n + r.findings.length, 0)

  /* поражённые слоты из WARN-квитанций полируемых гейтов */
  const failed = new Map<number, string[]>()
  for (const r of before.receipts) {
    if (r.level !== 'warn' || r.verdict !== 'WARN' || !POLISH_GATES.has(r.gate)) continue
    for (const fnd of r.findings) {
      const m = /P(\d{1,2})/.exec(fnd)
      if (m) {
        const p = parseInt(m[1], 10)
        if (!failed.has(p)) failed.set(p, [])
        failed.get(p)!.push(`[${r.gate}] ${fnd}`)
      }
    }
  }
  /* simcheck-близнецы без P-номера: находки без слота — перепишем
     худших кандидатов по J-мере нельзя (номера скрыты), пропускаем */

  if (failed.size === 0) {
    console.log(`${slug}: WARN-квитаций полируемых гейтов нет — полировать нечего (${warnBefore} прочих WARN остаются автору)`)
    return
  }

  const targets = [...failed.keys()].sort((a, b) => a - b).slice(0, Math.max(1, maxSlots))
  console.log(`${slug}: полировка ${targets.length} слот(ов) — ${targets.map((p) => `P${String(p).padStart(2, '0')}`).join(', ')}`)
  for (const p of targets) {
    for (const f of (failed.get(p) ?? []).slice(0, 4)) console.log(`  · ${f}`)
  }
  if (dry) {
    console.log('\n(сухой план — файл не менялся)')
    return
  }

  const { head, slots } = splitSlots(md)
  const zai = await ZAI.create()
  const linesOut = md.split('\n')
  const backup = md
  let polishedCount = 0

  for (const pos of targets) {
    const section = slots.find((s) => s.position === pos)
    const slot = contract.slots.find((s) => s.position === pos)
    if (!section || !slot) continue
    const paletteName = slot.paletteName ?? slot.palette
    const user = `SLOT P${String(pos).padStart(2, '0')} · genre ${slot.kind} · rating ${slot.rating} · pose ${slot.pose} ${slot.poseName} · palette ${paletteName} · lead ${slot.lead}${slot.oc ? ` · OC ${slot.oc} (canon locks are law)` : ''}

CURRENT THESIS: ${section.thesis}

CURRENT POS (rewrite it, keep its working bones):
${section.pos}

QUALITY FINDINGS TO FIX (each is a machine-checked rule):
${(failed.get(pos) ?? []).map((f) => `- ${f}`).join('\n')}

Rewrite the slot so every finding is fixed. Keep the anchor word «${section.header.replace(/^P\d{2}\s+—\s/, '').split(/\s+\(/)[0]}» if it still fits.`
    const raw = await chat(zai, SYSTEM, user)
    const thesisM = /^THESIS:\s*(.+)$/m.exec(raw)
    const posM = /\nPOS:\s*\n+([\s\S]+?)$/m.exec(raw)
    if (!thesisM || !posM) {
      console.log(`  · P${String(pos).padStart(2, '0')}: формат ответа не разобран — пропуск`)
      continue
    }
    const newThesis = thesisM[1].trim().slice(0, 400)
    const newPos = posM[1]
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```\s*$/, '')
      .trim()
    if (newPos.length < 200) {
      console.log(`  · P${String(pos).padStart(2, '0')}: ответ слишком короток (${newPos.length}) — пропуск`)
      continue
    }
    /* хирургическая замена THESIS и POS внутри секции слота */
    const secLines = linesOut.slice(section.start, section.end)
    const tIdx = secLines.findIndex((l) => /^THESIS:/.test(l))
    if (tIdx >= 0) secLines[tIdx] = `THESIS: ${newThesis}`
    const pIdx = secLines.findIndex((l) => /^POS:$/.test(l))
    const nIdx = secLines.findIndex((l) => /^NEG:$/.test(l))
    if (pIdx >= 0 && nIdx > pIdx) {
      const rebuilt = [...secLines.slice(0, pIdx + 1), '', newPos, '', ...secLines.slice(nIdx)]
      rebuilt.length = section.end - section.start
      for (let i = 0; i < rebuilt.length; i++) linesOut[section.start + i] = rebuilt[i] ?? ''
      polishedCount++
      console.log(`  · P${String(pos).padStart(2, '0')}: переписан (${newPos.split(/\s+/).length} слов)`)
    }
  }

  if (polishedCount === 0) {
    console.log('\nни один слот не переписан — файл не менялся')
    return
  }

  fs.writeFileSync(mdPath, linesOut.join('\n'), 'utf-8')
  const after = runGates(slug, true)
  if (after && after.hardPass) {
    const warnAfter = after.receipts
      .filter((r) => r.level === 'warn' && r.verdict === 'WARN')
      .reduce((n, r) => n + r.findings.length, 0)
    console.log(`\nполировка: hard PASS удержан · WARN ${warnBefore} → ${warnAfter} · переписано ${polishedCount}`)
  } else {
    /* откат: полировка уронила hard — черновик важнее */
    fs.writeFileSync(mdPath, backup, 'utf-8')
    const restored = runGates(slug, true)
    console.log(
      `\nполировка уронила hard — ОТКАТ к исходному черновику (hard ${restored?.hardPass ? 'PASS' : 'FAIL'} восстановлен)`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
