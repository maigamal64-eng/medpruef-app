import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-cram-card: the Home cram card (HOME_CRAM_CARD_ENABLED is server-side, so
 * /api/auth/me and /api/home/cram-card are answered here as the flag-on
 * routes would answer them). The window and every date come from
 * OFFICIAL_SITTINGS against a running fake clock. Local build + stand-in only.
 */

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);

type Study = { activeExam: string | null; examDate: string | null };
const study = (s: Study) => ({
  day: "2026-10-25", streak: 2, answersToday: 3, dailyGoal: 20, activeDays7: 4, totalAnswered: 40, lastStudyDate: "2026-10-24",
  daysSinceStudy: 1, phase: "active", hitRate: 70, ...s,
});

async function open(page: Page, tier: "free" | "pro", s: Study, extra: { gm?: boolean; credits?: { credits: number; expires_at: string } | null } = {}) {
  const calls = { patches: [] as string[], sources: [] as string[], cardReads: [] as string[], tracked: [] as string[] };
  const state = { ...s };
  await page.route("**/api/auth/me**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      user: { id: USER_ID, first_name: "Fixture", tier, tier_expires_at: tier === "pro" ? "2027-03-31T00:00:00Z" : null, role: "user", referrals_enabled: false, active_exam: state.activeExam, home_cram_card: true, email: "release@example.invalid" },
      study: study(state), fetched_at: new Date().toISOString(),
    }),
  }));
  await page.route("**/api/mentor/availability", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(extra.credits ? { available: true, can_buy: true } : { available: false }) }));
  await page.route("**/api/home/cram-card**", (route) => {
    const need = new URL(route.request().url()).searchParams.get("need") ?? "";
    calls.cardReads.push(need);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(need === "gm" ? { enabled: true, gm: Boolean(extra.gm) } : { enabled: true, credits: extra.credits ?? null }) });
  });
  await page.route("**/api/user/exam-preference", (route) => {
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { examDate?: string; source?: string };
      // Home's own onboarding sync also PATCHes (without a date); only date writes count here.
      if (body.examDate) { calls.patches.push(body.examDate); calls.sources.push(body.source ?? ""); state.examDate = body.examDate; }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, persisted: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ activeExam: state.activeExam, examDate: state.examDate }) });
  });
  await page.route("**/api/track", (route) => {
    try { for (const e of (JSON.parse(route.request().postData() ?? "{}").events ?? []) as Array<{ type?: string; data?: Record<string, unknown> }>) calls.tracked.push(`${e.type}:${JSON.stringify(e.data ?? {})}`); } catch { /* not a batch */ }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return calls;
}

const card = (page: Page) => page.getByTestId("home-cram-card");
const NEVER = /€|EUR\b|bestanden|pass rate|Bestehensquote/; // card dates come from OFFICIAL_SITTINGS, so a year is expected

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`SIP bank only: neutral card, name the sitting, plan line, credits (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-10-25T10:00:00Z") });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const calls = await open(page, "free", { activeExam: "kenntnispruefung", examDate: null }, { credits: { credits: 25, expires_at: "2026-11-24T10:00:00Z" } });
    const c = card(page);
    await c.waitFor({ state: "visible", timeout: 25_000 });
    await expect(c).toHaveAttribute("data-variant", "sip_bank");
    await expect(c.getByRole("heading")).toHaveText(v.lang === "de" ? "Wiederholungsphase vor den SIP-Terminen" : "Review phase before the SIP sittings");
    // No named sitting and no countdown on the bank-only variant.
    await expect(c).not.toContainText(/Noch \d+ Tage|\d+ days to/);
    await expect(c).not.toContainText(NEVER);
    await expect(c.getByTestId("cram-credits")).toContainText(v.lang === "de" ? "Ihre Credits für den KI-Mentor: 25" : "Your AI Mentor credits: 25");
    await expect(c.getByRole("link", { name: v.lang === "de" ? "Lernplan öffnen" : "Open study plan" })).toHaveAttribute("href", "/study-plan");
    const m = await measure(page);
    await c.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/cram-sip-bank-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(calls.cardReads).toContain("credits");

    // Name the part: the same PATCH every date picker uses, no exam switch, the card re-plans to the named sitting.
    await c.getByRole("button", { name: /SIP4a/ }).click();
    await expect(c.getByRole("status")).toContainText(v.lang === "de" ? "Gespeichert: SIP4a (MedUni Wien)." : "Saved: SIP4a (MedUni Vienna).");
    expect(calls.patches).toEqual(["2026-11-18"]);
    // sitting_set is server-only since a-release-int-6: the PATCH carries source cram_card, /api/track never sees it.
    expect(calls.sources).toEqual(["cram_card"]);
    expect(calls.tracked.some((e) => e.startsWith("sitting_set:"))).toBe(false);
    await expect(c).toHaveAttribute("data-variant", "sip_named");
    await expect(c.getByRole("heading")).toHaveText(v.lang === "de" ? /^Noch 24 Tage bis SIP4a \(MedUni Wien\)$/ : /^24 days to SIP4a \(MedUni Vienna\)$/);
    await expect(c.getByTestId("cram-plan-line")).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/cram-sip-named-${tag(v)}.png` });
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`named SIP5a, paid: countdown, no plan line (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await open(page, "pro", { activeExam: "kenntnispruefung", examDate: "2026-11-17" });
    const c = card(page);
    await c.waitFor({ state: "visible", timeout: 25_000 });
    await expect(c).toHaveAttribute("data-variant", "sip_named");
    await expect(c.getByRole("heading")).toHaveText(v.lang === "de" ? /^Noch 15 Tage bis SIP5a/ : /^15 days to SIP5a/);
    await expect(c).toContainText(v.lang === "de" ? "17. November 2026" : "17 November 2026");
    await expect(c.getByTestId("cram-plan-line")).toHaveCount(0);
    const m = await measure(page);
    await page.screenshot({ path: `${EVIDENCE}/cram-sip-paid-${tag(v)}.png` });
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`Rez/GM exam week: state A, state B, dismiss for 7 days (${tag(v)})`, async ({ browser }) => {
    for (const gm of [false, true]) {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-11-02T10:00:00Z") });
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: true, tier: "free" });
      const calls = await open(page, "free", { activeExam: "pharma", examDate: null }, { gm });
      const c = card(page);
      await c.waitFor({ state: "visible", timeout: 25_000 });
      await expect(c).toHaveAttribute("data-variant", gm ? "rezgm_b" : "rezgm_a");
      await expect(c.getByRole("heading")).toHaveText(gm
        ? (v.lang === "de" ? "Rezeptierkunde und Gerichtsmedizin: Ihre Vorbereitungswoche" : "Rezeptierkunde and Gerichtsmedizin: your preparation week")
        : (v.lang === "de" ? "Rezeptierkunde: Ihre Vorbereitungswoche" : "Rezeptierkunde: your preparation week"));
      await expect(c).toContainText(v.lang === "de" ? "Noch 21 Tage bis zur Prüfungswoche." : "21 days to the exam week.");
      await expect(c).toContainText(v.lang === "de" ? /23\. November bis 27\. November 2026/ : /23 November to 27 November 2026/);
      if (gm) await expect(c).toContainText(v.lang === "de" ? "keine echten Prüfungsfragen" : "not real exam questions");
      else await expect(c).not.toContainText(/Gerichtsmedizin/);
      await expect(c.getByRole("link", { name: v.lang === "de" ? "Offizielle Informationen der MedUni Wien" : "Official MedUni Wien information" })).toHaveAttribute("href", /meduniwien\.ac\.at/);
      await expect(c.getByTestId("cram-plan-line")).toHaveCount(0);
      // Only the GM read, never credits or anything else (a page that reloads itself during hydration may repeat it).
      expect([...new Set(calls.cardReads)]).toEqual(["gm"]);
      const m = await measure(page);
      await c.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${EVIDENCE}/cram-rezgm-${gm ? "b" : "a"}-${tag(v)}.png` });
      expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
      if (gm) {
        // Hide: gone now and after a reload on this device and account.
        await c.getByRole("button", { name: v.lang === "de" ? "Ausblenden" : "Hide" }).click();
        await expect(c).toHaveCount(0);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3_000);
        await expect(card(page)).toHaveCount(0);
      }
      expect(errors).toEqual([]);
      await context.close();
    }
  });
}

test("outside the windows and without a saved bank no card shows", async ({ browser }) => {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  for (const [time, s] of [
    ["2026-10-19T10:00:00Z", { activeExam: "kenntnispruefung", examDate: null }],
    ["2026-11-28T10:00:00Z", { activeExam: "pharma", examDate: null }],
    ["2026-10-25T10:00:00Z", { activeExam: null, examDate: null }],
  ] as Array<[string, Study]>) {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(time) });
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await open(page, "free", s);
    await page.waitForTimeout(3_500);
    await expect(card(page)).toHaveCount(0);
    await context.close();
  }
});
