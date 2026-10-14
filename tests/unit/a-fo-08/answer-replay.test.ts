/**
 * a-fo-08: an answer that committed after a 3 s client or server deadline
 * comes back as an outbox replay (same request id) and the RPC reports a
 * duplicate. The referral check still runs exactly once for it (idempotent
 * eligibility check); the announcement counter is never bumped twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  calls: [] as FakeCall[],
  duplicate: false,
  referral: [] as string[],
}));

vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({
  qualifyReferralOnActivity: vi.fn(async (_sb: unknown, userId: string) => { h.referral.push(userId); }),
}));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: "pro", tierExpiresAt: null })),
  isPaidAccess: () => true,
  isFreeAccess: () => false,
}));
vi.mock("@/lib/free-access", () => ({ canFreeUserReadQuestion: vi.fn(async () => true), logFreeCapHit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () =>
    createFakeSupabase((call: FakeCall) => {
      h.calls.push(call);
      if (call.table === "questions") return { data: { difficulty: 2, topic: "t", exam_type: "kenntnispruefung", answer: "A", choices: null, distractors: [] } };
      if (call.table === "rpc:record_quiz_answer" || call.table === "rpc:record_graded_answer") {
        return { data: { saved: true, duplicate: h.duplicate, xp: h.duplicate ? 0 : 10, totalXp: 50, gamification: null } };
      }
      return {};
    }).sb,
}));

import { POST } from "@/app/api/answer/route";

const KEY = "00000000-0000-4000-8000-0000000a0f08";
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("https://x/api/answer", {
    method: "POST",
    headers: { "x-session-token": "t", "content-type": "application/json" },
    body: JSON.stringify({ questionId: 7, isCorrect: true, requestId: KEY, ...body }),
  }));
const bumps = () => h.calls.filter((c) => c.table === "rpc:increment_user_announcements_qs").length;

beforeEach(() => {
  h.calls = [];
  h.referral = [];
  h.duplicate = false;
  delete process.env.ANSWER_KEY_GUARD;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("referral check on a replayed answer", () => {
  it("a fresh answer runs the referral check once and bumps the counter once", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(h.referral).toHaveLength(1);
    expect(bumps()).toBe(1);
  });

  it("a duplicate (committed after the deadline) still runs the referral check once, never a second bump", async () => {
    h.duplicate = true;
    const res = await post({});
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(h.referral).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(bumps()).toBe(0);
  });

  it("the first attempt plus its replay: two idempotent checks, exactly one bump", async () => {
    await post({});
    h.duplicate = true;
    await post({});
    expect(h.referral).toHaveLength(2);
    expect(bumps()).toBe(1);
  });

  it("a failing referral check never fails the saved answer", async () => {
    const { qualifyReferralOnActivity } = await import("@/lib/referral-exam-reward");
    vi.mocked(qualifyReferralOnActivity).mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.duplicate = true;
    const res = await post({});
    expect(res.status).toBe(200);
  });
});
