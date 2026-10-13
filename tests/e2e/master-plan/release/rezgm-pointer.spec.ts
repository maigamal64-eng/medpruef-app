import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-rezgm-pointer (U2): the Home deadline line of a Stichprobentest-track
 * learner (bank kmp_innsbruck) also shows the Rezeptierkunde/Gerichtsmedizin
 * registration close while that window is open, and never after the close.
 * A pharma learner keeps the single pharma line. Local build + stand-in only;
 * the clock is fixed so the window state does not depend on the run date.
 */

const OPEN = new Date("2026-10-14T08:00:00Z");
const CLOSED = new Date("2026-10-21T08:00:00Z");
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);

async function asBank(page: Page, bank: "kmp_innsbruck" | "pharma") {
  await page.addInitScript((b) => {
    // The harness's onboarding record names the Vienna bank; a learner of this
    // bank onboarded with it (otherwise Home re-saves the Vienna bank on load).
    try {
      localStorage.setItem("medpruef_exam_source", b);
      localStorage.setItem("medpruef_active_exam", b);
      localStorage.setItem("medpruef_onboarding", JSON.stringify({ completedAt: "2026-01-01T00:00:00Z", examSource: b }));
    } catch { /* blocked */ }
  }, bank);
  // Registered after prepare(), so these answers win over the harness defaults.
  await page.route("**/api/auth/me*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: USER_ID, first_name: "Fixture", tier: "pro", tier_expires_at: "2027-01-31T00:00:00Z", role: "user", referrals_enabled: true, active_exam: bank, email: "release@example.invalid" } }) }));
  // Only GET is answered here; a write falls back to the harness, which records it.
  await page.route("**/api/user/exam-preference*", (route) => route.request().method() !== "GET" ? route.fallback() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ activeExam: bank, exam_date: null, daily_goal: 20 }) }));
}

const deadlineRegion = (page: Page, lang: "de" | "en") =>
  page.getByRole("region", { name: lang === "de" ? /Anmeldeschluss|Termin/i : /deadline/i }).first();

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`kmp_innsbruck learner sees the Rez/GM pointer while open (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(OPEN);
    const errors = trackErrors(page);
    const writes = await prepare(context, page, v, { signedIn: true });
    await asBank(page, "kmp_innsbruck");
    const prefWrites: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET" && new URL(req.url()).pathname === "/api/user/exam-preference") prefWrites.push(req.postData() ?? "");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const pointer = page.locator("[data-deadline-pointer='pharma:2026-10-20']");
    await pointer.waitFor({ state: "visible", timeout: 25_000 });
    const region = deadlineRegion(page, v.lang);
    await expect(region).toContainText("Stichprobentest");
    await expect(pointer).toContainText(v.lang === "de" ? "Nur falls Ihr Nostrifizierungsantrag an der MedUni Wien läuft:" : "Only if your recognition application is filed at MedUni Wien:");
    await expect(pointer).toContainText(v.lang === "de" ? "Anmeldeschluss Dienstag, 20. Oktober 2026, 12:00 Uhr" : "Registration closes Tuesday, 20 October 2026, 12:00 Vienna time");
    const link = pointer.getByRole("link", { name: v.lang === "de" ? "Rezeptierkunde und Gerichtsmedizin anmelden" : "Register for Rezeptierkunde and Gerichtsmedizin" });
    await expect(link).toHaveAttribute("href", `/wien-route/rez-gm-anmeldung?lang=${v.lang}`);
    await expect(pointer.getByRole("link", { name: v.lang === "de" ? /Quelle: MedUni Wien/ : /Source: MedUni Wien/ })).toBeVisible();
    const m = await measure(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/rezgm-kmp-open-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors).toEqual([]);
    // The pointer never changes the saved bank: no preference write names
    // another exam, and following the link writes nothing at all.
    const before = prefWrites.length;
    expect(prefWrites.filter((b) => /"activeExam"/.test(b) && !/"activeExam":"kmp_innsbruck"/.test(b))).toEqual([]);
    await link.click();
    await page.waitForURL(/\/wien-route\/rez-gm-anmeldung\?lang=(de|en)$/, { timeout: 25_000 });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    expect(prefWrites.slice(before)).toEqual([]);
    expect(writes.filter((w) => w.path === "/api/user/exam-preference" && w.method !== "GET").length).toBe(before);
    expect(await page.evaluate(() => localStorage.getItem("medpruef_exam_source"))).toBe("kmp_innsbruck");
    await context.close();
  });
}

for (const lang of ["de", "en"] as const) {
  test(`kmp_innsbruck learner: pointer gone after the close (${lang})`, async ({ browser }) => {
    const v: Variant = { width: 375, height: 812, lang, dark: false };
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(CLOSED);
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true });
    await asBank(page, "kmp_innsbruck");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await deadlineRegion(page, lang).waitFor({ state: "visible", timeout: 25_000 });
    await expect(deadlineRegion(page, lang)).toContainText("Stichprobentest");
    await expect(page.locator("[data-deadline-pointer]")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  for (const dark of [false, true]) {
    test(`pharma learner keeps one pharma line, no pointer (${lang}, ${dark ? "dark" : "light"})`, async ({ browser }) => {
      const v: Variant = { width: 375, height: 812, lang, dark };
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      await page.clock.setFixedTime(OPEN);
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: true });
      await asBank(page, "pharma");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const region = deadlineRegion(page, lang);
      await region.waitFor({ state: "visible", timeout: 25_000 });
      await expect(region).toContainText("Rezeptierkunde");
      await expect(region).not.toContainText("Stichprobentest");
      await expect(page.locator("[data-deadline-pointer]")).toHaveCount(0);
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/rezgm-pharma-${lang}-${dark ? "dark" : "light"}.png` });
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}
