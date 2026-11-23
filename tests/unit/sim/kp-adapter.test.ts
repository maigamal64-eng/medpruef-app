import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { caseProblems, sessionResult, TALK_SLOT } from "@/lib/sim";
import { scoreRun } from "@/lib/de-kp/case-run";
import { KP_SIM_PROFILE } from "@/lib/de-kp/sim/profile";
import { followupItemId, parseKpCase, resultFromV1, toSimCase } from "@/lib/de-kp/sim/case-adapter";
import { T0, caseFiles, loadCase, run, newSession } from "./fixtures";

const CASES = path.resolve(__dirname, "../../../content/de-kp/cases");

describe("case adapter over every KP case file (files unchanged)", () => {
  const files = caseFiles();
  it("finds the bank", () => expect(files.length).toBeGreaterThanOrEqual(30));

  it.each(files)("%s maps to a valid simulation input", (f) => {
    const raw = readFileSync(path.join(CASES, f), "utf8");
    const c = parseKpCase(JSON.parse(raw));
    expect(c).not.toBeNull();
    const { sim, material } = toSimCase(c!);
    expect(caseProblems(sim, KP_SIM_PROFILE)).toEqual([]);
    expect(sim.caseId).toBe(c!.slug);
    expect(sim.provenance).toEqual({ kind: "drafted_from_open_refs" });
    // critical flags come from the case, only on Bericht points
    expect(sim.items.report.filter((i) => i.critical).map((i) => i.id)).toEqual(c!.bericht_rubric.filter((p) => p.critical).map((p) => p.id));
    expect([...sim.items.talk, ...sim.items.diff, ...sim.items.examiner].some((i) => i.critical)).toBe(false);
    expect(sim.items.examiner.length).toBeLessThanOrEqual(8);
    expect(material.followups.map((x) => x.position)).toEqual([...material.followups.map((x) => x.position)].sort((a, b) => a - b));
    expect(readFileSync(path.join(CASES, f), "utf8")).toBe(raw);
  });

  it("the differential lead weighs as much as all others together", () => {
    const { sim } = toSimCase(loadCase());
    const [lead, ...others] = sim.items.diff;
    expect(lead.weight).toBeCloseTo(others.reduce((s, o) => s + o.weight, 0));
  });

  it("rejects a malformed case instead of guessing", () => {
    const c = JSON.parse(readFileSync(path.join(CASES, caseFiles()[0]), "utf8")) as Record<string, unknown>;
    for (const broken of [null, [], { ...c, slug: "Bad Slug" }, { ...c, subject: "paediatrie" }, { ...c, bericht_rubric: [{ id: "r1", section: "fazit", point_de: "x", weight: 1, critical: true }] }, { ...c, followups: [] }, { ...c, history_checklist: [{ id: "h", domain: "x", point_de: "p", weight: 1 }] }, { ...c, differentials: { leading: [], others: [] } }]) {
      expect(parseKpCase(broken)).toBeNull();
    }
  });

  it("reads a protocol-informed case with its Land and date (S3 adds the fields)", () => {
    const c = { ...loadCase(), provenance: "protocol_informed", sources: [...loadCase().sources, { kind: "exam_protocol", ref: "Protokoll", url: "https://example.org", land: "NW", exam_date: "2026-10-14" }] };
    expect(toSimCase(c).sim.provenance).toEqual({ kind: "protocol_informed", land: "NW", examDate: "2026-10-14" });
  });
});

describe("scores agree with the v1 runner when the marks agree", () => {
  it.each(caseFiles())("%s", (f) => {
    const c = loadCase(f);
    const { sim } = toSimCase(c);
    const ticked = (ids: string[], every: number) => ids.filter((_, i) => i % every === 0);
    const historyIds = ticked(c.history_checklist.map((p) => p.id), 2);
    const berichtIds = ticked(c.bericht_rubric.map((p) => p.id), 3);
    const fus = [...c.followups].sort((a, b) => a.position - b.position);
    const oralIds = ticked(fus.map((x) => String(x.position)), 2);
    const bericht = { anamnese: "Anamnese mit mehreren Worten", diagnose: "Diagnose steht fest", prognose: "", behandlungsplan: "Therapie wie geplant", epikrise: "Kurzer Verlauf hier" };
    const oral = Object.fromEntries(fus.map((x) => [String(x.position), ["Antwort mit Inhalt"]]));
    const v1 = scoreRun({
      checklist: c.history_checklist,
      rubric: c.bericht_rubric,
      differentials: c.differentials,
      followups: fus.map((x) => ({ id: x.position, required: x.required })),
      answers: { anamnese: ["Seit wann haben Sie Schmerzen?", "Nehmen Sie Medikamente?"], differentials: { leading: "Leitdiagnose", others: ["Eins", "Zwei"] }, bericht, oral },
      marks: { history: Object.fromEntries(historyIds.map((id) => [id, true])), differentials: { leading: true, others: { "0": true } }, bericht: Object.fromEntries(berichtIds.map((id) => [id, true])), oral: Object.fromEntries(oralIds.map((id) => [id, true])) },
    });

    const cover = (ids: string[]) => ({ ...Object.fromEntries(ids.map((id) => [id, "covered" as const])) });
    let s = run(newSession({ caseFile: f }), [{ type: "start", at: T0 }]);
    s = run(s, [
      { type: "talk_turn", at: T0, partId: "talk", text: "Seit wann haben Sie Schmerzen?" },
      { type: "talk_turn", at: T0, partId: "talk", text: "Nehmen Sie Medikamente?" },
      { type: "submit_part", at: T0, partId: "talk" },
      { type: "submit_part", at: T0, partId: "findings" },
      { type: "save_text", at: T0, partId: "diff", slot: "leading", text: "Leitdiagnose" },
      { type: "save_text", at: T0, partId: "diff", slot: "others", text: "Eins\nZwei" },
      { type: "submit_part", at: T0, partId: "diff" },
      ...Object.entries(bericht).map(([slot, text]) => ({ type: "save_text" as const, at: T0, partId: "report", slot, text })),
      { type: "submit_part", at: T0, partId: "report" },
      ...fus.map((x) => ({ type: "save_text" as const, at: T0, partId: "examiner", slot: followupItemId(x.position), text: "Antwort mit Inhalt" })),
      { type: "submit_part", at: T0, partId: "examiner" },
    ]);
    const marks = { talk: cover(historyIds), diff: cover(["lead", "o1"]), report: cover(berichtIds), examiner: cover(oralIds.map((p) => followupItemId(Number(p)))) };
    for (const [partId, m] of Object.entries(marks)) for (const [itemId, mark] of Object.entries(m)) s = run(s, [{ type: "self_mark", at: T0, partId, itemId, mark }]);
    expect(s.parts[0].answers[TALK_SLOT]).toBe("Seit wann haben Sie Schmerzen?\nNehmen Sie Medikamente?");
    const r = sessionResult(KP_SIM_PROFILE, run(s, [{ type: "finish", at: T0 }]));
    const byId = Object.fromEntries(r.parts.map((p) => [p.partId, p.score]));
    expect(sim.caseId).toBe(c.slug);
    expect(byId.talk).toBeCloseTo(v1.history, 10);
    expect(byId.diff).toBeCloseTo(v1.differential, 10);
    expect(byId.report).toBeCloseTo(v1.bericht, 10);
    expect(byId.examiner).toBeCloseTo(v1.followup, 10);
    expect(r.criticalMissedCount).toBe(v1.criticalMissed);
  });
});

describe("v1 attempts for the readiness report (S9)", () => {
  const row = { id: "a1", caseSlug: "x", taxonomyCode: "IM-KARD-06", completedAt: T0, history_score: 0.5, differential_score: 1, bericht_score: 0.25, followup_score: null, critical_missed: 2 };
  it("reads a finished attempt as a self-marked practice result", () => {
    const r = resultFromV1(row)!;
    expect(r).toMatchObject({ mode: "practice_part", aiMarking: false, status: "finished", criticalMissedCount: 2, taxonomyCode: "IM-KARD-06" });
    expect(r.parts.map((p) => p.score)).toEqual([0.5, 1, 0.25, 0]);
    expect(r.total).toBeCloseTo(1.75 / 4);
  });
  it("skips an unfinished attempt", () => expect(resultFromV1({ ...row, completedAt: null })).toBeNull());
});
