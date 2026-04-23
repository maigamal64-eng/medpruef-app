/**
 * Pure-logic regression test for `computeActiveSurface`.
 *
 * The announcement-gate.spec.ts file covers the full end-to-end flow
 * (real page render, real API mock, real components reacting to gate
 * state). This file exercises the decision function directly with
 * synthetic state objects — no browser required, no dev server
 * flakiness. It's the unit-level tripwire that runs fast and catches
 * logic regressions even if the E2E harness is flaky.
 *
 * This proves the §1.4.2 cadence table row-by-row.
 */

import { test, expect } from "@playwright/test";
import {
  computeActiveSurface,
  type AnnouncementState,
} from "../../../src/lib/announcements/useAnnouncementGate";

// All logic tests run in a single project — they don't depend on
// viewport, theme, language, or page state.
test.beforeEach(async ({}, testInfo) => {
  if (testInfo.project.name !== "Desktop") {
    test.skip(true, "Pure-logic tests run on Desktop only — they don't depend on viewport.");
  }
});

const USER_ID = "82e7fccc-06b4-4c43-8146-127cf84ed8da";

function makeState(overrides: Partial<AnnouncementState> = {}): AnnouncementState {
  return {
    userId: USER_ID,
    sessionCount: 1,
    qsAnsweredTotal: 0,
    orientationModalSeenAt: null,
    cohortBannerDismissedAt: null,
    referralFloaterDismissedAt: null,
    lastSessionAt: new Date().toISOString(),
    ...overrides,
  };
}

test.describe("computeActiveSurface — §1.4.2 cadence table", () => {
  test("null state → null (safe default)", () => {
    expect(computeActiveSurface(null)).toBeNull();
  });

  test("Session 1, 0 Qs → null (no pitching on first touch)", () => {
    const result = computeActiveSurface(makeState({ sessionCount: 1, qsAnsweredTotal: 0 }));
    expect(result).toBeNull();
  });

  test("Session 1, 4 Qs → null (still below cohort banner threshold)", () => {
    const result = computeActiveSurface(makeState({ sessionCount: 1, qsAnsweredTotal: 4 }));
    expect(result).toBeNull();
  });

  test("Session 1, 5 Qs → cohort_banner (exactly at threshold)", () => {
    const result = computeActiveSurface(makeState({ sessionCount: 1, qsAnsweredTotal: 5 }));
    expect(result).toBe("cohort_banner");
  });

  test("Session 1, 5 Qs, banner already dismissed → null", () => {
    const result = computeActiveSurface(
      makeState({
        sessionCount: 1,
        qsAnsweredTotal: 5,
        cohortBannerDismissedAt: new Date().toISOString(),
      }),
    );
    expect(result).toBeNull();
  });

  test("Session 2, orientation_modal unseen → orientation_modal", () => {
    const result = computeActiveSurface(
      makeState({ sessionCount: 2, qsAnsweredTotal: 6, orientationModalSeenAt: null }),
    );
    expect(result).toBe("orientation_modal");
  });

  test("Session 2, orientation already seen → cohort_banner (fallback)", () => {
    const result = computeActiveSurface(
      makeState({
        sessionCount: 2,
        qsAnsweredTotal: 6,
        orientationModalSeenAt: new Date().toISOString(),
      }),
    );
    expect(result).toBe("cohort_banner");
  });

  test("Session 3, 25 Qs, orientation seen, cohort dismissed → referral_floater", () => {
    const result = computeActiveSurface(
      makeState({
        sessionCount: 3,
        qsAnsweredTotal: 25,
        orientationModalSeenAt: new Date(Date.now() - 86_400_000).toISOString(),
        cohortBannerDismissedAt: new Date(Date.now() - 43_200_000).toISOString(),
        referralFloaterDismissedAt: null,
      }),
    );
    expect(result).toBe("referral_floater");
  });

  test("Session 3, 25 Qs, floater dismissed within 7d → suppressed (cooldown)", () => {
    const result = computeActiveSurface(
      makeState({
        sessionCount: 3,
        qsAnsweredTotal: 25,
        orientationModalSeenAt: new Date(Date.now() - 86_400_000).toISOString(),
        cohortBannerDismissedAt: new Date(Date.now() - 43_200_000).toISOString(),
        referralFloaterDismissedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      }),
    );
    // Should fall through to banner (dismissed) → null.
    expect(result).toBeNull();
  });

  test("Session 3, 25 Qs, floater dismissed > 7d ago → re-eligible", () => {
    const result = computeActiveSurface(
      makeState({
        sessionCount: 3,
        qsAnsweredTotal: 25,
        orientationModalSeenAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        cohortBannerDismissedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        referralFloaterDismissedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      }),
    );
    expect(result).toBe("referral_floater");
  });

  test("CRITICAL invariant: computeActiveSurface always returns exactly one surface or null", () => {
    // Permute the bounded inputs and assert the return type is always
    // one of the allowed values. Future regression where two surfaces
    // could somehow be returned (e.g. returning an array) would fail.
    const valid = new Set(["cohort_banner", "orientation_modal", "referral_floater", null]);
    for (const sc of [0, 1, 2, 3, 5]) {
      for (const qs of [0, 4, 5, 24, 25, 100]) {
        for (const orient of [null, new Date(0).toISOString()]) {
          for (const cohort of [null, new Date(0).toISOString()]) {
            for (const floater of [null, new Date(0).toISOString(), new Date().toISOString()]) {
              const s = makeState({
                sessionCount: sc,
                qsAnsweredTotal: qs,
                orientationModalSeenAt: orient,
                cohortBannerDismissedAt: cohort,
                referralFloaterDismissedAt: floater,
              });
              const r = computeActiveSurface(s);
              expect(valid.has(r)).toBe(true);
            }
          }
        }
      }
    }
  });
});
