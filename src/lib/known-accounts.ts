/**
 * "Known accounts on this device" — a small, client-only, localStorage-based
 * memory of which email(s) successfully signed in / registered on THIS
 * device/browser. Built 2026-07-27 after a paying user (user-432cce9c@example.com,
 * Pro) hit the free 150-question cap, didn't recognize it, and created a
 * SECOND free account (user-17219ccc@example.com) instead of signing back in — the
 * second account doesn't unlock anything (the free 150 are the same set
 * for every account), so the only outcome was split progress + risk of
 * studying on the wrong (free) account. This module lets the register
 * form gently nudge "you've been here before, sign in instead" (see
 * `src/app/login/page.tsx`).
 *
 * Privacy: this NEVER leaves the browser. No network call, no analytics
 * event, no tracking. Only the email the user typed themselves is stored,
 * capped at 3 entries (most-recent first; oldest evicted). Every read/write
 * is wrapped in try/catch so a blocked or unavailable localStorage (private
 * browsing, cookie/storage blockers, SSR) degrades to a silent no-op —
 * it must never throw and must never block login/register.
 */

const KNOWN_ACCOUNTS_KEY = "medpruef_known_accounts";
const MAX_KNOWN_ACCOUNTS = 3;

export interface KnownAccount {
  /** Exactly what the user typed into the email field (trimmed). */
  email: string;
  /** ISO timestamp of the most recent successful sign-in/register. */
  lastUsedAt: string;
}

/**
 * Read the known-accounts list for this device, most-recently-used first.
 * Returns an empty array on any failure (missing key, blocked storage,
 * corrupt JSON, SSR) — callers never need their own try/catch.
 */
export function getKnownAccounts(): KnownAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KNOWN_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is KnownAccount =>
        !!e &&
        typeof e === "object" &&
        typeof (e as KnownAccount).email === "string" &&
        (e as KnownAccount).email.trim().length > 0 &&
        typeof (e as KnownAccount).lastUsedAt === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Remember a successful login/register on this device. Call right after a
 * successful `/api/auth` response (email login, email register, Telegram
 * code exchange — any path that mints a session), passing the account's
 * own email. No-ops silently on a missing/blank email (e.g. Telegram-only
 * accounts with no email on file) and on any storage failure.
 *
 * Moves the email to the front (most-recent) if already known, otherwise
 * inserts it and evicts the oldest entry beyond {@link MAX_KNOWN_ACCOUNTS}.
 */
export function rememberKnownAccount(email: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const trimmed = (email || "").trim();
  if (!trimmed) return;
  try {
    const rest = getKnownAccounts().filter(
      (e) => e.email.toLowerCase() !== trimmed.toLowerCase(),
    );
    const next: KnownAccount[] = [
      { email: trimmed, lastUsedAt: new Date().toISOString() },
      ...rest,
    ].slice(0, MAX_KNOWN_ACCOUNTS);
    localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable/full/blocked — best-effort feature, non-fatal */
  }
}
