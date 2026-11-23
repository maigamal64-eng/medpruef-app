import { expect, test, type Page } from "@playwright/test";
import { stpDeadlineCard } from "../../../../src/lib/stp-deadline-card";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-c1-stp-card-1119 (C1): the Home Stichprobentest deadline card.
 * STP_DEADLINE_CARD_ENABLED is server-side, so /api/auth/me and
 * /api/stp-deadline-card/line are answered here as the flag-on route would
 * answer them: the body is built by the real stpDeadlineCard() (dates,
 * publishers and links from OFFICIAL_SITTINGS) at the spec's fixed clock.
 * Local build + stand-in only, synthetic APIs.
 */

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const VARIANTS: Variant[] = (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width: 390, height: 844, lang, dark })));

type Scenario = { name: string; tier: "free" | "pro"; examDate: string | null; activeExam: string; clock: string };
const FEB_FREE: Scenario = { name: "free-feb", tier: "free", examDate: "2027-02-03", activeExam: "kmp_innsbruck", clock: "2026-11-19T10:00:00Z" };
const FEB_PAID: Scenario = { name: "paid-feb", tier: "pro", examDate: "2027-02-03", activeExam: "kmp_innsbruck", clock: "2026-11-19T10:00:00Z" };
const NO_SITTING: Scenario = { name: "no-sitting", tier: "free", examDate: null, activeExam: "kmp_innsbruck", clock: "2026-11-30T10:00:00Z" };

async function open(page: Page, v: Variant, s: Scenario) {
  const tracked: string[] = [];
  await page.route("**/api/auth/me**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      user: { id: USER_ID, first_name: "Fixture", tier: s.tier, tier_expires_at: s.tier === "pro" ? "2027-03-31T00:00:00Z" : null, role: "user", referrals_enabled: false, active_exam: s.activeExam, stp_deadline_card: true, email: "release@example.invalid" },
      study: { day: s.clock.slice(0, 10), streak: 2, answersToday: 3, dailyGoal: 20, activeDays7: 4, totalAnswered: 40, lastStudyDate: "2026-11-18", daysSinceStudy: 1, phase: "active", hitRate: 70, activeExam: s.activeExam, examDate: s.examDate },
      fetched_at: new Date().toISOString(),
    }),
  }));
  await page.route("**/api/stp-deadline-card/line**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(stpDeadlineCard({
      now: new Date(s.clock), lang: v.lang, examDate: s.examDate, activeExam: s.activeExam, isPaid: s.tier === "pro", momentsOn: false,
      fit: () => ({ plan: v.lang === "de" ? "Sitting Pass" : "Sitting Pass", total: v.lang === "de" ? "49,00 €" : "€49.00" }),
    })),
  }));
  await page.route("**/api/track", (route) => {
    try { for (const e of (JSON.parse(route.request().postData() ?? "{}").events ?? []) as Array<{ type?: string; data?: Record<string, unknown> }>) tracked.push(`${e.type}:${JSON.stringify(e.data ?? {})}`); } catch { /* ignore */ }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return tracked;
}

const card = (page: Page) => page.getByTestId("stp-deadline-card");

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`free learner, February sitting: title, both rows, plan line, CTA (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(FEB_FREE.clock) });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const tracked = await open(page, v, FEB_FREE);
    const c = card(page);
    await c.waitFor({ state: "visible", timeout: 25_000 });
    await expect(c).toHaveAttribute("data-variant", "sitting");
    await expect(c.getByRole("heading")).toHaveText(v.lang === "de" ? "Ihr Termin: Stichprobentest Innsbruck, 3. Februar 2027" : "Your sitting: Stichprobentest Innsbruck, 3 February 2027");
    const links = c.getByTestId("stp-deadline-rows").getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText(v.lang === "de" ? "MedUni Wien" : "MedUni Vienna");
    await expect(links.nth(1)).toHaveText(v.lang === "de" ? "Medizinische Universität Innsbruck" : "Medical University of Innsbruck");
    await expect(c.getByTestId("stp-deadline-rows")).toContainText(v.lang === "de" ? "Einreichungsfrist 14. Dezember 2026" : "submission deadline 14 December 2026");
    await expect(c.getByTestId("stp-deadline-rows")).toContainText(v.lang === "de" ? "Anmeldefrist 7. Jänner 2027" : "registration deadline 7 January 2027");
    await expect(c.getByTestId("stp-deadline-rows")).toContainText(v.lang === "de" ? "Bitte bestätigen Sie die Frist bei der Universität" : "Please confirm the deadline with the university");
    await expect(c.getByTestId("stp-deadline-plan")).toContainText("Sitting Pass");
    await expect(c).not.toContainText(/[–—]/);
    const cta = c.getByRole("link", { name: v.lang === "de" ? "Tarif bis zu Ihrem Termin ansehen" : "See the plan up to your sitting" });
    await expect(cta).toHaveAttribute("href", "/pricing?gate=full_bank&bank=kmp_innsbruck&sitting=2027-02-03&sitting_end=2027-02-03");
    const m = await measure(page);
    await c.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/c1-${FEB_FREE.name}-${tag(v)}.jpg`, type: "jpeg", quality: 60 });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await cta.click();
    await expect.poll(() => tracked.some((e) => e.startsWith("paywall_click:") && e.includes('"target":"pricing"') && e.includes('"line":"c1"')), { timeout: 8_000 }).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test(`paid learner, February sitting: title and rows only (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(FEB_PAID.clock) });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await open(page, v, FEB_PAID);
    const c = card(page);
    await c.waitFor({ state: "visible", timeout: 25_000 });
    await expect(c.getByTestId("stp-deadline-rows").getByRole("link")).toHaveCount(2);
    await expect(c.getByTestId("stp-deadline-plan")).toHaveCount(0);
    await expect(c.getByRole("link", { name: /\/pricing|Tarif|plan up to/ })).toHaveCount(0);
    const m = await measure(page);
    await c.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/c1-${FEB_PAID.name}-${tag(v)}.jpg`, type: "jpeg", quality: 60 });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test(`no sitting set, Stichprobentest bank, from 28 Nov: the ask (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(NO_SITTING.clock) });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await open(page, v, NO_SITTING);
    const c = card(page);
    await c.waitFor({ state: "visible", timeout: 25_000 });
    await expect(c).toHaveAttribute("data-variant", "ask");
    await expect(c).toContainText(v.lang === "de" ? "Für welchen Stichprobentest lernen Sie?" : "Which Stichprobentest are you preparing for?");
    await expect(c.getByRole("link", { name: v.lang === "de" ? "Termin wählen" : "Choose your sitting" })).toHaveAttribute("href", "/settings#exam-date");
    const m = await measure(page);
    await c.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/c1-${NO_SITTING.name}-${tag(v)}.jpg`, type: "jpeg", quality: 60 });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
