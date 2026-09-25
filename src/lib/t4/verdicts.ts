/**
 * THREAD 4 core — tiers, single copy (Залп 2 «Рефлекс»).
 *
 * Порядок тиров раньше был продублирован 4-5 раз (gates.ts, batch-verdict,
 * scribe.ts, page.tsx ×2) — каждая копия ждала своего расслоения истины
 * (MD-1). Теперь: один чистый модуль без fs — импортируют и сервер, и клиент.
 */
export const TIERS = ['PG-13', 'R', 'R+', 'X'] as const

export type Tier = (typeof TIERS)[number]

/** Ранг тира с алиасами рецептов (PG13, RPLUS) и XXX-never. */
export const TIER_RANK: Record<string, number> = {
  'PG-13': 0,
  PG13: 0,
  R: 1,
  'R+': 2,
  RPLUS: 2,
  X: 3,
  XXX: 4,
}

/** Нормализация ключа рецепта к каноническому имени тира. */
export function tierKey(t: string): string {
  return t === 'PG13' ? 'PG-13' : t === 'RPLUS' ? 'R+' : t
}
