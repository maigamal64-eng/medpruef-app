import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-checkout-resume smoke: the Home card for an opened, unpaid checkout shows
 * only when /api/checkout-resume says eligible, names the plan, links back to
 * /pricing with the plan's resume action, offers the cheaper plan when the
 * server names one, and has a support line. Synthetic answers, local server
 * only (release-harness fences it).
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

const FIT = { months: 3, openedTotalCents: 5700, cheaperTier: "first_3mo_27", cheaperTotalCents: 4900 };

async function routes(page: Page, body: unknown) {
  const json = (b: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route("**/api/checkout-resume", (r) => r.fulfill(json(body)));
  await page.route("**/api/whop/checkout/status", (r) => r.fulfill(json({ pending: null })));
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`eligible learner sees the resume card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await routes(page, { eligible: true, tier: "first_month_19", fit: FIT });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("checkout-resume");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "den Tarif Monatsabo" : "the Monthly plan");
    await expect(card).toContainText(v.lang === "de" ? "Stattdessen den Tarif 3 Monate wählen" : "Choose the \"3 months\" plan instead");
    await expect(card.locator('a[href="/pricing?action=first-month-checkout"]')).toBeVisible();
    await expect(card.locator('a[href="/pricing?action=starter-3mo-checkout"]')).toBeVisible();
    await expect(card.locator('a[href^="mailto:"]')).toBeVisible();
    for (const el of await card.locator("a, button").all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/checkout-resume/resume-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`not eligible: no card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await routes(page, { eligible: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("checkout-resume")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
}
