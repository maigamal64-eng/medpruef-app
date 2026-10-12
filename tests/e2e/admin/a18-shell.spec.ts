import { expect, test, type Page, type Route } from "@playwright/test";

// a18 admin shell smoke: Today, job menu, phone bottom bar, collapsed rail,
// derived freshness and phone cards. Mocked APIs, synthetic data, phone and
// desktop, light and dark. Admin is English-only. Screenshots go to
// A18_SHOT_DIR when set.
const permissions = ["overview.read", "users.read", "revenue.read", "revenue.manage", "system.read", "feedback.read", "content.read", "content.moderate", "access.manage"];
const shotDir = process.env.A18_SHOT_DIR;
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const recent = new Date(Date.now() - 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const overview = {
  generated_at: new Date().toISOString(),
  day: "2026-10-12",
  tiles: {
    revenue: { today_cents: 0, mtd_cents: 1900, series_7d: [0, 0, 1900, 0, 0, 0, 0], today: { gross_cents: 0, refunds_cents: 0, cash_cents: 0 }, month_to_date: { gross_cents: 3800, refunds_cents: 1900, cash_cents: 1900 }, other_currencies: [] },
    active_subs: { total: 11, in_trial: 2, by_cadence: { renews: 4, one_time: 7, unknown: 0 } },
    new_payers_7d: { new_payers: 1, signups: 3, ratio: 0.33 },
    real_signups: { d7: 3, d30: 19 },
    payment_health: { level: "attention", diagnosis: "One paid payment never granted Pro; link it or mark it.", failures_24h: 0, probes_24h: 1, unresolved_total: 1 },
    signups_today: 1,
    free_limit_hits_today: 2,
    feedback_new: 0,
    ai_chat_1h: { requests: 4, completed: 4, failed: 0, avg_latency_ms: 2100 },
    telegram_activation: { registered: 77, confirmed: 30 },
    crons: { "trial-reminder": { lastStatus: "succeeded", lastStartedAt: recent } },
    recent_events_aggregate: { total_last_24h: 853 },
  },
  needs: {
    unresolved: { count: 1, oldest_at: daysAgo(22), currencies: ["USD"] },
    refunds_7d: { count: 1, by_currency: [{ currency: "EUR", cents: 1900 }] },
    ending_7d: { count: 3, soonest_days: 2 },
  },
  failed: [] as string[],
};

const inbox = {
  feedback: 45, question_reports: 0, note_reports: 0, puyp: 0, ops_actions: null, referral_payouts: 0, referral_rewards: 3,
  oldest: { feedback: daysAgo(16), referral_rewards: daysAgo(4) },
  failed: [] as string[],
  generated_at: recent,
};

// String init scripts: Playwright 1.59 on Node 26 serialises transpiled
// function init scripts into code the page cannot parse.
const SEED = `localStorage.setItem("medpruef_session", ${JSON.stringify(JSON.stringify({ user: { id: "synthetic-admin", email: "user-26af5ee6@example.com", role: "admin", tier: "admin", first_name: "Test", xp_total: 0, streak_count: 0, daily_goal: 20 }, gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 } }))}); localStorage.setItem("medpruef_session_token", "local-test-session-token"); localStorage.setItem("medpruef_onboarding", ${JSON.stringify(JSON.stringify({ completedAt: "2026-01-01T00:00:00.000Z", examSource: "kenntnispruefung" }))});`;

async function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers });
}

async function setup(page: Page, theme: "light" | "dark", over: { overview?: unknown; inbox?: unknown; inboxStatus?: number } = {}) {
  await page.addInitScript({ content: SEED });
  await page.addInitScript({ content: `localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_cookies", "declined"); localStorage.setItem("medpruef_admin_theme", ${JSON.stringify(theme)});` });
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (p === "/api/admin/inbox") return json(route, over.inbox ?? inbox, over.inboxStatus ?? 200);
    if (p === "/api/admin/overview") return json(route, over.overview ?? overview);
    if (p === "/api/admin/audit-log/latest") return json(route, { today_count: 2, last_action_at: recent, last_action: "grant_free_access" });
    if (p === "/api/admin/audit") return json(route, { category: "all", available: true, items: [
      { id: "a1", actor_email: "synthetic-owner@example.invalid", action: "grant_free_access", target_type: "user", target_id: LEARNER, payload: { reason: "Goodwill after outage", days: 7 }, created_at: recent, category: "people" },
    ], total: 1, scanned: 1, next_before: null });
    if (p === "/api/admin/users/names") return json(route, { names: { [LEARNER]: { label: "Maximiliane Wanderer-Kolb", admin: false } } });
    if (p === "/api/admin/referrals") return json(route, { items: [
      { id: "r1", referrer_user_id: LEARNER, referee_user_id: null, referral_code: "MAX1", status: "qualified", reward_credit_cents: 4000, reward_type: "cash", qualified_at: daysAgo(20), rewarded_at: null, created_at: daysAgo(30), hold_expires_at: daysAgo(2), hold_reason: null, referrer: { first_name: "Maximiliane", email: "max@example.invalid", payout_method: "wise_account" }, referee: null },
    ] });
    if (p === "/api/admin/referrals/pending-exam-rewards") return json(route, { items: [], card_required: true });
    if (p === "/api/feedback") {
      if (url.searchParams.get("summary") === "1") return json(route, { first_reply: { median_hours: null, replied: 0, received: 1, window_days: 30 } });
      return json(route, [], 200, { "X-Total-Count": "0" });
    }
    if (p.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], actions: [], total: 0 });
  });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`a18 ${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      let errors: string[] = [];
      test.beforeEach(async ({ page }) => {
        errors = [];
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (err) => errors.push(err.message));
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      test("Today: needs-you rows with age, money strip, system line, honest freshness", async ({ page }) => {
        await setup(page, theme);
        await open(page, "/admin/overview");
        await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
        await expect(page).toHaveTitle("Today · MedPrüf Admin");
        const needs = page.getByTestId("overview-needs-you");
        await expect(needs.getByTestId("needs-row-unresolved")).toContainText("Payments that did not grant access");
        await expect(needs.getByTestId("needs-row-feedback")).toContainText("45");
        await expect(needs.getByTestId("needs-row-feedback")).toContainText("oldest waited 16 days");
        await expect(needs.getByTestId("needs-row-ending_7d")).toContainText("soonest in 2 days");
        await expect(needs.getByTestId("needs-row-referral_rewards")).toHaveAttribute("href", "/admin/referrals");
        await expect(needs.getByTestId("needs-row-ops_actions")).toHaveCount(0);
        await expect(needs).toContainText("Nothing waiting in");
        await expect(page.getByTestId("overview-money-strip")).toContainText("11");
        await expect(page.getByTestId("overview-system-line")).toContainText("never granted Pro");
        await expect(page.getByText("Admin action log →")).toBeVisible();
        await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0);
        await expect(page.getByTestId("admin-freshness")).toHaveText("NEAR-LIVE");
        await expect(page.getByTestId("admin-updated-at")).toContainText("Updated");
        await expect(page.getByTestId("admin-topbar-title")).toHaveText("Today");
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/today-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("Today: failed blocks read Could not load and badges read --, never 0", async ({ page }) => {
        await setup(page, theme, { overview: { ...overview, tiles: { ...overview.tiles, revenue: null, active_subs: null, real_signups: null, payment_health: null }, needs: null, failed: ["money"] }, inbox: { error: "boom" }, inboxStatus: 500 });
        await open(page, "/admin/overview");
        await expect(page.getByTestId("overview-money-strip").getByTestId("could-not-load").first()).toBeVisible();
        await expect(page.getByTestId("needs-row-unresolved")).toContainText("Could not load");
        await expect(page.getByTestId("needs-row-feedback")).toContainText("Could not load");
        await expect(page.getByTestId("needs-clear")).toHaveCount(0);
        await expect(page.getByTestId("overview-money-strip")).not.toContainText("€0");
        if (viewport.name === "phone") {
          await expect(page.getByTestId("admin-bottom-bar").getByTestId("admin-inbox-corner-badge")).toHaveText("--");
        } else {
          await expect(page.getByRole("link", { name: /Feedback/ }).getByText("--")).toBeVisible();
        }
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/today-failed-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("menu: job groups, Inbox chips, bottom bar on phones, collapsed rail opens a section", async ({ page }) => {
        await setup(page, theme);
        await open(page, "/admin/overview");
        if (viewport.name === "phone") {
          const bar = page.getByTestId("admin-bottom-bar");
          await expect(bar).toBeVisible();
          for (const label of ["Today", "Inbox", "Find", "Money", "More"]) await expect(bar.getByText(label, { exact: true })).toBeVisible();
          await expect(bar.getByTestId("admin-inbox-corner-badge")).toHaveText("45");
          const box = await bar.getByRole("link", { name: "Today" }).boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
          await bar.getByRole("button", { name: /^Inbox/ }).click();
          const drawer = page.getByRole("dialog", { name: "Admin navigation" });
          await expect(drawer.getByRole("link", { name: /PUYP proofs/ })).toBeVisible();
          await expect(drawer.getByRole("link", { name: /Ops approvals/ })).toBeVisible();
          if (shotDir) await page.screenshot({ path: `${shotDir}/drawer-${viewport.name}-${theme}.png` });
          await page.getByRole("button", { name: "Close admin navigation" }).click();
          await bar.getByRole("button", { name: "Find" }).click();
          await expect(page.locator("#admin-find-learner")).toBeFocused();
        } else {
          await expect(page.getByTestId("admin-bottom-bar")).toHaveCount(0);
          const nav = page.getByRole("navigation", { name: "Admin navigation" });
          for (const label of ["Today", "Inbox", "Learners", "Money", "Content", "Growth", "System"]) await expect(nav.getByText(label, { exact: true }).first()).toBeVisible();
          await expect(nav.getByRole("link", { name: /Feedback/ })).toContainText("45");
          await page.getByRole("button", { name: "Collapse sidebar" }).click();
          await page.getByRole("button", { name: "Money, open menu" }).click();
          await expect(nav.getByRole("link", { name: "Payments" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
        }
        await noOverflow(page);
      });

      test("audit and referrals: phone cards keep Target and Mark paid on screen", async ({ page }) => {
        await setup(page, theme);
        await open(page, "/admin/audit");
        await expect(page).toHaveTitle("Audit log · MedPrüf Admin");
        const audit = page.getByTestId("audit-table");
        if (viewport.name === "phone") {
          const card = audit.getByRole("listitem").first();
          await expect(card.getByText("Target")).toBeVisible();
          await expect(card.getByText("Maximiliane Wanderer-Kolb")).toBeVisible();
          await expect(card.getByRole("button", { name: /Payload/ })).toBeInViewport();
        } else {
          await expect(audit.getByRole("table")).toBeVisible();
        }
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/audit-${viewport.name}-${theme}.png`, fullPage: true });
        await open(page, "/admin/referrals?status=qualified");
        const markPaid = page.getByTestId("referrals-payouts").getByRole("button", { name: "Mark paid" }).locator("visible=true");
        await expect(markPaid).toBeVisible();
        const box = await markPaid.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
        if (viewport.name === "phone") expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/referrals-${viewport.name}-${theme}.png`, fullPage: true });
      });
    });
  }
}

test("leaving the admin restores the app theme for this tab", async ({ page }) => {
  await setup(page, "dark");
  await page.addInitScript({ content: `document.documentElement.setAttribute("data-theme", "light");` });
  await open(page, "/admin/overview");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => sessionStorage.getItem("medpruef_admin_prev_app_theme"))).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem("medpruef_admin_prev_app_theme"))).toBeNull();
});
