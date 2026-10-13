import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";
import { filterFreeAccessibleQuestions, logFreeCapHit, __resetCapHitThrottle } from "@/lib/free-access";
import { freeSetIds, legacyFreeIds } from "@/lib/free-set";

// a-free-set: the free set is committed data. Kenntnisprüfung: NEW = the
// spread set, LEGACY = the old 150 lowest ids (frozen). Some ids are in both.
const EXAM = "kenntnispruefung";
const NEW = [...freeSetIds(EXAM)];
const LEGACY = [...legacyFreeIds(EXAM)];
const LEGACY_ONLY = LEGACY.filter((id) => !NEW.includes(id));
const NEW_ONLY = NEW.filter((id) => !LEGACY.includes(id));
const OUTSIDE = 999_000; // never free

function world(answered: number[]) {
  return createFakeSupabase((c: FakeCall) => {
    if (c.table === "questions") {
      const ids = (c.filters.find((f) => f.kind === "in")?.value as number[]) ?? [];
      return { data: ids.map((id) => ({ id, exam_type: EXAM })) };
    }
    if (c.table === "answer_history") {
      const inIds = c.filters.find((f) => f.kind === "in")?.value as number[] | undefined;
      const after = Number(c.filters.find((f) => f.kind === "gt" && f.column === "question_id")?.value ?? 0);
      const rows = (inIds ? answered.filter((q) => inIds.includes(q)) : answered).filter((q) => q > after).sort((a, b) => a - b).map((q) => ({ question_id: q }));
      return { data: rows };
    }
    if (c.table === "user_events") return {};
    return {};
  });
}

const outsideAnswers = (n: number) => Array.from({ length: n }, (_, i) => OUTSIDE + i);
const read = (sb: unknown, user: string | null, ids: number[]) => filterFreeAccessibleQuestions(sb as SupabaseClient, user, ids);

describe("filterFreeAccessibleQuestions (free set + legacy rule)", () => {
  beforeEach(() => {
    process.env.FREE_TIER_ENFORCED = "true";
  });

  it("an uncapped free user reads new-set questions, never questions outside the set", async () => {
    const { sb } = world([]);
    const r = await read(sb, "u1", [NEW_ONLY[0], NEW_ONLY[1], OUTSIDE]);
    expect([...r.allowed].sort((a, b) => a - b)).toEqual([NEW_ONLY[0], NEW_ONLY[1]].sort((a, b) => a - b));
    expect(r.denied).toEqual([OUTSIDE]);
  });

  it("an old-slice question the learner already answered stays readable; an unanswered one does not", async () => {
    const { sb } = world([LEGACY_ONLY[0]]);
    const r = await read(sb, "u2", [LEGACY_ONLY[0], LEGACY_ONLY[1]]);
    expect([...r.allowed]).toEqual([LEGACY_ONLY[0]]);
    expect(r.denied).toEqual([LEGACY_ONLY[1]]);
  });

  it("answers outside both sets count toward the cap (2 Oct rule: 871 trial answers cap the learner)", async () => {
    const { sb } = world(outsideAnswers(871));
    const r = await read(sb, "u3", [NEW_ONLY[0], OUTSIDE]);
    expect([...r.allowed]).toEqual([]);
    expect(r.cappedExams).toEqual([EXAM]);
  });

  it("149 answers in the exam, some outside the free set, are not capped", async () => {
    const { sb } = world([...NEW_ONLY.slice(0, 49), ...outsideAnswers(100)]);
    const r = await read(sb, "u3b", [NEW_ONLY[60]]);
    expect(r.allowed.has(NEW_ONLY[60])).toBe(true);
    expect(r.cappedExams).toEqual([]);
  });

  it("149 distinct free answers (old and new set mixed) are not capped", async () => {
    const answered = [...LEGACY_ONLY.slice(0, 100), ...NEW_ONLY.slice(0, 49)];
    const { sb } = world(answered);
    const r = await read(sb, "u4", [NEW_ONLY[60]]);
    expect(r.allowed.has(NEW_ONLY[60])).toBe(true);
    expect(r.cappedExams).toEqual([]);
  });

  it("150 distinct free answers cap the learner: answered free questions stay readable, nothing new", async () => {
    const answered = [...LEGACY_ONLY.slice(0, 100), ...NEW_ONLY.slice(0, 50)];
    const { sb } = world(answered);
    const r = await read(sb, "u5", [LEGACY_ONLY[0], NEW_ONLY[0], NEW_ONLY[70], LEGACY_ONLY[101]]);
    expect([...r.allowed].sort((a, b) => a - b)).toEqual([LEGACY_ONLY[0], NEW_ONLY[0]].sort((a, b) => a - b));
    expect(r.cappedExams).toEqual([EXAM]);
  });

  it("guests read the new set only", async () => {
    const { sb } = world([]);
    const r = await read(sb, null, [NEW[0], LEGACY_ONLY[0], OUTSIDE]);
    expect([...r.allowed]).toEqual([NEW[0]]);
  });

  it("with enforcement off nobody is capped, the set bound still holds", async () => {
    process.env.FREE_TIER_ENFORCED = "false";
    const { sb } = world([...LEGACY_ONLY, ...NEW_ONLY]);
    const r = await read(sb, "u6", [NEW_ONLY[0], OUTSIDE]);
    expect([...r.allowed]).toEqual([NEW_ONLY[0]]);
    expect(r.cappedExams).toEqual([]);
  });

  it("a failed history read keeps the learner inside the new set (no legacy, no cap)", async () => {
    const { sb } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "questions") {
        const ids = (c.filters.find((f) => f.kind === "in")?.value as number[]) ?? [];
        return { data: ids.map((id) => ({ id, exam_type: EXAM })) };
      }
      if (c.table === "answer_history") return { error: { code: "42501", message: "permission denied" } };
      return {};
    });
    const r = await read(sb, "u7", [NEW_ONLY[0], LEGACY_ONLY[0]]);
    expect([...r.allowed]).toEqual([NEW_ONLY[0]]);
  });

  // a-db-relief-1 (skeptic HIGH): an unavailable database is not a denial.
  it.each([
    ["statement timeout (57014)", { code: "57014", message: "canceling statement due to statement timeout" }],
    ["deadline (DbUnavailableError shape)", { message: "DbUnavailableError: Database did not answer within 8000 ms" }],
  ])("throws DbUnavailableError when the history read hits a %s", async (_label, error) => {
    const { sb } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "questions") {
        const ids = (c.filters.find((f) => f.kind === "in")?.value as number[]) ?? [];
        return { data: ids.map((id) => ({ id, exam_type: EXAM })) };
      }
      if (c.table === "answer_history") return { error };
      return {};
    });
    await expect(read(sb, "u7", [NEW_ONLY[0], LEGACY_ONLY[0]])).rejects.toMatchObject({ name: "DbUnavailableError" });
  });

  it("throws DbUnavailableError when the questions read is unavailable (never denies every id)", async () => {
    const { sb } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "questions") return { error: { message: "DbUnavailableError: Database unreachable: fetch failed" } };
      return {};
    });
    await expect(read(sb, "u7", [NEW_ONLY[0]])).rejects.toMatchObject({ name: "DbUnavailableError" });
  });
});

describe("logFreeCapHit", () => {
  it("writes one paywall_hit event per user/gate/exam per window", async () => {
    __resetCapHitThrottle();
    const { sb, calls } = world([]);
    await logFreeCapHit(sb as unknown as SupabaseClient, { userId: "u9", gate: "qbank_limit", route: "/api/questions", examType: EXAM });
    await logFreeCapHit(sb as unknown as SupabaseClient, { userId: "u9", gate: "qbank_limit", route: "/api/questions", examType: EXAM });
    const inserts = calls.filter((c) => c.table === "user_events" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as { event_type: string }).event_type).toBe("paywall_hit");
    expect(eqVal(inserts[0], "x")).toBeUndefined();
  });
});
