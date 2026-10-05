import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Synthetic-only learner journeys. Every application API is fulfilled locally,
// and the host guard aborts all non-local network requests.
test.setTimeout(180_000);

const ROOT = join(process.cwd(), "reviews/ux-review-2026-09-26/evidence/journey-matrix");
mkdirSync(ROOT, { recursive: true });

const TRACKS = [
  { id: "kenntnispruefung", label: "Kenntnisprüfung Wien", onboardingLabel: "Kenntnisprüfung", topic: "Neurologie" },
  { id: "kmp_innsbruck", label: "Stichprobentest (Innsbruck)", onboardingLabel: "Stichprobentest (Innsbruck)", topic: "Dermatologie" },
  { id: "pharma", label: "Pharmakologie Rezeptierkunde", onboardingLabel: "Pharma", topic: "Pharmakologie" },
] as const;
type Tier = "free" | "pro";

type Setup = {
  context: BrowserContext;
  page: Page;
  writes: Array<{ path: string; method: string; body: unknown }>;
  diagnostics: string[];
  setStage: (stage: string) => void;
};

async function setup(browser: Browser, width: number, height: number, tier: Tier, onboarding = false): Promise<Setup> {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  // Middleware runs before init scripts and redirects bare `/` unless the
  // post-login cookie is present. Synthetic localStorage alone cannot bypass it.
  await context.addCookies([{ name: "mp_skip_landing", value: "1", url: process.env.BASE_URL ?? "http://127.0.0.1:3102" }]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Runtime.enable");
  await cdp.send("Debugger.enable");
  const writes: Setup["writes"] = [];
  const diagnostics: string[] = [];
  let journeyStage = "initial-load";
  cdp.on("Runtime.exceptionThrown", (event) => {
    const details = event.exceptionDetails;
    diagnostics.push(`runtime exception stage=${journeyStage}: ${JSON.stringify(details)}`);
  });
  cdp.on("Debugger.scriptFailedToParse", (event) => diagnostics.push(`script parse failed stage=${journeyStage}: ${JSON.stringify(event)}`));
  page.on("pageerror", (error) => diagnostics.push(`pageerror stage=${journeyStage}: name=${error.name} message=${error.message} stack=${error.stack || "<empty>"}`));
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(`console: ${message.text()}`); });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/user/") || url.pathname === "/api/auth/me") diagnostics.push(`request: ${request.method()} ${url.pathname}${url.search}`);
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/user/") || response.url().includes("/api/auth/me")) diagnostics.push(`api response: ${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => diagnostics.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`));
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`response ${response.status()}: ${response.url()}`);
    if (response.request().resourceType() === "script" && response.status() >= 400) diagnostics.push(`script response ${response.status()}: ${response.url()}`);
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.addInitScript(({ tier, onboarding }) => {
    localStorage.setItem("medpruef_session", JSON.stringify({
      user: { id: "journey-fixture", email: "journey@example.invalid", role: "user", tier, first_name: "Fixture", xp_total: 0, streak_count: 0, daily_goal: 10 },
      gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
    }));
    localStorage.setItem("medpruef_session_token", "synthetic-session-token");
    if (!onboarding) localStorage.setItem("medpruef_onboarding", JSON.stringify({ completedAt: "2026-01-01T00:00:00Z", examSource: "kenntnispruefung" }));
    else localStorage.removeItem("medpruef_onboarding");
    localStorage.setItem("medpruef_theme", "light");
    localStorage.setItem("medpruef-lang", "en");
    localStorage.setItem("medpruef_cookies", "declined");
  }, { tier, onboarding });

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() !== "GET" && req.method() !== "HEAD") {
      let body: unknown = null;
      try { body = req.postDataJSON(); } catch { /* Empty or non-JSON requests are recorded without parsing. */ }
      writes.push({ path, method: req.method(), body });
    }
    if (path === "/api/auth/me") return json({ user: { id: "journey-fixture", tier, role: "user", first_name: "Fixture", tier_expires_at: null, referrals_enabled: false } });
    if (path === "/api/user/onboarding-state") return json({});
    if (path === "/api/user/exam-preference" && req.method() === "GET") return json({ activeExam: "kenntnispruefung" });
    if (path === "/api/user/exam-preference") return json({ ok: true, activeExam: req.postDataJSON()?.activeExam });
    if (path === "/api/user/onboarding-complete") return json({ ok: true });
    if (path === "/api/user/last-session") return route.fulfill({ status: 204, body: "" });
    if (path === "/api/user/study-plan") return json({ plan: [], completed: 0, total: 0 });
    if (path === "/api/announcements/state") return json({ state: { sessionCount: 1, qsAnsweredTotal: 0 } });
    if (path === "/api/stats") return json({ gamification: {}, topicStats: [] });
    if (path === "/api/questions") {
      if (req.method() === "POST") {
        const examSource = req.postDataJSON()?.examSource;
        const track = TRACKS.find((item) => item.id === examSource) ?? TRACKS[0];
        return json([{ topic: track.topic, count: 3 }]);
      }
      if (url.searchParams.has("countOnly")) return json({ count: 3 });
      if (tier === "free" && ["wrong", "review"].includes(url.searchParams.get("practiceMode") || "")) {
        return json({ gate: url.searchParams.get("practiceMode") === "review" ? "spaced_repetition" : "wrong_only" }, 402);
      }
      const examSource = url.searchParams.get("examSource") || "kenntnispruefung";
      const track = TRACKS.find((item) => item.id === examSource) ?? TRACKS[0];
      const baseId = examSource === "pharma" ? 83001 : examSource === "kmp_innsbruck" ? 82001 : 81001;
      const excluded = new Set((url.searchParams.get("excludeIds") || "").split(",").map(Number));
      let firstId = baseId;
      while (excluded.has(firstId)) firstId++;
      const limit = Math.min(Number(url.searchParams.get("limit") || 1), 20);
      return json(Array.from({ length: limit }, (_, i) => ({
        id: firstId + i,
        topic: track.topic,
        question: `Synthetic ${track.label} question ${firstId + i - baseId + 1}`,
        answer: "Correct option",
        explanation: "Synthetic explanation for this track.",
        difficulty: 1,
        exam_type: examSource,
        exam_dates: [],
        n_correct: 1,
        options: [{ text: "Correct option", correct: true }, { text: "Other option", correct: false }],
      })));
    }
    if (path === "/api/answer") return json({ saved: true, xp: 1 });
    if (path === "/api/checkout-feedback/eligibility") return json({ eligible: false });
    if (path.startsWith("/api/announcements/")) return json({});
    return json({});
  });
  return { context, page, writes, diagnostics, setStage: (stage) => { journeyStage = stage; } };
}

function screenshot(name: string, width: number, height: number) {
  return join(ROOT, `${name}-${width}x${height}.png`);
}

function selectedViewports() {
  return [{ width: 390, height: 844 }, { width: 1440, height: 900 }].filter((viewport) =>
    !process.env.JOURNEY_VIEWPORT || `${viewport.width}x${viewport.height}` === process.env.JOURNEY_VIEWPORT,
  );
}

function selectedTracks() {
  return TRACKS.filter((track) => !process.env.JOURNEY_TRACK || track.id === process.env.JOURNEY_TRACK);
}

test("first-run onboarding selects each exam track and reaches the first saved answer on phone and desktop", async ({ browser }) => {
  const viewports = selectedViewports();
  const tracks = selectedTracks();
  for (const viewport of viewports) {
    for (const track of tracks) {
      const { context, page, writes, diagnostics } = await setup(browser, viewport.width, viewport.height, "free", true);
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: "Which exam are you taking?" })).toBeVisible();
        const escapedLabel = track.onboardingLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const trackCard = page.getByRole("button", { name: new RegExp(escapedLabel) });
        await trackCard.click();
        await expect(trackCard).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({ path: screenshot(`onboarding-track-${track.id}`, viewport.width, viewport.height), fullPage: true });
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await page.screenshot({ path: screenshot(`onboarding-date-${track.id}`, viewport.width, viewport.height), fullPage: true });
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await page.screenshot({ path: screenshot(`onboarding-goal-${track.id}`, viewport.width, viewport.height), fullPage: true });
        await page.getByRole("button", { name: "Let's go!" }).click();
        try {
          await page.waitForURL(new RegExp(`/quiz.*examSource=${track.id}`), { timeout: 15_000 });
        } catch {
          throw new Error(`Onboarding failed to navigate: url=${page.url()} diagnostics=${JSON.stringify(diagnostics)}`);
        }
        await expect(page.locator("[data-question-text]")).toContainText(`Synthetic ${track.label} question`);
        await page.screenshot({ path: screenshot(`first-question-${track.id}`, viewport.width, viewport.height), fullPage: true });
        await page.getByRole("radio", { name: "Correct option" }).click();
        await expect.poll(() => writes.some((write) => write.path === "/api/answer")).toBe(true);
        await page.screenshot({ path: screenshot(`first-answer-${track.id}`, viewport.width, viewport.height), fullPage: true });
        expect(writes.some((write) => write.path === "/api/user/exam-preference" && (write.body as { activeExam?: string })?.activeExam === track.id)).toBe(true);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      } finally { await context.close(); }
    }
  }
});

test("Free and Pro learners see correct review-mode gates across all three exam tracks at phone and desktop sizes", async ({ browser }) => {
  const tiers = (["free", "pro"] as const).filter((tier) => !process.env.JOURNEY_TIER || tier === process.env.JOURNEY_TIER);
  for (const viewport of selectedViewports()) {
    for (const track of selectedTracks()) {
      for (const tier of tiers) {
        const { context, page, diagnostics } = await setup(browser, viewport.width, viewport.height, tier);
        try {
          await page.goto(`/quiz?topic=${encodeURIComponent(track.topic)}&examSource=${track.id}&practiceMode=review&limit=3`, { waitUntil: "domcontentloaded" });
          if (tier === "free") {
            // Match the exact user-visible copy, independent of the portal's
            // role/class exposure in a dev browser.
            const paywallTitle = page.getByText("Review mode is Pro", { exact: true });
            try {
              await expect(paywallTitle).toBeVisible({ timeout: 15_000 });
            } catch {
              const bodyText = await page.locator("body").innerText().catch(() => "<body unavailable>");
              throw new Error(`Free review paywall text missing: url=${page.url()} body=${JSON.stringify(bodyText)} diagnostics=${JSON.stringify(diagnostics)}`);
            }
            await expect(page.getByRole("link", { name: "See plans" })).toBeVisible();
            await page.screenshot({ path: screenshot(`free-review-paywall-${track.id}`, viewport.width, viewport.height), fullPage: true });
          } else {
            await expect(page.locator("[data-question-text]")).toContainText(`Synthetic ${track.label} question`);
            await expect(page.getByText("No due reviews in this selection.")).toHaveCount(0);
            await page.screenshot({ path: screenshot(`pro-review-ready-${track.id}`, viewport.width, viewport.height), fullPage: true });
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(1);
        } finally { await context.close(); }
      }
    }
  }
});

test("a learner can pause a quiz and resume the same account-scoped session", async ({ browser }) => {
  for (const viewport of selectedViewports()) {
    const { context, page, diagnostics, setStage } = await setup(browser, viewport.width, viewport.height, "pro");
    try {
      await page.goto("/quiz?topic=Neurologie&examSource=kenntnispruefung&practiceMode=all&limit=3", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-question-text]")).toContainText("Synthetic Kenntnisprüfung Wien question 1");
      await page.getByRole("radio", { name: "Correct option" }).click();
      await expect(page.locator("[data-question-text]")).toContainText("Synthetic Kenntnisprüfung Wien question 1");
      await expect.poll(async () => page.evaluate(() => {
        const entry = Object.entries(localStorage).find(([key]) => key.startsWith("medpruef-quiz-v4:"));
        return entry ? JSON.parse(entry[1]).answered.length : 0;
      })).toBe(1);
      const beforeReload = await page.evaluate(() => Object.entries(localStorage)
        .filter(([key]) => key.startsWith("medpruef-quiz-v4:"))
        .map(([key, value]) => ({ key, value: JSON.parse(value) })));
      await page.screenshot({ path: screenshot("pause-before-leaving", viewport.width, viewport.height), fullPage: true });
      setStage("reload");
      await page.reload({ waitUntil: "domcontentloaded" });
      try {
        await expect(page.getByText("Resume your session?")).toBeVisible();
      } catch {
        const afterReload = await page.evaluate(() => ({
          sessions: Object.entries(localStorage)
            .filter(([key]) => key.startsWith("medpruef-quiz-v4:"))
            .map(([key, value]) => ({ key, value: JSON.parse(value) })),
          account: JSON.parse(localStorage.getItem("medpruef_session") || "null"),
          studyMode: localStorage.getItem("medpruef-study-mode:journey-fixture:kenntnispruefung"),
          languageKeys: Object.keys(localStorage).filter((key) => key.toLowerCase().includes("lang")),
          setupQuery: new URLSearchParams(location.search).get("setup"),
          headings: Array.from(document.querySelectorAll("h1,h2,h3"), (node) => node.textContent?.trim()),
          bodyStart: document.body.innerText.slice(0, 500),
        }));
        throw new Error(`Resume offer missing after reload: url=${page.url()} before=${JSON.stringify(beforeReload)} after=${JSON.stringify(afterReload)} diagnostics=${JSON.stringify(diagnostics)}`);
      }
      await expect(page.getByText(/1 questions already answered/)).toBeVisible();
      await page.screenshot({ path: screenshot("pause-resume-offer", viewport.width, viewport.height), fullPage: true });
      await page.getByRole("button", { name: "Resume" }).click();
      await expect(page.locator("[data-question-text]")).toContainText("Synthetic Kenntnisprüfung Wien question 2");
      await page.screenshot({ path: screenshot("resumed-question", viewport.width, viewport.height), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    } finally { await context.close(); }
  }
});
