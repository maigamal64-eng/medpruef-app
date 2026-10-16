import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ guard: vi.fn(), open: vi.fn(async () => true), note: vi.fn(async () => ({ lot_id: "lot_w", credits: 100, expires_at: "2027-01-16T08:00:00.000Z" })) }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: h.guard, isPaidAccess: (g: { tier?: string }) => g.tier === "pro" }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/mentor/route-gate", () => ({ mentorLearnerRouteOpenFor: h.open }));
vi.mock("@/lib/mentor/credits/winback", () => ({ readWinbackNote: h.note }));

import { GET } from "@/app/api/mentor/winback/route";
import { winbackNoteWanted } from "@/components/HomeWinbackNote";

const req = () => new NextRequest("https://x/api/mentor/winback");

describe("GET /api/mentor/winback", () => {
  afterEach(() => { delete process.env.REWARDS_WINBACK_ENABLED; h.guard.mockReset(); h.note.mockClear(); h.open.mockClear(); });
  it("flag off: {enabled:false} without auth or a read", async () => {
    const res = await GET(req());
    expect(await res.json()).toEqual({ enabled: false });
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
  });
  it("flag on: own note; null while the mentor is closed to the account", async () => {
    process.env.REWARDS_WINBACK_ENABLED = "true";
    h.guard.mockResolvedValue({ userId: "u1", role: "user", tier: "free", tierExpiresAt: null });
    expect(await (await GET(req())).json()).toEqual({ enabled: true, note: { lot_id: "lot_w", credits: 100, expires_at: "2027-01-16T08:00:00.000Z" } });
    expect(h.note).toHaveBeenCalledWith(expect.anything(), "u1", expect.any(Date));
    h.open.mockResolvedValueOnce(false);
    expect(await (await GET(req())).json()).toEqual({ enabled: true, note: null });
    expect(h.note).toHaveBeenCalledTimes(1);
    // Paying again: no "your access has ended" note.
    h.guard.mockResolvedValue({ userId: "u1", role: "user", tier: "pro", tierExpiresAt: "2027-03-01T00:00:00Z" });
    expect(await (await GET(req())).json()).toEqual({ enabled: true, note: null });
    expect(h.note).toHaveBeenCalledTimes(1);
  });
  it("flag on, signed out: the guard's answer", async () => {
    process.env.REWARDS_WINBACK_ENABLED = "true";
    h.guard.mockResolvedValue({ error: new Response(null, { status: 401 }) });
    expect((await GET(req())).status).toBe(401);
  });
});

describe("Home note wants", () => {
  const note = { lot_id: "lot_w", credits: 100, expires_at: "2027-01-16T08:00:00.000Z" };
  const now = Date.parse("2026-12-20T08:00:00Z");
  it("shows once per lot, never expired or empty", () => {
    expect(winbackNoteWanted(note, null, now)).toBe(true);
    expect(winbackNoteWanted(note, "lot_w", now)).toBe(false);
    expect(winbackNoteWanted(note, "lot_old", now)).toBe(true);
    expect(winbackNoteWanted(note, null, Date.parse("2027-01-17T00:00:00Z"))).toBe(false);
    expect(winbackNoteWanted({ ...note, credits: 0 }, null, now)).toBe(false);
    expect(winbackNoteWanted(null, null, now)).toBe(false);
  });
});
