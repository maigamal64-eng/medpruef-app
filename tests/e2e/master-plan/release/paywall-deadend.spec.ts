import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-paywall-deadend-fix smoke (needs a build with NEXT_PUBLIC_FREE_WALL_UPGRADE=true;
 * PRICING_V2_ENABLED=true adds the plan-fit line). Free at the cap: the modal's
 * "Später" leaves the wall card with "Tarife ansehen", never a "done" screen.
 * Free topic wall: the remaining free sample and the bank-carrying Pro link.
 * Paid learner who finished: the honest done text, no upgrade card. Home after
 * the cap: one calm card. Synthetic APIs only, local server.
 */
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const v2 = process.env.PRICING_V2_BUILD === "1";
// The upgrade screens need a build with NEXT_PUBLIC_FREE_WALL_UPGRADE=true (FREE_WALL_BUILD=1);
// without it only the flags-off case runs and proves today's screens are unchanged.
const on = process.env.FREE_WALL_BUILD === "1";

async function questions(page: Page, body: unknown) {
  await page.route("**/api/questions*", (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() !== "GET" || url.searchParams.has("countOnly")) return r.fallback();
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function me(page: Page, tier: "free" | "pro") {
  await page.route("**/api/auth/me*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: USER_ID, first_name: "Fixture", tier, tier_expires_at: tier === "pro" ? "2027-01-31T00:00:00Z" : null, role: "user", active_exam: "kenntnispruefung", onboarding_completed_at: "2026-10-01T00:00:00Z" }, fetched_at: new Date().toISOString() }) }));
}

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  const de = v.lang === "de";

  test(`free at the cap keeps the wall card after the modal ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs FREE_WALL_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    await questions(page, { paywallHit: true, seen: 150, limit: 150 });
    await page.goto("/quiz?examSource=kenntnispruefung", { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 25_000 });
    await dialog.getByRole("button", { name: de ? "Später" : "Later" }).click();
    await expect(dialog).toHaveCount(0);
    const card = page.getByTestId("free-wall-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(de ? "Mit Pro üben Sie alle Fragen dieser Fragenbank." : "With Pro you practise every question in this question bank.");
    if (v2) await expect(card).toContainText(de ? "passenden Tarif" : "the plan that fits");
    const link = card.getByRole("link", { name: de ? "Tarife ansehen" : "See plans" });
    await expect(link).toHaveAttribute("href", "/pricing?gate=qbank_limit&bank=kenntnispruefung");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    await expect(page.getByText(de ? "Alle verfügbaren Fragen in dieser Auswahl sind bearbeitet" : "You have covered all available questions")).toHaveCount(0);
    await noOverflow(page, "/quiz wall");
    await page.screenshot({ path: `${EVIDENCE}/paywall-deadend/cap-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`free topic wall shows the free sample left and the Pro link ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs FREE_WALL_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    await questions(page, { freeTopicEmpty: true, reason: "all_seen", topics: [{ topic: "Kardiologie", left: 5 }], freeLeft: 12 });
    await page.goto("/quiz?examSource=kenntnispruefung&topic=Neurologie", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("free-topic-empty");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(de ? "In Ihrer kostenlosen Probe sind noch 12 Fragen in anderen Fachgebieten offen." : "Your free sample still has 12 questions open in other subjects.");
    await expect(card.getByRole("link", { name: de ? "Pro ansehen" : "See Pro" })).toHaveAttribute("href", "/pricing?gate=full_bank&bank=kenntnispruefung");
    await noOverflow(page, "/quiz topic wall");
    await page.screenshot({ path: `${EVIDENCE}/paywall-deadend/topic-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`paid learner who finished keeps the honest done state ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs FREE_WALL_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await me(page, "pro");
    await questions(page, []);
    await page.goto("/quiz?examSource=kenntnispruefung&topic=Neurologie&practiceMode=unseen", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(de ? "Alle verfügbaren Fragen in dieser Auswahl sind bearbeitet" : "You have covered all available questions")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("free-wall-card")).toHaveCount(0);
    await expect(page.getByTestId("free-done-card")).toHaveCount(0);
    await noOverflow(page, "/quiz paid done");
    await page.screenshot({ path: `${EVIDENCE}/paywall-deadend/paid-done-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`free learner with an empty unseen run gets the upgrade line ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs FREE_WALL_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    await questions(page, []);
    await page.goto("/quiz?examSource=kenntnispruefung&topic=Neurologie&practiceMode=unseen", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("free-done-card");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(de ? "Sie haben alle Fragen der kostenlosen Probe in dieser Auswahl beantwortet." : "You have answered every free-sample question in this selection.");
    await expect(card.getByRole("link", { name: de ? "Tarife ansehen" : "See plans" })).toHaveAttribute("href", "/pricing?gate=full_bank&bank=kenntnispruefung");
    await noOverflow(page, "/quiz free done");
    expect(errors, "console errors").toEqual([]);
  });

  test(`Home after the cap shows one calm card ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs FREE_WALL_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    await page.route("**/api/user/topic-progress*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { topic: "Neurologie", total: 420, answered: 80, correct: 60, wrong: 20, accuracy: 75, freeTotal: 90, freeLeft: 0 },
      { topic: "Kardiologie", total: 380, answered: 70, correct: 50, wrong: 20, accuracy: 71, freeTotal: 60, freeLeft: 0 },
      { topic: "Chirurgische Fächer", total: 510, answered: 0, correct: 0, wrong: 0, accuracy: 0, freeTotal: 0, freeLeft: 0 },
    ]) }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("home-free-wall");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(de ? "Ihre kostenlose Probe in" : "Your free sample in");
    await expect(card.getByRole("link", { name: de ? "Tarife ansehen" : "See plans" })).toHaveAttribute("href", "/pricing?gate=qbank_limit&bank=kenntnispruefung");
    await noOverflow(page, "/ free wall");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/paywall-deadend/home-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`Home shows no card when a free count is missing ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs FREE_WALL_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    await page.route("**/api/user/topic-progress*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { topic: "Neurologie", total: 420, answered: 80, correct: 60, wrong: 20, accuracy: 75, freeTotal: 90, freeLeft: 0 },
      { topic: "Kardiologie", total: 380, answered: 70, correct: 50, wrong: 20, accuracy: 71 },
    ]) }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId("home-free-wall")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`flags off: the cap and an empty free run keep today's screens ${tag(v)}`, async ({ page, context }) => {
    test.skip(on, "runs on a build without NEXT_PUBLIC_FREE_WALL_UPGRADE");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    await questions(page, []);
    await page.goto("/quiz?examSource=kenntnispruefung&topic=Neurologie&practiceMode=unseen", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(de ? "Alle verfügbaren Fragen in dieser Auswahl sind bearbeitet" : "You have covered all available questions")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("free-done-card")).toHaveCount(0);
    await expect(page.getByTestId("free-wall-card")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
}
