import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * a35 pre-sitting release smoke (LX-17, LX-32, TR-19 and the per-surface
 * go/no-go for the 5 Nov learner release).
 *
 * Synthetic only: the server must be built with NEXT_PUBLIC_SUPABASE_URL
 * pointing at tests/e2e/master-plan/release/supabase-stand-in.mjs, every
 * browser /api call is fulfilled below and every non-local host is aborted,
 * so nothing reaches production, Whop or analytics.
 *
 * Each route is measured at the widths the plan names (320, 375, 390, 768,
 * 1024) plus 1280, in German and English, light and dark. A route passes when
 * the document answers 200, its first heading or question renders, the page
 * scrolls no wider than the viewport (document.documentElement.scrollWidth <=
 * window.innerWidth) and no console or page error appears.
 */

const evidence = process.env.A35_EVIDENCE_DIR;
const USER_ID = "51c5564a-5051-4b9b-8f81-4faf0e368533";

export const PUBLIC_ROUTES = [
  "/landing", "/pricing", "/faq", "/login", "/materials", "/kenntnispruefung-wien", "/stichprobentest",
  "/pharmakologie-pruefung-wien", "/wien-route", "/pruefungskalender", "/exam-formats", "/was-ist-was", "/umfang",
  "/graz-innsbruck", "/gerichtsmedizin", "/korrekturen", "/find-your-path", "/changelog", "/impressum", "/privacy", "/terms",
] as const;
export const LEARNER_ROUTES = [
  "/", "/quiz", "/flashcards", "/exam", "/study-plan", "/progress", "/library", "/settings", "/stats", "/curriculum",
  "/history", "/mistakes", "/referrals", "/checkout/success?tier=first_3mo_49",
] as const;
const ONBOARDING = "onboarding:/";

type Variant = { width: number; height: number; lang: "de" | "en"; dark: boolean };
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "de", dark: true },
  { width: 375, height: 812, lang: "en", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: false },
  { width: 1280, height: 900, lang: "en", dark: true },
  { width: 320, height: 568, lang: "de", dark: false },
  { width: 390, height: 844, lang: "en", dark: false },
  { width: 768, height: 1024, lang: "de", dark: true },
  { width: 1024, height: 768, lang: "en", dark: false },
];
const variantFilter = process.env.A35_VARIANT; // e.g. "375-de-light"
const tag = (v: Variant) => `${v.width}-${v.lang}-${v.dark ? "dark" : "light"}`;

const question = (id: number, topic = "Neurologie", multi = false) => ({
  id, topic, exam_type: "kenntnispruefung", question: `Synthetische Prüfungsfrage ${id}: Welche Aussage trifft zu?`,
  answer: "Antwort A", explanation: "Synthetische Erklärung. Quelle: Fixture.", difficulty: 1, exam_dates: [], tags: [],
  n_correct: multi ? 2 : 1,
  options: ["Antwort A", "Antwort B", "Antwort C", "Antwort D", "Antwort E"].map((text, i) => ({ text, correct: multi ? i < 2 : i === 0 })),
});

type Writes = { path: string; method: string }[];

async function prepare(context: BrowserContext, page: Page, v: Variant, opts: { signedIn: boolean; onboarded?: boolean; tier?: "free" | "pro" }) {
  const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3135").origin;
  if (opts.signedIn) await context.addCookies([{ name: "mp_skip_landing", value: "1", url: origin }]);
  await page.emulateMedia({ colorScheme: v.dark ? "dark" : "light" });
  await page.addInitScript(({ v, signedIn, onboarded, tier, userId }) => {
    try {
      localStorage.setItem("medpruef-lang", v.lang);
      localStorage.setItem("medpruef_theme", v.dark ? "dark" : "light");
      localStorage.setItem("medpruef_cookies", "declined");
      localStorage.setItem("medpruef_survey_v1_completed", "true");
      localStorage.setItem("medpruef_orientation_modal_seen_v2", "1");
      if (signedIn) {
        localStorage.setItem("medpruef_session", JSON.stringify({
          user: { id: userId, email: "release@example.invalid", role: "user", tier, first_name: "Fixture", xp_total: 120, streak_count: 2, daily_goal: 20 },
          gamification: { total_xp: 120, current_streak: 2, total_questions_answered: 40, total_correct: 28, daily_questions_today: 5 },
        }));
        localStorage.setItem("medpruef_session_token", "synthetic-release-token");
        localStorage.setItem("medpruef_active_exam", "kenntnispruefung");
        if (onboarded) localStorage.setItem("medpruef_onboarding", JSON.stringify({ completedAt: "2026-01-01T00:00:00Z", examSource: "kenntnispruefung" }));
      }
    } catch { /* storage blocked: the page must still render */ }
  }, { v, signedIn: opts.signedIn, onboarded: opts.onboarded ?? true, tier: opts.tier ?? "pro", userId: USER_ID });
  const writes: Writes = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort("blockedbyclient");
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (req.method() !== "GET" && req.method() !== "HEAD") writes.push({ path: url.pathname, method: req.method() });
    const { status, body } = apiFixture(url, req.method(), opts);
    return status === 204 ? route.fulfill({ status: 204, body: "" }) : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return writes;
}

/** Synthetic API answers. Unknown routes get an empty object, which every
 * learner region must tolerate (it is what a malformed answer looks like). */
export function apiFixture(url: URL, method: string, opts: { signedIn: boolean; tier?: "free" | "pro" }): { status: number; body: unknown } {
  const p = url.pathname;
  const tier = opts.tier ?? "pro";
  const ok = (body: unknown) => ({ status: 200, body });
  if (!opts.signedIn && (p === "/api/auth/me" || p.startsWith("/api/user/"))) return { status: 401, body: { error: "unauthorized" } };
  if (p === "/api/auth" && method === "POST") return ok({
    user: { id: USER_ID, email: "release@example.invalid", role: "user", tier: "free", first_name: "Fixture" },
    gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
    sessionToken: "synthetic-release-token",
  });
  if (p === "/api/auth/me") return ok({ user: { id: USER_ID, first_name: "Fixture", tier, tier_expires_at: tier === "pro" ? "2027-01-31T00:00:00Z" : null, role: "user", referrals_enabled: true, active_exam: "kenntnispruefung", email: "release@example.invalid" } });
  if (p === "/api/announcements/state") return ok({ state: { userId: USER_ID, sessionCount: 4, qsAnsweredTotal: 40, orientationModalSeenAt: "2026-01-01", cohortBannerDismissedAt: "2026-01-01", referralFloaterDismissedAt: "2026-01-01" } });
  if (p === "/api/user/exam-preference") return ok({ activeExam: "kenntnispruefung", exam_date: null, daily_goal: 20 });
  if (p === "/api/user/onboarding-state") return ok({});
  if (p === "/api/user/last-session") return { status: 204, body: null };
  if (p === "/api/checkout-feedback/eligibility") return ok({ eligible: false });
  if (p === "/api/questions") {
    if (method === "POST") return ok([{ topic: "Neurologie", count: 40 }, { topic: "Kardiologie", count: 30 }]);
    if (url.searchParams.has("countOnly")) return ok({ count: 40 });
    const limit = Math.min(Number(url.searchParams.get("limit") || 1), 20);
    return ok(Array.from({ length: limit }, (_, i) => question(91001 + i, "Neurologie", i === 1)));
  }
  if (p === "/api/answer") return ok({ saved: true, xp: 10, correct: true });
  if (p === "/api/track" || p === "/api/funnel-events" || p === "/api/beacon/landing") return { status: 204, body: null };
  return ok({});
}

type Result = { route: string; variant: string; status: string; scrollWidth?: number; innerWidth?: number; offenders?: string[]; errors?: string[]; writes?: string[] };
const results: Result[] = [];

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|status of 40[13]/.test(text)) return;
    errors.push(text.slice(0, 300));
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err).slice(0, 300)}`));
  return errors;
}

async function measure(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const out = { scrollWidth: 0, innerWidth: 0, offenders: [] as string[] };
  for (const bottom of [false, true]) {
    await page.evaluate((b) => window.scrollTo(0, b ? document.body.scrollHeight : 0), bottom);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const m = await page.evaluate(() => {
      const width = window.innerWidth;
      const offenders = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height || getComputedStyle(el).visibility === "hidden") return false;
        for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(parent).overflowX)) return false;
        }
        return box.right > width + 1 || box.left < -1;
      }).slice(0, 8).map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} [${Math.round(el.getBoundingClientRect().left)},${Math.round(el.getBoundingClientRect().right)}]`);
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth: width, offenders };
    });
    out.scrollWidth = Math.max(out.scrollWidth, m.scrollWidth);
    out.innerWidth = m.innerWidth;
    out.offenders.push(...m.offenders.filter((o) => !out.offenders.includes(o)));
  }
  return out;
}

async function visit(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${route} HTTP status`).toBe(200);
  const target = route.startsWith("/quiz") ? page.locator("[data-question-text]").first() : page.locator("h1").first();
  await target.waitFor({ state: "visible", timeout: 25_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS.filter((x) => !variantFilter || tag(x) === variantFilter)) {
  for (const route of [...PUBLIC_ROUTES, ...LEARNER_ROUTES, ONBOARDING]) {
    test(`${route} fits and renders cleanly (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block", reducedMotion: v.width === 320 ? "reduce" : "no-preference" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      const isPublic = (PUBLIC_ROUTES as readonly string[]).includes(route);
      const isOnboarding = route === ONBOARDING;
      const writes = await prepare(context, page, v, { signedIn: !isPublic, onboarded: !isOnboarding });
      const path_ = isOnboarding ? "/" : isPublic ? `${route}?lang=${v.lang}` : route;
      const result: Result = { route, variant: tag(v), status: "not-measured" };
      try {
        await visit(page, path_);
        const m = await measure(page);
        Object.assign(result, m, { errors, writes: writes.map((w) => `${w.method} ${w.path}`) });
        result.status = m.scrollWidth <= m.innerWidth + 1 && m.offenders.length === 0 && errors.length === 0 ? "passed" : "findings";
        expect.soft(m.scrollWidth, `${route} scrollWidth at ${tag(v)}; offenders ${m.offenders.join(" | ")}`).toBeLessThanOrEqual(m.innerWidth + 1);
        expect.soft(errors, `${route} console errors at ${tag(v)}`).toEqual([]);
      } finally {
        results.push(result);
        await context.close();
      }
    });
  }
}

test("TR-19 / LX-32: landing to the first free question with no card step, under 60 s", async ({ browser }) => {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const opts = { signedIn: false, tier: "free" as const };
  await prepare(context, page, v, opts);
  // After the synthetic sign-up the app behaves as signed in.
  let signedUp = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/api/auth" && req.method() === "POST") signedUp = true;
    const { status, body } = apiFixture(url, req.method(), { signedIn: signedUp, tier: "free" });
    return status === 204 ? route.fulfill({ status: 204, body: "" }) : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  const visited: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
  const started = Date.now();
  await page.goto("/landing?lang=de", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Kostenlos starten/ }).first().click();
  await page.waitForURL(/\/(login|quiz)/, { timeout: 20_000 });
  if (new URL(page.url()).pathname === "/login") {
    const register = page.getByRole("button", { name: "Registrieren", exact: true });
    if ((await register.getAttribute("aria-pressed")) !== "true") await register.click();
    await page.getByLabel("Vorname").fill("Fixture");
    await page.getByLabel("E-Mail", { exact: false }).first().fill("release@example.invalid");
    await page.getByLabel("Passwort", { exact: false }).first().fill("synthetic-pass-1234");
    await page.getByRole("button", { name: "Konto erstellen" }).click();
  }
  // Onboarding may ask for the exam first; pick the Vienna bank if it does.
  const firstQuestion = page.locator("[data-question-text]").first();
  for (let step = 0; step < 6 && !(await firstQuestion.isVisible().catch(() => false)); step++) {
    const exam = page.getByRole("radio", { name: /Kenntnisprüfung|SIP4a/ }).first();
    if (await exam.isVisible().catch(() => false)) await exam.check().catch(() => exam.click());
    const next = page.getByRole("button", { name: /^(Weiter|Los geht|Termin später festlegen|Tagesziel später festlegen|Starten)/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await expect(firstQuestion).toBeVisible({ timeout: 20_000 });
  await page.getByRole("radio").first().click().catch(async () => page.getByRole("checkbox").first().click());
  const elapsed = Date.now() - started;
  const cardFields = await page.locator('input[autocomplete^="cc-"], input[name*="card" i]').count();
  results.push({ route: "flow:landing-to-first-question", variant: tag(v), status: elapsed < 60_000 && cardFields === 0 ? "passed" : "findings", errors, writes: visited });
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(path.join(evidence, "release-flow.json"), JSON.stringify({ checkedAt: new Date().toISOString(), elapsedMs: elapsed, visited, cardFields, errors }, null, 2) + "\n");
  }
  expect(visited.some((p) => /checkout|whop/i.test(p))).toBe(false);
  expect(cardFields).toBe(0);
  expect(elapsed).toBeLessThan(60_000);
  expect(errors).toEqual([]);
  await context.close();
});

function writeEvidence() {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  const file = path.join(evidence, `release-smoke-${process.env.TEST_WORKER_INDEX ?? "0"}.json`);
  writeFileSync(file, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
}

test.afterAll(() => writeEvidence());
