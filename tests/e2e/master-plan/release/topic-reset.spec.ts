import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-topic-reset-selfserve-1019 smoke. /curriculum with synthetic APIs: the
 * quiet reset action opens one dialog (subjects with progress only, what goes
 * back to zero, what stays, that the old progress is saved), sends
 * {exam_type, topic} and reloads the numbers. With the flag off
 * (GET answers enabled:false) nothing is shown. No horizontal scroll, no
 * console errors, 375 and 1280, DE and EN, light and dark.
 */
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";

async function resetApi(page: Page, enabled: boolean) {
  const posts: unknown[] = [];
  await page.route("**/api/user/topic-progress/reset", async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled }) });
    posts.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "reset", counts: { answer_history: 24 } }) });
  });
  return posts;
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  const de = v.lang === "de";

  test(`curriculum reset dialog ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    const posts = await resetApi(page, true);
    let progressReads = 0;
    page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/user/topic-progress") progressReads += 1; });
    await page.goto("/curriculum", { waitUntil: "domcontentloaded" });
    const entry = page.getByRole("button", { name: de ? "Fortschritt in einem Fach zurücksetzen" : "Reset progress in a subject" });
    await expect(entry).toBeVisible({ timeout: 25_000 });
    // The list can re-render once while the exam resolves; read the box when settled.
    await expect.poll(async () => (await entry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43);
    await entry.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Only subjects with progress are offered.
    const select = dialog.getByLabel(de ? "Fach" : "Subject");
    const options = await select.locator("option").allTextContents();
    expect(options).toContain("Neurologie");
    expect(options).not.toContain("Chirurgische Fächer");
    await expect(dialog).toContainText(de ? "Das bleibt erhalten: Ihre XP, Ihre Serie, Ihr Lernplan" : "What stays: your XP, your streak, your study plan");
    await expect(dialog).toContainText(de ? "Ihr bisheriger Fortschritt wird gesichert" : "Your previous progress is saved");
    await expect(dialog).toContainText(de ? "zählen weiter zu Ihren kostenlosen Fragen" : "still count toward your free questions");
    const m1 = await measure(page);
    expect(m1.scrollWidth, `dialog: no horizontal scroll ${JSON.stringify(m1.offenders)}`).toBeLessThanOrEqual(m1.innerWidth);
    await page.screenshot({ path: `${EVIDENCE}/topic-reset/dialog-${tag(v)}.png` });
    await select.selectOption("Neurologie");
    const before = progressReads;
    await dialog.getByRole("button", { name: de ? "Fortschritt in diesem Fach zurücksetzen" : "Reset progress in this subject" }).click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toEqual([{ exam_type: "kenntnispruefung", topic: "Neurologie" }]);
    await expect(page.getByText(de ? "Der Fortschritt in Neurologie wurde zurückgesetzt." : "Progress in Neurologie has been reset.").first()).toBeVisible();
    await expect.poll(() => progressReads).toBeGreaterThan(before);
    const m2 = await measure(page);
    expect(m2.scrollWidth).toBeLessThanOrEqual(m2.innerWidth);
    await page.screenshot({ path: `${EVIDENCE}/topic-reset/after-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`flag off shows no reset action ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await resetApi(page, false);
    await page.goto("/curriculum", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Neurologie").first()).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: de ? "Fortschritt in einem Fach zurücksetzen" : "Reset progress in a subject" })).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
}
