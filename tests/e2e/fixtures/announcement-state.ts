/**
 * Mock the /api/announcements/state + /seen endpoints so the gate
 * test can cover every (session_count, qs_answered_total) combo
 * without round-tripping to Supabase. The gate's logic lives in
 * `src/lib/announcements/useAnnouncementGate.ts` and reads from
 * whatever the endpoints return — mocking is the fast + deterministic
 * way to cover every branch in §1.4.2.
 */

import type { Page, Route } from "@playwright/test";

export interface AnnouncementState {
  userId: string;
  sessionCount: number;
  qsAnsweredTotal: number;
  orientationModalSeenAt: string | null;
  cohortBannerDismissedAt: string | null;
  referralFloaterDismissedAt: string | null;
  lastSessionAt: string;
}

export interface MockAnnouncementGateOptions {
  /** Initial state returned by GET /api/announcements/state. */
  state: AnnouncementState;
  /**
   * Callback fired when POST /api/announcements/seen lands. Returns
   * the next state to return to the client (and stash for subsequent
   * GETs).
   */
  onSeen?: (surface: string, prev: AnnouncementState) => AnnouncementState;
}

/**
 * Attach route handlers that mock the announcement-gate endpoints on
 * the given page. Returns the mutable state ref so the test can peek
 * at the running state (e.g. to assert `cohortBannerDismissedAt` is
 * populated after the user dismisses the banner).
 */
export async function mockAnnouncementGate(
  page: Page,
  opts: MockAnnouncementGateOptions,
): Promise<{ current: () => AnnouncementState }> {
  // Hold the state in a closure so successive GETs see the updated
  // timestamps after a POST /seen lands.
  let state = { ...opts.state };

  await page.route("**/api/announcements/state", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state }),
    });
  });

  await page.route("**/api/announcements/seen", async (route: Route) => {
    const req = route.request();
    let surface = "";
    try {
      const body = req.postDataJSON();
      surface = body?.surface ?? "";
    } catch {
      /* ignore */
    }

    const nowIso = new Date().toISOString();
    const next: AnnouncementState = (() => {
      if (opts.onSeen) return opts.onSeen(surface, state);
      if (surface === "orientation_modal") {
        return { ...state, orientationModalSeenAt: nowIso };
      }
      if (surface === "cohort_banner") {
        return { ...state, cohortBannerDismissedAt: nowIso };
      }
      if (surface === "referral_floater") {
        return { ...state, referralFloaterDismissedAt: nowIso };
      }
      return state;
    })();

    state = next;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, state }),
    });
  });

  return { current: () => state };
}

/**
 * Stub the other client APIs the home page hits so a fake session id
 * doesn't cause 401s → login-redirect → test navigates away. These
 * endpoints aren't relevant to the gate tests but the home page will
 * call them on mount.
 */
export async function stubHomePageApis(page: Page): Promise<void> {
  // /api/stats — returns empty stats so the dashboard UI can render.
  await page.route("**/api/stats**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total_questions_answered: 0,
        total_correct: 0,
        current_streak: 0,
        topics: {},
      }),
    });
  });
  // /api/questions — returns empty list so topic cards show zero counts.
  await page.route("**/api/questions**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ questions: [], total: 0 }),
    });
  });
  // /api/user/topic-progress — empty progress.
  await page.route("**/api/user/topic-progress**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ progress: [] }),
    });
  });
  // /api/user/exam-preference — echo success.
  await page.route("**/api/user/exam-preference**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  // /api/track — silently accept events so the tracker doesn't complain.
  await page.route("**/api/track**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

/**
 * Preset states matching the §1.4.2 cadence table. Each preset
 * corresponds to one row of the table so test names can reference
 * them directly.
 */
export const PRESETS = {
  /** Session 1, 0 Qs answered → NOTHING should render. */
  freshFirstTouch: (userId: string): AnnouncementState => ({
    userId,
    sessionCount: 1,
    qsAnsweredTotal: 0,
    orientationModalSeenAt: null,
    cohortBannerDismissedAt: null,
    referralFloaterDismissedAt: null,
    lastSessionAt: new Date().toISOString(),
  }),

  /** Session 1, 5 Qs answered → cohort banner only. */
  session1After5Qs: (userId: string): AnnouncementState => ({
    userId,
    sessionCount: 1,
    qsAnsweredTotal: 5,
    orientationModalSeenAt: null,
    cohortBannerDismissedAt: null,
    referralFloaterDismissedAt: null,
    lastSessionAt: new Date().toISOString(),
  }),

  /** Session 2, orientation not yet seen → orientation modal. */
  session2FirstTime: (userId: string): AnnouncementState => ({
    userId,
    sessionCount: 2,
    qsAnsweredTotal: 6,
    orientationModalSeenAt: null,
    cohortBannerDismissedAt: null,
    referralFloaterDismissedAt: null,
    lastSessionAt: new Date().toISOString(),
  }),

  /**
   * Session 3+, >=25 Qs, orientation seen, cohort dismissed → referral
   * floater eligible. Cooldown window is null since it has never been
   * dismissed.
   */
  eligibleForFloater: (userId: string): AnnouncementState => ({
    userId,
    sessionCount: 3,
    qsAnsweredTotal: 25,
    orientationModalSeenAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    cohortBannerDismissedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    referralFloaterDismissedAt: null,
    lastSessionAt: new Date().toISOString(),
  }),
};
