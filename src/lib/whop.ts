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

// ── Whop v2 dashboard-webhook auth (the scheme Whop ACTUALLY uses) ──
// Verified against a real delivery 2026-06-19: Whop's dashboard webhooks send
// NO svix headers — they send the configured secret in a `webhook-secret`
// header and you verify by constant-time equality. (The generic docs describe
// Standard Webhooks / HMAC, which these deliveries do NOT use.)
export function verifyWhopSecretHeader(
  headerValue: string | null | undefined,
  configuredSecret: string | undefined
): boolean {
  if (!headerValue || !configuredSecret) return false;
  // Accept the secret verbatim or with the `ws_` prefix stripped on either side.
  const candidates = [
    configuredSecret,
    configuredSecret.replace(/^ws_/, ""),
  ];
  const hv = headerValue.trim();
  return candidates.some((c) => {
    try {
      const a = Buffer.from(hv);
      const b = Buffer.from(c);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

// ── Standard Webhooks signature verification (fallback) ─────────────
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

  // Whop's secret is `ws_<hex>` (classic Standard Webhooks uses
  // `whsec_<base64>`). Don't hard-code the encoding: try the key as
  // hex / base64 / utf8 and match the HMAC as base64 OR hex. Whichever
  // scheme Whop actually uses will match; everything else fails closed.
  const body = secret.replace(/^whsec_/, "").replace(/^ws_/, "");
  const keyCandidates: Buffer[] = [];
  if (/^[0-9a-fA-F]+$/.test(body) && body.length % 2 === 0) {
    keyCandidates.push(Buffer.from(body, "hex"));
  }
  keyCandidates.push(Buffer.from(body, "base64"));
  keyCandidates.push(Buffer.from(body, "utf8"));
  keyCandidates.push(Buffer.from(secret, "utf8"));

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const provided = signature
    .split(" ")
    .map((p) => (p.includes(",") ? p.split(",")[1] : p))
    .filter(Boolean);

  const eq = (a: string, b: string): boolean => {
    try {
      const ba = Buffer.from(a);
      const bb = Buffer.from(b);
      return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  };

  for (const keyBytes of keyCandidates) {
    if (keyBytes.length === 0) continue;
    const digest = crypto.createHmac("sha256", keyBytes).update(signedContent).digest();
    const asB64 = digest.toString("base64");
    const asHex = digest.toString("hex");
    if (provided.some((sig) => eq(sig, asB64) || eq(sig, asHex))) return true;
  }
  return false;
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
  memberId: string | null;
  metaUserId: string | null;
  metaTier: string | null;
  amountCents: number | null;
  currency: string;
}

// The v1 payment.succeeded payload carries NO top-level user_id / plan_id /
// email in the documented schema — only `data.id` (pay_), `data.member.id`
// (mem_), `data.amount_after_fees` (net float), `data.currency`, and
// `data.metadata` (our echoed checkout-session metadata). So the reliable
// buyer→user map is `data.metadata.medpruef_user_id`; plan/email are
// best-effort fallbacks only. (Verified via docs + a live checkout session.)
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
    memberId: str(member.id) ?? str(d.member_id),
    metaUserId: str(metadata.medpruef_user_id) ?? str(metadata.user_id),
    metaTier: str(metadata.tier),
    amountCents:
      toCents(d.amount_after_fees) ??
      toCents(d.final_amount) ??
      toCents(d.amount) ??
      toCents(d.subtotal),
    currency: (str(d.currency) ?? "eur").toLowerCase(),
  };
}

// ── Server-side checkout (per-user metadata session) ──────────────
// The buyer→user map relies on metadata, so every checkout must attach it via
// a checkout-configuration session (ch_...). Verified: POST
// /api/v1/checkout_configurations (NO company_id — inferred from the key)
// returns { id: ch_..., purchase_url: ".../<plan>/?session=ch_..." }. The
// scoped app key (WHOP_API_KEY) is authorized for this; the owner key is not
// needed at runtime.
export function tierToWhopPlan(tier: string): string | null {
  const map: Record<string, string | undefined> = {
    first_month_19: process.env.WHOP_PLAN_FIRST_MONTH_19,
    first_3mo_27: process.env.WHOP_PLAN_FIRST_3MO_27,
    premium_pass_guaranteed: process.env.WHOP_PLAN_PREMIUM_PASS,
  };
  return map[tier] ?? null;
}

export interface WhopCheckoutSession {
  id: string;
  purchaseUrl: string;
  planId: string;
}

export async function createWhopCheckoutSession(args: {
  planId: string;
  metadata: Record<string, string>;
  redirectUrl: string;
}): Promise<WhopCheckoutSession> {
  // Prod (Vercel) sets WHOP_API_KEY; the local .env.local stores the same
  // scoped app key under WHOP_APP_API_KEY. Accept either so local dev + prod
  // both resolve without a duplicated secret.
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY / WHOP_APP_API_KEY not set");
  const res = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      plan_id: args.planId,
      metadata: args.metadata,
      redirect_url: args.redirectUrl,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Whop checkout_configurations HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const d = JSON.parse(text) as { id?: string; purchase_url?: string };
  if (!d.id || !d.purchase_url) {
    throw new Error(`Whop checkout response missing id/purchase_url: ${text.slice(0, 200)}`);
  }
  return { id: d.id, purchaseUrl: d.purchase_url, planId: args.planId };
}
