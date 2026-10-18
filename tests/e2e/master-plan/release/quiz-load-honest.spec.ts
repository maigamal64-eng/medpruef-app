import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-quiz-load-failed-honest smoke. QUIZ_LOAD_HONEST_BUILD=1 = a build with
 * NEXT_PUBLIC_QUIZ_LOAD_HONEST=true and NEXT_PUBLIC_QUIZ_PACK_FALLBACK=true (the
 * pack button needs both); without it the flag-off case proves the old box.
 * The telemetry cases run on any build.
 *
 * Pro with a stored pack, a body that is not JSON: the Lektor line, the
 * "Offline-Paket verwenden" button, quiz_load_failed {reason: parse, status: 200,
 * error_name: SyntaxError, tier: pro}; the button serves a pack question.
 * Free, a dropped connection: reason network, no pack button.
 * A hanging read: reason timeout at the 8 s default deadline (pack flag off).
 */
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const on = process.env.QUIZ_LOAD_HONEST_BUILD === "1";
const QUIZ = "/quiz?examSource=kenntnispruefung&topic=random&practiceMode=unseen";

const packRow = (id: number) => ({
  id, topic: "Neurologie", question: `Pack-Frage ${id}: Welche Aussage trifft zu?`, answer: "Pack Antwort A",
  explanation: "Synthetische Erklärung.", ai_explanation: null, exam_type: "kenntnispruefung",
  choices: ["Pack Antwort A", "Pack Antwort B", "Pack Antwort C", "Pack Antwort D"].map((text, i) => ({ text, correct: i === 0, position: i })),
  image_url: null, image_urls: null, exam_dates: [], tags: [], cached_at: "2026-10-20T08:00:00Z",
});

async function seedPack(page: Page) {
  await page.goto("/impressum", { waitUntil: "domcontentloaded" });
  await page.evaluate(async ({ rows, owner }) => {
    localStorage.setItem("medpruef_offline_owner", owner);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("medpruef-offline", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore("questions", { keyPath: "id" });
        store.createIndex("by_exam_topic", ["exam_type", "topic"]);
        store.createIndex("by_exam", "exam_type");
        db.createObjectStore("pending_answers", { keyPath: "id" });
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("questions", "readwrite");
        for (const row of rows) tx.objectStore("questions").put(row);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { rows: Array.from({ length: 6 }, (_, i) => packRow(82001 + i)), owner: USER_ID });
  await page.waitForLoadState("load");
}

/** A late client navigation on the seeding page can abort the next goto once; retry it. */
async function gotoQuiz(page: Page) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(QUIZ, { waitUntil: "domcontentloaded" });
      if (new URL(page.url()).pathname === "/quiz") return;
    } catch (e) {
      if (attempt >= 3 || !/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
    }
    if (attempt >= 3) throw new Error(`quiz not reached: ${page.url()}`);
    await page.waitForLoadState("load");
  }
}

async function me(page: Page, tier: "free" | "pro") {
  await page.route("**/api/auth/me*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: USER_ID, first_name: "Fixture", tier, tier_expires_at: tier === "pro" ? "2027-01-31T00:00:00Z" : null, role: "user", active_exam: "kenntnispruefung", onboarding_completed_at: "2026-10-01T00:00:00Z" }, fetched_at: new Date().toISOString() }) }));
}

type Tracked = { type: string; data: Record<string, unknown> };
async function captureTrack(page: Page): Promise<Tracked[]> {
  const events: Tracked[] = [];
  await page.route("**/api/track", (r) => {
    try {
      const body = JSON.parse(r.request().postData() ?? "{}") as { events?: Tracked[] };
      for (const e of body.events ?? []) events.push(e);
    } catch { /* not a batch */ }
    return r.fulfill({ status: 202, body: "" });
  });
  return events;
}

/** The questions read only: other GETs (countOnly) and POSTs fall through to the harness. */
async function questionsRead(page: Page, handler: (route: Parameters<Parameters<Page["route"]>[1]>[0]) => Promise<void> | void) {
  await page.route("**/api/questions*", (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() !== "GET" || url.searchParams.has("countOnly") || url.searchParams.has("ids")) return r.fallback();
    return handler(r);
  });
}

async function flush(page: Page) {
  // The tracker flushes on pagehide/visibility change; hide the tab to send now.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    window.dispatchEvent(new Event("visibilitychange"));
  });
}

const loadFailed = (events: Tracked[]) => events.filter((e) => e.type === "quiz_load_failed").map((e) => e.data);

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  const de = v.lang === "de";

  test(`pro with a pack: parse failure shows the Lektor line and the pack button ${tag(v)}`, async ({ page, context }) => {
    test.skip(!on, "needs QUIZ_LOAD_HONEST_BUILD=1");
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await me(page, "pro");
    const events = await captureTrack(page);
    await seedPack(page);
    await questionsRead(page, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "<html>gateway</html>" }));
    await gotoQuiz(page);
    const error = page.getByTestId("quiz-load-error");
    await expect(error).toHaveText(de
      ? "Die Frage konnte nicht geladen werden. Ihr bisheriger Lernstand bleibt erhalten. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut."
      : "The question could not be loaded. Your progress so far is kept. Please check your connection and try again.", { timeout: 25_000 });
    const pack = page.getByTestId("quiz-use-pack");
    await expect(pack).toHaveText(de ? "Offline-Paket verwenden" : "Use offline pack");
    await expect(page.getByRole("button", { name: de ? "Erneut versuchen" : "Retry" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`error-${tag(v)}.png`), fullPage: false });
    const m = await measure(page);
    expect(m.scrollWidth, JSON.stringify(m.offenders)).toBeLessThanOrEqual(m.innerWidth);

    await pack.click();
    await expect(page.locator("[data-question-text]").first()).toContainText("Pack-Frage", { timeout: 10_000 });
    await expect(page.getByTestId("quiz-pack-mode")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`pack-${tag(v)}.png`), fullPage: false });

    await flush(page);
    await expect.poll(() => loadFailed(events).length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(loadFailed(events)[0]).toMatchObject({ reason: "parse", status: 200, error_name: "SyntaxError", tier: "pro", mode: "unseen", exam: "kenntnispruefung" });
    expect(typeof loadFailed(events)[0].elapsed_ms).toBe("number");
    expect(events.some((e) => e.type === "quiz_pack_mode" && e.data.reason === "chosen")).toBe(true);
    expect(errors.filter((e) => !/api\/questions|Unexpected token|SyntaxError|is not valid JSON/.test(e))).toEqual([]);
  });

  test(`flags off: the error box is unchanged for Pro with a pack ${tag(v)}`, async ({ page, context }) => {
    test.skip(on, "flag-off build only");
    await page.setViewportSize({ width: v.width, height: v.height });
    await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
    await me(page, "pro");
    await captureTrack(page);
    await seedPack(page);
    await questionsRead(page, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "<html>gateway</html>" }));
    await gotoQuiz(page);
    await expect(page.getByText(de
      ? "Fragen konnten nicht geladen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut."
      : "Questions could not be loaded. Check your connection and retry.")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("quiz-load-error")).toHaveCount(0);
    await expect(page.getByTestId("quiz-use-pack")).toHaveCount(0);
  });

  test(`free, dropped connection: network reason, no pack button ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await me(page, "free");
    const events = await captureTrack(page);
    await questionsRead(page, (r) => r.abort("failed"));
    await page.goto(QUIZ, { waitUntil: "domcontentloaded" });
    const retry = page.getByRole("button", { name: de ? "Erneut versuchen" : "Retry" });
    await expect(retry).toBeVisible({ timeout: 25_000 });
    if (on) await expect(page.getByTestId("quiz-load-error")).toContainText(de ? "Ihr bisheriger Lernstand bleibt erhalten." : "Your progress so far is kept.");
    await expect(page.getByTestId("quiz-use-pack")).toHaveCount(0);
    const m = await measure(page);
    expect(m.scrollWidth, JSON.stringify(m.offenders)).toBeLessThanOrEqual(m.innerWidth);
    await flush(page);
    await expect.poll(() => loadFailed(events).length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(loadFailed(events)[0]).toMatchObject({ reason: "network", status: 0, error_name: "TypeError", tier: "free" });
    expect(errors.filter((e) => !/api\/questions|Failed to fetch|net::ERR/.test(e))).toEqual([]);
  });
}

test("a hanging read is reported as timeout at the client deadline (375; 8 s default, 5 s with the pack flag)", async ({ page, context }) => {
  const deadline = on || process.env.A_FO_08_FLAGS_ON === "1" ? 5_000 : 8_000;
  const v = VARIANTS[0];
  await page.setViewportSize({ width: v.width, height: v.height });
  await prepare(context, page, v, { signedIn: true, tier: "pro", onboarded: true });
  await me(page, "pro");
  const events = await captureTrack(page);
  const release: Array<() => void> = [];
  await questionsRead(page, async (r) => {
    await new Promise<void>((resolve) => { release.push(resolve); setTimeout(resolve, 15_000); });
    await r.abort("timedout").catch(() => undefined);
  });
  await page.goto(QUIZ, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Erneut versuchen" })).toBeVisible({ timeout: 20_000 });
  await flush(page);
  await expect.poll(() => loadFailed(events).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const row = loadFailed(events)[0];
  expect(row).toMatchObject({ reason: "timeout", status: 0, error_name: "TimeoutError", tier: "pro" });
  expect(row.elapsed_ms as number).toBeGreaterThanOrEqual(deadline - 500);
  expect(row.elapsed_ms as number).toBeLessThan(deadline + 4_000);
  release.forEach((r) => r());
});
