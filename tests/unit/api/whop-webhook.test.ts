import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (call: unknown) => unknown,
  sendZohoEmail: vi.fn(),
  calls: [] as unknown[],
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/referral-exam-reward", () => ({
  qualifyReferralOnActivity: vi.fn(),
  isReferralExamRewardEnabled: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    // share the call log across every getServiceClient() instance
    const orig = sb.from;
    sb.from = (t: string) => {
      const b = orig(t) as Record<string, unknown>;
      const then = b.then as (...a: unknown[]) => unknown;
      void then;
      return b;
    };
    h.calls = calls;
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls ??= [];
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";

const SECRET = "ws_test_secret";
const MEZOO = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const PAYER_EMAIL_OWNER = "3e814abc-3c3f-4ef3-b55a-9f03b63a5841";

function allCalls(): FakeCall[] {
  return ((globalThis as { __fakeCalls?: FakeCall[][] }).__fakeCalls ?? []).flat();
}

function deliver(action: string, data: unknown) {
  return POST(
    new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "webhook-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    })
  );
}

const renewal = {
  id: "pay_redactedfd51769b",
  billing_reason: "subscription_cycle",
  plan: { id: "plan_trial" },
  user: { email: "payer@example.com" },
  membership: { id: "mem_redacted24a53b8f" },
  member: { id: "mber_bs3QbHTs49VWM" },
  metadata: null,
  checkout_configuration_id: "ch_S0bPNhu0eGZIBvL",
  amount_after_fees: 17.92,
  currency: "eur",
};

let claimed: Set<string>;

function baseHandler(extra?: (c: FakeCall) => FakeResult | undefined) {
  return (c: FakeCall): FakeResult | undefined => {
    const x = extra?.(c);
    if (x) return x;
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      const id = (c.payload as { event_id: string }).event_id;
      if (claimed.has(id)) return { error: { code: "23505", message: "duplicate key" } };
      claimed.add(id);
      return { data: { event_id: id } };
    }
    if (c.table === "payment_events" && c.op === "select") {
      return eqVal(c, "checkout_session_id") === "ch_S0bPNhu0eGZIBvL"
        ? { data: [{ user_id: MEZOO }] }
        : { data: [] };
    }
    if (c.table === "users" && c.op === "select") {
      const id = eqVal(c, "id") as string | undefined;
      if (id === MEZOO) return { data: { id, email: "mezoo@example.com", first_name: "M", language_code: "de", tier: "pro", tier_expires_at: null } };
      if (id === PAYER_EMAIL_OWNER) return { data: { id } };
      if (c.filters.some((f) => f.kind === "ilike")) return { data: [{ id: PAYER_EMAIL_OWNER }] };
      return { data: null };
    }
    if (c.table === "subscriptions" && c.op === "select") return { data: [] };
    if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
    return {};
  };
}

beforeEach(() => {
  process.env.WHOP_WEBHOOK_SECRET = SECRET;
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";
  (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls = [];
  claimed = new Set();
  h.sendZohoEmail.mockReset();
  h.sendZohoEmail.mockResolvedValue({ ok: true });
  // The membership API is never needed when the checkout tie resolves; make
  // any call loud.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  h.handler = baseHandler() as (call: unknown) => unknown;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
});

describe("POST /api/webhooks/whop: renewal mapping (fix A)", () => {
  it("credits a renewal with metadata=null to the membership's subscriber, not the payer-email account", async () => {
    const res = await deliver("payment.succeeded", renewal);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activated).toBe(true);
    const subInsert = allCalls().find((c) => c.table === "subscriptions" && c.op === "insert");
    expect(subInsert).toBeTruthy();
    expect((subInsert!.payload as { user_id: string }).user_id).toBe(MEZOO);
    // the membership id (mem_), never the member id (mber_), is stored as the pin
    expect((subInsert!.payload as { whop_membership_id: string }).whop_membership_id).toBe("mem_redacted24a53b8f");
    const userUpdate = allCalls().find((c) => c.table === "users" && c.op === "update");
    expect(eqVal(userUpdate!, "id")).toBe(MEZOO);
    expect(allCalls().some((c) => c.table === "users" && c.op === "update" && eqVal(c, "id") === PAYER_EMAIL_OWNER)).toBe(false);
  });

  it("503s and releases the claim (no email guess) when the membership lookup is transiently down", async () => {
    process.env.WHOP_API_KEY = "test_app_key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const res = await deliver("payment.succeeded", { ...renewal, checkout_configuration_id: undefined });
    expect(res.status).toBe(503);
    expect(allCalls().some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(true);
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });
});

describe("POST /api/webhooks/whop: dunning (fix B)", () => {
  const failed = { ...renewal, id: "pay_FAIL1", status: "open", decline_code: "insufficient_funds", recovery_url: null };

  it("dedupes repeat deliveries of the same failed payment (one claim, one email)", async () => {
    const r1 = await deliver("payment.failed", failed);
    const r2 = await deliver("payment.failed", failed);
    const r3 = await deliver("payment.requires_action", failed);
    expect(r1.status).toBe(200);
    expect((await r2.json()).duplicate).toBe(true);
    expect((await r3.json()).duplicate).toBe(true);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });

  it("emails the SUBSCRIBER the Whop billing link when recovery_url is null, and records user_id on the claim", async () => {
    await deliver("payment.failed", failed);
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    const mail = h.sendZohoEmail.mock.calls[0][0] as { to: string; htmlBody: string };
    expect(mail.to).toBe("mezoo@example.com");
    expect(mail.htmlBody).toContain("https://whop.com/billing/manage/mber_bs3QbHTs49VWM");
    expect(mail.htmlBody).not.toContain("—");
    const claim = allCalls().find((c) => c.table === "processed_webhook_events" && c.op === "insert");
    expect((claim!.payload as { payload: { user_id: string } }).payload.user_id).toBe(MEZOO);
  });

  it("uses Whop's recovery_url when present", async () => {
    await deliver("payment.failed", { ...failed, id: "pay_FAIL2", recovery_url: "https://whop.com/recover/abc" });
    const mail = h.sendZohoEmail.mock.calls[0][0] as { htmlBody: string };
    expect(mail.htmlBody).toContain("https://whop.com/recover/abc");
  });
});

describe("POST /api/webhooks/whop: dunning grace is per-user (fix B)", () => {
  it("filters the recover:% grace lookup by the revoked user's id", async () => {
    h.handler = baseHandler((c) => {
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "whop_membership_id") === "mem_GONE") {
        return {
          data: [
            {
              id: "sub_1", user_id: MEZOO, tier: "first_month_19", status: "active",
              expires_at: new Date(Date.now() + 86400_000).toISOString(), amount_cents: 1900,
              started_at: new Date().toISOString(), provider_payment_id: "pay_x", granted_payment_ids: [],
              whop_membership_id: "mem_GONE",
            },
          ],
        };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const res = await deliver("membership.deactivated", { id: "mem_GONE" });
    expect(res.status).toBe(200);
    const grace = allCalls().find(
      (c) => c.table === "processed_webhook_events" && c.op === "select" && c.filters.some((f) => f.kind === "like")
    );
    expect(grace).toBeTruthy();
    expect(eqVal(grace!, "payload->>user_id")).toBe(MEZOO);
  });
});

describe("POST /api/webhooks/whop: trial reuse", () => {
  it("refuses a second free window on an account that already trialed", async () => {
    h.handler = baseHandler((c) => {
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "notes_pro_trial" && eqVal(c, "status") === "active") {
        return { data: [] };
      }
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "notes_pro_trial") {
        return { data: [{ id: "old_trial", status: "expired" }] };
      }
      return undefined;
    }) as (call: unknown) => unknown;
    const res = await deliver("payment.succeeded", {
      ...renewal,
      id: "pay_TRIAL0",
      billing_reason: "subscription_create",
      amount_after_fees: 0,
      metadata: { medpruef_user_id: MEZOO, tier: "notes_pro_trial" },
    });
    const body = await res.json();
    expect(body.reason).toBe("trial_already_used");
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });
});

describe("POST /api/webhooks/whop: auth", () => {
  it("rejects an unsigned delivery with 401", async () => {
    const res = await POST(
      new NextRequest("https://medpruf.com/api/webhooks/whop", { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/webhooks/whop: review fixes", () => {
  it("never revokes the payer-email account for a membership event resolved by email only", async () => {
    process.env.WHOP_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const res = await deliver("membership.deactivated", { id: "mem_UNKNOWN", user: { email: "payer@example.com" } });
    const body = await res.json();
    expect(body.error).toBe("revoke matched no subscription");
    expect(allCalls().some((c) => c.table === "users" && c.op === "update")).toBe(false);
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "update")).toBe(false);
  });

  it("does not guess on a notes_pro_trial payment with no readable amount", async () => {
    const res = await deliver("payment.succeeded", {
      id: "pay_NOAMT",
      membership: { id: "mem_redacted24a53b8f" },
      checkout_configuration_id: "ch_S0bPNhu0eGZIBvL",
      metadata: { tier: "notes_pro_trial" },
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(allCalls().some((c) => c.table === "subscriptions" && (c.op === "insert" || c.op === "update"))).toBe(false);
  });
});
