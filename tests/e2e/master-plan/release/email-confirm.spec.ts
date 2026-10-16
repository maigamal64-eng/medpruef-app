import { createHash, createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, USER_ID, type Variant } from "./release-harness";

/**
 * a-email-confirm-trial smoke. Home line: shows only when /api/auth/me says
 * email_confirm and /api/email-confirm says pending, carries the Lektor copy,
 * and "send again" shows the sent note. Confirmation page: GET shows only a
 * button (nothing is written), the button POSTs and lands on a result page.
 * The page tests need the server started with EMAIL_CONFIRM_ENABLED=true and
 * REMINDER_LINK_SIGNING_SECRET equal to EMAIL_CONFIRM_SMOKE_SECRET; with the
 * flag off the page must answer 404. Local server only (release-harness).
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const SECRET = process.env.EMAIL_CONFIRM_SMOKE_SECRET ?? "";
const CONFIRM_UID = "00000000-0000-4000-8000-0000000ec001";

/** Same shape as src/lib/email-confirm/token.ts (ec1, purpose inside the MAC). */
function sign(userId: string, email: string, expSeconds: number): string {
  const ek = createHash("sha256").update(`email-confirm:${email.trim().toLowerCase()}`).digest("hex");
  const payload = Buffer.from(JSON.stringify({ v: 1, p: "email-confirm", u: userId, ek, exp: expSeconds })).toString("base64url");
  return `ec1.${payload}.${createHmac("sha256", SECRET).update(`ec1.email-confirm.${payload}`).digest("base64url")}`;
}

async function homeRoutes(page: Page, status: unknown) {
  await page.route("**/api/email-confirm", (r) => r.request().method() === "POST"
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sent: true, email: "release@example.invalid" }) })
    : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status) }));
  await page.route("**/api/auth/me*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: USER_ID, tier: "free", tier_expires_at: null, role: "user", email_status: null, language_code: null, onboarding_completed_at: "2026-10-01T00:00:00Z", email_confirm: true }, fetched_at: new Date().toISOString() }) }));
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`Home line and resend ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await homeRoutes(page, { enabled: true, pending: true, email: "release@example.invalid", trial: true, sent: true });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const line = page.locator("[data-email-confirm-line]");
    await expect(line).toBeVisible({ timeout: 25_000 });
    await expect(line).toContainText(v.lang === "de" ? "damit Ihr kostenloser Testzeitraum" : "so your trial with full access can start");
    const button = line.getByRole("button", { name: v.lang === "de" ? "Link erneut senden" : "Send link again" });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    await button.click();
    await expect(line).toContainText(v.lang === "de" ? "Gesendet an release@example.invalid" : "Sent to release@example.invalid");
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/email-confirm/home-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`confirmed account: no Home line ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free", onboarded: true });
    await homeRoutes(page, { enabled: true, pending: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    await expect(page.locator("[data-email-confirm-line]")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`confirmation page GET then POST ${tag(v)}`, async ({ page, request }) => {
    const probe = await request.get("/confirm-email?t=x");
    if (!SECRET) {
      expect(probe.status(), "flag off or no secret: the page is a 404").toBe(404);
      return;
    }
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.emulateMedia({ colorScheme: v.dark ? "dark" : "light" });
    const errors = trackErrors(page);
    const token = sign(CONFIRM_UID, "confirm@example.invalid", Math.floor(Date.now() / 1000) + 3600);
    const res = await page.goto(`/confirm-email?t=${encodeURIComponent(token)}&lang=${v.lang}`);
    expect(res?.status()).toBe(200);
    const button = page.getByRole("button", { name: v.lang === "de" ? "E-Mail-Adresse bestätigen" : "Confirm email address" });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43);
    let m = await measure(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await page.screenshot({ path: `${EVIDENCE}/email-confirm/page-form-${tag(v)}.png` });
    await button.click();
    await expect(page.getByRole("status")).toContainText(v.lang === "de" ? "Ihre E-Mail-Adresse ist bestätigt." : "Your email address is confirmed.");
    m = await measure(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await page.screenshot({ path: `${EVIDENCE}/email-confirm/page-done-${tag(v)}.png` });
    const expired = await page.goto(`/confirm-email?t=${encodeURIComponent(sign(CONFIRM_UID, "confirm@example.invalid", Math.floor(Date.now() / 1000) - 10))}&lang=${v.lang}`);
    expect(expired?.status()).toBe(410);
    await expect(page.locator("form")).toHaveCount(0);
    // The expired link answers 410 on purpose; the browser logs that document status.
    expect(errors.filter((e) => !/favicon|Content Security Policy|status of 410/i.test(e)), "console errors").toEqual([]);
  });
}
