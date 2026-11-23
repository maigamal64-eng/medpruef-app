import { describe, it, expect } from "vitest";
import { countsTowardAllowance, decideAccess, type AccessInput, type SimProfile } from "@/lib/sim";
import { KP_SIM_PROFILE } from "@/lib/de-kp/sim/profile";

const base: AccessInput = { profile: KP_SIM_PROFILE, account: "free", caseIsFree: true, mode: "full_exam", aiAvailable: true, freeCaseAiFullSimulationsUsed: 0, aiFullSimulationsInWindow: 0 };
const d = (o: Partial<AccessInput>) => decideAccess({ ...base, ...o });

describe("free account ([name]-ANSWERS-1116: the free case once as a full simulation with AI, then self-marked)", () => {
  it("gets one AI full simulation on the free case", () => {
    expect(d({})).toEqual({ access: "open", marking: "ai", reason: "free_case_first_full" });
    expect(countsTowardAllowance(d({}), "full_exam")).toBe(true);
  });
  it("S10 acceptance: after using it, the next one is self-marked", () => {
    expect(d({ freeCaseAiFullSimulationsUsed: 1 })).toEqual({ access: "open", marking: "self", reason: "free_case_used" });
  });
  it("practice parts on the free case are self-marked", () => {
    expect(d({ mode: "practice_part" })).toEqual({ access: "open", marking: "self", reason: "free_practice" });
    expect(countsTowardAllowance(d({ mode: "practice_part" }), "practice_part")).toBe(false);
  });
  it("a case that is not free stays locked", () => {
    expect(d({ caseIsFree: false })).toEqual({ access: "locked" });
    expect(d({ caseIsFree: false, aiAvailable: false })).toEqual({ access: "locked" });
  });
});

describe("paid account (included in every Pro plan, fair use 20 a month)", () => {
  const paid = (o: Partial<AccessInput>) => d({ account: "paid", caseIsFree: false, ...o });
  it("runs AI full simulations up to 20 in the window, then self-marked", () => {
    expect(paid({ aiFullSimulationsInWindow: 19 })).toMatchObject({ marking: "ai", reason: "paid_full" });
    expect(paid({ aiFullSimulationsInWindow: 20 })).toMatchObject({ marking: "self", reason: "fair_use_reached" });
  });
  it("practice parts are unlimited and never count", () => {
    const r = paid({ mode: "practice_part", aiFullSimulationsInWindow: 500 });
    expect(r).toMatchObject({ marking: "ai", reason: "paid_practice" });
    expect(countsTowardAllowance(r, "practice_part")).toBe(false);
  });
  it("the free case does not use up a paid learner's free-case allowance", () => {
    expect(paid({ caseIsFree: true, freeCaseAiFullSimulationsUsed: 1 })).toMatchObject({ marking: "ai", reason: "paid_full" });
  });
});

describe("AI unavailable (kill switch, spend cap D-3, outage) never blocks a session", () => {
  it("falls back to self-marking for everyone with access", () => {
    expect(d({ aiAvailable: false })).toEqual({ access: "open", marking: "self", reason: "ai_unavailable" });
    expect(d({ account: "paid", aiAvailable: false })).toEqual({ access: "open", marking: "self", reason: "ai_unavailable" });
  });
  it("a profile without AI parts is self-marked", () => {
    const selfOnly: SimProfile = { ...KP_SIM_PROFILE, parts: KP_SIM_PROFILE.parts.map((p) => (p.marking === "ai" ? { ...p, marking: "self" as const } : p)) };
    expect(d({ profile: selfOnly })).toMatchObject({ marking: "self", reason: "profile_self_only" });
  });
});
