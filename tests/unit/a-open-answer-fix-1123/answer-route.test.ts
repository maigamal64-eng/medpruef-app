/**
 * a-open-answer-fix-1123: /api/answer takes a self-grade for a row with choices NULL
 * (every old pharma row) in every guard mode, writes it through record_quiz_answer
 * (answer_history, XP, streak, progress), and the unseen draw then excludes the id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { answerKeyFingerprint, rowKeyFingerprint } from "@/lib/answer-key-fingerprint";
import { readFileSync } from "node:fs";

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
const freeCheck = vi.hoisted(() => ({ calls: 0, allowed: true, capHits: 0 }));
vi.mock("@/lib/free-access", () => ({
  canFreeUserReadQuestion: vi.fn(async () => { freeCheck.calls += 1; return freeCheck.allowed; }),
  logFreeCapHit: vi.fn(async () => { freeCheck.capHits += 1; }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () =>
    createFakeSupabase((call: FakeCall) => {
      h.calls.push(call);
      if (call.table === "questions") return { data: h.row };
      if (call.table === "rpc:record_quiz_answer") return { data: { saved: true, xp: 10, totalXp: 50, gamification: null } };
      if (call.table === "rpc:record_graded_answer") return { data: { saved: true, xp: 10, totalXp: 50, gamification: null } };
      return {};
    }).sb,
}));

import { POST } from "@/app/api/answer/route";
import { resetKeyMismatchReports } from "@/lib/answer-key-report";

const KEY = "00000000-0000-4000-8000-000000000001";
const ID = 110753;
const post = (body: unknown) =>
  POST(new NextRequest("https://x/api/answer", {
    method: "POST",
    headers: { "x-session-token": "t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
const quizRpc = () => h.calls.filter((c) => c.table === "rpc:record_quiz_answer");
const ENV = ["ANSWER_KEY_GUARD", "ANSWER_KEY_GUARD_ENFORCED_AT", "FLASHCARD_REVIEW_KIND_ENABLED", "SRS_GRADE_ENABLED"];

beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 10));
  h.calls = [];
  h.sentry = [];
  freeCheck.calls = 0;
  freeCheck.allowed = true;
  freeCheck.capHits = 0;
  // An old pharma row: no choices, fewer than 3 distractors, so no options are served.
  h.row = { difficulty: 2, topic: "Pharmakologie", exam_type: "pharma", answer: "Metformin", choices: null, distractors: [] };
  for (const k of ENV) delete process.env[k];
  resetKeyMismatchReports();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); for (const k of ENV) delete process.env[k]; });

const selfGrade = (known: boolean, extra: Record<string, unknown> = {}) => ({
  questionId: ID, isCorrect: known, userAnswer: known ? "self:known" : "self:unknown", timeSpentMs: 3000, requestId: KEY,
  keyFingerprint: answerKeyFingerprint(ID, null), ...extra,
});

describe("self-grade on a choices-NULL row", () => {
  it.each(["off", "shadow", "enforce"])("guard %s: accepted and written once with the tap's verdict", async (mode) => {
    process.env.ANSWER_KEY_GUARD = mode;
    const res = await post(selfGrade(false));
    expect(res.status).toBe(200);
    expect(quizRpc()).toHaveLength(1);
    expect(quizRpc()[0].payload).toMatchObject({ p_question_id: ID, p_is_correct: false, p_user_answer: "self:unknown", p_request_id: KEY });
    expect(h.sentry).toEqual([]);
  });
  it("'Gewusst' is written as correct", async () => {
    process.env.ANSWER_KEY_GUARD = "enforce";
    expect((await post(selfGrade(true))).status).toBe(200);
    expect(quizRpc()[0].payload).toMatchObject({ p_is_correct: true, p_user_answer: "self:known" });
  });
  it("the client and server fingerprints of an open-answer row are the same value", () => {
    expect(rowKeyFingerprint(ID, h.row as never)).toBe(answerKeyFingerprint(ID, null));
  });
  it("enforce: a pre-deploy outbox row without a fingerprint is on the legacy grace, not refused", async () => {
    process.env.ANSWER_KEY_GUARD = "enforce";
    process.env.ANSWER_KEY_GUARD_ENFORCED_AT = new Date().toISOString();
    const { keyFingerprint: _omit, ...legacy } = selfGrade(true);
    void _omit;
    expect((await post(legacy)).status).toBe(200);
  });
  it("a free caller outside the allowance still gets 402 and nothing is written", async () => {
    freeCheck.allowed = false;
    const res = await post(selfGrade(true));
    expect(res.status).toBe(402);
    expect(quizRpc()).toHaveLength(0);
  });
});

describe("the next unseen draw excludes a self-graded id", () => {
  it("the unseen RPC excludes every question with an answer_history row, whatever its user_answer", () => {
    const sql = readFileSync("supabase/migrations/20261014100000_study_rpc_perf.sql", "utf8");
    const unseen = sql.slice(sql.indexOf("IF p_mode = 'unseen'"), sql.indexOf("ELSIF p_mode = 'wrong'"));
    expect(unseen).toContain("NOT EXISTS (SELECT 1 FROM answer_history ah WHERE ah.user_id = p_user_id AND ah.question_id = q.id)");
    expect(unseen).not.toContain("user_answer");
  });
  it("record_quiz_answer inserts the self-grade into answer_history with that user_answer", () => {
    const sql = readFileSync("supabase/migrations/20261222090000_a23_graded_review.sql", "utf8");
    expect(sql).toMatch(/INSERT INTO public\.answer_history\(user_id, question_id, user_answer, is_correct, time_spent_ms, xp_earned, client_request_id\)\s+VALUES \(p_user_id, p_question_id, nullif\(p_user_answer, ''\)/);
  });
});
