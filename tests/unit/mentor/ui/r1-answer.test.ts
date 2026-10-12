import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MentorAnswerBlock, MentorCitation, MentorNextAction, MentorFinalEvent } from "@/lib/mentor/contract";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
import { answerCopy, ANSWER_COPY_AR_DRAFT, ANSWER_COPY_REVIEW } from "@/components/mentor/answer-copy";
import { isOlderSource, orderedActions, sourceDate, sourceHintStorageKey, visibleAnswer, withoutInlineSourceStamp } from "@/components/mentor/answer-view";

vi.mock("@/components/ui", () => ({ Dialog: () => null, Alert: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children) }));
import { AnswerBlocks, NextActions, SourceChips, StudyPlanRows } from "@/components/mentor/AnswerDetails";
import { AssistantBubble, UserBubble } from "@/components/mentor/ChatMessage";
(globalThis as { React?: unknown }).React = React;

const SOURCE: MentorCitation = { fact_id: "fixture.date", source_label: "Synthetic official source with a long wrapping office label", source_url: "https://example.org/synthetic-source", read_on: "2026-10-01", review_every_days: 10 };
const renderAnswer = (final: Partial<MentorFinalEvent>) => renderToStaticMarkup(createElement(AssistantBubble, { msg: { id: "a", role: "assistant", status: "done", text: "", final: { ...FIXTURE_FINAL_OK, ...final } }, lang: "en", packagesHref: null, waitSeconds: 0, onRetry() {}, onNewChat() {}, onSuggestedQuestion() {} }));

describe("MUX-01 and MUX-02 source provenance", () => {
  it("shows the checked date once and strips legacy ISO, numeric and long Stand dates", () => {
    const citations = [SOURCE];
    for (const stamp of ["Stand 2026-10-01", "(Stand 01.10.2026)", "Stand 1. Oktober 2026"]) {
      const html = renderToStaticMarkup(createElement(AnswerBlocks, { blocks: [{ text: `Keep this fact. ${stamp}`, fact_ids: [SOURCE.fact_id] }], citations, lang: "en" }));
      expect(html).toContain("Keep this fact.");
      expect(html).not.toContain("Stand");
    }
    expect(withoutInlineSourceStamp("Keep the Stand der Forschung unchanged.")).toBe("Keep the Stand der Forschung unchanged.");
    const sourceHtml = renderToStaticMarkup(createElement(SourceChips, { citations: [SOURCE, SOURCE], lang: "en", now: new Date("2026-10-01T12:00:00Z") }));
    expect(sourceHtml.match(/Source checked on 1 Oct 2026<\/span>/g)).toHaveLength(1);
    expect(sourceHtml).toContain("min-h-11");
    expect(sourceHtml).toContain("text-[12px]");
    expect(sourceHtml).not.toContain("truncate");
  });

  it("formats checked dates and explicit source labels in every supported UI language", () => {
    expect(answerCopy("source_checked", "de", { date: sourceDate(SOURCE.read_on, "de") })).toBe("Quelle geprüft am 1. Oktober 2026");
    for (const lang of ["en", "ru", "uk", "tr"] as const) {
      const label = answerCopy("source_checked", lang, { date: sourceDate(SOURCE.read_on, lang) });
      expect(label).not.toContain("Stand");
      expect(label).not.toContain("{date}");
      expect(label).toContain("2026");
    }
    expect(answerCopy("source_checked", "ar", { date: "1 Oct 2026" })).toBe("Source checked on 1 Oct 2026");
    expect(ANSWER_COPY_AR_DRAFT.source_checked).toContain("{date}");
    expect(ANSWER_COPY_REVIEW.ar.source_checked.status).toBe("needs [name] sign-off");
    expect(ANSWER_COPY_REVIEW.ru.source_checked.reviewer_sign_off).toBeNull();
  });

  it("removes source stamps in 50 multilingual UI samples while preserving the cited exam date", () => {
    // Synthetic rendering gate, not a live model or native-language review claim.
    const stamps = ["Stand 2026-10-01", "(Stand: 2026-10-01)", "Stand 01.10.2026", "Stand 1. 10. 2026", "Stand 1 Oktober 2026", "Stand 1. Oktober 2026", "Stand 1. Okt. 2026", "Stand vom 1. Oktober 2026", "Stand: 1/10/2026", "Stand October 1, 2026"];
    const languages = {
      de: "Der nächste Termin ist der 17. November 2026.",
      en: "The next date is 17 November 2026.",
      ru: "Следующая дата: 17 ноября 2026.",
      uk: "Наступна дата: 17 листопада 2026.",
      tr: "Sonraki tarih 17 Kasım 2026.",
    } as const;
    let rendered = 0;
    for (const lang of Object.keys(languages) as Array<keyof typeof languages>) {
      for (const stamp of stamps) {
        const html = renderToStaticMarkup(createElement(AnswerBlocks, { blocks: [{ text: `${languages[lang]} ${stamp}`, fact_ids: [SOURCE.fact_id] }], citations: [SOURCE], lang }));
        expect(html, `${lang}: ${stamp}`).not.toMatch(/\bStand\b/i);
        expect(html, `${lang}: ${stamp}`).toContain(languages[lang]);
        expect(html, `${lang}: ${stamp}`).not.toContain("2026-10-01");
        const chip = renderToStaticMarkup(createElement(SourceChips, { citations: [SOURCE], lang, now: new Date("2026-10-01T12:00:00Z") }));
        const visibleMeta = answerCopy("source_checked", lang, { date: sourceDate(SOURCE.read_on, lang) });
        expect(chip).toContain(`${visibleMeta}</span>`);
        rendered++;
      }
    }
    expect(rendered).toBe(50);
    expect(withoutInlineSourceStamp("Der Stand der Forschung bleibt unverändert. Der Termin ist der 17. November 2026.")).toBe("Der Stand der Forschung bleibt unverändert. Der Termin ist der 17. November 2026.");
  });

  it("uses neutral university choice copy and keeps every Arabic draft pending [name] sign-off", () => {
    expect(answerCopy("filing_question", "de")).toBe("Für welche Universität?");
    expect(answerCopy("filing_question", "en")).toBe("For which university?");
    expect(answerCopy("filing_selected", "de", { university: "MedUni Wien" })).toBe("Sie haben MedUni Wien gewählt.");
    expect(answerCopy("filing_selected", "en", { university: "MedUni Wien" })).toBe("You chose MedUni Wien.");
    for (const lang of ["ru", "uk", "tr"] as const) {
      expect(answerCopy("filing_question", lang)).not.toMatch(/нострификацию|нострифікацію|Denklik başvurunu/);
      expect(answerCopy("filing_selected", lang, { university: "MedUni Wien" })).not.toMatch(/подано|Başvuru/);
      expect(ANSWER_COPY_REVIEW[lang].filing_question.reviewer_sign_off).toBeNull();
    }
    for (const key of Object.keys(ANSWER_COPY_AR_DRAFT)) {
      expect(ANSWER_COPY_REVIEW.ar[key]).toEqual({ reviewer_sign_off: null, status: "needs [name] sign-off" });
    }
    expect(ANSWER_COPY_AR_DRAFT.filing_selected).toBe("إنت اخترت {university}.");
    expect(answerCopy("filing_question", "ar")).toBe("For which university?");
  });

  it("adds an explicit clock and Older label at 70 percent, with a stronger footer", () => {
    expect(isOlderSource(SOURCE, new Date("2026-10-07T12:00:00Z"))).toBe(false);
    expect(isOlderSource(SOURCE, new Date("2026-10-08T00:00:00Z"))).toBe(true);
    expect(isOlderSource({ ...SOURCE, review_every_days: undefined }, new Date("2026-10-08T00:00:00Z"))).toBe(false);
    const html = renderToStaticMarkup(createElement(SourceChips, { citations: [SOURCE], lang: "de", now: new Date("2026-10-08T12:00:00Z") }));
    expect(html).toContain("Älter");
    expect(html).toContain("lucide-clock");
    expect(html).toContain("var(--mp-warning-text)");
    expect(html).toContain("Diese Angabe ist älter, bitte zuerst auf der offiziellen Seite prüfen.");
  });

  it("scopes the one-time hint to a signed-session learner id, never an anonymous global key", () => {
    const key = sourceHintStorageKey("82e7fccc-06b4-4c43-8146-127cf84ed8da");
    expect(key).toBe("medpruef_mentor_source_hint:82e7fccc-06b4-4c43-8146-127cf84ed8da");
    expect(sourceHintStorageKey("guest_example")).toBeNull();
    expect(sourceHintStorageKey("")).toBeNull();
  });
});

describe("MUX-11 replacements and MUX-15 office labels", () => {
  it("collapses repeated notices and has no source chip under a fully replaced answer", () => {
    const notice: MentorAnswerBlock = { text: "I can't officially confirm this information right now. https://example.org/synthetic-source", fact_ids: [], replaced: true, official_url: SOURCE.source_url };
    const view = visibleAnswer([notice, notice], [SOURCE]);
    expect(view.blocks).toHaveLength(1);
    expect(view.citations).toEqual([]);
    const html = renderAnswer({ answer_blocks: [notice, notice], citations: [SOURCE], validator_replaced: true });
    expect(html.match(/Not confirmed/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Open official page");
    expect(html).toContain("min-h-11 w-full");
    expect(html.replace(/href="[^"]*"/g, "")).not.toContain("https://");
    expect(html).not.toContain(SOURCE.source_label);
    expect(html).not.toContain("A number or date could not be confirmed");
  });

  it("keeps a backed answer before its replacement and keeps only the surviving source", () => {
    const notice = { text: "Unconfirmed fact.", fact_ids: [], replaced: true };
    const backed = { text: "Confirmed source-backed answer.", fact_ids: [SOURCE.fact_id] };
    const view = visibleAnswer([notice, backed], [SOURCE, { ...SOURCE, fact_id: "removed.source" }]);
    expect(view.blocks).toEqual([backed, notice]);
    expect(view.citations).toEqual([SOURCE]);
  });

  it("names the code-selected office and offers a report and answerable starter for no source", () => {
    const office = renderAnswer({ answer_blocks: [], citations: [], refused: "individual_ruling", refusal_link: SOURCE.source_url, refusal_label: "Nostrifizierung MedUni Wien" });
    expect(office).toContain("Open Nostrifizierung MedUni Wien");
    expect(office).toContain("whitespace-normal break-words");
    const none = renderAnswer({ answer_blocks: [], citations: [], refused: "no_verified_source" });
    expect(none).toContain("Report question to the team");
    expect(none).toContain("How can I practise my weakest topic?");
  });
});

describe("MUX-41, MUX-55, MUX-56 and MUX-67 answer controls", () => {
  it("renders article speakers and no streaming live region", () => {
    const user = renderToStaticMarkup(createElement(UserBubble, { msg: { id: "u", role: "user", text: "Synthetic message" }, lang: "de" }));
    expect(user).toContain("<article");
    expect(user).toContain("Sie:");
    const html = renderToStaticMarkup(createElement(AssistantBubble, { msg: { id: "a", role: "assistant", status: "streaming", text: "Synthetic streaming text" }, lang: "en", packagesHref: null, waitSeconds: 0, onRetry() {}, onNewChat() {} }));
    expect(html).toContain("<article");
    expect(html).toContain("Mentor:");
    expect(html).not.toContain("aria-live");
  });

  it("shows a direct 44px question report control when final owns a question id", () => {
    expect(renderAnswer({ question_id: 5 })).toContain("Report question");
    expect(renderAnswer({ question_id: 5 })).toContain("min-h-11 items-center");
  });

  it("orders practice and save first, keeps only two primary actions and has More", () => {
    const actions: MentorNextAction[] = [{ kind: "open_question", question_id: 5 }, { kind: "save_note" }, { kind: "practice_topic", topic: "Neurologie" }, { kind: "practice_topic", topic: "Neurologie" }, { kind: "open_flashcards" }];
    expect(orderedActions(actions).map((a) => a.kind)).toEqual(["practice_topic", "save_note", "open_question", "open_flashcards"]);
    const html = renderToStaticMarkup(createElement(NextActions, { actions, lang: "de" }));
    const primary = html.slice(html.indexOf("data-mentor-next-actions"), html.indexOf("aria-expanded"));
    expect(primary.match(/<a /g)).toHaveLength(2);
    expect(html).toContain("Mehr");
    expect(html).toContain("hidden=");
    expect(html).toContain("from=mentor");
    expect(html).toContain("min-h-11 min-w-11");
  });

  it("renders 56px study rows with numeric accuracy, bar and 44px practice link", () => {
    const html = renderToStaticMarkup(createElement(StudyPlanRows, { items: [{ topic: "Neurologie", accuracy: 36, answered: 25, action: "practice", exam_source: "kenntnispruefung" }], lang: "de" }));
    expect(html).toContain("min-h-14");
    expect(html).toContain("36% richtig");
    expect(html).toContain("25 beantwortet");
    expect(html).toContain("width:36%");
    expect(html).toContain("min-h-11 min-w-11");
    expect(html).toContain("Üben");
    expect(html).toContain("examSource=kenntnispruefung");
    expect(html).toContain("from=mentor");
  });
});
