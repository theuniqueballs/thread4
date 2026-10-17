/**
 * THREAD 4 core — HYGIENE / grep-gate (Залп 2 «Рефлекс»).
 *
 * П-2 чертежа T4.2: код не знает чисел треда. Этот сканер ловит возврат
 * захардкоженных констант в src/lib/t4 — счётчики спек, списки имён OC,
 * застывшие легенды. Самопроверка кода на «память» — код, который помнит,
 * не проходит границу ветки.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface HygieneViolation {
  file: string
  line: number
  text: string
  rule: string
}

interface Rule {
  name: string
  re: RegExp
}

const RULES: Rule[] = [
  { name: 'spec-count-280 (carriers)', re: /\b280\b/ },
  { name: 'spec-count-240 (poses)', re: /\b240\b/ },
  { name: 'spec-count-105 (palettes)', re: /\b105\b/ },
  { name: 'spec-count-108 (techniques)', re: /\b108\b/ },
  { name: 'hardcoded OC-name list (canon-gate)', re: /Sue\|Miyu|Miyu\|Yui/ },
  { name: 'frozen legend «13 гейтов»', re: /13 гейтов/ },
  { name: 'frozen legend «19 гейтов»', re: /19 гейтов/ },
]

/** Строки с этой пометкой исключаются (оправданный кейс — комментируй почему). */
const ALLOW_MARK = 'hygiene-allow'

/* Аудит №4 (2026-10-17, strict, Big-O): scanSource — walk каталога +
 * чтение ВСЕХ .t4-файлов на каждый запрос /api/t4/state (grep-gate булев
 * в Стекле). TTL-кэш 5с: два useApi(state) на монтирование дашборда
 * больше не платят двойной обход; свежесть для живого булева достаточна
 * (правка кода видна через ≤5с). */
let scanCache: { root: string; at: number; hits: HygieneViolation[] } | null = null
const SCAN_TTL_MS = 5_000

export function scanSource(root: string): HygieneViolation[] {
  if (scanCache && scanCache.root === root && Date.now() - scanCache.at < SCAN_TTL_MS) {
    return scanCache.hits
  }
  const violations = scanSourceUncached(root)
  scanCache = { root, at: Date.now(), hits: violations }
  return violations
}

function scanSourceUncached(root: string): HygieneViolation[] {
  const violations: HygieneViolation[] = []
  let files: string[] = []
  try {
    /* сам сканер исключён — его regex'ы содержат запретные литералы по определению */
    files = fs
      .readdirSync(root)
      .filter((f) => f.endsWith('.ts') && f !== 'hygiene.ts' && fs.statSync(path.join(root, f)).isFile())
  } catch {
    return violations
  }
  for (const f of files) {
    const full = path.join(root, f)
    const lines = fs.readFileSync(full, 'utf-8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]
      if (t.includes(ALLOW_MARK)) continue
      const trimmed = t.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
      for (const rule of RULES) {
        if (rule.re.test(t)) {
          violations.push({ file: f, line: i + 1, text: trimmed.slice(0, 120), rule: rule.name })
        }
      }
    }
  }
  return violations
}
