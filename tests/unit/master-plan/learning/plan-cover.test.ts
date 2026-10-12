import { describe, expect, it } from "vitest";
import { TIERS } from "@/lib/content-truth";
import {
  DEFAULT_PRICES,
  coverCost,
  loggedOutTotals,
  monthsLabel,
  monthsUntil,
} from "@/lib/master-learning/plan-cover";

const total = (months: number, plan: "monthly" | "quarterly" | "cohort") =>
  coverCost(months).options.find((o) => o.plan === plan)!.totalEur;

describe("plan cover", () => {
  it("prices come from content-truth TIERS", () => {
    expect(DEFAULT_PRICES.monthlyEur).toBe(TIERS.first_month_19.price_cents / 100);
    expect(DEFAULT_PRICES.quarterlyEur).toBe(TIERS.first_3mo_27.price_cents / 100);
    expect(DEFAULT_PRICES.cohortEur).toBe(TIERS.premium_pass_guaranteed.price_cents / 100);
  });

  it("3 months: monthly 57 vs quarterly 49 vs cohort 129, cheapest quarterly", () => {
    expect([total(3, "monthly"), total(3, "quarterly"), total(3, "cohort")]).toEqual([57, 49, 129]);
    expect(coverCost(3).cheapest).toBe("quarterly");
  });

  it("6 months: cohort 129 vs monthly 114 (monthly is cheaper than the cohort) and quarterly 98 cheapest", () => {
    expect([total(6, "monthly"), total(6, "quarterly"), total(6, "cohort")]).toEqual([114, 98, 129]);
    expect(total(6, "monthly")).toBeLessThan(total(6, "cohort"));
    expect(coverCost(6).cheapest).toBe("quarterly");
  });

  it("1 month: monthly is cheapest; more than 6 months needs a second cohort", () => {
    expect(coverCost(1).cheapest).toBe("monthly");
    expect(coverCost(7).options.find((o) => o.plan === "cohort")).toMatchObject({ units: 2, totalEur: 258 });
  });

  it("months until the sitting, rounded up, none when passed or missing", () => {
    const now = new Date("2026-10-12T09:00:00Z");
    expect(monthsUntil("2027-02-09", now)).toBe(4); // 120 days
    expect(monthsUntil("2026-10-12", now)).toBe(1);
    expect(monthsUntil("2026-10-11", now)).toBeNull();
    expect(monthsUntil(null, now)).toBeNull();
    expect(monthsUntil("garbage", now)).toBeNull();
  });

  it("logged-out visitors get 3, 4 and 6 month totals", () => {
    expect(loggedOutTotals().map((r) => r.months)).toEqual([3, 4, 6]);
  });

  it("labels", () => {
    expect(monthsLabel(4, "de")).toBe("4 Monate bis zu Ihrem Termin");
    expect(monthsLabel(1, "de")).toBe("1 Monat bis zu Ihrem Termin");
  });
});
