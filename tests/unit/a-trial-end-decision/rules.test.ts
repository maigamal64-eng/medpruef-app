import { describe, expect, it } from "vitest";
import { sittingOptions } from "@/lib/pricing-v2/sitting-pass";
import {
  ENDED_WINDOW_DAYS,
  cardPlan,
  checkoutHref,
  shouldSaveSitting,
  trialEndState,
  trialKindOf,
  weakestFields,
} from "@/lib/trial-end/rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-06T11:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const free = { role: "user", tier: "free", tierExpiresAt: null };

describe("trialEndState", () => {
  it("last 24 hours of a running trial is the banner state", () => {
    const end = iso(now.getTime() + 20 * HOUR);
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: { role: "user", tier: "pro", tierExpiresAt: end }, now })).toBe("last_day");
  });
  it("more than 24 hours left is nothing yet", () => {
    const end = iso(now.getTime() + 30 * HOUR);
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: { role: "user", tier: "pro", tierExpiresAt: end }, now })).toBe("none");
  });
  it("ended: before the sweep (dated pro in the past) and after it (free)", () => {
    const end = iso(now.getTime() - 2 * HOUR);
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: { role: "user", tier: "pro", tierExpiresAt: end }, now })).toBe("ended");
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: free, now })).toBe("ended");
  });
  it(`ended more than ${ENDED_WINDOW_DAYS} days ago is nothing`, () => {
    const end = iso(now.getTime() - (ENDED_WINDOW_DAYS + 1) * DAY);
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: free, now })).toBe("none");
  });
  it("a payer, an admin, permanent Pro or access past the trial end never sees it", () => {
    const end = iso(now.getTime() + 2 * HOUR);
    expect(trialEndState({ trialEndsAt: end, everPaid: true, user: free, now })).toBe("none");
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: { role: "admin", tier: "admin", tierExpiresAt: null }, now })).toBe("none");
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: { role: "user", tier: "pro", tierExpiresAt: null }, now })).toBe("none");
    expect(trialEndState({ trialEndsAt: end, everPaid: false, user: { role: "user", tier: "pro", tierExpiresAt: iso(now.getTime() + 40 * DAY) }, now })).toBe("none");
  });
  it("no trial row is nothing", () => {
    expect(trialEndState({ trialEndsAt: null, everPaid: false, user: free, now })).toBe("none");
  });
});

describe("trialKindOf", () => {
  const since = new Date("2026-10-20T10:00:00Z");
  it("automatic for accounts after REVERSE_TRIAL_SINCE, claim for older ones", () => {
    expect(trialKindOf("2026-10-21T00:00:00Z", since)).toBe("auto");
    expect(trialKindOf("2026-05-01T00:00:00Z", since)).toBe("claim");
    expect(trialKindOf(null, since)).toBe("auto");
  });
});

describe("cardPlan (fit.ts, decision sitting-fit)", () => {
  const ready = { flex_month: true, sitting_pass: true, half_year: true, guarantee_ticket: true };
  const spt = sittingOptions("kmp_innsbruck", now).find((s) => s.date === "2027-02-03");
  it("Stichprobentest 3 Feb 2027 bought 6 Nov 2026: the Sitting Pass covers it once", () => {
    expect(spt).toBeTruthy();
    const plan = cardPlan({ kind: "sitting", ...spt! }, now, { guard: false, ready });
    expect(plan.tier).toBe("sitting_pass");
    expect(plan.fit?.covers).toBe(true);
    expect(plan.fit?.charges).toBe(1);
  });
  it("a plan that is not on sale is never marked", () => {
    const plan = cardPlan({ kind: "long_route" }, now, { guard: false, ready: { ...ready, guarantee_ticket: false } });
    expect(plan.tier).toBe("flex_month");
    expect(cardPlan({ kind: "long_route" }, now, { guard: false, ready }).tier).toBe("guarantee_ticket");
  });
  it("not sure yet: Monthly", () => {
    expect(cardPlan({ kind: "unsure" }, now, { guard: false, ready }).tier).toBe("flex_month");
  });
});

describe("checkoutHref", () => {
  it("opens /pricing's resume path with the plan and the sitting", () => {
    expect(checkoutHref("sitting_pass", { kind: "sitting", bank: "kmp_innsbruck", date: "2027-02-03", lastDay: "2027-02-03" }))
      .toBe("/pricing?action=sitting-pass-checkout&bank=kmp_innsbruck&sitting=2027-02-03&sitting_end=2027-02-03");
    expect(checkoutHref("flex_month", { kind: "unsure" })).toBe("/pricing?action=flex-month-checkout");
  });
});

describe("shouldSaveSitting (reviewer P2-2)", () => {
  it("saves only a sitting of the bank the learner studies", () => {
    const pharma = { kind: "sitting" as const, bank: "pharma" as const, date: "2027-01-20", lastDay: "2027-01-22" };
    expect(shouldSaveSitting(pharma, "pharma")).toBe(true);
    expect(shouldSaveSitting(pharma, "kenntnispruefung")).toBe(false);
    expect(shouldSaveSitting({ kind: "unsure" }, "pharma")).toBe(false);
  });
});

describe("weakestFields (MUX-68, TodayCard mapping)", () => {
  const rows = [
    { topic: "Innere Medizin", lastCorrectSample: 20, lastCorrectPct: 40 },
    { topic: "Chirurgie", lastCorrectSample: 15, lastCorrectPct: 55 },
    { topic: "Pädiatrie", lastCorrectSample: 12, lastCorrectPct: 80 },
    { topic: "Neurologie", lastCorrectSample: 3, lastCorrectPct: 0 },
  ];
  it("weakest first, at most two, judged fields only", () => {
    expect(weakestFields(rows)).toEqual(["Innere Medizin", "Chirurgie"]);
  });
  it("thin data or no newest-attempt read: none", () => {
    expect(weakestFields(rows.slice(0, 2))).toEqual([]);
    expect(weakestFields(rows.map(({ topic }) => ({ topic })))).toEqual([]);
    expect(weakestFields(null)).toEqual([]);
  });
});
