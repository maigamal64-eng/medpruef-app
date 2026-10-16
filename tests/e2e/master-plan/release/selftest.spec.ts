import { expect, test, type Page, type Route } from "@playwright/test";
import { BASE, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-public-selftest: /selbsttest end to end on a local build (stand-in
 * Supabase, server and build with PUBLIC_SELFTEST_ENABLED=true). The question
 * read is a synthetic fixture: bank choice, timed run with a multi-answer
 * item, result by field, official sitting, then "Ergebnis und Plan speichern"
 * opens the signup with intent selftest and the record waits in this browser.
 * When A35_FLAG_OFF_URL names a second server without the flag, /selbsttest
 * there must be a 404.
 */
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
const EVIDENCE = process.env.A35_EVIDENCE_DIR;
const FIELDS = ["Neurologie", "Augenheilkunde", "Dermatologie und Venerologie"];

function payload(bank: string) {
  return {
    bank, version: "st1-fixture", durationS: 900,
    items: Array.from({ length: 10 }, (_, i) => ({
      id: 990001 + i, field: FIELDS[i % FIELDS.length],
      question: `Synthetische Übungsfrage ${i + 1}: Welche Aussage trifft bei diesem langen klinischen Fallbeispiel mit Laborwerten am ehesten zu?`,
      options: ["Antwort A", "Antwort B", "Antwort C", "Antwort D", "Antwort E"].map((text, j) => ({ text, correct: i === 1 ? j < 2 : j === 0 })),
      required: i === 1 ? 2 : 1,
      keyFingerprint: `k1:${String(i).repeat(64).slice(0, 64)}`,
    })),
  };
}

async function routeSelftest(page: Page) {
  await page.route("**/api/selftest?*", (route: Route) => {
    const bank = new URL(route.request().url()).searchParams.get("bank") ?? "kmp_innsbruck";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload(bank)) });
  });
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/selftest/${name}.png`, fullPage: true });
}

async function fits(page: Page) {
  const m = await measure(page);
  expect(m.scrollWidth, m.offenders.join(", ")).toBeLessThanOrEqual(m.innerWidth);
  expect(m.fixedInFlow).toEqual([]);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`self-check run, result, sitting and save (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await routeSelftest(page);
    const funnel: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/funnel-events")) funnel.push(r.postData() ?? ""); });

    const res = await page.goto(`/selbsttest?lang=${v.lang}&from=landing`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(v.lang === "de" ? "10 Übungsfragen auf Zeit" : "10 timed practice questions");
    await expect(page.getByTestId("selftest-scope")).toContainText(v.lang === "de" ? "keine offiziellen Prüfungsfragen" : "not official exam questions");
    await fits(page);
    await shot(page, `intro-${tag(v)}`);

    await page.getByTestId("selftest-bank-kmp_innsbruck").check();
    await page.getByTestId("selftest-start").click();
    await expect(page.getByTestId("selftest-run")).toBeVisible();
    await expect(page.getByTestId("selftest-timer")).toContainText(/1[45]:\d\d/);
    await fits(page);
    await shot(page, `run-${tag(v)}`);

    for (let i = 0; i < 10; i++) {
      const options = page.getByTestId("selftest-run").locator("article [role=group] > *");
      await options.nth(0).click();
      if (i === 1) await options.nth(1).click();
      if (i < 9) await page.getByTestId("selftest-next").click();
    }
    await page.getByTestId("selftest-finish").click();
    await expect(page.getByTestId("selftest-result")).toBeVisible();
    await expect(page.getByTestId("selftest-fields").locator("li")).toHaveCount(3);
    const resultText = await page.getByTestId("selftest-result").innerText();
    expect(resultText).not.toMatch(/[–—]/);
    expect(resultText).not.toMatch(/bestanden|you passed|€/i);
    await page.getByTestId("selftest-review-toggle").click();
    await expect(page.getByTestId("selftest-review")).toBeVisible();

    const sitting = page.getByTestId("selftest-sitting");
    await expect(sitting.getByRole("heading")).toHaveText(v.lang === "de" ? "Für welchen Termin lernen Sie?" : "Which sitting are you studying for?");
    const radios = sitting.getByRole("radio");
    expect(await radios.count()).toBeGreaterThan(1);
    await radios.first().click();
    await fits(page);
    await shot(page, `result-${tag(v)}`);

    const cta = page.getByTestId("selftest-save-cta");
    const url = new URL((await cta.getAttribute("href")) ?? "", BASE);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("intent")).toBe("selftest");
    expect(url.searchParams.get("exam")).toBe("kmp_innsbruck");
    expect(url.searchParams.get("next")).toBe("/study-plan");
    await cta.click();
    await page.waitForURL(/\/login\?/);
    await expect(page.getByTestId("login-selftest-line")).toBeVisible();
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("medpruef_selftest_pending_v1") ?? "null"));
    expect(pending.bank).toBe("kmp_innsbruck");
    expect(pending.sitting).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pending.answers).toHaveLength(10);

    const sent = funnel.join("\n");
    for (const e of ["selftest_start", "selftest_finish", "selftest_register_click"]) expect(sent).toContain(e);
    expect(sent).toMatch(/"bucket":"(0-3|4-6|7-8|9-10)"/);
    expect(sent).not.toMatch(/"correct"|"score"/);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("the landing hero and the Stichprobentest page link the self-check", async ({ browser }) => {
  const v: Variant = { width: 375, height: 812, lang: "de", dark: false };
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: false });
  await page.goto("/landing", { waitUntil: "networkidle" });
  await expect(page.getByTestId("selftest-entry").first()).toHaveAttribute("href", /\/selbsttest\?.*from=landing/);
  await fits(page);
  await page.goto("/stichprobentest", { waitUntil: "networkidle" });
  await expect(page.getByTestId("selftest-entry").first()).toHaveAttribute("href", "/selbsttest?bank=kmp_innsbruck&from=stichprobentest");
  await fits(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("the self-check is a 404 on a server without the flag", async ({ request }) => {
  const off = process.env.A35_FLAG_OFF_URL;
  test.skip(!off, "A35_FLAG_OFF_URL not set");
  expect((await request.get(`${off}/selbsttest`)).status()).toBe(404);
  expect((await request.get(`${off}/api/selftest?bank=kmp_innsbruck`)).status()).toBe(404);
});
