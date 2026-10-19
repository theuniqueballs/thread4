'use client'

/**
 * THREAD 4 — ЕДИНЫЙ КОНВЕЙЕР (the / route, cutover-эра 2026-10-20).
 *
 * Один экран без вкладок: приказ → 5 этапов сверху вниз, одна главная
 * кнопка, ручной override маленькой «▶» на этапе, консоль — шторка снизу.
 * Никаких scattered-табов, никакой бухгалтерии на карточках — весь тех-ID
 * в «Подробностях». Бэкенд: ЕДИНЫЙ Rust-движок :3201 (прод RW, один
 * писатель), этот слой — тонкая обёртка.
 */

import { PipelineScreen } from '@/components/t4/console/pipeline'

export default function Page() {
  return <PipelineScreen />
}
