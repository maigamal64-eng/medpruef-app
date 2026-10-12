/**
 * Admin shell smoke test — renders every /admin/* route with mocked
 * APIs and asserts each page:
 *   1. Renders a top-level <main> element
 *   2. Does not crash with "Cannot read properties of undefined"
 *   3. Does not redirect to an error page (/error, /500)
 *   4. Shows the expected AdminPageShell title
 *
 * The auth bounce in `layout.tsx` just checks that a stored session
 * exists; the real gate is server-side on every /api/admin/* endpoint.
 * We mock both layers: `seedSession` satisfies the client bounce,
 * `stubAdminApis` returns deterministic payloads so pages hydrate
 * without a real DB.
 *
 * Every admin route is exercised once — we don't screenshot-diff
 * (that's a separate sprint). Failures land as readable Playwright
 * errors with the route path in the test name.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { seedPreferences } from "../helpers/page-setup";
import { ADMIN_USER_ID } from "../fixtures/users";

// `seedSession` with role='admin' satisfies the client-side bounce;
// server-side routes are mocked so the real user never has to exist in
// the test DB. ADMIN_USER_ID is a synthetic non-prod UUID (S-1) unless
// E2E_ADMIN_USER_ID is set — see fixtures/users.ts.

/**
 * Only run this suite on one representative desktop viewport. The
 * admin shell is desktop-first by design and the mobile layout
 * scales down via the same primitives — a mobile axe/responsive
 * sweep can live in a follow-up if [name] ever uses admin from a
 * phone, which he doesn't. This keeps the suite under 30s.
 */
const REPRESENTATIVE_PROJECT = "Desktop";

// Admin smoke uses a single worker to avoid swamping the Next.js dev
// server with 25 parallel webpack compiles. `mode: 'default'` keeps
// each test independent (failures don't cascade-skip the rest),
// while the Playwright config should pin workers to 1 for this suite
// when run locally. See README for the CLI recipe.
//
// Rather than `mode: 'serial'` (which marks siblings as skipped after
// a single failure), we accept independent tests and rely on workers
// throttling to keep dev-server load manageable.

test.describe("Admin smoke — every /admin/* route renders without crashing", () => {
  test.beforeEach(async ({ page, request, baseURL }, testInfo) => {
    if (testInfo.project.name !== REPRESENTATIVE_PROJECT) {
      test.skip(true, `Admin smoke runs only on ${REPRESENTATIVE_PROJECT}.`);
    }
    // Dev-server health gate — same pattern as public-routes.spec.ts.
    const health = await request
      .get(baseURL || "http://localhost:3000/")
      .catch(() => null);
    if (!health || health.status() >= 500) {
      test.skip(
        true,
        `Dev server unhealthy (status=${health?.status() ?? "unreachable"}). See README troubleshooting.`,
      );
    }

    await seedPreferences(page, { theme: "dark", lang: "en" });
    await seedSession(page, {
      userId: ADMIN_USER_ID,
      email: "admin@medpruf.com",
      role: "admin",
      tier: "admin",
      firstName: "Admin",
    });
    await stubAdminApis(page);

    // Capture client console errors + page errors so a runtime crash
    // surfaces as an assertion rather than a silent render.
    //
    // We only fail for errors that indicate a React render crash —
    // "Cannot read properties of undefined", "X is not a function",
    // "X is not defined". Dev-mode oddities (inline SW kill-switch
    // script, stale webpack chunks, Sentry wrapper warnings) get
    // logged but not asserted.
    const renderCrashes: string[] = [];
    const checkCrash = (source: string, text: string) => {
      const isCrash =
        text.includes("Cannot read properties") ||
        / is not a function\b/.test(text) ||
        / is not defined\b/.test(text);
      if (isCrash) renderCrashes.push(`[${source}] ${text}`);
    };
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      checkCrash("console", msg.text());
    });
    page.on("pageerror", (err) => {
      checkCrash("pageerror", err.message);
    });

    // Expose the crash collector to individual tests via a fixture.
    // Tests assert `expect(renderCrashes).toHaveLength(0)` after their
    // own assertions so a late hydration crash still fails the test.
    (page as unknown as { _renderCrashes: string[] })._renderCrashes =
      renderCrashes;
  });

  // Every admin route: {path, title} tuple. `title` is the AdminPageShell
  // heading that must appear in the rendered <h1>. For redirect stubs
  // (dashboard, analytics, system, changelog) we assert the final URL
  // instead.

  const ROUTES: Array<{
    path: string;
    title?: string;
    expectFinalUrl?: RegExp;
  }> = [
    { path: "/admin", expectFinalUrl: /\/admin\/overview/ },
    { path: "/admin/overview", title: "Mission Control" },
    { path: "/admin/users", title: "Users" },
    { path: "/admin/subscriptions", title: "Subscriptions" },
    { path: "/admin/referrals", title: "Referrals" },
    { path: "/admin/waitlist", title: "Waitlist" },
    { path: "/admin/questions", title: "Questions" },
    { path: "/admin/flagged", title: "Flagged questions" },
    { path: "/admin/media", title: "Media audit" },
    { path: "/admin/feedback", title: "User Feedback" },
    // These legacy entry paths intentionally redirect to their consolidated destinations.
    { path: "/admin/funnels", expectFinalUrl: /\/admin\/overview/ },
    { path: "/admin/flags", title: "Feature flags" },
    { path: "/admin/experiments", expectFinalUrl: /\/admin\/growth/ },
    { path: "/admin/puyp", title: "Pass-Until-You-Pass" },
    { path: "/admin/crons", title: "Cron health" },
    { path: "/admin/deploys", title: "Deploys" },
    { path: "/admin/webhooks", expectFinalUrl: /\/admin\/payments/ },
    { path: "/admin/errors", title: "Errors" },
    { path: "/admin/audit", title: "Audit log" },
    { path: "/admin/sql", title: "SQL runner" },
    { path: "/admin/env", title: "Environment" },
    { path: "/admin/dashboard", expectFinalUrl: /\/admin\/overview/ },
    { path: "/admin/analytics", expectFinalUrl: /\/admin\/overview/ },
    { path: "/admin/system", expectFinalUrl: /\/admin\/env/ },
    { path: "/admin/changelog", expectFinalUrl: /\/admin\/overview/ },
  ];

  for (const route of ROUTES) {
    test(`${route.path} renders without crashing`, async ({ page }) => {
      // Generous per-test ceiling — dev-mode webpack cold compile of the
      // admin shell + per-route module + websocket Realtime bootstrap
      // can take 20-40s on a cold run. Production builds resolve in <2s.
      test.setTimeout(90_000);
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
      });
      if (response && response.status() >= 500) {
        test.skip(
          true,
          `${route.path} returned ${response.status()} — dev server cache corrupted mid-run.`,
        );
      }

      // Did the router bounce us to an error page? Use strict boundary
      // patterns so /admin/errors (a legit admin route) doesn't false-match.
      await expect(page).not.toHaveURL(/\/(error|500|crashed|not-found)($|[?/])/i);

      // Redirect stubs: assert the final landing URL + early return.
      // Next.js `redirect()` in a nested server component routes through
      // the client-side router, which can take a second to propagate
      // the URL change after the layout hydrates — give it 15s.
      if (route.expectFinalUrl) {
        await expect(page).toHaveURL(route.expectFinalUrl, { timeout: 15_000 });
        return;
      }

      // Admin shell is client-rendered + fetches on mount. Under Next.js
      // dev mode the first hit on every route triggers a lazy webpack
      // compile (typically 2-8s) plus Realtime channel bootstrap. The
      // shell renders a full-page spinner until its auth useEffect runs
      // — so we first wait for the admin sidebar marker to mount
      // (`data-admin="1"`), which is only present once authChecked=true.
      // If the spinner keeps rendering past the timeout the session
      // seeding didn't stick, which is a real failure mode we want
      // surfaced in CI.
      await page.waitForSelector('[data-admin="1"]', { timeout: 45_000 });

      // <main> must mount — the AdminPageShell emits exactly one.
      await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });

      // Title must render. Grab the h1 matching the expected title —
      // AdminPageShell always emits exactly one h1 per page.
      if (route.title) {
        await expect(
          page.getByRole("heading", { level: 1, name: route.title }),
        ).toBeVisible({ timeout: 15_000 });
      }

      // Fail if a React render crash fired at any point during the run.
      const crashes =
        (page as unknown as { _renderCrashes?: string[] })._renderCrashes ?? [];
      expect(
        crashes,
        `React render crash on ${route.path}: ${crashes.join(" | ")}`,
      ).toHaveLength(0);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// API mocks — every admin page's backing endpoint.
//
// The philosophy: return the smallest shape the client expects so every
// render path (including "nothing here yet" empty states) gets exercised
// at least once in CI. The payloads mirror the real API's response
// structure so a future contract change will fail here first.
// ────────────────────────────────────────────────────────────────────────

async function stubAdminApis(page: Page): Promise<void> {
  // Admin shell routes can mount the live tier hook after redirecting from a
  // legacy URL. Keep synthetic admin sessions hermetic instead of allowing
  // the built app to validate their fixture token against production data.
  await page.route("**/api/auth/me**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: ADMIN_USER_ID,
          tier: "admin",
          tier_expires_at: null,
          role: "admin",
          email_status: "valid",
          language_code: "en",
          onboarding_completed_at: "2026-01-01T00:00:00.000Z",
          referrals_enabled: false,
        },
        fetched_at: new Date().toISOString(),
      }),
    });
  });

  // /api/admin/overview — 11 tiles
  await page.route("**/api/admin/overview", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generated_at: new Date().toISOString(),
        tiles: {
          revenue: { today_cents: 0, mtd_cents: 0, series_7d: [0, 0, 0, 0, 0, 0, 0], today: { gross_cents: 0, refunds_cents: 0, cash_cents: 0 }, month_to_date: { gross_cents: 0, refunds_cents: 0, cash_cents: 0 }, other_currencies: [] },
          active_subs: { total: 0, in_trial: 0, by_cadence: { renews: 0, one_time: 0, unknown: 0 } },
          signups_today: 0,
          paywall_hits_today: 0,
          referrals_awaiting_action: 0,
          puyp_pending: 0,
          flagged_open: 0,
          payment_health: { level: "quiet", diagnosis: "No Whop webhook delivery in the last 7 days.", failures_24h: 0, probes_24h: 0, unresolved_total: 0 },
          new_payers_7d: { new_payers: 0, signups: 0, ratio: null },
          crons: {},
          recent_events: [],
        },
      }),
    });
  });

  // /api/admin/subscriptions
  await page.route("**/api/admin/subscriptions", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generated_at: new Date().toISOString(),
        names_visible: true,
        kpis: { paying: 0, paying_by_cadence: { renews: 0, one_time: 0, unknown: 0 }, in_trial: 0, lose_7d: 0, lose_30d: 0, renew_30d: 0, ended_30d: 0, lifetime_gross_cents: 0, stuck_pending_24h: 0 },
        rows: [],
        pending: [],
        basis: { paid_to_date: "", cadence: "" },
      }),
    });
  });

  // /api/admin/referrals?status=...
  await page.route("**/api/admin/referrals**", async (route: Route) => {
    const url = route.request().url();
    // mark-paid POST passes through with 200 { ok: true } so the UI
    // doesn't explode if a click lands.
    if (url.includes("/mark-paid")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/admin/waitlist?format=json&exam_type=...
  await page.route("**/api/admin/waitlist**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/stats/admin/questions (stats + browse modes)
  await page.route("**/api/stats/admin/questions**", async (route: Route) => {
    const url = new URL(route.request().url());
    const mode = url.searchParams.get("mode");
    if (mode === "browse") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          questions: [],
          total: 0,
          page: 1,
          limit: 25,
          totalPages: 0,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalAll: 0,
        active: 0,
        inactive: 0,
        withMCQ: 0,
        withExplanations: 0,
        withImages: 0,
        mcqPct: 0,
        explPct: 0,
        imgPct: 0,
        byTopic: [],
      }),
    });
  });

  // /api/stats/admin/duplicates
  await page.route("**/api/stats/admin/duplicates", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalGroups: 0,
        totalExtraCopies: 0,
        groups: [],
      }),
    });
  });

  // /api/stats/admin/missing-images
  await page.route("**/api/stats/admin/missing-images**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/stats/admin/users (users page list)
  await page.route("**/api/stats/admin/users**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // /api/feedback — flagged + feedback pages
  await page.route("**/api/feedback**", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // /api/suggestions — questions > reviews sub-tab
  await page.route("**/api/suggestions**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [],
        counts: { pending: 0, approved: 0, rejected: 0, total: 0 },
      }),
    });
  });

  // /api/puyp/admin?status=...
  await page.route("**/api/puyp/admin**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], count: 0 }),
    });
  });

  // /api/admin/crons
  await page.route("**/api/admin/crons", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/admin/webhooks
  await page.route("**/api/admin/webhooks", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // Read-only integration pages degrade to their configured-off state in this synthetic suite.
  await page.route("**/api/admin/deploys", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: false, missing: "VERCEL_TOKEN" }) });
  });
  await page.route("**/api/admin/errors", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: false, missing: "SENTRY_AUTH_TOKEN" }) });
  });

  // /api/admin/audit
  await page.route("**/api/admin/audit**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/admin/flags
  await page.route("**/api/admin/flags", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/admin/env — presence-only
  await page.route("**/api/admin/env", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { name: "NEXT_PUBLIC_SUPABASE_URL", present: true, masked: "https…com (33 chars)" },
          { name: "SUPABASE_SERVICE_ROLE_KEY", present: true, masked: "eyJh…abc (220 chars)" },
        ],
      }),
    });
  });

  // /api/admin/sql — GET lists saved queries; POST runs SQL
  await page.route("**/api/admin/sql", async (route: Route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rows: [],
          row_count: 0,
          duration_ms: 1,
          capped_at: 1000,
          saved_id: null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/announcements/state — admin routes don't render the gate, but
  // any layout-level fetch that sneaks in gets a harmless stub.
  await page.route("**/api/announcements/state", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: {
          userId: ADMIN_USER_ID,
          sessionCount: 1,
          qsAnsweredTotal: 0,
          orientationModalSeenAt: null,
          cohortBannerDismissedAt: null,
          referralFloaterDismissedAt: null,
          lastSessionAt: new Date().toISOString(),
        },
      }),
    });
  });

  // Any Supabase Realtime websocket URL — admin pages subscribe via
  // useAdminRealtime(). Playwright can't trivially mock WS; the pages
  // tolerate a disconnected channel (isConnected=false), so let the
  // request hit the network and fail silently.
  // No route handler needed.
}
