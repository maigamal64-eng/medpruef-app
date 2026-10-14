import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-d5b: in-app opt-in to exam deadline reminders. Home shows one quiet line
 * under the deadline line; Settings shows the card. With the server answering
 * {available:false} (no link signing secret) neither exists. Local build and
 * stand-in only; /api/reminders/me is synthetic here.
 */

const NOW = new Date("2026-11-05T09:00:00Z");
const EMAIL = "release@example.invalid";
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const evidence = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";

async function reminders(page: Page, available: boolean) {
  const posts: string[] = [];
  let state = "off";
  await page.route("**/api/reminders/me*", async (route) => {
    const method = route.request().method();
    if (!available) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) });
    if (method === "POST") { posts.push(route.request().postData() ?? ""); state = "pending"; }
    if (method === "DELETE") state = "off";
    const body = { available: true, email: EMAIL, exam: "kenntnispruefung", state, ...(method === "POST" ? { mail: "sent" } : {}) };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return posts;
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`Home line and Settings card opt in (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true });
    const posts = await reminders(page, true);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const line = page.getByTestId("home-exam-reminder");
    await line.waitFor({ state: "visible", timeout: 25_000 });
    await expect(line).toHaveText(v.lang === "de" ? "Per E-Mail an Anmeldefristen erinnern lassen" : "Get deadline reminders by email");
    let m = await measure(page);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/d5b-home-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await line.click();
    await expect(page.getByTestId("home-exam-reminder")).toHaveText(v.lang === "de" ? /Link gesendet/ : /Link sent/);
    expect(posts).toHaveLength(1);
    // The client never names an address or a bank: the server reads the account.
    expect(posts[0]).toBe("");

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("settings-exam-reminder");
    await card.waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.getByTestId("exam-reminder-status")).toContainText(EMAIL);
    await expect(card).toContainText(v.lang === "de" ? "SIP4a und SIP5a (Wien)" : "SIP4a and SIP5a (Vienna)");
    await card.getByRole("button", { name: v.lang === "de" ? "Anfrage zurückziehen" : "Withdraw request" }).click();
    await expect(card.getByRole("button", { name: v.lang === "de" ? "Erinnerungen einschalten" : "Turn on reminders" })).toBeVisible();
    m = await measure(page);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/d5b-settings-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const lang of ["de", "en"] as const) {
  test(`no secret: no Home line, no Settings card (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: false };
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true });
    await reminders(page, false);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: lang === "de" ? /Anmeldeschluss|Termin/i : /deadline/i }).first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expect(page.getByTestId("home-exam-reminder")).toHaveCount(0);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expect(page.getByTestId("settings-exam-reminder")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}
