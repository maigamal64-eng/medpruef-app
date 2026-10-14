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
 * Webhook auth (confirmed against a real delivery 2026-06-19): Whop's dashboard
 * webhooks send the configured secret in a `webhook-secret` header — verify by
 * constant-time equality (verifyWhopSecretHeader). The Standard-Webhooks/svix
 * HMAC scheme (verifyWhopSignature) is kept ONLY as a fallback; the real v2
 * deliveries carry no svix headers and do not use it.
 */
import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";
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
    const normalized = env?.trim();
    if (normalized) map[normalized] = tier;
  };
  add(process.env.WHOP_PLAN_FIRST_MONTH_19, "first_month_19");
  add(process.env.WHOP_PLAN_FIRST_3MO_27, "first_3mo_27");
  add(process.env.WHOP_PLAN_PREMIUM_PASS, "premium_pass_guaranteed");
  add(process.env.WHOP_PLAN_NOTES_TRIAL, "notes_pro_trial");
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
  /** Whop MEMBER id (mber_…): the buyer's per-company member record. NOT the membership. */
  memberId: string | null;
  /** Whop MEMBERSHIP id (mem_…): the subscription. The stable key a renewal shares with its trial/first payment. */
  membershipId: string | null;
  /** The checkout configuration (ch_…) the membership was created from; round-trips on renewals. */
  checkoutConfigId: string | null;
  /** medpruef_user_id echoed on the embedded membership object (v2 envelopes), if present. */
  membershipMetaUserId: string | null;
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
  const membership = rec(d.membership);
  const membershipMeta = rec(membership.metadata);
  // A bare string `membership` (some envelopes) is the id itself.
  const membershipStr = typeof d.membership === "string" ? d.membership : null;
  const memberRaw = str(member.id) ?? str(d.member_id);

  return {
    paymentId: str(d.id) ?? str(d.payment_id) ?? str(d.receipt_id),
    planId: str(planObj.id) ?? str(d.plan_id) ?? str(d.plan) ?? str(d.access_pass),
    email:
      str(user.email) ?? str(d.email) ?? str(d.user_email) ?? str(member.email) ?? str(membership.email),
    // 2026-10-02: member.id is the mber_ record; older code stored it as the
    // membership id, so nothing membership-keyed ever matched. Keep only a
    // real mber_ here and read the membership separately.
    memberId: memberRaw && !memberRaw.startsWith("mem_") ? memberRaw : null,
    membershipId:
      str(membership.id) ??
      membershipStr ??
      str(d.membership_id) ??
      (memberRaw && memberRaw.startsWith("mem_") ? memberRaw : null),
    checkoutConfigId:
      str(d.checkout_configuration_id) ??
      str(membership.checkout_configuration_id) ??
      str(d.checkout_session_id),
    membershipMetaUserId:
      str(membershipMeta.medpruef_user_id) ?? str(membershipMeta.user_id),
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

// ── Revoke events (refund / chargeback / cancellation) ────────────
// B-08 revenue-leak fix: Pro access (and any referral reward) must be
// REVOKED when Whop reports the money was taken back or the membership
// went invalid. Event names are Whop's canonical taxonomy (docs:
// https://docs.whop.com/developer/guides/webhooks):
//   - `refund.created`         → a payment was refunded
//   - `dispute.created`        → a buyer opened a chargeback
//   - `membership.deactivated` → membership became invalid (failed
//                                payment, cancellation, or departure)
// Underscore variants are accepted defensively (some envelopes/api
// versions dot-vs-underscore). A refund/chargeback maps the subscription
// to 'refunded'; a deactivation/cancellation maps it to 'cancelled'.
export type WhopRevokeKind = "refunded" | "cancelled";

// refund/chargeback → money was reversed → subscriptions.status='refunded'
export const WHOP_REFUND_EVENTS = new Set([
  "refund.created",
  "refund_created",
  "refund.updated",
  "refund_updated",
  "dispute.created",
  "dispute_created",
  "dispute.updated",
  "dispute_updated",
  "dispute_alert.created",
  "payment.refunded",
  "payment_refunded",
  "payment.disputed",
  "payment_disputed",
]);

// membership invalid / cancellation → access lost → subscriptions.status='cancelled'
export const WHOP_CANCEL_EVENTS = new Set([
  "membership.deactivated",
  "membership_deactivated",
  "membership.went_invalid",
  "membership_went_invalid",
  "membership.cancelled",
  "membership_cancelled",
  "membership.canceled",
  "membership.expired",
  "membership_expired",
]);

/**
 * Classify a Whop event name into a revoke kind, or null if it is not a
 * revoke event. 'refunded' (money reversed) takes precedence over
 * 'cancelled' (access lost) if an event somehow appears in both sets.
 */
export function classifyWhopRevoke(event: string): WhopRevokeKind | null {
  if (WHOP_REFUND_EVENTS.has(event)) return "refunded";
  if (WHOP_CANCEL_EVENTS.has(event)) return "cancelled";
  return null;
}

export interface WhopRevokeFields {
  /** The payment id on a refund/dispute payload (joins subscriptions.provider_payment_id). */
  paymentId: string | null;
  /** The ORIGINAL/parent payment id if the refund carries it separately from its own id. */
  originalPaymentId: string | null;
  /** The membership id on a membership.* payload. */
  membershipId: string | null;
  /** Our echoed checkout metadata user id, if present. */
  metaUserId: string | null;
  /** Buyer email, best-effort fallback. */
  email: string | null;
  /** Checkout configuration (ch_…) if the payload carries it. */
  checkoutConfigId: string | null;
  /** A stable per-event id used to namespace the idempotency claim (so a
   * refund of pay_X never collides with the grant claim keyed on pay_X). */
  eventDedupeId: string | null;
}

// The refund/dispute/membership payload shapes are not fully documented and
// there is no live revoke delivery yet to confirm against, so — exactly like
// extractWhopPayment — read several plausible keys. Worst case a field is
// null and the handler Sentry-flags an unmatched revoke (never silently
// drops it, mirroring the grant path's loud-on-anomaly stance).
export function extractWhopRevoke(data: unknown): WhopRevokeFields {
  const d = rec(data);
  const user = rec(d.user);
  const membership = rec(d.membership);
  // `rec()` returns {} (truthy) for a missing key, so `a || b` never fell back.
  const member = d.member && typeof d.member === "object" ? rec(d.member) : membership;
  const metadata = rec(d.metadata);
  const payment = rec(d.payment);
  const receipt = rec(d.receipt);

  // The refund's OWN id (refund_/dispute_) vs the payment it reverses.
  const ownId =
    str(d.id) ?? str(d.refund_id) ?? str(d.dispute_id) ?? null;

  const paymentId =
    str(d.payment_id) ??
    str(payment.id) ??
    str(d.receipt_id) ??
    str(receipt.id) ??
    str(d.checkout_id) ??
    // On a refund payload `data.id` may itself be the payment id (pay_…).
    (typeof ownId === "string" && ownId.startsWith("pay_") ? ownId : null);

  const originalPaymentId =
    str(d.original_payment_id) ??
    str(d.parent_payment_id) ??
    str(payment.id) ??
    str(receipt.id) ??
    null;

  const membershipId =
    str(d.membership_id) ??
    str(membership.id) ??
    (typeof d.membership === "string" ? d.membership : null) ??
    (str(member.id)?.startsWith("mem_") ? str(member.id) : null) ??
    (typeof str(d.id) === "string" && (str(d.id) as string).startsWith("mem_")
      ? str(d.id)
      : null);

  return {
    paymentId,
    originalPaymentId,
    membershipId,
    metaUserId:
      str(metadata.medpruef_user_id) ??
      str(metadata.user_id) ??
      str(rec(membership.metadata).medpruef_user_id),
    email: str(user.email) ?? str(d.email) ?? str(d.user_email) ?? str(member.email),
    checkoutConfigId:
      str(d.checkout_configuration_id) ?? str(membership.checkout_configuration_id),
    // Prefer the event's own id (refund/dispute/membership id); fall back to
    // the payment id so repeated deliveries of the SAME revoke still dedupe.
    eventDedupeId: ownId ?? membershipId ?? paymentId,
  };
}

// ── Whop ledger pagination (2026-09-21 hardening, cursor fix 2026-10-14) ──
// The checkout-verify route used to read exactly ONE page of the memberships
// and payments ledgers. Whop's v1 list endpoints page by CURSOR: `first` (page
// size) + `after` (the previous response's page_info.end_cursor), with
// page_info.has_next_page and total_count in the envelope. They silently
// ignore `page` and `per` (verified read-only 2026-10-14: page=1 and page=2
// return identical rows), so the earlier page loop re-read the first page five
// times, reported a false truncation (Sentry JAVASCRIPT-NEXTJS-19) and fed
// duplicate rows to the email fallback. They also REJECT an explicit `order`
// (2026-09-21: order=created_at desc → 400), so we rely on the default
// newest-first ordering and check each page's oldest created_at defensively.
// Memberships filter by plan with `plan_ids=<id>`; `plan_id` is ignored.

const LEDGER_MAX_PAGES = 5;
const LEDGER_BUDGET_MS = 3_000;
const LEDGER_PAGE_SIZE = 100;

export interface WhopLedgerResult {
  rows: unknown[];
  /** true = more rows exist past the page cap or time budget; rows are PARTIAL. */
  truncated: boolean;
}

function ledgerCreatedAtMs(row: unknown): number | null {
  const d = rec(row);
  const raw = d.created_at ?? d.createdAt ?? null;
  const ms =
    typeof raw === "number"
      ? raw > 1e12
        ? raw
        : raw * 1000
      : typeof raw === "string"
        ? Date.parse(raw)
        : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** One entry per id, first occurrence kept (ledger rows can repeat). */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/** Whop membership-list filter for one plan (`plan_id` is ignored by v1). */
export function whopPlanQuery(planId: string): string {
  return `plan_ids=${encodeURIComponent(planId.trim())}`;
}

/**
 * Page through a Whop v1 list endpoint by cursor until:
 *   - the page is empty, or
 *   - `match` returns true for any row on the page (early stop, found it), or
 *   - the oldest row on the page is older than `cutoffMs` (payments: stop once
 *     we are past the 48h grant window), or
 *   - the response says there is no next page, or it says there is one but
 *     cannot move the scan forward (no new id, no or the same cursor) while
 *     total_count shows we already hold every row: the scan is complete, or
 *   - the 5-request cap / 3s budget is hit while a next page still exists, a
 *     next page exists but the cursor does not advance, or a full page comes
 *     without page_info → `truncated: true` (the caller must treat the result
 *     as partial, never as proof of absence).
 * Rows are deduplicated by id.
 */
function ledgerPartial(tag: string, why: string, rows: unknown[]): WhopLedgerResult {
  Sentry.captureMessage(`whop_ledger_truncated: ${tag} ${why} (rows=${rows.length})`, "warning");
  return { rows, truncated: true };
}

export async function paginateWhopLedger(args: {
  apiKey: string;
  /** e.g. "payments" | "memberships" */
  endpoint: string;
  /** query string WITHOUT first/after, e.g. `account_id=biz_x` (Whop renamed company_id for payments, Oct 2026) or `whopPlanQuery(plan)` */
  query: string;
  cutoffMs?: number | null;
  match?: (row: unknown) => boolean;
  tag: string;
}): Promise<WhopLedgerResult> {
  const startedAt = Date.now();
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let after: string | null = null;

  for (let request = 1; ; request++) {
    if (request > LEDGER_MAX_PAGES) {
      // A next page still exists after the cap; the scan is partial.
      Sentry.captureMessage(
        `whop_ledger_truncated: ${args.tag} hit the ${LEDGER_MAX_PAGES}-page cap (rows=${rows.length})`,
        "warning"
      );
      return { rows, truncated: true };
    }
    if (request > 1 && Date.now() - startedAt > LEDGER_BUDGET_MS) {
      Sentry.captureMessage(
        `whop_ledger_truncated: ${args.tag} hit the ${LEDGER_BUDGET_MS}ms budget at page ${request}`,
        "warning"
      );
      return { rows, truncated: true };
    }
    const cursor: string = after ? `&after=${encodeURIComponent(after)}` : "";
    const res = await fetch(
      `https://api.whop.com/api/v1/${args.endpoint}?${args.query}&first=${LEDGER_PAGE_SIZE}${cursor}`,
      { headers: { Authorization: `Bearer ${args.apiKey}`, Accept: "application/json" } }
    );
    const raw = await res.text();
    if (!res.ok) throw new Error(`Whop ${args.endpoint} HTTP ${res.status}: ${raw.slice(0, 200)}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Whop ${args.endpoint} page ${request}: non-JSON response`);
    }
    const pageRows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { data?: unknown[] }).data)
        ? ((parsed as { data: unknown[] }).data)
        : [];
    if (pageRows.length === 0) break;

    const pageInfo = Array.isArray(parsed) ? null : rec(parsed).page_info;
    const info = rec(pageInfo);
    const hasNext = info.has_next_page === true;
    const nextCursor = str(info.end_cursor);
    const totalRaw = Array.isArray(parsed) ? undefined : rec(parsed).total_count;
    const total = typeof totalRaw === "number" && Number.isFinite(totalRaw) ? totalRaw : null;

    let added = 0;
    for (const row of pageRows) {
      const id = str(rec(row).id);
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(row);
      added++;
    }
    if (args.match && pageRows.some(args.match)) break;

    if (args.cutoffMs != null) {
      const dates = pageRows
        .map(ledgerCreatedAtMs)
        .filter((ms): ms is number => ms !== null);
      if (dates.length > 0) {
        const oldest = Math.min(...dates);
        if (oldest < args.cutoffMs) break;
      }
    }

    if (pageInfo === null || pageInfo === undefined || typeof pageInfo !== "object") {
      // No cursor envelope: a short page is the whole list; a full page may
      // not be, so fail closed rather than call the scan complete.
      if (pageRows.length >= LEDGER_PAGE_SIZE) return ledgerPartial(args.tag, "no page_info on a full page", rows);
      break;
    }
    if (!hasNext) break;
    // Whop says more rows exist. Unless total_count proves we already hold
    // them all, a response that cannot move the scan forward (no new id, no
    // cursor, the same cursor again) leaves the scan partial.
    const complete = total !== null && rows.length >= total;
    if (added === 0 || !nextCursor || nextCursor === after) {
      if (complete) break;
      return ledgerPartial(args.tag, "the cursor did not advance", rows);
    }
    after = nextCursor;
  }
  return { rows, truncated: false };
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
    notes_pro_trial: process.env.WHOP_PLAN_NOTES_TRIAL,
  };
  // Environment values can acquire trailing whitespace when copied through a
  // dashboard or shell. Whop treats that as part of the plan ID and returns
  // 404, so normalize it at the boundary before the checkout route uses it.
  return map[tier]?.trim() || null;
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
  const planId = args.planId.trim();
  if (!planId) throw new Error("Whop plan ID is empty");
  const res = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      plan_id: planId,
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
  return { id: d.id, purchaseUrl: d.purchase_url, planId };
}
