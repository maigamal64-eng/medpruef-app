import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderAccessEndingReminder } from "@/lib/email/access-ending-template";
import { winbackCopy, winbackDate, winbackLang } from "@/lib/winback-copy";
import { createMemoryDb, emptyTables } from "../reminders/memory-db";

const h = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; htmlBody: string }>,
  promise: vi.fn(async () => true),
  run: vi.fn(async () => ({ enabled: true, mentor_reachable: true, candidates: 2, granted: 1, duplicates: 0, skipped: { skip_refund: 1 }, errors: [] as string[] })),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({
  sendZohoEmail: async (m: { to: string; subject: string; htmlBody: string }) => { h.sent.push(m); return { ok: true }; },
}));
vi.mock("@/lib/mentor/credits/winback", () => ({ winbackMailPromise: h.promise, runWinbackGrants: h.run }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const end = new Date(Date.now() + 4 * 86400_000).toISOString();
    const t = emptyTables();
    t.users.push({ id: "u2", email: "u@example.com", first_name: "Mira", language_code: "de", tier: "pro", role: "user", tier_expires_at: end });
    t.subscriptions.push({ id: "sub_due", user_id: "u2", tier: "first_3mo_27", status: "active", expires_at: end, payment_provider: "whop", provider_payment_id: "pay_due", trial_reminder_sent_at: null });
    t.payment_events.push({ payment_id: "pay_due", plan_id: "plan_redacted8dbd8718" });
    return createMemoryDb(t).sb;
  },
}));

import { GET } from "@/app/api/cron/trial-reminder/route";

const base = { firstName: "Mira", accessEndsAtIso: "2026-12-16T10:00:00Z", qsAnswered: 120, accuracyPct: 75, streakDays: 3, now: new Date("2026-12-10T08:00:00Z") };
const DASHES = /[–—]/;

describe("access-ending mail line (J11)", () => {
  it("absent unless passed: the mail is byte for byte unchanged", () => {
    for (const lang of ["de", "en"] as const) {
      expect(renderAccessEndingReminder({ ...base, lang, winback: null })).toEqual(renderAccessEndingReminder({ ...base, lang }));
      expect(renderAccessEndingReminder({ ...base, lang }).htmlBody).not.toMatch(/KI-Mentor|AI Mentor/);
    }
  });
  it("one line after the plan list and its button, Sie, no dashes, no price", () => {
    for (const lang of ["de", "en"] as const) {
      const html = renderAccessEndingReminder({ ...base, lang, winback: { credits: 100, days: 30 } }).htmlBody;
      const line = winbackCopy(lang).mailLine(100, 30);
      expect(html).toContain(line);
      expect(html.indexOf(line)).toBeGreaterThan(html.indexOf("</ul>"));
      expect(html.indexOf(line)).toBeGreaterThan(html.indexOf("medpruf.com/pricing"));
      expect(line).not.toMatch(DASHES);
      expect(line).not.toMatch(/€|EUR/);
    }
    expect(winbackCopy("de").mailLine(100, 30)).toMatch(/Ihr KI-Mentor bleibt bei Ihnen/);
    expect(winbackCopy("de").mailLine(100, 30)).not.toMatch(/\b(du|dein|dir)\b/i);
  });
  it("note copy: Sie, no dashes, Vienna date", () => {
    for (const lang of ["de", "en"] as const) {
      const c = winbackCopy(lang);
      for (const s of [c.noteTitle, c.noteBody(100, "16. Jänner 2027"), c.noteOpen, c.notePlans, c.noteDismiss]) expect(s).not.toMatch(DASHES);
    }
    expect(winbackCopy("de").noteBody(100, "x")).not.toMatch(/\b(du|dein|dir)\b/i);
    expect(winbackDate("2027-01-15T23:30:00Z", "de")).toMatch(/16\. J(ä|a)nner 2027/);
    expect(winbackLang("ru")).toBe("en");
  });
});

describe("cron wiring", () => {
  const run = () => GET(new NextRequest("https://x/api/cron/trial-reminder", { headers: { authorization: "Bearer cron_s" } }));
  beforeEach(() => {
    process.env.CRON_SECRET = "cron_s";
    process.env.TRIAL_REMINDER_EMAILS_ENABLED = "true";
    process.env.ZOHO_ACCOUNT_ID = "acct";
    h.sent.length = 0;
    h.promise.mockClear();
    h.run.mockClear();
  });
  afterEach(() => {
    delete process.env.REWARDS_WINBACK_ENABLED;
    delete process.env.TRIAL_REMINDER_EMAILS_ENABLED;
  });
  it("flag off: no win-back call, no line, response says disabled", async () => {
    const body = await (await run()).json();
    expect(body.winback).toEqual({ enabled: false });
    expect(h.promise).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].htmlBody).not.toMatch(/KI-Mentor/);
  });
  it("flag on: the mail carries the line and the daily grant runs after the sweep", async () => {
    process.env.REWARDS_WINBACK_ENABLED = "true";
    const body = await (await run()).json();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(body.winback).toMatchObject({ enabled: true, granted: 1, skipped: { skip_refund: 1 } });
    expect(h.sent).toHaveLength(1);
    expect(h.promise).toHaveBeenCalledWith(expect.anything(), "u2", expect.any(Number), expect.anything());
    expect(h.sent[0].htmlBody).toContain(winbackCopy("de").mailLine(100, 30));
  });
});
