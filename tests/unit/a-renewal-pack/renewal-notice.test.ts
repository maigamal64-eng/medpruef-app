import { describe, expect, it, vi } from "vitest";

import { renewalNoticeDryRun, renewalNoticeEnabled } from "@/lib/renewal-notice/flag";
import { renewalNoticeClaimKey, renewalNoticeDue, viennaDaysBetween, WHOP_READ_BUDGET_MS } from "@/lib/renewal-notice/rules";
import { RENEWAL_NOTICE_COPY, renderRenewalNotice } from "@/lib/renewal-notice/copy";
import { runRenewalNotices } from "@/lib/renewal-notice/run";
import { suppressionKey } from "@/lib/mail-suppression";
import { parseWhopBillingSnapshot, type ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";
import { fakeSb } from "./fake-sb";

// The real case: 48e1837d, Whop charges mem_1suK4 on 30 Oct 14:53:44 UTC, ledger end 1 Nov.
const CHARGE = "2026-10-30T14:53:44.868Z";
const at = (iso: string) => Date.parse(iso);

function snap(over: Partial<ProviderBillingSnapshot> = {}): ProviderBillingSnapshot {
  return {
    plan_id: "plan_redactedec56d4df", billing_cadence: "auto_renews", provider_status: "active", is_trial: false,
    cancel_at_period_end: false, next_charge_at: CHARGE, next_charge_amount_cents: 1900, billing_interval_days: 30,
    manage_url: "https://whop.com/billing/manage/abc?x=1&y=2", provider_state_verified: true, ...over,
  };
}

describe("flags", () => {
  it("default off and dry run; only the literals switch", () => {
    expect(renewalNoticeEnabled({})).toBe(false);
    expect(renewalNoticeEnabled({ RENEWAL_NOTICE_ENABLED: "TRUE" })).toBe(false);
    expect(renewalNoticeEnabled({ RENEWAL_NOTICE_ENABLED: "true" })).toBe(true);
    expect(renewalNoticeDryRun({})).toBe(true);
    expect(renewalNoticeDryRun({ RENEWAL_NOTICE_DRY_RUN: "no" })).toBe(true);
    expect(renewalNoticeDryRun({ RENEWAL_NOTICE_DRY_RUN: "false" })).toBe(false);
  });
});

describe("renewalNoticeDue", () => {
  it("the 07:00 UTC run three Vienna days before the charge is due (27 Oct for 30 Oct)", () => {
    const d = renewalNoticeDue(snap(), at("2026-10-27T07:00:00Z"));
    expect(d).toMatchObject({ due: true, chargeDay: "2026-10-30", daysAhead: 3 });
  });
  it("four days before is too early; two and one day before catch up; the charge day is out", () => {
    expect(renewalNoticeDue(snap(), at("2026-10-26T07:00:00Z"))).toEqual({ due: false, reason: "out_of_window" });
    expect(renewalNoticeDue(snap(), at("2026-10-28T07:00:00Z"))).toMatchObject({ due: true, daysAhead: 2 });
    expect(renewalNoticeDue(snap(), at("2026-10-29T07:00:00Z"))).toMatchObject({ due: true, daysAhead: 1 });
    expect(renewalNoticeDue(snap(), at("2026-10-30T07:00:00Z"))).toEqual({ due: false, reason: "out_of_window" });
    expect(renewalNoticeDue(snap(), at("2026-10-31T07:00:00Z"))).toEqual({ due: false, reason: "out_of_window" });
  });
  it("counts Vienna calendar days across the 25 Oct clock change", () => {
    expect(viennaDaysBetween(at("2026-10-24T22:30:00Z"), at("2026-10-27T23:30:00Z"))).toBe(3);
    expect(viennaDaysBetween(at("2026-10-24T21:30:00Z"), at("2026-10-24T22:30:00Z"))).toBe(1);
  });
  it("never for a trial, a stopping, paused, cancelled or unreadable membership", () => {
    const now = at("2026-10-27T07:00:00Z");
    expect(renewalNoticeDue(null, now)).toEqual({ due: false, reason: "no_snapshot" });
    expect(renewalNoticeDue(snap({ provider_state_verified: false }), now)).toEqual({ due: false, reason: "no_snapshot" });
    expect(renewalNoticeDue(snap({ is_trial: true, provider_status: "trialing" }), now)).toEqual({ due: false, reason: "trialing" });
    expect(renewalNoticeDue(snap({ billing_cadence: "one_time" }), now)).toEqual({ due: false, reason: "not_renewing" });
    expect(renewalNoticeDue(snap({ provider_status: "past_due" }), now)).toEqual({ due: false, reason: "not_renewing" });
    expect(renewalNoticeDue(snap({ cancel_at_period_end: true }), now)).toEqual({ due: false, reason: "cancelling" });
    expect(renewalNoticeDue(snap({ next_charge_at: null }), now)).toEqual({ due: false, reason: "no_charge_date" });
    expect(renewalNoticeDue(snap({ next_charge_amount_cents: null }), now)).toEqual({ due: false, reason: "no_amount" });
    expect(renewalNoticeDue(snap({ billing_interval_days: null }), now)).toEqual({ due: false, reason: "no_amount" });
    expect(renewalNoticeDue(snap({ billing_interval_days: 180, next_charge_amount_cents: 17900 }), now)).toEqual({ due: false, reason: "half_year" });
  });
  it("works on a parsed Whop membership (paused collection gives no date)", () => {
    const body = { id: "mem_redacted6448c29b", plan: { id: "plan_redactedec56d4df" }, status: "active", cancel_at_period_end: false, currency: "eur",
      formatted_renewal_price: "€19.00 / month", renewal_period_end: CHARGE, manage_url: "https://whop.com/billing/manage/x" };
    const parsed = parseWhopBillingSnapshot(body, { membershipId: "mem_redacted6448c29b", tier: "notes_pro_trial" });
    expect(renewalNoticeDue(parsed, at("2026-10-27T07:00:00Z"))).toMatchObject({ due: true, daysAhead: 3 });
    const paused = parseWhopBillingSnapshot({ ...body, payment_collection_paused: true }, { membershipId: "mem_redacted6448c29b", tier: "notes_pro_trial" });
    expect(renewalNoticeDue(paused, at("2026-10-27T07:00:00Z"))).toEqual({ due: false, reason: "no_charge_date" });
  });
  it("claim key is per membership and charge day", () => {
    expect(renewalNoticeClaimKey("mem_1", "2026-10-30")).toBe("renewal_notice:mem_1:2026-10-30");
  });
});

describe("renderRenewalNotice", () => {
  it("states Whop's date, amount and interval in German Sie and English, escapes the link, no em dash", () => {
    const de = renderRenewalNotice({ lang: "de", chargeAtIso: CHARGE, amountCents: 1900, intervalDays: 30, manageUrl: "https://whop.com/billing/manage/abc?x=1&y=2" });
    expect(de.subject).toBe("Ihr MedPrüf-Abo verlängert sich am 30. Oktober 2026");
    expect(de.htmlBody).toContain("werden 19 € über Whop abgebucht");
    expect(de.htmlBody).toContain("alle 30 Tage");
    expect(de.htmlBody).toContain('href="https://whop.com/billing/manage/abc?x=1&amp;y=2"');
    expect(de.htmlBody).not.toMatch(/\bdu\b|\bdein/i);
    const en = renderRenewalNotice({ lang: "en", chargeAtIso: CHARGE, amountCents: 4900, intervalDays: 90, manageUrl: null });
    expect(en.subject).toBe("Your MedPrüf subscription renews on 30 October 2026");
    expect(en.htmlBody).toContain("49 €");
    expect(en.htmlBody).toContain("every 90 days");
    expect(en.htmlBody).toContain('href="https://whop.com/@me/settings/memberships"');
    for (const text of [de.subject, de.htmlBody, en.subject, en.htmlBody, JSON.stringify(RENEWAL_NOTICE_COPY)]) expect(text).not.toMatch(/[–—]/);
  });
  it("shows the Whop cancel steps only once the cancel path is verified; the reply fallback always", () => {
    const off = renderRenewalNotice({ lang: "de", chargeAtIso: CHARGE, amountCents: 1900, intervalDays: 30, manageUrl: null, verifiedCancelPath: false });
    const on = renderRenewalNotice({ lang: "de", chargeAtIso: CHARGE, amountCents: 1900, intervalDays: 30, manageUrl: null, verifiedCancelPath: true });
    expect(off.htmlBody).not.toContain("Cancel membership");
    expect(on.htmlBody).toContain("Cancel membership");
    expect(off.htmlBody).toContain("vor dem Tag der Abbuchung auf diese E-Mail antworten, dann beenden wir die Verlängerung für Sie");
    expect(off.htmlBody).toContain("weil sich Ihr Abo automatisch verlängert");
    expect(off.htmlBody).not.toContain("vor jeder");
  });
  it("an Austrian January reads Jänner", () => {
    expect(renderRenewalNotice({ lang: "de", chargeAtIso: "2027-01-15T10:00:00Z", amountCents: 1900, intervalDays: 30, manageUrl: null }).subject).toContain("15. Jänner 2027");
  });
  it("refuses missing terms", () => {
    expect(() => renderRenewalNotice({ lang: "de", chargeAtIso: CHARGE, amountCents: 0, intervalDays: 30, manageUrl: null })).toThrow();
    expect(() => renderRenewalNotice({ lang: "de", chargeAtIso: "x", amountCents: 1900, intervalDays: 30, manageUrl: null })).toThrow();
  });
});

const UID = "5ff431be-2e41-4589-81ce-6da35e69ab94";
const MEM = "mem_redactedb84db0f1";
const NOW = new Date("2026-10-27T07:00:00Z");
const baseTables = () => ({
  subscriptions: [
    { id: "s1", user_id: UID, tier: "notes_pro_trial", payment_provider: "whop", status: "active", whop_membership_id: MEM, expires_at: "2026-11-01T14:54:33.975Z" },
  ],
  users: [{ id: UID, email: "user-610e28c1@example.com", language_code: "de" }],
});

describe("runRenewalNotices", () => {
  it("dry run reads Whop and decides, writes no claim and no event, sends nothing", async () => {
    const f = fakeSb(baseTables());
    const send = vi.fn(); const events: string[] = [];
    const r = await runRenewalNotices(f.sb, { now: NOW, dryRun: true, send, recordEvent: async (_u, e) => { events.push(e); }, loadSnapshot: async () => snap() });
    expect(r).toMatchObject({ candidates: 1, wouldSend: 1, sent: 0 });
    expect(r.rows[0]).toMatchObject({ user: "48e1837d", membership: "mem_1suK4", decision: "would_send", charge_day: "2026-10-30", days_ahead: 3, amount_cents: 1900, suppression: "clear" });
    expect(JSON.stringify(r.rows)).not.toContain("@");
    expect(send).not.toHaveBeenCalled(); expect(events).toEqual([]); expect(f.inserted).toEqual([]);
  });

  it("live: one claim outside the marketing-cap provider, one transactional mail, one event; the next day is a duplicate", async () => {
    const f = fakeSb(baseTables());
    const send = vi.fn(async () => ({ ok: true } as const)); const events: Array<[string, Record<string, unknown>]> = [];
    const run = (now: Date) => runRenewalNotices(f.sb, { now, dryRun: false, send, recordEvent: async (_u, e, d) => { events.push([e, d]); }, loadSnapshot: async () => snap() });
    const a = await run(NOW);
    expect(a.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ to: string; subject: string }])[0]).toMatchObject({ to: "user-610e28c1@example.com", subject: "Ihr MedPrüf-Abo verlängert sich am 30. Oktober 2026" });
    expect(f.tables.processed_webhook_events).toEqual([expect.objectContaining({ provider: "renewal_notice", event_id: `renewal_notice:${MEM}:2026-10-30` })]);
    expect(events).toEqual([["renewal_notice_sent", expect.objectContaining({ membership_id: MEM, amount_cents: 1900, days_ahead: 3 })]]);
    const b = await run(new Date("2026-10-28T07:00:00Z"));
    expect(b).toMatchObject({ sent: 0, duplicates: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a Stopp (marketing) opt-out still gets it; a bounce (scope all) does not and keeps the claim", async () => {
    const optOut = fakeSb({ ...baseTables(), mail_suppression: [{ id: "1", email_key: suppressionKey("user-610e28c1@example.com"), cause: "opt_out", scope: "marketing", source: "t", created_at: "x", lifted_at: null }] });
    const send = vi.fn(async () => ({ ok: true } as const));
    expect((await runRenewalNotices(optOut.sb, { now: NOW, dryRun: false, send, recordEvent: async () => {}, loadSnapshot: async () => snap() })).sent).toBe(1);

    const bounce = fakeSb({ ...baseTables(), mail_suppression: [{ id: "2", email_key: suppressionKey("user-610e28c1@example.com"), cause: "hard_bounce", scope: "all", source: "t", created_at: "x", lifted_at: null }] });
    const send2 = vi.fn(); const events: string[] = [];
    const r = await runRenewalNotices(bounce.sb, { now: NOW, dryRun: false, send: send2, recordEvent: async (_u, e) => { events.push(e); }, loadSnapshot: async () => snap() });
    expect(r).toMatchObject({ sent: 0, withheld: 1 }); expect(send2).not.toHaveBeenCalled();
    expect(events).toEqual(["renewal_notice_suppressed"]);
    expect(bounce.tables.processed_webhook_events).toHaveLength(1);
  });

  it("a provider 4xx releases the claim so tomorrow retries; a 5xx keeps it (at most once)", async () => {
    const f4 = fakeSb(baseTables());
    const r4 = await runRenewalNotices(f4.sb, { now: NOW, dryRun: false, send: async () => ({ ok: false, reason: "send_failed", status: 400 }), recordEvent: async () => {}, loadSnapshot: async () => snap() });
    expect(r4.errors.some((e) => e.startsWith("send:"))).toBe(true);
    expect(f4.tables.processed_webhook_events).toHaveLength(0);
    const f5 = fakeSb(baseTables());
    await runRenewalNotices(f5.sb, { now: NOW, dryRun: false, send: async () => ({ ok: false, reason: "send_failed", status: 502 }), recordEvent: async () => {}, loadSnapshot: async () => snap() });
    expect(f5.tables.processed_webhook_events).toHaveLength(1);
  });

  it("candidates: one per membership, never a legacy mber_ pin or a one-time tier; a failed Whop read is reported", async () => {
    const f = fakeSb({
      subscriptions: [
        ...baseTables().subscriptions,
        { id: "s2", user_id: UID, tier: "notes_pro_trial", payment_provider: "whop", status: "active", whop_membership_id: MEM, expires_at: "2026-11-02T00:00:00Z" },
        { id: "s3", user_id: "b", tier: "first_month_19", payment_provider: "whop", status: "active", whop_membership_id: "mber_old", expires_at: "2026-10-30T00:00:00Z" },
        { id: "s4", user_id: "c", tier: "sitting_pass", payment_provider: "whop", status: "active", whop_membership_id: "mem_onetime", expires_at: "2026-10-30T00:00:00Z" },
        { id: "s5", user_id: "d", tier: "flex_month", payment_provider: "whop", status: "active", whop_membership_id: "mem_flex", expires_at: "2026-11-20T00:00:00Z" },
        { id: "s6", user_id: "e", tier: "first_month_19", payment_provider: "nowpayments", status: "active", whop_membership_id: null, expires_at: "2026-10-30T00:00:00Z" },
      ],
      users: baseTables().users,
    });
    const seen: string[] = [];
    const r = await runRenewalNotices(f.sb, { now: NOW, dryRun: true, recordEvent: async () => {}, loadSnapshot: async (m) => { seen.push(m); return m === MEM ? snap() : null; } });
    // The flex_month row ends 24 days out: read too (a stacked renew-early row can end a period after the charge).
    expect(seen).toEqual([MEM, "mem_flex"]);
    expect(r.candidates).toBe(2);
    expect(r.skipped.legacy_pin).toBe(1); expect(r.errors).toContain("legacy_pin:b");

    const g = fakeSb(baseTables());
    const r2 = await runRenewalNotices(g.sb, { now: NOW, dryRun: true, recordEvent: async () => {}, loadSnapshot: async () => { throw new Error("timeout"); } });
    expect(r2.skipped.no_snapshot).toBe(1); expect(r2.errors).toContain("no_snapshot:48e1837d");
  });

  it("a membership on two accounts is skipped, never guessed", async () => {
    const t = baseTables();
    t.subscriptions.push({ id: "s9", user_id: "other-acct-0000", tier: "notes_pro_trial", payment_provider: "whop", status: "active", whop_membership_id: MEM, expires_at: "2026-11-05T00:00:00Z" });
    const f = fakeSb(t);
    const read = vi.fn(async () => snap());
    const r = await runRenewalNotices(f.sb, { now: NOW, dryRun: false, send: vi.fn(), recordEvent: async () => {}, loadSnapshot: read });
    expect(read).not.toHaveBeenCalled(); expect(r.skipped.rows_disagree).toBe(1); expect(r.errors).toContain("rows_disagree:48e1837d");
  });

  it("a membership noticed in the last 7 days costs no Whop read", async () => {
    const f = fakeSb({ ...baseTables(), processed_webhook_events: [{ provider: "renewal_notice", event_id: `renewal_notice:${MEM}:2026-10-30`, processed_at: "2026-10-27T07:00:01Z" }] });
    const read = vi.fn(async () => snap());
    const r = await runRenewalNotices(f.sb, { now: new Date("2026-10-28T07:00:00Z"), dryRun: false, send: vi.fn(), recordEvent: async () => {}, loadSnapshot: read });
    expect(read).not.toHaveBeenCalled(); expect(r).toMatchObject({ duplicates: 1, candidates: 0 });
  });

  it("a renew-early stacked row whose ledger end runs a month past Whop's charge is still noticed", async () => {
    const t = baseTables(); t.subscriptions[0].expires_at = "2026-11-29T14:54:33Z";
    const f = fakeSb(t);
    const r = await runRenewalNotices(f.sb, { now: NOW, dryRun: true, recordEvent: async () => {}, loadSnapshot: async () => snap() });
    expect(r.wouldSend).toBe(1);
  });

  it("stops reading Whop when the time budget is spent", async () => {
    const f = fakeSb(baseTables());
    let t = 0;
    const r = await runRenewalNotices(f.sb, { now: NOW, dryRun: true, recordEvent: async () => {}, loadSnapshot: async () => snap(), clock: () => (t += WHOP_READ_BUDGET_MS + 1) });
    expect(r.errors).toContain("time_budget"); expect(r.wouldSend).toBe(0);
  });

  it("an unreadable candidate list sends nothing", async () => {
    const f = fakeSb(baseTables(), { failTable: "subscriptions" });
    const send = vi.fn();
    const r = await runRenewalNotices(f.sb, { now: NOW, dryRun: false, send, recordEvent: async () => {}, loadSnapshot: async () => snap() });
    expect(r.errors).toEqual(["candidates_unreadable"]); expect(send).not.toHaveBeenCalled();
  });

  it("English for a non-German account", async () => {
    const tables = baseTables(); tables.users[0].language_code = "ar";
    const f = fakeSb(tables);
    const send = vi.fn(async () => ({ ok: true } as const));
    await runRenewalNotices(f.sb, { now: NOW, dryRun: false, send, recordEvent: async () => {}, loadSnapshot: async () => snap() });
    expect((send.mock.calls[0] as unknown as [{ subject: string }])[0].subject).toBe("Your MedPrüf subscription renews on 30 October 2026");
  });
});
