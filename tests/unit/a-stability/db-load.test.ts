import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// a-stability: one Home load must not run the same heavy aggregate several
// times. Bank totals come from the shared per-instance cache on every learner
// route; concurrent topic-progress reads for one learner share one round.
const USER = "11111111-1111-4111-8111-111111111111";
const h = vi.hoisted(() => ({ rpcCalls: [] as string[], release: [] as Array<() => void>, hold: false }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "11111111-1111-4111-8111-111111111111", tier: "pro", role: "user" }),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const chain = (data: unknown) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "not", "lte", "gte", "range", "in"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data, error: null });
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: Array.isArray(data) ? data : [], error: null }).then(ok, ko);
      return b;
    };
    return {
      from: (table: string) => chain(table === "users" ? { exam_date: null, daily_goal: 20, active_exam: "kenntnispruefung" } : table === "user_gamification" ? { current_streak: 1, daily_questions_today: 0 } : []),
      rpc: (fn: string) => {
        h.rpcCalls.push(fn);
        const rows = fn === "get_topic_counts" ? [{ topic: "HNO", count: 10 }] : fn === "get_user_topic_progress" ? [{ topic: "HNO", answered: 2, correct: 1, wrong: 1 }] : [];
        if (!h.hold) return Promise.resolve({ data: rows, error: null });
        return new Promise((resolve) => h.release.push(() => resolve({ data: rows, error: null })));
      },
    };
  },
}));

import { GET as topicProgress } from "@/app/api/user/topic-progress/route";
import { GET as readiness } from "@/app/api/user/readiness/route";
import { GET as studyPlan } from "@/app/api/user/study-plan/route";
import { inFlightCount, shareInFlight } from "@/lib/inflight";

const req = (path: string) => new NextRequest(`https://x${path}`);
beforeEach(() => { h.rpcCalls = []; h.release = []; h.hold = false; });

describe("shareInFlight", () => {
  it("shares a pending read and forgets it once settled", async () => {
    let runs = 0;
    let finish: (v: number) => void = () => {};
    const read = () => { runs++; return new Promise<number>((r) => { finish = r; }); };
    const a = shareInFlight("k", read);
    const b = shareInFlight("k", read);
    expect(runs).toBe(1);
    expect(inFlightCount()).toBe(1);
    finish(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(inFlightCount()).toBe(0);
    void shareInFlight("k", async () => { runs++; return 1; });
    expect(runs).toBe(2);
  });
  it("forgets a failed read so the next caller retries", async () => {
    await expect(shareInFlight("f", async () => { throw new Error("57014"); })).rejects.toThrow("57014");
    expect(await shareInFlight("f", async () => 3)).toBe(3);
  });
});

describe("one Home load", () => {
  it("runs each learner aggregate once for concurrent topic-progress requests", async () => {
    h.hold = true;
    const a = topicProgress(req("/api/user/topic-progress?examType=kenntnispruefung"));
    const b = topicProgress(req("/api/user/topic-progress?examType=kenntnispruefung"));
    await vi.waitFor(() => expect(h.release.length).toBe(4));
    await new Promise((r) => setTimeout(r, 10));
    h.release.forEach((go) => go());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe(200);
    expect(await ra.json()).toEqual(await rb.json());
    for (const fn of ["get_user_topic_progress", "get_user_topic_attempt_stats", "get_user_topic_last_correct", "get_topic_counts"]) {
      expect(h.rpcCalls.filter((c) => c === fn), fn).toHaveLength(1);
    }
  });

  it("reads the bank totals from the shared cache on readiness and study-plan", async () => {
    // topic-progress above filled the kenntnispruefung cache in this module.
    expect((await readiness(req("/api/user/readiness"))).status).toBe(200);
    expect((await studyPlan(req("/api/user/study-plan"))).status).toBe(200);
    expect(h.rpcCalls.filter((c) => c === "get_topic_counts")).toHaveLength(0);
  });

  it("a later topic-progress request reads fresh learner numbers", async () => {
    await topicProgress(req("/api/user/topic-progress?examType=kenntnispruefung"));
    expect(h.rpcCalls.filter((c) => c === "get_user_topic_progress")).toHaveLength(1);
  });
});
