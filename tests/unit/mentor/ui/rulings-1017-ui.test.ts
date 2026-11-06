/**
 * Client side of the 17 Oct CEO rulings (a-mentor-fix-rulings): the UC13 practice pointer card,
 * and failed-turn notices shown in the language the learner asked in (mentor-eval-leads-1017 (2)).
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_FINAL_REFUSED } from "@/lib/mentor/fixtures";
import { CONCEPT_REFUSAL_LINES, PRACTICE_POINTER_HREF } from "@/lib/mentor/rulings-1017";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
vi.mock("@/components/ui", () => ({ Dialog: () => null, Alert: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children) }));
import { AssistantBubble, noticeLangFor } from "@/components/mentor/ChatMessage";
import { INITIAL_CHAT_STATE, chatReducer, type AssistantMsg, type ChatAction, type ChatState } from "@/components/mentor/chat-state";
import { toMentorEvent } from "@/components/mentor/sse";
import { mentorT } from "@/lib/i18n-mentor";
(globalThis as { React?: unknown }).React = React;

const bubble = (msg: AssistantMsg, lang: "de" | "en" = "en") =>
  renderToStaticMarkup(createElement(AssistantBubble, { msg, lang, packagesHref: null, waitSeconds: 0, onRetry() {}, onNewChat() {}, onRephrase() {}, onSuggestedQuestion() {} }));

describe("UC13 practice pointer", () => {
  const concept = { ...FIXTURE_FINAL_REFUSED, refused: "no_verified_source" as const, refusal_link: undefined, answer_blocks: [{ text: CONCEPT_REFUSAL_LINES.de, fact_ids: [] }], practice_pointer: true as const };

  it("renders the bank pointer, no office link and no unrelated suggested question", () => {
    const html = bubble({ id: "a", role: "assistant", status: "done", text: "", final: concept }, "de");
    expect(html).toContain("data-mentor-practice-pointer");
    expect(html).toContain(`href="${PRACTICE_POINTER_HREF}"`);
    expect(html).toContain("Fragen nach Fachgebiet üben");
    expect(html).not.toContain("example.org/mentor-fixture");
    expect(html).not.toContain("Nostrifizierung in Wien Schritt für Schritt");
    expect(html).not.toContain("Frage an das Team melden");
  });

  it("without the field the refusal card is unchanged", () => {
    const html = bubble({ id: "a", role: "assistant", status: "done", text: "", final: FIXTURE_FINAL_REFUSED }, "en");
    expect(html).not.toContain("data-mentor-practice-pointer");
    expect(html).toContain("example.org/mentor-fixture/kontakt");
  });

  it("a plain no-source refusal still offers the report to the team", () => {
    const html = bubble({ id: "a", role: "assistant", status: "done", text: "", final: { ...FIXTURE_FINAL_REFUSED, refused: "no_verified_source" } }, "de");
    expect(html).toContain("Frage an das Team melden");
  });

  it("the SSE parser keeps practice_pointer only as literal true", () => {
    const base = { ...FIXTURE_FINAL_REFUSED };
    expect((toMentorEvent({ ...base, practice_pointer: true }) as { practice_pointer?: true }).practice_pointer).toBe(true);
    expect((toMentorEvent({ ...base, practice_pointer: "/evil" }) as { practice_pointer?: true }).practice_pointer).toBeUndefined();
  });
});

describe("Arabic answers (a-ai-fix-1106; the English lead notice is retired)", () => {
  it("renders an Arabic answer with no English notice and isolates German terms left to right", () => {
    const ar = "التسجيل في Rezeptierkunde بيقفل في الميعاد اللي الجامعة بتحدده.";
    const html = bubble({ id: "a", role: "assistant", status: "done", text: "", final: { ...FIXTURE_FINAL_OK, answer_blocks: [{ ...FIXTURE_FINAL_OK.answer_blocks[0], text: ar }] } }, "en");
    expect(html).not.toContain("data-mentor-lead-notice");
    expect(html).not.toContain("The Mentor answers in English");
    expect(html).toMatch(/<bdi dir="ltr">Rezeptierkunde<\/bdi>/);
    // An old frame with the retired marker is ignored.
    expect((toMentorEvent({ ...FIXTURE_FINAL_OK, lead_notice: "arabic_english" }) as { lead_notice?: string }).lead_notice).toBeUndefined();
  });
});

describe("failed-turn notice in the answer language", () => {
  it("noticeLangFor: own UI strings for de/en/ru/uk/tr, English for fr and ar, UI language for an old message", () => {
    expect(noticeLangFor("ru", "de")).toBe("ru");
    expect(noticeLangFor("en", "de")).toBe("en");
    expect(noticeLangFor("fr", "de")).toBe("en");
    expect(noticeLangFor("ar", "de")).toBe("en");
    expect(noticeLangFor(undefined, "de")).toBe("de");
  });

  it("an outage shows in the asked language, not the UI language", () => {
    const html = bubble({ id: "a", role: "assistant", status: "error", text: "", error: "upstream_error", notCharged: true, answerLang: "en" }, "de");
    expect(html).toContain(mentorT("err_upstream_error", "en"));
    expect(html).not.toContain(mentorT("err_upstream_error", "de"));
    expect(html).toContain("No credits were deducted for this.");
    expect(html).toContain('lang="en"');
  });

  it("the reducer stores the request language on send and keeps it on retry", () => {
    const run = (actions: ChatAction[], s: ChatState = INITIAL_CHAT_STATE) => actions.reduce(chatReducer, s);
    const req = { client_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", message: "Wann?", lang: "ru" as const, mode: "facts" as const };
    const failed = run([{ type: "send", userId: "u1", assistantId: "a1", text: "Wann?", request: req }, { type: "event", event: { type: "error", error: "upstream_error", credits_deducted: false } }]);
    const last = (s: ChatState) => s.messages[s.messages.length - 1] as AssistantMsg;
    expect(last(failed).answerLang).toBe("ru");
    expect(last(run([{ type: "retry", assistantId: "a2" }], failed)).answerLang).toBe("ru");
  });
});
