import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";

// a16 admin people smoke: mocked APIs with synthetic data, phone and
// desktop, light and dark. Admin is English-only. Screenshots go to
// A16_SHOT_DIR when set.
const permissions = ["overview.read", "users.read", "users.write", "revenue.read", "system.read", "feedback.read", "feedback.manage", "content.read"];
const shotDir = process.env.A16_SHOT_DIR;
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const TWO = "00000000-0000-4000-8000-0000000000b2";
const recent = new Date(Date.now() - 3_600_000).toISOString();
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const userRow = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, telegram_id: null, email: `${name.split(" ")[0].toLowerCase()}@example.invalid`, name, first_name: name, last_name: null, username: null, photo_url: null,
  role: "user", tier: "free", status: "none", created_at: day(-20), xp: 0, streak: 0, questions_answered: 0, accuracy: 0, daily_today: 0, last_study: null, last_active: null, ...over,
});

const detail = {
  profile: {
    id: LEARNER, email: "maximiliane.wanderer-kolb@example.invalid", telegram_id: null, telegram_username: null, first_name: "Maximiliane", last_name: "Wanderer-Kolb",
    name: "Maximiliane Wanderer-Kolb", photo_url: null, role: "user", tier: "pro", is_banned: false, language_code: "de", active_exam: "kenntnispruefung",
    exam_date: day(20).slice(0, 10), daily_goal: 30, referral_code: null, referred_by_code: null, tier_expires_at: day(18), onboarding_completed_at: day(-30),
    created_at: day(-40), updated_at: recent, last_active_date: null,
  },
  access: { state: "pro", endsAt: day(18), source: "subscription", sourceLabel: "Whop, Trial, then monthly, renews", renewal: "auto_renews", grantReason: null, grantAt: null },
  adminHistory: [
    { id: "ops-1", at: recent, actor: "synthetic-owner@example.invalid", action: "ops entitlement.grant approved", summary: "7 days · Goodwill after outage", origin: "ops" },
    { id: "h1", at: day(-2), actor: "synthetic-owner@example.invalid", action: "edit_user", summary: "Changed email", origin: "admin" },
  ],
  adminHistoryTotal: 2,
  adminHistoryOpsAvailable: true,
  gamification: { total_xp: 1200, level: 4, rank_name: "Assistenzarzt", current_streak: 9, longest_streak: 12, total_questions_answered: 1400, total_correct: 1000, daily_questions_today: 0, last_study_date: null },
  stats: { answersLogged: 1400, answersCorrect: 1000, accuracy: 71, totalTimeMs: 3_600_000, avgTimeMs: 2500, xpFromAnswers: 1200, activeDays: 30, firstActivity: day(-35), lastActivity: recent, lastActivityBasis: "Last active is the latest answer, learner event or session start.", currentStreak: 3, longestStreak: 12, answersComplete: true, sessionsCount: 4, notesCount: 0, bookmarksCount: 2, aiChatsCount: 1, searchesCount: 0, pageViewsCount: 10 },
  heatmap: Array.from({ length: 182 }, (_, i) => ({ date: new Date(Date.now() - (181 - i) * 86_400_000).toISOString().slice(0, 10), count: i % 3 })),
  trend: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10), answered: 10, correct: 7 })),
  topics: [{ topic: "Kardiologie", answered: 800, correct: 600, accuracy: 75 }],
  exams: [{ examType: "kenntnispruefung", label: "SIP4a / SIP5a Wien", answered: 1400, correct: 1000 }],
  timeline: [], timelineTotal: 0, answers: [], answersTotal: 1400, sessions: [], notes: [], feedback: [], flags: [],
  money: { isPayer: true, paidByCurrency: { EUR: 1900 }, refundedByCurrency: {}, unpaidInvoiceRows: 1, basis: "Paid counts only subscription rows with a payment reference.", subscriptions: [
    { tier: "notes_pro_trial", status: "active", provider: "whop", method: "card", amountCents: 1900, currency: "EUR", startedAt: day(-12), expiresAt: day(18), createdAt: day(-12), paid: true },
    { tier: "premium_pass_guaranteed", status: "cancelled", provider: "nowpayments", method: "crypto", amountCents: 11400, currency: "EUR", startedAt: null, expiresAt: null, createdAt: day(-90), paid: false },
  ], trial: null, referralsMade: 0, referralsQualified: 0, referredByCode: null },
  restricted_sections: [],
  generatedAt: recent,
};

const auditRows = [
  { id: "a1", actor_email: "synthetic-owner@example.invalid", action: "grant_free_access", target_type: "user", target_id: LEARNER, payload: { reason: "Goodwill after outage", days: 7, new_expiry: day(7) }, created_at: recent, category: "people" },
  { id: "a2", actor_email: "synthetic-owner@example.invalid", action: "revert_question_edit", target_type: "question", target_id: null, payload: { question_id: 812, before: { answer: "A" }, after: { answer: "B" } }, created_at: day(-1), category: "content" },
];

async function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers });
}

async function setup(page: Page, theme: "light" | "dark") {
  await seedSession(page, { userId: "synthetic-admin", role: "admin", tier: "admin" });
  await page.addInitScript((t) => { localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_cookies", "declined"); localStorage.setItem("medpruef_admin_theme", t); }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (p === "/api/admin/inbox") return json(route, { question_reports: 0, note_reports: 0, feedback: 1, generated_at: recent });
    if (p === "/api/admin/audit-log/latest") return json(route, { today_count: 0, last_action_at: null, last_action: null });
    if (p === "/api/stats/admin/users" && url.searchParams.get("view") === "segments") {
      return json(route, { available: true, counts: { learners: 181, never_answered: 60, onboarding_incomplete: 62, no_exam_date: 145, pro_inactive_7d: 3, exam_30d: 12 } });
    }
    if (p === "/api/stats/admin/users") {
      const seg = url.searchParams.get("segment");
      const items = seg === "never_answered"
        ? [userRow(TWO, "Synthetic Two")]
        : [userRow(LEARNER, "Maximiliane Wanderer-Kolb", { tier: "pro", status: "recent", questions_answered: 1400, accuracy: 71, xp: 1200, streak: 3, last_active: recent }), userRow(TWO, "Synthetic Two")];
      return json(route, { items, total: items.length, page: 1, limit: 25, totalPages: 1, activity_basis: "learner" });
    }
    if (p === `/api/stats/admin/users/${LEARNER}`) return json(route, detail);
    if (p === "/api/admin/users/names") {
      const ids = (url.searchParams.get("ids") ?? "").split(",");
      return json(route, { names: Object.fromEntries(ids.map((id) => [id, { label: id === LEARNER ? "Maximiliane Wanderer-Kolb" : "sy…@example.invalid", admin: false }])) });
    }
    if (p === "/api/admin/audit") {
      if (url.searchParams.get("category") === "ops") return json(route, { category: "ops", available: true, items: [{ id: 1, at: recent, event: "action.approved", operation: "entitlement.grant", status: "approved", actor_email: "synthetic-owner@example.invalid", principal: "ops-agent", user_id: LEARNER, feedback_id: null, days: "7", decision: null, reason: "Goodwill after outage" }], total: 1, scanned: 1, next_before: null });
      const cat = url.searchParams.get("category") ?? "all";
      const items = cat === "all" ? auditRows : auditRows.filter((r) => r.category === cat);
      return json(route, { category: cat, available: true, items, total: 308, scanned: 308, next_before: cat === "all" ? auditRows[1].created_at : null });
    }
    if (p === "/api/admin/crons") return json(route, { items: [{ id: "c1", cron_name: "trial-reminder", started_at: recent, finished_at: recent, status: "succeeded", rows_affected: 3, error: null }], total: 640, window_hours: 48 });
    if (p === "/api/feedback") {
      if (url.searchParams.get("summary") === "1") return json(route, { first_reply: { median_hours: null, replied: 0, received: 1, window_days: 30 } });
      return json(route, [{ id: 4, user_id: TWO, message: "The timer keeps running after submit.", context: {}, status: "new", admin_note: null, created_at: recent, first_replied_at: null, sender: { id: TWO, name: null, email: "two@example.invalid", telegram_username: null } }], 200, { "X-Total-Count": "240" });
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
    test.describe(`a16 ${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      let errors: string[] = [];
      test.beforeEach(async ({ page }) => {
        errors = [];
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (err) => errors.push(err.message));
        await setup(page, theme);
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      test("users list: segments with counts, filters in the URL, rows toggle", async ({ page }) => {
        await open(page, "/admin/users");
        const chip = page.getByRole("button", { name: /Never answered/ });
        await expect(chip).toContainText("60");
        await chip.click();
        await expect(page).toHaveURL(/segment=never_answered/);
        await expect(page.getByText("Synthetic Two").locator("visible=true").first()).toBeVisible();
        if (viewport.name === "desktop") {
          await page.getByRole("button", { name: "Show details for Synthetic Two" }).click();
          await expect(page.getByLabel("Details for Synthetic Two", { exact: true })).toBeFocused();
          await page.getByRole("button", { name: "Close details for Synthetic Two" }).click();
          await expect(page.getByLabel("Details for Synthetic Two", { exact: true })).toHaveCount(0);
        } else {
          await expect(page.getByLabel("Sort", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Edit profile" }).first().click();
          await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
        }
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/users-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("learner page: readable header, Access strip, Admin history, tab in the URL", async ({ page }) => {
        await open(page, `/admin/users/${LEARNER}`);
        const heading = page.getByRole("heading", { level: 1 });
        await expect(heading).toHaveText("Maximiliane Wanderer-Kolb");
        const box = await heading.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(120);
        await expect(page.getByTestId("access-strip")).toContainText("Pro until");
        await expect(page.getByTestId("access-strip")).toContainText("Whop, Trial, then monthly, renews");
        await expect(page.getByRole("heading", { name: "Admin history" })).toBeVisible();
        await expect(page.getByText("Showing 2 of 2 recorded actions.")).toBeVisible();
        await page.getByRole("main").getByRole("button", { name: /^Money/ }).click();
        await expect(page).toHaveURL(/tab=money/);
        await expect(page.getByText("No payment reference")).toBeVisible();
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/learner-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("audit: categories, learner links, payload, footer, Ops decisions", async ({ page }) => {
        await open(page, "/admin/audit");
        await expect(page.getByTestId("list-footer")).toHaveText("Showing 2 of 308 audit rows.");
        await expect(page.getByRole("link", { name: "Maximiliane Wanderer-Kolb" }).first()).toHaveAttribute("href", `/admin/users/${LEARNER}`);
        await page.getByRole("button", { name: /Payload/ }).nth(1).click();
        await expect(page.getByText('"answer": "B"').locator("visible=true")).toBeVisible();
        await expect(page.getByRole("button", { name: "Load older rows" })).toBeVisible();
        await page.getByRole("button", { name: "Ops decisions" }).click();
        await expect(page).toHaveURL(/category=ops/);
        await expect(page.getByText("Goodwill after outage").locator("visible=true")).toBeVisible();
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/audit-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("crons and feedback say how many rows exist", async ({ page }) => {
        await open(page, "/admin/crons");
        await expect(page.getByTestId("list-footer")).toContainText("Showing 1 of 640 runs from the last 48 hours.");
        await noOverflow(page);
        await open(page, "/admin/feedback");
        await expect(page.getByTestId("list-footer")).toContainText("Showing 1 of 240 messages in this filter.");
        await expect(page.getByRole("link", { name: "sy…@example.invalid" })).toHaveAttribute("href", `/admin/users/${TWO}`);
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/feedback-${viewport.name}-${theme}.png`, fullPage: true });
      });
    });
  }
}
