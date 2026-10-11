import { expect, test } from "@playwright/test";

test.use({ browserName: "chromium", serviceWorkers: "block", viewport: { width: 320, height: 720 } });

for (const lang of ["de", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${lang} ${theme}: SIP deadline wraps at 320 px with AA dark text`, async ({ page, context, baseURL }) => {
      await page.clock.install({ time: new Date("2026-10-11T12:00:00Z") });
      await context.addInitScript(({ lang, theme }) => {
        localStorage.setItem("medpruef-lang", lang);
        localStorage.setItem("medpruef_theme", theme);
      }, { lang, theme });
      // This proof has no external calls, analytics writes or customer data.
      const origin = new URL(baseURL!).origin;
      await context.route("**/*", (route) => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) return route.abort();
        return route.continue();
      });
      for (const path of ["/landing", "/pricing"]) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const card = page.locator("article").filter({ has: page.getByRole("heading", { name: /SIP/ }) });
        const badge = card.locator("dd").filter({ hasText: /Anmeldung bis|Register by/ });
        await expect(badge).toHaveText(lang === "de" ? "Anmeldung bis 19. Okt., noch 8 Tage" : "Register by 19 Oct, 8 days left");
        await badge.scrollIntoViewIfNeeded();
        await expect(badge).toBeVisible();
        const metrics = await badge.evaluate((element) => {
          const style = getComputedStyle(element);
          const label = element.querySelector("span")!;
          const rect = element.getBoundingClientRect();
          const labelStyle = getComputedStyle(label);
          // Canvas resolves CSS color-mix to sRGB for WCAG contrast math.
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          const luminance = (color: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const channels = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map((byte) => {
              const value = byte / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const fg = luminance(style.color);
          const bg = luminance(style.backgroundColor);
          return {
            contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
            fg,
            left: rect.left,
            right: rect.right,
            overflow: label.scrollWidth > label.clientWidth,
            wraps: label.getBoundingClientRect().height > parseFloat(labelStyle.lineHeight) * 1.5,
            whiteSpace: labelStyle.whiteSpace,
          };
        });
        expect(metrics.contrast).toBeGreaterThanOrEqual(4.5);
        expect(metrics.fg).toBeLessThan(0.1); // Dark foreground in both themes.
        expect(metrics.left).toBeGreaterThanOrEqual(0);
        expect(metrics.right).toBeLessThanOrEqual(320);
        expect(metrics.overflow).toBe(false);
        // The German label wraps at 320 px; the shorter English one fits on one line.
        if (lang === "de") expect(metrics.wraps).toBe(true);
        expect(metrics.whiteSpace).toBe("normal");
      }
    });
  }
}

test("SIP badge advances while the page stays open across Vienna midnight", async ({ page, context, baseURL }) => {
  await page.clock.install({ time: new Date("2026-10-19T21:59:00Z") });
  await page.addInitScript(() => localStorage.setItem("medpruef-lang", "en"));
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin || !["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  });
  await page.goto("/landing", { waitUntil: "domcontentloaded" });
  const badge = page.locator("#exam-calendar dd").filter({ hasText: /^Register by/ });
  await expect(badge).toHaveText("Register by 19 Oct, today is the last day");
  await page.clock.runFor(60_000);
  // The next window (4 to 18 Jan) has not opened: no countdown, the card shows the window.
  await expect(badge).toHaveCount(0);
  const card = page.locator("#exam-calendar article").filter({ has: page.getByRole("heading", { name: /SIP/ }) });
  await expect(card).toContainText("18 January 2027");
  await expect(card).not.toContainText("19 Oct");
});
