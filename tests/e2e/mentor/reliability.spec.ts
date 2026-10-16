import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_PACKAGES } from "../../../src/lib/mentor/fixtures";
import type { MentorUsageResponse } from "../../../src/lib/mentor/contract";
import { mentorT } from "../../../src/lib/i18n-mentor";

// a-mentor-reliability (R1, R3, R8): the credit balance load on phones. API fakes
// only, a fake page clock drives the 28 s budget and the 2/6/15 s retries. Run
// only through with-heavy against one local server. Screenshots go to SHOTS.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const SHOTS = process.env.MENTOR_RELIABILITY_SHOTS;
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
type Lang = "de" | "en";
type UsageMode = "ok" | "hold" | "error";

const USAGE: MentorUsageResponse = { state: "ok", credits_left: 120, messages_left_estimate: 120, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: true };

async function setup(page: Page, opts: { lang: Lang; dark?: boolean; usage: UsageMode; seedCache?: boolean }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    if (/Failed to load resource/.test(m.text()) && (!url || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) || /\/api\/mentor\/usage/.test(url))) return;
    errors.push(m.text());
  });
  await page.clock.install();
  await seedSession(page, { userId: USER, email: "mentor-reliability@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark, seed, usage, user }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.setItem(`medpruef_mentor_source_hint:${user}`, "1");
    if (seed && !sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      sessionStorage.setItem(`medpruef_mentor_${user}_usage`, JSON.stringify({ usage, at: Date.now() }));
    }
  }, { lang: opts.lang, dark: !!opts.dark, seed: !!opts.seedCache, usage: USAGE, user: USER });
  await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const held: Route[] = [];
  const state = { usage: opts.usage, usageCalls: 0, track: [] as string[], aborted: 0 };
  page.on("requestfailed", (r) => { if (new URL(r.url()).pathname === "/api/mentor/usage") state.aborted += 1; });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") {
      state.usageCalls += 1;
      if (state.usage === "hold") { held.push(route); return; }
      if (state.usage === "error") return route.fulfill({ status: 500, json: { error: "server_error" } });
      return route.fulfill({ json: USAGE });
    }
    if (path === "/api/track") { state.track.push(route.request().postData() ?? ""); return route.fulfill({ status: 202, json: {} }); }
    if (path === "/api/mentor/packages") return route.fulfill({ json: FIXTURE_PACKAGES });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat/result") return route.fulfill({ json: { status: "missing" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  const release = async () => { state.usage = "ok"; for (const r of held.splice(0)) await r.fulfill({ json: USAGE }); };
  return { errors, state, held, release };
}

const box = (page: Page) => page.locator("[data-mentor-composer] textarea");
const sendButton = (page: Page, lang: Lang) => page.getByRole("button", { name: mentorT("btn_send", lang), exact: true });
const strip = (page: Page) => page.locator("[data-mentor-usage-strip]");
const readyPill = (page: Page) => page.locator("[data-mentor-header] button[aria-expanded]");

async function noOverflow(page: Page, width: number) {
  await expectNoHorizontalScroll(page);
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(m.sw, JSON.stringify(m)).toBeLessThanOrEqual(width);
}

/** The document never scrolls and the composer stays above the tab bar (iOS safe areas included). */
async function fixedFrame(page: Page) {
  const m = await page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    return { sh: document.scrollingElement!.scrollHeight, ih: window.innerHeight, y: window.scrollY, header: r("[data-mentor-header]"), composer: r("[data-mentor-composer]"), nav: r("nav.bottom-nav"),
      footer: document.querySelectorAll("footer[aria-label='Rechtliche Links'], footer[aria-label='Legal links']").length };
  });
  expect(m.sh, JSON.stringify(m)).toBeLessThanOrEqual(m.ih + 1);
  expect(m.y).toBe(0);
  expect(m.header!.top).toBeGreaterThanOrEqual(0);
  if (m.nav && m.nav.height > 0) expect(m.composer!.bottom, JSON.stringify(m)).toBeLessThanOrEqual(m.nav.top + 0.5);
  expect(m.footer).toBe(0);
}

/** Advance the page clock until `n` usage requests were made (each retry waits up to 18 s). */
async function runUntilCalls(page: Page, state: { usageCalls: number }, n: number) {
  for (let i = 0; i < 40 && state.usageCalls < n; i++) await page.clock.runFor(1_000);
  expect(state.usageCalls).toBe(n);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const CASES = [
  { vp: { width: 375, height: 812 }, lang: "de" as const, dark: false },
  { vp: { width: 390, height: 844 }, lang: "en" as const, dark: true },
  { vp: { width: 375, height: 812 }, lang: "en" as const, dark: true },
  { vp: { width: 390, height: 844 }, lang: "de" as const, dark: false },
];

for (const c of CASES) {
  const tag = `${c.vp.width} ${c.lang} ${c.dark ? "dark" : "light"}`;

  test(`R1 slow usage ${tag}: a 20 s answer is still taken, no error, one request`, async ({ page }) => {
    await page.setViewportSize(c.vp);
    const { errors, state, held, release } = await setup(page, { lang: c.lang, dark: c.dark, usage: "hold" });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect.poll(() => held.length).toBe(1);
    await box(page).fill("Draft typed while credits load");
    // R3 single flight: tab returns and an online event join the running load.
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online")); });
    await page.clock.runFor(20_000);
    expect(state.aborted).toBe(0);
    await expect(strip(page)).toHaveCount(0);
    expect(held.length).toBe(1);
    await release();
    await expect(readyPill(page)).toBeVisible();
    await expect(sendButton(page, c.lang)).toBeEnabled();
    await expect(box(page)).toHaveValue("Draft typed while credits load");
    expect(state.usageCalls).toBe(1);
    await fixedFrame(page);
    await noOverflow(page, c.vp.width);
    await shot(page, `slow-ready-${c.vp.width}-${c.lang}-${c.dark ? "dark" : "light"}`);
    expect(errors).toEqual([]);
  });

  test(`R3 cold failure ${tag}: three retries, one compact strip, Send waits, Try again recovers`, async ({ page }) => {
    await page.setViewportSize(c.vp);
    const { errors, state } = await setup(page, { lang: c.lang, dark: c.dark, usage: "error" });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect.poll(() => state.usageCalls).toBe(1);
    await box(page).fill("Draft kept on error");
    // While retrying: loading pill, no strip yet.
    await expect(page.locator("[data-mentor-header] [role=status]")).toHaveAttribute("aria-label", mentorT("credits_loading", c.lang));
    await expect(strip(page)).toHaveCount(0);
    await runUntilCalls(page, state, 4);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toContainText(mentorT("credits_load_failed", c.lang));
    await expect(strip(page)).not.toContainText(mentorT("credits_can_still_ask", c.lang));
    await expect(page.getByText(mentorT("err_load_failed", c.lang))).toHaveCount(0);
    await expect(sendButton(page, c.lang)).toBeDisabled();
    await expect(box(page)).toHaveValue("Draft kept on error");
    const retry = strip(page).getByRole("button", { name: mentorT("btn_retry", c.lang) });
    const rb = (await retry.boundingBox())!;
    expect(rb.height).toBeGreaterThanOrEqual(44);
    await fixedFrame(page);
    await noOverflow(page, c.vp.width);
    await shot(page, `cold-failure-${c.vp.width}-${c.lang}-${c.dark ? "dark" : "light"}`);
    // R8: one text-free event for the cycle that ran out.
    await page.clock.runFor(6_000);
    await expect.poll(() => state.track.filter((b) => b.includes("mentor_usage_failed")).length).toBe(1);
    const body = state.track.find((b) => b.includes("mentor_usage_failed"))!;
    expect(body).toContain('"http":"5xx"');
    expect(body).not.toContain("Draft kept");
    expect(state.usageCalls).toBe(4);
    state.usage = "ok";
    await retry.click();
    await expect(readyPill(page)).toBeVisible();
    await expect(strip(page)).toHaveCount(0);
    await expect(sendButton(page, c.lang)).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test(`R3 last good balance ${tag}: shown at once with a refresh mark, Send works, failed refresh says so`, async ({ page }) => {
    await page.setViewportSize(c.vp);
    const { errors, state } = await setup(page, { lang: c.lang, dark: c.dark, usage: "error", seedCache: true });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(readyPill(page)).toBeVisible();
    await expect(readyPill(page)).toContainText("120");
    await expect(readyPill(page).locator("[data-mentor-credit-refreshing]")).toHaveCount(1);
    await expect(readyPill(page)).toHaveAttribute("aria-label", new RegExp(mentorT("credits_stale", c.lang)));
    await box(page).fill("Can I still ask?");
    await expect(sendButton(page, c.lang)).toBeEnabled();
    await shot(page, `stale-refreshing-${c.vp.width}-${c.lang}-${c.dark ? "dark" : "light"}`);
    await runUntilCalls(page, state, 4);
    await expect(strip(page)).toContainText(mentorT("credits_refresh_failed", c.lang));
    await expect(strip(page)).toContainText(mentorT("credits_can_still_ask", c.lang));
    // The mark says "updating" only while a re-check runs.
    await expect(readyPill(page).locator("[data-mentor-credit-refreshing]")).toHaveCount(0);
    await expect(readyPill(page)).toContainText("120");
    await expect(sendButton(page, c.lang)).toBeEnabled();
    await fixedFrame(page);
    await noOverflow(page, c.vp.width);
    await shot(page, `stale-failed-${c.vp.width}-${c.lang}-${c.dark ? "dark" : "light"}`);
    expect(errors).toEqual([]);
  });
}
