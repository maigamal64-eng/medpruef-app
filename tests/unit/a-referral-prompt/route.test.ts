import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const USER = "33333333-3333-4333-8333-333333333333";
const h = vi.hoisted(() => ({
  guard: null as Record<string, unknown> | "unauth" | null,
  db: vi.fn(),
  events: [] as Array<Record<string, unknown>>,
  answers: [] as Array<Record<string, unknown>>,
  subs: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => (h.guard === "unauth" ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } : h.guard),
  isPaidAccess: (g: { tier?: string; role?: string }) => g.role === "admin" || g.tier === "pro",
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.db();
    return {
      from(table: string) {
        const eqs: Array<[string, unknown]> = [];
        let since: string | null = null;
        const rows = () => {
          const src = table === "user_events" ? h.events : table === "answer_history" ? h.answers : table === "subscriptions" ? h.subs : [{ id: USER, referral_code: "ABCD2345" }];
          return src
            .filter((r) => eqs.every(([c, v]) => (table === "users" && c === "id") || r[c] === v))
            .filter((r) => !since || String(r.created_at) >= since)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
          gte: (_c: string, v: string) => { since = v; return chain; },
          order: () => chain,
          limit: async (n: number) => ({ data: rows().slice(0, n), error: null }),
          maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
          insert: async (row: Record<string, unknown>) => {
            h.inserts.push(row);
            h.events.push({ ...row, created_at: new Date().toISOString() });
            return { error: null };
          },
        };
        return chain;
      },
    };
  },
}));

import { GET, POST } from "@/app/api/referrals/prompt/route";

const url = "https://medpruf.test/api/referrals/prompt";
const get = async () => (await GET(new NextRequest(url))).json();
const post = async (body: unknown) => POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body) }));
const NOW = new Date("2026-10-29T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.REFERRAL_PROMPT_ENABLED = "true";
  process.env.REFERRAL_EXAM_REWARD_ENABLED = "true";
  process.env.NEXT_PUBLIC_SITE_URL = "https://medpruf.com";
  h.guard = { userId: USER, role: "user", tier: "pro", tierExpiresAt: null, profile: { referralsEnabled: true } };
  h.db.mockClear();
  h.events.length = 0;
  h.inserts.length = 0;
  h.subs = [{ user_id: USER, tier: "flex_month", status: "active", payment_provider: "whop", amount_cents: 2400, expires_at: "2026-11-20T00:00:00Z" }];
  h.answers = Array.from({ length: 16 }, (_, i) => ({ user_id: USER, question_id: 500 + i, is_correct: i < 14, created_at: minutesAgo(20 + i) }));
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ["REFERRAL_PROMPT_ENABLED", "REFERRAL_EXAM_REWARD_ENABLED", "NEXT_PUBLIC_SITE_URL", "REFERRAL_MENTOR_CREDITS_ENABLED"]) delete process.env[k];
});

describe("/api/referrals/prompt", () => {
  it("off: {enabled:false} with no session and no database read unless the flag is exactly 'true' and the exam reward is on", async () => {
    h.guard = "unauth";
    process.env.REFERRAL_PROMPT_ENABLED = "1";
    expect(await get()).toEqual({ enabled: false, show: false });
    expect(await (await post({ action: "shown", moment: "strong_session" })).json()).toEqual({ enabled: false, show: false });
    process.env.REFERRAL_PROMPT_ENABLED = "true";
    delete process.env.REFERRAL_EXAM_REWARD_ENABLED;
    expect(await get()).toEqual({ enabled: false, show: false });
    expect(h.db).not.toHaveBeenCalled();
  });

  it("401 without a session when on", async () => {
    h.guard = "unauth";
    expect((await GET(new NextRequest(url))).status).toBe(401);
  });

  it("free learners and accounts outside the referral program get nothing and cause no read", async () => {
    h.guard = { userId: USER, role: "user", tier: "free", tierExpiresAt: null, profile: { referralsEnabled: true } };
    expect(await get()).toEqual({ enabled: false, show: false });
    h.guard = { userId: USER, role: "user", tier: "pro", tierExpiresAt: null, profile: { referralsEnabled: false } };
    expect(await get()).toEqual({ enabled: false, show: false });
    expect(h.db).not.toHaveBeenCalled();
  });

  it("Pro access without money behind it (trial, seat, reward) is not paying: nothing offered, nothing written", async () => {
    h.subs = [{ user_id: USER, tier: "flex_month_trial", status: "active", payment_provider: "whop", amount_cents: 0, expires_at: "2026-11-01T00:00:00Z" }];
    expect(await get()).toEqual({ enabled: false, show: false });
    expect(await (await post({ action: "shown", moment: "strong_session" })).json()).toEqual({ enabled: false, show: false });
    h.subs = [{ user_id: USER, tier: "flex_month", status: "active", payment_provider: "whop", amount_cents: 2400, expires_at: "2026-10-01T00:00:00Z" }];
    expect(await get()).toEqual({ enabled: false, show: false });
    expect(h.inserts).toHaveLength(0);
  });

  it("admins pass without a subscription (smoke tests)", async () => {
    h.guard = { userId: USER, role: "admin", tier: "admin", tierExpiresAt: null, profile: { referralsEnabled: true } };
    h.subs = [];
    expect(await get()).toMatchObject({ show: true });
  });

  it("offers the personal link after a strong session; GET writes nothing", async () => {
    const body = await get();
    expect(body).toMatchObject({ enabled: true, show: true, moment: "strong_session", link: "https://medpruf.com/login?ref=ABCD2345" });
    expect(h.inserts).toHaveLength(0);
  });

  it("no moment while the learner may still be studying", async () => {
    h.answers = h.answers.map((r, i) => ({ ...r, created_at: minutesAgo(2 + i) }));
    expect(await get()).toEqual({ enabled: true, show: false, reason: "no_moment" });
  });

  it("POST shown stores one row and then blocks for 14 days on every device", async () => {
    const r = await post({ action: "shown", moment: "strong_session" });
    expect(await r.json()).toEqual({ enabled: true, show: true });
    expect(h.inserts).toEqual([{ user_id: USER, event_type: "referral_prompt_shown", event_data: { surface: "home", moment: "strong_session" } }]);
    expect(await get()).toEqual({ enabled: true, show: false, reason: "shown_recently", nextAt: "2026-11-12T12:00:00.000Z" });
    expect(await (await post({ action: "shown", moment: "strong_session" })).json()).toEqual({ enabled: true, show: false, reason: "shown_recently" });
    expect(h.inserts).toHaveLength(1);
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 86_400_000));
    h.answers = h.answers.map((r, i) => ({ ...r, created_at: new Date(Date.now() - (20 + i) * 60_000).toISOString() }));
    expect(await get()).toMatchObject({ show: true });
  });

  it("POST dismissed is for good and stored once", async () => {
    expect(await (await post({ action: "dismissed" })).json()).toEqual({ enabled: true, show: false, reason: "dismissed" });
    await post({ action: "dismissed" });
    expect(h.inserts).toEqual([{ user_id: USER, event_type: "referral_prompt_dismissed", event_data: { surface: "home" } }]);
    vi.setSystemTime(new Date(NOW.getTime() + 400 * 86_400_000));
    h.subs = [{ ...h.subs[0], expires_at: null }];
    expect(await get()).toEqual({ enabled: true, show: false, reason: "dismissed" });
  });

  it("rejects an unknown action or moment", async () => {
    expect((await post({ action: "nope" })).status).toBe(400);
    expect((await post({ action: "shown", moment: "other" })).status).toBe(400);
    expect(h.inserts).toHaveLength(0);
  });
});
