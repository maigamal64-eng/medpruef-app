import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error plain ESM script without types
import { validateCase, validateSet, buildArtifacts, personaUpdateSql, PROTOCOL_CASES_ALLOWED, caseInsertSql, taxonomyCodes, run, DEFAULT_TAXONOMY } from "../../../scripts/content/de-kp/build-seed.mjs";
import { parseKpCase, toSimCase, followupItemId } from "@/lib/de-kp/sim/case-adapter";
import { protocolDateDe, protocolLabelDe } from "@/lib/de-kp/sim/protocol-label";

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = path.resolve(__dirname, "../../..");
const CASES = path.join(ROOT, "content/de-kp/cases");
const codes = taxonomyCodes(JSON.parse(readFileSync(DEFAULT_TAXONOMY, "utf8")));
const files = readdirSync(CASES).filter((f) => f.endsWith(".json")).sort();
const base = (): Loose => JSON.parse(readFileSync(path.join(CASES, files[0]), "utf8"));
const errs = (c: Loose) => validateCase(c, codes) as string[];
const persona = "Herr Berger, 58, spricht ruhig und knapp, macht sich Sorgen um seine Arbeit und nimmt abends Tabletten gegen den Blutdruck. Er kennt keine Fachwörter.";
const protocol = { kind: "exam_protocol", ref: "Prüfungsprotokoll, KP, Bayern, 2026-10", land: "Bayern", exam_date: "2026-10" };
const protoCase = (over: Loose = {}) => { const c = base(); return { ...c, provenance: "protocol_informed", sources: [...c.sources, { ...protocol }], ...over }; };

describe("the 30 live cases are unchanged by S3", () => {
  const pinned = JSON.parse(readFileSync(path.join(__dirname, "unchanged-hashes.json"), "utf8"));
  it("still 30 files with the pinned content hashes", () => {
    expect(files.length).toBe(30);
    for (const f of files) expect(createHash("sha256").update(readFileSync(path.join(CASES, f))).digest("hex"), f).toBe(pinned.cases[f]);
  });
  it("every case still validates with no violation", () => {
    for (const f of files) expect(errs(JSON.parse(readFileSync(path.join(CASES, f), "utf8"))), f).toEqual([]);
  });
  it("the generated seed artifacts are byte-identical to the checked-in ones", () => {
    const art = buildArtifacts(files.map((f) => JSON.parse(readFileSync(path.join(CASES, f), "utf8"))));
    for (const [name, hash] of Object.entries(pinned.artifacts as Record<string, string>)) {
      expect(createHash("sha256").update(art[name]).digest("hex"), name).toBe(hash);
      expect(createHash("sha256").update(readFileSync(path.join(ROOT, "scripts/sql/track-a/de-kp", name))).digest("hex"), name).toBe(hash);
    }
  });
  it("the builder --check run passes on the real bank", () => expect(run({ check: true }).ok).toBe(true));
  it("no S3 column in the insert of a case without the fields", () => expect(caseInsertSql(base())).not.toMatch(/patient_persona_de|examiner_notes/));
  it("adapter output for a case without the fields has no persona and no notes", () => {
    const { material, sim } = toSimCase(parseKpCase(base())!);
    expect(material.patientPersona).toBeNull();
    expect(material.examinerNotes).toEqual({});
    expect(sim.provenance).toEqual({ kind: "drafted_from_open_refs" });
  });
});

describe("patient_persona_de rules", () => {
  it("accepts a valid persona", () => expect(errs({ ...base(), patient_persona_de: persona })).toEqual([]));
  it("rejects too short and too long", () => {
    expect(errs({ ...base(), patient_persona_de: "kurz" }).join()).toMatch(/patient_persona: 40 to 1500/);
    expect(errs({ ...base(), patient_persona_de: "a ".repeat(800) }).join()).toMatch(/patient_persona: 40 to 1500/);
  });
  it("rejects a non-string", () => expect(errs({ ...base(), patient_persona_de: 5 }).join()).toMatch(/patient_persona/));
  it("rejects the leading diagnosis, its long words and a listed differential", () => {
    const c = base();
    const lead: string = c.differentials.leading[0][0];
    expect(errs({ ...c, patient_persona_de: `${persona} Er glaubt an ${lead}.` }).join()).toMatch(/patient_persona: names a diagnosis term/);
    const long = lead.toLowerCase().split(/[^a-zäöüß]+/).find((t) => t.length >= 7 && !["akute", "akuter", "akutes"].includes(t));
    if (long) expect(errs({ ...c, patient_persona_de: `${persona} Es ist ${long.toUpperCase()}.` }).join()).toMatch(/names a diagnosis term/);
    const other: string = c.differentials.others[0][0];
    expect(errs({ ...c, patient_persona_de: `${persona} Vielleicht ${other}.` }).join()).toMatch(/names a diagnosis term/);
  });
  it("rejects dashes and never-say words in the persona", () => {
    expect(errs({ ...base(), patient_persona_de: `${persona} Er sagt – nichts.` }).join()).toMatch(/copy: en or em dash/);
    expect(errs({ ...base(), patient_persona_de: `${persona} Das ist ein Altfall.` }).join()).toMatch(/never-say/);
  });
});

describe("examiner_notes rules", () => {
  const ok = (): Loose[] => [{ position: base().followups[0].position, may_probe_de: ["Nach der Dosierung fragen"] }];
  it("accepts notes that map to follow-up positions", () => expect(errs({ ...base(), examiner_notes: ok() })).toEqual([]));
  it("rejects a position that names no follow-up", () => {
    const have = new Set(base().followups.map((f: Loose) => f.position));
    const missing = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => !have.has(n))!;
    expect(errs({ ...base(), examiner_notes: [{ position: missing, may_probe_de: ["Nach der Dosierung fragen"] }] }).join()).toMatch(/names no follow-up/);
  });
  it("rejects a duplicate position, missing lines, too many lines and over-long lines", () => {
    const p = ok()[0].position;
    expect(errs({ ...base(), examiner_notes: [ok()[0], ok()[0]] }).join()).toMatch(/duplicate position/);
    expect(errs({ ...base(), examiner_notes: [{ position: p, may_probe_de: [] }] }).join()).toMatch(/1 to 3 may_probe_de/);
    expect(errs({ ...base(), examiner_notes: [{ position: p, may_probe_de: ["Eins hier", "Zwei hier", "Drei hier", "Vier hier"] }] }).join()).toMatch(/1 to 3 may_probe_de/);
    expect(errs({ ...base(), examiner_notes: [{ position: p, may_probe_de: ["x".repeat(241)] }] }).join()).toMatch(/each line needs/);
    expect(errs({ ...base(), examiner_notes: [{ position: p, may_probe_de: ["Nach der Dosis – fragen"] }] }).join()).toMatch(/copy: en or em dash/);
    expect(errs({ ...base(), examiner_notes: [{ position: p, may_probe_de: ["Nach der Dosis fragen"], extra: 1 }] }).join()).toMatch(/unknown field/);
    expect(errs({ ...base(), examiner_notes: "x" }).join()).toMatch(/examiner_notes/);
  });
});

describe("protocol provenance and exam_protocol sources", () => {
  it("accepts a protocol_informed case with land and date", () => expect(errs(protoCase())).toEqual([]));
  it("accepts a protocol source with no url", () => expect(protocol).not.toHaveProperty("url"));
  it("refuses a day precision date: the day stays out of the data", () => {
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, ref: "Prüfungsprotokoll, KP, Bayern, 2026-10-14", exam_date: "2026-10-14" }] })).join()).toMatch(/exam_date must be YYYY-MM \(month precision\)/);
  });
  it("refuses a url on an exam_protocol source", () => expect(errs(protoCase({ sources: [...base().sources, { ...protocol, url: "https://t.me/c/123/45" }] })).join()).toMatch(/must not carry a url/));
  it("refuses a free text ref, a name or a handle in it", () => {
    for (const ref of ["Protokoll von Ahmed M., Gruppe 3", "Prüfungsprotokoll, KP, Bayern, 2026-10 (@dr_x)", "Gruppenpost vom 2026-10-12, Fall 7", "Prüfungsprotokoll, KP, Bayern, Fall Brustschmerz"]) {
      expect(errs(protoCase({ sources: [...base().sources, { ...protocol, ref }] })).join(), ref).toMatch(/ref must match/);
    }
  });
  it("refuses a ref that disagrees with land or month", () => {
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, ref: "Prüfungsprotokoll, KP, Hessen, 2026-10" }] })).join()).toMatch(/another Land/);
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, ref: "Prüfungsprotokoll, KP, Bayern, 2026-09" }] })).join()).toMatch(/another month/);
  });
  it("refuses more than one exam_protocol source per case", () => {
    const second = { ...protocol, ref: "Prüfungsprotokoll, KP, Hessen, 2026-09", land: "Hessen", exam_date: "2026-09" };
    expect(errs(protoCase({ sources: [...base().sources, protocol, second] })).join()).toMatch(/at most one exam_protocol source/);
  });
  it("rejects protocol_informed without an exam_protocol source", () => expect(errs({ ...base(), provenance: "protocol_informed" }).join()).toMatch(/provenance: protocol_informed needs at least one exam_protocol/));
  it("rejects missing land or date", () => {
    const { land, ...noLand } = protocol; void land;
    const { exam_date, ...noDate } = protocol; void exam_date;
    expect(errs(protoCase({ sources: [...base().sources, noLand] })).join()).toMatch(/must carry land/);
    expect(errs(protoCase({ sources: [...base().sources, noDate] })).join()).toMatch(/must carry exam_date/);
  });
  it("rejects a bad land or date format", () => {
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, land: "Atlantis" }] })).join()).toMatch(/sixteen Länder/);
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, exam_date: "2026-13" }] })).join()).toMatch(/exam_date must be/);
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, exam_date: "Oktober 2026" }] })).join()).toMatch(/exam_date must be/);
  });
  it("rejects an exam_protocol source on a drafted_from_open_refs case", () => expect(errs({ ...base(), sources: [...base().sources, protocol] }).join()).toMatch(/needs provenance protocol_informed/));
  it("rejects land or date on another source kind", () => expect(errs({ ...base(), sources: base().sources.map((s: Loose) => ({ ...s, land: "Bayern" })) }).join()).toMatch(/belong to kind exam_protocol only/));
  it("rejects a personal name field on a source, by key", () => {
    for (const k of ["name", "poster", "author", "handle", "phone", "examiner", "email"]) {
      expect(errs(protoCase({ sources: [...base().sources, { ...protocol, [k]: "Max Muster" }] })).join(), k).toMatch(/personal field/);
    }
    expect(errs(protoCase({ sources: [...base().sources, { ...protocol, color: "x" }] })).join()).toMatch(/unknown source field/);
  });
  it("rejects a handle, phone number or address inside the reference", () => {
    for (const ref of ["Post von @dr_mueller", "Anruf [phone]", "Mail an a.b@example.org", "Rückruf [phone]"]) {
      expect(errs(protoCase({ sources: [...base().sources, { ...protocol, ref }] })).join(), ref).toMatch(/handle, phone number or address/);
    }
  });
  it("a non-protocol source still needs an https url and an awmf entry is still required", () => {
    expect(errs({ ...base(), sources: [{ kind: "awmf", ref: "x" }] }).join()).toMatch(/url must be https/);
    expect(errs(protoCase({ sources: [protocol] })).join()).toMatch(/awmf/);
  });
  it("other provenance values stay rejected", () => expect(errs({ ...base(), provenance: "recalled" }).join()).toMatch(/provenance: must be one of/));
});

describe("protocol cases are refused for seeding until the learner label renders (review HIGH 1)", () => {
  it("the constant is false", () => expect(PROTOCOL_CASES_ALLOWED).toBe(false));
  it("validateSet and run refuse a valid protocol_informed case by default", () => {
    expect(validateSet([protoCase()]).join()).toMatch(/protocol_informed cases wait for the learner label \(S14\)/);
    expect(validateSet([protoCase()], { protocolAllowed: true })).toEqual([]);
    const dir = mkdtempSync(path.join(tmpdir(), "s3-gate-"));
    const cases = path.join(dir, "cases"); mkdirSync(cases);
    writeFileSync(path.join(cases, "a.json"), JSON.stringify(protoCase()));
    const res = run({ casesDir: cases, outDir: path.join(dir, "out") });
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toMatch(/wait for the learner label/);
    expect(run({ casesDir: cases, outDir: path.join(dir, "out"), protocolAllowed: true }).ok).toBe(true);
  });
  it("a drafted case with a persona is not affected", () => expect(validateSet([{ ...base(), patient_persona_de: persona }])).toEqual([]));
});

describe("lay wording and umlaut folding in the persona check (review MED 6)", () => {
  const c = () => base();
  it("catches a lay term listed for the case, in any spelling of the umlauts", () => {
    const withLay = { ...c(), lay_terms_de: ["Blinddarmentzündung", "Bauchfellreizung"] };
    expect(errs({ ...withLay, patient_persona_de: `${persona} Sie denkt an eine Blinddarmentzündung wie bei ihrer Schwester.` }).join()).toMatch(/names a diagnosis term/);
    expect(errs({ ...withLay, patient_persona_de: `${persona} Vielleicht eine BLINDDARMENTZUENDUNG.` }).join()).toMatch(/names a diagnosis term/);
    expect(errs({ ...withLay, patient_persona_de: persona })).toEqual([]);
  });
  it("folds umlauts and sharp s before matching the diagnosis words", () => {
    const x = { ...c(), differentials: { ...c().differentials, others: [["Gallenblasenentzündung"], ...c().differentials.others] } };
    expect(errs({ ...x, patient_persona_de: `${persona} Ich glaube an Gallenblasenentzuendung.` }).join()).toMatch(/names a diagnosis term/);
  });
  it("rejects a malformed lay_terms_de and one without a persona", () => {
    expect(errs({ ...c(), lay_terms_de: "x", patient_persona_de: persona }).join()).toMatch(/lay_terms_de must be a list/);
    expect(errs({ ...c(), lay_terms_de: ["Blinddarm"] }).join()).toMatch(/only makes sense with a patient_persona_de/);
  });
  it("lay_terms_de never reaches the insert SQL", () => expect(caseInsertSql({ ...c(), lay_terms_de: ["Blinddarm"], patient_persona_de: persona })).not.toMatch(/lay_terms/));
});

describe("persona-update.sql (review MED 7)", () => {
  const head = "-- h\n";
  it("is empty of statements for the live bank", () => {
    const body = personaUpdateSql(files.map((f) => JSON.parse(readFileSync(path.join(CASES, f), "utf8"))), head);
    expect(body).not.toMatch(/update public\.de_kp_cases/);
    expect(readFileSync(path.join(ROOT, "scripts/sql/track-a/de-kp/persona-update.sql"), "utf8")).toBe(body.replace(head, readFileSync(path.join(ROOT, "scripts/sql/track-a/de-kp/seed.sql"), "utf8").split("\n")[0] + "\n"));
  });
  it("fills only NULL columns and reads back, for a live case that gained a persona", () => {
    const body = personaUpdateSql([{ ...base(), patient_persona_de: persona, examiner_notes: [{ position: 1, may_probe_de: ["Dosis prüfen"] }] }], head);
    expect(body).toMatch(/patient_persona_de = coalesce\(patient_persona_de, /);
    expect(body).toMatch(/examiner_notes = coalesce\(examiner_notes, /);
    expect(body).toMatch(/read-back failed/);
    expect(body).toMatch(/^-- h\n[\s\S]*begin;[\s\S]*commit;\n$/);
  });
});

describe("insert SQL and the builder run with the new fields", () => {
  it("writes the S3 columns only for a case that has them", () => {
    const sql = caseInsertSql({ ...protoCase(), patient_persona_de: persona, examiner_notes: [{ position: 1, may_probe_de: ["Dosis"] }] });
    expect(sql).toMatch(/is_active, patient_persona_de, examiner_notes\)/);
    expect(sql).toMatch(/'protocol_informed'/);
    expect(caseInsertSql({ ...base(), patient_persona_de: persona })).toMatch(/is_active, patient_persona_de\)/);
  });
  it("a bank with an extended case builds, a broken extension fails with the rule named", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "s3-"));
    const cases = path.join(dir, "cases"); mkdirSync(cases);
    writeFileSync(path.join(cases, "a.json"), JSON.stringify({ ...protoCase(), patient_persona_de: persona }));
    const out = path.join(dir, "out");
    expect(run({ casesDir: cases, outDir: out, protocolAllowed: true }).ok).toBe(true);
    writeFileSync(path.join(cases, "a.json"), JSON.stringify({ ...protoCase({ sources: base().sources }) }));
    const bad = run({ casesDir: cases, outDir: out, protocolAllowed: true });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/provenance: protocol_informed needs/);
    expect(validateSet([base()])).toEqual([]);
  });
});

describe("adapter and registry read the new fields", () => {
  const ext = () => ({ ...protoCase(), patient_persona_de: persona, examiner_notes: [{ position: base().followups[1].position, may_probe_de: ["Nach der Dosis fragen", "Nach Alternativen fragen"] }] });
  it("passes persona and notes to the material and marks provenance", () => {
    const parsed = parseKpCase(ext());
    expect(parsed).not.toBeNull();
    const { material, sim } = toSimCase(parsed!);
    expect(material.patientPersona).toBe(persona);
    expect(material.examinerNotes).toEqual({ [followupItemId(base().followups[1].position)]: ["Nach der Dosis fragen", "Nach Alternativen fragen"] });
    expect(sim.provenance).toEqual({ kind: "protocol_informed", land: "Bayern", examDate: "2026-10" });
  });
  it("scored items are identical with and without the extension", () => {
    expect(toSimCase(parseKpCase(ext())!).sim.items).toEqual(toSimCase(parseKpCase(base())!).sim.items);
  });
  it("database nulls read as absent", () => {
    const { material } = toSimCase(parseKpCase({ ...base(), patient_persona_de: null, examiner_notes: null })!);
    expect(material.patientPersona).toBeNull();
    expect(material.examinerNotes).toEqual({});
  });
  it("a protocol source row without a url parses; a drafted source without one does not", () => {
    expect(parseKpCase(protoCase())).not.toBeNull();
    expect(parseKpCase({ ...base(), sources: [{ kind: "awmf", ref: "x" }] })).toBeNull();
  });
  it("malformed optional fields reject the case", () => {
    for (const bad of [{ patient_persona_de: 3 }, { patient_persona_de: "  " }, { examiner_notes: "x" }, { examiner_notes: [{ position: 99, may_probe_de: ["x"] }] }, { examiner_notes: [{ position: 1, may_probe_de: [] }] }, { examiner_notes: [{ position: 1, may_probe_de: [4] }] }]) {
      expect(parseKpCase({ ...base(), ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("protocol label", () => {
  it("is null for a case drafted from open references", () => expect(protocolLabelDe({ kind: "drafted_from_open_refs" })).toBeNull());
  it("names Land and month", () => expect(protocolLabelDe({ kind: "protocol_informed", land: "Bayern", examDate: "2026-10" })).toBe("Nach Prüfungsprotokoll, Bayern, Oktober 2026"));
  it("shows month and year only, whatever precision the source holds", () => {
    expect(protocolLabelDe({ kind: "protocol_informed", land: "Hessen", examDate: "2026-03-04" })).toBe("Nach Prüfungsprotokoll, Hessen, März 2026");
    expect(protocolDateDe("2026-03-04")).toBe("März 2026");
    expect(protocolLabelDe({ kind: "protocol_informed", land: "Hessen", examDate: "2026-03-04" })).not.toMatch(/\b4\./);
  });
  it("is null (hide the case) when Land or date is missing or unreadable", () => {
    for (const p of [{ land: null, examDate: null }, { land: "Berlin", examDate: "kaputt" }, { land: "Berlin", examDate: null }, { land: null, examDate: "2026-10" }, { land: "  ", examDate: "2026-10" }]) {
      expect(protocolLabelDe({ kind: "protocol_informed", ...p }), JSON.stringify(p)).toBeNull();
    }
  });
  it("has no dash, never-say word or claim of a real exam", () => {
    const l = protocolLabelDe({ kind: "protocol_informed", land: "Sachsen-Anhalt", examDate: "2026-12" })!;
    expect(l).not.toMatch(/[–—]/);
    expect(l).not.toMatch(/real|recalled|offiziell|altfall|prüfungsfall/i);
    expect(protocolDateDe("2026-12")).toBe("Dezember 2026");
  });
});
