import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  sendZohoEmail: vi.fn(async () => ({ ok: true })),
  ownerExpiry: null as string | null,
  failCoverage: false,
  failOwner: false,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/email/templates", () => ({ renderTrialReminder: () => ({ subject: "s", htmlBody: "b" }) }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.kind === "lt")) {
        return { data: [{ id: "sub_exp", user_id: "u1", tier: "first_month_19", expires_at: "2026-09-01T00:00:00Z" }] };
      }
      if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.kind === "lte")) {
        return { data: [{ id: "sub_due", user_id: "u2", tier: "first_month_19", expires_at: new Date(Date.now() + 3 * 86400_000).toISOString() }] };
      }
      if (c.table === "subscriptions" && c.op === "select") return h.failCoverage ? { error: { message: "coverage unavailable" } } : { data: [] }; // no other active sub
      if (c.table === "users" && c.op === "select") {
        if (h.failOwner) return { error: { message: "owner unavailable" } };
        return { data: { tier: "pro", tier_expires_at: h.ownerExpiry, email: "u@example.com", first_name: "U", language_code: "de" } };
      }
      return {};
    });
    h.calls = calls;
    return sb;
  },
}));

import { GET } from "@/app/api/cron/trial-reminder/route";

const run = () =>
  GET(new NextRequest("https://x/api/cron/trial-reminder", { headers: { authorization: "Bearer cron_s" } }));

beforeEach(() => {
  process.env.CRON_SECRET = "cron_s";
  delete process.env.TRIAL_REMINDER_EMAILS_ENABLED;
  h.sendZohoEmail.mockClear();
  h.ownerExpiry = "2026-09-01T00:00:00Z";
  h.failCoverage = false;
  h.failOwner = false;
});

describe("cron trial-reminder", () => {
  it("rejects calls without the cron secret", async () => {
    const res = await GET(new NextRequest("https://x/api/cron/trial-reminder"));
    expect(res.status).toBe(401);
  });

  it("sends NO customer reminder emails unless TRIAL_REMINDER_EMAILS_ENABLED=true", async () => {
    await run();
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
  });

  it("flips the expired row and downgrades a user with no remaining coverage", async () => {
    const res = await run();
    expect((await res.json()).expiries_processed).toBe(1);
    const calls = h.calls as FakeCall[];
    expect(calls.some((c) => c.table === "subscriptions" && c.op === "update" && eqVal(c, "id") === "sub_exp")).toBe(true);
    expect(calls.some((c) => c.table === "users" && c.op === "update" && (c.payload as { tier?: string }).tier === "free")).toBe(true);
  });

  it("never downgrades a user whose users.tier_expires_at is still in the future", async () => {
    h.ownerExpiry = new Date(Date.now() + 30 * 86400_000).toISOString();
    await run();
    const calls = h.calls as FakeCall[];
    expect(calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
  });
  it("preserves a non-expiring manual Pro grant when a paid row expires", async () => {
    h.ownerExpiry = null;
    await run();
    const calls = h.calls as FakeCall[];
    expect(calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
  });

  it.each(["failCoverage", "failOwner"] as const)("does not downgrade when %s read fails", async (failure) => {
    h[failure] = true;
    await run();
    expect((h.calls as FakeCall[]).some((c) => c.table === "users" && c.op === "update")).toBe(false);
  });

});
