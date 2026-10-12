/**
 * /exam run (b34-exam-pure, NEW-EXAM-E2E). Local servers talk to the production database, so:
 * - every /api/** request is answered by page.route stubs inside the browser; nothing reaches the server;
 * - every non-GET /api/** request is ABORTED, except POST /api/history/exams, which is fulfilled
 *   from a stub (never forwarded) after a first deliberate abort to prove the save retry;
 * - fixtures are synthetic (ids from 900000, no learner data, no bank content).
 * The spec asserts at the end that no non-GET request was forwarded.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { KP_BLUEPRINT, blueprintTotal } from "../../../../src/lib/master-exam/presets";

const USER_ID = "00000000-0000-4000-8000-0000000b3434";
const START = new Date("2027-02-19T07:00:00Z");

interface FixtureQuestion {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options: { text: string; correct: boolean }[];
  n_correct: number;
}

let nextId = 900000;
function fixtures(topic: string, limit: number): FixtureQuestion[] {
  return Array.from({ length: limit }, (_, i) => {
    const id = nextId++;
    // Three EKG stems in Innere Medizin satisfy the page's EKG quota without the extra search.
    const ekg = topic === "Innere Medizin" && i < 3 ? "EKG " : "";
    return {
      id,
      topic,
      question: `${ekg}Fixture ${id} (${topic})`,
      answer: `Q${id} correct`,
      explanation: "",
      difficulty: 1,
      exam_dates: [],
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
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ attempt: { id: "stub-attempt-1", attempt_id: body.attempt_id } }) });
      }
      ledger.aborted.push(`${method} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (url.pathname === "/api/questions") {
      const topic = url.searchParams.get("topic");
      const limit = Number(url.searchParams.get("limit") ?? "0");
      const body = topic ? fixtures(topic, limit) : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if (url.pathname === "/api/user/exam-preference") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ activeExam: "kenntnispruefung" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  // The handler never calls route.continue() or route.fallback(), so no /api request reaches the server.
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) ledger.seen += 1; });
}

async function seed(page: Page) {
  await page.addInitScript(({ userId }) => {
    try {
      localStorage.setItem("medpruef_theme", "light");
      localStorage.setItem("medpruef-lang", "en");
      localStorage.setItem("medpruef_cookies", "declined");
      localStorage.setItem("medpruef_exam_source", "kenntnispruefung");
      if (!localStorage.getItem("medpruef_session")) {
        localStorage.setItem("medpruef_session", JSON.stringify({
          user: { id: userId, email: "track-b-fixture@example.invalid", role: "user", tier: "pro", first_name: "Fixture", xp_total: 0, streak_count: 0, daily_goal: 20 },
          gamification: { total_xp: 0, current_streak: 0, longest_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
        }));
      }
    } catch { /* storage unavailable */ }
  }, { userId: USER_ID });
}

test("start preset, reload at hour 3, submit, result wording, history save retry", async ({ page }) => {
  test.setTimeout(120_000);
  const ledger: Ledger = { seen: 0, handled: 0, aborted: [], historyPosts: [] };
  await page.clock.install({ time: START });
  await seed(page);
  await stubApi(page, ledger, { failFirst: true });

  // 1. Start the default full preset (180 = KP blueprint total).
  await page.goto("/exam");
  const start = page.getByRole("button", { name: /Start Exam/ });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await expect(start).toContainText(String(blueprintTotal(KP_BLUEPRINT)));
  await start.click();
  const firstStem = page.getByText(/^(EKG )?Fixture \d+ \(/).first();
  await expect(firstStem).toBeVisible({ timeout: 30_000 });
  const firstId = Number((await firstStem.textContent())!.match(/Fixture (\d+)/)![1]);
  await page.getByText(`Q${firstId} correct`, { exact: true }).click();
  await expect(page.getByText(/^0(4:00:00|3:59:\d\d)$/).filter({ visible: true }).first()).toBeVisible();

  // 2. Three hours pass; the learner reloads. The resume card shows about one hour left.
  await page.clock.fastForward("03:00:00");
  await page.reload();
  await expect(page.getByText("Exam in progress")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1\/180 answered, 0(0:59:\d\d|1:00:00) left\./)).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText(`Fixture ${firstId} (`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/^0(0:59:\d\d|1:00:00)$/).filter({ visible: true }).first()).toBeVisible();

  // 3. Submit. One correct of 180 is below the 60 percent practice rule.
  await page.getByRole("button", { name: /Submit Exam/ }).first().click();
  await page.getByRole("button", { name: "Submit Exam", exact: true }).last().click();
  await expect(page.getByText("Not Passed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^1 \/ 180 /)).toBeVisible();

  // 4. The first history save is aborted; the retry is fulfilled by the stub and acknowledged.
  const alert = page.getByRole("alert").filter({ hasText: "has not been saved to history yet" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await alert.getByRole("button", { name: "Retry saving" }).click();
  await expect(alert).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('a[href*="/history"]').first()).toBeVisible();

  expect(ledger.historyPosts).toHaveLength(2);
  const posted = ledger.historyPosts[1] as { question_ids: number[]; answers: Record<string, string[]> };
  expect(posted.question_ids).toHaveLength(180);
  expect(posted.answers).toEqual({ [String(firstId)]: [`Q${firstId} correct`] });
  // Every /api request the page made went through the stub (none forwarded to the server).
  expect(ledger.handled).toBe(ledger.seen);
  expect(ledger.aborted).toContain("POST /api/history/exams");
});
