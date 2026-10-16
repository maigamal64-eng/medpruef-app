import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-rewards-program smoke. Browser /api calls are synthetic (release-harness);
 * the flags live on the server, so the routes are mocked as if on. Covers the
 * Settings exam report card (two open sittings, choose one, consent, one POST
 * with the sitting key), the card hidden while off, the fix reward line in My
 * reports and the exam report preview in /admin/feedback. 375 and 1280, DE
 * and EN, light and dark; no horizontal page scroll, no console errors.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, contentType: "application/json", headers, body: JSON.stringify(body) });

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

const SITTINGS = [
  { key: "sip4a:2026-11-18", label: { de: "SIP4a Wien", en: "SIP4a Vienna" }, sent: false, rewarded: false },
  { key: "sip5a:2026-11-17", label: { de: "SIP5a Wien", en: "SIP5a Vienna" }, sent: false, rewarded: false },
];

test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`settings exam report card: choose a sitting, consent, one POST ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/exam-report", (route) => route.fulfill(json(200, { enabled: true, eligible: true, credits: 150, expiry_days: 60, sittings: SITTINGS })));
    let posts = 0;
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/feedback", (route) => { posts++; sent = route.request().postDataJSON(); return route.fulfill(json(200, { ok: true })); });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("settings-exam-report");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText("150");
    await expect(card).not.toContainText("€");
    await card.locator('button[type="submit"]').click();
    await expect(card.locator('[role="alert"]')).toBeVisible();
    expect(posts).toBe(0);
    await card.locator("select").selectOption("sip4a:2026-11-18");
    await card.locator("textarea").fill(v.lang === "de" ? "Die Organisation war klar, es kamen viele Fragen zur Inneren Medizin vor." : "The organisation was clear, and many questions were on internal medicine.");
    await card.locator('input[type="checkbox"]').check();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/rewards-program/settings-exam-report-${tag(v)}.png`, fullPage: false });
    await card.locator('button[type="submit"]').click();
    await expect(card.locator('[role="status"]')).toBeVisible();
    expect(posts).toBe(1);
    expect(sent).toMatchObject({ context: { kind: "exam_report", sitting_key: "sip4a:2026-11-18", consent_public: true } });
    await expect(card).toContainText(v.lang === "de" ? "Bericht gesendet" : "report sent");
    await noOverflow(page, "/settings");
    expect(errors, "console errors").toEqual([]);
  });

  test(`settings hides the exam report card while off; My reports shows the fix reward line ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/exam-report", (route) => route.fulfill(json(200, { enabled: false })));
    await page.route("**/api/suggestions/mine**", (route) => route.fulfill(json(200, {
      suggestions: [
        { id: 5, question_id: 101, type: "flag", status: "approved", created_at: "2026-11-01T10:00:00Z", resolved_at: "2026-11-02T10:00:00Z", state: "fixed", reward_credits: 10 },
        { id: 6, question_id: 102, type: "flag", status: "approved", created_at: "2026-11-01T10:00:00Z", resolved_at: "2026-11-02T10:00:00Z", state: "fixed" },
      ], total: 2, limit: 50, offset: 0, turnaround: null,
    })));
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const line = page.getByTestId("report-fix-reward");
    await expect(line).toHaveCount(1, { timeout: 25_000 });
    await expect(line).toContainText(v.lang === "de" ? "10 Credits für den KI-Mentor" : "10 AI Mentor credits");
    await expect(page.getByTestId("settings-exam-report")).toHaveCount(0);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/rewards-program/my-reports-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/settings");
    expect(errors, "console errors").toEqual([]);
  });

  test(`admin feedback: exam report row previews sitting, bar and month breaker ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await page.addInitScript(() => {
      try {
        const s = JSON.parse(localStorage.getItem("medpruef_session") ?? "{}");
        s.user = { ...s.user, role: "admin", tier: "admin" };
        localStorage.setItem("medpruef_session", JSON.stringify(s));
      } catch { /* storage blocked */ }
    });
    await page.route("**/api/auth/me**", (route) => route.fulfill(json(200, { user: { id: "51c5564a-5051-4b9b-8f81-4faf0e368533", first_name: "Fixture", tier: "admin", tier_expires_at: null, role: "admin", referrals_enabled: true, active_exam: "kenntnispruefung", email: "admin@example.invalid" } })));
    await page.route("**/api/admin/access/me", (route) => route.fulfill(json(200, { actor: { userId: "51c5564a-5051-4b9b-8f81-4faf0e368533", email: "admin@example.invalid" }, roles: [{ key: "owner", name: "Owner" }], permissions: ["revenue.read", "revenue.manage", "feedback.read", "feedback.manage", "users.read", "system.read", "content.read", "content.moderate"] })));
    await page.route("**/api/feedback?summary=1", (route) => route.fulfill(json(200, { median_hours: null, sample: 0 })));
    await page.route("**/api/feedback?status=**", (route) => route.fulfill(json(200, [
      { id: 77, user_id: "00000000-0000-4000-8000-0000000000b1", message: "Die Organisation war klar.", context: { kind: "exam_report", sitting_key: "sip4a:2026-11-18", exam_report: { consent_public: true } }, status: "new", admin_note: null, created_at: "2026-11-22T10:00:00Z" },
    ], { "X-Total-Count": "1" })));
    await page.route("**/api/admin/feedback/reward", (route) => route.fulfill(json(200, { kind: "exam_report", credits: 150, expiry_days: 60, consent_public: true, rewarded: false, eligibility: { distinctQuestions: 40, activeDays: 5, everPaid: false, meetsBar: true }, sitting: { key: "sip4a:2026-11-18", label: "SIP4a Vienna" }, month: { granted: 3, cap: 300 } })));
    await page.goto("/admin/feedback", { waitUntil: "domcontentloaded" });
    const box = page.getByTestId("testimonial-reward");
    await expect(box).toBeVisible({ timeout: 25_000 });
    await expect(box).toContainText("Exam report (sip4a:2026-11-18)");
    await box.getByRole("button", { name: "Check reward" }).click();
    await expect(box).toContainText("Exam report rewards this month: 3 of 300.");
    await expect(box.getByRole("button", { name: /Grant 150 credits/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/rewards-program/admin-feedback-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/admin/feedback");
    expect(errors, "console errors").toEqual([]);
  });
}
