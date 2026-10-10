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

/* ------------------------------------------------------------------ */
/* Дифф-документ A→B (.md)                                             */
/* ------------------------------------------------------------------ */

/** Строка меты слота одним куском (для слотов с одной стороны). */
function metaLine(s: SlotMd): string {
  return [s.kind, s.who, s.rating, s.pose, s.palette, s.rehab].filter(Boolean).join(' · ')
}

/** Изменённые мета-поля A→B со стрелками (зеркало MetaChip дашборда). */
function metaChanges(x: SlotMd, y: SlotMd): string[] {
  const fields: [keyof SlotMd, string][] = [
    ['kind', 'жанр'],
    ['who', 'кто'],
    ['rating', 'рейтинг'],
    ['pose', 'поза'],
    ['palette', 'палитра'],
    ['rehab', 'REHAB'],
  ]
  const out: string[] = []
  for (const [k, label] of fields) {
    const va = x[k] as string
    const vb = y[k] as string
    if (va !== vb) out.push(`${label}: ${va || '—'} → ${vb || '—'}`)
  }
  return out
}

/** Дифф-документ перестройки A→B: тот же разбор, что в Сравнении дашборда,
 *  но одним .md-файлом — квиток пары под руку (кнопка «дифф .md» и
 *  tools/diff-export.ts). Чистая функция, без DOM — инструмент и ядро
 *  могут звать её без браузера. */
export function buildDiffMarkdown(aSlug: string, bSlug: string, a: BatchMd, b: BatchMd): string {
  /* выравнивание по позициям — объединение id обеих сторон */
  const map = new Map<string, { id: string; a?: SlotMd; b?: SlotMd }>()
  for (const s of a.slots) map.set(s.id, { id: s.id, a: s })
  for (const s of b.slots) {
    const cur = map.get(s.id)
    if (cur) cur.b = s
    else map.set(s.id, { id: s.id, b: s })
  }
  const rows = [...map.values()].sort((x, y) => x.id.localeCompare(y.id))

  let posAdd = 0
  let posRem = 0
  let negAdd = 0
  let negRem = 0
  let onlyA = 0
  let onlyB = 0
  const perSlot: { id: string; add: number; rem: number }[] = []
  for (const r of rows) {
    if (r.a && !r.b) {
      onlyA++
      continue
    }
    if (!r.a && r.b) {
      onlyB++
      continue
    }
    const dP = diffTokens(r.a!.pos, r.b!.pos)
    const dN = diffTokens(r.a!.neg, r.b!.neg)
    posAdd += dP.added.length
    posRem += dP.removed.length
    negAdd += dN.added.length
    negRem += dN.removed.length
    perSlot.push({ id: r.id, add: dP.added.length, rem: dP.removed.length })
  }
  perSlot.sort((x, y) => y.add + y.rem - (x.add + x.rem))
  const top = perSlot.filter((p) => p.add + p.rem > 0).slice(0, 3)

  const L: string[] = []
  L.push(`# THREAD 4 · дифф перестройки · ${aSlug} → ${bSlug}`)
  L.push('')
  L.push(`A (база): ${aSlug} · ${a.title || '—'} · ${a.slots.length} слотов`)
  L.push(`B (перестройка): ${bSlug} · ${b.title || '—'} · ${b.slots.length} слотов`)
  L.push('')
  L.push(
    `POS +${posAdd} · −${posRem} · NEG +${negAdd} · −${negRem}` +
      (onlyA + onlyB > 0 ? ` · только в A: ${onlyA} · новых в B: ${onlyB}` : '')
  )
  if (top.length > 0) {
    L.push(`самые перестроенные (POS): ${top.map((t) => `${t.id} +${t.add}/−${t.rem}`).join(' · ')}`)
  }
  L.push(`дифф текста промптов, не рендеров · сгенерировано ${new Date().toLocaleString('ru-RU')}`)
  L.push('')
  L.push('---')
  L.push('')

  for (const r of rows) {
    const { a: x, b: y } = r
    if (x && !y) {
      L.push(`## ${x.id} · ${x.slug}`)
      L.push('')
      const m = metaLine(x)
      L.push(`только в A${m ? ` · ${m}` : ''}`)
      L.push(`POS (A): ${x.pos}`)
      L.push(`NEG (A): ${x.neg}`)
      L.push('')
      continue
    }
    if (!x && y) {
      L.push(`## ${y.id} · ${y.slug}`)
      L.push('')
      const m = metaLine(y)
      L.push(`новый в B${m ? ` · ${m}` : ''}`)
      L.push(`POS (B): ${y.pos}`)
      L.push(`NEG (B): ${y.neg}`)
      L.push('')
      continue
    }
    const dP = diffTokens(x!.pos, y!.pos)
    const dN = diffTokens(x!.neg, y!.neg)
    const slugLine = x!.slug !== y!.slug ? `${x!.slug} → ${y!.slug}` : x!.slug
    L.push(`## ${x!.id} · ${slugLine}`)
    L.push('')
    for (const m of metaChanges(x!, y!)) L.push(m)
    if (x!.stack !== y!.stack) L.push(`Stack: ${x!.stack || '—'} → ${y!.stack || '—'}`)
    if (x!.thesis !== y!.thesis && y!.thesis) L.push(`тезис B: ${y!.thesis}`)
    if (x!.canon !== y!.canon && y!.canon) L.push(`канон B: ${y!.canon}`)
    if (dP.added.length + dP.removed.length === 0) {
      L.push('POS: без изменений')
    } else {
      L.push(`POS +${dP.added.length}/−${dP.removed.length} (общих ${dP.kept.length}):`)
      for (const t of dP.added) L.push(`  + ${t}`)
      for (const t of dP.removed) L.push(`  − ${t}`)
    }
    if (dN.added.length + dN.removed.length === 0) {
      L.push('NEG: без изменений')
    } else {
      L.push(`NEG +${dN.added.length}/−${dN.removed.length} (общих ${dN.kept.length}):`)
      for (const t of dN.added) L.push(`  + ${t}`)
      for (const t of dN.removed) L.push(`  − ${t}`)
    }
    L.push('')
  }
  return L.join('\n')
}
