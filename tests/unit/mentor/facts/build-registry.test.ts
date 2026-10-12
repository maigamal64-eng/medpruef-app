import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_PATH,
  allFacts,
  buildRegistry,
  dateNeedles,
  dueFacts,
  loadFacts,
  stringifyRegistry,
  verifyBaseline,
  watchEntries,
} from "../../../../scripts/build-facts-registry.mjs";
import * as examDates from "@/lib/exam-dates";

const facts = allFacts(loadFacts()) as Array<{
  id: string;
  exam_key: string;
  topic: string;
  source_url: string;
  text_en: string;
  valid_until?: string;
  deadline_type?: string;
  filing_university: string;
  read_on: string;
}>;
const committedText = readFileSync(REGISTRY_PATH, "utf8");
const committed = JSON.parse(committedText);
const HAND_IDS = ["kp_wien_sitting", "kp_wien_deadline", "kp_wien_fee", "stichprobentest_sitting", "stichprobentest_deadline", "pharma_scheduling"];

describe("FACTS-REGISTRY.json is generated from the mentor facts", () => {
  it("the committed registry is exactly what the script builds (re-run it if this fails)", () => {
    expect(stringifyRegistry(buildRegistry(committed, facts))).toBe(committedText);
  });

  it("building twice changes nothing (idempotent) and the generated section replaces itself", () => {
    const once = buildRegistry(committed, facts);
    const twice = buildRegistry(once, facts);
    expect(stringifyRegistry(twice)).toBe(stringifyRegistry(once));
    const stale = { ...committed, facts: [...committed.facts, { id: "mf:stale", origin: "mentor-facts", source_url: "https://x.example", expect_any: ["1"], facts: [] }] };
    expect(buildRegistry(stale, facts).facts.some((e: { id: string }) => e.id === "mf:stale")).toBe(false);
  });

  it("keeps every hand-written entry untouched and in front of the generated ones", () => {
    const hand = committed.facts.filter((e: { origin?: string }) => e.origin !== "mentor-facts");
    expect(hand.map((e: { id: string }) => e.id)).toEqual(HAND_IDS);
    const firstGenerated = committed.facts.findIndex((e: { origin?: string }) => e.origin === "mentor-facts");
    expect(firstGenerated).toBe(HAND_IDS.length);
    for (const e of hand) {
      expect(e.origin).toBeUndefined();
      expect(typeof e.value).toBe("string");
    }
  });

  it("the serialiser keeps the hand-written formatting: arrays of strings stay on one line", () => {
    expect(committedText).toContain('"expect_any": ["28.09.2026", "28. September 2026", "28.9.2026"]');
    const inline = committedText.match(/"expect_any": \[[^\]\n]*\]/g) ?? [];
    expect(inline.length).toBe(committed.facts.length);
    expect(committedText.endsWith("}\n")).toBe(true);
  });

  it("every dates or deadline fact is covered by at least one watched (source, date) entry on its own source", () => {
    const generated = committed.facts.filter((e: { origin?: string }) => e.origin === "mentor-facts");
    const covered = new Map<string, string[]>();
    for (const e of generated) for (const id of e.facts) covered.set(id, [...(covered.get(id) ?? []), e.source_url]);
    for (const f of facts.filter((x) => x.topic === "dates" || x.deadline_type)) {
      const urls = covered.get(f.id);
      if (!urls) {
        // allowed only when the text prints no date but the fact's own read date
        const [y, m, d] = f.read_on.split("-").map(Number);
        const stamp = `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
        expect(f.text_en.split(stamp).join("")).not.toMatch(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/);
        continue;
      }
      expect(urls.every((u) => u === f.source_url), f.id).toBe(true);
    }
  });

  it("needles are ASCII numeric or ASCII month-name dates, never empty, and entry ids are unique", () => {
    const generated = committed.facts.filter((e: { origin?: string }) => e.origin === "mentor-facts");
    expect(generated.length).toBeGreaterThan(30);
    const ids = new Set<string>();
    for (const e of generated) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(e.value).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(e.expect_any.length).toBeGreaterThan(0);
      expect(e.source_url).toMatch(/^https:\/\//);
      expect(["critical", "high", "medium"]).toContain(e.severity);
      for (const n of e.expect_any) expect(/^[\x20-\x7e]+$/.test(n), n).toBe(true);
    }
  });

  it("date needles cover the spellings the official pages use", () => {
    expect(dateNeedles("2026-12-14")).toEqual(expect.arrayContaining(["14.12.2026", "14. 12. 2026"]));
    expect(dateNeedles("2027-03-17")).toEqual(expect.arrayContaining(["17.03.2027", "17.3.2027", "17. 3. 2027"]));
    expect(dateNeedles("2027-02-03")).toEqual(expect.arrayContaining(["03.02.2027", "3.2.2027", "3. 2. 2027", "03. Februar 2027"]));
    // March has no ASCII spelling on the pages ("Maerz" does not occur), so only numeric needles
    expect(dateNeedles("2027-03-10").join(" ")).not.toMatch(/rz/);
    expect(dateNeedles("2027-05-04")).toContain("04. Mai 2027");
  });

  it("a SIP calendar window is watched by its close date only (the open date has no year on the page)", () => {
    const sip = facts.filter((f) => f.id === "sip5a.dates.2026-11");
    const e = watchEntries(sip) as Array<{ value: string }>;
    expect(e.map((x) => x.value).sort()).toEqual(["2026-10-19", "2026-11-17"]);
    // ... while a PDF that prints both ends in full watches both
    const rez = watchEntries(facts.filter((f) => f.id === "rezeptierkunde.dates.2026-11")) as Array<{ value: string }>;
    expect(rez.map((x) => x.value).sort()).toEqual(["2026-10-07", "2026-10-20", "2026-11-23", "2026-11-27"]);
  });

  it("verifyBaseline reports a needle that its source no longer contains", () => {
    const reg = { facts: [{ id: "mf:cal:2030-01-01", origin: "mentor-facts", expect_any: ["01.01.2030"] }] };
    // directory without baseline files: nothing checkable, nothing missing
    const r = verifyBaseline(reg, "/nonexistent-dir-for-test");
    expect(r.misses).toEqual([]);
    expect(r.skipped).toEqual(["mf:cal:2030-01-01"]);
  });
});

/**
 * Cross-check against the official sittings list in src/lib/exam-dates.ts (W1-CAL, C7).
 * Dates have two owners at integration time (the C7 list and these facts, because the code
 * validator only sees MentorFact[]), so they must agree. This block is inert until
 * OFFICIAL_SITTINGS is filled (it is an empty stub before W1-CAL merges) and bites at R3.
 */
const sittings = ((examDates as { OFFICIAL_SITTINGS?: ReadonlyArray<Record<string, unknown>> }).OFFICIAL_SITTINGS ?? []) as Array<{
  exam_key: string;
  date: string;
  date_end?: string;
  registration_closes: string | null;
  deadline_type: string;
  publisher: string;
  filing_university?: string;
}>;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const en = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

describe.skipIf(sittings.length === 0)("mentor date facts agree with OFFICIAL_SITTINGS (C7)", () => {
  it("every official sitting has a mentor dates or registration fact ending with its last day, naming its registration close", () => {
    for (const s of sittings) {
      const last = s.date_end ?? s.date;
      const same = facts.filter((f) => f.exam_key === s.exam_key && (f.topic === "dates" || f.topic === "registration") && f.valid_until === last);
      expect(same.length, `${s.exam_key} ${s.date}`).toBeGreaterThan(0);
      if (s.registration_closes) {
        const hit = same.filter((f) => f.text_en.includes(en(s.registration_closes!)));
        expect(hit.length, `${s.exam_key} ${s.date} close ${s.registration_closes}`).toBeGreaterThan(0);
        if (s.exam_key === "stichprobentest" && s.publisher === "MedUni Wien" && s.deadline_type === "filing_cutoff") {
          expect(hit.some((f) => /Merkblatt/.test(f.text_en))).toBe(true);
        }
        if (s.exam_key === "stichprobentest" && s.filing_university === "innsbruck") {
          expect(hit.some((f) => /i-med/.test(f.text_en))).toBe(true);
        }
      }
    }
  });
});

describe("review dates (M6): facts past read_on + review_every_days are listed", () => {
  const mk = (id: string, read_on: string, days: number) => ({ id, read_on, review_every_days: days });
  it("overdue only strictly after the due day, same rule as the runtime isAssertable", () => {
    const f = [mk("a.fee", "2026-10-10", 90), mk("a.fmt", "2026-10-10", 365), mk("a.dates", "2026-10-10", 30)];
    expect(dueFacts(f, "2026-11-09")).toEqual([]); // the due day itself is still fine
    expect(dueFacts(f, "2026-11-10").map((x: { id: string }) => x.id)).toEqual(["a.dates"]);
    expect(dueFacts(f, "2027-01-09").map((x: { id: string }) => x.id)).toEqual(["a.dates", "a.fee"]);
    expect(dueFacts(f, "2027-10-11").map((x: { id: string }) => x.id)).toEqual(["a.dates", "a.fee", "a.fmt"]);
  });

  it("no seeded fact is overdue on the day it was read", () => {
    expect(dueFacts(facts, "2026-10-10")).toEqual([]);
  });
});
