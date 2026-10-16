import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  db: vi.fn(),
  tables: [] as string[],
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  guard: { role: "user", tier: "free", tierExpiresAt: null as string | null },
  profile: { createdAt: "2026-10-21T08:00:00Z", activeExam: "kmp_innsbruck", examDate: null as string | null },
  trial: null as Record<string, unknown> | null,
  subs: [] as Record<string, unknown>[],
  counts: { translation: 3, feature_use: 7 } as Record<string, number>,
  homeSeen: false,
  failTranslations: false,
  capped: false as boolean | Error,
}));
vi.mock("@/lib/free-tier", () => ({
  loadFreeAccess: async () => { if (h.capped instanceof Error) throw h.capped; return { capped: h.capped }; },
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({
    userId: "44444444-4444-4444-8444-444444444444", ...h.guard,
    profile: { emailStatus: null, languageCode: "de", onboardingCompletedAt: null, referralsEnabled: false, dailyGoal: 20, ...h.profile },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.db();
    return {
      from: (table: string) => {
        h.tables.push(table);
        const filters: Record<string, unknown> = {};
        let head = false;
        const result = () => {
          if (table === "subscriptions") return { data: h.subs, error: null };
          if (table === "user_events") {
            if (head) {
              if (h.failTranslations) return { count: null, error: { message: "boom" } };
              return { count: h.counts[String(filters.event_type)] ?? 0, error: null };
            }
            return { data: h.homeSeen ? [{ id: 1 }] : [], error: null };
          }
          return { data: null, error: null };
        };
        const q: Record<string, unknown> = {
          select: (_c: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return q; },
          eq: (k: string, v: unknown) => { filters[k] = v; return q; },
          limit: async () => result(),
          maybeSingle: async () => ({ data: table === "trials" ? h.trial : null, error: null }),
          insert: async (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return { error: null }; },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
        };
        return q;
      },
    };
  },
}));

import { GET, POST } from "@/app/api/trial-end/route";
import { resetTrialEndCache } from "@/lib/trial-end/server-cache";

const NOW = new Date("2026-11-06T11:00:00Z");
const get = (surface?: string) => GET(new NextRequest(`https://medpruf.com/api/trial-end${surface ? `?surface=${surface}` : ""}`));
const post = (body: unknown) => POST(new NextRequest("https://medpruf.com/api/trial-end", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetTrialEndCache();
  h.db.mockClear();
  h.tables.length = 0;
  h.inserts.length = 0;
  h.guard = { role: "user", tier: "free", tierExpiresAt: null };
  h.profile = { createdAt: "2026-10-21T08:00:00Z", activeExam: "kmp_innsbruck", examDate: null };
  h.trial = null;
  h.subs = [];
  h.homeSeen = false;
  h.failTranslations = false;
  h.capped = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const on = () => vi.stubEnv("TRIAL_END_CARD_ENABLED", "true");

describe("GET /api/trial-end", () => {
  it("flag off: {enabled:false}, no session or database read", async () => {
    expect(await (await get()).json()).toEqual({ enabled: false });
    expect(h.db).not.toHaveBeenCalled();
  });

  it("no reverse trial: none, and the no is remembered without another read", async () => {
    on();
    expect(await (await get()).json()).toEqual({ enabled: true, state: "none" });
    expect(h.tables).toEqual(["trials"]);
    h.tables.length = 0;
    await get();
    expect(h.tables).toEqual([]);
  });

  it("a legacy (card) trial row is not the reverse trial", async () => {
    on();
    h.trial = { kind: "legacy", expires_at: "2026-11-05T10:00:00Z" };
    expect((await (await get()).json()).state).toBe("none");
  });

  it("ended trial: counts, sitting, switches, Home not yet seen", async () => {
    on();
    vi.stubEnv("REVERSE_TRIAL_SINCE", "2026-10-20T10:00:00Z");
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    h.subs = [{ tier: "reverse_trial", status: "expired", payment_provider: "trial", amount_cents: 0, granted_payment_ids: [] }];
    h.profile = { createdAt: "2026-11-02T08:00:00Z", activeExam: "kmp_innsbruck", examDate: "2027-02-03" };
    const body = await (await get("home")).json();
    expect(body).toMatchObject({
      enabled: true, state: "ended", ends_at: "2026-11-05T10:00:00Z", trial: "auto", exam: "kmp_innsbruck",
      translations: 7, capped: false, home_seen: false, v2: false, guard: false,
    });
    expect(body.sitting).toMatchObject({ bank: "kmp_innsbruck", date: "2027-02-03" });
    expect(body.ready).toMatchObject({ flex_month: true, sitting_pass: true });
  });

  it("an older account's claimed trial reads as claim", async () => {
    on();
    vi.stubEnv("REVERSE_TRIAL_SINCE", "2026-10-20T10:00:00Z");
    h.profile = { createdAt: "2026-06-01T08:00:00Z", activeExam: "kenntnispruefung", examDate: null };
    h.trial = { kind: "reverse", expires_at: "2026-11-06T20:00:00Z" };
    h.guard = { role: "user", tier: "pro", tierExpiresAt: "2026-11-06T20:00:00Z" };
    const body = await (await get()).json();
    expect(body).toMatchObject({ state: "last_day", trial: "claim", sitting: null, home_seen: null });
  });

  it("a payment ever (refunded too) or own access past the trial: none", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    h.subs = [{ tier: "sitting_pass", status: "refunded", payment_provider: "whop", amount_cents: 5900, provider_payment_id: "pay_1", granted_payment_ids: [] }];
    expect((await (await get()).json()).state).toBe("none");
    resetTrialEndCache();
    h.subs = [];
    h.guard = { role: "user", tier: "pro", tierExpiresAt: "2027-01-01T00:00:00Z" };
    expect((await (await get()).json()).state).toBe("none");
  });

  it("admins read nothing", async () => {
    on();
    h.guard = { role: "admin", tier: "admin", tierExpiresAt: null };
    expect((await (await get()).json()).state).toBe("none");
    expect(h.tables).toEqual([]);
  });

  it("an unreadable translation count is null, never 0", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    h.failTranslations = true;
    expect((await (await get()).json()).translations).toBeNull();
  });

  it("reports a used-up free sample, and null when it cannot be read", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    h.capped = true;
    expect((await (await get()).json()).capped).toBe(true);
    resetTrialEndCache();
    h.capped = new Error("boom");
    expect((await (await get()).json()).capped).toBeNull();
  });
});

describe("GET /api/trial-end load and edges (reviewer P2-1)", () => {
  it("only ?surface=home reads the Home marker", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    expect((await (await get("paywall")).json()).home_seen).toBeNull();
    expect(h.tables.filter((t) => t === "user_events")).toHaveLength(2);
    resetTrialEndCache();
    h.tables.length = 0;
    h.homeSeen = true;
    expect((await (await get("home")).json()).home_seen).toBe(true);
    expect(h.tables.filter((t) => t === "user_events")).toHaveLength(3);
  });

  it("an answer is kept 5 minutes per instance; the Home marker is still read fresh", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    await get("home");
    h.tables.length = 0;
    h.homeSeen = true;
    const again = await (await get("home")).json();
    expect(again).toMatchObject({ state: "ended", home_seen: true });
    expect(h.tables).toEqual(["user_events"]);
    h.tables.length = 0;
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    await get("paywall");
    expect(h.tables).toContain("trials");
  });

  it("a purchase or grant (new access) is seen at once despite the cache", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    expect((await (await get()).json()).state).toBe("ended");
    h.guard = { role: "user", tier: "pro", tierExpiresAt: "2027-01-01T00:00:00Z" };
    expect((await (await get()).json()).state).toBe("none");
  });

  it("a saved sitting that is over is asked again", async () => {
    on();
    h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
    h.profile = { createdAt: "2026-10-21T08:00:00Z", activeExam: "kenntnispruefung", examDate: "2026-11-04" };
    expect((await (await get()).json()).sitting).toBeNull();
  });
});

describe("POST /api/trial-end", () => {
  it("404 while off", async () => {
    expect((await post({ event: "shown", surface: "home" })).status).toBe(404);
  });

  it("records bounded enum fields only", async () => {
    on();
    const r = await post({ event: "click", surface: "paywall", plan: "sitting_pass", exam: "kmp_innsbruck", trial: "auto", target: "checkout", email: "x@y.z", free: "text" });
    expect(r.status).toBe(200);
    expect(h.inserts).toEqual([{ table: "user_events", row: {
      user_id: "44444444-4444-4444-8444-444444444444", event_type: "trial_end_card_click",
      event_data: { surface: "paywall", plan: "sitting_pass", exam: "kmp_innsbruck", trial: "auto", target: "checkout" },
    } }]);
  });

  it("rejects unknown events, surfaces and click targets", async () => {
    on();
    expect((await post({ event: "seen", surface: "home" })).status).toBe(400);
    expect((await post({ event: "shown", surface: "landing" })).status).toBe(400);
    expect((await post({ event: "click", surface: "home", target: "buy" })).status).toBe(400);
    expect(h.inserts).toEqual([]);
  });

  it("the Home shown marker is written once", async () => {
    on();
    await post({ event: "shown", surface: "home", plan: "none" });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].row.event_type).toBe("trial_end_card_shown");
    h.homeSeen = true;
    const again = await (await post({ event: "shown", surface: "home" })).json();
    expect(again).toEqual({ ok: true, recorded: false });
    expect(h.inserts).toHaveLength(1);
  });
});
