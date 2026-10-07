import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";
import { repairWhopUserAccess } from "@/lib/whop-entitlement";
afterEach(() => { delete process.env.WHOP_ATOMIC_GRANTS_ENABLED; });
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
