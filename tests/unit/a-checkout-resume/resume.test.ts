import { describe, expect, it } from "vitest";
import { decideCheckoutResume, planFit, resumeExcludedIds, checkoutResumeEnabled, type ResumeAccount, type ResumeEvent } from "@/lib/checkout-resume";
import { resumeCopy } from "@/lib/checkout-resume-copy";
import { summarize } from "../../../scripts/checkout-resume-count";
import { SURFACES } from "@/lib/announcements/queue";
import { sanitizeEventData, isAllowedEvent } from "@/lib/analytics-events";

const NOW = new Date("2026-10-15T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const account = (o: Partial<ResumeAccount> = {}): ResumeAccount => ({ id: "u1", role: "user", tier: "free", email: "doc@example.org".replace("example", "praxis"), examDate: null, paidAccess: false, doNotContact: false, ...o });
const opener = (tier: string, h = 48): ResumeEvent => ({ event: "checkout_session_created", created_at: ago(h), tier });
const run = (o: { account?: Partial<ResumeAccount>; events?: ResumeEvent[]; enabled?: boolean; excluded?: string[] } = {}) =>
  decideCheckoutResume({ enabled: o.enabled ?? true, excluded: new Set(o.excluded ?? []), account: account(o.account), events: o.events ?? [opener("first_3mo_27")], now: NOW });

describe("decideCheckoutResume", () => {
  it("shows for an unpaid opener inside 14 days", () => {
    expect(run()).toMatchObject({ show: true, tier: "first_3mo_27" });
  });
  it("is off by default and by flag", () => {
    expect(checkoutResumeEnabled({})).toBe(false);
    expect(checkoutResumeEnabled({ CHECKOUT_RESUME_ENABLED: "true" })).toBe(true);
    // release-int-4: the card knows only the v1 plans, so the v2 offer keeps it off.
    expect(checkoutResumeEnabled({ CHECKOUT_RESUME_ENABLED: "true", PRICING_V2_ENABLED: "true" })).toBe(false);
    expect(run({ enabled: false })).toEqual({ show: false, reason: "flag_off" });
  });
  it("hides for payers, admins, staff, do-not-contact and closed accounts", () => {
    expect(run({ account: { paidAccess: true } })).toMatchObject({ reason: "paid" });
    expect(run({ account: { role: "admin" } })).toMatchObject({ reason: "staff" });
    expect(run({ account: { email: "user-847887c3@example.com" } })).toMatchObject({ reason: "staff" });
    expect(run({ account: { doNotContact: true } })).toMatchObject({ reason: "do_not_contact" });
    expect(run({ excluded: ["u1"] })).toMatchObject({ reason: "excluded" });
  });
  it("hides without an opener, after 14 days, after a grant, while pending and for the trial", () => {
    expect(run({ events: [] })).toMatchObject({ reason: "no_opener" });
    expect(run({ events: [opener("first_3mo_27", 15 * 24)] })).toMatchObject({ reason: "no_opener" });
    expect(run({ events: [opener("first_3mo_27"), { event: "grant_succeeded", created_at: ago(24), tier: "first_3mo_27" }] })).toMatchObject({ reason: "granted_since" });
    expect(run({ events: [opener("first_3mo_27", 0.2), { event: "checkout_redirected", created_at: ago(0.2), tier: "first_3mo_27" }] })).toMatchObject({ reason: "pending" });
    expect(run({ events: [opener("notes_pro_trial")] })).toMatchObject({ reason: "unpaid_plan" });
  });
  it("stays silent when a payment may exist that nobody has tied to the learner, and for refunded payers", () => {
    expect(run({ events: [opener("first_3mo_27"), { event: "webhook_received", created_at: ago(40), tier: "first_3mo_27" }] })).toMatchObject({ reason: "unresolved_payment" });
    expect(run({ events: [opener("first_3mo_27"), { event: "grant_failed", created_at: ago(40), tier: "first_3mo_27", reason: "unmapped" }] })).toMatchObject({ reason: "unresolved_payment" });
    expect(run({ account: { refunded: true } })).toMatchObject({ reason: "refunded" });
  });
  it("a grant before the opener does not hide it", () => {
    expect(run({ events: [{ event: "grant_succeeded", created_at: ago(300), tier: "first_month_19" }, opener("first_3mo_27")] }).show).toBe(true);
  });
  it("reads the exclusion list from env", () => {
    expect([...resumeExcludedIds({ CHECKOUT_RESUME_EXCLUDE_USER_IDS: " A, b ,," })]).toEqual(["a", "b"]);
    expect(resumeExcludedIds({}).size).toBe(0);
  });
});

describe("planFit", () => {
  it("names a cheaper plan that covers the same time", () => {
    const fit = planFit("first_month_19", "2027-01-03", NOW)!; // about 3 months
    expect(fit.cheaperTier).toBe("first_3mo_27");
    expect(fit.cheaperTotalCents!).toBeLessThan(fit.openedTotalCents);
  });
  it("keeps the opened plan when it is the cheapest", () => {
    const fit = planFit("first_3mo_27", "2027-01-03", NOW)!;
    expect(fit.cheaperTier).toBeNull();
  });
  it("never suggests a renewing plan instead of the Cohort", () => {
    expect(planFit("premium_pass_guaranteed", "2027-03-01", NOW)!.cheaperTier).toBeNull();
  });
  it("has no fit without a future date", () => {
    expect(planFit("first_3mo_27", null, NOW)).toBeNull();
    expect(planFit("first_3mo_27", "2026-01-01", NOW)).toBeNull();
  });
});

describe("copy", () => {
  const fits = [null, planFit("first_month_19", "2027-01-03", NOW), planFit("first_3mo_27", "2027-01-03", NOW)];
  it("uses no em dash, no urgency or price-change words, and Sie in German", () => {
    for (const lang of ["de", "en"] as const) for (const tier of ["first_month_19", "first_3mo_27", "premium_pass_guaranteed"] as const) for (const fit of fits) {
      const c = resumeCopy(tier, fit, lang);
      const text = [c.title, c.body, ...c.fit, c.primary, c.cheaper ?? "", c.help, c.dismiss].join(" ");
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/nur noch|letzte Chance|läuft ab|Angebot endet|limited|last chance|hurry|expires|only \d+ left|price (rise|increase)|Preiserhöhung|bald teurer|sofort/i);
      if (lang === "de") { expect(text).not.toMatch(/\b(du|dein|deine|deinen|dir|dich)\b/i); }
    }
  });
  it("offers the cheaper plan only when there is one", () => {
    expect(resumeCopy("first_month_19", fits[1], "de").cheaper).toMatch(/Stattdessen/);
    expect(resumeCopy("first_3mo_27", fits[2], "de").cheaper).toBeNull();
    expect(resumeCopy("first_3mo_27", null, "en").fit).toEqual([]);
  });
});

describe("events and queue", () => {
  it("allowlists both events with their keys only", () => {
    expect(isAllowedEvent("checkout_resume_shown")).toBe(true);
    expect(sanitizeEventData("checkout_resume_click", { tier: "first_3mo_27", target: "cheaper", email: "user-12c2d785@example.com", extra: "x" })).toEqual({ tier: "first_3mo_27", target: "cheaper" });
  });
  it("ranks as checkout follow-up inline", () => {
    expect(SURFACES.checkout_resume).toMatchObject({ kind: "inline", priority: 2 });
  });
});

describe("scoreboard count", () => {
  it("counts distinct learners and grants only after the first view", () => {
    const e = (u: string, type: string, at: string, data: Record<string, unknown> = {}) => ({ user_id: u, event_type: type, event_data: data, created_at: at });
    const out = summarize([
      e("a", "checkout_resume_shown", "2026-10-10T10:00:00Z"), e("a", "checkout_resume_shown", "2026-10-11T10:00:00Z"),
      e("a", "checkout_resume_click", "2026-10-10T10:01:00Z", { target: "cheaper" }),
      e("b", "checkout_resume_shown", "2026-10-10T10:00:00Z"), e("b", "checkout_resume_click", "2026-10-10T10:02:00Z", { target: "support" }),
      e("c", "checkout_resume_shown", "2026-10-10T10:00:00Z"),
      e("s", "checkout_resume_shown", "2026-10-10T10:00:00Z"),
    ], [{ user_id: "a", created_at: "2026-10-12T00:00:00Z" }, { user_id: "b", created_at: "2026-10-01T00:00:00Z" }, { user_id: "s", created_at: "2026-10-12T00:00:00Z" }], 7, new Set(["s"]));
    expect(out).toEqual({ days: 7, shown: 3, clicked: 2, clickedOpened: 0, clickedCheaper: 1, clickedSupport: 1, paidAfterShown: 1 });
  });
});
