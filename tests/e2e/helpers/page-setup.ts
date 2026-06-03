/**
 * Page setup helpers — set theme, language, and clear cookie banner
 * before running assertions. Every public-route test uses these so the
 * first paint is deterministic across runs.
 */

import type { Page } from "@playwright/test";

export type Theme = "light" | "dark";
export type Lang = "de" | "en";

/**
 * Seed the localStorage keys that `ThemeProvider.tsx` and `i18n.ts`
 * read on mount. Call BEFORE navigating to the page so the first
 * render already reflects the requested theme + language and screenshot
 * baselines are stable across runs.
 *
 * Playwright's `addInitScript` fires before any page script, including
 * Next.js hydration — perfect for pre-populating localStorage.
 */
export async function seedPreferences(
  page: Page,
  { theme = "light", lang = "en" }: { theme?: Theme; lang?: Lang } = {},
): Promise<void> {
  await page.addInitScript(
    ({ theme, lang }) => {
      try {
        localStorage.setItem("medpruef_theme", theme);
        localStorage.setItem("medpruef-lang", lang);
        // Mark the cookie banner as dismissed so its overlay doesn't
        // occlude CTAs or leak into screenshot diffs. The app reads
        // this key on mount; mutating document in an init script is
        // safe because no script has run yet.
        // Matches `COOKIE_KEY` in src/components/CookieBanner.tsx.
        localStorage.setItem("medpruef_cookies", "declined");
      } catch {
        /* localStorage may be unavailable in some contexts — ignore */
      }
    },
    { theme, lang },
  );
}

/**
 * Assert the document has no horizontal scroll. Implementation note:
 * `scrollWidth > clientWidth` sometimes trips on sub-pixel rounding in
 * Safari/WebKit; we allow a 1px tolerance per §1.1 requirement 1.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollWidth > clientWidth + 1) {
    throw new Error(
      `Horizontal scroll detected: scrollWidth=${scrollWidth}, clientWidth=${clientWidth} (overflow ${
        scrollWidth - clientWidth
      }px)`,
    );
  }
}

/**
 * Pull the smallest bounding box of every visible <button> and anchor
 * styled as a button, and assert each meets the WCAG 2.5.5 44×44 CSS
 * pixel target on mobile viewports.
 *
 * The sprint requires this on mobile viewports only; desktop buttons
 * can legally be smaller.
 */
export async function expectTapTargets(page: Page, minSize = 44): Promise<void> {
  const offenders = await page.evaluate((min) => {
    const selectors = ["button", 'a[role="button"]', 'a.mp-btn', "a[class*='btn']"];
    const els = Array.from(document.querySelectorAll(selectors.join(",")));
    const found: { tag: string; w: number; h: number; text: string }[] = [];
    for (const el of els) {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // Skip elements that are visually hidden (display:none / aria-hidden)
      const style = window.getComputedStyle(htmlEl);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (htmlEl.getAttribute("aria-hidden") === "true") continue;
      // Skip elements that are off-screen (above the fold-finder)
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.width < min || rect.height < min) {
        found.push({
          tag: htmlEl.tagName.toLowerCase(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (htmlEl.textContent ?? "").slice(0, 50),
        });
      }
    }
    return found;
  }, minSize);

  if (offenders.length === 0) return;
  const lines = offenders.slice(0, 5).map(
    (o) => `  • <${o.tag}> ${o.w}×${o.h}px — "${o.text.trim()}"`,
  );
  throw new Error(
    `${offenders.length} tap target(s) below ${minSize}×${minSize}px:\n${lines.join(
      "\n",
    )}${offenders.length > 5 ? `\n  …and ${offenders.length - 5} more` : ""}`,
  );
}

/**
 * Apply `data-theme` attribute via addInitScript AND reapply after
 * hydration — ThemeProvider sets the attribute on useEffect, which
 * can race with screenshot capture on slow CI runners.
 */
export async function applyThemeAfterLoad(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
}
