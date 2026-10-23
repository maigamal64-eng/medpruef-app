import { describe, expect, it, vi, beforeEach } from "vitest";

// a-n3-head-1022, decision partner-code-account-age-1022: a partner code (PARTNER_CODES) redeems only on an
// account at most 7 days old, for both code kinds, while PARTNER_KIT_ENABLED is on.
const state = vi.hoisted(() => ({
  kind: null as string | null,
  campaignAges: [] as number[],
  seatAges: [] as (number | undefined)[],
}));

vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "11111111-1111-4111-8111-111111111111" }),
  forgetGuardUser: () => {},
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));
vi.mock("@/lib/user-events", () => ({ recordEventSafe: async () => ({ ok: true }) }));
vi.mock("@/lib/mentor/credits/campaign", () => ({
  redeemCampaignCode: async (_sb: unknown, _u: string, _c: unknown, _v: unknown, age: number) => { state.campaignAges.push(age); return { ok: false, reason: "account_too_old" }; },
}));
vi.mock("@/lib/referral-claim", () => ({ claimReferralCode: async () => ({ status: "not_found" }) }));
vi.mock("@/lib/seed-seats/server", () => ({
  readCodeKind: async () => state.kind,
  redeemSeatCode: async (_sb: unknown, _u: string, _c: unknown, _v: unknown, age?: number) => { state.seatAges.push(age); return { ok: false, reason: "account_too_old" }; },
}));
vi.mock("@/lib/rate-limit", () => ({ callerIp: () => "1.1.1.1", rateKey: (a: string, b: string) => a + b, checkRateLimit: () => ({ allowed: true, retryAfterSec: 0 }) }));

import { PARTNER_MAX_ACCOUNT_AGE_DAYS, partnerAccountMaxAgeDays } from "@/lib/partner-kit";

const BASE = {
  CODE_AT_SIGNUP_ENABLED: "true",
  SEED_SEATS_ENABLED: "true",
  AI_FEATURES_ENABLED: "true",
  MENTOR_ENABLED: "true",
  MENTOR_ACCESS_SCOPE: "paid",
  MENTOR_CAMPAIGN_CODES_ENABLED: "true",
  PARTNER_CODES: "OEH-WIEN, ARZT-GRUPPE",
};
const KEYS = [...Object.keys(BASE), "PARTNER_KIT_ENABLED"];
function setEnv(env: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}
async function postFrontDoor(code: string) {
  const { POST } = await import("@/app/api/code/redeem/route");
  return POST(new Request("http://x/api/code/redeem", { method: "POST", body: JSON.stringify({ code, source: "register" }), headers: { "content-type": "application/json" } }) as never);
}
async function postMentor(code: string) {
  const { POST } = await import("@/app/api/mentor/campaign/redeem/route");
  const res = await POST(new Request("http://x/api/mentor/campaign/redeem", { method: "POST", body: JSON.stringify({ code, via: "settings" }), headers: { "content-type": "application/json" } }) as never);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => { state.kind = null; state.campaignAges = []; state.seatAges = []; });

describe("partnerAccountMaxAgeDays", () => {
  const on = { PARTNER_KIT_ENABLED: "true", PARTNER_CODES: "OEH-WIEN" };
  it("caps a partner code at 7 days for both kinds while the partner kit is on", () => {
    expect(PARTNER_MAX_ACCOUNT_AGE_DAYS).toBe(7);
    expect(partnerAccountMaxAgeDays("oeh-wien", 14, on)).toBe(7);
    expect(partnerAccountMaxAgeDays("OEH-WIEN", 7, on)).toBe(7);
    expect(partnerAccountMaxAgeDays("OEH-WIEN", 3, on)).toBe(3);
  });
  it("leaves other codes and the flag-off state unchanged", () => {
    expect(partnerAccountMaxAgeDays("OTHER-CODE", 14, on)).toBe(14);
    expect(partnerAccountMaxAgeDays("OEH-WIEN", 14, { PARTNER_CODES: "OEH-WIEN" })).toBe(14);
    expect(partnerAccountMaxAgeDays("OEH-WIEN", 14, { PARTNER_KIT_ENABLED: "1", PARTNER_CODES: "OEH-WIEN" })).toBe(14);
    expect(partnerAccountMaxAgeDays(null, 14, on)).toBe(14);
  });
});

describe("redeem routes pass the partner age limit", () => {
  it("front door: a partner seat code redeems with 7 days, a plain seat code with 14", async () => {
    setEnv({ ...BASE, PARTNER_KIT_ENABLED: "true" });
    state.kind = "seat";
    await postFrontDoor("oeh wien");
    await postFrontDoor("PLAIN-SEAT");
    expect(state.seatAges).toEqual([7, 14]);
  });
  it("front door: partner flag off keeps the seat limit at 14", async () => {
    setEnv(BASE);
    state.kind = "seat";
    await postFrontDoor("OEH-WIEN");
    expect(state.seatAges).toEqual([14]);
  });
  it("front door: a partner credits code redeems with at most 7 days", async () => {
    setEnv({ ...BASE, PARTNER_KIT_ENABLED: "true" });
    state.kind = "credits";
    await postFrontDoor("ARZT-GRUPPE");
    expect(state.campaignAges).toEqual([7]);
  });
  it("Settings route: a partner seat code gets 7 days and the refusal names 7", async () => {
    setEnv({ ...BASE, PARTNER_KIT_ENABLED: "true" });
    state.kind = "seat";
    const r = await postMentor("OEH-WIEN");
    expect(state.seatAges).toEqual([7]);
    expect(r).toEqual({ status: 409, json: { ok: false, reason: "account_too_old", max_age_days: 7 } });
  });
  it("Settings route: a partner credits code gets at most 7 days", async () => {
    setEnv({ ...BASE, PARTNER_KIT_ENABLED: "true" });
    state.kind = "credits";
    await postMentor("ARZT-GRUPPE");
    expect(state.campaignAges).toEqual([7]);
  });
});
