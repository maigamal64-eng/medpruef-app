/**
 * /exam run (b34 NEW-EXAM-E2E, rewritten for a24). Local servers talk to the production
 * database, so:
 * - every /api/** request is answered by page.route stubs inside the browser; nothing reaches the server;
 * - every non-GET /api/** request is ABORTED, except POST /api/history/exams, which is fulfilled
 *   from a stub (never forwarded) after a first deliberate abort to prove the save retry;
 * - fixtures are synthetic (ids from 900000, no learner data, no bank content).
 * The run test asserts that no /api request was forwarded. The matrix test captures entry,
 * running exam, overview sheet, submit dialog, result, review, history list, KAF entry and
 * the real-result page at 375 px and desktop, light and dark, DE and EN, with no console
 * errors and no horizontal overflow.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { KP_BLUEPRINT, blueprintTotal } from "../../../../src/lib/master-exam/presets";

const USER_ID = "00000000-0000-4000-8000-0000000b3434";
const START = new Date("2027-02-19T07:00:00Z");

let nextId = 900000;
function fixtures(topic: string, limit: number) {
  return Array.from({ length: limit }, (_, i) => {
    const id = nextId++;
    // Three EKG stems in Innere Medizin satisfy the page's EKG quota without the extra search.
    const ekg = topic === "Innere Medizin" && i < 3 ? "EKG " : "";
    return {
      id, topic, question: `${ekg}Fixture ${id} (${topic})`, answer: `Q${id} correct`, explanation: "", difficulty: 1, exam_dates: [],
      options: [
        { text: `Q${id} correct`, correct: true },
        { text: `Q${id} wrong 1`, correct: false },
        { text: `Q${id} wrong 2`, correct: false },
        { text: `Q${id} wrong 3`, correct: false },
        { text: `Q${id} wrong 4`, correct: false },
      ],
      n_correct: 1,
    };
  });
}

interface Ledger { seen: number; handled: number; aborted: string[]; historyPosts: unknown[] }

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stubApi(page: Page, ledger: Ledger, historyMode: { failFirst: boolean }) {
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    ledger.handled += 1;
    const method = req.method();
    if (method !== "GET") {
      if (method === "POST" && url.pathname === "/api/history/exams") {
        const body = req.postDataJSON() as { attempt_id?: string };
        ledger.historyPosts.push(body);
        if (historyMode.failFirst && ledger.historyPosts.length === 1) {
          ledger.aborted.push(`${method} ${url.pathname}`);
          return route.abort("failed");
        }
        return json(route, { attempt: { id: "00000000-0000-4000-8000-00000000a124", attempt_id: body.attempt_id } });
      }
      ledger.aborted.push(`${method} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (url.pathname === "/api/questions") {
      if (url.searchParams.get("countOnly") === "1") return json(route, { count: 400 });
      const topic = url.searchParams.get("topic");
      return json(route, topic ? fixtures(topic, Number(url.searchParams.get("limit") ?? "0")) : []);
    }
    if (url.pathname === "/api/user/exam-preference") return json(route, { activeExam: "kenntnispruefung", examDate: "2027-03-10" });
    if (url.pathname === "/api/history/exams") {
      return json(route, { total: 3, access: "full", attempts: [55, 62, 71].map((score, i) => ({
        id: `00000000-0000-4000-8000-00000000b00${i}`, exam_type: "kenntnispruefung", title: "Vollsimulation",
        config: { part: "all", presetId: "kp_full", passRuleId: "overall-60", count: 180 }, correct_count: Math.round(score * 1.8), total_count: 180,
        score_pct: score, duration_ms: 3 * 3600_000, completed_at: `2026-10-0${i + 1}T10:00:00Z`,
      })) });
    }
    if (url.pathname === "/api/exam/kaf-pool") return json(route, { count: 45 });
    if (url.pathname === "/api/puyp/status") return json(route, { eligible: false, reason_code: "no_subscription", meets_completion_gate: false, exam_type: "kenntnispruefung", exam_date: "2026-11-18", qbank_completion_pct: 12, qbank_answered: 900, qbank_total: 7566 });
    if (url.pathname === "/api/user/topic-progress") return json(route, []);
    if (url.pathname === "/api/auth/me") return json(route, { user: { id: USER_ID, tier: "pro", role: "user" } });
    return json(route, {});
  });
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) ledger.seen += 1; });
}

async function seed(page: Page, lang: "de" | "en", theme: "light" | "dark") {
  await page.addInitScript(({ userId, lang, theme }) => {
    try {
      localStorage.setItem("medpruef_theme", theme);
      localStorage.setItem("medpruef-lang", lang);
      localStorage.setItem("medpruef_cookies", "declined");
      localStorage.setItem("medpruef_exam_source", "kenntnispruefung");
      if (!localStorage.getItem("medpruef_session")) {
        localStorage.setItem("medpruef_session", JSON.stringify({
          user: { id: userId, email: "track-a-fixture@example.invalid", role: "user", tier: "pro", tier_expires_at: null, first_name: "Fixture", xp_total: 0, streak_count: 0, daily_goal: 20 },
          gamification: { total_xp: 0, current_streak: 0, longest_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
        }));
      }
    } catch { /* storage unavailable */ }
  }, { userId: USER_ID, lang, theme });
}

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    // Deliberately aborted stub requests and the logged history-save failure are expected.
    if (/Failed to load resource|net::ERR_FAILED|ERR_BLOCKED_BY_CLIENT|\[exam\] history save failed/.test(text)) return;
    // Local-only: the prefetch of "/" is redirected from 127.0.0.1 to localhost (another origin
    // here, the same origin in production), so Next falls back to a normal navigation.
    if (/redirected from 'http:\/\/127\.0\.0\.1:31\d\d\/\?_rsc=|Failed to fetch RSC payload for http:\/\/127\.0\.0\.1:31\d\d\/\./.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test("start preset, reload at hour 3, submit, result wording, history save retry", async ({ page }) => {
  test.setTimeout(120_000);
  const ledger: Ledger = { seen: 0, handled: 0, aborted: [], historyPosts: [] };
  const errors = watchConsole(page);
  await page.clock.install({ time: START });
  await seed(page, "en", "light");
  await stubApi(page, ledger, { failFirst: true });

  // 1. Start the default full preset (180 = KP blueprint total).
  await page.goto("/exam");
  const start = page.getByRole("button", { name: /^Start simulation/ });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await expect(start).toContainText(String(blueprintTotal(KP_BLUEPRINT)));
  await expect(page.getByText(/practice threshold 60 percent/)).toBeVisible();
  await start.click();
  const firstStem = page.getByText(/^(EKG )?Fixture \d+ \(/).first();
  await expect(firstStem).toBeVisible({ timeout: 30_000 });
  const firstId = Number((await firstStem.textContent())!.match(/Fixture (\d+)/)![1]);
  await page.getByText(`Q${firstId} correct`, { exact: true }).click();
  await expect(page.getByText(/^0(4:00:00|3:59:\d\d)$/).first()).toBeVisible();

  // 2. Three hours pass; the learner reloads. The resume card shows about one hour left.
  await page.clock.fastForward("03:00:00");
  await page.reload();
  await expect(page.getByText("Exam in progress")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1 of 180 answered, (0:59|1:00) left\./)).toBeVisible();
  await page.getByRole("button", { name: "Resume current exam", exact: true }).click();
  await expect(page.getByText(`Fixture ${firstId} (`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/^0(0:59:\d\d|1:00:00)$/).first()).toBeVisible();

  // 3. Submit through the dialog: open questions remain, so "Submit now" is the secondary action.
  await page.getByRole("button", { name: /^Submit \(179 open\)/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Submit the exam?")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Go to first open question" })).toBeVisible();
  await page.clock.runFor(1000);
  await dialog.getByRole("button", { name: "Submit now" }).click();
  await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Below 60 percent", { exact: true })).toBeVisible();
  await expect(page.locator(".mp-stat").filter({ hasText: "Correct" })).toContainText("1");
  await expect(page.getByRole("link", { name: /Practise wrong and open questions \(179\)/ })).toHaveAttribute("href", /\/quiz\?.*ids=/);

  // 4. The first history save is aborted; the retry is fulfilled by the stub and acknowledged.
  const alert = page.getByRole("alert").filter({ hasText: "Retry saving" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await alert.getByRole("button", { name: "Retry saving" }).click();
  await expect(alert).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "View in history" })).toBeVisible();

  expect(ledger.historyPosts).toHaveLength(2);
  const posted = ledger.historyPosts[1] as { question_ids: number[]; answers: Record<string, string[]>; config: Record<string, unknown> };
  expect(posted.question_ids).toHaveLength(180);
  expect(posted.answers).toEqual({ [String(firstId)]: [`Q${firstId} correct`] });
  expect(posted.config).toMatchObject({ kind: "mcq", presetId: "kp_full", passRuleId: "overall-60", durationS: 14400 });
  expect(ledger.handled).toBe(ledger.seen);
  expect(ledger.aborted).toContain("POST /api/history/exams");
  // This test fakes the browser clock to 2027 while the server renders in real time, so
  // date-dependent server HTML (React #418) and the prefetch of "/" after the clock jump are
  // expected here only. The smoke matrix below runs on the real clock and allows no errors.
  expect(errors.filter((e) => !/React error #418|Failed to fetch RSC payload/.test(e))).toEqual([]);
});

const VIEWPORTS = [{ name: "375", width: 375, height: 812 }, { name: "desktop", width: 1440, height: 900 }] as const;
for (const vp of VIEWPORTS) for (const theme of ["light", "dark"] as const) for (const lang of ["de", "en"] as const) {
  test(`smoke ${vp.name} ${theme} ${lang}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const ledger: Ledger = { seen: 0, handled: 0, aborted: [], historyPosts: [] };
    const errors = watchConsole(page);
    await seed(page, lang, theme);
    await stubApi(page, ledger, { failFirst: false });
    const shot = async (name: string) => {
      await noOverflow(page, name);
      await page.screenshot({ path: info.outputPath(`${vp.name}-${theme}-${lang}-${name}.png`), fullPage: false });
    };

    await page.goto("/exam?part=sip4");
    await expect(page.getByRole("radio", { checked: true })).toContainText("SIP4a");
    await shot("entry-sip4");
    await page.getByRole("radio", { name: /Eigene|Custom/ }).click();
    await shot("entry-custom");
    await page.getByRole("radio", { name: /Vollsimulation|Full simulation/ }).click();
    await page.getByRole("button", { name: lang === "de" ? /^Simulation starten/ : /^Start simulation/ }).click();
    await expect(page.getByText(/^(EKG )?Fixture \d+ \(/).first()).toBeVisible({ timeout: 30_000 });
    await shot("running");
    if (vp.width < 1024) {
      await page.getByRole("button", { name: lang === "de" ? /^Übersicht/ : /^Overview/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot("overview-sheet");
      // On phones the submit action lives in the overview sheet footer.
      await page.getByRole("dialog").getByRole("button", { name: lang === "de" ? "Abgeben" : "Submit", exact: true }).click();
    } else {
      await page.getByRole("button", { name: lang === "de" ? /^Abgeben/ : /^Submit/ }).first().click();
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await shot("submit-dialog");
    await page.waitForTimeout(900);
    await dialog.getByRole("button", { name: lang === "de" ? "Jetzt abgeben" : "Submit now" }).click();
    await expect(page.getByRole("heading", { name: lang === "de" ? "Ihr Ergebnis" : "Your result" })).toBeVisible({ timeout: 30_000 });
    await shot("result");
    await page.getByRole("button", { name: lang === "de" ? "Alle Antworten ansehen" : "Review all answers" }).click();
    await shot("review");

    await page.goto("/history");
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(500);
    await shot("history");
    await page.goto("/exam/kaf");
    await page.waitForTimeout(800);
    await shot("kaf-entry");
    await page.goto("/dashboard/exam-result");
    await page.waitForTimeout(800);
    await shot("real-result");
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
