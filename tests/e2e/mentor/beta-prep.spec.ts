import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";

// Local route fakes only. No flag changes, provider calls or DB writes.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const ADMIN = "00000000-0000-4000-8000-00000000aaaa";
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  return errors;
}

for (const width of [375, 1440]) for (const dark of [false, true]) {
  test(`admin Beta tab enrols and shows usage at ${width}px ${dark ? "dark" : "light"}`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await seedSession(page, { userId: ADMIN, email: "admin-fixture@example.invalid", role: "admin", tier: "admin" });
    await page.addInitScript((dark) => { localStorage.setItem("medpruef_theme", dark ? "dark" : "light"); localStorage.setItem("medpruef_cookies", "declined"); }, dark);
    await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const posts: unknown[] = [];
    let enrolled = false;
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/admin/access/me") return route.fulfill({ json: { actor: { userId: ADMIN, email: null }, roles: [], permissions: ["revenue.read", "revenue.manage", "users.read", "system.read", "system.manage"] } });
      if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: ADMIN, role: "admin", tier: "admin" } } });
      if (path === "/api/mentor/admin/summary") return route.fulfill({ status: 503, json: { error: "ledger_not_applied" } });
      if (path === "/api/mentor/admin/beta/cohort" && route.request().method() === "POST") {
        posts.push(route.request().postDataJSON()); enrolled = true;
        return route.fulfill({ json: { key: "beta-2026-10", credits: 50, results: [{ user_id: A, allowlisted: true, status: "granted" }, { user_id: B, allowlisted: true, status: "already_granted" }] } });
      }
      if (path === "/api/mentor/admin/beta/cohort") return route.fulfill({ json: { key: "beta-2026-10", since: "2026-10-01T00:00:00Z", users: enrolled ? [
        { user_id: A, first_name: "Ana", messages: 12, failures: 1, blocked: 0, credits_used: 9.4, cost_micro: 41000, beta_credits: 50, credits_left: 40.6, last_turn_at: "2026-10-12T09:00:00Z" },
        { user_id: B, first_name: null, messages: 0, failures: 0, blocked: 2, credits_used: 0, cost_micro: 0, beta_credits: 50, credits_left: 50, last_turn_at: null },
      ] : [] } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/admin/mentor?tab=Beta", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Free beta" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Beta", exact: true })).toHaveCount(1);
    await expect(page.getByText("No one is on the beta allowlist yet.")).toBeVisible();
    await page.getByLabel("User ids (one per line, at most 100)").fill(`${A}\n${B}`);
    await page.getByRole("button", { name: "Allowlist and grant" }).click();
    await expect(page.getByLabel("Enrolment results")).toContainText("Allowlisted, credits granted");
    expect(posts).toEqual([{ user_ids: [A, B], credits: 50 }]);
    await expect(page.getByText(/2 beta users · 12 messages · 1 failure ·/)).toBeVisible();
    await expect(page.locator(`a[href="/admin/users/${A}"]`)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/beta-prep/admin-beta-${width}-${dark ? "dark" : "light"}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

for (const lang of ["de", "en"] as const) for (const width of [375, 1440]) for (const dark of [false, true]) {
  test(`facts-only notice for the free taste, ${lang} ${width}px ${dark ? "dark" : "light"}`, async ({ page }) => {
    const errors = consoleErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await seedSession(page, { userId: USER, email: "mentor-fixture@example.invalid", tier: "free" });
    await page.addInitScript(({ lang, dark }) => { localStorage.setItem("medpruef-lang", lang); localStorage.setItem("medpruef_theme", dark ? "dark" : "light"); localStorage.setItem("medpruef_cookies", "declined"); }, { lang, dark });
    await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/mentor/usage") return route.fulfill({ json: { state: "ok", credits_left: 5, messages_left_estimate: 5, next_expiry: "2026-11-11T00:00:00Z", sources: ["trial"], subscriptions: [], can_buy: false } });
      if (path === "/api/mentor/availability") return route.fulfill({ json: { available: true, can_buy: false } });
      if (path === "/api/mentor/chat") return route.fulfill({ status: 402, json: { error: "credits_required", reason: "facts_only", packages_url: "/mentor/packages" } });
      if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "free", email_status: "valid" } } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const box = page.getByRole("textbox").first();
    await box.fill("Explain question 5 please");
    await box.press("Enter");
    const expected = lang === "de" ? "Die Gratis-Credits gelten nur für Fragen zu Fristen und Regeln." : "The free credits cover questions about deadlines and rules only.";
    await expect(page.getByText(expected)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/beta-prep/facts-only-${lang}-${width}-${dark ? "dark" : "light"}.png`, fullPage: false });
    expect(errors).toEqual([]);
  });
}
