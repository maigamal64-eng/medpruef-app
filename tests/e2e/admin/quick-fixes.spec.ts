import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";
const permissions = ["overview.read", "users.read", "users.write", "users.entitlements.write", "users.sessions.write", "content.read", "content.moderate", "feedback.read", "feedback.manage", "revenue.read", "system.read", "access.manage"];
const learner = { id: "synthetic-learner", name: "Synthetic Long Learner Name", email: "synthetic@example.invalid", username: "synthetic", role: "user", tier: "free", status: "recent", photo_url: null, telegram_id: null, first_name: "Synthetic", last_name: "Learner", xp: 0, streak: 0, questions_answered: 0, accuracy: 0, daily_today: 0, last_study: null, last_active: "2026-10-10", created_at: "2026-10-01" };
const question = { id: 42, topic: "Synthetic topic", question: "Synthetic question text", question_preview: "Synthetic question text", answer: "Synthetic answer", explanation: "old explanation", choices: [], choices_count: 0, has_explanation: true, has_image: false, image_url: null, exam_dates: [], tags: [], is_active: true, exam_type: "kenntnispruefung", source_file: "synthetic" };
const stats = { active: 100, totalAll: 100, inactive: 0, withMCQ: 100, withExplanations: 100, withImages: 0, mcqPct: 100, explPct: 100, imgPct: 0, byTopic: [{ topic: "Synthetic topic", count: 100 }] };
async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
async function setup(page: Page) {
  await seedSession(page, { userId: "synthetic-admin", role: "admin", tier: "admin" });
  await page.addInitScript({ content: `localStorage.setItem("medpruef_cookie_consent", "accepted"); localStorage.setItem("medpruef_cookies", "accepted"); localStorage.setItem("medpruef_admin_theme", "dark");` });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (url.pathname === "/api/stats/admin/users") return json(route, { items: [learner], total: 75, page: Number(url.searchParams.get("page")) || 1, limit: 25, totalPages: 3 });
    if (url.pathname === "/api/stats/admin/users/synthetic-learner") return json(route, {
      profile: { ...learner, name: "Synthetic Long Learner Name", is_banned: false, active_exam: null, exam_date: null, updated_at: null, last_active_date: null, telegram_username: null, language_code: null, daily_goal: 20, referral_code: null, referred_by_code: null, tier_expires_at: null, onboarding_completed_at: null }, gamification: null,
      stats: { answersLogged: 0, answersCorrect: 0, accuracy: 0, totalTimeMs: 0, avgTimeMs: 0, xpFromAnswers: 0, activeDays: 0, firstActivity: null, lastActivity: null, sessionsCount: null, notesCount: null, bookmarksCount: 0, aiChatsCount: 0, searchesCount: 0, pageViewsCount: 0 }, heatmap: [], trend: [], topics: [], exams: [], timeline: [], timelineTotal: 0, answers: [], answersTotal: 0, money: null, restricted_sections: [], generatedAt: "2026-10-11" });
    if (url.pathname === "/api/stats/admin/questions") return json(route, route.request().method() === "PATCH" ? { ok: true } : url.searchParams.get("mode") === "browse" ? { questions: [question], total: 1, totalPages: 1 } : stats);
    if (url.pathname === "/api/feedback") return json(route, [{ id: 1, message: "Synthetic reviewed message", status: "reviewed", created_at: "2026-10-11T00:00:00Z", context: {}, admin_note: null, user_id: null }]);
    if (url.pathname === "/api/suggestions") return json(route, { suggestions: [{ id: 1, question_id: 42, type: "flag", reason: "other", details: "Synthetic report", status: "pending", created_at: "2026-10-11", user_name: "Learner", question_text: "Synthetic question", context: { url: { unexpected: "object" }, user_agent: { unexpected: "object" } } }], counts: { pending: 1, approved: 0, rejected: 0 }, total: 1 });
    if (url.pathname === "/api/stats/admin/missing-images") return json(route, { questions: [{ id: 42, exam_type: "kenntnispruefung", topic: "Synthetic topic", question: "Synthetic missing-image question" }], total: 1 });
    if (url.pathname === "/api/admin/audit-log/latest") return json(route, { today_count: 1, last_action_at: "2026-10-11", last_action: "edit_question" });
    if (url.pathname === "/api/admin/overview") return json(route, { generated_at: "2026-10-11", tiles: { revenue: { today_cents: 0, mtd_cents: 0 }, active_subs: { total: 0, by_tier: {} }, signups_today: 0, paywall_hits_today: 0, referrals_awaiting_action: 0, puyp_pending: 0, flagged_open: 0, webhook_failures_24h: 0, stuck_pending_24h: 0, conversion_7d: null, ai_chat_1h: null, telegram_activation: null, crons: {}, recent_events_aggregate: { total_last_24h: 12 } } });
    if (url.pathname === "/api/admin/ops/actions") return json(route, { actions: [{ id: "synthetic-action", operation: "synthetic", status: "prepared", payload: {}, payload_hash: "hash", target_hash: "target", predicted_effect: { kind: "synthetic" }, expires_at: "2099-01-01", created_at: "2026-10-11", principal_id: "synthetic-principal" }] });
    return json(route, { items: [], actions: [], reports: [], suggestions: [], counts: { pending: 0, approved: 0, rejected: 0 }, total: 0 });
  });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

test("Q01/Q02 admin loads no third-party integrations and has noindex", async ({ page }) => {
  await setup(page); const thirdParty: string[] = [];
  page.on("request", (req) => { if (/googletagmanager|clarity\.ms|facebook\.net|redditstatic|t\.whop\.tw|telegram\.org\/js/.test(req.url())) thirdParty.push(req.url()); });
  await page.goto("/admin/users"); await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("medpruef-consent", { detail: "accepted" })));
  expect(thirdParty).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
});
test("Q07 failed Today load is gray Retry without colored zeros; audit failure warns instead of vanishing", async ({ page }) => {
  await setup(page); await page.route("**/api/admin/overview", (route) => json(route, { error: "synthetic failure" }, 500));
  await page.goto("/admin/overview"); await expect(page.getByText("Could not load Today.")).toBeVisible(); await expect(page.locator('[data-testid="overview-revenue-hero"]')).toHaveCount(0);
  await expect(page.getByText("€0,00")).toHaveCount(0);
  await page.unroute("**/api/admin/overview"); await page.route("**/api/admin/audit-log/latest**", (route) => json(route, { error: "failed" }, 500));
  await page.getByRole("button", { name: "Retry", exact: true }).first().click(); await expect(page.getByText(/Could not load the admin action log/)).toBeVisible();
});
for (const [path, api, falseEmpty] of [["crons", "/api/admin/crons", "No cron runs yet"], ["audit", "/api/admin/audit", "Audit log empty"], ["flags", "/api/admin/flags", "No flags yet"], ["env", "/api/admin/env", "MISSING"], ["puyp", "/api/puyp/admin", "No pending reviews"]]) {
  test(`Q08 ${path} failed load shows Retry without false empty/LIVE`, async ({ page }) => {
    await setup(page); await page.route(`**${api}**`, (route) => json(route, { error: "synthetic failure" }, 500)); await page.goto(`/admin/${path}`);
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible(); await expect(page.getByText(falseEmpty, { exact: true })).toHaveCount(0); await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0);
    if (path === "puyp") { await expect(page.getByText("Queue unavailable")).toBeVisible(); await expect(page.getByText("0 in queue")).toHaveCount(0); }
  });
}
test("Q08 questions Retry hides misleading stats/empty results", async ({ page }) => {
  await setup(page); await page.route("**/api/stats/admin/questions**", (route) => json(route, { error: "failed" }, 500)); await page.goto("/admin/questions"); await expect(page.getByRole("button", { name: "Retry", exact: true }).first()).toBeVisible(); await expect(page.getByText("No questions found", { exact: true })).toHaveCount(0);
});
test("Q09 feedback opens Needs action with Resolve and Dismiss on reviewed rows", async ({ page }) => {
  await setup(page); const request = page.waitForRequest((req) => new URL(req.url()).pathname === "/api/feedback"); await page.goto("/admin/feedback"); expect(new URL((await request).url()).searchParams.get("status")).toBe("needs_action");
  await expect(page.getByRole("tab", { name: "Needs action" })).toHaveAttribute("aria-selected", "true"); await expect(page.getByRole("button", { name: "Resolve", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
});
test("Q11 media reads questions and links to the exact Browse row", async ({ page }) => {
  await setup(page); await page.goto("/admin/media"); await expect(page.getByText("Synthetic missing-image question")).toBeVisible(); await page.getByRole("link", { name: "Question #42", exact: true }).click(); await expect(page).toHaveURL(/questionId=42/);
});
test("Q12/Q14 edit sends a delta and canceling Hide writes nothing", async ({ page }) => {
  await setup(page); const writes: unknown[] = []; page.on("request", (req) => { if (req.method() === "PATCH") writes.push(req.postDataJSON()); });
  await page.goto("/admin/questions"); await expect(page.getByText("MCQ (Wien + Innsbruck)", { exact: true })).toBeVisible(); await page.getByText("Synthetic question text", { exact: true }).first().click(); await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Explanation", { exact: true }).fill("new explanation"); await page.getByRole("button", { name: "Save", exact: true }).click(); await expect.poll(() => writes).toEqual([{ questionId: 42, updates: { explanation: "new explanation" } }]);
  await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.getByRole("checkbox", { name: "Active", exact: true }).uncheck(); page.once("dialog", (dialog) => dialog.dismiss()); await page.getByRole("button", { name: "Save", exact: true }).click(); expect(writes).toHaveLength(1);
});
test("Q15 reviews tolerate bad context objects without rendering dead chips", async ({ page }) => {
  await setup(page); const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); await page.goto("/admin/questions?tab=reviews"); await expect(page.getByText('"Synthetic report"')).toBeVisible(); expect(errors).toEqual([]); await expect(page.getByText("[object Object]", { exact: true })).toHaveCount(0);
});
test("Q17 learner identity is readable on a 390px phone", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/admin/users/synthetic-learner"); const name = page.getByRole("heading", { level: 1, name: learner.name }); await expect(name).toBeVisible(); expect((await name.boundingBox())!.width).toBeGreaterThan(200);
});
test("Q18 row menu is visible at the last row without overflow clipping", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 1440, height: 700 }); await page.goto("/admin/users"); const trigger = page.locator('button[aria-haspopup="menu"]').last(); await trigger.scrollIntoViewIfNeeded(); await trigger.click(); const menu = page.getByRole("menu"); await expect(menu).toBeVisible(); const box = (await menu.boundingBox())!; expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(700); expect(await menu.evaluate((el) => el.parentElement === document.body)).toBe(true);
});
test("Q19/Q20/Q21 directory URL survives Back, shows identity and has one Refresh", async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/admin/users?q=synthetic&tier=free&auth=email&page=3&sort=xp&order=asc"); await expect(page.getByRole("searchbox", { name: "Search users" })).toHaveValue("synthetic"); await expect(page.getByRole("columnheader", { name: "Role", exact: true })).toHaveCount(0); await expect(page.getByText(learner.email, { exact: true }).first()).toBeVisible(); await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(1);
  await page.getByRole("link", { name: learner.name, exact: true }).first().click(); await expect(page).toHaveURL(/\/admin\/users\/synthetic-learner$/); await page.goBack(); await expect(page).toHaveURL(/page=3/); await expect(page.getByRole("searchbox", { name: "Search users" })).toHaveValue("synthetic");
});
test("Q22 transient access check retries once", async ({ page }) => {
  await setup(page); let attempts = 0; await page.route("**/api/admin/access/me", (route) => json(route, ++attempts === 1 ? { error: "temporary" } : { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions }, attempts === 1 ? 500 : 200)); await page.goto("/admin/users"); await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible(); expect(attempts).toBe(2);
});
test("Q23 Approve has a visible fill in dark mode", async ({ page }) => {
  await setup(page); await page.goto("/admin/ops"); const button = page.getByRole("button", { name: "Approve this exact change" }); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); await expect(button).toBeVisible(); const color = await button.evaluate((el) => getComputedStyle(el).backgroundColor); expect(color).not.toBe("rgba(0, 0, 0, 0)"); const pageColor = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor); expect(color).not.toBe(pageColor);
});

for (const [path, api] of [["flagged", "/api/suggestions"], ["subscriptions", "/api/admin/subscriptions"], ["growth", "/api/stats/admin/growth"], ["users", "/api/stats/admin/users"]]) {
  test(`Q08 ${path} load failure exposes Retry`, async ({ page }) => {
    await setup(page); await page.route(`**${api}**`, (route) => json(route, { error: "synthetic failure" }, 500)); await page.goto(`/admin/${path}`); await expect(page.getByRole("button", { name: "Retry", exact: true }).first()).toBeVisible(); await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0); if (path === "users") { await expect(page.getByText("Directory counts unavailable")).toBeVisible(); await expect(page.getByText(/saved snapshot of 0/)).toHaveCount(0); }
  });
}
test("Q22 learner opening admin returns home", async ({ page }) => {
  await setup(page); await seedSession(page, { userId: "synthetic-learner", role: "user", tier: "free" }); await page.goto("/admin/users"); await expect.poll(() => new URL(page.url()).pathname.startsWith("/admin")).toBe(false);
});
test("Q01 entering admin replaces the public document", async ({ page }) => {
  await setup(page); await page.goto("/pricing"); await page.evaluate(() => {
    (window as unknown as { syntheticPixelLoaded: boolean }).syntheticPixelLoaded = true;
    window.history.pushState({}, "", "/admin/users");
  });
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { syntheticPixelLoaded?: boolean }).syntheticPixelLoaded)).toBeUndefined();
});
