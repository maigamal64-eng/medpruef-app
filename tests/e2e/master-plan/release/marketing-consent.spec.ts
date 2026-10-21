import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-intercom-marketing-consent: the unticked register checkbox, the Settings
 * switch and the privacy text in a build made with
 * NEXT_PUBLIC_MARKETING_CONSENT_ENABLED=true (MARKETING_CONSENT_SMOKE=1).
 * 375 and 1280, DE and EN, light and dark; stand-in and synthetic APIs only.
 */
test.use({ serviceWorkers: "block" });
test.skip(process.env.MARKETING_CONSENT_SMOKE !== "1", "needs a build with NEXT_PUBLIC_MARKETING_CONSENT_ENABLED=true");

const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const evidence = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const COPY = {
  de: { box: "E-Mails mit Neuigkeiten, Lerntipps und Angeboten von MedPrüf erhalten", saved: "Gespeichert. Sie haben E-Mails mit Neuigkeiten und Angeboten zugestimmt.", privacy: "Diese E-Mails versenden wir über Intercom, Inc., USA, oder über Zoho Mail." },
  en: { box: "Get emails with MedPrüf news, study tips and offers", saved: "Saved. You agreed to emails with news and offers.", privacy: "We send these emails through Intercom, Inc., USA, or Zoho Mail." },
};

async function noOverflow(page: Page) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`register checkbox starts unticked and is sent only when ticked (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const bodies: unknown[] = [];
    await page.route("**/api/auth", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "stop here" }) });
    });
    await page.goto("/login?mode=register", { waitUntil: "domcontentloaded" });
    const label = page.getByTestId("register-marketing-consent");
    await label.waitFor({ state: "visible", timeout: 25_000 });
    await expect(label).toContainText(COPY[v.lang].box);
    const box = page.locator("#login-marketing-opt-in");
    await expect(box).not.toBeChecked();
    await noOverflow(page);
    await label.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/consent-register-${tag(v)}.png` });

    await page.locator('input[name="given-name"]').fill("Anna");
    await page.locator('input[name="email"]').fill("anna@example.invalid");
    await page.locator('input[name="password"]').fill("correct-horse-1");
    await page.getByRole("button", { name: v.lang === "de" ? "Konto erstellen" : "Create account" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect((bodies[0] as { emailRegister: { marketingOptIn?: unknown } }).emailRegister.marketingOptIn).toBe(false);

    await box.check();
    await page.getByRole("button", { name: v.lang === "de" ? "Konto erstellen" : "Create account" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect((bodies[1] as { emailRegister: { marketingOptIn?: unknown } }).emailRegister.marketingOptIn).toBe(true);
    // The two answers above are the synthetic 500 this spec forces.
    expect(errors.filter((e) => !/status of 500/.test(e))).toEqual([]);
    await context.close();
  });

  test(`settings switch saves the opt-in (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true });
    const patches: unknown[] = [];
    let optIn = false;
    await page.route("**/api/user/marketing-consent", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = JSON.parse(route.request().postData() ?? "{}") as { optIn: boolean };
        patches.push(body);
        optIn = body.optIn;
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, canOptIn: true, optIn, consentAt: null, hasEmail: true, addressProven: true }) });
    });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("settings-marketing-consent");
    await card.waitFor({ state: "visible", timeout: 25_000 });
    const sw = page.getByTestId("marketing-consent-switch");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("marketing-consent-outcome")).toHaveText(COPY[v.lang].saved);
    await expect(page.getByTestId("marketing-consent-status")).toContainText("release@example.invalid");
    expect(patches).toEqual([{ optIn: true }]);
    await noOverflow(page);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/consent-settings-${tag(v)}.png` });
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`privacy names Intercom and Zoho (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    const section = page.getByTestId("privacy-marketing-consent");
    await section.waitFor({ state: "visible", timeout: 25_000 });
    await expect(section).toContainText(COPY[v.lang].privacy);
    await expect(page.getByText("Intercom, Inc., USA", { exact: false }).first()).toBeVisible();
    await noOverflow(page);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/consent-privacy-${tag(v)}.png` });
    expect(errors).toEqual([]);
    await context.close();
  });
}
