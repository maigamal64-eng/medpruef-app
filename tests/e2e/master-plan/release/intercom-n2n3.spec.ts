import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-intercom-into-n2n3-1021: in a build with every Intercom switch of N2 and
 * N3 on (contact sync, marketing consent, Telegram bridge), /privacy shows ONE
 * Intercom row in the Lektor order (data list, chat sentence, Telegram block,
 * consent sentence, deletion) and the register form shows the code field and
 * the unticked consent box together without overflow. INTERCOM_N2N3_SMOKE=1.
 * 375 and 1280, DE and EN, light and dark; stand-in and synthetic APIs only.
 */
test.use({ serviceWorkers: "block" });
test.skip(process.env.INTERCOM_N2N3_SMOKE !== "1", "needs a build with the N2 and N3 Intercom switches on");

const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const evidence = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const ORDER = {
  de: ["ob ein Telegram-Konto verknüpft ist", "Im Support-Chat kommen", "Support-Nachrichten, die Sie dem MedPrüf-Bot", "Nur wenn Sie zugestimmt haben, senden wir Ihnen über Intercom", "Wenn Ihr Konto gelöscht wird"],
  en: ["whether a Telegram account is linked", "In the support chat", "Support messages you write to the MedPrüf bot", "We also send you emails with news, study tips and offers through Intercom", "When your account is deleted"],
};

async function noOverflow(page: Page) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`one Intercom privacy row in the Lektor order (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    const row = page.getByText(ORDER[v.lang][0], { exact: false }).first();
    await row.waitFor({ state: "visible", timeout: 25_000 });
    const text = (await row.textContent()) ?? "";
    const at = ORDER[v.lang].map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0), `all parts in one row: ${at.join(",")}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(await page.getByText(ORDER[v.lang][2], { exact: false }).count()).toBeGreaterThanOrEqual(1);
    expect(text).not.toMatch(/[–—]/);
    await noOverflow(page);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/intercom-privacy-${tag(v)}.png` });
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`register form: consent box unticked next to the other fields (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto("/login?mode=register", { waitUntil: "domcontentloaded" });
    const label = page.getByTestId("register-marketing-consent");
    await label.waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.locator("#login-marketing-opt-in")).not.toBeChecked();
    await noOverflow(page);
    await label.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/intercom-register-${tag(v)}.png` });
    expect(errors).toEqual([]);
    await context.close();
  });
}
