#!/usr/bin/env node
/**
 * Lighthouse CI script — sprint §1.5.
 *
 * Runs Lighthouse against `/` and `/pricing` with 4G throttling and
 * asserts the sprint's perf budget:
 *
 *   LCP ≤ 2.5s
 *   CLS ≤ 0.1
 *   Total JS bundle for /  ≤ 200 KB gzipped
 *
 * Usage:
 *   npm install --save-dev lighthouse chrome-launcher
 *   node scripts/lighthouse-ci.mjs
 *   # Override base URL for a Vercel preview:
 *   BASE_URL=https://preview-a98d91.vercel.app node scripts/lighthouse-ci.mjs
 *
 * Why it's a standalone script rather than wired into CI:
 *
 *   - Lighthouse is ~400 MB of chrome headless dependencies; adding
 *     it to the default devDependencies would bloat every CI run,
 *     even ones that don't touch perf. [name] installs it on-demand
 *     when he wants to audit perf.
 *   - The sprint explicitly asks for documentation, not CI wiring:
 *     "Document how to run it (`npm install --save-dev lighthouse`
 *     then `node scripts/lighthouse-ci.mjs`). Don't wire CI."
 *
 * Exits 0 on all budgets met, 1 on any budget breach. Prints a table
 * showing each metric + budget + result.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ROUTES = ["/", "/pricing"];

const BUDGETS = {
  lcp_ms: { label: "LCP (4G)", max: 2500, route: "all" },
  cls: { label: "CLS", max: 0.1, route: "all" },
  js_kb: { label: "Total JS (gzipped)", max: 200, route: "/" },
};

async function run() {
  let lighthouse;
  let chromeLauncher;
  try {
    lighthouse = (await import("lighthouse")).default;
    chromeLauncher = await import("chrome-launcher");
  } catch {
    console.error(
      "Lighthouse not installed. Run: npm install --save-dev lighthouse chrome-launcher",
    );
    process.exit(2);
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });

  const config = {
    extends: "lighthouse:default",
    settings: {
      onlyCategories: ["performance"],
      throttlingMethod: "simulate",
      throttling: {
        rttMs: 150,
        throughputKbps: 1638.4, // ~4G
        cpuSlowdownMultiplier: 4,
      },
      formFactor: "mobile",
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        disabled: false,
      },
    },
  };

  const opts = { port: chrome.port, logLevel: "error", output: "json" };
  let failed = false;
  const rows = [];

  try {
    for (const route of ROUTES) {
      const url = new URL(route, BASE_URL).toString();
      console.log(`\n→ Auditing ${url}`);
      const runnerResult = await lighthouse(url, opts, config);
      const lhr = runnerResult.lhr;

      const lcp = lhr.audits["largest-contentful-paint"]?.numericValue ?? NaN;
      const cls = lhr.audits["cumulative-layout-shift"]?.numericValue ?? NaN;

      // `total-byte-weight` reports network bytes sent over the wire,
      // which is a close proxy for gzipped size. We filter to JS only
      // via resource-summary.
      const resourceSummary =
        lhr.audits["resource-summary"]?.details?.items ?? [];
      const jsBytes =
        resourceSummary.find((i) => i.resourceType === "script")
          ?.transferSize ?? 0;
      const jsKb = Math.round(jsBytes / 1024);

      const lcpOk = !Number.isNaN(lcp) && lcp <= BUDGETS.lcp_ms.max;
      const clsOk = !Number.isNaN(cls) && cls <= BUDGETS.cls.max;
      const jsOk =
        BUDGETS.js_kb.route === route ? jsKb <= BUDGETS.js_kb.max : true;

      if (!lcpOk || !clsOk || !jsOk) failed = true;

      rows.push({
        route,
        lcp_ms: Math.round(lcp),
        lcp_ok: lcpOk,
        cls: Math.round(cls * 1000) / 1000,
        cls_ok: clsOk,
        js_kb: jsKb,
        js_ok: jsOk,
      });
    }
  } finally {
    await chrome.kill();
  }

  console.log("\n── Lighthouse perf budget ──────────────────────────────\n");
  console.log(
    "route".padEnd(10),
    "LCP(ms)".padEnd(10),
    "CLS".padEnd(8),
    "JS(kb)".padEnd(8),
    "status",
  );
  for (const r of rows) {
    const status = r.lcp_ok && r.cls_ok && r.js_ok ? "OK" : "BUDGET BREACH";
    console.log(
      r.route.padEnd(10),
      `${r.lcp_ms}`.padEnd(10),
      `${r.cls}`.padEnd(8),
      `${r.js_kb}`.padEnd(8),
      status,
    );
  }
  console.log("\nBudget targets:");
  console.log(`  LCP ≤ ${BUDGETS.lcp_ms.max}ms  (all routes)`);
  console.log(`  CLS ≤ ${BUDGETS.cls.max}  (all routes)`);
  console.log(
    `  Total JS ≤ ${BUDGETS.js_kb.max}KB gzipped  (route: ${BUDGETS.js_kb.route})`,
  );

  if (failed) {
    console.error("\nOne or more perf budgets breached. Exiting 1.");
    process.exit(1);
  }
  console.log("\nAll perf budgets met.");
}

run().catch((err) => {
  console.error("Lighthouse run failed:", err);
  process.exit(2);
});
