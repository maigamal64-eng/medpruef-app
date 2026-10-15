import { expect, test, type Page, type Route } from "@playwright/test";

// a-anthropic-features: the Today "AI spend" row (workspace meter, per-feature
// cost and prompt-cache hit rate). Mocked APIs (the a19 harness), synthetic
// data, phone and desktop, light and dark, ok and soft-stop states.
// Screenshots go to AIF_SHOT_DIR when set.
const permissions = ["overview.read", "users.read", "revenue.read", "system.read", "feedback.read", "content.read", "content.moderate"];
const shotDir = process.env.AIF_SHOT_DIR;
const recent = new Date(Date.now() - 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const jobs = [
  { key: "trial-reminder", label: "Trial reminder and expiry sweep", schedule: "0 7 * * *", every: "daily 07:00 UTC", state: "late", tone: "warn", text: "Late: last run 2 d ago", last_started_at: daysAgo(2), evidence: "heartbeat event" },
  { key: "admin-action-alert", label: "Admin action alert", schedule: "15 * * * *", every: "hourly", state: "ok", tone: "ok", text: "OK: last run 20 min ago", last_started_at: recent, evidence: "heartbeat event" },
  { key: "mentor-sweep", label: "Mentor sweep", schedule: "*/15 * * * *", every: "every 15 minutes", state: "off", tone: "neutral", text: "Off (feature disabled)", last_started_at: null, evidence: "mentor job record" },
  { key: "mentor-health", label: "Mentor health check", schedule: "0 * * * *", every: "hourly", state: "not_recorded", tone: "neutral", text: "No run record (alerts only)", last_started_at: null, evidence: "none" },
];

const overview = {
  generated_at: new Date().toISOString(), day: "2026-10-12",
  tiles: {
    revenue: null, active_subs: null, new_payers_7d: null, real_signups: null,
    payment_health: { level: "ok", diagnosis: "Payments are flowing.", failures_24h: 0, probes_24h: 0, unresolved_total: 0 },
    signups_today: 1, free_limit_hits_today: 0, feedback_new: 0,
    ai_chat_1h: { requests: 0, completed: 0, failed: 0, avg_latency_ms: null },
    telegram_activation: { registered: 1, confirmed: 1 },
    crons: jobs.map(({ key, label, state, tone, text }) => ({ key, label, state, tone, text })),
    recent_events_aggregate: { total_last_24h: 10 },
  },
  needs: null, failed: [] as string[],
};

const inbox = {
  feedback: 0, question_reports: 2, note_reports: 0, puyp: 0, ops_actions: null, referral_payouts: 0, referral_rewards: 0,
  oldest: { question_reports: daysAgo(4) }, failed: [] as string[], generated_at: recent,
  kill_switches_on: [{ key: "DISABLE_ANALYTICS_WRITES", effect: "Sessions, landing hits, CSP reports and tracked events are not written; analytics numbers read near zero." }],
};

let spendState: "ok" | "soft_stop" = "ok";
function spendBody() {
  const soft = spendState === "soft_stop";
  return {
    meter: { workspace: "prod", monthCapMicro: 400_000_000, dayCapMicro: 12_903_225, monthMicro: soft ? 384_000_000 : 2_130_000, dayMicro: soft ? 9_000_000 : 64_000, monthPct: soft ? 96 : 0.53, dayPct: soft ? 69.75 : 0.49, state: spendState, trigger: soft ? "month" : null },
    features: [
      { feature: "mentor", calls: 12, costMicro: 8_400, inputTokens: 1586, outputTokens: 1562, cacheReadTokens: 47390, cacheWriteTokens: 0, hitRate: 0.9676 },
      { feature: "translate", calls: 33, costMicro: 63_700, inputTokens: 19401, outputTokens: 6348, cacheReadTokens: 0, cacheWriteTokens: 0, hitRate: 0 },
      { feature: "notes_safety", calls: 0, costMicro: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, hitRate: null },
    ],
    features_failed: false, month_start: "2026-10-01T00:00:00.000Z", generated_at: new Date().toISOString(),
  };
}

const SEED = `localStorage.setItem("medpruef_session", ${JSON.stringify(JSON.stringify({ user: { id: "synthetic-admin", email: "user-26af5ee6@example.com", role: "admin", tier: "admin", first_name: "Test", xp_total: 0, streak_count: 0, daily_goal: 20 }, gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 } }))}); localStorage.setItem("medpruef_session_token", "local-test-session-token"); localStorage.setItem("medpruef_onboarding", ${JSON.stringify(JSON.stringify({ completedAt: "2026-01-01T00:00:00.000Z", examSource: "kenntnispruefung" }))});`;

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function setup(page: Page, theme: "light" | "dark") {
  await page.addInitScript({ content: SEED });
  await page.addInitScript({ content: `localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_cookies", "declined"); localStorage.setItem("medpruef_admin_theme", ${JSON.stringify(theme)});` });
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (p === "/api/admin/inbox") return json(route, inbox);
    if (p === "/api/admin/overview") return json(route, overview);
    if (p === "/api/admin/ai-spend") return json(route, spendBody());
    if (p === "/api/admin/system-status") return json(route, { deploy: { ok: true, sha: "7ad750d", created_at: Date.now() - 5 * 3_600_000, summary: "feat" }, sentry: { ok: true, unresolved: 3 }, kill_switches: [] });
    if (p === "/api/admin/audit-log/latest") return json(route, { today_count: 0, last_action_at: recent, last_action: "x" });
    if (p === "/api/admin/crons") return json(route, { jobs, items: [
      { id: "hb-1", cron_name: "trial-reminder", started_at: daysAgo(2), finished_at: null, status: "fired", rows_affected: null, error: null },
      { id: "c1", cron_name: "trial-reminder", started_at: daysAgo(3), finished_at: daysAgo(3), status: "failed", rows_affected: 0, error: "Error: relation \"subscriptions\" timed out while reading the expiry sweep batch after 30000 ms, retry scheduled" },
    ], total: 2, window_hours: 48 });
    if (p === "/api/admin/deploys") return json(route, { configured: true, ok: true, deployments: [
      { uid: "d2", state: "READY", shaShort: "aaaaaaa", commitSummary: "preview build", branch: "track-a/x", target: null, author: "[name]", createdAt: Date.now() - 3_600_000, inspectorUrl: null },
      { uid: "d1", state: "READY", shaShort: "7ad750d", commitSummary: "a19 health", branch: "main", target: "production", author: "[name]", createdAt: Date.now() - 5 * 3_600_000, inspectorUrl: null },
    ] });
    if (p === "/api/suggestions") {
      if (url.searchParams.get("summary") === "1") return json(route, { summary: { window_days: 90, received: 40, decided: 36, median_hours: 19.6, p90_hours: 319.7, acknowledged_on_time: 30, open_over_target: 2, wrong_key: { decided: 9, p90_hours: 200, target_hours: 168, on_target: false } } });
      return json(route, { suggestions: [
        { id: 11, type: "flag", question_id: 501, question_text: "Single report question", question_topic: "Innere Medizin", user_name: "Learner", reason: "typo", details: null, status: "pending", created_at: daysAgo(1), repeat_count: null },
        { id: 12, type: "flag", question_id: 777, question_text: "Twice reported question", question_topic: "Chirurgie", user_name: "Learner", reason: "incorrect_answer", details: null, status: "pending", created_at: daysAgo(4), repeat_count: 2 },
      ], total: 2, counts: { pending: 2, approved: 0, rejected: 0, reverted: 0, total: 2 } });
    }
    if (p === "/api/stats/admin/explanations/downvoted") return json(route, { measured: true, items: [] });
    if (p.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], total: 0 });
  });
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`ai spend ${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      let errors: string[] = [];
      test.beforeEach(async ({ page }) => {
        errors = [];
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (e) => errors.push(e.message));
        await setup(page, theme);
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      for (const state of ["ok", "soft_stop"] as const) {
        test(`Today shows the AI spend row (${state}) with per-feature hit rates`, async ({ page }) => {
          spendState = state;
          await page.goto("/admin/overview");
          const row = page.getByTestId("overview-ai-spend");
          await expect(row).toContainText("AI spend (production workspace)");
          await expect(row).toContainText(state === "ok" ? "USD 2.13 of USD 400 this month (0.53 %)" : "USD 384.00 of USD 400 this month (96 %)");
          await expect(row).toContainText(state === "ok" ? "Within budget." : "paid learners continue");
          await row.getByText("Per feature this month (UTC)").click();
          const list = page.getByTestId("overview-ai-spend-features");
          await expect(list).toContainText("AI Mentor");
          await expect(list).toContainText("cache hit 97 %");
          await expect(list).toContainText("cache hit n/a");
          await noOverflow(page);
          if (shotDir) await page.screenshot({ path: `${shotDir}/today-ai-spend-${state}-${viewport.name}-${theme}.png`, fullPage: true });
        });
      }
    });
  }
}
