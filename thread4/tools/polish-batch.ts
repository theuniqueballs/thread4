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
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= 6; attempt++) {
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
      lastErr = e
      /* 429 — уважительно ждём: 5с → 12с → 25с → 45с → 70с → 100с */
      await new Promise((r) => setTimeout(r, 5000 + attempt * attempt * 4500))
    }
  }
  throw lastErr
}

const SYSTEM = `You are the polish scribe of THREAD 4 — an ecchi prompt-batch forge. You surgically fix INDIVIDUAL slots of a finished draft. The draft already passes ALL HARD machine gates — your job is to fix QUALITY findings WITHOUT breaking anything.

THE TAG RUN IS SACRED: everything before the first period of the POS is the machine-checked tag run. Keep it byte-for-byte UNLESS a finding explicitly says to add/change a garment noun there. All claims, ratings and recipe signals live in the tag run — losing one fails the batch.

RULES OF THE REWRITE:
- THE CLAIM SET IS FROZEN: keep every claim tag that is already in the tag run (nipples through clothing / clothed nipples / see-through / visible pantyline / extreme fanservice — whichever are present stay present; add none above R+). NEVER write: bare breasts, topless, exposed nipples, nude — these are above-tier (X) and fail the batch instantly.
- If the finding says the claim is not locked to a NAMED garment: add the garment NOUN into the tag run (blouse/tee/crop top/shirt/knit/swimsuit/leotard/slip/sheet/towel for top claims; skirt/shorts/leggings for lower claims) right next to the fabric state tags.
- If the finding says the claim zone is closed (skirt/dress blocks a lower claim): MOVE the claim to the chest (see-through + named thin top) instead of opening the lower zone.
- DUPLICATE PROSE (twins): rewrite the prose sentences so they share NO sentence skeleton with any other slot. The theme words may repeat; the SENTENCES may not. Vary rhythm, imagery and syntax.
- CONTRAST: name one light source falling ON the claim zone (law 21) — a lamp, a window, a screen glow, a headlight.
- INTERPRETATION: one micro-expression reading the claim (half-lidded eyes, seductive smile, bedroom eyes).
- Keep the slot's anchor, pose, palette, canon, stack and genre EXACTLY as given. POS total 150-300 words.
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

  /* поражённые слоты из WARN-квитанций полируемых гейтов; simcheck-строка
   * несёт МНОГО слотов (P7≈P8 · P7≈P12 …) — собираем все, не только первый */
  const failed = new Map<number, string[]>()
  for (const r of before.receipts) {
    if (r.level !== 'warn' || r.verdict !== 'WARN' || !POLISH_GATES.has(r.gate)) continue
    for (const fnd of r.findings) {
      for (const m of fnd.matchAll(/P(\d{1,2})/g)) {
        const p = parseInt(m[1], 10)
        if (!failed.has(p)) failed.set(p, [])
        failed.get(p)!.push(`[${r.gate}] ${fnd}`)
      }
    }
  }
  /* simcheck-близнецы все именаются слотами; лишний мусор-комментарий снят */

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
    /* троттлинг между слотами: лимит апстрима дышит перегрузками,
     * серия из 10 рерайтов подряд его ломает (429 в середине серии) */
    await new Promise((r) => setTimeout(r, 7000))
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
    return
  }
  /* послотовый откат: рерайты, уронившие hard, возвращаются из бэкапа;
   * чистые рерайты СОХРАНЯЮТСЯ (полный откат хоронил бы 9 слотов из-за 1) */
  const failSlots = new Set<number>()
  const hardFails = (after?.receipts ?? []).filter((r) => r.level === 'hard' && r.verdict === 'FAIL')
  for (const r of hardFails) {
    for (const fnd of r.findings) {
      for (const m of fnd.matchAll(/P(\d{1,2})/g)) failSlots.add(parseInt(m[1], 10))
    }
  }
  for (const r of hardFails.slice(0, 3)) {
    for (const fnd of r.findings.slice(0, 4)) console.log(`  · [${r.gate}] ${fnd}`)
  }
  if (failSlots.size === 0) {
    /* батч-уровневый провал без слота — полный откат */
    fs.writeFileSync(mdPath, backup, 'utf-8')
    const restored = runGates(slug, true)
    console.log(`\nполировка уронила hard безымянно — полный ОТКАТ (hard ${restored?.hardPass ? 'PASS' : 'FAIL'})`)
    return
  }
  const backupLinesArr = backup.split('\n')
  const backupParsed = splitSlots(backup)
  let merged = linesOut
  /* от высоких позиций к низким: splice не рвёт диапазоны ниже */
  for (const p of [...failSlots].sort((a, b) => b - a)) {
    const bs = backupParsed.slots.find((s) => s.position === p)
    if (!bs) continue
    const ps = splitSlots(merged.join('\n')).slots.find((s) => s.position === p)
    if (!ps) continue
    const restore = backupLinesArr.slice(bs.start, bs.end)
    merged = [...merged.slice(0, ps.start), ...restore, ...merged.slice(ps.end)]
    console.log(`  · P${String(p).padStart(2, '0')}: рерайт уронил hard — восстановлен из бэкапа`)
  }
  fs.writeFileSync(mdPath, merged.join('\n'), 'utf-8')
  const restored = runGates(slug, true)
  if (restored?.hardPass) {
    const warnAfter = restored.receipts
      .filter((r) => r.level === 'warn' && r.verdict === 'WARN')
      .reduce((n, r) => n + r.findings.length, 0)
    console.log(
      `\nпослотовый откат: hard PASS · WARN ${warnBefore} → ${warnAfter} · чистых рерайтов сохранено ${polishedCount - failSlots.size}`
    )
  } else {
    fs.writeFileSync(mdPath, backup, 'utf-8')
    const full = runGates(slug, true)
    console.log(`\nпослотовый откат не спас — полный ОТКАТ (hard ${full?.hardPass ? 'PASS' : 'FAIL'})`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
