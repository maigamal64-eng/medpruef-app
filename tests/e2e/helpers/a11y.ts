/**
 * Axe-core helper for Playwright tests.
 *
 * Wraps AxeBuilder from @axe-core/playwright with:
 *   - WCAG 2.0 A/AA + 2.1 A/AA tagset (matches sprint §1.3).
 *   - A documented exclusion list for known false-positives.
 *   - A formatter that surfaces rule id, selector, and help URL so a
 *     failing assertion is actionable without digging through axe JSON.
 *
 * Usage:
 *   import { runAxe, assertNoSeriousOrCriticalViolations } from "../helpers/a11y";
 *   const result = await runAxe(page);
 *   assertNoSeriousOrCriticalViolations(result, "home-route-light");
 */

import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AxeResults, Result as AxeResult } from "axe-core";

/**
 * Axe tags the sprint requires. WCAG 2.0 A/AA + WCAG 2.1 A/AA — we
 * deliberately do NOT opt into "best-practice" or "experimental" here;
 * the spec calls for AA, no heuristic fluff.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Rules we disable globally. Every exclusion is documented so a future
 * reviewer can tell whether the false-positive still applies.
 */
const GLOBAL_RULE_EXCLUSIONS: string[] = [
  // `region` requires every piece of content to live inside a landmark.
  // Our layout uses fixed-position cookie banners and cohort banners
  // that axe sees as "not in a landmark"; they are, semantically, live
  // notifications, not page content. WCAG passes these via role=status
  // / role=alert already.
  "region",
  // `landmark-one-main` flags pages where the hero section is outside
  // <main>. Our landing page legitimately has a persistent <header>
  // above <main>, and the interior of <main> covers the remainder of
  // the page content. Axe mis-reports this on client-rendered pages.
  "landmark-one-main",
];

/**
 * Selectors we exclude from axe scans. These are fixed-position
 * overlays whose contrast is measured against whatever happens to be
 * behind them after scrolling; axe can't resolve the correct stacking
 * context in a headless run and reports spurious contrast violations.
 */
const GLOBAL_SELECTOR_EXCLUSIONS: string[] = [
  // CookieBannerMount — GDPR banner, acceptable contrast verified
  // manually in both themes (post-soft-launch sprint §1.4.6 item 2).
  "[data-a11y-skip='cookie-banner']",
];

export interface RunAxeOptions {
  /** Extra rules to disable on top of the global exclusion list. */
  disableRules?: string[];
  /** Narrow the scan to a CSS selector (e.g. `main`, `[data-testid=pricing-card]`). */
  includeOnly?: string;
}

export async function runAxe(page: Page, opts: RunAxeOptions = {}): Promise<AxeResults> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);

  const disabled = [...GLOBAL_RULE_EXCLUSIONS, ...(opts.disableRules ?? [])];
  if (disabled.length) builder = builder.disableRules(disabled);

  for (const sel of GLOBAL_SELECTOR_EXCLUSIONS) {
    builder = builder.exclude(sel);
  }

  if (opts.includeOnly) {
    builder = builder.include(opts.includeOnly);
  }

  return builder.analyze();
}

/**
 * Assert that axe reported zero violations of serious or critical
 * impact. `label` is prepended to the error message so multi-route
 * loops show which page failed.
 */
export function assertNoSeriousOrCriticalViolations(
  result: AxeResults,
  label: string,
): void {
  const bad = result.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (bad.length === 0) return;

  const msg = formatViolations(bad, label);
  // Playwright expects the assertion error to throw — `expect.fail` is
  // nice but not always imported in the calling scope.
  throw new Error(msg);
}

export function formatViolations(violations: AxeResult[], label: string): string {
  const lines: string[] = [
    `[a11y:${label}] ${violations.length} serious/critical violation(s):`,
  ];
  for (const v of violations) {
    lines.push(`  • ${v.id} (${v.impact}) — ${v.help}`);
    lines.push(`    help: ${v.helpUrl}`);
    for (const node of v.nodes.slice(0, 3)) {
      const selector = Array.isArray(node.target) ? node.target.join(" >> ") : String(node.target);
      lines.push(`    at: ${selector}`);
    }
    if (v.nodes.length > 3) lines.push(`    …and ${v.nodes.length - 3} more node(s)`);
  }
  return lines.join("\n");
}
