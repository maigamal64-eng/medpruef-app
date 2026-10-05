import { expect, test } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { seedPreferences } from "../helpers/page-setup";
import { ADMIN_USER_ID } from "../fixtures/users";

test("Flagged questions shows pending question flags, not general feedback", async ({ page }) => {
  const suggestionRequests: URL[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: { id: ADMIN_USER_ID, tier: "admin", role: "admin" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/suggestions**", async (route) => {
    suggestionRequests.push(new URL(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [{
          id: 71,
          question_id: 812,
          question_text: "Which finding needs urgent review?",
          question_topic: "Neurology",
          user_name: "QA Reviewer",
          type: "flag",
          status: "pending",
          reason: "incorrect_answer",
          details: "The marked answer appears inconsistent.",
          created_at: "2026-09-26T10:00:00.000Z",
        }],
        counts: { pending: 1, approved: 0, rejected: 0, total: 1 },
      }),
    });
  });
  await page.route("**/api/feedback**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 4, message: "General feedback must not appear here", status: "new" }]),
    });
  });

  await seedPreferences(page, { theme: "dark", lang: "en" });
  await seedSession(page, {
    userId: ADMIN_USER_ID,
    email: "admin@medpruf.com",
    role: "admin",
    tier: "admin",
  });
  const response = await page.goto("/admin/flagged", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(500);

  await expect(page.getByRole("heading", { level: 1, name: "Flagged questions" })).toBeVisible();
  await expect(page.getByText("Question #812 · Neurology")).toBeVisible();
  await expect(page.getByText("Which finding needs urgent review?")).toBeVisible();
  await expect(page.getByText("General feedback must not appear here")).toHaveCount(0);
  expect(suggestionRequests[0]?.searchParams.get("status")).toBe("pending");
  expect(suggestionRequests[0]?.searchParams.get("type")).toBe("flag");
});
