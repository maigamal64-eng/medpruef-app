import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-checkout-return-read smoke (synthetic answers, local server only): the return
 * from Whop lands on /pricing, the reader reports it once, the existing one-tap
 * reasons show inline there once and log shown/answered; with the flag on Home
 * shows no second prompt; with the flag off (eligibility without returnRead) the
 * Home prompt is the one it always was.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const TITLE = { de: "Kurze Frage: Hat beim Bezahlen etwas nicht geklappt?", en: "Quick question: did something go wrong at checkout?" };
const json = (b: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(b) });

async function routes(page: Page, o: { returnRead: boolean }) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/whop/checkout/status", (r) => r.fulfill(json({ pending: null })));
  await page.route("**/api/checkout-feedback/eligibility", (r) => r.fulfill(json({ eligible: true, tier: "first_3mo_27", ...(o.returnRead ? { returnRead: true } : {}) })));
  await page.route("**/api/checkout-return", async (r) => {
    posts.push({ path: "checkout-return", body: JSON.parse(r.request().postData() ?? "{}") });
    await r.fulfill(json({ recorded: true, prompt: true }));
  });
  await page.route("**/api/checkout-feedback", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posts.push({ path: "checkout-feedback", body: JSON.parse(r.request().postData() ?? "{}") });
    await r.fulfill(json({ ok: true }));
  });
  return posts;
}

async function leftMarker(page: Page) {
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.setItem("medpruef_checkout_left", JSON.stringify({ at: Date.now() - 90_000, tier: "first_3mo_27" }));
    } catch { /* ignore */ }
  });
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`return on /pricing shows the one-tap reasons once ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    const posts = await routes(page, { returnRead: true });
    await leftMarker(page);
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const prompt = page.getByRole("region", { name: TITLE[v.lang] });
    await expect(prompt).toBeVisible({ timeout: 25_000 });
    await expect(prompt).toHaveCount(1);
    expect(posts.find((p) => p.body.kind === "return")?.body).toMatchObject({ kind: "return", page: "/pricing" });
    await expect.poll(() => posts.filter((p) => p.body.kind === "stall_shown").length).toBe(1);
    expect(posts.find((p) => p.body.kind === "stall_shown")?.body).toMatchObject({ surface: "pricing" });
    for (const el of await prompt.locator("button").all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/checkout-return/pricing-${tag(v)}.png` });
    await prompt.getByRole("button").nth(2).click();
    await expect(page.getByRole("status").filter({ hasText: v.lang === "de" ? "Danke, das hilft uns." : "Thank you, that helps us." })).toBeVisible();
    expect(posts.some((p) => p.path === "checkout-feedback")).toBe(true);
    // once: a reload shows nothing (marker and prompt flag are consumed)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);
    await expect(page.getByRole("region", { name: TITLE[v.lang] })).toHaveCount(0);
    expect(posts.filter((p) => p.body.kind === "return").length).toBeLessThanOrEqual(2);
    expect(errors, "console errors").toEqual([]);
  });

  test(`flag on: Home shows no second prompt ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await routes(page, { returnRead: true });
    await page.route("**/api/checkout-resume", (r) => r.fulfill(json({ eligible: false })));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    await expect(page.getByRole("region", { name: TITLE[v.lang] })).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`flag off: no marker traffic, Home prompt unchanged ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    const posts = await routes(page, { returnRead: false });
    await page.route("**/api/checkout-resume", (r) => r.fulfill(json({ eligible: false })));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: TITLE[v.lang] })).toBeVisible({ timeout: 25_000 });
    expect(posts.filter((p) => p.path === "checkout-return")).toEqual([]);
    expect(errors, "console errors").toEqual([]);
  });
}
