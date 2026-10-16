/**
 * Renewal-off card (a-whop-cancel-signal). A Home card for a learner whose
 * live Whop subscription is set to cancel at period end, read from our own
 * signal log (user_events whop_renewal_signal, written by the Whop webhook or
 * the daily read), because the production key cannot read memberships yet.
 * Default off: RENEWAL_OFF_CARD_ENABLED must be 'true'. Pure.
 */
import { safeWhopManageUrl } from "@/lib/whop-subscription-snapshot";
import { WHOP_MANAGE_URL } from "@/lib/billing-copy";

export function renewalOffCardEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RENEWAL_OFF_CARD_ENABLED === "true";
}

export interface LiveWhopPin { whop_membership_id: string | null; expires_at: string | null }
export interface SignalRow { created_at: string; event_data: Record<string, unknown> | null }

export type RenewalOffDecision =
  | { show: false }
  | { show: true; membershipId: string; manageUrl: string };

/**
 * Show only when the newest renewal signal for one of the learner's live,
 * pinned Whop memberships says cancel_at_period_end = true. A later "back on"
 * signal, or a signal for a membership that is no longer live, hides it.
 */
export function decideRenewalOff(pins: readonly LiveWhopPin[], rows: readonly SignalRow[], nowMs: number = Date.now()): RenewalOffDecision {
  const live = new Set(
    pins
      .filter((p) => p.whop_membership_id?.startsWith("mem_") && p.expires_at && Date.parse(p.expires_at) > nowMs)
      .map((p) => p.whop_membership_id as string),
  );
  if (live.size === 0) return { show: false };
  // A plan switch (whop-switch.ts) turns renewal off on the old membership
  // while a newer pinned membership carries access on: no card then.
  const endOf = (mem: string) => Math.max(...pins.filter((p) => p.whop_membership_id === mem).map((p) => Date.parse(p.expires_at as string)));
  const newest = [...rows]
    .filter((r) => typeof r.event_data?.membership_id === "string" && live.has(r.event_data.membership_id as string))
    .filter((r) => typeof r.event_data?.cancel_at_period_end === "boolean")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // One decision per membership: the newest row for each.
  const seen = new Set<string>();
  for (const row of newest) {
    const mem = row.event_data!.membership_id as string;
    if (seen.has(mem)) continue;
    seen.add(mem);
    if (row.event_data!.cancel_at_period_end === true) {
      const offEnd = endOf(mem);
      if ([...live].some((other) => other !== mem && endOf(other) > offEnd)) continue;
      return { show: true, membershipId: mem, manageUrl: safeWhopManageUrl(row.event_data!.manage_url) ?? WHOP_MANAGE_URL };
    }
  }
  return { show: false };
}
