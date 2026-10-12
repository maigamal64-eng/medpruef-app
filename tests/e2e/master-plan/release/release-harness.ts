import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Shared harness of the a35 release smoke and the a-narrow-320 guard:
 * local-origin fence, synthetic session and API answers, error tracking and
 * the layout measurement. Synthetic only: the server must be built with
 * NEXT_PUBLIC_SUPABASE_URL pointing at supabase-stand-in.mjs, every browser
 * /api call is fulfilled here and every non-local host is aborted.
 */

// Local only, enforced at load so the root config cannot aim this spec at a
// preview or production URL.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):(\d{4,5})$/;
export const BASE = process.env.BASE_URL ?? "";
export const STAND_IN = process.env.A35_STANDIN_URL ?? "http://127.0.0.1:54398";
if (!LOCAL.test(BASE) || !LOCAL.test(STAND_IN)) throw new Error("BASE_URL and A35_STANDIN_URL must be local origins");
export const USER_ID = "51c5564a-5051-4b9b-8f81-4faf0e368533";

export type Variant = { width: number; height: number; lang: "de" | "en"; dark: boolean };
export const tag = (v: Variant) => `${v.width}-${v.lang}-${v.dark ? "dark" : "light"}`;

const question = (id: number, topic = "Neurologie", multi = false) => ({
  id, topic, exam_type: "kenntnispruefung", question: `Synthetische Prüfungsfrage ${id}: Welche Aussage trifft zu?`,
  answer: "Antwort A", explanation: "Synthetische Erklärung. Quelle: Fixture.", difficulty: 1, exam_dates: [], tags: [],
  n_correct: multi ? 2 : 1,
  options: ["Antwort A", "Antwort B", "Antwort C", "Antwort D", "Antwort E"].map((text, i) => ({ text, correct: multi ? i < 2 : i === 0 })),
});

export type Writes = { path: string; method: string }[];

export async function prepare(context: BrowserContext, page: Page, v: Variant, opts: { signedIn: boolean; onboarded?: boolean; tier?: "free" | "pro" }) {
  const origin = new URL(BASE).origin;
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
  if (p === "/api/stats") return ok({
    gamification: { total_xp: 120, current_streak: 2, longest_streak: 3, total_questions_answered: 40, total_correct: 28, level: 2, rank_name: "Famulant", daily_questions_today: 5 },
    topicStats: { Neurologie: { total: 24, correct: 17 }, Kardiologie: { total: 16, correct: 11 } },
  });
  if (p === "/api/user/topic-progress") return ok([
    { topic: "Neurologie", total: 420, answered: 24, accuracy: 71 },
    { topic: "Kardiologie", total: 380, answered: 16, accuracy: 69 },
    { topic: "Chirurgische Fächer", total: 510, answered: 0, accuracy: null },
  ]);
  if (p === "/api/user/study-plan") return ok({ hasExamDate: false, plan: null });
  if (p === "/api/track" || p === "/api/funnel-events" || p === "/api/beacon/landing") return { status: 204, body: null };
  return ok({});
}

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Only requests this spec aborts on purpose (other hosts) and the 401/403
    // a signed-out page gets are expected; a first-party 404 or 500 counts.
    if (/ERR_BLOCKED_BY_CLIENT|status of 40[13]\b/.test(text)) return;
    errors.push(text.slice(0, 300));
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err).slice(0, 300)}`));
  return errors;
}

export async function measure(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const out = { scrollWidth: 0, innerWidth: 0, offenders: [] as string[], fixedInFlow: [] as string[] };
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
      // An element styled `fixed` that computes to another position sits in
      // the page flow (the a35 feedback-launcher regression).
      const fixedInFlow = [...document.querySelectorAll<HTMLElement>("[class~='fixed']")]
        .filter((el) => getComputedStyle(el).display !== "none" && getComputedStyle(el).position !== "fixed")
        .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? ""}`.trim());
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth: width, offenders, fixedInFlow };
    });
    out.scrollWidth = Math.max(out.scrollWidth, m.scrollWidth);
    out.innerWidth = m.innerWidth;
    out.offenders.push(...m.offenders.filter((o) => !out.offenders.includes(o)));
    out.fixedInFlow.push(...m.fixedInFlow.filter((o) => !out.fixedInFlow.includes(o)));
  }
  return out;
}

export async function visit(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${route} HTTP status`).toBe(200);
  // A learner region that cannot read its data shows an alert instead of its
  // heading; that still has to fit, so it counts as rendered.
  const target = route.startsWith("/quiz") ? page.locator("[data-question-text]").first() : page.locator("h1, [role=alert]").first();
  await target.waitFor({ state: "visible", timeout: 25_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

/** Preflight for every spec of this config: the server under test must read
 * the Supabase stand-in, never a real project, for its server-side renders. */
export async function assertStandIn(request: APIRequestContext) {
  const before = (await (await request.get(`${STAND_IN}/__a35/hits`)).json()).hits as number;
  await request.get(`${BASE}/api/questions?examSource=kenntnispruefung&limit=1`);
  const after = (await (await request.get(`${STAND_IN}/__a35/hits`)).json()).hits as number;
  if (after <= before) throw new Error("The server under test did not query the Supabase stand-in; rebuild it with NEXT_PUBLIC_SUPABASE_URL set to the stand-in");
}
