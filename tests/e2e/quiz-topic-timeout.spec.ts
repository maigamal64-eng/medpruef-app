import { expect, test } from "@playwright/test";

test("quiz setup shows a retry after topic counts time out and keeps the exam source", async ({ page, context }) => {
  await context.addCookies([{ name: "mp_skip_landing", value: "1", url: process.env.BASE_URL ?? "http://127.0.0.1:3102" }]);
  await page.addInitScript(() => {
    localStorage.setItem("medpruef_session", JSON.stringify({
      user: { id: "topic-timeout-fixture", email: "fixture@example.invalid", role: "user", tier: "pro" },
      gamification: {},
    }));
    localStorage.setItem("medpruef_session_token", "synthetic-topic-session");
    localStorage.setItem("medpruef_onboarding", "1");
    localStorage.setItem("medpruef-lang", "en");
    localStorage.setItem("medpruef_cookies", "declined");
  });

  const topicRequests: Array<{ action?: string; examSource?: string }> = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/questions") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("**/api/questions", async (route) => {
    const body = route.request().postDataJSON() as { action?: string; examSource?: string };
    topicRequests.push(body);
    if (topicRequests.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      await route.abort().catch(() => undefined);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ topic: "Neurologie", count: 12 }]),
    });
  });
  await page.goto("/quiz?setup=1&examSource=kenntnispruefung", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Topics" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Topics could not be loaded" }),
  ).toContainText("Topics could not be loaded", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Start test/ })).toBeDisabled();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Neurologie" })).toBeVisible();
  await expect.poll(() => topicRequests.length).toBe(2);
  expect(topicRequests).toEqual([
    { action: "topics", examSource: "kenntnispruefung" },
    { action: "topics", examSource: "kenntnispruefung" },
  ]);

  await page.getByRole("button", { name: "Neurologie" }).click();
  await expect(page.getByRole("button", { name: "Neurologie" })).toHaveAttribute("aria-pressed", "true");
});
