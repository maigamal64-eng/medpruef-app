/**
 * Session-seeding helpers for authenticated-route tests.
 *
 * The production login flow POSTs email/password to `/api/auth`, which
 * returns a session object that the client stores under
 * `medpruef_session` in localStorage. `authFetch` then reads that
 * object to populate the `x-user-id` header on every API call.
 *
 * For tests we bypass the login POST and seed the session object
 * directly. This keeps tests hermetic from bcrypt rounds + prevents
 * rate-limit flakes on the auth endpoint.
 *
 * IMPORTANT: seeded sessions work only for UI assertions. Server-side
 * API calls (e.g. /api/announcements/state) validate the userId
 * against the `users` table via `requireUser`, so the seeded user id
 * must actually exist in the DB. For the announcement-gate test we
 * MOCK the API responses rather than hitting the real DB — see
 * `announcement-gate.spec.ts`.
 */

import type { Page } from "@playwright/test";

export interface SeedSessionInput {
  userId: string;
  email?: string;
  role?: "user" | "admin";
  tier?: "free" | "pro" | "admin";
  firstName?: string;
}

/**
 * Pre-populate localStorage with a fake session row before the first
 * page script runs. Call BEFORE `page.goto`.
 */
export async function seedSession(
  page: Page,
  {
    userId,
    email = "user-26af5ee6@example.com",
    role = "user",
    tier = "free",
    firstName = "Test",
  }: SeedSessionInput,
): Promise<void> {
  // Shape matches `StoredSession` in src/lib/auth.ts. Home page + gate
  // logic read `user.id`, `user.first_name`, and `user.tier` — the
  // rest are filled in to match the type shape so TS-strict client
  // code doesn't throw on missing fields.
  const session = {
    user: {
      id: userId,
      email,
      role,
      tier,
      first_name: firstName,
      xp_total: 0,
      streak_count: 0,
      daily_goal: 20,
    },
    gamification: {
      total_xp: 0,
      current_streak: 0,
      total_questions_answered: 0,
      total_correct: 0,
      daily_questions_today: 0,
    },
  };

  await page.addInitScript((sess) => {
    try {
      localStorage.setItem("medpruef_session", JSON.stringify(sess));
      // Mark onboarding as complete so we don't bounce through the
      // first-run flow.
      localStorage.setItem("medpruef_onboarding", "1");
    } catch {
      /* localStorage may be unavailable */
    }
  }, session);
}

/**
 * Clear any seeded session so a test can assert the unauthenticated
 * path. Useful when one describe block mixes public and authed tests.
 */
export async function clearSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("medpruef_session");
    } catch {
      /* ignore */
    }
  });
}
