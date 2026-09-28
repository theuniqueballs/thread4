#!/usr/bin/env bun
/**
 * post-issues.ts — Фред, 2026-09-28
 *
 * Постер Issues из markdown-файла аудита (thread4/ISSUES-FRED-2026-09-28.md).
 * Формат файла: секции "## ISSUE NN · SEVERITY · tag", в первых двух строках
 * секции — **Заголовок:** и **Лейблы:**, дальше тело до следующей секции / <!-- END.
 *
 * Использование:
 *   GITHUB_TOKEN=<PAT> bun run thread4/tools/post-issues.ts <file.md> --post   # публикация
 *   bun run thread4/tools/post-issues.ts <file.md>                             # dry-run
 *
 * Репо: theuniqueballs/thread4 (переопределение: env T4_REPO="owner/name").
 * Идемпотентность: тикеты с уже существующим заголовком (open+closed) пропускаются.
 * Фолбэк: при отказе лейблов (нет прав/не существуют) — повтор без лейблов.
 */

const REPO = process.env.T4_REPO ?? 'theuniqueballs/thread4'
const API = 'https://api.github.com'

interface IssueDraft {
  num: string
  severity: string
  title: string
  labels: string[]
  body: string
}

function parseDrafts(md: string): IssueDraft[] {
  const out: IssueDraft[] = []
  const sections = md.split(/^## ISSUE /m).slice(1)
  for (const raw of sections) {
    const body0 = raw.replace(/<!-- END[\s\S]*$/, '').trimEnd()
    const lines = body0.split('\n')
    const head = (lines[0] ?? '').trim() // "01 · CRITICAL · doctrine-stale"
    const parts = head.split('·').map((p) => p.trim())
    const num = parts[0] ?? ''
    const severity = parts[1] ?? ''
    const titleLine = lines.find((l) => l.startsWith('**Заголовок:**'))
    const labelLine = lines.find((l) => l.startsWith('**Лейблы:**'))
    if (!titleLine) throw new Error(`ISSUE ${num}: нет строки **Заголовок:**`)
    const title = titleLine.replace('**Заголовок:**', '').trim()
    const labels = (labelLine ?? '')
      .replace('**Лейблы:**', '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
    const bodyStart = body0.indexOf(titleLine) + titleLine.length
    const body =
      `**Серьёзность:** ${severity}\n\n` +
      body0.slice(bodyStart).replace(/^\s*\*\*Лейблы:\*\*.*$/m, '').trim()
    out.push({ num, severity, title, labels, body })
  }
  return out
}

async function gh(path: string, token: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub ${res.status} на ${path}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

async function existingTitles(token: string): Promise<Set<string>> {
  const titles = new Set<string>()
  for (const state of ['open', 'closed']) {
    for (let page = 1; page <= 5; page++) {
      const batch = (await gh(
        `/repos/${REPO}/issues?state=${state}&per_page=100&page=${page}`,
        token
      )) as Array<{ title: string; pull_request?: unknown }>
      for (const it of batch) if (!it.pull_request) titles.add(it.title.trim())
      if (batch.length < 100) break
    }
  }
  return titles
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const doPost = args.includes('--post')
  const file = args.find((a) => !a.startsWith('--'))
  const token = process.env.GITHUB_TOKEN ?? ''
  if (!file) {
    console.error('Использование: bun run thread4/tools/post-issues.ts <file.md> [--post]')
    process.exit(1)
  }
  const md = await Bun.file(file).text()
  const drafts = parseDrafts(md)
  console.log(`Парсер: ${drafts.length} тикетов из ${file} (репо ${REPO})`)

  if (!doPost) {
    for (const d of drafts) {
      console.log(`\n=== [${d.num} · ${d.severity}] ${d.title}`)
      console.log(`    лейблы: ${d.labels.join(', ')}`)
      console.log(`    тело: ${d.body.length} символов`)
    }
    console.log('\nDRY-RUN (без --post ничего не отправлено).')
    return
  }
  if (!token) {
    console.error('Нет GITHUB_TOKEN — постинг отменён (dry-run безопасен без токена).')
    process.exit(1)
  }

  const seen = await existingTitles(token)
  console.log(`На репо уже ${seen.size} issues — проверяю дубликаты по заголовкам.`)
  let posted = 0
  let skipped = 0
  for (const d of drafts) {
    if (seen.has(d.title)) {
      console.log(`SKIP [${d.num}] уже существует: ${d.title}`)
      skipped++
      continue
    }
    const payload = JSON.stringify({ title: d.title, body: d.body, labels: d.labels })
    try {
      const created = (await gh(`/repos/${REPO}/issues`, token, {
        method: 'POST',
        body: payload,
      })) as { number: number; html_url: string }
      console.log(`OK   [${d.num}] #${created.number} — ${created.html_url}`)
      posted++
    } catch (e) {
      // фолбэк: лейблы могут не существовать / нет прав — повтор без них
      try {
        const created = (await gh(`/repos/${REPO}/issues`, token, {
          method: 'POST',
          body: JSON.stringify({ title: d.title, body: d.body }),
        })) as { number: number; html_url: string }
        console.log(`OK   [${d.num}] #${created.number} (без лейблов) — ${created.html_url}`)
        posted++
      } catch (e2) {
        console.error(`FAIL [${d.num}] ${d.title}: ${(e2 as Error).message}`)
      }
    }
  }
  console.log(`\nИтог: ${posted} запощено, ${skipped} пропущено (дубликаты).`)
}

main().catch((e: unknown) => {
  console.error(`Фатально: ${(e as Error).message}`)
  process.exit(1)
})
