import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-winback-credits (J11) smoke: the Home note after paid access ended.
 * Browser /api calls are synthetic (release-harness); /api/mentor/winback
 * answers one live win-back lot (100 credits left, valid to 16 Jan 2027) or
 * {enabled:false}. Covers: the note shows once with the credits and the
 * Vienna date, two links and a hide button; hiding ends it for that lot
 * (also after a reload); with the flag off or the mentor hidden nothing
 * shows. 375 and 1280, DE and EN, light and dark; no horizontal page
 * scroll, no console errors.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const NOTE = { lot_id: "lot_w1", credits: 100, expires_at: "2027-01-16T08:00:00.000Z" };

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

async function mentor(page: Page, availability: "available" | "hidden", winback: unknown) {
  let winbackCalls = 0;
  await page.route("**/api/mentor/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/availability")) return route.fulfill(json(200, availability === "available" ? { available: true, can_buy: true } : { available: false }));
    if (p.endsWith("/winback")) { winbackCalls++; return route.fulfill(json(200, winback)); }
    return route.fulfill(json(200, {}));
  });
  return () => winbackCalls;
}

test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`home win-back note shows once and hides per lot ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentor(page, "available", { enabled: true, note: NOTE });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const note = page.getByTestId("home-winback-note");
    await expect(note).toBeVisible({ timeout: 25_000 });
    await expect(note).toContainText(v.lang === "de" ? "Ihr KI-Mentor bleibt bei Ihnen" : "Your AI Mentor stays with you");
    await expect(note).toContainText("100");
    await expect(note).toContainText(v.lang === "de" ? "16. Jänner 2027" : "16 January 2027");
    await expect(note).not.toContainText("€");
    await expect(note.locator('a[href="/mentor"]')).toBeVisible();
    await expect(note.locator('a[href="/pricing"]')).toBeVisible();
    await note.scrollIntoViewIfNeeded();
    await noOverflow(page, "/ with win-back note");
    await note.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${OUT}/winback-note/home-${tag(v)}.png`, fullPage: false });
    await note.getByRole("button", { name: v.lang === "de" ? "Ausblenden" : "Hide" }).click();
    await expect(note).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("home-winback-note")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`home shows no win-back note with the flag off or the mentor hidden ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentor(page, "available", { enabled: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("home-winback-note")).toHaveCount(0);

    const hidden = await context.newPage();
    await hidden.setViewportSize({ width: v.width, height: v.height });
    const hiddenErrors = trackErrors(hidden);
    await prepare(context, hidden, v, { signedIn: true, tier: "free" });
    const calls = await mentor(hidden, "hidden", { enabled: true, note: NOTE });
    await hidden.goto("/", { waitUntil: "domcontentloaded" });
    await hidden.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await hidden.waitForTimeout(2500);
    await expect(hidden.getByTestId("home-winback-note")).toHaveCount(0);
    expect(calls(), "no win-back read while the mentor is hidden").toBe(0);
    await noOverflow(hidden, "/ without note");
    expect([...errors, ...hiddenErrors], "console errors").toEqual([]);
  });
}
