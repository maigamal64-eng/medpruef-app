/**
 * a-trial-decline-mail-1103 (harness copied from a-dunning-check):
 * decline-help mail for a declined card-trial start. Dry run: sendZohoEmail is a mock.
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
  logPaymentEvent: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: h.logPaymentEvent }));
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

import { suppressionKey } from "@/lib/mail-suppression";
import { POST } from "@/app/api/webhooks/whop/route";

const V1_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const V1_SECRET = `ws_${V1_HEX}`;
const LEARNER = "5ff431be-2e41-4589-81ce-6da35e69ab94";
const MEMBERSHIP = "mem_redacted0becd128";
const MEMBER = "mber_REPLAY0001";

const failedCharge = {
  id: "pay_redacted40c16d8d",
  status: "open",
  substatus: "failed",
  billing_reason: "subscription_create",
  plan: { id: "plan_trial" },
  membership: { id: MEMBERSHIP },
  member: { id: MEMBER },
  user: { email: "payer@example.com" },
  metadata: null,
  recovery_url: null,
  failure_message: "Your card was declined. Please use a different card or contact your bank.",
  total: 0,
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
let userLang = "de";

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
    if (c.op === "delete") { if (id) claims.delete(id); return { data: null }; }
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
  // a-intercom-into-n2n3-1021: the dunning mail reads the do-not-email list first.
  if (c.table === "mail_suppression" && c.op === "select") return { data: [] };
  if (c.table === "subscriptions" && c.op === "select") {
    return eqVal(c, "whop_membership_id") === MEMBERSHIP ? { data: [{ user_id: LEARNER }] } : { data: [] };
  }
  if (c.table === "users" && c.op === "select") {
    if (usersReadFails) return { error: { code: "57014", message: "canceling statement due to statement timeout" } };
    if (eqVal(c, "id") === LEARNER) {
      return { data: { id: LEARNER, email: "learner@example.com", first_name: "Anna", language_code: userLang, tier: "free" } };
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
  userLang = "de";
  delete process.env.DECLINE_HELP_MAIL_ENABLED;
  h.sendZohoEmail.mockReset();
  h.logPaymentEvent.mockReset();
  delete process.env.DUNNING_FIRST_HOLD_ENABLED;
  h.sendZohoEmail.mockResolvedValue({ ok: true, messageId: "m1" });
  // The pin resolves the buyer; any Whop API call would be a test bug.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network call"); }));
  h.handler = handler as (call: unknown) => unknown;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_WEBHOOK_SECRET_V1;
});

describe("a-trial-decline-mail-1103", () => {
  const on = () => { process.env.DECLINE_HELP_MAIL_ENABLED = "true"; };

  it("flag on, no recovery_url: one decline-help mail in DE, links /pricing, signed [name]", async () => {
    on();
    const res = await deliverV1("payment.failed", failedCharge);
    expect(res.status).toBe(200);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendZohoEmail.mock.calls[0][0] as { to: string; subject: string; htmlBody: string };
    expect(mail.to).toBe("learner@example.com");
    expect(mail.subject).toContain("Karte wurde abgelehnt");
    expect(mail.htmlBody).toContain("https://medpruf.com/pricing#pro-test");
    expect(mail.htmlBody).toContain("https://medpruf.com/pricing#plans");
    expect(mail.htmlBody).toContain("[name]");
    expect(mail.htmlBody).not.toMatch(/—|!|KI|bot/i);
    // a-trial-checkout-1104: two plain choices, the monthly price (EUR 24 every 30 days) last.
    expect(mail.htmlBody).toContain("24 € alle 30 Tage");
    expect(mail.htmlBody.indexOf("pricing#pro-test")).toBeLessThan(mail.htmlBody.indexOf("24 €"));
    expect(mail.htmlBody.indexOf("24 €")).toBeLessThan(mail.htmlBody.indexOf("Wenn ich helfen soll"));
    expect(dunningRows("whop_dunning_email")).toHaveLength(1);
    expect(dunningRows("whop_dunning_email")[0].payload).toMatchObject({ event_data: { link_kind: "decline_help" } });
  });

  it("EN learner gets the EN copy", async () => {
    on(); userLang = "en";
    await deliverV1("payment.failed", failedCharge);
    const mail = h.sendZohoEmail.mock.calls[0][0] as { subject: string };
    expect(mail.subject).toBe("Your MedPrüf trial: your card was declined");
  });

  it("idempotent within the day: a second failed payment of the same learner sends no second mail", async () => {
    on();
    await deliverV1("payment.failed", failedCharge);
    await deliverV1("payment.failed", { ...failedCharge, id: "pay_second0001" });
    await deliverV1("payment.failed", failedCharge);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    expect(dunningRows("whop_decline_help_skipped")).toHaveLength(1);
  });

  it("with a recovery_url the existing dunning mail is used", async () => {
    on();
    await deliverV1("payment.failed", { ...failedCharge, recovery_url: "https://whop.com/recover/abc" });
    const mail = h.sendZohoEmail.mock.calls[0][0] as { subject: string; htmlBody: string };
    expect(mail.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
    expect(mail.htmlBody).toContain("https://whop.com/recover/abc");
  });

  it("a renewal (subscription_cycle) keeps the existing dunning mail", async () => {
    on();
    await deliverV1("payment.failed", { ...failedCharge, billing_reason: "subscription_cycle" });
    const mail = h.sendZohoEmail.mock.calls[0][0] as { subject: string };
    expect(mail.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
  });

  it("a declined direct paid purchase (not the trial plan) never gets the trial copy", async () => {
    on();
    await deliverV1("payment.failed", { ...failedCharge, plan: { id: "plan_unknown_paid" } });
    const mail = h.sendZohoEmail.mock.calls[0][0] as { subject: string };
    expect(mail.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
  });

  it("flag off: the existing mail, never the decline-help copy", async () => {
    await deliverV1("payment.failed", failedCharge);
    const mail = h.sendZohoEmail.mock.calls[0][0] as { subject: string };
    expect(mail.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
  });

  it("a suppressed address gets nothing", async () => {
    on();
    const base = handler;
    h.handler = ((c: FakeCall) => c.table === "mail_suppression" && c.op === "select"
      ? { data: [{ id: "s1", email_key: suppressionKey("learner@example.com"), cause: "bounce", scope: "all", source: "test", created_at: new Date().toISOString() }] }
      : base(c)) as (call: unknown) => unknown;
    const res = await deliverV1("payment.failed", failedCharge);
    expect(res.status).toBe(200);
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
  });

  it("a certain non-send frees the day claim so a later payment can still mail", async () => {
    on();
    h.sendZohoEmail.mockResolvedValueOnce({ ok: false, reason: "auth_failed" });
    await deliverV1("payment.failed", failedCharge);
    await deliverV1("payment.failed", { ...failedCharge, id: "pay_second0001" });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(2);
  });
});

describe("a-trial-checkout-1104: decline release", () => {
  const releaseRows = () => h.logPaymentEvent.mock.calls.map((c) => c[1] as Record<string, unknown>).filter((r) => r.event === "checkout_failed");

  it("a declined card-trial start writes checkout_failed card_declined on the plan's card-trial tier (fixture plan_trial), even with the mail flag off", async () => {
    await deliverV1("payment.failed", failedCharge);
    const rows = releaseRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: LEARNER, reason: "card_declined", tier: "notes_pro_trial", paymentId: "pay_redacted40c16d8d" });
  });

  it("a redelivery of the same failed payment writes no second release row", async () => {
    await deliverV1("payment.failed", failedCharge);
    await deliverV1("payment.failed", failedCharge);
    expect(releaseRows()).toHaveLength(1);
  });

  it("a renewal decline, a decline with a recovery link and a non-trial plan write no release row", async () => {
    await deliverV1("payment.failed", { ...failedCharge, id: "pay_a", billing_reason: "subscription_cycle" });
    await deliverV1("payment.failed", { ...failedCharge, id: "pay_b", recovery_url: "https://whop.com/recover/abc" });
    await deliverV1("payment.failed", { ...failedCharge, id: "pay_c", plan: { id: "plan_unknown_paid" } });
    expect(releaseRows()).toHaveLength(0);
  });
});

describe("a-trial-checkout-1104: first-purchase hold", () => {
  const hold = () => { process.env.DUNNING_FIRST_HOLD_ENABLED = "true"; };
  const claimOf = (id: string) => claims.get(`recover:${id}`);

  it("flag on, first purchase: no mail now, claim held for 30 minutes, release row still written", async () => {
    hold(); process.env.DECLINE_HELP_MAIL_ENABLED = "true";
    const before = Date.now();
    const res = await deliverV1("payment.failed", failedCharge);
    expect(res.status).toBe(200);
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    const c = claimOf("pay_redacted40c16d8d")!;
    expect(c.mail).toBe("held");
    expect(c.held_kind).toBe("decline_help");
    expect(Date.parse(c.hold_until as string) - before).toBeGreaterThanOrEqual(30 * 60_000 - 5_000);
    expect(Date.parse(c.hold_until as string) - before).toBeLessThanOrEqual(30 * 60_000 + 5_000);
    expect(dunningRows("whop_dunning_email_held")).toHaveLength(1);
    expect(h.logPaymentEvent.mock.calls.some((c2) => (c2[1] as { reason?: string }).reason === "card_declined")).toBe(true);
  });

  it("flag on, a first charge on a paid plan (not the trial) is held as a plain dunning mail", async () => {
    hold();
    await deliverV1("payment.failed", { ...failedCharge, plan: { id: "plan_unknown_paid" } });
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    expect(claimOf("pay_redacted40c16d8d")!.held_kind).toBe("dunning");
  });

  it("flag on, a renewal keeps today's behaviour: mailed at once", async () => {
    hold();
    await deliverV1("payment.failed", { ...failedCharge, billing_reason: "subscription_cycle" });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    expect(claimOf("pay_redacted40c16d8d")!.mail).toBe("sent");
  });

  it("flag off: first purchase mails at once as before", async () => {
    await deliverV1("payment.failed", failedCharge);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("a redelivery of a held payment is a duplicate and sends nothing", async () => {
    hold();
    await deliverV1("payment.failed", failedCharge);
    await deliverV1("payment.failed", failedCharge);
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    expect(claimOf("pay_redacted40c16d8d")!.mail).toBe("held");
  });
});

