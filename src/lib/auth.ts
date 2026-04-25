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

/**
 * Retrieve the stored session from localStorage (set after Login Widget auth).
 *
 * Defence-in-depth (review-2026-04-25-A1): the WRITE path
 * (`storeSession` → `sanitizeUserForStorage`) strips secrets, but cached
 * sessions persisted BEFORE that fix shipped (PR #6 / 2026-04-24) still
 * carry `password_hash`, `password_salt`, etc. Until every existing user
 * logs out + back in, those credentials leak to every script on
 * medpruef.com (XSS, browser extensions, even ad-tech in dev).
 *
 * So the READ path now also runs the sanitizer. If the stored blob has
 * any disallowed fields, we strip them AND write the cleaned version
 * back to localStorage — so the next read is fast and the leak is
 * permanently neutralized after a single page load. Idempotent: a
 * blob that's already clean compares equal and we skip the write.
 */
export function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.user) return parsed;
    const cleanUser = sanitizeUserForStorage(
      parsed.user as unknown as Record<string, unknown>,
    ) as StoredSession['user'];
    // If the read blob had ANY disallowed field, persist the cleaned
    // version so future scripts on this origin can't read it.
    const originalKeys = Object.keys(parsed.user);
    const cleanedKeys = Object.keys(cleanUser);
    if (originalKeys.length !== cleanedKeys.length) {
      const safe = { ...parsed, user: cleanUser };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
      } catch {
        // localStorage might be full / disabled; the in-memory return
        // is still sanitized so the leak is closed for THIS render.
      }
      return safe;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Whitelist of `user` fields that are safe to keep in localStorage.
 *
 * The 2026-04-24 prod UX tour caught `password_hash` in
 * `localStorage.medpruef_session.user` — every script loaded on a
 * medpruef.com page (and every browser extension) could read the
 * bcrypt hash. Even though `/api/auth` now sanitizes responses, defence
 * in depth: every entry path into `storeSession` (login, register,
 * Telegram exchange, settings update, EmailValidationModal, the
 * `setItem` call in quiz/page.tsx that re-stamps the session) goes
 * through this filter, so a stale or unsanitized server payload can't
 * leak credentials to the client storage.
 *
 * Any field NOT in this list is dropped before persistence. To add a
 * new public field, list it here. If you find yourself reaching for
 * `role` or anything starting with `password_`, stop — those belong on
 * the server.
 */
const SAFE_USER_FIELDS = new Set<string>([
  'id',
  'telegram_id',
  'telegram_username',
  'email',
  'email_status',
  'first_name',
  'last_name',
  'photo_url',
  'language_code',
  'active_exam',
  'tier',
  'tier_expires_at',
  'role', // UI-only hint; every server route revalidates via requireAdmin
  'xp_total',
  'streak_count',
  'longest_streak',
  'level',
  'daily_goal',
  'exam_date',
  'last_active_date',
  'referral_code',
  'created_at',
  'updated_at',
]);

/**
 * Strip every field that isn't in the whitelist before persisting.
 * Returns a fresh object so callers can't mutate it post-store.
 */
function sanitizeUserForStorage(
  user: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!user || typeof user !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) {
    // Hard-stop on anything matching `password_*` — `password_hash`,
    // `password_salt`, `password_changed_at`, `password_reset_token`.
    if (key.startsWith('password_')) continue;
    // Telegram bot HMAC secret and similar one-shot auth materials.
    if (key === 'telegram_auth_secret' || key === 'telegram_login_token') continue;
    // Server-only ban/lock state.
    if (key === 'is_banned' || key === 'is_locked') continue;
    // `role` is a deliberate carve-out: the audit denylist suggested
    // stripping it, but every admin-gated route revalidates server-side
    // via `requireAdmin()` (against the DB, not the request). Client
    // `role` only controls UI affordances (sidebar entry, /admin
    // redirect). Without it, admins see the public chrome until a
    // round-trip resolves their role — degraded UX for zero security
    // gain because the server wouldn't trust the client value anyway.
    // Tracked as a session-refactor follow-up if we ever ship signed
    // cookies; for now keep `role` and rely on server validation.
    if (SAFE_USER_FIELDS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Persist a session to localStorage. The user blob is filtered through
 * the {@link SAFE_USER_FIELDS} whitelist so credentials and other
 * server-only state can never reach the browser's storage.
 */
export function storeSession(session: StoredSession): void {
  if (typeof window === 'undefined') return;
  try {
    const safe = {
      ...session,
      user: sanitizeUserForStorage(
        session.user as unknown as Record<string, unknown>,
      ) as StoredSession['user'],
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(safe));
  } catch {}
}

/** Exported only for unit tests — DO NOT call from product code. */
export function __sanitizeUserForStorageForTests(
  user: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return sanitizeUserForStorage(user);
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
