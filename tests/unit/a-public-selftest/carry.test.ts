import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: new Map<string, string>(), calls: [] as { url: string; method: string; body?: unknown }[], own: null as string | null }));
vi.mock("@/lib/safe-storage", () => ({ safeStorage: { getItem: (k: string) => h.store.get(k) ?? null, setItem: (k: string, v: string) => h.store.set(k, v), removeItem: (k: string) => h.store.delete(k) } }));
vi.mock("@/lib/auth", () => ({ getStoredSession: () => ({ user: { id: "u-1" } }), storeSession: vi.fn() }));
vi.mock("@/lib/topics", async (orig) => ({ ...(await orig<object>()), setStoredExamSource: vi.fn() }));
vi.mock("@/lib/offlineDb", () => ({ queuePendingAnswer: vi.fn(async () => {}) }));
vi.mock("@/lib/offlineSync", () => ({ flushQueue: vi.fn(async () => {}) }));
vi.mock("@/lib/authFetch", () => ({
  authFetch: vi.fn(async (url: string, init: { method: string; body?: string }) => {
    h.calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/user/exam-preference" && init.method === "GET") return new Response(JSON.stringify({ examDate: h.own }), { status: 200 });
    return new Response("{}", { status: 200 });
  }),
}));

import { carrySelftest } from "@/lib/public-selftest/carry";
import { SELFTEST_PENDING_KEY, allowlistFor, pendingRecord, selftestSittingDates } from "@/lib/public-selftest";
import { pinClock } from "../helpers/pin-clock";

// Fixtures use fixed calendar dates as the future: pin Date so they cannot go stale.
pinClock("2026-10-19T09:00:00Z");

const NOW = Date.now();
const id = allowlistFor("kmp_innsbruck")[0].id;
const answer = { id, requestId: "00000000-0000-4000-8000-000000000001", userAnswer: "A", isCorrect: true, timeSpentMs: 1000, keyFingerprint: "k1:" + "a".repeat(64) };
const patches = () => h.calls.filter((c) => c.method === "PATCH").map((c) => c.body);

beforeEach(() => { h.store.clear(); h.calls.length = 0; h.own = null; });

describe("carry", () => {
  const sitting = selftestSittingDates("kmp_innsbruck")[0];
  it("saves the exam and the named sitting together when the account has no date", async () => {
    h.store.set(SELFTEST_PENDING_KEY, pendingRecord({ bank: "kmp_innsbruck", sitting, answers: [answer] }, NOW));
    const r = await carrySelftest();
    expect(r).toMatchObject({ ran: true, queued: 1, sitting: "saved" });
    expect(patches()).toEqual([{ activeExam: "kmp_innsbruck", examDate: sitting }]);
    expect(h.store.has(SELFTEST_PENDING_KEY)).toBe(false);
  });
  it("keeps an own date of another bank and does not switch the exam", async () => {
    h.own = "2030-06-01";
    h.store.set(SELFTEST_PENDING_KEY, pendingRecord({ bank: "kmp_innsbruck", sitting, answers: [answer] }, NOW));
    const r = await carrySelftest();
    expect(r.sitting).toBe("kept_own");
    expect(patches()).toEqual([]);
  });
  it("switches the exam but keeps an own date of the same bank", async () => {
    h.own = selftestSittingDates("kmp_innsbruck").at(-1) ?? null;
    h.store.set(SELFTEST_PENDING_KEY, pendingRecord({ bank: "kmp_innsbruck", sitting: "", answers: [answer] }, NOW));
    const r = await carrySelftest();
    expect(r.sitting).toBe("open");
    expect(patches()).toEqual([{ activeExam: "kmp_innsbruck" }]);
  });
  it("does nothing without a record of this browser", async () => {
    expect((await carrySelftest()).ran).toBe(false);
    expect(h.calls).toEqual([]);
  });
});
