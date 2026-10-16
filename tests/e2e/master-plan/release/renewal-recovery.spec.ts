import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-renewal-recovery-card smoke: the Home card for a declined renewal shows
 * only when /api/renewal-recovery says eligible, carries the final C5 strings
 * and its button goes to the stored recovery link. Synthetic answers, local
 * server only (release-harness fences it).
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

const LINK = "https://whop.com/checkout/recover/abc123";

async function routes(page: Page, body: unknown) {
  await page.route("**/api/renewal-recovery", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`eligible learner sees the recovery card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await routes(page, { eligible: true, url: LINK, kind: "failed" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("renewal-recovery");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "Ihre letzte Zahlung ist noch offen" : "Your last payment is still open");
    await expect(card).toContainText(v.lang === "de" ? "Zahlung abschließen" : "Complete payment");
    await expect(card.locator(`a[href="${LINK}"]`)).toBeVisible();
    for (const el of await card.locator("a, button").all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/renewal-recovery/recovery-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`not eligible: no card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await routes(page, { eligible: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("renewal-recovery")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
}
