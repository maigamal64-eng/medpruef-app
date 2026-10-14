/**
 * a-fo-07 parity through the real routes: the options /api/questions delivers
 * (attachOptions, shuffled per load) fingerprint to exactly what /api/answer
 * rebuilds from the row, for structured choices with a placeholder, the legacy
 * distractor path and an open-answer row. If attachOptions ever changes
 * without answerKeyOptions, this fails instead of enforce refusing answers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { answerKeyFingerprint } from "@/lib/answer-key-fingerprint";

process.env.SESSION_SIGNING_SECRET ||= "a-fo-07-parity-test-secret-0123456789abcdef";
const USER = "22222222-2222-4222-8222-222222222222";
const EXAM = "kenntnispruefung";

const ROWS: Record<number, Record<string, unknown>> = {
  101: { id: 101, topic: "Neurologie", exam_type: EXAM, is_active: true, question: "Q1", answer: "Adrenalin", difficulty: 2, distractors: [],
    choices: [{ text: "Adrenalin", correct: true, position: 0 }, { text: " Amiodaron  300 mg", correct: false, position: 1 }, { text: "?", correct: false, position: 2 }, { text: "Atropin", correct: true, position: 3 }] },
  102: { id: 102, topic: "Neurologie", exam_type: EXAM, is_active: true, question: "Q2", answer: "Furosemid", difficulty: 2, choices: null, distractors: ["Torasemid", "HCT", "Spironolacton", "Mannitol"] },
  103: { id: 103, topic: "Neurologie", exam_type: EXAM, is_active: true, question: "Q3", answer: "frei", difficulty: 2, choices: null, distractors: [] },
};

const h = vi.hoisted(() => ({ calls: [] as FakeCall[] }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn(), withScope: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () =>
    createFakeSupabase((c) => {
      h.calls.push(c);
      if (c.table === "users") {
        return { data: { id: USER, tier: "pro", role: "user", tier_expires_at: null, is_banned: false, session_invalidated_at: null, email_status: "valid", active_exam: EXAM } };
      }
      if (c.table === "questions") {
        const idIn = c.filters.find((f) => f.kind === "in" && f.column === "id")?.value as number[] | undefined;
        const idEq = c.filters.find((f) => f.kind === "eq" && f.column === "id")?.value as number | undefined;
        const ids = idIn ?? (idEq !== undefined ? [idEq] : []);
        const rows = ids.map((id) => ROWS[id]).filter(Boolean);
        return { data: c.single ? rows[0] ?? null : rows, count: rows.length };
      }
      if (c.table === "rpc:record_quiz_answer") return { data: { saved: true, duplicate: false, xp: 10, totalXp: 10, gamification: null } };
      return { data: c.single ? null : [] };
    }).sb,
}));

const { signSession } = await import("@/lib/session");
const token = signSession(USER);
const req = (url: string, body?: unknown) =>
  new NextRequest(`https://medpruf.test${url}`, {
    method: body ? "POST" : "GET",
    headers: { "x-session-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeAll(() => { process.env.ANSWER_KEY_GUARD = "enforce"; process.env.ANSWER_KEY_GUARD_ENFORCED_AT = "2020-01-01T00:00:00Z"; });
afterAll(() => { delete process.env.ANSWER_KEY_GUARD; delete process.env.ANSWER_KEY_GUARD_ENFORCED_AT; });

describe("delivered options and the route agree", () => {
  for (const id of [101, 102, 103]) {
    it(`question ${id}: a fingerprint from the delivered options is accepted under enforce`, async () => {
      const questions = await import("@/app/api/questions/route");
      const answer = await import("@/app/api/answer/route");
      for (let load = 0; load < 5; load++) {
        const res = await questions.GET(req(`/api/questions?${new URLSearchParams({ ids: String(id), examSource: EXAM })}`));
        expect(res.status).toBe(200);
        const [q] = (await res.json()) as Array<{ id: number; options?: Array<{ text: string; correct: boolean }> | null }>;
        expect(q.id).toBe(id);
        if (id !== 103) expect(q.options?.some((o) => o.correct)).toBe(true); // correct flags still delivered
        const posted = await answer.POST(req("/api/answer", {
          questionId: id,
          isCorrect: false,
          requestId: crypto.randomUUID(),
          keyFingerprint: answerKeyFingerprint(q.id, q.options),
        }));
        expect(posted.status).toBe(200);
      }
      // Not vacuous: the guard is live in this setup.
      const refused = await answer.POST(req("/api/answer", {
        questionId: id, isCorrect: true, requestId: crypto.randomUUID(),
        keyFingerprint: answerKeyFingerprint(id, [{ text: "anders", correct: true }]),
      }));
      expect(refused.status).toBe(409);
    });
  }
});
