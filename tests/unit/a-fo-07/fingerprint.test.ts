/**
 * a-fo-07: the answer-key fingerprint is order independent, changes with the
 * key, and is the same on the client (options as delivered by /api/questions
 * or the offline pack) and on the server (rebuilt from the row).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  answerKeyFingerprint,
  answerKeyOptions,
  checkAnswerKey,
  isWellFormedFingerprint,
  LEGACY_FINGERPRINT_GRACE_MS,
  normalizeOptionText,
  readAnswerKeyGuardMode,
  rowKeyFingerprint,
  sha256Hex,
} from "@/lib/answer-key-fingerprint";
import { buildMCQFromChoices, buildMCQFromStored, shuffle, type StoredChoice } from "@/lib/mcq";

const CHOICES: StoredChoice[] = [
  { text: "Adrenalin 1 mg i.v.", correct: true, position: 0 },
  { text: "Amiodaron 300 mg", correct: false, position: 1 },
  { text: "Atropin 0,5 mg", correct: false, position: 2 },
  { text: "Lidocain", correct: false, position: 3 },
  { text: "?", correct: false, position: 4 },
];

describe("sha256Hex", () => {
  it("equals node:crypto for ASCII, umlauts, Cyrillic, Arabic and long input", () => {
    for (const input of ["", "abc", "Prüfung Österreich", "вопрос", "سؤال", "x".repeat(1000), "🩺 emoji"]) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
    }
  });
});

describe("answerKeyFingerprint", () => {
  const server = rowKeyFingerprint(42, { choices: CHOICES, answer: "Adrenalin 1 mg i.v.", distractors: [] });

  it("is well formed", () => {
    expect(isWellFormedFingerprint(server)).toBe(true);
    expect(isWellFormedFingerprint("k1:abc")).toBe(false);
    expect(isWellFormedFingerprint(42)).toBe(false);
  });

  it("is stable under the per-load shuffle", () => {
    for (let i = 0; i < 25; i++) {
      expect(answerKeyFingerprint(42, buildMCQFromChoices(CHOICES))).toBe(server);
      expect(answerKeyFingerprint(42, shuffle(buildMCQFromChoices(CHOICES)))).toBe(server);
    }
  });

  it("changes when a correct flag, an option text or the question id changes", () => {
    const reKeyed = CHOICES.map((c, i) => ({ ...c, correct: i === 1 }));
    expect(rowKeyFingerprint(42, { choices: reKeyed })).not.toBe(server);
    const multi = CHOICES.map((c, i) => ({ ...c, correct: c.correct || i === 2 }));
    expect(rowKeyFingerprint(42, { choices: multi })).not.toBe(server);
    const typo = CHOICES.map((c, i) => (i === 3 ? { ...c, text: "Lidocain 100 mg" } : c));
    expect(rowKeyFingerprint(42, { choices: typo })).not.toBe(server);
    expect(rowKeyFingerprint(43, { choices: CHOICES })).not.toBe(server);
  });

  it("normalizes NFC and whitespace the same way on both sides", () => {
    expect(normalizeOptionText("  Prüfung \n  Wien ")).toBe("Prüfung Wien");
    const decomposed = CHOICES.map((c) => ({ ...c, text: `  ${c.text.normalize("NFD")}\t ` }));
    expect(rowKeyFingerprint(42, { choices: decomposed })).toBe(server);
  });

  it("hides placeholder options exactly as /api/questions does", () => {
    const delivered = buildMCQFromChoices(CHOICES);
    expect(delivered.some((o) => o.text === "?")).toBe(false);
    expect(answerKeyOptions({ choices: CHOICES })).toHaveLength(delivered.length);
    // A row whose placeholder became a real option is a changed key.
    const filled = CHOICES.map((c, i) => (i === 4 ? { ...c, text: "Magnesium" } : c));
    expect(rowKeyFingerprint(42, { choices: filled })).not.toBe(server);
  });

  it("mirrors the legacy distractor path and the open-answer path", () => {
    const row = { choices: null, answer: "Furosemid", distractors: ["A", "B", "C", "D"] };
    expect(answerKeyFingerprint(9, buildMCQFromStored(row.answer, row.distractors))).toBe(rowKeyFingerprint(9, row));
    // Open answer: no options on either side still matches.
    expect(answerKeyFingerprint(9, undefined)).toBe(rowKeyFingerprint(9, { choices: null, answer: "x", distractors: [] }));
    expect(answerKeyFingerprint(9, null)).toBe(answerKeyFingerprint(9, []));
    // A question that gained options is a changed key.
    expect(answerKeyFingerprint(9, undefined)).not.toBe(rowKeyFingerprint(9, row));
  });

  it("an answer given on a translated UI (ru, ar) matches the server", () => {
    // The UI language never reaches the key: options are delivered and kept in
    // the source language (/api/translate only serves the explanation fields),
    // so the quiz fingerprints question.options whatever the learner reads.
    for (const lang of ["ru", "ar", "de", "en"]) {
      const delivered = { id: 42, lang, options: buildMCQFromChoices(CHOICES) };
      expect(answerKeyFingerprint(delivered.id, delivered.options)).toBe(server);
    }
    // Translated option text would not match: the guard is source-only.
    const translated = buildMCQFromChoices(CHOICES).map((o) => ({ ...o, text: `ru:${o.text}` }));
    expect(answerKeyFingerprint(42, translated)).not.toBe(server);
  });
});

describe("checkAnswerKey", () => {
  const current = rowKeyFingerprint(1, { choices: CHOICES });
  const stale = rowKeyFingerprint(1, { choices: CHOICES.map((c, i) => ({ ...c, correct: i === 1 })) });
  const since = "2026-10-24T00:00:00Z";
  const t0 = Date.parse(since);

  it("reads the flag with shadow as the default", () => {
    expect(readAnswerKeyGuardMode({})).toBe("shadow");
    expect(readAnswerKeyGuardMode({ ANSWER_KEY_GUARD: "enforce" })).toBe("enforce");
    expect(readAnswerKeyGuardMode({ ANSWER_KEY_GUARD: " OFF " })).toBe("off");
    expect(readAnswerKeyGuardMode({ ANSWER_KEY_GUARD: "yes" })).toBe("shadow");
  });

  it("shadow never refuses", () => {
    expect(checkAnswerKey({ mode: "shadow", sent: stale, current })).toEqual({ verdict: "mismatch", refuse: false });
    expect(checkAnswerKey({ mode: "shadow", sent: "garbage", current })).toEqual({ verdict: "mismatch", refuse: false });
    expect(checkAnswerKey({ mode: "shadow", sent: undefined, current, enforcedAt: since, now: t0 + 30 * 86400000 }).verdict).toBe("legacy_accept");
  });

  it("enforce refuses a mismatch and accepts a match", () => {
    expect(checkAnswerKey({ mode: "enforce", sent: stale, current })).toEqual({ verdict: "mismatch", refuse: true });
    expect(checkAnswerKey({ mode: "enforce", sent: current, current })).toEqual({ verdict: "match" });
  });

  it("legacy rows without a fingerprint pass inside the 7-day window only", () => {
    expect(checkAnswerKey({ mode: "enforce", sent: undefined, current, enforcedAt: since, now: t0 + 6 * 86400000 }).verdict).toBe("legacy_accept");
    expect(checkAnswerKey({ mode: "enforce", sent: null, current, enforcedAt: since, now: t0 + LEGACY_FINGERPRINT_GRACE_MS }).verdict).toBe("legacy_accept");
    expect(checkAnswerKey({ mode: "enforce", sent: undefined, current, enforcedAt: since, now: t0 + LEGACY_FINGERPRINT_GRACE_MS + 1 }).verdict).toBe("legacy_refuse");
    // Without a readable enforce date legacy rows are never refused.
    expect(checkAnswerKey({ mode: "enforce", sent: undefined, current, now: t0 + 90 * 86400000 }).verdict).toBe("legacy_accept");
    expect(checkAnswerKey({ mode: "enforce", sent: undefined, current, enforcedAt: "soon", now: t0 + 90 * 86400000 }).verdict).toBe("legacy_accept");
  });

  it("off skips everything", () => {
    expect(checkAnswerKey({ mode: "off", sent: stale, current })).toEqual({ verdict: "skip" });
  });
});
