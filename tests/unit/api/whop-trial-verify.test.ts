import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const USER = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  priorTrials: [] as unknown[],
  calls: [] as unknown[],
  failUserWrite: false,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "22222222-2222-4222-8222-222222222222", role: "user", tier: "free", tierExpiresAt: null })),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "users" && c.op === "select") {
        // stale tier='pro' with an EXPIRED date must not short-circuit as granted
        return { data: { tier: "pro", tier_expires_at: "2026-01-01T00:00:00Z", email: "t@example.com" } };
      }
      if (c.table === "subscriptions" && c.op === "select") return { data: h.priorTrials };
      if (c.table === "users" && c.op === "update" && h.failUserWrite) return { error: { message: "write unavailable" } };
      if (c.table === "processed_webhook_events" && c.op === "insert") return { data: { event_id: "mem_NEW" } };
      return {};
    });
    h.calls = calls;
    return sb;
  },
}));

async function load() {
  process.env.NOTES_TRIAL_ENABLED = "true";
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";
  process.env.WHOP_API_KEY = "k";
  vi.resetModules();
  return (await import("@/app/api/whop/trial/verify/route")).POST;
}

beforeEach(() => {
  h.priorTrials = [];
  h.failUserWrite = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "mem_NEW",
              status: "trialing",
              plan: { id: "plan_trial" },
              metadata: { medpruef_user_id: USER },
              renewal_period_end: new Date(Date.now() + 7 * 86400_000).toISOString(),
            },
          ],
        }),
        { status: 200 }
      )
    )
  );
});
afterEach(() => vi.unstubAllGlobals());

const req = () => new NextRequest("https://x/api/whop/trial/verify", { method: "POST", headers: { "x-session-token": "t" } });

describe("/api/whop/trial/verify", () => {
  it("grants a first trial and stores the membership id as the renewal pin", async () => {
    const POST = await load();
    const res = await POST(req());
    expect((await res.json()).granted).toBe(true);
    const insert = (h.calls as FakeCall[]).find((c) => c.table === "subscriptions" && c.op === "insert");
    expect((insert!.payload as { whop_membership_id: string }).whop_membership_id).toBe("mem_NEW");
  });
  it("records the trial as zero-month provenance with its actual end", async () => {
    const POST = await load();
    await POST(req());
    const payload = (h.calls as FakeCall[]).find((c) => c.table === "subscriptions" && c.op === "insert")!.payload as {
      expires_at: string; started_at: string; granted_payment_ids: Array<Record<string, unknown>>;
    };
    expect(payload.granted_payment_ids).toEqual([{ payment_id: "mem_NEW", amount_cents: 0, added_months: 0,
      granted_at: payload.started_at, trial_ends_at: payload.expires_at }]);
  });

  it("refuses a second free window on an account that already used its trial", async () => {
    h.priorTrials = [{ id: "old", status: "expired", expires_at: "2026-09-01T00:00:00Z", whop_membership_id: "mem_OLD", provider_payment_id: "pay_old" }];
    const POST = await load();
    const res = await POST(req());
    const body = await res.json();
    expect(body.granted).toBe(false);
    expect(body.reason).toBe("trial_already_used");
    expect((h.calls as FakeCall[]).some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });
  it("keeps verification pending if the subscription writes but Pro access does not", async () => {
    h.failUserWrite = true;
    const POST = await load();
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(false);
    expect(body.reason).toBe("entitlement_pending");
    expect((h.calls as FakeCall[]).some(c => c.table === "processed_webhook_events" && c.op === "delete")).toBe(false);
  });

  it("reads the trial plan through the cursor ledger with plan_ids (JAVASCRIPT-NEXTJS-19)", async () => {
    const POST = await load();
    await POST(req());
    const fetchMock = fetch as unknown as { mock: { calls: unknown[][] } };
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v1/memberships");
    expect(url.searchParams.get("plan_ids")).toBe("plan_trial");
    expect(url.searchParams.get("first")).toBe("100");
    expect(url.searchParams.has("plan_id")).toBe(false);
    expect(url.searchParams.has("per")).toBe(false);
  });
});

describe("/api/whop/trial/verify: 3-day card trial (a-card-trial-build-1024)", () => {
  const membership = (over: Record<string, unknown> = {}) => vi.fn(async () => new Response(JSON.stringify({ data: [{
    id: "mem_FLEX", status: "trialing", plan: { id: "plan_flex" }, metadata: { medpruef_user_id: USER },
    renewal_period_end: new Date(Date.now() + 3 * 86400_000).toISOString(), ...over,
  }] }), { status: 200 }));
  async function loadFlex(cardOn = true) {
    process.env.NOTES_TRIAL_ENABLED = "false";
    process.env.CARD_TRIAL_ENABLED = cardOn ? "true" : "false";
    process.env.NEXT_PUBLIC_CARD_TRIAL = cardOn ? "true" : "";
    process.env.WHOP_PLAN_FLEX_TRIAL = "plan_flex";
    process.env.WHOP_API_KEY = "k";
    vi.resetModules();
    return (await import("@/app/api/whop/trial/verify/route")).POST;
  }
  afterEach(() => {
    delete process.env.CARD_TRIAL_ENABLED; delete process.env.NEXT_PUBLIC_CARD_TRIAL; delete process.env.WHOP_PLAN_FLEX_TRIAL;
  });
  const insert = () => (h.calls as FakeCall[]).find((c) => c.table === "subscriptions" && c.op === "insert")?.payload as
    { tier: string; expires_at: string; granted_payment_ids: Array<{ trial_ends_at: string }> } | undefined;

  it("grants Whop's trial end plus 1 day on the flex_month_trial tier", async () => {
    vi.stubGlobal("fetch", membership());
    const POST = await loadFlex();
    const before = Date.now();
    expect((await (await POST(req())).json()).granted).toBe(true);
    const row = insert()!;
    expect(row.tier).toBe("flex_month_trial");
    const ms = Date.parse(row.expires_at) - before;
    expect(ms).toBeGreaterThan(4 * 86400_000 - 5_000);
    expect(ms).toBeLessThan(4 * 86400_000 + 5_000);
    expect(row.granted_payment_ids[0].trial_ends_at).toBe(row.expires_at);
  });

  it("never grants more than the trial window, even when Whop reports a 30-day period", async () => {
    vi.stubGlobal("fetch", membership({ status: "active", renewal_period_end: new Date(Date.now() + 30 * 86400_000).toISOString() }));
    const POST = await loadFlex();
    const before = Date.now();
    await POST(req());
    expect(Date.parse(insert()!.expires_at) - before).toBeLessThan(4 * 86400_000 + 5_000);
  });

  it("grants nothing for a membership whose metadata names another account", async () => {
    vi.stubGlobal("fetch", membership({ metadata: { medpruef_user_id: "33333333-3333-4333-8333-333333333333" } }));
    const POST = await loadFlex();
    expect((await (await POST(req())).json()).reason).toBe("membership_not_found");
    expect(insert()).toBeUndefined();
  });

  it("refuses a second free window after any earlier card trial", async () => {
    h.priorTrials = [{ id: "old", status: "expired", expires_at: "2026-09-01T00:00:00Z", whop_membership_id: "mem_OLD", provider_payment_id: "pay_old" }];
    vi.stubGlobal("fetch", membership());
    const POST = await loadFlex();
    expect((await (await POST(req())).json()).reason).toBe("trial_already_used");
    const reuse = (h.calls as FakeCall[]).find((c) => c.table === "subscriptions" && c.op === "select" &&
      c.filters.some((f) => f.kind === "in" && f.column === "tier"));
    expect(reuse!.filters.find((f) => f.kind === "in" && f.column === "tier")?.value).toEqual(["notes_pro_trial", "flex_month_trial"]);
  });

  it("still finishes a started 3-day trial after a rollback (switch off, plan still set)", async () => {
    vi.stubGlobal("fetch", membership());
    const POST = await loadFlex(false);
    expect((await (await POST(req())).json()).granted).toBe(true);
    expect(insert()!.tier).toBe("flex_month_trial");
  });
});
