import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";
import type { MentorChatRequest, MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";
import { mentorT } from "../../../src/lib/i18n-mentor";
import { answerCopy } from "../../../src/components/mentor/answer-copy";

// API fakes only, no provider or production writes. Run only through with-heavy.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = { fact_id: "fixture.source", source_label: "Synthetic official office with a long label that must wrap", source_url: "https://example.org/synthetic-official-office", read_on: "2026-10-10", review_every_days: 30 };

async function setup(page: Page, lang: "en" | "de" | "ru" | "uk" | "tr" | "ar" = "en", dark = false) {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
  await seedSession(page, { userId: USER, email: "mentor-fixture@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.removeItem("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da");
  }, { lang, dark });
  await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const fake = {
    final: { ...FIXTURE_FINAL_OK, request_id: REQUEST, answer_blocks: [{ text: "Synthetic backed answer. Stand 2026-10-10", fact_ids: [SOURCE.fact_id] }], citations: [SOURCE] } as MentorFinalEvent,
    requests: [] as MentorChatRequest[],
    reports: [] as Array<Record<string, unknown>>,
  };
  const usage: MentorUsageResponse = { state: "ok", credits_left: 142, messages_left_estimate: 140, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: false };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") return route.fulfill({ json: usage });
    if (path === "/api/mentor/chat") {
      fake.requests.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(fake.final)}\n\n` });
    }
    if (path === "/api/mentor/report") { fake.reports.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (path === "/api/questions") return route.fulfill({ json: [{ id: 5, question: "Synthetic question to report", explanation: "Synthetic explanation", topic: "Synthetic" }] });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  return fake;
}
async function send(page: Page, lang: "en" | "de" | "ru" | "uk" | "tr" | "ar" = "en") {
  await page.getByRole("textbox", { name: mentorT("composer_label", lang) }).fill("Synthetic learner question");
  await page.getByRole("button", { name: mentorT("btn_send", lang), exact: true }).click();
}
async function minTarget(locator: Locator, height = 44) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(height);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

test("MUX-01 source hint opens once per learner, traps focus and returns it to a 44px source chip", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect(page.getByText("Source checked on 10 Oct 2026", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Stand 2026/)).toHaveCount(0);
  const source = page.getByRole("link", { name: /^Synthetic official office/ });
  await minTarget(source);
  await source.click();
  const hint = page.getByRole("dialog", { name: "About this source date" });
  await expect(hint).toBeVisible();
  const close = hint.getByRole("button", { name: "Close" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(hint.getByRole("link", { name: "Open official page" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await expect(source).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da"))).toBe("1");
  const popup = page.waitForEvent("popup");
  await source.click();
  const opened = await popup;
  await opened.close();
  await expect(hint).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("MUX-02,11,42 replacement notice has one label, no raw URL or source chip, and an accessible official action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fake = await setup(page, "ar", true);
  const block = { text: "I can't officially confirm this synthetic information right now. https://example.org/synthetic-official-office", fact_ids: [], replaced: true, official_url: SOURCE.source_url };
  fake.final = { ...fake.final, answer_blocks: [block, block], validator_replaced: true };
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect(page.getByText("Not confirmed", { exact: true })).toHaveCount(1);
  const notice = page.locator('[role="status"]').filter({ hasText: "Not confirmed" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("link", { name: /^Synthetic official office/ })).toHaveCount(0);
  await expect(page.locator("article").last()).not.toContainText("https://");
  const action = notice.getByRole("link", { name: "Open official page" });
  await minTarget(action);
  expect((await action.boundingBox())!.width).toBeGreaterThan(180);
  await expectNoHorizontalScroll(page);
});

test("MUX-55 attached question report opens the existing report modal and restores focus", async ({ page }) => {
  const fake = await setup(page);
  fake.final = { ...fake.final, question_id: 5, citations: [], answer_blocks: [{ text: "Synthetic explanation with a questionable key.", fact_ids: [] }] };
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  const trigger = page.getByRole("button", { name: "Report question", exact: true });
  await minTarget(trigger);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Suggest an edit/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Question text", exact: true })).toHaveValue("Synthetic question to report");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(fake.reports).toHaveLength(0);
});

test("MUX-11 no-source report starts with Other and the starter prepares a study question before Send", async ({ page }) => {
  const fake = await setup(page);
  fake.final = { ...fake.final, refused: "no_verified_source", citations: [], answer_blocks: [{ text: "I cannot confirm this synthetic information.", fact_ids: [] }] };
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  const report = page.getByRole("button", { name: "Report question to the team", exact: true });
  await minTarget(report);
  await report.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("radio", { name: "Other", exact: true })).toBeChecked();
  await sheet.getByRole("button", { name: "Report", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(fake.reports).toEqual([{ request_id: REQUEST, reason: "other" }]);
  await expect(report).toBeFocused();
  await page.getByRole("button", { name: /Try this question.*How can I practise my weakest topic/ }).click();
  await expect(page.getByRole("textbox", { name: "Your message to the Mentor" })).toHaveValue("How can I practise my weakest topic?");
  expect(fake.requests).toHaveLength(1);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => fake.requests.length).toBe(2);
  expect(fake.requests[1].message).toBe("How can I practise my weakest topic?");
  expect(fake.requests[1].mode).toBe("study");
});

for (const lang of ["en", "ru", "uk", "tr"] as const) {
  test(`MUX-01,02 old source text wraps at 360px in ${lang} with an explicit age label`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const fake = await setup(page, lang, true);
    fake.final = { ...fake.final, citations: [{ ...SOURCE, read_on: "2026-10-01", review_every_days: 10 }] };
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await send(page, lang);
    await expect(page.getByText(answerCopy("older", lang), { exact: true })).toBeVisible();
    await expect(page.getByText(answerCopy("older_footer", lang), { exact: true })).toBeVisible();
    const chip = page.getByRole("link", { name: /^Synthetic official office/ });
    await minTarget(chip);
    await expectNoHorizontalScroll(page);
  });
}

test("MUX-56,67 code-owned next actions and study rows are measurable targets with mentor links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fake = await setup(page);
  fake.final = {
    ...fake.final, citations: [], answer_blocks: [{ text: "Synthetic short study rationale.", fact_ids: [] }],
    next_actions: [{ kind: "open_question", question_id: 5 }, { kind: "practice_topic", topic: "Neurologie" }, { kind: "open_flashcards" }],
    plan_items: [{ topic: "Neurologie", accuracy: 36, answered: 25, action: "practice", exam_source: "kenntnispruefung" }],
  };
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  const primary = page.locator("[data-mentor-next-actions]");
  await expect(primary.getByRole("link")).toHaveCount(2);
  await expect(primary.getByRole("link").first()).toHaveText("Practise topic");
  await minTarget(primary.getByRole("link").first());
  await expect(page.getByRole("link", { name: "Open flashcards", exact: true })).not.toBeVisible();
  await primary.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("link", { name: "Open flashcards", exact: true })).toBeVisible();
  const row = page.locator("[data-mentor-plan-row]");
  await minTarget(row, 56);
  await expect(row).toContainText("36% correct");
  await expect(row).toContainText("25 answered");
  const practice = row.getByRole("link", { name: "Practise", exact: true });
  await minTarget(practice);
  await expect(practice).toHaveAttribute("href", /from=mentor/);
  await expect(practice).toHaveAttribute("href", /examSource=kenntnispruefung/);
  await expectNoHorizontalScroll(page);
});
