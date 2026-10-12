/**
 * Standalone config for the b37 language gate: one Chromium project at 375x812,
 * no web server (BASE_URL must point at a running `next start`).
 * Run: BASE_URL=http://localhost:3137 npx playwright test -c tests/e2e/master-plan/languages/playwright.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../../.artifacts/b37",
  timeout: 60_000,
  // baseline mode writes one file from module state, so it must run in a single worker
  workers: process.env.LANG_GATE_WRITE_BASELINE === "1" ? 1 : 2,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3137",
    ...devices["Desktop Chrome"],
    viewport: { width: 375, height: 812 },
    navigationTimeout: 30_000,
    serviceWorkers: "block",
  },
});
