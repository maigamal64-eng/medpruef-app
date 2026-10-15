import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";
import data from "../../../../src/lib/answer-pages/pages.data.json";

/**
 * a-release-int-2: the integrated train with every new flag off. Run against a
 * server started without STUDY_PLAN_PUBLIC_ENABLED, ANSWER_PAGES_ENABLED,
 * REFERRAL_SURFACE_ENABLED and every MENTOR_* free-credit flag.
 */
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 1280, height: 900, lang: "en", dark: true },
];
const SLUGS = (data.pages as { slug: string }[]).map((p) => p.slug);

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

test("switched-off pages answer a real 404; an ordinary blog post still answers 200", async ({ request }) => {
  for (const path of ["/lernplan", "/lernplan?bank=kmp_innsbruck&hours=8", ...SLUGS.map((s) => `/blog/${s}`)]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
  }
  expect((await request.get("/blog/ukrainische-aerzte-oesterreich-anerkennung")).status()).toBe(200);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/lernplan");
  for (const s of SLUGS) expect(sitemap).not.toContain(s);
});

for (const v of VARIANTS) {
  test(`gratis code page is neutral while codes are off ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const res = await page.goto(`/gratis/TG-SPT${v.lang === "en" ? "?lang=en" : ""}`, { waitUntil: "load" });
    expect(res?.status()).toBeLessThan(400);
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/100 Credits|100 credits/);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const m = await measure(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    expect(m.offenders).toEqual([]);
    expect(m.fixedInFlow).toEqual([]);
    expect(errors).toEqual([]);
  });
}
