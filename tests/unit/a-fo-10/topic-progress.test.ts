/**
 * a-fo-10: /api/user/topic-progress reads.
 *  - get_user_topic_last_correct is called with the live pg_proc signature
 *    (p_user_id uuid, p_exam_type text; read 14 Oct 2026) and its result
 *    feeds lastCorrect* and openMistakes.
 *  - TOPIC_STRENGTH_READS=true takes the attempt stats from
 *    user_topic_strength instead of get_user_topic_attempt_stats.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const USER = "22222222-2222-4222-8222-222222222222";
const EXAM = "kenntnispruefung";

const h = vi.hoisted(() => ({
  handler: (() => undefined) as (c: FakeCall) => FakeResult | undefined,
  calls: [] as FakeCall[],
}));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: USER, role: "user", tier: "pro", tierExpiresAt: null }),
  isPaidAccess: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c));
    const push = calls.push.bind(calls);
    calls.push = (...items: FakeCall[]) => { h.calls.push(...items); return push(...items); };
    return sb;
  },
}));

const { GET } = await import("@/app/api/user/topic-progress/route");
const freeTier = await import("@/lib/free-tier");

const COUNTS = [{ topic: "Neurologie", count: 400 }, { topic: "Unknown", count: 3 }];
const PROGRESS = [{ topic: "Neurologie", answered: 4, correct: 3, wrong: 2 }];
const ATTEMPTS = [{ topic: "Neurologie", attempts: 6, correct_attempts: 3 }, { topic: "Unknown", attempts: 2, correct_attempts: 2 }];
const STRENGTH = [
  { topic: "Neurologie", answered: 6, correct: 3 },
  { topic: "", answered: 1, correct: 1 },
  { topic: "Unknown", answered: 1, correct: 1 },
];
const LAST = [{ topic: "Neurologie", answered: 4, last_correct: 3 }];

function base(c: FakeCall): FakeResult | undefined {
  if (c.table === "rpc:get_topic_counts") return { data: COUNTS };
  if (c.table === "rpc:get_user_topic_progress") return { data: PROGRESS };
  if (c.table === "rpc:get_user_topic_attempt_stats") return { data: ATTEMPTS };
  if (c.table === "rpc:get_user_topic_last_correct") return { data: LAST };
  if (c.table === "user_topic_strength") return { data: STRENGTH };
  return { data: null };
}

const get = () => GET(new NextRequest(`https://medpruf.test/api/user/topic-progress?examType=${EXAM}`));
type Row = { topic: string; attempts: number; accuracy: number; lastCorrectPct: number | null; openMistakes: number | null };
const byTopic = async (res: Response) => Object.fromEntries(((await res.json()) as Row[]).map((r) => [r.topic, r]));

beforeEach(() => {
  h.calls.length = 0;
  h.handler = base;
  freeTier.resetTopicCountsCacheForTests();
});
afterEach(() => vi.unstubAllEnvs());

describe("get_user_topic_last_correct call (a-fo-10)", () => {
  it("calls the RPC with the live signature and uses its rows", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const call = h.calls.find((c) => c.table === "rpc:get_user_topic_last_correct");
    expect(call?.payload).toEqual({ p_user_id: USER, p_exam_type: EXAM });
    const rows = await byTopic(res);
    expect(rows.Neurologie.openMistakes).toBe(1);
    expect(rows.Neurologie.lastCorrectPct).not.toBeNull();
  });

  it("a schema-cache miss (PGRST202, HTTP 404) leaves the newest-attempt fields null, still 200", async () => {
    h.handler = (c) => (c.table === "rpc:get_user_topic_last_correct" ? { error: { code: "PGRST202", message: "Could not find the function" } } : base(c));
    const res = await get();
    expect(res.status).toBe(200);
    const rows = await byTopic(res);
    expect(rows.Neurologie.openMistakes).toBeNull();
    expect(rows.Neurologie.lastCorrectPct).toBeNull();
  });

  it("any other last_correct error is a 503", async () => {
    h.handler = (c) => (c.table === "rpc:get_user_topic_last_correct" ? { error: { code: "57014", message: "canceling statement due to statement timeout" } } : base(c));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get()).status).toBe(503);
  });
});

describe("TOPIC_STRENGTH_READS (a-fo-10)", () => {
  it("off (default): attempt stats come from get_user_topic_attempt_stats", async () => {
    const rows = await byTopic(await get());
    expect(h.calls.some((c) => c.table === "rpc:get_user_topic_attempt_stats")).toBe(true);
    expect(h.calls.some((c) => c.table === "user_topic_strength")).toBe(false);
    expect(rows.Neurologie).toMatchObject({ attempts: 6, accuracy: 50 });
  });

  it("on: one user_topic_strength read for this learner and exam, same numbers, '' grouped as Unknown", async () => {
    vi.stubEnv("TOPIC_STRENGTH_READS", "true");
    const offRows = await byTopic(await get());
    h.calls.length = 0;
    freeTier.resetTopicCountsCacheForTests();
    const rows = await byTopic(await get());
    expect(h.calls.some((c) => c.table === "rpc:get_user_topic_attempt_stats")).toBe(false);
    const read = h.calls.filter((c) => c.table === "user_topic_strength");
    expect(read).toHaveLength(1);
    expect(eqVal(read[0], "user_id")).toBe(USER);
    expect(eqVal(read[0], "exam_type")).toBe(EXAM);
    expect(rows.Neurologie).toMatchObject({ attempts: offRows.Neurologie.attempts, accuracy: offRows.Neurologie.accuracy });
    expect(rows.Unknown).toMatchObject({ attempts: 2, accuracy: 100 });
  });

  it("on: a failed table read is a 503, never a fall back to the RPC", async () => {
    vi.stubEnv("TOPIC_STRENGTH_READS", "true");
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.handler = (c) => (c.table === "user_topic_strength" ? { error: { code: "57014", message: "timeout" } } : base(c));
    expect((await get()).status).toBe(503);
    expect(h.calls.some((c) => c.table === "rpc:get_user_topic_attempt_stats")).toBe(false);
  });

  it("only the literal 'true' switches it on", async () => {
    vi.stubEnv("TOPIC_STRENGTH_READS", "1");
    await get();
    expect(h.calls.some((c) => c.table === "user_topic_strength")).toBe(false);
  });
});
