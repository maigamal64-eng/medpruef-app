import { expect, test, type Browser } from "@playwright/test";
import { USER_ID, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-tg-miniapp-welcome: /tg-welcome opened as a Telegram Mini App. The server
 * under test runs with TG_MINIAPP_WELCOME_ENABLED=true (runtime env). A
 * window.Telegram.WebApp stub stands in for the Telegram client (the real SDK
 * host is aborted by the harness); /api/auth is answered here and the spec
 * checks it receives exactly the stub's initData (server-side verification is
 * covered by tests/unit/a-tg-miniapp-welcome/initdata.test.ts). Local build +
 * stand-in only.
 */

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const INIT_DATA = "query_id=AAF&user=%7B%22id%22%3A4242%2C%22first_name%22%3A%22Fixture%22%7D&auth_date=1800000000&hash=0f0f";
const STARTER = "/quiz?examSource=kmp_innsbruck&ids=91001%2C91002%2C91003&starter=1";

async function open(browser: Browser, v: Variant, opts: { telegram: boolean; hash?: string }) {
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: false });
  if (opts.telegram) {
    await page.addInitScript((initData) => {
      const noop = () => undefined;
      (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData, ready: noop, expand: noop, setHeaderColor: noop, setBackgroundColor: noop } };
    }, INIT_DATA);
  }
  const authBodies: string[] = [];
  const patches: Record<string, unknown>[] = [];
  const events: string[] = [];
  await page.route("**/api/auth", (route) => {
    authBodies.push(route.request().postData() ?? "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      user: { id: USER_ID, telegram_id: 4242, role: "user", tier: "free", first_name: "Fixture", active_exam: null, created_at: new Date().toISOString() },
      gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
      sessionToken: "synthetic-release-token",
    }) });
  });
  await page.route("**/api/auth/me*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    user: { id: USER_ID, first_name: "Fixture", tier: "pro", tier_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), role: "user",
      referrals_enabled: false, active_exam: "kmp_innsbruck", email: null, activation: true,
      reverse_trial: { ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), started: true } },
  }) }));
  await page.route("**/api/activation*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    enabled: true, stage: "starter", exam: "kmp_innsbruck", segment: "stichprobentest", answered: 0, first_win_size: 10, named: true,
    starter: { href: STARTER, ids: [91001, 91002, 91003], translated: null, lang: null }, reminder_hour: 18,
  }) }));
  await page.route("**/api/user/exam-preference", (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ activeExam: "kmp_innsbruck", examDate: null }) });
  });
  await page.route("**/api/track", (route) => {
    events.push(route.request().postData() ?? "");
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(`/tg-welcome?exam=kmp_innsbruck&lang=${v.lang}${opts.hash ?? ""}`, { waitUntil: "domcontentloaded" });
  return { context, page, errors, authBodies, patches, events };
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`tg-welcome ${tag(v)}: signs in with initData, sitting first, then the starter set`, async ({ browser }) => {
    const { context, page, errors, authBodies, patches, events } = await open(browser, v, { telegram: true });
    const de = v.lang === "de";
    await expect(page.getByRole("heading", { level: 1, name: de ? "Wann ist Ihre Prüfung?" : "When is your exam?" })).toBeVisible({ timeout: 25_000 });
    expect(JSON.parse(authBodies[0])).toMatchObject({ initData: "query_id=AAF&user=%7B%22id%22%3A4242%2C%22first_name%22%3A%22Fixture%22%7D&auth_date=1800000000&hash=0f0f" });
    expect(page.url()).not.toMatch(/tg_token|token=/);
    // Nothing is written to the account before the learner taps Continue (a03: a URL exam never silently wins).
    expect(patches).toEqual([]);
    // Official Stichprobentest sittings, each with both publishers' deadlines, and "no date yet".
    const radios = page.getByRole("radio");
    const first = radios.first();
    await expect(first).toContainText("Stichprobentest");
    await expect(first.locator("span.rounded")).toHaveCount(2);
    await expect(page.getByRole("radio", { name: de ? /Ich habe noch keinen Termin/ : /I do not have a date yet/ })).toBeVisible();
    // Official sittings only: no custom-date option here.
    await expect(page.getByRole("radio", { name: /Eigenes Datum|Own date|Custom date/i })).toHaveCount(0);
    let m = await measure(page);
    expect(m.scrollWidth, `${tag(v)} picker width`).toBeLessThanOrEqual(m.innerWidth);
    expect(m.offenders).toEqual([]);
    await page.screenshot({ path: `${EVIDENCE}/tg-miniapp-welcome/${tag(v)}-sitting.png`, fullPage: true });

    await first.click();
    await page.getByRole("button", { name: de ? "Weiter" : "Continue" }).click();
    await expect(page.getByRole("status").filter({ hasText: de ? "Ihr Termin ist gespeichert." : "Your sitting is saved." })).toBeVisible();
    const save = patches.find((p) => "source" in p) as { activeExam: string; examDate: string; source: string };
    expect(save).toMatchObject({ activeExam: "kmp_innsbruck", source: "tg_welcome" });
    expect(save.examDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("link", { name: de ? "Starten Sie mit 10 Fragen" : "Start with 10 questions" })).toHaveAttribute("href", STARTER);
    await expect(page.locator("[data-reverse-trial-banner]")).toBeVisible();
    m = await measure(page);
    expect(m.scrollWidth, `${tag(v)} start width`).toBeLessThanOrEqual(m.innerWidth);
    expect(m.offenders).toEqual([]);
    await page.screenshot({ path: `${EVIDENCE}/tg-miniapp-welcome/${tag(v)}-start.png`, fullPage: true });
    // tg_welcome_open went through the signed tracker.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => events.join("\n"), { timeout: 10_000 }).toContain("tg_welcome_open");
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const width of [375, 1280]) {
  test(`tg-welcome ${width}: outside Telegram it only links to the normal sign-in`, async ({ browser }) => {
    const v: Variant = { width, height: width < 800 ? 812 : 900, lang: "de", dark: false };
    const { context, page, errors, authBodies } = await open(browser, v, { telegram: false });
    const link = page.getByRole("link", { name: "Zur Anmeldung" });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute("href", /\/login\?.*intent=free.*exam=kmp_innsbruck/);
    expect(authBodies).toEqual([]);
    const m = await measure(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("tg-welcome: without the SDK, the signed initData in the launch fragment still signs in, and leaves the address", async ({ browser }) => {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  const hash = `#tgWebAppData=${encodeURIComponent(INIT_DATA)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
  const { context, page, errors, authBodies } = await open(browser, v, { telegram: false, hash });
  await expect(page.getByRole("heading", { level: 1, name: "Wann ist Ihre Prüfung?" })).toBeVisible({ timeout: 25_000 });
  expect(JSON.parse(authBodies[0]).initData).toBe(INIT_DATA);
  expect(page.url()).not.toContain("tgWebAppData");
  expect(errors).toEqual([]);
  await context.close();
});
