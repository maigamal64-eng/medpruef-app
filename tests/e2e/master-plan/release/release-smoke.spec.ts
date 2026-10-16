import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { apiFixture, assertStandIn, headerOverlaps, LEARNER_ROUTES, measure, prepare, PUBLIC_ROUTES, tag, trackErrors, visit, type Variant } from "./release-harness";

/**
 * a35 pre-sitting release smoke (LX-17, LX-32, TR-19 and the per-surface
 * go/no-go for the 5 Nov learner release).
 *
 * Synthetic only: the server must be built with NEXT_PUBLIC_SUPABASE_URL
 * pointing at tests/e2e/master-plan/release/supabase-stand-in.mjs, every
 * browser /api call is fulfilled in release-harness.ts and every non-local host is aborted,
 * so nothing reaches production, Whop or analytics.
 *
 * Each route is measured at the widths the plan names (320, 375, 390, 768,
 * 1024) plus 1280, in German and English, light and dark. A route passes when
 * the document answers 200, its first heading or question renders, the page
 * scrolls no wider than the viewport (document.documentElement.scrollWidth <=
 * window.innerWidth), no two header elements overlap or touch
 * (headerOverlaps, a-header-375) and no console or page error appears.
 */

const evidence = process.env.A35_EVIDENCE_DIR;

const ONBOARDING = "onboarding:/";
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "de", dark: true },
  { width: 375, height: 812, lang: "en", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: false },
  { width: 1280, height: 900, lang: "en", dark: true },
  { width: 320, height: 568, lang: "de", dark: false },
  { width: 390, height: 844, lang: "en", dark: false },
  { width: 768, height: 1024, lang: "de", dark: true },
  { width: 1024, height: 768, lang: "en", dark: false },
];
const variantFilter = process.env.A35_VARIANT; // e.g. "375-de-light"

type Result = { route: string; variant: string; status: string; alertOnly?: boolean; scrollWidth?: number; innerWidth?: number; offenders?: string[]; fixedInFlow?: string[]; headerOverlaps?: string[]; errors?: string[]; writes?: string[]; visited?: string[] };
const results: Result[] = [];

test.use({ serviceWorkers: "block" });

test.beforeAll(async ({ request }) => assertStandIn(request));
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS.filter((x) => !variantFilter || tag(x) === variantFilter)) {
  for (const route of [...PUBLIC_ROUTES, ...LEARNER_ROUTES, ONBOARDING]) {
    test(`${route} fits and renders cleanly (${tag(v)})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block", reducedMotion: v.width === 320 ? "reduce" : "no-preference" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      const isPublic = (PUBLIC_ROUTES as readonly string[]).includes(route);
      const isOnboarding = route === ONBOARDING;
      const writes = await prepare(context, page, v, { signedIn: !isPublic, onboarded: !isOnboarding });
      const path_ = isOnboarding ? "/" : isPublic ? `${route}?lang=${v.lang}` : route;
      const result: Result = { route, variant: tag(v), status: "not-measured" };
      try {
        await visit(page, path_);
        // Rendered on an alert only (its synthetic data was not accepted):
        // layout is still measured, the go/no-go lists these routes.
        result.alertOnly = (await page.locator("h1").count()) === 0;
        const m = await measure(page);
        const overlaps = await headerOverlaps(page);
        Object.assign(result, m, { headerOverlaps: overlaps, errors, writes: writes.map((w) => `${w.method} ${w.path}`) });
        // Offenders are diagnostics (fixed or clipped elements can sit past an
        // edge without making the page scroll); the gate is the scroll width.
        result.status = m.scrollWidth <= m.innerWidth + 1 && m.fixedInFlow.length === 0 && overlaps.length === 0 && errors.length === 0 ? "passed" : "findings";
        expect.soft(m.scrollWidth, `${route} scrollWidth at ${tag(v)}; offenders ${m.offenders.join(" | ")}`).toBeLessThanOrEqual(m.innerWidth + 1);
        expect.soft(m.fixedInFlow, `${route} fixed elements in the page flow at ${tag(v)}`).toEqual([]);
        expect.soft(overlaps, `${route} header overlaps at ${tag(v)}`).toEqual([]);
        expect.soft(errors, `${route} console errors at ${tag(v)}`).toEqual([]);
      } finally {
        results.push(result);
        await context.close();
      }
    });
  }
}

test("TR-19 / LX-32: landing to the first free question with no card step, under 60 s", async ({ browser }) => {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const opts = { signedIn: false, tier: "free" as const };
  await prepare(context, page, v, opts);
  // After the synthetic sign-up the app behaves as signed in.
  let signedUp = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/api/auth" && req.method() === "POST") signedUp = true;
    const { status, body } = apiFixture(url, req.method(), { signedIn: signedUp, tier: "free" });
    return status === 204 ? route.fulfill({ status: 204, body: "" }) : route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  const visited: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
  const started = Date.now();
  await page.goto("/landing?lang=de", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Kostenlose Probe starten/ }).first().click();
  await page.waitForURL(/\/(login|quiz)/, { timeout: 20_000 });
  if (new URL(page.url()).pathname === "/login") {
    const register = page.getByRole("button", { name: "Registrieren", exact: true });
    if ((await register.getAttribute("aria-pressed")) !== "true") await register.click();
    await page.locator('input[name="given-name"]').fill("Fixture");
    await page.locator('input[name="email"]').fill("release@example.invalid");
    await page.locator('input[name="password"]').fill("synthetic-pass-1234");
    await page.getByRole("button", { name: "Konto erstellen" }).click();
  }
  // Onboarding may ask for the exam first; pick the Vienna bank if it does.
  const firstQuestion = page.locator("[data-question-text]").first();
  for (let step = 0; step < 6 && !(await firstQuestion.isVisible().catch(() => false)); step++) {
    const exam = page.getByRole("radio", { name: /Kenntnisprüfung|SIP4a/ }).first();
    if (await exam.isVisible().catch(() => false)) await exam.check().catch(() => exam.click());
    const next = page.getByRole("button", { name: /^(Weiter|Los geht|Termin später festlegen|Tagesziel später festlegen|Starten)/ }).first();
    if (await next.isVisible().catch(() => false)) await next.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await expect(firstQuestion).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Antwort A/ }).first().click();
  const elapsed = Date.now() - started;
  const cardFields = await page.locator('input[autocomplete^="cc-"], input[name*="card" i]').count();
  results.push({ route: "flow:landing-to-first-question", variant: tag(v), status: elapsed < 60_000 && cardFields === 0 ? "passed" : "findings", errors, visited });
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(path.join(evidence, "release-flow.json"), JSON.stringify({ checkedAt: new Date().toISOString(), elapsedMs: elapsed, visited, cardFields, errors }, null, 2) + "\n");
  }
  expect(visited.some((p) => /checkout|whop/i.test(p))).toBe(false);
  expect(cardFields).toBe(0);
  expect(elapsed).toBeLessThan(60_000);
  expect(errors).toEqual([]);
  await context.close();
});

function writeEvidence() {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  const file = path.join(evidence, `release-smoke-${process.env.TEST_WORKER_INDEX ?? "0"}.json`);
  writeFileSync(file, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + "\n");
}

test.afterAll(() => writeEvidence());
