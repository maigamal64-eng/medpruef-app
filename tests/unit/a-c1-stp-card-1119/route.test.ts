/**
 * GET /api/stp-deadline-card/line (a-c1-stp-card-1119, C1): flag off means no
 * session check and no database read; no session gets 401 while on; a paid
 * learner gets rows only; a database error gets none; the answer is only about
 * the caller's own row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

process.env.SESSION_SIGNING_SECRET ||= "stp-card-route-secret-0123456789abcdef0123456";
const USER = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({ calls: [] as FakeCall[], row: null as Record<string, unknown> | null }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => (c.table === "users" ? { data: h.row } : { data: c.single ? null : [] }));
    const push = calls.push.bind(calls);
    calls.push = (...items: FakeCall[]) => { h.calls.push(...items); return push(...items); };
    return sb;
  },
}));

const { signSession } = await import("@/lib/session");
const route = await import("@/app/api/stp-deadline-card/line/route");

const req = (withSession: boolean, lang = "de") =>
  new NextRequest(`https://medpruf.test/api/stp-deadline-card/line?lang=${lang}`, { headers: withSession ? { "x-session-token": signSession(USER) } : {} });
const free = { id: USER, role: "user", tier: "free", tier_expires_at: null, is_banned: false, session_invalidated_at: null, exam_date: "2027-02-03", active_exam: "kmp_innsbruck" };
const on = () => { process.env.STP_DEADLINE_CARD_ENABLED = "true"; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-19T10:00:00Z")); };

afterEach(() => { delete process.env.STP_DEADLINE_CARD_ENABLED; delete process.env.MOMENTS_ENABLED; vi.useRealTimers(); h.calls = []; });

describe("/api/stp-deadline-card/line", () => {
  it("flag off: none, and no database read at all", async () => {
    h.calls = []; h.row = free;
    const res = await route.GET(req(true));
    expect(await res.json()).toEqual({ state: "none" });
    expect(h.calls).toHaveLength(0);
  });
  it("flag on, no session: 401", async () => {
    on();
    expect((await route.GET(req(false))).status).toBe(401);
  });
  it("free learner with the February sitting gets both rows and the CTA", async () => {
    on(); h.row = free;
    const body = await (await route.GET(req(true))).json();
    expect(body.state).toBe("sitting");
    expect(body.rows).toHaveLength(2);
    expect(body.cta.href).toContain("sitting=2027-02-03");
    expect(JSON.stringify(body)).not.toContain(USER);
  });
  it("a paid learner gets rows only", async () => {
    on(); h.row = { ...free, tier: "pro", tier_expires_at: "2027-12-31T00:00:00Z" };
    const body = await (await route.GET(req(true))).json();
    expect(body.state).toBe("sitting");
    expect(body.cta).toBeNull();
    expect(body.planLine).toBeNull();
  });
  it("MOMENTS_ENABLED on: none", async () => {
    on(); process.env.MOMENTS_ENABLED = "true"; h.row = free;
    expect(await (await route.GET(req(true))).json()).toEqual({ state: "none" });
  });
  it("no sitting, Stichprobentest bank: none before 28 Nov, ask after", async () => {
    on(); h.row = { ...free, exam_date: null };
    expect(await (await route.GET(req(true))).json()).toEqual({ state: "none" });
    vi.setSystemTime(new Date("2026-11-28T10:00:00Z"));
    expect((await (await route.GET(req(true))).json()).state).toBe("ask");
  });
});
