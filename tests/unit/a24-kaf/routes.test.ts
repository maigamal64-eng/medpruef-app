import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Result = { data: unknown; error: { code?: string } | null };
const h = vi.hoisted(() => ({
  guard: { userId: "u1", role: "user", tier: "pro", tierExpiresAt: null } as Record<string, unknown> | "unauth",
  paid: true,
  results: {} as Record<string, Result>,
  calls: [] as { table: string; select: string; filters: unknown[] }[],
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => (h.guard === "unauth" ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } : h.guard),
  isPaidAccess: () => h.paid,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from(table: string) {
      const call = { table, select: "", filters: [] as unknown[] };
      h.calls.push(call);
      const chain: Record<string, unknown> = {
        select(cols: string) { call.select = cols; return chain; },
        eq(...a: unknown[]) { call.filters.push(["eq", ...a]); return chain; },
        in(...a: unknown[]) { call.filters.push(["in", ...a]); return chain; },
        order() { return chain; },
        range() { return chain; },
        then(resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve(h.results[table] ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/exam/kaf-pool/route";
import { POST } from "@/app/api/exam/kaf-pool/answers/route";

const get = (qs = "") => GET(new NextRequest(`https://medpruf.test/api/exam/kaf-pool${qs}`));
const post = (body: unknown) => POST(new NextRequest("https://medpruf.test/api/exam/kaf-pool/answers", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
}));

const ITEMS = Array.from({ length: 5 }, (_, i) => ({
  question_id: 100 + i, required: 1, accepted: [["A" + i, "B" + i]], model_answer: "A" + i, key_points: ["K" + i],
}));
const QUESTIONS = ITEMS.slice(0, 4).map((r) => ({ id: r.question_id, topic: "Innere Medizin", question: `Stem ${r.question_id}`, image_url: null }));

beforeEach(() => {
  process.env.KAF_TIMED_ENABLED = "true";
  h.guard = { userId: "u1", role: "user", tier: "pro", tierExpiresAt: null };
  h.paid = true;
  h.calls.length = 0;
  h.results = { kaf_items: { data: ITEMS, error: null }, questions: { data: QUESTIONS, error: null } };
});
afterEach(() => { delete process.env.KAF_TIMED_ENABLED; });

describe("GET /api/exam/kaf-pool", () => {
  it("401 without a session", async () => {
    h.guard = "unauth";
    expect((await get()).status).toBe(401);
  });
  it("404 KAF_DISABLED unless the flag is exactly 'true', before any read", async () => {
    process.env.KAF_TIMED_ENABLED = "1";
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "KAF_DISABLED" });
    expect(h.calls).toHaveLength(0);
  });
  it("403 PRO_REQUIRED for free accounts", async () => {
    h.paid = false;
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PRO_REQUIRED" });
    expect(h.calls).toHaveLength(0);
  });
  it("counts only items whose question is active in the Kenntnisprüfung bank", async () => {
    const res = await get("?countOnly=1");
    expect(await res.json()).toEqual({ count: 4 });
    const q = h.calls.find((c) => c.table === "questions")!;
    expect(q.filters).toContainEqual(["eq", "is_active", true]);
    expect(q.filters).toContainEqual(["eq", "exam_type", "kenntnispruefung"]);
    expect(h.calls.find((c) => c.table === "kaf_items")!.filters).toContainEqual(["eq", "is_active", true]);
  });
  it("serves stems without options or accepted answers, capped by limit", async () => {
    const res = await get("?limit=2");
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["id", "image_url", "required", "stem", "topic"]);
      expect(item.stem).toBe(`Stem ${item.id}`);
    }
    expect(h.calls.find((c) => c.table === "kaf_items")!.select).not.toMatch(/accepted|model_answer/);
    expect(h.calls.find((c) => c.table === "questions")!.select).toBe("id, topic, question, image_url");
  });
  it.each(["42P01", "PGRST205"])("503 KAF_POOL_UNAVAILABLE when the table is missing (%s)", async (code) => {
    h.results.kaf_items = { data: null, error: { code } };
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "KAF_POOL_UNAVAILABLE" });
  });
  it("500 on other read errors", async () => {
    h.results.questions = { data: null, error: { code: "XX000" } };
    expect((await get()).status).toBe(500);
  });
});

describe("POST /api/exam/kaf-pool/answers", () => {
  it("is gated like the pool route", async () => {
    process.env.KAF_TIMED_ENABLED = "false";
    expect((await post({ ids: [100] })).status).toBe(404);
    process.env.KAF_TIMED_ENABLED = "true";
    h.paid = false;
    expect((await post({ ids: [100] })).status).toBe(403);
  });
  it("validates ids", async () => {
    expect((await post({ ids: [] })).status).toBe(400);
    expect((await post({ ids: Array.from({ length: 61 }, (_, i) => i + 1) })).status).toBe(400);
    expect((await post({ ids: ["x"] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
  it("returns keys only for ids in the pool", async () => {
    // The database narrows kaf_items to the requested ids; 104's question is not active.
    h.results.kaf_items = { data: [ITEMS[0], ITEMS[4]], error: null };
    h.results.questions = { data: [QUESTIONS[0]], error: null };
    const res = await post({ ids: [100, 104, 999] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["100"]);
    expect(body["100"]).toEqual({ accepted: [["A0", "B0"]], model_answer: "A0", key_points: ["K0"] });
    expect(h.calls.find((c) => c.table === "kaf_items")!.filters).toContainEqual(["in", "question_id", [100, 104, 999]]);
  });
  it("503 when the table is missing", async () => {
    h.results.kaf_items = { data: null, error: { code: "PGRST205" } };
    expect((await post({ ids: [100] })).status).toBe(503);
  });
});
