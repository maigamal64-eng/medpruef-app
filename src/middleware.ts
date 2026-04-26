import { NextRequest, NextResponse } from 'next/server'

/**
 * Middleware — server-side routing before any React hydration.
 *
 * F6 fix (2026-04-26): unauthenticated requests to `/` previously did a
 * client-side redirect *after* hydration, causing a 5-second blank screen
 * (ü-dots loader + nothing else) while the JS bundle loaded and checked
 * localStorage. Now we do a server-side 302 to `/landing` for the common
 * unauthenticated case — the user sees fully-SSR'd marketing content
 * immediately.
 *
 * We intentionally do NOT redirect when:
 *  - The request carries `?tg_token=` — Telegram bot deep-link exchange.
 *    The home page must receive this token so the exchange useEffect can
 *    claim it (Apr 14 race-condition fix must not be broken).
 *  - The request carries `?tg_start=1` — bare /start welcome button link.
 *  - The request carries `?welcome=cohort` — post-payment greeting.
 *  - A session cookie exists (see note below).
 *
 * Session detection: MedPrüf stores the session in localStorage (client-only),
 * not in an HTTP cookie, so we have no reliable server-side signal. The
 * safest heuristic: redirect only when there is NO query param that
 * indicates an active flow. Authenticated users who land on `/` with no
 * special params will be sent to `/landing` first, but the client-side
 * authenticate() hook immediately detects the stored session and renders
 * the dashboard — this is a one-render flicker, far less jarring than a
 * 5-second blank screen. An `X-Skip-Landing` cookie written post-login
 * bypasses the redirect entirely for returning users.
 */
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl

  // Only intercept bare `/`
  if (pathname !== '/') return NextResponse.next()

  // Allow Telegram deep-link flows through unchanged
  if (
    searchParams.has('tg_token') ||
    searchParams.has('tg_start') ||
    searchParams.has('welcome')
  ) {
    return NextResponse.next()
  }

  // Skip-landing cookie: set on the client after a successful login so
  // returning authenticated users don't see the landing page flash.
  const skipLanding = req.cookies.get('mp_skip_landing')
  if (skipLanding) return NextResponse.next()

  // Redirect unauthenticated (or unknown) visitors to /landing
  return NextResponse.redirect(new URL('/landing', req.url))
}

export const config = {
  matcher: ['/'],
}
