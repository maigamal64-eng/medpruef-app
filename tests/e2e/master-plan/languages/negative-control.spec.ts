/**
 * Negative control: the detector must flag a planted English sentence on a
 * German page, a planted German sentence on an English page, and a planted
 * English fallback on an Arabic page, and must pass clean pages and allowlisted
 * exam terms. No network: pages are built with setContent.
 */
import { expect, test } from "@playwright/test";
import { findLeaks } from "../../../../scripts/master-language/detect.mjs";

const ALLOW = ["Kenntnisprüfung"];
async function visibleText(page: import("@playwright/test").Page, html: string) {
  await page.setContent(html);
  return page.evaluate(() => document.body.innerText);
}

test("flags English on a German page", async ({ page }) => {
  const t = await visibleText(page, `<html lang="de"><body><h1>Üben starten</h1><p>Start your free practice session and see your progress.</p></body></html>`);
  const leaks = findLeaks(t, "de", ALLOW);
  expect(leaks.length).toBeGreaterThan(0);
  expect(leaks[0].detected).toBe("en");
});

test("flags German on an English page", async ({ page }) => {
  const t = await visibleText(page, `<html lang="en"><body><p>Starte jetzt deine Vorbereitung und sieh deinen Fortschritt.</p></body></html>`);
  expect(findLeaks(t, "en", ALLOW).length).toBeGreaterThan(0);
});

test("flags a Latin English fallback on an Arabic page", async ({ page }) => {
  const t = await visibleText(page, `<html lang="ar" dir="rtl"><body><p>You can choose your specialty and start with the free questions.</p></body></html>`);
  expect(findLeaks(t, "ar", ALLOW).length).toBeGreaterThan(0);
});

test("passes clean pages and allowlisted exam terms", async ({ page }) => {
  const de = await visibleText(page, `<html lang="de"><body><p>Bereite dich auf die Kenntnisprüfung in Wien vor.</p><p>Kenntnisprüfung Wien</p></body></html>`);
  expect(findLeaks(de, "de", ALLOW)).toEqual([]);
  const en = await visibleText(page, `<html lang="en"><body><p>Prepare for the Austrian Kenntnisprüfung in Vienna with free questions.</p></body></html>`);
  expect(findLeaks(en, "en", ALLOW)).toEqual([]);
});

test("an allowlisted term does not hide an English sentence around it", async ({ page }) => {
  const t = await visibleText(page, `<html lang="de"><body><p>Start your free Kenntnisprüfung practice session and see your progress.</p></body></html>`);
  expect(findLeaks(t, "de", ALLOW).length).toBeGreaterThan(0);
});
