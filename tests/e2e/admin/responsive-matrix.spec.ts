import { expect, test, type Page, type Route } from "@playwright/test";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;
const ROUTES = [
  { path: "/admin/overview", title: "Mission Control" },
  { path: "/admin/users", title: "Users" },
  { path: "/admin/questions", title: "Questions" },
  { path: "/admin/feedback", title: "Feedback inbox" },
  { path: "/admin/flagged", title: "Question reports" },
  { path: "/admin/access", title: "Admins & roles" },
] as const;

test("admin core screens: 390, 768, and 1440 responsive matrix", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.on("pageerror", (error) => console.log(`[admin matrix pageerror]\n${error.stack || error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      console.log(`[admin matrix console] ${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    console.log(`[admin matrix requestfailed] ${request.method()} ${url.origin}${url.pathname}: ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const url = new URL(response.url());
    console.log(`[admin matrix http ${response.status()}] ${url.origin}${url.pathname}`);
  });
  await seedSyntheticAdminAndMockNetwork(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of ROUTES) {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      expect(response?.status() ?? 200, `${route.path} response`).toBeLessThan(500);
      const storedSession = await page.evaluate(() => localStorage.getItem("medpruef_session"));
      expect(storedSession, "synthetic session must be present before the admin auth gate runs").not.toBeNull();
      await page.waitForSelector('[data-admin="1"]', { timeout: 12_000 });
      await expect(page.getByRole("heading", { level: 1, name: route.title })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("button", { name: "Global search" })).toHaveCount(0);
      await expect(page.getByText("Live", { exact: true })).toHaveCount(0);

      if (route.path === "/admin/users" && viewport.width < 640) {
        const search = page.getByRole("searchbox", { name: "Search users" });
        const searchWidth = await search.evaluate((input) => input.getBoundingClientRect().width);
        expect(searchWidth, "mobile user search must remain a usable full-row input").toBeGreaterThan(300);
      }
      if (route.path === "/admin/access") {
        await expect(page.getByRole("heading", { level: 2, name: "Roles" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Admin accounts" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Add access to an existing account" })).toBeVisible();
        await expect(page.getByRole("button", { name: "New role" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Owner" })).toBeDisabled();
      }
      if (route.path === "/admin/questions" && viewport.width < 1024) {
        await expect(page.getByText("Scroll horizontally to see all columns")).toBeVisible();
      }
      if (route.path === "/admin/users" && viewport.width < 1024) {
        await expect(page.locator("article").filter({ hasText: "Sample Learner" })).toBeVisible();
        await expect(page.getByText("Scroll horizontally to see all columns")).toBeHidden();
      }
      if (route.path === "/admin/overview") {
        await expect(page.getByText("Admin actions today", { exact: true })).toBeVisible();
        await expect(page.getByText("Is the audit log being written?", { exact: true })).toBeVisible();
        if (viewport.width >= 1024) {
          const positions = await page.evaluate(() => {
            const hero = document.querySelector('[data-testid="overview-revenue-hero"]')?.getBoundingClientRect();
            const conversion = document.querySelector('[data-testid="overview-conversion-tile"]')?.getBoundingClientRect();
            const referral = document.querySelector('[data-testid="overview-referrals-hero"]')?.getBoundingClientRect();
            const flagged = document.querySelector('[data-testid="overview-flagged-tile"]')?.getBoundingClientRect();
            return { revenueTop: hero?.top, conversionTop: conversion?.top, referralTop: referral?.top, flaggedTop: flagged?.top };
          });
          expect(Math.abs((positions.revenueTop ?? 0) - (positions.conversionTop ?? 0)), "revenue metrics should share one desktop row").toBeLessThanOrEqual(2);
          expect(Math.abs((positions.referralTop ?? 0) - (positions.flaggedTop ?? 0)), "operational queue metrics should share one desktop row").toBeLessThanOrEqual(2);
        }
        if (viewport.width >= 640 && viewport.width < 1024) {
          const widths = await page.evaluate(() => {
            const grid = document.querySelector('[data-testid="overview-conversion-tile"]')?.parentElement;
            const conversion = document.querySelector('[data-testid="overview-conversion-tile"]');
            const operations = document.querySelector('[data-testid="overview-flagged-tile"]')?.parentElement;
            const flagged = document.querySelector('[data-testid="overview-flagged-tile"]');
            return {
              revenueGrid: grid?.getBoundingClientRect().width ?? 0,
              conversion: conversion?.getBoundingClientRect().width ?? 0,
              opsGrid: operations?.getBoundingClientRect().width ?? 0,
              flagged: flagged?.getBoundingClientRect().width ?? 0,
            };
          });
          expect(widths.conversion).toBeGreaterThanOrEqual(widths.revenueGrid - 2);
          expect(widths.flagged).toBeGreaterThanOrEqual(widths.opsGrid - 2);
        }
      }

      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        elements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
              text: (element.innerText || "").slice(0, 50),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
          })
          .filter((element) => element.right > document.documentElement.clientWidth + 1 || element.scrollWidth > element.clientWidth + 1)
          .slice(0, 12),
      }));
      expect(overflow.document, `${route.path} overflows at ${viewport.name}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body, `${route.path} body overflows at ${viewport.name}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport + 1);

      const sidebar = page.locator('aside[aria-label="Admin navigation"]');
      if (viewport.width < 1024) {
        const openNav = page.getByRole("button", { name: "Open admin navigation" });
        await expect(openNav).toBeVisible();
        await openNav.click();
        await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Close admin navigation" })).toBeFocused();
        await page.getByRole("button", { name: "Close admin navigation" }).click();
        await expect(openNav).toBeFocused();
        await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeHidden();
        await openNav.click();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeHidden();
        await expect(sidebar).toHaveAttribute("aria-hidden", "true");
        await expect.poll(async () => {
          const box = await sidebar.boundingBox();
          return (box?.x ?? 0) + (box?.width ?? 0);
        }, { message: `${route.path} closed mobile drawer must finish moving fully off-screen` }).toBeLessThanOrEqual(1);
      } else {
        await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
        const desktopSidebar = await sidebar.boundingBox();
        expect(await sidebar.evaluate((element) => getComputedStyle(element).position), `${route.path} desktop sidebar must participate in page layout`).toBe("static");
        expect(desktopSidebar?.x ?? -1, `${route.path} desktop sidebar starts at viewport edge`).toBe(0);
        expect(desktopSidebar?.width ?? 0, `${route.path} desktop sidebar has its expanded width`).toBe(240);
      }

      await page.screenshot({
        path: testInfo.outputPath(`${route.path.split("/").at(-1)}-${viewport.name}.png`),
        fullPage: true,
      });
    }
  }
});

async function seedSyntheticAdminAndMockNetwork(page: Page): Promise<void> {
  // Use one init script with a source-controlled synthetic identity. Do not
  // inherit E2E_ADMIN_USER_ID from the operator's shell or any credential.
  await page.addInitScript((adminId) => {
    try {
      localStorage.setItem("medpruef_session", JSON.stringify({
        user: {
          id: adminId, email: "synthetic-admin@example.test", role: "admin", tier: "admin",
          first_name: "Synthetic", last_name: "Admin", xp_total: 0, streak_count: 0, daily_goal: 20,
        },
        gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
      }));
      localStorage.setItem("medpruef_onboarding", JSON.stringify({
        examSource: "kenntnispruefung",
        examDate: "not_planned",
        level: "intermediate",
        dailyGoal: 20,
        language: "en",
        darkMode: true,
        completedAt: "2026-09-26T20:00:00.000Z",
      }));
      localStorage.setItem("medpruef_theme", "dark");
      localStorage.setItem("medpruef_admin_theme", "dark");
      localStorage.setItem("medpruef-lang", "en");
      localStorage.setItem("medpruef_cookies", "declined");
    } catch {
      // The initial about:blank origin may not expose localStorage. The
      // init script runs again for the actual local app origin.
    }
  }, ADMIN_ID);

  // Block all non-local HTTP and websocket traffic. Every API request,
  // including writes, is fulfilled locally with a harmless fixture.
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route("**/*", async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname !== "localhost" && requestUrl.hostname !== "127.0.0.1") {
      await route.abort();
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      await mockApi(route, requestUrl);
      return;
    }
    await route.continue();
  });
}

async function mockApi(route: Route, url: URL): Promise<void> {
  const { pathname } = url;
  const method = route.request().method();
  let payload: unknown = { ok: true };

  if (pathname === "/api/admin/access/me") {
    payload = {
      actor: { userId: ADMIN_ID, email: "synthetic-admin@example.test" },
      roles: [{ key: "owner", name: "Owner" }],
      permissions: [
        "overview.read", "users.read", "users.write", "users.entitlements.write", "users.sessions.read", "users.sessions.write", "users.notes.read",
        "content.read", "content.moderate", "feedback.read", "feedback.manage", "revenue.read", "revenue.reconcile", "revenue.manage",
        "system.read", "system.manage", "access.manage",
      ],
    };
  } else if (pathname === "/api/admin/access/roles") {
    payload = {
      roles: [
        { id: "owner-role", key: "owner", name: "Owner", description: "Full access.", system: true, updated_at: "2026-09-26T20:00:00.000Z", permissions: ["access.manage", "overview.read", "users.read"] },
        { id: "content-role", key: "content-reviewer", name: "Content reviewer", description: "Review study questions.", system: false, updated_at: "2026-09-26T20:00:00.000Z", permissions: ["content.read", "content.moderate"] },
      ],
      permission_catalog: ["overview.read", "users.read", "users.write", "users.entitlements.write", "users.sessions.read", "users.sessions.write", "users.notes.read", "content.read", "content.moderate", "feedback.read", "feedback.manage", "revenue.read", "revenue.reconcile", "revenue.manage", "system.read", "system.manage", "access.manage"],
    };
  } else if (pathname === "/api/admin/access/memberships") {
    payload = { memberships: [{ user_id: ADMIN_ID, email: "synthetic-admin@example.test", name: "Synthetic Admin", roles: [{ key: "owner", name: "Owner", assigned_at: "2026-09-26T20:00:00.000Z" }], legacy_unassigned: false }] };
  } else if (pathname === "/api/admin/access/candidates") {
    payload = { candidates: [], total: 0, limit: 25, offset: 0, has_more: false };
  } else if (pathname === "/api/admin/overview") {
    payload = {
      generated_at: "2026-09-26T20:00:00.000Z",
      tiles: {
        revenue: { today_cents: 18700, mtd_cents: 109300, series_7d: [3, 5, 4, 8, 7, 9, 12] },
        active_subs: { total: 12, by_tier: { pro: 12 } }, signups_today: 4,
        paywall_hits_today: 8, referrals_awaiting_action: 2, puyp_pending: 1,
        flagged_open: 3, webhook_failures_24h: 0, stuck_pending_24h: 0,
        conversion_7d: 0.14, ai_chat_1h: { requests: 0, completed: 0, failed: 0, avg_latency_ms: null },
        telegram_activation: { registered: 0, confirmed: 0 }, crons: {},
        recent_events: [{ id: "fixture-1", event_type: "question_answered", user_id: ADMIN_ID, created_at: "2026-09-26T19:58:00.000Z" }],
      },
    };
  } else if (pathname === "/api/stats/admin/users") {
    payload = {
      items: [{
        id: "00000000-0000-4000-8000-00000000a001", telegram_id: "700000001", email: "learner@example.test",
        name: "Sample Learner", first_name: "Sample", last_name: "Learner", username: "samplelearner", photo_url: null,
        role: "user", tier: "pro", status: "active", created_at: "2026-09-01T10:00:00.000Z",
        xp: 650, streak: 4, questions_answered: 127, accuracy: 82, daily_today: 13,
        last_study: "2026-09-26T19:00:00.000Z", last_active: "2026-09-26T19:00:00.000Z",
      }],
      total: 1, page: 1, limit: 25, totalPages: 1,
    };
  } else if (pathname === "/api/stats/admin/questions" && url.searchParams.get("mode") === "browse") {
    payload = { questions: [{
      id: 812, topic: "Neurology", question: "Which finding best localizes the lesion?", answer: "Upper motor neuron signs",
      explanation: "The pattern is consistent with a central lesion.", choices: [{ text: "Upper motor neuron signs", correct: true }, { text: "Reduced reflexes", correct: false }],
      image_url: null, exam_dates: ["2026-09-23"], tags: ["neuro"], is_active: true, anki_note_id: null,
      created_at: "2026-09-01T10:00:00.000Z", question_preview: "Which finding best localizes the lesion?", choices_count: 2,
      has_explanation: true, has_image: false,
    }], total: 1, page: 1, limit: 25, totalPages: 1 };
  } else if (pathname === "/api/stats/admin/questions") {
    payload = { totalAll: 1000, active: 950, inactive: 50, withMCQ: 900, withExplanations: 780, withImages: 160, mcqPct: 90, explPct: 78, imgPct: 16, byTopic: [] };
  } else if (pathname === "/api/suggestions") {
    payload = { suggestions: [{
      id: 71, question_id: 812, question_text: "Which finding best localizes the lesion?", question_topic: "Neurology",
      user_name: "Sample Learner", type: "flag", status: "pending", reason: "incorrect_answer",
      details: "Please double-check the marked answer.", created_at: "2026-09-26T19:00:00.000Z",
    }], counts: { pending: 1, approved: 0, rejected: 0, total: 1 } };
  } else if (pathname === "/api/feedback" && method === "GET") {
    payload = [{
      id: 4, user_id: "00000000-0000-4000-8000-00000000a001",
      message: "The explanation on this item was difficult to follow. Please review the wording.",
      context: { pathname: "/quiz", questionId: 812, examType: "kenntnispruefung", screenSize: "390x844" },
      status: "new", admin_note: null, created_at: "2026-09-26T19:00:00.000Z",
    }];
  } else if (pathname === "/api/announcements/state") {
    payload = { state: { userId: ADMIN_ID, sessionCount: 1, qsAnsweredTotal: 0, orientationModalSeenAt: null, cohortBannerDismissedAt: null, referralFloaterDismissedAt: null, lastSessionAt: "2026-09-26T20:00:00.000Z" } };
  } else if (pathname === "/api/admin/subscriptions") payload = { total_active: 0, by_tier: {}, recent: [] };
  else if (["/api/admin/webhooks", "/api/admin/crons", "/api/admin/referrals", "/api/admin/flags"].includes(pathname)) payload = { items: [] };

  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
}
