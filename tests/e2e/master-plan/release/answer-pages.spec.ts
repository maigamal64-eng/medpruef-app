import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";
import data from "../../../../src/lib/answer-pages/pages.data.json";

/**
 * a-answer-pages smoke. The pages read ANSWER_PAGES_ENABLED per request, so one
 * build serves both states:
 *   ANSWER_PAGES_RUNTIME=on   server started with ANSWER_PAGES_ENABLED=true
 *   ANSWER_PAGES_RUNTIME=off  server started without it (default)
 * Sitemap and llms.txt are built at deploy time; the build used here has the
 * flag off, so they are checked for absence (the on state is a unit test).
 * MENTOR_PUBLIC_COPY_BUILD=1 adds the mentor page (needs that build flag too).
 */

type Page = { id: string; slug: string; bank: string; requires?: string[] };
const PAGES = (data.pages as Page[]);
const mentorOn = process.env.MENTOR_PUBLIC_COPY_BUILD === "1";
const shown = PAGES.filter((p) => !(p.requires ?? []).includes("mentor_public_copy") || mentorOn);
const runtime = process.env.ANSWER_PAGES_RUNTIME ?? "off";
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/answer-pages`;

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

test.describe("flag on", () => {
  test.skip(runtime !== "on", "needs a server started with ANSWER_PAGES_ENABLED=true");
  for (const v of VARIANTS) {
    test(`answer pages render ${tag(v)}`, async ({ page, context }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: v.width, height: v.height });
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: false });
      for (const p of shown) {
        const res = await page.goto(`/blog/${p.slug}${v.lang === "en" ? "?lang=en" : ""}`, { waitUntil: "load" });
        expect(res?.status(), p.slug).toBe(200);
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
        // The exam and its next official sitting lead the page.
        const sections = page.locator("article section");
        await expect(sections.first()).toHaveAttribute("data-answer-lead");
        await expect(page.locator("[data-answer-sitting]").first()).toBeVisible();
        expect(await page.locator("[data-answer-page]").getAttribute("lang")).toBe(v.lang);
        // FAQPage markup matches the visible questions.
        const ld = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map((el) => { try { return JSON.parse(el.textContent ?? ""); } catch { return null; } })
          .find((x) => x && x["@type"] === "FAQPage") ?? {});
        expect(ld["@type"]).toBe("FAQPage");
        const visibleQs = await page.locator("#answer-faq ~ div h3").allTextContents();
        expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(visibleQs);
        // Free sample link keeps the bank and the free intent for a signed-out visitor.
        const href = await page.locator("[data-answer-sample]").getAttribute("href");
        expect(href).toContain("intent=free");
        expect(href).toContain(`exam=${p.bank}`);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        const m = await measure(page);
        expect(m.scrollWidth, `no horizontal page scroll on ${p.slug} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${dir()}/${p.id}-${tag(v)}.png`, fullPage: false });
      }
      // The blog index is static: it lists them only in a build made with the flag on.
      if (process.env.ANSWER_PAGES_BUILD === "1") {
        await page.goto("/blog", { waitUntil: "load" });
        await expect(page.locator("[data-blog-answers] li")).toHaveCount(shown.length);
      }
      expect(errors, "console errors").toEqual([]);
    });
  }
  if (!mentorOn) test("mentor answer page stays 404 without the public mentor copy", async ({ request }) => {
    for (const p of PAGES.filter((x) => (x.requires ?? []).includes("mentor_public_copy"))) {
      expect((await request.get(`/blog/${p.slug}`)).status()).toBe(404);
    }
  });
});

test.describe("flag off", () => {
  test.skip(runtime !== "off", "needs a server started without ANSWER_PAGES_ENABLED");
  test("every answer URL is a 404 and nothing lists one", async ({ request }) => {
    for (const p of PAGES) {
      const res = await request.get(`/blog/${p.slug}`);
      expect(res.status(), p.slug).toBe(404);
      expect(await res.text()).toContain('name="robots" content="noindex');
    }
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const llms = await (await request.get("/llms.txt")).text();
    const blog = await (await request.get("/blog")).text();
    for (const p of PAGES) {
      expect(sitemap).not.toContain(p.slug);
      expect(llms).not.toContain(p.slug);
      expect(blog).not.toContain(p.slug);
    }
    expect(llms).toContain("# MedPrüf: exam prep for the Austrian medical licensing exams");
  });
});
