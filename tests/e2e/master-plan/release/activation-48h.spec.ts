import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { USER_ID, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-activation-48h: the first 48 hours. The flag lives on the server and
 * reaches the client through /api/auth/me (activation:true) and
 * /api/activation; both are answered here as the flag-on routes would. Local
 * build + stand-in only. The clock runs: the announcement queue waits
 * SETTLE_MS on Date.now(), which a fixed clock never lets pass.
 */

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const STARTER_IDS = [91001, 91002, 91003, 91004, 91005, 91006, 91007, 91008, 91009, 91010];
const href = (ids: number[]) => `/quiz?examSource=kenntnispruefung&ids=${ids.join("%2C")}&starter=1`;

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date());

function study(phase: "new" | "active", totalAnswered: number) {
  return {
    day: TODAY, streak: totalAnswered > 0 ? 1 : 0, answersToday: totalAnswered, dailyGoal: 20, activeDays7: totalAnswered > 0 ? 1 : 0,
    totalAnswered, lastStudyDate: totalAnswered > 0 ? TODAY : null, daysSinceStudy: totalAnswered > 0 ? 0 : null, phase,
    activeExam: "kenntnispruefung", examDate: null, hitRate: totalAnswered > 0 ? 70 : null,
  };
}

async function open(browser: import("@playwright/test").Browser, v: Variant, opts: {
  activation: Record<string, unknown> | { enabled: false };
  studyPhase?: "new" | "active";
  answered?: number;
  trialEndsAt?: string | null;
  nudge?: Record<string, unknown>;
  tier?: "free" | "pro";
  flag?: boolean;
  path?: string;
}): Promise<{ context: BrowserContext; page: Page; errors: string[]; posts: string[]; asked: string[] }> {
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: true, tier: opts.tier ?? "free" });
  const flag = opts.flag ?? true;
  await page.route("**/api/auth/me*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      study: study(opts.studyPhase ?? "new", opts.answered ?? 0),
      user: {
        id: USER_ID, first_name: "Fixture", tier: opts.trialEndsAt ? "pro" : (opts.tier ?? "free"), tier_expires_at: opts.trialEndsAt ?? null, role: "user",
        referrals_enabled: false, active_exam: "kenntnispruefung", email: "release@example.invalid", activation: flag,
        ...(opts.trialEndsAt ? { reverse_trial: { ends_at: opts.trialEndsAt, started: false } } : {}),
      },
    }),
  }));
  const asked: string[] = [];
  await page.route("**/api/activation*", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.activation) });
  });
  const posts: string[] = [];
  await page.route("**/api/nudge*", (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postData() ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, opt_in: false, confirmation_pending: true, channel: "email", hour: 18 }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.nudge ?? { enabled: false }) });
  });
  await page.goto(opts.path ?? "/", { waitUntil: "domcontentloaded" });
  return { context, page, errors, posts, asked };
}

const view = (over: Record<string, unknown>) => ({
  enabled: true, stage: "starter", window_ends_at: inDays(1), exam: "kenntnispruefung", segment: "vienna_sip",
  answered: 0, first_win_size: 10, named: false, starter: null, reminder_hour: 18, ...over,
});

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`starter on the hero, continue card, trial value line (${tag(v)})`, async ({ browser }) => {
    const translated = v.lang === "en" ? 3 : null;
    // No answer yet: the hero's primary opens the starter set.
    const a = await open(browser, v, {
      activation: view({ stage: "starter", starter: { href: href(STARTER_IDS), ids: STARTER_IDS, translated, lang: v.lang === "en" ? "en" : null } }),
    });
    const primary = a.page.getByTestId("home-primary");
    await expect(primary).toHaveAttribute("href", href(STARTER_IDS), { timeout: 25_000 });
    if (v.lang === "en") await expect(a.page.getByText(/^For 3 of these questions the explanation is already available in English/)).toBeVisible();
    else await expect(a.page.getByText(/maschinell übersetzt/)).toHaveCount(0);
    await expect(a.page.locator("[data-activation='home']")).toHaveCount(0);
    let m = await measure(a.page);
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await a.page.screenshot({ path: `${EVIDENCE}/activation-starter-${tag(v)}.png` });
    expect(a.errors).toEqual([]);
    await a.context.close();

    // 4 answers: the Home card names the 6 left; a running trial shows its value line.
    const rest = STARTER_IDS.slice(4);
    const b = await open(browser, v, {
      studyPhase: "active", answered: 4, trialEndsAt: inDays(3),
      activation: view({ stage: "continue", answered: 4, starter: { href: href(rest), ids: rest, translated: null, lang: null } }),
    });
    const card = b.page.locator("[data-activation='home']");
    await card.waitFor({ state: "visible", timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "Noch 6 Fragen bis zu Ihren ersten 10. Ihr Fortschritt bleibt gespeichert." : "6 more questions to reach your first 10. Your progress stays saved.");
    await expect(card.getByRole("link", { name: v.lang === "de" ? "Weiterüben" : "Keep practising" })).toHaveAttribute("href", href(rest));
    const value = b.page.locator("[data-trial-value]");
    await expect(value).toBeVisible();
    await expect(value.getByRole("link", { name: v.lang === "de" ? "Simulation starten" : "Start a simulation" })).toHaveAttribute("href", "/exam");
    await expect(value.getByRole("link", { name: v.lang === "de" ? "Meine Fehler üben" : "Practise my mistakes" })).toHaveAttribute("href", "/mistakes");
    await expect(card).not.toContainText(/€|EUR/);
    m = await measure(b.page);
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await b.page.screenshot({ path: `${EVIDENCE}/activation-continue-${tag(v)}.png` });
    expect(b.errors).toEqual([]);
    await b.context.close();
  });

  test(`after the first 10: exam date step and reminder opt-in (${tag(v)})`, async ({ browser }) => {
    const c = await open(browser, v, {
      studyPhase: "active", answered: 10,
      activation: view({ stage: "after_win", answered: 10, named: false }),
      nudge: { enabled: true, opt_in: false, channel: "email", hour: 9, confirmation_pending: false, email_available: true, telegram_available: false },
    });
    const card = c.page.locator("[data-activation='home']");
    await card.waitFor({ state: "visible", timeout: 25_000 });
    await expect(card.getByRole("heading")).toHaveText(v.lang === "de" ? "Ihre ersten 10 Fragen sind geschafft." : "You have answered your first 10 questions.");
    await expect(card.getByRole("link", { name: v.lang === "de" ? "Prüfungstermin festlegen" : "Set exam date" })).toHaveAttribute("href", "/settings#exam-date");
    const reminder = card.locator("[data-activation='reminder']");
    await expect(reminder).toContainText(v.lang === "de" ? "höchstens eine E-Mail am Tag um 18 Uhr (Wiener Zeit)" : "at 18:00 (Vienna time)");
    const m = await measure(c.page);
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await c.page.screenshot({ path: `${EVIDENCE}/activation-win-home-${tag(v)}.png` });
    await reminder.getByRole("button", { name: v.lang === "de" ? "Erinnerung einrichten" : "Set up reminder" }).click();
    await expect(reminder.getByRole("status")).toHaveText(v.lang === "de" ? "Bitte bestätigen Sie den Link in Ihrem Postfach." : "Please confirm the link in your inbox.");
    expect(c.posts.map((p) => JSON.parse(p))).toEqual([{ opt_in: true, channel: "email", hour: 18 }]);
    expect(c.errors).toEqual([]);
    await c.context.close();
  });
}

for (const lang of ["de", "en"] as const) {
  test(`quiz round end of a starter round names the first win and the plan (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: false };
    const q = await open(browser, v, {
      studyPhase: "active", answered: 9, tier: "pro",
      activation: view({ stage: "after_win", answered: 10, named: true }),
      path: "/quiz?examSource=kenntnispruefung&ids=91001&starter=1",
    });
    await q.page.getByRole("button", { name: /Antwort A/ }).first().click({ timeout: 25_000 });
    await q.page.getByRole("button", { name: lang === "de" ? /Nächste Frage|Ergebnis|Abschließen|beenden/i : /Next question|Result|Finish/ }).first().click();
    const win = q.page.locator("[data-activation='first-win']");
    await win.waitFor({ state: "visible", timeout: 25_000 });
    await expect(win).toContainText(lang === "de" ? "Ihre ersten 10 Fragen sind geschafft." : "You have answered your first 10 questions.");
    await expect(win.getByRole("link", { name: lang === "de" ? "Lernplan ansehen" : "View study plan" })).toHaveAttribute("href", "/study-plan");
    // The sender is off in this fixture: no reminder offer is shown.
    await expect(win.locator("[data-activation='reminder']")).toHaveCount(0);
    const m = await measure(q.page);
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await win.scrollIntoViewIfNeeded();
    await q.page.screenshot({ path: `${EVIDENCE}/activation-first-win-${lang}.png` });
    expect(q.errors).toEqual([]);
    await q.context.close();
  });

  test(`flag off: no request to /api/activation and no path surface (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: false };
    const off = await open(browser, v, { flag: false, activation: { enabled: false }, trialEndsAt: inDays(3) });
    await expect(off.page.getByTestId("home-primary")).toBeVisible({ timeout: 25_000 });
    await off.page.waitForTimeout(2_000);
    expect(off.asked).toEqual([]);
    await expect(off.page.locator("[data-activation], [data-trial-value]")).toHaveCount(0);
    expect(await off.page.getByTestId("home-primary").getAttribute("href")).not.toContain("starter=1");
    expect(off.errors).toEqual([]);
    await off.context.close();
  });
}
