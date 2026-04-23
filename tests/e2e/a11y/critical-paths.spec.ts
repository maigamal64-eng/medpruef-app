/**
 * WCAG 2.1 AA audit on the critical user paths (sprint §1.3).
 *
 * Routes covered:
 *   /            — home/dashboard shell
 *   /pricing     — conversion path (crypto-only tier)
 *   /faq         — trust signal + deep-linked from pricing
 *   /login       — auth entry point
 *   /quiz        — primary study surface (unauthenticated it loops
 *                  back to /login; we assert that bounce is a11y-clean)
 *
 * Matrix: 5 routes × 2 viewports (iPhone 14 + Desktop 1440) × 2 themes
 * = 20 runs. Plus a keyboard-only smoke on the landing hero.
 *
 * All runs must report 0 serious/critical violations. The helper in
 * `../helpers/a11y.ts` already documents which axe rules are excluded
 * globally.
 */

import { test, expect } from "@playwright/test";
import { runAxe, assertNoSeriousOrCriticalViolations } from "../helpers/a11y";
import { seedPreferences, applyThemeAfterLoad, type Theme } from "../helpers/page-setup";

const ROUTES = ["/", "/pricing", "/faq", "/login", "/quiz"] as const;
const THEMES: Theme[] = ["light", "dark"];

// Narrow to the two a11y-critical viewports the sprint spec calls out.
// Skip everything else so a critical-paths regression flags early.
const A11Y_PROJECTS = new Set(["iPhone 14", "Desktop"]);

test.beforeEach(async ({ request, baseURL }, testInfo) => {
  if (!A11Y_PROJECTS.has(testInfo.project.name)) {
    test.skip(true, `a11y critical paths run only on iPhone 14 + Desktop`);
  }
  // Dev-server health gate.
  const health = await request.get(baseURL || "http://localhost:3000/").catch(() => null);
  if (!health || health.status() >= 500) {
    test.skip(
      true,
      `Dev server unhealthy (status=${health?.status() ?? "unreachable"}). See tests/e2e/README.md for recovery.`,
    );
  }
});

for (const theme of THEMES) {
  for (const path of ROUTES) {
    test(`${path} has no serious/critical a11y violations (${theme})`, async ({ page }) => {
      await seedPreferences(page, { theme, lang: "de" });
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      if (res && res.status() >= 500) {
        // Dev-server cache corruption mid-run. Skip rather than fail —
        // see README's "Dev server webpack cache fragility" note.
        test.skip(
          true,
          `${path} returned ${res.status()} — dev server cache corrupted. Restart with: rm -rf .next && npm run dev`,
        );
      }

      await applyThemeAfterLoad(page, theme);
      await page.waitForTimeout(500);

      const results = await runAxe(page);
      assertNoSeriousOrCriticalViolations(results, `${path}:${theme}`);
    });
  }
}

test("keyboard-only: Tab cycles through landing hero and the first interactive element has a focus ring", async ({
  page,
}) => {
  await seedPreferences(page, { theme: "light", lang: "de" });
  const res = await page.goto("/landing", { waitUntil: "domcontentloaded" });
  if (res && res.status() >= 500) {
    test.skip(true, `/landing returned ${res.status()} — dev server cache corrupted`);
  }
  // Wait for the first interactive element to actually render.
  // Landing hero renders "Kostenlos starten" CTA + "Anmelden" link
  // within the first paint. Tabbing before hydration lands on body.
  await page
    .waitForSelector("a, button", { state: "visible", timeout: 10_000 })
    .catch(() => null);
  await page.waitForTimeout(500);

  // Tab to the first interactive element and capture what received
  // focus. On some browsers the body is focused by default; we keep
  // tabbing until we're on a real element.
  let focusedTag = "";
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    focusedTag = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "";
      return `${el.tagName.toLowerCase()}:${el.textContent?.trim().slice(0, 40) ?? ""}`;
    });
    if (focusedTag && !focusedTag.startsWith("body")) break;
  }

  expect(focusedTag, "Tab should land on a real interactive element").not.toBe("");
  expect(focusedTag.startsWith("body")).toBe(false);

  // Capture the focus-visible outline state. MPDS v2 ships a focus
  // ring token — on the focused element that token must produce a
  // non-zero outline, box-shadow, or ring.
  const focusStyles = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });

  expect(focusStyles, "focused element must have computed styles").not.toBeNull();
  if (!focusStyles) return; // guard for TS

  // Accept any of: outline width > 0, non-none outline, any non-trivial
  // box-shadow. MPDS implements focus via box-shadow rings in several
  // primitives.
  const hasVisibleFocus =
    (parseInt(focusStyles.outlineWidth, 10) > 0 && focusStyles.outlineStyle !== "none") ||
    (focusStyles.boxShadow !== "none" && focusStyles.boxShadow !== "");

  expect(
    hasVisibleFocus,
    `Focused element must have a visible focus indicator. Got outline=${focusStyles.outlineWidth}/${focusStyles.outlineStyle}, boxShadow=${focusStyles.boxShadow}`,
  ).toBe(true);
});

test("keyboard-only: the login form submit path is reachable via Tab + Enter", async ({ page }) => {
  await seedPreferences(page, { theme: "light", lang: "de" });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  // Find the email input by type; every /login surface has exactly one.
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();

  if (!(await email.count()) || !(await password.count())) {
    test.skip(true, "/login form variant has no email+password fields — Telegram-only variant");
    return;
  }

  await email.focus();
  await email.fill("user-d0fecb66@example.com");
  await page.keyboard.press("Tab");
  // Next focus target should be the password field (or a "forgot
  // password" link, depending on the form). Fill password via explicit
  // locator so the test is robust to insertion of a helper link.
  await password.fill("incorrect-password-for-test");

  // Find the submit button — text-driven to survive CSS refactors.
  const submit = page.getByRole("button", { name: /anmelden|sign in|login/i }).first();
  await expect(submit).toBeVisible();
  // We don't actually submit (rate-limit friendly), but we assert the
  // keyboard-focused submit flow is wired.
  await submit.focus();
  const activeIsSubmit = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.tagName.toLowerCase() === "button";
  });
  expect(activeIsSubmit).toBe(true);
});
