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
  testMatch: ["release-smoke.spec.ts", "narrow-320.spec.ts", "header-overlap.spec.ts", "sw-rsc.spec.ts", "rezgm-pointer.spec.ts", "mentor-open.spec.ts", "mentor-public-copy.spec.ts", "mentor-privacy-only.spec.ts", "mentor-basis-plus.spec.ts", "a-fo-08.spec.ts", "exam-reminder-optin.spec.ts", "referral-surface.spec.ts", "study-plan-public.spec.ts", "free-credit-hooks.spec.ts", "answer-pages.spec.ts", "release-int-2-flags-off.spec.ts", "pricing-v2.spec.ts", "pricing-v2-fit.spec.ts", "winback-note.spec.ts", "trial-claim.spec.ts", "rewards-program.spec.ts", "results-route.spec.ts", "renew-early.spec.ts", "seed-seats.spec.ts", "journey-moments.spec.ts", "activation-48h.spec.ts", "trial-end-card.spec.ts", "checkout-resume.spec.ts", "calendar-feed.spec.ts", "release-int-4-smoke.spec.ts", "sitting-link.spec.ts", "code-front-door.spec.ts", "sitting-pages.spec.ts", "checkout-confirm-v2.spec.ts", "renewal-recovery.spec.ts", "checkout-return-read.spec.ts", "seo-from-gsc.spec.ts", "selftest.spec.ts", "tg-miniapp-welcome.spec.ts", "partner-kit.spec.ts", "cram-part-plan.spec.ts", "cram-card.spec.ts", "email-confirm.spec.ts", "renewal-off.spec.ts", "tg-checkout-context.spec.ts", "trial-phone-gate.spec.ts", "paywall-deadend.spec.ts", "channel-inflow.spec.ts", "quiz-load-honest.spec.ts", "feedback-at-pause.spec.ts", "landing-418.spec.ts", "topic-reset.spec.ts", "marketing-consent.spec.ts", "v2-copy-surfaces.spec.ts", "intercom-n2n3.spec.ts", "card-trial.spec.ts"],
  outputDir: process.env.A35_EVIDENCE_DIR ? `${process.env.A35_EVIDENCE_DIR}/playwright-artifacts` : "../../.artifacts/a35",
  reporter: [["list"], ["json", { outputFile: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/playwright-results.json` }]],
  workers: 3,
  retries: 0,
  timeout: 90_000,
  use: { baseURL, browserName: "chromium", trace: "off", screenshot: "only-on-failure", video: "off", launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined }, navigationTimeout: 30_000, actionTimeout: 10_000 },
});
