import { describe, it, expect } from "vitest";
import { PARTLY_CREDIT, checkVerdict, quotePasses, scorePart, totalScore, worthGrading, isPartEmpty, type ItemVerdict, type PartConfig, type SelfMark, type SimItem } from "@/lib/sim";
import { KP_SIM_PROFILE } from "@/lib/de-kp/sim/profile";

const report = KP_SIM_PROFILE.parts.find((p) => p.id === "report") as PartConfig;
const diff = KP_SIM_PROFILE.parts.find((p) => p.id === "diff") as PartConfig;
const items: SimItem[] = [
  { id: "a", label: "A", weight: 3, critical: true, slot: "anamnese" },
  { id: "b", label: "B", weight: 1, critical: false, slot: "anamnese" },
  { id: "c", label: "C", weight: 2, critical: true, slot: "diagnose" },
];
const answers = { anamnese: "Der Patient nimmt Metoprolol und hat Asthma.", diagnose: "Anaphylaxie Grad III nach Wespenstich" };
const v = (itemId: string, status: ItemVerdict["status"], quote: string | null): ItemVerdict => ({ itemId, status, quote, model: "m", promptVersion: "p1" });
const score = (selfMarks: Record<string, SelfMark>, verdicts: Record<string, ItemVerdict> = {}, a: Record<string, string> = answers) => scorePart({ part: report, items, answers: a, selfMarks, verdicts });

describe("S1 acceptance: the self-mark decides; critical_missed counts unticked critical points", () => {
  it("scores the self-marks even when the AI suggested the opposite", () => {
    const r = score({ a: "missing", b: "covered", c: "covered" }, { a: v("a", "covered", "nimmt Metoprolol"), b: v("b", "missing", null), c: v("c", "missing", null) });
    expect(r.score).toBeCloseTo((1 + 2) / 6);
    expect(r.criticalMissed).toEqual(["a"]);
    expect(r.items.map((i) => i.overridden)).toEqual([true, true, true]);
  });

  it("an AI 'covered' without a learner mark scores nothing and a critical item stays missed", () => {
    const r = score({}, { a: v("a", "covered", "nimmt Metoprolol"), c: v("c", "covered", "Anaphylaxie Grad III") });
    expect(r.score).toBe(0);
    expect(r.criticalMissed).toEqual(["a", "c"]);
    expect(r.items[0].suggestion).toBe("covered");
  });

  it("'partly' earns partial credit but never clears a critical point", () => {
    const r = score({ a: "partly", b: "partly", c: "covered" });
    expect(r.score).toBeCloseTo((3 * PARTLY_CREDIT + 1 * PARTLY_CREDIT + 2) / 6);
    expect(r.criticalMissed).toEqual(["a"]);
  });

  it("an item whose slot is empty never scores, whatever the mark", () => {
    const r = score({ a: "covered", b: "covered", c: "covered" }, {}, { anamnese: answers.anamnese });
    expect(r.score).toBeCloseTo(4 / 6);
    expect(r.criticalMissed).toEqual(["c"]);
  });
});

describe("quote rule (S5 stores what this returns)", () => {
  it("passes a verbatim quote, ignoring case and whitespace", () => {
    expect(quotePasses("nimmt   METOPROLOL", answers.anamnese)).toBe(true);
    expect(quotePasses("nimmt Bisoprolol", answers.anamnese)).toBe(false);
    expect(quotePasses("ab", "ab cd")).toBe(false); // too short to prove anything
    expect(quotePasses(null, answers.anamnese)).toBe(false);
  });

  it("a quote not in the learner's text turns a non-critical mark into 'unklar'", () => {
    expect(checkVerdict(v("b", "covered", "erfunden"), { critical: false }, answers.anamnese)).toMatchObject({ status: "unklar", quote: null });
    expect(checkVerdict(v("b", "partly", null), { critical: false }, answers.anamnese)).toMatchObject({ status: "unklar", quote: null });
  });

  it("a critical point marked covered without a passing quote is stored as missing", () => {
    expect(checkVerdict(v("a", "covered", null), { critical: true }, answers.anamnese)).toMatchObject({ status: "missing", quote: null });
    expect(checkVerdict(v("a", "covered", "erfunden"), { critical: true }, answers.anamnese)).toMatchObject({ status: "missing" });
    expect(checkVerdict(v("a", "covered", "Metoprolol"), { critical: true }, answers.anamnese).status).toBe("covered");
  });

  it("'unklar' proposes 'missing' and counts as not covered until the learner ticks it", () => {
    const unclear = { b: v("b", "covered", "erfunden") };
    expect(score({}, unclear).items[1]).toMatchObject({ suggestion: "unklar", credit: 0 });
    expect(score({ b: "covered" }, unclear).items[1]).toMatchObject({ credit: 1, overridden: true });
  });
});

describe("PLAN.md 4: nothing or one word scores 0 and is not sent to the grader", () => {
  it("a one-word free-text part scores 0 even when ticked", () => {
    const r = score({ a: "covered", b: "covered", c: "covered" }, {}, { anamnese: "Asthma" });
    expect(r.empty).toBe(true);
    expect(r.score).toBe(0);
    expect(worthGrading("Asthma")).toBe(false);
    expect(worthGrading("Asthma bronchiale")).toBe(true);
    expect(worthGrading("   ")).toBe(false);
  });

  it("a one-word diagnosis in short answers is a real answer", () => {
    expect(isPartEmpty("short_answers", { leading: "Anaphylaxie" })).toBe(false);
    expect(isPartEmpty("short_answers", { leading: "  " })).toBe(true);
    const r = scorePart({ part: diff, items: [{ id: "lead", weight: 1, critical: false, slot: "leading" }], answers: { leading: "Anaphylaxie" }, selfMarks: { lead: "covered" }, verdicts: {} });
    expect(r.score).toBe(1);
  });
});

describe("total", () => {
  it("weights scored parts and ignores parts that mark nothing", () => {
    const findings = KP_SIM_PROFILE.parts.find((p) => p.kind === "findings") as PartConfig;
    const mk = (part: PartConfig, s: number) => ({ part, result: { partId: part.id, kind: part.kind, score: s, empty: false, items: [], criticalMissed: [] } });
    expect(totalScore([mk(report, 1), mk(diff, 0.5), mk(findings, 0)])).toBeCloseTo(0.75);
    expect(totalScore([])).toBe(0);
  });
});
