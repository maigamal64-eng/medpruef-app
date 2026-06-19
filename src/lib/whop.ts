/**
 * Whop payment integration helpers — MedPrüf's primary card rail.
 *
 * Whop cleared [name]'s KYC with his national ID where Stripe (Egypt + an
 * expired passport) could not. Each tier is a one-time Whop plan; the
 * webhook (/api/webhooks/whop) grants Pro access on payment.succeeded.
 * Tier durations + the price catalogue are shared with the NOWPayments
 * path via @/lib/nowpayments (TIERS). Account/skill: ~/.claude/skills/whop;
 * decision memo: comms/payment-options-whop-vs-telegram-2026-06-19.md.
 *
 * Webhook auth = Standard Webhooks (svix) scheme:
 *   headers  webhook-id / webhook-timestamp / webhook-signature ("v1,<b64>")
 *   content  "{id}.{timestamp}.{rawBody}"
 *   sig      HMAC-SHA256(base64-decoded secret) -> base64  (strip "whsec_")
 */
import crypto from "crypto";
import { TIERS, computeExpiry } from "@/lib/nowpayments";

export { computeExpiry, TIERS };

/**
 * Map a Whop plan id (env-configured, created under the "MedPrüf Access"
 * product) to our internal tier id. Returns null for an unknown plan.
 */
export function whopPlanToTier(planId: string | null | undefined): string | null {
  if (!planId) return null;
  const map: Record<string, string> = {};
  const add = (env: string | undefined, tier: string) => {
    if (env) map[env] = tier;
  };
  add(process.env.WHOP_PLAN_FIRST_MONTH_19, "first_month_19");
  add(process.env.WHOP_PLAN_FIRST_3MO_27, "first_3mo_27");
  add(process.env.WHOP_PLAN_PREMIUM_PASS, "premium_pass_guaranteed");
  return map[planId] ?? null;
}

export function tierDurationMonths(tier: string): number {
  return TIERS[tier]?.durationMonths ?? 1;
}

export function isKnownTier(tier: string | null | undefined): tier is string {
  return Boolean(tier && TIERS[tier]);
}

// ── Standard Webhooks signature verification ──────────────────────
export function verifyWhopSignature(
  rawBody: string,
  headers: { id?: string | null; timestamp?: string | null; signature?: string | null },
  secret: string | undefined,
  toleranceSec = 300
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;

  // Reject stale/forged timestamps (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) {
    return false;
  }

  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(key, "base64");
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expBuf = Buffer.from(expected);

  // The header may carry several space-separated "v1,<base64sig>" entries.
  return signature.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    try {
      const b = Buffer.from(sig);
      return b.length === expBuf.length && crypto.timingSafeEqual(b, expBuf);
    } catch {
      return false;
    }
  });
}

// ── Defensive payload extraction ──────────────────────────────────
// Whop's exact payment payload field names are finalised against a real
// delivery during the go-live test; we read several plausible keys so a
// minor shape difference can't silently drop a grant.
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}
function toCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export interface WhopPaymentFields {
  paymentId: string | null;
  planId: string | null;
  email: string | null;
  metaUserId: string | null;
  metaTier: string | null;
  amountCents: number | null;
  currency: string;
}

export function extractWhopPayment(data: unknown): WhopPaymentFields {
  const d = rec(data);
  const user = rec(d.user);
  const member = rec(d.member);
  const metadata = rec(d.metadata);
  const planObj = rec(d.plan);

  return {
    paymentId: str(d.id) ?? str(d.payment_id) ?? str(d.receipt_id),
    planId: str(planObj.id) ?? str(d.plan_id) ?? str(d.plan) ?? str(d.access_pass),
    email: str(user.email) ?? str(d.email) ?? str(d.user_email) ?? str(member.email),
    metaUserId: str(metadata.medpruef_user_id) ?? str(metadata.user_id),
    metaTier: str(metadata.tier),
    amountCents:
      toCents(d.final_amount) ?? toCents(d.amount) ?? toCents(d.subtotal) ?? toCents(d.usd_amount),
    currency: (str(d.currency) ?? "eur").toLowerCase(),
  };
}
