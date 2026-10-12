import { describe, expect, it } from "vitest";
import { flashcardSkipReason, splitFlashcards } from "@/lib/flashcard-eligibility";
import { cleanExplanation, cutAtSentence, EXPLANATION_PREVIEW_CHARS } from "@/lib/explanation";

describe("flashcard eligibility (UX-PRA-64)", () => {
  it("keeps recall stems and open-answer cards", () => {
    expect(flashcardSkipReason({ question: "Welche Diagnose ist am wahrscheinlichsten?", n_correct: 1 })).toBeNull();
    expect(flashcardSkipReason({ question: "Nennen Sie das Antidot bei Paracetamol-Intoxikation.", n_correct: 0 })).toBeNull();
    expect(flashcardSkipReason({ question: "Was ist die Therapie der ersten Wahl bei Erysipel?" })).toBeNull();
    expect(flashcardSkipReason({ question: "Welche Therapie ist indiziert?", n_correct: 1 })).toBeNull();
  });
  it("removes multi-answer items by n_correct", () => {
    expect(flashcardSkipReason({ question: "Typische Befunde bei Morbus Basedow (3 richtige Antworten)", n_correct: 3 })).toBe("multi");
  });
  it("removes single-answer stems that need their options", () => {
    for (const stem of [
      "Welche Aussage trifft zu?",
      "Welche der folgenden Antworten ist richtig?",
      "Welche der genannten Erkrankungen gehört nicht dazu?",
      "Welche Aussagen zur Herzinsuffizienz treffen nicht zu?",
      "Zum Morbus Crohn: Was gilt?",
      "Alle folgenden sind Risikofaktoren außer?",
      "Which of the following is correct?",
      "Die Aussage zur Hyperkaliämie ist richtig?",
    ]) {
      expect(flashcardSkipReason({ question: stem, n_correct: 1 }), stem).toBe("option_dependent");
    }
  });
  it("splits a batch and counts each rule", () => {
    const split = splitFlashcards([
      { id: 1, question: "Welche Diagnose?", n_correct: 1 },
      { id: 2, question: "Welche Aussage trifft zu?", n_correct: 1 },
      { id: 3, question: "Befunde", n_correct: 2 },
    ]);
    expect(split.cards.map((c) => c.id)).toEqual([1]);
    expect(split.skippedIds).toEqual([2, 3]);
    expect(split.skipped).toEqual({ multi: 1, option_dependent: 1 });
  });
});

describe("explanation helpers (UX-PRA-27, UX-PRA-62)", () => {
  it("strips a leading bracketed stem echo that ends in a date, never a cited source", () => {
    expect(cleanExplanation("[Welche Therapie ist indiziert? 2019-03] Die korrekte Antwort ist B.")).toBe("Die korrekte Antwort ist B.");
    expect(cleanExplanation("[2016-09] [2018-03] Die korrekte Antwort ist C.")).toBe("Die korrekte Antwort ist C.");
    expect(cleanExplanation("[ESC 2023] Betablocker senken die Mortalität.")).toBe("[ESC 2023] Betablocker senken die Mortalität.");
  });
  it("keeps line breaks for markdown when asked", () => {
    expect(cleanExplanation("Punkte:\n- eins\n- zwei", { keepLines: true })).toBe("Punkte:\n- eins\n- zwei");
    expect(cleanExplanation("Punkte:\n- eins")).toBe("Punkte: - eins");
  });
  it("cuts near 600 characters at a sentence boundary", () => {
    const sentence = "Dies ist ein ganzer Satz mit genau sechzig Zeichen Länge ok. ";
    const long = sentence.repeat(15);
    const cut = cutAtSentence(long, EXPLANATION_PREVIEW_CHARS);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(EXPLANATION_PREVIEW_CHARS);
    expect(cut.text.endsWith(".")).toBe(true);
    expect(cutAtSentence("kurz.", 600)).toEqual({ text: "kurz.", truncated: false });
  });
  it("falls back to a word boundary with an ellipsis when no sentence ends in range", () => {
    const words = "wort ".repeat(200);
    const cut = cutAtSentence(words, 600);
    expect(cut.text.endsWith(" …")).toBe(true);
    expect(cut.text).not.toMatch(/wor …$/);
  });
});
