import { NextRequest, NextResponse } from 'next/server'

/* Ревизия 2026-10-13: конвенция middleware → proxy (Next 16 — варнинг
 * «The "middleware" file convention is deprecated. Please use "proxy"
 * instead» в dev.log). Семантика без изменений (CSP-nonce, Issue #47).
 *
 * Аудит 2026-10-12, остаток Issue #47: Strict-CSP с nonce для дашборда.
 * Дашборд рендерит летопись (текст писца/автора) — nonce-пайплайн закрывает
 * инлайн-инъекцию скриптов даже при прорыве экранирования. Next сам подхватывает
 * nonce из CSP-заголовка ЗАПРОСА и проставляет его своим скриптам
 * (документация Next.js: Content Security Policy). Стили — 'unsafe-inline'
 * (Tailwind/React инлайнят <style>; стили — слабейший вектор, принято).
 * Dev (turbopack HMR) требует 'unsafe-eval' и ws — только вне прод-сборки.
 * Дашборд loopback-only (127.0.0.1) — заголовок defense-in-depth, не замена
 * командному замку (apiguard). */
export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const isDev = process.env.NODE_ENV !== 'production'

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', csp)
  return response
}

export const config = {
  /* CSP нужен только документам и API; статика Next кешируется без него */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
