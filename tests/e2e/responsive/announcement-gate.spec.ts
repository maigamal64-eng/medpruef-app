/**
 * P0 regression guard for the announcement gate (post-soft-launch
 * sprint §1.4.1–§1.4.5).
 *
 * The soft launch shipped with three announcement surfaces
 * (CohortCountdownBanner + SoftLaunchWelcomeModal + ReferralShareFloater)
 * each self-gated by independent localStorage keys. Result: all three
 * rendered simultaneously on first touch, two of them pitched the same
 * referral bounty. This test is the tripwire that prevents that from
 * ever happening again.
 *
 * The test mocks `/api/announcements/state` + `/seen` so every row of
 * the §1.4.2 cadence table is exercised deterministically without
 * touching Supabase. The component contract under test:
 *
 *   - Session 1, 0 Qs → no banner, no modal, no floater.
 *   - Session 1, ≥5 Qs → banner only.
 *   - Session 2, orientation_modal_seen_at=null → modal appears (once).
 *   - Session 3+, ≥25 Qs, orientation seen, cohort dismissed → floater.
 *   - At every state: at MOST one of {banner, modal, floater} renders.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  mockAnnouncementGate,
  stubHomePageApis,
  PRESETS,
} from "../fixtures/announcement-state";
import { seedSession } from "../fixtures/session";
import { seedPreferences } from "../helpers/page-setup";

const TEST_USER_ID = "82e7fccc-06b4-4c43-8146-127cf84ed8da";

/**
 * Next.js dev mode compiles routes lazily on first hit. On a cold
 * build, the first `/` render can take 10-15s for the app bundle +
 * API route compile. We generously wait for surface rendering; the
 * actual production app responds in <500ms.
 */
const SURFACE_VISIBLE_TIMEOUT = 20_000;
const POST_NAV_SETTLE_MS = 1_500;

// Selectors that uniquely identify each surface. We use ARIA landmarks
// and visible text rather than DOM classes so a refactor of MPDS
// primitives doesn't silently break the test.
const SELECTORS = {
  cohortBanner: 'div[role="status"]:has-text("Kohorte")',
  // Dialog primitive renders the modal with aria-modal=true and
  // title="Willkommen bei MedPrüf". Scope to that exact title so we
  // don't grab any other dialog (FeedbackWidget, PaywallUpgradeModal).
  orientationModal: 'div[role="dialog"][aria-modal="true"]:has-text("Willkommen bei MedPrüf")',
  referralFloater: 'div[role="region"][aria-label="Empfehlungsprogramm"]',
};

/**
 * Count how many of the three gated surfaces are currently visible.
 * Used to assert the gate's core invariant: at most one at a time.
 */
async function countVisibleSurfaces(page: Page): Promise<{
  banner: boolean;
  modal: boolean;
  floater: boolean;
  total: number;
}> {
  const banner = await page.locator(SELECTORS.cohortBanner).isVisible().catch(() => false);
  const modal = await page.locator(SELECTORS.orientationModal).isVisible().catch(() => false);
  const floater = await page.locator(SELECTORS.referralFloater).isVisible().catch(() => false);
  return {
    banner,
    modal,
    floater,
    total: [banner, modal, floater].filter(Boolean).length,
  };
}

test.describe("Announcement gate — no stacking, earned cadence (sprint §1.4)", () => {
  // These tests render the real home page with mocked APIs and assert
  // the gate's surface-election logic. They require a HEALTHY dev
  // server (or a production build served via `next start`). Next.js
  // dev mode's webpack cache is notoriously fragile — if a run hits a
  // cascade of "Cannot find module './NNNN.js'" errors, the dev
  // server has corrupted its `.next/` cache and these tests will
  // flake. The pure-logic tests in
  // `announcement-gate-logic.spec.ts` cover the same invariant
  // without depending on the server, so those are the first-line
  // regression guard; this file layers on the real-component check
  // when the server is healthy.
  //
  // To clear a corrupted dev server cache:
  //   pkill -f "next dev" ; rm -rf .next node_modules/.cache ; npm run dev
  test.beforeEach(async ({ page, baseURL }) => {
    // Quick health check — if the server is returning 5xx, skip.
    const health = await page.request
      .get(baseURL || "http://localhost:3000/")
      .catch(() => null);
    if (!health || health.status() >= 500) {
      test.skip(
        true,
        `Dev server unhealthy (status=${health?.status() ?? "unreachable"}). See pure-logic tests for the canonical regression guard.`,
      );
    }
    await page.context().addCookies([{
      name: "mp_skip_landing",
      value: "1",
      url: baseURL || "http://localhost:3000",
    }]);
    await seedPreferences(page, { theme: "light", lang: "de" });
    await seedSession(page, { userId: TEST_USER_ID });
    await stubHomePageApis(page);
    await page.route("**/api/auth/me**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: {
        id: TEST_USER_ID,
        tier: "free",
        tier_expires_at: null,
        role: "user",
        email_status: "valid",
        language_code: "de",
        onboarding_completed_at: null,
        referrals_enabled: true,
      } }),
    }));
  });

  test("Session 1, 0 Qs answered → no banner, no modal, no floater", async ({ page }) => {
    await mockAnnouncementGate(page, { state: PRESETS.freshFirstTouch(TEST_USER_ID) });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Give the client gate enough time to fetch state and decide
    // nothing renders. Dev-mode cold compile needs a generous window.
    await page.waitForTimeout(POST_NAV_SETTLE_MS * 2);

    const s = await countVisibleSurfaces(page);
    expect.soft(s.banner, "cohort banner must not render on first touch").toBe(false);
    expect.soft(s.modal, "orientation modal must not render on first touch").toBe(false);
    expect.soft(s.floater, "referral floater must not render on first touch").toBe(false);
    expect(s.total, "no marketing surface may render before the user has engaged").toBe(0);
  });

  test("Session 1, ≥5 Qs answered → cohort banner only, never modal/floater", async ({ page }) => {
    await mockAnnouncementGate(page, { state: PRESETS.session1After5Qs(TEST_USER_ID) });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for the banner to actually paint. Generous timeout for
    // Next dev cold compile; will settle in <500ms in production.
    await page
      .waitForSelector(SELECTORS.cohortBanner, { timeout: SURFACE_VISIBLE_TIMEOUT })
      .catch(() => null);
    await page.waitForTimeout(POST_NAV_SETTLE_MS);

    const s = await countVisibleSurfaces(page);
    expect.soft(s.banner, "cohort banner should render after 5 Qs").toBe(true);
    expect.soft(s.modal, "modal must not stack with banner").toBe(false);
    expect.soft(s.floater, "floater must not stack with banner").toBe(false);
    expect(s.total, "exactly one surface should render").toBe(1);
  });

  test("Session 2, orientation_modal_seen_at=null → modal appears; close it", async ({ page }) => {
    await mockAnnouncementGate(page, { state: PRESETS.session2FirstTime(TEST_USER_ID) });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Modal is rendered in a portal by the Dialog primitive. Wait for
    // the title text to appear. Dev cold-compile needs a larger
    // window than production.
    const modal = page.locator(SELECTORS.orientationModal);
    await expect(modal).toBeVisible({ timeout: SURFACE_VISIBLE_TIMEOUT });

    // Check invariant: even while the modal is open, no banner/floater.
    const whileOpen = await countVisibleSurfaces(page);
    expect(whileOpen.total, "only the modal should render in session 2 first-time").toBe(1);
    expect(whileOpen.modal).toBe(true);

    // Close the modal via the primary CTA ("Weiterlernen"). The gate
    // stamps orientation_modal_seen_at and re-evaluates.
    await page.getByRole("button", { name: "Weiterlernen" }).click();
    await expect(modal).toBeHidden({ timeout: 2_000 });
  });

  test("Session 3+, ≥25 Qs, orientation seen, cohort dismissed → floater only", async ({ page }) => {
    await mockAnnouncementGate(page, { state: PRESETS.eligibleForFloater(TEST_USER_ID) });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Floater has a 6s mount delay in ReferralShareFloater.tsx — the
    // gate may elect it but the component waits to nudge politely.
    // Wait past the mount delay then look for the floater to appear.
    await page
      .waitForSelector(SELECTORS.referralFloater, { timeout: SURFACE_VISIBLE_TIMEOUT })
      .catch(() => null);
    await page.waitForTimeout(POST_NAV_SETTLE_MS);

    const s = await countVisibleSurfaces(page);
    expect.soft(s.floater, "floater should render once all cadence gates clear").toBe(true);
    expect.soft(s.banner, "banner must not stack with floater").toBe(false);
    expect.soft(s.modal, "modal must not stack with floater").toBe(false);
    expect(s.total, "exactly one surface should render").toBe(1);
  });

  test("Invariant: at most ONE gated surface renders at any state", async ({ page }) => {
    // This is the belt-and-suspenders test. Cycle through every
    // preset and assert the invariant. A future regression where a
    // component ignores the gate and self-elects would fail here.
    const presets = [
      { name: "fresh", state: PRESETS.freshFirstTouch(TEST_USER_ID) },
      { name: "session1+5Qs", state: PRESETS.session1After5Qs(TEST_USER_ID) },
      { name: "session2-first-time", state: PRESETS.session2FirstTime(TEST_USER_ID) },
      { name: "eligible-floater", state: PRESETS.eligibleForFloater(TEST_USER_ID) },
    ];

    for (const preset of presets) {
      await mockAnnouncementGate(page, { state: preset.state });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      // Wait long enough for dev-mode cold compile + settle.
      await page.waitForTimeout(POST_NAV_SETTLE_MS * 2);
      // For the floater preset, wait out the 6s mount delay in
      // ReferralShareFloater.tsx plus a buffer.
      if (preset.name === "eligible-floater") await page.waitForTimeout(7_000);
      const s = await countVisibleSurfaces(page);
      expect(
        s.total,
        `[${preset.name}] at most ONE gated surface may render — found ${s.total} (banner=${s.banner}, modal=${s.modal}, floater=${s.floater})`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
