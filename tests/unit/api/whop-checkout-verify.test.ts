import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";
const h = vi.hoisted(() => ({
  owner: { tier: "pro", role: "user", tier_expires_at: "2026-01-01T00:00:00Z", email: "synthetic@example.test" } as Record<string, unknown>,
  subs: [] as unknown[],
  events: [] as unknown[],
  calls: [] as unknown[],
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
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
