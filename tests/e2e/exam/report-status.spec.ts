import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { seedPreferences } from "../helpers/page-setup";

// a15 (QLT-03, TR-10): Settings > Meine Meldungen with a stubbed
// /api/suggestions/mine. Phone and desktop, light and dark, DE and EN.
// The list must show the learner states and never another person's name
// or an admin note. Screenshots go to A15_SHOT_DIR when set.
const shotDir = process.env.A15_SHOT_DIR;
// The service worker's build-id reload would navigate mid-test.
test.use({ serviceWorkers: "block" });
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const mine = {
  suggestions: [
    { id: 5, question_id: 1201, type: "flag", status: "pending", state: "open", created_at: "2026-10-11T08:00:00Z", resolved_at: null },
    { id: 4, question_id: 1188, type: "edit", status: "approved", state: "fixed", created_at: "2026-10-08T08:00:00Z", resolved_at: "2026-10-08T15:00:00Z" },
    { id: 3, question_id: 1150, type: "flag", status: "approved", state: "accepted", created_at: "2026-10-05T08:00:00Z", resolved_at: "2026-10-06T04:00:00Z" },
    { id: 2, question_id: 1102, type: "flag", status: "rejected", state: "not_an_error", created_at: "2026-10-01T08:00:00Z", resolved_at: "2026-10-02T05:00:00Z" },
    { id: 1, question_id: 1099, type: "flag", status: "rejected", state: "needs_info", created_at: "2026-09-28T08:00:00Z", resolved_at: "2026-09-29T05:00:00Z" },
  ],
  total: 5,
  limit: 20,
  offset: 0,
  turnaround: { median_hours: 20, sample: 64, window_days: 180 },
};

async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }

async function setup(page: Page, theme: "light" | "dark", lang: "de" | "en") {
  await seedPreferences(page, { theme, lang });
  await seedSession(page, { userId: LEARNER, email: "learner@example.invalid", role: "user", tier: "free", firstName: "Testperson" });
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/suggestions/mine") return json(route, mine);
    if (url.pathname === "/api/auth/me") return json(route, { user: { id: LEARNER, tier: "free", role: "user", email: "learner@example.invalid", first_name: "Testperson" } });
    if (url.pathname.startsWith("/api/mentor/")) return json(route, { enabled: false }, 200);
    return json(route, {});
  });
}

for (const viewport of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    for (const lang of ["de", "en"] as const) {
      test(`My reports ${viewport.name} ${theme} ${lang}`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setup(page, theme, lang);
        await page.goto("/settings#meine-meldungen", { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle");
        const list = page.getByTestId("my-reports");
        await expect(list).toBeVisible({ timeout: 20_000 });
        const labels = lang === "de"
          ? ["Offen", "Korrigiert", "Angenommen", "Kein Fehler", "Mehr Angaben nötig"]
          : ["Open", "Fixed", "Accepted", "Not an error", "More information needed"];
        for (const label of labels) await expect(list.getByText(label, { exact: true })).toBeVisible();
        await expect(page.getByTestId("my-reports-turnaround")).toContainText(lang === "de" ? "etwa 20 Stunden" : "about 20 hours");
        await expect(list).not.toContainText("QA Reviewer");
        await expect(list).not.toContainText("admin");
        await expect(list.getByRole("link").first()).toHaveAttribute("href", "/quiz?questionId=1201");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        if (shotDir) await list.screenshot({ path: `${shotDir}/my-reports-${viewport.name}-${theme}-${lang}.png` });
        expect(errors).toEqual([]);
      });
    }
  }
}
