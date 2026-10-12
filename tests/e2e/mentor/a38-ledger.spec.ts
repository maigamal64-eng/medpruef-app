import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
import { FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";

// a38 browser smoke: Hide (MUX-37 A), not-charged lines (MUX-38 B) and the
// admission-gap sentence (MUX-23 A) at 375 and 1280, light and dark, DE and EN.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "00000000-0000-4000-8000-00000000a380";
const COPY = {
  de: { hide: "Ausblenden", waiting: "Ausgeblendet. Die Antwort wird noch fertig geschrieben.", charged: "Ausgeblendet. Die Antwort ist fertig und wurde berechnet.", view: "Ansehen", gap: "Mindestens 4,3 Credits nötig, Sie haben 2,4.", free: "Dafür wurden keine Credits abgezogen.", send: "Senden" },
  en: { hide: "Hide", waiting: "Hidden. The answer is still being finished.", charged: "Hidden. The answer is ready and was charged.", view: "View", gap: "At least 4.3 credits needed, you have 2.4.", free: "No credits were deducted for this.", send: "Send" },
} as const;

async function setup(page: Page, opts: { lang: "de" | "en"; theme: "light" | "dark"; usage?: Record<string, unknown>; chat?: () => string; delayMs?: number }) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await seedSession(page, { userId: USER, email: "a38-fixture@example.invalid", tier: "pro" });
  await page.addInitScript(`try{localStorage.setItem("medpruef-lang","${opts.lang}");localStorage.setItem("medpruef_theme","${opts.theme}");localStorage.setItem("medpruef_cookies","declined");}catch(e){}`);
  await page.emulateMedia({ colorScheme: opts.theme });
  await page.context().route("**/*", (route) => (["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/mentor/usage") return route.fulfill({ json: { state: "ok", credits_left: 50, admit_min_credits: 4.21, messages_left_estimate: 30, next_expiry: null, sources: ["pro_included"], subscriptions: [], can_buy: false, ...opts.usage } });
    if (path === "/api/mentor/availability") return route.fulfill({ json: { available: true } });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat") {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return route.fulfill({ contentType: "text/event-stream", body: opts.chat ? opts.chat() : `data: ${JSON.stringify(FIXTURE_FINAL_OK)}\n\n` });
    }
    return route.fulfill({ json: {} });
  });
  return errors;
}
const unexpected = (errors: string[]) => errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|status of 4\d\d/.test(e));

for (const [width, lang, theme] of [[375, "de", "light"], [375, "en", "dark"], [1280, "en", "light"], [1280, "de", "dark"]] as const) {
  test(`MUX-37 A Hide keeps the composer locked and reveals a charged answer at ${width}px ${lang} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, { lang, theme, delayMs: 2500, chat: () => `data: ${JSON.stringify({ ...FIXTURE_FINAL_OK, charged: true, credits_used: 0.2 })}\n\n` });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const box = page.getByRole("textbox").first();
    await expect(box).toBeEditable({ timeout: 30_000 });
    await box.fill("Wann ist die nächste Prüfung?");
    await page.getByRole("button", { name: COPY[lang].send, exact: true }).click();
    const hide = page.getByRole("button", { name: COPY[lang].hide, exact: true });
    await expect(hide).toBeVisible();
    const size = await hide.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
    await hide.click();
    await expect(page.getByText(COPY[lang].waiting)).toBeVisible();
    await expect(box).toBeFocused();
    await expect(page.getByRole("button", { name: COPY[lang].send, exact: true })).toHaveCount(0);
    await expect(page.getByText(COPY[lang].charged)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: COPY[lang].send, exact: true })).toBeVisible();
    await page.screenshot({ path: `tests/e2e/.artifacts/a38/hidden-${width}-${lang}-${theme}.png`, fullPage: false });
    await page.getByRole("button", { name: COPY[lang].view, exact: true }).click();
    await expect(page.getByText(COPY[lang].charged)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/a38/hide-${width}-${lang}-${theme}.png`, fullPage: false });
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-38 a server-confirmed free error says not charged at ${width}px ${lang} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, { lang, theme, chat: () => `data: ${JSON.stringify({ type: "error", error: "upstream_error", credits_deducted: false })}\n\n` });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox").first()).toBeEditable({ timeout: 30_000 });
    await page.getByRole("textbox").first().fill("Wann ist die nächste Prüfung?");
    await page.getByRole("button", { name: COPY[lang].send, exact: true }).click();
    await expect(page.getByText(COPY[lang].free)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/a38/free-${width}-${lang}-${theme}.png` });
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-23 the admission gap names the bar, not 'used up' at ${width}px ${lang} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, { lang, theme, usage: { state: "exhausted", credits_left: 2.4, admit_min_credits: 4.21, current_grant: 50 } });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox").first()).toHaveAttribute("placeholder", COPY[lang].gap, { timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `tests/e2e/.artifacts/a38/gap-${width}-${lang}-${theme}.png` });
    expect(unexpected(errors)).toEqual([]);
  });
}
