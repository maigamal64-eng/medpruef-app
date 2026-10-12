import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";

// a46 smoke: the do-not-email flag on admin Users (b39 patch 02). Mocked APIs,
// synthetic data, phone and desktop, light and dark. Admin is English-only.
// Screenshots go to A46_SHOT_DIR when set.
const permissions = ["overview.read", "users.read", "users.write", "revenue.read", "system.read"];
const shotDir = process.env.A46_SHOT_DIR;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const userRow = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000004${n}`, telegram_id: null, email: `${name.split(" ")[0].toLowerCase()}@example.invalid`, name, first_name: name, last_name: null,
  username: null, photo_url: null, role: "user", tier: "pro", status: "recent", created_at: day(-20), xp: 10, streak: 1, questions_answered: 40, accuracy: 60,
  daily_today: 0, last_study: null, last_active: day(-1), is_banned: false, ...over,
});

const items = [
  userRow(1, "Opted Out", { do_not_email: { suppressed: true, causes: ["opt_out"], scope: "marketing", since: day(-21) } }),
  userRow(2, "Bounced Address", { do_not_email: { suppressed: true, causes: ["hard_bounce"], scope: "all", since: day(-21) } }),
  userRow(3, "Unusable Address", { do_not_email: "unmailable" }),
  userRow(4, "Clear Learner", { do_not_email: null }),
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function setup(page: Page, theme: "light" | "dark", unknown: boolean) {
  await seedSession(page, { userId: "synthetic-admin", role: "admin", tier: "admin" });
  await page.addInitScript((t) => { localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_cookies", "declined"); localStorage.setItem("medpruef_admin_theme", t); }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (p === "/api/admin/inbox") return json(route, { question_reports: 0, note_reports: 0, feedback: 0, generated_at: day(0) });
    if (p === "/api/admin/audit-log/latest") return json(route, { today_count: 0, last_action_at: null, last_action: null });
    if (p === "/api/stats/admin/users" && url.searchParams.get("view") === "segments") return json(route, { available: false, counts: null });
    if (p === "/api/stats/admin/users") {
      const rows = unknown ? items.map((r) => ({ ...r, do_not_email: "unknown" })) : items;
      return json(route, { items: rows, total: rows.length, page: 1, limit: 25, totalPages: 1, activity_basis: "learner" });
    }
    if (p.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], actions: [], total: 0 });
  });
}

for (const viewport of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`a46 ${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      let errors: string[] = [];
      test.beforeEach(({ page }) => {
        errors = [];
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (err) => errors.push(err.message));
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      test("users list shows the do-not-email flag per learner", async ({ page }) => {
        await setup(page, theme, false);
        await page.goto("/admin/users");
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("No marketing mail").locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Do not email").locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Unmailable address").locator("visible=true").first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        if (shotDir) await page.screenshot({ path: `${shotDir}/users-flag-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("an unreadable list reads unknown, never clear", async ({ page }) => {
        await setup(page, theme, true);
        await page.goto("/admin/users");
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Mail status unknown").locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Do not email")).toHaveCount(0);
      });
    });
  }
}
