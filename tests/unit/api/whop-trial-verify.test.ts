import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const USER = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  priorTrials: [] as unknown[],
  calls: [] as unknown[],
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

  it("refuses a second free window on an account that already used its trial", async () => {
    h.priorTrials = [{ id: "old", status: "expired", expires_at: "2026-09-01T00:00:00Z", whop_membership_id: "mem_OLD", provider_payment_id: "pay_old" }];
    const POST = await load();
    const res = await POST(req());
    const body = await res.json();
    expect(body.granted).toBe(false);
    expect(body.reason).toBe("trial_already_used");
    expect((h.calls as FakeCall[]).some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });
});
