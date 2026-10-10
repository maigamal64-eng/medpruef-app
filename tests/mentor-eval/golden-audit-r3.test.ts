/**
 * Round-3 grader audit (mentor loop): one widening, proven both ways.
 * pr-prescribed-de failed in 14 of 20 saved live runs on the term list alone: the model cites the right
 * facts and quotes the official wording "stets vorzuschreiben" (rezeptierkunde.documents.always-prescribed,
 * gerichtsmedizin.documents.always-prescribed; the facts list "stets" as a keyword). The golden only knew
 * "immer" and "in jedem Fall".
 */
import { describe, expect, it } from "vitest";
import { scoreCase } from "./lib/score";
import { golden, mkCtx, mkOutcome } from "./helpers";

const IDS = ["rezeptierkunde.documents.always-prescribed", "gerichtsmedizin.documents.always-prescribed"];

function grade(id: string, text: string, ids: string[]) {
  const c = golden.cases.find((x) => x.id === id);
  if (!c) throw new Error(`no golden case ${id}`);
  return scoreCase(c, mkOutcome({ blocks: [{ text, fact_ids: ids }] }), mkCtx());
}

describe("widened: 'stets' on pr-prescribed-de (official wording of the always-prescribed facts)", () => {
  it("the saved live answer, quoting the official wording, passes", () => {
    const text = "Ja. Die Ergänzungsprüfungen aus Gerichtliche Medizin und Rezeptierkunde (Pharmakologie) sind unabhängig vom Ergebnis des Stichprobentests stets vorzuschreiben (Merkblatt der MedUni Wien, Stand 2026-10-10). Ein abgewiesener Antrag bekommt keine Ergänzungsprüfungen.";
    const s = grade("pr-prescribed-de", text, IDS);
    expect(s.critical).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.pass).toBe(true);
  });

  it("a wrong answer (no obligation stated) still fails the term check", () => {
    const s = grade("pr-prescribed-de", "Nein, wenn du den Stichprobentest bestehst, entfallen diese Prüfungen.", IDS);
    expect(s.failures).toContain("missing_term_any:immer");
    expect(s.pass).toBe(false);
  });

  it("the right words without the expected citation still fail", () => {
    const s = grade("pr-prescribed-de", "Die Prüfungen sind stets vorzuschreiben.", ["general.glossary.learner-words"]);
    expect(s.failures).toContain("missing_expected_citation");
    expect(s.pass).toBe(false);
  });

  it("an invented number next to the right wording is still rejected", () => {
    const s = grade("pr-prescribed-de", "Die Prüfungen sind stets vorzuschreiben und kosten 150 Euro.", IDS);
    expect(s.critical).toContain("wrong_fee:150");
  });
});
