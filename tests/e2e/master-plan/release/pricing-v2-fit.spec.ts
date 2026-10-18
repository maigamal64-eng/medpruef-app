import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-pricing-v2-fit smoke (needs the v2 build, PRICING_V2_BUILD=1, see
 * pricing-v2.spec.ts). "When is your exam?" shows each plan's total to the
 * chosen sitting and marks one plan; a returning payer (the eligibility
 * answer is synthetic) also sees the old recurring plans, and their click
 * posts that tier. 375 and 1280 px, DE and EN, light and dark; no console
 * error, no horizontal scroll; the checkout is captured, never sent.
 */
const v2 = process.env.PRICING_V2_BUILD === "1";
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/pricing-v2-fit`;
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

test.skip(!v2, "needs the v2 build (PRICING_V2_BUILD=1)");
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

for (const v of VARIANTS) {
  test(`fit totals ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto("/pricing", { waitUntil: "load" });
    await page.locator("#exam-timing").waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.locator("[data-fit-total]")).toHaveCount(0);
    await page.locator('#exam-timing input[type="radio"]').first().check();
    await expect(page.locator("[data-plan] >> text=/Empfohlen|Recommended/")).toHaveCount(1);
    // The marked plan states its total to the sitting, price last.
    const marked = page.locator("[data-plan]", { hasText: v.lang === "de" ? "Empfohlen" : "Recommended" });
    const total = marked.locator("[data-fit-total]").first();
    await expect(total).toBeVisible();
    await expect(total).toHaveText(v.lang === "de" ? /^Bis zu Ihrem Termin: .*€\.( Danach .*)?$/ : /^Up to your sitting: .*€( in total| once)?\.( After .*)?$/);
    // F19: the new picker labels.
    await expect(page.locator("#exam-timing")).toContainText(v.lang === "de" ? "Ich wiederhole einen nicht bestandenen Prüfungsteil" : "I am repeating a part I did not pass");
    await expect(page.locator("#exam-timing")).toContainText(v.lang === "de" ? "Ich habe mehrere Prüfungen vor mir" : "I have several exams ahead");
    // Not for visitors: the returning-payer plans.
    await expect(page.locator("[data-returning-plans]")).toHaveCount(0);
    await noOverflow(page, "/pricing fit");
    await page.locator("#exam-timing").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/fit-${tag(v)}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });
}

for (const v of VARIANTS) {
  test(`returning payer plans ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/pricing/returning", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eligible: true, tiers: ["first_month_19", "first_3mo_27"] }) }));
    const bodies: unknown[] = [];
    await page.route("**/api/whop/checkout", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PLAN_NOT_READY" }) });
    });
    await page.goto("/pricing", { waitUntil: "load" });
    const section = page.locator("[data-returning-plans]");
    await expect(section).toBeVisible({ timeout: 25_000 });
    await expect(section.locator("[data-plan]")).toHaveCount(2);
    await expect(section).toContainText(v.lang === "de" ? "Unsere bisherigen Tarife" : "Our earlier plans");
    await expect(section.locator('[data-plan="first_month_19"]')).toContainText("19");
    await expect(section.locator('[data-plan="first_3mo_27"]')).toContainText("49");
    // No legacy guarantee line on the returning cards.
    await expect(section).not.toContainText("Pass-Until-You-Pass");
    await section.locator('[data-plan="first_month_19"] button').click();
    await expect.poll(() => bodies.length).toBe(1);
    // a-tg-checkout-context (int-8) adds the client context enum to every checkout body.
    expect(bodies[0]).toEqual({ tier: "first_month_19", context: "browser" });
    await noOverflow(page, "/pricing returning");
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/returning-${tag(v)}.png`, fullPage: false });
    expect(errors.filter((e) => !/status of 409/.test(e)), "console errors").toEqual([]);
  });
}

test("not eligible: no returning-payer plans", async ({ page, context }) => {
  const v = VARIANTS[0];
  await page.setViewportSize({ width: v.width, height: v.height });
  await prepare(context, page, v, { signedIn: true, tier: "free" });
  await page.route("**/api/pricing/returning", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ eligible: false, tiers: [] }) }));
  await page.goto("/pricing", { waitUntil: "load" });
  await page.locator("#exam-timing").waitFor({ state: "visible", timeout: 25_000 });
  await expect(page.locator("[data-plan]")).toHaveCount(4);
  await expect(page.locator("[data-returning-plans]")).toHaveCount(0);
});
