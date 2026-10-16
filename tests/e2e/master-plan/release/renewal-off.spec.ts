import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-whop-cancel-signal smoke: the renewal-off Home card shows only when
 * /api/renewal-off says eligible, carries the Lektor strings with the Vienna
 * access end, links the Whop manage page and shows the plans link only when
 * the server allows it. Synthetic answers, local server only.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

const MANAGE = "https://whop.com/billing/manage/abc123";
const END = "2026-11-03T23:30:00.000Z";

async function routes(page: Page, body: unknown) {
  await page.route("**/api/renewal-off", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`renewal off: card with access end ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await routes(page, { eligible: true, accessEnd: END, manageUrl: MANAGE, pricing: v.width > 400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("renewal-off");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "Ihr Abo verlängert sich nicht mehr" : "Your plan will not renew");
    await expect(card).toContainText(v.lang === "de" ? "bis zum 4. November 2026" : "until 4 November 2026");
    await expect(card.locator(`a[href="${MANAGE}"]`)).toBeVisible();
    await expect(card.locator('a[href="/pricing"]')).toHaveCount(v.width > 400 ? 1 : 0);
    for (const el of await card.locator("a, button").all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/renewal-off/renewal-off-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`not eligible: no card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await routes(page, { eligible: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("renewal-off")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
}
