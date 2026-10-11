import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { FIXTURE_FINAL_OK, FIXTURE_PACKAGES } from "../../../src/lib/mentor/fixtures";
import type { MentorChatRequest, MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";
import type { MentorThread } from "../../../src/lib/mentor/thread";
import { mentorT } from "../../../src/lib/i18n-mentor";

// Synthetic owner and localhost mocks only. track-A runs this acceptance suite.
test.use({ browserName: "webkit", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const CONVERSATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const draftText = "Synthetic learner question, preserve all of this text.";
const messageBox = (page: Page) => page.locator("[data-mentor-composer] textarea");
const shellStatus = (page: Page) => page.locator("main > [role=status]");
async function setup(page: Page, lang: "en" | "ru" = "en", dark = false) {
  await seedSession(page, { userId: USER, email: "mentor-shell-r3@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
  }, { lang, dark });
  const fake = {
    behavior: "success" as "success" | "error" | "paywall" | "minute" | "day" | "hold",
    usage: { state: "ok", credits_left: 120, messages_left_estimate: 120, sources: ["package"], subscriptions: [], next_expiry: null, can_buy: true } as MentorUsageResponse,
    requests: [] as MentorChatRequest[], results: [] as string[], historyCalls: [] as string[],
    history: { conversation_id: null, messages: [] } as MentorThread,
    final: { ...FIXTURE_FINAL_OK, conversation_id: CONVERSATION, answer_blocks: [{ text: "Synthetic delivered answer.", fact_ids: [] }], citations: [] } as MentorFinalEvent,
  };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort();
    if (url.pathname === "/api/mentor/usage") return route.fulfill({ json: fake.usage });
    if (url.pathname === "/api/mentor/packages") return route.fulfill({ json: FIXTURE_PACKAGES });
    if (url.pathname === "/api/mentor/chat/history") { fake.historyCalls.push(url.search); return route.fulfill({ json: fake.history }); }
    if (url.pathname === "/api/mentor/chat/result") { fake.results.push(url.searchParams.get("client_request_id")!); return route.fulfill({ json: { status: fake.behavior === "hold" ? "in_progress" : "missing" } }); }
    if (url.pathname === "/api/mentor/chat") {
      const request = route.request().postDataJSON() as MentorChatRequest; fake.requests.push(request);
      if (fake.behavior === "hold") return;
      if (fake.behavior === "minute" || fake.behavior === "day") return route.fulfill({ status: 429, json: { error: "rate_limited", limit: fake.behavior, retry_after_seconds: fake.behavior === "minute" ? 31 : 3_600 } });
      if (fake.behavior === "error") return route.fulfill({ status: 503, json: { error: "upstream_error" } });
      if (fake.behavior === "paywall") return route.fulfill({ status: 402, json: { error: "credits_exhausted", packages_url: "/mentor/packages" } });
      fake.history = { conversation_id: CONVERSATION, messages: [{ id: `owner-user-${fake.requests.length}`, role: "user", text: request.message }, { id: `owner-answer-${fake.requests.length}`, role: "assistant", text: "Synthetic delivered answer.", final: fake.final }] };
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(fake.final)}\n\n` });
    }
    if (url.pathname === "/api/mentor/checkout/verify") return route.fulfill({ json: { status: "granted", credits_left: 162, credits_added: 150 } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
    return route.continue();
  });
  return fake;
}
async function send(page: Page, text = draftText, lang: "en" | "ru" = "en") {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: mentorT("btn_send", lang), exact: true }).click();
}
async function caretAtEnd(page: Page, text: string) {
  await expect(messageBox(page)).toHaveValue(text);
  await expect(messageBox(page)).toBeFocused();
  expect(await messageBox(page).evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([text.length, text.length]);
}
async function watchAnnouncements(page: Page) {
  await page.evaluate(() => {
    const status = document.querySelector("main > [role=status]")!;
    const windowState = window as unknown as { r3Announcements: string[] };
    windowState.r3Announcements = [];
    new MutationObserver(() => windowState.r3Announcements.push(status.textContent ?? "")).observe(status, { childList: true, subtree: true, characterData: true });
  });
}
const announcements = (page: Page) => page.evaluate(() => (window as unknown as { r3Announcements: string[] }).r3Announcements);

for (const behavior of ["error", "paywall"] as const) test(`MUX-28 ${behavior} restores the complete draft, caret and one announcement, then reload retains it`, async ({ page }) => {
  const fake = await setup(page); fake.behavior = behavior;
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  await watchAnnouncements(page); await send(page);
  await caretAtEnd(page, draftText);
  await expect(shellStatus(page)).toHaveText("Question restored");
  expect((await announcements(page)).filter(text => text === "Question restored")).toHaveLength(1);
  if (behavior === "paywall") await expect(page.getByText("Your question is saved", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(messageBox(page)).toHaveValue(draftText);
});

test("MUX-28/33 successful credit return restores the saved question and owner thread, and one tap sends", async ({ page }) => {
  const fake = await setup(page); fake.behavior = "paywall";
  await page.goto("/mentor", { waitUntil: "domcontentloaded" }); await send(page);
  await expect(messageBox(page)).toHaveValue(draftText);
  fake.history = { conversation_id: CONVERSATION, messages: [{ id: "owner-prior-user", role: "user", text: "Prior owner question" }, { id: "owner-prior-answer", role: "assistant", text: "Prior owner answer", final: { ...fake.final, answer_blocks: [{ text: "Prior owner answer", fact_ids: [] }] } }] };
  await page.goto("/mentor/checkout/success?checkout_session_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/150 credits/i).first()).toBeVisible();
  await page.getByRole("link", { name: mentorT("btn_back_to_mentor", "en"), exact: true }).click();
  await expect(messageBox(page)).toHaveValue(draftText);
  await expect(page.getByText("Prior owner answer", { exact: true })).toBeVisible();
  fake.behavior = "success";
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Synthetic delivered answer.", { exact: true })).toBeVisible();
  expect(fake.requests).toHaveLength(2); expect(fake.requests[1].message).toBe(draftText);
  await expect(messageBox(page)).toHaveValue("");
});

test("MUX-33 reload, fresh server restore, resume and package return converge on the same owner thread", async ({ page }) => {
  const fake = await setup(page);
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  const newChat = page.getByRole("button", { name: "New chat", exact: true });
  await expect(newChat).toBeVisible(); await expect(newChat).toHaveAttribute("aria-disabled", "true");
  await send(page); await expect(page.getByText("Synthetic delivered answer.", { exact: true })).toBeVisible();
  await expect(page.getByText("The mentor remembers the last few messages.", { exact: true })).toBeVisible();
  await page.evaluate(user => { sessionStorage.removeItem(`medpruef_mentor_${user}_chat`); }, USER);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Synthetic delivered answer.", { exact: true })).toBeVisible();
  const initialReads = fake.historyCalls.length;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => fake.historyCalls.length).toBeGreaterThan(initialReads);
  await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: mentorT("btn_back_to_mentor", "en"), exact: true }).click();
  await expect(page.getByText("Synthetic delivered answer.", { exact: true })).toBeVisible();
  expect(fake.requests).toHaveLength(1);
});

test("MUX-27 minute limit announces exactly 30, 10 and 0, with aria-hidden visual countdown", async ({ page }) => {
  await page.clock.install(); const fake = await setup(page); fake.behavior = "minute";
  await page.goto("/mentor", { waitUntil: "domcontentloaded" }); await send(page);
  await expect(messageBox(page)).toHaveAttribute("readonly", "");
  await watchAnnouncements(page);
  await page.clock.runFor(1_000);
  await expect(shellStatus(page)).toHaveText("Short break: you can ask again in 30 seconds.");
  await expect(page.locator("main > div[aria-hidden=true]")).toHaveText("Short break: you can ask again in 30 seconds.");
  await page.clock.runFor(20_000);
  await expect(shellStatus(page)).toHaveText("Short break: you can ask again in 10 seconds.");
  await page.clock.runFor(10_000);
  await expect(shellStatus(page)).toHaveText("You can ask again.");
  expect((await announcements(page)).filter(text => /^Short break:|^You can ask again\.$/.test(text))).toEqual(["Short break: you can ask again in 30 seconds.", "Short break: you can ask again in 10 seconds.", "You can ask again."]);
  expect(fake.requests).toHaveLength(1);
});

test("MUX-27 daily cap survives New chat and reload without another POST", async ({ page }) => {
  await page.clock.install(); const fake = await setup(page); fake.behavior = "day";
  await page.goto("/mentor", { waitUntil: "domcontentloaded" }); await send(page);
  const day = "Daily limit reached (60 messages). Your credits are kept. You can continue from 00:00 Vienna time.";
  await expect(page.locator("main > div[aria-hidden=true]")).toHaveText(day);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(messageBox(page)).toHaveAttribute("readonly", "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(messageBox(page)).toHaveAttribute("readonly", "");
  await expect(page.locator("main > div[aria-hidden=true]")).toHaveText(day);
  expect(fake.requests).toHaveLength(1);
});

test("MUX-34 RU controls fit 360px, arrow keys select equal 44px segments and native names open in a keyboard sheet", async ({ page }) => {
  await setup(page, "ru"); await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/mentor", { waitUntil: "domcontentloaded" });
  const modes = page.locator("[data-mentor-composer] [role=radiogroup]").first();
  const radios = modes.getByRole("radio"); await expect(radios).toHaveCount(2);
  const boxes = await Promise.all((await radios.all()).map(radio => radio.boundingBox()));
  expect(boxes[0]!.width).toBeCloseTo(boxes[1]!.width, 0);
  for (const box of boxes) { expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(360); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await radios.first().focus(); await page.keyboard.press("ArrowRight");
  await expect(radios.nth(1)).toBeFocused(); await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
  const language = page.getByRole("button", { name: /^Язык ответа:/ });
  expect((await language.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await language.focus(); await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Язык ответа" });
  await expect(sheet).toBeVisible();
  for (const name of ["Deutsch", "English", "Русский (бета)", "Українська (бета)", "Türkçe (beta)", "Français"]) await expect(sheet.getByRole("button", { name, exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "English", exact: true }).click();
  await send(page, "Synthetic learner question", "ru");
  const options = page.locator("[data-mentor-composer] button[aria-expanded]");
  await expect(options).toHaveCount(1); await expect(options).toContainText("Стратегия обучения");
  await expect(page.locator("[data-mentor-composer] [role=radiogroup]")).toHaveCount(0);
  await page.screenshot({ path: "tests/e2e/.artifacts/mentor-r3-controls-ru360.png" });
});

async function auditColors(locator: Locator) {
  return locator.evaluate(node => {
    const rgba = (color: string): number[] => {
      const parts = color.match(/[\d.]+/g)?.map(Number) ?? [];
      if (parts.length < 3) throw new Error(`Unsupported browser color: ${color}`);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const blend = (a: number[], b: number[]) => [0,1,2].map(i => a[i] * a[3] + b[i] * (1-a[3])).concat(1);
    const background = (element: Element | null): number[] => element ? blend(rgba(getComputedStyle(element).backgroundColor), background(element.parentElement)) : [255,255,255,1];
    const luminance = (color: number[]) => color.slice(0,3).map(v => { const n = v/255; return n <= 0.04045 ? n/12.92 : ((n+0.055)/1.055)**2.4; }).reduce((n,v,i) => n+v*[0.2126,0.7152,0.0722][i],0);
    const ratio = (a: number[], b: number[]) => { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
    const style = getComputedStyle(node), bg = background(node), parentBg = background(node.parentElement);
    const fg = blend(rgba(style.color), bg), border = blend(rgba(style.borderTopColor), parentBg);
    return { textContrast: ratio(fg,bg), fillContrast: ratio(bg,parentBg), borderContrast: ratio(border,parentBg), color:style.color, background:style.backgroundColor, borderWidth:parseFloat(style.borderTopWidth), opacity:style.opacity };
  });
}
async function fontScan(page: Page) {
  return page.evaluate(() => {
    const violations: Array<{text:string;size:number}> = [];
    for (const root of document.querySelectorAll("main:has([data-mentor-header]), main[data-mentor-packages], [data-mentor-sheet]")) {
      const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text=walker.currentNode.textContent?.trim(), parent=walker.currentNode.parentElement;
        if (!text || !parent || parent.closest('[aria-hidden="true"],.sr-only')) continue;
        const style=getComputedStyle(parent), rect=parent.getBoundingClientRect();
        if (!rect.width || !rect.height || style.visibility==="hidden" || style.display==="none") continue;
        const size=parseFloat(style.fontSize);
        if (size<12) violations.push({text:text.slice(0,70),size});
      }
    }
    return violations;
  });
}
async function solidFocus(locator: Locator) {
  const style = await locator.evaluate(node => { const s=getComputedStyle(node); return {width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),style:s.outlineStyle}; });
  expect(style.width).toBeGreaterThanOrEqual(2); expect(style.offset).toBeGreaterThanOrEqual(2); expect(style.style).toBe("solid");
}

for (const dark of [false,true]) test(`MUX-43/45/46 ${dark ? "dark" : "light"} contrast, keyboard outlines and computed caption floor`, async ({ page }) => {
  await setup(page,"en",dark); await page.setViewportSize({width:390,height:844});
  await page.goto("/mentor",{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("button",{name:"Send",exact:true})).toBeDisabled();
  expect(await page.locator("main").evaluate(node=>getComputedStyle(node).getPropertyValue("--mp-text-caption").trim())).toBe("12px");
  expect(await fontScan(page)).toEqual([]);
  const fullDisclaimer = page.getByRole("log").locator("section p").filter({ hasText: "Study support, no medical or legal advice." });
  await expect(fullDisclaimer).toBeVisible();
  expect(await fullDisclaimer.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBe(13);
  const disclaimer=page.locator("[data-mentor-composer] p").filter({hasText:"Study support, no medical or legal advice."}).first();
  expect((await auditColors(disclaimer)).textContrast).toBeGreaterThanOrEqual(4.5);
  const disabled=await auditColors(page.getByRole("button",{name:"Send",exact:true}));
  expect(disabled.opacity).toBe("1"); expect(disabled.borderWidth).toBeGreaterThanOrEqual(1);
  await page.keyboard.press("Tab");
  const starter=page.getByRole("log").locator("section button").first();
  await starter.focus(); await solidFocus(starter);
  const chip=page.locator("[data-mentor-composer] [role=radio]").first();
  await chip.focus(); await solidFocus(chip);
  const language=page.getByRole("button",{name:/^Answer language:/});
  await language.focus(); await solidFocus(language);
  await messageBox(page).focus(); await solidFocus(page.locator("[data-mentor-state-bar]"));
  await messageBox(page).fill(draftText);
  const sendButton=page.getByRole("button",{name:"Send",exact:true});
  if(dark) { const active=await auditColors(sendButton); expect(active.textContrast).toBeGreaterThanOrEqual(4.5); expect(active.background).toBe("rgb(77, 141, 240)"); expect(active.color).toBe("rgb(0, 16, 40)"); }
  await sendButton.click(); await expect(messageBox(page)).toHaveValue("");
  const userBubble=page.locator("article.justify-end > p").first();
  if(dark) { const bubble=await auditColors(userBubble); expect(Math.max(bubble.fillContrast,bubble.borderContrast)).toBeGreaterThanOrEqual(3); }
  expect(await fontScan(page)).toEqual([]);
  await page.screenshot({path:`tests/e2e/.artifacts/mentor-r3-${dark ? "dark" : "light"}-focus-font.png`});
  await page.goto("/mentor/packages",{waitUntil:"domcontentloaded"});
  expect(await fontScan(page)).toEqual([]);
  const packageButton=page.locator("[data-mentor-package-offers] button").first();
  await page.keyboard.press("Tab"); await packageButton.focus(); await solidFocus(packageButton);
  if(dark) expect((await auditColors(packageButton)).textContrast).toBeGreaterThanOrEqual(4.5);
});

test("MUX-52 More opens a bottom sheet, traps focus, explains scope/data and Escape returns to trigger", async ({page}) => {
  await setup(page); await page.setViewportSize({width:390,height:844});
  await page.goto("/mentor",{waitUntil:"domcontentloaded"});
  const trigger=page.getByRole("button",{name:"More",exact:true});
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog=page.getByRole("dialog",{name:"More",exact:true});
  await expect(dialog).toHaveAttribute("aria-modal","true");
  for(const text of [/checked sources and your progress/,/does not decide eligibility/,/Report wrong or outdated answers/,/retained for up to 30 days/]) await expect(dialog.getByText(text)).toBeVisible();
  const bounds=await dialog.boundingBox(); expect(bounds!.y+bounds!.height).toBeCloseTo(844,0);
  const controls=dialog.locator('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
  await controls.last().focus(); await page.keyboard.press("Tab"); await expect(controls.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(controls.last()).toBeFocused();
  expect(await fontScan(page)).toEqual([]);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});

test("MUX-40 reserved static wait, 8s notice, 45s recovery and 55s same-UUID retry", async ({page}) => {
  await page.clock.install(); await page.emulateMedia({reducedMotion:"reduce"});
  const fake=await setup(page); fake.behavior="hold";
  await page.goto("/mentor",{waitUntil:"domcontentloaded"}); await send(page);
  await expect.poll(()=>fake.requests.length).toBe(1);
  const waiting=page.locator('[id^="mentor-message-a-"] .min-h-20').last();
  expect((await waiting.boundingBox())!.height).toBeGreaterThanOrEqual(80);
  const animations=await waiting.locator("[aria-hidden=true] *").evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).animationName));
  expect(animations.every(name=>name==="none")).toBe(true);
  await page.clock.runFor(8_001); await expect(page.getByText("This is taking longer than usual. You can stop and try later.",{exact:true})).toBeVisible();
  await page.clock.runFor(37_000); await expect.poll(()=>fake.results.length).toBeGreaterThan(0);
  expect(fake.results.every(id=>id===fake.requests[0].client_request_id)).toBe(true);
  await page.clock.runFor(10_001);
  await expect(page.getByText("The answer did not arrive",{exact:true})).toBeVisible();
  await expect(messageBox(page)).toHaveValue(draftText);
  fake.behavior="success";
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await expect.poll(()=>fake.requests.length).toBe(2);
  expect(fake.requests[1]).toEqual(fake.requests[0]);
  await expect(page.getByText("Synthetic delivered answer.",{exact:true})).toBeVisible();
});
