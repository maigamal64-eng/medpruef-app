import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";

// a40 browser smoke: revenue next to cost on AI Mentor > Cost (MUX-98, admin is
// English only) and the learner resume date while the breaker rests the mentor
// (MUX-99) at 375 and 1280, light and dark, DE and EN.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const ADMIN = "00000000-0000-4000-8000-00000000aaaa";
const LEARNER = "00000000-0000-4000-8000-00000000a400";
const summary = { generated_at: "2026-10-11T12:00:00Z", month: "2026-10", timezone: "Europe/Vienna", projection: { projected_month_micro: 31000000, cap_in_days: 20 }, spend: { mentor_micro: 10000000, legacy_micro: 0, total_micro: 10000000, cap_micro: 30000000, pct_of_cap: 33.3 }, by_day: Array.from({ length: 11 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, mentor_micro: 1000, calls: 5, house_micro: 0 })), by_model: [], lots_by_package: [], stale_reservations: [], clawbacks: [], top_users: [], overruns: 0, debt_total_micro: 0, state: { ai_features_enabled: false, mentor_enabled: false, packages_enabled: false, topups_enabled: false, db_flag: { enabled: false, env: "all", rollout_pct: 0 }, resting: false, beta_allowlist_size: 0 } };
const revenue = {
  window_days: 30, since: "2026-09-13", basis: "Mentor payments at their gross Whop amount on the Vienna payment day, per currency; refunds and disputes that clawed credits back are subtracted on their own day.",
  by_currency: [{ currency: "EUR", gross_cents: 2470, refunded_cents: 490, net_cents: 1980, payments: 3, refunds: 1 }],
  by_package: [{ package_id: "mentor_basis", currency: "EUR", gross_cents: 980, payments: 2 }, { package_id: "mentor_plus", currency: "EUR", gross_cents: 990, payments: 1 }],
  payments_without_amount: 0, refunds_without_amount: 0, refunds_amount_assumed: 0, plans_configured: 3, cost_micro: 840000, pro_included: { cost_micro: 120000, lots: 4 },
  margin: { available: false, reason: "The Whop fee and the USD to EUR rate are not verified against the Whop account yet. No assumed fee is shown." },
};

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
const unexpected = (errors: string[]) => errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|status of 4\d\d|status of 503/.test(e));

for (const [width, theme] of [[375, "light"], [375, "dark"], [1280, "light"], [1280, "dark"]] as const) {
  test(`MUX-98 revenue tiles on the Cost tab at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = watch(page);
    await seedSession(page, { userId: ADMIN, email: "admin-fixture@example.invalid", role: "admin", tier: "admin" });
    await page.addInitScript(`try{localStorage.setItem("medpruef_theme","${theme}");localStorage.setItem("medpruef_cookies","declined");}catch(e){}`);
    await page.emulateMedia({ colorScheme: theme });
    await page.context().route("**/*", (route) => (["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/admin/access/me") return route.fulfill({ json: { actor: { userId: ADMIN, email: null }, roles: [], permissions: ["revenue.read", "content.read", "system.read", "users.read"] } });
      if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: ADMIN, role: "admin", tier: "admin" } } });
      if (path === "/api/mentor/admin/summary") return route.fulfill({ json: summary });
      if (path === "/api/mentor/admin/revenue") return route.fulfill({ json: revenue });
      return route.fulfill({ json: {} });
    });
    await page.goto("/admin/mentor", { waitUntil: "domcontentloaded" });
    const tiles = page.getByTestId("mentor-revenue");
    await expect(tiles).toBeVisible({ timeout: 30_000 });
    await expect(tiles.getByText("Net revenue (30 d)", { exact: true })).toBeVisible();
    await expect(tiles.getByText("€19.80", { exact: true })).toBeVisible();
    await expect(tiles.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(tiles.getByText(/not verified against the Whop account/)).toBeVisible();
    await expect(tiles.getByText("$0.8400 USD", { exact: true })).toBeVisible();
    await expect(tiles.getByText(/mentor_plus/)).toBeVisible();
    await tiles.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/a40/revenue-${width}-${theme}.png`, fullPage: false });
    expect(unexpected(errors)).toEqual([]);
  });
}

test("MUX-98 revenue before the ledger is installed reads Not installed, never zero", async ({ page }) => {
  await seedSession(page, { userId: ADMIN, email: "admin-fixture@example.invalid", role: "admin", tier: "admin" });
  await page.context().route("**/*", (route) => (["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/access/me") return route.fulfill({ json: { actor: { userId: ADMIN, email: null }, roles: [], permissions: ["revenue.read"] } });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: ADMIN, role: "admin", tier: "admin" } } });
    if (path === "/api/mentor/admin/summary") return route.fulfill({ json: summary });
    if (path === "/api/mentor/admin/revenue") return route.fulfill({ status: 503, json: { error: "ledger_not_applied" } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/admin/mentor", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Revenue: not installed/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mentor-revenue")).toHaveCount(0);
});

const RESUME = { de: "Voraussichtlich wieder ab 1. November 2026.", en: "Expected back from 1 November 2026." } as const;
for (const [width, lang, theme] of [[375, "de", "light"], [375, "en", "dark"], [1280, "en", "light"], [1280, "de", "dark"]] as const) {
  test(`MUX-99 resting learner sees the resume date at ${width}px ${lang} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = watch(page);
    await seedSession(page, { userId: LEARNER, email: "a40-fixture@example.invalid", tier: "pro" });
    await page.addInitScript(`try{localStorage.setItem("medpruef-lang","${lang}");localStorage.setItem("medpruef_theme","${theme}");localStorage.setItem("medpruef_cookies","declined");}catch(e){}`);
    await page.emulateMedia({ colorScheme: theme });
    await page.context().route("**/*", (route) => (["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/mentor/usage") return route.fulfill({ json: { state: "resting", reason: "paused", resting_until: "2026-11-01T00:00:00.000Z", credits_left: 40, admit_min_credits: 4.21, messages_left_estimate: 20, next_expiry: null, sources: ["pro_included"], subscriptions: [], can_buy: false } });
      if (path === "/api/mentor/availability") return route.fulfill({ json: { available: true } });
      if (path === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const line = page.locator("[data-mentor-resting-until]");
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(line).toHaveText(RESUME[lang]);
    const box = await line.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/a40/resting-${width}-${lang}-${theme}.png`, fullPage: false });
    await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(RESUME[lang], { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/a40/resting-packages-${width}-${lang}-${theme}.png`, fullPage: false });
    expect(unexpected(errors)).toEqual([]);
  });
}
