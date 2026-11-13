import { describe, expect, it } from "vitest";
import {
  autoHistoryMarks, berichtRemainingSeconds, berichtScore, canAdvance, criticalBucket, criticalMissed, differentialHints, differentialScore,
  followupScore, historyScore, keyPartsReleased, matchDomains, parseSession, pendingKey, revealAnswers, sanitizeAnswers, sanitizeMarks, scoreRun, sessionKey, suggestMark,
  type ChecklistPoint, type RubricPoint,
} from "@/lib/de-kp/case-run";
import { deKpCopy } from "@/lib/de-kp/copy";

const checklist: ChecklistPoint[] = [
  { id: "a1", domain: "aktuelle_beschwerden", point_de: "Schmerzcharakter", weight: 2 },
  { id: "m1", domain: "medikation", point_de: "Antikoagulation", weight: 1 },
  { id: "n1", domain: "noxen", point_de: "Nikotin", weight: 1 },
];
const rubric: RubricPoint[] = [
  { id: "r1", section: "anamnese", point_de: "x", weight: 1, critical: false },
  { id: "r2", section: "behandlungsplan", point_de: "Antikoagulation prüfen", weight: 1, critical: true },
  { id: "r3", section: "diagnose", point_de: "y", weight: 2, critical: false },
];
const diff = { leading: [["Akutes Koronarsyndrom", "ACS"]], others: [["Lungenembolie"], ["Aortendissektion"]] };

describe("anamnese", () => {
  it("matches domains by keyword incl. umlauts, no AI", () => {
    const d = matchDomains(["Wie ist der Schmerzcharakter?", "Nehmen Sie Blutverdünner?", "Rauchen Sie?"]);
    expect([...d].sort()).toEqual(["aktuelle_beschwerden", "medikation", "noxen"]);
    expect(matchDomains(["Hatten Sie Übelkeit?"]).has("aktuelle_beschwerden")).toBe(true);
    expect(matchDomains(["", "   "]).size).toBe(0);
  });
  it("reveals patient answers only for matched domains", () => {
    const answers = { a1: "drückend", m1: "ASS", n1: "10 py" };
    expect(revealAnswers(checklist, answers, matchDomains(["Seit wann haben Sie Schmerzen?"]))).toEqual({ a1: "drückend" });
  });
  it("score = ticked weight / total; nothing typed is 0", () => {
    expect(historyScore(checklist, ["Schmerzen?"], { a1: true })).toBeCloseTo(2 / 4);
    expect(historyScore(checklist, ["Schmerzen?"], { a1: true, m1: true, n1: true })).toBe(1);
    expect(historyScore(checklist, [], { a1: true })).toBe(0);
    expect(autoHistoryMarks(checklist, ["Schmerzen?"])).toEqual({ a1: true });
  });
});

describe("differentials", () => {
  it("hint only: exact wording matches, anything else compares, empty is empty", () => {
    const h = differentialHints({ leading: "acs", others: ["Lungenembolie", "Pneumonie"] }, diff);
    expect(h.leading).toBe("matches");
    expect(h.others).toEqual(["matches", "compare"]);
    expect(differentialHints({ leading: "" }, diff).leading).toBe("empty");
  });
  it("score = leading x 0.5 + others right / required x 0.5, empty never right", () => {
    expect(differentialScore({ leading: "ACS", others: ["Lungenembolie", "Aortendissektion"] }, { leading: true, others: { "0": true, "1": true } }, diff)).toBe(1);
    expect(differentialScore({ leading: "ACS", others: ["Lungenembolie"] }, { leading: true, others: { "0": true } }, diff)).toBeCloseTo(0.75);
    expect(differentialScore({ leading: "", others: [] }, { leading: true, others: { "0": true } }, diff)).toBe(0);
    expect(differentialScore({ leading: "x", others: ["a", "b", "c"] }, { leading: false, others: { "0": true, "1": true, "2": true } }, diff)).toBeCloseTo(0.5);
  });
});

describe("bericht", () => {
  const text = { anamnese: "a", diagnose: "d", behandlungsplan: "b" };
  it("weighted score; a point in an empty section never counts", () => {
    expect(berichtScore(rubric, text, { r1: true, r2: true, r3: true })).toBe(1);
    expect(berichtScore(rubric, { anamnese: "a" }, { r1: true, r2: true, r3: true })).toBeCloseTo(1 / 4);
    expect(berichtScore(rubric, {}, { r1: true })).toBe(0);
  });
  it("lists unticked critical points", () => {
    expect(criticalMissed(rubric, text, { r1: true }).map((p) => p.id)).toEqual(["r2"]);
    expect(criticalMissed(rubric, text, { r2: true })).toEqual([]);
    expect(criticalMissed(rubric, {}, { r2: true }).map((p) => p.id)).toEqual(["r2"]);
    expect([criticalBucket(0), criticalBucket(1), criticalBucket(5)]).toEqual(["0", "1", "2+"]);
  });
});

describe("oral and run score", () => {
  const items = [{ id: 1, required: 1 }, { id: 2, required: 2 }];
  it("share right; unanswered never right", () => {
    expect(followupScore(items, { "1": ["x"], "2": ["a", "b"] }, { "1": true, "2": true })).toBe(1);
    expect(followupScore(items, { "1": ["x"] }, { "1": true, "2": true })).toBe(0.5);
    expect(followupScore([], {}, {})).toBe(0);
  });
  it("scoreRun combines the four parts", () => {
    const s = scoreRun({
      checklist, rubric, differentials: diff, followups: items,
      answers: { anamnese: ["Schmerzen"], differentials: { leading: "ACS", others: [] }, bericht: { anamnese: "a", behandlungsplan: "b", diagnose: "d" }, oral: { "1": ["x"] } },
      marks: { history: { a1: true }, differentials: { leading: true }, bericht: { r1: true, r3: true }, oral: { "1": true } },
    });
    expect(s.history).toBeCloseTo(0.5);
    expect(s.differential).toBeCloseTo(0.5);
    expect(s.bericht).toBeCloseTo(3 / 4);
    expect(s.followup).toBe(0.5);
    expect(s.criticalMissed).toBe(1);
  });
  it("suggestMark is re-exported and only a hint", () => {
    expect(suggestMark([["ACS"]], ["acs"])).toBe("matches");
  });
});

describe("steps and key release", () => {
  it("advances one step at a time, never back", () => {
    expect(canAdvance("anamnese", "differentials")).toBe(true);
    expect(canAdvance("anamnese", "bericht")).toBe(false);
    expect(canAdvance("bericht", "differentials")).toBe(false);
    expect(canAdvance("oral", "done")).toBe(true);
  });
  it("releases key parts only after the matching submit", () => {
    expect(keyPartsReleased("anamnese")).toEqual([]);
    expect(keyPartsReleased("differentials")).toEqual(["history"]);
    expect(keyPartsReleased("bericht")).toEqual(["history", "differentials"]);
    expect(keyPartsReleased("oral")).toEqual(["history", "differentials", "bericht"]);
    expect(keyPartsReleased("done")).toEqual(["history", "differentials", "bericht", "oral"]);
  });
});

describe("storage helpers", () => {
  it("caps typed text and drops unknown keys", () => {
    const a = sanitizeAnswers({
      anamnese: Array.from({ length: 40 }, () => "x".repeat(400)), evil: "y",
      bericht: { diagnose: "z".repeat(5000), junk: "q" }, oral: { "1": ["a", "b", "c", "d"], bad: ["x"] },
    });
    expect(a.anamnese).toHaveLength(25);
    expect(a.anamnese[0]).toHaveLength(300);
    expect(a.bericht.diagnose).toHaveLength(4000);
    expect(Object.keys(a)).toEqual(["anamnese", "differentials", "bericht", "oral"]);
    expect(a.oral).toEqual({ "1": ["a", "b", "c"] });
  });
  it("keeps only booleans in marks", () => {
    expect(sanitizeMarks({ history: { a1: true, b: "yes" }, differentials: { leading: true, others: { "0": true, "9": true } }, bericht: { r1: false }, oral: { "1": true, x: true } }))
      .toEqual({ history: { a1: true }, differentials: { leading: true, others: { "0": true } }, bericht: { r1: false }, oral: { "1": true } });
  });
  it("uses its own storage keys and rejects foreign sessions", () => {
    expect(sessionKey("u 1")).toBe("medpruef_dekp_session:v1:u%201");
    expect(pendingKey("")).toBeNull();
    expect(parseSession("{}")).toBeNull();
    expect(parseSession(null)).toBeNull();
    const ok = { v: 1, attemptId: "5b1e2c4a-3f6d-4a8b-9c1d-0e2f3a4b5c6d", slug: "fall-eins", startedAt: 1, step: "bericht", source: "x", answers: {}, marks: {}, berichtClockStartedAt: 1000, savedAt: 2 };
    const s = parseSession(JSON.stringify(ok));
    expect(s?.source).toBeNull();
    expect(berichtRemainingSeconds(s!, 1000 + 60_000)).toBe(30 * 60 - 60);
    expect(berichtRemainingSeconds({ berichtClockStartedAt: null }, 5)).toBeNull();
  });
});

describe("copy", () => {
  it("has de and en, defaults to German, no dashes", () => {
    expect(deKpCopy("en-GB").chip).toBe("KP-DE");
    expect(deKpCopy("ar").examName).toContain("Deutschland");
    expect(JSON.stringify([deKpCopy("de"), deKpCopy("en")])).not.toMatch(/[–—]/);
  });
});
