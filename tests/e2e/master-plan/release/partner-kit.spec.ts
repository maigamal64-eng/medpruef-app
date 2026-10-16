import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-partner-kit: /kooperation and the organiser report of a local build started
 * with PARTNER_KIT_ENABLED=true, PARTNER_CODES=TG-SPT and
 * REMINDER_LINK_SIGNING_SECRET=<40 x "k"> (the secret below). Synthetic
 * session, stand-in Supabase (every table empty), local server only.
 */
const SECRET = process.env.PK_E2E_SECRET ?? "k".repeat(40);
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);

function token(code: string, days = 10): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose: "partner-report", code, exp: Math.floor(Date.now() / 1000) + days * 86400 })).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", SECRET).update(`v1.${payload}`).digest("base64url")}`;
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`kooperation page and request (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    const events: string[] = [];
    await page.route("**/api/funnel-events", async (route) => { events.push(route.request().postData() ?? ""); await route.fulfill({ status: 204 }); });
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/support/contact", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true }) });
      sent = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.goto(`/kooperation?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("partner-page").waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(v.lang === "de" ? "MedPrüf für Ihre Lerngruppe" : "MedPrüf for your study group");
    await expect(page.getByTestId("partner-privacy")).toContainText(v.lang === "de" ? "Zahlen unter 5 zeigen wir nicht an" : "We do not show numbers below 5");
    await expect(page.locator("main")).not.toContainText(/€|EUR|MedUni|Medizinische Universität/);
    await expect(page.getByTestId("partner-lang")).toHaveText(v.lang === "de" ? "English" : "Deutsch");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => events.some((e) => e.includes('"partner_page_view"') && e.includes(`"surface":"${v.lang}"`))).toBe(true);
    // The request goes through the contact route with topic partner.
    const form = page.getByTestId("partner-request");
    await form.getByRole("textbox", { name: /E-Mail|email/i }).fill("organiser@verein.example");
    await form.getByRole("textbox", { name: /Nachricht|message/i }).fill("Wir begleiten etwa 30 Ärztinnen und Ärzte in Wien.");
    await form.getByRole("button", { name: /Nachricht senden|Send message/ }).click();
    await expect.poll(() => sent?.topic).toBe("partner");
    await expect.poll(() => events.some((e) => e.includes('"partner_request_sent"'))).toBe(true);
    const m = await measure(page);
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/partner-page-${tag(v)}.png`, fullPage: true });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(m.fixedInFlow).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`organiser report (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto(`/kooperation/bericht?lang=${v.lang}&t=${token("TG-SPT")}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("partner-report").waitFor({ state: "visible", timeout: 25_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(v.lang === "de" ? "Übersicht für den Code TG-SPT" : "Overview for code TG-SPT");
    // The stand-in holds no redemptions: every count is under the small-cell floor.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const small = v.lang === "de" ? "unter 5" : "under 5";
    await expect(page.getByTestId("partner-metric")).toHaveText([small, small, small]);
    await expect(page.getByTestId("partner-report")).not.toContainText(/@|user_id|[0-9a-f]{8}-[0-9a-f]{4}-/);
    const m = await measure(page);
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/partner-report-${tag(v)}.png` });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("report links: forged, expired, other code and missing all read the same neutral line", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const bad = [token("OTHER-CODE"), token("TG-SPT", -1), `${token("TG-SPT").slice(0, -3)}abc`, "nope", ""];
  for (const t of bad) {
    const res = await page.goto(`/kooperation/bericht${t ? `?t=${encodeURIComponent(t)}` : ""}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("partner-report-invalid")).toContainText("Dieser Link ist nicht gültig oder abgelaufen.");
    await expect(page.getByTestId("partner-report")).toHaveCount(0);
  }
  await context.close();
});
