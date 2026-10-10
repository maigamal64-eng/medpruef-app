import { afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";
import { repairWhopPaymentAccess, repairWhopUserAccess } from "@/lib/whop-entitlement";
afterEach(() => { delete process.env.WHOP_ATOMIC_GRANTS_ENABLED; });

/**
 * Real supabase-js client with a capturing fetch, so the test sees the exact
 * PostgREST query string the library serializes. A recorded-call fake would
 * hide the bug this guards (2026-10-07..09): `.contains()` with an array on
 * the jsonb `granted_payment_ids` column serialized `cs.{[object Object]}`,
 * the database answered 22P02, and every duplicate Whop delivery got a 503.
 */
function capturingClient() {
  const urls: URL[] = [];
  const sb = createClient("https://synthetic.supabase.co", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        urls.push(new URL(String(input instanceof Request ? input.url : input)));
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  });
  return { sb, urls };
}

describe("duplicate-delivery payment owner lookup", () => {
  it("sends a JSON-array containment filter for the jsonb granted_payment_ids column", async () => {
    const { sb, urls } = capturingClient();
    await repairWhopPaymentAccess(sb, "pay_redacted51b1a240");
    const history = urls.find(u => u.searchParams.has("granted_payment_ids"));
    expect(history, "history lookup request was not sent").toBeDefined();
    const raw = history!.searchParams.get("granted_payment_ids")!;
    expect(raw).toBe('cs.[{"payment_id":"pay_redacted51b1a240"}]');
    expect(raw).not.toContain("object Object");
    expect(raw.startsWith("cs.{")).toBe(false);
    // The value after `cs.` must be valid JSON, as Postgres parses it as jsonb.
    expect(JSON.parse(raw.slice(3))).toEqual([{ payment_id: "pay_redacted51b1a240" }]);
    expect(history!.pathname).toBe("/rest/v1/subscriptions");
    expect(history!.searchParams.get("payment_provider")).toBe("eq.whop");
  });

  it("keeps the latest-payment lookup on provider_payment_id", async () => {
    const { sb, urls } = capturingClient();
    await repairWhopPaymentAccess(sb, "pay_X");
    const latest = urls.find(u => u.searchParams.has("provider_payment_id"));
    expect(latest?.searchParams.get("provider_payment_id")).toBe("eq.pay_X");
  });
});
describe("stored Whop access repair", () => {
  it("preserves non-expiring subscription coverage without buying time", async () => {
    let owner = { tier: "free", tier_expires_at: null };
    const { sb, calls } = createFakeSupabase(c => {
      if (c.table === "users" && c.op === "select") return { data: owner };
      if (c.table === "subscriptions") return { data: [{ expires_at: null }] };
      if (c.table === "users" && c.op === "update") { owner = { ...owner, ...(c.payload as typeof owner) }; return { data: { id: "synthetic" } }; }
      return {};
    });
    expect(await repairWhopUserAccess(sb as unknown as SupabaseClient, "synthetic")).toEqual({ granted: true, tier_expires_at: null });
    expect(calls.some(c => c.table === "subscriptions" && c.op !== "select")).toBe(false);
  });
  it("cannot report repair success when a concurrent user change prevents the snapshot write", async () => {
    const { sb, calls } = createFakeSupabase(c => c.table === "users" && c.op === "select" ? { data: { tier: "free", tier_expires_at: null } }
      : c.table === "subscriptions" ? { data: [{ expires_at: "2031-01-01T00:00:00Z" }] } : { data: null });
    await expect(repairWhopUserAccess(sb as unknown as SupabaseClient, "synthetic")).rejects.toThrow("changed during repair");
    const write = calls.find(c => c.op === "update")!;
    expect(write.filters).toContainEqual({ kind: "eq", column: "tier", value: "free" });
    expect(write.filters).toContainEqual({ kind: "is", column: "tier_expires_at", value: null });
  });
  it.each(["true", "TRUE"])("uses the same literal gate as grants and revokes: %s", async (value) => {
    process.env.WHOP_ATOMIC_GRANTS_ENABLED = value;
    const { sb, calls } = createFakeSupabase(c => c.table === "rpc:repair_whop_user_access" ? { data: [{ granted: false, tier_expires_at: null }] } : c.table === "users" ? { data: { tier: "free", tier_expires_at: null } } : { data: [] });
    expect((await repairWhopUserAccess(sb as unknown as SupabaseClient, "synthetic")).granted).toBe(false);
    expect(calls.some(c => c.table === "rpc:repair_whop_user_access")).toBe(value === "true");
  });
  it("does not fall back to unsafe repair if the enabled RPC is unavailable", async () => {
    process.env.WHOP_ATOMIC_GRANTS_ENABLED = "true";
    const { sb, calls } = createFakeSupabase(() => ({ error: { message: "RPC missing" } }));
    await expect(repairWhopUserAccess(sb as unknown as SupabaseClient, "synthetic")).rejects.toMatchObject({ message: "RPC missing" });
    expect(calls).toHaveLength(1);
  });
});
