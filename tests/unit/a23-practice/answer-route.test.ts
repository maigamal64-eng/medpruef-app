/**
 * /api/answer a23 paths: graded scheduling, the flashcard review kind and the
 * free schedule are all behind default-OFF flags. With every flag off the
 * route calls exactly the pre-a23 RPC with the pre-a23 arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { CONFIDENCE_GRADE, parseGrade, parseKind, readAnswerFlags, resolveAnswerPath, skipSchedule } from "@/lib/answer-request";

const h = vi.hoisted(() => ({
  paid: true,
  calls: [] as FakeCall[],
  rpc: {} as Record<string, unknown>,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: h.paid ? "pro" : "free", tierExpiresAt: null })),
  isPaidAccess: () => h.paid,
  isFreeAccess: () => !h.paid,
}));
vi.mock("@/lib/free-access", () => ({
  canFreeUserReadQuestion: vi.fn(async () => true),
  logFreeCapHit: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () =>
    createFakeSupabase((call: FakeCall) => {
      h.calls.push(call);
      if (call.table === "questions") return { data: { difficulty: 2, topic: "t", exam_type: "kenntnispruefung" } };
      if (call.table === "user_question_progress") return { data: { interval_days: 6, next_review_at: "2026-10-18T10:00:00Z" } };
      if (call.table.startsWith("rpc:")) return { data: h.rpc[call.table.slice(4)] ?? { saved: true } };
      return {};
    }).sb,
}));

import { POST } from "@/app/api/answer/route";

const KEY = "00000000-0000-4000-8000-000000000001";
const post = (body: unknown) =>
  POST(new NextRequest("https://x/api/answer", {
    method: "POST",
    headers: { "x-session-token": "t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
const rpcCalls = () => h.calls.filter((c) => c.table.startsWith("rpc:") && !c.table.includes("increment_user_announcements"));

beforeEach(() => {
  h.paid = true;
  h.calls = [];
  h.rpc = {
    record_quiz_answer: { saved: true, xp: 10, totalXp: 50, gamification: null },
    record_graded_answer: { saved: true, xp: 10, totalXp: 50, graded: true, intervalDays: 6 },
    record_flashcard_review: { saved: true, duplicate: false, kind: "flashcard", scheduled: true, intervalDays: 6, nextReviewAt: "2026-10-18T10:00:00Z", cardsToday: 3, gamification: { total_xp: 50 } },
  };
  delete process.env.SRS_GRADE_ENABLED;
  delete process.env.FLASHCARD_REVIEW_KIND_ENABLED;
  delete process.env.FREE_SCHEDULE_ENABLED;
});
afterEach(() => {
  delete process.env.SRS_GRADE_ENABLED;
  delete process.env.FLASHCARD_REVIEW_KIND_ENABLED;
  delete process.env.FREE_SCHEDULE_ENABLED;
});

describe("answer-request helpers", () => {
  it("parses grades and kinds strictly", () => {
    expect([0, 1, 2, 3].map(parseGrade)).toEqual([0, 1, 2, 3]);
    expect(parseGrade(undefined)).toBeUndefined();
    expect([4, -1, 1.5, "2", null].map(parseGrade)).toEqual([null, null, null, null, null]);
    expect(parseKind("flashcard")).toBe("flashcard");
    expect(parseKind("exam")).toBeNull();
  });
  it("flags default off and pick the quiz path", () => {
    const off = readAnswerFlags({});
    expect(off).toEqual({ srsGrade: false, flashcardKind: false, freeSchedule: false });
    expect(resolveAnswerPath("flashcard", 2, off)).toBe("quiz");
    expect(resolveAnswerPath(undefined, 2, { ...off, srsGrade: true })).toBe("graded");
    expect(resolveAnswerPath("flashcard", 2, { ...off, flashcardKind: true })).toBe("flashcard");
    expect(resolveAnswerPath("flashcard", undefined, { ...off, flashcardKind: true })).toBe("quiz");
    expect(skipSchedule(true, off)).toBe(true);
    expect(skipSchedule(true, { ...off, freeSchedule: true })).toBe(false);
    expect(skipSchedule(false, off)).toBe(false);
    expect(CONFIDENCE_GRADE).toEqual({ again: 0, hard: 1, good: 2, easy: 3 });
  });
});

describe("/api/answer with flags off (default)", () => {
  it("a flashcard rating with grade and kind is the same binary quiz answer as before", async () => {
    const res = await post({ questionId: 7, isCorrect: true, userAnswer: "A", timeSpentMs: 0, requestId: KEY, grade: 2, kind: "flashcard" });
    expect(res.status).toBe(200);
    const calls = rpcCalls();
    expect(calls.map((c) => c.table)).toEqual(["rpc:record_quiz_answer"]);
    expect(calls[0].payload).toEqual({
      p_user_id: "11111111-1111-4111-8111-111111111111",
      p_question_id: 7,
      p_is_correct: true,
      p_user_answer: "A",
      p_time_spent_ms: null,
      p_is_free: false,
      p_request_id: KEY,
    });
    const body = await res.json();
    expect(body.review).toEqual({ intervalDays: 6, nextReviewAt: "2026-10-18T10:00:00Z" });
  });
  it("free accounts still write no schedule and get no review promise", async () => {
    h.paid = false;
    const res = await post({ questionId: 7, isCorrect: false, requestId: KEY });
    expect((rpcCalls()[0].payload as { p_is_free: boolean }).p_is_free).toBe(true);
    expect((await res.json()).review).toBeNull();
  });
  it("rejects an invalid grade or kind", async () => {
    expect((await post({ questionId: 7, isCorrect: true, grade: 5 })).status).toBe(400);
    expect((await post({ questionId: 7, isCorrect: true, kind: "exam" })).status).toBe(400);
    expect(rpcCalls()).toHaveLength(0);
  });
});

describe("/api/answer with a23 flags on", () => {
  it("SRS_GRADE_ENABLED records a graded answer", async () => {
    process.env.SRS_GRADE_ENABLED = "true";
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, grade: 3 });
    expect(res.status).toBe(200);
    const [call] = rpcCalls();
    expect(call.table).toBe("rpc:record_graded_answer");
    expect(call.payload).toMatchObject({ p_grade: 3, p_request_id: KEY, p_is_free: false });
  });
  it("refuses a grade that contradicts isCorrect", async () => {
    process.env.SRS_GRADE_ENABLED = "true";
    expect((await post({ questionId: 7, isCorrect: true, requestId: KEY, grade: 0 })).status).toBe(400);
  });
  it("FLASHCARD_REVIEW_KIND_ENABLED writes a review, no quiz answer, no XP", async () => {
    process.env.FLASHCARD_REVIEW_KIND_ENABLED = "true";
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, grade: 2, kind: "flashcard" });
    expect(res.status).toBe(200);
    const calls = rpcCalls();
    expect(calls.map((c) => c.table)).toEqual(["rpc:record_flashcard_review"]);
    expect(calls[0].payload).toMatchObject({ p_grade: 2, p_request_id: KEY, p_schedule: true, p_graded: false });
    const body = await res.json();
    expect(body).toMatchObject({ kind: "flashcard", xp: 0, cardsToday: 3, review: { intervalDays: 6 } });
    expect(h.calls.some((c) => c.table === "rpc:increment_user_announcements_qs")).toBe(false);
  });
  it("a flashcard review needs a request key", async () => {
    process.env.FLASHCARD_REVIEW_KIND_ENABLED = "true";
    expect((await post({ questionId: 7, isCorrect: true, grade: 2, kind: "flashcard" })).status).toBe(400);
  });
  it("FREE_SCHEDULE_ENABLED schedules free reviews but promises nothing", async () => {
    process.env.FLASHCARD_REVIEW_KIND_ENABLED = "true";
    process.env.FREE_SCHEDULE_ENABLED = "true";
    h.paid = false;
    const res = await post({ questionId: 7, isCorrect: false, requestId: KEY, grade: 0, kind: "flashcard" });
    expect((rpcCalls()[0].payload as { p_schedule: boolean }).p_schedule).toBe(true);
    expect((await res.json()).review).toBeNull();
  });
  it("FREE_SCHEDULE_ENABLED alone lets a free quiz answer write the schedule", async () => {
    process.env.FREE_SCHEDULE_ENABLED = "true";
    h.paid = false;
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY });
    expect((rpcCalls()[0].payload as { p_is_free: boolean }).p_is_free).toBe(false);
    expect((await res.json()).review).toBeNull();
  });
  it("never claims a flashcard save the RPC did not confirm", async () => {
    process.env.FLASHCARD_REVIEW_KIND_ENABLED = "true";
    h.rpc.record_flashcard_review = { saved: false };
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, grade: 2, kind: "flashcard" });
    expect(res.status).toBe(500);
  });
});
