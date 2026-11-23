import { describe, it, expect } from "vitest";
import { PARTLY_CREDIT, checkVerdict, markProblem, quotePasses, scorePart, totalScore, worthGrading, isPartEmpty, type ItemVerdict, type PartConfig, type SelfMark, type SimItem } from "@/lib/sim";
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
    expect(checkVerdict(v("a", "covered", "nimmt Metoprolol"), { critical: true }, answers.anamnese).status).toBe("covered");
  });

  it("a critical point needs a quote of at least two words and 12 characters; other items keep the 3 character rule", () => {
    const text = "Der Patient nimmt Metoprolol und hat Asthma.";
    expect(quotePasses("und", text)).toBe(true);
    expect(quotePasses("und", text, true)).toBe(false);
    expect(quotePasses("Metoprolol", text, true)).toBe(false); // one word
    expect(quotePasses("und hat", text, true)).toBe(false); // two words, 7 characters
    expect(quotePasses("hat Asthma.", text, true)).toBe(false); // 11 characters
    expect(quotePasses("nimmt Metoprolol", text, true)).toBe(true);
    expect(checkVerdict(v("a", "covered", "die"), { critical: true }, "die Diagnose")).toMatchObject({ status: "missing", quote: null });
    expect(checkVerdict(v("b", "covered", "die"), { critical: false }, "die Diagnose").status).toBe("covered");
  });

  it("'unklar' proposes 'missing' and counts as not covered until the learner ticks it", () => {
    const unclear = { b: v("b", "covered", "erfunden") };
    expect(score({}, unclear).items[1]).toMatchObject({ suggestion: "unklar", credit: 0 });
    expect(score({ b: "covered" }, unclear).items[1]).toMatchObject({ credit: 1, overridden: true });
  });
});

describe("marks agree with the score (review findings 2 and 3)", () => {
  const diffItems = [
    { id: "lead", weight: 1, critical: false, slot: "leading" },
    { id: "o1", weight: 1 / 3, critical: false, slot: "others" },
    { id: "o2", weight: 1 / 3, critical: false, slot: "others" },
    { id: "o3", weight: 1 / 3, critical: false, slot: "others" },
  ];
  it("an item with an empty slot cannot be marked covered or partly; missing and clearing stay possible", () => {
    const a = { anamnese: answers.anamnese };
    expect(markProblem("written_report", items, a, {}, "c", "covered")).toBe("slot_empty");
    expect(markProblem("written_report", items, a, {}, "c", "partly")).toBe("slot_empty");
    expect(markProblem("written_report", items, a, {}, "c", "missing")).toBeNull();
    expect(markProblem("written_report", items, a, {}, "c", null)).toBeNull();
    expect(markProblem("written_report", items, a, {}, "a", "covered")).toBeNull();
  });
  it("other differentials earn together no more than the typed lines", () => {
    const a = { leading: "Anaphylaxie", others: "Urtikaria" };
    expect(markProblem("short_answers", diffItems, a, { o1: "covered" }, "o2", "covered")).toBe("slot_full");
    expect(markProblem("short_answers", diffItems, a, { o1: "partly" }, "o2", "partly")).toBeNull();
    expect(markProblem("short_answers", diffItems, { ...a, others: "Urtikaria\nAsthma" }, { o1: "covered" }, "o2", "covered")).toBeNull();
    // a forged set of marks is capped in scoring too: one typed line, three ticks, one third credit
    const r = scorePart({ part: diff, items: diffItems, answers: a, selfMarks: { o1: "covered", o2: "covered", o3: "covered" }, verdicts: {} });
    expect(r.score).toBeCloseTo((1 / 3) / 2);
    expect(r.items.map((i) => i.credit)).toEqual([0, 1, 0, 0]);
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
