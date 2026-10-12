import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ACCESS_ENDING_CLAIM_PROVIDER,
  accessEndingClaimKey,
  decideAccessEnding,
  effectiveAccessEnd,
  previewAccessEndingAudience,
  runAccessEndingReminders,
} from "@/lib/reminders/access-ending";
import { suppressionKey } from "@/lib/mail-suppression";
import { createMemoryDb, emptyTables, type MemoryTables, type Row } from "./memory-db";

// a46: the existing day-25 sender, proved on the shape of the 10 Oct dry run
// (5 would-be recipients, two of them with a users end date a month after the
// row) plus the suppression and skip cases. All addresses are synthetic.

const ONE_TIME_PLAN = "plan_redacted324decbc";
const RENEWING_PLAN = "plan_redacted145e2752";
const NOW = new Date("2026-10-12T10:00:00Z");
const day = (d: string) => `${d}T21:59:00Z`;

interface Learner {
  id: string;
  email: string | null;
  tier?: string;
  role?: string;
  tierExpiresAt: string | null;
  lang?: string;
  rows: Array<{ id: string; tier: string; expires_at: string; status?: string; provider?: string; plan?: string | null; stamp?: string | null }>;
}

function seed(learners: Learner[], extra: Partial<MemoryTables> = {}): MemoryTables {
  const t = emptyTables();
  for (const l of learners) {
    t.users.push({ id: l.id, email: l.email, first_name: "Mira", language_code: l.lang ?? "de", tier: l.tier ?? "pro", role: l.role ?? "user", tier_expires_at: l.tierExpiresAt });
    for (const r of l.rows) {
      const paymentId = `pay_${r.id}`;
      t.subscriptions.push({
        id: r.id,
        user_id: l.id,
        tier: r.tier,
        status: r.status ?? "active",
        expires_at: r.expires_at,
        payment_provider: r.provider ?? "whop",
        provider_payment_id: paymentId,
        trial_reminder_sent_at: r.stamp ?? null,
      });
      if ((r.provider ?? "whop") === "whop" && r.plan !== null) t.payment_events.push({ payment_id: paymentId, plan_id: r.plan ?? ONE_TIME_PLAN });
    }
  }
  for (const [k, v] of Object.entries(extra)) t[k] = [...(t[k] ?? []), ...(v as Row[])];
  return t;
}

const suppress = (email: string, cause: string, scope = "all"): Row => ({
  id: `s_${cause}_${email.length}`,
  email_key: suppressionKey(email),
  cause,
  scope,
  source: "comms-log",
  created_at: "2026-09-21T00:00:00Z",
  lifted_at: null,
});

// The 10 Oct dry-run shape (ids synthetic, dates as observed).
const DRY_RUN: Learner[] = [
  { id: "4c39e744-a", email: "a@learner.example.org", tierExpiresAt: day("2026-10-13"), rows: [{ id: "4c39e744", tier: "first_month_19", expires_at: day("2026-10-13") }] },
  { id: "5117d7ef-b", email: "b@learner.example.org", tierExpiresAt: day("2026-11-17"), rows: [{ id: "5117d7ef", tier: "first_month_19", expires_at: day("2026-10-17") }] },
  { id: "ad943b4f-c", email: "c@learner.example.org", tierExpiresAt: day("2026-11-17"), rows: [{ id: "ad943b4f", tier: "first_3mo_27", expires_at: day("2026-10-17") }] },
  { id: "d8398a39-d", email: "d@learner.example.org", tierExpiresAt: day("2026-10-21"), rows: [{ id: "d8398a39", tier: "first_month_19", expires_at: day("2026-10-21") }] },
  { id: "c45d7fef-e", email: "e@learner.example.org", tierExpiresAt: day("2026-10-23"), rows: [{ id: "c45d7fef", tier: "first_3mo_27", expires_at: day("2026-10-23") }] },
];

const EDGE: Learner[] = [
  { id: "renew-f", email: "f@learner.example.org", tierExpiresAt: day("2026-10-20"), rows: [{ id: "row_f", tier: "first_3mo_27", expires_at: day("2026-10-20"), plan: RENEWING_PLAN }] },
  { id: "unknownplan-f2", email: "f2@learner.example.org", tierExpiresAt: day("2026-10-20"), rows: [{ id: "row_f2", tier: "first_month_19", expires_at: day("2026-10-20"), plan: null }] },
  { id: "admin-g", email: "g@learner.example.org", tier: "admin", role: "admin", tierExpiresAt: day("2026-10-15"), rows: [{ id: "row_g", tier: "first_month_19", expires_at: day("2026-10-15") }] },
  { id: "forever-h", email: "h@learner.example.org", tierExpiresAt: null, rows: [{ id: "row_h", tier: "first_month_19", expires_at: day("2026-10-15") }] },
  { id: "disagree-i", email: "i@learner.example.org", tierExpiresAt: day("2026-10-20"), rows: [{ id: "row_i", tier: "first_month_19", expires_at: day("2026-11-20") }] },
  { id: "bounce-j", email: "j@learner.example.org", tierExpiresAt: day("2026-10-19"), rows: [{ id: "row_j", tier: "first_month_19", expires_at: day("2026-10-19") }] },
  // Address listed before it had an account, stored with other case and spaces.
  { id: "unmatched-l", email: "  L@Learner.Example.org ", tierExpiresAt: day("2026-10-19"), rows: [{ id: "row_l", tier: "first_month_19", expires_at: day("2026-10-19") }] },
  { id: "invalid-m", email: "not-an-address", tierExpiresAt: day("2026-10-19"), rows: [{ id: "row_m", tier: "first_month_19", expires_at: day("2026-10-19") }] },
  { id: "manual-n", email: "n@learner.example.org", tierExpiresAt: day("2026-10-18"), rows: [{ id: "row_n", tier: "first_month_19", expires_at: day("2026-10-18"), provider: "manual" }] },
  { id: "cohort-o", email: "o@learner.example.org", tierExpiresAt: day("2026-10-18"), rows: [{ id: "row_o", tier: "premium_pass_guaranteed", expires_at: day("2026-10-18") }] },
  { id: "nomail-p", email: null, tierExpiresAt: day("2026-10-18"), rows: [{ id: "row_p", tier: "first_month_19", expires_at: day("2026-10-18") }] },
];

const SUPPRESSIONS = [
  suppress("e@learner.example.org", "opt_out", "marketing"),
  suppress("j@learner.example.org", "hard_bounce"),
  suppress("l@learner.example.org", "manual"),
  // Listed address with no account at all: must never break anything.
  suppress("nobody@elsewhere.example.org", "hard_bounce"),
];

const sent: Array<{ to: string; subject: string; htmlBody: string }> = [];
const send = vi.fn(async (m: { to: string; subject: string; htmlBody: string }) => {
  sent.push(m);
  return { ok: true as const };
});
const db = (t: MemoryTables, failReads?: Set<string>) => createMemoryDb(t, { failReads }).sb as unknown as SupabaseClient;
const recordInto = (t: MemoryTables) => async (userId: string, eventType: string, data: Record<string, unknown>) => {
  t.user_events.push({ user_id: userId, event_type: eventType, event_data: data });
};

beforeEach(() => {
  sent.length = 0;
  send.mockClear();
});

describe("effective access end (what the paywall enforces)", () => {
  const now = NOW.getTime();
  it("admins and Pro without an end are permanent", () => {
    expect(effectiveAccessEnd({ role: "admin", tier: "free" }, now).kind).toBe("permanent");
    expect(effectiveAccessEnd({ tier: "admin" }, now).kind).toBe("permanent");
    expect(effectiveAccessEnd({ tier: "pro", tier_expires_at: null }, now).kind).toBe("permanent");
  });
  it("free, past and corrupt dates are no access", () => {
    expect(effectiveAccessEnd({ tier: "free", tier_expires_at: day("2026-11-01") }, now).kind).toBe("none");
    expect(effectiveAccessEnd({ tier: "pro", tier_expires_at: "2026-10-01T00:00:00Z" }, now).kind).toBe("none");
    expect(effectiveAccessEnd({ tier: "pro", tier_expires_at: "garbage" }, now).kind).toBe("none");
  });
  it("a Pro end date is the end", () => {
    expect(effectiveAccessEnd({ tier: "pro", tier_expires_at: day("2026-11-17") }, now)).toEqual({ kind: "ends", endMs: Date.parse(day("2026-11-17")) });
  });
});

describe("decideAccessEnding", () => {
  const base = { owner: { tier: "pro", tier_expires_at: day("2026-10-20"), email: "x@learner.example.org" }, cadenceSuppressed: false, nowMs: NOW.getTime() };
  it("a row ending one minute after the users date is the same grant", () => {
    const rowEnd = new Date(Date.parse(day("2026-10-20")) + 30_000).toISOString();
    expect(decideAccessEnding({ ...base, activeRows: [{ id: "r", tier: "first_month_19", expires_at: rowEnd, trial_reminder_sent_at: null }] }).decision).toBe("send");
  });
  it("a row ending later than the paywall date is a disagreement, not a send", () => {
    expect(decideAccessEnding({ ...base, activeRows: [{ id: "r", tier: "first_month_19", expires_at: day("2026-10-25"), trial_reminder_sent_at: null }] }).decision).toBe("skip_rows_disagree");
  });
  it("an old stamp on a row ending the same Vienna day counts as already reminded", () => {
    expect(decideAccessEnding({ ...base, activeRows: [{ id: "r", tier: "first_month_19", expires_at: day("2026-10-20"), trial_reminder_sent_at: "2026-10-06T00:00:00Z" }] }).decision).toBe("skip_already_reminded");
  });
  it("unreadable cadence never sends", () => {
    expect(decideAccessEnding({ ...base, cadenceSuppressed: null, activeRows: [] }).decision).toBe("skip_cadence_unreadable");
  });
});

describe("preview: the exact current audience, no writes", () => {
  it("lists every decision on the dry-run shape and writes nothing", async () => {
    const t = seed([...DRY_RUN, ...EDGE], { mail_suppression: SUPPRESSIONS });
    const before = JSON.stringify(t);
    const p = await previewAccessEndingAudience(db(t), NOW);
    expect(JSON.stringify(t)).toBe(before);
    expect(send).not.toHaveBeenCalled();

    const by = Object.fromEntries(p.rows.map((r) => [r.user, r]));
    // 13 Oct payer: told 13 Oct.
    expect(by["4c39e744"]).toMatchObject({ decision: "send", access_end_day: "2026-10-13", suppression: "clear" });
    // Rows end 17 Oct but access runs to 17 Nov: not told a month early.
    expect(by["5117d7ef"]).toMatchObject({ decision: "skip_out_of_window", access_end_day: "2026-11-17" });
    expect(by["ad943b4f"]).toMatchObject({ decision: "skip_out_of_window", access_end_day: "2026-11-17" });
    expect(by["d8398a39"]).toMatchObject({ decision: "send", suppression: "clear" });
    expect(by["c45d7fef"]).toMatchObject({ decision: "send", suppression: "suppressed" });
    expect(by["renew-f"].decision).toBe("skip_renewing");
    expect(by["unknownp"].decision).toBe("skip_renewing");
    expect(by["admin-g"].decision).toBe("skip_permanent");
    expect(by["forever-"].decision).toBe("skip_permanent");
    expect(by["disagree"].decision).toBe("skip_rows_disagree");
    expect(by["bounce-j"]).toMatchObject({ decision: "send", suppression: "suppressed" });
    expect(by["unmatche"]).toMatchObject({ decision: "send", suppression: "suppressed" });
    expect(by["invalid-"]).toMatchObject({ decision: "send", suppression: "invalid" });
    expect(by["manual-n"]).toMatchObject({ decision: "send", suppression: "clear" });
    expect(by["nomail-p"].decision).toBe("no_email");
    // Cohort-only learner is not this sender's population.
    expect(by["cohort-o"]).toBeUndefined();

    expect(p.would_send).toBe(3);
    expect(p.withheld_by_list).toBe(4);
    expect(p.list_unreadable).toBe(0);
    expect(by["4c39e744"].subject).toBe("Ihr MedPrüf Pro-Zugang endet in 2 Tagen");
    // Masked: no address and no full id anywhere in the report.
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain("4c39e744-a");
  });

  it("reports an unreadable do-not-email list as unknown, never as clear", async () => {
    const t = seed(DRY_RUN);
    const p = await previewAccessEndingAudience(db(t, new Set(["mail_suppression"])), NOW);
    expect(p.would_send).toBe(0);
    expect(p.list_unreadable).toBe(3);
    expect(p.rows.filter((r) => r.decision === "send").every((r) => r.suppression === "unknown")).toBe(true);
  });
});

describe("sending run", () => {
  it("mails exactly the clear recipients, withholds listed and unusable addresses, and runs once", async () => {
    const t = seed([...DRY_RUN, ...EDGE], { mail_suppression: SUPPRESSIONS });
    const r1 = await runAccessEndingReminders(db(t), { now: NOW, recordEvent: recordInto(t), send });
    expect(sent.map((m) => m.to).sort()).toEqual(["a@learner.example.org", "d@learner.example.org", "n@learner.example.org"]);
    expect(r1.sent).toBe(3);
    expect(r1.withheld).toBe(4);
    expect(r1.errors).toEqual([]);

    // The date stated is the paywall date in Vienna.
    const mailA = sent.find((m) => m.to.startsWith("a@"))!;
    expect(mailA.htmlBody).toContain("13. Oktober 2026");

    // Withheld events carry no address.
    const withheldEvents = t.user_events.filter((e) => String(e.event_type).match(/suppressed|invalid_address/));
    expect(withheldEvents).toHaveLength(4);
    expect(JSON.stringify(withheldEvents)).not.toMatch(/@/);

    // One claim per learner and end date, recipients and withheld alike.
    expect(t.processed_webhook_events.map((c) => c.event_id).sort()).toContain(accessEndingClaimKey("4c39e744-a", Date.parse(day("2026-10-13"))));
    expect(t.processed_webhook_events.every((c) => c.provider === ACCESS_ENDING_CLAIM_PROVIDER)).toBe(true);
    expect(t.processed_webhook_events).toHaveLength(7);

    // A second run the same day (or a retry) sends nothing.
    sent.length = 0;
    const r2 = await runAccessEndingReminders(db(t), { now: new Date(NOW.getTime() + 3_600_000), recordEvent: recordInto(t), send });
    expect(sent).toHaveLength(0);
    expect(r2.sent).toBe(0);
  });

  it("reaches the learner whose end date was moved by hand once the real end approaches, with the real date", async () => {
    const t = seed(DRY_RUN.filter((l) => l.id.startsWith("5117")));
    // By 5 Nov the 17 Oct row has expired (expiry sweep); access runs to 17 Nov.
    t.subscriptions[0].status = "expired";
    const r = await runAccessEndingReminders(db(t), { now: new Date("2026-11-05T10:00:00Z"), recordEvent: recordInto(t), send });
    expect(r.sent).toBe(1);
    expect(sent[0].htmlBody).toContain("17. November 2026");
    expect(sent[0].htmlBody).not.toContain("17. Oktober");
  });

  it("uses neutral wording for a manually granted learner (never says they paid)", async () => {
    const t = seed(EDGE.filter((l) => l.id === "manual-n"));
    await runAccessEndingReminders(db(t), { now: NOW, recordEvent: recordInto(t), send });
    expect(sent).toHaveLength(1);
    expect(sent[0].htmlBody).not.toMatch(/bezahlt|paid once/i);
    expect(sent[0].htmlBody).toMatch(/keine automatische Abbuchung eingerichtet/);
  });

  it("fails closed when the do-not-email list cannot be read: no mail, claims released for a retry", async () => {
    const t = seed(DRY_RUN);
    const r = await runAccessEndingReminders(db(t, new Set(["mail_suppression"])), { now: NOW, recordEvent: recordInto(t), send });
    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(t.processed_webhook_events).toHaveLength(0);
    expect(r.errors.some((e) => e.includes("suppression_check_failed"))).toBe(true);
    expect(t.subscriptions.some((s) => s.trial_reminder_sent_at)).toBe(false);
  });

  it("releases the claim when the provider refuses, so the next run retries once", async () => {
    const t = seed(DRY_RUN.filter((l) => l.id.startsWith("4c39")));
    const refuse = vi.fn(async () => ({ ok: false as const, reason: "send_failed" as const, status: 502 }));
    const r = await runAccessEndingReminders(db(t), { now: NOW, recordEvent: recordInto(t), send: refuse });
    expect(r.sent).toBe(0);
    expect(t.processed_webhook_events).toHaveLength(0);
    await runAccessEndingReminders(db(t), { now: NOW, recordEvent: recordInto(t), send });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing and reports when the audience cannot be read", async () => {
    const t = seed(DRY_RUN);
    const r = await runAccessEndingReminders(db(t, new Set(["users"])), { now: NOW, recordEvent: recordInto(t), send });
    expect(send).not.toHaveBeenCalled();
    expect(r.errors).toEqual(["access-ending audience read failed: users_window"]);
  });

  it("a withheld end date stays final, even after the suppression is lifted", async () => {
    const t = seed(DRY_RUN.filter((l) => l.id.startsWith("c45d")), { mail_suppression: [suppress("e@learner.example.org", "opt_out", "marketing")] });
    await runAccessEndingReminders(db(t), { now: NOW, recordEvent: recordInto(t), send });
    expect(send).not.toHaveBeenCalled();
    t.mail_suppression[0].lifted_at = "2026-10-13T00:00:00Z";
    await runAccessEndingReminders(db(t), { now: new Date(NOW.getTime() + 86_400_000), recordEvent: recordInto(t), send });
    expect(send).not.toHaveBeenCalled();
  });
});
