/**
 * One Back behaviour for the app (UX-GLOBAL-10).
 *
 * Order:
 *   1. a validated `returnTo` parameter (same allowlist as `next`, safeNext);
 *   2. in-app history, when the previous entry is an in-app route — tracked
 *      by a session navigation marker, never document.referrer (empty after
 *      client navigation and in standalone PWAs);
 *   3. the IA parent (study pages to Home, Fortschritt tabs to Fortschritt);
 *   4. Home with a session, /landing without.
 *
 * `returnTo` carries in-app returns; `next` is used only after sign-in.
 * Labels by destination: "Zurück" for history, "Startseite" for Home.
 *
 * resolveBack() is pure and unit-tested; goBack() applies it.
 */

import { safeNext } from './auth-entry'

export type BackKind = 'returnTo' | 'history' | 'parent' | 'home' | 'landing'

export interface BackTarget {
  kind: BackKind
  /** Route to push; absent for 'history' (use history.back()). */
  href?: string
  /** i18n key of the visible label. */
  labelKey: 'back' | 'home'
}

export interface BackContext {
  pathname: string
  search?: string
  /** The previous in-app path recorded by the navigation marker, if any. */
  previousInAppPath?: string | null
  hasSession: boolean
}

/** IA parents. Keys are route prefixes, longest match wins. */
const PARENTS: ReadonlyArray<[string, string]> = [
  ['/history/', '/history'],
  ['/stats', '/progress'],
  ['/history', '/progress'],
  ['/dashboard/exam-result', '/exam'],
  ['/flashcards', '/library'],
  ['/settings', '/'],
  ['/study-plan', '/'],
  ['/curriculum', '/'],
  ['/progress', '/'],
  ['/library', '/'],
  ['/mistakes', '/'],
  ['/quiz', '/'],
  ['/exam', '/'],
  ['/changelog', '/'],
  ['/pricing', '/'],
]

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix) && pathname.length > prefix.length
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export function iaParent(pathname: string): string | null {
  let best: [string, string] | null = null
  for (const entry of PARENTS) {
    if (matchesPrefix(pathname, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry
  }
  if (!best || best[1] === pathname) return null
  return best[1]
}

export function readReturnTo(search: string | undefined): string | null {
  if (!search) return null
  try {
    const value = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('returnTo')
    if (!value) return null
    const safe = safeNext(value, '')
    return safe || null
  } catch {
    return null
  }
}

export function resolveBack(ctx: BackContext): BackTarget {
  const returnTo = readReturnTo(ctx.search)
  if (returnTo && returnTo !== ctx.pathname) {
    return { kind: 'returnTo', href: returnTo, labelKey: returnTo === '/' ? 'home' : 'back' }
  }
  if (ctx.previousInAppPath && ctx.previousInAppPath !== ctx.pathname) {
    return { kind: 'history', labelKey: 'back' }
  }
  const parent = iaParent(ctx.pathname)
  if (parent && (ctx.hasSession || parent !== '/')) {
    return { kind: 'parent', href: parent, labelKey: parent === '/' ? 'home' : 'back' }
  }
  return ctx.hasSession ? { kind: 'home', href: '/', labelKey: 'home' } : { kind: 'landing', href: '/landing', labelKey: 'home' }
}

/** Build an in-app link that returns here (used by deep links into study). */
export function withReturnTo(href: string, returnTo: string): string {
  const safe = safeNext(returnTo, '')
  if (!safe) return href
  const [path, hash = ''] = href.split('#')
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}returnTo=${encodeURIComponent(safe)}${hash ? `#${hash}` : ''}`
}

// ── Session navigation marker ───────────────────────────────────────────
// A tiny in-memory + sessionStorage trail of in-app paths. Written by
// <NavigationMarker /> on every route change; read by goBack().

const TRAIL_KEY = 'mp_nav_trail'
const TRAIL_MAX = 20

export function pushTrail(trail: readonly string[], path: string): string[] {
  if (trail[trail.length - 1] === path) return trail.slice()
  const next = [...trail, path]
  return next.length > TRAIL_MAX ? next.slice(next.length - TRAIL_MAX) : next
}

export function readTrail(): string[] {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(TRAIL_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export function recordNavigation(path: string): void {
  try {
    const next = pushTrail(readTrail(), path)
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(next))
  } catch { /* storage blocked: Back falls through to the IA parent */ }
}

export function previousInAppPath(currentPath: string): string | null {
  const trail = readTrail()
  // The last entry is the current page; the one before it is where we came from.
  const index = trail.lastIndexOf(currentPath)
  return index > 0 ? trail[index - 1] : null
}

/** Mark the current page as left by Back so the trail does not loop. */
export function popTrail(): void {
  try {
    const trail = readTrail()
    trail.pop()
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail))
  } catch { /* ignore */ }
}

export interface BackRouter {
  push(href: string): void
  replace?(href: string): void
}

export function goBack(router: BackRouter, hasSession: boolean): BackTarget {
  const pathname = window.location.pathname
  const target = resolveBack({
    pathname,
    search: window.location.search,
    previousInAppPath: previousInAppPath(pathname),
    hasSession,
  })
  if (target.kind === 'history') {
    popTrail()
    window.history.back()
  } else if (target.href) {
    router.push(target.href)
  }
  return target
}
