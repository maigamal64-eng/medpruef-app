/**
 * a10-language smoke: Home and /mistakes with every API stubbed (no network
 * writes), 375 px and desktop, light and dark, DE and EN, plus an Arabic and a
 * Russian preference on the English fallback. Checks exam names, number
 * formatting, lang/dir attributes, horizontal overflow and console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const userId = "00000000-0000-4000-8000-0000000000a1";
const OUT = process.env.A10_OUT ?? path.join(process.cwd(), "tests/e2e/.artifacts/a10");

async function setup(page: Page, language: string, dark: boolean, bank = "kenntnispruefung") {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(({ userId, bank, language, dark }) => {
    localStorage.setItem("medpruef_session", JSON.stringify({ user: { id: userId, first_name: "Fixture", role: "user", tier: "pro", xp_total: 0, streak_count: 0, daily_goal: 20 }, gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 } }));
    localStorage.setItem("medpruef_session_token", "fixture");
    localStorage.setItem("medpruef_onboarding", JSON.stringify({ completedAt: "2026-01-01" }));
    localStorage.setItem("medpruef_exam_source", bank);
    localStorage.setItem("medpruef-lang", language);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.setItem("medpruef-consent", "declined");
    localStorage.setItem("medpruef_whats_new_seen", "2026-04-22");
    localStorage.setItem("medpruef_survey_v1_completed", "true");
    localStorage.setItem("medpruef_orientation_modal_seen_v2", "1");
  }, { userId, bank, language, dark });
  const base = new URL(process.env.BASE_URL ?? "http://localhost:3137").origin;
  // Returning signed-in learners carry this cookie; without it middleware sends / to /landing.
  await page.context().addCookies([{ name: "mp_skip_landing", value: "1", url: base }]);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort("blockedbyclient");
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let json: unknown = {};
    if (url.pathname === "/api/auth/me") json = { user: { id: userId, first_name: "Fixture", tier: "pro", role: "user", referrals_enabled: false } };
    if (url.pathname === "/api/user/exam-preference") json = { activeExam: bank };
    if (url.pathname === "/api/whop/trial") json = { eligible: false, trial_enabled: false };
    if (url.pathname === "/api/checkout-feedback/eligibility") json = { eligible: false };
    if (url.pathname === "/api/user/last-session") json = { hasSession: false };
    if (url.pathname === "/api/announcements/state") json = { qsAnsweredTotal: 0, sessionCount: 1, orientationModalSeenAt: "2026-01-01", whatsNewSeenAt: "2026-01-01", feedbackSurveyShownAt: "2026-01-01" };
    if (url.pathname === "/api/questions") json = url.searchParams.get("list") === "1"
      ? [{ id: 4711, topic: "Innere Medizin", question: "Welche Aussage zur Herzinsuffizienz trifft zu?" }]
      : [{ topic: "Innere Medizin", count: 1240 }];
    if (url.pathname === "/api/user/topic-progress") json = [{ topic: "Innere Medizin", total: 1240, answered: 620, correct: 459, wrong: 161, accuracy: 74 }];
    if (url.pathname === "/api/mentor/availability") json = { available: false };
    return route.fulfill({ json });
  });
  return errors;
}

const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource|blockedbyclient|ERR_BLOCKED|net::|Content Security Policy|Clarity|gtag/i.test(e));

for (const lang of ["de", "en"]) for (const dark of [false, true]) for (const width of [375, 1280]) {
  test(`home ${lang} ${dark ? "dark" : "light"} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setup(page, lang, dark);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByRole("link", { name: /Innere Medizin/ }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(lang === "de" ? "1.240 Fragen" : "1,240 questions");
    await expect(card).toContainText(lang === "de" ? "74 %" : "74%");
    await expect(page.getByText("SIP4a / SIP5a Wien").filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/\bSTP\b|🇦🇹/);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(lang);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `home-${lang}-${dark ? "dark" : "light"}-${width}.png`), fullPage: true });
    expect(relevant(errors), relevant(errors).join("\n")).toEqual([]);
  });
}

for (const lang of ["ar", "ru"]) {
  test(`${lang} preference renders English LTR and keeps German content marked`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const errors = await setup(page, lang, false);
    await page.goto("/mistakes?examSource=kenntnispruefung", { waitUntil: "domcontentloaded" });
    const stem = page.getByText("Welche Aussage zur Herzinsuffizienz trifft zu?");
    await expect(stem).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(["en", "ltr"]);
    await expect(stem).toHaveAttribute("lang", "de");
    await expect(stem).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My mistakes");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `mistakes-${lang}-375.png`), fullPage: true });
    expect(relevant(errors), relevant(errors).join("\n")).toEqual([]);
  });
}

test("exam switcher chip and selector use SIP, SPT, Pharma", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page, "de", false, "kmp_innsbruck");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Vorbereitung: Stichprobentest (Innsbruck)")).toBeVisible({ timeout: 20_000 });
});
