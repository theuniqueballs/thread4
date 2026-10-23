/**
 * THREAD 4 — BRIDGE SERVE (cutover-эра, 2026-10-20).
 *
 * Общие горелки мостовых роутов /api/t4/bridge/*: Rust-движок (единый
 * конвейер) зовёт Next ТОЛЬКО за двумя инструментами — LLM-проза писца и
 * файловый компилятор контрактов. Каждый роут — ЧИСТАЯ вычислялка:
 * НИКАКИХ записей в файлы/летопись (пишет только Rust, один писатель).
 *
 * Протокол: 200 {ok:true, data:{…}} | 4xx/5xx {error:'…'} — движок
 * разбирает честным текстом, без масок.
 */
import path from 'node:path'

import { readJson } from '@/lib/t4/fsutil'
import type { BatchContract } from '@/lib/t4/compiler'
import {
  buildScribeCtx,
  type BriquetteStory,
  type ScribeCtx,
} from '@/lib/t4/scribe'

/** Контракты конвейера twin'а — РЕПЕТИЦИОННЫЙ каталог (доктрина изоляции
 * e9f1f0a: Rust пишет сюда, значит и мост читает отсюдА). До 2026-10-20
 * мост читал ПРОД-контракт (thread4/contracts) — писец писал черновик по
 * ИСТОРИЧЕСКОМУ батчу, а позиции сверх его 21 слота (P22+…) молча
 * выбрасывались: failedSlots [22,23,24] в каждом прогоне, ремонт не мог
 * дописать их никогда (в чужом контракте их нет). */
const TWIN_REHEARSALS_DIR = path.join(
  process.cwd(),
  'mini-services',
  't4-engine-rs',
  'data',
  'rehearsals',
  'contracts'
)

/** Слаг-гвард моста: только канонические T4-NN(-суффиксы), без траверса. */
export function bridgeSlug(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/.test(s)) return null
  return s
}

/** Контракт писца с диска (его пишет Rust на этапе «Компиляция»):
 * репетиционный каталог twin'а — тот же файл, что читает сам Rust. */
export function bridgeContract(slug: string): BatchContract | null {
  return readJson<BatchContract>(path.join(TWIN_REHEARSALS_DIR, `${slug}.json`))
}

/** Спайн-результат этапа «Сборка», как его отдал Rust (JSON-форма). */
export interface BridgeBuild {
  engineName?: unknown
  engineLaw?: unknown
  thesis?: unknown
  acts?: unknown
  themeKeywords?: unknown
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(asStr).filter((s) => s.trim() !== '') : []

/** Брикеты сборщика — репетиционный каталог twin'а (его пишет Rust на
 * этапе «Сборщик»); могут отсутствовать (полировка file-эры) — тогда
 * писец работает по контракту без историй, как до эры ARS. */
export function loadBriquettes(slug: string): Map<number, BriquetteStory> {
  const raw = readJson<{
    briquettes?: {
      position?: unknown
      kind?: unknown
      rating?: unknown
      story?: Record<string, unknown>
      laws?: unknown[]
    }[]
  }>(path.join(TWIN_REHEARSALS_DIR, '..', 'briquettes', `${slug}.json`))
  const out = new Map<number, BriquetteStory>()
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  for (const b of raw?.briquettes ?? []) {
    const pos = typeof b.position === 'number' && Number.isInteger(b.position) ? b.position : -1
    if (pos <= 0) continue
    const story = b.story ?? {}
    out.set(pos, {
      position: pos,
      kind: str(b.kind),
      rating: str(b.rating),
      title: str(story['title']) || 'untitled',
      thesis: str(story['thesis']),
      reveal: str(story['reveal']),
      scene: str(story['scene']),
      environment: str(story['environment']),
      vibe: str(story['vibe']),
      lighting: str(story['lighting']),
      poseIdea: str(story['poseIdea']),
      outfit: str(story['outfit']),
      character: str(story['character']),
      witness: str(story['witness']) || null,
      dice: str(story['dice']) || null,
      tokens: Array.isArray(story['tokens'])
        ? (story['tokens'] as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        : [],
      laws: Array.isArray(b.laws) ? (b.laws as unknown[]).filter((l): l is string => typeof l === 'string') : [],
    })
  }
  return out
}

/** Контекст писца + применённый спайн (движок/тезис/акты/тема-слова):
 * одна правда для чанков, ремонта, полировки и сборки. */
export async function ctxWithBuild(
  contract: BatchContract,
  build: BridgeBuild,
  slug?: string
): Promise<ScribeCtx> {
  const ctx = await buildScribeCtx(contract)
  if (slug != null) ctx.briquettes = loadBriquettes(slug)
  ctx.engineName = asStr(build.engineName) || contract.engine
  ctx.engineLaw = asStr(build.engineLaw) || contract.engineLaw
  ctx.batchThesis = asStr(build.thesis)
  ctx.acts = asStrArr(build.acts)
  const keywords = asStrArr(build.themeKeywords)
  if (keywords.length > 0) ctx.themeKeywords = keywords.slice(0, 8)
  return ctx
}
