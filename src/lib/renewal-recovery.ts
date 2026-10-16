/**
 * Renewal recovery (a-renewal-recovery-card). Pure rules for the Home card that
 * opens the stored Whop recovery link of a declined renewal.
 *
 * Source row: the `whop_payment_recovery_needed` user_events row the Whop
 * webhook writes (payment.failed / payment.requires_action). The card shows
 * only for the newest such row in the last 14 days when it carries a
 * `recovery_url` on whop.com, and no `grant_succeeded` payment event landed
 * after it. The fallback manage-page link is never used here: the approved
 * C5 copy says "complete the open payment", which only recovery_url resumes.
 *
 * Transactional on purpose (a payment for access the learner already bought):
 * paid access does NOT hide it (a declined renewal usually arrives while the
 * learner still has Pro). Hidden for staff or test accounts, ids in
 * CHECKOUT_RESUME_EXCLUDE_USER_IDS, learners suppressed with scope `all`
 * (a marketing-only row does not hide it), a refunded history and while the
 * flag is off.
 */
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { resumeExcludedIds } from "@/lib/checkout-resume";

export const RECOVERY_WINDOW_DAYS = 14;
export const RECOVERY_WINDOW_MS = RECOVERY_WINDOW_DAYS * 86_400_000;
export const RECOVERY_EVENT = "whop_payment_recovery_needed";

export function renewalRecoveryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RENEWAL_RECOVERY_CARD_ENABLED === "true";
}

export { resumeExcludedIds as recoveryExcludedIds };

/** Only an https link on whop.com (or a subdomain) is ever handed to the browser. */
export function safeRecoveryUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (host !== "whop.com" && !host.endsWith(".whop.com")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export interface RecoveryRow { created_at: string; event_data: Record<string, unknown> | null }
export interface RecoveryGrant { created_at: string; payment_id?: string | null }
export interface RecoveryRevoke { created_at: string }

export interface RecoveryAccount {
  id: string;
  role?: string | null;
  tier?: string | null;
  email?: string | null;
  /** An active mail_suppression row with scope `all` (transactional blocked too). */
  suppressedAll: boolean;
  /** A refunded subscription row exists. */
  refunded?: boolean;
}

export type RecoveryHide =
  | "flag_off" | "excluded" | "staff" | "suppressed" | "refunded" | "no_row" | "no_link" | "granted_since" | "revoked";

/** `requires_action` is a 3D Secure hold, anything else a declined charge. */
export type RecoveryKind = "requires_action" | "failed";

export type RecoveryDecision =
  | { show: false; reason: RecoveryHide }
  | { show: true; url: string; kind: RecoveryKind; at: string };

export function decideRenewalRecovery(input: {
  enabled: boolean;
  excluded: ReadonlySet<string>;
  account: RecoveryAccount;
  rows: readonly RecoveryRow[];
  grants: readonly RecoveryGrant[];
  /** whop_subscription_revoked rows of this learner (access ended after dunning, cancel or refund). */
  revokes?: readonly RecoveryRevoke[];
  now?: Date;
}): RecoveryDecision {
  const now = (input.now ?? new Date()).getTime();
  const { account } = input;
  if (!input.enabled) return { show: false, reason: "flag_off" };
  if (input.excluded.has(account.id.toLowerCase())) return { show: false, reason: "excluded" };
  if (isStaffOrTestAccount({ role: account.role ?? null, tier: account.tier ?? null, email: account.email ?? null })) return { show: false, reason: "staff" };
  if (account.suppressedAll) return { show: false, reason: "suppressed" };
  if (account.refunded) return { show: false, reason: "refunded" };

  const since = now - RECOVERY_WINDOW_MS;
  const rows = input.rows
    .filter((r) => { const t = Date.parse(r.created_at); return Number.isFinite(t) && t >= since && t <= now; })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = rows[0];
  if (!newest) return { show: false, reason: "no_row" };
  const url = safeRecoveryUrl(newest.event_data?.recovery_url);
  if (!url) return { show: false, reason: "no_link" };
  const openedAt = Date.parse(newest.created_at);
  // Identity first, time second: webhooks can arrive out of order, so a row written after the
  // grant (a redelivered payment.failed) must still be silenced by the payment it names.
  const paymentId = typeof newest.event_data?.payment_id === "string" ? newest.event_data.payment_id : null;
  if (input.grants.some((g) => (paymentId !== null && g.payment_id === paymentId) || Date.parse(g.created_at) >= openedAt)) return { show: false, reason: "granted_since" };
  // Access ended after the decline (dunning exhausted, cancelled, refunded): the link points at a dead charge.
  if ((input.revokes ?? []).some((r) => Date.parse(r.created_at) >= openedAt)) return { show: false, reason: "revoked" };
  const ev = String(newest.event_data?.event ?? "");
  const kind: RecoveryKind = /requires_action/.test(ev) ? "requires_action" : "failed";
  return { show: true, url, kind, at: newest.created_at };
}
