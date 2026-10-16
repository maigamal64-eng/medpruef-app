/**
 * a-mentor-question-entry-v2 smoke. Needs a build with
 * NEXT_PUBLIC_MENTOR_QUESTION_ENTRY_V2=true (the flag is inlined at build).
 * Stubbed APIs only, no provider or production writes. 375 and 1280, light and
 * dark, DE and EN; no console errors, no horizontal overflow.
 */
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { buildMCQFromChoices } from "../../../src/lib/mcq";

test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "28a172c7-d54d-41d6-8175-4d3053c80deb";
const SHOTS = process.env.QE_V2_SHOTS ?? "tests/e2e/.artifacts/a-mentor-question-entry-v2";
const choices = [
  { text: "Lithium", correct: true, position: 0 },
  { text: "Haloperidol", correct: false, position: 1 },
  { text: "Diazepam", correct: false, position: 2 },
];
const Q = {
  id: 111700, topic: "Psychiatrie", exam_type: "kmp_innsbruck", question: "Welches Medikament ist Mittel der ersten Wahl zur Phasenprophylaxe der bipolaren Störung?",
  answer: "Lithium", explanation: "Lithium senkt das Rückfallrisiko.", exam_dates: [], tags: [], difficulty: 2,
  choices, options: buildMCQFromChoices(choices), n_correct: 1,
};
const BASIS = { package_id: "mentor_basis", kind: "subscription", credits: 150, price_eur_cents: 490, messages_estimate: 150, valid_days: 33, period_days: 30 };
const COPY = {
  de: { wrong: "Warum ist meine Antwort falsch? Mentor fragen", right: "Noch unklar? Vom Mentor Schritt für Schritt erklären lassen", draftWrong: "Warum ist meine Antwort falsch?", prepared: "Ihre Nachricht an den Mentor ist vorbereitet.", packages: "Pakete ansehen", sample: "Beispielantwort ansehen", note: "zählt als eine Nachricht" },
  en: { wrong: "Why is my answer wrong? Ask the mentor", right: "Still unclear? Have the mentor explain it step by step", draftWrong: "Why is my answer wrong?", prepared: "Your message to the mentor is ready.", packages: "See packages", sample: "See a sample answer", note: "counts as one message" },
} as const;

async function setup(page: Page, lang: "de" | "en", dark: boolean, usage: Record<string, unknown> = { state: "none", credits_left: 0, sources: ["none"] }) {
  await seedSession(page, { userId: USER, tier: "free" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_onboarding", JSON.stringify({ completedAt: "2026-10-01" }));
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.setItem("medpruef_exam_source", "kmp_innsbruck");
    localStorage.setItem("medpruef_whats_new_seen", "2026-04-22");
    localStorage.setItem("medpruef_survey_v1_completed", "true");
    localStorage.setItem("medpruef_orientation_modal_seen_v2", "1");
  }, { lang, dark });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.context().route("**/*", (route) => (["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  const tracked: Array<{ type: string; data: Record<string, unknown> }> = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/track") {
      const body = route.request().postDataJSON() as { events?: Array<{ type: string; data: Record<string, unknown> }> } | null;
      for (const e of body?.events ?? []) tracked.push(e);
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/questions" && route.request().method() === "GET") {
      if (url.searchParams.get("countOnly")) return route.fulfill({ json: { count: 13, freeTier: true, limit: 150 } });
      return route.fulfill({ json: [Q] });
    }
    if (path === "/api/answer") return route.fulfill({ json: { saved: true, xp: 10 } });
    if (path === "/api/mentor/availability") return route.fulfill({ json: { available: true } });
    if (path === "/api/mentor/usage") return route.fulfill({ json: { admit_min_credits: 1, messages_left_estimate: 0, next_expiry: null, subscriptions: [], can_buy: true, ...usage } });
    if (path === "/api/mentor/packages") return route.fulfill({ json: { packages: [BASIS] } });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat") return route.abort();
    if (path === "/api/mentor/checkout/verify") return route.fulfill({ json: { status: "granted", credits_added: 150, credits_left: 150 } });
    let json: unknown = {};
    if (path === "/api/auth/me") json = { user: { id: USER, first_name: "Fixture", tier: "free", role: "user" } };
    if (path === "/api/user/exam-preference") json = { activeExam: "kmp_innsbruck", examDate: null };
    if (path === "/api/user/onboarding-state") json = { completed_at: "2026-10-01T00:00:00Z", skipped_at: null };
    if (path === "/api/announcements/state") json = { qsAnsweredTotal: 0, sessionCount: 1, orientationModalSeenAt: "2026-01-01", whatsNewSeenAt: "2026-01-01", feedbackSurveyShownAt: "2026-01-01" };
    return route.fulfill({ json });
  });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED|favicon|clarity|google/i.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { tracked, errors };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const lang of ["de", "en"] as const) for (const dark of [false, true]) for (const width of [375, 1280]) {
  const tag = `${lang}-${dark ? "dark" : "light"}-${width}`;

  test(`wrong answer: one prominent entry with the drafted question ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, lang, dark);
    await page.goto("/quiz?examSource=kmp_innsbruck&topic=Psychiatrie&practiceMode=unseen");
    await page.getByText("Haloperidol").first().click({ timeout: 20_000 });
    const entry = page.getByRole("link", { name: COPY[lang].wrong });
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-mentor-entry]")).toHaveCount(1);
    await expect(page.getByText(COPY[lang].note)).toHaveCount(0);
    const href = await entry.getAttribute("href");
    expect(href).toMatch(/^\/mentor\?mode=explain&question_id=111700&answered=1&selected_option=Haloperidol&q=/);
    expect(new URL(href!, "https://x").searchParams.get("q")).toBe(COPY[lang].draftWrong);
    await expect(page.locator("[data-mentor-entry]").first()).not.toContainText(/€|\d+ ?Credits/);
    expect(await noOverflow(page)).toBe(true);
    await entry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/quiz-wrong-${tag}.png` });
    expect(errors).toEqual([]);
  });

  test(`correct answer: one quiet entry at the end of the Erklärung pane ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, lang, dark);
    await page.goto("/quiz?examSource=kmp_innsbruck&topic=Psychiatrie&practiceMode=unseen");
    await page.getByText("Lithium").first().click({ timeout: 20_000 });
    const entry = page.getByRole("link", { name: COPY[lang].right });
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-mentor-entry]")).toHaveCount(1);
    expect(await entry.getAttribute("href")).toContain("from=explanation");
    expect(await noOverflow(page)).toBe(true);
    await entry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/quiz-right-${tag}.png` });
    expect(errors).toEqual([]);
  });

  test(`0 credits from a question: prepared card, question kept through checkout ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, lang, dark);
    const q = encodeURIComponent(COPY[lang].draftWrong);
    const start = `/mentor?mode=explain&question_id=111700&answered=1&selected_option=Haloperidol&q=${q}&from=question`;
    await page.goto(start, { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-mentor-first-run]");
    await expect(card).toContainText(COPY[lang].prepared, { timeout: 30_000 });
    await expect(card).toContainText("4,90".replace(",", lang === "de" ? "," : "."));
    await expect(page.getByRole("button", { name: COPY[lang].sample })).toHaveCount(0);
    await expect(page.locator("[data-mentor-composer] textarea")).toHaveValue(COPY[lang].draftWrong);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/first-run-${tag}.png` });
    await card.getByRole("link", { name: COPY[lang].packages }).click();
    await page.waitForURL(/\/mentor\/packages/);
    const stored = await page.evaluate((k) => sessionStorage.getItem(k), `medpruef_mentor_${USER}_return`);
    expect(JSON.parse(stored!).href).toBe(start.replace(/q=[^&]*/, `q=${new URLSearchParams({ q: COPY[lang].draftWrong }).toString().slice(2)}`));
    await page.goto("/mentor/checkout/success?checkout_session_id=88888888-8888-4888-8888-888888888888", { waitUntil: "domcontentloaded" });
    const back = page.locator('main a.mp-btn--primary[href^="/mentor"]');
    await expect(back).toHaveAttribute("href", JSON.parse(stored!).href, { timeout: 30_000 });
    expect(await noOverflow(page)).toBe(true);
    await back.click();
    await page.waitForURL(/\/mentor\?mode=explain/);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), `medpruef_mentor_${USER}_return`)).toBeNull();
    await expect(page.locator("[data-mentor-composer] textarea")).toHaveValue(COPY[lang].draftWrong, { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test("a forged return value falls back to /mentor", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await setup(page, "de", false);
  await page.addInitScript((k) => sessionStorage.setItem(k, JSON.stringify({ href: "//evil.example/mentor?mode=explain", at: Date.now() })), `medpruef_mentor_${USER}_return`);
  await page.goto("/mentor/checkout/success?checkout_session_id=88888888-8888-4888-8888-888888888888", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main a.mp-btn--primary").first()).toHaveAttribute("href", "/mentor", { timeout: 30_000 });
});

test("per-question impression carries entry and mode only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { tracked } = await setup(page, "de", false);
  await page.goto("/quiz?examSource=kmp_innsbruck&topic=Psychiatrie&practiceMode=unseen");
  await page.getByText("Haloperidol").first().click({ timeout: 20_000 });
  await expect.poll(() => tracked.filter((e) => e.type === "mentor_entry_shown").length, { timeout: 15_000 }).toBe(1);
  expect(tracked.find((e) => e.type === "mentor_entry_shown")?.data).toEqual({ entry: "question", mode: "explain" });
});
