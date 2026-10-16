/**
 * Renew before the end date, and switch to a longer pass (a21, a-renew-early).
 *
 * WHOP_EXTENSIONS_ENABLED (default off): a learner with Whop access that
 * will not charge again (a one-time pass, or a renewing plan already
 * cancelled at Whop) may pay now; the new time starts at the current end.
 * WHOP_SWITCH_CANCEL_ENABLED (default off, needs the first; [name]'s one-time
 * OK E2): a learner whose plan still renews may buy a strictly longer plan;
 * once that payment is granted the app sets cancel_at_period_end on the old
 * membership (whop-switch.ts), so the old plan never charges again.
 *
 * Why the extension gets its own row (review 2026-10-12): the old grant
 * extended the newest live Whop row in place and re-pinned it, so a later
 * membership-only deactivation of either membership revoked the merged row,
 * the paid extension with it. grant_whop_paid_subscription_pinned
 * (20270104090000) and its TS mirror (whop-grant.ts pinnedGrantTarget) give a
 * new membership its own row, starting at the old end and pinned to it, so a
 * membership-only revoke flips only that membership's row. That works only
 * when the running rows carry real mem_ pins: an unpinned row would still be
 * extended in place, so it is not offered.
 *
 * Comp and manual access stay non-extendable: the newest live Whop row must
 * end when the account ends. A manual, crypto or referral grant, a PUYP hand
 * extension or a renewal-guard row that outlasts the Whop row would gain no
 * days (the new row starts at the Whop end), so it gets EXTENSION_UNAVAILABLE.
 *
 * Turn the flags on only after the changeset is applied and Kassa has
 * replayed real payloads (release note a-renew-early).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";
import { TIERS } from "@/lib/nowpayments";

const monthsOf = (tier: string): number => TIERS[tier]?.durationMonths ?? 1;

export type ExtensionAvailability = "available" | "unavailable" | "error";

export function whopExtensionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WHOP_EXTENSIONS_ENABLED === "true";
}

/** The switch for renewing payers (E2). Never on without extensions. */
export function whopSwitchCancelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return whopExtensionsEnabled(env) && env.WHOP_SWITCH_CANCEL_ENABLED === "true";
}

interface LiveWhopRow { expires_at: string | null; whop_membership_id: string | null }

/** Pure rule (tested): may this account pay now with the new time from its current end? */
export function extensionAllowedFor(rows: LiveWhopRow[], accountExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!accountExpiresAt || !Number.isFinite(Date.parse(accountExpiresAt))) return false;
  const live = rows.filter((row) => row.expires_at == null || Date.parse(row.expires_at) > now.getTime());
  if (live.length === 0) return false;
  // A non-expiring Whop row cannot be stacked after; an unpinned row would be merged into.
  if (live.some((row) => row.expires_at == null || !whopMembershipIdOrNull(row.whop_membership_id))) return false;
  const newest = Math.max(...live.map((row) => Date.parse(row.expires_at as string)));
  return Math.abs(newest - Date.parse(accountExpiresAt)) <= 60_000;
}

export async function extensionAvailability(
  sb: SupabaseClient,
  userId: string,
  accountExpiresAt: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<ExtensionAvailability> {
  if (!whopExtensionsEnabled(env) || !accountExpiresAt) return "unavailable";
  const { data, error } = await sb.from("subscriptions")
    .select("expires_at, whop_membership_id").eq("user_id", userId).eq("payment_provider", "whop").eq("status", "active");
  if (error) return "error";
  return extensionAllowedFor((data ?? []) as LiveWhopRow[], accountExpiresAt) ? "available" : "unavailable";
}

/**
 * The plans a renewing payer may switch to: strictly longer than the plan
 * that renews (whole months per charge), never the Sitting Pass (its end is
 * tied to a sitting date and is not stacked). `candidates` are the plans the
 * account may buy at all (checkout tiers, plus the earlier plans for a
 * returning payer).
 */
export function switchTiersFor(renewingTier: string, candidates: Iterable<string>): string[] {
  const current = monthsOf(renewingTier);
  return [...candidates].filter((tier) => tier !== "sitting_pass" && Boolean(TIERS[tier]) && monthsOf(tier) > current);
}
