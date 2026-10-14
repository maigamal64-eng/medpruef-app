import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";
const h = vi.hoisted(() => ({
  owner: { tier: "pro", role: "user", tier_expires_at: "2026-01-01T00:00:00Z", email: "synthetic@example.test" } as Record<string, unknown>,
  subs: [] as unknown[],
  events: [] as unknown[],
  calls: [] as unknown[],
}));
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn(), hashEmail: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "synthetic", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => {
  const { sb, calls } = createFakeSupabase(c => {
    if (c.table === "users" && c.op === "select") return { data: h.owner };
    if (c.table === "users" && c.op === "update") { h.owner = { ...h.owner, ...(c.payload as object) }; return { data: { id: "22222222-2222-4222-8222-222222222222" } }; }
    if (c.table === "subscriptions" && c.op === "select") return { data: h.subs };
    if (c.table === "payment_events" && c.op === "select") return { data: h.events };
    return {};
  });
  h.calls = calls;
  return sb;
} }));
import { POST } from "@/app/api/whop/checkout/verify/route";
const req = () => new NextRequest("https://x/api/whop/checkout/verify", {method:"POST", body: JSON.stringify({tier:"first_month_19"})});
beforeEach(() => {
  delete process.env.WHOP_API_KEY; delete process.env.WHOP_APP_API_KEY;
  h.owner = { tier: "pro", role: "user", tier_expires_at: "2026-01-01T00:00:00Z", email: "synthetic@example.test" };
  h.subs = [];
  h.events = [];
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("checkout verify authoritative access", () => {
  it("does not report an expired Pro tier as an activated purchase", async () => {
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(false);
  });
  it("repairs a previous subscription write before needing another provider lookup", async () => {
    h.owner.tier = "free";
    h.subs = [{ expires_at: "2031-01-01T00:00:00Z" }];
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(true);
    expect(h.owner.tier).toBe("pro");
    expect(h.calls.some((c: unknown) => (c as {table:string;op:string}).table === "subscriptions" && (c as {op:string}).op !== "select")).toBe(false);
  });
  it("an extension is not granted until the end date moves past the previous end", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const from = "2031-01-01T00:00:00.000Z";
    h.owner = { tier: "pro", role: "user", tier_expires_at: from, email: "synthetic@example.test" };
    h.subs = [{ expires_at: from }];
    const ext = () => new NextRequest("https://x/api/whop/checkout/verify", { method: "POST", body: JSON.stringify({ tier: "first_month_19", extends_from: from }) });
    expect(await (await POST(ext())).json()).toMatchObject({ granted: false, reason: "extension_pending" });
    h.owner.tier_expires_at = "2031-02-01T00:00:00.000Z";
    h.subs = [{ expires_at: "2031-02-01T00:00:00.000Z" }];
    expect(await (await POST(ext())).json()).toMatchObject({ granted: true, already: true });
  });
  it("ignores extends_from while WHOP_EXTENSIONS_ENABLED is off (default)", async () => {
    const from = "2031-01-01T00:00:00.000Z";
    h.owner = { tier: "pro", role: "user", tier_expires_at: from, email: "synthetic@example.test" };
    h.subs = [{ expires_at: from }];
    for (const flag of ["", "TRUE", "1"]) {
      vi.stubEnv("WHOP_EXTENSIONS_ENABLED", flag);
      const ext = new NextRequest("https://x/api/whop/checkout/verify", { method: "POST", body: JSON.stringify({ tier: "first_month_19", extends_from: from }) });
      expect(await (await POST(ext)).json()).toMatchObject({ granted: true, already: true });
    }
  });
  it("already:true says whether a grant landed after the latest checkout (receipt line on the success page)", async () => {
    h.owner = { tier: "pro", role: "user", tier_expires_at: "2031-01-01T00:00:00.000Z", email: "synthetic@example.test" };
    h.events = [{ event: "grant_succeeded" }, { event: "checkout_redirected" }];
    expect(await (await POST(req())).json()).toMatchObject({ granted: true, already: true, paid_after_checkout: true });
    h.events = [{ event: "checkout_redirected" }, { event: "grant_succeeded" }];
    expect(await (await POST(req())).json()).toMatchObject({ already: true, paid_after_checkout: false });
    h.events = [];
    expect(await (await POST(req())).json()).toMatchObject({ already: true, paid_after_checkout: false });
  });
});

// JAVASCRIPT-NEXTJS-19: the ledger scan pages by cursor, filters with plan_ids
// and never lets repeated rows or another plan's membership decide a grant.
describe("checkout verify ledger scan", () => {
  const PLAN = "plan_redacted4b0850d6";
  const recent = () => new Date(Date.now() - 3600_000).toISOString();
  const urls: string[] = [];
  function stubWhop(memberships: () => unknown, payments: () => unknown) {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(input);
      const body = input.includes("/memberships") ? memberships() : payments();
      return new Response(JSON.stringify(body), { status: 200 });
    }));
  }
  beforeEach(() => {
    urls.length = 0;
    sentry.captureMessage.mockClear();
    vi.stubEnv("WHOP_API_KEY", "k_synthetic");
    vi.stubEnv("WHOP_PLAN_FIRST_MONTH_19", PLAN);
    vi.stubEnv("WHOP_COMPANY_ID", "biz_synthetic");
    h.owner = { tier: "free", role: "user", tier_expires_at: null, email: "synthetic@example.test" };
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("one membership repeated on every page is one email candidate, never email_ambiguous", async () => {
    const copy = { id: "mem_redacted1d1a3c26", status: "active", plan: { id: PLAN }, member: { email: "Synthetic@Example.test" }, created_at: recent() };
    stubWhop(
      () => ({ data: [copy, { ...copy }], page_info: { end_cursor: "c1", has_next_page: true }, total_count: 1 }),
      () => ({ data: [], page_info: { end_cursor: null, has_next_page: false }, total_count: 0 }),
    );
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ granted: false, reason: "membership_not_found" });
    const messages = sentry.captureMessage.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("email_ambiguous") || m.includes("ambiguous"))).toBe(false);
    expect(messages.some((m) => m.includes("whop_ledger_truncated"))).toBe(false);
    const membershipUrls = urls.filter((u) => u.includes("/memberships")).map((u) => new URL(u));
    expect(membershipUrls.length).toBeGreaterThan(0);
    for (const u of membershipUrls) {
      expect(u.searchParams.get("plan_ids")).toBe(PLAN);
      expect(u.searchParams.has("plan_id")).toBe(false);
      expect(u.searchParams.has("page")).toBe(false);
    }
  });

  it("a membership on another plan (e.g. the trial) never stands in for the paid tier", async () => {
    stubWhop(
      () => ({ data: [{ id: "mem_redacted2888d38f", status: "trialing", plan: { id: "plan_synthetic_trial" }, metadata: { medpruef_user_id: "22222222-2222-4222-8222-222222222222" }, member: { email: "other@example.test" }, created_at: recent() }], page_info: { end_cursor: "c1", has_next_page: false } }),
      () => ({ data: [{ id: "pay_redactedfb4d6557", status: "paid", member: { id: "mem_redacted2888d38f" }, created_at: recent() }], page_info: { end_cursor: "c1", has_next_page: false } }),
    );
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ granted: false, reason: "membership_not_found" });
    expect(h.calls.some((c: unknown) => (c as { table: string; op: string }).table === "subscriptions" && (c as { op: string }).op !== "select")).toBe(false);
  });
});
