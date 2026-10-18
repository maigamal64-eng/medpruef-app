import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-channel-inflow: the Fristen channel line on /pruefungskalender and
 * /lernplan. Local build + stand-in only; server started with
 * FRISTEN_CHANNEL_LINK_ENABLED=true and STUDY_PLAN_PUBLIC_ENABLED=true. A
 * second server with the channel flag off (A35_FLAG_OFF_URL, plan flag on)
 * must show no line.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const EVIDENCE = process.env.A35_EVIDENCE_DIR;
const URL_CH = "https://t.me/fristen_nostrifizierung";
const LINE = {
  de: "Neue Prüfungs- und Anmeldetermine aus offiziellen Quellen, immer mit Lesedatum",
  en: "New exam dates and registration deadlines from official sources, always with the date we read them",
};

async function shot(page: Page, name: string) {
  if (!EVIDENCE) return;
  await page.getByTestId("fristen-channel-line").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/channel-inflow/${name}.png` });
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const path of ["/pruefungskalender", "/lernplan"] as const) {
  for (const v of VARIANTS) {
    test(`${path}: channel line and link (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: false });
      await page.goto(`${path}?lang=${v.lang}`, { waitUntil: "networkidle" });
      const line = page.getByTestId("fristen-channel-line");
      await expect(line).toHaveCount(1);
      await expect(line).toBeVisible();
      await expect(line).toContainText(LINE[v.lang]);
      const link = line.getByRole("link");
      await expect(link).toHaveAttribute("href", URL_CH);
      await expect(link).toHaveAttribute("target", "_blank");
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await line.innerText()).not.toMatch(/[–—]/);
      const m = await measure(page);
      expect(m.scrollWidth, m.offenders.join(", ")).toBeLessThanOrEqual(m.innerWidth);
      await shot(page, `${path.slice(1)}-${tag(v)}`);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("flag off: no channel line on either page", async ({ browser }) => {
  const off = process.env.A35_FLAG_OFF_URL;
  test.skip(!off, "A35_FLAG_OFF_URL not set");
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  for (const path of ["/pruefungskalender?lang=de", "/lernplan?lang=de"]) {
    const res = await page.goto(`${off}${path}`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("fristen-channel-line")).toHaveCount(0);
    expect(await page.content()).not.toContain("fristen_nostrifizierung");
  }
  await context.close();
});
