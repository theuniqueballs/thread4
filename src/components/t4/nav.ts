'use client'

/**
 * THREAD 4 — мини-шина глубокой навигации «покажи слот N батча X».
 *
 * Преемник Фреда, 2026-10-10 (webDevReview #5): радар TRIAL-3 живёт во
 * вкладке Вердиктов, а слоты — во вкладке Батчей; ссылка между ними должна
 * работать через перемонтирование вкладок (они рендерятся по условию).
 * Дом слушает шину (переключает вкладку), BatchesTab открывает батч,
 * SlotStrip скроллит к строке слота и вспыхивает янтарным.
 *
 * Sticky-pending переживает поздний монтаж: событие летит, когда слушатель
 * ещё не смонтирован — намерение лежит в модуле, смонтировавшийся слушатель
 * забирает его сам (lazy-инициализаторы вместо запрещённого setState в
 * эффекте).
 */

export interface SlotNavIntent {
  /** слаг батча, например «T4-27.2-EXP» */
  slug: string
  /** «P25» */
  slotId: string
}

type Listener = (intent: SlotNavIntent) => void

const listeners = new Set<Listener>()
let pending: SlotNavIntent | null = null

/** Попросить дашборд показать слот: переключит вкладку, откроет батч,
 *  проскроллит к строке и вспыхнет её. */
export function navigateToSlot(slug: string, slotId: string): void {
  const intent = { slug, slotId }
  pending = intent
  for (const l of listeners) l(intent)
}

/** Подписка; отписка — возвращённой функцией (эффекты-чистильщики). */
export function subscribeSlotNav(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Последнее непогашенное намерение — для поздно смонтировавшихся слушателей. */
export function pendingSlotNav(): SlotNavIntent | null {
  return pending
}

/** Погасить намерение (слот показан — скролл/вспышка состоялись). */
export function clearPendingSlotNav(): void {
  pending = null
}
