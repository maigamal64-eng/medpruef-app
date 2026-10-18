import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-mentor-public-copy-split smoke: a build with NEXT_PUBLIC_MENTOR_PRIVACY_COPY=true
 * and NEXT_PUBLIC_MENTOR_PUBLIC_COPY unset. /privacy shows the mentor processor row and
 * chat-history block; FAQ, terms and pricing carry no mentor pricing part. Run only
 * against such a build (MENTOR_PRIVACY_ONLY_BUILD=1), local server only.
 */
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/mentor-privacy-only`;

test.skip(process.env.MENTOR_PRIVACY_ONLY_BUILD !== "1", "needs a build with only NEXT_PUBLIC_MENTOR_PRIVACY_COPY=true");
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`privacy on, pricing off ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });

    await page.goto("/privacy", { waitUntil: "load" });
    const privacy = page.locator("[data-mentor-privacy]");
    await expect(privacy).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("Anthropic (KI-Mentor)").first()).toBeVisible();
    expect(await privacy.textContent()).not.toMatch(/€|EUR/);
    await privacy.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/privacy-${tag(v)}.png`, fullPage: false });
    const p = await measure(page);
    expect(p.scrollWidth, `no horizontal page scroll on /privacy ${JSON.stringify(p.offenders)}`).toBeLessThanOrEqual(p.innerWidth);

    await page.goto("/faq", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.locator("[data-mentor-faq]")).toHaveCount(0);

    await page.goto("/terms", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.locator("[data-mentor-terms]")).toHaveCount(0);

    await page.goto("/pricing", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.locator("[data-mentor-included]")).toHaveCount(0);
    await expect(page.locator("[data-mentor-ladder]")).toHaveCount(0);
    const r = await measure(page);
    expect(r.scrollWidth, `no horizontal page scroll on /pricing ${JSON.stringify(r.offenders)}`).toBeLessThanOrEqual(r.innerWidth);

    expect(errors, "console errors").toEqual([]);
  });
}
