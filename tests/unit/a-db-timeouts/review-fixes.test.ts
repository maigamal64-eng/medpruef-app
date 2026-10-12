import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";

// a-db-timeouts reviewer follow-ups: the shorter deadline must not double a
// Whop grant, heavy routes can ask for a longer deadline, upstream
// Retry-After is capped, and a real bug is never hidden behind a 503.

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: mocks.capture }));

import { extendOrInsertWhopSubscription } from "@/lib/whop-grant";
import { getServiceClient } from "@/lib/supabase";
import { createTimedFetch, __resetDbUnavailableState } from "@/lib/db-unavailable";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

beforeEach(() => { vi.clearAllMocks(); __resetDbUnavailableState(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("fallback Whop grant replay", () => {
  const args = { userId: "synthetic-user", tier: "first_month_19", paymentId: "pay_synthetic", amountCents: 1900, currency: "EUR", membershipId: "mem_synthetic" };

  it("a payment already in an active row's history is replayed, never extended twice", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "");
    const row = { id: "sub-1", tier: "first_month_19", expires_at: "2040-05-01T00:00:00.000Z", amount_cents: 1900, currency: "EUR", whop_membership_id: "mem_synthetic",
      granted_payment_ids: [{ payment_id: "pay_synthetic", amount_cents: 1900, added_months: 1, granted_at: "2040-04-01T00:00:00.000Z" }] };
    const fake = createFakeSupabase((call) => (call.table === "subscriptions" && call.op === "select" ? { data: [row] } : { data: null }));
    const result = await extendOrInsertWhopSubscription(fake.sb as unknown as SupabaseClient, args);
    expect(result).toMatchObject({ mode: "extended", subscriptionId: "sub-1", expiresAt: row.expires_at, replayed: true, entitlementReconciled: false });
    expect(fake.calls.some((c) => c.op === "update" || c.op === "insert")).toBe(false);
  });

  it("a new payment still extends the live row", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "");
    const row = { id: "sub-1", tier: "first_month_19", expires_at: "2040-05-01T00:00:00.000Z", amount_cents: 1900, currency: "EUR", whop_membership_id: null,
      granted_payment_ids: [{ payment_id: "pay_older", amount_cents: 1900, added_months: 1, granted_at: "2040-04-01T00:00:00.000Z" }] };
    const fake = createFakeSupabase((call) => (call.table === "subscriptions" && call.op === "select" ? { data: [row] } : { data: null }));
    const result = await extendOrInsertWhopSubscription(fake.sb as unknown as SupabaseClient, args);
    expect(result.mode).toBe("extended");
    expect(result.replayed).toBeUndefined();
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(1);
  });
});

describe("per-client deadline", () => {
  it("getServiceClient({ timeoutMs }) waits longer than the default before giving up", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    vi.stubEnv("SUPABASE_FETCH_TIMEOUT_MS", "1000");
    vi.stubGlobal("fetch", vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    const time = async (sb: SupabaseClient) => { const t = Date.now(); const { error } = await sb.from("users").select("id"); expect(error?.message).toMatch(/^DbUnavailableError/); return Date.now() - t; };
    const [short, long] = await Promise.all([time(getServiceClient()), time(getServiceClient({ timeoutMs: 1_600 }))]);
    expect(short).toBeLessThan(1_400);
    expect(long).toBeGreaterThanOrEqual(1_550);
  });
});

describe("rebuilt PostgREST response", () => {
  it("caps an upstream Retry-After and drops transfer headers", async () => {
    const upstream = vi.fn(async () => new Response("busy", { status: 503, headers: { "retry-after": "3600", "content-encoding": "gzip", "content-length": "4" } })) as unknown as typeof fetch;
    const res = await createTimedFetch(upstream, 500)("https://synthetic.supabase.invalid/rest/v1/x");
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(await res.text()).toBe("busy");
    const small = vi.fn(async () => new Response("busy", { status: 503, headers: { "retry-after": "1" } })) as unknown as typeof fetch;
    expect((await createTimedFetch(small, 500)("https://synthetic.supabase.invalid/rest/v1/x")).headers.get("retry-after")).toBe("1");
  });
});

describe("withDbUnavailable never hides a bug", () => {
  it("a non-database throw during an outage is reported before the 503", async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const res = await withDbUnavailable(async () => {
      await createTimedFetch(hang, 20)("https://synthetic.supabase.invalid/rest/v1/x").catch(() => null);
      throw new TypeError("cannot read properties of undefined");
    })();
    expect(res.status).toBe(503);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
  it("a database throw is not reported", async () => {
    const { DbUnavailableError } = await import("@/lib/db-unavailable");
    const res = await withDbUnavailable(async (): Promise<Response> => { throw new DbUnavailableError("timeout", "x"); })();
    expect(res.status).toBe(503);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
