/**
 * Mentor credits: the price on screen must be the price Whop charges
 * (review M3). Before a checkout session is created the Whop plan behind
 * WHOP_PLAN_MENTOR_* is read and compared with ai_credit_package.price_eur_cents:
 *   - currency must be EUR
 *   - a top-up: initial price equals the row price and it must not renew
 *   - a subscription: renewal price equals the row price and the first charge
 *     is that price too. On Whop a renewal plan's initial_price is an extra
 *     fee charged ON TOP of the first renewal_price (4.90/4.90 showed
 *     initial_price_due 9.80, Kassa 14 Oct), so the live plans carry
 *     initial_price 0. The first charge is initial_price_due when Whop sends
 *     it (number or {amount}), otherwise initial_price must be 0.
 *   - no free trial phase (review H3: a trial fires payment.succeeded at 0)
 * Any difference or an unreadable plan is a refusal (the route returns 503 and
 * alerts). Cached 10 minutes per plan id and price; failures are not cached.
 *
 * Field names follow the Whop v1 plan object (initial_price, renewal_price,
 * currency, trial_period_days), prices as decimal currency units. Confirm
 * against the first real mentor plan before MENTOR_PACKAGES_ENABLED.
 */

import * as Sentry from "@sentry/nextjs";
import { whopHeaders, whopMoneyCents } from "@/lib/whop-api";

export const PLAN_CACHE_MS = 10 * 60_000;

export type PlanCheck = { ok: true } | { ok: false; reason: "plan_unreadable" | "currency" | "initial_price" | "renewal_price" | "trial" };

export type PlanFetcher = (planId: string, apiKey: string) => Promise<unknown>;

const cache = new Map<string, number>();

/** Clear the in-process cache (tests). */
export function resetPlanCheckCache(): void {
  cache.clear();
}

async function fetchWhopPlan(planId: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.whop.com/api/v1/plans/${encodeURIComponent(planId)}`, {
    headers: whopHeaders(apiKey),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Whop plan HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

const money = whopMoneyCents;

/** Pure comparison of a Whop plan object with the catalogue row. */
export function comparePlan(plan: unknown, priceCents: number, kind: "subscription" | "topup"): PlanCheck {
  const raw = plan && typeof plan === "object" ? (plan as Record<string, unknown>) : null;
  const p = raw && raw.data && typeof raw.data === "object" && !("initial_price" in raw) ? (raw.data as Record<string, unknown>) : raw;
  if (!p) return { ok: false, reason: "plan_unreadable" };
  if (typeof p.currency !== "string" || p.currency.toLowerCase() !== "eur") return { ok: false, reason: "currency" };
  const initial = money(p.initial_price);
  const renewal = money(p.renewal_price) ?? 0;
  if (kind === "topup") {
    if (initial === null || initial !== priceCents) return { ok: false, reason: "initial_price" };
    if (renewal !== 0) return { ok: false, reason: "renewal_price" };
  } else {
    if (renewal !== priceCents) return { ok: false, reason: "renewal_price" };
    const due = p.initial_price_due === undefined || p.initial_price_due === null ? null : money(p.initial_price_due);
    if (p.initial_price_due !== undefined && p.initial_price_due !== null && due === null) return { ok: false, reason: "initial_price" };
    const firstChargeOk = due !== null ? due === priceCents && (initial === null || initial === 0) : initial === 0;
    if (!firstChargeOk) return { ok: false, reason: "initial_price" };
  }
  const trial = typeof p.trial_period_days === "number" ? p.trial_period_days : Number(p.trial_period_days ?? 0);
  if (Number.isFinite(trial) && trial > 0) return { ok: false, reason: "trial" };
  return { ok: true };
}

export async function checkMentorPlan(args: {
  planId: string;
  priceCents: number;
  kind: "subscription" | "topup";
  apiKey: string | null;
  fetchPlan?: PlanFetcher;
  now?: () => number;
}): Promise<PlanCheck> {
  const now = args.now ? args.now() : Date.now();
  const key = `${args.planId}:${args.priceCents}:${args.kind}`;
  const at = cache.get(key);
  if (at !== undefined && now - at < PLAN_CACHE_MS) return { ok: true };
  if (!args.apiKey) return { ok: false, reason: "plan_unreadable" };
  let plan: unknown;
  try {
    plan = await (args.fetchPlan ?? fetchWhopPlan)(args.planId, args.apiKey);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout", step: "plan_check" } });
    return { ok: false, reason: "plan_unreadable" };
  }
  const r = comparePlan(plan, args.priceCents, args.kind);
  if (r.ok) cache.set(key, now);
  else Sentry.captureMessage(`mentor plan ${args.planId} does not match the package row (${r.reason}): checkout refused`, "error");
  return r;
}
