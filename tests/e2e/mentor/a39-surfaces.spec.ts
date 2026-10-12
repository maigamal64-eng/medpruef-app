import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";

// a39 browser smoke: first run with the sample answer (MUX-19), the end of the
// free taste (MUX-20/22), the pinned question card without spoiler (MUX-58),
// renewal and grace on the packages page (MUX-73), the failed-payment screen
// (MUX-84) and the Settings mentor card (MUX-110). 375 and 1280, light and
// dark, DE and EN; no console errors, no horizontal overflow.
test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "00000000-0000-4000-8000-00000000a390";
const SESSION = "88888888-8888-4888-8888-888888888888";
const BASIS = { package_id: "mentor_basis", kind: "subscription", credits: 150, price_eur_cents: 490, messages_estimate: 150, valid_days: 33, period_days: 30 };
const PLUS = { package_id: "mentor_plus", kind: "subscription", credits: 400, price_eur_cents: 990, messages_estimate: 400, valid_days: 33, period_days: 30 };
const COPY = {
  de: { pill: "Credits holen", sample: "Beispielantwort ansehen", sampleQ: "Kann ich mich für die SIP4a nach Ende der Anmeldefrist noch nachmelden?", composer: "Zum Schreiben brauchen Sie Credits.", freeEnd: "Das war Ihr Gratis-Test.", head: "Frage 7", more: "Ganze Frage zeigen", choice: "Ihre Wahl", key: "Richtig", grace: "Nicht genutzte Credits bleiben 3 Tage länger nutzbar", manual: "Zahlung angekommen", copy: "Referenz kopieren", whyWrong: "Warum ist meine Antwort falsch?", settings: "KI-Mentor", delete: "Mentor-Chatverlauf löschen" },
  en: { pill: "Get credits", sample: "See a sample answer", sampleQ: "Can I still register for SIP4a after the registration period has ended?", composer: "You need credits to write.", freeEnd: "That was your free trial.", head: "Question 7", more: "Show the whole question", choice: "Your choice", key: "Correct", grace: "Unused credits stay usable for 3 more days", manual: "Payment received", copy: "Copy reference", whyWrong: "Why is my answer wrong?", settings: "AI mentor", delete: "Delete mentor chat history" },
} as const;

async function setup(page: Page, lang: "de" | "en", theme: "light" | "dark", usage: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await seedSession(page, { userId: USER, email: "a39-fixture@example.invalid", tier: "free" });
  await page.addInitScript(`try{localStorage.setItem("medpruef-lang","${lang}");localStorage.setItem("medpruef_theme","${theme}");localStorage.setItem("medpruef_cookies","declined");}catch(e){}`);
  await page.emulateMedia({ colorScheme: theme });
  await page.context().route("**/*", (route) => (["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path in extra) return route.fulfill({ json: extra[path] });
    if (path === "/api/mentor/usage") return route.fulfill({ json: { state: "ok", credits_left: 50, admit_min_credits: 1, messages_left_estimate: 30, next_expiry: null, sources: ["package"], subscriptions: [], can_buy: true, ...usage } });
    if (path === "/api/mentor/packages") return route.fulfill({ json: { packages: [BASIS, PLUS] } });
    if (path === "/api/mentor/availability") return route.fulfill({ json: { available: true } });
    if (path === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
    if (path === "/api/mentor/chat") return route.abort();
    return route.fulfill({ json: {} });
  });
  return errors;
}
const unexpected = (errors: string[]) => errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|status of 4\d\d/.test(e));
const MATRIX = [[375, "de", "light"], [375, "en", "dark"], [1280, "en", "light"], [1280, "de", "dark"]] as const;
const shot = (page: Page, name: string) => page.screenshot({ path: `tests/e2e/.artifacts/a39/${name}.png`, fullPage: false });

for (const [width, lang, theme] of MATRIX) {
  const tag = `${width}-${lang}-${theme}`;
  test(`MUX-19 first run shows the price, the static sample and a closed composer at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, lang, theme, { state: "none", credits_left: 0, sources: ["none"], next_expiry: null });
    let chatCalls = 0;
    page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/mentor/chat") chatCalls += 1; });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-mentor-first-run]");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("150");
    await expect(page.getByText(COPY[lang].pill).first()).toBeVisible();
    await expect(page.getByText(/(^|\s)0 (Credits|credits)\b/)).toHaveCount(0);
    await expect(page.getByRole("textbox").first()).not.toBeEditable();
    await page.getByRole("button", { name: COPY[lang].sample }).click();
    await expect(page.getByText(COPY[lang].sampleQ)).toBeVisible();
    expect(chatCalls).toBe(0);
    await expectNoHorizontalScroll(page);
    await shot(page, `first-run-${tag}`);
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-20/22 the end of the free taste is not an error at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, lang, theme, { state: "exhausted", credits_left: 0, sources: ["none"], source: "none", source_package: "free_taste", trial: { credits: 5, credits_left: 0, expires_at: "2026-12-01T00:00:00Z", expired: false, free_taste: true } });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox").first()).toHaveAttribute("placeholder", new RegExp(COPY[lang].freeEnd.replace(".", "\\.")), { timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await shot(page, `free-end-${tag}`);
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-58 the pinned question shows the key only when answered at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, lang, theme, {}, { "/api/questions": [{ id: 7, question: "Welches Medikament ist ein Betablocker?", topic: "Pharmakologie", explanation: "", options: [{ text: "Metoprolol", correct: true, position: 1 }, { text: "Ramipril", correct: false, position: 2 }] }] });
    await page.goto("/mentor?mode=explain&question_id=7&answered=0&from=question", { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-mentor-question-card]");
    await expect(card).toContainText(COPY[lang].head, { timeout: 30_000 });
    await card.getByRole("button", { name: new RegExp(COPY[lang].more) }).click();
    await expect(card).toContainText("Metoprolol");
    await expect(card).not.toContainText(COPY[lang].key);
    await page.goto("/mentor?mode=explain&question_id=7&answered=1&selected_option=Ramipril&from=question", { waitUntil: "domcontentloaded" });
    await card.getByRole("button", { name: new RegExp(COPY[lang].more) }).click({ timeout: 30_000 });
    await expect(card).toContainText(COPY[lang].choice);
    await expect(card).toContainText(COPY[lang].key);
    await expect(page.getByRole("button", { name: COPY[lang].whyWrong })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, `question-card-${tag}`);
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-73 packages state renewal and grace from the row at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, lang, theme, { state: "low", credits_left: 5, next_expiry: "2026-11-05T00:00:00Z" });
    await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(COPY[lang].grace).first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await shot(page, `packages-${tag}`);
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-84 a payment needing a manual unlock shows the reference at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, lang, theme, {}, { "/api/mentor/checkout/verify": { status: "failed", failure_reason: "needs_manual", credits_added: 0, credits_left: 0 } });
    await page.goto(`/mentor/checkout/success?checkout_session_id=${SESSION}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: COPY[lang].manual })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SESSION).first()).toBeVisible();
    await expect(page.getByRole("button", { name: COPY[lang].copy })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, `payment-manual-${tag}`);
    expect(unexpected(errors)).toEqual([]);
  });

  test(`MUX-110 Settings shows the mentor card from /usage at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = await setup(page, lang, theme, { state: "ok", credits_left: 42, next_expiry: "2026-11-05T00:00:00Z", source_package: "mentor_basis" });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: COPY[lang].delete })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("42").first()).toBeVisible();
    await page.getByRole("button", { name: COPY[lang].delete }).scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, `settings-${tag}`);
    expect(unexpected(errors)).toEqual([]);
  });
}
