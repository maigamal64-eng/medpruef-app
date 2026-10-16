import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  db: vi.fn(),
  user: { exam_date: "2026-11-17", active_exam: "kenntnispruefung" } as Record<string, unknown>,
  events: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "22222222-2222-4222-8222-222222222222", role: "user", tier: "free", tierExpiresAt: null }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.db();
    return {
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const q = {
          select: () => q,
          eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
          limit: async () => ({
            data: h.events.filter((e) => filters.every(([c, v]) => (c === "event_data->>sitting_key" ? (e.event_data as Record<string, unknown>).sitting_key === v : e[c] === v))),
            error: null,
          }),
          maybeSingle: async () => ({ data: table === "users" ? h.user : null, error: null }),
          insert: async (row: Record<string, unknown>) => { h.inserts.push(row); h.events.push(row); return { error: null }; },
        };
        return q;
      },
    };
  },
}));

import { GET, POST } from "@/app/api/journey/route";

const get = () => GET(new NextRequest("https://medpruf.com/api/journey"));
const post = (body: unknown) => POST(new NextRequest("https://medpruf.com/api/journey", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  h.db.mockClear();
  h.events.length = 0;
  h.inserts.length = 0;
  h.user = { exam_date: "2026-11-17", active_exam: "kenntnispruefung" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/journey", () => {
  it("answers {enabled:false} without a database read while MOMENTS_ENABLED is off", async () => {
    const r = await get();
    expect(await r.json()).toEqual({ enabled: false });
    expect(h.db).not.toHaveBeenCalled();
    expect((await post({ action: "registered", sitting_key: "sip5a:2026-11-17" })).status).toBe(404);
    expect(h.db).not.toHaveBeenCalled();
  });

  it("returns the learner's moment when on", async () => {
    vi.stubEnv("MOMENTS_ENABLED", "true");
    const body = await (await get()).json();
    expect(body).toMatchObject({ enabled: true, phase: "registration", code: "m3", canConfirm: true, registered: false, named: { key: "sip5a:2026-11-17" } });
  });

  it("stores registered_confirmed once per sitting and refuses another sitting", async () => {
    vi.stubEnv("MOMENTS_ENABLED", "true");
    expect((await post({ action: "registered", sitting_key: "sip4a:2026-11-18" })).status).toBe(409);
    expect((await post({ action: "nope", sitting_key: "sip5a:2026-11-17" })).status).toBe(400);
    const ok = await post({ action: "registered", sitting_key: "sip5a:2026-11-17" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, registered: true });
    await post({ action: "registered", sitting_key: "sip5a:2026-11-17" });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      event_type: "registered_confirmed",
      event_data: { sitting_key: "sip5a:2026-11-17", exam_keys: ["sip5a"], segment: "vienna_sip", source: "home" },
    });
    expect(JSON.stringify(h.inserts[0].event_data)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect((await (await get()).json()).registered).toBe(true);
  });

  it("refuses a confirmation before any confirmed window opened", async () => {
    vi.stubEnv("MOMENTS_ENABLED", "true");
    h.user = { exam_date: "2027-03-10", active_exam: "kenntnispruefung" };
    expect((await post({ action: "registered", sitting_key: "sip4a+sip5a:2027-03-10" })).status).toBe(409);
    expect(h.inserts).toHaveLength(0);
  });
});
