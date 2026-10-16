import { expect, test, type Page } from "@playwright/test";
import { measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-reverse-trial-claim smoke. Browser /api calls are synthetic
 * (release-harness), so the server flag does not matter here: the routes
 * answer as with TRIAL_CLAIM_ENABLED on. Covers: the claim page from a mail
 * link (no claim on open, the token leaves the address bar, one POST with
 * the token, success line, no checkout call), an expired link with the
 * signed-in fallback, a refusal (already paid) with the pricing link, the
 * Home card (one POST without a token, success line) and no card while the
 * flag is off. 375 and 1280, DE and EN, light and dark; no horizontal page
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
const END = "2026-11-09T11:00:00.000Z";
// release-int-3 (reviewer P2-2): the Home card asks only on a reverse-trial build
// (NEXT_PUBLIC_REVERSE_TRIAL). Set REVERSE_TRIAL_BUILD=1 when the server under test was built with it.
const reverseTrialBuild = process.env.REVERSE_TRIAL_BUILD === "1";

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.use({ serviceWorkers: "block" });

for (const v of VARIANTS) {
  test(`claim page from the mail link: opening never claims, one POST with the token ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const posts: unknown[] = [];
    let checkout = 0;
    await page.route("**/api/whop/**", (route) => { checkout++; return route.fulfill(json(500, {})); });
    await page.route("**/api/trial/claim**", (route) => {
      if (route.request().method() === "POST") { posts.push(route.request().postDataJSON()); return route.fulfill(json(200, { claimed: true, already: false, ends_at: END, days: 3 })); }
      return route.fulfill(json(200, { enabled: true, eligible: true, reason: "eligible", days: 3, ends_at: null, link: "valid" }));
    });
    await page.goto(`/trial/claim?t=tc1.synthetic.token&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const button = page.getByRole("button", { name: v.lang === "de" ? "3 Tage freischalten" : "Unlock 3 days" });
    await expect(button).toBeVisible({ timeout: 25_000 });
    await expect(page.locator("main")).toContainText(v.lang === "de" ? "keine Karte und kein Abo" : "no card and no subscription");
    expect(page.url()).not.toContain("tc1.");
    expect(posts).toHaveLength(0);
    await noOverflow(page, "/trial/claim");
    await page.screenshot({ path: `${OUT}/trial-claim/page-${tag(v)}.png`, fullPage: true });
    await button.click();
    await expect(page.getByRole("status").filter({ hasText: v.lang === "de" ? "Freigeschaltet" : "Unlocked" })).toBeVisible();
    expect(posts).toEqual([{ token: "tc1.synthetic.token" }]);
    expect(checkout).toBe(0);
    await noOverflow(page, "/trial/claim done");
    await page.screenshot({ path: `${OUT}/trial-claim/page-done-${tag(v)}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });

  test(`expired link: says so and still lets the signed-in account claim without it ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const posts: unknown[] = [];
    await page.route("**/api/trial/claim**", (route) => {
      if (route.request().method() === "POST") { posts.push(route.request().postDataJSON()); return route.fulfill(json(200, { claimed: true, already: false, ends_at: END, days: 3 })); }
      return route.fulfill(json(200, { enabled: true, eligible: true, reason: "eligible", days: 3, ends_at: null, link: "expired" }));
    });
    await page.goto(`/trial/claim?t=tc1.old.token&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toContainText(v.lang === "de" ? "Dieser Link ist abgelaufen." : "This link has expired.", { timeout: 25_000 });
    await page.getByRole("button", { name: v.lang === "de" ? "3 Tage freischalten" : "Unlock 3 days" }).click();
    await expect(page.getByRole("status").filter({ hasText: v.lang === "de" ? "Freigeschaltet" : "Unlocked" })).toBeVisible();
    expect(posts).toEqual([{}]);
    await noOverflow(page, "/trial/claim expired");
    expect(errors, "console errors").toEqual([]);
  });

  test(`a paid account sees why and the pricing link, no button ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/trial/claim**", (route) => route.fulfill(json(200, { enabled: true, eligible: false, reason: "paid", days: 3, ends_at: null, link: "valid" })));
    await page.goto(`/trial/claim?t=tc1.synthetic.token&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('main a[href="/pricing"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("button", { name: v.lang === "de" ? "3 Tage freischalten" : "Unlock 3 days" })).toHaveCount(0);
    await noOverflow(page, "/trial/claim paid");
    await page.screenshot({ path: `${OUT}/trial-claim/page-paid-${tag(v)}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });

  test(`Home card claims with one POST and no token ${tag(v)}`, async ({ page, context }) => {
    test.skip(!reverseTrialBuild, "needs a build with REVERSE_TRIAL_ENABLED and REVERSE_TRIAL_SINCE (REVERSE_TRIAL_BUILD=1)");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const posts: unknown[] = [];
    await page.route("**/api/trial/claim**", (route) => {
      if (route.request().method() === "POST") { posts.push(route.request().postDataJSON()); return route.fulfill(json(200, { claimed: true, already: false, ends_at: END, days: 3 })); }
      return route.fulfill(json(200, { enabled: true, eligible: true, reason: "eligible", days: 3, ends_at: null }));
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-trial-claim-card]");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await card.scrollIntoViewIfNeeded();
    await noOverflow(page, "/ with claim card");
    await card.screenshot({ path: `${OUT}/trial-claim/home-card-${tag(v)}.png` });
    await card.getByRole("button", { name: v.lang === "de" ? "3 Tage freischalten" : "Unlock 3 days" }).click();
    await expect(card.getByRole("status")).toContainText(v.lang === "de" ? "Freigeschaltet" : "Unlocked");
    expect(posts).toEqual([{}]);
    expect(errors, "console errors").toEqual([]);
  });

  test(`no Home card while the claim is off ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    let asked = 0;
    await page.route("**/api/trial/claim**", (route) => { asked++; return route.fulfill(json(200, { enabled: false })); });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForTimeout(2500);
    await expect(page.locator("[data-trial-claim-card]")).toHaveCount(0);
    // Without the reverse-trial build the card sends no request at all.
    if (!reverseTrialBuild) expect(asked, "claim status requests without the reverse trial").toBe(0);
    expect(errors, "console errors").toEqual([]);
  });
}
