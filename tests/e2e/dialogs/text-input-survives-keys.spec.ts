/**
 * Text-input-survives-keys regression test (review-2026-04-26-A1).
 *
 * Tests that typing multi-character strings into modal/dialog
 * text inputs doesn't close the dialog or steal focus to a global
 * shortcut.
 *
 * Original bug: typing "He" into the FeedbackWidget textarea
 * triggered the QuestionCard A-E answer shortcut on the 'e' key
 * (because the narrow `instanceof HTMLTextAreaElement` guard missed
 * portaled inputs OR because typing inside a non-portaled floating
 * panel was never gated against the parent route's keydown handlers).
 * The fix wires every global keydown through `shouldIgnoreGlobalKey`
 * which walks up the DOM tree and also bails on any keypress inside
 * a `[role="dialog"]` overlay.
 */

import { test, expect } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { seedPreferences } from "../helpers/page-setup";
import { SAMPLE_USER_ID } from "../fixtures/users";

test.describe("dialog text inputs survive multi-character typing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await seedSession(page, {
      userId: SAMPLE_USER_ID,
      role: "user",
      tier: "free",
      firstName: "Test",
    });
    await seedPreferences(page);

    // Stub the announcements + auth endpoints so the page can hydrate
    // without the test DB.
    await page.route("**/api/announcements/state", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          orientation_modal_seen_at: new Date().toISOString(),
          cohort_banner_dismissed_at: new Date().toISOString(),
          referral_floater_dismissed_at: new Date().toISOString(),
          qs_answered_total: 50,
          session_count: 5,
        }),
      }),
    );
    await page.route("**/api/feedback", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  });

  test("FeedbackWidget textarea accepts 'Multi-character feedback' without losing focus or closing", async ({
    page,
  }) => {
    await page.goto("/");

    // Open the floating Feedback widget.
    await page.getByRole("button", { name: /feedback/i }).first().click();

    // Find the textarea inside the widget.
    const textarea = page.getByRole("textbox").filter({ hasText: "" });
    await textarea.waitFor({ state: "visible" });

    const phrase = "Multi-character feedback that survives typing";
    await page.keyboard.type(phrase);

    // The textarea must contain the FULL string (not just the first
    // letter) AND the widget panel must still be open.
    await expect(textarea).toHaveValue(phrase);
    // The Send button is only present when the panel is open. If the
    // dialog auto-closed mid-typing, this would fail.
    await expect(page.getByRole("button", { name: /senden|send/i })).toBeVisible();
  });

  test("typing 'aeibcd' inside FeedbackWidget on /quiz does NOT trigger A-E answer shortcuts", async ({
    page,
  }) => {
    // /quiz is the page where QuestionCard's window-level keydown
    // listener runs and where the original bug was reported. Stub
    // the questions API so a question renders.
    await page.route("**/api/questions**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          questions: [
            {
              id: 99999,
              question: "Test question?",
              choices: [
                { letter: "A", text: "Option A", correct: false },
                { letter: "B", text: "Option B", correct: false },
                { letter: "C", text: "Option C", correct: false },
                { letter: "D", text: "Option D", correct: true },
                { letter: "E", text: "Option E", correct: false },
              ],
              topic: "Test",
              exam_type: "kenntnispruefung",
              answer: "D",
              explanation: "Test",
            },
          ],
        }),
      }),
    );
    await page.route("**/api/answer", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await page.goto("/quiz?examSource=kenntnispruefung&autoStart=1");
    await page.waitForLoadState("networkidle");

    // Open feedback widget
    await page.getByRole("button", { name: /feedback/i }).first().click();
    const textarea = page.getByRole("textbox").filter({ hasText: "" });
    await textarea.waitFor({ state: "visible" });

    // Type a string that includes letters A-E. With the bug, these
    // would each select an answer option and submit the question.
    const phrase = "abcde works fine";
    await page.keyboard.type(phrase);

    await expect(textarea).toHaveValue(phrase);
    // Crucially: the question card should NOT show "submitted" /
    // result feedback (no "Richtig!" / "Nicht ganz richtig" headlines).
    // We assert that the page does not contain a result panel.
    const resultPanel = page.locator(
      'text=/Richtig|Korrekt|Nicht ganz richtig|Falsch/',
    );
    await expect(resultPanel).toHaveCount(0);
  });
});
