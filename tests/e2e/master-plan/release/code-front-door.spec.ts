import { expect, test, type Page } from "@playwright/test";
import { apiFixture, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-code-front-door smoke. The server under test is built with
 * CODE_AT_SIGNUP_ENABLED=true (NEXT_PUBLIC_CODE_AT_SIGNUP mirror). Synthetic
 * browser /api answers only (release-harness). Covers: the register form's own
 * "Haben Sie einen Code?" field apart from the Telegram code, the typed code
 * leaving as first-touch attribution on the register call and being redeemed
 * once after sign-in, the landing entry (signed out, keeps the code and opens
 * the register form), the Home entry (signed in, redeems on the spot) and the
 * neutral failure line. 375 and 1280, DE and EN, light and dark; no horizontal
 * page scroll, no console errors.
 */
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`register: own code field, kept apart from Telegram; code travels as first touch and is redeemed once after sign-in ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    // After the register call the synthetic backend answers as a signed-in free account.
    let registered = false;
    await page.route(/\/api\/(auth\/me|user\/)/, (route) => {
      if (!registered) return route.fallback();
      const { status, body } = apiFixture(new URL(route.request().url()), route.request().method(), { signedIn: true, tier: "free" });
      return status === 204 ? route.fulfill({ status: 204, body: "" }) : route.fulfill(json(status, body));
    });
    const sent: { body: { emailRegister?: { attribution?: Record<string, string> } } | null } = { body: null };
    await page.route("**/api/auth", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sent.body = JSON.parse(route.request().postData() ?? "{}");
      registered = true;
      return route.fulfill(json(200, {
        user: { id: "51c5564a-5051-4b9b-8f81-4faf0e368533", email: "release@example.invalid", role: "user", tier: "free", first_name: "Fixture" },
        gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
        sessionToken: "synthetic-release-token",
      }));
    });
    let posts: Array<{ code: string; source: string }> = [];
    await page.route("**/api/code/redeem", (route) => { posts.push(JSON.parse(route.request().postData() ?? "{}")); return route.fulfill(json(200, { ok: true, kind: "campaign", duplicate: false, credits: 25, expires_at: "2027-01-21T10:00:00Z" })); });
    // The result toast is short-lived and a slow Home load can outlast it: record it as it appears.
    await page.addInitScript(() => {
      (window as unknown as { __seen: string[] }).__seen = [];
      const note = () => { const t = document.body?.innerText ?? ""; const m = t.match(/Code (eingelöst|redeemed)[^\n]*/); if (m) (window as unknown as { __seen: string[] }).__seen.push(m[0]); };
      new MutationObserver(note).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto(`/login?mode=register&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const field = page.locator("#register-code");
    await expect(field).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(v.lang === "de" ? "Haben Sie einen Code?" : "Do you have a code?")).toBeVisible();
    await expect(page.getByText(v.lang === "de" ? "nicht der Anmeldecode von Telegram" : "not the Telegram sign-in code")).toBeVisible();
    await expect(field).toHaveAttribute("autocomplete", "off");
    await noOverflow(page, "/login register");
    await page.screenshot({ path: `${OUT}/code-front-door/register-${tag(v)}.png`, fullPage: true });
    await page.locator('input[autocomplete="given-name"]').first().fill("Fixture");
    await page.locator('input[autocomplete="username"]').fill("release@example.invalid");
    await page.locator("#login-password").fill("correct horse battery");
    await field.fill(" tg spt ");
    await page.locator('form[data-prehydration-guard] button[type="submit"]').click();
    await expect.poll(() => posts.length, { timeout: 25_000 }).toBe(1);
    expect(sent.body?.emailRegister?.attribution).toMatchObject({ utm_source: "code", utm_medium: "typed", utm_campaign: "tg-spt" });
    expect(posts[0]).toEqual({ code: "TG-SPT", source: "register" });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __seen?: string[] }).__seen?.join("|") ?? ""), { timeout: 20_000 }).toContain(v.lang === "de" ? "Code eingelöst: 25 Credits" : "Code redeemed: 25 AI Mentor credits");
    await page.waitForTimeout(800);
    expect(posts.length, "redeemed exactly once").toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("medpruef_typed_code"))).toBeNull();
    expect(errors, "console errors").toEqual([]);
  });

  test(`register: an invalid code stops the form with its own message ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    await prepare(context, page, v, { signedIn: false });
    let authPosts = 0;
    await page.route("**/api/auth", (route) => { if (route.request().method() === "POST") authPosts++; return route.fallback(); });
    await page.goto(`/login?mode=register&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await page.locator('input[autocomplete="given-name"]').first().fill("Fixture");
    await page.locator('input[autocomplete="username"]').fill("release@example.invalid");
    await page.locator("#login-password").fill("correct horse battery");
    await page.locator("#register-code").fill("no way!");
    await page.locator('form[data-prehydration-guard] button[type="submit"]').click();
    await expect(page.getByText(v.lang === "de" ? "Bitte prüfen Sie den Code." : "Please check the code.")).toBeVisible();
    expect(authPosts).toBe(0);
  });

  test(`landing: Code einlösen keeps the code and opens the register form ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const funnel: string[] = [];
    await page.route("**/api/funnel-events", (route) => { funnel.push(route.request().postData() ?? ""); return route.fulfill({ status: 204, body: "" }); });
    await page.goto(`/landing?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const entry = page.getByTestId("code-entry-landing");
    await expect(entry).toBeVisible({ timeout: 25_000 });
    // a-release-int-6: a click can land before hydration on a loaded machine (the button takes focus, nothing opens); retry the tap.
    await expect(async () => {
      await entry.getByRole("button", { name: v.lang === "de" ? "Code einlösen" : "Redeem code" }).click();
      await expect(entry.getByText(v.lang === "de" ? "Sie legen als Nächstes ein Konto an, ohne Karte" : "Next, you create an account, no card needed")).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await noOverflow(page, "/landing code entry open");
    await page.screenshot({ path: `${OUT}/code-front-door/landing-${tag(v)}.png`, fullPage: false });
    await entry.locator("input").fill("TG-SPT");
    await entry.getByRole("button", { name: v.lang === "de" ? "Weiter zur Registrierung" : "Continue to sign-up" }).click();
    await page.waitForURL(/\/login\?mode=register/, { timeout: 25_000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#register-code")).toBeVisible();
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("medpruef_typed_code"))) ?? "{}").code).toBe("TG-SPT");
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("medpruef_attribution"))) ?? "{}")).toMatchObject({ utm_source: "code", utm_campaign: "tg-spt" });
    await expect(page.locator("#register-code")).toHaveValue("TG-SPT");
    expect(funnel.some((b) => b.includes("code_entered_pre_signup") && b.includes("tg-spt"))).toBe(true);
    expect(errors, "console errors").toEqual([]);
  });

  test(`home: signed in redeems on the spot; a refused code answers with the neutral line ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    let n = 0;
    await page.route("**/api/code/redeem", (route) => { n++; return route.fulfill(n === 1 ? json(409, { ok: false, reason: "not_active" }) : json(200, { ok: true, kind: "referral", duplicate: false })); });
    await page.goto(`/?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const entry = page.getByTestId("code-entry-home");
    await expect(entry).toBeVisible({ timeout: 25_000 });
    await entry.getByRole("button", { name: v.lang === "de" ? "Code einlösen" : "Redeem code" }).click();
    await entry.locator("input").fill("K4M9X7QA");
    await entry.getByRole("button", { name: v.lang === "de" ? "Einlösen" : "Redeem", exact: true }).click();
    await expect(entry.getByText(v.lang === "de" ? "Dieser Code ist nicht gültig oder nicht mehr aktiv." : "This code is not valid or no longer active.")).toBeVisible();
    await entry.getByRole("button", { name: v.lang === "de" ? "Einlösen" : "Redeem", exact: true }).click();
    await expect(page.getByTestId("code-entry-done")).toContainText(v.lang === "de" ? "Code eingelöst" : "Code redeemed");
    await noOverflow(page, "/ code entry");
    await page.screenshot({ path: `${OUT}/code-front-door/home-${tag(v)}.png`, fullPage: false });
    // The refused first try is a deliberate 409.
    expect(errors.filter((e) => !/status of 409/.test(e)), "console errors").toEqual([]);
  });
}
