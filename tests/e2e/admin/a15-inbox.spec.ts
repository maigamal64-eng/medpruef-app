import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";

// a15 admin inbox smoke: mocked APIs with synthetic data, phone and desktop,
// light and dark. Admin is English-only (note reports keep their German
// owner copy). Screenshots go to A15_SHOT_DIR when set.
const permissions = ["overview.read", "content.read", "content.moderate", "feedback.read", "feedback.manage", "users.read"];
const shotDir = process.env.A15_SHOT_DIR;
const recent = new Date(Date.now() - 3_600_000).toISOString();

const report = (over: Record<string, unknown> = {}) => ({
  id: 71, question_id: 812, type: "flag", reason: "incorrect_answer", details: "The marked answer appears inconsistent with the 2021 guideline.",
  status: "pending", admin_note: null, created_at: recent, resolved_at: null,
  question_text: "Which finding needs urgent review?", question_full: "A 64-year-old presents with sudden weakness of the right arm. Which finding needs urgent review?",
  question_topic: "Neurology", question_choices: [{ text: "Pupil asymmetry", correct: true }, { text: "Mild headache", correct: false }, { text: "Normal reflexes", correct: false }],
  question_answer: "Pupil asymmetry", question_explanation: "Anisocoria can signal raised intracranial pressure.", question_active: true, question_missing: false,
  report_page: "/quiz?topic=Neurology", reporter_outcome: null, notified_at: null, notify_error: null, has_account: true, reporter_contactable: true,
  reporter_id: "00000000-0000-4000-8000-0000000000b1", user_name: "Synthetic Learner", ...over,
});
const list = (rows: unknown[]) => ({ suggestions: rows, total: rows.length, email_enabled: false, counts: { pending: 2, approved: 5, rejected: 3, reverted: 1, total: rows.length } });

async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
async function setup(page: Page, theme: "light" | "dark") {
  await seedSession(page, { userId: "synthetic-admin", role: "admin", tier: "admin" });
  await page.addInitScript((t) => { localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_cookies", "declined"); localStorage.setItem("medpruef_admin_theme", t); }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (p === "/api/admin/inbox") return json(route, { question_reports: 2, note_reports: 1, feedback: 3, generated_at: recent });
    if (p === "/api/admin/audit-log/latest") return json(route, { today_count: 0, last_action_at: null, last_action: null });
    if (p === "/api/suggestions" && route.request().method() === "PATCH") return json(route, { ok: true, status: "rejected", applied: false });
    if (p === "/api/suggestions") {
      if (url.searchParams.get("id") === "70") return json(route, list([report({ id: 70, question_id: 790, status: "approved", reporter_outcome: "fixed", resolved_at: recent, admin_note: "New key: B" })]));
      return json(route, list([report(), report({ id: 72, question_id: 900, type: "edit", reason: null, user_name: "Anonymous", has_account: false, reporter_id: null, proposed: { explanation: "Neu" }, current: { explanation: "Alt" } })]));
    }
    if (p === "/api/stats/admin/explanations/downvoted") return json(route, { measured: true, items: [{ question_id: 1500, down_votes: 3, votes: 4, rating_sum: -2, topic: "Kardiologie", exam_type: "kenntnispruefung", is_active: true, question: "Welche Therapie ist bei Vorhofflimmern zuerst indiziert?" }] });
    if (p === "/api/stats/admin/questions") return json(route, { totalAll: 10, active: 9, inactive: 1, mcqPct: 97, explPct: 80, imgPct: 9, byTopic: [], questions: [], total: 0, totalPages: 0 });
    if (p === "/api/feedback") {
      if (url.searchParams.get("summary") === "1") return json(route, { first_reply: { median_hours: 14.5, replied: 4, received: 9, window_days: 30 } });
      return json(route, [
        { id: 4, user_id: "00000000-0000-4000-8000-0000000000b2", message: "The timer in the exam keeps running after I submit.", context: { pathname: "/exam", questionId: 812 }, status: "reviewed", admin_note: null, created_at: recent, first_replied_at: null, sender: { id: "00000000-0000-4000-8000-0000000000b2", name: "Synthetic Two", email: "two@example.invalid", telegram_username: "synthetic_two" } },
        { id: 5, user_id: null, message: "Anonymous suggestion about dark mode.", context: {}, status: "new", admin_note: null, created_at: recent, sender: null },
      ]);
    }
    if (p === "/api/admin/note-reports") return json(route, { reports: [{ id: "r1", note_id: "n1", reason: "pii", detail: "Contains a phone number", status: "open", created_at: recent, notes: { id: "n1", title: "Sepsis bundle", content: { blocks: [{ type: "keyfact", text: "Lactate within 1 h" }] }, visibility: "public", is_active: true, user_id: "00000000-0000-4000-8000-0000000000b3" } }] });
    if (p === "/api/stats/admin/missing-images") return json(route, { total: 2, questions: [{ id: 3001, exam_type: "kmp_innsbruck", topic: "Neurologie", question: "Auf dem Bild ist ein EEG zu sehen. Welche Diagnose?", has_image: false }, { id: 3002, exam_type: "kenntnispruefung", topic: "Kardiologie", question: "Folgendes EKG zeigt?", has_image: true }] });
    if (p.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], actions: [], total: 0 });
  });
}

// The root layout's stale-build check may reload once after the first load;
// settle before asserting so a reload cannot land mid-test.
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
    test.describe(`a15 ${viewport.name} ${theme}`, () => {
      // The service worker's build-id reload would navigate mid-test.
      test.use({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      let errors: string[] = [];
      test.beforeEach(async ({ page }) => {
        errors = [];
        page.on("framenavigated", (f) => { if (f === page.mainFrame() && process.env.A15_DEBUG) console.log("NAV", f.url()); });
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (err) => errors.push(err.message));
        await setup(page, theme);
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      test("reports inbox links each report to its row and lists down-voted explanations", async ({ page }) => {
        await open(page, "/admin/flagged");
        await expect(page.getByRole("link", { name: "Open report" }).first()).toHaveAttribute("href", "/admin/questions?tab=reviews&report=71");
        await expect(page.getByRole("link", { name: "Question #812" }).first()).toHaveAttribute("href", "/admin/questions?tab=browse&questionId=812");
        await expect(page.getByText("1 open")).toBeVisible();
        await expect(page.getByText("3 down of 4")).toBeVisible();
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/flagged-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("review deep link pins and highlights the report; dismiss offers undo", async ({ page }) => {
        await open(page, "/admin/questions?tab=reviews&report=70");
        const pinned = page.locator("#report-70");
        await expect(pinned).toBeVisible();
        await expect(pinned).toContainText("Reporter sees: Fixed");
        await expect(pinned).toContainText("Pupil asymmetry (keyed correct)");
        const row = page.locator("#report-71");
        await row.getByRole("button", { name: "Dismiss report" }).click();
        await row.getByLabel("Needs more information", { exact: false }).check();
        await row.getByRole("textbox").fill("Please send the source you used.");
        await row.getByRole("button", { name: "Dismiss report" }).click();
        await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/reviews-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("feedback shows contact, note and Mark replied", async ({ page }) => {
        await open(page, "/admin/feedback");
        await expect(page.getByTestId("feedback-first-reply")).toContainText("14.5 h");
        await expect(page.getByRole("link", { name: "Synthetic Two" })).toHaveAttribute("href", "/admin/users/00000000-0000-4000-8000-0000000000b2");
        await expect(page.getByRole("button", { name: "Copy email" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", "https://t.me/synthetic_two");
        await expect(page.getByRole("button", { name: "Mark replied" })).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(2);
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/feedback-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("note reports: reason first, owner link, takedown confirm", async ({ page }) => {
        await open(page, "/admin/note-reports");
        await expect(page.getByText("Persönliche Daten")).toBeVisible();
        await expect(page.getByRole("link", { name: "Profil der Autorin oder des Autors" })).toBeVisible();
        await page.getByRole("button", { name: "Entfernen" }).click();
        await expect(page.getByRole("dialog")).toContainText("Notiz entfernen?");
        await expect(page).toHaveTitle(/\(1\) Note reports/);
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/note-reports-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("media lists image state with Open in editor", async ({ page }) => {
        await open(page, "/admin/media");
        await expect(page.getByText("No image attached")).toBeVisible();
        await expect(page.getByText("Image attached, tag still set")).toBeVisible();
        await expect(page.getByRole("link", { name: "Open in editor" }).first()).toHaveAttribute("href", "/admin/questions?tab=browse&questionId=3001");
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/media-${viewport.name}-${theme}.png`, fullPage: true });
      });

      test("Inbox group shows badges", async ({ page }) => {
        await open(page, "/admin/media");
        await expect(page.getByText("No image attached")).toBeVisible();
        if (viewport.width < 1024) await page.getByRole("button", { name: "Open admin navigation" }).click();
        const nav = page.getByRole("navigation", { name: "Admin navigation" }).first();
        await expect(nav.getByRole("link", { name: /Note reports/ })).toContainText("1");
        await expect(nav.getByRole("link", { name: /Feedback/ })).toContainText("3");
        if (shotDir) await page.screenshot({ path: `${shotDir}/nav-${viewport.name}-${theme}.png` });
      });
    });
  }
}
