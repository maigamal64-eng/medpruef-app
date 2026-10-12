import { NextRequest, NextResponse } from 'next/server'

/**
 * Markdown-for-Agents content negotiation (isitagentready.com spec +
 * Cloudflare's "Markdown for Agents" convention). A GET whose `Accept`
 * header EXPLICITLY includes `text/markdown` (not just a wildcard accept
 * value — normal browser Accept strings never contain this substring, so
 * human traffic is untouched) gets a concise markdown document instead of
 * the HTML page. HTML stays the default for everyone else.
 *
 * Kept to a small, hand-written per-path map rather than importing
 * content libs (topics.ts / exam-dates.ts) into the edge bundle — the
 * edge runtime can technically import them (no Node-only APIs in either
 * file), but topics.ts's EXAM_SOURCES carries hardcoded question counts
 * that NOTES.md flags as stale/DB-owned, so pulling it in here would
 * ship a number this file has no way to keep honest. Copy below states
 * only stable facts (exam names, how to start, where to look for
 * current numbers) and links out to /pricing for anything that moves.
 */
const MARKDOWN_DOCS: Record<string, string> = {
  '/': `# MedPrüf

MedPrüf is exam preparation for foreign-trained doctors sitting Austrian
medical-licensing exams.

## What it covers

Three Austrian exams, all part of the licensing/nostrification path (this
is Austrian medical law, not a German exam):

- **Kenntnisprüfung (Wien)**: the Vienna bank is based on SIP4a/SIP5a study
  material. The ÖÄK postgraduate Allgemeinmedizin examination is a different
  examination.
- **Stichprobentest (Innsbruck)**: the national MedUni nostrification
  screening test (venue rotates by sitting).
- **Pharmakologie**: Rezeptierkunde / prescription-studies content.

Practice questions, spaced-repetition review, flashcards, full exam
simulation, and progress tracking across all three.

## How to start

- Create an account or log in: /login
- See current plans and pricing: /pricing

## For agents and integrators

- Human-readable API docs: /docs/api
- Machine-readable API catalog: /.well-known/api-catalog
`,
}

function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4)
}

function wantsMarkdown(req: NextRequest): boolean {
  if (req.method !== 'GET') return false
  const accept = req.headers.get('accept') || ''
  return accept.includes('text/markdown')
}

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
/** Query keys that survive the `/` → `/landing` redirect (referral + campaign). */
const LANDING_FORWARD_PARAMS = ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'rdt_cid'] as const

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl

  // Markdown-for-Agents FIRST, before the `/` → `/landing` redirect below.
  // Order matters: an agent GETting `/` with `Accept: text/markdown` must
  // get the markdown doc, not get swept into the unauthenticated-visitor
  // redirect. This must stay ahead of the `pathname !== '/'` early-return
  // too, so adding more paths to MARKDOWN_DOCS later doesn't require
  // touching the redirect logic below at all.
  const markdownDoc = MARKDOWN_DOCS[pathname]
  if (markdownDoc && wantsMarkdown(req)) {
    return new NextResponse(markdownDoc, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Vary': 'Accept',
        'x-markdown-tokens': String(estimateTokens(markdownDoc)),
      },
    })
  }

  // Only intercept bare `/` from here on (existing landing-redirect logic,
  // untouched)
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

  // Referral attribution fix (2026-07-11): a bare `medpruf.com/?ref=CODE`
  // share link used to lose the query string on this redirect — visitors
  // landed on /landing with no way to recover the code, so 0/126 users
  // ever got `referred_by_code` populated. Forward `ref` onto /landing so
  // landing/page.tsx's localStorage capture (mirrors login/page.tsx) can
  // still pick it up before the visitor clicks through to Login/Register.
  //
  // Campaign attribution (a20, OW-46, 2026-10-12): the same redirect also
  // dropped utm_* and rdt_cid, so a tagged link to the bare domain (for
  // example a Telegram post) arrived on /landing untagged and the signup
  // could never be tied to its post. Forward them too.
  const landingUrl = new URL('/landing', req.url)
  for (const key of LANDING_FORWARD_PARAMS) {
    const value = searchParams.get(key)
    if (value) landingUrl.searchParams.set(key, value)
  }

  // Redirect unauthenticated (or unknown) visitors to /landing
  return NextResponse.redirect(landingUrl)
}

export const config = {
  // Explicit allow-list (not a negative-lookahead regex) so /api, /_next,
  // /admin, and static assets are excluded by construction. Extend this
  // list (and MARKDOWN_DOCS above) together when adding markdown support
  // for /pricing, /about, /materials.
  matcher: ['/'],
}
