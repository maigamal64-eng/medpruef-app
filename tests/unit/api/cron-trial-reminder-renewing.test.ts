import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";

// i-MP-TRUTH-19: the "pick a longer plan" reminder must skip users whose
// plan renews by itself, and must not stamp them.
const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  sendZohoEmail: vi.fn(async () => ({ ok: true })),
  planId: "plan_redacted145e2752" as string | null,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/email/templates", () => ({ renderTrialReminder: () => ({ subject: "s", htmlBody: "b" }) }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.kind === "lte")) {
        return { data: [{ id: "sub_due", user_id: "u2", tier: "first_3mo_27", expires_at: new Date(Date.now() + 3 * 86400_000).toISOString() }] };
      }
      if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.kind === "lt")) return { data: [] };
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "user_id") === "u2") {
        return { data: [{ tier: "first_3mo_27", payment_provider: "whop", provider_payment_id: "pay_due" }] };
      }
      if (c.table === "payment_events") return { data: h.planId ? [{ payment_id: "pay_due", plan_id: h.planId }] : [] };
      if (c.table === "users" && c.op === "select") return { data: { email: "u@example.com", first_name: "U", language_code: "de" } };
      return {};
    });
    h.calls = calls;
    return sb;
  },
}));

import { GET } from "@/app/api/cron/trial-reminder/route";

const run = () => GET(new NextRequest("https://x/api/cron/trial-reminder", { headers: { authorization: "Bearer cron_s" } }));
const stamped = () => (h.calls as FakeCall[]).some((c) => c.table === "subscriptions" && c.op === "update" && eqVal(c, "id") === "sub_due");

beforeEach(() => {
  process.env.CRON_SECRET = "cron_s";
  process.env.TRIAL_REMINDER_EMAILS_ENABLED = "true";
  h.sendZohoEmail.mockClear();
  h.planId = "plan_redacted145e2752";
});

describe("cron trial-reminder: auto-renewing plans", () => {
  it("does not email or stamp a user on the recurring quarterly plan", async () => {
    const body = await (await run()).json();
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    expect(stamped()).toBe(false);
    expect(body.reminders_skipped_renewing).toBe(1);
    expect(body.reminders_marked).toBe(0);
  });
  it("does not email when the plan cannot be identified (fail closed)", async () => {
    h.planId = null;
    await run();
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    expect(stamped()).toBe(false);
  });
  it("still reminds a one-time buyer", async () => {
    h.planId = "plan_redacted8dbd8718";
    const body = await (await run()).json();
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
    expect(stamped()).toBe(true);
    expect(body.reminders_marked).toBe(1);
  });
});
