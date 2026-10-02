/**
 * THREAD 4 core — THE REAPER (Залп 2 «Рефлекс», policy.reaper).
 *
 * Храповик без отставок (MD-4) умирает: reaper делает регулярный прогон
 * по каналам, движкам и OC, сверяет правила смерти/жизни из policy.json
 * с реальными данными и пишет ДРАФТ-отставок. Выстрел всегда за автором (§10):
 * reaper не пишет событий и ничего не удаляет — только доклад.
 *
 * Grace (правка Кенни): новорождённое не судят до первого полного цикла —
 * канонизирующий рендер считается первым использованием.
 */
import path from 'node:path'

import { CONTRACTS_DIR, readJson } from './fsutil'
import { foldState, readEvents } from './events'
import { getDeliveryStats, getEngines, getOCCanon, getPolicy } from './specs'

export interface ReaperItem {
  kind: 'channel' | 'engine' | 'oc' | 'law'
  id: string
  status: string
  facts: string
  recommendation: string
}

export interface ReaperDraft {
  at: string
  items: ReaperItem[]
  report: string
}

export function buildReaperDraft(): ReaperDraft {
  const policy = getPolicy()
  const reaperPolicy = policy.reaper as {
    grace_batches?: number
    unused_batches_to_draft?: number
    channel_dead_rule?: string
    channel_live_rule?: string
  }
  const events = readEvents()
  const state = foldState(events)
  const delivered = state.batches.filter((b) => b.deliveredAt)
  const deliveredCount = delivered.length
  const items: ReaperItem[] = []

  /* --- каналы доставки: правила смерти/жизни vs данные --- */
  const ds = getDeliveryStats()
  /* каналы, отставленные вердиктом автора (channel.retired), жнец не трогает */
  const retiredChannels = new Set(
    events
      .filter((e) => e.type === 'channel.retired')
      .map((e) => String(e.data?.channel ?? ''))
  )
  for (const c of ds?.channels ?? []) {
    if (retiredChannels.has(c.id)) continue
    const n = Number(c.attempts ?? 0)
    const ok = Number(c.delivered ?? 0)
    if (c.status === 'dead' && !(n >= 15 && ok === 0)) {
      items.push({
        kind: 'channel',
        id: c.id,
        status: `dead (${ok}/${n})`,
        facts: `смерть подтверждена ${ok}/${n} — ниже формального порога «${reaperPolicy.channel_dead_rule ?? 'n>=15 и delivered=0'}»`,
        recommendation: 'подтвердить смерть досрочно ИЛИ дать добор до порога (прицел автора)',
      })
    }
    if (c.status === 'live' && !(n >= 3 && ok > 0)) {
      /* grace: каналы, рождённые живым вердиктом автора (contact-physics),
         не судятся пока не наберут попыток — ребёнка не судят до цикла */
      if (n === 0 && ok === 0 && (c.born || c.rehab)) continue
      items.push({
        kind: 'channel',
        id: c.id,
        status: `live (${ok}/${n})`,
        facts: `статус live не подтверждён правилом «${reaperPolicy.channel_live_rule ?? 'n>=3 и delivered>0'}» (n=1-каналы — аудит RC-4)`,
        recommendation: 'понизить до candidate или собрать статистику',
      })
    }
  }

  /* --- движки: с Issue #11 Q3 движки ОДНОРАЗОВЫЕ (пишутся под тему, --- */
  /* --- утилизируются) — аудит библиотеки движков более не существует --- */
  const engines = getEngines()
  const deliveredEngines = new Set<string>()
  for (const b of delivered) {
    const c = readJson<{ engine?: string }>(path.join(CONTRACTS_DIR, `${b.slug}.json`))
    if (c?.engine) deliveredEngines.add(c.engine)
  }
  const lastDeliveredWithEngine = new Map<string, string>()
  for (const b of delivered) {
    const c = readJson<{ engine?: string }>(path.join(CONTRACTS_DIR, `${b.slug}.json`))
    if (c?.engine) lastDeliveredWithEngine.set(c.engine, b.slug)
  }
  for (const [key, e] of Object.entries(engines?.engines ?? {})) {
    if ((e as { role?: string }).role === 'floor') continue
    const debuted = deliveredEngines.has(key)
    if (!debuted) {
      items.push({
        kind: 'engine',
        id: key,
        status: 'запись в архиве библиотеки (эра библиотеки закрыта 2026-09-27)',
        facts: 'движки теперь одноразовые per-theme — эта запись историческая, не кандидат на дебют',
        recommendation: 'архив хранить как наследие; при нужде темы писец изобретает движок заново',
      })
      continue
    }
    const last = lastDeliveredWithEngine.get(key) ?? '—'
    const lastIdx = delivered.findIndex((b) => b.slug === last)
    const idle = deliveredCount - 1 - lastIdx
    if (idle > (reaperPolicy.unused_batches_to_draft ?? 4)) {
      items.push({
        kind: 'engine',
        id: key,
        status: `исторический движок, не используется с ${last}`,
        facts: `эра одноразовых движков: ротации больше нет`,
        recommendation: 'хранить как наследие эры библиотеки',
      })
    }
  }

  /* --- OC:appearance-ростер --- */
  const ocCanon = getOCCanon()
  for (const [name] of Object.entries(ocCanon?.ocs ?? {})) {
    const served = state.ocAppearances[name] ?? 0
    if (served === 0) {
      items.push({
        kind: 'oc',
        id: name,
        status: '0 появлений в летописи',
        facts: 'в каноне активна, в ротации не светилась (или события канонизации старше пересборок лога)',
        recommendation: 'дать дебют в ближайших батчах ИЛИ перевести в inactive_reserve — решает автор',
      })
    }
  }

  /* --- законы/гейты: Retirement Protocol (Issue #18, MD-4 храповик).
     Закон, который ни разу не поймал реальную ловушку за N полных прогонов,
     — кандидат на suspension/retirement. Выстрел за автором (§10):
     закон.retired / закон.suspended событие записывается только по вердикту. */
  const lawMinRuns = Number(reaperPolicy.law_min_runs ?? 5)
  const gateTally = new Map<string, { runs: number; hardFails: number; warns: number }>()
  for (const e of events) {
    if (e.type !== 'gate.run') continue
    const receipts = Array.isArray(e.data?.receipts) ? (e.data?.receipts as Array<{ gate?: string; level?: string; verdict?: string }>) : []
    for (const r of receipts) {
      if (!r.gate) continue
      const t = gateTally.get(r.gate) ?? { runs: 0, hardFails: 0, warns: 0 }
      t.runs += 1
      if (r.level === 'hard' && r.verdict === 'FAIL') t.hardFails += 1
      if (r.level === 'warn' && r.verdict === 'WARN') t.warns += 1
      gateTally.set(r.gate, t)
    }
  }
  for (const [gate, t] of [...gateTally.entries()].sort((a, b) => a[1].runs - b[1].runs)) {
    if (t.runs < lawMinRuns) continue
    if (t.hardFails === 0 && t.warns === 0) {
      items.push({
        kind: 'law',
        id: gate,
        status: `${t.runs} прогонов — ни одной ловушки`,
        facts: `гейт за ${t.runs} полных прогонов не поймал ни одного FAIL/WARN — он ничего не измеряет, только весит (храповик MD-4)`,
        recommendation: 'кандидат на law.suspended (заморозка) или law.retired — решает автор (§10)',
      })
    } else if (t.hardFails + t.warns >= Math.ceil(t.runs / 2)) {
      items.push({
        kind: 'law',
        id: gate,
        status: `ловит в ${(t.hardFails + t.warns) / t.runs * 100 | 0}% прогонов`,
        facts: `hard FAIL ×${t.hardFails}, WARN ×${t.warns} из ${t.runs} прогонов — закон живой и работает`,
        recommendation: 'оставить (двусторонний храповик: жизнь тоже фиксируется)',
      })
    }
  }

  /* --- отчёт --- */
  const lines: string[] = []
  lines.push(`# REAPER DRAFT — ${new Date().toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push(`Прогон по ${deliveredCount} сданным батчам эпохи. Пороги из policy.json (reaper).`)
  lines.push('Это ДРАФТ: ни одно событие не записано, ничего не удалено. Выстрел — за автором (§10).')
  lines.push('')
  if (items.length === 0) {
    lines.push('Претендентов на отставку нет — все органы дышат по правилам политики.')
  }
  for (const it of items) {
    lines.push(`## [${it.kind}] ${it.id} — ${it.status}`)
    lines.push(`- Факты: ${it.facts}`)
    lines.push(`- Рекомендация: ${it.recommendation}`)
    lines.push('')
  }
  lines.push('---')
  lines.push('*Жнец: рождение и смерть легальны (П-4). Отставка остаётся черновиком до вердикта автора.*')

  return { at: new Date().toISOString(), items, report: lines.join('\n') }
}
