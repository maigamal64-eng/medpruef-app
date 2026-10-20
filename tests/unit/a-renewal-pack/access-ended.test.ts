import { describe, expect, it, vi } from "vitest";

import { accessEndedDryRun, accessEndedEmailsEnabled } from "@/lib/access-ended/flag";
import { decideAccessEnded, isPaidPass, accessEndedClaimKey, type DecideInput, type EndedRow } from "@/lib/access-ended/rules";
import { ACCESS_ENDED_COPY, renderAccessEnded } from "@/lib/access-ended/copy";
import { runAccessEndedMails } from "@/lib/access-ended/run";
import { loadMarketingCapHits } from "@/lib/day1-ask/run";
import { suppressionKey } from "@/lib/mail-suppression";
import { fakeSb } from "./fake-sb";

const UID = "17ba1fe3-1fd2-4781-8b49-c69355ea31b4";
const END = "2026-10-21T06:58:04.250Z";
const NOW = new Date("2026-10-22T07:05:00Z");
const ONE_TIME_19 = "plan_redacted07253e20";

const pass = (over: Partial<EndedRow> = {}): EndedRow => ({
  id: "p1", tier: "first_month_19", status: "expired", payment_provider: "whop", provider_payment_id: "pay_1",
  amount_cents: 1900, expires_at: END, plan_id: ONE_TIME_19, ...over,
});

describe("flags", () => {
  it("default off and dry run", () => {
    expect(accessEndedEmailsEnabled({})).toBe(false);
    expect(accessEndedEmailsEnabled({ ACCESS_ENDED_EMAILS_ENABLED: "true" })).toBe(true);
    expect(accessEndedDryRun({})).toBe(true);
    expect(accessEndedDryRun({ ACCESS_ENDED_DRY_RUN: "false" })).toBe(false);
  });
});

describe("isPaidPass", () => {
  it("only paid one-time passes; renewing, unknown, free, manual and ticket rows stay out", () => {
    expect(isPaidPass(pass())).toBe(true);
    expect(isPaidPass(pass({ plan_id: "plan_redacted8f2b848b" }))).toBe(false); // monthly that renews: the dunning path's
    expect(isPaidPass(pass({ plan_id: null }))).toBe(false); // unknown cadence, fail closed
    expect(isPaidPass(pass({ tier: "sitting_pass", plan_id: null }))).toBe(true);
    expect(isPaidPass(pass({ payment_provider: "nowpayments", plan_id: null }))).toBe(true);
    expect(isPaidPass(pass({ payment_provider: "manual" }))).toBe(false);
    expect(isPaidPass(pass({ payment_provider: "staff_smoke" }))).toBe(false);
    expect(isPaidPass(pass({ amount_cents: 0 }))).toBe(false);
    expect(isPaidPass(pass({ provider_payment_id: null }))).toBe(false);
    expect(isPaidPass(pass({ tier: "guarantee_ticket" }))).toBe(false);
    expect(isPaidPass(pass({ tier: "notes_pro_trial" }))).toBe(false);
  });
});

describe("decideAccessEnded", () => {
  const input = (over: Partial<DecideInput> = {}): DecideInput => ({
    account: { id: UID, email: "user-610e28c1@example.com", role: "user", tier: "free", tier_expires_at: null, is_banned: false },
    endMs: Date.parse(END), otherRows: [], claimed: false, capHit: false, sittingWeek: false, excluded: new Set(), nowMs: NOW.getTime(), ...over,
  });
  it("sends on day 1; days 2 and 3 catch up; the end day and day 4 do not", () => {
    expect(decideAccessEnded(input())).toEqual({ act: "send", daysAfter: 1 });
    expect(decideAccessEnded(input({ nowMs: Date.parse("2026-10-24T07:00:00Z") }))).toEqual({ act: "send", daysAfter: 3 });
    expect(decideAccessEnded(input({ nowMs: Date.parse("2026-10-21T07:05:00Z") }))).toEqual({ act: "skip", reason: "not_in_window" });
    expect(decideAccessEnded(input({ nowMs: Date.parse("2026-10-25T07:00:00Z") }))).toEqual({ act: "skip", reason: "not_in_window" });
  });
  it("never to someone with access now or a newer purchase", () => {
    expect(decideAccessEnded(input({ account: { ...input().account!, tier: "pro", tier_expires_at: "2026-11-20T00:00:00Z" } }))).toEqual({ act: "skip", reason: "has_access" });
    expect(decideAccessEnded(input({ otherRows: [{ id: "x", status: "active", expires_at: "2026-11-21T00:00:00Z", created_at: "2026-10-01T00:00:00Z" }] }))).toEqual({ act: "skip", reason: "has_access" });
    expect(decideAccessEnded(input({ otherRows: [{ id: "y", status: "cancelled", expires_at: "2026-11-21T00:00:00Z", created_at: "2026-10-21T12:00:00Z" }] }))).toEqual({ act: "skip", reason: "rebought" });
    expect(decideAccessEnded(input({ otherRows: [{ id: "z", status: "expired", expires_at: "2026-09-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z" }] }))).toEqual({ act: "send", daysAfter: 1 });
  });
  it("staff, banned, excluded, no address, already claimed", () => {
    expect(decideAccessEnded(input({ account: null }))).toEqual({ act: "skip", reason: "no_user" });
    expect(decideAccessEnded(input({ excluded: new Set([UID]) }))).toEqual({ act: "skip", reason: "excluded" });
    expect(decideAccessEnded(input({ account: { ...input().account!, email: "user-b7e46e80@example.com" } }))).toEqual({ act: "skip", reason: "staff" });
    expect(decideAccessEnded(input({ account: { ...input().account!, is_banned: true } }))).toEqual({ act: "skip", reason: "banned" });
    expect(decideAccessEnded(input({ account: { ...input().account!, email: " " } }))).toEqual({ act: "skip", reason: "no_email" });
    expect(decideAccessEnded(input({ claimed: true }))).toEqual({ act: "skip", reason: "already_claimed" });
  });
  it("holds for the 14-day cap, an unreadable cap and the learner's sitting week", () => {
    expect(decideAccessEnded(input({ capHit: true }))).toEqual({ act: "hold", reason: "mail_cap" });
    expect(decideAccessEnded(input({ capHit: null }))).toEqual({ act: "hold", reason: "cap_unreadable" });
    expect(decideAccessEnded(input({ sittingWeek: true }))).toEqual({ act: "hold", reason: "sitting_week" });
  });
});

describe("renderAccessEnded", () => {
  it("German Sie and English: end date, saved progress, plans link, Stopp line; no price, no em dash", () => {
    const de = renderAccessEnded({ lang: "de", endedAtIso: END, answered: 58, activeExam: "kmp_innsbruck" });
    expect(de.subject).toBe("Ihr Lernstand bei MedPrüf bleibt gespeichert");
    expect(de.htmlBody).toContain("am 21. Oktober 2026 ausgelaufen");
    expect(de.htmlBody).toContain("Bisher haben Sie 58 Fragen beantwortet.");
    expect(de.htmlBody).toContain("auf den Stichprobentest");
    expect(de.htmlBody).toContain("Antworten Sie mit Stopp");
    expect(de.htmlBody).toContain('href="https://medpruf.com/pricing?utm_source=access_ended&amp;utm_medium=mail&amp;utm_campaign=renewal"');
    const en = renderAccessEnded({ lang: "en", endedAtIso: END, answered: 0, activeExam: "kenntnispruefung" });
    expect(en.htmlBody).toContain("ended on 21 October 2026");
    expect(en.htmlBody).toContain("for your exam");
    expect(en.htmlBody).toContain("unless you have already used them up");
    expect(en.htmlBody).not.toContain("answered");
    for (const text of [de.subject, de.htmlBody, en.subject, en.htmlBody, JSON.stringify(ACCESS_ENDED_COPY)]) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/€|EUR|\d+[.,]\d{2}/);
    }
    expect(de.htmlBody).not.toMatch(/\bdu\b|\bdein/i);
  });
});

const tables = (over: Record<string, unknown[]> = {}) => ({
  subscriptions: [
    { id: "p1", user_id: UID, tier: "first_month_19", status: "expired", payment_provider: "whop", provider_payment_id: "pay_1", amount_cents: 1900, expires_at: END, created_at: "2026-09-21T06:58:04Z" },
  ],
  payment_events: [{ payment_id: "pay_1", plan_id: ONE_TIME_19 }],
  users: [{ id: UID, email: "user-610e28c1@example.com", role: "user", tier: "free", tier_expires_at: null, is_banned: false, language_code: "de", exam_date: null, active_exam: "kmp_innsbruck" }],
  user_gamification: [{ user_id: UID, total_questions_answered: 58 }],
  user_events: [],
  study_nudge_prefs: [],
  ...over,
});

describe("runAccessEndedMails", () => {
  it("dry run decides and writes nothing", async () => {
    const f = fakeSb(tables());
    const send = vi.fn(); const events: string[] = [];
    const r = await runAccessEndedMails(f.sb, { now: NOW, dryRun: true, send, recordEvent: async (_u, e) => { events.push(e); } });
    expect(r).toMatchObject({ candidates: 1, wouldSend: 1, sent: 0 });
    expect(r.rows).toEqual([{ user: "0944349d", decision: "would_send", end_day: "2026-10-21", lang: "de", suppression: "clear" }]);
    expect(send).not.toHaveBeenCalled(); expect(events).toEqual([]); expect(f.inserted).toEqual([]);
  });

  it("live: claim under mail_reminder with the user id (every cap read sees it), one marketing mail, one event; rerun is a no-op", async () => {
    const f = fakeSb(tables());
    const send = vi.fn(async () => ({ ok: true } as const)); const events: string[] = [];
    const run = (now: Date) => runAccessEndedMails(f.sb, { now, dryRun: false, send, recordEvent: async (_u, e) => { events.push(e); } });
    expect((await run(NOW)).sent).toBe(1);
    expect(f.tables.processed_webhook_events).toEqual([expect.objectContaining({
      provider: "mail_reminder", event_id: accessEndedClaimKey(UID, Date.parse(END)), payload: expect.objectContaining({ user_id: UID, reason: "access_ended" }),
    })]);
    expect(events).toEqual(["access_ended_email_sent"]);
    expect((send.mock.calls[0] as unknown as [{ subject: string; htmlBody: string }])[0].htmlBody).toContain("58 Fragen");
    const again = await run(new Date("2026-10-23T07:05:00Z"));
    expect(again).toMatchObject({ sent: 0, duplicates: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await loadMarketingCapHits(f.sb, [UID], new Date("2026-10-23T07:05:00Z"))).has(UID)).toBe(true);
  });

  it("holds inside the 14-day cap (13 Oct access-ending mail) and writes nothing", async () => {
    const f = fakeSb(tables({ user_events: [{ user_id: UID, event_type: "trial_reminder_email_sent", created_at: "2026-10-13T07:00:00Z" }] }));
    const send = vi.fn();
    const r = await runAccessEndedMails(f.sb, { now: NOW, dryRun: false, send, recordEvent: async () => {} });
    expect(r.held).toEqual({ mail_cap: 1 }); expect(send).not.toHaveBeenCalled(); expect(f.inserted).toEqual([]);
  });

  it("a Stopp opt-out is withheld and keeps the claim; a provider 4xx releases it", async () => {
    const f = fakeSb(tables({ mail_suppression: [{ id: "1", email_key: suppressionKey("user-610e28c1@example.com"), cause: "opt_out", scope: "marketing", source: "t", created_at: "x", lifted_at: null }] }));
    const send = vi.fn(); const events: string[] = [];
    const r = await runAccessEndedMails(f.sb, { now: NOW, dryRun: false, send, recordEvent: async (_u, e) => { events.push(e); } });
    expect(r.withheld).toBe(1); expect(send).not.toHaveBeenCalled(); expect(events).toEqual(["access_ended_email_suppressed"]);
    expect(f.tables.processed_webhook_events).toHaveLength(1);

    const g = fakeSb(tables());
    await runAccessEndedMails(g.sb, { now: NOW, dryRun: false, send: async () => ({ ok: false, reason: "send_failed", status: 422 }), recordEvent: async () => {} });
    expect(g.tables.processed_webhook_events).toHaveLength(0);
  });

  it("a renewing plan, a rebought learner and an unreadable plan lookup send nothing", async () => {
    const renewing = fakeSb(tables({ payment_events: [{ payment_id: "pay_1", plan_id: "plan_redacted8f2b848b" }] }));
    expect((await runAccessEndedMails(renewing.sb, { now: NOW, dryRun: true, recordEvent: async () => {} })).candidates).toBe(0);

    const rebought = fakeSb(tables({ subscriptions: [
      ...tables().subscriptions,
      { id: "n1", user_id: UID, tier: "flex_month", status: "active", payment_provider: "whop", provider_payment_id: "pay_2", amount_cents: 2400, expires_at: "2026-11-21T00:00:00Z", created_at: "2026-10-22T06:00:00Z" },
    ] }));
    const r = await runAccessEndedMails(rebought.sb, { now: NOW, dryRun: true, recordEvent: async () => {} });
    expect(r.skipped).toEqual({ has_access: 1 });

    const broken = fakeSb(tables(), { failTable: "payment_events" });
    const send = vi.fn();
    const b = await runAccessEndedMails(broken.sb, { now: NOW, dryRun: false, send, recordEvent: async () => {} });
    expect(b.errors).toEqual(["plans_unreadable"]); expect(send).not.toHaveBeenCalled();
  });
});
