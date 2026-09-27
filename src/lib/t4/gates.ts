/**
 * THREAD 4 core — THE GATES (constitution §4, §9).
 *
 * Three tiers: hard (a delivered batch passes these FIRST RUN — always),
 * warn (receipted, must be acknowledged in the batch worklog), advisory
 * (reports only). The rating gate grades every slot against its recipe;
 * the diversity gate reads the same constants the contract printed.
 */
import crypto from 'node:crypto'
import path from 'node:path'

import { BATCHES_DIR, CONTRACTS_DIR, readJson, readText } from './fsutil'
import { appendEvent, foldState, readEvents } from './events'
import { getBans, getCarriers, getOCCanon, getRaces, getRatingRecipes, getRatingTechniques, type TechniqueEntry } from './specs'
import { LAWS } from './compiler'
import { TIER_RANK as TIER_ORDER } from './verdicts'

export type GateLevel = 'hard' | 'warn' | 'advisory'
export type Verdict = 'PASS' | 'FAIL' | 'WARN' | 'REPORT'

export interface GateReceipt {
  gate: string
  level: GateLevel
  verdict: Verdict
  findings: string[]
}

export interface GatesResult {
  slug: string
  runIndex: number
  sha10: string
  receipts: GateReceipt[]
  hardPass: boolean
  firstRunClean: boolean
  at: string
}

/** Всего гейтов в прогоне (state-панель читает отсюда — одна истина).
 *  Залп 2: +1 warn (ab-single-variable). Вердикт автора 2026-09-27:
 *  +1 warn (theme-presence), -1 engine-rent (движки одноразовые),
 *  +1 warn (garment-family, U8 «осторожно») → 22. */
export const GATES_TOTAL = 22

/* ------------------------------------------------------------------ */
/* Batch file parsing                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedSlot {
  position: number
  header: string
  anchor: string
  meta: string
  genre: string // OC | NICHE | VOLT | EXQUISITE ('' if absent)
  thesis: string
  canon: string
  spine: string
  stack: string[]
  pos: string
  neg: string
}

export interface ParsedBatch {
  slug: string
  text: string
  title: string
  slots: ParsedSlot[]
}

const GENRES = ['OC', 'NICHE', 'VOLT', 'EXQUISITE'] as const

function genreOf(meta: string): string {
  const u = meta.toUpperCase()
  for (const g of GENRES) {
    if (new RegExp(`\\b${g}\\b`).test(u)) return g
  }
  return ''
}

export function parseBatch(slug: string, text: string): ParsedBatch {
  const titleMatch = /#\s*THREAD 4[^\n]*?Batch\s+(T4-\d+)[^\n]*?["«]([^"»]+)["»]/i.exec(text)
  const title = titleMatch ? titleMatch[2] : ''
  const slots: ParsedSlot[] = []
  const slotRe = /^P(\d{1,2})\s*—\s*(.+)$/gm
  const marks: { pos: number; n: number; anchor: string }[] = []
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(text)) !== null) {
    marks.push({ pos: m.index, n: parseInt(m[1], 10), anchor: m[2] })
  }
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].pos
    const to = i + 1 < marks.length ? marks[i + 1].pos : text.length
    const block = text.slice(from, to)
    const lines = block.split('\n')
    const header = lines[0] ?? ''
    const grab = (key: string): string => {
      const re = new RegExp(`^${key}:\\s*(.*)$`, 'm')
      const mm = re.exec(block)
      return mm ? mm[1].trim() : ''
    }
    const posMatch = /^POS:\s*\n([\s\S]*?)(?=\nNEG:|\n[^ \n]|\n*$)/m.exec(block)
    const negMatch = /^NEG:\s*\n([\s\S]*?)(?=\n[^ \n]|\n*$)/m.exec(block)
    const stackLine = grab('Stack')
    slots.push({
      position: marks[i].n,
      header,
      anchor: marks[i].anchor.replace(/\s*\(.*$/, ''),
      meta: header.replace(/^[^（(]*[（(]/, '').replace(/[)）]\s*$/, ''),
      genre: genreOf(header.replace(/^[^（(]*[（(]/, '').replace(/[)）]\s*$/, '')),
      thesis: grab('THESIS'),
      canon: grab('Canon'),
      spine: grab('Spine'),
      stack: stackLine
        ? (stackLine.match(/CR-[A-Z]\d{2}/g) ?? [])
        : [],
      pos: posMatch ? posMatch[1].trim() : '',
      neg: negMatch ? negMatch[1].trim() : '',
    })
  }
  return { slug, text, title, slots }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/* TIER_ORDER импортируется из ./verdicts — единая копия порядка тиров (Залп 2) */

function tierOf(meta: string): string {
  const u = meta.toUpperCase()
  // order matters: XXX before X, R+ before R («R+ ·» — \b after '+' never fires)
  if (/\bXXX\b/.test(u)) return 'XXX'
  if (/\bR\+/.test(u) || /\bRPLUS\b/.test(u)) return 'R+'
  if (/\bPG-13\b/.test(u) || /\bPG13\b/.test(u)) return 'PG-13'
  if (/\bX\b/.test(u)) return 'X'
  if (/\bR\b/.test(u)) return 'R'
  return ''
}

function recipeKey(tier: string): string {
  if (tier === 'PG-13') return 'PG13'
  if (tier === 'R+') return 'RPLUS'
  return tier // R, X, XXX
}

function countSignals(haystackLower: string, signals: string[]): number {
  let n = 0
  for (const s of signals) {
    if (haystackLower.includes(s.toLowerCase())) n += 1
  }
  return n
}

const HEDGES = ['maybe', 'perhaps', 'slightly', 'almost', 'sort of', 'kind of', 'a bit']

const XXX_SIGNALS = [
  'sex', 'sexual act', 'intercourse', 'penetration', 'creampie', 'cum ',
  'cumshot', 'semen', 'blowjob', 'handjob', 'masturbat',
]

/* ------------------------------------------------------------------ */
/* Техника-карта (таблица автора 2026-09-21, PG-13→R→R+→X Cut):        */
/* матчинг приёмов по тег-блоку. Бойлерплейт (опенеры/quality/1girl/   */
/* solo) вырезается — «ecchi anime style» не должен дарить слой 3.     */
/* ------------------------------------------------------------------ */

const TECH_BOILER_RE =
  /\b(?:hentai anime style|ecchi anime style|anime style|masterpiece|best quality|anime artstyle|1girl|solo)\b/gi

function techTagBlock(pos: string): string {
  const firstPeriod = pos.indexOf('.')
  const tb = (firstPeriod > 0 ? pos.slice(0, firstPeriod) : pos).toLowerCase()
  return tb.replace(TECH_BOILER_RE, ' ')
}

function techHit(tb: string, match: string[][]): boolean {
  if (match.length === 0) return false
  return match.some((alt) =>
    alt.every((s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tb))
  )
}

/** Сигнал лестницы R+: ● на R / R+ / X (живёт на R-уровне или выше). */
function isLadderSignal(e: TechniqueEntry): boolean {
  return e.r === '●' || e.rplus === '●' || e.x === '●'
}

/** Дедупликация субсумируемых тегов: «taped nipples» уже содержит «nipples» —
 *  голый X-тег не считается вторым сигналом (двойной счёт ломает сумму). */
function dedupeSubsumed(hits: TechniqueEntry[]): TechniqueEntry[] {
  const has = (re: RegExp) => hits.some((e) => re.test(e.tag))
  return hits.filter((e) => {
    if (e.tag === 'nipples' && has(/nipples through|taped nipples|clothed nipples|covered nipples|nipple outline/)) return false
    if (e.tag === 'naked, nude' && has(/naked apron|naked shirt|almost naked/)) return false
    if (e.tag === 'see-through' && has(/see-through breasts/)) return false
    if (e.tag === 'bare breasts' && has(/breasts out|one breast out/)) return false
    return true
  })
}

const LAYER_NAMES: Record<number, string> = {
  1: 'видимо',
  2: 'как',
  3: 'зачем',
  4: 'дорисовывает',
}

const TECH_WET_RE = /\b(?:wet clothes|steam|shower|rain|sweat)\b/
const TECH_SHEER_RE = /\bsee-through\b/

/* ------------------------------------------------------------------ */
/* Gate runner                                                         */
/* ------------------------------------------------------------------ */

export function runGates(slug: string, dryRun = false): GatesResult | null {
  const file = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (file == null) return null

  const batch = parseBatch(slug, file)
  const contract = readJson<{
    slots: {
      position: number
      rating: string
      race?: string
      poseRisk?: string
      poseName?: string
      carriers: { id: string }[]
    }[]
  }>(path.join(CONTRACTS_DIR, `${slug}.json`))
  const recipes = getRatingRecipes()
  const bans = getBans()
  const carriers = getCarriers()
  const ocCanon = getOCCanon()

  const receipts: GateReceipt[] = []
  const hard = (gate: string, findings: string[]) =>
    receipts.push({ gate, level: 'hard', verdict: findings.length ? 'FAIL' : 'PASS', findings })
  const warn = (gate: string, findings: string[]) =>
    receipts.push({ gate, level: 'warn', verdict: findings.length ? 'WARN' : 'PASS', findings })
  const advisory = (gate: string, findings: string[]) =>
    receipts.push({ gate, level: 'advisory', verdict: 'REPORT', findings })

  /* ---------------- 1. structure (hard) ---------------- */
  {
    const f: string[] = []
    if (batch.slots.length !== LAWS.slotsTotal) {
      f.push(`слотов ${batch.slots.length}, ожидается ${LAWS.slotsTotal} (${LAWS.ocSlots} OC + ${LAWS.mainsTotal} мейнов — вердикт T4-02)`)
    }
    const mains = batch.slots.filter((s) => s.genre !== 'OC')
    const ocSlots = batch.slots.filter((s) => s.genre === 'OC')
    if (ocSlots.length !== LAWS.ocSlots) f.push(`OC-слотов ${ocSlots.length}, ожидается ${LAWS.ocSlots}`)
    if (mains.length !== LAWS.mainsTotal) f.push(`мейнов ${mains.length}, ожидается ${LAWS.mainsTotal}`)
    for (const s of batch.slots) {
      if (s.pos === '') f.push(`P${s.position}: пустой POS`)
      if (s.neg === '') f.push(`P${s.position}: пустой NEG`)
      if (s.thesis === '') f.push(`P${s.position}: нет THESIS`)
      if (s.genre === '') f.push(`P${s.position}: жанр не назван в шапке (OC/NICHE/VOLT/EXQUISITE — вердикт T4-02)`)
      if (s.pos && !/masterpiece/i.test(s.pos)) f.push(`P${s.position}: POS без quality-тегов`)
      if (s.pos && !/anime eyes/i.test(s.pos)) f.push(`P${s.position}: нет фейс-лока (anime eyes)`)
      if (s.pos && !/anime style/i.test(s.pos)) f.push(`P${s.position}: нет опенера (anime style)`)
    }
    // OC slots must carry canon lines
    for (const s of batch.slots.filter((x) => x.position <= 3)) {
      if (s.canon === '') f.push(`P${s.position} (OC): нет Canon-строки`)
    }
    hard('structure', f)
  }

  /* ---------------- 2. floors (hard) ---------------- */
  {
    const f: string[] = []
    const floors = recipes?.eternal_floors ?? {}
    for (const s of batch.slots) {
      const neg = s.neg.toLowerCase()
      for (const term of floors.genital_lock ?? []) {
        if (!neg.includes(term.toLowerCase())) {
          f.push(`P${s.position}: генитальный лок пропускает «${term}»`)
          break
        }
      }
      const loliTerms = floors.anti_loli ?? []
      const loliHits = loliTerms.filter((t) => neg.includes(t.toLowerCase())).length
      if (loliHits < 4) {
        f.push(`P${s.position}: анти-лоли флоор слаб (${loliHits}/${loliTerms.length} терминов) — нужно ≥4`)
      }
      for (const term of floors.leak_guard ?? []) {
        if (!neg.includes(term.toLowerCase())) {
          f.push(`P${s.position}: лика-гарда пропускает «${term}»`)
          break
        }
      }
      // candle guard: required unless the concept itself names the light source
      const posLower = s.pos.toLowerCase()
      const conceptCalls =
        /candle|lantern|torch|chandelier|lamp|brazier/.test(posLower)
      if (!conceptCalls) {
        for (const term of floors.candle_guard ?? []) {
          if (!neg.includes(term.toLowerCase())) {
            f.push(`P${s.position}: свечная гарда пропускает «${term}»`)
            break
          }
        }
      }
      // face guard
      for (const term of floors.face_guard ?? []) {
        if (!neg.includes(term.toLowerCase())) {
          f.push(`P${s.position}: фейс-гарда пропускает «${term}»`)
          break
        }
      }
      // maturity tags (N30): milf is ALWAYS banned in POS; adult woman /
      // mature female are warn-level (batch-wide MILF skew receipt)
      if (/\b(milf|milfs)\b/i.test(s.pos)) {
        f.push(`P${s.position}: тег зрелости в POS («milf») — N30: зрелость только нарративом`)
      }
      // XXX never
      const posLow = s.pos.toLowerCase()
      for (const t of XXX_SIGNALS) {
        if (posLow.includes(t)) {
          f.push(`P${s.position}: XXX-сигнал в POS («${t.trim()}») — вечный потолок`)
          break
        }
      }
    }
    hard('floors', f)
  }

  /* ---------------- 3. rating-recipe (hard) ---------------- */
  {
    const f: string[] = []
    // EXPLORATORY-слоты (§10: 1-2 слота могут нарушать нежёсткий закон с
    // флагом в THESIS): нарушения RENDER LAW у них — квитанция warn, не
    // hard-fail (эксперимент легален, вердикт автора решает)
    const exploratoryFindings: string[] = []
    const isExploratory = (s: (typeof batch.slots)[number]) => s.header.includes('⚗')
    const tiers = recipes?.tiers ?? {}
    const signalMinDefault: Record<string, number> = { 'PG-13': 2, R: 1, 'R+': 2, X: 2 }
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (!tier) {
        f.push(`P${s.position}: рейтинг не распознан в шапке («${s.meta}»)`)
        continue
      }
      const recipe = tiers[recipeKey(tier)]
      if (!recipe) continue
      // сигнал-теги считаются в POS — NEG границу держит, а не зарабатывает
      const posLower = s.pos.toLowerCase()
      const negLower = s.neg.toLowerCase()
      const signals = countSignals(posLower, recipe.signals)
      const min = recipe.signal_min ?? signalMinDefault[tier] ?? 1
      if (signals < min) {
        f.push(
          `P${s.position}: заявлен ${tier}, сигнал-тегов рецепта ${signals}/${min} — рейтинг не заработан (рецепт: ${recipe.signals.slice(0, 5).join(', ')}…)`
        )
      }
      // HARD-CLAIM (вердикт T4-03: 14/15 R+ слотов не дотянули): тир с
      // signals_hard обязан нести именованный edge-объект в POS.
      // v1.2.0 (рендер-вердикт T4-03): hard-сигналы = только рендер-
      // доказанные заявки (pantyline / nipples through / see-through / tape);
      // cameltoe выведен — тег рендер-мёртв (0 отрисовок из всех попыток)
      const hardSignals = recipe.signals_hard ?? []
      if (hardSignals.length > 0) {
        const hard = countSignals(posLower, hardSignals)
        const hardMin = recipe.hard_min ?? 1
        if (hard < hardMin) {
          const cameltoeOnly = /\bcameltoe\b|\bcamel toe\b/.test(posLower)
          f.push(
            `P${s.position}: заявлен ${tier}, но рендер-доказанной заявки нет (${hard}/${hardMin})${cameltoeOnly ? ' — cameltoe рендер-мёртв (0 отрисовок, рендер-вердикт T4-03), заявку не зарабатывает' : ''}: ${hardSignals.slice(0, 4).join(', ')}`
          )
        }
      }
      // RENDER LAW v1.2.0 — только для тиров с механизмами (R+): заявка
      // живёт на состоянии ткани, без подслоя, не на мёртвой ткани
      // (присутствие/подслой/мёртвая ткань = hard; позиция тега = warn,
      // см. claim-visibility — рендер-эвиденс позиций неоднозначен)
      const firstDot = s.pos.indexOf('.')
      const tagRun = (firstDot > 0 ? s.pos.slice(0, firstDot) : s.pos).toLowerCase()
      for (const [mechName, m] of Object.entries(recipe.mechanisms ?? {})) {
        const mHard = m.hard ?? []
        const activeHard = mHard.filter((h) => tagRun.includes(h.toLowerCase()))
        if (activeHard.length === 0) continue
        // (а) состояние ткани обязательно в тег-блоке
        const reqState = m.required_state ?? []
        if (reqState.length > 0) {
          const stateHit = reqState.some((st) => tagRun.includes(st.toLowerCase()))
          if (!stateHit) {
            const msg = `P${s.position}: механизм «${mechName}» без состояния ткани — в тег-блоке нет ни одного из [${reqState.join(' / ')}] (рендер-вердикт T4-03: сухая плотная ткань не несёт edge, P13/P21 умерли именно так)`
            if (isExploratory(s)) {
              exploratoryFindings.push(`EXPLORATORY (§10, квитанция): ${msg}`)
            } else {
              f.push(msg)
            }
          }
        }
        // (б) подслой глушит чит: bra/camisole под sheer = рендерер рисует ПОДСЛОЙ
        const blockApplies = m.underlayer_block_applies_to ?? []
        if (blockApplies.some((h) => activeHard.includes(h))) {
          for (const u of m.underlayer_block ?? []) {
            const re = new RegExp(`\\b${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            if (re.test(tagRun)) {
              f.push(
                `P${s.position}: подслой «${u}» под сквозь-ткань заявкой — рендерер рисует подслой, не edge, тиры падают в R (рендер-вердикт T4-03: P12 sports bra под sheer → R, P14 bra под gauze → R)`
              )
              break
            }
          }
        }
        // (в) мёртвые ткани не несут заявку — зона-осознанно: lower-заявки
        // (pantyline) гибнут на джинсах/коже/свитпанах; upper-заявки
        // (nipples through / see-through) — на бархате/коже/фланели
        const lowerClaims = m.lower_claims ?? []
        const upperClaims = m.upper_claims ?? []
        const isLower = activeHard.some((h) => lowerClaims.includes(h))
        const isUpper = activeHard.some((h) => upperClaims.includes(h))
        const deadList = isLower
          ? [...(m.dead_fabrics_lower ?? []), ...(m.dead_fabrics_upper ?? []).filter((x) => x === 'suit')]
          : isUpper
            ? [...(m.dead_fabrics_upper ?? []), ...(m.dead_fabrics_lower ?? []).filter((x) => x === 'suit')]
            : []
        for (const df of deadList) {
          const re = new RegExp(`\\b${df.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
          if (re.test(tagRun)) {
            f.push(
              `P${s.position}: мёртвая ткань «${df}» в тег-блоке при активной ${isLower ? 'нижней' : 'грудной'} заявке «${mechName}» — эта ткань не несёт edge (рендер-вердикт T4-03: джинсы/бархат/костюм → PG-13)`
            )
            break
          }
        }
      }
      // механизм-осознанный контр-NEG (вердикт T4-03: «только купальник»):
      // активный механизм держит СВОЙ boundary — lifted-термины в NEG глушат
      for (const [mechName, m] of Object.entries(recipe.mechanisms ?? {})) {
        const mHard = m.hard ?? []
        if (!mHard.some((h) => posLower.includes(h.toLowerCase()))) continue
        for (const t of m.counter_neg ?? []) {
          if (!negLower.includes(t.toLowerCase())) {
            f.push(`P${s.position}: механизм «${mechName}» требует контр-NEG «${t}» в NEG`)
          }
        }
        for (const t of m.counter_neg_lifted ?? []) {
          if (negLower.includes(t.toLowerCase())) {
            f.push(
              `P${s.position}: механизм «${mechName}» заглушен — «${t}» в NEG закрывает грудь и душит сигнал (вердикт T4-03)`
            )
          }
        }
      }
      // counter-NEG: at least one boundary term present
      const counterHit = (recipe.counter_neg ?? []).some((t) => negLower.includes(t.toLowerCase()))
      if (!counterHit) {
        f.push(`P${s.position}: контр-NEG не держит границу тира (нужно ≥1 из: ${(recipe.counter_neg ?? []).slice(0, 3).join(', ')})`)
      }
      // X CUT HOLD (техника-карта автора, блок 9 — рецепт v1.3.0): X = грудь/
      // соски, низ — в одежде или вне кадра. NEG несёт ВЕСЬ блок границы
      // тира (не ≥1), POS не приглашает рендерер вниз
      if (tier === 'X') {
        const missing = (recipe.counter_neg ?? []).filter((t) => !negLower.includes(t.toLowerCase()))
        if (missing.length > 0) {
          f.push(
            `P${s.position}: X Cut hold (блок 9) — в NEG нет: ${missing.join(', ')} — весь блок границы X обязан стоять в NEG (главная угроза X Cut — модель дорисовывает ниже; это флоор-сила, не совет)`
          )
        }
        for (const t of ['spread legs', 'nude lower body', 'uncensored']) {
          if (tagRun.includes(t)) {
            f.push(`P${s.position}: X Cut hold (блок 9) — «${t}» в POS приглашает рендерер ниже груди`)
            break
          }
        }
      }
      // no above-tier signals (overclaim) — but a higher-tier token that is a
      // SUBSTRING of this tier's own signal phrase is by design (e.g. R+ «taped
      // nipples» contains the X token «nipples») — not an overclaim
      const myOrder = TIER_ORDER[tier] ?? 0
      const mySignals = recipe?.signals ?? []
      for (const [otherKey, other] of Object.entries(tiers)) {
        const otherTier =
          otherKey === 'PG13' ? 'PG-13' : otherKey === 'RPLUS' ? 'R+' : otherKey
        if ((TIER_ORDER[otherTier] ?? 0) > myOrder && otherTier !== 'XXX') {
          const over = (other.signals ?? []).filter(
            (sig) =>
              s.pos.toLowerCase().includes(sig.toLowerCase()) &&
              !mySignals.some((m) => m.toLowerCase().includes(sig.toLowerCase()))
          )
          if (over.length >= 1 && tier !== 'X') {
            f.push(`P${s.position}: заявлен ${tier}, но несёт сигнал выше тиром: «${over[0]}»`)
          }
        }
      }
    }
    hard('rating-recipe', f)
    // эксперименты (§10) — квитанцией в claim-visibility (warn), не блоком
    if (exploratoryFindings.length > 0) {
      receipts.push({
        gate: 'rating-recipe-exploratory',
        level: 'warn',
        verdict: 'WARN',
        findings: exploratoryFindings,
      })
    }
  }

  /* ---------------- 4. canon (hard) ---------------- */
  {
    const f: string[] = []
    const ocText = (name: string) => {
      const oc = ocCanon?.ocs[name]
      if (!oc) return null
      return {
        hair: String(oc.hair ?? ''),
        eyes: String(oc.eyes ?? ''),
      }
    }
    // ЗАПРЕТ ИМЁН В POS (приказ автора, вердикт T4-04): имена ОС в POS —
    // триггеры реально существующих персонажей у рендерера. POS описывает
    // персонажа дескрипторами (раса/анатомия/волосы/глаза/кожа); имя живёт
    // в шапке и Canon-строке, которые рендерер не читает
    const ocNames = Object.keys(ocCanon?.ocs ?? {})
    for (const s of batch.slots) {
      for (const name of ocNames) {
        // case-sensitive: имена — имена собственные; «ash-grey» ≠ OC Ash
        const re = new RegExp(`\\b${name}\\b`)
        if (re.test(s.pos)) {
          f.push(
            `P${s.position}: имя ОС «${name}» в POS — триггер чужих персонажей у рендерера (приказ автора, T4-04); опиши её дескрипторами, имя живёт в шапке/Canon`
          )
          break
        }
      }
    }
    for (const s of batch.slots.filter((x) => x.position <= 3)) {
      // Залп 2 (аудит RC-2/MD-1): список имён OC гейт читает из oc-canon.json,
      // а не из застывшего regex'а в коде — канонизация (Ana, следующая) не
      // рассинхронизирует гейт
      const ocNames = Object.keys(getOCCanon()?.ocs ?? {}).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const nameMatch =
        ocNames.length > 0
          ? new RegExp(`\\b(${ocNames.join('|')})\\b`).exec(s.header + ' ' + s.canon)
          : null
      if (!nameMatch) {
        f.push(`P${s.position}: OC не опознан в шапке`)
        continue
      }
      const oc = ocText(nameMatch[1])
      if (!oc) continue
      const hairWords = (oc.hair.match(/[a-z]+/gi) ?? []).filter(
        (w) => w.length > 3 && !['hair', 'with', 'held', 'long', 'into'].includes(w.toLowerCase())
      )
      const eyeWords = (oc.eyes.match(/[a-z]+/gi) ?? []).filter(
        (w) => w.length > 3 && !['eyes', 'with', 'held'].includes(w.toLowerCase())
      )
      const hay = (s.canon + ' ' + s.pos).toLowerCase()
      const hairHit = hairWords.some((w) => hay.includes(w.toLowerCase()))
      const eyeHit = eyeWords.some((w) => hay.includes(w.toLowerCase()))
      if (!hairHit) f.push(`P${s.position} (${nameMatch[1]}): канон-лок волос не виден`)
      if (!eyeHit) f.push(`P${s.position} (${nameMatch[1]}): канон-лок глаз не виден`)
    }
    hard('canon', f)
  }

  /* ---------------- 5. diversity (hard) ---------------- */
  {
    const f: string[] = []
    const mechOf = (cls: string) => carriers?.class_defs?.[cls]?.mech ?? ''
    const clsOf = (id: string) => (/^CR-([A-Z])/.exec(id) ?? [])[1] ?? '?'
    const allStacked: string[] = []
    let sheerFrames = 0
    let rplusCount = 0
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (tier === 'R+' || tier === 'X') {
        rplusCount += 1
        const groups = new Set(s.stack.map((id) => mechOf(clsOf(id))))
        const classes = new Set(s.stack.map((id) => clsOf(id)))
        if (s.stack.length < 4) {
          f.push(`P${s.position}: стек ${s.stack.length}/4 носителей (core-4)`)
        }
        if (groups.size < 4) {
          f.push(`P${s.position}: механо-групп ${groups.size}/4 (${[...groups].join(',') || 'пусто'})`)
        }
        if (classes.size < 4) {
          f.push(`P${s.position}: классов ${classes.size}/4`)
        }
        const sheerIds = (s.stack ?? []).filter((id) => {
          const c = Object.values(carriers?.classes ?? {})
            .flat()
            .find((x) => x.id === id)
          return c?.sheer_family === true
        })
        if (sheerIds.length > 2) {
          f.push(`P${s.position}: sheer-носителей ${sheerIds.length} > 2`)
        }
        if (sheerIds.length > 0) sheerFrames += 1
      }
      allStacked.push(...s.stack)
    }
    // моно-носитель N28 (фикс после T4-03: CR-W27 вставал во все 15 R+/X
    // слотов — lruPick не дедуплицировал внутри батча): один ID ≤4 слотов
    const perCarrier: Record<string, number> = {}
    for (const id of batch.slots.flatMap((s) => s.stack)) {
      perCarrier[id] = (perCarrier[id] ?? 0) + 1
    }
    for (const [id, n] of Object.entries(perCarrier)) {
      if (n > 4) f.push(`моно-носитель ${id} в ${n} слотах > 4 — моно-механизм N28`)
    }
    const wCount = allStacked.filter((id) => clsOf(id) === 'W').length
    const wShare = allStacked.length ? Math.round((wCount / allStacked.length) * 100) : 0
    if (wShare > 45) f.push(`W-класс ${wShare}% > 45% (моно-механизм)`)
    if (rplusCount > 0) {
      const sheerPct = Math.round((sheerFrames / rplusCount) * 100)
      if (sheerPct > 40) f.push(`sheer-кадры ${sheerPct}% > 40% R+ слотов (N28-ловушка)`)
    }
    const poseIds = batch.slots.map((s) => (/\bPL\d{1,3}\b/.exec(s.header) ?? [])[0]).filter(Boolean)
    if (new Set(poseIds).size !== poseIds.length) f.push('позы не уникальны в батче')
    // palette ids are the underscore form (P77_LATE_MILK) — the bare P\d+ form
    // would catch the slot's own position marker (P01…) and never fail
    const palIds = batch.slots
      .map((s) => (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(s.header) ?? [])[0])
      .filter(Boolean)
    if (poseIds.length === LAWS.slotsTotal && palIds.length !== LAWS.slotsTotal) {
      f.push(`слотов с палитрой в шапке: ${palIds.length}/${LAWS.slotsTotal}`)
    }
    if (palIds.length >= LAWS.slotsTotal && new Set(palIds).size < LAWS.slotsTotal) {
      f.push('палитры не уникальны в батче')
    }
    hard('diversity', f)
  }

  /* ---------------- 6. window (hard, vacuous on clean slate) ------- */
  {
    const f: string[] = []
    const state = foldState(readEvents())
    if (state.windowSlugs.length > 0 && contract) {
      // повторная сдача (v2): батч не конфликтует сам с собой — своё окно
      // исключается (событие batch.delivered уже внесло слаг в окно)
      const windowOthers = state.windowSlugs.filter((w) => w !== batch.slug)
      const myPoses = new Set(
        batch.slots.map((s) => (/\bPL\d{1,3}\b/.exec(s.header) ?? [])[0]).filter(Boolean)
      )
      const myPals = new Set(
        batch.slots.map((s) => (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(s.header) ?? [])[0]).filter(Boolean)
      )
      for (const w of windowOthers) {
        const wc = readJson<{ slots: { pose: string; palette: string }[] }>(
          path.join(CONTRACTS_DIR, `${w}.json`)
        )
        if (!wc) continue
        for (const s of wc.slots) {
          if (myPoses.has(s.pose)) f.push(`поза ${s.pose} конфликтует с окном (${w})`)
          if (myPals.has(s.palette)) f.push(`палитра ${s.palette} конфликтует с окном (${w})`)
        }
      }
    }
    hard('window', f)
  }

  /* ---------------- 7. budget (warn) ---------------- */
  {
    const f: string[] = []
    const target = bans?.word_budget.pos_target ?? 300
    const hardCap = bans?.word_budget.pos_hard ?? 400
    for (const s of batch.slots) {
      const words = s.pos.split(/\s+/).filter(Boolean).length
      if (words > hardCap) f.push(`P${s.position}: POS ${words} слов > ${hardCap}`)
      else if (words > target) f.push(`P${s.position}: POS ${words} слов (цель ${target}) — плотнее`)
      const hedges = HEDGES.filter((h) => s.pos.toLowerCase().includes(h)).length
      if (hedges > (bans?.hedge_budget ?? 2)) f.push(`P${s.position}: хеджей ${hedges} > 2`)
    }
    warn('budget', f)
  }

  /* ---------------- 8. cadence (warn) ---------------- */
  {
    const f: string[] = []
    const closers: Record<string, number> = { other: 0 }
    for (const s of batch.slots) {
      const sentences = s.pos.split(/(?<=[.!?…"\u00bb])\s+/).filter(Boolean)
      const last = sentences[sentences.length - 1] ?? ''
      if (/[«"„]/.test(last) || /"\s*$/.test(last)) closers.dialogue = (closers.dialogue ?? 0) + 1
      else if (/—\s*\S+[.,]?\s*$/.test(last)) closers['fragment-pair'] = (closers['fragment-pair'] ?? 0) + 1
      else if (/\b(waited|still|again|on)\.\s*$/i.test(last)) closers['image-close'] = (closers['image-close'] ?? 0) + 1
      else closers.other += 1
    }
    const total = batch.slots.length || 1
    for (const [cls, n] of Object.entries(closers)) {
      if (n / total > 0.6 && cls !== 'other') {
        f.push(`клоузер-формула: ${cls} ${Math.round((n / total) * 100)}% > 60% (N25-ловушка)`)
      }
    }
    warn('cadence', f)
  }

  /* ---------------- 8b. niche legibility (warn — вердикт T4-02) ----- */
  {
    // Автор не увидел NICHE в T4-02 → ниша обязана быть видна:
    // раса делает физическую работу (теги расы в POS) + свидетель в кадре.
    const f: string[] = []
    const racesSpec = getRaces()
    const nicheSlots = batch.slots.filter((s) => s.genre === 'NICHE')
    const WITNESS_WORDS = [
      'mirror', 'shop glass', 'security monitor', 'door gap', 'propped phone',
      'traffic mirror', 'level gauge', 'window pane', 'wet street', 'elevator brass',
      'photo frame', 'spoon', 'watch face', 'car hood', 'fountain edge', 'witness',
    ]
    for (const s of nicheSlots) {
      const posLower = s.pos.toLowerCase()
      // race legibility: tokens of the assigned race (name + features) in POS
      const slot = contract?.slots?.find((x) => x.position === s.position)
      const raceName = slot?.race ?? ''
      if (raceName) {
        const raceEntry = racesSpec?.races.find(
          (r) => raceName.toLowerCase().includes(r.name.toLowerCase().split(' (')[0]) ||
            r.name.toLowerCase().includes(raceName.toLowerCase().split(' (')[0])
        )
        const tokens = new Set(
          [
            ...raceName.toLowerCase().replace(/[()-]/g, ' ').split(/\s+/),
            ...(raceEntry?.features ?? []).join(' ').toLowerCase().replace(/[()-]/g, ' ').split(/\s+/),
          ].filter((w) => w.length > 3 && !['girl', 'kin', 'with'].includes(w))
        )
        const hits = [...tokens].filter((w) => posLower.includes(w)).length
        if (hits < 2) {
          f.push(`P${s.position}: NICHE-раса «${raceName}» не читается в POS (тегов расы ${hits}/2) — раса делает физическую работу в кадре`)
        }
      }
      const witnessHit = WITNESS_WORDS.some((w) => posLower.includes(w))
      if (!witnessHit && raceName) {
        f.push(`P${s.position}: NICHE без свидетеля в кадре (mirror/glass/monitor/phone/gauge…) — свидетель держит невозможное`)
      }
    }
    if (nicheSlots.length === 0 && batch.slots.length === LAWS.slotsTotal) {
      f.push('NICHE-слотов нет — жанровая структура батча сломана')
    }
    warn('niche-legibility', f)
  }

  /* ---------------- 8c. prop geometry (warn — вердикт T4-02) -------- */
  {
    // Штурвал в T4-02: «небольшая хуёвая геометрия расположения» —
    // сложный проп требует названных якорей контакта (руки/ноги/корпус).
    const f: string[] = []
    const COMPLEX_PROPS = [
      'wheel', 'helm', 'valve', 'ladder', 'stairs', 'staircase', 'railing', 'rail',
      'bicycle', 'handlebar', 'rope', 'pulley', 'crane', 'swing', 'scaffold',
      'scaffolding', 'mast', 'tiller', 'treadmill', 'steering', 'oar', 'winch',
    ]
    const ANCHORS = [
      'hand on', 'hands on', 'hands at', 'fingers around', 'fingers curled', 'grip',
      'gripping', 'grips', 'grip on', 'braced', 'brace', 'foot on', 'feet on',
      'feet braced', 'feet planted', 'palm flat', 'palm on', 'knee on', 'elbow on',
      'shoulder against', 'leaning against', 'lean against', 'arched against',
      'heels planted', 'toes on', 'fingertips on', 'wrapped around', 'wound around',
      'knuckles white', 'soles flat', 'held fast', 'anchored',
    ]
    for (const s of batch.slots) {
      // тег-блок — то, что рендерер обязан нарисовать (до первой точки);
      // метафоры прозы («her leg as its staircase») пропами не считаются
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const prop = COMPLEX_PROPS.find((p) => new RegExp(`\\b${p}\\b`).test(tagBlock))
      if (!prop) continue
      const posLower = s.pos.toLowerCase()
      const anchorHits = ANCHORS.filter((a) => posLower.includes(a)).length
      if (anchorHits < 2) {
        f.push(`P${s.position}: сложный проп «${prop}» с ${anchorHits}/2 якорей контакта — назови, где руки/ноги (вердикт T4-02, геометрия)`)
      }
    }
    warn('prop-geometry', f)
  }

  /* ---------------- 8d. claim visibility (warn — вердикт T4-03) ------ */
  {
    // Вердикт T4-03: R+ сигнал заявлен на зоне, которую стейджинг закрывает
    // (рубашка на талии, юбка, плащ), либо слоёв столько, что рендер путает
    // порядок («чулки сквозь джинсы, майка поверх рубашки»), либо OC-слот
    // ушёл позой от камеры. Зона сигнала = LEAD, открыта камере.
    const f: string[] = []
    const LOWER_COVERS = [
      'skirt', 'dress', 'cloak', 'cape', 'coat', 'apron', 'happi',
      'tied at waist', 'tied at the waist', 'shirt tied', 'towel around waist',
      'waist wrap', 'sarong', 'long shirt', 'untucked shirt', 'peplum',
    ]
    const CHEST_COVERS = [
      'buttoned shirt', 'buttoned-up', 'buttoned up', 'zipped up', 'zipped to',
      'closed jacket', 'buttoned jacket', 'turtleneck', 'high-neck', 'closed coat',
    ]
    const TOP_LAYERS = [
      'shirt', 'tee', 't-shirt', 'tank', 'camisole', 'blouse', 'sweater',
      'pullover', 'hoodie', 'jacket', 'coat', 'blazer', 'cardigan', 'happi',
      'tunic', 'turtleneck', 'button-down', 'flannel', 'jersey', 'varsity',
      'parka', 'poncho', 'robe', 'overalls',
    ]
    const GARMENT_NOUNS = new Set([
      ...TOP_LAYERS, 'leotard', 'bodysuit', 'swimsuit', 'bikini', 'microbikini',
      'bra', 'panties', 'thong', 'boyshorts', 'lingerie', 'garter belt',
      'stockings', 'thighhighs', 'socks', 'jeans', 'pants', 'trousers',
      'breeches', 'shorts', 'skirt', 'dress', 'apron', 'towel', 'nightgown',
      'slip', 'corset', 'harness', 'wrap', 'sarong', 'sash', 'obi', 'bolero',
      'kimono', 'happi', 'leggings', 'fishnets', 'jersey', 'uniform', 'cloak', 'cape',
    ])
    const POSE_AWAY = [
      'forward fold', 'prone', 'facedown', 'face down', 'from behind',
      'back to camera', 'back turned', 'bent away',
    ]
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (tier !== 'R+' && tier !== 'X') continue
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const posLower = s.pos.toLowerCase()
      // word-boundary матчинг: «escaped» не должен ловиться как «cape»
      const coverIn = (list: string[]) =>
        list.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tagBlock))
      // 1) нижняя зона сигнала закрыта верхним предметом
      const lowerClaim = ['cameltoe', 'camel toe', 'visible pantyline', 'pantyline'].some((c) =>
        tagBlock.includes(c)
      )
      if (lowerClaim) {
        const cover = coverIn(LOWER_COVERS)
        if (cover) {
          f.push(
            `P${s.position}: зона сигнала (низ) закрыта «${cover}» — cameltoe/pantyline не виден камере; открой зону или перевези claim (вердикт T4-03)`
          )
        }
      }
      // 2) грудная on-skin зона закрыта застёгнутым верхом
      const chestClaim = ['taped nipples', 'topless with tape', 'handbra'].some((c) =>
        tagBlock.includes(c)
      )
      if (chestClaim) {
        const cover = coverIn(CHEST_COVERS)
        if (cover) {
          f.push(
            `P${s.position}: зона сигнала (грудь) закрыта «${cover}» — tape/handbra не виден камере (вердикт T4-03)`
          )
        }
      }
      // 3) слоевой хаос: ≥5 предметов одежды в тег-блоке
      const garments = [...GARMENT_NOUNS].filter((g) => new RegExp(`\\b${g}\\b`).test(tagBlock))
      if (garments.length >= 5) {
        f.push(
          `P${s.position}: ${garments.length} предметов одежды в тег-блоке (${garments.slice(0, 5).join(', ')}) — ≤2 слоя на зону, зона сигнала ≤1 (вердикт T4-03: слои путают рендер)`
        )
      }
      // 3b) стопка верхних слоёв: ≥3 верхних предметов
      const tops = TOP_LAYERS.filter((g) => new RegExp(`\\b${g}\\b`).test(tagBlock))
      if (tops.length >= 3) {
        f.push(
          `P${s.position}: стопка верхних слоёв ${tops.length} (${tops.join(', ')}) — «майка поверх рубашки» ломает порядок слоёв (вердикт T4-03)`
        )
      }
      // 4) OC-слот позой уходит от камеры — зона сигнала не читается
      if (s.genre === 'OC') {
        const away = POSE_AWAY.find((p) => tagBlock.includes(p) || posLower.includes(p))
        if (away) {
          f.push(
            `P${s.position}: OC-слот с позой «${away}» — зона сигнала уходит от камеры; OC = любимые персонажи автора, камера-смотрящие позы (вердикт T4-03)`
          )
        }
      }
      // 5) позиция заявки/состояния в тег-ране (рендер-вердикт T4-03:
      // хвостовые сигналы рендерятся слабо; эвиденс неоднозначен — warn).
      // OC-слоты: канон-локи съедают первые ~15 тегов по закону — им люфт
      if (tier === 'R+') {
        const posTags = tagBlock.split(',').map((t) => t.trim())
        const findIdx = (needle: string) => posTags.findIndex((t) => t.includes(needle))
        // РАННЕЕ вхождение состояния решает (see-through №13 + wet №18 = раннее)
        const idxs = [findIdx('wet clothes'), findIdx('see-through')].filter((i) => i >= 0)
        const wetIdx = idxs.length > 0 ? Math.min(...idxs) : -1
        const limit = s.genre === 'OC' ? 22 : 16 // 0-based
        if (wetIdx >= limit) {
          f.push(
            `P${s.position}: состояние ткани стоит тегом №${wetIdx + 1} — хвост тег-рана рендерер читает слабо; подними wet clothes / see-through к началу (рендер-вердикт T4-03)`
          )
        }
      }
    }
    warn('claim-visibility', f)
  }

  /* ---------------- 8e. technique-layers (warn — таблица автора) ----- */
  {
    // ТЕХНИКА-КАРТА (2026-09-21): закон суммы факторов (блок 8) — R+ = 3+
    // R-сигнала через 2+ из четырёх слоёв (что видно / как показано / зачем
    // показано / что модель дорисовывает); ловушки (X-● теги — модель
    // дорисовывает сосок сама); супрессоры (держат PG-13); мокрое+сквозное
    // = осознанный X-риск (блок 8, строка 5); X Cut hold — кадрирование/
    // низ в одежде (блок 9). Всё — квитанции: вердикт по эротике у автора.
    const tech = getRatingTechniques()
    const f: string[] = []
    if (tech) {
      const wetSheerSlots: string[] = []
      for (const s of batch.slots) {
        const tier = tierOf(s.meta)
        if (tier !== 'R+' && tier !== 'X') continue
        const tb = techTagBlock(s.pos)
        const hits = dedupeSubsumed(tech.techniques.filter((e) => techHit(tb, e.match)))
        const ladder = hits.filter(isLadderSignal)
        const layersHit = [...new Set(ladder.map((e) => e.layer))].sort((a, b) => a - b)
        if (tier === 'R+') {
          // (1) сумма факторов — R+ зарабатывается суммой, не одним слоем
          const floor = tech.sum_rules.rplus_floor
          if (ladder.length < floor.signals_min || layersHit.length < floor.layers_min) {
            const map = ladder.map((e) => e.tag.split(',')[0]).slice(0, 6).join(', ')
            f.push(
              `P${s.position}: сумма факторов не набрана — ${ladder.length} сигнал(а) через ${layersHit.length} слой(я) ${layersHit.length > 0 ? `(${layersHit.map((l) => LAYER_NAMES[l]).join('+')})` : ''}· блок 8: R+ = ${floor.signals_min}+ сигнала через ${floor.layers_min}+ слоя — это R/R+ граница, не R+ сумма; карта кадра: ${map || '—'}`
            )
          }
          // (2) ловушки: X-● теги в R+ тег-блоке — модель часто решает за тебя
          for (const e of hits) {
            if (e.trap) {
              f.push(`P${s.position}: ловушка «${e.tag}» — ${e.note} (X-риск известен до рендера)`)
            }
          }
          // (3) супрессоры: держат кадр в PG-13/R сколько бы слоёв ни было
          for (const e of hits) {
            if (e.suppressor) {
              f.push(`P${s.position}: супрессор «${e.tag}» — держит кадр ниже заявленного, снимай или компенсируй (блок 4/7)`)
            }
          }
          // (4) мокрое + сквозное — осознанный X-риск (считается батч-уровнем ниже)
          if (TECH_WET_RE.test(tb) && TECH_SHEER_RE.test(tb)) wetSheerSlots.push(`P${s.position}`)
        }
        if (tier === 'X') {
          // (5) X Cut hold: кадрирование или закрытый низ (блок 9)
          const framing = tech.xcut_hold.framing.some((t) => techHit(tb, [[t]]))
          const covered = tech.xcut_hold.lower_cover.some((t) => techHit(tb, [[t]]))
          if (!framing && !covered) {
            f.push(
              `P${s.position}: X Cut hold (блок 9) — низ тела ни закрыт (${tech.xcut_hold.lower_cover.slice(0, 5).join('/')}…), ни выведен из кадра (${tech.xcut_hold.framing.join('/')}) — модель может «дорисовать» ниже`
            )
          }
        }
      }
      if (wetSheerSlots.length > 0) {
        f.push(
          `осознанный X-риск (блок 8, строка 5): ${wetSheerSlots.length} R+ слотов несут мокрое+сквозное (${wetSheerSlots.join(', ')}) — очень высокий риск нечаянного X при рендере; это рабочий механизм рецепта v1.2.0, автор фильтрует перекидкой`
        )
      }
    }
    warn('technique-layers', f)
  }

  /* ---------------- 8f. noun-lock (warn — §10-поправка, Claude №4) ---- */
  {
    // ЗАКОН САЛИЕНСА, следствие noun-lock: заявка живёт на ИМЕНОВАННОМ
    // объекте (тонкая светлая вещь с именем-существительным), и подслой
    // под сквозь-ткань заявку должен быть ЗАЛОЧЕН в NEG — тишина по
    // подслою = дыра: рендерер дорисовывает bra/camisole сам, тир падает
    // в R (рендер-вердикт T4-03: P12/P14). PRESENT ≠ VISIBLE ≠ LEGIBLE.
    const f: string[] = []
    const UPPER_LIGHT = [
      'blouse', 'tee', 't-shirt', 'shirt', 'knit', 'cardigan', 'leotard',
      'bodysuit', 'swimsuit', 'bikini', 'romper', 'slip', 'dress',
      'sundress', 'nightgown', 'gown', 'robe', 'kimono', 'yukata', 'sheet',
      'towel', 'halter', 'tunic', 'apron', 'qipao', 'cheongsam',
      'sweater', 'gi', 'nightshirt',
    ]
    const LOWER_LIGHT = [
      'skirt', 'shorts', 'pants', 'trousers', 'leggings', 'tights',
      'pantyhose', 'dress', 'sheet', 'towel', 'sarong', 'wrap', 'slip',
      'leotard', 'bodysuit', 'swimsuit', 'bikini', 'romper', 'qipao', 'boyshorts',
    ]
    const UNDERLOCK = [
      'bra', 'sports bra', 'push-up bra', 'camisole', 'bandeau',
      'undershirt', 'swimsuit top',
    ]
    const hasWord = (hay: string, word: string) =>
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)
    const UPPER_CLAIMS = ['nipples through clothing', 'clothed nipples', 'see-through']
    const LOWER_CLAIMS = ['visible pantyline', 'pantyline']
    const ON_SKIN = ['taped nipples', 'topless with tape', 'handbra']
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (tier !== 'R+') continue
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const negLower = s.neg.toLowerCase()
      const posLowerFull = s.pos.toLowerCase()
      const upperActive = UPPER_CLAIMS.filter((c) => tagBlock.includes(c))
      const lowerActive = LOWER_CLAIMS.filter((c) => tagBlock.includes(c))
      const onSkinActive = ON_SKIN.filter((c) => tagBlock.includes(c))
      if (upperActive.length === 0 && lowerActive.length === 0 && onSkinActive.length === 0) continue
      // on-skin заявки (tape/handbra) garment не требуют — зона голая
      if (upperActive.length > 0) {
        const garment = UPPER_LIGHT.find((g) => hasWord(tagBlock, g))
        if (!garment) {
          f.push(
            `P${s.position}: сквозь-ткань заявка (${upperActive[0]}) не залочена на именованную тонкую вещь — назови garment существительным (blouse/tee/shirt/knit/swimsuit/leotard/sheet/towel…), прилагательное заявку не несёт (§10-поправка, noun-lock)`
          )
        }
        // тишина по подслою = дыра: NEG лочит подслой, иначе рендерер
        // дорисовывает его сам (P12 sports bra под sheer → R, P14 bra → R).
        // Границы слов обязательны: «brazier» свечной гарды ≠ «bra»
        const lock = UNDERLOCK.filter((t) => !hasWord(tagBlock, t)).find((t) =>
          new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(negLower)
        )
        if (!lock) {
          f.push(
            `P${s.position}: тишина по подслою = дыра — NEG не лочит подслой (bra / camisole / bandeau / undershirt): рендерер дорисует его сам и тир упадёт в R (§10-поправка, noun-lock)`
          )
        }
        // §9-септима, правило 1 — BARE-UNDER ПОЗИТИВОМ (вердикт T4-05,
        // P07: лифчик нарисован ПОВЕРХ NEG-лока): негатива мало — POS
        // обязан нести позитивное утверждение голого подслоя. Требование
        // — только для сквозь-ткань заявки СОСКОВ (nipples through /
        // clothed nipples): see-through сам по себе подслой не заявляет.
        const BARE_UNDER = [
          'nothing underneath', 'nothing beneath', 'nothing under', 'braless',
          'no bra', 'without underlayer', 'worn without a bra',
          'worn without underlayer', 'unlined', 'only layer', 'single layer',
          'worn alone', 'on bare skin', 'against bare skin',
        ]
        const needsBareUnder = upperActive.some((c) =>
          c === 'nipples through clothing' || c === 'clothed nipples'
        )
        if (needsBareUnder && !BARE_UNDER.some((t) => posLowerFull.includes(t))) {
          f.push(
            `P${s.position}: подслой не заявлен позитивом — «braless / nothing underneath» нет в POS: негатива мало, рендерер рисует лифчик ПОВЕРХ NEG-лока (вердикт T4-05, P07) — POS обязан нести позитивное утверждение (§9-септима, noun-lock bare-under)`
          )
        }
      }
      if (lowerActive.length > 0) {
        const garment = LOWER_LIGHT.find((g) => hasWord(tagBlock, g))
        if (!garment) {
          f.push(
            `P${s.position}: нижняя заявка (${lowerActive[0]}) не залочена на именованную вещь — pantyline живёт на именованном низе (skirt/shorts/leggings/sheet…), не в воздухе (§10-поправка, noun-lock)`
          )
        }
      }
    }
    warn('noun-lock', f)
  }

  /* ------- 8g. character-collision (warn — §9-септима, правило 3) ---- */
  {
    // ВЕРДИКТ T4-05, P08: слово «aurora» из палитры → рендерер матнул
    // aurora_(arknights) и ВПУСТИЛ чужого персонажа в кадр («пробежал
    // персонаж»). Данбуру-омонимы (слова-имена чужих персонажей) в POS
    // допустимы ТОЛЬКО составными (aurora borealis sky), одиночное слово
    // — триггер. Список растёт от вердиктов: каждый пойманный омоним
    // становится строкой здесь.
    const f: string[] = []
    const HOMONYMS: Record<string, string[]> = {
      // слово → безопасные продолжения (составные формы)
      aurora: ['borealis', 'australis', 'sky', 'light', 'dawn', 'veil', 'crown', 'glow', 'shimmer'],
      meteor: ['shower', 'strike', 'glow'],
      nova: ['burst', 'glow'],
      alice: ['in wonderland', 'band', 'blue'],
      miku: ['hatsune'],
      celestia: ['gown', 'veil'],
    }
    for (const s of batch.slots) {
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const prose = (firstPeriod > 0 ? s.pos.slice(firstPeriod) : '').toLowerCase()
      for (const [word, safe] of Object.entries(HOMONYMS)) {
        // одиночное слово — триггер; составное (продолжение из
        // safe-списка) — разрешено; тег-блок и проза проверяются одним
        // правилом («только составные»)
        const re = new RegExp(`\\b${word}\\b(?!\\s+(?:${safe.join('|')}))`, 'i')
        if (re.test(tagBlock) || re.test(prose)) {
          f.push(
            `P${s.position}: омоним данбуру «${word}» в POS — рендерер матчит чужого персонажа (${word}_…: T4-05 P08 — aurora_(arknights) «пробежал персонаж»). Только составной формой (§9-септима, character-collision)`
          )
          break
        }
      }
    }
    warn('character-collision', f)
  }

  /* ---------------- 9b. ab-single-variable (warn, Залп 2 «Рефлекс») -------- */
  {
    const f: string[] = []
    const contract = readJson<{
      abPairs?: { pair: string; a: number; b: number; lead: string }[]
      slots?: { position: number; carriers?: { id: string }[] }[]
    }>(path.join(CONTRACTS_DIR, `${batch.slug}.json`))
    const pairs = contract?.abPairs ?? []
    if (pairs.length === 0) {
      f.push('контракт без A/B-пар — дисциплина §10 не атрибутируема')
    }
    for (const p of pairs) {
      const sa = contract?.slots?.find((s) => s.position === p.a)
      const sb = contract?.slots?.find((s) => s.position === p.b)
      if (!sa || !sb) {
        f.push(`пара ${p.pair}: слоты не читаются из контракта`)
        continue
      }
      const xi = new Set((sa.carriers ?? []).map((c) => c.id))
      const yi = new Set((sb.carriers ?? []).map((c) => c.id))
      let d = 0
      for (const id of xi) if (!yi.has(id)) d++
      for (const id of yi) if (!xi.has(id)) d++
      if (d > 2) {
        f.push(
          `пара ${p.pair} (${p.lead}): ${d} отличий стека — больше одной замены носителя (policy.ab.one_variable, аудит I-4)`
        )
      }
    }
    warn('ab-single-variable', f)
  }

  /* ---------------- 9d. theme-presence (warn, вердикт автора «тема не раскрывается») --- */
  {
    const f: string[] = []
    const text = readText(path.join(BATCHES_DIR, `${batch.slug}.md`)) ?? ''
    const kwLine = /^ТЕМА-СЛОВА:\s*(.+)$/m.exec(text)
    if (!kwLine) {
      f.push('в батче нет строки ТЕМА-СЛОВА — тема не меряется (спайн писца обязан вывести из темы)')
    } else {
      const kws = kwLine[1]
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      const withTheme = batch.slots.filter((s) =>
        kws.some((k) => s.pos.toLowerCase().includes(k) || s.thesis.toLowerCase().includes(k))
      )
      if (withTheme.length < Math.ceil(batch.slots.length * 0.6)) {
        f.push(
          `тему несут ${withTheme.length}/${batch.slots.length} слотов (нужно ≥60%) — слова: ${kws.join(', ')}; тема живёт в кадрах, не в шапке`
        )
      }
    }
    warn('theme-presence', f)
  }

  /* ---------------- 9e. garment-family (warn, U8 «внедрить, но осторожно») --- */
  {
    const f: string[] = []
    const FAMILY = /\b(lingerie|stockings?|garter belt|panties|thong|bra(?!less)|lace)\b/i
    const lingerieSlots = batch.slots.filter((s) => FAMILY.test(s.pos))
    if (lingerieSlots.length > Math.ceil(batch.slots.length * 0.58)) {
      f.push(
        `бельё-семья монополизирует батч: ${lingerieSlots.length}/${batch.slots.length} слотов несут lingerie/stockings/garter — вердикт автора «дохуя белья с чулками»; разнообразь семьи одежды (forma/верхняя/спорт/домашнее), эротика не обязана быть бельём`
      )
    }
    warn('garment-family', f)
  }

  /* ---------------- 9. simcheck (warn) ---------------- */
  {
    const f: string[] = []
    const state = foldState(readEvents())
    // бойлерплейт (quality-теги, фейс-лок N31) общий для всех промптов —
    // не считаем предложением автора, иначе J=1.00 на каждом кадре
    const isBoilerplate = (s: string) =>
      /masterpiece|best quality|anime artstyle/.test(s) ||
      /her face is rendered in stylized/.test(s)
    const sentencesOf = (batchParsed: ParsedBatch) =>
      batchParsed.slots.flatMap((s) =>
        s.pos
          .split(/[.!?]\s+/)
          .map((x) => x.trim().toLowerCase())
          .filter((x) => x.length > 40 && !isBoilerplate(x))
      )
    const mySentences = new Set(sentencesOf(batch))
    // ВНУТРИ-батчевый сход (вердикт-диагноз 2026-09-24: T4-07 P01/P02 —
    // дословные близнецы «the read of her nipples through the damp weave»
    // в одном файле; cross-batch simcheck их не видит)
    const mine = sentencesOf(batch)
    const intra: string[] = []
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const jj = jaccard(words(mine[i]), words(mine[j]))
        if (jj > 0.75) {
          intra.push(`P${batch.slots[i]?.position ?? '?'}≈P${batch.slots[j]?.position ?? '?'}: «${mine[i].slice(0, 60)}…» (J=${jj.toFixed(2)})`)
        }
      }
    }
    if (intra.length > 0) {
      f.push(`внутри-батчевые близнецы: ${intra.slice(0, 4).join(' · ')}${intra.length > 4 ? ` — и ещё ${intra.length - 4}` : ''}`)
    }
    // повторная сдача (v2): себя не сравниваем — своё окно исключено
    for (const w of state.windowSlugs.filter((x) => x !== batch.slug)) {
      const wText = readText(path.join(BATCHES_DIR, `${w}.md`))
      if (!wText) continue
      const wBatch = parseBatch(w, wText)
      const wSentences = sentencesOf(wBatch)
      for (const mineS of mySentences) {
        for (const theirs of wSentences) {
          const j = jaccard(words(mineS), words(theirs))
          if (j > 0.7) {
            f.push(`похоже на ${w}: «${mineS.slice(0, 60)}…» (J=${j.toFixed(2)})`)
          }
        }
      }
    }
    if (f.length > 8) f.splice(8, f.length, `…и ещё ${f.length - 8} пар`)
    warn('simcheck', f)
  }

  /* ---------------- 10. freq report (advisory) ---------------- */
  {
    const f: string[] = []
    const STOP = new Set(
      'the a an and or of in on at to with her his its from into over under is are was were be been by as for that this it she they them their not no but all one two'.split(' ')
    )
    const freq: Record<string, number> = {}
    for (const s of batch.slots) {
      const seen = new Set<string>()
      for (const w of s.pos.toLowerCase().match(/[a-z']+/g) ?? []) {
        if (STOP.has(w) || w.length < 5 || seen.has(w)) continue
        seen.add(w)
        freq[w] = (freq[w] ?? 0) + 1
      }
    }
    const tics = Object.entries(freq)
      .filter(([, n]) => n >= 8)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([w, n]) => `${w} ${n}/21`)
    if (tics.length) f.push(`кандидаты в тики: ${tics.join(' · ')}`)
    else f.push('тиков не обнаружено')
    advisory('freq-report', f)
  }

  /* ---------------- 11. usage (advisory) ---------------- */
  {
    const f: string[] = []
    const stacked = batch.slots.flatMap((s) => s.stack)
    f.push(`носителей в стеках: ${stacked.length}; уникальных: ${new Set(stacked).size}`)
    f.push(`R+ слотов: ${batch.slots.filter((s) => tierOf(s.meta) === 'R+').length}; X: ${batch.slots.filter((s) => tierOf(s.meta) === 'X').length}`)
    advisory('usage', f)
  }

  /* ---------------- 12. technique map (advisory — карта слоёв) ------- */
  {
    // Карта слоёв автора (принцип «для идиота»): сколько сигналов и через
    // какие слои набрано в каждом R+/X кадре. Отчёт, не квитанция —
    // прозрачность для автора: что именно рендерер увидит в тег-ране.
    const tech = getRatingTechniques()
    const f: string[] = []
    if (tech) {
      for (const s of batch.slots) {
        const tier = tierOf(s.meta)
        if (tier !== 'R+' && tier !== 'X') continue
        const tb = techTagBlock(s.pos)
        const hits = dedupeSubsumed(tech.techniques.filter((e) => techHit(tb, e.match)))
        const ladder = hits.filter(isLadderSignal)
        const layersHit = [...new Set(ladder.map((e) => e.layer))].sort((a, b) => a - b)
        const map = ladder.map((e) => e.tag.split(',')[0]).slice(0, 8).join(', ')
        f.push(
          `P${String(s.position).padStart(2, '0')} ${tier}: ${ladder.length} сигнал(ов) · слои ${layersHit.map((l) => `${l}·${LAYER_NAMES[l]}`).join(' + ') || '—'} · ${map || '—'}`
        )
      }
      if (f.length === 0) f.push('R+/X слотов в батче нет')
    } else {
      f.push('техника-карта не загружена (specs/rating-techniques.json)')
    }
    advisory('technique-map', f)
  }

  /* ------------- 12b. salience-chain v2 (advisory — §9-секста + §9-септима) - */
  {
    // ЗАКОН САЛИЕНСА (ChatGPT, external.review 2026-09-23): рейтинг =
    // цепочка OBJECT → EXPOSURE → CAMERA → CONTRAST → SALIENCE →
    // INTERPRETATION; провал звена роняет тир. §9-септима (вердикт
    // T4-05) достроила три звена: BLOCKER (шаль крестом = «the frame's
    // one closed door», P21 — мёртвый слот до рендера), LEGIBILITY
    // (дистанция кадра: P23 T4-05 — рассвет съел заявку), POSE-RISK
    // (акробатика × R+ = амплификатор мутаций: P04 дрейф / P22 мутация /
    // P17 недолёт). Итого 9 звеньев; ≥2 порванных = тир под угрозой.
    // Ретроспектива T4-04: P05 «dark» (пятно-риск) и P03 (слияние со
    // светлым фоном) предсказаны до рендера; T4-05: смерти P21/P07/P17
    // предсказаны до рендера (P07 — noun-lock bare-under).
    const f: string[] = []
    const LIGHT_WORDS = ['white', 'pale', 'cream', 'ivory', 'pastel', 'pink', 'salt', 'linen', 'silver', 'chalk']
    const GLOW_WORDS = ['glow', 'spotlight', 'backlit', 'backlight', 'rim light', 'sunlit', 'sunlight', 'lit from', 'flare']
    const DARK_SCENE = ['night', 'noir', 'midnight', 'dark', 'deep indigo', 'black', 'dusk', 'shadow', 'ultramarine deep', 'eclipse']
    const CAMERA_TAGS = [
      'from below', 'close-up', 'closeup', 'cowboy shot', 'upper body', 'portrait',
      'pov', 'over-shoulder', 'through-gap', 'dutch angle', 'from above', 'wide shot',
      'foreshortening', 'looking up', 'looking down', 'close on',
    ]
    const INTENT_TAGS = [
      'erotic pose', 'extreme fanservice', 'fanservice', 'seductive', 'seductive smile',
      'bedroom eyes', 'half-closed eyes', 'half-lidded', 'parted lips', 'teasing',
      'suggestive', 'provocative', 'come hither', 'sultry', 'looking at viewer', 'eye contact',
    ]
    const UPPER_LIGHT = [
      'blouse', 'tee', 't-shirt', 'shirt', 'knit', 'cardigan', 'leotard', 'bodysuit',
      'swimsuit', 'bikini', 'romper', 'slip', 'dress', 'sundress', 'nightgown', 'gown',
      'robe', 'kimono', 'yukata', 'sheet', 'towel', 'halter', 'tunic', 'apron', 'qipao', 'cheongsam',
      'sweater', 'gi', 'nightshirt',
    ]
    const X_SIGNALS = ['topless', 'bare breasts', 'exposed breasts', 'nsfw', 'nude', 'naked']
    const POSE_VERBS = 'standing|kneel|sitting|leaning|climb|slide|stretch|arch|bend|turn|twirl|float|stride|spiral|hang|curl|lean|reach|prone|crouch|drape|sprawl|recline|straddl|waltz|handstand|cartwheel|pli|sprint|jump|bounce|balance|extend|lock|draw|halt'
    const LOWER_COVERS_SC = ['skirt', 'dress', 'cloak', 'cape', 'coat', 'apron', 'tied at waist', 'tied at the waist', 'shirt tied', 'waist wrap', 'sarong', 'long shirt', 'peplum']
    const CHEST_COVERS_SC = ['buttoned shirt', 'buttoned-up', 'buttoned up', 'zipped up', 'closed jacket', 'buttoned jacket', 'turtleneck', 'high-neck', 'closed coat']
    const poseRiskByPos = new Map<number, string>()
    for (const c of contract?.slots ?? []) {
      poseRiskByPos.set(c.position, c.poseRisk ?? '')
    }
    let atRisk = 0
    for (const s of batch.slots) {
      const tier = tierOf(s.meta)
      if (tier !== 'R+' && tier !== 'X') continue
      const firstPeriod = s.pos.indexOf('.')
      const tagBlock = (firstPeriod > 0 ? s.pos.slice(0, firstPeriod) : s.pos).toLowerCase()
      const posLower = s.pos.toLowerCase()
      const spineLower = s.spine.toLowerCase()
      const tags = tagBlock.split(',').map((t) => t.trim())
      const mark = (ok: boolean, unclear = false) => (ok ? '✓' : unclear ? '?' : '✗')
      const isX = tier === 'X'
      // OBJECT: именованная заявка (X: bare-state сигнал, R+: сигнал-тег + вещь)
      const upperClaim = ['nipples through clothing', 'clothed nipples', 'see-through', 'taped nipples', 'topless with tape', 'handbra'].find((c) => tagBlock.includes(c))
      const lowerClaim = ['visible pantyline', 'pantyline'].find((c) => tagBlock.includes(c))
      const xClaim = X_SIGNALS.find((c) => tagBlock.includes(c))
      const garmentTag = tags.find((t) => UPPER_LIGHT.some((g) => new RegExp(`\\b${g}\\b`).test(t)))
      const onSkin = upperClaim === 'taped nipples' || upperClaim === 'topless with tape' || upperClaim === 'handbra'
      const objOk = isX
        ? Boolean(xClaim)
        : Boolean((upperClaim || lowerClaim) && (onSkin || garmentTag))
      // EXPOSURE: зона заявки открыта камере
      const coverLower = lowerClaim ? LOWER_COVERS_SC.find((c) => tagBlock.includes(c)) : undefined
      const coverChest = onSkin ? CHEST_COVERS_SC.find((c) => tagBlock.includes(c)) : undefined
      const expOk = !coverLower && !coverChest
      const expUnclear = !expOk ? false : (garmentTag ? tags.filter((t) => /shirt|cardigan|jacket|robe|kimono/.test(t)).length >= 2 : false)
      // CAMERA: камера-участник (явный тег, поза в тегах или поза спайна)
      const camTag = CAMERA_TAGS.find((c) => tagBlock.includes(c))
      const camOk = Boolean(camTag) || new RegExp(POSE_VERBS).test(tagBlock) || new RegExp(POSE_VERBS).test(spineLower)
      // CONTRAST: сигнал читается — свет НА зоне заявки, не в декорациях.
      // Ретроспектива T4-04: мокрая тёмная ткань без света = пятно (P05
      // «dark»); светлое на светлом = слияние с фоном (P03) — оба убивают
      // сигнал сильнее любого дальнего света сцены.
      const garmentLight = garmentTag ? LIGHT_WORDS.some((w) => garmentTag.includes(w)) : false
      const sceneGlow = GLOW_WORDS.some((w) => tagBlock.includes(w))
      const darkScene = DARK_SCENE.some((w) => tagBlock.includes(w))
      // фоновая светимость: светлые слова в НЕ-телесных тегах (волосы/кожа/
      // чулки — не фон; слияние ловится только фоновой доминантой)
      const bodyWordsRe = /hair|skin|eyes|stocking|sock|thighhigh|pantyhose|scales|ears|tail|horn|freckle|cheek/i
      const bgLightCount = tags.filter(
        (t) => t !== garmentTag && !bodyWordsRe.test(t) && LIGHT_WORDS.some((w) => t.includes(w))
      ).length
      const wet = tagBlock.includes('wet clothes')
      let conOk = false
      let conUnclear = false
      let conWhy = ''
      if (wet && darkScene && !garmentLight) {
        conWhy = 'мокрая тёмная ткань без света — пятно-риск'
      } else if (garmentLight && bgLightCount >= 2) {
        conWhy = 'светлое на светлом — слияние с фоном'
      } else if (garmentLight || sceneGlow || isX) {
        conOk = true
      } else {
        conUnclear = true
        conWhy = 'нет ни светлой вещи, ни света на зоне'
      }
      // SALIENCE: заявка стоит рано в тег-ране (ранние весят больше)
      const limit = isX ? 20 : s.genre === 'OC' ? 22 : 16
      const claimCandidates = [upperClaim, lowerClaim, xClaim, 'wet clothes', 'see-through']
        .filter((c): c is string => Boolean(c) && tagBlock.includes(c as string))
        .map((c) => tags.findIndex((t) => t.includes(c as string)))
        .filter((i) => i >= 0)
      const claimIdx = claimCandidates.length > 0 ? Math.min(...claimCandidates) : 99
      const salOk = claimIdx < limit
      // INTERPRETATION: подача (зачем показано); X: bare state = заявление
      const intent = INTENT_TAGS.find((c) => tagBlock.includes(c) || posLower.includes(c))
      const intOk = isX ? Boolean(xClaim) : Boolean(intent)
      // §9-септима, звено 7 — BLOCKER: в кадре нет запертой двери на зоне
      // заявки (шаль/платок/руки крестом поверх claim — P21: «the frame's
      // one closed door», мёртвый слот до рендера)
      const BLOCKERS_SC = [
        'crossed arms', 'arms crossed', 'crossed shawl', 'shawl crossed',
        'scarf crossed', 'crossed scarf', 'crossed over her chest',
        'arms over her chest', 'arms over chest', 'shawl over her chest',
      ]
      const blockerHit = BLOCKERS_SC.find((c) => posLower.includes(c))
      const blkOk = !blockerHit
      // §9-септима, звено 8 — LEGIBILITY: различимость на дистанции кадра:
      // близкая камера (close-up / cowboy / portrait / pov / upper body)
      // или свет НА зоне при читаемой вещи (потеря различимости — артефакт
      // T4-05 P23: рассвет съел заявку)
      const CLOSE_CAM = ['close-up', 'closeup', 'cowboy shot', 'portrait', 'pov', 'upper body', 'close on']
      const closeCam = CLOSE_CAM.find((c) => tagBlock.includes(c))
      const legOk = Boolean(closeCam) || (conOk && (garmentLight || sceneGlow))
      // §9-септима, звено 9 — POSE-RISK: HIGH-поза × R+/X = амплификатор
      // мутаций (вердикт T4-05: P04 дрейф · P22 мутация · P17 недолёт) —
      // RENDER LAW v1.3.0: R+/X получают только LOW/MID позы
      const poseRisk = poseRiskByPos.get(s.position) ?? ''
      const prOk = poseRisk !== 'HIGH'
      const broken = [objOk, expOk, camOk, conOk, salOk, intOk, blkOk, legOk, prOk].filter((x) => !x).length
      if (broken >= 2) atRisk += 1
      f.push(
        `P${String(s.position).padStart(2, '0')} ${tier}: OBJECT ${mark(objOk)}${objOk && garmentTag && !isX ? ` (${garmentTag.split(' ').slice(-1)[0]})` : objOk && isX && xClaim ? ` (${xClaim})` : ''} · EXPOSURE ${mark(expOk, expUnclear)}${!expOk && (coverLower || coverChest) ? ` (закрыта «${coverLower ?? coverChest}»)` : ''} · CAMERA ${mark(camOk)}${camTag ? ` (${camTag})` : ' (поза)'} · CONTRAST ${mark(conOk, conUnclear)}${!conOk ? ` — ${conWhy}` : ''} · SALIENCE ${mark(salOk)}${claimIdx === 99 ? ' (нет заявки)' : ` (№${claimIdx + 1})`} · INTERPRETATION ${mark(intOk)}${intent && !isX ? ` (${intent})` : isX ? ' (bare state = заявление)' : ' (без подачи)'} · BLOCKER ${mark(blkOk)}${!blkOk ? ` («${blockerHit}» — the frame's one closed door, P21)` : ''} · LEGIBILITY ${mark(legOk)}${closeCam ? ` (${closeCam})` : legOk ? ' (свет на зоне)' : ' (дистанция кадра)'} · POSE-RISK ${mark(prOk)}${poseRisk ? ` (${poseRisk})` : ''}${broken >= 2 ? ` → ${broken} звена порваны: ПРОГНОЗ — тир под угрозой` : broken === 1 ? ' → 1 звено порвано' : ' → цепочка цела'}`
      )
    }
    if (f.length > 0) {
      f.unshift(
        `салиенс-цепочка (§9-секста + §9-септима BLOCKER/LEGIBILITY/POSE-RISK, вердикт T4-05): ${f.length} R+/X слотов, под угрозой ${atRisk} (≥2 порванных звеньев — провал звена роняет тир)`
      )
    }
    /* U7 (вердикт автора 2026-09-27 «похуй, делаем»): салиенс — прогноз
       доставки, подтверждён T4-11 (11/14 под угрозой → R+ 5/14) → warn */
    warn('salience-chain', f)
  }

  /* ---------------- receipt + event ---------------- */
  const sha10 = crypto.createHash('sha256').update(file).digest('hex').slice(0, 10)
  const priorRuns = readEvents().filter(
    (e) => e.type === 'gate.run' && e.data?.slug === slug
  ).length
  const runIndex = priorRuns + 1
  const hardPass = receipts.filter((r) => r.level === 'hard').every((r) => r.verdict === 'PASS')
  const result: GatesResult = {
    slug,
    runIndex,
    sha10,
    receipts,
    hardPass,
    firstRunClean: hardPass && runIndex === 1,
    at: new Date().toISOString(),
  }
  if (!dryRun) {
    appendEvent(
      'gate.run',
      `${slug} гейты: прогон #${runIndex}, hard ${hardPass ? 'PASS' : 'FAIL'}${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''} (sha ${sha10})`,
      {
        slug,
        run: runIndex,
        sha10,
        hardPass,
        firstRunClean: result.firstRunClean,
        hardFails: receipts
          .filter((r) => r.level === 'hard' && r.verdict === 'FAIL')
          .map((r) => r.gate),
        warns: receipts.filter((r) => r.level === 'warn' && r.verdict === 'WARN').length,
      }
    )
  }
  return result
}

/* ------------------------------------------------------------------ */
/* utils                                                               */
/* ------------------------------------------------------------------ */

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 3))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}
