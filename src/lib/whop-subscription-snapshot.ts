import { classifySubscriptionCadence, type BillingCadence } from "@/lib/billing-cadence";
import { WHOP_MANAGE_URL } from "@/lib/billing-copy";
import { isWhopMembershipId } from "@/lib/whop-ids";

/** Whop v1 membership response. No plan list price substitutes for a buyer's charge.
 * https://docs.whop.com/api-reference/memberships/retrieve-membership */
export interface ProviderBillingSnapshot {
  plan_id: string | null;
  billing_cadence: BillingCadence;
  provider_status: string | null;
  is_trial: boolean;
  cancel_at_period_end: boolean;
  next_charge_at: string | null;
  next_charge_amount_cents: number | null;
  billing_interval_days: number | null;
  manage_url: string | null;
  provider_state_verified: boolean;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export function safeWhopManageUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && url.hostname === "whop.com" && !url.username && !url.password &&
      (url.pathname.startsWith("/billing/manage/") || url.pathname === "/@me/settings/memberships") ? url.href : null;
  } catch { return null; }
}
export function parseWhopBillingSnapshot(value: unknown, args: { membershipId: string; tier: string }): ProviderBillingSnapshot | null {
  const d = record(value);
  if (d.id !== args.membershipId) return null;
  const planId = string(record(d.plan).id) ?? string(d.plan_id);
  const cadence = classifySubscriptionCadence({ tier: args.tier, payment_provider: "whop", plan_id: planId });
  const status = string(d.status);
  const cancelled = d.cancel_at_period_end === true || status === "canceling" || status === "canceled";
  // Provider-formatted member renewal price is buyer-specific (discounts included).
  // Accept only an unambiguous EUR number + reviewed monthly/quarterly interval.
  const price = string(d.formatted_renewal_price);
  const match = d.currency === "eur" || d.currency === "EUR"
    ? price?.match(/^(?:€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*€)\s*\/\s*(month|monthly|30 days|quarter|quarterly|3 months|90 days)$/i) : null;
  const cents = match ? Math.round(Number((match[1] ?? match[2]).replace(",", ".")) * 100) : null;
  const interval = match ? /quarter|3 months|90 days/i.test(match[3]) ? 90 : 30 : null;
  const rawDate = d.renewal_period_end;
  const time = typeof rawDate === "number" ? rawDate > 1e12 ? rawDate : rawDate * 1000 : typeof rawDate === "string" ? Date.parse(rawDate) : NaN;
  const canCharge = cadence === "auto_renews" && !cancelled && d.payment_collection_paused !== true && (status === "active" || status === "trialing");
  return {
    plan_id: planId, billing_cadence: cadence, provider_status: status,
    is_trial: status === "trialing", cancel_at_period_end: cancelled,
    next_charge_at: canCharge && Number.isFinite(time) ? new Date(time).toISOString() : null,
    next_charge_amount_cents: canCharge && cents != null && Number.isSafeInteger(cents) ? cents : null,
    billing_interval_days: interval,
    manage_url: safeWhopManageUrl(d.manage_url), provider_state_verified: true,
  };
}
export function unknownBillingSnapshot(args: { tier: string; payment_provider: string | null; plan_id?: string | null }): ProviderBillingSnapshot {
  return {
    plan_id: args.plan_id ?? null,
    billing_cadence: classifySubscriptionCadence({ ...args, plan_id: args.plan_id ?? null }),
    provider_status: null, is_trial: false, cancel_at_period_end: false,
    next_charge_at: null, next_charge_amount_cents: null, billing_interval_days: null,
    manage_url: args.payment_provider === "whop" ? WHOP_MANAGE_URL : null,
    provider_state_verified: false,
  };
}
/**
 * One bounded membership read plus how it ended (a-stability): `status` is the
 * HTTP status, 0 for a network failure or timeout, null when no read was made
 * (no key, or the pin is not a mem_ membership id).
 */
export interface WhopBillingRead { snapshot: ProviderBillingSnapshot | null; status: number | null }
export async function loadWhopBillingRead(membershipId: string | null, tier: string): Promise<WhopBillingRead> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  if (!apiKey || !isWhopMembershipId(membershipId)) return { snapshot: null, status: null };
  try {
    const response = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}`, {
      method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    return { snapshot: response.ok ? parseWhopBillingSnapshot(await response.json(), { membershipId, tier }) : null, status: response.status };
  } catch { return { snapshot: null, status: 0 }; }
}

/** One bounded read, with no secrets/raw provider payload in the client response. */
export async function loadWhopBillingSnapshot(membershipId: string | null, tier: string): Promise<ProviderBillingSnapshot | null> {
  return (await loadWhopBillingRead(membershipId, tier)).snapshot;
}
