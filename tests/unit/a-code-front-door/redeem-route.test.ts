import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  campaign: { ok: false, reason: "unknown_code" } as Record<string, unknown>,
  claim: { status: "not_found" } as Record<string, unknown>,
  events: [] as unknown[],
  campaignCalls: 0,
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "11111111-1111-4111-8111-111111111111" }) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));
vi.mock("@/lib/user-events", () => ({ recordEventSafe: async (_sb: unknown, a: unknown) => { state.events.push(a); return { ok: true }; } }));
vi.mock("@/lib/mentor/credits/campaign", () => ({ redeemCampaignCode: async () => { state.campaignCalls++; return state.campaign; } }));
vi.mock("@/lib/referral-claim", () => ({ claimReferralCode: async () => state.claim }));
vi.mock("@/lib/rate-limit", () => ({ callerIp: () => "1.1.1.1", rateKey: (a: string, b: string) => a + b, checkRateLimit: () => ({ allowed: true, retryAfterSec: 0 }) }));

const FLAGS = { CODE_AT_SIGNUP_ENABLED: "true", MENTOR_CAMPAIGN_CODES_ENABLED: "true" };
function req(body: unknown) {
  return new Request("http://x/api/code/redeem", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as never;
}
async function post(body: unknown, env: Record<string, string> = FLAGS) {
  for (const k of ["CODE_AT_SIGNUP_ENABLED", "MENTOR_CAMPAIGN_CODES_ENABLED"]) delete process.env[k];
  Object.assign(process.env, env);
  const { POST } = await import("@/app/api/code/redeem/route");
  const res = await POST(req(body));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => { state.campaign = { ok: false, reason: "unknown_code" }; state.claim = { status: "not_found" }; state.events = []; state.campaignCalls = 0; });

describe("POST /api/code/redeem", () => {
  it("is a 404 while the flag is off", async () => {
    expect((await post({ code: "TG-SPT" }, {})).status).toBe(404);
  });
  it("rejects a text that is no code", async () => {
    const r = await post({ code: "no way!" });
    expect(r.status).toBe(400);
    expect(r.json.reason).toBe("invalid_args");
  });
  it("redeems a campaign code and records its kind", async () => {
    state.campaign = { ok: true, duplicate: false, credits: 25, expiresAt: "2026-12-01T00:00:00Z", code: "TG-SPT" };
    const r = await post({ code: " tg spt-", source: "register" });
    expect(r.json).toMatchObject({ ok: true, kind: "campaign", credits: 25 });
    expect(state.events[0]).toMatchObject({ eventType: "code_redeemed", data: { kind: "campaign", code: "tg-spt", source: "register" } });
  });
  it("falls through to a referral code when the campaign is unknown", async () => {
    state.claim = { status: "ok", firstName: "Sam" };
    const r = await post({ code: "k4m9 x7qa", source: "home" });
    expect(r.json).toMatchObject({ ok: true, kind: "referral" });
    expect(JSON.stringify(r.json)).not.toContain("Sam");
    expect(state.events[0]).toMatchObject({ data: { kind: "referral", code: "k4m9x7qa", source: "home" } });
  });
  it("answers unknown, paused, ended and not-started alike", async () => {
    const a = await post({ code: "NOPE-CODE" }); // unknown campaign, unknown referral
    expect(a).toEqual({ status: 409, json: { ok: false, reason: "not_active" } });
    for (const reason of ["inactive", "expired", "not_started"]) {
      state.campaign = { ok: false, reason };
      expect(await post({ code: "NOPE-CODE" })).toEqual(a);
    }
    expect(state.events).toHaveLength(0);
  });
  it("with credit codes off it tries a referral code and never the campaign function", async () => {
    state.claim = { status: "ok" };
    const r = await post({ code: "K4M9X7QA" }, { CODE_AT_SIGNUP_ENABLED: "true" });
    expect(r.json.kind).toBe("referral");
    expect(state.campaignCalls).toBe(0);
    state.claim = { status: "not_found" };
    expect((await post({ code: "TG-SPT" }, { CODE_AT_SIGNUP_ENABLED: "true" })).json.reason).toBe("not_active");
  });
  it("names account and cap reasons, never the code's existence", async () => {
    state.campaign = { ok: false, reason: "already_redeemed" };
    expect((await post({ code: "TG-SPT" })).json.reason).toBe("already_used");
    // Reasons only an existing code can produce read as not_active.
    for (const reason of ["cap_reached", "daily_cap"]) {
      state.campaign = { ok: false, reason };
      expect((await post({ code: "TG-SPT" })).json.reason).toBe("not_active");
    }
    state.campaign = { ok: false, reason: "unknown_code" };
    state.claim = { status: "self" };
    expect((await post({ code: "K4M9X7QA" })).json.reason).toBe("own_code");
    state.claim = { status: "too_old" };
    expect((await post({ code: "K4M9X7QA" })).json.reason).toBe("account_too_old");
  });
  it("a fresh unverified account can still redeem a referral code; with no referral it hears the account reason", async () => {
    state.campaign = { ok: false, reason: "unverified" };
    state.claim = { status: "ok" };
    expect((await post({ code: "K4M9X7QA" })).json).toMatchObject({ ok: true, kind: "referral" });
    state.claim = { status: "not_found" };
    expect((await post({ code: "K4M9X7QA" })).json.reason).toBe("unverified");
    state.campaign = { ok: false, reason: "account_too_old" };
    expect((await post({ code: "K4M9X7QA" })).json.reason).toBe("account_too_old");
  });
  it("a database failure is a 503 with Retry-After semantics, no event", async () => {
    state.campaign = { ok: false, reason: "db_error" };
    const r = await post({ code: "TG-SPT" });
    expect(r.status).toBe(503);
    expect(r.json.reason).toBe("unavailable");
    expect(state.events).toHaveLength(0);
  });
});
