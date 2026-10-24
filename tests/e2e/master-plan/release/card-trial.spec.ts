import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-card-trial-build-1024 smoke: the checkout entry points of the 3-day card
 * trial. Needs a build with CARD_TRIAL_ENABLED=true and WHOP_PLAN_FLEX_TRIAL
 * set (reverse trial off), CARD_TRIAL_BUILD=1. Landing button (with its terms)
 * to signup with intent=trial, the signup line, the /pricing visitor tile, and
 * the signed-in tile that opens the Whop checkout (captured, never sent to
 * Whop). 375 and 1280 px, DE and EN, light and dark; no console error, no
 * horizontal scroll; the CTA view and tap events reach the funnel endpoint.
 */
const ON = process.env.CARD_TRIAL_BUILD === "1";
const EVIDENCE = `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/card-trial`;
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const CHARGE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const STATUS = { enabled: true, tier: "flex_month_trial", trial_days: 3, price_after_cents: 2400, currency: "EUR", charge_at: CHARGE };
const ELIGIBLE = { eligible: true, trial_enabled: true, is_pro: false, already_trialed: false, refusal: null, tier: "flex_month_trial", trial_days: 3, price_after_cents: 2400, currency: "EUR", charge_at: CHARGE };
const WHOP_URL = "https://whop.com/checkout/plan_card_trial_test/?session=ch_cardtrialtest";
const T = {
  de: { button: "Pro 3 Tage testen", cadence: "alle 30 Tage", terms: "Karte nötig, heute 0 €" },
  en: { button: "Try Pro for 3 days", cadence: "every 30 days", terms: "Card required, 0 € today" },
};

type Funnel = { eventName: string; eventData: Record<string, unknown> };
async function trialRoutes(page: Page) {
  const funnel: Funnel[] = [];
  const checkouts: unknown[] = [];
  await page.route("**/api/trial/status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STATUS) }));
  await page.route("**/api/funnel-events*", async (r) => {
    try { funnel.push(JSON.parse(r.request().postData() ?? "{}") as Funnel); } catch { /* beacon body */ }
    return r.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/whop/trial", (r) => {
    if (r.request().method() === "POST") {
      checkouts.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, purchaseUrl: WHOP_URL, sessionId: "ch_cardtrialtest", planId: "plan_card_trial_test" }) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ELIGIBLE) });
  });
  // Registered on the page after prepare(), so it wins over the harness abort of other origins.
  await page.route("https://whop.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>whop checkout stub</body></html>" }));
  return { funnel, checkouts };
}

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.skip(!ON, "needs the CARD_TRIAL_BUILD=1 build");

for (const v of VARIANTS) {
  test(`landing button and signup lead to the card trial ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const { funnel } = await trialRoutes(page);
    await page.goto("/landing", { waitUntil: "load" });
    const hero = page.locator("section").first();
    const button = hero.getByRole("link", { name: T[v.lang].button });
    await expect(button).toBeVisible({ timeout: 25_000 });
    await expect(hero).toContainText(T[v.lang].terms);
    await expect(hero).toContainText(`24 € ${T[v.lang].cadence}`);
    await noOverflow(page, "/landing");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${EVIDENCE}/landing-${tag(v)}.png` });
    await expect.poll(() => funnel.some((e) => e.eventName === "card_trial_cta_view" && e.eventData.surface === "landing_hero")).toBe(true);
    await button.click();
    await page.waitForURL(/\/login\?.*intent=trial/, { timeout: 25_000 });
    expect(funnel.some((e) => e.eventName === "card_trial_cta_click" && e.eventData.surface === "landing_hero")).toBe(true);
    // The signup screen states the trial, the charge amount and the cadence before any card.
    const main = page.locator("main, body").first();
    await expect(main).toContainText(T[v.lang].button, { timeout: 25_000 });
    await expect(main).toContainText("24 €");
    await expect(main).toContainText(T[v.lang].cadence);
    await noOverflow(page, "/login");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${EVIDENCE}/signup-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`pricing visitor tile names the card trial ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const { funnel } = await trialRoutes(page);
    await page.goto("/pricing", { waitUntil: "load" });
    const tile = page.locator("#pro-test");
    await expect(tile).toContainText(T[v.lang].button, { timeout: 25_000 });
    await expect(tile).toContainText(`24 € ${T[v.lang].cadence}`);
    await expect(page.locator('[data-reverse-trial="visitor"]')).toHaveCount(0);
    await expect.poll(() => funnel.some((e) => e.eventName === "card_trial_cta_view" && e.eventData.surface === "pricing_visitor")).toBe(true);
    await noOverflow(page, "/pricing visitor");
    await tile.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/pricing-visitor-${tag(v)}.png` });
    await tile.getByRole("link", { name: T[v.lang].button }).click();
    await page.waitForURL(/\/login\?.*intent=trial/, { timeout: 25_000 });
    expect(errors, "console errors").toEqual([]);
  });

  test(`signed-in tile opens the Whop card checkout ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const { funnel, checkouts } = await trialRoutes(page);
    await page.goto("/pricing?action=trial&intent=trial#pro-test", { waitUntil: "load" });
    const tile = page.locator("#pro-test");
    const start = tile.getByRole("button", { name: T[v.lang].button });
    await expect(start).toBeVisible({ timeout: 25_000 });
    await expect(tile).toContainText("24 €");
    await expect(tile).toContainText(T[v.lang].cadence);
    await expect(page.locator("[data-telegram-trial-link]")).toHaveCount(0);
    await expect.poll(() => funnel.some((e) => e.eventName === "card_trial_cta_view" && e.eventData.surface === "pricing_tile")).toBe(true);
    await noOverflow(page, "/pricing signed in");
    await tile.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/pricing-tile-${tag(v)}.png` });
    await start.click();
    await page.waitForURL(/whop\.com\/checkout\/plan_card_trial_test/, { timeout: 25_000 });
    expect(checkouts).toHaveLength(1);
    expect(funnel.some((e) => e.eventName === "card_trial_cta_click" && e.eventData.surface === "pricing_tile" && e.eventData.tier === "flex_month_trial")).toBe(true);
    expect(errors, "console errors").toEqual([]);
  });
}
