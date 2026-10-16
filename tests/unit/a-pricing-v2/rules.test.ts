import { afterEach, describe, expect, it } from "vitest";
import { GRANTABLE_TIERS, V1_TIERS, V2_TIERS, checkoutTiers, entryMonthlyCents, isOneTimeV2, recommendTier } from "@/lib/pricing-v2/offer";
import { SITTING_PASS_MAX_MONTHS, dayAfterEnd, resolveSittingChoice, sittingOptions, sittingPassAddedMonths, sittingPassEnd, viennaMidnight } from "@/lib/pricing-v2/sitting-pass";
import { TICKET_MAX_RENEWALS, safeProofLink, sittingAfterTicket, ticketNotRefund, ticketRequestBlocker, ticketTerms } from "@/lib/pricing-v2/ticket";
import { mayStartReverseTrial, normaliseTrialEmail, trialDaysLeft, trialEmailKey, trialIpHash } from "@/lib/pricing-v2/reverse-trial";
import { halfYearAutoStopDryRun, pricingV2Enabled, reverseTrialEnabled, reverseTrialSince } from "@/lib/pricing-v2/flag";
import { halfYearReady, ticketMentorReady, ticketReady, v2PlanReady } from "@/lib/pricing-v2/readiness";
import { TIERS } from "@/lib/content-truth";
import { TIERS as NP_TIERS, isPuypEligibleTier } from "@/lib/nowpayments";
import type { OfficialSitting } from "@/lib/exam-dates";

const DAY = 86_400_000;
const NOW = new Date("2026-10-20T10:00:00Z");

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PRICING_V2;
  delete process.env.NEXT_PUBLIC_REVERSE_TRIAL;
  delete process.env.REVERSE_TRIAL_ENABLED;
  delete process.env.REVERSE_TRIAL_SINCE;
});

describe("offer: prices, tiers and the flag", () => {
  it("the four v2 prices and maximum grants come from TIERS, both ledgers agree, none is PUYP", () => {
    expect([TIERS.flex_month.price_cents, TIERS.sitting_pass.price_cents, TIERS.half_year.price_cents, TIERS.guarantee_ticket.price_cents]).toEqual([2400, 5900, 10000, 17900]);
    for (const t of V2_TIERS) {
      expect(NP_TIERS[t].priceCents).toBe(TIERS[t].price_cents);
      expect(NP_TIERS[t].durationMonths).toBe(TIERS[t].duration_months);
      // Whop only: never on the crypto route.
      expect(NP_TIERS[t].available).toBe(false);
      expect(isPuypEligibleTier(t)).toBe(false);
    }
    expect(TIERS.guarantee_ticket.duration_months).toBe(12);
    expect(TIERS.half_year.duration_months).toBe(6);
  });

  it("flag off sells today's three plans; flag on only the four v2 plans; grants accept both", () => {
    expect([...checkoutTiers({})]).toEqual([...V1_TIERS]);
    expect([...checkoutTiers({ PRICING_V2_ENABLED: "TRUE" })]).toEqual([...V1_TIERS]);
    expect([...checkoutTiers({ PRICING_V2_ENABLED: "true" })]).toEqual([...V2_TIERS]);
    for (const t of [...V1_TIERS, ...V2_TIERS]) expect(GRANTABLE_TIERS.has(t)).toBe(true);
    expect(GRANTABLE_TIERS.has("notes_pro_trial")).toBe(false);
    expect(isOneTimeV2("sitting_pass") && isOneTimeV2("guarantee_ticket")).toBe(true);
    expect(isOneTimeV2("flex_month") || isOneTimeV2("half_year")).toBe(false);
  });

  it("without arguments the flag reads the build copy only", () => {
    process.env.PRICING_V2_ENABLED = "true";
    expect(pricingV2Enabled()).toBe(false);
    process.env.NEXT_PUBLIC_PRICING_V2 = "true";
    expect(pricingV2Enabled()).toBe(true);
    expect(entryMonthlyCents()).toBe(2400);
    delete process.env.PRICING_V2_ENABLED;
    delete process.env.NEXT_PUBLIC_PRICING_V2;
    expect(entryMonthlyCents()).toBe(1900);
  });

  // a-pricing-v2-fit (decision sitting-fit, D-B): a sitting marks the
  // cheapest plan that covers it, computed with the renewal rules
  // (tests/unit/a-pricing-v2-fit/fit.test.ts holds the truth table).
  it("recommends one plan from the exam timing", () => {
    const at = (days: number) => ({ kind: "sitting" as const, lastDay: new Date(NOW.getTime() + days * DAY).toISOString().slice(0, 10) });
    expect(recommendTier({ kind: "unsure" }, NOW)).toBe("flex_month");
    expect(recommendTier({ kind: "long_route" }, NOW)).toBe("guarantee_ticket");
    expect(recommendTier({ kind: "after_fail" }, NOW)).toBe("guarantee_ticket");
    expect(recommendTier(at(20), NOW)).toBe("flex_month");
    expect(recommendTier(at(30), NOW)).toBe("flex_month");
    // Two 30-day cycles (48) still beat the pass (59).
    expect(recommendTier(at(59), NOW)).toBe("flex_month");
    expect(recommendTier(at(60), NOW)).toBe("sitting_pass");
    expect(recommendTier(at(91), NOW)).toBe("sitting_pass");
    // Past the pass's 3 months: four monthly charges (96) beat 6 months (100).
    expect(recommendTier(at(92), NOW)).toBe("flex_month");
    expect(recommendTier(at(120), NOW)).toBe("half_year");
    expect(recommendTier(at(179), NOW)).toBe("half_year");
    // The 180-day renewal lands before the sitting: without the guard it is a
    // second charge (200), so seven monthly charges (168) are cheaper ...
    expect(recommendTier(at(180), NOW)).toBe("flex_month");
    // ... with the guard running it does not charge.
    expect(recommendTier(at(180), NOW, { guard: true })).toBe("half_year");
    expect(recommendTier(at(211), NOW)).toBe("guarantee_ticket");
  });
});

describe("Sitting Pass: never open-ended", () => {
  const sittings: OfficialSitting[] = [
    { exam_key: "sip4a", learner_label: { de: "SIP4a", en: "SIP4a" }, date: "2026-12-10", registration_opens: "2026-11-01", registration_closes: "2026-11-15", deadline_type: "registration", publisher: "MedUni Wien", source_url: "https://x", read_on: "2026-10-10" },
    { exam_key: "rezeptierkunde", learner_label: { de: "Rez", en: "Rez" }, date: "2026-11-23", date_end: "2026-11-27", registration_opens: null, registration_closes: null, deadline_type: "registration", publisher: "MedUni Wien", source_url: "https://x", read_on: "2026-10-10" },
    { exam_key: "sip5a", learner_label: { de: "SIP5a", en: "SIP5a" }, date: "2026-09-01", registration_opens: null, registration_closes: null, deadline_type: "registration", publisher: "MedUni Wien", source_url: "https://x", read_on: "2026-10-10" },
  ];

  it("accepts only an upcoming official date of the chosen bank", () => {
    expect(resolveSittingChoice("kenntnispruefung", "2026-12-10", NOW, sittings)).toEqual({ bank: "kenntnispruefung", date: "2026-12-10", lastDay: "2026-12-10" });
    expect(resolveSittingChoice("pharma", "2026-11-23", NOW, sittings)).toEqual({ bank: "pharma", date: "2026-11-23", lastDay: "2026-11-27" });
    expect(resolveSittingChoice("kenntnispruefung", "2026-11-23", NOW, sittings)).toBeNull();
    expect(resolveSittingChoice("kenntnispruefung", "2026-09-01", NOW, sittings)).toBeNull();
    expect(resolveSittingChoice("kenntnispruefung", "2026-12-11", NOW, sittings)).toBeNull();
    expect(resolveSittingChoice("germany", "2026-12-10", NOW, sittings)).toBeNull();
    expect(resolveSittingChoice("kenntnispruefung", "2026-12-10T00:00", NOW, sittings)).toBeNull();
    expect(sittingOptions("kenntnispruefung", NOW, sittings).map((s) => s.date)).toEqual(["2026-12-10"]);
  });

  it("ends the day after the sitting in Vienna, between 30 days and 3 months, never null", () => {
    // 10 Dec sitting: access through 11 Dec, ends at Vienna midnight starting 12 Dec (UTC+1).
    expect(sittingPassEnd("2026-12-10", NOW).toISOString()).toBe("2026-12-11T23:00:00.000Z");
    // Too soon: the 30-day floor.
    expect(sittingPassEnd("2026-10-25", NOW).getTime()).toBe(NOW.getTime() + 30 * DAY);
    // Too late: the 3-month cap.
    const cap = new Date(NOW); cap.setUTCMonth(cap.getUTCMonth() + SITTING_PASS_MAX_MONTHS);
    expect(sittingPassEnd("2027-06-30", NOW).getTime()).toBe(cap.getTime());
    // Missing or unreadable: the maximum, never an open end.
    for (const bad of [null, undefined, "", "soon", "2026-13-45"]) {
      const end = sittingPassEnd(bad as string | null, NOW);
      expect(Number.isFinite(end.getTime())).toBe(true);
      expect(end.getTime()).toBeLessThanOrEqual(cap.getTime());
      expect(end.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("Vienna midnight follows summer and winter time; added_months rounds up within 1..3", () => {
    expect(viennaMidnight("2027-07-01").toISOString()).toBe("2027-06-30T22:00:00.000Z");
    expect(viennaMidnight("2027-01-15").toISOString()).toBe("2027-01-14T23:00:00.000Z");
    // Summer time starts 28 Mar 2027: midnight of 29 Mar is 22:00 UTC.
    expect(dayAfterEnd("2027-03-27").toISOString()).toBe("2027-03-28T22:00:00.000Z");
    expect(sittingPassAddedMonths(new Date(NOW.getTime() + 30 * DAY), NOW)).toBe(1);
    expect(sittingPassAddedMonths(new Date(NOW.getTime() + 31 * DAY), NOW)).toBe(2);
    expect(sittingPassAddedMonths(new Date(NOW.getTime() + 92 * DAY), NOW)).toBe(3);
  });
});

describe("Guarantee Ticket renewal rules", () => {
  const ticket = (days: number, status = "active") => ({ id: "s1", tier: "guarantee_ticket", status, expires_at: new Date(NOW.getTime() + days * DAY).toISOString() });
  it("allows a request while the ticket runs and 30 days after, at most two approvals, one at a time", () => {
    expect(ticketRequestBlocker(ticket(100), 0, false, NOW)).toBeNull();
    expect(ticketRequestBlocker(ticket(-29, "expired"), 1, false, NOW)).toBeNull();
    expect(ticketRequestBlocker(ticket(-31, "expired"), 0, false, NOW)).toBe("too_late");
    expect(ticketRequestBlocker(ticket(100), TICKET_MAX_RENEWALS, false, NOW)).toBe("cap_reached");
    expect(ticketRequestBlocker(ticket(100), 0, true, NOW)).toBe("pending");
    expect(ticketRequestBlocker(ticket(100, "refunded"), 0, false, NOW)).toBe("inactive");
    expect(ticketRequestBlocker({ ...ticket(100), tier: "premium_pass_guaranteed" }, 0, false, NOW)).toBe("no_ticket");
    expect(ticketRequestBlocker({ ...ticket(100), expires_at: null }, 0, false, NOW)).toBe("no_end");
    expect(ticketRequestBlocker(null, 0, false, NOW)).toBe("no_ticket");
  });
  it("a booked sitting counts only after the ticket end; links are https without credentials", () => {
    expect(sittingAfterTicket("2027-11-01", "2027-10-20T10:00:00Z")).toBe(true);
    expect(sittingAfterTicket("2027-10-19", "2027-10-20T10:00:00Z")).toBe(false);
    expect(sittingAfterTicket("not a date", "2027-10-20T10:00:00Z")).toBe(false);
    expect(safeProofLink(" https://example.org/result.pdf ")).toBe("https://example.org/result.pdf");
    for (const bad of ["http://example.org", "javascript:alert(1)", "https://u:p@example.org", "", 3, "https://" + "a".repeat(600)]) expect(safeProofLink(bad)).toBeNull();
  });
  it("terms copy: Sie, no em dashes, the cap, no cash refund, the statutory right", () => {
    for (const lang of ["de", "en"] as const) {
      const text = [...ticketTerms(lang, 400).map((r) => `${r.label} ${r.value}`), ticketNotRefund(lang)].join(" ");
      expect(text).not.toMatch(/[–—]/);
      if (lang === "de") {
        expect(text).toMatch(/Zwei Verlängerungsjahre/);
        expect(text).toMatch(/keine Geldrückerstattung/);
        expect(text).toMatch(/gesetzliches Rücktrittsrecht/);
        expect(text).not.toMatch(/\b(du|dein|dich|dir)\b/i);
      } else {
        expect(text).toMatch(/not a cash refund/);
        expect(text).toMatch(/statutory right of withdrawal/);
      }
    }
    expect(ticketTerms("de", null).some((r) => /Mentor/.test(r.label))).toBe(false);
  });
});

describe("reverse trial guards", () => {
  it("normalises an address to one key per person", () => {
    expect(normaliseTrialEmail(" user-20e1567a@example.com ")).toBe("user-7192ae67@example.com");
    expect(normaliseTrialEmail("user-9561c430@example.com")).toBe("user-a3fcfc0f@example.com");
    expect(normaliseTrialEmail("nope")).toBeNull();
    expect(trialEmailKey("user-8698d007@example.com")).toBe(trialEmailKey("user-823e9935@example.com"));
    expect(trialEmailKey("user-415f3c4f@example.com")).toMatch(/^[0-9a-f]{64}$/);
    expect(trialIpHash("1.2.3.4, 10.0.0.1", "salt")).toBe(trialIpHash("1.2.3.4", "salt"));
    expect(trialIpHash("1.2.3.4", null)).toBeNull();
    expect(trialIpHash("1.2.3.4", "salt")).not.toContain("1.2.3.4");
  });
  it("only a new account, after the switch-on, not Pro, not admin", () => {
    const since = new Date(NOW.getTime() - 10 * DAY);
    const base = { createdAt: new Date(NOW.getTime() - DAY).toISOString(), role: "user", tier: "free", tierExpiresAt: null };
    expect(mayStartReverseTrial(base, since, NOW)).toBe(true);
    expect(mayStartReverseTrial({ ...base, createdAt: new Date(since.getTime() - 1).toISOString() }, since, NOW)).toBe(false);
    expect(mayStartReverseTrial({ ...base, createdAt: new Date(NOW.getTime() - 8 * DAY).toISOString() }, new Date(0), NOW)).toBe(false);
    expect(mayStartReverseTrial({ ...base, role: "admin" }, since, NOW)).toBe(false);
    expect(mayStartReverseTrial({ ...base, tier: "pro", tierExpiresAt: null }, since, NOW)).toBe(false);
    expect(mayStartReverseTrial({ ...base, tier: "pro", tierExpiresAt: new Date(NOW.getTime() + DAY).toISOString() }, since, NOW)).toBe(false);
    expect(mayStartReverseTrial({ ...base, tier: "pro", tierExpiresAt: new Date(NOW.getTime() - DAY).toISOString() }, since, NOW)).toBe(true);
    expect(mayStartReverseTrial({ ...base, createdAt: null }, since, NOW)).toBe(false);
    expect(trialDaysLeft(new Date(NOW.getTime() + 2.5 * DAY).toISOString(), NOW)).toBe(3);
    expect(trialDaysLeft(new Date(NOW.getTime() - 1).toISOString(), NOW)).toBe(0);
  });
  it("needs the build copy, the runtime switch and a readable start date", () => {
    expect(reverseTrialEnabled({ REVERSE_TRIAL_ENABLED: "true" })).toBe(false);
    expect(reverseTrialEnabled({ REVERSE_TRIAL_ENABLED: "true", REVERSE_TRIAL_SINCE: "nonsense" })).toBe(false);
    expect(reverseTrialEnabled({ REVERSE_TRIAL_ENABLED: "true", REVERSE_TRIAL_SINCE: "2026-10-20T00:00:00Z" })).toBe(true);
    expect(reverseTrialSince({ REVERSE_TRIAL_SINCE: "2026-10-20T00:00:00Z" })?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    process.env.REVERSE_TRIAL_ENABLED = "true";
    process.env.REVERSE_TRIAL_SINCE = "2026-10-20T00:00:00Z";
    expect(reverseTrialEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_REVERSE_TRIAL = "true";
    expect(reverseTrialEnabled()).toBe(true);
    process.env.REVERSE_TRIAL_ENABLED = "false";
    expect(reverseTrialEnabled()).toBe(false);
  });
});

describe("readiness: never sell a promise that is not running", () => {
  const mentor = { AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "paid", MENTOR_HOUSE_GRANTS_SCOPE: "signed_in", MENTOR_INCLUDED_RAISE_ENABLED: "true" };
  it("6 months needs the live renewal stop and the reminder", () => {
    expect(halfYearReady({})).toBe(false);
    expect(halfYearReady({ HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true" })).toBe(false);
    expect(halfYearAutoStopDryRun({})).toBe(true);
    expect(halfYearReady({ HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_AUTO_STOP_DRY_RUN: "false", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true" })).toBe(true);
  });
  it("the ticket needs the renewal flow and the Mentor credits", () => {
    expect(ticketMentorReady(mentor)).toBe(true);
    expect(ticketMentorReady({ ...mentor, MENTOR_ACCESS_SCOPE: "beta" })).toBe(false);
    // House grants stay allowlist-only: the ticket does not need them (review P2 #1).
    expect(ticketMentorReady({ ...mentor, MENTOR_HOUSE_GRANTS_SCOPE: "" })).toBe(true);
    expect(ticketMentorReady({ ...mentor, MENTOR_INCLUDED_RAISE_ENABLED: "" })).toBe(false);
    expect(ticketReady(mentor)).toBe(false);
    expect(ticketReady({ ...mentor, TICKET_RENEWAL_ENABLED: "true" })).toBe(false);
    expect(ticketReady({ ...mentor, TICKET_RENEWAL_ENABLED: "true", TICKET_REMINDER_EMAILS_ENABLED: "true" })).toBe(true);
    expect(v2PlanReady("flex_month", {})).toBe(true);
    expect(v2PlanReady("sitting_pass", {})).toBe(true);
  });
});
