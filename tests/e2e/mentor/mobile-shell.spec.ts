import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_FINAL_OK, FIXTURE_PACKAGES } from "../../../src/lib/mentor/fixtures";
import type { MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";
import { mentorT, type MentorUiLang } from "../../../src/lib/i18n-mentor";

// a-mentor-mobile-2: the mentor page shell and composer on phones. API fakes only,
// no provider or production writes. Run only through with-heavy against one local
// server. Screenshots go to SHOTS when set.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const SHOTS = process.env.MENTOR_MOBILE_SHOTS;
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const CONVERSATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type Lang = "de" | "en";
type UsageMode = "ok" | "hold" | "error";

const FINAL: MentorFinalEvent = {
  ...FIXTURE_FINAL_OK,
  conversation_id: CONVERSATION,
  answer_blocks: [{ text: "**Registration SIP4a (MedUni Vienna): until October 19, 2026.** Synthetic restored answer with a second sentence that wraps on a phone.", fact_ids: [] }],
  citations: [],
  credits_left: 120,
} as MentorFinalEvent;
const THREAD = {
  conversation_id: CONVERSATION,
  messages: Array.from({ length: 3 }, (_, i) => [
    { id: `u-${i}`, role: "user", text: `Synthetic learner question ${i + 1}` },
    { id: `a-${i}`, role: "assistant", text: "Synthetic restored answer.", final: FINAL },
  ]).flat(),
};

async function setup(page: Page, opts: { lang: Lang; dark?: boolean; usage?: UsageMode; history?: boolean; chat?: "ok" | "minute" | "month"; signedOut?: boolean }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    // External hosts are aborted on purpose; the usage 500 is the error state under test.
    if (/Failed to load resource/.test(m.text()) && (!url || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) || /\/api\/mentor\/usage/.test(url))) return;
    errors.push(m.text());
  });
  if (!opts.signedOut) await seedSession(page, { userId: USER, email: "mentor-shell-mobile@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.setItem("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da", "1");
  }, { lang: opts.lang, dark: !!opts.dark });
  await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const usage: MentorUsageResponse = { state: "ok", credits_left: 120, messages_left_estimate: 120, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: true };
  const held: Route[] = [];
  const state = { usage: opts.usage ?? "ok", chat: opts.chat ?? "ok", chatCalls: 0 };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") {
      if (state.usage === "hold") { held.push(route); return; }
      if (state.usage === "error") return route.fulfill({ status: 500, json: { error: "server_error" } });
      return route.fulfill({ json: usage });
    }
    if (path === "/api/mentor/packages") return route.fulfill({ json: FIXTURE_PACKAGES });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: opts.history ? THREAD : { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat/result") return route.fulfill({ json: { status: "missing" } });
    if (path === "/api/mentor/chat") {
      state.chatCalls += 1;
      if (state.chat === "minute") return route.fulfill({ status: 429, json: { error: "rate_limited", limit: "minute", retry_after_seconds: 31 } });
      if (state.chat === "month") return route.fulfill({ status: 429, json: { error: "rate_limited", limit: "month", retry_after_seconds: 86_400 } });
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(FINAL)}\n\n` });
    }
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  const release = async (override: Partial<MentorUsageResponse> = {}) => { state.usage = "ok"; Object.assign(usage, override); for (const r of held.splice(0)) await r.fulfill({ json: usage }); };
  return { errors, state, release, held };
}

const composer = (page: Page) => page.locator("[data-mentor-composer]");
const box = (page: Page) => page.locator("[data-mentor-composer] textarea");
const sendButton = (page: Page, lang: Lang) => page.getByRole("button", { name: mentorT("btn_send", lang), exact: true });

/** Strict: against the width we set (mobile emulation would otherwise zoom out and widen innerWidth). */
async function noOverflow(page: Page, width: number) {
  await expectNoHorizontalScroll(page);
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(m.sw, JSON.stringify(m)).toBeLessThanOrEqual(width);
  expect(m.iw, JSON.stringify(m)).toBe(width);
}

/** Fixed app frame: the document never scrolls, header and composer stay on screen above the tab bar. */
async function fixedFrame(page: Page) {
  const m = await page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    return {
      sh: document.scrollingElement!.scrollHeight, ih: window.innerHeight, y: window.scrollY,
      header: r("[data-mentor-header]"), composer: r("[data-mentor-composer]"), nav: r("nav.bottom-nav"),
      footer: document.querySelectorAll("footer[aria-label='Rechtliche Links'], footer[aria-label='Legal links']").length,
    };
  });
  expect(m.sh, JSON.stringify(m)).toBeLessThanOrEqual(m.ih + 1);
  expect(m.y).toBe(0);
  expect(m.header!.top).toBeGreaterThanOrEqual(0);
  if (m.nav && m.nav.height > 0) expect(m.composer!.bottom, JSON.stringify(m)).toBeLessThanOrEqual(m.nav.top + 0.5);
  expect(m.footer).toBe(0);
}

async function headerChecks(page: Page) {
  const m = await page.evaluate(() => {
    const h1 = document.querySelector("[data-mentor-header] h1") as HTMLElement;
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    const buttons = [...document.querySelectorAll("[data-mentor-header] button, [data-mentor-header] [role=status]")].map((b) => { const r = b.getBoundingClientRect(); return { name: b.getAttribute("aria-label") ?? b.textContent, w: r.width, h: r.height }; });
    return { h1Height: h1.getBoundingClientRect().height, lh, clipped: h1.scrollWidth > h1.clientWidth, buttons };
  });
  expect(m.h1Height, JSON.stringify(m)).toBeLessThanOrEqual(m.lh + 1);
  expect(m.clipped, JSON.stringify(m)).toBe(false);
  for (const b of m.buttons) { expect(b.w, JSON.stringify(b)).toBeGreaterThanOrEqual(44); expect(b.h, JSON.stringify(b)).toBeGreaterThanOrEqual(44); }
}

async function tabBarChecks(page: Page) {
  const m = await page.evaluate(() => {
    const nav = document.querySelector("nav.bottom-nav") as HTMLElement;
    const ul = nav.querySelector("ul") as HTMLElement;
    const navStyle = getComputedStyle(nav);
    const content = nav.clientHeight - parseFloat(navStyle.paddingTop) - parseFloat(navStyle.paddingBottom);
    const labels = [...nav.querySelectorAll(".mp-bottom-nav__label")].map((l) => l.getBoundingClientRect().bottom);
    const targets = [...nav.querySelectorAll("li > a, li > button")].map((t) => { const r = t.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const raisedIcon = nav.querySelector(".mp-bottom-nav__raised > span:first-child")!.getBoundingClientRect();
    const raisedLabel = nav.querySelector(".mp-bottom-nav__raised > span:last-child") as HTMLElement;
    return { ulScroll: ul.scrollHeight, content, labels, targets, raisedIconH: raisedIcon.height, raisedLabelClip: raisedLabel.scrollHeight > raisedLabel.clientHeight + 1, ih: window.innerHeight };
  });
  expect(m.ulScroll, JSON.stringify(m)).toBeLessThanOrEqual(m.content + 0.5);
  for (const bottom of m.labels) expect(bottom, JSON.stringify(m)).toBeLessThanOrEqual(m.ih);
  expect(m.raisedIconH).toBeGreaterThanOrEqual(24);
  expect(m.raisedLabelClip).toBe(false);
  expect(m.targets.length).toBe(5);
  for (const t of m.targets) { expect(t.w, JSON.stringify(m.targets)).toBeGreaterThanOrEqual(44); expect(t.h, JSON.stringify(m.targets)).toBeGreaterThanOrEqual(44); }
}

/** Composer with a thread: icon chip, one-line disclaimer with a 44 px Details target, <= 80 px tall. */
async function composerChecks(page: Page, langs: MentorUiLang[]) {
  const placeholders = Object.fromEntries(langs.map((l) => [l, (["composer_placeholder_facts", "composer_placeholder_explain", "composer_placeholder_study"] as const).map((k) => mentorT(k, l))]));
  const m = await page.evaluate((placeholders) => {
    const root = document.querySelector("[data-mentor-composer]") as HTMLElement;
    const ta = root.querySelector("textarea") as HTMLTextAreaElement;
    const cs = getComputedStyle(ta);
    const contentWidth = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
    document.body.appendChild(probe);
    const widths: Record<string, number[]> = {};
    for (const [l, texts] of Object.entries(placeholders as Record<string, string[]>)) widths[l] = texts.map((t) => { probe.textContent = t; return probe.getBoundingClientRect().width; });
    probe.remove();
    const chip = root.querySelector("[data-mentor-mode-chip]") as HTMLElement | null;
    const visibleChipText = chip ? [...chip.querySelectorAll("span")].filter((s) => getComputedStyle(s).display !== "none" && s.textContent).map((s) => s.textContent) : null;
    const disc = root.querySelector("[data-mentor-disclaimer]") as HTMLElement;
    const details = disc.querySelector("button") as HTMLElement;
    const hit = getComputedStyle(details, "::before");
    const truncated = disc.querySelector("span") as HTMLElement;
    return {
      contentWidth, widths, visibleChipText, chipW: chip?.getBoundingClientRect().width ?? 0,
      discH: disc.getBoundingClientRect().height, discTruncated: truncated.scrollWidth > truncated.clientWidth,
      hitW: parseFloat(hit.width), hitH: parseFloat(hit.height),
      composerH: root.getBoundingClientRect().height,
    };
  }, placeholders);
  for (const [l, ws] of Object.entries(m.widths)) for (const w of ws) expect(w, `${l} ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.contentWidth);
  expect(m.visibleChipText, JSON.stringify(m)).toEqual([]);
  expect(m.chipW).toBeGreaterThanOrEqual(44);
  expect(m.discH, JSON.stringify(m)).toBeLessThanOrEqual(24);
  expect(m.discTruncated, JSON.stringify(m)).toBe(false);
  expect(m.hitW).toBeGreaterThanOrEqual(44);
  expect(m.hitH).toBeGreaterThanOrEqual(44);
  expect(m.composerH, JSON.stringify(m)).toBeLessThanOrEqual(80);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const VIEWPORTS = [{ width: 375, height: 812 }, { width: 390, height: 844 }];
for (const vp of VIEWPORTS) for (const lang of ["de", "en"] as const) for (const dark of [false, true]) {
  test(`ready thread ${vp.width} ${lang} ${dark ? "dark" : "light"}: fixed frame, header, composer, tab bar`, async ({ page }) => {
    await page.setViewportSize(vp);
    const { errors } = await setup(page, { lang, dark, history: true });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Synthetic learner question 3", { exact: true })).toBeVisible();
    await expect(page.locator("[data-mentor-header] [role=status]")).toHaveCount(0);
    await page.waitForTimeout(400);
    await fixedFrame(page);
    await headerChecks(page);
    await composerChecks(page, vp.width === 390 ? [lang, "ru", "uk", "tr"] : [lang]);
    await tabBarChecks(page);
    expect(await page.locator("[role=log]").innerText()).not.toContain("**");
    await noOverflow(page, vp.width);
    await shot(page, `ready-${vp.width}-${lang}-${dark ? "dark" : "light"}`);
    // An answer lands: only the thread scrolls.
    await box(page).fill("Synthetic follow-up question");
    await sendButton(page, lang).click();
    await expect(page.locator("[role=log] article").last()).toBeVisible();
    await page.waitForTimeout(800);
    await fixedFrame(page);
    expect(errors).toEqual([]);
  });
}

for (const vp of VIEWPORTS) for (const lang of ["de", "en"] as const) {
  test(`loading ${vp.width} ${lang}: editable composer, disabled Send, status pill without jump`, async ({ page }) => {
    await page.setViewportSize(vp);
    const { errors, release, held } = await setup(page, { lang, usage: "hold" });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect.poll(() => held.length).toBeGreaterThan(0);
    const pill = page.locator("[data-mentor-header] [role=status]");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("aria-label", mentorT("credits_loading", lang));
    await expect(pill.locator("svg")).toHaveCount(1);
    const loadingW = (await pill.boundingBox())!.width;
    await expect(box(page)).not.toHaveAttribute("readonly", /.*/);
    await box(page).fill("Draft typed while credits load");
    await expect(box(page)).toHaveValue("Draft typed while credits load");
    await expect(sendButton(page, lang)).toBeDisabled();
    // The waiting Send must not keep the ready green fill.
    expect(await sendButton(page, lang).evaluate((b) => getComputedStyle(b).backgroundColor)).not.toBe(await page.evaluate(() => { const p = document.createElement("span"); p.style.color = "var(--mp-viridian)"; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }));
    await headerChecks(page);
    await fixedFrame(page);
    await noOverflow(page, vp.width);
    await shot(page, `loading-${vp.width}-${lang}`);
    await release();
    const ready = page.locator("[data-mentor-header] button[aria-expanded]");
    await expect(ready).toBeVisible();
    expect(Math.abs((await ready.boundingBox())!.width - loadingW)).toBeLessThanOrEqual(4);
    await expect(box(page)).toHaveValue("Draft typed while credits load");
    await expect(sendButton(page, lang)).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

for (const lang of ["de", "en"] as const) {
  test(`error 390 ${lang}: composer stays editable, Send waits, retry notice shows`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // a-mentor-reliability R3: the strip shows once the three retries (2/6/15 s) ran out.
    await page.clock.install();
    const { errors } = await setup(page, { lang, usage: "error" });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const strip = page.locator("[data-mentor-usage-strip]");
    for (let i = 0; i < 40 && !(await strip.count()); i++) await page.clock.runFor(1_000);
    await expect(strip).toContainText(mentorT("credits_load_failed", lang));
    await box(page).fill("Draft kept on error");
    await expect(box(page)).toHaveValue("Draft kept on error");
    await expect(sendButton(page, lang)).toBeDisabled();
    await headerChecks(page);
    await fixedFrame(page);
    await noOverflow(page, 390);
    await shot(page, `error-390-${lang}`);
    expect(errors).toEqual([]);
  });

  test(`empty 390 ${lang}: one disclaimer, no footer, legal links in Chat and data`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { errors } = await setup(page, { lang });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-mentor-header] button[aria-expanded]")).toBeVisible();
    await expect(page.locator("[data-mentor-disclaimer]")).toHaveCount(1);
    await expect(page.getByRole("log").locator("section p").filter({ hasText: lang === "de" ? "Lernhilfe" : "Study support" })).toHaveCount(0);
    await fixedFrame(page);
    await tabBarChecks(page);
    await noOverflow(page, 390);
    await shot(page, `empty-390-${lang}`);
    await page.getByRole("button", { name: lang === "de" ? "Chat und Daten" : "Chat and data", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: lang === "de" ? "Chat und Daten" : "Chat and data", exact: true });
    await expect(sheet).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== "running"));
    const labels = lang === "de" ? ["Impressum", "Datenschutz", "AGB", "Kontakt"] : ["Imprint", "Privacy", "Terms", "Contact"];
    const hrefs = ["/impressum", "/privacy", "/terms", "mailto:"];
    for (const [i, label] of labels.entries()) {
      const link = sheet.getByRole("link", { name: label, exact: true });
      await expect(link).toBeVisible();
      expect(await link.getAttribute("href")).toContain(hrefs[i]);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await shot(page, `sheet-390-${lang}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: lang === "de" ? "Details zum Mentor" : "Details about the mentor", exact: true }).click();
    const about = page.getByRole("dialog", { name: lang === "de" ? "Über den Mentor" : "About the mentor", exact: true });
    await expect(about.getByText(lang === "de" ? "Prüfen Sie Termine immer auf der offiziellen Seite." : "Always confirm dates on the official page.", { exact: true })).toBeVisible();
    await shot(page, `about-390-${lang}`);
    expect(errors).toEqual([]);
  });
}

test("loading then exhausted: the composer becomes read-only once usage says so", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { release, held } = await setup(page, { lang: "en", usage: "hold" });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await expect(box(page)).not.toHaveAttribute("readonly", /.*/);
  await release({ state: "exhausted", credits_left: 0, messages_left_estimate: 0 });
  await expect(box(page)).toHaveAttribute("readonly", "");
  await expect(sendButton(page, "en")).toHaveCount(0);
});

test("signed out: /mentor keeps Impressum, Privacy, Terms and Contact under the sign-in card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { lang: "de", signedOut: true });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  const legal = page.locator("[data-mentor-legal]");
  for (const label of ["Impressum", "Datenschutz", "AGB", "Kontakt"]) await expect(legal.getByRole("link", { name: label, exact: true })).toBeVisible();
  await shot(page, "signed-out-390-de");
});

test("footer: hidden on /mentor and /mentor/chat, kept on /mentor/packages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { lang: "en" });
  const footer = page.locator("footer[aria-label='Legal links']");
  for (const path of ["/mentor", "/mentor/chat"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-mentor-header]")).toBeVisible();
    await expect(footer).toHaveCount(0);
  }
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  await expect(footer).toHaveCount(1);
});

test("offline banner: frame shrinks by the banner height, document still does not scroll", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await setup(page, { lang: "en", history: true });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Synthetic learner question 3", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mp-banner-h")) || 0), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => ({ main: document.querySelector("main")!.getBoundingClientRect().height, banner: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mp-banner-h")), ih: window.innerHeight }));
  expect(Math.abs(m.main - (m.ih - m.banner)), JSON.stringify(m)).toBeLessThanOrEqual(1);
  await fixedFrame(page);
  await shot(page, "offline-banner-390-en");
  await context.setOffline(false);
  expect(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/.test(e))).toEqual([]);
});

for (const limit of ["minute", "month"] as const) {
  test(`${limit} limit stays read-only`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { state } = await setup(page, { lang: "en", chat: limit });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(sendButton(page, "en")).toBeVisible();
    await box(page).fill("Synthetic question");
    await sendButton(page, "en").click();
    await expect.poll(() => state.chatCalls).toBe(1);
    await expect(box(page)).toHaveAttribute("readonly", "");
    await fixedFrame(page);
    await shot(page, `${limit}-limit-390-en`);
  });
}

// Smoke only: at 320 the title may truncate with an ellipsis, but it never wraps.
test("320x568 smoke: no overflow, title on one line, no console errors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { errors } = await setup(page, { lang: "de", history: true });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Synthetic learner question 3", { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  const h1 = await page.evaluate(() => { const h = document.querySelector("[data-mentor-header] h1") as HTMLElement; return { h: h.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(h).lineHeight) }; });
  expect(h1.h, JSON.stringify(h1)).toBeLessThanOrEqual(h1.lh + 1);
  await fixedFrame(page);
  await noOverflow(page, 320);
  await shot(page, "ready-320-de");
  expect(errors).toEqual([]);
});

test("safe areas: env() bottom clauses stay in the mentor nav rule and the sheets", () => {
  const frame = readFileSync("src/components/mentor/MentorFrame.tsx", "utf8");
  expect(frame).toContain("--mobile-nav-clearance: calc(46px + env(safe-area-inset-bottom, 0px))");
  expect(frame).toMatch(/\.bottom-nav \{ height: var\(--mobile-nav-clearance\); padding-bottom: env\(safe-area-inset-bottom, 0px\); \}/);
  expect(readFileSync("src/components/mentor/MentorMoreSheet.tsx", "utf8")).toContain("padding-bottom:calc(16px + env(safe-area-inset-bottom))");
  expect(readFileSync("src/app/globals.css", "utf8")).toMatch(/\[data-mentor-sheet\]\) \{[^}]*padding-bottom:env\(safe-area-inset-bottom\)/);
});

test.describe("desktop 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  for (const lang of ["de", "en"] as const) for (const dark of [false, true]) {
    test(`desktop ${lang} ${dark ? "dark" : "light"}: fixed frame, sidebar, labelled header controls, no footer`, async ({ page }) => {
      const { errors } = await setup(page, { lang, dark, history: true });
      await page.goto("/mentor", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Synthetic learner question 3", { exact: true })).toBeVisible();
      await page.waitForTimeout(400);
      await expect(page.locator(".sidebar").first()).toBeVisible();
      const header = page.locator("[data-mentor-header]");
      await expect(header.getByText(mentorT("btn_new_chat", lang), { exact: true })).toBeVisible();
      await expect(header.getByText(lang === "de" ? "Chat und Daten" : "Chat and data", { exact: true })).toBeVisible();
      await expect(page.locator("[data-mentor-mode-chip] span.truncate")).toBeVisible();
      await fixedFrame(page);
      await noOverflow(page, 1280);
      await shot(page, `desktop-1280-${lang}-${dark ? "dark" : "light"}`);
      expect(errors).toEqual([]);
    });
  }
});
