/**
 * THREAD 4 — clipboard без тихих сбоев (раунд 2026-10-16, фидбек автора:
 * «когда я копирую негатив на некоторых слотах, то копируется ещё хуйня
 * помимо них… кнопки хуёво сработали и я те же картинки два раза
 * нахуярил»).
 *
 * Причина обеих жалоб — одна: `navigator.clipboard.writeText` в iframe
 * превью-панели падает (NotAllowedError — permissions policy без
 * clipboard-write), а старый обработчик ГЛОТАЛ ошибку молча. Буфер
 * оставался со СТАРЫМ содержимым: автор вставлял прошлый POS/NEG —
 * «хуйня помимо них» — и по ошибке генерил ту же картинку дважды.
 *
 * Контракт:
 *  1) сначала Clipboard API (async, современный путь);
 *  2) при отказе — execCommand('copy') через внеэкранный textarea
 *     (работает по user-activation даже там, где API запрещён политикой);
 *  3) оба пути упали — вызывающий обязан ПОКАЗАТЬ ошибку (результат
 *     { ok:false, reason }), а не молчать: тихий сбой буфера = дубль
 *     рендера на живом конвейере автора.
 */

export interface CopyResult {
  ok: boolean
  /** 'clipboard-api' | 'exec-command' — какой путь сработал */
  via: 'clipboard-api' | 'exec-command' | 'none'
  /** человекочитаемая причина отказа (для тоста/лога) */
  reason?: string
}

function copyViaExec(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    /* вне экрана + фиксированная позиция: не скроллит страницу,
     * не ловит фокус-рамку, не мигает на мобильных */
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.left = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    const previouslyFocused = document.activeElement as HTMLElement | null
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    previouslyFocused?.focus?.()
    return ok
  } catch {
    return false
  }
}

/** Копировать текст в буфер со всеми фоллбеками. Клиентский код only. */
export async function copyText(text: string): Promise<CopyResult> {
  if (typeof window === 'undefined') {
    return { ok: false, via: 'none', reason: 'нет окна браузера' }
  }
  /* пустой текст — не копия, а гарантированная «вставка старого»:
   * возвращаем отказ, кнопка обязана подсветить это, а не молча
   * затирать успехом (экспресс-слоты без NEG) */
  if (text === '') {
    return { ok: false, via: 'none', reason: 'пусто — копировать нечего' }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return { ok: true, via: 'clipboard-api' }
    }
  } catch {
    /* iframe policy / не secure context / нет прав — идём в fallback */
  }
  if (copyViaExec(text)) {
    return { ok: true, via: 'exec-command' }
  }
  return {
    ok: false,
    via: 'none',
    reason: 'буфер закрыт (iframe/политика) — выдели и скопируй вручную',
  }
}
