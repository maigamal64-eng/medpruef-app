/**
 * GET /api/mock-gate/sitting-line (a-b2-mock-gate-1110, B2): flag off or past
 * the window means no session check and no database read; a paid learner gets
 * none; a database error gets none; no session gets 401 while the switch is on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

process.env.SESSION_SIGNING_SECRET ||= "mock-gate-route-secret-0123456789abcdef0123456";
const USER = "55555555-5555-4555-8555-555555555555";

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
const route = await import("@/app/api/mock-gate/sitting-line/route");

const req = (withSession: boolean, bank = "kmp_innsbruck") =>
  new NextRequest(`https://medpruf.test/api/mock-gate/sitting-line?bank=${bank}&lang=de`, {
    headers: withSession ? { "x-session-token": signSession(USER) } : {},
  });
const free = { id: USER, role: "user", tier: "free", tier_expires_at: null, is_banned: false, session_invalidated_at: null, exam_date: null };

afterEach(() => { delete process.env.MOCK_GATE_SITTING_ENABLED; vi.useRealTimers(); h.calls = []; });

describe("/api/mock-gate/sitting-line", () => {
  it("flag off: none, and no database read at all", async () => {
    h.calls = []; h.row = free;
    const res = await route.GET(req(true));
    expect(await res.json()).toEqual({ state: "none" });
    expect(h.calls).toHaveLength(0);
  });
  it("after the window with the flag on: none, no database read", async () => {
    process.env.MOCK_GATE_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-23T08:00:00Z"));
    h.calls = []; h.row = free;
    const res = await route.GET(req(true));
    expect(await res.json()).toEqual({ state: "none" });
    expect(h.calls).toHaveLength(0);
  });
  it("flag on, no session: 401", async () => {
    process.env.MOCK_GATE_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T22:00:00Z"));
    const res = await route.GET(req(false));
    expect(res.status).toBe(401);
  });
  it("free learner with a saved Stichprobentest sitting gets the line; no sitting gets the ask", async () => {
    process.env.MOCK_GATE_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T22:00:00Z"));
    h.row = { ...free, exam_date: "2027-02-03" };
    const a = await (await route.GET(req(true))).json();
    expect(a.state).toBe("sitting");
    expect(a.lines[0]).toContain("Stichprobentest Innsbruck");
    expect(a.cta.href).toContain("gate=mock_exam");
    h.row = free;
    const b = await (await route.GET(req(true))).json();
    expect(b.state).toBe("ask");
  });
  it("a paid learner gets none", async () => {
    process.env.MOCK_GATE_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T22:00:00Z"));
    h.row = { ...free, tier: "pro", tier_expires_at: "2027-12-31T00:00:00Z", exam_date: "2027-02-03" };
    expect(await (await route.GET(req(true))).json()).toEqual({ state: "none" });
  });
});
