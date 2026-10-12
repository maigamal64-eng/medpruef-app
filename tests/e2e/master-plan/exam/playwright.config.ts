import { defineConfig } from "@playwright/test";

const evidence = process.env.B34_UI_EVIDENCE_DIR;
if (!evidence) throw new Error("Set B34_UI_EVIDENCE_DIR to the package handover directory");
const baseURL = process.env.BASE_URL;
if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1):31\d\d$/.test(baseURL)) {
  throw new Error("BASE_URL must explicitly identify a local track-B server");
}
export default defineConfig({
  testDir: ".",
  testMatch: "exam-run.spec.ts",
  outputDir: `${evidence}/playwright-artifacts`,
  reporter: [["list"], ["json", { outputFile: `${evidence}/playwright-results.json` }]],
  workers: 2,
  retries: 0,
  timeout: 120_000,
  use: { baseURL, browserName: "chromium", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
});
