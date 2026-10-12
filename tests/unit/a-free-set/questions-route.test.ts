/**
 * a-free-set: /api/questions for free callers against a small simulated bank.
 * Paywall safety (nothing outside new set + answered), the honest empty
 * state, the true 150 wall, and the curated opening.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { freeOpeningIds, freeSetIds, freeSetTopicsAtBuild, legacyFreeIds, resetOpeningCacheForTests } from "@/lib/free-set";

const EXAM = "kenntnispruefung";
const NEW = [...freeSetIds(EXAM)];
const LEGACY_ONLY = legacyFreeIds(EXAM).filter((id) => !NEW.includes(id));
const TOPIC_OF = freeSetTopicsAtBuild(EXAM);
const PSY = NEW.filter((id) => TOPIC_OF.get(id) === "Psychiatrie");
const OPENING = [...freeOpeningIds(EXAM)];

type Row = { id: number; topic: string; exam_type: string; is_active: boolean; question: string; answer: string; choices: unknown };
const row = (id: number, topic: string): Row => ({
  id, topic, exam_type: EXAM, is_active: true, question: `Q${id}`, answer: "A",
  choices: [{ text: "A", correct: true }, { text: "B", correct: false }, { text: "C", correct: false }],
});
const BANK: Row[] = [
  ...NEW.map((id) => row(id, TOPIC_OF.get(id)!)),
  ...LEGACY_ONLY.map((id) => row(id, "Augenheilkunde")),
  ...Array.from({ length: 40 }, (_, i) => row(900_000 + i, "Psychiatrie")),
  ...Array.from({ length: 10 }, (_, i) => row(910_000 + i, "Leeres Fach")),
];

const h = vi.hoisted(() => ({ answered: [] as number[], calls: [] as FakeCall[], tier: "free" }));
vi.mock("@/lib/auth-guard", () => ({ resolveOptionalUser: () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/free-access", async (orig) => ({ ...(await orig<typeof import("@/lib/free-access")>()), logFreeCapHit: vi.fn() }));

function applyFilters(rows: Row[], c: FakeCall): Row[] {
  let out = rows;
  for (const f of c.filters) {
    if (f.kind === "eq" && f.column in (rows[0] ?? {})) out = out.filter((r) => (r as Record<string, unknown>)[f.column] === f.value);
    if (f.kind === "in") out = out.filter((r) => (f.value as unknown[]).includes((r as Record<string, unknown>)[f.column]));
    if (f.kind === "not" && f.column === "id" && typeof f.value === "string") {
      const ex = f.value.replace(/[()]/g, "").split(",").map(Number);
      out = out.filter((r) => !ex.includes(r.id));
    }
  }
  return out;
}

vi.mock("@/lib/supabase", () => ({ getServiceClient: () => {
  const { sb, calls } = createFakeSupabase((c) => {
    if (c.table === "users") return { data: { id: "11111111-1111-4111-8111-111111111111", tier: h.tier, role: "user", tier_expires_at: null } };
    if (c.table === "answer_history") {
      const inIds = c.filters.find((f) => f.kind === "in")?.value as number[] | undefined;
      const notIn = c.filters.find((f) => f.kind === "not" && f.column === "question_id")?.value as string | undefined;
      const excluded = notIn ? notIn.replace(/[()]/g, "").split(",").map(Number) : [];
      const after = Number(c.filters.find((f) => f.kind === "gt" && f.column === "question_id")?.value ?? 0);
      const rows = (inIds ? h.answered.filter((q) => inIds.includes(q)) : h.answered).filter((q) => q > after && !excluded.includes(q)).sort((a, b) => a - b).map((q) => ({ question_id: q }));
      return { data: c.limit ? rows.slice(0, c.limit) : rows };
    }
    if (c.table === "questions") {
      const rows = applyFilters(BANK, c);
      return { data: rows, count: rows.length };
    }
    if (c.table === "rpc:get_study_question_ids") {
      const p = c.payload as { p_allowed_ids: number[] | null; p_topics: string[] | null; p_exclude_ids: number[]; p_limit: number };
      const ids = BANK.filter((r) => (!p.p_allowed_ids || p.p_allowed_ids.includes(r.id)) && (!p.p_topics || p.p_topics.includes(r.topic)) && !h.answered.includes(r.id) && !p.p_exclude_ids.includes(r.id))
        .slice(0, p.p_limit).map((r) => ({ question_id: r.id }));
      return { data: ids };
    }
    return { data: [] };
  });
  h.calls = calls;
  return sb;
} }));

import { GET } from "@/app/api/questions/route";
import { resetFreeSetLiveCacheForTests } from "@/lib/free-tier";

const get = async (query: string) => {
  const res = await GET(new NextRequest(`https://x/api/questions?examSource=${EXAM}&${query}`));
  return { status: res.status, body: await res.json() };
};
const servedIds = (body: unknown) => (Array.isArray(body) ? body.map((q: { id: number }) => q.id) : []);

beforeEach(() => {
  h.answered = [];
  h.tier = "free";
  process.env.FREE_TIER_ENFORCED = "true";
  resetFreeSetLiveCacheForTests();
  resetOpeningCacheForTests();
});

describe("a-free-set /api/questions", () => {
  it("a fresh free learner picking a non-Augenheilkunde topic gets free questions of that topic", async () => {
    h.answered = [999_999]; // history elsewhere: the opening steps aside
    const { status, body } = await get("practiceMode=unseen&topic=Psychiatrie&limit=5");
    expect(status).toBe(200);
    const ids = servedIds(body);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(PSY).toContain(id);
  });

  it("a topic without free questions answers free_topic_empty with other topics, never the 150 wall", async () => {
    h.answered = [999_999];
    const { body } = await get("practiceMode=unseen&topic=Leeres%20Fach");
    expect(body.paywallHit).toBeUndefined();
    expect(body.freeTopicEmpty).toBe(true);
    expect(body.reason).toBe("no_free_in_topic");
    expect(body.topics.length).toBeGreaterThan(0);
    expect(body.topics.length).toBeLessThanOrEqual(3);
    expect(body.topics.map((t: { topic: string }) => t.topic)).not.toContain("Leeres Fach");
    // The random (all) path says the same.
    const all = await get("practiceMode=all&topic=Leeres%20Fach");
    expect(all.body.freeTopicEmpty).toBe(true);
  });

  it("all free questions of a topic answered: all_seen, still not the wall", async () => {
    h.answered = [...PSY];
    const { body } = await get("practiceMode=unseen&topic=Psychiatrie");
    expect(body.freeTopicEmpty).toBe(true);
    expect(body.reason).toBe("all_seen");
    expect(body.topics.map((t: { topic: string }) => t.topic)).not.toContain("Psychiatrie");
  });

  it("the wall fires only at 150 distinct free answers (old and new set counted)", async () => {
    h.answered = [...LEGACY_ONLY.slice(0, 100), ...NEW.filter((id) => !LEGACY_ONLY.includes(id) && !legacyFreeIds(EXAM).includes(id)).slice(0, 49)];
    expect((await get("practiceMode=unseen&topic=Leeres%20Fach")).body.paywallHit).toBeUndefined();
    h.answered = [...LEGACY_ONLY.slice(0, 100), ...NEW.filter((id) => !legacyFreeIds(EXAM).includes(id)).slice(0, 50)];
    const capped = await get("practiceMode=unseen&topic=Psychiatrie");
    expect(capped.body.paywallHit).toBe(true);
    expect(capped.body.seen).toBe(150);
    expect((await get("practiceMode=all")).body.paywallHit).toBe(true);
  });

  it("the random path serves only readable ids: new set plus answered old-slice questions", async () => {
    h.answered = [LEGACY_ONLY[0], 999_999];
    const { body } = await get("practiceMode=all&limit=200");
    const ids = servedIds(body);
    expect(ids.length).toBeGreaterThan(0);
    const readable = new Set([...NEW, LEGACY_ONLY[0]]);
    for (const id of ids) expect(readable.has(id)).toBe(true);
    expect(ids).not.toContain(LEGACY_ONLY[1]);
    expect(ids.some((id) => id >= 900_000)).toBe(false);
  });

  it("a deep link outside the free set returns no content and no false wall", async () => {
    h.answered = [999_999];
    const { body } = await get(`ids=900001,${LEGACY_ONLY[1]}`);
    expect(Array.isArray(body)).toBe(false);
    expect(body.freeTopicEmpty).toBe(true);
    expect(body.paywallHit).toBeUndefined();
    const ok = await get(`ids=${NEW[0]}`);
    expect(servedIds(ok.body)).toEqual([NEW[0]]);
  });

  it("countOnly counts readable questions only", async () => {
    const { body } = await get("countOnly=1&topic=Psychiatrie");
    expect(body.count).toBe(PSY.length);
  });

  it("a learner with no answer in the bank gets the curated opening first, in order", async () => {
    const first = await get("practiceMode=unseen");
    expect(servedIds(first.body)).toEqual([OPENING[0]]);
    const second = await get(`practiceMode=unseen&excludeIds=${OPENING[0]}`);
    expect(servedIds(second.body)).toEqual([OPENING[1]]);
    h.answered = [OPENING[0], OPENING[1]];
    const third = await get(`practiceMode=unseen&excludeIds=${OPENING[0]},${OPENING[1]}`);
    expect(servedIds(third.body)).toEqual([OPENING[2]]);
    // An answer outside the opening means normal order (the study RPC answers).
    h.answered = [999_999];
    h.calls = [];
    const normal = await get("practiceMode=unseen");
    expect(servedIds(normal.body)).not.toEqual([OPENING[0]]);
    // A topic filter never uses the opening.
    h.answered = [];
    const topic = await get("practiceMode=unseen&topic=Psychiatrie");
    for (const id of servedIds(topic.body)) expect(PSY).toContain(id);
  });

  it("a Pro learner with no answer in the bank also starts with the opening; one answered elsewhere does not", async () => {
    h.tier = "admin";
    expect(servedIds((await get("practiceMode=unseen")).body)).toEqual([OPENING[0]]);
    resetOpeningCacheForTests();
    h.answered = [900_001];
    expect(servedIds((await get("practiceMode=unseen")).body)).not.toEqual([OPENING[0]]);
    // A session that already had a non-opening question skips the history reads.
    resetOpeningCacheForTests();
    h.answered = [];
    h.calls.length = 0;
    await get("practiceMode=unseen&excludeIds=900002");
    expect(h.calls.some((c) => c.table === "answer_history")).toBe(false);
  });

  it("an unknown exam value falls back to the default exam set, never a false wall", async () => {
    h.answered = [999_999];
    const res = await GET(new NextRequest("https://x/api/questions?examSource=bogus&practiceMode=all&limit=200"));
    const body = await res.json();
    expect(body.paywallHit).toBeUndefined();
    for (const id of servedIds(body)) expect(NEW).toContain(id);
  });

  it("paid callers are not restricted and get no free fields", async () => {
    h.tier = "admin";
    h.answered = [999_999];
    const { body } = await get("practiceMode=all&topic=Leeres%20Fach&limit=200");
    expect(servedIds(body).length).toBe(10);
  });
});
