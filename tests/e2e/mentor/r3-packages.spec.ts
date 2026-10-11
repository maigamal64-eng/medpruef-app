import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { FIXTURE_PACKAGES } from "../../../src/lib/mentor/fixtures";
import type { MentorUsageResponse } from "../../../src/lib/mentor/contract";

// Local synthetic responses only; run by track-A under with-heavy.sh.
test.use({ browserName: "webkit", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
async function setup(page: Page) {
  await seedSession(page, { userId: USER, email: "mentor-package@example.invalid", tier: "pro" });
  await page.addInitScript(() => { localStorage.setItem("medpruef-lang", "en"); localStorage.setItem("medpruef_cookies", "declined"); });
  const fake = { error: "" as string, purchases: [] as Record<string, unknown>[], hold: false };
  const usage: MentorUsageResponse = { state: "ok", credits_left: 11.8, messages_left_estimate: 11, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: true };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "whop.com") { if (fake.hold) return; return route.abort(); }
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort();
    if (url.pathname === "/api/mentor/usage") return route.fulfill({ json: usage });
    if (url.pathname === "/api/mentor/packages") return route.fulfill({ json: FIXTURE_PACKAGES });
    if (url.pathname === "/api/mentor/checkout") {
      fake.purchases.push(route.request().postDataJSON());
      if (fake.error) return route.fulfill({ status: fake.error === "rate_limited" ? 429 : 503, json: { error: fake.error } });
      return route.fulfill({ json: { purchase_url: "https://whop.com/synthetic-payment", checkout_session_id: "11111111-1111-4111-8111-111111111111" } });
    }
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, tier: "pro", role: "user", email_status: "valid" } } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
    return route.continue();
  });
  return fake;
}

test("MUX-75 both offers end inside 1.3 phone screens, with factual saving and 48px buttons", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  const cards = page.locator("[data-mentor-package-offers] > li");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toContainText("Best price per credit");
  await expect(cards.nth(1)).toContainText("Save 24 percent per credit");
  expect((await cards.nth(1).boundingBox())!.y + (await cards.nth(1).boundingBox())!.height).toBeLessThanOrEqual(844 * 1.3);
  for (const button of await cards.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: "tests/e2e/.artifacts/mentor-r3-packages-390x844.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await cards.nth(0).boundingBox())!.height).toBeCloseTo((await cards.nth(1).boundingBox())!.height, 0);
});

test("MUX-81 persisted pageshow restores purchase buttons and sends one UUID per click", async ({ page }) => {
  const fake = await setup(page); fake.hold = true;
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  const button = page.locator("[data-mentor-package-offers] > li").first().getByRole("button");
  await button.click({ noWaitAfter: true });
  await expect.poll(() => fake.purchases.length).toBe(1);
  await expect(button).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(button).toBeEnabled();
  expect(fake.purchases[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
});

test("MUX-81 after 15 seconds without completed navigation the button returns to idle", async ({ page }) => {
  await page.clock.install();
  const fake = await setup(page); fake.hold = true;
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  const button = page.locator("[data-mentor-package-offers] > li").first().getByRole("button");
  await button.click({ noWaitAfter: true });
  await expect.poll(() => fake.purchases.length).toBe(1);
  await page.clock.runFor(15_001);
  await expect(button).toBeEnabled();
  await expect(page.getByText("The payment page didn't open. Please try again.", { exact: true })).toBeVisible();
});

for (const [error, message] of [["rate_limited", "Please wait a moment"], ["upstream_error", "Payment is unavailable right now, nothing was charged"]]) test(`MUX-81 ${error} is specific and recoverable`, async ({ page }) => {
  const fake = await setup(page); fake.error = error;
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  const button = page.locator("[data-mentor-package-offers] > li").first().getByRole("button");
  await button.click(); await expect(button).toBeEnabled();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});
