import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { formatEuro, TIERS } from "@/lib/content-truth";
import { createMemoryDb, emptyTables } from "../reminders/memory-db";

// W3-CRON (DB-TIMEOUTS item 4 + 7): the reminder text for one-time buyers
// never says a plan renews, and the cron secret is compared in constant time.
// The real email text is exercised: nothing here mocks the renderer.
const h = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; htmlBody: string }>,
  planId: "plan_redacted8dbd8718" as string | null, // Exam Cohort (one-time)
  lang: "de",
  daysOut: 4,
  firstName: "Mira" as string,
  tierExpiresAt: null as string | null,
  otherActive: [] as Array<{ id: string; expires_at: string; trial_reminder_sent_at: string | null }>,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({
  sendZohoEmail: async (m: { to: string; subject: string; htmlBody: string }) => {
    h.sent.push(m);
    return { ok: true };
  },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    // a46: one in-memory store per cron run. The row ends `daysOut` days from
    // now; the learner's paywall date defaults to the same instant, so the
    // stated date and the row agree unless a test moves one of them.
    const dueExpiresAt = new Date(Date.now() + h.daysOut * 86400_000).toISOString();
    const t = emptyTables();
    t.users.push({ id: "u2", email: "u@example.com", first_name: h.firstName, language_code: h.lang, tier: "pro", role: "user", tier_expires_at: h.tierExpiresAt ?? dueExpiresAt });
    t.subscriptions.push({ id: "sub_due", user_id: "u2", tier: "first_3mo_27", status: "active", expires_at: dueExpiresAt, payment_provider: "whop", provider_payment_id: "pay_due", trial_reminder_sent_at: null });
    for (const o of h.otherActive) t.subscriptions.push({ ...o, user_id: "u2", tier: "first_month_19", status: "active", payment_provider: "whop", provider_payment_id: "pay_due" });
    if (h.planId) t.payment_events.push({ payment_id: "pay_due", plan_id: h.planId });
    t.user_gamification.push({ user_id: "u2", total_questions_answered: 120, total_correct: 90, current_streak: 3 });
    return createMemoryDb(t).sb;
  },
}));

import { GET } from "@/app/api/cron/trial-reminder/route";

const call = (auth?: string) =>
  GET(
    new NextRequest("https://x/api/cron/trial-reminder", {
      headers: auth === undefined ? {} : { authorization: auth },
    }),
  );
const run = () => call("Bearer cron_s");

// Any renewal wording at all, DE or EN. The body must contain none of it:
// the recipient holds a one-time plan, and the subscription options are
// described as "keep running until you cancel".
const RENEW_WORDS = /renew|verläng|erneuer|automatisch/i;
// The old comfort sentence aimed at subscribers.
const OLD_COMFORT = /musst du nichts tun|you do not need to do anything|wenn du einen dieser tarife hast|if you are on one of those/i;

beforeEach(() => {
  process.env.CRON_SECRET = "cron_s";
  process.env.TRIAL_REMINDER_EMAILS_ENABLED = "true";
  h.sent.length = 0;
  h.planId = "plan_redacted8dbd8718";
  h.lang = "de";
  h.daysOut = 4;
  h.firstName = "Mira";
  h.tierExpiresAt = null;
  h.otherActive = [];
});

describe("cron trial-reminder: one-time buyer wording", () => {
  it("DE: neutral access-ending wording, no automatic charge, never claims renewal or payment", async () => {
    await run();
    expect(h.sent).toHaveLength(1);
    const { subject, htmlBody } = h.sent[0];
    expect(htmlBody).not.toMatch(/bezahlt/);
    expect(htmlBody).toMatch(/keine automatische Abbuchung/);
    expect(htmlBody).not.toMatch(OLD_COMFORT);
    // the only "automatisch" allowed is the explicit "no automatic charge" sentence
    expect(htmlBody.replace(/keine automatische Abbuchung/g, "")).not.toMatch(RENEW_WORDS);
    expect(subject).not.toMatch(RENEW_WORDS);
  });

  it("EN: neutral access-ending wording, no automatic charge, never claims renewal or payment", async () => {
    h.lang = "en";
    await run();
    expect(h.sent).toHaveLength(1);
    const { subject, htmlBody } = h.sent[0];
    expect(htmlBody).not.toMatch(/paid once|you paid/i);
    expect(htmlBody).toMatch(/No automatic charge is set up/);
    expect(htmlBody).not.toMatch(OLD_COMFORT);
    expect(htmlBody).not.toMatch(RENEW_WORDS);
    expect(subject).not.toMatch(RENEW_WORDS);
  });

  it("describes the subscription plans only as options, billed until cancelled", async () => {
    await run();
    expect(h.sent[0].htmlBody).toMatch(/Abos, die bis zur Kündigung weiterlaufen/);
  });

  it("computes the days left for the subject instead of a fixed 5 days", async () => {
    h.daysOut = 11;
    await run();
    expect(h.sent[0].subject).toBe("Ihr MedPrüf Pro-Zugang endet in 11 Tagen");
    h.sent.length = 0;
    h.lang = "en";
    h.daysOut = 1;
    await run();
    expect(h.sent[0].subject).toBe("Your MedPrüf Pro access ends in 1 day");
  });

  it("still sends nothing to an auto-renewing plan (cbce0be rule untouched)", async () => {
    h.planId = "plan_redacted8f2b848b"; // Monthly
    const body = await (await run()).json();
    expect(h.sent).toHaveLength(0);
    expect(body.reminders_skipped_renewing).toBe(1);
  });

  it("sends nothing while TRIAL_REMINDER_EMAILS_ENABLED is unset", async () => {
    delete process.env.TRIAL_REMINDER_EMAILS_ENABLED;
    await run();
    expect(h.sent).toHaveLength(0);
  });
});

const daysFromNow = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

describe("cron trial-reminder: effective access end (R4-01, OW-16) and escaping", () => {
  it("skips, without stamping, when another active row ends after the paywall date", async () => {
    h.otherActive = [{ id: "sub_other", expires_at: daysFromNow(40), trial_reminder_sent_at: null }];
    const body = await (await run()).json();
    expect(h.sent).toHaveLength(0);
    expect(body.reminders_skipped_covered).toBe(1);
    expect(body.reminders_marked).toBe(0);
  });
  it("does not tell a learner the row date when their access runs a month longer", async () => {
    h.tierExpiresAt = daysFromNow(40);
    const body = await (await run()).json();
    expect(h.sent).toHaveLength(0);
    expect(body.reminders_skipped.skip_out_of_window).toBe(1);
  });
  it("states the paywall date when the row ends earlier inside the window", async () => {
    h.daysOut = 2;
    h.tierExpiresAt = daysFromNow(9);
    await run();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].subject).toBe("Ihr MedPrüf Pro-Zugang endet in 9 Tagen");
  });
  it("skips when an active row already carries a reminder stamp for that date", async () => {
    h.otherActive = [{ id: "sub_other", expires_at: daysFromNow(h.daysOut), trial_reminder_sent_at: new Date().toISOString() }];
    await run();
    expect(h.sent).toHaveLength(0);
  });
  it("sends when coverage ends on the same date as the row", async () => {
    h.otherActive = [{ id: "sub_other", expires_at: daysFromNow(h.daysOut - 1), trial_reminder_sent_at: null }];
    const body = await (await run()).json();
    expect(h.sent).toHaveLength(1);
    expect(body.reminders_skipped_covered).toBe(0);
  });
  it("escapes markup in first_name", async () => {
    h.firstName = "<a href=x>Mira</a>";
    await run();
    expect(h.sent[0].htmlBody).toContain("&lt;a href=x&gt;Mira&lt;/a&gt;");
    expect(h.sent[0].htmlBody).not.toContain("<a href=x>");
  });
  it("reads prices from content-truth", async () => {
    await run();
    expect(h.sent[0].htmlBody).toContain(formatEuro(TIERS.premium_pass_guaranteed.price_cents));
  });
});

describe("cron trial-reminder: secret check", () => {
  it("accepts the exact bearer token", async () => {
    expect((await run()).status).toBe(200);
  });
  it.each([
    ["missing header", undefined],
    ["wrong token", "Bearer nope_s"],
    ["token with the secret as a prefix", "Bearer cron_s_extra"],
    ["shorter token", "Bearer cron_"],
    ["no scheme", "cron_s"],
    ["empty bearer", "Bearer "],
    ["multibyte token of equal UTF-16 length", "Bearer crön_s"],
  ])("rejects %s with 401", async (_n, header) => {
    expect((await call(header)).status).toBe(401);
    expect(h.sent).toHaveLength(0);
  });
  it("fails closed with 503 when CRON_SECRET is unset, even for an empty bearer", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(503);
    expect((await call()).status).toBe(503);
  });
});
