import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error plain ESM script without types
import { validateCase, validateSet, buildArtifacts, taxonomyCodes, run, DEFAULT_TAXONOMY } from "../../../scripts/content/de-kp/build-seed.mjs";

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tax = JSON.parse(readFileSync(DEFAULT_TAXONOMY, "utf8"));
const codes = taxonomyCodes(tax);
const w = (n: number, s = "wort") => Array.from({ length: n }, (_, i) => `${s}${i}`).join(" ");
const domains = ["aktuelle_beschwerden", "vorerkrankungen", "medikation", "allergien", "sozial", "familie", "vegetativ", "noxen"];

function validCase(over: Loose = {}) {
  const hc = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, domain: domains[i % 8], point_de: `Punkt ${i}`, weight: 1 }));
  const rubric = ["anamnese", "diagnose", "prognose", "behandlungsplan", "epikrise"].flatMap((s) => [1, 2].map((n) => ({ id: `${s}${n}`, section: s, point_de: `Punkt ${s}`, weight: 1, critical: n === 1 && s === "behandlungsplan" })));
  const fu = Array.from({ length: 5 }, (_, i) => ({ position: i + 1, scope: i < 2 ? "cross" : "case", stem_de: `Frage ${i}?`, required: 1, accepted: [["Antwort"]], model_answer_de: "Antwort", key_points: [] }));
  return {
    slug: "test-fall", subject: "innere", taxonomy_code: "IM-KARD-01", title_de: "Brustschmerz am Abend", title_en: "Chest pain in the evening",
    vignette_de: w(100), history_checklist: hc, patient_answers_de: Object.fromEntries(hc.map((p) => [p.id, "Antwort"])),
    findings: [{ id: "f1", kind: "ekg", text_de: "EKG ohne ST-Hebung" }],
    differentials: { leading: [["Akutes Koronarsyndrom"]], others: [["Lungenembolie"], ["Aortendissektion"]] },
    bericht_rubric: rubric, model_bericht_de: w(300),
    sources: [{ kind: "awmf", ref: "Leitlinie", url: "https://register.awmf.org/" }],
    provenance: "drafted_from_open_refs", reviewed_by: ["read-a", "read-b"], reviewed_at: "2026-11-20T10:00:00Z", is_free: false, followups: fu,
    ...over,
  };
}
const errs = (c: Loose) => validateCase(c, codes);

describe("taxonomy", () => {
  it("has unique codes, a source on every subject and area group, and the three subjects", () => {
    const all: string[] = [];
    for (const s of tax.subjects) { expect(s.source_ids.length).toBeGreaterThan(0); expect(s.source_line).toBeTruthy(); for (const a of s.areas) for (const l of a.leaves) all.push(l.code); }
    expect(tax.cross_areas.source_ids.length).toBeGreaterThan(0);
    for (const a of tax.cross_areas.areas) for (const l of a.leaves) all.push(l.code);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((c) => /^[A-Z]{2}-[A-Z]{4}-[0-9]{2}$/.test(c))).toBe(true);
    expect(tax.subjects.map((s: Loose) => s.key)).toEqual(["innere", "chirurgie", "notfall"]);
  });
  it("marks every leaf editorial (no invented official blueprint)", () => {
    for (const s of tax.subjects) for (const a of s.areas) for (const l of a.leaves) expect(l.editorial).toBe(true);
  });
});

describe("case validation (acceptance test 3)", () => {
  it("accepts a valid case", () => expect(errs(validCase())).toEqual([]));
  it("rejects provenance other than drafted_from_open_refs", () => expect(errs(validCase({ provenance: "recalled" })).join()).toMatch(/provenance/));
  it("rejects fewer than 5 follow-ups", () => expect(errs(validCase({ followups: validCase().followups.slice(0, 4) })).join()).toMatch(/followups: 5 to 8/));
  it("rejects more than 8 follow-ups", () => {
    const f = Array.from({ length: 9 }, (_, i) => ({ ...validCase().followups[0], position: Math.min(i + 1, 8) }));
    expect(errs(validCase({ followups: f })).join()).toMatch(/followups/);
  });
  it("rejects fewer than 2 cross follow-ups", () => {
    const f = validCase().followups.map((x: Loose, i: number) => ({ ...x, scope: i === 0 ? "cross" : "case" }));
    expect(errs(validCase({ followups: f })).join()).toMatch(/at least 2 cross/);
  });
  it("rejects required not equal to accepted length", () => {
    const f = validCase().followups; f[0].required = 2;
    expect(errs(validCase({ followups: f })).join()).toMatch(/must equal accepted length/);
  });
  it("rejects a case with no guideline source", () => expect(errs(validCase({ sources: [{ kind: "rki", ref: "RKI", url: "https://www.rki.de/" }] })).join()).toMatch(/awmf/));
  it("rejects a rubric section with fewer than 2 points", () => {
    const r = validCase().bericht_rubric.filter((x: Loose) => x.id !== "epikrise2");
    expect(errs(validCase({ bericht_rubric: r })).join()).toMatch(/section epikrise needs at least 2/);
  });
  it("rejects fewer than two distinct reads", () => expect(errs(validCase({ reviewed_by: ["read-a", "read-a"] })).join()).toMatch(/reviewed_by/));
  it("rejects word counts out of range", () => {
    expect(errs(validCase({ vignette_de: w(10) })).join()).toMatch(/vignette/);
    expect(errs(validCase({ model_bericht_de: w(100) })).join()).toMatch(/model_bericht/);
  });
  it("rejects checklist size, unknown domain and orphan patient answers", () => {
    expect(errs(validCase({ history_checklist: validCase().history_checklist.slice(0, 11) })).join()).toMatch(/12 to 25/);
    const hc = validCase().history_checklist; hc[0].domain = "foo";
    expect(errs(validCase({ history_checklist: hc })).join()).toMatch(/domain/);
    const pa = validCase().patient_answers_de; delete pa.h0;
    expect(errs(validCase({ patient_answers_de: pa })).join()).toMatch(/no answer for checklist point h0/);
  });
  it("rejects differentials of the wrong size", () => {
    expect(errs(validCase({ differentials: { leading: [["a"], ["b"]], others: [["c"], ["d"]] } })).join()).toMatch(/leading/);
    expect(errs(validCase({ differentials: { leading: [["a"]], others: [["c"]] } })).join()).toMatch(/others/);
  });
  it("rejects an unknown taxonomy code and a subject mismatch", () => {
    expect(errs(validCase({ taxonomy_code: "IM-ZZZZ-99" })).join()).toMatch(/not in taxonomy/);
    expect(errs(validCase({ taxonomy_code: "CH-VISZ-01" })).join()).toMatch(/does not belong to subject/);
  });
  it("rejects dashes and never-say words in learner text", () => {
    expect(errs(validCase({ title_de: "Fall – Brust" })).join()).toMatch(/dash/);
    expect(errs(validCase({ title_en: "An official case" })).join()).toMatch(/never-say/);
    expect(errs(validCase({ title_de: "Ein Altfall" })).join()).toMatch(/never-say/);
  });
  it("rejects two free cases in one set and duplicate slugs", () => {
    expect(validateSet([validCase({ is_free: true }), validCase({ slug: "b", is_free: true })]).join()).toMatch(/at most one/);
    expect(validateSet([validCase(), validCase()]).join()).toMatch(/duplicate slug/);
  });
});

describe("artifacts and CLI", () => {
  it("emits inactive inserts, activate, deactivate and rollback for exactly the slugs", () => {
    const art = buildArtifacts([validCase({ title_de: "Fall d'Arc" })]);
    expect(art["seed.sql"]).toContain("false)\non conflict (slug) do nothing;");
    expect(art["seed.sql"]).toContain("Fall d''Arc");
    expect(art["activate.sql"]).toContain("is_active = true where slug in ('test-fall')");
    expect(art["deactivate.sql"]).toContain("is_active = false");
    expect(art["rollback.sql"]).toContain("delete from public.de_kp_cases where slug in ('test-fall')");
  });
  it("exits non-zero naming the rule and writes nothing when a case is bad", () => {
    const d = mkdtempSync(path.join(tmpdir(), "dekp-"));
    mkdirSync(path.join(d, "cases"));
    writeFileSync(path.join(d, "cases", "bad.json"), JSON.stringify(validCase({ provenance: "x" })));
    const res = run({ casesDir: path.join(d, "cases"), outDir: path.join(d, "out") });
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/provenance/);
    expect(existsSync(path.join(d, "out"))).toBe(false);
  });
  it("writes the four artifacts for a valid set and --check confirms them", () => {
    const d = mkdtempSync(path.join(tmpdir(), "dekp-"));
    mkdirSync(path.join(d, "cases"));
    writeFileSync(path.join(d, "cases", "ok.json"), JSON.stringify(validCase()));
    const out = path.join(d, "out");
    const res = run({ casesDir: path.join(d, "cases"), outDir: out });
    expect(res.ok).toBe(true);
    expect(res.written.sort()).toEqual(["activate.sql", "deactivate.sql", "rollback.sql", "seed.sql"]);
    expect(run({ casesDir: path.join(d, "cases"), outDir: out, check: true }).ok).toBe(true);
  });
});
