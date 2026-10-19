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

import {
  CONTRACTS_DIR,
  readJson,
} from '@/lib/t4/fsutil'
import type { BatchContract } from '@/lib/t4/compiler'
import {
  buildScribeCtx,
  type ScribeCtx,
} from '@/lib/t4/scribe'

/** Слаг-гвард моста: только канонические T4-NN(-суффиксы), без траверса. */
export function bridgeSlug(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^T4-\d{2}(?:[-.][A-Za-z0-9]+)*$/.test(s)) return null
  return s
}

/** Контракт писца с диска (его пишет Rust на этапе «Компиляция»). */
export function bridgeContract(slug: string): BatchContract | null {
  return readJson<BatchContract>(path.join(CONTRACTS_DIR, `${slug}.json`))
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

/** Контекст писца + применённый спайн (движок/тезис/акты/тема-слова):
 * одна правда для чанков, ремонта, полировки и сборки. */
export async function ctxWithBuild(
  contract: BatchContract,
  build: BridgeBuild
): Promise<ScribeCtx> {
  const ctx = await buildScribeCtx(contract)
  ctx.engineName = asStr(build.engineName) || contract.engine
  ctx.engineLaw = asStr(build.engineLaw) || contract.engineLaw
  ctx.batchThesis = asStr(build.thesis)
  ctx.acts = asStrArr(build.acts)
  const keywords = asStrArr(build.themeKeywords)
  if (keywords.length > 0) ctx.themeKeywords = keywords.slice(0, 8)
  return ctx
}
