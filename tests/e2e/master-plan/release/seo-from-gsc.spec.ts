import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";
import { ANSWER_EN_SLUGS } from "../../../../src/lib/answer-pages/slugs";

/**
 * a-seo-from-gsc: a local build started with SEO_GSC_COPY_ENABLED=true,
 * ANSWER_PAGES_ENABLED=true and SITTING_PAGES_ENABLED=true. Scope line and
 * link block on the exam pages and landing, titles, canonicals, noindex on
 * app routes and the typo redirect. Local server only.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const PAGES = [
  { path: "/stichprobentest", title: "Stichprobentest Österreich: Übungsfragen | MedPrüf", sittings: /stichprobentest-/ },
  { path: "/kenntnispruefung-wien", title: "SIP4a und SIP5a Wien: Übungsfragen zur Nostrifizierung | MedPrüf", sittings: /sip[45]a-/ },
  { path: "/landing", title: "MedPrüf: Übungsfragen für die Nostrifizierung in Österreich", sittings: /pruefungskalender\// },
];

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  for (const p of PAGES) {
    test(`seo ${p.path} (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: false });
      await page.goto(p.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveTitle(p.title);
      const hub = page.locator("[data-seo-hub]");
      await expect(hub).toBeVisible();
      await expect(hub.getByRole("heading", { level: 2 })).toHaveText(v.lang === "de" ? "Mehr zur Prüfung" : "More about the exam");
      const hrefs = await hub.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      expect(hrefs.some((h) => h.startsWith("/blog/"))).toBe(true);
      expect(hrefs.some((h) => p.sittings.test(h))).toBe(true);
      // a-seo-articles-en-1019 (cd97529a): a guide with its own English URL is linked by that URL (hrefEn), not ?lang=en.
      const englishGuide = (h: string) => Object.values(ANSWER_EN_SLUGS).some((en) => h === `/blog/${en}`);
      if (v.lang === "en") for (const h of hrefs) if (!englishGuide(h)) expect(h).toContain("lang=en");
      const scope = page.locator("[data-seo-scope]");
      await expect(scope).toContainText(v.lang === "de" ? "Nostrifizierung in Österreich" : "nostrification in Austria");
      await expect(scope.getByRole("link")).toHaveAttribute("href", v.lang === "de" ? "/was-ist-was" : "/was-ist-was?lang=en");
      const m = await measure(page);
      await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/seo-${p.path.slice(1)}-${tag(v)}.png`, fullPage: true });
      expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("guidance pages carry their own canonical and registry title", async ({ request }) => {
  const html = await (await request.get("/wien-route/kosten")).text();
  expect(html).toContain('<link rel="canonical" href="https://medpruf.com/wien-route/kosten"/>');
  expect(html).toContain("<title>Kosten richtig einplanen | MedPrüf</title>");
  expect(html).not.toContain('href="https://medpruf.com/landing"/>');
  const en = await (await request.get("/wien-route/kosten?lang=en")).text();
  expect(en).toContain('<link rel="canonical" href="https://medpruf.com/wien-route/kosten?lang=en"/>');
  expect(en).toContain("<title>Plan your costs | MedPrüf</title>");
  const fmt = await (await request.get("/exam-formats/sip4a")).text();
  expect(fmt).toContain('<link rel="canonical" href="https://medpruf.com/exam-formats/sip4a"/>');
});

test("app routes are noindex", async ({ request }) => {
  for (const path of ["/quiz?exam=kenntnispruefung&free=1", "/login?intent=trial", "/study-plan", "/curriculum", "/mistakes", "/history"]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toMatch(/<meta name="robots" content="noindex, nofollow, nocache"\/>/);
  }
  const landing = await (await request.get("/landing")).text();
  expect(landing).not.toMatch(/name="robots" content="noindex/);
});

test("the typo URL redirects once, permanently", async ({ request }) => {
  const res = await request.get("/kenntnispruepruefung-wien", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()["location"]).toMatch(/\/kenntnispruefung-wien$/);
});
