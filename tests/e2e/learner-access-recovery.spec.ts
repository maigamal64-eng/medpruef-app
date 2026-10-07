import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "./fixtures/session";

// Isolated fixtures only. Every API is mocked and every external origin is blocked.
test.use({ browserName: "chromium", video: "off", serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await seedSession(page, { userId: "synthetic-access-review", email: "fixture@example.invalid" });
  await page.addInitScript(() => {
    localStorage.setItem("medpruef-lang", "en");
    localStorage.setItem("medpruef_cookies", "declined");
  });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
  });
});

async function capturePurchases(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("medpruef_cookies", "accepted");
    (window as unknown as { purchaseCalls: unknown[]; fbq: (...args: unknown[]) => void }).purchaseCalls = [];
    (window as unknown as { fbq: (...args: unknown[]) => void }).fbq = (...args) => {
      if (args[1] === "Purchase") (window as unknown as { purchaseCalls: unknown[] }).purchaseCalls.push(args);
    };
  });
}
test("pending checkout never claims a received payment and keeps a learning path", async ({ page }) => {
  await page.clock.install();
  await capturePurchases(page);
  let verifyCalls = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/whop/checkout/verify") verifyCalls++;
    const data = path === "/api/auth/me" ? { user: { id: "synthetic-access-review", tier: "pro", tier_expires_at: "2000-01-01T00:00:00Z" } }
      : path === "/api/whop/checkout/verify" ? { granted: false, reason: "entitlement_pending" } : {};
    return route.fulfill({ json: data });
  });
  await page.goto("/checkout/success?tier=first_month_19&paid=1", { waitUntil: "domcontentloaded" });
  // The heading also exists in SSR. Wait for hydration to install its timers.
  await expect.poll(() => verifyCalls).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Zahlung wird geprüft");
  await expect(page.getByRole("link", { name: /weiterlernen/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/erhalten|aktiv/);
  expect(await page.evaluate(() => (window as unknown as { purchaseCalls: unknown[] }).purchaseCalls)).toEqual([]);
  await page.clock.runFor(35_000);
  await expect(page.getByText(/We received your payment/)).toHaveCount(0);
  await page.clock.runFor(35_000);
  await expect(page.getByText("Your payment has not been confirmed yet.", { exact: false })).toBeVisible();
});

test("checkout failure stays pending and a visibility retry confirms successful access", async ({ page }) => {
  await capturePurchases(page);
  let calls = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/whop/checkout/verify") {
      calls++;
      return route.fulfill({ status: calls === 1 ? 503 : 200, json: calls === 1 ? { error: "unavailable" } : { granted: true, payment_ref: "pay_synthetic", amount_cents: 1900 } });
    }
    return route.fulfill({ json: path === "/api/auth/me" ? { user: { id: "synthetic-access-review", tier: "free" } } : {} });
  });
  await page.goto("/checkout/success?tier=first_month_19", { waitUntil: "domcontentloaded" });
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Zahlung wird geprüft");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dein Pro-Zugang ist aktiv");
  expect(calls).toBe(2);
  expect((await page.evaluate(() => (window as unknown as { purchaseCalls: unknown[] }).purchaseCalls)).length).toBe(1);
});

test("an existing non-expiring manual grant remains active on checkout return", async ({ page }) => {
  await capturePurchases(page);
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/auth/me" ? { user: { id: "synthetic-access-review", tier: "pro", tier_expires_at: null } }
      : path === "/api/whop/checkout/verify" ? { granted: true, already: true, tier_expires_at: null } : {} });
  });
  await page.goto("/checkout/success?tier=first_month_19", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dein Pro-Zugang ist aktiv");
  expect(await page.evaluate(() => (window as unknown as { purchaseCalls: unknown[] }).purchaseCalls)).toEqual([]);
});

test("progress failure offers keyboard retry and does not present fabricated coverage", async ({ page }) => {
  let progressCalls = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/user/topic-progress") {
      progressCalls++;
      return route.fulfill({ status: progressCalls === 1 ? 503 : 200, json: progressCalls === 1 ? { error: "temporary" } : [{ topic: "Synthetic topic", total: 42, answered: 7, correct: 5, wrong: 2, accuracy: 71 }] });
    }
    const data = path === "/api/auth/me" ? { user: { id: "synthetic-access-review", tier: "free", role: "user" } }
      : path === "/api/user/exam-preference" ? { activeExam: "kenntnispruefung", examDate: null }
      : path === "/api/user/stats" ? { total: 0, correct: 0, history: [], daily: [], topics: [] }
      : path === "/api/bookmarks" ? { questionIds: [] } : {};
    return route.fulfill({ json: data });
  });
  await page.goto("/progress", { waitUntil: "domcontentloaded" });
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText("Synthetic topic", { exact: true })).toHaveCount(0);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/42 in selected exam/)).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(progressCalls).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("a delayed canonical exam prevents the stale cached exam request from publishing", async ({ page }) => {
  const requested: string[] = [];
  await page.addInitScript(() => localStorage.setItem("medpruef_exam_source", "pharma"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/user/exam-preference") {
      await new Promise(resolve => setTimeout(resolve, 250));
      return route.fulfill({ json: { activeExam: "kenntnispruefung", examDate: null } });
    }
    if (url.pathname === "/api/user/topic-progress") {
      requested.push(url.searchParams.get("examType") ?? "");
      return route.fulfill({ json: [{ topic: "Innere Medizin", total: 42, answered: 7, correct: 5, wrong: 2, accuracy: 71 }] });
    }
    return route.fulfill({ json: url.pathname === "/api/auth/me" ? { user: { id: "synthetic-access-review", tier: "free", role: "user" } }
      : url.pathname === "/api/bookmarks" ? { questionIds: [] } : {} });
  });
  await page.goto("/progress", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/42 in selected exam/)).toBeVisible();
  expect(requested).toEqual(["kenntnispruefung"]);
});
