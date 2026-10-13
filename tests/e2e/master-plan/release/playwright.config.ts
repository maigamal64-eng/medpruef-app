import { defineConfig } from "@playwright/test";

// a35 release smoke. Run against a local production build whose
// NEXT_PUBLIC_SUPABASE_URL points at supabase-stand-in.mjs (see release.md):
//   BASE_URL=http://127.0.0.1:3135 A35_EVIDENCE_DIR=<abs dir> npx playwright test -c tests/e2e/master-plan/release
const baseURL = process.env.BASE_URL;
if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1):31\d\d$/.test(baseURL)) {
  throw new Error("BASE_URL must name a local server on port 3100 to 3199 (never production)");
}
export default defineConfig({
  testDir: ".",
  testMatch: ["release-smoke.spec.ts", "narrow-320.spec.ts", "header-overlap.spec.ts", "sw-rsc.spec.ts"],
  outputDir: process.env.A35_EVIDENCE_DIR ? `${process.env.A35_EVIDENCE_DIR}/playwright-artifacts` : "../../.artifacts/a35",
  reporter: [["list"], ["json", { outputFile: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/playwright-results.json` }]],
  workers: 3,
  retries: 0,
  timeout: 90_000,
  use: { baseURL, browserName: "chromium", trace: "off", screenshot: "only-on-failure", video: "off", navigationTimeout: 30_000, actionTimeout: 10_000 },
});
