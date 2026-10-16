import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";
import type { MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";
import { mentorT } from "../../../src/lib/i18n-mentor";

// a-mentor-mobile-1: the answer card on phones. API fakes only, no provider or
// production writes. Run only through with-heavy. Screenshots go to SHOTS when set.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const SHOTS = process.env.MENTOR_MOBILE_SHOTS;
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = { fact_id: "sip4a.registration", source_label: "MedUni Wien", source_url: "https://www.meduniwien.ac.at/pruefungskalender", read_on: "2026-10-10", review_every_days: 30 };
const ALIAS = { ...SOURCE, fact_id: "sip4a.no-late-registration" };
const OTHER = { fact_id: "sip.format", source_label: "Österreichische Ärztekammer", source_url: "https://example.org/oeak-format", read_on: "2026-10-10", review_every_days: 30 };

type Lang = "en" | "de";
const TEXT: Record<Lang, { block1: string; block2: string; date: string; deadline: RegExp; calendar: string; cost: string }> = {
  en: {
    block1: "**Registration SIP4a (MedUni Vienna): until October 19, 2026, 5 days left (open).** Sitting: **November 18, 2026**.",
    block2: "Per the MedUni Vienna Pruefungskalender, late registrations are not possible for any reason, and the Anmeldefrist cannot be exceeded.",
    date: "October 19, 2026", deadline: /^Registration SIP4a/, calendar: "Exam calendar", cost: "This answer: 0.8 credits. 4.2 left.",
  },
  de: {
    block1: "**Anmeldung SIP4a (MedUni Wien): bis 19. Oktober 2026, noch 5 Tage (offen).** Termin: **18. November 2026**.",
    block2: "Laut Prüfungskalender der MedUni Wien ist eine verspätete Anmeldung aus keinem Grund möglich.",
    date: "19. Oktober 2026", deadline: /^Anmeldung SIP4a/, calendar: "Prüfungskalender", cost: "Diese Antwort: 0,8 Credits. Noch 4,2 übrig.",
  },
};

function productionFinal(lang: Lang, creditsLeft = 999.2488): MentorFinalEvent {
  const t = TEXT[lang];
  return {
    ...FIXTURE_FINAL_OK, request_id: REQUEST,
    answer_blocks: [
      { text: t.block1, fact_ids: [SOURCE.fact_id], confirmed_dates: [t.date], date_type: "deadline" },
      { text: t.block2, fact_ids: [ALIAS.fact_id] },
    ],
    citations: [SOURCE, ALIAS], next_actions: [{ kind: "open_exam_dates" }],
    credits_used: 0.7512, credits_left: creditsLeft,
  } as MentorFinalEvent;
}

async function setup(page: Page, opts: { lang: Lang; dark?: boolean; final?: MentorFinalEvent; history?: unknown }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    // External hosts are aborted on purpose below; their load failures are not app errors.
    if (/Failed to load resource/.test(m.text()) && url && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return;
    errors.push(m.text());
  });
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  await seedSession(page, { userId: USER, email: "mentor-fixture@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.setItem("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da", "1");
  }, { lang: opts.lang, dark: !!opts.dark });
  await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const final = opts.final ?? productionFinal(opts.lang);
  const usage: MentorUsageResponse = { state: "ok", credits_left: final.credits_left, messages_left_estimate: 140, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: false };
  const reports: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") return route.fulfill({ json: usage });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: opts.history ?? { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat") return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(final)}\n\n` });
    if (path === "/api/mentor/report") { reports.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  return { errors, reports };
}

async function ask(page: Page, lang: Lang) {
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: mentorT("composer_label", lang) }).fill("When is the next SIP4a sitting?");
  await page.getByRole("button", { name: mentorT("btn_send", lang), exact: true }).click();
  await expect(page.locator("[data-mentor-answer-footer]")).toBeVisible();
}

const log = (page: Page) => page.locator("[role=log]");
/** Strict: against the width we set (mobile emulation would otherwise zoom out and widen innerWidth). */
async function noOverflow(page: Page, width: number) {
  await expectNoHorizontalScroll(page);
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth, scale: window.visualViewport?.scale ?? 1 }));
  expect(m.sw, JSON.stringify(m)).toBeLessThanOrEqual(width);
  expect(m.iw, JSON.stringify(m)).toBe(width);
  expect(m.scale, JSON.stringify(m)).toBe(1);
}
/** Wait until smooth scrolling and entry animations under the log have settled. */
async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const top = await page.evaluate(() => document.querySelector("[role=log]")!.scrollTop + window.scrollY);
    if (top === last) return;
    last = top; await page.waitForTimeout(100);
  }
}

for (const vp of [{ width: 375, height: 812 }, { width: 390, height: 844 }]) {
  for (const lang of ["en", "de"] as const) {
    for (const dark of [false, true]) {
      test(`answer card ${vp.width}x${vp.height} ${lang} ${dark ? "dark" : "light"}`, async ({ page }) => {
        await page.setViewportSize(vp);
        const { errors } = await setup(page, { lang, dark });
        await ask(page, lang);
        const t = TEXT[lang];
        // AC-1: no raw markdown, the deadline line is bold, EN starts with a capital R.
        await expect(log(page)).not.toContainText("**");
        const lead = log(page).locator("strong").first();
        await expect(lead).toHaveText(t.deadline);
        await expect(lead.locator("strong")).toHaveText(t.date);
        // AC-6: the calendar action.
        const calendar = page.locator("[data-mentor-next-actions]").getByRole("link", { name: t.calendar, exact: true });
        const url = new URL((await calendar.getAttribute("href"))!, "https://medpruf.com");
        expect(url.pathname).toBe("/pruefungskalender");
        expect(url.searchParams.get("from")).toBe("mentor");
        expect(url.searchParams.get("lang")).toBe(lang === "de" ? null : "en");
        // AC-2: one source, no inline markers.
        await expect(page.locator("[data-mentor-citation-marker]")).toHaveCount(0);
        // AC-4: one footer row, lower than the answer text; the flag is 44x44.
        await settle(page);
        const g = await page.evaluate(() => {
          const footer = document.querySelector("[data-mentor-answer-footer]")!.getBoundingClientRect();
          const text = document.querySelector("[role=log] .space-y-2\\.5")!.getBoundingClientRect();
          const flag = [...document.querySelectorAll("[data-mentor-answer-footer] button")].find((b) => /^(Report answer|Antwort melden):/.test(b.getAttribute("aria-label") ?? ""))!.getBoundingClientRect();
          return { footerH: footer.height, footerMid: footer.top + footer.height / 2, textH: text.height, flagW: flag.width, flagH: flag.height, flagMid: flag.top + flag.height / 2 };
        });
        expect(g.footerH, JSON.stringify(g)).toBeLessThanOrEqual(48);
        expect(g.footerH).toBeLessThan(g.textH);
        expect(g.flagW).toBeGreaterThanOrEqual(44); expect(g.flagH).toBeGreaterThanOrEqual(44);
        expect(Math.abs(g.flagMid - g.footerMid)).toBeLessThan(4);
        await expect(page.getByRole("button", { name: lang === "de" ? /^Antwort melden:/ : /^Report answer:/ })).toBeVisible();
        // AC-5: balance above 20, no cost text and no old toggle.
        await expect(page.locator("[data-mentor-cost-line]")).toHaveCount(0);
        await expect(page.getByText(/Answer credit cost|Credit-Kosten der Antwort/)).toHaveCount(0);
        // Composer still usable after the answer.
        const composer = page.locator("[data-mentor-composer]");
        await expect(composer).toBeInViewport();
        const box = page.getByRole("textbox", { name: mentorT("composer_label", lang) });
        await box.fill("Next question");
        await expect(box).toHaveValue("Next question");
        await noOverflow(page, vp.width);
        if (SHOTS) {
          await page.locator("article").last().scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${SHOTS}/answer-${vp.width}x${vp.height}-${lang}-${dark ? "dark" : "light"}.png` });
        }
        expect(errors).toEqual([]);
      });
    }
  }
}

test("report flag opens the report sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { errors } = await setup(page, { lang: "en" });
  await ask(page, "en");
  const flag = page.getByRole("button", { name: /^Report answer:/ });
  await expect(flag).toHaveAttribute("title", "Report a problem with this answer");
  await flag.click();
  await expect(page.getByRole("dialog", { name: mentorT("report_answer", "en") })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/report-sheet-375x812-en-light.png` });
  expect(errors).toEqual([]);
});

for (const lang of ["en", "de"] as const) {
  test(`cost meta under 20 credits is plain text (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const { errors } = await setup(page, { lang, final: productionFinal(lang, 4.2488) });
    await ask(page, lang);
    const cost = page.locator("[data-mentor-cost-line]");
    await expect(cost).toHaveText(TEXT[lang].cost);
    expect(await cost.evaluate((el) => el.closest("button"))).toBeNull();
    // With the cost line the row may wrap to two lines on a phone.
    await settle(page);
    const footerBox = (await page.locator("[data-mentor-answer-footer]").boundingBox())!;
    expect(footerBox.height).toBeLessThanOrEqual(100);
    await noOverflow(page, 375);
    if (SHOTS) {
      await page.locator("article").last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/cost-375x812-${lang}-light.png` });
    }
    expect(errors).toEqual([]);
  });
}

test("two distinct sources: small markers on the last text line with a 44px hit area", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const final = productionFinal("en");
  final.answer_blocks = [final.answer_blocks[0], { text: "The written exam has multiple choice questions in German.", fact_ids: [OTHER.fact_id] }];
  final.citations = [SOURCE, OTHER];
  const { errors } = await setup(page, { lang: "en", final });
  await ask(page, "en");
  const markers = page.locator("[data-mentor-citation-marker]");
  await expect(markers).toHaveCount(2);
  await settle(page);
  for (const marker of await markers.all()) {
    const geometry = await marker.evaluate((el) => {
      const p = el.closest("p, li")!;
      const textRects: DOMRect[] = [];
      for (const node of p.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE && !(node instanceof HTMLElement && !node.hasAttribute("data-mentor-citation-marker"))) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        textRects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
      }
      const box = el.getBoundingClientRect();
      const before = getComputedStyle(el, "::before");
      const last = textRects.reduce((a, r) => (r.bottom > a.bottom ? r : a));
      return { height: box.height, top: box.top, bottom: box.bottom, lastTop: last.top, lastBottom: last.bottom, hitW: parseFloat(before.width), hitH: parseFloat(before.height), parentTag: p.tagName };
    });
    expect(geometry.parentTag).toMatch(/^(P|LI)$/);
    expect(geometry.height).toBeLessThanOrEqual(16);
    expect(geometry.hitW).toBeGreaterThanOrEqual(44); expect(geometry.hitH).toBeGreaterThanOrEqual(44);
    // Same line box: the marker overlaps the last line of its paragraph.
    expect(geometry.bottom).toBeGreaterThan(geometry.lastTop);
    expect(geometry.top).toBeLessThan(geometry.lastBottom);
  }
  await noOverflow(page, 375);
  if (SHOTS) {
    await page.locator("article").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/two-sources-375x812-en-light.png` });
  }
  expect(errors).toEqual([]);
});

test("model bold term and a restored text-only answer render without asterisks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const history = { conversation_id: "00000000-0000-4000-8000-00000000c0a9", messages: [
    { id: "1", role: "user", text: "Erklären Sie die Anämie" },
    { id: "2", role: "assistant", text: "Die Anämie ist **megaloblastär**.\n**Anmeldung SIP4a (MedUni Wien): bis 19. Oktober 2026, noch 5 Tage (offen).**" },
  ] };
  const { errors } = await setup(page, { lang: "de", history });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await expect(log(page).getByText("megaloblastär", { exact: true })).toBeVisible();
  await expect(log(page)).not.toContainText("**");
  await expect(log(page).locator("strong", { hasText: "megaloblastär" })).toHaveCount(1);
  await expect(log(page).locator("strong", { hasText: /^Anmeldung SIP4a/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("320 px smoke: footer may wrap, nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const final = productionFinal("de", 4.2488);
  final.next_actions = [{ kind: "set_exam_date", exam_date: "2026-11-18", sitting_label: "SIP4a" }, { kind: "open_exam_dates" }, { kind: "deadline_reminder", exam_date: "2026-11-18" }];
  const { errors } = await setup(page, { lang: "de", final });
  await ask(page, "de");
  await expect(log(page)).not.toContainText("**");
  const footerBox = (await page.locator("[data-mentor-answer-footer]").boundingBox())!;
  expect(footerBox.height).toBeLessThanOrEqual(150);
  await noOverflow(page, 320);
  if (SHOTS) {
    await page.locator("article").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/smoke-320x568-de-light.png` });
  }
  expect(errors).toEqual([]);
});

test("safe-area clauses are still in the mentor nav rule and the bottom sheets", async () => {
  const { readFileSync } = await import("node:fs");
  // MentorFrame belongs to a-mentor-mobile-2; only require that its nav still pads for the inset.
  expect(readFileSync("src/components/mentor/MentorFrame.tsx", "utf8")).toMatch(/padding-bottom:[^;}]*env\(safe-area-inset-bottom/);
  expect(readFileSync("src/components/mentor/ReportAnswerSheet.tsx", "utf8")).toContain("padding-bottom: env(safe-area-inset-bottom)");
  expect(readFileSync("src/components/mentor/ExamDateAction.tsx", "utf8")).toContain("env(safe-area-inset-bottom)");
});
