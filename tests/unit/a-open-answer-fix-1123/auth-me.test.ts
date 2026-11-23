import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/pricing-v2/reverse-trial-server", () => ({ ensureReverseTrial: async () => ({ active: false, endsAt: null, started: false }) }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { GET } from "@/app/api/auth/me/route";

const me = async () => {
  m.guard.mockResolvedValue({
    userId: "11111111-2222-4333-8444-555555555555", role: "user", tier: "pro", tierExpiresAt: null,
    profile: { emailStatus: null, languageCode: "de", onboardingCompletedAt: null, referralsEnabled: false, activeExam: null, examDate: null, dailyGoal: null, createdAt: new Date().toISOString() },
  });
  return (await (await GET(new NextRequest("http://unit.test/api/auth/me"))).json()).user;
};

afterEach(() => { delete process.env.OPEN_ANSWER_SELF_GRADE_ENABLED; });

describe("auth/me open_answer_self_grade", () => {
  it("false by default", async () => { expect((await me()).open_answer_self_grade).toBe(false); });
  it("true only for the literal 'true'", async () => {
    process.env.OPEN_ANSWER_SELF_GRADE_ENABLED = "yes";
    expect((await me()).open_answer_self_grade).toBe(false);
    process.env.OPEN_ANSWER_SELF_GRADE_ENABLED = "true";
    expect((await me()).open_answer_self_grade).toBe(true);
  });
});
