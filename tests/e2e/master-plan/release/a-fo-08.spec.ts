import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-fo-08 at 375 px. Needs a local build with NEXT_PUBLIC_QUIZ_PACK_FALLBACK=true
 * and NEXT_PUBLIC_HOME_LAST_GOOD=true (plus the a35 stand-in, see release.md),
 * and A_FO_08_FLAGS_ON=1 for the run; skipped otherwise.
 *
 * Quiz: a hanging /api/questions is cut at 5 s, the downloaded pack serves the
 * next question, the next 5 taps read no question from the server, and every
 * answer still goes to /api/answer.
 * Home: a failed topic-progress / readiness read shows the account's last-good
 * copy with its time; another account never sees it.
 */

const V: Variant = { width: 375, height: 812, lang: "de", dark: false };

const packRow = (id: number) => ({
  id, topic: "Neurologie", question: `Pack-Frage ${id}: Welche Aussage trifft zu?`, answer: "Pack Antwort A",
  explanation: "Synthetische Erklärung.", ai_explanation: null, exam_type: "kenntnispruefung",
  choices: ["Pack Antwort A", "Pack Antwort B", "Pack Antwort C", "Pack Antwort D"].map((text, i) => ({ text, correct: i === 0, position: i })),
  image_url: null, image_urls: null, exam_dates: [], tags: [], cached_at: "2026-10-20T08:00:00Z",
});

async function seedPack(page: Page) {
  // Any first-party page gives the origin; then write the pack the way offline-pack stores it.
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
  }, { rows: Array.from({ length: 12 }, (_, i) => packRow(81001 + i)), owner: USER_ID });
}

// Part of the default release list, so it only runs when the build under test
// has both client flags on (they are baked in at build time).
test.skip(process.env.A_FO_08_FLAGS_ON !== "1", "needs a build with NEXT_PUBLIC_QUIZ_PACK_FALLBACK=true and NEXT_PUBLIC_HOME_LAST_GOOD=true; set A_FO_08_FLAGS_ON=1");
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

test("quiz: a hanging question read falls back to the pack and stays there for the next taps (375)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: V.width, height: V.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const writes = await prepare(context, page, V, { signedIn: true });
  await seedPack(page);

  // Every server question read hangs (a frozen database); nothing else changes.
  const questionReads: number[] = [];
  const hangs: Array<() => void> = [];
  await page.route("**/api/questions*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== "GET" || url.searchParams.has("countOnly")) return route.fallback();
    questionReads.push(Date.now());
    await new Promise<void>((resolve) => { hangs.push(resolve); setTimeout(resolve, 20_000); });
    return route.abort("timedout").catch(() => undefined);
  });
  const healthProbes: number[] = [];
  await page.route("**/api/health/db", (route) => { healthProbes.push(Date.now()); return route.fulfill({ status: 503, contentType: "application/json", body: '{"status":"unavailable"}' }); });

  const started = Date.now();
  await page.goto("/quiz?examSource=kenntnispruefung&topic=random&practiceMode=unseen", { waitUntil: "domcontentloaded" });
  const stem = page.locator("[data-question-text]").first();
  await expect(stem).toContainText("Pack-Frage", { timeout: 15_000 });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(4_500); // the 5 s client deadline, not the 8 s default
  expect(elapsed).toBeLessThan(12_000);
  await expect(page.getByTestId("quiz-pack-mode")).toContainText("heruntergeladenen Fragen");
  const readsBeforeTaps = questionReads.length;

  const answers: string[] = [];
  page.on("request", (req) => { if (new URL(req.url()).pathname === "/api/answer" && req.method() === "POST") answers.push(req.postData() ?? ""); });
  const seen = new Set<string>();
  for (let tap = 0; tap < 6; tap++) {
    const text = (await stem.innerText()).trim();
    expect(text).toContain("Pack-Frage");
    seen.add(text);
    await page.getByRole("button", { name: /Pack Antwort A/ }).first().click();
    await expect.poll(() => answers.length, { timeout: 10_000 }).toBe(tap + 1);
    if (tap === 5) break;
    await page.getByRole("button", { name: /Nächste Frage/ }).first().click();
    await expect.poll(async () => (await stem.innerText()).trim(), { timeout: 10_000 }).not.toBe(text);
  }
  expect(seen.size).toBe(6);
  // Five Next taps, no server question read; each answer went to /api/answer with its key fingerprint.
  expect(questionReads.length).toBe(readsBeforeTaps);
  for (const body of answers) expect(JSON.parse(body)).toMatchObject({ keyFingerprint: expect.stringMatching(/^k1:/) });
  expect(writes.filter((w) => w.path === "/api/answer")).toHaveLength(6);

  const m = await measure(page);
  expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
  hangs.forEach((r) => r());
  expect(errors.filter((e) => !/api\/questions|ERR_TIMED_OUT|net::ERR|503/.test(e))).toEqual([]);
  await context.close();
});

test("quiz: a healthy probe leaves pack mode and the next tap reads from the server again (375)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: V.width, height: V.height } });
  const page = await context.newPage();
  await page.clock.install();
  await prepare(context, page, V, { signedIn: true });
  await seedPack(page);
  let hang = true;
  const reads: string[] = [];
  await page.route("**/api/questions*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.searchParams.has("countOnly")) return route.fallback();
    reads.push(url.search);
    if (!hang) return route.fallback();
    return route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"DB_UNAVAILABLE"}' });
  });
  let healthy = false;
  await page.route("**/api/health/db", (route) => route.fulfill(healthy
    ? { status: 200, contentType: "application/json", body: '{"status":"ok"}' }
    : { status: 503, contentType: "application/json", body: '{"status":"unavailable"}' }));

  await page.goto("/quiz?examSource=kenntnispruefung&topic=random&practiceMode=unseen", { waitUntil: "domcontentloaded" });
  const stem = page.locator("[data-question-text]").first();
  await expect(stem).toContainText("Pack-Frage", { timeout: 15_000 }); // a 503 moves to the pack at once
  await expect(page.getByTestId("quiz-pack-mode")).toBeVisible();
  hang = false;
  healthy = true;
  await page.clock.runFor(31_000);
  await expect(page.getByTestId("quiz-pack-mode")).toBeHidden({ timeout: 10_000 });
  const before = reads.length;
  await page.getByRole("button", { name: /Pack Antwort A/ }).first().click();
  await page.getByRole("button", { name: /Nächste Frage/ }).first().click();
  await expect(stem).toContainText("Synthetische Prüfungsfrage", { timeout: 10_000 });
  expect(reads.length).toBeGreaterThan(before);
  await context.close();
});

async function asAccount(page: Page, id: string) {
  await page.route("**/api/auth/me*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id, first_name: "Fixture", tier: "pro", tier_expires_at: "2027-01-31T00:00:00Z", role: "user", referrals_enabled: true, active_exam: "kenntnispruefung", email: "release@example.invalid" } }) }));
}

const READINESS = { band: "building", trend: "up", lowestFactor: "coverage", hasExamDate: false, factors: { coverage: 0.2, accuracy: 0.7, consistency: 0.5, pace: null } };

test("home: a failed progress read shows the account's last-good copy with its time; another account never sees it (375)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: V.width, height: V.height } });
  const page = await context.newPage();
  await prepare(context, page, V, { signedIn: true });
  await asAccount(page, USER_ID);
  let failing = false;
  await page.route("**/api/user/readiness*", (route) => route.fulfill(failing
    ? { status: 503, contentType: "application/json", body: '{"code":"DB_UNAVAILABLE"}' }
    : { status: 200, contentType: "application/json", body: JSON.stringify(READINESS) }));
  // The harness's own rows carry a null accuracy (a malformed answer); these are valid.
  const PROGRESS = [
    { topic: "Neurologie", total: 40, answered: 24, correct: 17, wrong: 7, accuracy: 71 },
    { topic: "Kardiologie", total: 30, answered: 16, correct: 11, wrong: 5, accuracy: 69 },
  ];
  await page.route("**/api/user/topic-progress*", (route) => route.fulfill(failing
    ? { status: 503, contentType: "application/json", body: '{"code":"DB_UNAVAILABLE"}' }
    : { status: 200, contentType: "application/json", body: JSON.stringify(PROGRESS) }));

  // 1. A healthy visit stores the copy.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const hero = page.getByTestId("home-hero");
  await expect(hero).toContainText("40 / 70", { timeout: 25_000 }); // 24 + 16 answered of 40 + 30 topic rows
  await expect(hero.locator("h1")).toContainText("Im Aufbau");
  await expect(page.getByTestId("home-as-of")).toHaveCount(0);

  // 2. The database fails: the saved copy with its time, not an error or a dash.
  failing = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  const asOf = page.getByTestId("home-as-of");
  await expect(asOf).toContainText(/Gespeicherter Stand von \d{2}:\d{2}/, { timeout: 25_000 });
  await expect(hero.locator("h1")).toContainText("Im Aufbau");
  await expect(hero).toContainText("40 / 70");
  await expect(page.getByText("Fortschritt konnte nicht geladen werden.")).toHaveCount(0);
  const m = await measure(page);
  expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);

  // 3. Another account on the same device, same failure: no copy, the honest error.
  const other = "00000000-0000-4000-8000-0000000a0f08";
  await page.addInitScript((id) => {
    try {
      const s = JSON.parse(localStorage.getItem("medpruef_session") || "{}");
      if (s.user && s.user.id !== id) { s.user.id = id; localStorage.setItem("medpruef_session", JSON.stringify(s)); }
    } catch { /* blocked */ }
  }, other);
  await asAccount(page, other);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Fortschritt konnte nicht geladen werden.", { exact: true }).last()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("home-as-of")).toHaveCount(0);
  await expect(hero.locator("h1")).not.toContainText("Im Aufbau");
  await context.close();
});
