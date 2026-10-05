import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";
import { filterFreeAccessibleQuestions, logFreeCapHit, __resetCapHitThrottle } from "@/lib/free-access";
import { FREE_TIER_QUESTIONS_PER_EXAM } from "@/lib/free-tier";

// Exam "kmp_test": free slice = ids 1..150 (lowest active ids). Ids >= 1000
// exist but are outside the slice (they are what a trial unlocked).
const EXAM = "kmp_test"; // unique key so the 5-min slice cache cannot leak across files
const SLICE = Array.from({ length: FREE_TIER_QUESTIONS_PER_EXAM }, (_, i) => i + 1);

function world(answered: number[]) {
  return createFakeSupabase((c: FakeCall) => {
    if (c.table === "questions") {
      // slice query: order by id, limit 150
      if (c.limit === FREE_TIER_QUESTIONS_PER_EXAM) return { data: SLICE.map((id) => ({ id })) };
      const ids = (c.filters.find((f) => f.kind === "in")?.value as number[]) ?? [];
      return { data: ids.map((id) => ({ id, exam_type: EXAM })) };
    }
    if (c.table === "answer_history") {
      const inIds = c.filters.find((f) => f.kind === "in")?.value as number[] | undefined;
      const rows = (inIds ? answered.filter((q) => inIds.includes(q)) : answered).map((q) => ({ question_id: q }));
      return { data: rows };
    }
    if (c.table === "user_events") return {};
    return {};
  });
}

const trialAnswers = (n: number) => Array.from({ length: n }, (_, i) => 1000 + i);

describe("filterFreeAccessibleQuestions", () => {
  beforeEach(() => {
    process.env.FREE_TIER_ENFORCED = "true";
  });

  it("an uncapped free user can read slice questions but never non-slice ones", async () => {
    const { sb } = world([1, 2, 3]);
    const r = await filterFreeAccessibleQuestions(sb as unknown as SupabaseClient, "u1", [5, 6, 2000]);
    expect([...r.allowed].sort()).toEqual([5, 6]);
    expect(r.denied).toEqual([2000]);
  });

  it("answers made during a trial count toward the cap after it ends (871 answers -> capped)", async () => {
    // 23e66aa5-shaped: 871 distinct answers, all outside the slice, made in-trial.
    const { sb } = world(trialAnswers(871));
    const r = await filterFreeAccessibleQuestions(sb as unknown as SupabaseClient, "u2", [1, 2, 1000]);
    expect(r.allowed.size).toBe(0);
    expect(r.cappedExams).toEqual([EXAM]);
  });

  it("a capped user keeps re-read access to slice questions they already answered, nothing new", async () => {
    const { sb } = world([...trialAnswers(200), 7]);
    const r = await filterFreeAccessibleQuestions(sb as unknown as SupabaseClient, "u3", [7, 8]);
    expect([...r.allowed]).toEqual([7]);
    expect(r.denied).toEqual([8]);
  });

  it("guests get the slice only", async () => {
    const { sb } = world([]);
    const r = await filterFreeAccessibleQuestions(sb as unknown as SupabaseClient, null, [1, 999999]);
    expect([...r.allowed]).toEqual([1]);
  });
});

describe("logFreeCapHit", () => {
  it("writes one free_quota_cap_hit event per user/gate/exam per window", async () => {
    __resetCapHitThrottle();
    const { sb, calls } = world([]);
    await logFreeCapHit(sb as unknown as SupabaseClient, { userId: "u9", gate: "qbank_limit", route: "/api/questions", examType: EXAM });
    await logFreeCapHit(sb as unknown as SupabaseClient, { userId: "u9", gate: "qbank_limit", route: "/api/questions", examType: EXAM });
    const inserts = calls.filter((c) => c.table === "user_events" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as { event_type: string }).event_type).toBe("free_quota_cap_hit");
    expect(eqVal(inserts[0], "x")).toBeUndefined();
  });
});
