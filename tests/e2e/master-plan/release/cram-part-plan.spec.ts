import { expect, test, type Page } from "@playwright/test";
import { USER_ID, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-cram-part-plan smoke. Browser /api calls are synthetic (release-harness);
 * /api/user/study-plan is answered as the server would with
 * CRAM_PART_PLAN_ENABLED on (a SIP4a sitter on 5 Nov: yesterday's part run
 * makes today a drill day, T-7 run ahead) and off (no cram block). Covers the
 * part card (subjects, MedPrüf's own split, sitting format, SIP4a block rule
 * with its source, latest run, no-forecast line), the drill day, the part run
 * link (Pro: /exam part=sip4 from=plan; free: Pro pill and the gate), and the
 * latest part run on the trial-end card. 375 and 1280, DE and EN, light and
 * dark; no horizontal page scroll, no console errors.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const TODAY = "2026-11-05";
const day = (iso: string, extra: Record<string, unknown> = {}) => ({
  day: iso, phase: "new", totalQuestions: 30,
  topics: [{ topic: "Innere Medizin", targetCount: 12, focus: "new" }, { topic: "Chirurgische Fächer", targetCount: 12, focus: "new" }, { topic: "Dermatologie und Venerologie", targetCount: 6, focus: "new" }],
  ...extra,
});
const PLAN = {
  totalDays: 13, totalQuestions: 390, phaseBreak: "2026-11-14", generatedFor: "2026-11-18", weakTopics: ["Innere Medizin"], status: "normal",
  dailySchedule: [
    day(TODAY, { topics: [{ topic: "Innere Medizin", targetCount: 18, focus: "weak" }, { topic: "Dermatologie und Venerologie", targetCount: 12, focus: "weak" }], drill: { presetId: "kp_sip4", state: "blocks", runDay: "2026-11-04", blocks: ["Innere Medizin", "Dermatologie und Venerologie"] } }),
    day("2026-11-06"), day("2026-11-07"), day("2026-11-08"), day("2026-11-09"), day("2026-11-10"),
    day("2026-11-11", { simulation: { presetId: "kp_sip4", offsetDays: 7 } }),
    day("2026-11-12", { drill: { presetId: "kp_sip4", state: "pending" } }),
  ],
};
const CRAM = { part: "sip4", presetId: "kp_sip4", examKey: "sip4a", date: "2026-11-18", days: "d10_13", kaf: false, latestRun: { day: "2026-11-04", weak: ["Innere Medizin", "Dermatologie und Venerologie"] } };
const planResponse = (cram: boolean) => ({
  plan: PLAN, hasExamDate: true, examDate: "2026-11-18", targetDate: "2026-11-18", provisional: false, targetSource: "user_exam_date", expired: false,
  nextSittings: [], dailyGoal: 30, activeExam: "kenntnispruefung", todayISO: TODAY, unseenTotal: 1200, bankTotal: 1300, answeredToday: 4,
  focus: "all", weakAvailable: true, ...(cram ? { cram: CRAM } : {}),
});

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.use({ serviceWorkers: "block" });

for (const v of VARIANTS) {
  const de = v.lang === "de";

  test(`cram plan on, Pro: part card, drill day, part run link ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await page.route("**/api/user/study-plan**", (route) => route.fulfill(json(200, planResponse(true))));
    await page.goto("/study-plan", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("plan-cram-part");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(de ? "Ihr Plan für die SIP4a" : "Your plan for SIP4a");
    await expect(card).toContainText(de ? "die MedPrüf der SIP4a zuordnet" : "MedPrüf assigns to SIP4a");
    await expect(card.getByTestId("plan-cram-weights")).toContainText(de ? "nicht nach einer offiziellen Gewichtung" : "not by an official MedUni Wien weighting");
    await expect(card.getByTestId("sitting-format")).toBeVisible();
    await expect(card.getByTestId("plan-cram-rule")).toContainText(de ? "Regel der MedUni Wien" : "MedUni Wien rule");
    await expect(card.getByRole("link", { name: de ? "Quelle der Regel" : "Rule source" })).toHaveAttribute("href", /\/exam-formats\/sip4a/);
    await expect(card.getByTestId("plan-cram-runs")).toContainText(de ? "Probeprüfung zur SIP4a mit Zeitlimit" : "Timed SIP4a mock exam in your plan");
    await expect(card.getByTestId("plan-cram-latest")).toContainText(de ? "keine Vorhersage" : "not a forecast");
    await expect(card).not.toContainText(/bestanden|you will pass|garant/i);
    await expect(card).not.toContainText("{");
    const drill = page.locator('[data-testid="plan-drill"][data-drill-state="blocks"]').first();
    await expect(drill).toContainText(de ? "Nachbereitung Ihrer Probeprüfung" : "Drill day after your mock exam");
    const sim = page.getByTestId("plan-simulation").first();
    await expect(sim).toHaveAttribute("href", /\/exam\?examSource=kenntnispruefung&part=sip4&returnTo=%2Fstudy-plan&from=plan/);
    await expect(sim).toContainText(de ? "Probeprüfung SIP4a" : "SIP4a mock exam");
    await expect(page.getByTestId("mock-exam-link").getByRole("link")).toHaveAttribute("href", /part=sip4/);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/cram-part-plan/pro-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/study-plan cram pro");
    expect(errors).toEqual([]);
  });

  test(`cram plan on, free: run days keep the Pro pill and the gate ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/user/study-plan**", (route) => route.fulfill(json(200, { ...planResponse(true), cram: { ...CRAM, latestRun: null }, plan: { ...PLAN, dailySchedule: PLAN.dailySchedule.map((d) => ({ ...d, drill: undefined })) } })));
    await page.goto("/study-plan", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("plan-cram-part");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card.getByTestId("plan-cram-runs").locator(".mp-pro-pill")).toBeVisible();
    for (const link of await page.getByTestId("plan-simulation").all()) await expect(link).toHaveAttribute("href", "/pricing?gate=mock_exam");
    await expect(page.getByTestId("mock-exam-link").getByRole("link")).toHaveAttribute("href", "/pricing?gate=mock_exam");
    expect(await page.locator('a[href*="/exam?"]').count()).toBe(0);
    await page.screenshot({ path: `${OUT}/cram-part-plan/free-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/study-plan cram free");
    expect(errors).toEqual([]);
  });

  test(`cram plan off: today's plan, no part card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    const off = { ...planResponse(false), plan: { ...PLAN, dailySchedule: PLAN.dailySchedule.map((d) => ({ ...d, drill: undefined, simulation: undefined })) } };
    await page.route("**/api/user/study-plan**", (route) => route.fulfill(json(200, off)));
    await page.goto("/study-plan", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#heute")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("plan-cram-part")).toHaveCount(0);
    await expect(page.getByTestId("plan-drill")).toHaveCount(0);
    await expect(page.getByTestId("mock-exam-link").getByRole("link")).toHaveAttribute("href", "/exam?examSource=kenntnispruefung");
    await noOverflow(page, "/study-plan off");
    expect(errors).toEqual([]);
  });

  test(`trial-end card shows the latest part run's subjects below 60 percent ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    const endsAt = new Date(Date.now() + 10 * 3_600_000).toISOString();
    await page.route("**/api/auth/me**", (route) => route.fulfill(json(200, { user: {
      id: USER_ID, first_name: "Fixture", tier: "pro", tier_expires_at: endsAt, role: "user", referrals_enabled: false,
      active_exam: "kenntnispruefung", email: "release@example.invalid", trial_end_card: true, reverse_trial: { ends_at: endsAt, started: false },
    } })));
    await page.route("**/api/trial-end**", (route) => route.request().method() === "POST"
      ? route.fulfill(json(200, { ok: true, recorded: true }))
      : route.fulfill(json(200, {
        enabled: true, state: "last_day", ends_at: endsAt, trial: "auto", exam: "kenntnispruefung", sitting: null, translations: 2, capped: false,
        home_seen: false, v2: false, guard: false, ready: { flex_month: true, sitting_pass: true, half_year: false, guarantee_ticket: false },
        part_run: { exam_key: "sip4a", day: "2026-11-04", weak: ["Innere Medizin"] },
      })));
    await page.route("**/api/user/topic-progress**", (route) => route.fulfill(json(200, [])));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-trial-end-card="banner"]');
    await expect(card).toBeVisible({ timeout: 25_000 });
    const line = card.locator("[data-trial-end-part-run]");
    await expect(line).toContainText(de ? "Ihre letzte Probeprüfung zur SIP4a" : "Your last SIP4a mock exam");
    await expect(line).toContainText("Innere Medizin");
    await expect(line).not.toContainText("{");
    await expect(line).toContainText(de ? "keine Vorhersage" : "not a forecast");
    await expect(line.getByRole("link", { name: de ? "Quelle der Regel" : "Rule source" })).toHaveAttribute("href", de ? "/exam-formats/sip4a" : "/exam-formats/sip4a?lang=en");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/cram-part-plan/trial-end-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/ trial-end part run");
    expect(errors).toEqual([]);
  });
}
