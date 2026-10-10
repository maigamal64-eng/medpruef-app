import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";

// W3-CRON (DB-TIMEOUTS item 4 + 7): the reminder text for one-time buyers
// never says a plan renews, and the cron secret is compared in constant time.
// The real email text is exercised: nothing here mocks the renderer.
const h = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; htmlBody: string }>,
  planId: "plan_redacted8dbd8718" as string | null, // Exam Cohort (one-time)
  lang: "de",
  daysOut: 4,
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
    const { sb } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.kind === "lte")) {
        return {
          data: [
            { id: "sub_due", user_id: "u2", tier: "first_3mo_27", expires_at: new Date(Date.now() + h.daysOut * 86400_000).toISOString() },
          ],
        };
      }
      if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.kind === "lt")) return { data: [] };
      if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "user_id") === "u2") {
        return { data: [{ tier: "first_3mo_27", payment_provider: "whop", provider_payment_id: "pay_due" }] };
      }
      if (c.table === "payment_events") return { data: h.planId ? [{ payment_id: "pay_due", plan_id: h.planId }] : [] };
      if (c.table === "users" && c.op === "select") {
        return { data: { email: "u@example.com", first_name: "Mira", language_code: h.lang } };
      }
      if (c.table === "user_gamification") {
        return { data: { total_questions_answered: 120, total_correct: 90, current_streak: 3 } };
      }
      return {};
    });
    return sb;
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
});

describe("cron trial-reminder: one-time buyer wording", () => {
  it("DE: says one-time, no automatic charge, and never claims renewal", async () => {
    await run();
    expect(h.sent).toHaveLength(1);
    const { subject, htmlBody } = h.sent[0];
    expect(htmlBody).toMatch(/einmalig bezahlt/);
    expect(htmlBody).toMatch(/keine automatische Abbuchung/);
    expect(htmlBody).not.toMatch(OLD_COMFORT);
    // the only "automatisch" allowed is the explicit "no automatic charge" sentence
    expect(htmlBody.replace(/keine automatische Abbuchung/g, "")).not.toMatch(RENEW_WORDS);
    expect(subject).not.toMatch(RENEW_WORDS);
  });

  it("EN: says one-time, nothing charged automatically, and never claims renewal", async () => {
    h.lang = "en";
    await run();
    expect(h.sent).toHaveLength(1);
    const { subject, htmlBody } = h.sent[0];
    expect(htmlBody).toMatch(/You paid once/);
    expect(htmlBody).toMatch(/nothing is charged automatically/);
    expect(htmlBody).not.toMatch(OLD_COMFORT);
    expect(htmlBody.replace(/nothing is charged automatically/g, "")).not.toMatch(RENEW_WORDS);
    expect(subject).not.toMatch(RENEW_WORDS);
  });

  it("describes the subscription plans only as options, billed until cancelled", async () => {
    await run();
    expect(h.sent[0].htmlBody).toMatch(/Abos, die bis zur Kündigung weiterlaufen/);
  });

  it("computes the days left for the subject instead of a fixed 5 days", async () => {
    h.daysOut = 11;
    await run();
    expect(h.sent[0].subject).toBe("Dein MedPrüf Pro-Zugang endet in 11 Tagen");
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
