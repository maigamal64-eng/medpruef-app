import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-journey-engine: Home moments for the learner's own sitting. The flag
 * lives on the server, so /api/journey is answered here as the flag-on route
 * would answer it; the deadline line formats every date itself from
 * OFFICIAL_SITTINGS. Local build + stand-in only; the clock is fixed.
 */

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const OCT15 = new Date("2026-10-15T10:00:00Z");
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);

const sip5a = { key: "sip5a:2026-11-17", exam_keys: ["sip5a"], segment: "vienna_sip", date: "2026-11-17" };
const base = { enabled: true, closingSoon: false, inCram: false, canConfirm: false, registered: false, sittingWeek: false, kaf: false, resultsRoute: false };

async function journey(page: Page, view: Record<string, unknown>, onPost?: () => Record<string, unknown>) {
  await page.route("**/api/journey", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(onPost ? onPost() : {}) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) });
  });
}

const region = (page: Page, lang: "de" | "en") =>
  page.getByRole("region", { name: lang === "de" ? /Anmeldeschluss/i : /deadline/i }).first();

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`M3: own SIP5a line, "registered" button and confirmation (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(OCT15);
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true });
    const view = { ...base, phase: "registration", code: "m3", named: sip5a, closingSoon: true, canConfirm: true };
    let posted: string | null = null;
    await journey(page, view, () => ({ ok: true, ...view, registered: true }));
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/journey") posted = r.postData(); });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const line = region(page, v.lang);
    const button = page.getByRole("button", { name: v.lang === "de" ? "Ich habe mich angemeldet" : "I have registered" });
    await button.waitFor({ state: "visible", timeout: 25_000 });
    // The line follows the learner's own sitting: SIP5a only, with its official source.
    await expect(line).toContainText("SIP5a");
    await expect(line).not.toContainText("SIP4a");
    await expect(line.getByRole("link", { name: v.lang === "de" ? /Quelle: MedUni Wien/ : /Source: MedUni Wien/ })).toBeVisible();
    const m = await measure(page);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/journey-m3-${tag(v)}.png` });
    await button.click();
    await expect(line.getByRole("status")).toHaveText(v.lang === "de"
      ? "Sie sind angemeldet. Ab jetzt planen wir jede Woche bis zu Ihrem Termin."
      : "You are registered. From here we plan every week up to your sitting.");
    expect(JSON.parse(posted ?? "{}")).toEqual({ action: "registered", sitting_key: "sip5a:2026-11-17" });
    await page.screenshot({ path: `${EVIDENCE}/journey-m3-confirmed-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const lang of ["de", "en"] as const) {
  for (const dark of [false, true]) {
    for (const width of [375, 1280]) {
      const v: Variant = { width, height: width < 800 ? 812 : 900, lang, dark };
      test(`M4 card, M5 line and the sitting prompt (${tag(v)})`, async ({ browser }) => {
        // One browser context per moment: the announcement queue grants one inline card per session.
        const open = async (at: Date, view: Record<string, unknown>) => {
          const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
          const page = await context.newPage();
          // A running clock from `at`: the announcement queue waits SETTLE_MS on Date.now(),
          // which a fixed clock never lets pass (a-activation-48h, found after the merge).
          await page.clock.install({ time: at });
          const errors = trackErrors(page);
          await prepare(context, page, v, { signedIn: true });
          await journey(page, view);
          await page.goto("/", { waitUntil: "domcontentloaded" });
          return { context, page, errors };
        };

        // M4: four weeks out, timed mock for the learner's own part.
        const m4 = await open(new Date("2026-10-25T10:00:00Z"), { ...base, phase: "cram", code: "m4", named: sip5a, inCram: true, canConfirm: true, registered: true });
        const card = m4.page.locator("[data-moment='m4']");
        await card.waitFor({ state: "visible", timeout: 25_000 });
        await expect(card).toContainText(lang === "de" ? "Noch vier Wochen. Jetzt zählt das Üben unter Prüfungsbedingungen" : "Four weeks to go. Now practise under exam conditions");
        await expect(card.getByRole("link", { name: lang === "de" ? "Probeprüfung mit Zeitlimit starten" : "Start a timed mock exam" })).toHaveAttribute("href", "/exam?examSource=kenntnispruefung&part=sip5");
        await expect(card).not.toContainText(/€|EUR|\d{4}/);
        let m = await measure(m4.page);
        expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
        await card.scrollIntoViewIfNeeded();
        await m4.page.screenshot({ path: `${EVIDENCE}/journey-m4-${tag(v)}.png` });
        expect(m4.errors).toEqual([]);
        await m4.context.close();

        // M5: exam day, one line, nothing to buy.
        const m5 = await open(new Date("2026-11-17T08:00:00Z"), { ...base, phase: "exam_day", code: "m5", named: sip5a, sittingWeek: true });
        const line5 = m5.page.locator("[data-moment='m5']");
        await line5.waitFor({ state: "visible", timeout: 25_000 });
        await expect(line5).toHaveText(lang === "de" ? "Alles Gute für heute. Ihr Lernstand bleibt gespeichert." : "All the best today. Your progress stays saved.");
        await line5.scrollIntoViewIfNeeded();
        await m5.page.screenshot({ path: `${EVIDENCE}/journey-m5-${tag(v)}.png` });
        expect(m5.errors).toEqual([]);
        await m5.context.close();

        // No named sitting: "When is your exam?" opens the sitting picker.
        const a = await open(OCT15, { ...base, phase: "ask", code: "ask", named: null });
        const ask = a.page.locator("[data-moment='ask']");
        await ask.waitFor({ state: "visible", timeout: 25_000 });
        await expect(ask.getByRole("heading")).toHaveText(lang === "de" ? "Wann ist Ihre Prüfung?" : "When is your exam?");
        await expect(ask.getByRole("link", { name: lang === "de" ? "Termin wählen" : "Choose your sitting" })).toHaveAttribute("href", "/settings#exam-date");
        m = await measure(a.page);
        expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
        await ask.scrollIntoViewIfNeeded();
        await a.page.screenshot({ path: `${EVIDENCE}/journey-ask-${tag(v)}.png` });
        expect(a.errors).toEqual([]);
        await a.context.close();
      });
    }
  }

  test(`flag off: the plain deadline line, no moment surfaces (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: false };
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(OCT15);
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true });
    await page.route("**/api/journey", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) }));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const line = region(page, lang);
    await line.waitFor({ state: "visible", timeout: 25_000 });
    // The bank's line names both Vienna parts, as before the engine.
    await expect(line).toContainText("SIP4a");
    await expect(line).toContainText("SIP5a");
    await page.waitForTimeout(2_000);
    await expect(page.locator("[data-moment]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: lang === "de" ? "Ich habe mich angemeldet" : "I have registered" })).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}
