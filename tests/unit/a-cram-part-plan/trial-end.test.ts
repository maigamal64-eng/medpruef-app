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
  runs: [] as unknown[],
  runsFail: false,
}));
vi.mock("@/lib/cram-part-plan/server", () => ({
  loadPartRuns: async () => { if (h.runsFail) throw new Error("boom"); return h.runs; },
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
  h.runs = [];
  h.runsFail = false;
  h.trial = { kind: "reverse", expires_at: "2026-11-05T10:00:00Z" };
  h.subs = [];
  h.profile = { createdAt: "2026-10-21T08:00:00Z", activeExam: "kenntnispruefung", examDate: "2026-11-18" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const on = () => vi.stubEnv("TRIAL_END_CARD_ENABLED", "true");

describe("trial-end card: latest part run (a-cram-part-plan)", () => {
  const run = { presetId: "kp_sip4", day: "2026-11-04", weak: [{ topic: "Innere Medizin", pct: 0.45 }, { topic: "Chirurgische Fächer", pct: 0.55 }] };

  it("cram flag off: no part_run key, the body is today's", async () => {
    on();
    h.runs = [run];
    const body = await (await get()).json();
    expect(body.state).toBe("ended");
    expect(body).not.toHaveProperty("part_run");
  });

  it("cram flag on: the newest part run's subjects below 60 percent", async () => {
    on();
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    h.runs = [{ presetId: "kp_sip5", day: "2026-10-30", weak: [{ topic: "Neurologie", pct: 0.3 }] }, run];
    const body = await (await get()).json();
    expect(body.part_run).toEqual({ exam_key: "sip4a", day: "2026-11-04", weak: ["Innere Medizin", "Chirurgische Fächer"] });
  });

  it("a run with none below 60 percent, no run, or an unreadable read: no line", async () => {
    on();
    vi.stubEnv("CRAM_PART_PLAN_ENABLED", "true");
    h.runs = [{ ...run, weak: [] }];
    expect(await (await get()).json()).not.toHaveProperty("part_run");
    resetTrialEndCache();
    h.runs = [];
    expect(await (await get()).json()).not.toHaveProperty("part_run");
    resetTrialEndCache();
    h.runsFail = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("part_run");
  });
});
