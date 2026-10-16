import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/pricing-v2/reverse-trial-server", () => ({ ensureReverseTrial: async () => ({ active: false, endsAt: null, started: false }) }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { GET } from "@/app/api/auth/me/route";

const guardFor = (createdAt: string, role = "user") => ({
  userId: "11111111-2222-4333-8444-555555555555", role, tier: "free", tierExpiresAt: null,
  profile: { emailStatus: null, languageCode: "de", onboardingCompletedAt: null, referralsEnabled: false, activeExam: null, examDate: null, dailyGoal: null, createdAt },
});
const me = async () => (await (await GET(new NextRequest("http://unit.test/api/auth/me"))).json()).user;

afterEach(() => {
  delete process.env.EMAIL_CONFIRM_ENABLED;
  delete process.env.REMINDER_LINK_SIGNING_SECRET;
});

describe("auth/me email_confirm", () => {
  it("absent while off (the response is unchanged)", async () => {
    m.guard.mockResolvedValue(guardFor(new Date().toISOString()));
    expect(await me()).not.toHaveProperty("email_confirm");
  });
  it("true only for a young non-admin account while on", async () => {
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    process.env.REMINDER_LINK_SIGNING_SECRET = "k".repeat(40);
    m.guard.mockResolvedValue(guardFor(new Date(Date.now() - 86_400_000).toISOString()));
    expect((await me()).email_confirm).toBe(true);
    m.guard.mockResolvedValue(guardFor(new Date(Date.now() - 8 * 86_400_000).toISOString()));
    expect(await me()).not.toHaveProperty("email_confirm");
    m.guard.mockResolvedValue(guardFor(new Date().toISOString(), "admin"));
    expect(await me()).not.toHaveProperty("email_confirm");
  });
});
