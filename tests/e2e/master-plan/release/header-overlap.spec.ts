import { expect, test } from "@playwright/test";
import { assertStandIn, headerOverlaps, LEARNER_ROUTES, prepare, PUBLIC_ROUTES, tag, trackErrors, visit, type Variant } from "./release-harness";

/**
 * a-header-375 guard: no two header elements overlap or touch on a phone, on
 * every public and learner route, in DE and EN, light and dark. The release
 * smoke checks 375 px (and its other widths) with the same headerOverlaps();
 * this spec adds 360 and 390 px in every language and theme. Run with the
 * release config:
 *   BASE_URL=http://localhost:3135 A35_STANDIN_URL=http://127.0.0.1:54398 npx playwright test -c tests/e2e/master-plan/release header-overlap
 */
const WIDTHS = (process.env.A35_HEADER_WIDTHS ?? "360,390").split(",").map(Number);
const HEIGHT: Record<number, number> = { 360: 780, 375: 812, 390: 844 };
const VARIANTS: Variant[] = WIDTHS.flatMap((width) => (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: HEIGHT[width] ?? 800, lang, dark }))));

test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => assertStandIn(request));
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  for (const route of [...PUBLIC_ROUTES, ...LEARNER_ROUTES]) {
    test(`${route} header has no overlap (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block", reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      const isPublic = (PUBLIC_ROUTES as readonly string[]).includes(route);
      await prepare(context, page, v, { signedIn: !isPublic });
      try {
        await visit(page, isPublic ? `${route}?lang=${v.lang}` : route);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        expect.soft(await headerOverlaps(page), `${route} header overlaps at ${tag(v)}`).toEqual([]);
        expect.soft(errors, `${route} console errors at ${tag(v)}`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
