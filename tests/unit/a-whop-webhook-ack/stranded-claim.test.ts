/**
 * a-whop-webhook-ack (G3): a payment claim left by a run that died before its
 * grant is taken over by the next delivery after 10 minutes. Claims that were
 * granted, kept on purpose, resolved by an admin or are still young are left
 * alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { useWhopV1Secret, whopSigned } from "../helpers/whop-signed";

const h = vi.hoisted(() => ({ handler: (() => ({})) as (call: unknown) => unknown }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => true }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    (globalThis as { __claimCalls?: FakeCall[][] }).__claimCalls ??= [];
    (globalThis as { __claimCalls?: FakeCall[][] }).__claimCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { checkStrandedClaim, stampWhopClaimOutcome, WHOP_CLAIM_VERSION, WHOP_STALE_CLAIM_MS } from "@/lib/whop-stranded-claim";
import { getServiceClient } from "@/lib/supabase";

const LEARNER = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const PAY = "pay_redactedd2d60dc0";
const NOW = new Date("2026-10-16T12:00:00.000Z");

type Claim = { payload: Record<string, unknown>; processed_at: string };
let claims: Map<string, Claim>;
let owners: string[];
let granted: boolean;
let keptRow: boolean;
let whopPayment: { status: number; body?: Record<string, unknown> };
let resolution: "none" | "row" | "missing_table";
let subInserted: number;

function allCalls(): FakeCall[] {
  return ((globalThis as { __claimCalls?: FakeCall[][] }).__claimCalls ?? []).flat();
}

function handler(c: FakeCall): FakeResult | undefined {
  if (c.table === "processed_webhook_events") {
    const id = (eqVal(c, "event_id") as string | undefined) ?? (c.payload as { event_id?: string } | undefined)?.event_id;
    if (c.op === "insert") {
      const row = c.payload as { event_id: string; payload: Record<string, unknown> };
      if (claims.has(row.event_id)) return { error: { code: "23505", message: "duplicate key" } };
      claims.set(row.event_id, { payload: row.payload, processed_at: new Date().toISOString() });
      return { data: { event_id: row.event_id } };
    }
    if (c.op === "select") return { data: id && claims.has(id) ? claims.get(id) : null };
    if (c.op === "delete") {
      const at = eqVal(c, "processed_at");
      const cur = id ? claims.get(id) : undefined;
      if (!cur || (at !== undefined && cur.processed_at !== at)) return { data: [] };
      claims.delete(id!);
      return { data: [{ event_id: id }] };
    }
    if (c.op === "update") {
      const cur = id ? claims.get(id) : undefined;
      if (cur) claims.set(id!, { ...cur, payload: (c.payload as { payload: Record<string, unknown> }).payload });
      return { data: null };
    }
  }
  if (c.table === "subscriptions" && c.op === "select") {
    const filtersPayment = c.filters.some((f) => (f.column === "provider_payment_id") || f.column === "granted_payment_ids");
    if (filtersPayment) return { data: owners.map((user_id) => ({ user_id })) };
    return { data: [] };
  }
  if (c.table === "subscriptions" && c.op === "insert") {
    subInserted += 1;
    return { data: { id: "sub_new" } };
  }
  if (c.table === "payment_events" && c.op === "select") {
    if (eqVal(c, "event") === "grant_succeeded") return { data: granted ? [{ id: 1 }] : [] };
    if (eqVal(c, "event") === "grant_failed") return { data: keptRow ? [{ id: 2 }] : [] };
    return { data: [] };
  }
  if (c.table === "payment_resolutions") {
    if (resolution === "missing_table") return { error: { code: "PGRST205", message: "no table" } };
    return { data: resolution === "row" ? [{ payment_id: PAY }] : [] };
  }
  if (c.table === "users" && c.op === "select") {
    return { data: { id: LEARNER, email: "l@example.com", tier: "free", tier_expires_at: null, role: "user" } };
  }
  return {};
}

const V = WHOP_CLAIM_VERSION;
function stale(payload: Record<string, unknown> = { v: V, claimed_at: "x", event: "payment.succeeded" }) {
  claims.set(PAY, { payload, processed_at: new Date(Date.now() - WHOP_STALE_CLAIM_MS - 60_000).toISOString() });
}

beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_month";
  (globalThis as { __claimCalls?: FakeCall[][] }).__claimCalls = [];
  claims = new Map();
  owners = [];
  granted = false;
  keptRow = false;
  whopPayment = { status: 200, body: { id: PAY, status: "paid" } };
  process.env.WHOP_API_KEY = "test_key";
  resolution = "none";
  subInserted = 0;
  h.handler = handler as (call: unknown) => unknown;
  // Only the takeover's GET /v1/payments/{id} may reach Whop.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url) !== `https://api.whop.com/api/v1/payments/${PAY}`) throw new Error(`unexpected network call ${url}`);
    return new Response(JSON.stringify(whopPayment.body ?? {}), { status: whopPayment.status });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_PLAN_FIRST_MONTH_19;
  delete process.env.WHOP_API_KEY;
});

describe("checkStrandedClaim", () => {
  const sb = () => getServiceClient() as never;
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

  it("a payment some subscription row holds is settled", async () => {
    claims.set(PAY, { payload: {}, processed_at: at(WHOP_STALE_CLAIM_MS * 3) });
    owners = [LEARNER];
    expect(await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).toEqual({ kind: "settled" });
  });

  it("a payment with grant_succeeded is settled", async () => {
    claims.set(PAY, { payload: {}, processed_at: at(WHOP_STALE_CLAIM_MS * 3) });
    granted = true;
    expect((await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).kind).toBe("settled");
  });

  it("a claim kept on purpose (outcome recorded) is settled", async () => {
    claims.set(PAY, { payload: { outcome: "unmapped" }, processed_at: at(WHOP_STALE_CLAIM_MS * 3) });
    expect((await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).kind).toBe("settled");
  });

  it("an admin payment resolution keeps the claim", async () => {
    claims.set(PAY, { payload: {}, processed_at: at(WHOP_STALE_CLAIM_MS * 3) });
    resolution = "row";
    expect((await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).kind).toBe("settled");
  });

  it("a young unsettled claim asks Whop to retry", async () => {
    claims.set(PAY, { payload: { v: V }, processed_at: at(60_000) });
    expect(await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).toEqual({ kind: "retry", reason: "claim_in_flight" });
    expect(claims.get(PAY)!.processed_at).toBe(at(60_000));
  });

  it("a stale unsettled claim is replaced by compare-and-set (missing resolutions table reads as none)", async () => {
    resolution = "missing_table";
    const old = at(WHOP_STALE_CLAIM_MS + 1);
    claims.set(PAY, { payload: { v: V, event: "payment.succeeded" }, processed_at: old });
    const r = await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW });
    expect(r).toMatchObject({ kind: "taken_over", previousProcessedAt: old });
    expect(claims.get(PAY)!.payload).toMatchObject({ taken_over_from: old });
    const drop = allCalls().find((c) => c.table === "processed_webhook_events" && c.op === "delete")!;
    expect(eqVal(drop, "processed_at")).toBe(old);
  });

  it("a claim that changed between read and drop is left alone", async () => {
    const old = at(WHOP_STALE_CLAIM_MS + 1);
    claims.set(PAY, { payload: { v: V }, processed_at: old });
    const base = h.handler;
    h.handler = ((c: FakeCall) => {
      if (c.table === "processed_webhook_events" && c.op === "delete") return { data: [] };
      return (base as (x: FakeCall) => FakeResult | undefined)(c);
    }) as (call: unknown) => unknown;
    expect(await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).toEqual({ kind: "retry", reason: "claim_changed" });
  });

  it("any failed read answers retry, never a takeover", async () => {
    claims.set(PAY, { payload: {}, processed_at: at(WHOP_STALE_CLAIM_MS * 3) });
    h.handler = ((c: FakeCall) => (c.table === "payment_events" ? { error: { message: "timeout" } } : handler(c))) as (call: unknown) => unknown;
    expect((await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).kind).toBe("retry");
  });

  it("a claim written before this change (no version) is never taken over", async () => {
    claims.set(PAY, { payload: { claimed_at: "x", event: "payment.succeeded" }, processed_at: at(WHOP_STALE_CLAIM_MS * 30) });
    expect((await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).kind).toBe("settled");
  });

  it("a kept exit whose stamp failed is still settled by its grant_failed row", async () => {
    claims.set(PAY, { payload: { v: V }, processed_at: at(WHOP_STALE_CLAIM_MS * 3) });
    keptRow = true;
    expect((await checkStrandedClaim(sb(), { paymentId: PAY, event: "payment.succeeded", now: NOW })).kind).toBe("settled");
  });

  it("stampWhopClaimOutcome merges the outcome into the claim payload", async () => {
    claims.set(PAY, { payload: { v: V, claimed_at: "t", taken_over_from: "x" }, processed_at: at(0) });
    await stampWhopClaimOutcome(sb(), { paymentId: PAY, claimPayload: { v: V, claimed_at: "t", taken_over_from: "x" }, outcome: "unmapped" });
    expect(claims.get(PAY)!.payload).toMatchObject({ outcome: "unmapped", taken_over_from: "x", v: V });
    const up = allCalls().find((c) => c.table === "processed_webhook_events" && c.op === "update")!;
    expect(eqVal(up, "payload->>claimed_at")).toBe("t");
  });
});

describe("POST /api/webhooks/whop with a stranded claim", () => {
  const paid = {
    id: PAY,
    plan: { id: "plan_month" },
    membership: { id: "mem_STRAND1" },
    metadata: { medpruef_user_id: LEARNER, tier: "first_month_19" },
    user: { email: "l@example.com" },
    amount_after_fees: 17.72,
    currency: "eur",
  };
  const deliver = () => POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
    method: "POST", ...whopSigned(JSON.stringify({ type: "payment.succeeded", data: paid })),
  }));

  it("a redelivery after a dead run grants the payment once", async () => {
    stale();
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activated: true });
    expect(subInserted).toBe(1);
  });

  it("a redelivery while the first run may still be live answers 503 and grants nothing", async () => {
    claims.set(PAY, { payload: { v: V, event: "payment.succeeded" }, processed_at: new Date().toISOString() });
    const res = await deliver();
    expect(res.status).toBe(503);
    expect(subInserted).toBe(0);
  });

  it("a payment Whop now reports refunded is not granted, and the claim says so", async () => {
    stale();
    whopPayment = { status: 200, body: { id: PAY, status: "paid", refunded_amount: 19 } };
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activated: false, reason: "takeover_refused" });
    expect(subInserted).toBe(0);
    expect(claims.get(PAY)!.payload).toMatchObject({ outcome: "takeover_refused" });
  });

  it("a payment the key may not read is not granted (manual review), never retried in a loop", async () => {
    stale();
    whopPayment = { status: 403 };
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reason: "takeover_refused" });
    expect(subInserted).toBe(0);
  });

  it("Whop unavailable during the check: 503, the new claim stays without an outcome", async () => {
    stale();
    whopPayment = { status: 502 };
    const res = await deliver();
    expect(res.status).toBe(503);
    expect(subInserted).toBe(0);
    expect(claims.get(PAY)!.payload.outcome).toBeUndefined();
    expect(claims.get(PAY)!.payload.v).toBe(V);
  });

  it("no Whop API key: 503, never a permanent refusal", async () => {
    stale();
    delete process.env.WHOP_API_KEY;
    const res = await deliver();
    expect(res.status).toBe(503);
    expect(claims.get(PAY)!.payload.outcome).toBeUndefined();
  });

  it("a granted payment stays a plain duplicate", async () => {
    stale();
    owners = [LEARNER];
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(subInserted).toBe(0);
  });

  it("an unmapped payment stamps its outcome, so a later redelivery is a duplicate", async () => {
    const unmapped = { ...paid, metadata: null, membership: null, user: null };
    const send = () => POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST", ...whopSigned(JSON.stringify({ type: "payment.succeeded", data: unmapped })),
    }));
    expect((await send()).status).toBe(200);
    expect(claims.get(PAY)!.payload).toMatchObject({ outcome: "unmapped" });
    claims.set(PAY, { ...claims.get(PAY)!, processed_at: new Date(Date.now() - WHOP_STALE_CLAIM_MS * 2).toISOString() });
    const again = await send();
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
  });
});

describe("checkout verify's payment_events fallback", () => {
  it("releases only a claim stamped unmapped, or an old claim with no outcome (never a refused one)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(`${process.cwd()}/src/app/api/whop/checkout/verify/route.ts`, "utf8");
    const second = src.slice(src.indexOf("// Second pass: release the stale claim first"), src.indexOf('source: "checkout_verify_payment_events_fallback"'));
    expect(second).toContain("payload->>outcome.eq.unmapped,and(processed_at.lt.${new Date(Date.now() - WHOP_STALE_CLAIM_MS).toISOString()},payload->>outcome.is.null)");
    expect(second).not.toContain("releaseWhopClaim(");
  });
});
