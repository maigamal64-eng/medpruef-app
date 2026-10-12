import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

// a-stability C: a timeout or 5xx keeps the write in the device outbox and
// replays it later with the same idempotency key; a replay of a write that did
// land is a server-side duplicate (no second XP, streak or count).
const KEY = "00000000-0000-4000-8000-0000000000a1";
const KEY2 = "00000000-0000-4000-8000-0000000000a2";
const USER = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111" as string | null,
  queue: [] as Array<Record<string, unknown>>,
  authFetch: vi.fn(),
  removed: [] as string[],
  updated: [] as Array<Record<string, unknown>>,
  calls: [] as unknown[],
  rpc: {} as Record<string, unknown>,
}));

vi.mock("@/lib/authFetch", () => ({ authFetch: h.authFetch }));
vi.mock("@/lib/auth", () => ({ getStoredSession: () => (h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/offlineDb", () => ({
  drainPendingAnswers: async () => h.queue.map((r) => ({ ...r })),
  pendingAnswersForUser: (rows: Array<{ userId?: string }>, id: string) => rows.filter((r) => r.userId === id),
  removePendingAnswer: async (id: string) => { h.removed.push(id); h.queue = h.queue.filter((r) => r.id !== id); },
  updatePendingAnswer: async (row: Record<string, unknown>) => { h.updated.push(row); h.queue = h.queue.map((r) => (r.id === row.id ? row : r)); },
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: "pro", tierExpiresAt: null })),
  isPaidAccess: () => true,
  isFreeAccess: () => false,
}));
vi.mock("@/lib/free-access", () => ({ canFreeUserReadQuestion: vi.fn(async () => true), logFreeCapHit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((call: FakeCall) => {
    h.calls.push(call);
    if (call.table === "questions") return { data: { difficulty: 2, topic: "t", exam_type: "kenntnispruefung" } };
    if (call.table === "user_question_progress") return { data: { interval_days: 6, next_review_at: null } };
    if (call.table.startsWith("rpc:")) return { data: h.rpc[call.table.slice(4)] ?? { saved: true } };
    return {};
  }).sb,
}));

import {
  flushQueue, GIVE_UP_AFTER_MS, isRetryableSaveStatus, MAX_REPLAY_ATTEMPTS, replayBody, replayOrder, retryDelayMs, shouldGiveUp,
} from "@/lib/offlineSync";
import { POST as answer } from "@/app/api/answer/route";
import type { PendingAnswer } from "@/lib/offlineDb";

const row = (over: Partial<PendingAnswer> = {}): PendingAnswer => ({
  id: KEY, userId: USER, questionId: 42, userAnswer: "A", isCorrect: true, timeSpentMs: 1200, createdAt: new Date().toISOString(), ...over,
});
const response = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const sentBodies = () => h.authFetch.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("window", { addEventListener: vi.fn(), dispatchEvent: vi.fn() } as unknown as Window);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  h.userId = USER; h.queue = []; h.removed = []; h.updated = []; h.calls = [];
  h.authFetch.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("which live failures go to the outbox", () => {
  it("timeouts, network failures, 408/425/429 and 5xx do; real refusals do not", () => {
    for (const s of [null, 408, 425, 429, 500, 502, 503, 504]) expect(isRetryableSaveStatus(s), String(s)).toBe(true);
    for (const s of [400, 401, 402, 403, 404, 409, 422]) expect(isRetryableSaveStatus(s), String(s)).toBe(false);
  });
});

describe("drain during a database outage", () => {
  it("503: keeps the row with its key, stops sending the rest, schedules a retry", async () => {
    h.queue = [row(), row({ id: KEY2, questionId: 43 })];
    h.authFetch.mockResolvedValue(response(503, { error: "unavailable" }));
    await flushQueue();
    expect(h.authFetch).toHaveBeenCalledTimes(1);
    expect(h.removed).toEqual([]);
    expect(h.updated).toEqual([expect.objectContaining({ id: KEY, attempts: 1 })]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("timeout: the request throws, the row stays with the same key and is tried again later", async () => {
    h.queue = [row()];
    h.authFetch.mockRejectedValueOnce(new DOMException("Request timed out", "TimeoutError"));
    await flushQueue();
    expect(h.removed).toEqual([]);
    expect(h.queue).toEqual([expect.objectContaining({ id: KEY, attempts: 1 })]);
    h.authFetch.mockResolvedValueOnce(response(200, { saved: true, duplicate: false, xp: 10 }));
    await vi.runOnlyPendingTimersAsync();
    expect(sentBodies().map((b) => b.requestId)).toEqual([KEY, KEY]);
    expect(h.removed).toEqual([KEY]);
  });

  it("never drops a young row however many outage attempts; drops only old and often-tried rows", async () => {
    h.queue = [row({ attempts: 40 })];
    h.authFetch.mockResolvedValue(response(500));
    await flushQueue();
    expect(h.removed).toEqual([]);
    const old = new Date(Date.now() - GIVE_UP_AFTER_MS - 1000).toISOString();
    expect(shouldGiveUp({ createdAt: old }, MAX_REPLAY_ATTEMPTS)).toBe(true);
    expect(shouldGiveUp({ createdAt: old }, MAX_REPLAY_ATTEMPTS - 1)).toBe(false);
    expect(shouldGiveUp({ createdAt: new Date().toISOString() }, 99)).toBe(false);
    h.queue = [row({ attempts: MAX_REPLAY_ATTEMPTS, createdAt: old })];
    await flushQueue();
    expect(h.removed).toEqual([KEY]);
  });

  it("retries the least-tried rows first and backs off to five minutes", () => {
    const stuck = row({ id: "stuck", attempts: 4, createdAt: "2026-10-12T14:00:00Z" });
    const fresh = row({ id: "fresh", createdAt: "2026-10-12T14:10:00Z" });
    expect(replayOrder([stuck, fresh]).map((r) => r.id)).toEqual(["fresh", "stuck"]);
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(20)).toBe(5 * 60_000);
  });
});

describe("duplicate retry never counts twice", () => {
  it("a replay of a write that already landed is removed as saved, with the same key", async () => {
    h.queue = [row()];
    h.authFetch.mockResolvedValue(response(200, { saved: true, duplicate: true, xp: 0 }));
    await flushQueue();
    expect(sentBodies()[0]).toMatchObject({ requestId: KEY, questionId: 42, isCorrect: true });
    expect(h.removed).toEqual([KEY]);
  });

  it("a queued flashcard rating replays its grade and kind under its key", () => {
    expect(replayBody(row({ grade: 2, kind: "flashcard" }))).toEqual({
      questionId: 42, requestId: KEY, userAnswer: "A", isCorrect: true, timeSpentMs: 1200, grade: 2, kind: "flashcard",
    });
    expect(replayBody(row())).not.toHaveProperty("grade");
  });

  it("/api/answer: a duplicate key returns xp 0 and skips every counter side effect", async () => {
    vi.useRealTimers();
    h.rpc = { record_quiz_answer: { saved: true, duplicate: true, xp: 0, totalXp: 50, gamification: { total_xp: 50, current_streak: 3 } } };
    const res = await answer(new NextRequest("https://x/api/answer", {
      method: "POST", headers: { "x-session-token": "t", "content-type": "application/json" },
      body: JSON.stringify({ questionId: 42, isCorrect: true, userAnswer: "A", timeSpentMs: 1200, requestId: KEY }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saved: true, duplicate: true, xp: 0 });
    const rpcs = (h.calls as FakeCall[]).filter((c) => c.table.startsWith("rpc:")).map((c) => c.table);
    expect(rpcs).toContain("rpc:record_quiz_answer");
    expect(rpcs).not.toContain("rpc:increment_user_announcements_qs");
    expect((h.calls as FakeCall[]).find((c) => c.table === "rpc:record_quiz_answer")?.payload).toMatchObject({ p_request_id: KEY });
  });
});
