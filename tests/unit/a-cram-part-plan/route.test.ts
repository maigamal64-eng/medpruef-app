import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { VIENNA_EXAM_PARTS } from "@/lib/topics";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth-guard", async (orig) => ({ ...(await orig<typeof import("@/lib/auth-guard")>()), requireUser: mocks.guard }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), withScope: vi.fn() }));
import { GET } from "@/app/api/user/study-plan/route";
import { resetTopicCountsCacheForTests } from "@/lib/free-tier";

const OWNER = "33333333-3333-4333-8333-333333333333";
const TEN = [...VIENNA_EXAM_PARTS.sip4, ...VIENNA_EXAM_PARTS.sip5];
const request = () => new NextRequest("https://fixture.invalid/api/user/study-plan");

function handler(examDate: string, runs: unknown[] = []) {
  return (call: FakeCall): FakeResult => {
    if (call.table === "users") return { data: { exam_date: examDate, daily_goal: 30, active_exam: "kenntnispruefung" } };
    if (call.table === "rpc:get_topic_counts") return { data: TEN.map((topic) => ({ topic, count: 300 })) };
    if (call.table === "exam_simulations") return { data: runs };
    if (call.table === "questions") return { data: [{ id: 1, topic: "Innere Medizin" }, { id: 2, topic: "Innere Medizin" }, { id: 3, topic: "Chirurgische Fächer" }] };
    return { data: [] };
  };
}

const paid = { userId: OWNER, role: "user", tier: "pro", tierExpiresAt: "2026-12-31T00:00:00Z" };
const free = { userId: OWNER, role: "user", tier: "free", tierExpiresAt: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
  vi.clearAllMocks();
  resetTopicCountsCacheForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const topicsOf = (json: { plan: { dailySchedule: Array<{ topics: Array<{ topic: string }> }> } }) =>
  new Set(json.plan.dailySchedule.flatMap((d) => d.topics.map((t) => t.topic)));

describe("study-plan route, CRAM_PART_PLAN_ENABLED", () => {
  it("off: no cram block, all ten subjects, the full run, no exam_simulations read", async () => {
    mocks.guard.mockResolvedValue(paid);
    const fake = createFakeSupabase(handler("2026-11-18"));
    mocks.client.mockReturnValue(fake.sb);
    const json = await (await GET(request())).json();
    expect(json).not.toHaveProperty("cram");
    expect(topicsOf(json).size).toBeGreaterThan(3);
    expect(json.plan.dailySchedule.some((d: { drill?: unknown }) => d.drill)).toBe(false);
    expect(fake.calls.some((c) => c.table === "exam_simulations")).toBe(false);
  });

  it("on, SIP4a sitter, paid: part subjects only, kp_sip4 runs, drill from the learner's own run", async () => {
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    mocks.guard.mockResolvedValue(paid);
    const run = { question_ids: [1, 2, 3], grading: { "1": { is_correct: false }, "2": { is_correct: false }, "3": { is_correct: true } }, config: { presetId: "kp_sip4", kind: "mcq" }, completed_at: "2026-10-27T15:00:00Z" };
    const fake = createFakeSupabase(handler("2026-11-18", [run]));
    mocks.client.mockReturnValue(fake.sb);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cram).toMatchObject({ part: "sip4", presetId: "kp_sip4", examKey: "sip4a", date: "2026-11-18", days: "d21_29", kaf: false, latestRun: { day: "2026-10-27", weak: ["Innere Medizin"] } });
    expect([...topicsOf(json)].every((t) => VIENNA_EXAM_PARTS.sip4.includes(t))).toBe(true);
    const sims = json.plan.dailySchedule.filter((d: { simulation?: { presetId: string } }) => d.simulation);
    expect(sims.map((d: { day: string }) => d.day)).toEqual(["2026-11-04", "2026-11-11"]);
    expect(sims.every((d: { simulation: { presetId: string } }) => d.simulation.presetId === "kp_sip4")).toBe(true);
    // Yesterday's run makes today a drill day on Innere Medizin.
    expect(json.plan.dailySchedule[0]).toMatchObject({ day: "2026-10-28", drill: { state: "blocks", blocks: ["Innere Medizin"] } });
    const read = fake.calls.find((c) => c.table === "exam_simulations")!;
    expect(read.filters).toContainEqual({ kind: "eq", column: "user_id", value: OWNER });
    expect(read.filters).toContainEqual({ kind: "in", column: "config->>presetId", value: ["kp_sip4"] });
    expect(read.limit).toBeLessThanOrEqual(3);
    expect(fake.calls.every((c) => c.op === "select")).toBe(true);
  });

  it("on, KAF live: the SIP4a block says so; SIP5a never", async () => {
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    vi.stubEnv("KAF_TIMED_ENABLED", "true");
    mocks.guard.mockResolvedValue(paid);
    mocks.client.mockReturnValue(createFakeSupabase(handler("2026-11-18")).sb);
    expect((await (await GET(request())).json()).cram.kaf).toBe(true);
    resetTopicCountsCacheForTests();
    mocks.client.mockReturnValue(createFakeSupabase(handler("2026-11-17")).sb);
    expect((await (await GET(request())).json()).cram).toMatchObject({ part: "sip5", kaf: false });
  });

  it("on, free account: part plan and run days (gated in the page), but no run read and no drill days", async () => {
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    mocks.guard.mockResolvedValue(free);
    const fake = createFakeSupabase(handler("2026-11-17"));
    mocks.client.mockReturnValue(fake.sb);
    const json = await (await GET(request())).json();
    expect(json.cram).toMatchObject({ part: "sip5", latestRun: null });
    expect(fake.calls.some((c) => c.table === "exam_simulations")).toBe(false);
    expect(json.plan.dailySchedule.some((d: { drill?: unknown }) => d.drill)).toBe(false);
  });

  it("on, a date that names both parts (10 Mar 2027, window unconfirmed): today's all-subject plan, part all", async () => {
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    mocks.guard.mockResolvedValue(paid);
    const fake = createFakeSupabase(handler("2027-03-10"));
    mocks.client.mockReturnValue(fake.sb);
    const json = await (await GET(request())).json();
    expect(json.cram).toEqual({ part: "all", days: "d30plus" });
    expect(topicsOf(json).size).toBeGreaterThan(3);
    expect(fake.calls.some((c) => c.table === "exam_simulations")).toBe(false);
  });

  it("on, a failed run read: the plan still answers, without drill data", async () => {
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    mocks.guard.mockResolvedValue(paid);
    const base = handler("2026-11-18");
    mocks.client.mockReturnValue(createFakeSupabase((c) => (c.table === "exam_simulations" ? { error: { code: "42P01", message: "boom" } } : base(c))).sb);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).cram).toMatchObject({ part: "sip4", latestRun: null });
  });
});
