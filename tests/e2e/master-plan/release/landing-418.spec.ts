import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-landing-418-fix: /landing and /pricing are prerendered at build time. A
 * visitor days later must hydrate without React error #418. The browser clock
 * is moved ahead of the build (0, 2 and 4 days: the SIP close of 19 Oct and the
 * Rez/GM close of 20 Oct 12:00 pass inside that span), so the client's clock
 * differs from the one the HTML was rendered with. Local build + stand-in only.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const SHIFTS = [0, 2, 4];
const EVIDENCE = process.env.A35_EVIDENCE_DIR;

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

async function run(browser: import("@playwright/test").Browser, path: string, v: Variant, shift: number) {
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: false });
  // A returning visitor with a stored exam: the links must not read it during render.
  await page.addInitScript(() => { try { localStorage.setItem("medpruef_exam_source", "pharma"); } catch { /* blocked */ } });
  if (shift) await page.clock.install({ time: new Date(Date.now() + shift * 86_400_000) });
  const res = await page.goto(`${path}?lang=${v.lang}`, { waitUntil: "networkidle" });
  expect(res?.status()).toBe(200);
  await expect(page.locator("#exam-calendar, h2").first()).toBeVisible();
  await page.waitForTimeout(1500);
  const m = await measure(page);
  expect(m.scrollWidth, m.offenders.join(", ")).toBeLessThanOrEqual(m.innerWidth);
  if (EVIDENCE && shift === 2) {
    await page.locator(path === "/landing" ? "#termine" : "h2").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${EVIDENCE}/landing-418/${path.slice(1)}-${tag(v)}-plus${shift}d.png` });
  }
  expect(errors).toEqual([]);
  await context.close();
}

for (const v of VARIANTS) {
  for (const shift of SHIFTS) {
    test(`/landing hydrates clean, client clock +${shift}d (${tag(v)})`, async ({ browser }) => { await run(browser, "/landing", v, shift); });
  }
}

for (const v of [VARIANTS[0], VARIANTS[VARIANTS.length - 1]]) {
  for (const shift of SHIFTS) {
    test(`/pricing hydrates clean, client clock +${shift}d (${tag(v)})`, async ({ browser }) => { await run(browser, "/pricing", v, shift); });
  }
}
