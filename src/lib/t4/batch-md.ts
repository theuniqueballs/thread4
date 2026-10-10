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
/* TRIAL-3 радар: законы M1x и EXP-гипотезы батча                      */
/* ------------------------------------------------------------------ */

/** Закон триала, как он записан в шапке батча («M15 интерливинг…»). */
export interface TrialLaw {
  /** «M15» */
  id: string
  /** «интерливинг» */
  name: string
  /** «закон №22» — ссылка на конституцию, если названа */
  ref: string
  /** скобка + первые слова пояснения (обрезано, полный текст — в title UI) */
  note: string
}

/** Половинка A/B-пары (или одиночная гипотеза) — слот и его тезис. */
export interface HypothesisHalf {
  slotId: string
  slotSlug: string
  thesis: string
  /** ⚗ — осознанный нарушитель (λ-B, μ-B) */
  alchemy: boolean
  /** POS слота — для диффа половинок прямо в радаре */
  pos: string
}

/** EXP-гипотеза батча: пара κ/λ/μ (A/B) или одиночка ν/ξ/ρ. */
export interface Hypothesis {
  /** греческая буква программы */
  greek: string
  kind: 'pair' | 'single'
  /** «H10» (может не быть у одиночек) */
  hid: string
  /** номер закона из тезиса («24»), если назван */
  lawNo: string
  /** короткое имя: «опорная геометрия» / «underwear-ДОБОР» */
  title: string
  a?: HypothesisHalf
  b?: HypothesisHalf
  single?: HypothesisHalf
}

const LAW_HEAD_RE = /^\s*\d+\.\s+\*\*(M\d+)\s+([^*]+?)\s*\*\*\s*(?:\(([^)]*)\))?\s*:?\s*/
const LAW_REF_RE = /закон\s*№\s*\d+/
/* NB: \b после греческой буквы не существует (\b — ASCII-граница, буква
 * не-ASCII) — поэтому lookahead (?![A-Za-z0-9]), а не \b. */
const HYPO_PAIR_RE = /^EXP\s+([κλμνξρ])-(A|B)(?![A-Za-z0-9])\s*·?\s*(H\d+)?\s*(.*)$/u
const HYPO_SINGLE_RE = /^EXP\s+single\s*·\s*([κλμνξρ])(?![A-Za-z0-9])\s*(H\d+)?\s*(.*)$/u
const HYPO_LAW_RE = /закон\s*№\s*(\d+)/
const ALCHEMY_ROW_RE = /^P(\d+)\s+—\s+\S+\s+\(.*\)\s*⚗/

/** Законы триала из шапки батча: нумерованный список «1. **M15 …** (…)»
 *  с продолжениями-отступами. Чистая функция — зовут и дашборд, и ядро. */
export function extractTrialLaws(md: string): TrialLaw[] {
  if (!md) return []
  const lines = md.split('\n')
  const laws: TrialLaw[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LAW_HEAD_RE)
    if (!m) continue
    /* продолжение закона — строки с отступом до следующей структурной строки */
    const cont: string[] = []
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) cont.push(lines[j].trim())
    const body = collapse(cont.join(' '))
    const refMatch = `${m[3] ?? ''} ${body}`.match(LAW_REF_RE)
    const note = [m[3] ?? '', body].filter(Boolean).join(' — ')
    laws.push({
      id: m[1],
      name: collapse(m[2]),
      ref: refMatch ? refMatch[0] : '',
      note: collapse(note).slice(0, 160),
    })
    i += cont.length
  }
  return laws
}

/** Короткое имя гипотезы: текст до первой скобки/тире/двоеточия. */
function hypoTitle(rest: string): string {
  return collapse(rest.split(/[(—:]/)[0])
}

/** EXP-программа батча: THESIS слотов несут маркеры «EXP κ-A · H10 …»
 *  (формат стабилен с T4-25). Половинки одной буквы склеиваются в пару;
 *  ⚗-марки ловятся по строке шапки слота. */
export function extractHypotheses(md: string, batch: BatchMd): Hypothesis[] {
  if (!md || batch.slots.length === 0) return []
  const alchemy = new Set<string>()
  for (const line of md.split('\n')) {
    const m = line.match(ALCHEMY_ROW_RE)
    if (m) alchemy.add(`P${m[1].padStart(2, '0')}`)
  }
  const out = new Map<string, Hypothesis>()
  for (const s of batch.slots) {
    if (s.kind !== 'EXP' || !s.thesis) continue
    const half: HypothesisHalf = {
      slotId: s.id,
      slotSlug: s.slug,
      thesis: s.thesis,
      alchemy: alchemy.has(s.id),
      pos: s.pos,
    }
    const lawNo = s.thesis.match(HYPO_LAW_RE)?.[1] ?? ''
    const pair = s.thesis.match(HYPO_PAIR_RE)
    const single = pair ? null : s.thesis.match(HYPO_SINGLE_RE)
    if (pair) {
      const h = out.get(pair[1]) ?? {
        greek: pair[1],
        kind: 'pair' as const,
        hid: pair[3] ?? '',
        lawNo,
        title: hypoTitle(pair[4] ?? ''),
      }
      if (pair[2] === 'A') h.a = half
      else h.b = half
      if (pair[3]) h.hid = pair[3]
      out.set(pair[1], h)
      continue
    }
    if (single) {
      out.set(single[1], {
        greek: single[1],
        kind: 'single',
        hid: single[2] ?? '',
        lawNo,
        title: hypoTitle(single[3] ?? ''),
        single: half,
      })
    }
  }
  return [...out.values()]
}

/* ------------------------------------------------------------------ */
/* Сводка триала (.md) — экспорт радара                                */
/* ------------------------------------------------------------------ */

/** Данные экспорта сводки триала: те же законы/гипотезы/статусы, что
 *  радар показывает на экране. rendered и verdictRecord приносит вызывающий
 *  (дашборд — трекер localStorage + приёмник; CLI — лог событий,
 *  трекер браузера ему недоступен — честная пометка в шапке). */
export interface TrialRadarExport {
  slug: string
  title: string
  /** законы взяты из стороны пары (перестройка не повторяет список) */
  lawSource?: string
  laws: TrialLaw[]
  hypos: Hypothesis[]
  /** id слотов, отрендеренных по трекеру дашборда */
  rendered: string[]
  /** вердикт автора по батчу записан (render.verdict · author-batch) */
  verdictRecord: boolean
  /** трекер рендера недоступен (CLI) — в шапке будет честная пометка */
  renderedUnknown?: boolean
  /** H13 BODY-SPECTRUM: карта пары, если обе стороны известны */
  pair?: {
    a: string
    b: string
    aRendered: number
    aTotal: number
    bRendered: number
    bTotal: number
    verdictB: boolean
  }
}

/** Строка статуса половинки/гипотезы — те же три состояния, что пилюля
 *  радара: ждёт рендер → отрендерена — ждёт вердикт → вердикт записан. */
function hypoStatusLabel(allRendered: boolean, some: number, total: number, verdict: boolean): string {
  if (verdict) return 'вердикт записан'
  if (allRendered && total > 0) return 'отрендерена — ждёт вердикт'
  return `ждёт рендер · ${some}/${total}`
}

/** Сводка триала одним .md-файлом: шапка со статусами, законы M1x,
 *  EXP-программа с тезисами половинок и POS-дельтой пар. Чистая функция,
 *  без DOM — кнопка радара и tools/trial-export.ts дают идентичный файл
 *  (одна правда, как у диффа и рендер-листов). */
export function buildTrialRadarMarkdown(x: TrialRadarExport): string {
  const L: string[] = []
  const pairs = x.hypos.filter((h) => h.kind === 'pair').length
  const singles = x.hypos.filter((h) => h.kind === 'single').length

  L.push(`# THREAD 4 · сводка триала · ${x.slug}`)
  L.push('')
  L.push(`${x.slug} · ${x.title || '—'}`)
  if (x.lawSource) L.push(`законы триала — из ${x.lawSource} (перестройка не повторяет список родителя)`)
  L.push(
    `законов: ${x.laws.length} · гипотез: ${x.hypos.length} (${pairs} ${pairs === 1 ? 'пара' : 'пары'} + ${singles} ${singles === 1 ? 'одиночка' : 'одиночек'})`
  )
  if (x.renderedUnknown) {
    L.push(`трекер рендера живёт в браузере автора — статусы рендера ниже не заполнены`)
    L.push(`вердикт: ${x.verdictRecord ? 'записан (render.verdict · author-batch)' : 'ждёт'}`)
  } else {
    L.push(
      `рендер по трекеру: ${x.rendered.length} слотов отмечено · вердикт: ${x.verdictRecord ? 'записан (render.verdict · author-batch)' : 'ждёт'}`
    )
  }
  L.push(`сгенерировано ${new Date().toLocaleString('ru-RU')}`)
  L.push('')
  L.push('---')
  L.push('')

  if (x.laws.length > 0) {
    L.push(`## Законы триала · ${x.laws.length}`)
    L.push('')
    for (const l of x.laws) {
      L.push(`- **${l.id} ${l.name}**${l.ref ? ` (${l.ref})` : ''} — ${l.note}`)
    }
    L.push('')
  }

  if (x.hypos.length > 0) {
    L.push(`## EXP-программа · ${x.hypos.length}`)
    L.push('')
    for (const h of x.hypos) {
      const head = `${h.greek}${h.hid ? ` (${h.hid})` : ''} · ${h.title || (h.kind === 'pair' ? 'A/B-пара' : 'одиночка')}`
      L.push(`### ${head}${h.lawNo ? ` · закон №${h.lawNo}` : ''} — ${h.kind === 'pair' ? 'пара' : 'одиночка'}`)
      L.push('')
      const halves: { half: NonNullable<Hypothesis['a']>; side: 'A' | 'B' | '' }[] =
        h.kind === 'pair'
          ? [
              { half: h.a, side: 'A' as const },
              { half: h.b, side: 'B' as const },
            ]
          : [{ half: h.single, side: '' }]
      const present = halves.filter((xh) => xh.half != null) as typeof halves
      for (const { half, side } of present) {
        const mark = half.alchemy ? ' · ⚗ осознанный нарушитель' : ''
        const rend = x.rendered.includes(half.slotId) ? 'отрендерен' : 'ждёт рендер'
        L.push(
          `${side ? `${side} · ` : ''}${half.slotId} ${half.slotSlug}${mark} — ${rend}`
        )
        L.push(`  тезис: ${half.thesis}`)
      }
      if (h.kind === 'pair' && h.a && h.b) {
        const d = diffTokens(h.a.pos, h.b.pos)
        if (d.added.length + d.removed.length === 0) {
          L.push(`POS A→B: без изменений`)
        } else {
          L.push(`POS A→B: +${d.added.length} · −${d.removed.length} (общих ${d.kept.length})`)
          for (const t of d.added) L.push(`  + ${t}`)
          for (const t of d.removed) L.push(`  − ${t}`)
        }
      }
      const some = present.filter(({ half }) => x.rendered.includes(half.slotId)).length
      L.push(
        `статус: ${hypoStatusLabel(some === present.length && some > 0, some, present.length, x.verdictRecord)}`
      )
      L.push('')
    }
  }

  if (x.pair) {
    const p = x.pair
    L.push(`## H13 · BODY-SPECTRUM — названное тело против дефолта`)
    L.push('')
    L.push(
      `${p.a} (рендер ${p.aRendered}/${p.aTotal}) ↔ ${p.b} (рендер ${p.bRendered}/${p.bTotal}) · вердикт B: ${p.verdictB ? 'записан' : 'ждёт'}`
    )
    L.push(
      `перестройка: тот же состав, единственная переменная — тело; решает глаз автора на рендере B против A.`
    )
    L.push('')
  }

  L.push('---')
  L.push('')
  L.push(`сводка читается файлом под руку: рендер-листы и дифф пары лежат рядом (download/); статус рендера живёт в трекере дашборда.`)
  return L.join('\n')
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
