import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { USER_ID, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-feedback-at-pause: the one optional question on the quiz round-end card.
 * FEEDBACK_ASK_ENABLED is a server flag; it reaches the client through
 * /api/auth/me (feedback_ask:true) and /api/feedback/ask, both answered here
 * as the flag-on routes would. Local build + stand-in only, synthetic APIs.
 */

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const IDS = [91001, 91003, 91005];
const PATH = `/quiz?examSource=kenntnispruefung&ids=${IDS.join("%2C")}`;
const COPY = {
  de: { question: "Eine kurze Frage zum Schluss: Was würde Ihnen beim Lernen mit MedPrüf am meisten helfen?", hint: "Freiwillig. Wir lesen jede Antwort.", send: "Antwort senden", skip: "Überspringen", thanks: "Danke für Ihre Antwort.", tooShort: "Bitte schreiben Sie mindestens 3 Zeichen.", region: "Kurze Frage" },
  en: { question: "One short question to finish: what would help you most when studying with MedPrüf?", hint: "Optional. We read every answer.", send: "Send answer", skip: "Skip", thanks: "Thank you for your answer.", tooShort: "Please write at least 3 characters.", region: "Short question" },
};

const single = (id: number) => ({
  id, topic: "Neurologie", exam_type: "kenntnispruefung", question: `Synthetische Prüfungsfrage ${id}: Welche Aussage trifft zu?`,
  answer: "Antwort A", explanation: "Synthetische Erklärung. Quelle: Fixture.", difficulty: 1, exam_dates: [], tags: [], n_correct: 1,
  options: ["Antwort A", "Antwort B", "Antwort C", "Antwort D", "Antwort E"].map((text, i) => ({ text, correct: i === 0 })),
});

async function open(browser: Browser, v: Variant, opts: { flag: boolean; show?: boolean }): Promise<{
  context: BrowserContext; page: Page; errors: string[]; asks: string[]; feedback: Array<Record<string, unknown>>;
}> {
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
  await page.route("**/api/auth/me*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    user: { id: USER_ID, first_name: "Fixture", tier: "pro", tier_expires_at: "2027-01-31T00:00:00Z", role: "user", referrals_enabled: false, active_exam: "kenntnispruefung", email: "release@example.invalid", onboarding_completed_at: "2026-10-01T00:00:00Z", feedback_ask: opts.flag },
  }) }));
  await page.route("**/api/questions*", (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() !== "GET" || url.searchParams.has("countOnly")) return r.fallback();
    const ids = (url.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => n > 0);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ids.length ? [single(ids[0])] : []) });
  });
  const asks: string[] = [];
  await page.route("**/api/feedback/ask*", (r) => {
    asks.push(r.request().method());
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.flag ? { enabled: true, show: opts.show ?? true } : { enabled: false, show: false }) });
  });
  const feedback: Array<Record<string, unknown>> = [];
  await page.route("**/api/feedback", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    feedback.push(JSON.parse(r.request().postData() ?? "{}"));
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  return { context, page, errors, asks, feedback };
}

async function finishRound(page: Page, lang: "de" | "en") {
  for (let i = 0; i < IDS.length; i++) {
    await page.getByRole("button", { name: /Antwort A/ }).first().click({ timeout: 25_000 });
    await page.getByRole("button", { name: lang === "de" ? /Nächste Frage|Ergebnis|Abschließen|beenden/i : /Next question|Result|Finish/i }).first().click({ timeout: 15_000 });
  }
  await expect(page.getByRole("button", { name: lang === "de" ? "Neues Quiz starten" : "Start new quiz" })).toBeVisible({ timeout: 25_000 });
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`round end shows the one optional question and sends the answer ${tag(v)}`, async ({ browser }) => {
    const c = COPY[v.lang];
    const q = await open(browser, v, { flag: true });
    await finishRound(q.page, v.lang);
    const ask = q.page.getByTestId("round-end-ask");
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await expect(ask).toHaveAttribute("aria-label", c.region);
    await expect(ask.getByLabel(c.question)).toBeVisible();
    await expect(ask).toContainText(c.hint);
    // Never a modal, never steals focus.
    await expect(q.page.getByRole("dialog")).toHaveCount(0);
    await expect(ask.getByLabel(c.question)).not.toBeFocused();
    expect(q.asks).toEqual(["GET", "POST"]);
    for (const name of [c.send, c.skip]) {
      expect((await ask.getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(43);
    }
    const m = await measure(q.page);
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await ask.scrollIntoViewIfNeeded();
    await q.page.screenshot({ path: `${EVIDENCE}/feedback-at-pause/ask-${tag(v)}.png` });

    // Too short: stays, nothing sent.
    await ask.getByLabel(c.question).fill("ok");
    await ask.getByRole("button", { name: c.send }).click();
    await expect(ask).toContainText(c.tooShort);
    expect(q.feedback).toEqual([]);

    await ask.getByLabel(c.question).fill("Mehr Erklärungen zu Bildern");
    await ask.getByRole("button", { name: c.send }).click();
    await expect(ask).toContainText(c.thanks);
    expect(q.feedback).toHaveLength(1);
    expect(q.feedback[0]).toMatchObject({ message: "Mehr Erklärungen zu Bildern", context: { source: "round_end_ask", surface: "round_end", exam_type: "kenntnispruefung", url: "/quiz" } });
    await q.page.screenshot({ path: `${EVIDENCE}/feedback-at-pause/thanks-${tag(v)}.png` });
    expect(q.errors, "console errors").toEqual([]);
    await q.context.close();
  });
}

for (const lang of ["de", "en"] as const) {
  test(`skip hides the question without sending (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: false };
    const q = await open(browser, v, { flag: true });
    await finishRound(q.page, lang);
    const ask = q.page.getByTestId("round-end-ask");
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await ask.getByRole("button", { name: COPY[lang].skip }).click();
    await expect(ask).toHaveCount(0);
    expect(q.feedback).toEqual([]);
    expect(q.errors).toEqual([]);
    await q.context.close();
  });

  test(`server refuses (14 days or sitting week): no question and no claim (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 1280, height: 900, lang, dark: true };
    const q = await open(browser, v, { flag: true, show: false });
    await finishRound(q.page, lang);
    await q.page.waitForTimeout(3_000);
    await expect(q.page.getByTestId("round-end-ask")).toHaveCount(0);
    expect(q.asks).toEqual(["GET"]);
    expect(q.errors).toEqual([]);
    await q.context.close();
  });

  test(`flag off: no request to /api/feedback/ask and no question (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: true };
    const q = await open(browser, v, { flag: false });
    await finishRound(q.page, lang);
    await q.page.waitForTimeout(3_000);
    await expect(q.page.getByTestId("round-end-ask")).toHaveCount(0);
    expect(q.asks).toEqual([]);
    expect(q.errors).toEqual([]);
    await q.context.close();
  });

  test(`never during a quiz: nothing before the round ends (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 1280, height: 900, lang, dark: false };
    const q = await open(browser, v, { flag: true });
    await q.page.getByRole("button", { name: /Antwort A/ }).first().click({ timeout: 25_000 });
    await q.page.waitForTimeout(2_500);
    await expect(q.page.getByTestId("round-end-ask")).toHaveCount(0);
    expect(q.asks).toEqual([]);
    await q.context.close();
  });
}
