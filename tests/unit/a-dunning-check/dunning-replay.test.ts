/**
 * a-dunning-check: replay of a failed renewal charge through the live v1
 * (Standard Webhooks, svix-signed) Whop hook. Dry run: sendZohoEmail is a
 * mock, nothing is sent.
 *
 * The fixture is the sanitized shape of pay_5iKl (23 Sep 2026, retried by
 * Whop until 27 Sep, four deliveries): status open, substatus failed,
 * billing_reason subscription_cycle, metadata null and recovery_url null.
 * The 20 Sep handler mailed only when recovery_url was set, so none of
 * those deliveries produced a dunning mail.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (call: unknown) => unknown,
  sendZohoEmail: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    (globalThis as { __dunCalls?: FakeCall[][] }).__dunCalls ??= [];
    (globalThis as { __dunCalls?: FakeCall[][] }).__dunCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { classifyDunningSend } from "@/lib/whop-dunning-claim";

const V1_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const V1_SECRET = `ws_${V1_HEX}`;
const LEARNER = "5ff431be-2e41-4589-81ce-6da35e69ab94";
const MEMBERSHIP = "mem_redacted0becd128";
const MEMBER = "mber_REPLAY0001";

const failedCharge = {
  id: "pay_redacted40c16d8d",
  status: "open",
  substatus: "failed",
  billing_reason: "subscription_cycle",
  plan: { id: "plan_trial" },
  membership: { id: MEMBERSHIP },
  member: { id: MEMBER },
  user: { email: "payer@example.com" },
  metadata: null,
  recovery_url: null,
  failure_message: "Your card was declined. Please use a different card or contact your bank.",
  total: 19,
  currency: "eur",
};

function allCalls(): FakeCall[] {
  return ((globalThis as { __dunCalls?: FakeCall[][] }).__dunCalls ?? []).flat();
}

let deliveryNo = 0;
/** One signed v1 delivery; every redelivery gets its own webhook-id like Whop's. */
function deliverV1(type: string, data: unknown) {
  deliveryNo += 1;
  const id = `msg_replay_${deliveryNo}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ id, api_version: "v1", type, timestamp: new Date().toISOString(), data });
  const sig = crypto.createHmac("sha256", Buffer.from(V1_HEX, "hex")).update(`${id}.${ts}.${body}`).digest("base64");
  return POST(
    new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
      body,
    })
  );
}

/** In-memory processed_webhook_events with the compare-and-set the claim uses. */
let claims: Map<string, Record<string, unknown>>;
let usersReadFails: boolean;

function payloadFilter(c: FakeCall): unknown {
  return c.filters.find((f) => f.kind === "eq" && f.column === "payload->>mail")?.value;
}

function handler(c: FakeCall): FakeResult | undefined {
  if (c.table === "processed_webhook_events") {
    const id = (eqVal(c, "event_id") as string | undefined) ?? (c.payload as { event_id?: string } | undefined)?.event_id;
    if (c.op === "insert") {
      const row = c.payload as { event_id: string; payload: Record<string, unknown> };
      if (claims.has(row.event_id)) return { error: { code: "23505", message: "duplicate key" } };
      claims.set(row.event_id, { ...row.payload });
      return { data: { event_id: row.event_id } };
    }
    if (c.op === "select") {
      if (c.filters.some((f) => f.kind === "like")) return { data: [] };
      return { data: id && claims.has(id) ? { payload: claims.get(id) } : null };
    }
    if (c.op === "update") {
      const want = payloadFilter(c);
      const cur = id ? claims.get(id) : undefined;
      if (!cur || (want !== undefined && cur.mail !== want)) return { data: [] };
      claims.set(id!, { ...(c.payload as { payload: Record<string, unknown> }).payload });
      return { data: [{ event_id: id }] };
    }
  }
  if (c.table === "subscriptions" && c.op === "select") {
    return eqVal(c, "whop_membership_id") === MEMBERSHIP ? { data: [{ user_id: LEARNER }] } : { data: [] };
  }
  if (c.table === "users" && c.op === "select") {
    if (usersReadFails) return { error: { code: "57014", message: "canceling statement due to statement timeout" } };
    if (eqVal(c, "id") === LEARNER) {
      return { data: { id: LEARNER, email: "learner@example.com", first_name: "Anna", language_code: "de" } };
    }
    return { data: null };
  }
  return {};
}

function dunningRows(type: string): FakeCall[] {
  return allCalls().filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type: string }).event_type === type);
}

beforeEach(() => {
  delete process.env.WHOP_WEBHOOK_SECRET;
  process.env.WHOP_WEBHOOK_SECRET_V1 = V1_SECRET;
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";
  (globalThis as { __dunCalls?: FakeCall[][] }).__dunCalls = [];
  claims = new Map();
  usersReadFails = false;
  h.sendZohoEmail.mockReset();
  h.sendZohoEmail.mockResolvedValue({ ok: true, messageId: "m1" });
  // The pin resolves the buyer; any Whop API call would be a test bug.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network call"); }));
  h.handler = handler as (call: unknown) => unknown;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_WEBHOOK_SECRET_V1;
});

describe("a-dunning-check replay: failed renewal charge, v1 hook (dry run)", () => {
  it("four deliveries of one failed payment send exactly one dunning mail to the pinned learner", async () => {
    for (let i = 0; i < 4; i += 1) {
      const res = await deliverV1("payment.failed", failedCharge);
      expect(res.status).toBe(200);
    }
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendZohoEmail.mock.calls[0][0] as { to: string; subject: string; htmlBody: string };
    expect(mail.to).toBe("learner@example.com");
    expect(mail.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
    // recovery_url is null on a decline: the mail links the member's Whop billing page.
    expect(mail.htmlBody).toContain(`https://whop.com/billing/manage/${MEMBER}`);
    expect(dunningRows("whop_dunning_email")).toHaveLength(1);
    expect(dunningRows("whop_dunning_email_failed")).toHaveLength(0);
    expect(dunningRows("whop_payment_recovery_needed")).toHaveLength(1);
    const claim = claims.get(`recover:${failedCharge.id}`)!;
    expect(claim).toMatchObject({ user_id: LEARNER, membership_id: MEMBERSHIP, mail: "sent" });
  });

  it("a mail that certainly did not go out is retried once on Whop's next delivery of the payment, then never again", async () => {
    h.sendZohoEmail.mockResolvedValueOnce({ ok: false, reason: "auth_failed" });
    const first = await deliverV1("payment.failed", failedCharge);
    // a-whop-webhook-ack: the mail runs after the 2xx; the claim records the
    // outcome and Whop's next payment.failed delivery (its charge retry)
    // retries a certain non-send once.
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ mail: "queued" });
    expect(claims.get(`recover:${failedCharge.id}`)).toMatchObject({ mail: "not_sent", mail_reason: "auth_failed" });
    expect(dunningRows("whop_dunning_email_failed")).toHaveLength(1);
    expect(dunningRows("whop_dunning_email")).toHaveLength(0);

    const second = await deliverV1("payment.failed", failedCharge);
    expect(second.status).toBe(200);
    const third = await deliverV1("payment.failed", failedCharge);
    expect(third.status).toBe(200);
    expect(await third.json()).toMatchObject({ duplicate: true });

    expect(h.sendZohoEmail).toHaveBeenCalledTimes(2);
    expect(dunningRows("whop_dunning_email")).toHaveLength(1);
    expect(claims.get(`recover:${failedCharge.id}`)).toMatchObject({ mail: "sent", mail_attempts: 2 });
    // telemetry stays once per failed payment
    expect(dunningRows("whop_payment_recovery_needed")).toHaveLength(1);
  });

  it("a second certain failure is final: one retry at most", async () => {
    h.sendZohoEmail.mockResolvedValue({ ok: false, reason: "not_configured" });
    expect((await deliverV1("payment.failed", failedCharge)).status).toBe(200);
    expect((await deliverV1("payment.failed", failedCharge)).status).toBe(200);
    const third = await deliverV1("payment.failed", failedCharge);
    expect(third.status).toBe(200);
    expect(await third.json()).toMatchObject({ duplicate: true });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(2);
    expect(claims.get(`recover:${failedCharge.id}`)).toMatchObject({ mail: "not_sent", mail_attempts: 2 });
  });

  it("never retries once the same payment has succeeded (the learner fixed the card)", async () => {
    h.sendZohoEmail.mockResolvedValueOnce({ ok: false, reason: "auth_failed" });
    expect((await deliverV1("payment.failed", failedCharge)).status).toBe(200);
    // payment.succeeded for the same payment id writes its grant claim.
    claims.set(failedCharge.id, { claimed_at: new Date().toISOString(), event: "payment.succeeded" });
    const retry = await deliverV1("payment.failed", failedCharge);
    expect(await retry.json()).toMatchObject({ duplicate: true });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("never retries a claim older than 24 hours", async () => {
    h.sendZohoEmail.mockResolvedValueOnce({ ok: false, reason: "auth_failed" });
    expect((await deliverV1("payment.failed", failedCharge)).status).toBe(200);
    const key = `recover:${failedCharge.id}`;
    claims.set(key, { ...claims.get(key)!, claimed_at: new Date(Date.now() - 25 * 3600_000).toISOString() });
    const retry = await deliverV1("payment.failed", failedCharge);
    expect(await retry.json()).toMatchObject({ duplicate: true });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("two redeliveries racing after a certain failure send one mail", async () => {
    h.sendZohoEmail.mockResolvedValueOnce({ ok: false, reason: "auth_failed" });
    expect((await deliverV1("payment.failed", failedCharge)).status).toBe(200);
    const [a, b] = await Promise.all([deliverV1("payment.failed", failedCharge), deliverV1("payment.failed", failedCharge)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(2);
    expect(dunningRows("whop_dunning_email")).toHaveLength(1);
  });

  it("an ambiguous send (timeout or Zoho 5xx) is never re-sent", async () => {
    h.sendZohoEmail.mockResolvedValueOnce({ ok: false, reason: "send_failed", details: "mail_transport_error" });
    const first = await deliverV1("payment.failed", failedCharge);
    expect(first.status).toBe(200);
    expect(claims.get(`recover:${failedCharge.id}`)).toMatchObject({ mail: "unknown" });
    const second = await deliverV1("payment.failed", failedCharge);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    expect(dunningRows("whop_dunning_email")).toHaveLength(0);
  });

  it("a failed recipient read answers 503 without taking the claim; the redelivery mails once", async () => {
    usersReadFails = true;
    const first = await deliverV1("payment.failed", failedCharge);
    expect(first.status).toBe(503);
    expect(claims.size).toBe(0);
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    usersReadFails = false;
    const second = await deliverV1("payment.failed", failedCharge);
    expect(second.status).toBe(200);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("payment.requires_action with Whop's recovery_url links that url", async () => {
    const res = await deliverV1("payment.requires_action", { ...failedCharge, id: "pay_redacted92e278bf", recovery_url: "https://whop.com/recover/abc" });
    expect(res.status).toBe(200);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    expect((h.sendZohoEmail.mock.calls[0][0] as { htmlBody: string }).htmlBody).toContain("https://whop.com/recover/abc");
  });
});

describe("classifyDunningSend", () => {
  it("retries only certain non-sends", () => {
    expect(classifyDunningSend({ ok: true })).toBe("sent");
    expect(classifyDunningSend({ ok: false, reason: "not_configured" })).toBe("not_sent");
    expect(classifyDunningSend({ ok: false, reason: "auth_failed" })).toBe("not_sent");
    expect(classifyDunningSend({ ok: false, reason: "send_failed", status: 400 })).toBe("not_sent");
    expect(classifyDunningSend({ ok: false, reason: "send_failed", status: 502 })).toBe("unknown");
    expect(classifyDunningSend({ ok: false, reason: "send_failed", details: "mail_transport_error" })).toBe("unknown");
    expect(classifyDunningSend(null)).toBe("unknown");
  });
});
