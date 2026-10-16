import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-tg-checkout-context smoke (synthetic answers, local server only).
 * TG_OPENLINK_BUILD=1: the server was built with TG_CHECKOUT_OPENLINK_ENABLED=true.
 * Unset: the flag-off build, where nothing but the context field changes.
 *
 *  - /pricing in a stubbed Mini App (window.Telegram.WebApp + the tab marker):
 *    flag on, the Whop URL goes to openLink and the page stays with one note;
 *    flag off, today's navigation. The checkout POST always carries `context`.
 *  - /checkout/success and /mentor/checkout/success with no session: flag on,
 *    the neutral state (no verify call, Telegram button only with via=tg_webapp);
 *    flag off, the pages as they were.
 */
const on = process.env.TG_OPENLINK_BUILD === "1";
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/tg-checkout-context`;
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const WHOP = "https://whop.example/checkout/ch_tg";
const NOTE = { de: "Die Whop-Seite öffnet sich in Ihrem Browser.", en: "The Whop page opens in your browser." };
const TITLE = { de: "Zurück zur App", en: "Back to the app" };
const TG_BUTTON = { de: "Zurück zu Telegram", en: "Back to Telegram" };

// The service worker's first install can reload the page mid-test (as in the other release specs).
test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

/** Stubs window.Telegram.WebApp; openLink calls are collected on the Node side (they survive a navigation). */
async function miniApp(page: Page, marked: boolean): Promise<string[]> {
  const opened: string[] = [];
  await page.exposeFunction("__tgOpened", (u: string) => { opened.push(u); });
  await page.addInitScript((marked) => {
    const w = window as unknown as { Telegram: unknown; __tgOpened: (u: string) => void };
    w.Telegram = { WebApp: { initData: marked ? "query_id=fixture" : "", platform: "ios", isVersionAtLeast: () => true, ready() {}, expand() {}, openLink(u: string) { void w.__tgOpened(u); } } };
    try { if (marked) sessionStorage.setItem("medpruef_tg_webapp", "1"); } catch { /* ignore */ }
  }, marked);
  return opened;
}

// release-int-8: with NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED in the same build
// (all-on), the plan button opens the confirm sheet first; tap through it.
async function startCheckout(page: Page) {
  await page.locator("[data-plan] button").first().click();
  const go = page.getByRole("button", { name: /^(Weiter zur Zahlung|Continue to payment)$/ });
  if (await go.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false)) await go.click();
}

for (const v of VARIANTS) {
  test(`pricing hand-off in a Mini App ${on ? "on" : "off"} ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const opened = await miniApp(page, true);
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/whop/checkout", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, purchaseUrl: WHOP, sessionId: "ch_tg" }) });
    });
    await page.goto("/pricing", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    const whopRequest = on ? null : page.waitForRequest((r) => r.url().startsWith(WHOP), { timeout: 15_000 });
    await startCheckout(page);
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].context).toBe("tg_webapp");
    if (!on) {
      await whopRequest;
      expect(opened).toEqual([]);
      return;
    }
    await expect.poll(() => opened).toEqual([WHOP]);
    expect(new URL(page.url()).pathname).toBe("/pricing");
    const note = page.getByTestId("checkout-opened-external");
    await expect(note).toBeVisible();
    await expect(note).toContainText(NOTE[v.lang]);
    await expect(note).toBeInViewport();
    // The plan buttons are usable again, and "open again" hands the same URL (same session) to Telegram.
    await expect(page.locator("[data-plan] button[aria-busy='true']")).toHaveCount(0);
    await note.getByRole("button", { name: v.lang === "de" ? "Whop-Seite erneut öffnen" : "Open the Whop page again" }).click();
    await expect.poll(() => opened).toEqual([WHOP, WHOP]);
    expect(bodies.length, "no second checkout").toBe(1);
    expect((await note.getByRole("link").boundingBox())!.height).toBeGreaterThanOrEqual(43);
    await noOverflow(page, "pricing note");
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/pricing-note-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`pricing outside a Mini App navigates (${on ? "on" : "off"}) ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const opened = await miniApp(page, false);
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/whop/checkout", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, purchaseUrl: WHOP, sessionId: "ch_tg" }) });
    });
    await page.goto("/pricing", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    const whopRequest = page.waitForRequest((r) => r.url().startsWith(WHOP), { timeout: 15_000 });
    await startCheckout(page);
    await whopRequest;
    expect(bodies[0].context).toBe("browser");
    expect(opened).toEqual([]);
  });

  test(`signed-out visit without a purchase keeps the unidentified state (${on ? "on" : "off"}) ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    await prepare(context, page, v, { signedIn: false });
    await page.goto("/checkout/success", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.getByTestId("checkout-sessionless")).toHaveCount(0);
    await expect(page.locator("h1").first()).toHaveText(v.lang === "de" ? "Dieser Link gehört zu keiner Zahlung." : "This link does not identify a payment.");
  });

  for (const c of [
    { path: "/checkout/success?tier=first_month_19&via=tg_webapp", kind: "pro", tg: true },
    { path: "/checkout/success?tier=first_month_19", kind: "pro", tg: false },
    { path: "/checkout/success?tier=notes_pro_trial&trial=1&via=tg_webapp", kind: "trial", tg: true },
    { path: "/mentor/checkout/success?package=mentor_basis&checkout_session_id=88888888-8888-4888-8888-888888888888&via=tg_webapp", kind: "credits", tg: true },
    { path: "/mentor/checkout/success?package=mentor_basis&checkout_session_id=88888888-8888-4888-8888-888888888888", kind: "credits", tg: false },
  ] as const) {
    test(`sessionless ${c.kind}${c.tg ? " via Telegram" : ""} ${on ? "on" : "off"} ${tag(v)}`, async ({ page, context }) => {
      await page.setViewportSize({ width: v.width, height: v.height });
      const errors = trackErrors(page);
      const writes = await prepare(context, page, v, { signedIn: false });
      const verifies: string[] = [];
      page.on("request", (r) => { if (/\/verify/.test(r.url())) verifies.push(r.url()); });
      await page.goto(c.path, { waitUntil: "load" });
      if (!on) {
        // The pages as they were: the Pro page offers sign-in to check, the mentor page its sign-in wall (no h1 there).
        const signIn = c.kind === "credits" ? (v.lang === "de" ? "Anmelden" : "Sign in") : (v.lang === "de" ? "Einloggen und Zugang prüfen" : "Sign in to check access");
        await expect(page.getByRole("link", { name: signIn, exact: true }).first()).toBeVisible({ timeout: 25_000 });
        await expect(page.getByTestId("checkout-sessionless")).toHaveCount(0);
        return;
      }
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
      const card = page.getByTestId("checkout-sessionless");
      await expect(card).toBeVisible();
      await expect(card.locator("h1")).toHaveText(TITLE[v.lang]);
      const text = (await card.innerText()).replace(/\s+/g, " ");
      if (c.kind === "trial") expect(text).toContain(v.lang === "de" ? "Pro-Test" : "Pro trial");
      if (c.kind === "credits") expect(text).toContain(v.lang === "de" ? "Ihre Credits" : "Your credits");
      const tgButton = card.getByRole("link", { name: TG_BUTTON[v.lang] });
      if (c.tg) {
        await expect(tgButton).toHaveAttribute("href", "https://t.me/MedPruefBot");
        expect((await tgButton.boundingBox())!.height).toBeGreaterThanOrEqual(43);
      } else await expect(tgButton).toHaveCount(0);
      await page.waitForTimeout(1_500);
      expect(verifies, "no verify call without a session").toEqual([]);
      expect(writes, "nothing written").toEqual([]);
      await noOverflow(page, c.path);
      await page.screenshot({ path: `${dir()}/sessionless-${c.kind}${c.tg ? "-tg" : ""}-${tag(v)}.png` });
      expect(errors, "console errors").toEqual([]);
    });
  }
}
