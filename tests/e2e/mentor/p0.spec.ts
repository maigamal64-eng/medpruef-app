import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_PACKAGES, FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";
import type { MentorChatRequest, MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";

// Local route fakes only. No flag changes, provider calls, live eval or DB writes.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const baseUsage = (): MentorUsageResponse => ({ state: "ok", credits_left: 12, messages_left_estimate: 12, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: true });

async function setup(page: Page, lang: "de" | "en" | "ru" | "uk" | "ar" = "en", dark = false) {
  await seedSession(page, { userId: USER, email: "mentor-fixture@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.removeItem("medpruef_mentor_credit_arrivals");
  }, { lang, dark });
  await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const fake = {
    usage: baseUsage(),
    final: { ...FIXTURE_FINAL_OK, request_id: REQUEST, answer_blocks: [{ text: "Synthetic answer to this learner message.", fact_ids: [] }], citations: [] } as MentorFinalEvent,
    chatError: false,
    inProgress: false,
    resultCalls: 0,
    chatRequests: [] as MentorChatRequest[],
    reportRequests: [] as Array<Record<string, unknown>>,
    checkoutRequests: [] as Array<Record<string, unknown>>,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/mentor/usage") return route.fulfill({ json: fake.usage });
    if (path === "/api/mentor/packages") return route.fulfill({ json: FIXTURE_PACKAGES });
    if (path === "/api/mentor/chat/result") {
      fake.resultCalls++;
      return route.fulfill({ json: fake.resultCalls === 1 ? { status: "in_progress" } : { status: "complete", final: fake.final } });
    }
    if (path === "/api/mentor/chat") {
      fake.chatRequests.push(route.request().postDataJSON() as MentorChatRequest);
      if (fake.chatError) fake.usage = { ...fake.usage, state: "resting", reason: "paused", resting_until: null, can_buy: false };
      const event = fake.chatError ? { type: "error", error: "ai_disabled" } : fake.inProgress ? { type: "in_progress", client_request_id: fake.chatRequests.at(-1)!.client_request_id } : fake.final;
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(event)}\n\n` });
    }
    if (path === "/api/mentor/report") { fake.reportRequests.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (path === "/api/mentor/checkout") { fake.checkoutRequests.push(route.request().postDataJSON()); return route.fulfill({ status: 409, json: { error: "pending_purchase" } }); }
    if (path === "/api/mentor/checkout/verify") return route.fulfill({ json: { status: "granted", credits_left: 162, credits_added: 150 } });
    if (path === "/api/questions") return route.fulfill({ json: [{ id: 5, question: "Synthetic exam question", explanation: "Synthetic explanation", topic: "Synthetic" }] });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  return fake;
}

async function target44(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}
async function send(page: Page, text = "Synthetic learner message") {
  await page.getByRole("textbox", { name: "Your message to the Mentor" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("MUX-13 patient safety hotlines are fixed, 44px and LTR in an Arabic dark UI", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const fake = await setup(page, "ar", true);
  fake.final = { ...fake.final, refused: "patient_advice", refusal_link: "https://www.aerztekammer.at/", validator_replaced: true };
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  for (const phone of ["1450", "144"]) {
    const link = page.locator(`a[href="tel:${phone}"]`);
    await expect(link).toBeVisible();
    await target44(link);
    await expect(link.locator("..")).toHaveAttribute("dir", "ltr");
  }
  await expect(page.getByText("If you have symptoms yourself in Austria", { exact: false })).toBeVisible();
  await expect(page.locator('a[href*="aerztekammer"]')).toHaveCount(0);
  await expect(page.getByText("A number or date could not be confirmed", { exact: false })).toHaveCount(0);
});

test("MUX-54 report reasons have 44px targets, trap focus and return it to the named answer control", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const fake = await setup(page);
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  const trigger = page.getByRole("button", { name: /^Report answer: Synthetic answer/ });
  await target44(trigger);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Wrong or outdated? Report" });
  await expect(dialog).toBeVisible();
  const radios = dialog.getByRole("radio");
  await expect(radios).toHaveCount(5);
  for (let i = 0; i < 5; i++) await target44(radios.nth(i).locator(".."));
  await dialog.getByRole("radio", { name: "Date wrong" }).check();
  const submit = dialog.getByRole("button", { name: "Report", exact: true });
  await submit.focus(); await page.keyboard.press("Tab"); await expect(radios.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(submit).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(800, 0);
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Thanks. We'll check the source." })).toBeVisible();
  expect(fake.reportRequests).toEqual([{ request_id: REQUEST, reason: "date_wrong" }]);
});

test("MUX-54 a question/solution report also opens the existing question modal", async ({ page }) => {
  const fake = await setup(page); fake.final.question_id = 5;
  await page.goto("/mentor?question_id=5", { waitUntil: "domcontentloaded" });
  await send(page);
  await page.getByRole("button", { name: /^Report answer:/ }).click();
  const sheet = page.getByRole("dialog", { name: "Wrong or outdated? Report" });
  await sheet.getByRole("radio", { name: "Question or answer looks wrong" }).check();
  await sheet.getByRole("button", { name: "Report", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const questionDialog = page.getByRole("dialog");
  await expect(questionDialog).toBeVisible();
  await questionDialog.getByRole("button", { name: /Suggest an edit/ }).click();
  await expect(questionDialog.getByRole("textbox", { name: "Question text" })).toHaveValue("Synthetic exam question");
  expect(fake.reportRequests[0].reason).toBe("question_wrong");
});

test("MUX-35 an in-progress response polls the original UUID without another POST", async ({ page }) => {
  const fake = await setup(page); fake.inProgress = true;
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect(page.getByRole("status").filter({ hasText: "Your answer is still being written" })).toBeVisible();
  await expect(page.getByText("Synthetic answer to this learner message.", { exact: true })).toBeVisible();
  expect(fake.chatRequests).toHaveLength(1);
  expect(fake.chatRequests[0].client_request_id).toMatch(/^[\da-f-]{36}$/i);
  expect(fake.resultCalls).toBe(2);
});

test("MUX-30 an AI pause closes the composer and preserves the previous thread", async ({ page }) => {
  const fake = await setup(page);
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page, "First learner message");
  await expect(page.getByText("Synthetic answer to this learner message.", { exact: true })).toBeVisible();
  fake.chatError = true;
  await send(page, "Second learner message");
  await expect(page.getByRole("textbox", { name: "Your message to the Mentor" })).toHaveAttribute("readonly", "");
  await expect(page.getByText("First learner message", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic answer to this learner message.", { exact: true })).toBeVisible();
  await expect(page.getByText("The mentor is paused for now. Your credits are kept.", { exact: true }).last()).toBeVisible();
});

test("MUX-30 the paused state reaches chat and navigation within 60s", async ({ page }) => {
  await page.clock.install();
  const fake = await setup(page);
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Your message to the Mentor" })).toBeEnabled();
  fake.usage = { ...fake.usage, state: "resting", reason: "paused", can_buy: false };
  await page.clock.runFor(60_000);
  await expect(page.getByRole("textbox", { name: "Your message to the Mentor" })).toHaveAttribute("readonly", "");
  await expect(page.locator('a[href="/mentor"]').first()).toBeVisible();
});

for (const lang of ["ru", "uk"] as const) test(`MUX-74 terms wrap at 360px in ${lang}`, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await setup(page, lang);
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  const buy = page.getByRole("button", { name: lang === "ru" ? /^Оформить подписку,/ : /^Оформити підписку,/ }).first();
  await expect(buy).toBeVisible();
  await target44(buy);
  const once = page.getByRole("button", { name: lang === "ru" ? /^Купить один раз,/ : /^Купити один раз,/ });
  await expect(once).toBeVisible();
  await target44(once);
  await expect(page.getByText(lang === "ru" ? "Для оплаты вы перейдёте на Whop, а затем вернётесь сюда." : "Для оплати ви перейдете на Whop, а потім повернетеся сюди.", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const fits = await buy.evaluate((b) => b.scrollWidth <= b.clientWidth + 1);
  expect(fits).toBe(true);
});

test("MUX-78 an active plan shows a check/text badge instead of the same buy button", async ({ page }) => {
  const fake = await setup(page);
  fake.usage.subscriptions = [{ package_id: "mentor_basis", renews: true, status: "active", renews_at: null }];
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  const basis = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Mentor Basis" }) });
  await expect(basis.getByText("Active", { exact: true })).toBeVisible();
  await expect(basis.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Start subscription,/ })).toHaveCount(1);
});

test("MUX-79 resting keeps package buttons visible and disabled with their reason", async ({ page }) => {
  const fake = await setup(page); fake.usage = { ...fake.usage, state: "resting", reason: "paused", can_buy: false };
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  for (const button of await page.getByRole("button", { name: /^(Start subscription,|Buy once,)/ }).all()) {
    await expect(button).toBeDisabled(); await expect(button).toHaveAttribute("aria-disabled", "true");
    const reason = await button.getAttribute("aria-describedby");
    expect(reason).toBeTruthy(); await expect(page.locator(`#${reason}`)).toContainText("The mentor is taking a break");
  }
  expect(fake.checkoutRequests).toEqual([]);
});

test("MUX-85 pending payment blocks rebuy, offers an explicit retry after 30min, and grant toast occurs once", async ({ page }) => {
  const fake = await setup(page);
  fake.usage.pending_purchase = { package_id: "mentor_basis", since: new Date(Date.now() - 31 * 60_000).toISOString(), checkout_session_id: SESSION, retry_allowed: true };
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Payment is being checked. Please don't pay again.").first()).toBeVisible();
  const basis = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Mentor Basis" }) });
  await expect(basis.getByRole("button", { name: /^Start subscription,/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Contact support" })).toBeVisible();
  await basis.getByRole("button", { name: "Pay again anyway" }).click();
  expect(fake.checkoutRequests).toEqual([{ package_id: "mentor_basis", retry_pending: true }]);
  fake.usage.pending_purchase = null;
  fake.usage.recent_purchase = { checkout_session_id: SESSION, credits_added: 150, granted_at: new Date().toISOString() };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("status").filter({ hasText: "Credits have arrived: +150" })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mentor packages" })).toBeVisible();
  await expect(page.getByText("Credits have arrived: +150", { exact: true })).toHaveCount(0);
});

test("MUX-83 return confirmation says credits added by this receipt and current balance", async ({ page }) => {
  await setup(page);
  await page.goto(`/mentor/checkout/success?checkout_session_id=${SESSION}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("New: +150 credits, now 162", { exact: true })).toBeVisible();
});
