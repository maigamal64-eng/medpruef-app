import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createFakeSupabase, eqVal } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getServiceClient: vi.fn(), isPaidAccess: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.requireUser, isPaidAccess: mocks.isPaidAccess }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.getServiceClient }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { GET as weekly } from "@/app/api/user/weekly-progress/route";
import { GET as trend } from "@/app/api/history/exams/trend/route";

describe("GET /api/user/weekly-progress (LX-09)", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ userId: "owner-1" }); });
  it("reads only the signed-in learner's rows of the active exam, bounded by date", async () => {
    const fake = createFakeSupabase((call) => {
      if (call.table === "users") return { data: { active_exam: "kmp_innsbruck" } };
      const at = new Date(Date.now() - 60_000).toISOString();
      return { data: [{ created_at: at, is_correct: true }, { created_at: at, is_correct: false }] };
    });
    mocks.getServiceClient.mockReturnValue(fake.sb);
    const res = await weekly(new NextRequest("https://fixture.test/api/user/weekly-progress?userId=someone-else"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weeks).toHaveLength(12);
    expect(body.weeks.at(-1)).toMatchObject({ answered: 2, correct: 1 });
    const read = fake.calls.find((c) => c.table === "answer_history")!;
    expect(eqVal(read, "user_id")).toBe("owner-1");
    expect(eqVal(read, "questions.exam_type")).toBe("kmp_innsbruck");
    expect(read.filters.some((f) => f.kind === "gte" && f.column === "created_at")).toBe(true);
  });
  it("a database error is an error, never an empty chart", async () => {
    const fake = createFakeSupabase((call) => (call.table === "users" ? { data: { active_exam: "kenntnispruefung" } } : { error: { message: "down" } }));
    mocks.getServiceClient.mockReturnValue(fake.sb);
    const res = await weekly(new NextRequest("https://fixture.test/api/user/weekly-progress"));
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("weeks");
  });
  it("signed out: refused before any read", async () => {
    mocks.requireUser.mockResolvedValue({ error: NextResponse.json({ error: "Sign in" }, { status: 401 }) });
    const res = await weekly(new NextRequest("https://fixture.test/api/user/weekly-progress"));
    expect(res.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });
});

describe("GET /api/history/exams/trend (INF-04)", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ userId: "owner-2" }); });
  it("is Pro only", async () => {
    mocks.isPaidAccess.mockReturnValue(false);
    const res = await trend(new NextRequest("https://fixture.test/api/history/exams/trend"));
    expect(res.status).toBe(403);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });
  it("reads only the owner's completed runs and joins topics at read time", async () => {
    mocks.isPaidAccess.mockReturnValue(true);
    const fake = createFakeSupabase((call) => {
      if (call.table === "exam_simulations") return { data: [{ id: "x", exam_type: "kenntnispruefung", config: { part: "all" }, question_ids: [1, 2], grading: { "1": { is_correct: true } }, completed_at: "2026-10-01T10:00:00Z" }] };
      if (call.table === "questions") return { data: [{ id: 1, topic: "Neurologie" }, { id: 2, topic: "Neurologie" }] };
      return {};
    });
    mocks.getServiceClient.mockReturnValue(fake.sb);
    const res = await trend(new NextRequest("https://fixture.test/api/history/exams/trend"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fullRuns: 1, subjects: [] });
    const sims = fake.calls.find((c) => c.table === "exam_simulations")!;
    expect(eqVal(sims, "user_id")).toBe("owner-2");
    expect(eqVal(sims, "status")).toBe("completed");
    expect(fake.calls.find((c) => c.table === "questions")!.columns).toBe("id, topic");
  });
});
