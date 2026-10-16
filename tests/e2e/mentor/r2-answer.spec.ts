import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";
import type { MentorChatRequest, MentorFinalEvent, MentorUsageResponse } from "../../../src/lib/mentor/contract";
import { mentorT } from "../../../src/lib/i18n-mentor";


// API fakes only, no provider or production writes. Run only through with-heavy.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = { fact_id: "fixture.source", source_label: "Synthetic official office with a long label that must wrap", source_url: "https://example.org/synthetic-official-office", read_on: "2026-10-10", review_every_days: 30 };

async function setup(page: Page, lang: "en" | "de" | "ru" | "uk" | "tr" | "ar" = "en", dark = false) {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00Z"));
  await seedSession(page, { userId: USER, email: "mentor-fixture@example.invalid", tier: "pro" });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_theme", dark ? "dark" : "light");
    localStorage.setItem("medpruef_cookies", "declined");
    localStorage.removeItem("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da");
  }, { lang, dark });
  await page.context().route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const fake = {
    final: { ...FIXTURE_FINAL_OK, request_id: REQUEST, answer_blocks: [{ text: "Synthetic backed answer. Stand 2026-10-10", fact_ids: [SOURCE.fact_id] }], citations: [SOURCE] } as MentorFinalEvent,
    requests: [] as MentorChatRequest[],
    reports: [] as Array<Record<string, unknown>>,
  };
  const usage: MentorUsageResponse = { state: "ok", credits_left: 142, messages_left_estimate: 140, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: false };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") return route.fulfill({ json: usage });
    if (path === "/api/mentor/chat") {
      fake.requests.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(fake.final)}\n\n` });
    }
    if (path === "/api/mentor/report") { fake.reports.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (path === "/api/questions") return route.fulfill({ json: [{ id: 5, question: "Synthetic question to report", explanation: "Synthetic explanation", topic: "Synthetic" }] });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: USER, role: "user", tier: "pro", email_status: "valid" } } });
    return route.fulfill({ json: {} });
  });
  return fake;
}
async function send(page: Page, lang: "en" | "de" | "ru" | "uk" | "tr" | "ar" = "en") {
  await page.getByRole("textbox", { name: mentorT("composer_label", lang) }).fill("Synthetic learner question");
  await page.getByRole("button", { name: mentorT("btn_send", lang), exact: true }).click();
}

for (const width of [390, 1440]) test(`MUX-03 source cap, citation disclosure and small inline markers with a 44px hit area at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const fake = await setup(page);
  const citations = Array.from({ length: 5 }, (_,i) => ({ ...SOURCE, fact_id: `fixture.${i}`, source_url: `https://example.org/source-${i}`, source_label: i === 0 ? "MedUni Wien" : `Synthetic document ${i} with a wrapping source label` }));
  fake.final = { ...fake.final, result: "answer", answer_blocks: [{ text: "Synthetic date 18 March 2099.", fact_ids: citations.map(c=>c.fact_id), confirmed_dates:["18 March 2099"], date_type:"sitting" }], citations: [...citations, {...citations[0],fact_id:"alias"}] };
  await page.goto("/mentor", {waitUntil:"domcontentloaded"}); await send(page);
  await expect(page.locator("[data-source-number]:visible")).toHaveCount(width < 400 ? 2 : 3);
  const all = page.getByRole("button",{name:"All 5 sources"}); await expect(all).toHaveAttribute("aria-expanded","false");
  const marker = page.getByRole("button",{name:/^Source 1, 2, 3, 4, 5: MedUni Wien;/}); const box=await marker.boundingBox(); expect(box!.height).toBeLessThanOrEqual(16);const hit=await marker.evaluate(el=>{const b=getComputedStyle(el,"::before");return{w:parseFloat(b.width),h:parseFloat(b.height)};});expect(hit.w).toBeGreaterThanOrEqual(44);expect(hit.h).toBeGreaterThanOrEqual(44);
  await marker.click();await expect(all).toHaveAttribute("aria-expanded","true");await expect(page.locator("[data-source-number]:visible")).toHaveCount(5);await expect(page.locator('[data-source-number="1"]')).toHaveClass(/ring-2/);
  await expect(page.locator("strong").filter({hasText:"18 March 2099"})).toHaveCount(1);await expectNoHorizontalScroll(page);
});
test("MUX-18 inline script suggestion is dismissible once per conversation", async ({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.goto("/mentor",{waitUntil:"domcontentloaded"});
 const control=page.getByRole("button",{name:/Answer in:/});expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 const input=page.getByRole("textbox",{name:mentorT("composer_label","en")});await input.fill("Когда экзамен?");const row=page.locator("[data-language-offer]");await expect(row).toContainText("Ты пишешь по-русски");
 await row.getByRole("button",{name:"Оставить текущий язык"}).click();await input.fill("Почему экзамен?");await expect(row).toHaveCount(0);
});
