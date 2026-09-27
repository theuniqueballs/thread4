/**
 * THREAD 4 — DELIVERY (constitution §9: first run clean is the definition
 * of done). Shared by the CLI and the API: official gate run → batch meta
 * → batch.delivered event → worklog section in the batch file.
 */
import path from 'node:path'

import { BATCHES_DIR, CONTRACTS_DIR, readJson, readText, writeJson, writeText } from './fsutil'
import { appendEvent, readEvents } from './events'
import { parseBatch, runGates, type GatesResult } from './gates'
import { LAWS } from './compiler'
import { getRatingRecipes } from './specs'
import { snapshotNow } from './persist'

export interface DeliverResult {
  ok: boolean
  result: GatesResult
  title: string
  alreadyDelivered?: boolean
}

export function deliverBatch(slug: string): DeliverResult | null {
  const text0 = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (text0 == null) return null

  // охрана повторной сдачи (аудит N-10): второй batch.delivered двигал бы
  // окно ротации и дублировал события — сданный батч не сдаётся дважды
  const priorDelivery = readEvents().some(
    (e) => e.type === 'batch.delivered' && e.data?.slug === slug
  )
  if (priorDelivery) {
    const gates = runGates(slug, true)
    const dryResult: GatesResult =
      gates ??
      {
        slug,
        runIndex: 0,
        sha10: '',
        receipts: [],
        hardPass: true,
        firstRunClean: false,
        at: new Date().toISOString(),
      }
    return {
      ok: false,
      alreadyDelivered: true,
      result: dryResult,
      title: slug,
    }
  }

  const result = runGates(slug, false)
  if (!result) return null // файл есть (text0 прочитан) — недостижимо, но честно для типов
  if (!result.hardPass) {
    return { ok: false, result, title: slug }
  }

  const parsed = parseBatch(slug, text0)
  const contract = readJson<{
    theme?: string
    engine?: string
    slots?: { kind?: string; oc?: string; exploratory?: string; position: number }[]
    spread?: { rating: string; count: number }[]
  }>(path.join(CONTRACTS_DIR, `${slug}.json`))
  const title = parsed.title || contract?.theme || slug

  /* oc.appeared — ростер финален только при сдаче (рекомпиляции не считаются) */
  const ocRoster = (contract?.slots ?? [])
    .filter((s) => s.kind === 'OC' && s.oc)
    .map((s) => s.oc as string)
  const existing = readEvents()
  for (const oc of ocRoster) {
    const seen = existing.some(
      (e) => e.type === 'oc.appeared' && e.data?.slug === slug && e.data?.name === oc
    )
    if (!seen) {
      appendEvent('oc.appeared', `OC ${oc} назначен в ${slug}`, { slug, name: oc })
    }
  }

  /* batch worklog (constitution §12) — appended to the batch file once */
  let text = text0
  if (!/^## WORKLOG/m.test(text)) {
    const warns = result.receipts.filter(
      (r) => r.level === 'warn' && r.verdict === 'WARN'
    )
    const exploratory = (contract?.slots ?? []).filter((s) => s.exploratory)
    const wl: string[] = []
    wl.push('## WORKLOG')
    wl.push('')
    wl.push(
      `- Сдача: прогон #${result.runIndex}, hard PASS${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''} (sha10 ${result.sha10}). Движок: ${contract?.engine ?? '—'}.`
    )
    // Залп 2: спред и число слотов читаются из контракта/политики — шаблон
    // больше не застывшая строка с чужими числами (аудит MD-1)
    const spreadText = (contract?.spread ?? [])
      .map((s) => `${s.rating}×${s.count}`)
      .join(' · ')
    wl.push(
      `- Структура: ${contract?.slots?.length ?? LAWS.slotsTotal} слот(ов) — ${spreadText || 'спред из контракта'}; расовый каст на мейнах, регистры третями.`
    )
    if (exploratory.length > 0) {
      wl.push(
        `- EXPLORATORY-слоты (§10): P${exploratory.map((s) => s.position).join(', P')} — эксперимент против нежёсткого закона назван здесь: см. THESIS слота; вердикт автора решает, станет ли рецептом.`
      )
    }
    if (warns.length === 0) {
      wl.push('- Предупреждения: ноль — все warn-гейты чистые.')
    } else {
      for (const w of warns) {
        wl.push(`- Квитанция warn [${w.gate}]: ${w.findings.slice(0, 4).join(' · ')}`)
      }
    }
    // актуальный пакет законов на момент сдачи — числа из политики,
    // версия рецепта из спеки (Залп 2: ни одного застывшего числа)
    const recipeVersion = getRatingRecipes()?.version ?? '—'
    wl.push(`- Законы в силе: ${LAWS.slotsTotal} слота (${LAWS.ocSlots} OC + ${LAWS.mainsTotal} мейн) · жанр в шапках · R+-рецепт v${recipeVersion} (hard-claim, bare-under позитивом, framing-тег, LOW/MID позы) · noun-lock + подслой-лок · salience-chain · character-collision.`)
    text = `${text.trimEnd()}\n\n${wl.join('\n')}\n`
    writeText(path.join(BATCHES_DIR, `${slug}.md`), text)
  }

  writeJson(path.join(BATCHES_DIR, `${slug}.json`), {
    slug,
    title,
    date: new Date().toISOString(),
    theme: contract?.theme ?? '',
    engine: contract?.engine ?? '',
    hardPass: result.hardPass,
    firstRunClean: result.firstRunClean,
    sha10: result.sha10,
    run: result.runIndex,
    receipts: result.receipts,
  })
  appendEvent(
    'batch.delivered',
    `${slug} «${title}» сдан: гейты hard PASS${result.firstRunClean ? ' · FIRST RUN CLEAN' : ''} (sha ${result.sha10})`,
    {
      slug,
      title,
      theme: contract?.theme ?? '',
      engine: contract?.engine ?? '',
      hardPass: true,
      firstRunClean: result.firstRunClean,
      sha10: result.sha10,
    }
  )
  /* durability: сдача батча — священный момент, коммит в git немедленно */
  snapshotNow(`deliver:${slug}`)
  return { ok: true, result, title }
}
