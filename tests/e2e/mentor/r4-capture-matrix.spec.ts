import { expect, test } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { FIXTURE_ADMIN_QUALITY, FIXTURE_CHECKOUT_VERIFY, FIXTURE_EXPLAIN_ANSWERED, FIXTURE_EXPLAIN_UNANSWERED, FIXTURE_OPERATIONS, FIXTURE_PACKAGES, FIXTURE_REVIEW_QUEUE, FIXTURE_USAGE, FIXTURE_USAGE_PRO_INCLUDED } from "../../../src/lib/mentor/fixtures";
import type { MentorUsageResponse } from "../../../src/lib/mentor/contract";
// Synthetic internal QA captures only. No social reuse and no external calls.
// track-A runs this under with-heavy.sh; this sandbox cannot launch WebKit.
test.use({ browserName: "webkit", serviceWorkers: "block", video: "off" });
const U = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
for (const width of [360, 390]) for (const lang of ["de", "en", "ru", "uk", "tr", "ar"]) for (const theme of ["light", "dark"] as const) for (const zoom of [100, 200]) {
  test(`MUX-114 ${width}px ${lang} ${theme} text ${zoom}%`, async ({ page }) => {
    test.setTimeout(600000);
    await seedSession(page, { userId: U, email: "fixture@example.invalid", tier: "admin", role: "admin" });
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(({ lang, theme }) => { localStorage.setItem("medpruef-lang", lang); localStorage.setItem("medpruef_theme", theme); localStorage.setItem("medpruef_cookies", "declined"); }, { lang, theme });
    let scenario = "ok";
    let usage: MentorUsageResponse = FIXTURE_USAGE.ok;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort();
      if (url.pathname === "/api/mentor/availability") return scenario.startsWith("entry429") ? route.fulfill({ status: 429, json: { error: "rate_limited", retry_after_seconds: 30 } }) : route.fulfill({ json: { available: true, can_buy: usage.can_buy } });
      if (url.pathname === "/api/mentor/usage") return route.fulfill({ json: usage });
      if (url.pathname === "/api/mentor/packages") return route.fulfill({ json: scenario === "nopackages" ? { packages: [] } : FIXTURE_PACKAGES });
      if (url.pathname === "/api/mentor/checkout/verify") return route.fulfill({ json: FIXTURE_CHECKOUT_VERIFY[scenario === "failpay" ? "failed" : scenario === "slowpay" ? "pending" : "granted"] });
      if (url.pathname === "/api/mentor/chat/history") return route.fulfill({ json: { conversation_id: null, messages: [] } });
      if (url.pathname === "/api/mentor/chat") {
        const req = route.request().postDataJSON();
        const final = scenario === "explain-unanswered" ? FIXTURE_EXPLAIN_UNANSWERED : FIXTURE_EXPLAIN_ANSWERED;
        const events = [{ type: "status", phase: "writing" }, { ...final, request_id: req.client_request_id }];
        return route.fulfill({ contentType: "text/event-stream", body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") });
      }
      if (url.pathname === "/api/questions") return route.fulfill({ json: [{ id: 1, question: "Synthetische Beispielfrage", explanation: "Beispielerklärung", topic: "", choices: [] }] });
      if (url.pathname === "/api/mentor/admin/operations") return route.fulfill({ json: FIXTURE_OPERATIONS });
      if (url.pathname === "/api/mentor/admin/review") return route.fulfill({ json: FIXTURE_REVIEW_QUEUE });
      if (url.pathname === "/api/mentor/admin/summary") return scenario === "quality" ? route.fulfill({ json: FIXTURE_ADMIN_QUALITY }) : route.fulfill({ status: 503, json: { error: "ledger_not_applied" } });
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: U, tier: "admin", role: "admin", email_status: "valid" } } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    });
    const states = ["ok", "low", "exhausted", "pro", "nopackages", "resting", "slowpay", "failpay", "grantpay", "explain-answered", "explain-unanswered", "entry429-hidden", "entry429-retained", "breaker-composing", "facts-due", "readiness-red", "review-queue", "quality"];
    for (const state of states) {
      scenario = state;
      usage = state === "pro" ? FIXTURE_USAGE_PRO_INCLUDED : state === "low" ? FIXTURE_USAGE.low : state === "exhausted" ? FIXTURE_USAGE.exhausted : state === "resting" || state === "breaker-composing" ? FIXTURE_USAGE.resting : FIXTURE_USAGE.ok;
      if (state.startsWith("entry429")) await page.addInitScript(({ U, state }) => sessionStorage.setItem(`medpruf:mentor-availability:${U}`, JSON.stringify({ userId: U, value: state.endsWith("hidden") ? "hidden" : "available", at: Date.now() - 120000 })), { U, state });
      const url = state === "quality" ? "/admin/mentor?tab=Quality" : state === "facts-due" ? "/admin/mentor?tab=Facts" : state === "readiness-red" ? "/admin/mentor?tab=Readiness" : state === "review-queue" ? "/admin/mentor/review" : state.endsWith("pay") ? "/mentor/checkout/success?checkout_session_id=55555555-5555-4555-8555-555555555555" : state.startsWith("explain") ? `/mentor?mode=explain&question_id=1&from=question&answered=${state.endsWith("unanswered") ? "0" : "1"}` : ["low", "exhausted", "pro", "nopackages"].includes(state) ? "/mentor/packages" : "/mentor?q=Synthetic%20draft";
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main").first()).toBeVisible();
      if (state.startsWith("explain")) {
        const composer = page.locator("[data-mentor-composer] textarea");
        await composer.fill("Erklär mir diese Beispielfrage");
        await page.locator("[data-mentor-composer] button[type=submit]").click();
        await expect(page.locator("main").first()).toContainText(state.endsWith("unanswered") ? FIXTURE_EXPLAIN_UNANSWERED.answer_blocks[0].text : FIXTURE_EXPLAIN_ANSWERED.answer_blocks[0].text);
      } else if (state === "facts-due") await expect(page.locator("main").first()).toContainText("Fact-sheet health");
      else if (state === "readiness-red") await expect(page.locator("main").first()).toContainText("Launch readiness");
      else if (state === "review-queue") await expect(page.locator("main").first()).toContainText(FIXTURE_REVIEW_QUEUE.items[0].answer_text);
      else if (["low", "exhausted", "pro", "nopackages"].includes(state)) await expect(page.locator("[data-mentor-package-balance]")).toBeVisible();
      else await expect(page.locator("main").first()).not.toContainText("Loading readiness");
      if (zoom === 200) await page.evaluate(() => {
        // Measure every original size before applying absolute values; inherited
        // 2em rules would multiply nested text beyond 200 percent.
        const text = [...document.querySelectorAll<HTMLElement>("p,span,a,button,label,input,textarea,h1,h2,h3,h4,li,td,th,legend,select")].map(el => ({el,size:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));
        for (const {el,size,line} of text) { if (Number.isFinite(size)) el.style.setProperty("font-size",`${size*2}px`,"important"); if (Number.isFinite(line)) el.style.setProperty("line-height",`${line*2}px`,"important"); }
      });
      await page.screenshot({ path: `tests/e2e/.artifacts/mentor-r4-${state}-${width}-${lang}-${theme}-text${zoom}.png`, fullPage: true });
    }
  });
}
