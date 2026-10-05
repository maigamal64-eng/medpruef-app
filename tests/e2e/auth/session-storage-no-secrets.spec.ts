/**
 * Session-storage no-secrets integration test (review-2026-04-25-A1).
 *
 * Loads /admin/overview as a fresh admin session, then reads
 * `localStorage.medpruef_session` and asserts none of the disallowed
 * fields (password_hash, password_salt, password_reset_token,
 * telegram_auth_secret, is_banned, is_locked) leak to the browser.
 *
 * Also verifies that if the test BEGINS with a poisoned session blob —
 * simulating a user whose session was cached before the PR #6
 * sanitization shipped — the read-side sanitizer in `getStoredSession`
 * cleans it on first page load AND writes the cleaned blob back.
 */

import { test, expect } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { seedPreferences } from "../helpers/page-setup";
import { ADMIN_USER_ID } from "../fixtures/users";

const emptyAdminOverview = () => ({
  generated_at: new Date().toISOString(),
  tiles: {
    revenue: { today_cents: 0, mtd_cents: 0, series_7d: [0, 0, 0, 0, 0, 0, 0] },
    active_subs: { total: 0, by_tier: {} },
    signups_today: 0,
    paywall_hits_today: 0,
    referrals_awaiting_action: 0,
    puyp_pending: 0,
    flagged_open: 0,
    webhook_failures_24h: 0,
    stuck_pending_24h: 0,
    conversion_7d: null,
    ai_chat_1h: { requests: 0, completed: 0, failed: 0, avg_latency_ms: null },
    telegram_activation: { registered: 0, confirmed: 0 },
    crons: {},
    recent_events: [],
  },
});

test.describe("session storage never carries secrets", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a freshly seeded admin session has no password_* / role-mutating fields", async ({
    page,
  }) => {
    await seedSession(page, {
      userId: ADMIN_USER_ID,
      role: "admin",
      tier: "admin",
      firstName: "Admin",
    });
    await seedPreferences(page);

    // Stub the admin overview API so the page can hydrate without a DB.
    await page.route("**/api/admin/overview**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyAdminOverview()),
      }),
    );
    await page.route("**/api/admin/audit-log**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      }),
    );

    await page.goto("/admin/overview");

    const blob = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("medpruef_session") || "null"),
    );
    expect(blob).not.toBeNull();
    const json = JSON.stringify(blob);
    expect(json).not.toMatch(/password_/i);
    expect(json).not.toContain("$2a$");
    expect(json).not.toContain("$2b$");
    expect(json).not.toContain("telegram_auth_secret");
    expect(json).not.toContain("telegram_login_token");
  });

  test("a poisoned legacy session is sanitized on first page load", async ({
    page,
  }) => {
    // Inject a session blob shaped like one persisted before PR #6 —
    // password_hash + password_salt embedded in user. The read-side
    // sanitizer must remove them before any application code touches
    // the session.
    await page.addInitScript((adminId) => {
      localStorage.setItem(
        "medpruef_session",
        JSON.stringify({
          user: {
            id: adminId,
            email: "admin@medpruf.com",
            first_name: "Admin",
            role: "admin",
            tier: "admin",
            password_hash: "$2a$10$LeakyPreSanitizationHash/abc123",
            password_salt: "stillsalty",
            password_reset_token: "reset-secret",
            telegram_auth_secret: "bot-hmac-secret",
            is_banned: false,
            is_locked: false,
          },
          gamification: {
            total_xp: 100,
            current_streak: 1,
            total_questions_answered: 10,
            total_correct: 7,
            daily_questions_today: 5,
          },
        }),
      );
    }, ADMIN_USER_ID);
    await seedPreferences(page);

    await page.route("**/api/admin/overview**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyAdminOverview()),
      }),
    );
    await page.route("**/api/admin/audit-log**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      }),
    );

    await page.goto("/admin/overview");
    // Wait for the authenticated shell and the layout's real read-path
    // sanitizer instead of assuming hydration finishes within 200 ms.
    await expect(page.locator('[data-admin="1"]')).toBeVisible();
    await page.waitForFunction(() => {
      const raw = localStorage.getItem("medpruef_session") || "";
      return !/password_|telegram_(auth_secret|login_token)|is_banned|is_locked/i.test(raw);
    });

    const blob = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("medpruef_session") || "null"),
    );
    const json = JSON.stringify(blob);
    expect(json).not.toContain("password_hash");
    expect(json).not.toContain("password_salt");
    expect(json).not.toContain("password_reset_token");
    expect(json).not.toContain("telegram_auth_secret");
    expect(json).not.toContain("$2a$");
    expect(json).not.toContain("is_banned");
    expect(json).not.toContain("is_locked");

    // Public fields preserved.
    expect(blob.user.id).toBe(ADMIN_USER_ID);
    expect(blob.user.email).toBe("admin@medpruf.com");
    expect(blob.user.role).toBe("admin");
  });
});
