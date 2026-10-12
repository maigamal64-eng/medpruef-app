import { expect, test } from "@playwright/test";
import { measure, prepare, tag, trackErrors, visit, type Variant } from "./release-harness";

/**
 * a-narrow-320 guard: the six routes the a35 smoke found wider than a 320 px
 * phone (header controls, filter row, h1, stat tile, select) in every
 * language and theme the smoke only samples once at that width. Same harness,
 * same pass rule: page scroll no wider than the viewport, no fixed element in
 * the page flow, no console error. Run with the release config:
 *   BASE_URL=http://localhost:3135 npx playwright test -c tests/e2e/master-plan/release narrow-320
 */
export const NARROW_ROUTES = ["/kenntnispruefung-wien", "/changelog", "/exam", "/stichprobentest", "/stats", "/curriculum"] as const;
const PUBLIC = new Set<string>(["/kenntnispruefung-wien", "/changelog", "/stichprobentest"]);
const VARIANTS: Variant[] = (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width: 320, height: 568, lang, dark })));

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  for (const route of NARROW_ROUTES) {
    test(`${route} fits a 320 px phone (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block", reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      const isPublic = PUBLIC.has(route);
      await prepare(context, page, v, { signedIn: !isPublic });
      try {
        await visit(page, isPublic ? `${route}?lang=${v.lang}` : route);
        // The route must render its own heading, not only an alert.
        await expect(page.locator("h1").first()).toBeVisible();
        const m = await measure(page);
        expect.soft(m.scrollWidth, `${route} scrollWidth at ${tag(v)}; offenders ${m.offenders.join(" | ")}`).toBeLessThanOrEqual(m.innerWidth + 1);
        expect.soft(m.fixedInFlow, `${route} fixed elements in the page flow at ${tag(v)}`).toEqual([]);
        expect.soft(errors, `${route} console errors at ${tag(v)}`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
