/**
 * Playwright config — post-soft-launch sprint §1.1–§1.5.
 *
 * Covers the 8-viewport × 2-theme × 2-language × 25-route matrix the
 * sprint calls for. The full matrix is aspirational this session; the
 * shipped slice walks the high-value combos (public routes at 3
 * viewports × 2 themes, announcement gate regression, a11y on critical
 * paths, Telegram deep-link race).
 *
 * Project names are viewport-keyed so CLI filters like
 * `npx playwright test --project="iPhone SE"` work.
 *
 * Base URL priority:
 *   1. `BASE_URL` env (e.g. Vercel preview URL in CI).
 *   2. `http://localhost:3000` (assumes `npm run dev` is already up —
 *      we intentionally don't auto-start the dev server because
 *      starting it adds 15-20s per CI run and the worker layout makes
 *      that expensive).
 */

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
// Cap workers at 4 to keep a dev laptop usable. On CI, halve again so a
// cold start doesn't starve the test process.
const WORKERS = process.env.CI ? 2 : 4;

export default defineConfig({
  testDir: "./tests/e2e",
  // Suites with their own config and local-only guards (a35).
  testIgnore: ["**/master-plan/release/**", "**/track-b/b30-links-gate-overflow/**"],
  outputDir: "./tests/e2e/.artifacts",

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: WORKERS,
  // Global timeout per test. Responsive sweeps + dev-mode cold
  // compiles can push individual page loads to 10-15s on the first
  // visit. 60s is the ceiling before we call it a hang.
  timeout: 60_000,
  expect: {
    timeout: 5_000,
    // Screenshot diff threshold per §1.1 requirement 5.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  reporter: [
    ["html", { open: "never", outputFolder: "tests/e2e/.report" }],
    ["list"],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    // Bumped to 30s because Next.js dev-mode first compile of a route
    // is slow + the home page includes a Telegram SDK script that
    // blocks `load` until it finishes. Tests should prefer
    // `waitUntil: "domcontentloaded"` per page — but this is the
    // ceiling when they don't specify.
    navigationTimeout: 30_000,
    // Every client API call in this app reads from localStorage and
    // sends an `x-user-id` header. Most of the harness works with
    // storage cleared (unauth/public). Authenticated suites seed
    // storage explicitly; see tests/e2e/fixtures/session.ts.
    storageState: undefined,
  },

  projects: [
    // ── Mobile viewports ────────────────────────────────────────────
    {
      name: "iPhone SE",
      use: {
        ...devices["iPhone SE"],
        viewport: { width: 375, height: 667 },
      },
    },
    {
      name: "iPhone 14",
      use: {
        ...devices["iPhone 13"], // closest Playwright preset
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "iPhone 14 Pro Max",
      use: {
        ...devices["iPhone 13 Pro Max"],
        viewport: { width: 430, height: 932 },
      },
    },
    // ── Tablet viewports ────────────────────────────────────────────
    {
      name: "iPad portrait",
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "iPad landscape",
      use: {
        ...devices["iPad (gen 7) landscape"],
        viewport: { width: 1024, height: 768 },
      },
    },
    // ── Desktop viewports ───────────────────────────────────────────
    {
      name: "Small laptop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: "Desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "Large desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
