import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium', serviceWorkers: 'block' });
for (const width of [320, 375, 390, 430, 1440]) {
  for (const lang of ['de', 'en'] as const) {
    test(`${lang} Ukrainian article fits ${width}px without clipping text or table`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      const origin = new URL(baseURL!).origin;
      await context.addInitScript(l => localStorage.setItem('medpruef-lang', l), lang);
      await context.route('**/*', route => {
        const req = route.request();
        const url = new URL(req.url());
        return ['GET', 'HEAD'].includes(req.method()) && url.origin === origin && !url.pathname.startsWith('/api/')
          ? route.continue() : route.abort();
      });
      await page.goto('/blog/ukrainian-refugee-physicians-austria', { waitUntil: 'networkidle' });
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toHaveText(lang === 'de'
        ? 'Ukrainische Flüchtlingsärzt:innen: Arztpraxis in Österreich'
        : 'How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide');
      const sizes = await page.evaluate(() => {
        const h1 = document.querySelector('h1')!;
        return { page: document.documentElement.scrollWidth, viewport: innerWidth, heading: h1.scrollWidth, headingBox: h1.clientWidth };
      });
      expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
      expect(sizes.heading).toBeLessThanOrEqual(sizes.headingBox + 1);
      await expect(page.getByRole('link', { name: lang === 'de' ? 'Zurück zum Blog' : 'Back to blog', exact: true })).toHaveAttribute('href', '/blog');
      // Preserve the article's scrollable data table, rather than hiding overflow.
      const table = page.locator('article table');
      await expect(table.getByRole('columnheader', { name: 'Timeline', exact: true })).toBeAttached();
      const tableScroll = await table.evaluate(node => {
        const container = node.parentElement!;
        container.scrollLeft = container.scrollWidth;
        return { overflow: getComputedStyle(container).overflowX, available: container.scrollWidth > container.clientWidth, moved: container.scrollLeft > 0 };
      });
      if (width < 768) {
        expect(tableScroll.overflow).toBe('auto');
        expect(tableScroll.available).toBe(true);
        expect(tableScroll.moved).toBe(true);
      }
    });
  }
}
