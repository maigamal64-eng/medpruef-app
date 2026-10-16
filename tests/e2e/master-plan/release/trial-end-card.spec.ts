import { expect, test, type Page, type Route } from "@playwright/test";
import { USER_ID, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-trial-end-decision smoke. Browser /api calls are synthetic
 * (release-harness); /api/auth/me reports TRIAL_END_CARD_ENABLED and the
 * reverse trial as the server would. Covers: the trial line becomes the card
 * in the last 24 hours (real end, free sample, saved progress, picker, plan
 * with one tap into /pricing), the one-time Home card after the end with a
 * saved sitting and "Später", the card inside the paywall on /exam, and no
 * request or card while the flag is off. 375 and 1280, DE and EN, light and
 * dark; no horizontal page scroll, no console errors.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const READY = { flex_month: true, sitting_pass: true, half_year: false, guarantee_ticket: false };
const TOPICS = [
  { topic: "Innere Medizin", answered: 40, lastCorrectSample: 30, lastCorrectPct: 40 },
  { topic: "Chirurgie", answered: 30, lastCorrectSample: 20, lastCorrectPct: 70 },
  { topic: "Pädiatrie", answered: 20, lastCorrectSample: 15, lastCorrectPct: 75 },
];

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

function me(opts: { flag: boolean; tier: "free" | "pro"; endsAt?: string }) {
  return {
    user: {
      id: USER_ID, first_name: "Fixture", tier: opts.tier, tier_expires_at: opts.tier === "pro" ? opts.endsAt ?? null : null,
      role: "user", referrals_enabled: false, active_exam: "kmp_innsbruck", email: "release@example.invalid",
      trial_end_card: opts.flag,
      ...(opts.endsAt ? { reverse_trial: { ends_at: opts.endsAt, started: false } } : {}),
    },
  };
}

type Seen = { gets: number; events: Array<Record<string, unknown>>; patches: Array<Record<string, unknown>> };

async function routeTrialEnd(page: Page, view: Record<string, unknown> | null, me_: unknown): Promise<Seen> {
  const seen: Seen = { gets: 0, events: [], patches: [] };
  await page.route("**/api/auth/me**", (route) => route.fulfill(json(200, me_)));
  await page.route("**/api/trial-end**", (route: Route) => {
    if (route.request().method() === "POST") { seen.events.push(route.request().postDataJSON()); return route.fulfill(json(200, { ok: true, recorded: true })); }
    seen.gets++;
    return route.fulfill(json(200, view ?? { enabled: true, state: "none" }));
  });
  await page.route("**/api/user/topic-progress**", (route) => route.fulfill(json(200, TOPICS)));
  await page.route("**/api/user/exam-preference**", (route) => {
    if (route.request().method() === "PATCH") seen.patches.push(route.request().postDataJSON());
    return route.fulfill(json(200, { ok: true, activeExam: "kmp_innsbruck", examDate: null }));
  });
  return seen;
}

test.use({ serviceWorkers: "block" });

for (const v of VARIANTS) {
  const de = v.lang === "de";

  test(`last 24 hours: the trial line becomes the card, pick a sitting, one tap to checkout ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    const endsAt = new Date(Date.now() + 10 * 3_600_000).toISOString();
    const seen = await routeTrialEnd(page, {
      enabled: true, state: "last_day", ends_at: endsAt, trial: "auto", exam: "kmp_innsbruck", sitting: null,
      translations: 4, capped: false, home_seen: false, v2: true, guard: false, ready: READY,
    }, me({ flag: true, tier: "pro", endsAt }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-trial-end-card="banner"]');
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(de ? "Ihr Testzugang läuft bis" : "Your trial runs until");
    await expect(card).toContainText(de ? "Danach üben Sie mit der kostenlosen Probe weiter." : "Afterwards you keep practising with the free sample.");
    await expect(card).toContainText(de ? "90 beantwortete Fragen" : "90 answered questions");
    await expect(card).toContainText(de ? "Fächer mit Übungsbedarf: Innere Medizin" : "Subjects to practise more: Innere Medizin");
    await expect(card).toContainText(de ? "4 übersetzte Erklärungen" : "4 translated explanations");
    await expect(card.locator("[data-trial-end-plan]")).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await noOverflow(page, "/ banner card");
    await card.screenshot({ path: `${OUT}/trial-end/banner-${tag(v)}.png` });
    await card.locator("[data-trial-end-picker] input[type=radio]").first().check();
    const plan = card.locator("[data-trial-end-plan]");
    await expect(plan).toBeVisible();
    await expect(plan).toContainText(de ? "Für Ihren Termin:" : "For your sitting:");
    const href = await plan.locator("[data-trial-end-cta]").getAttribute("href");
    expect(href).toMatch(/^\/pricing\?action=(flex-month|sitting-pass)-checkout/);
    // Home may also sync activeExam; the card sends exactly one examDate save.
    expect(seen.patches.filter((b) => "examDate" in b)).toEqual([{ examDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
    await noOverflow(page, "/ banner card with plan");
    await card.screenshot({ path: `${OUT}/trial-end/banner-plan-${tag(v)}.png` });
    await expect.poll(() => seen.events.filter((e) => e.event === "shown").length).toBe(1);
    expect(seen.events[0]).toMatchObject({ event: "shown", surface: "banner", trial: "auto", exam: "kmp_innsbruck" });
    expect(errors, "console errors").toEqual([]);
  });

  test(`after the end: one-time Home card with the saved sitting and Later ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const seen = await routeTrialEnd(page, {
      enabled: true, state: "ended", ends_at: new Date(Date.now() - 5 * 3_600_000).toISOString(), trial: "claim", exam: "kmp_innsbruck",
      sitting: { bank: "kmp_innsbruck", date: "2027-02-03", lastDay: "2027-02-03" },
      translations: null, capped: true, home_seen: false, v2: true, guard: false, ready: READY,
    }, me({ flag: true, tier: "free" }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-trial-end-card="home"]');
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(de ? "Ihr Testzugang ist beendet." : "Your trial has ended.");
    await expect(card).toContainText(de ? "Die kostenlose Probe in dieser Fragenbank ist aufgebraucht." : "The free sample in this question bank is used up.");
    await expect(card).toContainText(de ? "Ihr Fortschritt bleibt gespeichert" : "Your progress stays saved");
    await expect(card).not.toContainText(de ? "übersetzte" : "translated");
    await expect(card.locator("[data-trial-end-sitting]")).toBeVisible();
    await expect(card.locator("[data-trial-end-plan]")).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await noOverflow(page, "/ home card");
    await card.screenshot({ path: `${OUT}/trial-end/home-${tag(v)}.png` });
    await expect.poll(() => seen.events.filter((e) => e.event === "shown" && e.surface === "home").length).toBe(1);
    await card.getByRole("button", { name: de ? "Später" : "Later" }).first().click();
    await expect(card).toHaveCount(0);
    expect(seen.events.some((e) => e.event === "click" && e.target === "later")).toBe(true);
    expect(errors, "console errors").toEqual([]);
  });

  test(`paywall after the end leads with the card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await routeTrialEnd(page, {
      enabled: true, state: "ended", ends_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), trial: "auto", exam: "kmp_innsbruck",
      sitting: null, translations: 2, capped: false, home_seen: true, v2: true, guard: false, ready: READY,
    }, me({ flag: true, tier: "free" }));
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 25_000 });
    const card = dialog.locator('[data-trial-end-card="paywall"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText(de ? "Sie üben mit der kostenlosen Probe weiter." : "You keep practising with the free sample.");
    await noOverflow(page, "/exam paywall card");
    await dialog.screenshot({ path: `${OUT}/trial-end/paywall-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`flag off: no request and no card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const seen = await routeTrialEnd(page, null, me({ flag: false, tier: "free" }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator("[data-trial-end-card]")).toHaveCount(0);
    expect(seen.gets, "trial-end requests while the flag is off").toBe(0);
    expect(errors, "console errors").toEqual([]);
  });
}
