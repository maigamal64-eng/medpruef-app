import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { factsMatching, loadFactRecords, officialHostsOf, readOnDatesOf, truthTextOf, type FactRecord } from "./lib/facts-source";

function rec(id: string, over: Partial<FactRecord> = {}): FactRecord {
  return {
    id, exam_key: "sip4a", topic: "dates", filing_university: "wien", text_de: "DE", text_en: "EN", source_url: "https://www.meduniwien.ac.at/a/b", source_label: "MedUni Wien", read_on: "2026-10-10", verdict: "confirmed", status: "live", ...over,
  };
}

describe("facts source", () => {
  it("reads every json array in a directory and ignores SCHEMA.json and non-arrays", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mentor-facts-"));
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify([rec("a.one"), rec("a.two")]));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify([rec("b.one")]));
    fs.writeFileSync(path.join(dir, "SCHEMA.json"), JSON.stringify({ not: "facts" }));
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    expect(loadFactRecords(dir)?.map((r) => r.id)).toEqual(["a.one", "a.two", "b.one"]);
    expect(loadFactRecords(path.join(dir, "missing"))).toBeNull();
  });

  it("matches globs, builds truth text and the official host set", () => {
    const rs = [rec("sip4a.dates.2026-11", { text_en: "18 Nov 2026" }), rec("sip5a.dates.2026-11", { text_en: "17 Nov 2026", source_url: "https://www.i-med.ac.at/p" })];
    expect(factsMatching(rs, ["sip4a.dates.*"]).map((r) => r.id)).toEqual(["sip4a.dates.2026-11"]);
    expect(factsMatching(rs, [])).toEqual([]);
    expect(truthTextOf(rs, ["sip4a.dates.*"])).toContain("18 Nov 2026");
    expect(truthTextOf(rs, ["sip4a.dates.*"])).not.toContain("17 Nov 2026");
    expect([...officialHostsOf(rs)].sort()).toEqual(["i-med.ac.at", "medpruf.com", "meduniwien.ac.at"]);
    expect(readOnDatesOf(rs)).toEqual(["2026-10-10"]);
  });
});
