import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-trial-phone-gate smoke. Home: the "Telegram verbinden" prompt shows only
 * when /api/auth/me reports trial_telegram_link, opens the bot link (captured,
 * never sent to Telegram) and reports the started trial once the status says
 * linked. /pricing (needs the v2 build, PRICING_V2_BUILD=1, see pricing-v2.spec):
 * the visitor tile names the Telegram condition and a signed-in email account
 * gets the link prompt in the trial tile. Synthetic APIs only, local server.
 */
const v2 = process.env.PRICING_V2_BUILD === "1";
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const BOT_URL = "https://t.me/MedPruefBot?start=lk_" + "A".repeat(43);
const ENDS = new Date(Date.now() + 3 * 86_400_000).toISOString();

async function routes(page: Page, prompt: boolean) {
  await page.route("**/api/auth/me*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: USER_ID, tier: "free", tier_expires_at: null, role: "user", email_status: null, language_code: null, onboarding_completed_at: "2026-10-01T00:00:00Z", ...(prompt ? { trial_telegram_link: true } : {}) }, fetched_at: new Date().toISOString() }) }));
  let linked = false;
  await page.route("**/api/telegram/link", (r) => {
    if (r.request().method() === "POST") { linked = true; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: BOT_URL, expires_at: ENDS }) }); }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(linked ? { enabled: true, linked: true, trial: { ends_at: ENDS, started: true } } : { enabled: true, linked: false }) });
  });
  await page.context().route("https://t.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>bot</body></html>" }));
}

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`Home prompt links Telegram and shows the trial ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await routes(page, true);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-telegram-trial-link="trial"]');
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "Telegram verbinden, um Ihre 3 Tage Pro zu starten" : "Link Telegram to start your 3-day trial");
    const button = card.getByRole("button", { name: v.lang === "de" ? "Telegram verbinden" : "Link Telegram" });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    await noOverflow(page, "/ prompt");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/trial-phone-gate/home-prompt-${tag(v)}.png` });
    const popup = page.waitForEvent("popup");
    await button.click();
    const bot = await popup;
    await bot.waitForURL(BOT_URL);
    await bot.close();
    await expect(card).toContainText(v.lang === "de" ? "Ihr Testzugang läuft bis" : "Your trial runs until", { timeout: 15_000 });
    await noOverflow(page, "/ linked");
    await page.screenshot({ path: `${EVIDENCE}/trial-phone-gate/home-linked-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`no prompt without the server's say-so ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await routes(page, false);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    await expect(page.locator("[data-telegram-trial-link]")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`pricing trial tile ${tag(v)}`, async ({ page, context }) => {
    test.skip(!v2, "needs the v2 build with the reverse trial (PRICING_V2_BUILD=1)");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto("/pricing", { waitUntil: "load" });
    const visitor = page.locator('[data-reverse-trial="visitor"]');
    await expect(visitor).toBeVisible({ timeout: 25_000 });
    await expect(visitor).toContainText(v.lang === "de" ? "Neue Konten mit verknüpftem Telegram" : "New accounts with a linked Telegram account");
    await noOverflow(page, "/pricing visitor");
    await page.context().clearCookies();
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await routes(page, true);
    await page.goto("/pricing", { waitUntil: "load" });
    const tile = page.locator('[data-reverse-trial="telegram"]');
    await expect(tile).toBeVisible({ timeout: 25_000 });
    await expect(tile.getByRole("button", { name: v.lang === "de" ? "Telegram verbinden" : "Link Telegram" })).toBeVisible();
    await noOverflow(page, "/pricing signed in");
    await tile.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/trial-phone-gate/pricing-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });
}
