import { expect, test, type Page, type Route } from "@playwright/test";

// a20 smoke: Growth window, cohort hero, Sources/Campaigns, tagged-link
// builder and as-of dates; legacy admin redirects; FAQ #crypto-only lands on
// the payment section (DE/EN); a Telegram-tagged bare-domain link reaches
// /landing with its tags stored. Mocked APIs, synthetic data, phone and
// desktop, light and dark. Nothing is written anywhere: every /api call is
// fulfilled here and sendBeacon is stubbed. Screenshots go to A20_SHOT_DIR.
const permissions = ["overview.read", "users.read", "revenue.read", "system.read", "feedback.read", "content.read"];
const shotDir = process.env.A20_SHOT_DIR;

const SEED = `localStorage.setItem("medpruef_session", ${JSON.stringify(JSON.stringify({ user: { id: "synthetic-admin", email: "user-26af5ee6@example.com", role: "admin", tier: "admin", first_name: "Test", xp_total: 0, streak_count: 0, daily_goal: 20 }, gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 } }))}); localStorage.setItem("medpruef_session_token", "local-test-session-token"); localStorage.setItem("medpruef_onboarding", ${JSON.stringify(JSON.stringify({ completedAt: "2026-01-01T00:00:00.000Z", examSource: "kenntnispruefung" }))});`;
const BEACON_STUB = `window.__beacons = []; navigator.sendBeacon = (url, data) => { window.__beacons.push(String(url)); return true; };`;

function growth(window: string) {
  const big = window === "all";
  return {
    generated_at: new Date().toISOString(), window: big ? "all" : Number(window), since: big ? null : new Date(Date.now() - Number(window) * 86_400_000).toISOString(),
    signups: { count: big ? 182 : 19, pctOfSignups: 1 }, activated: { count: big ? 121 : 12, pctOfSignups: 0.63 }, engaged: { count: big ? 48 : 5, pctOfSignups: 0.26 }, paying: { count: big ? 11 : 1, pctOfSignups: 0.05 },
    signup_totals: { last_7d: 3, last_30d: 19, all_time: 182 },
    sources: [
      { source: "telegram", arrivals: 40, signups: 6, payers: 1 },
      { source: "(untagged)", arrivals: 210, signups: 13, payers: 0 },
    ],
    campaigns: [{ source: "telegram", campaign: "fristen-17-okt-a-very-long-campaign-name", arrivals: 40, signups: 6, payers: 1 }],
    waitlist: { total: 7, in_window: 0, latest_at: "2026-04-24T09:00:00Z" },
    basis: { signups: "Real users created in the window.", activated: "Of those, answered 1.", engaged: "Of those, answered 25.", paying: "Of those, paying now.", sources: "Counts only." },
  };
}
const content = {
  strategy: [{ tier: 1, label: "Synthetic tier", cash: "EUR 0", status: "running", moves: ["one move"], rationale: "why" }],
  strategyAsOf: "2026-06-29",
  published: [{ id: "p1", channel: "telegram", date: "2026-06-30", kind: "post", summary: "Synthetic post", status: "published", results: "not instrumented" }],
  publishedLastUpdated: "2026-06-30",
  channelLabels: { telegram: "Telegram" },
  presence: [{ name: "Telegram", handle: "@synthetic", status: "live" }],
  presenceAsOf: "2026-07-01",
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function setup(page: Page, theme: "light" | "dark", admin = true) {
  if (admin) await page.addInitScript({ content: SEED });
  await page.addInitScript({ content: `localStorage.setItem("medpruef_cookie_consent", "declined"); localStorage.setItem("medpruef_cookies", "declined"); localStorage.setItem("medpruef_admin_theme", ${JSON.stringify(theme)}); ${BEACON_STUB}` });
  await page.emulateMedia({ colorScheme: theme });
  await page.route(/https:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/admin/access/me") return json(route, { actor: { userId: "synthetic-admin", email: null }, roles: [{ key: "owner", name: "Owner" }], permissions });
    if (p === "/api/admin/inbox") return json(route, { feedback: 0, question_reports: 0, note_reports: 0, puyp: 0, ops_actions: null, referral_payouts: 0, referral_rewards: 0, oldest: {}, failed: [], kill_switches_on: [] });
    if (p === "/api/stats/admin/growth") return json(route, growth(url.searchParams.get("window") ?? "30"));
    if (p === "/api/stats/admin/growth/content") return json(route, content);
    if (p === "/api/beacon/landing" || p === "/api/funnel-events" || p === "/api/track") return route.fulfill({ status: 204 });
    if (p.startsWith("/api/mentor/")) return json(route, { error: "not mocked" }, 503);
    return json(route, { items: [], total: 0 });
  });
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of [{ name: "phone", width: 375, height: 812 }, { name: "desktop", width: 1280, height: 900 }]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`a20 ${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      let errors: string[] = [];
      test.beforeEach(async ({ page }) => {
        errors = [];
        page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(msg.text())) errors.push(msg.text()); });
        page.on("pageerror", (e) => errors.push(e.message));
      });
      test.afterEach(() => { expect(errors).toEqual([]); });

      test("Growth: window, cohort hero, sources, campaigns, tagged links, as-of dates", async ({ page }) => {
        await setup(page, theme);
        await page.goto("/admin/growth");
        await expect(page.getByRole("radio", { name: "30 days" })).toHaveAttribute("aria-checked", "true");
        await expect(page.getByTestId("growth-hero")).toContainText("Signups in the last 30 days");
        await expect(page.getByTestId("growth-hero")).toContainText("19");
        await expect(page.getByTestId("growth-sources")).toContainText("telegram");
        await expect(page.getByTestId("growth-campaigns")).toContainText("fristen-17-okt");
        await expect(page.getByTestId("growth-waitlist")).toContainText("7 sign-ups in total");
        await expect(page.getByText("Hand-kept plan, as of 29 Jun 2026")).toBeVisible();
        await expect(page.getByText(/as of 1 Jul 2026/)).toBeVisible();
        await page.getByLabel("Post name").fill("Fristen 17. Okt");
        await expect(page.getByTestId("campaign-links")).toContainText("utm_campaign=fristen-17-okt");
        await expect(page.getByTestId("campaign-links")).toContainText("t.me/MedPruefBot?start=c_fristen-17-okt");
        await noOverflow(page);
        if (shotDir) await page.screenshot({ path: `${shotDir}/growth-${viewport.name}-${theme}.png`, fullPage: true });
        await page.getByRole("radio", { name: "7 days" }).click();
        await expect(page).toHaveURL(/window=7/);
        await expect(page.getByTestId("growth-hero")).toContainText("Signups in the last 7 days");
        await page.getByRole("radio", { name: "All time" }).click();
        await expect(page.getByTestId("growth-hero")).toContainText("182");
      });

      test("legacy admin URLs redirect with their query string", async ({ page }) => {
        await setup(page, theme);
        await page.goto("/admin/waitlist?window=7");
        await expect(page).toHaveURL(/\/admin\/growth\?window=7$/);
        for (const [from, to] of [["/admin/system", /\/admin\/overview/], ["/admin/launch", /\/admin\/overview/], ["/admin/sql", /\/admin\/overview/], ["/admin/experiments", /\/admin\/growth/]] as const) {
          const res = await page.request.get(from, { maxRedirects: 0 });
          expect(res.status(), from).toBe(307);
          expect(res.headers().location, from).toMatch(to);
        }
      });

      for (const lang of ["de", "en"] as const) {
        test(`FAQ #crypto-only lands on the payment section (${lang})`, async ({ page }) => {
          await setup(page, theme, false);
          await page.addInitScript({ content: `localStorage.setItem("medpruef-lang", ${JSON.stringify(lang)}); document.cookie = "mp_lang=${lang}; path=/";` });
          await page.goto(`/faq?lang=${lang}#crypto-only`);
          await expect(page.locator("#payment")).toBeInViewport();
          await expect(page).toHaveURL(/#payment$/);
          await expect(page.locator("#payment")).toContainText(lang === "de" ? "Wie kann ich bezahlen?" : "How can I pay?");
          await noOverflow(page);
          if (shotDir) await page.screenshot({ path: `${shotDir}/faq-payment-${lang}-${viewport.name}-${theme}.png` });
        });
      }

      test("a Telegram-tagged bare-domain link reaches /landing with its tags stored (OW-46)", async ({ page }) => {
        await setup(page, theme, false);
        await page.goto("/?utm_source=telegram&utm_medium=post&utm_campaign=fristen-17-okt");
        await expect(page).toHaveURL(/\/landing\?.*utm_campaign=fristen-17-okt/);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("medpruef_attribution") ?? "null"));
        expect(stored).toMatchObject({ utm_source: "telegram", utm_medium: "post", utm_campaign: "fristen-17-okt" });
        expect(await page.evaluate(() => (window as unknown as { __beacons: string[] }).__beacons)).toContain("/api/beacon/landing");
      });
    });
  }
}
