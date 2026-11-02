/**
 * GET /api/free-empty/sitting-line (a-growth-lines-1102, A1): flag off or past
 * the window means no session check and no database read; a paid learner gets
 * none; a database error gets none; no session gets 401 while the switch is on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

process.env.SESSION_SIGNING_SECRET ||= "growth-lines-route-secret-0123456789abcdef0123";
const USER = "44444444-4444-4444-8444-444444444444";

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
const route = await import("@/app/api/free-empty/sitting-line/route");

const req = (withSession: boolean) =>
  new NextRequest("https://medpruf.test/api/free-empty/sitting-line?bank=kenntnispruefung&lang=de", {
    headers: withSession ? { "x-session-token": signSession(USER) } : {},
  });
const free = { id: USER, role: "user", tier: "free", tier_expires_at: null, is_banned: false, session_invalidated_at: null, exam_date: null };

afterEach(() => { delete process.env.FREE_EMPTY_SITTING_ENABLED; vi.useRealTimers(); h.calls = []; });

describe("/api/free-empty/sitting-line", () => {
  it("flag off: none, and no database read at all", async () => {
    h.calls = []; h.row = free;
    const res = await route.GET(req(true));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "none" });
    expect(h.calls).toHaveLength(0);
  });

  it("flag on, no session: 401", async () => {
    process.env.FREE_EMPTY_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    expect((await route.GET(req(false))).status).toBe(401);
  });

  it("flag on, past the window: none before any read", async () => {
    process.env.FREE_EMPTY_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    h.calls = []; h.row = free;
    expect(await (await route.GET(req(true))).json()).toEqual({ state: "none" });
    expect(h.calls).toHaveLength(0);
  });

  it("flag on, free learner without a sitting: the ask line", async () => {
    process.env.FREE_EMPTY_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    h.row = free;
    const body = await (await route.GET(req(true))).json();
    expect(body.state).toBe("ask");
    expect(body.cta.href).toBe("/settings#exam-date");
  });

  it("flag on, paid learner: none", async () => {
    process.env.FREE_EMPTY_SITTING_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    h.row = { ...free, tier: "pro", tier_expires_at: "2027-01-01T00:00:00.000Z" };
    expect(await (await route.GET(req(true))).json()).toEqual({ state: "none" });
  });
});
