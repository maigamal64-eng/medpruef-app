import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-results-route smoke. Browser /api calls are synthetic (release-harness);
 * the flag lives on the server, so /api/results-route is mocked as if on.
 * Covers the Stichprobentest outcome question (which exams follow, never pass
 * or fail; one POST; next track, experience and invitation shown) and a SIP
 * rescue route next to the exam report form (official link, study plan).
 * 375 and 1280, DE and EN, light and dark; no horizontal page scroll, no
 * console errors.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const OFFICIAL = { url: "https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/pruefungen/", label: "MedUni Wien, Nostrifizierung, Prüfungen" };
const SPT = { key: "stichprobentest:2026-09-23", exam_key: "stichprobentest", kind: "spt", label: { de: "Stichprobentest Graz", en: "Stichprobentest Graz" }, date: "2026-09-23", ask: true, answer: null, plan: null };

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`results route: Stichprobentest asks which exams follow, one POST, next track ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const posts: unknown[] = [];
    await page.route("**/api/exam-report", (route) => route.fulfill(json(200, { enabled: false })));
    await page.route("**/api/results-route", (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, { enabled: true, official: OFFICIAL, sittings: [SPT] }));
      posts.push(route.request().postDataJSON());
      return route.fulfill(json(200, { ok: true, outcome: "rez_gm", plan: { next: ["pharma"], rescue: false, officialNext: false, gm: false, testimonial: true, referral: true } }));
    });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("settings-exam-report");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "Ihr Termin ist vorbei. Wie ist es gelaufen?" : "Your sitting is over. How did it go?");
    await expect(card).toContainText(v.lang === "de" ? "Welche Prüfungen folgen bei Ihnen?" : "Which exams follow for you?");
    await expect(card).not.toContainText(/bestanden|passed|fail/i);
    await card.locator('button[type="submit"]').click();
    await expect(card.locator('[role="alert"]')).toBeVisible();
    expect(posts).toHaveLength(0);
    await card.locator('input[type="radio"][value="rez_gm"]').check();
    await expect(card.locator('[role="alert"]')).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/results-route/spt-question-${tag(v)}.png`, fullPage: false });
    await card.locator('button[type="submit"]').click();
    await expect(card.getByTestId("results-route-plan")).toBeVisible();
    expect(posts).toEqual([{ sitting_key: "stichprobentest:2026-09-23", outcome: "rez_gm" }]);
    await expect(card).toContainText(v.lang === "de" ? "Nach dem Stichprobentest folgen" : "After the Stichprobentest");
    await expect(card.getByRole("button", { name: v.lang === "de" ? /Mit .* weitermachen/ : /Continue with/ })).toBeVisible();
    await expect(card.getByRole("link", { name: v.lang === "de" ? "Erfahrung teilen" : "Share your experience" })).toHaveAttribute("href", "#erfahrung");
    await expect(card.getByRole("link", { name: v.lang === "de" ? "Einladen" : "Invite" })).toHaveAttribute("href", "/referrals");
    await expect(card).not.toContainText("€");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/results-route/spt-route-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/settings");
    expect(errors, "console errors").toEqual([]);
  });

  test(`results route: SIP rescue links the official page next to the exam report form ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/exam-report", (route) => route.fulfill(json(200, { enabled: true, eligible: true, credits: 150, expiry_days: 60, sittings: [{ key: "sip4a:2026-11-18", label: { de: "SIP4a Wien", en: "SIP4a Vienna" }, sent: false, rewarded: false }] })));
    await page.route("**/api/results-route", (route) => route.fulfill(json(200, { enabled: true, official: OFFICIAL, sittings: [
      { key: "sip4a:2026-11-18", exam_key: "sip4a", kind: "sip", label: { de: "SIP4a (MedUni Wien)", en: "SIP4a (MedUni Vienna)" }, date: "2026-11-18", ask: false, answer: { outcome: "not_all_passed", at: "2026-12-01T10:00:00Z" }, plan: { next: [], rescue: true, officialNext: false, gm: false, testimonial: false, referral: false } },
    ] })));
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("settings-exam-report");
    await expect(card.getByTestId("results-route-plan")).toBeVisible({ timeout: 25_000 });
    const official = card.getByRole("link", { name: OFFICIAL.label });
    await expect(official).toHaveAttribute("href", OFFICIAL.url);
    await expect(official).toHaveAttribute("rel", /noopener/);
    await expect(card.getByRole("link", { name: v.lang === "de" ? "Zum Lernplan" : "Open study plan" })).toHaveAttribute("href", "/study-plan");
    await expect(card.locator("textarea")).toBeVisible();
    await expect(card.getByRole("link", { name: v.lang === "de" ? "Einladen" : "Invite" })).toHaveCount(0);
    await card.getByRole("button", { name: v.lang === "de" ? "Antwort ändern" : "Change answer" }).click();
    await expect(card.getByTestId("results-route-form").locator('input[type="radio"][value="passed"]')).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/results-route/sip-rescue-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/settings");
    expect(errors, "console errors").toEqual([]);
  });
}
