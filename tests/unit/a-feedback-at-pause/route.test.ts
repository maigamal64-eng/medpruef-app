import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  db: vi.fn(),
  profile: { examDate: null as string | null, activeExam: "kenntnispruefung" as string | null },
  events: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "22222222-2222-4222-8222-222222222222", role: "user", tier: "free", tierExpiresAt: null, profile: h.profile }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.db();
    return {
      from: (table: string) => {
        const filters: Array<[string, string, unknown]> = [];
        const rows = () => h.events.filter((e) => filters.every(([op, c, v]) => (op === "eq" ? e[c] === v : String(e[c]) >= String(v))));
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); h.filters.push(["eq", c, v]); return q; },
          gte: (c: string, v: unknown) => { filters.push(["gte", c, v]); h.filters.push(["gte", c, v]); return q; },
          order: () => q,
          limit: async () => ({ data: table === "user_events" ? rows().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : [], error: null }),
          insert: async (row: Record<string, unknown>) => { h.inserts.push(row); h.events.push({ ...row, created_at: new Date().toISOString() }); return { error: null }; },
        };
        return q;
      },
    };
  },
}));

import { GET, POST } from "@/app/api/feedback/ask/route";

const url = "https://medpruf.com/api/feedback/ask";
const get = () => GET(new NextRequest(url));
const post = () => POST(new NextRequest(url, { method: "POST", body: "{}" }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  h.db.mockClear();
  h.events.length = 0;
  h.inserts.length = 0;
  h.filters.length = 0;
  h.profile = { examDate: null, activeExam: "kenntnispruefung" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/feedback/ask", () => {
  it("answers {enabled:false} with no database read while FEEDBACK_ASK_ENABLED is off", async () => {
    expect(await (await get()).json()).toEqual({ enabled: false, show: false });
    expect(await (await post()).json()).toEqual({ enabled: false, show: false });
    expect(h.db).not.toHaveBeenCalled();
    vi.stubEnv("FEEDBACK_ASK_ENABLED", "1");
    expect(await (await get()).json()).toEqual({ enabled: false, show: false });
    expect(h.db).not.toHaveBeenCalled();
  });

  it("GET writes nothing; POST stores one feedback_ask_shown row and then blocks for 14 days", async () => {
    vi.stubEnv("FEEDBACK_ASK_ENABLED", "true");
    expect(await (await get()).json()).toEqual({ enabled: true, show: true });
    expect(h.inserts).toHaveLength(0);
    expect(await (await post()).json()).toEqual({ enabled: true, show: true });
    expect(h.inserts).toEqual([{ user_id: USER, event_type: "feedback_ask_shown", event_data: { surface: "round_end", source: "quiz" } }]);
    expect(await (await get()).json()).toEqual({ enabled: true, show: false, reason: "asked_recently" });
    expect(await (await post()).json()).toEqual({ enabled: true, show: false, reason: "asked_recently" });
    expect(h.inserts).toHaveLength(1);
    // The read covers 14 days and any surface: no filter on surface or source.
    expect(h.filters).toContainEqual(["gte", "created_at", "2026-10-03T10:00:00.000Z"]);
    expect(h.filters.some(([, c]) => String(c).startsWith("event_data"))).toBe(false);
  });

  it("a learner-watch mail ask (any surface) blocks the in-app ask", async () => {
    vi.stubEnv("FEEDBACK_ASK_ENABLED", "true");
    h.events.push({ user_id: USER, event_type: "feedback_ask_shown", event_data: { surface: "mail", source: "learner_watch" }, created_at: "2026-10-12T09:00:00.000Z" });
    expect(await (await post()).json()).toEqual({ enabled: true, show: false, reason: "asked_recently" });
    expect(h.inserts).toHaveLength(0);
  });

  it("an ask older than 14 days does not block", async () => {
    vi.stubEnv("FEEDBACK_ASK_ENABLED", "true");
    h.events.push({ user_id: USER, event_type: "feedback_ask_shown", event_data: { surface: "mail", source: "learner_watch" }, created_at: "2026-10-01T09:00:00.000Z" });
    expect(await (await post()).json()).toEqual({ enabled: true, show: true });
  });

  it("refuses in the learner's own sitting week without reading user_events", async () => {
    vi.stubEnv("FEEDBACK_ASK_ENABLED", "true");
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    h.profile = { examDate: "2026-11-17", activeExam: "kenntnispruefung" };
    expect(await (await get()).json()).toEqual({ enabled: true, show: false, reason: "sitting_week" });
    expect(await (await post()).json()).toEqual({ enabled: true, show: false, reason: "sitting_week" });
    expect(h.inserts).toHaveLength(0);
    expect(h.filters).toHaveLength(0);
  });
});
