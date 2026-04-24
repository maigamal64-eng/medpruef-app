/**
 * Client-side authentication utilities.
 * Supports Telegram Mini App, Telegram Login Widget, and Email/Password.
 * Safe to import in Client Components — no Node.js APIs.
 */

const SESSION_KEY = 'medpruef_session';

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface StoredSession {
  user: {
    id: string;
    telegram_id?: number;
    email?: string;
    email_status?: 'valid' | 'bounced' | 'unverified' | null;
    first_name: string;
    last_name?: string;
    role?: string;
    /** 'free' | 'pro' | 'admin' — populated by /api/auth after 2026-04-23 Lock */
    tier?: string;
    tier_expires_at?: string | null;
    xp_total: number;
    streak_count: number;
    daily_goal: number;
  };
  gamification: {
    total_xp: number;
    current_streak: number;
    total_questions_answered: number;
    total_correct: number;
    daily_questions_today: number;
  };
}

/** Returns true when running inside a Telegram Mini App. */
export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  return !!(tg?.WebApp?.initData);
}

/** Returns the Mini App initData string (empty string if not in Mini App). */
export function getMiniAppInitData(): string {
  if (typeof window === 'undefined') return '';
  const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  return tg?.WebApp?.initData || '';
}

/** Retrieve stored session from localStorage (set after Login Widget auth). */
export function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Persist a session to localStorage. */
export function storeSession(session: StoredSession): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

/** Remove stored session (logout). */
export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** Check if the current user has admin role. */
export function isAdmin(session?: StoredSession | null): boolean {
  const s = session === undefined ? getStoredSession() : session;
  return s?.user?.role === 'admin';
}

/**
 * Canonical client-side "does this user have Pro-level access" check.
 *
 * Used by every paywall gate on pages (mock exam, bookmarks, notes,
 * SR review) and by the PaywallUpgradeModal trigger. Must honor ALL
 * three access paths:
 *
 * 1. `role === 'admin'` — the /admin/ console operator. Always has
 *    access regardless of tier (they may not be a paying customer).
 * 2. `tier === 'pro'` or `tier === 'admin'` with either no expiry
 *    or a future `tier_expires_at`.
 * 3. Defence-in-depth: a stale localStorage session where `tier` is
 *    missing/stale but `role='admin'` is persistent. Without this,
 *    users whose session was cached before the April 23 tier catalogue
 *    get redirected to /pricing even when their DB row says admin.
 *    Logging out + back in refreshes tier from `/api/auth`, but we
 *    should never punish a user for a stale client cache.
 *
 * Returns `false` for free + anonymous + bounced / expired paid users.
 *
 * Pass an explicit `null` to force-check against no session (useful
 * for testing); pass `undefined` (default) to pull from localStorage.
 */
export function hasProAccess(session?: StoredSession | null): boolean {
  const s = session === undefined ? getStoredSession() : session;
  if (!s) return false;
  // Admin role overrides tier — /admin/ operators may have tier='free'
  // in the users table because they've never subscribed. That's fine.
  if (s.user.role === 'admin') return true;
  const tier = s.user.tier;
  if (tier !== 'pro' && tier !== 'admin') return false;
  const expires = s.user.tier_expires_at;
  if (!expires) return true;
  try {
    return new Date(expires).getTime() > Date.now();
  } catch {
    // Unparseable expiry — treat as valid (defence-in-depth; the
    // webhook is supposed to flip the tier back to 'free' on expiry,
    // so an unparseable value is a data bug, not an attack).
    return true;
  }
}

/**
 * Convenience negation of {@link hasProAccess}. Returns true for free,
 * guest, anonymous, and expired paid users. Mirrors the server-side
 * `isFreeTier` from `@/lib/free-tier`.
 */
export function isFreeAccess(session?: StoredSession | null): boolean {
  return !hasProAccess(session);
}
