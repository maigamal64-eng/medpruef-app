import { describe, expect, it } from "vitest";
import { lintGolden } from "./lib/lint";
import type { FactRecord } from "./lib/facts-source";
import type { GoldenCase, GoldenFile } from "./lib/types";
import { fixtures, golden, mkCase } from "./helpers";

const OK: GoldenCase = mkCase({ id: "lint-ok-de", message: "Frage?", expect: { kind: "answer", cite_any: ["sip4a.dates.2026-11"], must_dates: ["2026-11-18"] } });

function fileOf(cases: GoldenCase[], over: Partial<GoldenFile> = {}): GoldenFile {
  return { ...golden, min_counts: {}, cases, ...over };
}
const fact = (id: string, en: string): FactRecord => ({
  id, exam_key: "sip4a", topic: "dates", filing_university: "wien", text_de: "", text_en: en, source_url: "https://www.meduniwien.ac.at/x", source_label: "x", read_on: "2026-10-10", verdict: "confirmed", status: "live",
});

describe("lintGolden structure", () => {
  it("accepts a clean case", () => {
    expect(lintGolden(fileOf([OK]), fixtures, { facts: null }).errors).toEqual([]);
  });

  it.each<[string, Partial<GoldenCase>, RegExp]>([
    ["bad id", { id: "X" }, /id must match/],
    ["unknown language", { lang: "xx" as never }, /invalid mentor language/],
    ["empty message", { message: " " }, /empty message/],
    ["em dash in a learner message", { message: "Frage — bitte" }, /em dash/],
    ["unknown fixture", { question_fixture: "q-nope" }, /unknown question_fixture/],
    ["explain without a question", { mode: "explain" }, /needs question_fixture/],
    ["study without a profile", { mode: "study" }, /needs profile_fixture/],
    ["answer without cite_any", { expect: { kind: "answer" } }, /needs cite_any/],
    ["ask without forbidden deadlines", { expect: { kind: "ask_filing_university" } }, /must forbid the deadline dates/],
    ["not an ISO date", { expect: { kind: "answer", cite_any: ["a.b"], must_dates: ["2026-02-31"] } }, /not an ISO date/],
    ["required and forbidden", { expect: { kind: "answer", cite_any: ["a.b"], must_dates: ["2026-11-18"], forbid_dates: ["2026-11-18"] } }, /both required and forbidden/],
    ["must_dates on a refusal", { expect: { kind: "refuse", must_dates: ["2026-11-18"] } }, /only make sense for kind=answer/],
    ["unknown refusal reason", { expect: { kind: "refuse", refusal_reasons: ["nope" as never] } }, /unknown refusal reason/],
    ["history that does not alternate", { history: [{ role: "user", text: "a" }, { role: "user", text: "b" }] }, /alternate/],
    ["history that ends on the user", { history: [{ role: "user", text: "a" }] }, /end with an assistant turn/],
  ])("rejects %s", (_n, over, re) => {
    const r = lintGolden(fileOf([{ ...OK, ...over } as GoldenCase]), fixtures, { facts: null });
    expect(r.errors.join("\n")).toMatch(re);
  });

  it("rejects duplicate ids, a bad as_of and a count under its minimum", () => {
    const r = lintGolden(fileOf([OK, OK], { as_of: "2026-10-12T10:00:00", min_counts: { total: 5 } }), fixtures, { facts: null });
    expect(r.errors.join("\n")).toMatch(/duplicate id/);
    expect(r.errors.join("\n")).toMatch(/explicit UTC offset/);
    expect(r.errors.join("\n")).toMatch(/min_counts.total: 2 < 5/);
  });

  it("requires synthetic, collision-proof fixtures", () => {
    const bad = JSON.parse(JSON.stringify(fixtures));
    bad.questions["q-acei"].id = 5;
    bad.questions["q-acei"].synthetic = false;
    const r = lintGolden(fileOf([OK]), bad, { facts: null });
    expect(r.errors.join("\n")).toMatch(/must be marked synthetic/);
    expect(r.errors.join("\n")).toMatch(/id must be >= 9000000/);
  });
});

describe("lintGolden ground truth", () => {
  const facts = [fact("sip4a.dates.2026-11", "SIP4a (MedUni Wien): sitting on 18 Nov 2026. Registration window 5 Oct to 19 Oct 2026.")];

  it("accepts values printed in the cited facts", () => {
    const r = lintGolden(fileOf([{ ...OK, expect: { ...OK.expect, must_dates: ["2026-11-18", "2026-10-19"], allow_dates: ["2026-10-05"] } }]), fixtures, { facts });
    expect(r.errors).toEqual([]);
    expect(r.groundTruthChecked).toBe(true);
  });

  it("rejects a value the cited facts do not print, a glob that matches nothing and an allowed date nobody prints", () => {
    const r = lintGolden(
      fileOf([
        { ...OK, id: "lint-a-de", expect: { kind: "answer", cite_any: ["sip4a.dates.2026-11"], must_dates: ["2026-11-19"] } },
        { ...OK, id: "lint-b-de", expect: { kind: "answer", cite_any: ["nope.*"], must_dates: [] } },
        { ...OK, id: "lint-c-de", expect: { kind: "answer", cite_any: ["sip4a.dates.2026-11"], must_dates: ["2026-11-18"], allow_dates: ["2030-01-01"] } },
        { ...OK, id: "lint-d-de", expect: { kind: "answer", cite_any: ["sip4a.dates.2026-11"], must_eur: [150] } },
      ]),
      fixtures,
      { facts },
    );
    const text = r.errors.join("\n");
    expect(text).toMatch(/lint-a-de: must_date 2026-11-19 is not printed/);
    expect(text).toMatch(/lint-b-de: cite_any nope\.\* matches no fact/);
    expect(text).toMatch(/lint-c-de: allow_date 2030-01-01 is not printed in any fact/);
    expect(text).toMatch(/lint-d-de: must_eur 150 is not printed/);
  });

  it("holds allowed amounts and percentages to the facts too (a widened allow-list must name a real value)", () => {
    const withFact = [fact("gm.format", "Innsbruck: 14 Fragen, bestanden bei mindestens 60 Prozent. Gebühr 150 EUR.")];
    const ok = { ...OK, expect: { kind: "not_confirmed" as const, allow_eur: [150, 19, 0], allow_percent: [60] } };
    // 19 and 0 are printed in the app billing copy (app.billing.plans / app.billing.trial), 150 and 60 in the fact.
    expect(lintGolden(fileOf([ok]), fixtures, { facts: withFact }).errors).toEqual([]);
    const bad = { ...OK, id: "lint-bad-de", expect: { kind: "not_confirmed" as const, allow_eur: [4], allow_percent: [95] } };
    const text = lintGolden(fileOf([bad]), fixtures, { facts: withFact }).errors.join("\n");
    expect(text).toMatch(/lint-bad-de: allow_eur 4 is not printed in any fact or in the app billing copy/);
    expect(text).toMatch(/lint-bad-de: allow_percent 95 is not printed in any fact/);
  });

  it("checks derived sitting ids against the supplied list when there is one", () => {
    const c = { ...OK, expect: { kind: "answer" as const, cite_any: ["sitting.sip4a.2026-11-18.*"] } };
    expect(lintGolden(fileOf([c]), fixtures, { facts, sittingIds: ["sitting.sip4a.2026-11-18.wien.registration"] }).errors).toEqual([]);
    expect(lintGolden(fileOf([c]), fixtures, { facts, sittingIds: ["sitting.sip5a.2026-11-17.wien.registration"] }).errors.join()).toMatch(/matches no derived sitting id/);
  });

  it("warns when a not_confirmed case cites only confirmed facts", () => {
    const c = mkCase({ id: "lint-nc-de", category: "unconfirmed", expect: { kind: "not_confirmed", cite_any: ["sip4a.dates.2026-11"] } });
    expect(lintGolden(fileOf([c]), fixtures, { facts }).warnings.join()).toMatch(/not_confirmed but none/);
  });
});
