import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { assertStandIn, measure, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-sitting-one-tap: the page behind the one-tap sitting link on a local build
 * started with SITTING_LINK_ENABLED=true and REMINDER_LINK_SIGNING_SECRET set
 * (the same value is given to this run). The stand-in serves the synthetic
 * account; flags of pricing v2 and the claim are off, so no offer shows.
 * One synthetic account: the route allows 10 saves per account in 10 minutes
 * per server instance, so --repeat-each needs a server restart in between.
 */
const SECRET = process.env.REMINDER_LINK_SIGNING_SECRET ?? "";
const UID = "00000000-0000-4000-8000-000000517710";

function token(source?: "day1"): string {
  const iat = Math.floor(Date.now() / 1000) - 60;
  const payload = Buffer.from(JSON.stringify({ v: 1, p: "sitting-link", u: UID, ek: null, iat, exp: iat + 7 * 86_400, ...(source ? { s: source } : {}) })).toString("base64url");
  return `sl1.${payload}.${createHmac("sha256", SECRET).update(`sl1.sitting-link.${payload}`).digest("base64url")}`;
}

const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);

test.beforeAll(async ({ request }) => {
  if (SECRET.length < 32) throw new Error("REMINDER_LINK_SIGNING_SECRET (at least 32 bytes) must equal the server's");
  await assertStandIn(request);
});
test.describe.configure({ mode: "parallel" });

for (const v of VARIANTS) {
  test(`sitting link choose and save (${tag(v)})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: v.dark ? "dark" : "light" });
    const errors = trackErrors(page);
    const res = await page.goto(`/api/sitting-link?t=${encodeURIComponent(token())}&lang=${v.lang}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(v.lang === "de" ? "Ihr Prüfungstermin" : "Your exam sitting");
    await expect(page.getByText(v.lang === "de" ? "Einreichungsfrist laut MedUni Wien Merkblatt" : "Filing cutoff", { exact: false }).first()).toBeVisible();
    const radios = page.getByRole("radio");
    expect(await radios.count()).toBeGreaterThan(3);
    for (const label of await page.locator("label.opt").all()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    const m = await measure(page);
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/sitting-link-form-${tag(v)}.png`, fullPage: true });
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);

    await radios.first().check();
    await page.getByRole("button", { name: v.lang === "de" ? "Termin speichern" : "Save sitting" }).click();
    await expect(page.getByRole("status")).toContainText(v.lang === "de" ? "Gespeichert:" : "Saved:");
    await expect(page.getByText(v.lang === "de" ? /Bis zu Ihrem Termin|Ihr Termin ist heute/ : /to go until your sitting|Your sitting is today/)).toBeVisible();
    await expect(page.getByRole("link", { name: v.lang === "de" ? "Zu Ihrem Lernplan" : "Go to your study plan" })).toBeVisible();
    await expect(page.getByText(/€|Tarif|plan that covers/)).toHaveCount(0);
    const m2 = await measure(page);
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/sitting-link-saved-${tag(v)}.png`, fullPage: true });
    expect(m2.scrollWidth, `no horizontal overflow: ${m2.offenders.join(", ")}`).toBeLessThanOrEqual(m2.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("forged link and GET-only scanner never write", async ({ request }) => {
  const bad = await request.get("/api/sitting-link?t=sl1.x.y&lang=de");
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain("nicht gültig");
  const scan = await request.get(`/api/sitting-link?t=${encodeURIComponent(token())}&lang=en`);
  expect(scan.status()).toBe(200);
  expect(scan.headers()["cache-control"]).toBe("no-store");
  expect(scan.headers()["content-security-policy"]).toContain("default-src 'none'");
});

// a-day1-sitting-ask: the link in the day-1 mail carries a signed source claim; the page is the same one.
for (const width of [375, 1280]) {
  test(`day1 mail link opens, saves and does not overflow (${width})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width < 800 ? 812 : 900 } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    const res = await page.goto(`/api/sitting-link?t=${encodeURIComponent(token("day1"))}&lang=de`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ihr Prüfungstermin");
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal overflow: ${m.offenders.join(", ")}`).toBeLessThanOrEqual(m.innerWidth);
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/day1-link-form-${width}.png`, fullPage: true });
    await page.getByRole("radio").first().check();
    await page.getByRole("button", { name: "Termin speichern" }).click();
    await expect(page.getByRole("status")).toContainText("Gespeichert:");
    const m2 = await measure(page);
    expect(m2.scrollWidth, `no horizontal overflow: ${m2.offenders.join(", ")}`).toBeLessThanOrEqual(m2.innerWidth);
    expect(errors).toEqual([]);
    await context.close();
  });
}
