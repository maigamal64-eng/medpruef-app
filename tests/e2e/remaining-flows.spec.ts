import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { studyScope } from "@/lib/study-session";
import type { QuizConfig } from "@/components/QuizSetup";

// These journeys use an isolated, synthetic learner and intercept every API.
// The browser may talk only to the local built app. No provider, payment,
// analytics, account, or production endpoint is reachable from this suite.
test.setTimeout(180_000);

const ROOT = join(process.cwd(), "reviews/ux-review-2026-09-26/evidence/remaining-flows");
mkdirSync(ROOT, { recursive: true });
const NEUROLOGY_QID = 71_001 + [..."Neurologie"].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 100;
const RANDOM_QID = 71_001 + [..."random"].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 100;

type FixtureOptions = {
  width: number;
  height: number;
  lang?: "de" | "en";
  role?: "user" | "admin";
  tier?: "free" | "pro";
  cachedActiveExam?: string;
  cachedTargetDate?: string;
  serverExamPreference?: { activeExam: string; examDate: string | null };
  partialExamTopic?: string;
  delayExamPreferenceMs?: number;
  seedStudyScope?: string;
  emptyNotes?: boolean;
  theme?: "light" | "dark";
};
type ExamSubmission = { attempt_id: string; question_ids: number[]; answers: Record<string, unknown> };
type FixtureState = {
  bookmarks: number[];
  questionQueries: string[];
  questionResponseCounts: Record<string, number>;
  topicProgressQueries: string[];
  answerWrites: unknown[];
  suggestionWrites: unknown[];
  feedbackWrites: unknown[];
  examWrites: ExamSubmission[];
  checkoutWrites: Array<Record<string, unknown>>;
  translateWrites: Array<Record<string, unknown>>;
  aiWrites: Array<Record<string, unknown>>;
  authMeReads: number;
  notes: Array<Record<string, unknown>>;
  noteTransformWrites: unknown[];
  noteListReads: number;
};

async function fixture(browser: Browser, opts: FixtureOptions): Promise<{ context: BrowserContext; page: Page; state: FixtureState }> {
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, serviceWorkers: "block" });
  const page = await context.newPage();
  const state: FixtureState = {
    bookmarks: [], questionQueries: [], questionResponseCounts: {}, topicProgressQueries: [], answerWrites: [], suggestionWrites: [], feedbackWrites: [], examWrites: [], checkoutWrites: [], translateWrites: [], aiWrites: [], authMeReads: 0,
    notes: opts.emptyNotes ? [] : [
      { id: "fixture-typed-note", source_type: "user_note", source_ref: null, title: "Typed clinical note", content: { title: "Typed clinical note", blocks: [{ type: "keyfact", text: "Searchable detail from an authored note, visible in the full note reader." }], tags: [], refs: [] }, tags: ["fixture"], exam_type: "kenntnispruefung", topic: "Cardiology", visibility: "private", is_active: true, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      { id: "fixture-manual-note", source_type: "manual", source_ref: null, title: "Manual reference card", content: { title: "Manual reference card", blocks: [{ type: "keyfact", text: "A reference card made manually." }], tags: [], refs: [] }, tags: ["fixture"], exam_type: null, topic: null, visibility: "private", is_active: true, created_at: "2026-09-02T00:00:00Z", updated_at: "2026-09-02T00:00:00Z" },
    ],
    noteTransformWrites: [], noteListReads: 0,
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.addInitScript(({ lang, role, tier, cachedActiveExam, cachedTargetDate, seedStudyScope, theme }) => {
    localStorage.setItem("medpruef_session", JSON.stringify({
      user: { id: "ux-flow-fixture", email: "fixture@example.invalid", role, tier, active_exam: cachedActiveExam, first_name: "Fixture", xp_total: 0, streak_count: 0, daily_goal: 20 },
      gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 },
    }));
    localStorage.setItem("medpruef_session_token", "local-test-session-token");
    localStorage.setItem("medpruef_onboarding", "1");
    localStorage.setItem("medpruef_theme", theme);
    localStorage.setItem("medpruef-lang", lang);
    localStorage.setItem("medpruef_cookies", "declined");
    if (cachedTargetDate) localStorage.setItem("medpruef_profile", JSON.stringify({ targetDate: cachedTargetDate, dailyGoal: 20 }));
    if (seedStudyScope) localStorage.setItem(seedStudyScope, JSON.stringify({ v: 4, savedAt: Date.now(), targetCount: 20, answered: [{ id: 777_001, correct: false }] }));
  }, { lang: opts.lang ?? "en", role: opts.role ?? "user", tier: opts.tier ?? "pro", cachedActiveExam: opts.cachedActiveExam, cachedTargetDate: opts.cachedTargetDate, seedStudyScope: opts.seedStudyScope, theme: opts.theme ?? "light" });

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/track") return json({ ok: true });
    if (path === "/api/auth/me") { state.authMeReads++; return json({ user: { id: "ux-flow-fixture", tier: opts.tier ?? "pro", role: opts.role ?? "user", first_name: "Fixture", tier_expires_at: null, referrals_enabled: true } }); }
    if (path === "/api/user/exam-preference") {
      if (opts.delayExamPreferenceMs) await new Promise((resolve) => setTimeout(resolve, opts.delayExamPreferenceMs));
      return json(opts.serverExamPreference ?? { activeExam: "kenntnispruefung", examDate: null });
    }
    if (path === "/api/user/topic-progress") {
      const examType = url.searchParams.get("examType") || "kenntnispruefung";
      state.topicProgressQueries.push(examType);
      const total = examType === "kmp_innsbruck" ? 2_742 : examType === "pharma" ? 335 : 7_565;
      return json([{ topic: "Innere Medizin", total, answered: 1, accuracy: 100 }]);
    }
    // a23: the open-mistake rule is not applied in this fixture, so /mistakes shows its all-time fallback list.
    if (path === "/api/user/mistakes") return json({ error: "Mistake rule not available yet", code: "MISTAKE_RULE_UNAVAILABLE" }, 503);
    if (path === "/api/questions") {
      state.questionQueries.push(url.search);
      if (url.searchParams.has("countOnly")) return json({ count: 3 });
      if (req.method() === "POST") return json([{ topic: "Neurologie", count: 3 }]);
      const idParam = Number(url.searchParams.get("ids"));
      const count = url.searchParams.has("list") ? 3 : Math.min(Number(url.searchParams.get("limit") || 1), 400);
      const topic = url.searchParams.get("topic") || "Neurologie";
      const responseCount = state.questionResponseCounts[topic] ?? 0;
      state.questionResponseCounts[topic] = responseCount + 1;
      const topicSeed = [...topic].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      let qid = idParam || (url.searchParams.get("search") === "EKG" ? 9_900_000 : 71_001 + topicSeed * 100);
      const excluded = new Set((url.searchParams.get("excludeIds") || "").split(",").map(Number));
      while (!idParam && excluded.has(qid)) qid++;
      const returnedCount = opts.partialExamTopic === topic && responseCount === 0 ? Math.min(count, 9) : count;
      return json(Array.from({ length: returnedCount }, (_, i) => ({
        id: qid + i,
        topic,
        question: topic === "Long" ? `Long flashcard stem. ${"Read every line carefully. ".repeat(220)}` : i < 3 && url.searchParams.get("search") === "EKG" ? `EKG fixture ${qid + i}` : `Fixture question ${qid + i}`,
        answer: "Correct option",
        explanation: "Fixture explanation in German. The correct option is supported by the clinical finding.",
        difficulty: 1,
        exam_dates: [],
        n_correct: 1,
        options: [{ text: "Correct option", correct: true }, { text: "Other option", correct: false }],
      })));
    }
    if (path === "/api/answer" && req.method() === "POST") { state.answerWrites.push(req.postDataJSON()); return json({ xp: 10, saved: true }); }
    if (path === "/api/bookmarks" && req.method() === "GET") return json({ questionIds: state.bookmarks });
    if (path === "/api/bookmarks" && req.method() === "PATCH") {
      const body = req.postDataJSON() as { questionId: number; isBookmarked: boolean };
      state.bookmarks = body.isBookmarked ? [...new Set([...state.bookmarks, body.questionId])] : state.bookmarks.filter((id) => id !== body.questionId);
      return json({ ok: true, questionIds: state.bookmarks });
    }
    if (path === "/api/bookmarks" && req.method() === "DELETE") {
      state.bookmarks = [];
      return json({ ok: true });
    }
    if (path === "/api/ai-chat" && req.method() === "GET") return json({ cached: true, explanation: "Fixture AI explanation: the clinical finding supports the correct choice.", lang: "en" });
    if (path === "/api/ai-chat" && req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown> & { messages?: unknown[] }; state.aiWrites.push(body);
      return json({ reply: (body.messages?.length ?? 0) > 1 ? "Fixture follow-up answer: review the mechanism and the distractors." : "Fixture AI explanation: the clinical finding supports the correct choice." });
    }
    if (path === "/api/translate" && req.method() === "GET") return json({ field: url.searchParams.get("field"), translations: {} });
    if (path === "/api/translate" && req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>; state.translateWrites.push(body);
      return json({ translatedText: "Fixture translated explanation.", lang: body.lang, field: body.field, cached: false });
    }
    if (path === "/api/notes/for-question") return json({ enabled: false, notes: [] });
    if (path === "/api/notes" && req.method() === "GET") { state.noteListReads++; return json({ notes: state.notes }); }
    if (path === "/api/notes/transform" && req.method() === "POST") {
      state.noteTransformWrites.push(req.postDataJSON());
      const now = new Date().toISOString();
      state.notes.unshift({ id: `fixture-generated-${state.noteTransformWrites.length}`, source_type: "user_note", source_ref: null, title: "Fixture generated flash-note", content: { title: "Fixture generated flash-note", blocks: [{ type: "keyfact", text: "A newly saved fixture note." }], tags: [], refs: [] }, tags: ["fixture"], exam_type: null, topic: null, visibility: "private", is_active: true, created_at: now, updated_at: now });
      return json({ ok: true });
    }
    if (path === "/api/suggestions" && req.method() === "POST") { state.suggestionWrites.push(req.postDataJSON()); return json({ ok: true }); }
    if (path === "/api/feedback" && req.method() === "POST") { state.feedbackWrites.push(req.postDataJSON()); return json({ ok: true }); }
    if (path === "/api/history/exams" && req.method() === "POST") {
      const body = req.postDataJSON() as ExamSubmission; state.examWrites.push(body);
      return json({ ok: true, attempt: { id: body.attempt_id, attempt_id: body.attempt_id, correct_count: 180, total_count: body.question_ids?.length, score_pct: 100 } });
    }
    if (path === "/api/whop/checkout" && req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>; state.checkoutWrites.push(body);
      return json({ purchaseUrl: new URL("/__test-checkout", url.origin).toString() });
    }
    if (path === "/api/checkout-feedback/eligibility") return json({ eligible: false });
    if (path.startsWith("/api/announcements/")) return json({});
    if (path === "/api/referrals/status") return json({ referralLink: "https://medpruf.com/register?ref=fixture", code: "FIXTURE", referrals: [], qualifiedAllTime: 0 });
    if (path === "/api/referrals/social-proof") return json({ count: 0 });
    if (path === "/api/referrals/mark-copied") return json({ ok: true });
    if (path === "/api/stats") return json({ gamification: {}, topicStats: [] });
    return json({});
  });
  await page.route("**/__test-checkout", (route) => route.fulfill({ contentType: "text/html", body: '<main><h1>Mock checkout</h1><a href="/pricing?checkout=cancelled">Cancel and return</a></main>' }));
  return { context, page, state };
}

function shot(name: string, width: number, height: number) {
  return join(ROOT, `${name}-${width}x${height}.png`);
}

test("exam topic names remain readable in the narrow two-column phone grid", async ({ browser }) => {
  const { context, page } = await fixture(browser, { width: 390, height: 844, lang: "de" });
  try {
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    const label = page.getByText("Chirurgische Fächer", { exact: true });
    await expect(label).toBeVisible();
    const styles = await label.evaluate((element) => ({
      lineClamp: getComputedStyle(element).getPropertyValue("-webkit-line-clamp"),
      textOverflow: getComputedStyle(element).textOverflow,
      renderedHeight: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(styles.lineClamp).toBe("2");
    expect(styles.textOverflow).not.toBe("ellipsis");
    expect(styles.renderedHeight).toBeGreaterThanOrEqual(styles.lineHeight * 1.7);
    expect(styles.renderedHeight).toBeLessThan(styles.lineHeight * 2.2);
    await page.screenshot({ path: shot("exam-topic-labels-phone", 390, 844), fullPage: true });
  } finally {
    await context.close();
  }
});

test("Library source labels match note types and a typed note opens at full length", async ({ browser }) => {
  const { context, page } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.goto("/library", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Typed clinical note/ })).toBeVisible();
    await page.getByRole("button", { name: "Manually created", exact: true }).click();
    await expect(page.getByRole("button", { name: /Manual reference card/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Typed clinical note/ })).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder("Search notes…").fill("Searchable detail from an authored note");
    const typedNote = page.getByRole("button", { name: /Typed clinical note/ });
    await expect(typedNote).toBeVisible();
    await typedNote.click();
    const readerTitle = page.getByText("Typed clinical note", { exact: true }).last();
    await expect(readerTitle).toBeVisible();
    await readerTitle.click();
    await expect(page.getByText("Searchable detail from an authored note, visible in the full note reader.").last()).toBeVisible();
    await page.screenshot({ path: shot("library-full-note-phone", 390, 844), fullPage: true });
  } finally { await context.close(); }
});

test("Library refreshes a newly saved flash-note without reloading on phone and desktop", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { context, page, state } = await fixture(browser, { ...viewport, lang: "en", role: "user", tier: "pro", emptyNotes: true });
    try {
      await page.goto("/library", { waitUntil: "domcontentloaded" });
      // Allow the client-side session state to hydrate before interacting.
      await page.waitForTimeout(1_000);
      await expect.poll(() => state.noteListReads).toBeGreaterThan(0);
      const initialReads = state.noteListReads;
      await expect(page.getByRole("button", { name: /New note|Neue Notiz/ })).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: /New note|Neue Notiz/ }).click();
      await page.getByPlaceholder(/features of Marfan syndrome|Merkmale des Marfan-Syndroms/i).fill("Review the key diagnostic criteria before my exam.");
      await page.getByRole("button", { name: /Save as study note|Als Lernnotiz speichern/ }).click();

      await expect.poll(() => state.noteTransformWrites).toHaveLength(1);
      await expect.poll(() => state.noteListReads).toBeGreaterThan(initialReads);
      await expect(page.getByText("Fixture generated flash-note", { exact: true })).toBeVisible();
      await expect(page.getByText("No notes yet", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: shot("library-new-flash-note-visible", viewport.width, viewport.height), fullPage: true });
    } finally { await context.close(); }
  }
});

test("learner question tools: AI, translation, note edit, bookmark, and flag on phone, tablet, and desktop", async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    const { context, page, state } = await fixture(browser, { ...viewport, role: "admin", tier: "pro" });
    try {
      await page.goto("/quiz?topic=Neurologie&examSource=kmp_innsbruck&limit=3", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-question-text]")).toContainText("Fixture question");
      await expect.poll(() => state.authMeReads).toBeGreaterThan(0);
      if (viewport.width === 1440) {
        await page.getByRole("button", { name: "Feedback / Report a problem" }).click();
        const feedback = page.getByRole("textbox", { name: /feedback message/i });
        await expect(feedback).toBeVisible();
        const originalQuestion = await page.locator("[data-question-text]").innerText();
        await feedback.focus();
        await page.keyboard.type("abcde works fine");
        await expect(feedback).toHaveValue("abcde works fine");
        await expect(page.locator("[data-question-text]")).toHaveText(originalQuestion);
        expect(state.answerWrites).toHaveLength(0);
        await page.screenshot({ path: shot("feedback-keyboard-safe", viewport.width, viewport.height), fullPage: true });
        await page.getByRole("button", { name: /^Close$/i }).click();
      }
      await page.getByRole("button", { name: /Correct option/ }).first().click();
      await expect(page.getByRole("tab", { name: "AI Explanation" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Notes" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Translate" })).toBeVisible();
      await page.screenshot({ path: shot("quiz-answered", viewport.width, viewport.height), fullPage: true });

      await page.getByRole("button", { name: "Bookmark" }).click();
      await expect.poll(() => state.bookmarks).toEqual([NEUROLOGY_QID]);

      await page.getByRole("tab", { name: "AI Explanation" }).click();
      await expect(page.getByText(/Fixture AI explanation/)).toBeVisible();
      await page.screenshot({ path: shot("ai-explanation", viewport.width, viewport.height), fullPage: true });
      const followup = page.getByRole("textbox", { name: "Ask a follow-up question" });
      await followup.fill("Why is the other choice incorrect?");
      await page.getByRole("button", { name: "Send follow-up question" }).click();
      await expect(page.getByText(/Fixture follow-up answer/)).toBeVisible();

      await page.getByRole("tab", { name: "Translate" }).click();
      await page.getByRole("button", { name: "Language" }).click();
      await page.getByRole("option", { name: /Русский/ }).click();
      await expect(page.getByText("Fixture translated explanation.")).toBeVisible();
      expect(state.translateWrites).toHaveLength(1);
      await page.screenshot({ path: shot("translation", viewport.width, viewport.height), fullPage: true });

      await page.getByRole("tab", { name: "Notes" }).click();
      const noteInput = page.getByPlaceholder(/write|note|notiz/i).first();
      await noteInput.fill("First fixture note");
      await page.getByRole("button", { name: /Save|Add Note/i }).first().click();
      await expect(page.getByText("First fixture note")).toBeVisible();
      await page.getByRole("button", { name: "Edit note" }).click();
      await page.locator('[role="tabpanel"] textarea').first().fill("Edited fixture note");
      await page.getByRole("button", { name: /Save/i }).last().click();
      await expect(page.getByText("Edited fixture note")).toBeVisible();
      await page.screenshot({ path: shot("notes-edited", viewport.width, viewport.height), fullPage: true });

      await page.getByRole("button", { name: "Report", exact: true }).click();
      await page.getByRole("button", { name: /^Report a problem/ }).click();
      // a23 (PRA-35): one report dialog, reasons as a radiogroup, only a stored report is thanked.
      await page.getByRole("radio", { name: "Wrong answer" }).click();
      await page.getByRole("button", { name: "Submit", exact: true }).click();
      await expect(page.getByTestId("report-ack")).toBeVisible();
      expect(state.suggestionWrites).toHaveLength(1);
      await page.screenshot({ path: shot("flag-confirmation", viewport.width, viewport.height), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    } finally { await context.close(); }
  }
});

test("Progress shows and removes only authenticated account bookmarks on phone and desktop", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { context, page, state } = await fixture(browser, { ...viewport, lang: "en", role: "user", tier: "pro" });
    state.bookmarks = [NEUROLOGY_QID];
    await page.addInitScript(() => localStorage.setItem("medpruef_favorites", JSON.stringify([999_001])));
    try {
      await page.goto("/progress#saved", { waitUntil: "domcontentloaded" });
      const savedTab = page.getByRole("tab", { name: /Bookmarked Questions/ });
      await expect(savedTab).toContainText("1");
      await expect(page.getByText("Fixture question " + NEUROLOGY_QID, { exact: true })).toBeVisible();
      await expect(page.getByText("Question #999001", { exact: true })).toHaveCount(0);
      await page.getByTitle("Remove").click();
      await expect(savedTab).toContainText("0");
      await expect.poll(() => state.bookmarks).toEqual([]);
      expect(page.url()).toContain("/progress");
    } finally { await context.close(); }
  }
});

test("Progress requires confirmation before importing legacy browser bookmarks", async ({ browser }) => {
  const { context, page, state } = await fixture(browser, { width: 390, height: 844, lang: "en", role: "user", tier: "pro" });
  await page.addInitScript(() => localStorage.setItem("medpruef_favorites", JSON.stringify([999_001])));
  try {
    await page.goto("/progress#saved", { waitUntil: "domcontentloaded" });
    const importButton = page.getByRole("button", { name: "Review and import older bookmarks" });
    await expect(importButton).toBeVisible();
    await expect(page.getByText("Question #999001", { exact: true })).toHaveCount(0);
    const confirmation: string[] = [];
    page.once("dialog", async (dialog) => { confirmation.push(dialog.message()); await dialog.accept(); });
    await importButton.click();
    await expect.poll(() => state.bookmarks).toEqual([999_001]);
    expect(confirmation[0]).toContain("Import unassigned bookmarks");
    await expect(page.getByText("Fixture question 999001", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("medpruef_favorites"))).toBe(JSON.stringify([999_001]));
  } finally { await context.close(); }
});

test("signed-out Progress never reads ownerless quiz history or profile date", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem("medpruef-lang", "en");
    localStorage.setItem("medpruef_quiz_results", JSON.stringify([{ timestamp: new Date().toISOString(), correct: true }]));
    localStorage.setItem("medpruef_profile", JSON.stringify({ targetDate: "2032-12-31" }));
    const original = Storage.prototype.getItem;
    localStorage.setItem("__test_ownerless_reads", "[]");
    Storage.prototype.getItem = function (key: string) {
      if (key === "medpruef_quiz_results" || key === "medpruef_profile") {
        const reads = JSON.parse(original.call(this, "__test_ownerless_reads") || "[]") as string[];
        reads.push(key);
        this.setItem("__test_ownerless_reads", JSON.stringify(reads));
      }
      return original.call(this, key);
    };
  });
  try {
    await page.goto("/progress", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Sign in to see your progress" })).toBeVisible();
    const ownerlessReads = await page.evaluate(() => JSON.parse(localStorage.getItem("__test_ownerless_reads") || "[]"));
    expect(ownerlessReads).toEqual([]);
  } finally { await context.close(); }
});

test("Settings clears only the active account bookmark cache and server flags", async ({ browser }) => {
  const { context, page, state } = await fixture(browser, { width: 1440, height: 900, lang: "en", role: "user", tier: "pro" });
  state.bookmarks = [11];
  await page.addInitScript(() => {
    localStorage.setItem("medpruef_favorites:ux-flow-fixture", JSON.stringify([11]));
    localStorage.setItem("medpruef_favorites:other-account", JSON.stringify([22]));
    localStorage.setItem("medpruef_favorites", JSON.stringify([33]));
  });
  try {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Clear Study Data" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Clear Study Data" }).click();
    await expect.poll(() => state.bookmarks).toEqual([]);
    const storage = await page.evaluate(() => ({
      current: localStorage.getItem("medpruef_favorites:ux-flow-fixture"),
      other: localStorage.getItem("medpruef_favorites:other-account"),
      legacy: localStorage.getItem("medpruef_favorites"),
    }));
    expect(storage.current).toBeNull();
    expect(storage.other).toBe(JSON.stringify([22]));
    expect(storage.legacy).toBe(JSON.stringify([33]));
  } finally { await context.close(); }
});

test("Settings replaces stale cached exam and date with the server preference", async ({ browser }) => {
  const { context, page } = await fixture(browser, {
    width: 390,
    height: 844,
    lang: "en",
    role: "admin",
    tier: "pro",
    cachedActiveExam: "kmp_innsbruck",
    cachedTargetDate: "2031-12-31",
    serverExamPreference: { activeExam: "kenntnispruefung", examDate: "2026-06-15" },
  });
  try {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Kenntnisprüfung", { exact: true })).toBeVisible();
    await expect(page.getByText("15 Jun 2026", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Feedback / Report a problem" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Language" })).toBeVisible();
    await page.screenshot({ path: shot("settings-language-picker-phone", 390, 844), fullPage: true });
    const cachedSession = await page.evaluate(() => JSON.parse(localStorage.getItem("medpruef_session") || "{}"));
    expect(cachedSession.user.active_exam).toBe("kenntnispruefung");
    const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("medpruef_profile") || "{}"));
    expect(profile.targetDate).toBe("2031-12-31");
  } finally { await context.close(); }
});

test("Progress uses the server exam preference instead of a stale browser cache", async ({ browser }) => {
  const { context, page, state } = await fixture(browser, {
    width: 390,
    height: 844,
    lang: "de",
    cachedActiveExam: "kenntnispruefung",
    serverExamPreference: { activeExam: "kmp_innsbruck", examDate: null },
  });
  try {
    await page.goto("/progress", { waitUntil: "domcontentloaded" });
    await expect.poll(() => state.topicProgressQueries).toContain("kmp_innsbruck");
    await expect(page.getByText(/2\.742 im gewählten Examen/)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("medpruef_exam_source"))).toBe("kmp_innsbruck");
    await page.screenshot({ path: shot("progress-server-exam-preference-phone", 390, 844), fullPage: true });
  } finally { await context.close(); }
});

test("custom exam bookmark filter uses the signed-in account bookmark list", async ({ browser }) => {
  const { context, page, state } = await fixture(browser, { width: 1440, height: 900, lang: "en", role: "user", tier: "pro" });
  state.bookmarks = [NEUROLOGY_QID];
  try {
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    const bookmarkFilter = page.getByLabel(/Only bookmarked|Bookmarked only/i);
    await bookmarkFilter.check();
    await expect.poll(() => state.questionQueries.some((query) => query.includes(`ids=${NEUROLOGY_QID}`))).toBe(true);
    await expect(page.getByRole("button", { name: /Start Exam/ })).toBeEnabled();
  } finally { await context.close(); }
});

test("an incomplete exam load keeps Start Exam disabled and offers a retry", async ({ browser }) => {
  const { context, page, state } = await fixture(browser, {
    width: 390,
    height: 844,
    lang: "en",
    partialExamTopic: "Chirurgische Fächer",
  });
  try {
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    const startButton = page.getByRole("button", { name: /Start Exam/ });
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(page.locator("main [role=alert]").first()).toContainText("Chirurgische Fächer: 9/28");
    await expect(startButton).toBeDisabled();
    const retryButton = page.getByRole("button", { name: "Try again" });
    await expect(retryButton).toBeEnabled();
    await expect(page.getByText(/Q1 \/ 180/)).toHaveCount(0);
    expect(state.examWrites).toHaveLength(0);
    await retryButton.click();
    await expect(page.getByText(/Q1 \/ 180/).first()).toBeVisible({ timeout: 15_000 });
    expect(state.examWrites).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("Study now and topic practice start fresh without flashing the quiz builder or resuming an old run", async ({ browser }) => {
  for (const topic of [null, "Neurologie"] as const) {
    const config: QuizConfig = {
      topics: topic ? [topic] : [],
      tags: [],
      targetCount: 20,
      timeLimitMin: null,
      examDateFrom: null,
      examDateTo: null,
      examSource: "kenntnispruefung",
    };
    const staleScope = studyScope("ux-flow-fixture", config, "unseen");
    const { context, page, state } = await fixture(browser, {
      width: 390,
      height: 844,
      lang: "en",
      delayExamPreferenceMs: 800,
      seedStudyScope: staleScope,
    });
    try {
      const target = topic
        ? `/quiz?topic=${encodeURIComponent(topic)}&examSource=kenntnispruefung&practiceMode=unseen`
        : "/quiz?topic=random&examSource=kenntnispruefung&practiceMode=unseen";
      await page.goto(target, { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-quiz-initializing="true"]')).toBeVisible();
      await expect(page.getByRole("heading", { name: "Customize your quiz" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Create new test" })).toHaveCount(0);
      await expect(page.locator("[data-question-text]")).toContainText("Fixture question", { timeout: 15_000 });
      await expect(page.getByText("Resume your session?")).toHaveCount(0);
      expect(state.answerWrites).toHaveLength(0);
      if (topic) await page.screenshot({ path: shot("study-now-fresh-practice", 390, 844) });
    } finally {
      await context.close();
    }
  }
});

test("unseen Study now practice continues beyond the daily goal on phone and desktop", async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const { context, page, state } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.goto("/quiz?topic=Neurologie&examSource=kenntnispruefung&practiceMode=unseen", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-question-text]")).toContainText("Fixture question", { timeout: 15_000 });
    // a23 (PRA-11 interim): one session line replaces the open-practice paragraphs.
    await expect(page.getByText("0 answered in this session")).toBeVisible();
    await expect(page.getByText("Q1", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: shot("study-now-continuous-practice", 390, 844), fullPage: true });

    for (let answered = 1; answered <= 21; answered++) {
      if (answered === 20) await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("button", { name: /Correct option/ }).first().click();
      await expect.poll(() => state.answerWrites).toHaveLength(answered);
      await expect(page.getByRole("button", { name: "Next question" })).toBeVisible();
      await page.getByRole("button", { name: "Next question" }).click();
      if (answered < 21) {
        await expect(page.locator("[data-question-text]")).toContainText("Fixture question");
      }
      if (answered === 20) {
        await expect(page.getByText("Q21", { exact: true }).first()).toBeVisible();
        await page.screenshot({ path: shot("study-now-past-daily-goal", 1440, 900), fullPage: true });
      }
    }

    await expect(page.getByText("Q22", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Strong round|Solid round|Keep going|Every miss counts/ })).toHaveCount(0);
    expect(state.answerWrites).toHaveLength(21);
  } finally {
    await context.close();
  }
});

test("an explicitly limited quiz still finishes at its selected question count", async ({ browser }) => {
  const { context, page, state } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.goto("/quiz?topic=Neurologie&examSource=kenntnispruefung&practiceMode=all&limit=2", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-question-text]")).toContainText("Fixture question", { timeout: 15_000 });
    await page.getByRole("combobox", { name: "Study mode" }).selectOption("unseen");
    await expect(page).toHaveURL(/practiceMode=unseen.*limit=2|limit=2.*practiceMode=unseen/);
    await expect(page.locator("[data-question-text]")).toContainText("Fixture question", { timeout: 15_000 });
    for (let answered = 1; answered <= 2; answered++) {
      await page.getByRole("button", { name: /Correct option/ }).first().click();
      await expect.poll(() => state.answerWrites).toHaveLength(answered);
      if (answered === 1) {
        await expect(page.getByRole("button", { name: "Next question" })).toBeVisible();
        await page.getByRole("button", { name: "Next question" }).click();
        await expect(page.locator("[data-question-text]")).toContainText("Fixture question");
      }
    }
    await expect(page.getByRole("button", { name: "Finish quiz" })).toBeVisible();
    await page.getByRole("button", { name: "Finish quiz" }).click();
    await expect(page.getByRole("heading", { name: "Perfect!" })).toBeVisible();
    await expect(page.getByText("2 of 2 questions answered")).toBeVisible();
    expect(state.answerWrites).toHaveLength(2);
  } finally {
    await context.close();
  }
});

test("Create a test stays an explicit flow, separate from timed exam simulation", async ({ browser }) => {
  const { context, page } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.goto("/quiz?setup=1&examSource=kenntnispruefung", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Create new test" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Exam Simulation" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("full 180-question exam goes from start through saved results and review", async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const { context, page, state } = await fixture(browser, { width: 1440, height: 900, lang: "en" });
  try {
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Start Exam/ })).toBeVisible();
    await page.screenshot({ path: shot("exam-entry", 1440, 900), fullPage: true });
    await page.getByRole("button", { name: /Start Exam/ }).click();
    await expect(page.getByText(/Q1 \/ 180/).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: shot("exam-active", 1440, 900), fullPage: true });
    // Every option is a synthetic correct answer. Dispatch native DOM clicks
    // to the same rendered radio and next controls from one browser task. This
    // still runs the app's React handlers and UI state transitions, while
    // avoiding hundreds of slow host-to-browser locator round trips.
    await page.evaluate(async () => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const main = document.querySelector("main");
      if (!main) throw new Error("Exam main surface is missing");
      for (let i = 0; i < 180; i++) {
        const radio = Array.from(main.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && el.textContent?.includes("Correct option");
        });
        if (!radio) throw new Error(`No answer option rendered at question ${i + 1}`);
        radio.click();
        await nextFrame();
        if (i < 179) {
          const next = main.querySelector<HTMLButtonElement>(".flex.items-center.justify-between.gap-2.mb-4 .flex.gap-2.flex-1.max-w-sm button:last-child");
          if (!next || next.disabled) throw new Error(`Next control unavailable at question ${i + 1}`);
          next.click();
          await nextFrame();
        }
      }
    });
    await page.getByRole("button", { name: /Submit Exam/ }).first().click();
    await page.getByRole("button", { name: /Submit Exam/ }).last().click();
    await expect(page.getByRole("heading", { name: "Exam Completed" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("180 / 180 correct")).toBeVisible();
    await expect.poll(() => state.examWrites.length).toBe(1);
    expect(state.examWrites[0].question_ids).toHaveLength(180);
    expect(state.examWrites[0].answers && Object.keys(state.examWrites[0].answers)).toHaveLength(180);
    await page.screenshot({ path: shot("exam-results", 1440, 900), fullPage: true });
    await page.getByRole("button", { name: /Review Answers/ }).click();
    await expect(page.getByText(/Correct option/).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: shot("exam-review", 390, 844), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally { await context.close(); }
});

test("an ownerless legacy exam requires explicit ownership confirmation before resume", async ({ browser }) => {
  const { context, page } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.addInitScript(() => {
      localStorage.setItem("medpruef_exam_autosave", JSON.stringify({
        v: 1,
        startedAt: Date.now(),
        questions: [{
          id: 88001,
          topic: "Neurologie",
          question: "Legacy ownerless fixture question",
          answer: "Correct option",
          explanation: "Fixture explanation.",
          difficulty: 1,
          exam_dates: [],
          options: [{ text: "Correct option", correct: true }, { text: "Other option", correct: false }],
        }],
        answers: { 0: [0] },
        flaggedIdxs: [],
        currentIdx: 0,
        selectedPart: "all",
        examSource: "kenntnispruefung",
        attemptId: "legacy-ownerless-fixture",
        savedAt: Date.now(),
      }));
    });
    await page.goto("/exam", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("An unsaved exam was found on this device")).toBeVisible();
    await expect(page.getByText("This older save is not linked to an account. Continue only if you started it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume my exam" })).toBeVisible();
    await page.getByRole("button", { name: "Resume my exam" }).click();
    await expect(page.getByText("Legacy ownerless fixture question")).toBeVisible();
    const ownershipMove = await page.evaluate(() => ({
      legacy: localStorage.getItem("medpruef_exam_autosave"),
      scoped: localStorage.getItem("medpruef_exam_autosave:v1:ux-flow-fixture"),
    }));
    expect(ownershipMove.legacy).toBeNull();
    expect(ownershipMove.scoped).toContain("legacy-ownerless-fixture");
  } finally { await context.close(); }
});

test("materials, referral, and mocked checkout return are reachable at mobile and desktop widths", async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { context, page, state } = await fixture(browser, { ...viewport, tier: "free" });
    try {
      await page.goto("/materials", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();
      await expect(page.getByText("Our own guides for your path. Coming soon.")).toBeVisible();
      await page.screenshot({ path: shot("materials", viewport.width, viewport.height), fullPage: true });

      await page.goto("/referrals", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("https://medpruf.com/register?ref=fixture")).toBeVisible();
      await page.screenshot({ path: shot("referrals", viewport.width, viewport.height), fullPage: true });

      await page.goto("/pricing", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Pass first try/i })).toBeVisible();
      await page.screenshot({ path: shot("pricing", viewport.width, viewport.height), fullPage: true });
      const cta = page.getByRole("button", { name: "Start 3 months for 49 €" });
      await cta.click();
      await expect.poll(() => state.checkoutWrites.length).toBe(1);
      expect(state.checkoutWrites[0]).toHaveProperty("tier");
      await expect(page.getByRole("heading", { name: "Mock checkout" })).toBeVisible();
      await page.getByRole("link", { name: "Cancel and return" }).click();
      await expect(page).toHaveURL(/\/pricing\?checkout=cancelled/);
      await expect(page.getByRole("heading", { name: /Pass first try/i })).toBeVisible();
      await page.screenshot({ path: shot("checkout-cancel-return", viewport.width, viewport.height), fullPage: true });
    } finally { await context.close(); }
  }
});

test("pricing phone layout keeps the floating support launcher off the plan cards", async ({ browser }) => {
  const { context, page } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Start free: 150 questions/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open help & feedback" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Common questions" })).toBeVisible();
  } finally { await context.close(); }
});

test("flashcard rating advances the queue and feedback submits without external writes at phone and desktop sizes", async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { context, page, state } = await fixture(browser, { ...viewport, tier: "pro" });
    try {
      await page.goto("/flashcards?topic=random", { waitUntil: "domcontentloaded" });
      await expect(page.getByText(`Fixture question ${RANDOM_QID}`).first()).toBeVisible();
      await page.screenshot({ path: shot("flashcard-front", viewport.width, viewport.height), fullPage: true });
      await page.getByRole("button", { name: /Show Answer/i }).click();
      await expect(page.getByText("How well did you know it?")).toBeVisible();
      await page.screenshot({ path: shot("flashcard-rating", viewport.width, viewport.height), fullPage: true });
      await page.getByRole("button", { name: /^Good,/ }).click();
      await expect.poll(() => state.answerWrites.length).toBe(1);
      await expect(page.getByText(`Fixture question ${RANDOM_QID + 1}`).first()).toBeVisible({ timeout: 10_000 });
      expect(state.answerWrites[0]).toMatchObject({ questionId: RANDOM_QID, isCorrect: true });
      await page.screenshot({ path: shot("flashcard-next-after-rating", viewport.width, viewport.height), fullPage: true });

      await expect(page.getByRole("button", { name: "Chat with us" })).toHaveCount(0);
      await page.getByRole("button", { name: "Feedback / Report a problem" }).click();
      await expect(page.getByRole("textbox", { name: "Feedback message" })).toBeVisible();
      await page.screenshot({ path: shot("feedback-form", viewport.width, viewport.height), fullPage: true });
      await page.getByRole("textbox", { name: "Feedback message" }).fill("Synthetic UX review feedback.");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("Thank you!", { exact: true })).toBeVisible();
      expect(state.feedbackWrites).toHaveLength(1);
      await page.screenshot({ path: shot("feedback-confirmation", viewport.width, viewport.height), fullPage: true });
    } finally { await context.close(); }
  }
});

test("very long flashcard stem remains scrollable on a phone", async ({ browser }) => {
  const { context, page } = await fixture(browser, { width: 390, height: 844, lang: "en" });
  try {
    await page.goto("/flashcards?topic=Long&examSource=kenntnispruefung", { waitUntil: "domcontentloaded" });
    // a23 (PRA-63): the back face repeats the stem as a two-line preview; the front is the first.
    const stem = page.getByText(/^Long flashcard stem\./).first();
    await expect(stem).toBeVisible();
    const scrollRegion = stem.locator("xpath=../..");
    const dimensions = await scrollRegion.evaluate((element) => {
      const node = element as HTMLElement;
      return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
    });
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    const scrollTop = await scrollRegion.evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollTop = node.scrollHeight;
      return node.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
    await page.screenshot({ path: shot("flashcard-long-stem-scroll-phone", 390, 844), fullPage: true });
  } finally { await context.close(); }
});

test("long mistake-list reading stays clear of the floating launcher on a phone", async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const viewport = { width: 390, height: 844 };
  const { context, page } = await fixture(browser, { ...viewport, lang: "en", tier: "pro" });
  try {
    await page.goto("/mistakes?topic=Long&examSource=kenntnispruefung", { waitUntil: "domcontentloaded" });
    const stem = page.getByText(/^Long flashcard stem\./).first();
    await expect(stem).toBeVisible();
    await expect(page.getByRole("button", { name: "Open help & feedback" })).toHaveCount(0);
    await page.screenshot({ path: shot("mistake-list-long-stem-phone", viewport.width, viewport.height) });
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByRole("link", { name: "Review mistakes" })).toBeVisible();
  } finally { await context.close(); }
});

// a37 (TR-30, MUX-90): the AI tab is labelled as AI, every real AI answer says it
// can be wrong, and one tap opens the report form with the AI reason preset.
test("AI explanation tab: KI badge, error line and one-tap report in DE and EN, light and dark, 375 and 1280", async ({ browser }, testInfo) => {
  testInfo.setTimeout(240_000);
  for (const lang of ["de", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
        const { context, page, state } = await fixture(browser, { ...viewport, lang, theme, role: "user", tier: "pro" });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED|ERR_ABORTED/.test(m.text())) errors.push(m.text()); });
        try {
          await page.goto("/quiz?topic=Neurologie&examSource=kmp_innsbruck&limit=3", { waitUntil: "domcontentloaded" });
          await expect(page.locator("[data-question-text]")).toContainText("Fixture question");
          await page.getByRole("button", { name: /Correct option/ }).first().click();
          const tabName = lang === "de" ? "KI-Erklärung" : "AI Explanation";
          await page.getByRole("tab", { name: tabName }).click();
          const panel = page.locator("[data-ai-trust]").first();
          await expect(panel).toContainText(lang === "de" ? "KI-generiert, kann Fehler enthalten." : "AI-generated, may contain errors.");
          await expect(page.locator("[data-ai-badge]").first()).toHaveText(lang === "de" ? "KI" : "AI");
          await expect(page.getByText(/MedPrüf Assistent|MedPrüf Assistant/)).toHaveCount(0);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);
          await page.screenshot({ path: shot(`a37-ai-trust-${lang}-${theme}`, viewport.width, viewport.height), fullPage: true });
          await page.getByRole("button", { name: lang === "de" ? "Fehler in der KI-Erklärung melden" : "Report an error in the AI explanation" }).click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole("radio", { name: lang === "de" ? "KI-Erklärung falsch" : "AI explanation wrong" })).toHaveAttribute("aria-checked", "true");
          expect(state.suggestionWrites).toHaveLength(0);
          expect(errors).toEqual([]);
        } finally { await context.close(); }
      }
    }
  }
});
