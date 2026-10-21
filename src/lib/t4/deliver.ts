/**
 * THREAD 4 — DELIVERY (constitution §9: first run clean is the definition
 * of done). Shared by the CLI and the API: official gate run → batch meta
 * → batch.delivered event → worklog section in the batch file.
 */
import path from 'node:path'

import { assertSafeSlug, BATCHES_DIR, CONTRACTS_DIR, readJson, readText, writeJson, writeText } from './fsutil'
import { appendEvent, withEventLock } from './events'
import { consciousnessEvents } from './consciousness'
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
  /* defense-in-depth (аудит 2026-10-12): deliver ПИШЕТ batches/${slug}.md
   * и .json — без валидации slug это была запись за пределы каталога. */
  assertSafeSlug(slug)
  const text0 = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (text0 == null) return null

  /* Ревизия 2026-10-13 (TOCTOU повторной сдачи): чек priorDelivery и
   * batch.delivered жили в разных критических секциях — два параллельных
   * deliver проходили оба (прецедент: T4-04, три batch.delivered в
   * летописи). Вся сдача — одна секия под событийным локом; appendEvent
   * внутри реентерабелен (events.ts), runGates пишет gate.run под тем же
   * замком. Git-снапшот — ПОСЛЕ секции: секунды коммита не держат летопись. */
  const delivered = withEventLock(() => deliverBatchInner(slug, text0))
  if (delivered?.ok) {
    /* durability: сдача батча — священный момент, коммит в git немедленно */
    snapshotNow(`deliver:${slug}`)
  }
  return delivered
}

function deliverBatchInner(slug: string, text0: string): DeliverResult | null {
  // охрана повторной сдачи (аудит N-10): второй batch.delivered двигал бы
  // окно ротации и дублировал события — сданный батч не сдаётся дважды.
  // Фаза 2/итерация 3: хроника сознания — живой движок (∪ файл-хвост),
  // сдачи движковой эры видны охране сразу.
  const priorDelivery = consciousnessEvents().some(
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
  /* Фред, 2026-10-08: RAW-батчи сдаются без контракта — theme/engine больше
   * не пустеют: тема берётся из H1 батча, движок помечается по формату.
   * (Ремонт «нет названия у T4-23/T4-24»: delivery писал title=slug.) */
  const rawFormat = /^#\s*T4-[\dA-Za-z.-]+[^\n]*\bRAW\b/m.test(text0)
  const theme = contract?.theme || parsed.title || ''
  const engine = contract?.engine || (rawFormat ? 'raw-danbooru' : '')

  /* oc.appeared — ростер финален только при сдаче (рекомпиляции не считаются).
   * Раунд 2026-10-16: у Lucy 3 события на 4 появления — контракт одной из
   * сдач не нёс slots[].oc, и ростер тихо пустел. Фоллбэк — шапки слотов
   * самого батча («OC · Lucy · R+ · …»): parseBatch их уже держит, имя ОС
   * — второй сегмент меты. Двойная защита: union контракта и батча. */
  const ocFromContract = (contract?.slots ?? [])
    .filter((s) => s.kind === 'OC' && s.oc)
    .map((s) => s.oc as string)
  const ocFromBatch = parsed.slots
    .filter((s) => s.genre.toUpperCase() === 'OC')
    .map((s) => s.meta.split('·').map((x) => x.trim()).filter(Boolean)[1] ?? '')
    .filter((x) => x !== '' && x !== '—')
  const ocRoster = [...new Set([...ocFromContract, ...ocFromBatch])]
  const existing = consciousnessEvents()
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
    // больше не застывшая строка с чужими числами (аудит MD-1).
    // Поправка 2026-10-11 (преемник): штамп врал для ручных сборок без контракта —
    // печатал «спред из контракта; расовый каст…» при null (T4-23/T4-24 уносят
    // поправку ниже). Теперь: нет контракта → честная строка ручной сборки;
    // расовый каст упоминается только когда реально назначен (RAW-эра не назначает).
    const spreadText = (contract?.spread ?? [])
      .map((s) => `${s.rating}×${s.count}`)
      .join(' · ')
    const racial = (contract?.slots ?? []).filter(
      (s) => Boolean((s as { race?: string } | undefined)?.race)
    ).length
    const structureText = contract
      ? `${contract.slots?.length ?? LAWS.slotsTotal} слот(ов) — ${spreadText || 'спред см. в контракте'}${racial > 0 ? `; расовый каст ${racial} на мейнах` : ''}`
      : `${LAWS.slotsTotal} слот(ов) — ручная сборка RAW-эры, контракта нет; спред и состав — шапка батча`
    wl.push(`- Структура: ${structureText}.`)
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
    theme,
    engine,
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
      theme,
      engine,
      hardPass: true,
      firstRunClean: result.firstRunClean,
      sha10: result.sha10,
    }
  )
  return { ok: true, result, title }
}
