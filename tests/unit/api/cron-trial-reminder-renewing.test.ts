import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMemoryDb, emptyTables, type MemoryTables } from "../reminders/memory-db";
import { suppressionKey } from "@/lib/mail-suppression";

// i-MP-TRUTH-19: the "pick a longer plan" reminder must skip users whose
// plan renews by itself, and must not stamp them.
const h = vi.hoisted(() => ({
  tables: null as unknown as MemoryTables,
  sendZohoEmail: vi.fn(async () => ({ ok: true })),
  planId: "plan_redacted145e2752" as string | null,
  suppression: "none" as "none" | "opt_out" | "error",
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const end = new Date(Date.now() + 3 * 86400_000).toISOString();
    const t = emptyTables();
    t.users.push({ id: "u2", email: "u@example.com", first_name: "U", language_code: "de", tier: "pro", role: "user", tier_expires_at: end });
    t.subscriptions.push({ id: "sub_due", user_id: "u2", tier: "first_3mo_27", status: "active", expires_at: end, payment_provider: "whop", provider_payment_id: "pay_due", trial_reminder_sent_at: null });
    if (h.planId) t.payment_events.push({ payment_id: "pay_due", plan_id: h.planId });
    if (h.suppression === "opt_out") t.mail_suppression.push({ id: "s1", email_key: suppressionKey("u@example.com"), cause: "opt_out", scope: "marketing", source: "comms-log", created_at: "2026-09-21T00:00:00Z", lifted_at: null });
    h.tables = t;
    return createMemoryDb(t, { failReads: h.suppression === "error" ? new Set(["mail_suppression"]) : undefined }).sb;
  },
}));

import { GET } from "@/app/api/cron/trial-reminder/route";

const run = () => GET(new NextRequest("https://x/api/cron/trial-reminder", { headers: { authorization: "Bearer cron_s" } }));
const stamped = () => h.tables.subscriptions.some((s) => s.id === "sub_due" && s.trial_reminder_sent_at);

beforeEach(() => {
  process.env.CRON_SECRET = "cron_s";
  process.env.TRIAL_REMINDER_EMAILS_ENABLED = "true";
  h.sendZohoEmail.mockClear();
  h.planId = "plan_redacted145e2752";
  h.suppression = "none";
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

  it("b39: never emails an address on the do-not-email list, and stamps it", async () => {
    h.planId = "plan_redacted8dbd8718";
    h.suppression = "opt_out";
    const body = await (await run()).json();
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    expect(stamped()).toBe(true);
    expect(body.reminders_marked).toBe(1);
    const event = h.tables.user_events.find((e) => e.event_type === "trial_reminder_email_suppressed");
    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain("u@example.com");
  });

  it("b39: fails closed when the do-not-email list cannot be read (no send, no stamp, no claim)", async () => {
    h.planId = "plan_redacted8dbd8718";
    h.suppression = "error";
    await run();
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    expect(stamped()).toBe(false);
    expect(h.tables.processed_webhook_events).toHaveLength(0);
  });
});
