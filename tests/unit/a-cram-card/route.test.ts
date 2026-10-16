import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  guardCalls: 0, dbCalls: 0, lots: [] as Array<Record<string, unknown>>, lotError: false, mentorOpen: true,
  gm: { available: false, active: 0 as number | null },
}));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => { h.guardCalls++; return { userId: "u1", role: "user", tier: "free", tierExpiresAt: null, profile: {} }; },
  isPaidAccess: () => false,
}));
vi.mock("@/lib/mentor/route-gate", () => ({ mentorLearnerRouteOpenFor: async () => h.mentorOpen }));
vi.mock("@/lib/gm-practice/availability", () => ({ getGmAvailability: async () => h.gm }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.dbCalls++;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gt", "order"]) q[m] = () => q;
    q.limit = async () => (h.lotError ? { data: null, error: { code: "x" } } : { data: h.lots, error: null });
    return { from: () => q };
  },
}));

import { GET } from "@/app/api/home/cram-card/route";

const get = (need?: string) => GET(new NextRequest(`https://medpruf.com/api/home/cram-card${need ? `?need=${need}` : ""}`));
const ENV = ["HOME_CRAM_CARD_ENABLED", "WELCOME_ENABLED", "MENTOR_WELCOME_ENABLED", "REWARDS_WINBACK_ENABLED"];

beforeEach(() => {
  h.guardCalls = 0; h.dbCalls = 0; h.lots = []; h.lotError = false; h.mentorOpen = true; h.gm = { available: false, active: 0 };
  for (const k of ENV) delete process.env[k];
});
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("GET /api/home/cram-card", () => {
  it("flag off: {enabled:false} with no session and no database read", async () => {
    const res = await get("credits");
    expect(await res.json()).toEqual({ enabled: false });
    expect(h.guardCalls).toBe(0);
    expect(h.dbCalls).toBe(0);
  });
  it("need=gm answers the availability", async () => {
    process.env.HOME_CRAM_CARD_ENABLED = "true";
    h.gm = { available: true, active: 128 };
    expect(await (await get("gm")).json()).toEqual({ enabled: true, gm: true });
  });
  it("need=credits: no free-credit hook on means no read and no line", async () => {
    process.env.HOME_CRAM_CARD_ENABLED = "true";
    expect(await (await get("credits")).json()).toEqual({ enabled: true, credits: null });
    expect(h.dbCalls).toBe(0);
  });
  it("need=credits: the lot that ends first, own balance", async () => {
    process.env.HOME_CRAM_CARD_ENABLED = "true";
    process.env.MENTOR_WELCOME_ENABLED = "true";
    const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    h.lots = [
      { granted_micro: 500_000, spent_micro: 0, clawed_back_micro: 0, expires_at: future(20) },
      { granted_micro: 125_000, spent_micro: 0, clawed_back_micro: 0, expires_at: future(5) },
    ];
    const body = await (await get("credits")).json();
    expect(body.enabled).toBe(true);
    expect(body.credits.credits).toBe(25);
    expect(body.credits.expires_at).toBe(h.lots[1].expires_at);
  });
  it("a comped subscription's included admin_gift lot is not a free-credit lot; a reward lot is", async () => {
    process.env.HOME_CRAM_CARD_ENABLED = "true";
    process.env.MENTOR_WELCOME_ENABLED = "true";
    const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    h.lots = [
      { source: "admin_gift", source_id: "sub-1:2026-10", granted_micro: 1_000_000, spent_micro: 0, clawed_back_micro: 0, expires_at: future(2) },
      { source: "admin_gift", source_id: "reward:winback:abc", granted_micro: 500_000, spent_micro: 0, clawed_back_micro: 0, expires_at: future(9) },
    ];
    const body = await (await get("credits")).json();
    expect(body.credits.credits).toBe(100);
    expect(body.credits.expires_at).toBe(h.lots[1].expires_at);
  });
  it("a closed mentor or a failed read is no line, never an error", async () => {
    process.env.HOME_CRAM_CARD_ENABLED = "true";
    process.env.MENTOR_WELCOME_ENABLED = "true";
    h.mentorOpen = false;
    expect((await (await get("credits")).json()).credits).toBeNull();
    h.mentorOpen = true; h.lotError = true;
    const res = await get("credits");
    expect(res.status).toBe(200);
    expect((await res.json()).credits).toBeNull();
  });
});
