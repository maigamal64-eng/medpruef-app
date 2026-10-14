/**
 * a-fo-07: /api/answer stale-key guard. A version check only: the client's
 * isCorrect stays the verdict whenever its key is current (audit rule 6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { answerKeyFingerprint, rowKeyFingerprint } from "@/lib/answer-key-fingerprint";
import { buildMCQFromChoices, type StoredChoice } from "@/lib/mcq";

const CHOICES: StoredChoice[] = [
  { text: "A richtig", correct: true, position: 0 },
  { text: "B falsch", correct: false, position: 1 },
  { text: "C falsch", correct: false, position: 2 },
];

const h = vi.hoisted(() => ({
  calls: [] as FakeCall[],
  row: null as Record<string, unknown> | null,
  sentry: [] as string[],
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn((m: string) => h.sentry.push(m)),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  withScope: (fn: (scope: Record<string, unknown>) => void) => fn({ setLevel: vi.fn(), setTag: vi.fn(), setExtra: vi.fn() }),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: "free", tierExpiresAt: null })),
  isPaidAccess: () => false,
  isFreeAccess: () => true,
}));
const freeCheck = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/free-access", () => ({
  canFreeUserReadQuestion: vi.fn(async () => { freeCheck.calls += 1; return true; }),
  logFreeCapHit: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () =>
    createFakeSupabase((call: FakeCall) => {
      h.calls.push(call);
      if (call.table === "questions") return { data: h.row };
      if (call.table === "rpc:record_quiz_answer") return { data: { saved: true, xp: 10, totalXp: 50, gamification: null } };
      return {};
    }).sb,
}));

import { POST } from "@/app/api/answer/route";
import { resetKeyMismatchReports } from "@/lib/answer-key-report";

const KEY = "00000000-0000-4000-8000-000000000001";
const post = (body: unknown) =>
  POST(new NextRequest("https://x/api/answer", {
    method: "POST",
    headers: { "x-session-token": "t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
const quizRpc = () => h.calls.filter((c) => c.table === "rpc:record_quiz_answer");
const current = () => answerKeyFingerprint(7, buildMCQFromChoices(CHOICES));
const stale = () => answerKeyFingerprint(7, buildMCQFromChoices(CHOICES.map((c, i) => ({ ...c, correct: i === 1 }))));
const ENV = ["ANSWER_KEY_GUARD", "ANSWER_KEY_GUARD_ENFORCED_AT", "FLASHCARD_REVIEW_KIND_ENABLED", "SRS_GRADE_ENABLED"];

beforeEach(async () => {
  // Let a previous test's fire-and-forget Sentry report settle first.
  await new Promise((r) => setTimeout(r, 10));
  h.calls = [];
  h.sentry = [];
  freeCheck.calls = 0;
  h.row = { difficulty: 2, topic: "t", exam_type: "kenntnispruefung", answer: "A richtig", choices: CHOICES, distractors: [] };
  for (const k of ENV) delete process.env[k];
  resetKeyMismatchReports();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.restoreAllMocks();
});

describe("question read", () => {
  it("adds the key columns to the read the route already does (no extra round trip)", async () => {
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, keyFingerprint: current() });
    expect(res.status).toBe(200);
    const reads = h.calls.filter((c) => c.table === "questions");
    expect(reads).toHaveLength(1);
    expect(reads[0].columns).toBe("difficulty, topic, exam_type, answer, choices, distractors");
  });
});

describe("enforce", () => {
  beforeEach(() => { process.env.ANSWER_KEY_GUARD = "enforce"; process.env.ANSWER_KEY_GUARD_ENFORCED_AT = new Date().toISOString(); });

  it("a mismatch answers 409 'question changed' and calls no RPC, no free check", async () => {
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, keyFingerprint: stale() });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "question changed" });
    expect(h.calls.filter((c) => c.table.startsWith("rpc:"))).toHaveLength(0);
    expect(freeCheck.calls).toBe(0);
    expect(console.warn).toHaveBeenCalledWith("[answer] key_mismatch", { questionId: 7, mode: "enforce" });
  });

  it("a match writes exactly as today with the client's isCorrect", async () => {
    for (const isCorrect of [true, false]) {
      h.calls = [];
      const res = await post({ questionId: 7, isCorrect, userAnswer: "B falsch", timeSpentMs: 900, requestId: KEY, keyFingerprint: current() });
      expect(res.status).toBe(200);
      expect(quizRpc()).toHaveLength(1);
      expect(quizRpc()[0].payload).toEqual({
        p_user_id: "11111111-1111-4111-8111-111111111111",
        p_question_id: 7,
        p_is_correct: isCorrect,
        p_user_answer: "B falsch",
        p_time_spent_ms: 900,
        p_is_free: true,
        p_request_id: KEY,
      });
    }
  });

  it("a legacy outbox row without a fingerprint is accepted inside the 7-day window", async () => {
    process.env.ANSWER_KEY_GUARD_ENFORCED_AT = new Date(Date.now() - 6 * 86400000).toISOString();
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY });
    expect(res.status).toBe(200);
    expect(quizRpc()).toHaveLength(1);
  });

  it("a legacy row is refused once the window has passed", async () => {
    process.env.ANSWER_KEY_GUARD_ENFORCED_AT = new Date(Date.now() - 8 * 86400000).toISOString();
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY });
    expect(res.status).toBe(409);
    expect(quizRpc()).toHaveLength(0);
  });

  it("flashcard ratings and graded self-ratings carry no key and are never guarded", async () => {
    process.env.ANSWER_KEY_GUARD_ENFORCED_AT = new Date(Date.now() - 30 * 86400000).toISOString();
    const flash = await post({ questionId: 7, isCorrect: true, requestId: KEY, grade: 2, kind: "flashcard" });
    expect(flash.status).toBe(200);
    expect(quizRpc()).toHaveLength(1);
  });

  it("an open-answer question with no options matches the client's empty key", async () => {
    h.row = { difficulty: 2, topic: "t", exam_type: "kenntnispruefung", answer: "frei", choices: null, distractors: [] };
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, keyFingerprint: answerKeyFingerprint(7, undefined) });
    expect(res.status).toBe(200);
    expect(rowKeyFingerprint(7, h.row)).toBe(answerKeyFingerprint(7, undefined));
  });
});

describe("shadow (default)", () => {
  it("never refuses: a mismatch is logged with the question id only and written as today", async () => {
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, keyFingerprint: stale() });
    expect(res.status).toBe(200);
    expect(quizRpc()).toHaveLength(1);
    expect((quizRpc()[0].payload as { p_is_correct: boolean }).p_is_correct).toBe(true);
    expect(console.warn).toHaveBeenCalledWith("[answer] key_mismatch", { questionId: 7, mode: "shadow" });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sentry).toEqual(["[answer] key_mismatch"]);
    // Rate limited per question per instance.
    await post({ questionId: 7, isCorrect: true, requestId: "00000000-0000-4000-8000-000000000002", keyFingerprint: stale() });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sentry).toHaveLength(1);
  });

  it("accepts rows without a fingerprint and counts them", async () => {
    const res = await post({ questionId: 7, isCorrect: false, requestId: KEY });
    expect(res.status).toBe(200);
    expect(console.info).toHaveBeenCalledWith("[answer] key_missing", { questionId: 7 });
  });

  it("off checks nothing", async () => {
    process.env.ANSWER_KEY_GUARD = "off";
    const res = await post({ questionId: 7, isCorrect: true, requestId: KEY, keyFingerprint: stale() });
    expect(res.status).toBe(200);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
