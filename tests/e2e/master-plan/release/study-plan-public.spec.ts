import { expect, test, type Page } from "@playwright/test";
import { BASE, assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-study-plan-magnet (M8): the public /lernplan page. Local build + stand-in
 * only, server started with STUDY_PLAN_PUBLIC_ENABLED=true. A second server
 * without the flag (A35_FLAG_OFF_URL) must answer 404.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const EVIDENCE = process.env.A35_EVIDENCE_DIR;

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/study-plan-public/${name}.png`, fullPage: true });
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`plan for the Stichprobentest shows weeks, both publishers and the save CTA (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const sitting = "2027-02-03";
    await page.goto(`/lernplan?bank=kmp_innsbruck&sitting=${sitting}&hours=8&lang=${v.lang}`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("public-plan-summary")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(v.lang === "de" ? "Ihr Lernplan bis zum Prüfungstermin" : "Your study plan to the exam date");
    const deadlines = page.getByTestId("public-plan-deadline");
    await expect(deadlines).toHaveCount(2);
    await expect(page.getByTestId("public-plan-registration")).toContainText("MedUni Wien");
    await expect(page.getByTestId("public-plan-registration")).toContainText("Medizinische Universität Innsbruck");
    expect(await page.getByTestId("public-plan-week").count()).toBeGreaterThan(3);
    await expect(page.getByTestId("public-plan-narrative")).toHaveCount(0);
    const cta = page.getByTestId("public-plan-save-cta");
    const href = (await cta.getAttribute("href")) ?? "";
    const url = new URL(href, BASE);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("intent")).toBe("free");
    expect(url.searchParams.get("exam")).toBe("kmp_innsbruck");
    expect(url.searchParams.get("utm_source")).toBe("study-plan");
    const next = new URL(url.searchParams.get("next") ?? "", BASE);
    expect(next.pathname).toBe("/study-plan");
    expect(next.searchParams.get("plan_date")).toBe(sitting);
    expect(next.searchParams.get("plan_goal")).toBe("46");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/€|\bEUR\b/);
    const m = await measure(page);
    expect(m.scrollWidth, m.offenders.join(", ")).toBeLessThanOrEqual(m.innerWidth);
    expect(m.fixedInFlow).toEqual([]);
    await shot(page, `stp-${tag(v)}`);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("the form follows the bank and builds a pharma plan", async ({ browser }) => {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: false });
  await page.goto("/lernplan?lang=de", { waitUntil: "networkidle" });
  await expect(page.getByTestId("public-plan-summary")).toHaveCount(0);
  await page.getByLabel("Fragenbank").selectOption("pharma");
  const sitting = page.getByLabel("Offizieller Termin");
  await expect(sitting.locator("option").first()).toContainText("Rezeptierkunde");
  await expect(page.getByTestId("plan-sitting-publisher")).toContainText("MedUni Wien");
  await page.getByLabel("Lernzeit pro Woche").selectOption("3");
  await page.getByRole("button", { name: "Lernplan anzeigen" }).click();
  await page.waitForURL(/bank=pharma.*#plan$/);
  await expect(page.getByTestId("public-plan-summary")).toBeVisible();
  await expect(page.getByTestId("public-plan-deadline")).toContainText("12:00 Uhr");
  await shot(page, "pharma-form-375-de-light");
  expect(errors).toEqual([]);
  await context.close();
});

test("an invalid sitting for the bank shows no plan", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await prepare(context, page, { width: 1280, height: 900, lang: "en", dark: false }, { signedIn: false });
  const res = await page.goto("/lernplan?bank=pharma&sitting=2027-02-03&hours=8&lang=en");
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("public-plan-summary")).toHaveCount(0);
  await context.close();
});

async function carryPage(browser: import("@playwright/test").Browser, withMarker: boolean) {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: true });
  if (withMarker) {
    // Seeded once per tab: a later reload (service worker takeover) must not re-create it.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("medpruef_public_plan_pending", JSON.stringify({ marker: "kmp_innsbruck|2027-02-03|46", expires: Date.now() + 600_000 }));
    });
  }
  const patches: string[] = [];
  const onboarding: string[] = [];
  await page.route("**/api/user/exam-preference*", (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postData() ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, persisted: true }) });
    }
    return route.fallback();
  });
  await page.route("**/api/user/onboarding-complete*", (route) => {
    onboarding.push(route.request().postData() ?? "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto("/study-plan?plan_exam=kmp_innsbruck&plan_date=2027-02-03&plan_goal=46&from=lernplan", { waitUntil: "networkidle" });
  return { context, page, errors, patches, onboarding };
}

test("a signed-in learner without a date gets the plan from the save CTA applied once", async ({ browser }) => {
  const { context, page, errors, patches, onboarding } = await carryPage(browser, true);
  await expect.poll(() => patches.length, { timeout: 15_000 }).toBe(1);
  expect(JSON.parse(patches[0])).toEqual({ activeExam: "kmp_innsbruck", examDate: "2027-02-03", dailyGoal: 46 });
  await expect.poll(() => onboarding.length).toBe(1);
  await expect.poll(() => new URL(page.url()).search).toBe("");
  expect(await page.evaluate((id) => localStorage.getItem(`medpruef_plan_prompt:${id}`), USER_ID)).toBe("lernplan");
  expect(await page.evaluate(() => localStorage.getItem("medpruef_public_plan_pending"))).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});

test("a crafted link without the CTA marker asks first and writes nothing", async ({ browser }) => {
  const { context, page, errors, patches } = await carryPage(browser, false);
  const card = page.getByTestId("plan-carry");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Stichprobentest (Innsbruck)");
  expect(patches).toEqual([]);
  await shot(page, "carry-confirm-375-de-light");
  await card.getByRole("button", { name: "Bisherigen Plan behalten" }).click();
  await expect(card).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(patches).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test("the page is a 404 while the flag is off", async ({ request }) => {
  const off = process.env.A35_FLAG_OFF_URL;
  test.skip(!off, "A35_FLAG_OFF_URL not set");
  const res = await request.get(`${off}/lernplan?bank=kmp_innsbruck&sitting=2027-02-03&hours=8`);
  expect(res.status()).toBe(404);
  const map = await request.get(`${off}/sitemap.xml`);
  expect(await map.text()).not.toContain("/lernplan");
});
