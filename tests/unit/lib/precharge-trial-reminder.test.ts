import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";
const h = vi.hoisted(() => ({ verified: true, snapshot: {} as Record<string, unknown>, send: vi.fn(), claimed: false, suppression: "none" as "none" | "opt_out" | "hard_bounce" | "error" }));
vi.mock("@/lib/billing-copy", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/billing-copy")>(), get VERIFIED_CANCEL_PATH() { return h.verified; } }));
vi.mock("@/lib/whop-subscription-snapshot", () => ({ loadWhopBillingSnapshot: vi.fn(async () => h.snapshot) }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.send }));
import { eligiblePrechargeReminder, prechargeRemindersEnabled, renderPrechargeReminder, sendPrechargeTrialReminder } from "@/lib/precharge-trial-reminder";
import type { ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";
const now = Date.parse("2026-10-11T12:00:00Z");
function fake() {
  return createFakeSupabase(c => {
    if (c.table === "subscriptions" && c.op === "select") return { data: { id: "sub_a", status: "active", tier: "notes_pro_trial", expires_at: "2026-10-14T12:00:00Z", trial_reminder_sent_at: null } };
    if (c.table === "users") return { data: { email: "fixture@example.com", language_code: "de" } };
    if (c.table === "mail_suppression") {
      if (h.suppression === "error") return { error: { message: "unavailable" } };
      if (h.suppression === "none") return { data: [] };
      const key = ((c.filters.find((f: { kind: string }) => f.kind === "in") as { value?: string[] } | undefined)?.value ?? [])[0];
      return { data: [{ id: "s1", email_key: key, cause: h.suppression, scope: h.suppression === "opt_out" ? "marketing" : "all", source: "comms-log", created_at: "2026-09-21T00:00:00Z" }] };
    }
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      if (h.claimed) return { error: { code: "23505" } };
      h.claimed = true; return { data: { event_id: "trialssoon:mem_a" } };
    }
    return {};
  });
}
beforeEach(() => {
  h.verified = true; h.claimed = false; h.suppression = "none"; h.send.mockReset().mockResolvedValue({ ok: true });
  process.env.TRIAL_REMINDER_EMAILS_ENABLED = "true";
  h.snapshot = { plan_id: "plan_redactedec56d4df", billing_cadence: "auto_renews", provider_status: "trialing", is_trial: true, cancel_at_period_end: false, next_charge_at: "2026-10-13T12:00:00Z", next_charge_amount_cents: 1772, billing_interval_days: 30, manage_url: "https://whop.com/billing/manage/mem_a", provider_state_verified: true };
});
afterEach(() => { delete process.env.TRIAL_REMINDER_EMAILS_ENABLED; });
describe("precharge reminder", () => {
  it("flag OFF or missing cancellation release proof does no send or claim", async () => {
    const { sb, calls } = fake();
    delete process.env.TRIAL_REMINDER_EMAILS_ENABLED;
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, { userId: "u1", membershipId: "mem_a", nowMs: now })).toBe("disabled");
    process.env.TRIAL_REMINDER_EMAILS_ENABLED = "true"; h.verified = false;
    expect(prechargeRemindersEnabled()).toBe(false);
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, { userId: "u1", membershipId: "mem_a", nowMs: now })).toBe("disabled");
    expect(h.send).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
  });
  it("concurrent cron/webhook invocations emit at most one message per membership", async () => {
    const { sb, calls } = fake();
    const args = { userId: "u1", membershipId: "mem_a", nowMs: now };
    const results = await Promise.all([sendPrechargeTrialReminder(sb as unknown as SupabaseClient, args), sendPrechargeTrialReminder(sb as unknown as SupabaseClient, args)]);
    expect(results.sort()).toEqual(["duplicate", "sent"]); expect(h.send).toHaveBeenCalledTimes(1);
    expect(calls.some(c => c.table === "subscriptions" && c.op === "update")).toBe(true);
  });
  it("retains the claim after ambiguous provider failure, prevents another send", async () => {
    h.send.mockRejectedValue(new Error("timeout")); const { sb } = fake();
    const args = { userId: "u1", membershipId: "mem_a", nowMs: now };
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, args)).toBe("failed");
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, args)).toBe("duplicate"); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("b39: a marketing opt-out still gets the billing notice", async () => {
    h.suppression = "opt_out"; const { sb } = fake();
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, { userId: "u1", membershipId: "mem_a", nowMs: now })).toBe("sent");
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("b39: a hard bounce on the do-not-email list gets nothing and burns no claim", async () => {
    h.suppression = "hard_bounce"; const { sb, calls } = fake();
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, { userId: "u1", membershipId: "mem_a", nowMs: now })).toBe("ineligible");
    expect(h.send).not.toHaveBeenCalled();
    expect(calls.some(c => c.table === "processed_webhook_events")).toBe(false);
    expect(calls.some(c => c.table === "user_events" && JSON.stringify(c.payload).includes("trial_precharge_reminder_suppressed"))).toBe(true);
    expect(JSON.stringify(calls.filter(c => c.table === "user_events").map(c => c.payload))).not.toContain("fixture@example.com");
  });
  it("b39: an unreadable list fails closed without a claim", async () => {
    h.suppression = "error"; const { sb, calls } = fake();
    expect(await sendPrechargeTrialReminder(sb as unknown as SupabaseClient, { userId: "u1", membershipId: "mem_a", nowMs: now })).toBe("unavailable");
    expect(h.send).not.toHaveBeenCalled(); expect(calls.some(c => c.table === "processed_webhook_events")).toBe(false);
  });
  it.each([{ cancel_at_period_end: true }, { provider_status: "active", is_trial: false }, { next_charge_at: null }, { next_charge_amount_cents: null }, { manage_url: null }, { next_charge_at: "2026-10-14T12:00:00Z" }])("skips unverified/canceled/not-due trial %j", patch => {
    expect(eligiblePrechargeReminder({ ...h.snapshot, ...patch } as unknown as ProviderBillingSnapshot, now)).toBe(false);
  });
  it("uses exact provider date/amount and actual membership cancellation steps", () => {
    const tpl = renderPrechargeReminder(h.snapshot as unknown as ProviderBillingSnapshot, "de");
    expect(tpl.subject).toContain("13. Oktober 2026"); expect(tpl.htmlBody).toContain("17,72 €");
    expect(tpl.htmlBody).toContain("https://whop.com/billing/manage/mem_a"); expect(tpl.htmlBody).toContain("Cancel membership"); expect(tpl.htmlBody).not.toMatch(/[\u2013\u2014]/);
  });
});
