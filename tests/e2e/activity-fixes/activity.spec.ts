/**
 * a-activity-fixes smoke: /checkout/success with no payment (issue 7) and the
 * /exam mock-exam gate for free accounts (issue 12), at 375 px and desktop,
 * light and dark, DE and EN. Every API is mocked (no production call). Fails
 * on a console error or horizontal overflow; screenshots go to ACT_SHOTS.
 *   BASE_URL=http://localhost:3131 npx playwright test tests/e2e/activity-fixes --project=Desktop
 */
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";

test.use({ serviceWorkers: "block" });
const SHOTS = process.env.ACT_SHOTS;

type Verify = { granted: false; reason: string; settled?: boolean };

async function mockApis(page: Page, verify: Verify, tracked: string[]) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/track" || path === "/api/funnel-events") { tracked.push(route.request().postData() ?? ""); return route.fulfill({ status: 204 }); }
    if (path === "/api/auth/me") return json({ user: { id: "synthetic-act", email: "act@example.test", role: "user", tier: "free", tier_expires_at: null } });
    if (path === "/api/whop/trial") return json({ eligible: true, trial_enabled: true, is_pro: false, already_trialed: false, trial_days: 7, price_after_cents: 1900, currency: "EUR" });
    if (path === "/api/whop/checkout/status") return json({ pending: null });
    if (path === "/api/whop/checkout/verify") return json(verify);
    if (path === "/api/user/subscription") return json({ active: false, renewal_offer_suppressed: false });
    if (path === "/api/user/exam-preference") return json({ activeExam: "kenntnispruefung" });
    if (path === "/api/questions") return json([]);
    return json({});
  });
}

async function setup(page: Page, w: number, scheme: "light" | "dark", lang: "de" | "en", verify: Verify) {
  await page.setViewportSize({ width: w, height: w < 600 ? 812 : 900 });
  await page.emulateMedia({ colorScheme: scheme });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((l) => {
    try {
      localStorage.setItem("medpruef-lang", l);
      localStorage.setItem("medpruef_cookie_consent", "declined");
      document.cookie = "mp_consent=declined; path=/";
    } catch { /* storage blocked */ }
  }, lang);
  await seedSession(page, { userId: "synthetic-act", email: "act@example.test", tier: "free" });
  const tracked: string[] = [];
  await mockApis(page, verify, tracked);
  return { errors, tracked };
}

async function finish(page: Page, errors: string[], shot: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: false });
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
  const real = errors.filter((e) => !/Failed to load resource|net::ERR|Content Security Policy|clarity|googletagmanager|intercom|telegram/i.test(e));
  expect(real, real.join("\n")).toEqual([]);
}

const T = {
  de: { none: "Keine Zahlung eingegangen", yet: "Noch keine Zahlung eingegangen", retry: "Erneut versuchen", later: "Später", plans: "Tarife ansehen" },
  en: { none: "No payment received", yet: "No payment received yet", retry: "Try again", later: "Later", plans: "See plans" },
};

for (const w of [375, 1280]) for (const scheme of ["light", "dark"] as const) for (const lang of ["de", "en"] as const) {
  test(`checkout success, no payment settled ${w} ${scheme} ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "Desktop", "sets its own viewport; runs once on the Desktop project");
    const { errors } = await setup(page, w, scheme, lang, { granted: false, reason: "payment_not_found", settled: true });
    await page.goto("/checkout/success?tier=first_month_19", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveText(T[lang].none, { timeout: 20_000 });
    await expect(page.getByTestId("checkout-no-payment")).toBeVisible();
    await expect(page.getByTestId("checkout-retry")).toHaveAttribute("href", "/pricing");
    await expect(page.getByTestId("checkout-retry")).toHaveText(T[lang].retry);
    // Never success copy or "Pro appears automatically".
    await expect(page.locator("main")).not.toContainText(lang === "de" ? "Pro-Zugang erscheint" : "Pro access appears");
    await expect(page.locator("main")).not.toContainText(lang === "de" ? "Bitte bezahlen Sie nicht noch einmal" : "Please do not pay again");
    await finish(page, errors, `checkout-none-${w}-${scheme}-${lang}`);
  });

  test(`checkout success, no payment yet ${w} ${scheme} ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "Desktop", "sets its own viewport; runs once on the Desktop project");
    const { errors } = await setup(page, w, scheme, lang, { granted: false, reason: "membership_not_found", settled: false });
    await page.goto("/checkout/success?tier=first_month_19", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveText(T[lang].yet, { timeout: 20_000 });
    await expect(page.getByTestId("checkout-no-payment-yet")).toBeVisible();
    await expect(page.getByTestId("checkout-retry")).toHaveCount(0);
    await finish(page, errors, `checkout-yet-${w}-${scheme}-${lang}`);
  });

  test(`exam gate in place ${w} ${scheme} ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "Desktop", "sets its own viewport; runs once on the Desktop project");
    const { errors } = await setup(page, w, scheme, lang, { granted: false, reason: "payment_not_found" });
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole("link", { name: T[lang].plans })).toHaveAttribute("href", "/pricing?gate=mock_exam");
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/exam");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/exam-gate-dialog-${w}-${scheme}-${lang}.png` });
    await dialog.getByRole("button", { name: T[lang].later }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("exam-pro-gate")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/exam");
    await finish(page, errors, `exam-gate-${w}-${scheme}-${lang}`);
  });
}
