import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { FIXTURE_PACKAGES, FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";
import type { MentorChatRequest, MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";

// Local route fakes only. Run this suite on WebKit before beta release.
test.use({ browserName: "webkit", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
async function setup(page: Page) {
  await seedSession(page, { userId: USER, email: "mentor-shell@example.invalid", tier: "pro" });
  await page.addInitScript(() => {
    localStorage.setItem("medpruef-lang", "en");
    localStorage.setItem("medpruef_cookies", "declined");
  });
  await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  let releaseChat: (() => void) | undefined;
  const heldChat = new Promise<void>((resolve) => { releaseChat = resolve; });
  const fake = {
    usage: { state: "ok", credits_left: 120, messages_left_estimate: 120, sources: ["package"], next_expiry: null, subscriptions: [], can_buy: true } as MentorUsageResponse,
    final: { ...FIXTURE_FINAL_OK, answer_blocks: [{ text: "Recovered first sentence. " + "Synthetic explanation sentence. ".repeat(120), fact_ids: [] }], citations: [] } as MentorFinalEvent,
    requests: [] as MentorChatRequest[],
    results: [] as string[],
    hold: false,
    kill: false,
    retryAfter: 0,
    release: () => releaseChat?.(),
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/mentor/usage") return route.fulfill({ json: fake.usage });
    if (url.pathname === "/api/mentor/packages") return route.fulfill({ json: FIXTURE_PACKAGES });
    if (url.pathname === "/api/mentor/chat/result") {
      fake.results.push(url.searchParams.get("client_request_id")!);
      return route.fulfill({ json: { status: "complete", final: fake.final } });
    }
    if (url.pathname === "/api/mentor/chat") {
      fake.requests.push(route.request().postDataJSON());
      if (fake.retryAfter) return route.fulfill({ status: 429, json: { error: "rate_limited", retry_after_seconds: fake.retryAfter } });
      if (fake.kill) return route.abort("failed");
      if (fake.hold) await heldChat;
      try { await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(fake.final)}\n\n` }); } catch { /* watchdog may abort the held fetch after recovery */ }
      return;
    }
    if (url.pathname === "/api/questions") return route.fulfill({ json: [{ id: 5, question: "Synthetic stem", explanation: "Synthetic explanation", topic: "Synthetic topic" }] });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  return fake;
}
async function send(page: Page) {
  await page.getByRole("textbox", { name: "Your message to the Mentor" }).fill("Synthetic learner message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("MUX-36 WebKit recovers a throttled turn after 45 seconds of silence without a second POST or focus/layout jump", async ({ page }) => {
  await page.clock.install();
  const fake = await setup(page); fake.hold = true;
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect.poll(() => fake.requests.length).toBe(1);
  const composer = page.locator("[data-mentor-composer]");
  const before = await composer.boundingBox();
  const textbox = page.getByRole("textbox", { name: "Your message to the Mentor" });
  await textbox.focus();
  await page.clock.runFor(44_000);
  expect(fake.results).toHaveLength(0);
  await page.clock.runFor(2_000);
  await expect(page.getByText(/^Recovered first sentence\./).first()).toBeVisible();
  expect(fake.results).toEqual([fake.requests[0].client_request_id]);
  expect(fake.requests).toHaveLength(1);
  await expect(textbox).toBeFocused();
  const after = await composer.boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 0);
  expect(after!.height).toBeCloseTo(before!.height, 0);
  await expect(page.getByRole("button", { name: "Jump to end" })).toBeVisible();
  fake.release();
});

test("MUX-36 WebKit recovers a killed stream from its original UUID", async ({ page }) => {
  const fake = await setup(page); fake.kill = true;
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect(page.getByText(/^Recovered first sentence\./).first()).toBeVisible();
  expect(fake.requests).toHaveLength(1);
  expect(fake.results).toEqual([fake.requests[0].client_request_id]);
});

test("MUX-36 visible return probes an active request immediately", async ({ page }) => {
  const fake = await setup(page); fake.hold = true;
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect.poll(() => fake.requests.length).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText(/^Recovered first sentence\./).first()).toBeVisible();
  expect(fake.requests).toHaveLength(1);
  expect(fake.results).toEqual([fake.requests[0].client_request_id]);
  fake.release();
});

test("MUX-22/25 blocking keeps the draft read-only and one purchase action with server-owned source wording", async ({ page }) => {
  const fake = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  const textbox = page.getByRole("textbox", { name: "Your message to the Mentor" });
  await textbox.fill("Keep this draft");
  const before = await page.locator("[data-mentor-state-bar]").boundingBox();
  fake.usage = { ...fake.usage, state: "exhausted", credits_left: 0, current_grant: 50, sources: ["pro_included"], renewal_at: "2026-11-01T12:00:00Z" };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(textbox).toHaveAttribute("readonly", "");
  await expect(textbox).toHaveValue("Keep this draft");
  await expect(page.locator("#mentor-blocked-reason")).toContainText("Your 50 Pro credits are used up");
  await expect(page.locator("#mentor-blocked-reason")).toHaveAttribute("aria-live", "off");
  const action = page.locator("[data-mentor-composer]").getByRole("link", { name: "See packages" });
  await expect(action).toHaveAttribute("href", "/mentor/packages?from=exhausted&select=mentor_topup");
  const after = await page.locator("[data-mentor-state-bar]").boundingBox();
  expect(after!.height).toBeCloseTo(before!.height, 0);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  await expect(page.getByText("Try a question", { exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 375, height: 667 }, { width: 360, height: 640 }]) test(`MUX-26 scope, strip and keyboard at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  const fake = await setup(page);
  fake.usage = { ...fake.usage, state: "low", credits_left: 8, renewal_at: "2026-11-01T12:00:00Z", low_threshold: 22.5 };
  await page.setViewportSize(viewport);
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  const scope = page.locator("[data-mentor-scope]");
  expect((await scope.boundingBox())!.height).toBeLessThan(140);
  await expect(scope.getByRole("radio")).toHaveCount(3);
  await expect(scope.getByRole("radio").nth(1)).toBeDisabled();
  const strip = page.locator("[data-mentor-info-strip]");
  expect((await strip.boundingBox())!.height).toBe(44);
  await expect(strip).toContainText("8 credits left");
  await page.screenshot({ path: `tests/e2e/.artifacts/mentor-r1-shell-${viewport.width}x${viewport.height}-low-strip.png` });
  await strip.getByRole("button", { name: "Close" }).click();
  await expect(strip).toHaveCount(0);
  const chrome = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("[data-mentor-header]")!;
    const composer = document.querySelector<HTMLElement>("[data-mentor-composer]")!;
    const main = document.querySelector<HTMLElement>("main.main-content")!;
    const nav = document.querySelector<HTMLElement>("nav.bottom-nav")!;
    const clearance = Math.max(parseFloat(getComputedStyle(main).paddingBottom), window.innerHeight - nav.getBoundingClientRect().top);
    return { header: header.getBoundingClientRect().height, composer: composer.getBoundingClientRect().height, nav: nav.getBoundingClientRect().height, clearance, viewport: window.innerHeight, total: header.getBoundingClientRect().height + composer.getBoundingClientRect().height + clearance };
  });
  await test.info().attach("full-mentor-chrome-measurement", { body: JSON.stringify(chrome, null, 2), contentType: "application/json" });
  expect(chrome.header).toBeLessThanOrEqual(45);
  expect(chrome.composer).toBeLessThanOrEqual(66);
  expect(chrome.clearance).toBeGreaterThanOrEqual(chrome.nav);
  expect(chrome.total).toBeLessThanOrEqual(158);
  expect(chrome.total / chrome.viewport).toBeLessThan(0.25);
  for (const link of await page.locator("nav.bottom-nav a").all()) {
    const box = await link.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(link).not.toHaveText("");
  }
  await page.screenshot({ path: `tests/e2e/.artifacts/mentor-r1-shell-${viewport.width}x${viewport.height}-at-rest.png` });
  await page.getByRole("textbox", { name: "Your message to the Mentor" }).focus();
  // A deterministic viewport resize proves focus alone does not hide navigation.
  await expect(page.locator("nav.bottom-nav")).toBeVisible();
  await page.evaluate((height) => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: height });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }, viewport.height - 260);
  await expect(page.locator("nav.bottom-nav")).toHaveCount(0);
  await page.screenshot({ path: `tests/e2e/.artifacts/mentor-r1-shell-${viewport.width}x${viewport.height}-keyboard.png` });
  await page.evaluate((height) => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: height });
    window.visualViewport!.dispatchEvent(new Event("resize"));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, viewport.height);
  await expect(page.locator("nav.bottom-nav")).toBeVisible();
  await page.screenshot({ path: `tests/e2e/.artifacts/mentor-r1-shell-${viewport.width}x${viewport.height}.png` });
});

test("MUX-25 rate-limit ticker uses server retry_after and announces only start and resume", async ({ page }) => {
  await page.clock.install();
  const fake = await setup(page); fake.retryAfter = 29;
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  const textbox = page.getByRole("textbox", { name: "Your message to the Mentor" });
  await expect(textbox).toHaveAttribute("readonly", "");
  await expect(page.locator("#mentor-blocked-reason")).toHaveText("You can ask again in 29 s.");
  await expect(page.locator("main > [role=status]")).toHaveText("You can ask again in 29 s.");
  await page.clock.runFor(5_000);
  await expect(page.locator("#mentor-blocked-reason")).toHaveText("You can ask again in 24 s.");
  await expect(page.locator("main > [role=status]")).toHaveText("You can ask again in 29 s.");
  await page.clock.runFor(24_000);
  await expect(textbox).toHaveAttribute("aria-readonly", "false");
  await expect(page.locator("main > [role=status]")).toHaveText("You can ask again.");
});

test("MUX-49 scope rows select the corresponding available mode", async ({ page }) => {
  await setup(page);
  await page.goto("/mentor?question_id=5", { waitUntil: "domcontentloaded" });
  const scope = page.locator("[data-mentor-scope]");
  for (const name of [/^Study plan:/, /^Deadlines and rules:/, /^Explaining questions:/]) {
    const radio = scope.getByRole("radio", { name });
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
  }
});

test("MUX-41/44 a completed answer has a single shell end announcement and starts below the header", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await send(page);
  await expect(page.getByRole("log")).toHaveAttribute("aria-relevant", "additions");
  const shellStatus = page.locator("main > [role=status]");
  await expect(shellStatus).toHaveCount(1);
  await expect(shellStatus).toContainText("Answer ready, 0 sources.");
  await expect(page.getByRole("button", { name: "Jump to end" })).toBeVisible();
  const answer = page.locator('[id^="mentor-message-a-"]').last();
  const header = await page.locator("[data-mentor-header]").boundingBox();
  await expect.poll(async () => (await answer.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
});
