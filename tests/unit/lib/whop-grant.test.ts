import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
import { reconcileUserTierPro } from "@/lib/whop-grant";

const expiry = "2030-01-01T00:00:00Z";
describe("reconcileUserTierPro", () => {
  it("preserves a non-expiring manual Pro grant after a finite purchase", async () => {
    const { sb, calls } = createFakeSupabase(() => ({ data: { tier: "pro", tier_expires_at: null } }));
    await reconcileUserTierPro(sb as unknown as SupabaseClient, "synthetic-user", expiry);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
  it("does not grant access when the owning user lookup fails", async () => {
    const { sb, calls } = createFakeSupabase(() => ({ error: { message: "read unavailable" } }));
    await expect(reconcileUserTierPro(sb as unknown as SupabaseClient, "synthetic-user", expiry)).rejects.toMatchObject({ message: "read unavailable" });
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
  it("keeps a longer finite override", async () => {
    const { sb, calls } = createFakeSupabase(() => ({ data: { tier: "pro", tier_expires_at: "2031-01-01T00:00:00Z" } }));
    await reconcileUserTierPro(sb as unknown as SupabaseClient, "synthetic-user", expiry);
    expect((calls.find((c) => c.op === "update")!.payload as {tier_expires_at: string}).tier_expires_at).toBe("2031-01-01T00:00:00.000Z");
  });
});
