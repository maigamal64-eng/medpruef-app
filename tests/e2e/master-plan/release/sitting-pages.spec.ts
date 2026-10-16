import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-sitting-pages: the per-sitting pages of a local build started with
 * SITTING_PAGES_ENABLED=true (and the feed and public study-plan flags on).
 * Synthetic session, local server only.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const SLUGS = ["sip4a-2027-02-19", "stichprobentest-innsbruck-2027-02-03", "gerichtsmedizin-2027-01-18"];

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  for (const slug of SLUGS) {
    test(`sitting page ${slug} (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: false });
      await page.route("**/api/beacon/landing", (route) => route.fulfill({ status: 204 }));
      await page.goto(`/pruefungskalender/${slug}?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
      const root = page.locator(`[data-sitting-page="${slug}"]`);
      await root.waitFor({ state: "visible", timeout: 25_000 });
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/2027/);
      await expect(root.locator("[data-window-row]").first()).toBeVisible();
      if (slug.startsWith("stichprobentest")) await expect(root.locator("[data-window-row]")).toHaveCount(2);
      await expect(root.locator("[data-sitting-plan]")).toHaveAttribute("href", /\/lernplan\?bank=.+&sitting=2027-/);
      await expect(root.locator("[data-sitting-feed]")).toHaveAttribute("href", new RegExp(`/api/calendar/${slug.split("-")[0]}\\.ics`));
      const official = root.getByRole("link", { name: v.lang === "de" ? "Zur offiziellen Seite" : "Open the official page" }).first();
      await expect(official).toHaveAttribute("href", /^https:\/\//);
      for (const el of await root.locator("a").all()) {
        const b = await el.boundingBox();
        if (b && (await el.isVisible())) expect(b.height, "touch target").toBeGreaterThanOrEqual(24);
      }
      const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
      const events = blocks.filter((b) => b["@type"] === "EducationEvent");
      expect(events).toHaveLength(1);
      const ld = events[0];
      expect(JSON.stringify(ld)).not.toMatch(/organizer|offers/);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical).toBe(`https://medpruf.com/pruefungskalender/${slug}${v.lang === "en" ? "?lang=en" : ""}`);
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", `https://medpruf.com/pruefungskalender/${slug}?lang=en`);
      await expect(page.locator('link[rel="alternate"][hreflang="de"]')).toHaveAttribute("href", `https://medpruf.com/pruefungskalender/${slug}`);
      const m = await measure(page);
      await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/sitting-${slug}-${tag(v)}.png`, fullPage: true });
      expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
      expect(m.fixedInFlow).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("unknown and unconfirmed sittings answer 404", async ({ request }) => {
  expect((await request.get("/pruefungskalender/nope")).status()).toBe(404);
  expect((await request.get("/pruefungskalender/sip4a-2027-03-10")).status()).toBe(404);
});
