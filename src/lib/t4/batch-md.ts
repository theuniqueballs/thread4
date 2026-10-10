/**
 * THREAD 4 — парсер скомпилированных батчей (.md) в слоты + токен-дифф.
 *
 * Преемник Фреда, 2026-10-10 (webDevReview #2): дашборду нужен был честный
 * инструмент для живой задачи автора — «тела однообразные» решается парой
 * T4-27 ↔ T4-27.2-EXP, и глаз автора должен видеть, что именно перестроено,
 * слот к слоту, без вычитания двух файлов руками. Парсер живёт в lib (чистая
 * функция, без реакт-зависимостей) — им пользуется и страница, и (потенциально)
 * ядро; формат батчей стабилен с T4-02: «P0X — slug (мета)» + секции
 * THESIS/Canon/Spine/Stack/POS/NEG.
 *
 * Мета-скобка отличается по эпохам (эра прозы: OC · Lyn · R+ · PL24 · палитра;
 * RAW+: NICHE · палитра · R) — поэтому сегменты классифицируются по форме,
 * а не по позиции: kind/rating/поза(PL###)/палитра(P##_...)/REHAB/кто-остальное.
 */

/** Слот батча, как он записан в .md. */
export interface SlotMd {
  /** «P01» */
  id: string
  /** slug слота из шапки, например «aob-walking-block» */
  slug: string
  /** жанр: OC / VOLT / NICHE / EXQUISITE / EXP (пусто — не распознан) */
  kind: string
  /** имя ОС или раса («Lyn», «Mushroom-kin») — первый неклассифицированный сегмент */
  who: string
  /** R+ / R / X / PG-13 */
  rating: string
  /** PL### (эра прозы) */
  pose: string
  /** P##_NAME — палитра RAW+/эры прозы */
  palette: string
  /** REHAB-маркер (P08 · REHAB wet-sheer-flat) */
  rehab: string
  /** секции, объединённые пробелом (пустая строка — секции нет) */
  thesis: string
  canon: string
  spine: string
  stack: string
  pos: string
  neg: string
}

export interface BatchMd {
  title: string
  slots: SlotMd[]
}

/* Жадный (.*) до последней «)» в строке — мета бывает с вложенными скобками
 * («Cecaelia (upper)»), а после скобки — парные маркеры «⚗» (A/B-половины),
 * якориться на конец строки нельзя. */
const SLOT_HEADER_RE = /^P(\d+) — (\S+)\s+\((.*)\)/
const SECTION_RE = /^(THESIS|Canon|Spine|Stack|POS|NEG|PROTOCOL|HEROINE-BATCH):/
const KINDS = new Set(['OC', 'VOLT', 'NICHE', 'EXQUISITE', 'EXP'])
const RATINGS = /^(R\+?|X|XXX|PG-?13)$/i

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Классификация сегментов меты по форме (эпохи пишут её по-разному). */
function parseMeta(raw: string): Pick<SlotMd, 'kind' | 'who' | 'rating' | 'pose' | 'palette' | 'rehab'> {
  const out = { kind: '', who: '', rating: '', pose: '', palette: '', rehab: '' }
  for (const segRaw of raw.split('·')) {
    const seg = collapse(segRaw)
    if (seg === '' || seg === '—') continue
    if (KINDS.has(seg.toUpperCase())) {
      if (!out.kind) out.kind = seg.toUpperCase()
      continue
    }
    if (RATINGS.test(seg)) {
      if (!out.rating) out.rating = seg.toUpperCase().replace(/^PG13$/, 'PG-13').replace(/^PG-13$/, 'PG-13')
      continue
    }
    if (/^PL\d+$/.test(seg)) {
      if (!out.pose) out.pose = seg
      continue
    }
    if (/^P[A-Z0-9_]+$/.test(seg) && seg.includes('_')) {
      if (!out.palette) out.palette = seg
      continue
    }
    if (seg.toUpperCase().startsWith('REHAB')) {
      if (!out.rehab) out.rehab = seg
      continue
    }
    if (!out.who) out.who = seg
  }
  return out
}

/** Разбор батча: слоты вырезаются по шапкам «P0X — …», секции — по префиксам. */
export function parseBatchMd(md: string): BatchMd | null {
  if (!md) return null
  const lines = md.split('\n')
  let title = ''
  for (const l of lines) {
    if (l.startsWith('# ')) {
      title = collapse(l.slice(2))
      break
    }
  }
  const slots: SlotMd[] = []
  let cur: SlotMd | null = null
  let section: 'thesis' | 'canon' | 'spine' | 'stack' | 'pos' | 'neg' | null = null

  const flush = () => {
    if (cur) slots.push(cur)
    cur = null
    section = null
  }

  for (const line of lines) {
    const m = line.match(SLOT_HEADER_RE)
    if (m) {
      flush()
      cur = {
        id: `P${m[1].padStart(2, '0')}`,
        slug: m[2],
        ...parseMeta(m[3]),
        thesis: '',
        canon: '',
        spine: '',
        stack: '',
        pos: '',
        neg: '',
      }
      continue
    }
    if (!cur) continue
    const sm = line.match(SECTION_RE)
    if (sm) {
      section = sm[1].toLowerCase() as typeof section
      /* Stack/THESIS/Canon пишутся с содержимым на той же строке
       * («Stack: CR-W23 + …»), POS/NEG — на следующих; хвост строки
       * не выбрасываем. */
      const sameLine = collapse(line.slice(sm[0].length))
      if (sameLine !== '' && section) {
        cur[section] = cur[section] ? `${cur[section]} ${sameLine}` : sameLine
      }
      continue
    }
    if (section) {
      const v = collapse(line)
      if (v === '') continue
      cur[section] = cur[section] ? `${cur[section]} ${v}` : v
    }
  }
  flush()
  return slots.length > 0 ? { title, slots } : null
}

/* ------------------------------------------------------------------ */
/* Токен-дифф POS/NEG                                                  */
/* ------------------------------------------------------------------ */

export interface TokenDiff {
  /** теги B, общие с A (в порядке B) */
  kept: string[]
  /** теги B, которых нет в A (в порядке B) */
  added: string[]
  /** теги A, которых нет в B (в порядке A) */
  removed: string[]
}

const normToken = (t: string): string =>
  t.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')

/** Разделение тегов с учётом скобок: «anime eyes (striking red, level)» —
 *  ОДИН тег (запятая внутри скобок не режет); без глубины скобок
 *  face-блок распадается на мусорные фрагменты «level)». */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      if (cur.trim() !== '') out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/** split('·') не нужен: теги разделены запятыми; длинная проза эры T4-02..22
 *  дробится на фрагменты предложений — честно, хоть и шумно; сравнение
 *  внутри одной эпохи (обычный случай) чистое. */
export function diffTokens(a: string, b: string): TokenDiff {
  const aList = splitTop(a)
  const bList = splitTop(b)
  const aSet = new Set(aList.map(normToken))
  const bSet = new Set(bList.map(normToken))
  const kept: string[] = []
  const added: string[] = []
  for (const t of bList) (aSet.has(normToken(t)) ? kept : added).push(t)
  const removed: string[] = []
  for (const t of aList) if (!bSet.has(normToken(t))) removed.push(t)
  return { kept, added, removed }
}

/** Стек носителей: «CR-W23 + CR-B08» → [CR-W23, CR-B08]. */
export function stackIds(stack: string): string[] {
  return stack.split('+').map((s) => s.trim()).filter(Boolean)
}
