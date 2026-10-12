import { describe, expect, it } from "vitest";
import { aggregate, generalPrompt, selectItems, type Row, type ScoreRow } from "../../../scripts/content/tr33/lib";

const row = (id: number, extra: Partial<Row> = {}): Row => ({
  id, topic: "T", question: `Frage ${id}`, answer: "Ja", explanation: null, is_active: true, exam_type: "kenntnispruefung",
  image_url: null, image_urls: null, choices: [{ text: "Ja", correct: true }, { text: "Nein", correct: false }], ...extra,
});

describe("TR-33 comparison helpers", () => {
  it("selects a reproducible sample of active, text-only, disputed items", () => {
    const rows = [row(1), row(2), row(3, { is_active: false }), row(4, { image_url: "x.png" }), row(5), row(6)];
    const disputed = rows.map((r) => ({ id: r.id, verdict: "UNSURE", is_active: r.is_active, excluded: null }));
    const a = selectItems(rows, disputed, 3, "33").map((r) => r.id);
    expect(a).toEqual(selectItems(rows, disputed, 3, "33").map((r) => r.id));
    expect(a).toHaveLength(3);
    expect(a).not.toContain(3);
    expect(a).not.toContain(4);
  });

  it("gives the general chatbot the stem and options but never the key", () => {
    const p = generalPrompt(row(7));
    expect(p).toContain("Frage 7");
    expect(p).toContain("- Nein");
    expect(p).not.toMatch(/CORRECT|richtig ist: Ja/);
  });

  it("unblinds scores, counts sourcing wins and checks re-score agreement within one point", () => {
    const s = (item: number, a: number, b: number, w: "A" | "B" | "tie"): ScoreRow => ({ item, rater_id: "r", A: { accuracy: a, sourcing: a, refusal: a }, B: { accuracy: b, sourcing: b, refusal: b }, sourcing_winner: w });
    const key = { "1": { A: "medpruef", B: "general" }, "2": { A: "general", B: "medpruef" } };
    const res = aggregate([{ item: 1 }, { item: 2 }], key, [s(1, 5, 2, "A"), s(2, 1, 4, "B")], [s(1, 4, 3, "A"), s(2, 3, 4, "B")]);
    expect(res.sourcing.medpruef_wins).toBe(2);
    expect(res.target_met).toBe(true);
    expect(res.mean.medpruef.sourcing).toBe(4.5);
    expect(res.rescore.detail).toEqual([{ item: 1, within_one: true, max_diff: 1 }, { item: 2, within_one: false, max_diff: 2 }]);
    expect(res.rescore.all_within_one).toBe(false);
  });
});
