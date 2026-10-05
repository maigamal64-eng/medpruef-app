import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.setTimeout(120_000);

const EVIDENCE = join(process.cwd(), "reviews/ux-review-2026-09-26/evidence/offline-experience");
mkdirSync(EVIDENCE, { recursive: true });

type OfflineOptions = { serviceWorkers?: "block" | "allow"; width: number; height: number };

async function offlineFixture(browser: Browser, opts: OfflineOptions): Promise<{
  context: BrowserContext;
  page: Page;
  savedAnswers: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
}> {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    serviceWorkers: opts.serviceWorkers ?? "block",
  });
  const page = await context.newPage();
  const savedAnswers: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
  await page.route(/^https?:\/\/(?!((localhost|127\.0\.0\.1):(?:3102|3103)))/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("medpruef_session", JSON.stringify({
      user: { id: "ux-offline-fixture", email: "offline@example.invalid", role: "user", tier: "pro", first_name: "Offline Fixture", xp_total: 0, streak_count: 0, daily_goal: 20 },
      gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
    }));
    localStorage.setItem("medpruef_session_token", "local-offline-test-token");
    localStorage.setItem("medpruef_onboarding", "1");
    localStorage.setItem("medpruef_theme", "light");
    localStorage.setItem("medpruef-lang", "en");
    localStorage.setItem("medpruef_cookies", "declined");
  });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/auth/me") return json({ user: { id: "ux-offline-fixture", tier: "pro", role: "user", first_name: "Offline Fixture", tier_expires_at: null } });
    if (path === "/api/user/exam-preference") return json({ activeExam: "kenntnispruefung" });
    if (path === "/api/offline/questions") {
      const count = Math.min(Number(url.searchParams.get("count") || 100), 100);
      return json({ questions: Array.from({ length: count }, (_, index) => ({
        id: 820_000 + index,
        topic: "Neurologie",
        question: `Offline fixture question ${index + 1}`,
        answer: "Correct offline option",
        explanation: "Synthetic offline explanation.",
        ai_explanation: null,
        exam_type: "kenntnispruefung",
        choices: [{ text: "Correct offline option", correct: true }, { text: "Other offline option", correct: false }],
        image_url: null,
        image_urls: null,
        exam_dates: [],
        tags: [],
        cached_at: new Date().toISOString(),
      })) });
    }
    if (path === "/api/questions") {
      const id = Number(url.searchParams.get("ids")) || 910_001;
      return json([{ id, topic: "Neurologie", question: "Online fixture question before disconnect", answer: "Correct offline option", explanation: "Fixture explanation.", difficulty: 1, exam_dates: [], n_correct: 1, options: [{ text: "Correct offline option", correct: true }, { text: "Other offline option", correct: false }] }]);
    }
    if (path === "/api/answer" && req.method() === "POST") {
      savedAnswers.push({ body: req.postDataJSON() as Record<string, unknown>, headers: req.headers() });
      return json({ xp: 10, saved: true });
    }
    return json({});
  });
  return { context, page, savedAnswers };
}

function evidence(name: string, width: number, height: number) {
  return join(EVIDENCE, `${name}-${width}x${height}.png`);
}

test("offline download confirmation stays clear of the mobile bottom navigation", async ({ browser }) => {
  const { context, page } = await offlineFixture(browser, { width: 390, height: 844 });
  try {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const downloadedToast = page.getByText("100 questions downloaded");
    await expect(downloadedToast).toBeVisible({ timeout: 10_000 });

    const toastBox = await downloadedToast.locator("xpath=..").boundingBox();
    const navBox = await page.locator(".bottom-nav").boundingBox();
    expect(toastBox, "download confirmation toast should have a layout box").not.toBeNull();
    expect(navBox, "mobile learner navigation should have a layout box").not.toBeNull();
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(navBox!.y - 8);

    await page.screenshot({ path: evidence("offline-pack-downloaded", 390, 844), fullPage: true });
  } finally {
    await context.close();
  }
});

test("offline pack downloads, study answers queue on device, then sync after reconnect", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { context, page, savedAnswers } = await offlineFixture(browser, viewport);
    try {
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Download questions ahead of time to keep studying without internet.")).toBeVisible();
      await page.screenshot({ path: evidence("offline-settings", viewport.width, viewport.height), fullPage: true });
      await page.getByRole("button", { name: "Download", exact: true }).click();
      const downloadedToast = page.getByText("100 questions downloaded");
      await expect(downloadedToast).toBeVisible({ timeout: 10_000 });
      if (viewport.width <= 1024) {
        const toastBox = await downloadedToast.locator("xpath=..").boundingBox();
        const navBox = await page.locator(".bottom-nav").boundingBox();
        expect(toastBox, "download confirmation toast should have a layout box").not.toBeNull();
        expect(navBox, "mobile learner navigation should have a layout box").not.toBeNull();
        expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(navBox!.y - 8);
      }
      await expect(page.getByRole("button", { name: "Clear offline data" })).toBeEnabled();
      await page.screenshot({ path: evidence("offline-pack-downloaded", viewport.width, viewport.height), fullPage: true });

      await page.goto("/quiz?topic=Neurologie&examSource=kenntnispruefung&limit=1", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-question-text]")).toContainText("Online fixture question before disconnect");
      await page.screenshot({ path: evidence("quiz-before-disconnect", viewport.width, viewport.height), fullPage: true });

      await context.setOffline(true);
      await page.getByRole("radio", { name: "Correct offline option" }).click();
      await expect(page.getByText(/saved on this device|queued offline|will sync/i)).toBeVisible({ timeout: 10_000 });
      expect(savedAnswers).toHaveLength(0);
      await page.screenshot({ path: evidence("answer-queued-offline", viewport.width, viewport.height), fullPage: true });

      await context.setOffline(false);
      await expect.poll(() => savedAnswers.length, { timeout: 15_000 }).toBe(1);
      expect(savedAnswers[0].body).toMatchObject({ questionId: 910_001, userAnswer: "Correct offline option" });
      expect(savedAnswers[0].headers["x-session-token"]).toBeTruthy();
      await page.screenshot({ path: evidence("answer-synced-after-reconnect", viewport.width, viewport.height), fullPage: true });
    } finally {
      await context.close();
    }
  }
});

test("offline fallback document is readable and responsive at phone, tablet, and desktop sizes", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    const { context, page } = await offlineFixture(browser, viewport);
    try {
      await page.goto("/offline.html", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
      await expect(page.locator("main p")).toContainText("wieder online");
      await expect(page.getByRole("link", { name: "Erneut versuchen" })).toHaveAttribute("href", "/quiz");
      await expect(page.getByText("Offline Fixture")).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: evidence("pwa-offline-page", viewport.width, viewport.height), fullPage: true });
    } finally {
      await context.close();
    }
  }
});
