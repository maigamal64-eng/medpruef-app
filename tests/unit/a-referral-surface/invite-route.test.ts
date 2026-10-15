import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
const h = vi.hoisted(() => ({
  guard: { userId: "u1", profile: { referralsEnabled: true } } as Record<string, unknown> | "unauth",
  results: {} as Record<string, Result>,
  updates: [] as unknown[],
  calls: [] as { table: string; select: string; filters: unknown[] }[],
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => (h.guard === "unauth" ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } : h.guard),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from(table: string) {
      const call = { table, select: "", filters: [] as unknown[] };
      h.calls.push(call);
      let result: Result = h.results[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {
        select(cols: string) { call.select = cols; return chain; },
        update(v: unknown) { h.updates.push(v); result = { data: null, error: null }; return chain; },
        eq(...a: unknown[]) { call.filters.push(["eq", ...a]); return chain; },
        gte(...a: unknown[]) { call.filters.push(["gte", ...a]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return Promise.resolve(result); },
        then(resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(result).then(resolve, reject); },
      };
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/referrals/invite/route";

let n = 0;
const get = (qs = "") => GET(new NextRequest(`https://medpruf.test/api/referrals/invite${qs}`));

beforeEach(() => {
  n++;
  process.env.REFERRAL_SURFACE_ENABLED = "true";
  process.env.REFERRAL_EXAM_REWARD_ENABLED = "true";
  process.env.REFERRAL_MENTOR_CREDITS_ENABLED = "true";
  process.env.AI_FEATURES_ENABLED = "true";
  process.env.MENTOR_ENABLED = "true";
  process.env.MENTOR_ACCESS_SCOPE = "signed_in";
  h.guard = { userId: `u${n}`, profile: { referralsEnabled: true } };
  h.calls.length = 0;
  h.updates.length = 0;
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  h.results = {
    users: { data: { referral_code: "ABCD2345" }, error: null },
    answer_history: { data: [{ created_at: day(0) }, { created_at: day(2) }, { created_at: day(5) }], error: null },
  };
});
afterEach(() => {
  for (const k of ["REFERRAL_SURFACE_ENABLED", "REFERRAL_EXAM_REWARD_ENABLED", "REFERRAL_MENTOR_CREDITS_ENABLED", "AI_FEATURES_ENABLED", "MENTOR_ENABLED", "MENTOR_ACCESS_SCOPE"]) delete process.env[k];
});

describe("GET /api/referrals/invite", () => {
  it("401 without a session", async () => {
    h.guard = "unauth";
    expect((await get()).status).toBe(401);
  });
  it("disabled without any read, not even the session, unless the flag is exactly 'true'", async () => {
    process.env.REFERRAL_SURFACE_ENABLED = "1";
    h.guard = "unauth"; // the session check is never reached
    const res = await get("?card=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
    expect(h.calls).toHaveLength(0);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it("disabled for accounts outside the referral program", async () => {
    h.guard = { userId: "x", profile: { referralsEnabled: false } };
    expect(await (await get()).json()).toEqual({ enabled: false });
    expect(h.calls).toHaveLength(0);
  });
  it("disabled while the exam reward is off (the invite states it), before the session read", async () => {
    delete process.env.REFERRAL_EXAM_REWARD_ENABLED;
    h.guard = "unauth";
    expect(await (await get()).json()).toEqual({ enabled: false });
    expect(h.calls).toHaveLength(0);
  });
  it("returns the personal link and the credit amount", async () => {
    const body = await (await get()).json();
    expect(body).toMatchObject({ enabled: true, mentorCredits: 50 });
    expect(body.link).toMatch(/\/login\?ref=ABCD2345$/);
    expect(body.card).toBeUndefined();
    expect(h.calls.map((c) => c.table)).toEqual(["users"]);
    expect(h.calls[0].filters).toContainEqual(["eq", "id", h.guard !== "unauth" && h.guard.userId]);
  });
  it("credit amount is null while the mentor is still beta-only", async () => {
    process.env.MENTOR_ACCESS_SCOPE = "beta";
    expect((await (await get()).json()).mentorCredits).toBeNull();
  });
  it("?card=1 reads only the caller's answers in the 14-day window", async () => {
    const body = await (await get("?card=1")).json();
    expect(body.card).toEqual({ activeDays14: 3, eligible: true });
    const ah = h.calls.find((c) => c.table === "answer_history")!;
    expect(ah.filters).toContainEqual(["eq", "user_id", h.guard !== "unauth" && h.guard.userId]);
    expect(ah.filters.some((f) => Array.isArray(f) && f[0] === "gte")).toBe(true);
  });
  it("two active days are not eligible", async () => {
    h.results.answer_history = { data: [{ created_at: new Date().toISOString() }, { created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }], error: null };
    expect((await (await get("?card=1")).json()).card).toEqual({ activeDays14: 2, eligible: false });
  });
  it("mints a code when none is stored", async () => {
    h.results.users = { data: { referral_code: null }, error: null };
    const body = await (await get()).json();
    expect(body.enabled).toBe(true);
    expect(h.updates).toHaveLength(1);
    expect(body.link).toMatch(/\/login\?ref=[A-Z0-9]{8}$/);
  });
  it("rate limits at 30 a minute per learner", async () => {
    for (let i = 0; i < 30; i++) expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
  });
});
