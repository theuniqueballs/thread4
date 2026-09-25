/**
 * THREAD 4 tool — build the golden corpus from T4-04 author verdicts (Залп 3 «Ученик»).
 * Парсит verdicts/T4-04-author-verdict.md («Оценено / Указано» + PH Rewritten +
 * авторский комментарий) в машиночитаемый few-shot корпус для писца.
 * Запуск: bun thread4/tools/build-golden-corpus.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'thread4', 'verdicts', 'T4-04-author-verdict.md')
const OUT = path.join(process.cwd(), 'thread4', 'specs', 'golden-corpus.json')

const normTier = (t: string): string => {
  const u = t.trim().toUpperCase()
  if (u === 'PG13') return 'PG-13'
  if (u === 'RPLUS' || u === 'R+') return 'R+'
  return u
}

function main(): void {
  const raw = fs.readFileSync(SRC, 'utf-8')
  const lines = raw.split(/\r?\n/)
  /* заголовок слота: «OC-1: ...», «4: R+ / R+», «5:R-R+ / R+» */
  const headerRe = /^\s*(OC-)?(\d{1,2})\s*:\s*(.*)$/

  const entries: {
    slot: string
    claim: string
    delivered: string
    author_note: string
    ph_text: string
  }[] = []

  let cur: { slot: string; tiersRaw: string; body: string[] } | null = null
  const flush = (): void => {
    if (!cur) return
    const tiers = cur.tiersRaw.match(/(PG-?13|R\+|RPLUS|X|XXX|R)/gi) ?? []
    const delivered = tiers.length > 0 ? normTier(tiers[0]) : ''
    const claim = tiers.length > 1 ? normTier(tiers[tiers.length - 1]) : ''
    const body = cur.body.join('\n').trim()
    if (!body || !delivered || !claim) {
      cur = null
      return
    }
    /* PH-текст = английский текст после маркера; комментарий автора = первая
       кириллическая строка после него (PH пишет по-английски, автор — нет) */
    const markerIdx = body.search(/PH\s+Rewrit(?:en|ten)\s*:\s*/i)
    let phText = body
    let authorNote = '—'
    if (markerIdx >= 0) {
      const afterMarker = body.slice(markerIdx).replace(/^PH\s+Rewrit(?:en|ten)\s*:\s*/i, '')
      const amLines = afterMarker.split(/\r?\n/)
      const noteStart = amLines.findIndex((l) => /[\u0400-\u04FF]/.test(l))
      phText = (noteStart < 0 ? amLines : amLines.slice(0, noteStart)).join(' ').replace(/\s+/g, ' ').trim()
      if (noteStart >= 0) {
        authorNote = amLines.slice(noteStart).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400) || '—'
      }
    }
    entries.push({ slot: `P${cur.slot.padStart(2, '0')}`, claim, delivered, author_note: authorNote, ph_text: phText })
    cur = null
  }

  for (const line of lines) {
    const m = headerRe.exec(line)
    if (m && !/^(PH|The|Формат|Обработан|Движок|ENVIRON)/i.test(m[3] ?? '')) {
      flush()
      cur = { slot: m[2], tiersRaw: m[3] ?? '', body: [] }
      continue
    }
    if (cur) cur.body.push(line)
  }
  flush()

  const corpus = {
    id: 'golden-corpus',
    name: 'Golden corpus писца — что PH реально отправил и что увидел автор',
    version: '1.0.0',
    born: '2026-09-26',
    born_from: 'Залп 3 «Ученик» (MD-3: память→рефлекс; корпус T4-04, аудиты v1/v2)',
    source_batch: 'T4-04',
    entries,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(corpus, null, 2) + '\n')
  console.log(`golden-corpus: ${entries.length} записей из T4-04 → ${path.relative(process.cwd(), OUT)}`)
  const success = entries.filter((e) => e.claim === e.delivered).length
  console.log(`из них точных попаданий в заявку: ${success}`)
}

main()
