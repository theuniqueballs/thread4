/**
 * THREAD 4 — DELIVERY (constitution §9: first run clean is the definition
 * of done). Shared by the CLI and the API: official gate run → batch meta
 * → batch.delivered event → worklog section in the batch file.
 */
import path from 'node:path'

import { BATCHES_DIR, CONTRACTS_DIR, readJson, readText, writeJson, writeText } from './fsutil'
import { appendEvent, readEvents } from './events'
import { parseBatch, runGates, type GatesResult } from './gates'
import { snapshotNow } from './persist'

export interface DeliverResult {
  ok: boolean
  result: GatesResult
  title: string
}

export function deliverBatch(slug: string): DeliverResult | null {
  const text0 = readText(path.join(BATCHES_DIR, `${slug}.md`))
  if (text0 == null) return null

  const result = runGates(slug, false)
  if (!result.hardPass) {
    return { ok: false, result, title: slug }
  }

  const parsed = parseBatch(slug, text0)
  const contract = readJson<{
    theme?: string
    engine?: string
    slots?: { kind?: string; oc?: string; exploratory?: string; position: number }[]
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
    wl.push(
      `- Структура: 3 OC + 21 мейн (спред R+×12 · R×7 · X×2), расовый каст на мейнах, регистры третями.`
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
    wl.push('- Вердикт T4-02 учтён: жанр в шапках, 24 слота, якоря геометрии у сложных пропов.')
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
