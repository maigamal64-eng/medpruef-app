import { describe, expect, it, vi, beforeEach } from "vitest";

// a-release-int-5: the code front door sends a seed-seat code to the seat function
// while seats are ready (a-seed-seats seam named in a-code-front-door conflicts.md).
const state = vi.hoisted(() => ({
  kind: null as string | null,
  seat: { ok: false, reason: "unknown_code" } as Record<string, unknown>,
  campaignCalls: 0,
  seatCalls: 0,
  forgot: [] as string[],
  events: [] as unknown[],
}));

vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "11111111-1111-4111-8111-111111111111" }),
  forgetGuardUser: (id: string) => { state.forgot.push(id); },
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));
vi.mock("@/lib/user-events", () => ({ recordEventSafe: async (_sb: unknown, a: unknown) => { state.events.push(a); return { ok: true }; } }));
vi.mock("@/lib/mentor/credits/campaign", () => ({ redeemCampaignCode: async () => { state.campaignCalls++; return { ok: false, reason: "unknown_code" }; } }));
vi.mock("@/lib/referral-claim", () => ({ claimReferralCode: async () => ({ status: "not_found" }) }));
vi.mock("@/lib/seed-seats/server", () => ({
  readCodeKind: async () => state.kind,
  redeemSeatCode: async () => { state.seatCalls++; return state.seat; },
}));
vi.mock("@/lib/rate-limit", () => ({ callerIp: () => "1.1.1.1", rateKey: (a: string, b: string) => a + b, checkRateLimit: () => ({ allowed: true, retryAfterSec: 0 }) }));

const SEATS = {
  CODE_AT_SIGNUP_ENABLED: "true",
  SEED_SEATS_ENABLED: "true",
  AI_FEATURES_ENABLED: "true",
  MENTOR_ENABLED: "true",
  MENTOR_ACCESS_SCOPE: "paid",
};
const KEYS = [...Object.keys(SEATS), "MENTOR_CAMPAIGN_CODES_ENABLED"];
async function post(code: string, env: Record<string, string> = SEATS) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const { POST } = await import("@/app/api/code/redeem/route");
  const res = await POST(new Request("http://x/api/code/redeem", { method: "POST", body: JSON.stringify({ code, source: "register" }), headers: { "content-type": "application/json" } }) as never);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => { state.kind = null; state.seat = { ok: false, reason: "unknown_code" }; state.campaignCalls = 0; state.seatCalls = 0; state.forgot = []; state.events = []; });

describe("code front door: seed seats", () => {
  it("redeems a seat code through the seat function and records kind seat", async () => {
    state.kind = "seat";
    state.seat = { ok: true, duplicate: false, credits: 100, seatEndsAt: "2026-12-10T23:00:00Z", code: "WIEN-GRUPPE" };
    const r = await post("wien gruppe");
    expect(r.json).toMatchObject({ ok: true, kind: "seat", credits: 100, expires_at: "2026-12-10T23:00:00Z" });
    expect(state.campaignCalls).toBe(0);
    expect(state.forgot).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ eventType: "code_redeemed", data: { kind: "seat", code: "wien-gruppe" } });
  });
  it("code-level seat refusals read not_active like any code", async () => {
    state.kind = "seat";
    for (const reason of ["inactive", "expired", "not_started", "cap_reached", "daily_cap", "unknown_code"]) {
      state.seat = { ok: false, reason };
      expect(await post("WIEN-GRUPPE")).toEqual({ status: 409, json: { ok: false, reason: "not_active" } });
    }
  });
  it("keeps the seat account lines and makes unverified retryable", async () => {
    state.kind = "seat";
    for (const [reason, want] of [["paid_before", "paid_before"], ["already_pro", "already_pro"], ["identity_used", "identity_used"], ["unverified", "seat_unverified"], ["already_redeemed", "already_used"]]) {
      state.seat = { ok: false, reason };
      expect((await post("WIEN-GRUPPE")).json).toEqual({ ok: false, reason: want });
    }
    const { isRetryable } = await import("@/lib/code-entry/client");
    expect(isRetryable("seat_unverified")).toBe(true);
    expect(isRetryable("paid_before")).toBe(false);
  });
  it("a seat database fault is unavailable (503)", async () => {
    state.kind = "seat";
    state.seat = { ok: false, reason: "missing_function" };
    expect((await post("WIEN-GRUPPE")).status).toBe(503);
  });
  it("seats off: the seat function is never called", async () => {
    state.kind = "seat";
    const r = await post("WIEN-GRUPPE", { CODE_AT_SIGNUP_ENABLED: "true", MENTOR_CAMPAIGN_CODES_ENABLED: "true" });
    expect(state.seatCalls).toBe(0);
    expect(r.json).toEqual({ ok: false, reason: "not_active" });
  });
  it("a credits code with seats on goes to the campaign path", async () => {
    state.kind = "credits";
    await post("TG-SPT", { ...SEATS, MENTOR_CAMPAIGN_CODES_ENABLED: "true" });
    expect(state.seatCalls).toBe(0);
    expect(state.campaignCalls).toBe(1);
  });
});
