import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-checkout-confirm-v2 smoke. Needs a build with PRICING_V2_ENABLED=true and
 * NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED=true (CONFIRM_BUILD=1, also
 * NEXT_PUBLIC_CHECKOUT_BANK_TRANSFER_NOTE=true for the C2 line). With the flag
 * absent (CONFIRM_BUILD unset) the sheet must never open. 375 and 1280 px, DE
 * and EN, light and dark, each v2 plan. The checkout request is captured and
 * answered 409, never sent to Whop. Run it against its own flag-on build; the other release specs click a plan and expect a checkout request at once, so they run against the flag-off build.
 */
const on = process.env.CONFIRM_BUILD === "1";
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/checkout-confirm-v2`;
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const PLANS = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"] as const;

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

for (const v of VARIANTS) for (const plan of PLANS) {
  test(`confirm sheet ${plan} ${on ? "on" : "off"} ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const bodies: unknown[] = [];
    await page.route("**/api/whop/checkout", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PLAN_NOT_READY" }) });
    });
    await page.goto("/pricing", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.locator('#exam-timing input[type="radio"]').first().check();
    const button = page.locator(`[data-plan="${plan}"] button`).first();
    await button.click();
    const sheet = page.getByRole("dialog");
    if (!on) {
      await expect.poll(() => bodies.length).toBe(1);
      await expect(sheet).toHaveCount(0);
      return;
    }
    await expect(sheet).toBeVisible();
    const text = (await sheet.innerText()).replace(/\s+/g, " ");
    // C1: no payment method is named, Whop shows the ones for the buyer's country.
    expect(text).not.toMatch(/Visa|Mastercard|Apple Pay/);
    expect(text).toContain(v.lang === "de" ? "Zahlungsarten, die für Ihr Land verfügbar sind" : "payment methods available in your country");
    if (plan === "flex_month") expect(text).toMatch(v.lang === "de" ? /Nächste Abbuchung am/ : /Next charge on/);
    if (plan === "sitting_pass" || plan === "guarantee_ticket") expect(text).toMatch(v.lang === "de" ? /Zugang bis/ : /Access until/);
    if (plan === "half_year") expect(text).toMatch(v.lang === "de" ? /verlängert sich der Tarif nicht mehr/ : /stops renewing/);
    if (process.env.CONFIRM_BANK_NOTE === "1") await expect(sheet.locator("[data-confirm-bank-transfer]")).toBeVisible();
    else await expect(sheet.locator("[data-confirm-bank-transfer]")).toHaveCount(0);
    expect(bodies.length, "nothing is created before Continue").toBe(0);
    await noOverflow(page, `sheet ${plan}`);
    await page.screenshot({ path: `${dir()}/confirm-${plan}-${tag(v)}.png` });
    // Back closes without a checkout; Continue then creates exactly one.
    await sheet.getByRole("button", { name: v.lang === "de" ? "Zurück zu den Tarifen" : "Back to plans" }).click();
    await expect(sheet).toHaveCount(0);
    expect(bodies.length).toBe(0);
    await button.click();
    await sheet.getByRole("button", { name: v.lang === "de" ? "Weiter zur Zahlung" : "Continue to payment" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect((bodies[0] as { tier: string }).tier).toBe(plan);
    // Event payloads are proved by the unit test (the tracker batches and needs a session).
    expect(errors.filter((e) => !/status of 409/.test(e)), "console errors").toEqual([]);
  });
}
