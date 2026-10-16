import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), rate: vi.fn(), gm: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.guard }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/gm-practice/availability", () => ({ getGmAvailability: mocks.gm }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

import { GET, POST } from "@/app/api/results-route/route";

const USER = "00000000-0000-4000-8000-0000000000c1";

function req(method: "GET" | "POST", body?: unknown) {
  return new NextRequest("https://medpruf.com/api/results-route", { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
}
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
interface Opts { examDate?: string | null; activeExam?: string | null; referrals?: boolean; answered?: boolean; events?: unknown[]; l5?: boolean; testimonialSent?: boolean }
const L5_ROWS = Array.from({ length: 24 }, (_, i) => ({ question_id: 100 + i, created_at: i % 2 ? "2026-09-01T10:00:00Z" : "2026-09-02T10:00:00Z" }));
function learner(o: Opts = {}): FakeHandler {
  return (c: FakeCall) => {
    if (c.table === "users") return { data: { exam_date: o.examDate === undefined ? "2026-09-23" : o.examDate, active_exam: o.activeExam ?? "kmp_innsbruck", referrals_enabled: o.referrals ?? false } };
    if (c.table === "answer_history" && c.columns?.includes("question_id")) return { data: o.l5 ? L5_ROWS : [] };
    if (c.table === "answer_history") return { data: o.answered === false ? [] : [{ id: 1 }] };
    if (c.table === "user_feedback") return { data: o.testimonialSent ? [{ id: 3 }] : [] };
    if (c.table === "user_events" && c.op === "select") return { data: o.events ?? [] };
    if (c.table === "user_events" && c.op === "insert") return { data: null };
    if (c.table === "user_feedback" || c.table === "ai_credit_lot" || c.table === "subscriptions") return { data: [] };
    return {};
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
  mocks.guard.mockResolvedValue({ userId: USER, role: "user", tier: "free" });
  mocks.rate.mockReturnValue({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 });
  mocks.gm.mockResolvedValue({ available: false, active: null });
  vi.stubEnv("RESULTS_ROUTE_ENABLED", "true");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("GET /api/results-route", () => {
  it("is dark without a read while the flag is off", async () => {
    vi.stubEnv("RESULTS_ROUTE_ENABLED", "");
    const { calls } = database(learner());
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: false });
    expect(calls).toHaveLength(0);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
  it("is dark on a blackout day", async () => {
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    const { calls } = database(learner());
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: false });
    expect(calls).toHaveLength(0);
  });
  it("asks a September Stichprobentest sitter which exams follow, with the official page", async () => {
    database(learner());
    const body = await (await GET(req("GET"))).json();
    expect(body.enabled).toBe(true);
    expect(body.official.url).toMatch(/^https:\/\/www\.meduniwien\.ac\.at\//);
    expect(body.sittings).toEqual([expect.objectContaining({ key: "stichprobentest:2026-09-23", kind: "spt", ask: true, answer: null, plan: null })]);
  });
  it("needs activity before the sitting, with or without a matching exam date (Vienna day bounds)", async () => {
    for (const examDate of [null, "2026-09-23"]) {
      database(learner({ examDate, answered: false }));
      expect((await (await GET(req("GET"))).json()).sittings).toEqual([]);
    }
    const { calls } = database(learner({ examDate: null, answered: true }));
    expect((await (await GET(req("GET"))).json()).sittings).toHaveLength(1);
    const ah = calls.find((c) => c.table === "answer_history")!;
    expect(ah.filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "user_id", value: USER }, { kind: "gte", column: "created_at", value: "2026-06-24T22:00:00.000Z" }, { kind: "lt", column: "created_at", value: "2026-09-23T22:00:00.000Z" }]));
  });
  it("shows the stored route of the newest answer and reads no testimonial state while that reward is off", async () => {
    const { calls } = database(learner({ referrals: true, events: [
      { event_data: { sitting_key: "stichprobentest:2026-09-23", exam_key: "stichprobentest", outcome: "rez_gm" }, created_at: "2026-11-02T10:00:00Z" },
    ] }));
    const s = (await (await GET(req("GET"))).json()).sittings[0];
    expect(s).toMatchObject({ ask: false, answer: { outcome: "rez_gm" }, plan: { next: ["pharma"], testimonial: false, referral: true } });
    expect(calls.some((c) => c.table === "user_feedback" || c.table === "ai_credit_lot")).toBe(false);
    const ev = calls.find((c) => c.table === "user_events")!;
    expect(ev.filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "event_data->>sitting_key", value: "stichprobentest:2026-09-23" }]));
    expect(ev.limit).toBe(1);
  });
  it("a 'not here yet' answer is asked again after a week; it never reads testimonial state", async () => {
    vi.stubEnv("MENTOR_EXPERIENCE_REWARD_ENABLED", "true");
    const ev = (at: string) => [{ event_data: { sitting_key: "stichprobentest:2026-09-23", exam_key: "stichprobentest", outcome: "waiting" }, created_at: at }];
    let fake = database(learner({ events: ev("2026-11-01T10:00:00Z") }));
    expect((await (await GET(req("GET"))).json()).sittings[0]).toMatchObject({ ask: false, answer: { outcome: "waiting" } });
    expect(fake.calls.some((c) => c.table === "user_feedback")).toBe(false);
    fake = database(learner({ events: ev("2026-10-28T09:00:00Z") }));
    expect((await (await GET(req("GET"))).json()).sittings[0]).toMatchObject({ ask: true });
  });
  it("rate-limits reads per learner", async () => {
    database(learner());
    mocks.rate.mockReturnValue({ allowed: false, remaining: 0, resetAt: 0, retryAfterSec: 30 });
    expect((await GET(req("GET"))).status).toBe(429);
  });
  it("offers the testimonial only while the experience reward is on and the learner can still send one", async () => {
    vi.stubEnv("MENTOR_EXPERIENCE_REWARD_ENABLED", "true");
    database(learner({ events: [{ event_data: { sitting_key: "stichprobentest:2026-09-23", exam_key: "stichprobentest", outcome: "rez_gm" }, created_at: "2026-11-02T10:00:00Z" }] }));
    // Below the L5 bar (no answers, never paid): no testimonial ask.
    expect((await (await GET(req("GET"))).json()).sittings[0].plan.testimonial).toBe(false);
    const events = [{ event_data: { sitting_key: "stichprobentest:2026-09-23", exam_key: "stichprobentest", outcome: "rez_gm" }, created_at: "2026-11-02T10:00:00Z" }];
    database(learner({ events, l5: true }));
    expect((await (await GET(req("GET"))).json()).sittings[0].plan.testimonial).toBe(true);
    database(learner({ events, l5: true, testimonialSent: true }));
    expect((await (await GET(req("GET"))).json()).sittings[0].plan.testimonial).toBe(false);
    vi.stubEnv("MENTOR_EXPERIENCE_REWARD_ENABLED", "");
    database(learner({ events, l5: true }));
    expect((await (await GET(req("GET"))).json()).sittings[0].plan.testimonial).toBe(false);
  });
});

describe("POST /api/results-route", () => {
  it("is 404 while the flag is off", async () => {
    vi.stubEnv("RESULTS_ROUTE_ENABLED", "");
    database(learner());
    expect((await POST(req("POST", { sitting_key: "stichprobentest:2026-09-23", outcome: "rez_gm" }))).status).toBe(404);
  });
  it("stores result_reported in user_events and returns the route", async () => {
    const { calls } = database(learner({ referrals: true }));
    const res = await POST(req("POST", { sitting_key: "stichprobentest:2026-09-23", outcome: "rez_gm_sip" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, outcome: "rez_gm_sip", plan: { next: ["pharma", "kenntnispruefung"], officialNext: true, referral: false, testimonial: false } });
    const insert = calls.filter((c) => c.op !== "select");
    expect(insert).toHaveLength(1);
    // Everything the response needs is read before the row is written.
    expect(calls.at(-1)).toBe(insert[0]);
    expect(insert[0]).toMatchObject({ table: "user_events", op: "insert", payload: { user_id: USER, event_type: "result_reported", event_data: { sitting_key: "stichprobentest:2026-09-23", exam_key: "stichprobentest", outcome: "rez_gm_sip", need: "more_to_do", source: "settings_exam_report_card" } } });
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
  });
  it("refuses a pass or fail answer for the Stichprobentest", async () => {
    for (const outcome of ["passed", "not_all_passed", "failed"]) {
      const { calls } = database(learner());
      expect((await POST(req("POST", { sitting_key: "stichprobentest:2026-09-23", outcome }))).status).toBe(400);
      expect(calls.some((c) => c.op === "insert")).toBe(false);
    }
  });
  it("refuses a sitting the learner is not asked about", async () => {
    for (const key of ["sip4a:2026-11-18", "stichprobentest:2027-02-03", "nope"]) {
      const { calls } = database(learner());
      expect((await POST(req("POST", { sitting_key: key, outcome: "waiting" }))).status).toBe(409);
      expect(calls.some((c) => c.op === "insert")).toBe(false);
    }
  });
  it("validates the body and rate-limits per learner", async () => {
    database(learner());
    expect((await POST(req("POST", { outcome: "rez_gm" }))).status).toBe(400);
    mocks.rate.mockReturnValue({ allowed: false, remaining: 0, resetAt: 0, retryAfterSec: 60 });
    expect((await POST(req("POST", { sitting_key: "stichprobentest:2026-09-23", outcome: "rez_gm" }))).status).toBe(429);
  });
});
