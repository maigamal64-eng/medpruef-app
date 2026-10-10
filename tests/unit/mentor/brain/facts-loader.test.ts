import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MentorFactsLoader,
  appBillingFacts,
  isAssertable,
  readFactFilesFromDisk,
  sittingFactId,
  sittingToFact,
  validateFactRecord,
} from "@/lib/mentor/facts-loader";
import { FACTS, NOW, SITTINGS, fact, makeLoader } from "./helpers";

describe("validateFactRecord (C6 shape, fail closed)", () => {
  it("accepts a valid record", () => {
    expect(validateFactRecord(FACTS[0]).ok).toBe(true);
  });
  it("rejects unknown keys, bad enums, bad dates and reserved prefixes", () => {
    expect(validateFactRecord({ ...FACTS[0], extra: 1 }).ok).toBe(false);
    expect(validateFactRecord({ ...FACTS[0], verdict: "maybe" }).ok).toBe(false);
    expect(validateFactRecord({ ...FACTS[0], read_on: "10.01.2099" }).ok).toBe(false);
    expect(validateFactRecord({ ...FACTS[0], source_url: "http://insecure.example" }).ok).toBe(false);
    expect(validateFactRecord({ ...FACTS[0], id: "sitting.sip5a.x" }).ok).toBe(false);
    expect(validateFactRecord({ ...FACTS[0], id: "question.1" }).ok).toBe(false);
    expect(validateFactRecord(null).ok).toBe(false);
    expect(validateFactRecord([]).ok).toBe(false);
  });
});

describe("assertability", () => {
  it("confirmed + live + not past valid_until only", () => {
    expect(isAssertable(FACTS[0], NOW)).toBe(true);
    expect(isAssertable(fact({ id: "x.partly", verdict: "partly" }), NOW)).toBe(false);
    expect(isAssertable(fact({ id: "x.review", status: "needs_review" }), NOW)).toBe(false);
    expect(isAssertable(fact({ id: "x.old", valid_until: "2099-01-09" }), NOW)).toBe(false);
    expect(isAssertable(fact({ id: "x.today", valid_until: "2099-01-10" }), NOW)).toBe(true);
  });
});

describe("MentorFactsLoader", () => {
  it("byIds returns assertable facts and derived sittings, never the rest", async () => {
    const l = makeLoader();
    const sid = sittingFactId(SITTINGS[0]);
    const got = await l.byIds(["fixture.fee.sip5a", "fixture.partly.sip5a", "fixture.expired.sip5a", "nope", sid], NOW);
    expect(got.map((f) => f.id)).toEqual(["fixture.fee.sip5a", sid]);
    expect(got[1].text_de).toContain("2099-04-20");
    expect(got[1].text_de).toContain("2099-03-18");
    expect(got[1].source_url).toBe(SITTINGS[0].source_url);
  });

  it("drops duplicates and malformed records and logs them", () => {
    const logs: string[] = [];
    const l = makeLoader([...FACTS, FACTS[0], { id: "bad" }], SITTINGS, (m) => logs.push(m));
    expect(l.peek("fixture.fee.sip5a", NOW)).toBeNull();
    expect(l.loadErrors().join(" ")).toMatch(/duplicate id fixture.fee.sip5a/);
    expect(l.loadErrors().join(" ")).toMatch(/bad/);
    expect(logs.length).toBe(1);
  });

  it("a missing facts dir gives an empty set plus an error, never a throw", () => {
    const l = new MentorFactsLoader({
      files: () => readFactFilesFromDisk(path.join(os.tmpdir(), "mentor-facts-does-not-exist-xyz")),
      sittings: [],
      appFacts: () => [],
      log: () => {},
    });
    expect(l.size()).toBe(0);
    expect(l.loadErrors()[0]).toMatch(/not readable/);
  });

  it("reads *.json from disk and skips SCHEMA.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mentor-facts-"));
    fs.writeFileSync(path.join(dir, "SCHEMA.json"), JSON.stringify({ not: "facts" }));
    fs.writeFileSync(path.join(dir, "sip.json"), JSON.stringify([FACTS[0]]));
    fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
    const r = readFactFilesFromDisk(dir);
    expect(r.files.map((f) => f.file)).toEqual(["sip.json"]);
    expect(r.errors[0]).toMatch(/broken.json/);
  });

  it("search ranks German keywords and aliases, filters by exam (general always included), points at unconfirmed facts without text", () => {
    const l = makeLoader();
    const r = l.searchDetailed("Wie hoch ist die Gebühr?", "sip5a", undefined, NOW);
    expect(r.facts[0].id).toBe("fixture.fee.sip5a");
    const a = l.searchDetailed("Wie viele Antritte habe ich", "sip5a", undefined, NOW);
    expect(a.facts.find((f) => f.id === "fixture.partly.sip5a")).toBeUndefined();
    expect(a.unconfirmed.map((u) => u.id)).toContain("fixture.partly.sip5a");
    expect(JSON.stringify(a.unconfirmed)).not.toContain("9 Antritte");
    const g = l.searchDetailed("Anerkennung Nostrifikation", "sip5a", undefined, NOW);
    expect(g.facts.map((f) => f.id)).toContain("fixture.general.glossary");
    const ru = l.searchDetailed("сбор", undefined, undefined, NOW);
    expect(ru.facts[0]?.id).toBe("fixture.fee.sip5a");
  });

  it("dates returns upcoming official sittings for the filing university plus date facts", () => {
    const l = makeLoader();
    const w = l.datesAt("stichprobentest", "wien", NOW);
    expect(w.sittings.map((s) => s.registration_closes)).toEqual(["2099-03-02"]);
    const i = l.datesAt("stichprobentest", "innsbruck", NOW);
    expect(i.sittings.map((s) => s.publisher)).toEqual(["Fixture Uni Innsbruck"]);
    expect(l.datesAt("stichprobentest", "graz", NOW).sittings).toEqual([]);
    expect(l.datesAt("sip4a", "wien", NOW).sittings).toEqual([]); // past sitting ages out
    const s = l.datesAt("sip5a", "wien", NOW);
    expect(s.facts.map((f) => f.id)).toEqual(["fixture.dates.sip5a"]);
    expect(l.universitiesWithRows("stichprobentest", NOW)).toEqual(["innsbruck", "wien"]);
  });

  it("sheetFacts excludes dates, deadlines and non-assertable facts, deterministic order", () => {
    const l = makeLoader();
    const a = l.sheetFacts(NOW).map((f) => f.id);
    // Short, often-asked rules first (fee, pass rule), then format, then glossary (eval W3).
    expect(a).toEqual(["fixture.fee.sip5a", "fixture.pass.sip5a", "fixture.format.sip5a", "fixture.general.glossary"]);
    expect(makeLoader().sheetFacts(NOW).map((f) => f.id)).toEqual(a);
  });

  it("sitting facts are confirmed, live and carry the official source", () => {
    const f = sittingToFact(SITTINGS[1]);
    expect(f.id).toBe("sitting.stichprobentest.2099-05-06.wien.filing");
    expect(f.deadline_type).toBe("filing_cutoff");
    expect(isAssertable(f, NOW)).toBe(true);
    expect(validateFactRecord({ ...f, id: "x.y.z" }).ok).toBe(true);
  });

  it("app billing facts come from billing-copy.ts and are valid C6 records", () => {
    const facts = appBillingFacts();
    expect(facts.map((f) => f.id)).toEqual(["app.billing.plans", "app.billing.trial", "app.billing.cancel"]);
    for (const f of facts) expect(f.text_de.length).toBeGreaterThan(10);
  });
});
