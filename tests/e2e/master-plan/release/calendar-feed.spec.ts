import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-exam-calendar-feed: the subscribe block on /pruefungskalender and the live
 * feed routes of a local build started with EXAM_CALENDAR_FEED_ENABLED=true and
 * REMINDER_LINK_SIGNING_SECRET set. Synthetic session, local server only.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`calendar subscribe block (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const events: string[] = [];
    await page.route("**/api/funnel-events", async (route) => { events.push(route.request().postData() ?? ""); await route.fulfill({ status: 204 }); });
    await page.goto(`/pruefungskalender?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const block = page.getByTestId("calendar-feed-block");
    await block.waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await expect(block.getByRole("heading", { level: 2 })).toHaveText(v.lang === "de" ? "In Ihren Kalender übernehmen" : "Add to your calendar");
    const google = block.getByRole("link", { name: v.lang === "de" ? "Google Kalender" : "Google Calendar" });
    // A choice made before hydration is overwritten by the initial state, so repeat it until it sticks.
    await expect.poll(async () => { await block.locator("select").selectOption("sip4a"); return (await google.getAttribute("href")) ?? ""; }, { timeout: 15_000 }).toContain("sip4a");
    await expect(google).toHaveAttribute("href", /calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2Fmedpruf\.com%2Fapi%2Fcalendar%2Fsip4a\.ics/);
    const file = block.getByRole("link", { name: /\.ics/ });
    await expect(file).toHaveAttribute("href", v.lang === "en" ? "https://medpruf.com/api/calendar/sip4a.ics?lang=en" : "https://medpruf.com/api/calendar/sip4a.ics");
    // Touch targets at least 44 px.
    for (const el of await block.locator("a.mp-btn, button.mp-btn").all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.evaluate(() => document.querySelectorAll("a[href^='webcal:'], a[href*='.ics'], a[href*='calendar.google']").forEach((a) => a.addEventListener("click", (e) => e.preventDefault())));
    await file.click();
    await expect.poll(() => events.some((e) => e.includes("calendar_subscribe_click") && e.includes('"kind":"download"') && e.includes('"exam":"sip4a"'))).toBe(true);
    const m = await measure(page);
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/calendar-feed-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(m.fixedInFlow).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("live feeds answer valid calendars", async ({ request }) => {
  for (const [path, min] of [["/api/calendar/all.ics", 20], ["/api/calendar/sip4a.ics?lang=en", 5]] as const) {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const text = await res.text();
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect((text.match(/BEGIN:VEVENT/g) ?? []).length).toBeGreaterThanOrEqual(min);
  }
  expect((await request.get("/api/calendar/nope.ics")).status()).toBe(404);
  expect((await request.get("/api/calendar/u/not-a-token.ics")).status()).toBe(404);
});
