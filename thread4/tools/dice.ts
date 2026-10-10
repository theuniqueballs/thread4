/**
 * dice.ts — ULTIMATE DICE, порт A5P6 §3 в RAW-эру (приказ автора
 * 2026-10-12: «обновлённый Ultimate Dice и прочие аспекты — чтобы было
 * сильно и сильно круче»).
 *
 * Проблема A5P6 жива и в RAW+: структурная монотония. Писец пишет
 * слоты одним скелетом — «anime style, [id-блок], [garment], [claims],
 * [camera]. The void has… [проза]. Her face is rendered in stylized 2D
 * anime style… Masterpiece» — 24 слота, один ритм. Freq-report видит
 * тики (void's 23/21), simcheck ловит близнецов J=1.00, но НИКТО не
 * рандомизирует сам СКЕЛЕТ. A5 решил это кубиками: 8 костей, ~26M
 * комбинаций, два промпта никогда не делят структуру.
 *
 * RAW+ конвертация: кости действуют ВНУТРИ легального конверта гейтов
 * (opener «anime style» обязан стоять первым, заявки — рано, фейс-лок —
 * в хвосте, квалити — последним). Кости выбирают порядок идентификации,
 * подачу одежды, интеграцию темы, свет, ритм прозы.
 *
 * Дисциплина повторов (A5P6 §6): внутри батча сигнатуры уникальны;
 * межбатчевая — архив dice-archive.jsonl (движковая традиция), новые
 * батчи обходят использованные сигнатуры (best-effort, потом чистый
 * бросок — 26M комбинаций, коллизия — редкость).
 */
import fs from 'node:fs'
import path from 'node:path'

import { T4_ROOT } from '../../src/lib/t4/fsutil'

/* ------------------------------------------------------------------ */
/* Кости                                                               */
/* ------------------------------------------------------------------ */

export interface DieFace {
  code: string
  what: string
  how: string
}

export interface Die {
  id: string
  title: string
  faces: DieFace[]
}

export const DICE: Die[] = [
  {
    id: 'A',
    title: 'порядок идентификации (что идёт сразу после «1girl, solo»)',
    faces: [
      { code: 'A1', what: 'hair-first', how: 'волосы первыми, потом глаза, потом раса/тело' },
      { code: 'A2', what: 'race-first', how: 'расовые теги первими (ears/wings/tail/scales), потом волосы' },
      { code: 'A3', what: 'garment-first', how: 'именнованная вещь сразу после id — до волос' },
      { code: 'A4', what: 'body-first', how: 'форма тела первой (register-теги), потом волосы' },
      { code: 'A5', what: 'marks-first', how: 'метки/шрамы/веснушки первыми, потом волосы' },
      { code: 'A6', what: 'kinetic-first', how: 'движение-тег первым (mid-motion), потом id-хвост' },
      { code: 'A7', what: 'claims-first', how: 'заявка-теги сразу после id — волосы после одежды' },
      { code: 'A8', what: 'witness-first', how: 'объект-свидетель первым тегом сцены (НИША-путь)' },
    ],
  },
  {
    id: 'B',
    title: 'подача одежды в прозе',
    faces: [
      { code: 'B1', what: 'garment-noun', how: '«the blouse clings…» — вещь субъектом предложения' },
      { code: 'B2', what: 'state-first', how: '«soaked through, the blouse…» — состояние первым словом' },
      { code: 'B3', what: 'reveal-first', how: '«the blouse gives/conceals…» — что вещь отдаёт/держит' },
      { code: 'B4', what: 'fabric-first', how: '«cotton, gone sheer…» — материал первым' },
      { code: 'B5', what: 'absence-first', how: '«nothing underneath the…» — отсутствие первым' },
      { code: 'B6', what: 'tactile-first', how: '«fabric against skin…» — прикосновение первым' },
      { code: 'B7', what: 'action-clothing', how: '«she reaches/leans, the garment…» — действие раскрывает вещь' },
      { code: 'B8', what: 'layer-first', how: '«one layer, then…» — счёт слоёв первым' },
    ],
  },
  {
    id: 'C',
    title: 'интеграция темы ( THEME-KEYWORDS )',
    faces: [
      { code: 'C1', what: 'theme-noun', how: 'тема — существительное в кадре (объект с именем темы)' },
      { code: 'C2', what: 'theme-action', how: 'она ГЛАГОЛИТ тему (does the theme)' },
      { code: 'C3', what: 'theme-absence', how: 'тема — то, чего в кадре НЕТ (отсутствие названо)' },
      { code: 'C4', what: 'theme-transform', how: 'тема ИЗМЕНИЛА её/мир (результат виден)' },
      { code: 'C5', what: 'theme-witness', how: 'свидетель видит тему (третий глаз кадра)' },
      { code: 'C6', what: 'theme-implied', how: 'тема вплетена без явного слова (только теги)' },
    ],
  },
  {
    id: 'D',
    title: 'свет (закон №21: свет НА зоне заявки)',
    faces: [
      { code: 'D1', what: 'source-off-frame', how: 'источник за кадром, луч входит' },
      { code: 'D2', what: 'edge-on-skin', how: 'свет красит кромку тела на зоне' },
      { code: 'D3', what: 'shadow-contrast', how: 'свет против тени — контраст пары' },
      { code: 'D4', what: 'atmospheric-wash', how: 'цветовой залив всего пространства' },
      { code: 'D5', what: 'light-as-verb', how: 'свет ДЕЙСТВУЕТ на зону (licks/falls/hits)' },
      { code: 'D6', what: 'dual-light', how: 'два источника, две температуры на зоне' },
      { code: 'D7', what: 'glow-from-within', how: 'зона светится сама (экран/прибор/магия)' },
      { code: 'D8', what: 'borrowed-light', how: 'зона ловит чужой свет (мокрое стекло/зеркало)' },
    ],
  },
  {
    id: 'E',
    title: 'ритм прозы',
    faces: [
      { code: 'E1', what: 'three-long', how: '3 длинных предложения, дыхание медленное' },
      { code: 'E2', what: 'fragment-pair', how: '2 фрагмента + 1 длинное — обрыв как стиль' },
      { code: 'E3', what: 'action-beat', how: 'глагольная пулемётная очередь — движение' },
      { code: 'E4', what: 'one-breath', how: 'одно предложение на весь кадр, длинное' },
      { code: 'E5', what: 'dialogue-close', how: 'проза + реплика в конце (closer-dialogue)' },
      { code: 'E6', what: 'question-close', how: 'проза заканчивается вопросом без ответа' },
    ],
  },
]

export const DICE_TOTAL = DICE.length

/** сигнатура броска: «A3·B5·C2·D7·E1» */
export function diceSignature(roll: Record<string, DieFace>): string {
  return DICE.map((d) => roll[d.id]?.code ?? '—').join('·')
}

/** строка инструкций для писца (slotFrame) */
export function diceInstructions(roll: Record<string, DieFace>): string {
  return DICE.map((d) => {
    const f = roll[d.id]
    if (!f) return ''
    return `${f.code} ${f.what}: ${f.how}`
  })
    .filter(Boolean)
    .join(' · ')
}

/* ------------------------------------------------------------------ */
/* RNG — тот же алгоритм, что и генератор                              */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* Архив сигнатур (межбатчевая дисциплина, A5P6 §6)                    */
/* ------------------------------------------------------------------ */

const DICE_ARCHIVE = path.join(T4_ROOT, 'dice-archive.jsonl')

export function usedSignatures(): Set<string> {
  const out = new Set<string>()
  try {
    for (const line of fs.readFileSync(DICE_ARCHIVE, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const d = JSON.parse(line) as { signatures?: string[] }
        for (const s of d.signatures ?? []) out.add(s)
      } catch {
        /* битая строка архива — не блокирует броски */
      }
    }
  } catch {
    /* архива нет — первый бросок чист */
  }
  return out
}

export function archiveSignatures(slug: string, theme: string, signatures: string[]): void {
  try {
    fs.appendFileSync(
      DICE_ARCHIVE,
      JSON.stringify({ slug, theme, signatures, at: new Date().toISOString() }) + '\n',
      'utf-8'
    )
  } catch {
    /* архив не критичен для работы кубиков */
  }
}

/* ------------------------------------------------------------------ */
/* Бросок батча: уникальные сигнатуры внутри батча + обход архива      */
/* ------------------------------------------------------------------ */

export interface BatchRoll {
  /** позиция слота → бросок по костям */
  byPosition: Map<number, Record<string, DieFace>>
  /** позиция → сигнатура «A3·B5·C2·D7·E1» */
  signatures: Map<number, string>
  /** сколько сигнатур пришлось перебросить из-за архива/внутри батча */
  rerolls: number
}

export function rollBatch(
  seed: number,
  positions: number[],
  opts: { avoidArchive?: boolean } = {}
): BatchRoll {
  const rng = mulberry32(seed >>> 0)
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]
  const used = opts.avoidArchive ? usedSignatures() : new Set<string>()
  const byPosition = new Map<number, Record<string, DieFace>>()
  const signatures = new Map<number, string>()
  let rerolls = 0
  for (const pos of positions) {
    let roll: Record<string, DieFace> = {}
    let sig = ''
    for (let attempt = 0; attempt < 12; attempt++) {
      roll = {}
      for (const die of DICE) roll[die.id] = pick(die.faces)
      sig = diceSignature(roll)
      if (used.has(sig)) {
        rerolls++
        continue
      }
      break
    }
    used.add(sig)
    byPosition.set(pos, roll)
    signatures.set(pos, sig)
  }
  return { byPosition, signatures, rerolls }
}
