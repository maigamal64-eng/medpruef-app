import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";
import type { MentorFinalEvent, MentorSseEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";
import { mentorT } from "../../../src/lib/i18n-mentor";
import { ARABIC_NOTICE_EN, CONCEPT_REFUSAL_LINES, PRACTICE_POINTER_HREF } from "../../../src/lib/mentor/rulings-1017";

// a-mentor-fix-rulings (CEO rulings 17 Oct): the UC13 practice pointer, the English Arabic notice and
// an outage notice in the asked language, on API fakes only. Run only through with-heavy.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const SHOTS = process.env.MENTOR_RULINGS_SHOTS;
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
type Lang = "en" | "de";

const conceptFinal = (lang: Lang): MentorFinalEvent => ({
  ...FIXTURE_FINAL_OK, result: "refusal", charged: false, credits_used: 0, refused: "no_verified_source", practice_pointer: true,
  answer_blocks: [{ text: CONCEPT_REFUSAL_LINES[lang], fact_ids: [] }], citations: [], next_actions: [],
} as MentorFinalEvent);
const arabicFinal = (): MentorFinalEvent => ({ ...FIXTURE_FINAL_OK, lead_notice: "arabic_english" } as MentorFinalEvent);
const outage: MentorSseEvent = { type: "error", error: "upstream_error", credits_deducted: false };

async function setup(page: Page, opts: { lang: Lang; dark: boolean; answerLang?: string; frames: MentorSseEvent[] }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    if (/Failed to load resource/.test(m.text()) && url && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return;
    errors.push(m.text());
  });
  await page.clock.setFixedTime(new Date("2026-10-17T12:00:00Z"));
  await seedSession(page, { userId: USER, email: "mentor-fixture@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark, answerLang }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.setItem("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da", "1");
    if (answerLang) localStorage.setItem("medpruef_mentor_answer_lang", answerLang);
  }, { lang: opts.lang, dark: opts.dark, answerLang: opts.answerLang ?? null });
  await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const usage: MentorUsageResponse = { state: "ok", credits_left: 141, messages_left_estimate: 140, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: false };
  const sent: Array<{ lang?: string }> = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") return route.fulfill({ json: usage });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat") { sent.push(route.request().postDataJSON()); return route.fulfill({ contentType: "text/event-stream", body: opts.frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") }); }
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  return { errors, sent };
}

async function ask(page: Page, lang: Lang, text: string) {
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: mentorT("composer_label", lang) }).fill(text);
  await page.getByRole("button", { name: mentorT("btn_send", lang), exact: true }).click();
}

async function noOverflow(page: Page, width: number) {
  await expectNoHorizontalScroll(page);
  const sw = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(sw).toBeLessThanOrEqual(width);
}

for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
  for (const lang of ["de", "en"] as const) {
    for (const dark of [false, true]) {
      const tag = `${vp.width} ${lang} ${dark ? "dark" : "light"}`;

      test(`UC13 practice pointer ${tag}`, async ({ page }) => {
        await page.setViewportSize(vp);
        const { errors } = await setup(page, { lang, dark, answerLang: lang, frames: [conceptFinal(lang)] });
        await ask(page, lang, lang === "de" ? "Erklären Sie mir die Nebenwirkungen von ACE-Hemmern." : "Explain the side effects of ACE inhibitors.");
        const card = page.locator("[data-mentor-practice-pointer]");
        await expect(card).toBeVisible();
        await expect(page.locator("[role=log]")).toContainText(CONCEPT_REFUSAL_LINES[lang]);
        const link = card.getByRole("link", { name: lang === "de" ? "Fragen nach Fachgebiet üben" : "Practise questions by subject" });
        await expect(link).toHaveAttribute("href", PRACTICE_POINTER_HREF);
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await noOverflow(page, vp.width);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/uc13-${vp.width}-${lang}-${dark ? "dark" : "light"}.png` });
        expect(errors).toEqual([]);
      });

      test(`outage notice in the asked language ${tag}`, async ({ page }) => {
        await page.setViewportSize(vp);
        const other: Lang = lang === "de" ? "en" : "de";
        const { errors, sent } = await setup(page, { lang, dark, answerLang: other, frames: [outage] });
        await ask(page, lang, "Wann?");
        const notice = page.locator("[data-mentor-system-notice]");
        await expect(notice).toBeVisible();
        await expect(notice).toHaveAttribute("lang", other);
        await expect(notice).toContainText(mentorT("err_upstream_error", other));
        await expect(notice).not.toContainText(mentorT("err_upstream_error", lang));
        expect(sent[0]?.lang).toBe(other);
        await noOverflow(page, vp.width);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/outage-${vp.width}-${lang}-${dark ? "dark" : "light"}.png` });
        expect(errors).toEqual([]);
      });
    }
  }

  test(`Arabic notice first, in English ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const { errors } = await setup(page, { lang: "en", dark: false, answerLang: "en", frames: [arabicFinal()] });
    await ask(page, "en", "متى التسجيل؟");
    const log = page.locator("[role=log]");
    await expect(log).toContainText(ARABIC_NOTICE_EN);
    await expect(page.locator("[data-mentor-lead-notice]")).toHaveAttribute("lang", "en");
    const order = await log.evaluate((el, notice) => el.textContent!.indexOf(notice), ARABIC_NOTICE_EN);
    const answer = await log.evaluate((el, t) => el.textContent!.indexOf(t), FIXTURE_FINAL_OK.answer_blocks[0].text.slice(0, 20));
    expect(order).toBeGreaterThanOrEqual(0);
    expect(order).toBeLessThan(answer);
    await noOverflow(page, vp.width);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/arabic-${vp.width}.png` });
    expect(errors).toEqual([]);
  });
}
