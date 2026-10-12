import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";

// a14 admin money smoke: mocked APIs with synthetic data, phone and desktop,
// light and dark. Admin is English-only, so there is no DE/EN axis.
// Screenshots go to A14_SHOT_DIR when set.
const permissions = ["overview.read", "users.read", "revenue.read", "revenue.manage", "system.read"];
const shotDir = process.env.A14_SHOT_DIR;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const overview = {
  generated_at: day(0),
  tiles: {
    revenue: { today_cents: 1900, mtd_cents: 1900, series_7d: [0, 0, 1900, 0, -1900, 0, 1900], today: { gross_cents: 1900, refunds_cents: 0, cash_cents: 1900 }, month_to_date: { gross_cents: 3800, refunds_cents: 1900, cash_cents: 1900 }, other_currencies: [{ currency: "USD", paid_payments: 1, gross_cents: 5000, refunds_cents: 0 }] },
    active_subs: { total: 11, in_trial: 1, by_cadence: { renews: 5, one_time: 6, unknown: 0 } },
    signups_today: 3, paywall_hits_today: 4, referrals_awaiting_action: 0, puyp_pending: 1, flagged_open: 2,
    payment_health: { level: "attention", diagnosis: "1 paid payment never granted Pro (USD 50.00). Resolve it in Unresolved payments. 3 unsigned probes rejected in 7 days (normal internet noise, no action).", failures_24h: 0, probes_24h: 1, unresolved_total: 1 },
    stuck_pending_24h: 9,
    new_payers_7d: { new_payers: 2, signups: 14, ratio: 0.14 },
    ai_chat_1h: { requests: 0, completed: 0, failed: 0, avg_latency_ms: null },
    telegram_activation: { registered: 10, confirmed: 4 }, crons: {}, recent_events: null, recent_events_aggregate: { total_last_24h: 120 },
  },
  restricted_sections: [],
};

const month = (m: string, paid: number, gross: number, refunds = 0, fees = 0, feeN = 0, trials = 0) => ({ month: m, paid_payments: paid, trial_starts: trials, gross_cents: gross, fees_known_cents: fees, payments_with_fee_known: feeN, refunds_cents: refunds, refunds: refunds ? 1 : 0, cash_cents: gross - refunds });
const payments = {
  generated_at: day(0),
  window_days: 30,
  health: { ...overview.tiles.payment_health, probes_7d: 3, suspected_mismatch_7d: 0, processed_7d: 16, deliveries_7d: 19, unresolved_cents_by_currency: { USD: 5000 } },
  money: {
    currency: "EUR", today: overview.tiles.revenue.today, month_to_date: overview.tiles.revenue.month_to_date, series_7d: overview.tiles.revenue.series_7d, days_7d: [],
    months: [month("2026-05", 0, 0), month("2026-06", 0, 0), month("2026-07", 2, 9800, 0, 0, 0, 2), month("2026-08", 4, 7600, 0, 0, 0, 1), month("2026-09", 9, 23100, 0, 437, 3, 5), month("2026-10", 2, 3800, 1900, 256, 2, 1)],
    lifetime_gross_cents: 44300, other_currencies: [{ currency: "USD", paid_payments: 1, gross_cents: 5000, refunds_cents: 0 }], refunds_without_amount: 0,
    basis: "Cash basis: paid payments by payment date at the gross charge, refunds subtracted on the day they happened, Vienna calendar days.",
  },
  funnel: [
    { key: "checkout_session_created", label: "Checkout started", count: 26, rows: 28, hint: "15 distinct buyers" },
    { key: "checkout_redirected", label: "Redirected to pay", count: 26, rows: 28, hint: "distinct checkout sessions" },
    { key: "payment_received", label: "Paid", count: 9, rows: 9, hint: "distinct paid payments" },
    { key: "grant_succeeded", label: "Pro granted", count: 8, rows: 8, hint: "paid payments that granted" },
  ],
  totals: { checkout_failed: 10, grant_failed: 2, paid_payments: 9, granted_payments: 8 },
  failure_reasons: [{ reason: "provider_error", count: 10 }, { reason: "unmapped", count: 2 }],
  unresolved: [{ payment_id: "pay_synthetic_usd50_payment_id", provider: "whop", currency: "USD", gross_cents: 5000, net_cents: null, paid_at: "2026-09-20T11:27:00Z", last_seen_at: "2026-09-20T11:27:31Z", plan_id: "plan_synthetic_other", failure_reasons: ["unmapped"], learner: null, linkable_tier: null, linkable_months: null, age_days: 22 }],
  resolved_recent: [],
  resolutions_available: true,
  refunds_90d: {
    refunds: [{ refund_id: "r_synthetic_1", kind: "refund", currency: "EUR", amount_cents: 1900, refunded_at: "2026-10-10T12:00:00Z" }], refund_count: 1, dispute_count: 0, amount_by_currency: { EUR: 1900 },
    refunded_access: [{ subscription_id: "s1", learner: { id: "synthetic-learner", label: "Synthetic Learner (synthetic@example.invalid)", staff_or_test: true }, tier: "first_month_19", refunded_at: "2026-10-10T12:00:00Z", access_now: "Pro until 2026-10-17" }],
  },
  deliveries: {
    window_days: 30,
    by_provider: [{ provider: "whop", result: "dup", rows: 22, distinct_events: 8 }, { provider: "whop", result: "processed", rows: 16, distinct_events: 16 }, { provider: "whop", result: "sig_invalid", rows: 3, distinct_events: 0 }],
    recent: [{ id: "d1", provider: "whop", result: "sig_invalid", signature_valid: false, event_id: null, error: "no recognized auth header", received_at: day(-1), kind: "probe" }, { id: "d2", provider: "whop", result: "processed", signature_valid: true, event_id: "pay_synthetic_processed", error: null, received_at: day(-2), kind: "processed" }],
  },
  recent_events: [{ id: 9, event: "grant_succeeded", provider: "whop", user_id: "synthetic-learner", tier: "first_month_19", payment_id: "pay_synthetic_processed", checkout_session_id: null, reason: null, signature_valid: null, matched: true, amount_cents: 1900, currency: "EUR", whop_event: null, created_at: day(-2) }],
};

const rosterRow = (n: number, cadence: string, days: number, status = "paying") => ({ user_id: `00000000-0000-4000-8000-00000000000${n}`, label: `Synthetic Learner ${n} (learner${n}@example.invalid)`, status, plan: cadence === "auto_renews" ? "Trial, then monthly" : "1 month", tier: "first_month_19", cadence, paid_to_date_cents: 1900 * n, access_ends: day(days), days_left: days });
const roster = {
  generated_at: day(0),
  names_visible: true,
  kpis: { paying: 4, paying_by_cadence: { renews: 1, one_time: 3, unknown: 0 }, in_trial: 1, lose_7d: 2, lose_30d: 3, renew_30d: 1, ended_30d: 0, lifetime_gross_cents: 44300, stuck_pending_24h: 1 },
  rows: [rosterRow(1, "one_time", 2), rosterRow(2, "one_time", 6), rosterRow(3, "one_time", 27), rosterRow(4, "auto_renews", 20), rosterRow(5, "auto_renews", 5, "trial")],
  pending: [{ id: "p1", user_id: null, label: null, tier: "premium_pass_guaranteed", provider: "nowpayments", amount_cents: 12900, currency: "EUR", created_at: day(-120), age_hours: 2880 }],
  basis: { paid_to_date: "Paid to date is the gross charge of every granted EUR payment by the learner.", cadence: "Whop does not tell us when a member cancels at period end." },
};

async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
async function setup(page: Page, theme: "light" | "dark") {
  await seedSession(page, { userId: "synthetic-admin", role: "admin", tier: "admin" });
  await page.addInitScript((t) => { localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_admin_theme", t); }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (url.pathname === "/api/admin/overview") return json(route, overview);
    if (url.pathname === "/api/stats/admin/payments") return json(route, payments);
    if (url.pathname === "/api/admin/subscriptions") return json(route, roster);
    if (url.pathname === "/api/admin/audit-log/latest") return json(route, { today_count: 0, last_action_at: null, last_action: null });
    if (url.pathname === "/api/admin/payments/resolve") return json(route, { ok: true, kind: "test" });
    if (url.pathname.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], actions: [], total: 0 });
  });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`a14 ${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });
      let errors: string[] = [];
      test.beforeEach(async ({ page }) => {
        errors = [];
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (err) => errors.push(err.message));
        await setup(page, theme);
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      test("overview shows cash money in, paying learners and the payment diagnosis", async ({ page }) => {
        await page.goto("/admin/overview");
        await expect(page.getByTestId("overview-payment-diagnosis")).toContainText("never granted Pro");
        // a18: the money strip leads; the detailed tiles sit under More signals.
        // Stuck NOWPayments checkouts left the home page (Paid roster, Pending view).
        await expect(page.getByTestId("overview-money-strip")).toBeVisible();
        await page.getByTestId("overview-more-signals").locator("summary").click();
        await expect(page.getByText("Money in today (cash)")).toBeVisible();
        await expect(page.getByText("Paying learners")).toBeVisible();
        await expect(page.getByText("All webhooks landed")).toHaveCount(0);
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/overview-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("payments shows money by month, the queue and the deliveries", async ({ page }) => {
        await page.goto("/admin/payments");
        await expect(page.getByTestId("payments-diagnosis")).toContainText("Resolve it in Unresolved payments");
        await expect(page.getByTestId("payments-diagnosis")).not.toContainText("ALARM");
        await expect(page.getByTestId("unresolved-row")).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Link to learner" })).toBeDisabled();
        // a18: keep the button clear of the phone bottom bar before tapping.
        const markTest = page.getByRole("button", { name: "Mark as test" });
        await markTest.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await markTest.click();
        await expect(page.getByRole("dialog")).toContainText("Mark payment as test");
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/payments-dialog-${viewport.name}-${theme}.png` });
        await page.getByRole("dialog").getByRole("button", { name: "Mark as test" }).click();
        await expect(page.getByRole("status").filter({ hasText: "Marked as test" })).toBeVisible();
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/payments-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("subscriptions is a paid roster with the ending-soon default and pending view", async ({ page }) => {
        await page.goto("/admin/subscriptions");
        await expect(page.getByTestId("roster-kpis")).toContainText("Lose Pro in 7 days");
        await expect(page.getByRole("tab", { name: /Ending soon, will not renew/ })).toHaveAttribute("aria-selected", "true");
        // Since a16 names come from UserLink (/api/admin/users/names); unmocked here, so the id label shows.
        await expect(page.getByRole("link", { name: /^Learner 00000000/ }).locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Synthetic Learner 4", { exact: false })).toHaveCount(0);
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/subscriptions-${viewport.name}-${theme}.png`, fullPage: true });
        await page.goto("/admin/subscriptions?status=pending");
        await expect(page.getByRole("tab", { name: /Pending checkouts/ })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByText("pending for more than 24 hours", { exact: false })).toBeVisible();
        await noOverflow(page);
      });

      test("old webhooks link lands on the payments deliveries", async ({ page }) => {
        await page.goto("/admin/webhooks");
        await expect(page).toHaveURL(/\/admin\/payments/);
      });
    });
  }
}
