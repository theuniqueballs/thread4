/**
 * THREAD 4 ENGINE — rematerialization of file-era plans (Фаза 4 «зрячее окно»).
 *
 * Находка §11 (фаза 3, живой прогон WRITE→GATES): легаси-импорт 2026-10-19
 * сложил файл-эру в t4_batches с ЗАГЛУШКАМИ payload {"legacy":true,...} —
 * в projection не осталось слотов, paletteWindowUnion() ослеп к каждой
 * палитре, которую файл-эра когда-либо использовала: окно компиляции
 * переиспользовало замороженные палитры, union-фолд гейтов честно резал
 * батч (/v1/batches/T4-33 → 0 слотов при 26 в contracts/T4-33.json).
 *
 * Лекарство (вариант А автора): движковый план каждого мигрированного батча
 * собирается из ФАЙЛ-ИСТИНЫ (contracts/T4-NN.json, фолбэк batches/T4-NN.json)
 * и ДОПИСЫВАЕТСЯ в прод-цепь событиями движковой эры — квитанция
 * payload.migrated (канон 24→25, синхронно ×3) + обновление projection
 * payload в ОДНОЙ транзакции. Append-only: прошлое не переписывается,
 * прод-цепь только растёт, каждая квитанция несёт sha10 записанного.
 * Идемпотентность: легаси-проверка payload + дедуп квитанции по slug —
 * повторный вызов ничего не плодит (краш посреди прогона дочитывается
 * следующим вызовом). Сходимость (эра-цель): после рематериализации план
 * живёт в движке, файл остаётся историческим источником, а не зависимостью.
 *
 * Выбор варианта — против «Б: окно поверх union с файлом»: окно движка,
 * вечно дочитывающее файл-летопись, противоположно эре «сходимость»
 * (файл-хвост → 0) и ломает §2 конституции (один источник правды на факт —
 * палитра окна жила бы в двух местах навсегда). Вариант А делает окно
 * движка истиной ОДИН раз, N квитанций — честная цена.
 *
 * Этот файл — ЧИСТОЕ ядро (без fs/БД/путей): его типчекает и корень
 * платформы (selftest cli.ts импортирует его напрямую), и bun-движок.
 * Раннер с транзакциями — rematerialize-run.ts.
 */
import { payloadSha10 } from '../lib/canonical'

/* ------------------------------------------------------------------ */
/* Pure mapping: file-truth slot → engine plan slot                     */
/* ------------------------------------------------------------------ */

/** «P89_THRESHOLD_GOLD» / «P089» / «p89» → «P089» (канон палитр движка).
 *  Окно движка (assign_palettes) исключает короткие pid — полные id спека
 *  никогда бы не совпали с окном, и миграция осталась бы слепой. */
export function normalizePaletteId(raw: string): string | null {
  const m = /^P0*(\d{1,3})/i.exec(raw.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 120) return null // фонд 105 + extension 120 (EXP-резерв)
  return `P${String(n).padStart(3, '0')}`
}

/** Виды файл-эры → канон движка. VOLT/EXQUISITE — вкусовые оттенки R+-мейна:
 *  канон движка знает MAIN; оттенок сохраняется в kindSpec (ничего не теряем). */
export function mapKind(kind: string): { kind: string; kindSpec?: string } {
  if (kind === 'VOLT') return { kind: 'MAIN', kindSpec: 'VOLT' }
  if (kind === 'EXQUISITE') return { kind: 'MAIN', kindSpec: 'EXQUISITE' }
  return { kind }
}

export interface RematerializedPlan {
  payload: Record<string, unknown>
  payloadJson: string
  sha10: string
  slots: number
  exp: number
  abPairs: number
  palettes: number
}

/** План движка из файл-истины. Слоты = файл-правда (позы/носители/причёски
 *  сохраняются) + канонические поля движка (kind, paletteId короткий).
 *  exp/ab объекты контракта совпадают по форме с движковыми
 *  (letter/half/pairWith/hypothesis; pair/half) — проходят как есть.
 *  Детерминизм: та же файл-истина + та же метка → байт-в-байт тот же план. */
export function buildPlanFromContract(
  slug: string,
  contract: Record<string, unknown>,
  at: string,
  source: string,
): RematerializedPlan {
  const rawSlots = Array.isArray(contract.slots) ? (contract.slots as Record<string, unknown>[]) : []
  const slots = rawSlots.map((s) => {
    const kind = String(s.kind ?? '')
    const { kind: mapped, kindSpec } = mapKind(kind)
    const out: Record<string, unknown> = { ...s, position: s.position, kind: mapped }
    if (kindSpec) out.kindSpec = kindSpec
    const short = normalizePaletteId(String(s.paletteId ?? s.palette ?? ''))
    if (short) out.paletteId = short
    return out
  })
  const palettes = new Set(slots.map((s) => s.paletteId).filter((p): p is string => typeof p === 'string'))
  const abPairsRaw = contract.abPairs
  const abPairs = Array.isArray(abPairsRaw) ? abPairsRaw.length : Number(abPairsRaw ?? 0)

  const plan: Record<string, unknown> = {
    slug,
    title: contract.title ?? slug,
    theme: contract.theme ?? contract.title ?? slug,
    engine: contract.engine ?? 'per-theme',
    seed: contract.seed ?? null,
    slots,
    exp: slots.filter((s) => s.kind === 'EXP').length,
    abPairs,
    paletteWindow: {
      union: null,
      budget: null,
      extensionFree: null,
      note: 'рематериализовано — окно момента компиляции не пересчитывалось',
    },
    receipts: Array.isArray(contract.receipts) ? contract.receipts : [],
    diff: { up: null, down: null, against: null },
    createdAt: at,
    migrated: {
      source,
      sourceSha10: contract.sha10 ?? null,
      sourceCreatedAt: contract.createdAt ?? null,
    },
  }
  /* sha10 по формуле движка: без sha10, слоты — числом (byte-parity доктрина) */
  const payloadForHash: Record<string, unknown> = { ...plan }
  delete payloadForHash['sha10']
  payloadForHash['slots'] = slots.length
  const sha10 = payloadSha10(payloadForHash)
  plan['sha10'] = sha10

  return {
    payload: plan,
    payloadJson: JSON.stringify(plan),
    sha10,
    slots: slots.length,
    exp: plan.exp as number,
    abPairs,
    palettes: palettes.size,
  }
}

/** Легаси-заглушка? payload парсится в объект с legacy:true. */
export function isLegacyPayload(payload: string): boolean {
  try {
    const v = JSON.parse(payload) as unknown
    return v != null && typeof v === 'object' && (v as Record<string, unknown>)['legacy'] === true
  } catch {
    return false
  }
}
