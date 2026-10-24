import { describe, expect, it } from "vitest";
import { DISABLE_ADAPTIVE_BODY, blockingProblems, deprecationNotes, expectFor, idempotencyKey, planSpecs, planSummary, planValueProblems, selectSpecs } from "../../../scripts/whop/create-v2-plans";

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

  it("a v2 plan read back must still be hidden (a-whop-v2-plans-now)", () => {
    const plan = { id: "plan_p", plan_type: "one_time", adaptive_pricing_enabled: false, currency: "eur", initial_price: 59 };
    expect(planValueProblems({ ...plan, visibility: "hidden" }, 5900, { hidden: true })).toEqual([]);
    expect(planValueProblems({ ...plan, visibility: "visible" }, 5900, { hidden: true })).toEqual(['visibility is "visible", expected "hidden"']);
    expect(planValueProblems(plan, 5900, { hidden: true })).toEqual(["visibility is undefined, expected \"hidden\""]);
    // The Top-up is a live plan: visibility is not checked there.
    expect(planValueProblems({ ...plan, visibility: "visible" }, null)).toEqual([]);
  });

  it("reads the 2026-09-02-1 money object (major-unit decimal string)", () => {
    const base = { id: "plan_t", plan_type: "one_time", adaptive_pricing_enabled: false, currency: "eur", visibility: "hidden" };
    expect(planValueProblems({ ...base, initial_price: { amount: "179.00", currency: "eur", decimals: 2 } }, 17900, { hidden: true })).toEqual([]);
    expect(planValueProblems({ ...base, initial_price: "179.00" }, 17900)).toEqual([]);
    expect(planValueProblems({ ...base, initial_price: { amount: "17.90" } }, 17900)).toEqual(["price is 17.9, expected 179"]);
    expect(planValueProblems({ ...base, initial_price: { amount: null } }, 17900)).toEqual(["price is null, expected 179"]);
  });

  it("summarises a read-back for the card line", () => {
    expect(planSummary({ id: "plan_m", title: "MedPrüf Pro Monatsabo", visibility: "hidden", plan_type: "renewal", currency: "eur", initial_price: 0, renewal_price: 24, billing_period: 30 })).toBe('plan_m "MedPrüf Pro Monatsabo" visibility=hidden 24.00 EUR every 30 days (initial_price=0.00, initial_price_due=absent)');
    expect(planSummary({ id: "plan_h", title: "MedPrüf Pro 6 Monate", visibility: "hidden", plan_type: "renewal", currency: "eur", initial_price: { value: "100" }, renewal_price: "100.00", billing_period: 180, initial_price_due: "100.00" })).toBe('plan_h "MedPrüf Pro 6 Monate" visibility=hidden 100.00 EUR every 180 days (initial_price=unreadable, initial_price_due=100.00)');
    expect(planSummary({ data: { id: "plan_g", title: "MedPrüf Garantie-Ticket", visibility: "hidden", plan_type: "one_time", currency: "eur", initial_price: { amount: "179.00" } } })).toBe('plan_g "MedPrüf Garantie-Ticket" visibility=hidden 179.00 EUR once');
    expect(planSummary(null)).toBe("unreadable response");
  });

  it("reviewer P1: an unreadable initial_price on a renewal plan never reads as 0", () => {
    const plan = { id: "plan_m", plan_type: "renewal", adaptive_pricing_enabled: false, currency: "eur", renewal_price: "24.00", billing_period: 30, visibility: "hidden" };
    expect(planValueProblems({ ...plan, initial_price: { value: "24.00" } }, 2400)).toContain("initial_price is unreadable on a renewal plan, expected 0 (it is charged on top of the first renewal)");
    expect(planValueProblems({ ...plan }, 2400)).toContain("initial_price is unreadable on a renewal plan, expected 0 (it is charged on top of the first renewal)");
    // --allow-missing-due never lets it through.
    const { blocking } = blockingProblems(planValueProblems({ ...plan, initial_price: { value: "24.00" } }, 2400), true);
    expect(blocking).toEqual(["initial_price is unreadable on a renewal plan, expected 0 (it is charged on top of the first renewal)"]);
    // A clean plan without initial_price_due passes only with the switch, as a warning.
    const clean = planValueProblems({ ...plan, initial_price: "0.00" }, 2400, expectFor(planSpecs("b", "p")[0]));
    expect(blockingProblems(clean, false).blocking).toHaveLength(1);
    expect(blockingProblems(clean, true)).toEqual({ blocking: [], warnings: [clean[0]] });
  });

  it("reviewer P2: type and cadence must match the spec", () => {
    const [flex, pass, half] = planSpecs("b", "p");
    expect(expectFor(half)).toEqual({ hidden: true, planType: "renewal", billingPeriod: 180 });
    expect(expectFor(pass)).toEqual({ hidden: true, planType: "one_time", billingPeriod: undefined });
    const ok = { id: "plan_h", plan_type: "renewal", billing_period: 180, adaptive_pricing_enabled: false, currency: "eur", visibility: "hidden", initial_price: 0, renewal_price: 100, initial_price_due: 100 };
    expect(planValueProblems(ok, 10000, expectFor(half))).toEqual([]);
    expect(planValueProblems({ ...ok, billing_period: 30 }, 10000, expectFor(half))).toEqual(["billing_period is 30, expected 180"]);
    expect(planValueProblems({ ...ok, initial_price_due: 59, renewal_price: 59, billing_period: 30 }, 5900, expectFor(pass))).toContain('plan_type is "renewal", expected "one_time"');
    expect(planValueProblems({ ...ok, plan_type: "subscription", renewal_price: 24, initial_price: 24, billing_period: 30, initial_price_due: undefined }, 2400, expectFor(flex))).toContain('plan_type is "subscription", expected "renewal"');
    expect(planValueProblems({ ...ok, plan_type: undefined }, 10000, expectFor(half))).toContain('plan_type is undefined, expected "renewal"');
  });

  it("reviewer P3: a numeric amount without decimals is major units; a money object in another currency fails", () => {
    const base = { id: "plan_t", plan_type: "one_time", adaptive_pricing_enabled: false, currency: "eur", visibility: "hidden" };
    expect(planValueProblems({ ...base, initial_price: { amount: 179 } }, 17900)).toEqual([]);
    expect(planValueProblems({ ...base, initial_price: { amount: 17900, decimals: 2 } }, 17900)).toEqual([]);
    expect(planValueProblems({ ...base, initial_price: { amount: "179.00", currency: "usd" } }, 17900)).toEqual(['initial_price currency is "usd", expected eur']);
  });

  it("idempotency key carries a body hash; --only selects one tier", () => {
    const specs = planSpecs("b", "p");
    const k = idempotencyKey("variants", specs[0]);
    expect(k).toMatch(/^medpruef-a-pricing-v2-variants-flex_month-[0-9a-f]{12}$/);
    expect(idempotencyKey("variants", { ...specs[0], body: { ...specs[0].body, renewal_price: 25 } })).not.toBe(k);
    expect(idempotencyKey("plans", specs[0])).not.toBe(k);
    expect(selectSpecs(specs, null)).toHaveLength(4);
    expect(selectSpecs(specs, "half_year")?.map((s) => s.tier)).toEqual(["half_year"]);
    expect(selectSpecs(specs, "nope")).toBeNull();
  });
});

describe("create-v2-plans --card-trial (a-card-trial-preflip-1024)", () => {
  // Imported lazily so the describe above keeps its own import line unchanged.
  it("the 3-day trial plan has exactly the terms [name] approved on 24 Oct", async () => {
    const { cardTrialPlanSpec, expectFor, planValueProblems } = await import("../../../scripts/whop/create-v2-plans");
    const s = cardTrialPlanSpec("biz_x", "prod_redacted1b973073");
    expect(s.env).toBe("WHOP_PLAN_FLEX_TRIAL");
    expect(s.body).toMatchObject({
      account_id: "biz_x", product_id: "prod_redacted1b973073", plan_type: "renewal", initial_price: 0, renewal_price: 24,
      currency: "eur", billing_period: 30, trial_period_days: 3, unlimited_stock: true, visibility: "hidden", adaptive_pricing_enabled: false,
    });
    expect(String(s.body.title).length).toBeLessThanOrEqual(30);
    const e = expectFor(s);
    expect(e).toMatchObject({ hidden: true, planType: "renewal", billingPeriod: 30, trialDays: 3 });
    const good = { id: "plan_t", product: { id: "prod_redacted1b973073" }, visibility: "hidden", plan_type: "renewal", billing_period: 30, trial_period_days: 3, adaptive_pricing_enabled: false, currency: "eur", initial_price: 0, renewal_price: 24, initial_price_due: 0 };
    expect(planValueProblems(good, s.priceCents, e)).toEqual([]);
    // A trial plan that charges 24 at checkout, or lost its trial days, is refused.
    expect(planValueProblems({ ...good, initial_price_due: 24 }, s.priceCents, e).join()).toContain("initial_price_due is 24, expected 0");
    expect(planValueProblems({ ...good, trial_period_days: null }, s.priceCents, e).join()).toContain("trial_period_days");
    expect(planValueProblems({ ...good, renewal_price: 19 }, s.priceCents, e).join()).toContain("price is 19");
    expect(planValueProblems({ ...good, visibility: "visible" }, s.priceCents, e).join()).toContain("visibility");
    expect(e.productId).toBe("prod_redacted1b973073");
    expect(planValueProblems({ ...good, product: { id: "prod_other" } }, s.priceCents, e).join()).toContain("product");
  });

  it("a v2 plan read back with trial days is refused (the monthly plan must never give free days)", async () => {
    const { planSpecs, expectFor, planValueProblems } = await import("../../../scripts/whop/create-v2-plans");
    const flex = planSpecs("biz_x", "prod_x")[0];
    const plan = { id: "plan_m", visibility: "hidden", plan_type: "renewal", billing_period: 30, adaptive_pricing_enabled: false, currency: "eur", initial_price: 0, renewal_price: 24, initial_price_due: 24 };
    expect(planValueProblems(plan, flex.priceCents, expectFor(flex))).toEqual([]);
    expect(planValueProblems({ ...plan, trial_period_days: 3 }, flex.priceCents, expectFor(flex)).join()).toContain("expected none");
  });
});
