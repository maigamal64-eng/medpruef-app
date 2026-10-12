import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard }));
vi.mock("@/lib/admin/audit", () => ({ resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/admin/permissions", () => ({ loadAdminPermissionSnapshot: mocks.snapshot, canAccessAdminPermission: (s: string[], p: string) => s.includes(p) }));

import { GET as growthRoute } from "@/app/api/stats/admin/growth/route";
import { GET as contentRoute } from "@/app/api/stats/admin/growth/content/route";
import { computeGrowthMetrics } from "@/lib/admin/growthMetrics";
import { buildSourceTables, growthWindowStart, normalizeTag, parseGrowthWindow, pickSignupAttribution, OTHER, UNTAGGED } from "@/lib/admin/growth-rules";
import { buildCampaignLinks, campaignSlug, campaignWelcomeUrl, parseCampaignStart } from "@/lib/campaign-links";
import { resolveFaqAnchor } from "@/lib/faq-anchors";

const NOW = new Date("2026-10-12T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("growth rules (ADM-18 A)", () => {
  it("parses the window with a 30-day default", () => {
    expect(parseGrowthWindow("7")).toBe(7);
    expect(parseGrowthWindow("all")).toBe("all");
    expect(parseGrowthWindow("365")).toBe(30);
    expect(parseGrowthWindow(null)).toBe(30);
    expect(growthWindowStart("all", NOW)).toBeNull();
    expect(growthWindowStart(7, NOW)?.toISOString()).toBe(daysAgo(7));
  });

  it("normalises attacker-typed tags", () => {
    expect(normalizeTag("  Telegram ")).toBe("telegram");
    expect(normalizeTag("<script>alert(1)</script>")).toBe("script-alert-1-script");
    expect(normalizeTag("x".repeat(80))).toHaveLength(40);
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag(42)).toBeNull();
  });

  it("counts arrivals, signups and payers per source and campaign, untagged visible", () => {
    const { sources, campaigns } = buildSourceTables({
      arrivals: [
        { utm_source: "telegram", utm_campaign: "post-1" },
        { utm_source: "Telegram", utm_campaign: "post-1" },
        { utm_source: null, utm_campaign: null },
      ],
      signups: [
        { user_id: "a", utm_source: "telegram", utm_campaign: "post-1" },
        { user_id: "b", utm_source: null, utm_campaign: null },
      ],
      paying: new Set(["a"]),
    });
    expect(sources).toEqual([
      { source: "telegram", arrivals: 2, signups: 1, payers: 1 },
      { source: UNTAGGED, arrivals: 1, signups: 1, payers: 0 },
    ]);
    expect(campaigns).toEqual([{ source: "telegram", campaign: "post-1", arrivals: 2, signups: 1, payers: 1 }]);
  });

  it("folds past 12 sources into (other)", () => {
    const arrivals = Array.from({ length: 15 }, (_, i) => ({ utm_source: `s${i}`, utm_campaign: null }));
    const { sources } = buildSourceTables({ arrivals, signups: [], paying: new Set() });
    expect(sources).toHaveLength(12);
    expect(sources[11]).toEqual({ source: OTHER, arrivals: 4, signups: 0, payers: 0 });
  });

  it("prefers the signup event over the older activity record", () => {
    expect(pickSignupAttribution({ utm_source: "telegram" }, { utm_source: "reddit" }).utm_source).toBe("telegram");
    expect(pickSignupAttribution(null, { utm_source: "reddit", utm_campaign: "c" })).toEqual({ utm_source: "reddit", utm_campaign: "c" });
    expect(pickSignupAttribution(undefined, undefined)).toEqual({ utm_source: null, utm_campaign: null });
  });
});

describe("tagged links (ADM-18 A)", () => {
  it("slugs a post name and builds both links", () => {
    expect(campaignSlug("Fristen 17. Okt, Prüfung!")).toBe("fristen-17-okt-prufung");
    expect(campaignSlug("Straße")).toBe("strasse");
    expect(campaignSlug("!!!")).toBeNull();
    expect(campaignSlug("a".repeat(60))).toHaveLength(40);
    expect(buildCampaignLinks("fristen-17-okt")).toEqual({
      site: "https://medpruf.com/landing?utm_source=telegram&utm_medium=post&utm_campaign=fristen-17-okt",
      bot: "https://t.me/MedPruefBot?start=c_fristen-17-okt",
    });
  });
  it("only accepts slug characters from a bot start payload", () => {
    expect(parseCampaignStart("c_fristen-17-okt")).toBe("fristen-17-okt");
    expect(parseCampaignStart("c_fristen-17-okt_de")).toBe("fristen-17-okt");
    for (const bad of ["c_", "c_-x", "c_x-", "c_Upper", "c_../admin", "c_a/b", "web_login", "auth_x", null, undefined, `c_${"a".repeat(41)}`]) {
      expect(parseCampaignStart(bad)).toBeNull();
    }
    expect(campaignWelcomeUrl("https://medpruf.com/", null)).toBe("https://medpruf.com/?tg_start=1");
  });
  it("every built bot link round-trips through the parser", () => {
    for (const label of ["Fristen 17 Okt", "SIP Anmeldung März", "x"]) {
      const slug = campaignSlug(label)!;
      const payload = new URL(buildCampaignLinks(slug).bot).searchParams.get("start");
      expect(parseCampaignStart(payload)).toBe(slug);
    }
  });
});

describe("FAQ anchor (LX-27)", () => {
  it("maps the old crypto anchor to the payment section", () => {
    expect(resolveFaqAnchor("#crypto-only")).toBe("payment");
    expect(resolveFaqAnchor("#puyp")).toBe("puyp");
    expect(resolveFaqAnchor("")).toBeNull();
  });
});

describe("cohort funnel and sources (ADM-18 A)", () => {
  const users = [
    { id: "u-old", email: "user-56a01820@example.com", role: "user", created_at: daysAgo(200) },
    { id: "u-week", email: "user-a81b18b0@example.com", role: "user", created_at: daysAgo(3) },
    { id: "u-month", email: "user-bd0777ee@example.com", role: "user", created_at: daysAgo(20) },
    { id: "u-staff", email: "admin@medpruf.com", role: "admin", created_at: daysAgo(2) },
  ];
  function handler(call: FakeCall) {
    if (call.table === "users") return { data: users };
    if (call.table === "answer_history") return { count: eqVal(call, "user_id") === "u-week" ? 30 : 0 };
    if (call.table === "user_events") return { data: [{ user_id: "u-week", event_data: { source: "telegram", attribution: { utm_source: "telegram", utm_campaign: "post-1" } } }] };
    if (call.table === "user_activity_log") return { data: [{ user_id: "u-month", metadata: { attribution: { utm_source: "reddit" } } }] };
    if (call.table === "landing_hits") return { data: [{ utm_source: "telegram", utm_campaign: "post-1" }, { utm_source: "telegram", utm_campaign: "post-1" }, { utm_source: null, utm_campaign: null }] };
    if (call.table === "pricing_waitlist") return call.columns === "created_at" ? { data: [{ created_at: "2026-04-24T09:00:00Z" }] } : { count: call.filters.some((f) => f.kind === "gte") ? 0 : 7 };
    return { data: [], count: 0 };
  }

  it("30-day window counts only that cohort and splits it by source", async () => {
    const { sb, calls } = createFakeSupabase(handler);
    const m = await computeGrowthMetrics(sb as unknown as SupabaseClient, 30, NOW);
    expect(m.signups.count).toBe(2);
    expect(m.engaged.count).toBe(1);
    expect(m.signup_totals).toEqual({ last_7d: 1, last_30d: 2, all_time: 3 });
    expect(m.sources).toEqual([
      { source: "telegram", arrivals: 2, signups: 1, payers: 0 },
      { source: "reddit", arrivals: 0, signups: 1, payers: 0 },
      { source: UNTAGGED, arrivals: 1, signups: 0, payers: 0 },
    ]);
    expect(m.campaigns).toEqual([{ source: "telegram", campaign: "post-1", arrivals: 2, signups: 1, payers: 0 }]);
    expect(m.waitlist).toEqual({ total: 7, in_window: 0, latest_at: "2026-04-24T09:00:00Z" });
    // Only cohort users are counted one by one.
    expect(calls.filter((c) => c.table === "answer_history").map((c) => eqVal(c, "user_id")).sort()).toEqual(["u-month", "u-week"]);
    // Window reads are bounded by the window start.
    for (const table of ["landing_hits", "user_events", "user_activity_log"]) {
      expect(calls.find((c) => c.table === table)?.filters.some((f) => f.kind === "gte")).toBe(true);
    }
    // Counts only: no ids or emails leave.
    expect(JSON.stringify(m)).not.toMatch(/u-week|u-month|example\.org/);
  });

  it("all time keeps every real user and reads without a window filter", async () => {
    const { sb, calls } = createFakeSupabase(handler);
    const m = await computeGrowthMetrics(sb as unknown as SupabaseClient, "all", NOW);
    expect(m.signups.count).toBe(3);
    expect(m.since).toBeNull();
    expect(calls.find((c) => c.table === "landing_hits")?.filters.some((f) => f.kind === "gte")).toBe(false);
  });

  it("a failed source read fails the request instead of showing zero", async () => {
    const { sb } = createFakeSupabase((call) => (call.table === "landing_hits" ? { error: { message: "failed" } } : handler(call)));
    await expect(computeGrowthMetrics(sb as unknown as SupabaseClient, 30, NOW)).rejects.toMatchObject({ message: "failed" });
  });
});

describe("growth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ userId: "synthetic-admin", role: "admin", tier: "admin" });
    mocks.snapshot.mockResolvedValue(["revenue.read"]);
    mocks.db.mockReturnValue(createFakeSupabase(() => ({ data: [], count: 0 })).sb);
  });
  it("reads ?window and falls back to 30", async () => {
    expect((await (await growthRoute(new NextRequest("https://medpruf.com/api/stats/admin/growth?window=7"))).json()).window).toBe(7);
    expect((await (await growthRoute(new NextRequest("https://medpruf.com/api/stats/admin/growth?window=nope"))).json()).window).toBe(30);
  });
  it("refuses a caller the admin guard rejects", async () => {
    mocks.guard.mockResolvedValue({ error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await growthRoute(new NextRequest("https://medpruf.com/api/stats/admin/growth"))).status).toBe(403);
  });
  it("content carries as-of dates for the hand-kept sections", async () => {
    const body = await (await contentRoute(new NextRequest("https://medpruf.com/api/stats/admin/growth/content"))).json();
    expect(body.strategyAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.presenceAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
