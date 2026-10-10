import { describe, it, expect, expectTypeOf } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MentorFact } from "@/lib/mentor/seam";
import {
  ALLOWED_KEYS,
  DEADLINE_TYPES,
  EXAM_KEYS,
  FACTS_DIR,
  FACT_FILES,
  FILING_UNIVERSITIES,
  ID_PATTERN,
  REQUIRED,
  STATUSES,
  TOPICS,
  VERDICTS,
  allFacts,
  datesInText,
  isAssertable,
  loadFacts,
  validateAll,
  validateFact,
  viennaDay,
} from "../../../../scripts/build-facts-registry.mjs";

const byFile = loadFacts();
const facts = allFacts(byFile) as MentorFact[];
const ROOT = join(FACTS_DIR, "..", "..");

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
const sample = (id: string) => clone(facts.find((f) => f.id === id)!) as Record<string, unknown>;

describe("mentor facts base: the seeded files are valid", () => {
  it("every record passes the C6 rules and the house rules", () => {
    expect(validateAll(byFile)).toEqual([]);
  });

  it("is seeded with a real base: at least 60 confirmed facts, every verdict present", () => {
    const confirmed = facts.filter((f) => f.verdict === "confirmed");
    expect(confirmed.length).toBeGreaterThanOrEqual(60);
    expect(new Set(facts.map((f) => f.verdict))).toEqual(new Set(["confirmed", "partly", "not_in_sources"]));
  });

  it("only the four owned data files (plus the frozen SCHEMA.json) live in content/mentor-facts", () => {
    const names = readdirSync(FACTS_DIR).sort();
    for (const n of names) expect([...Object.keys(FACT_FILES), "SCHEMA.json"]).toContain(n);
    for (const n of Object.keys(FACT_FILES)) expect(names).toContain(n);
  });

  it("each file only holds its own exam keys and ids are unique across files", () => {
    const seen = new Set<string>();
    for (const [file, list] of Object.entries(byFile) as [string, MentorFact[]][]) {
      for (const f of list) {
        expect(FACT_FILES[file as keyof typeof FACT_FILES]).toContain(f.exam_key);
        expect(seen.has(f.id)).toBe(false);
        seen.add(f.id);
      }
    }
  });

  it("matches the MentorFact shape frozen in src/lib/mentor/seam.ts", () => {
    expectTypeOf(facts[0]).toMatchTypeOf<MentorFact>();
    const keys = new Set(ALLOWED_KEYS);
    for (const f of facts) for (const k of Object.keys(f)) expect(keys.has(k)).toBe(true);
  });

  it("the built-in C6 enums equal the unions in seam.ts (one set of names, no drift)", () => {
    const seam = readFileSync(join(ROOT, "src/lib/mentor/seam.ts"), "utf8");
    const union = (name: string) => {
      const m = seam.match(new RegExp(`export type ${name} =([^;]+);`));
      expect(m, `${name} not found in seam.ts`).toBeTruthy();
      return [...m![1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]).sort();
    };
    expect(union("MentorExamKey")).toEqual([...EXAM_KEYS].sort());
    expect(union("MentorFactTopic")).toEqual([...TOPICS].sort());
    expect(union("FilingUniversity")).toEqual([...FILING_UNIVERSITIES].sort());
    const fact = seam.match(/export interface MentorFact \{([\s\S]*?)\n\}/)![1];
    const lit = (field: string) =>
      [...fact.match(new RegExp(`${field}\\??: ([^;]+);`))![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    expect(lit("verdict")).toEqual([...VERDICTS].sort());
    expect(lit("status")).toEqual([...STATUSES].sort());
    expect(lit("deadline_type")).toEqual([...DEADLINE_TYPES].sort());
  });

  it("agrees with content/mentor-facts/SCHEMA.json when that frozen schema file is present", () => {
    const schemaPath = join(FACTS_DIR, "SCHEMA.json");
    if (!existsSync(schemaPath)) return; // lands with C0a at integration; the test then bites
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const def = schema.$defs.Fact;
    expect([...def.required].sort()).toEqual([...REQUIRED].sort());
    expect(Object.keys(def.properties).sort()).toEqual([...ALLOWED_KEYS].sort());
    expect(def.additionalProperties).toBe(false);
    expect(def.properties.exam_key.enum).toEqual(EXAM_KEYS);
    expect(def.properties.topic.enum).toEqual(TOPICS);
    expect(def.properties.filing_university.enum).toEqual(FILING_UNIVERSITIES);
    expect(def.properties.deadline_type.enum).toEqual(DEADLINE_TYPES);
    expect(def.properties.verdict.enum).toEqual(VERDICTS);
    expect(def.properties.status.enum).toEqual(STATUSES);
    expect(new RegExp(def.properties.id.pattern).source).toBe(ID_PATTERN.source);
    expect(def.properties.text_de.maxLength).toBe(1200);
    expect(def.properties.text_en.maxLength).toBe(1200);
    expect(def.properties.source_url.pattern).toBe("^https://");
  });
});

describe("mentor facts base: honesty rules", () => {
  it("never carries postgraduate OeAEK facts (C14): no 28 Sep 2026, no 795 EUR, no 55 percent floor, no OeAEK/ÖÄK dates", () => {
    const all = facts.map((f) => `${f.text_de}\n${f.text_en}`).join("\n");
    for (const banned of [
      /28\.?\s?(Sep|September)\w*\s?2026/i,
      /2026-09-28/,
      /\b795\b/,
      /55\s?(%|percent|Prozent)/i,
      /Arztakademie/i,
      /arztakademie\.at/i,
    ]) {
      expect(all).not.toMatch(banned);
    }
    for (const f of facts) expect(f.source_url).not.toContain("arztakademie");
  });

  it("every fact that is not confirmed says so in both languages, and none says a stale-date claim as fact", () => {
    for (const f of facts.filter((x) => x.verdict !== "confirmed")) {
      expect(f.text_de).toMatch(/^(Nicht amtlich|Nicht eindeutig)/);
      expect(f.text_en).toMatch(/^(Not officially|Not unambiguously)/);
    }
  });

  it("no fact repeats the researched-wrong claims (prescription format for Wien, uniform statutory 150, 14-question Wien GM, moved deadline)", () => {
    const wien = facts.filter((f) => f.filing_university === "wien");
    for (const f of wien) {
      expect(f.text_en).not.toMatch(/3 prescriptions/i);
      expect(f.text_en).not.toMatch(/14 questions/i);
      expect(f.text_en).not.toMatch(/uniform|statutory (fee|taxe)/i);
    }
    expect(facts.map((f) => f.text_en).join(" ")).not.toMatch(/deadline (was )?moved/i);
    // the 150 EUR is the application taxe, never a per-test fee
    const fee = facts.find((f) => f.id === "general.fee.application-taxe")!;
    expect(fee.text_en).toMatch(/not per exam/);
  });

  it("the Vienna Rezeptierkunde fact is written MC, the prescription format is only Innsbruck's", () => {
    expect(facts.find((f) => f.id === "rezeptierkunde.format.wien-written-mc")!.text_en).toMatch(/30 questions/);
    const inn = facts.find((f) => f.id === "rezeptierkunde.format.innsbruck-prescriptions")!;
    expect(inn.filing_university).toBe("innsbruck");
    expect(inn.text_en).toMatch(/not the Vienna one/);
  });

  it("Stichprobentest deadlines are attributed to their publisher: Merkblatt rows are wien, i-med rows are innsbruck, never mixed", () => {
    const merk = facts.filter((f) => f.id.startsWith("stichprobentest.dates.") && f.id.endsWith(".wien-merkblatt"));
    const imed = facts.filter((f) => f.id.startsWith("stichprobentest.dates.") && f.id.endsWith(".imed"));
    expect(merk.length).toBe(2);
    expect(imed.length).toBe(2);
    for (const f of merk) {
      expect(f.filing_university).toBe("wien");
      expect(f.deadline_type).toBe("filing_cutoff");
      expect(f.text_en).toMatch(/MedUni Wien Merkblatt/);
      expect(f.text_en).not.toMatch(/i-med/i);
    }
    for (const f of imed) {
      expect(f.filing_university).toBe("innsbruck");
      expect(f.deadline_type).toBe("registration");
      expect(f.text_en).toMatch(/i-med/);
      expect(f.text_en).not.toMatch(/Merkblatt/);
    }
    // the rule that says which list applies is NOT asserted
    expect(facts.find((f) => f.id === "stichprobentest.dates.which-deadline-applies")!.verdict).toBe("partly");
  });

  it("the three sources that cannot be fully trusted are not confirmed: March 2027 SIP window, SIP attempt commission, Graz cutoffs", () => {
    for (const id of ["sip4a.registration.window-2027-03", "sip5a.registration.window-2027-03", "sip4a.attempts.commission", "sip5a.attempts.commission"]) {
      expect(facts.find((f) => f.id === id)!.verdict).toBe("partly");
    }
    expect(facts.find((f) => f.id === "stichprobentest.dates.graz-own-cutoffs")!.verdict).toBe("not_in_sources");
    expect(facts.find((f) => f.id === "rezeptierkunde.registration.deregistration")!.verdict).toBe("partly");
  });

  it("text is human-facing: no em dash anywhere (text, aliases, labels, editions)", () => {
    for (const f of facts) {
      for (const v of [f.text_de, f.text_en, f.source_label, f.edition, ...f.aliases]) expect(v).not.toContain("—");
    }
  });

  it("every fact cites an https source with a label and a read date, and every language is non-empty", () => {
    for (const f of facts) {
      expect(f.source_url).toMatch(/^https:\/\//);
      expect(f.source_label.length).toBeGreaterThan(5);
      expect(f.read_on).toBe("2026-10-10");
      expect(f.text_de.length).toBeGreaterThan(40);
      expect(f.text_en.length).toBeGreaterThan(40);
      expect(f.aliases.length).toBeGreaterThan(0);
    }
  });

  it("learner aliases cover the words learners use (SPT, STP, SIP4a, SIP5a, Rezeptierkunde, Gerichtsmedizin, C1) and the mentor languages ru, uk, tr", () => {
    const all = facts.flatMap((f) => f.aliases).join("|");
    for (const w of ["SPT", "STP", "SIP4a", "Rezeptierkunde", "Gerichtsmedizin", "C1"]) expect(all).toContain(w);
    expect(all).toMatch(/[Ѐ-ӿ]/); // Cyrillic (ru, uk)
    expect(all).toMatch(/[ıİşŞğĞ]/); // Turkish
    // Arabic wording waits for [name]'s sign-off: no Arabic anywhere in this base
    expect(`${all}${facts.map((f) => f.text_de + f.text_en).join("")}`).not.toMatch(/[؀-ۿ]/);
  });
});

describe("mentor facts base: dates never outlive their deadline", () => {
  const dated = facts.filter((f) => f.topic === "dates" || f.deadline_type);

  it("every dates or deadline fact has valid_until, not before any date printed in its text", () => {
    expect(dated.length).toBeGreaterThanOrEqual(25);
    for (const f of dated) {
      expect(f.valid_until, f.id).toBeTruthy();
      const printed = datesInText(f.text_en)
        .map((d: { iso: string }) => d.iso)
        .filter((iso: string) => iso !== f.read_on);
      for (const iso of printed) expect(f.valid_until! >= iso, `${f.id}: ${iso}`).toBe(true);
    }
  });

  it("valid_until is the last printed date for sitting and window facts (the fact dies with its sitting)", () => {
    for (const id of ["sip5a.dates.2026-11", "sip4a.dates.2027-02", "rezeptierkunde.dates.2026-11", "gerichtsmedizin.dates.2027-01"]) {
      const f = facts.find((x) => x.id === id)!;
      const last = datesInText(f.text_en).map((d: { iso: string }) => d.iso).sort().at(-1);
      expect(f.valid_until).toBe(last);
    }
  });

  it("a confirmed date fact is assertable today and stops being assertable the Vienna day after valid_until", () => {
    const today = new Date("2026-10-10T12:00:00Z");
    const rez = facts.find((f) => f.id === "rezeptierkunde.dates.2026-11")!;
    expect(rez.valid_until).toBe("2026-11-27");
    expect(isAssertable(rez, today)).toBe(true);
    // 27 Nov 22:30Z is 23:30 in Vienna: still the 27th
    expect(isAssertable(rez, new Date("2026-11-27T22:30:00Z"))).toBe(true);
    // 27 Nov 23:30Z is 00:30 on the 28th in Vienna: gone, although UTC is still the 27th
    expect(viennaDay(new Date("2026-11-27T23:30:00Z"))).toBe("2026-11-28");
    expect(isAssertable(rez, new Date("2026-11-27T23:30:00Z"))).toBe(false);
  });

  it("only confirmed live facts are assertable; partly and not_in_sources never are", () => {
    const today = new Date("2026-10-10T12:00:00Z");
    for (const f of facts) {
      if (f.verdict !== "confirmed") expect(isAssertable(f, today)).toBe(false);
    }
    expect(isAssertable({ ...facts[0], status: "needs_review" } as MentorFact, today)).toBe(false);
    expect(isAssertable({ ...facts[0], status: "retracted" } as MentorFact, today)).toBe(false);
    const live = facts.filter((f) => isAssertable(f, today));
    expect(live.length).toBeGreaterThanOrEqual(60);
  });

  it("by the end of the last sitting only the evergreen rules remain assertable", () => {
    const later = new Date("2027-10-01T10:00:00Z");
    const alive = facts.filter((f) => isAssertable(f, later));
    expect(alive.length).toBeGreaterThan(30);
    for (const f of alive) expect(f.topic === "dates" || f.deadline_type).toBeFalsy();
  });

  it("dates in the text parse as intended (ranges, single dates, the read date)", () => {
    expect(datesInText("Registration window 5 Oct to 19 Oct 2026; sitting 17 Nov 2026")).toEqual([
      { iso: "2026-10-05", kind: "open" },
      { iso: "2026-10-19", kind: "close" },
      { iso: "2026-11-17", kind: "single" },
    ]);
    expect(datesInText("no dates here")).toEqual([]);
  });
});

describe("mentor facts base: German and English say the same numbers and dates", () => {
  // The only normalisation: a clock time may be written "12 Uhr" in German and "12:00" in English.
  const digits = (t: string) => (t.replace(/(\d{1,2}):00/g, "$1").match(/\d+/g) ?? []).sort();
  const DE_MONTHS: Record<string, number> = { Januar: 1, Februar: 2, "März": 3, April: 4, Mai: 5, Juni: 6, Juli: 7, August: 8, September: 9, Oktober: 10, November: 11, Dezember: 12 };

  /** ISO dates printed in a German text ("17. November 2026", "5. Oktober bis 19. Oktober 2026"); a missing year is the next year printed after it. */
  function deDates(t: string): string[] {
    const re = new RegExp(`(\\d{1,2})\\. (${Object.keys(DE_MONTHS).join("|")})(?: (\\d{4}))?`, "g");
    const out: string[] = [];
    for (const m of t.matchAll(re)) {
      let year = m[3];
      if (!year) year = t.slice(m.index! + m[0].length).match(/\b(20\d\d)\b/)?.[1] ?? "????";
      out.push(`${year}-${String(DE_MONTHS[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
    }
    return out.sort();
  }

  it("every fact carries the same multiset of numbers in text_de and text_en", () => {
    for (const f of facts) expect(digits(f.text_de), f.id).toEqual(digits(f.text_en));
  });

  it("every date written out in German is the same calendar date as in the English text (no swapped 17 and 18 Nov, no Oct for Nov)", () => {
    let checked = 0;
    for (const f of facts) {
      const en = datesInText(f.text_en).map((d: { iso: string }) => d.iso).sort();
      expect(deDates(f.text_de), f.id).toEqual(en);
      checked += en.length;
    }
    expect(checked).toBeGreaterThanOrEqual(70);
  });

  it("the parity check itself catches a swap", () => {
    const f = facts.find((x) => x.id === "sip5a.dates.2026-11")!;
    expect(deDates(f.text_de.replace("17. November", "18. November"))).not.toEqual(datesInText(f.text_en).map((d: { iso: string }) => d.iso).sort());
    expect(digits(f.text_de.replace("17. November", "18. November"))).not.toEqual(digits(f.text_en));
  });
});

describe("mentor facts base: twins stay in step", () => {
  const find = (id: string) => facts.find((f) => f.id === id);

  it("every shared SIP rule exists for both sip4a and sip5a with identical sourcing", () => {
    const slugs = facts.filter((f) => f.exam_key === "sip4a" && !f.id.startsWith("sip4a.dates.")).map((f) => f.id.slice("sip4a.".length));
    expect(slugs.length).toBeGreaterThanOrEqual(12);
    for (const s of slugs) {
      const a = find(`sip4a.${s}`)!;
      const b = find(`sip5a.${s}`);
      expect(b, `sip5a.${s}`).toBeTruthy();
      // the official registration form is one PDF per exam, so those slugs cite their own form
      const ownForm = ["registration.method", "documents.same-sitting", "format.parts-on-form"].includes(s);
      for (const k of ["topic", "filing_university", "verdict", "review_every_days"] as const) {
        expect(b![k], `${s}.${k}`).toBe(a[k]);
      }
      if (ownForm) {
        expect(a.source_url).toContain("Anmeldung_SIP4a");
        expect(b!.source_url).toContain("Anmeldung_SIP5a");
      } else {
        for (const k of ["source_url", "source_label", "edition"] as const) expect(b![k], `${s}.${k}`).toBe(a[k]);
      }
      expect(b!.aliases).toEqual(a.aliases);
      // the text differs only by the exam name (and the pass rule's block versus subject, the form's own parts)
      if (s !== "pass_rule.sixty-percent" && s !== "format.parts-on-form") {
        expect(b!.text_en.replaceAll("SIP5a", "X")).toBe(a.text_en.replaceAll("SIP4a", "X"));
        expect(b!.text_de.replaceAll("SIP5a", "X")).toBe(a.text_de.replaceAll("SIP4a", "X"));
      }
    }
  });

  it("the SIP4a pass rule speaks of blocks, the SIP5a pass rule of subjects", () => {
    expect(find("sip4a.pass_rule.sixty-percent")!.text_en).toMatch(/each block/);
    expect(find("sip5a.pass_rule.sixty-percent")!.text_en).toMatch(/each subject/);
    expect(find("sip4a.pass_rule.sixty-percent")!.text_en).not.toMatch(/subject/);
  });

  it("Rezeptierkunde and Gerichtsmedizin have the same dated weeks and the same always-prescribed rule", () => {
    for (const slug of ["dates.2026-11", "dates.2027-01", "dates.ss-2027-not-published", "documents.always-prescribed", "registration.method", "registration.deregistration", "attempts.limit", "attempts.commission"]) {
      expect(find(`rezeptierkunde.${slug}`), `rezeptierkunde.${slug}`).toBeTruthy();
      expect(find(`gerichtsmedizin.${slug}`), `gerichtsmedizin.${slug}`).toBeTruthy();
    }
    const a = find("rezeptierkunde.dates.2026-11")!;
    const b = find("gerichtsmedizin.dates.2026-11")!;
    expect(a.valid_until).toBe(b.valid_until);
    expect(a.source_url).toBe(b.source_url);
  });
});

describe("validateFact: the rules actually reject bad records", () => {
  const goodSip = () => sample("sip5a.dates.2026-11");
  const goodRule = () => sample("sip4a.attempts.limit");

  it("accepts the unmodified samples", () => {
    expect(validateFact(goodSip(), "sip.json")).toEqual([]);
    expect(validateFact(goodRule(), "sip.json")).toEqual([]);
  });

  it("rejects a missing required field, an unknown key and a wrong type", () => {
    const m = goodRule();
    delete m.source_label;
    expect(validateFact(m, "sip.json").join()).toMatch(/missing source_label/);
    expect(validateFact({ ...goodRule(), extra: 1 }, "sip.json").join()).toMatch(/unknown key extra/);
    expect(validateFact({ ...goodRule(), aliases: "SIP" }, "sip.json").join()).toMatch(/aliases must be array/);
  });

  it("rejects bad enums, ids, urls, dates and lengths", () => {
    const bad = (patch: Record<string, unknown>, re: RegExp) => expect(validateFact({ ...goodRule(), ...patch }, "sip.json").join(), JSON.stringify(patch)).toMatch(re);
    bad({ exam_key: "kenntnispruefung" }, /bad exam_key/);
    bad({ topic: "price" }, /bad topic/);
    bad({ filing_university: "linz" }, /bad filing_university/);
    bad({ verdict: "maybe" }, /bad verdict/);
    bad({ status: "draft" }, /bad status/);
    bad({ deadline_type: "soon" }, /bad deadline_type/);
    bad({ id: "X" }, /id does not match/);
    bad({ source_url: "http://example.org" }, /must be https/);
    bad({ read_on: "10.10.2026" }, /read_on not an ISO date/);
    bad({ valid_until: "2026-13-01" }, /valid_until not an ISO date/);
    bad({ review_every_days: 400 }, /review_every_days/);
    bad({ text_en: "x".repeat(1201) }, /text_en length/);
    bad({ aliases: ["a", "a"] }, /duplicate aliases/);
    bad({ aliases: ["x".repeat(121)] }, /alias out of bounds/);
  });

  it("rejects ids that do not start with exam_key.topic., and facts filed in the wrong file", () => {
    expect(validateFact({ ...goodRule(), id: "sip4a.format.limit" }, "sip.json").join()).toMatch(/id must start with sip4a\.attempts\./);
    expect(validateFact(goodRule(), "pharma.json").join()).toMatch(/does not belong in pharma\.json/);
  });

  it("rejects an em dash in any user-facing field", () => {
    const dash = "—";
    expect(validateFact({ ...goodRule(), text_en: `Fine ${dash} not fine ${"x".repeat(50)}` }, "sip.json").join()).toMatch(/em dash/);
    expect(validateFact({ ...goodRule(), aliases: [`a${dash}b`] }, "sip.json").join()).toMatch(/em dash/);
  });

  it("a dates or deadline fact must carry valid_until, and it may not be earlier than its own text", () => {
    const noVu = goodSip();
    delete noVu.valid_until;
    expect(validateFact(noVu, "sip.json").join()).toMatch(/needs valid_until/);
    expect(validateFact({ ...goodSip(), valid_until: "2026-10-12" }, "sip.json").join()).toMatch(/before the date printed in its text/);
    expect(validateFact({ ...goodSip(), valid_until: "2026-10-01" }, "sip.json").join()).toMatch(/before read_on/);
  });

  it("a not-confirmed fact must announce it, and a confirmed fact must not", () => {
    expect(validateFact({ ...goodRule(), verdict: "partly" }, "sip.json").join()).toMatch(/not officially confirmed/i);
    expect(validateFact({ ...goodRule(), text_en: `Not officially confirmed: ${"x".repeat(50)}`, text_de: `Nicht amtlich bestätigt: ${"x".repeat(50)}` }, "sip.json").join()).toMatch(/confirmed but the text says it is not confirmed/);
  });

  it("validateAll catches a duplicate id and a missing twin", () => {
    const dup = clone(byFile);
    dup["sip.json"].push(clone(dup["sip.json"][5]));
    expect(validateAll(dup).join()).toMatch(/duplicate id/);
    const orphan = clone(byFile);
    orphan["sip.json"] = orphan["sip.json"].filter((f: { id: string }) => f.id !== "sip5a.attempts.limit");
    expect(validateAll(orphan).join()).toMatch(/twin sip5a\.attempts\.limit is missing/);
  });
});
