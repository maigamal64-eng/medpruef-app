import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";

// n-web-01 web admin phone fixes: Today money strip, Payments cards, Users
// Filters sheet, Questions pager, Note reports targets. Mocked APIs and
// synthetic data at 375px and 1280px, light and dark. Admin is English-only.
// Screenshots go to N_WEB_01_SHOT_DIR when set.
const permissions = ["overview.read", "users.read", "users.write", "revenue.read", "revenue.manage", "system.read", "feedback.read", "content.read", "content.moderate"];
const shotDir = process.env.N_WEB_01_SHOT_DIR;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const recent = day(0);
const LEARNER = "00000000-0000-4000-8000-0000000000b1";

const month = (m: string, paid: number, gross: number) => ({ month: m, paid_payments: paid, gross_cents: gross, refunds: 0, refunds_cents: 0, cash_cents: gross, fees_known_cents: 0, payments_with_fee_known: 0, trial_starts: 1 });
const overview = {
  generated_at: recent,
  day: "2026-10-13",
  tiles: {
    revenue: { today_cents: 0, mtd_cents: 482300, series_7d: [0, 0, 0, 0, 0, 0, 0], today: { gross_cents: 0, refunds_cents: 0, cash_cents: 0 }, month_to_date: { gross_cents: 482300, refunds_cents: 0, cash_cents: 482300 }, other_currencies: [] },
    active_subs: { total: 1234, in_trial: 12, by_cadence: { renews: 4, one_time: 7, unknown: 0 } },
    new_payers_7d: { new_payers: 1, signups: 3, ratio: 0.33 },
    real_signups: { d7: 3, d30: 19 },
    payment_health: { level: "ok", diagnosis: "Payments processing normally.", failures_24h: 0, probes_24h: 0, unresolved_total: 0 },
    signups_today: 1, free_limit_hits_today: 2, feedback_new: 0,
    ai_chat_1h: { requests: 4, completed: 4, failed: 0, avg_latency_ms: 2100 },
    telegram_activation: { registered: 77, confirmed: 30 },
    crons: [], recent_events_aggregate: { total_last_24h: 853 },
  },
  needs: { unresolved: { count: 0, oldest_at: null, currencies: [] }, refunds_7d: { count: 0, by_currency: [] }, ending_7d: { count: 0, soonest_days: null } },
  failed: [] as string[],
};
const payments = {
  generated_at: recent, window_days: 30,
  health: { ...overview.tiles.payment_health, probes_7d: 0, suspected_mismatch_7d: 0, processed_7d: 16, deliveries_7d: 16, unresolved_cents_by_currency: {} },
  money: { currency: "EUR", today: overview.tiles.revenue.today, month_to_date: overview.tiles.revenue.month_to_date, series_7d: [], days_7d: [], months: [month("2026-09", 9, 23100), month("2026-10", 254, 482300)], lifetime_gross_cents: 505400, other_currencies: [], refunds_without_amount: 0, basis: "Cash basis, Vienna days." },
  funnel: [], totals: { checkout_failed: 0, grant_failed: 0, paid_payments: 9, granted_payments: 9 }, failure_reasons: [],
  unresolved: [], resolved_recent: [], resolutions_available: true,
  refunds_90d: { refunds: [], refund_count: 0, dispute_count: 0, amount_by_currency: {}, refunded_access: [] },
  deliveries: { window_days: 30, by_provider: [], recent: [] },
  recent_events: [{ id: 9, event: "webhook_received", provider: "whop", user_id: LEARNER, tier: "first_month_19", payment_id: "pay_synthetic_long_payment_identifier_0001", checkout_session_id: null, reason: null, signature_valid: true, matched: true, amount_cents: 1900, currency: "EUR", whop_event: "payment.succeeded", created_at: recent }],
  recent_events_total: 1,
};
const userRow = (id: string, name: string) => ({ id, telegram_id: null, email: `${name.split(" ")[0].toLowerCase()}@example.invalid`, name, first_name: name, last_name: null, username: null, photo_url: null, role: "user", tier: "free", status: "none", created_at: day(-20), xp: 0, streak: 0, questions_answered: 0, accuracy: 0, daily_today: 0, last_study: null, last_active: null });

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
    if (p === "/api/admin/inbox") return json(route, { feedback: 0, question_reports: 0, note_reports: 1, puyp: 0, ops_actions: null, referral_payouts: 0, referral_rewards: 0, oldest: {}, failed: [], generated_at: recent });
    if (p === "/api/admin/overview") return json(route, overview);
    if (p === "/api/admin/audit-log/latest") return json(route, { today_count: 0, last_action_at: null, last_action: null });
    if (p === "/api/stats/admin/payments") return json(route, payments);
    if (p === "/api/admin/users/names") return json(route, { names: { [LEARNER]: { label: "Maximiliane Wanderer-Kolb", admin: false } } });
    if (p === "/api/stats/admin/users" && url.searchParams.get("view") === "segments") return json(route, { available: true, counts: { learners: 181, never_answered: 60, onboarding_incomplete: 62, no_exam_date: 145, pro_inactive_7d: 3, exam_30d: 12 } });
    if (p === "/api/stats/admin/users") return json(route, { items: [userRow(LEARNER, "Maximiliane Wanderer-Kolb")], total: 1, page: 1, limit: 25, totalPages: 1, activity_basis: "learner" });
    if (p === "/api/stats/admin/questions") {
      const q = (id: number) => ({ id, topic: "Innere Medizin", question: `Synthetic stem ${id}`, answer: "A", explanation: null, ai_explanation: null, exam_type: "kenntnispruefung", is_active: true, choices: null, tags: [], image_url: null, exam_dates: [] });
      return json(route, { totalAll: 200, active: 199, inactive: 1, mcqPct: 97, explPct: 80, imgPct: 9, byTopic: [], questions: [q(1), q(2)], total: 200, totalPages: 9 });
    }
    if (p === "/api/admin/note-reports") return json(route, { reports: [{ id: "r1", note_id: "n1", reason: "pii", detail: "Contains a phone number", status: "open", created_at: recent, notes: { id: "n1", title: "Sepsis bundle", content: { blocks: [{ type: "keyfact", text: "Lactate within 1 h" }] }, visibility: "public", is_active: true, user_id: "00000000-0000-4000-8000-0000000000b3" } }] });
    if (p.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], actions: [], total: 0 });
  });
}

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}
const height = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height);

for (const theme of ["light", "dark"] as const) {
  for (const vp of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }] as const) {
    test.describe(`n-web-01 ${vp.name} ${theme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      test("admin phone fixes", async ({ page }) => {
        const errors: string[] = [];
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
        page.on("pageerror", (e) => errors.push(e.message));
        await setup(page, theme);
        const shot = async (name: string) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${name}-${vp.name}-${theme}.png`, fullPage: true }); };

        // Today: money strip columns
        await page.goto("/admin/overview");
        const strip = page.getByTestId("overview-money-strip");
        await expect(strip).toContainText(/4\.823/);
        const cols = await strip.locator("div.grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
        expect(cols).toBe(vp.width < 400 ? 2 : 3);
        await noOverflow(page);
        await shot("today");

        // Payments: cards below 1024px, table on desktop
        await page.goto("/admin/payments");
        await expect(page.getByTestId("payments-money-table")).toBeVisible();
        const tables = await page.getByTestId("payments-feed-table").locator("table").count();
        expect(tables).toBe(vp.name === "desktop" ? 1 : 0);
        await noOverflow(page);
        await shot("payments");

        // Users: Filters sheet on phones, inline chips on desktop
        await page.goto("/admin/users?auth=email");
        await expect(page.getByText("Maximiliane Wanderer-Kolb").filter({ visible: true }).first()).toBeVisible();
        if (vp.name === "phone") {
          await expect(page.getByTestId("users-filter-controls")).toBeHidden();
          const btn = page.getByTestId("users-filters-button");
          await expect(btn).toBeVisible();
          await expect(page.getByTestId("users-filters-count")).toHaveText("1");
          expect(await height(page, '[data-testid="users-filters-button"]')).toBeGreaterThanOrEqual(44);
          await btn.click();
          await expect(page.getByRole("dialog", { name: "Filters (1 active)" })).toBeVisible();
          await shot("users-sheet");
          await page.getByRole("button", { name: "Show learners" }).click();
          await expect(page.getByRole("dialog")).toBeHidden();
        } else {
          await expect(page.getByTestId("users-filters-button")).toBeHidden();
          await expect(page.getByTestId("users-filter-controls")).toBeVisible();
        }
        await noOverflow(page);
        await shot("users");

        // Questions: Page x of y on phones
        await page.goto("/admin/questions");
        await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
        if (vp.name === "phone") {
          await expect(page.getByTestId("questions-page-of")).toHaveText("Page 1 of 9");
          await expect(page.getByRole("button", { name: "2", exact: true })).toBeHidden();
        } else {
          await expect(page.getByTestId("questions-page-of")).toBeHidden();
          await expect(page.getByRole("button", { name: "2", exact: true })).toBeVisible();
        }
        expect(await page.getByRole("button", { name: "Next" }).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        await noOverflow(page);
        await shot("questions");

        // Note reports: 44px targets
        await page.goto("/admin/note-reports");
        const remove = page.getByRole("button", { name: "Entfernen" });
        await expect(remove).toBeVisible();
        expect(await remove.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        expect(await page.getByRole("button", { name: "Verwerfen" }).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        await noOverflow(page);
        await shot("note-reports");

        expect(errors.filter((e) => !/Failed to load resource|ERR_FAILED|net::/.test(e))).toEqual([]);
      });
    });
  }
}
