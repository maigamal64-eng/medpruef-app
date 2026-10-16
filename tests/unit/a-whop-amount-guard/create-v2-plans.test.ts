import { describe, expect, it } from "vitest";
import { DISABLE_ADAPTIVE_BODY, deprecationNotes, planSpecs, planValueProblems } from "../../../scripts/whop/create-v2-plans";

describe("create-v2-plans (Whop review G2/G11)", () => {
  it("every plan body switches adaptive pricing off and charges EUR", () => {
    for (const endpoint of ["variants", "plans"] as const) {
      const specs = planSpecs("biz_x", "prod_x", endpoint);
      expect(specs.map((s) => s.tier)).toEqual(["flex_month", "sitting_pass", "half_year", "guarantee_ticket"]);
      for (const s of specs) {
        expect(s.body.adaptive_pricing_enabled).toBe(false);
        expect(s.body.currency).toBe("eur");
        expect(s.body.visibility).toBe("hidden");
        expect(String(s.body.title).length).toBeLessThanOrEqual(30);
        // Whop charges initial_price + the first renewal_price on a renewal plan.
        const charged = s.body.plan_type === "renewal" ? Number(s.body.initial_price) + Number(s.body.renewal_price) : Number(s.body.initial_price);
        expect(Math.round(charged * 100)).toBe(s.priceCents);
        if (s.body.plan_type === "renewal") expect(s.body.initial_price).toBe(0);
      }
    }
  });

  it("/variants names the owner account_id, /plans company_id", () => {
    expect(planSpecs("biz_x", "prod_x", "variants")[0].body).toMatchObject({ account_id: "biz_x" });
    expect(planSpecs("biz_x", "prod_x", "variants")[0].body).not.toHaveProperty("company_id");
    expect(planSpecs("biz_x", "prod_x", "plans")[0].body).toMatchObject({ company_id: "biz_x" });
  });

  it("the Top-up PATCH only turns adaptive pricing off", () => {
    expect(DISABLE_ADAPTIVE_BODY).toEqual({ adaptive_pricing_enabled: false });
  });

  it("logs Deprecation, Sunset and Link headers", () => {
    const h = new Headers({ deprecation: "@1790208000", link: '<https://api.whop.com/api/v1/variants>; rel="successor-version"' });
    expect(deprecationNotes(h)).toEqual(["deprecation: @1790208000", 'link: <https://api.whop.com/api/v1/variants>; rel="successor-version"']);
    expect(deprecationNotes(new Headers())).toEqual([]);
  });

  it("checks a plan read back by value", () => {
    expect(planValueProblems({ id: "plan_a", adaptive_pricing_enabled: false, currency: "eur", initial_price: 59 }, 5900)).toEqual([]);
    // A renewal plan that does not state its first charge fails the check.
    expect(planValueProblems({ id: "plan_m", plan_type: "renewal", adaptive_pricing_enabled: false, currency: "eur", initial_price: 0, renewal_price: 24 }, 2400)).toEqual([
      "initial_price_due is missing on a renewal plan; confirm the first charge with one real checkout before PRICING_V2_ENABLED",
    ]);
    expect(planValueProblems({ data: { adaptive_pricing_enabled: false, currency: "eur", initial_price: { amount: 17900, decimals: 2 } } }, 17900)).toEqual([]);
    expect(planValueProblems({ id: "plan_m", plan_type: "renewal", adaptive_pricing_enabled: false, currency: "eur", initial_price: 0, renewal_price: 24, initial_price_due: { amount: 2400, decimals: 2 } }, 2400)).toEqual([]);
    // The old body: 24 + 24 at checkout.
    expect(planValueProblems({ id: "plan_m", plan_type: "renewal", adaptive_pricing_enabled: false, currency: "eur", initial_price: 24, renewal_price: 24, initial_price_due: 48 }, 2400)).toHaveLength(2);
    expect(planValueProblems({ id: "plan_a", adaptive_pricing_enabled: true, currency: "eur", initial_price: 59 }, 5900)).toEqual(["adaptive_pricing_enabled is true, expected false"]);
    expect(planValueProblems({ id: "plan_a", adaptive_pricing_enabled: false, currency: "usd", initial_price: 49 }, 5900)).toHaveLength(2);
    expect(planValueProblems({ id: "plan_topup", adaptive_pricing_enabled: false, currency: "eur" }, null)).toEqual([]);
    expect(planValueProblems({ id: "plan_topup", currency: "eur" }, null)).toEqual(["adaptive_pricing_enabled is undefined, expected false"]);
    expect(planValueProblems({ id: "plan_topup", adaptive_pricing_enabled: false }, null)).toEqual(["currency is undefined, expected eur"]);
    expect(planValueProblems(null, null)).toEqual(["unreadable response"]);
  });
});
