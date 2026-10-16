/**
 * a-pricing-v2-fit acceptance: the truth table for "When is your exam?"
 * (decision sitting-fit, D-B) computed with a-pricing-v2's own renewal rules
 * (stopDue) and the renewal guard (decision renewal-guard). Sittings are real
 * OFFICIAL_SITTINGS rows; purchases at 11:00 UTC.
 */
import { describe, expect, it } from "vitest";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { sittingFit, sittingCoveredFrom } from "@/lib/pricing-v2/fit";
import { guardAccessUntil, guardDue, guardWindowStart, renewalGuardApplies } from "@/lib/pricing-v2/renewal-guard";
import { stopDue } from "@/lib/pricing-v2/half-year-server";
import { dayAfterEnd } from "@/lib/pricing-v2/sitting-pass";
import { fitLines } from "@/app/pricing/_parts/fit-copy";

const DAY = 86_400_000;
const bought = (day: string) => new Date(`${day}T11:00:00Z`);

function official(exam: string, date: string) {
  const row = OFFICIAL_SITTINGS.find((s) => s.exam_key === exam && s.date === date);
  if (!row) throw new Error(`no official ${exam} sitting on ${date}`);
  return { date: row.date, lastDay: row.date_end ?? row.date };
}
const STP_FEB = official("stichprobentest", "2027-02-03");
const STP_MAY = official("stichprobentest", "2027-05-04");
const SIP5A_NOV = official("sip5a", "2026-11-17");

describe("truth table (acceptance cases)", () => {
  it("3 Feb sitting bought 6 Nov: the Sitting Pass (59) beats three monthly charges (72)", () => {
    const fit = sittingFit(STP_FEB, bought("2026-11-06"), { guard: true });
    expect(fit.recommended).toBe("sitting_pass");
    expect(fit.plans.sitting_pass).toMatchObject({ covers: true, charges: 1, totalCents: 5900 });
    expect(fit.plans.flex_month).toMatchObject({ charges: 3, totalCents: 7200 });
    expect(fit.plans.half_year).toMatchObject({ charges: 1, totalCents: 10000, guardedRenewalAt: null });
    expect(fit.plans.guarantee_ticket).toMatchObject({ charges: 1, totalCents: 17900, needsRenewalYear: false });
  });

  it("3 Feb sitting bought 10 Dec: Monthly with 2 charges (48)", () => {
    const fit = sittingFit(STP_FEB, bought("2026-12-10"), { guard: true });
    expect(fit.recommended).toBe("flex_month");
    expect(fit.plans.flex_month).toMatchObject({ covers: true, charges: 2, totalCents: 4800 });
  });

  it("4 May sitting bought 6 Nov: 6 months with no renewal (its renewal falls after the sitting, stopDue)", () => {
    const now = bought("2026-11-06");
    const fit = sittingFit(STP_MAY, now, { guard: false });
    expect(fit.recommended).toBe("half_year");
    expect(fit.plans.half_year).toMatchObject({ charges: 1, totalCents: 10000, guardedRenewalAt: null });
    // The rule the cron applies: the renewal 180 days later is on/after the first day after the sitting.
    const renewal = new Date(now.getTime() + 180 * DAY);
    expect(renewal.getTime()).toBeGreaterThanOrEqual(sittingCoveredFrom(STP_MAY.lastDay).getTime());
    expect(stopDue(STP_MAY.lastDay, renewal.toISOString(), new Date(renewal.getTime() - 3 * DAY))).toBe(true);
    expect(renewalGuardApplies(renewal, STP_MAY)).toBe(false);
  });

  it("4 May sitting bought 4 Nov: the renewal guard applies, never a silent second charge", () => {
    const now = bought("2026-11-04");
    const renewal = new Date(now.getTime() + 180 * DAY); // 3 May 2027, the day before the sitting
    expect(renewal.toISOString().slice(0, 10)).toBe("2027-05-03");
    // a-pricing-v2's stop alone would NOT prevent this charge: the guard is real work.
    expect(stopDue(STP_MAY.lastDay, renewal.toISOString(), new Date(renewal.getTime() - 3 * DAY))).toBe(false);
    expect(renewalGuardApplies(renewal, STP_MAY)).toBe(true);

    const guarded = sittingFit(STP_MAY, now, { guard: true });
    expect(guarded.recommended).toBe("half_year");
    expect(guarded.plans.half_year).toMatchObject({ charges: 1, totalCents: 10000, guardedRenewalAt: renewal.toISOString() });
    expect(guarded.plans.half_year.accessUntil).toBe(dayAfterEnd(STP_MAY.lastDay).toISOString());
    expect(fitLines(guarded.plans.half_year, "de").join(" ")).toContain("Die Verlängerung am 3. Mai 2027 fiele in die 14 Tage vor Ihrem Termin. Deshalb entfällt sie, und Ihr Zugang läuft ohne weitere Abbuchung bis einschließlich 5. Mai 2027.");

    // Guard not running: the totals show the renewal (2 charges, 200), and
    // the highlight moves to the cheaper cover.
    const plain = sittingFit(STP_MAY, now, { guard: false });
    expect(plain.plans.half_year).toMatchObject({ charges: 2, totalCents: 20000, guardedRenewalAt: null });
    expect(fitLines(plain.plans.half_year, "de")).toEqual(["Bis zu Ihrem Termin: 2 Abbuchungen, zusammen 200 €."]);
    expect(plain.recommended).toBe("flex_month");
    expect(plain.plans.flex_month).toMatchObject({ charges: 7, totalCents: 16800 });
  });

  it("17 Nov SIP bought 21 Oct: Monthly with 1 charge (24)", () => {
    const fit = sittingFit(SIP5A_NOV, bought("2026-10-21"), { guard: true });
    expect(fit.recommended).toBe("flex_month");
    expect(fit.plans.flex_month).toMatchObject({ charges: 1, totalCents: 2400 });
    expect(fitLines(fit.plans.flex_month, "de")).toEqual(["Bis zu Ihrem Termin: 1 Abbuchung, zusammen 24 €. Danach läuft das Abo weiter, bis Sie kündigen."]);
    expect(fitLines(fit.plans.flex_month, "en")).toEqual(["Up to your sitting: 1 charge, 24 € in total. After that the plan keeps running until you cancel."]);
  });
});

describe("fit rules", () => {
  it("a plan that cannot be sold now is never the highlight", () => {
    const fit = sittingFit(STP_MAY, bought("2026-11-06"), { guard: false, ready: { half_year: false, guarantee_ticket: false } });
    expect(fit.recommended).toBe("flex_month");
  });

  it("the pass capped before the sitting does not cover it and gets no total line", () => {
    const fit = sittingFit(STP_MAY, bought("2026-11-06"), { guard: false });
    expect(fit.plans.sitting_pass.covers).toBe(false);
    expect(fitLines(fit.plans.sitting_pass, "de")).toEqual([]);
  });

  it("a sitting beyond the ticket's 12 months is covered by a renewal year, said plainly", () => {
    const fit = sittingFit({ date: "2027-09-22", lastDay: "2027-09-22" }, bought("2026-09-01"), { guard: true });
    expect(fit.plans.guarantee_ticket.needsRenewalYear).toBe(true);
    expect(fitLines(fit.plans.guarantee_ticket, "de")[0]).toMatch(/Verlängerungsjahr ohne Abbuchung.*einmalig 179 €\.$/);
  });

  it("copy: price last, Sie, no em dash, no break-even wording", () => {
    for (const now of ["2026-10-21", "2026-11-04", "2026-11-06", "2026-12-10"].map(bought)) {
      for (const s of [STP_FEB, STP_MAY, SIP5A_NOV]) {
        if (now.getTime() > Date.parse(`${s.lastDay}T00:00:00Z`)) continue;
        const fit = sittingFit(s, now, { guard: true });
        for (const plan of Object.values(fit.plans)) {
          for (const lang of ["de", "en"] as const) {
            for (const line of fitLines(plan, lang)) {
              expect(line).not.toMatch(/—|–/);
              expect(line).not.toMatch(/\b(du|dein|dir)\b/i);
              expect(line).not.toMatch(/lohnt|break-even|pays off|günstiger als|cheaper than/i);
            }
          }
        }
      }
    }
  });
});

describe("renewal guard window", () => {
  it("from 00:00 Vienna 14 days before the first day to the end of the last day", () => {
    const week = { date: "2027-01-18", lastDay: "2027-01-22" };
    const start = guardWindowStart(week);
    expect(start.toISOString()).toBe("2027-01-03T23:00:00.000Z");
    expect(renewalGuardApplies(new Date(start.getTime() - 1), week)).toBe(false);
    expect(renewalGuardApplies(start, week)).toBe(true);
    expect(renewalGuardApplies("2027-01-22T22:59:59.000Z", week)).toBe(true);
    expect(renewalGuardApplies("2027-01-22T23:00:00.000Z", week)).toBe(false); // stopDue's from here
    expect(guardAccessUntil(week).toISOString()).toBe(dayAfterEnd("2027-01-22").toISOString());
  });

  it("the cron acts within 8 days of the charge, never after it", () => {
    const charge = "2027-05-03T11:00:00.000Z";
    expect(guardDue(STP_MAY, charge, new Date("2027-04-24T11:00:00Z"))).toBe(false);
    expect(guardDue(STP_MAY, charge, new Date("2027-04-25T11:00:00Z"))).toBe(true);
    expect(guardDue(STP_MAY, charge, new Date("2027-05-03T11:00:01Z"))).toBe(false);
    expect(guardDue(null, charge, new Date("2027-04-28T11:00:00Z"))).toBe(false);
    expect(guardDue(STP_MAY, "2027-04-01T11:00:00.000Z", new Date("2027-03-28T11:00:00Z"))).toBe(false);
  });
});
