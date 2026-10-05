import { expect, test } from "@playwright/test";
import { seedSession } from "./fixtures/session";
import { seedPreferences } from "./helpers/page-setup";
import { SAMPLE_USER_ID } from "./fixtures/users";

async function waitForSearchMount(page: import("@playwright/test").Page) {
  // The shortcut handler is client-only. The document language changes from
  // the server's German default when LangAttributeSync mounts, which avoids
  // sending the key before React hydration has attached global listeners.
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function openSearchWhenReady(
  page: import("@playwright/test").Page,
  dialog: import("@playwright/test").Locator,
) {
  const shortcut = process.platform === "darwin" ? "Meta+k" : "Control+k";
  // LangAttributeSync marks the hydration pass. Give the sibling global
  // shortcut effect one more frame to attach, then send exactly one chord.
  await page.waitForTimeout(700);
  await page.keyboard.press(shortcut);
  await expect(dialog).toBeVisible();
}

test.describe("quick search modal sizing and keyboard flow", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, {
      userId: SAMPLE_USER_ID,
      role: "user",
      tier: "free",
      firstName: "Test",
    });
    await seedPreferences(page, { lang: "en" });
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: SAMPLE_USER_ID,
            role: "user",
            tier: "free",
            first_name: "Test",
            referrals_enabled: true,
          },
        }),
      }),
    );
    await page.route("**/api/user/exam-preference", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ activeExam: "kenntnispruefung" }),
      }),
    );
    await page.route("**/api/questions**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );
  });

  test("keeps one predictable results scroll area on a short phone viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 390 });
    await page.goto("/materials", { waitUntil: "domcontentloaded" });
    await waitForSearchMount(page);

    const dialog = page.getByRole("dialog", { name: "Quick search" });
    await openSearchWhenReady(page, dialog);
    const body = dialog.locator(":scope > .mp-dialog__body");
    const results = dialog.getByRole("listbox", { name: "Search results" });

    const dimensions = await body.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
    await expect(results).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: /Search questions/ })).toBeFocused();

    const resultsOverflow = await results.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    );
    expect(resultsOverflow).toBe(true);
  });

  test("supports arrow and Enter navigation from the focused search field", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/materials", { waitUntil: "domcontentloaded" });
    await waitForSearchMount(page);

    const dialog = page.getByRole("dialog", { name: "Quick search" });
    await openSearchWhenReady(page, dialog);
    const search = dialog.getByRole("textbox", { name: /Search questions/ });
    await expect(search).toBeFocused();
    await search.fill("Quiz");
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("option", { name: /Quiz/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/quiz(?:\?|$)/);
    await expect(dialog).toHaveCount(0);
  });

  test("closes with Escape without scrolling the surrounding page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/materials", { waitUntil: "domcontentloaded" });
    await waitForSearchMount(page);
    await page.evaluate(() => window.scrollTo(0, 280));

    const dialog = page.getByRole("dialog", { name: "Quick search" });
    await openSearchWhenReady(page, dialog);
    const pageScrollY = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScrollY);
  });
});
