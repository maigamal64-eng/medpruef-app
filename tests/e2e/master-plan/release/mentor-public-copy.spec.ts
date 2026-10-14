import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-mentor-preconds smoke: a build with NEXT_PUBLIC_MENTOR_PUBLIC_COPY=true and
 * NEXT_PUBLIC_MENTOR_INCLUDED_COPY unset (the state the switch-on runbook uses
 * with MENTOR_ACCESS_SCOPE=signed_in). The privacy, terms and FAQ mentor blocks
 * render; no surface says Pro or the Cohort include mentor credits. Run only
 * against such a build (MENTOR_PUBLIC_COPY_BUILD=1), local server only.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

const INCLUDED_CLAIM = /inklusive|enthält \d+ Mentor|Inklusive Credits|includes? \d+ mentor|credits a month included|Included credits/i;
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/mentor-public-copy`;

test.skip(process.env.MENTOR_PUBLIC_COPY_BUILD !== "1", "needs a build with NEXT_PUBLIC_MENTOR_PUBLIC_COPY=true");
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`public mentor copy on, included off ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });

    await page.goto(`/faq?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const faq = page.locator("[data-mentor-faq]");
    await faq.waitFor({ state: "attached", timeout: 25_000 });
    await expect(faq).toContainText("Mentor Basis");
    expect(await faq.textContent()).not.toMatch(INCLUDED_CLAIM);
    const f = await measure(page);
    expect(f.scrollWidth, `no horizontal page scroll on /faq ${JSON.stringify(f.offenders)}`).toBeLessThanOrEqual(f.innerWidth);

    await page.goto(`/terms?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const terms = page.locator("[data-mentor-terms]");
    await expect(terms).toBeVisible({ timeout: 25_000 });
    expect(await terms.textContent()).not.toMatch(INCLUDED_CLAIM);
    await terms.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/terms-${tag(v)}.png`, fullPage: false });
    const t = await measure(page);
    expect(t.scrollWidth, `no horizontal page scroll on /terms ${JSON.stringify(t.offenders)}`).toBeLessThanOrEqual(t.innerWidth);

    await page.goto(`/privacy?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const privacy = page.locator("[data-mentor-privacy]");
    await expect(privacy).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("Anthropic (KI-Mentor)").first()).toBeVisible();
    await privacy.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/privacy-${tag(v)}.png`, fullPage: false });
    const p = await measure(page);
    expect(p.scrollWidth, `no horizontal page scroll on /privacy ${JSON.stringify(p.offenders)}`).toBeLessThanOrEqual(p.innerWidth);

    await page.goto(`/pricing?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expect(page.locator("[data-mentor-included]")).toHaveCount(0);
    expect(await page.locator("main").first().textContent()).not.toMatch(/Mentor-Credits pro Monat inklusive|mentor credits a month included/);
    await page.screenshot({ path: `${dir()}/pricing-${tag(v)}.png`, fullPage: false });
    const r = await measure(page);
    expect(r.scrollWidth, `no horizontal page scroll on /pricing ${JSON.stringify(r.offenders)}`).toBeLessThanOrEqual(r.innerWidth);

    expect(errors, "console errors").toEqual([]);
  });
}
