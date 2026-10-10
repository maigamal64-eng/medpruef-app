import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXAM_SITTINGS,
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  getNextOfficialDeadlineGroup,
  getNextRegistrationDeadlineSitting,
  getOpenOfficialDeadlineGroups,
  getUpcomingOfficialFor,
  isOfficialWindowOpen,
  officialSittingsForAgents,
  viennaStamp,
  type OfficialExamKey,
  type OfficialSitting,
} from "@/lib/exam-dates";

describe("getNextRegistrationDeadlineSitting", () => {
  it("selects the earliest published deadline and keeps it on the deadline day", () => {
    const sitting = getNextRegistrationDeadlineSitting(
      new Date("2026-07-28T12:00:00Z")
    );

    expect(sitting?.examType).toBe("kenntnispruefung");
    expect(sitting?.registrationDeadline).toBe("2026-07-28");
  });

  it("moves to the next sitting once the prior registration deadline passes", () => {
    const sitting = getNextRegistrationDeadlineSitting(
      new Date("2026-07-29T00:00:00Z")
    );

    expect(sitting?.examType).toBe("kmp_innsbruck");
    expect(sitting?.registrationDeadline).toBe("2026-08-26");
  });

  it("skips expired deadlines and selects the next published sitting", () => {
    for (const now of ["2026-08-27T00:00:00Z", "2026-09-26T12:00:00Z"]) {
      const sitting = getNextRegistrationDeadlineSitting(new Date(now));
      expect(sitting?.date).toBe("2027-01-18");
      expect(sitting?.registrationDeadline).toBe("2026-11-18");
    }
  });

  it("uses the newly published 2027 Kenntnisprüfung deadline after the 2026 deadlines pass", () => {
    const sitting = getNextRegistrationDeadlineSitting(
      new Date("2026-09-27T12:00:00Z")
    );

    expect(sitting?.examType).toBe("kenntnispruefung");
    expect(sitting?.date).toBe("2027-01-18");
    expect(sitting?.registrationDeadline).toBe("2026-11-18");
  });
});

// ---------------------------------------------------------------------------
// C7 / C14: every OFFICIAL_SITTINGS value must pair with a row of the official
// research files. The files live in the gitignored reports/ folder of the
// main checkout, so they are found through the shared git dir (works from a
// worktree too). OFFICIAL_DATES_DIR overrides. A missing file FAILS: this test
// is the control for dates learners act on.
// ---------------------------------------------------------------------------

const OFFICIAL_FILES = ["official-vienna.json", "official-spt-pharma.json"];

function officialDir(): string {
  if (process.env.OFFICIAL_DATES_DIR) return process.env.OFFICIAL_DATES_DIR;
  const common = execSync("git rev-parse --path-format=absolute --git-common-dir", {
    cwd: __dirname,
  })
    .toString()
    .trim();
  return path.join(path.dirname(common), "reports/archive-sweep-2026-10-09/out/finish");
}

interface NextDateRow {
  exam: string;
  date: string;
  registration: string;
  file: string;
}

function loadNextDates(): NextDateRow[] {
  const dir = officialDir();
  const rows: NextDateRow[] = [];
  for (const f of OFFICIAL_FILES) {
    const file = path.join(dir, f);
    if (!existsSync(file)) {
      throw new Error(
        `Official research file missing: ${file}. Set OFFICIAL_DATES_DIR to the folder holding ${OFFICIAL_FILES.join(" and ")}.`
      );
    }
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      next_dates: Array<{ exam: string; date: string; registration: string }>;
    };
    for (const r of json.next_dates) rows.push({ ...r, file: f });
  }
  return rows;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const iso = (y: string, mon: string, d: string) =>
  `${y}-${MONTHS[mon.slice(0, 3).toLowerCase()]}-${d.padStart(2, "0")}`;

/**
 * ISO dates written in a research text. Handles "17 Nov 2026",
 * "5 to 19 Oct 2026", "23 to 27 Nov 2026" and "19 Jul to 2 Aug 2027"; a
 * yearless "27 Apr" is ignored (safe failure: the row then has to pair with a
 * fuller official row).
 */
function datesIn(text: string): Set<string> {
  const out = new Set<string>();
  const M = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
  const rangeSameMonth = new RegExp(`\\b(\\d{1,2}) to (\\d{1,2}) ${M} (\\d{4})`, "g");
  const rangeTwoMonths = new RegExp(`\\b(\\d{1,2}) ${M} to (\\d{1,2}) ${M} (\\d{4})`, "g");
  const single = new RegExp(`\\b(\\d{1,2}) ${M} (\\d{4})`, "g");
  for (const m of text.matchAll(rangeSameMonth)) {
    out.add(iso(m[4], m[3], m[1]));
    out.add(iso(m[4], m[3], m[2]));
  }
  for (const m of text.matchAll(rangeTwoMonths)) {
    out.add(iso(m[5], m[2], m[1]));
    out.add(iso(m[5], m[4], m[3]));
  }
  for (const m of text.matchAll(single)) out.add(iso(m[3], m[2], m[1]));
  return out;
}

const EXAM_WORD: Record<OfficialExamKey, string> = {
  sip4a: "sip4a",
  sip5a: "sip5a",
  stichprobentest: "stichprobentest",
  rezeptierkunde: "rezeptierkunde",
  gerichtsmedizin: "gerichtsmedizin",
  c1: "c1",
  general: "general",
  fsp: "fsp",
};

/** The official rows that describe this sitting (exam word + sitting date). */
function officialRowsFor(s: OfficialSitting, rows: NextDateRow[]): NextDateRow[] {
  const word = EXAM_WORD[s.exam_key];
  const other = s.exam_key === "sip4a" ? "sip5a" : s.exam_key === "sip5a" ? "sip4a" : null;
  const candidates = rows.filter((r) => {
    const exam = r.exam.toLowerCase();
    if (!exam.includes(word)) return false;
    const dates = datesIn(r.date);
    return dates.has(s.date) && (!s.date_end || dates.has(s.date_end));
  });
  // Prefer rows naming only this SIP part, so 17 Nov cannot pair as SIP4a.
  const exact = candidates.filter((r) => !other || !r.exam.toLowerCase().includes(other));
  return exact.length > 0 ? exact : candidates;
}

/** The sentence or clause of a registration text that holds `date`. */
function clauseWith(text: string, date: string): string | null {
  for (const clause of text.split(/[;.]\s+/)) if (datesIn(clause).has(date)) return clause;
  return null;
}

describe("C7 OFFICIAL_SITTINGS vs the official research files (C14)", () => {
  const nextDates = loadNextDates();

  it("is filled, sorted by date, and every row was read on a stated day", () => {
    expect(OFFICIAL_SITTINGS.length).toBeGreaterThan(0);
    const dates = OFFICIAL_SITTINGS.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    for (const s of OFFICIAL_SITTINGS) {
      expect(s.read_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.source_url).toMatch(/^https:\/\/(www\.)?(meduniwien|i-med)\.ac\.at\//);
    }
  });

  for (const s of OFFICIAL_SITTINGS) {
    const name = `${s.exam_key} ${s.date} (${s.deadline_type}, ${s.publisher})`;

    it(`${name}: sitting date pairs with an official row`, () => {
      expect(officialRowsFor(s, nextDates).length).toBeGreaterThan(0);
    });

    it(`${name}: deadline and window pair with the SAME official row`, () => {
      const paired = officialRowsFor(s, nextDates).filter((r) => {
        const reg = datesIn(r.registration);
        if (s.registration_closes && !reg.has(s.registration_closes)) return false;
        if (s.registration_opens && !reg.has(s.registration_opens)) return false;
        if (s.closes_at_time && !r.registration.includes(s.closes_at_time)) return false;
        if (s.exam_key === "stichprobentest") {
          // The clause holding the date must name the right publisher:
          // Merkblatt for the MedUni Wien filing cutoff, i-med for the
          // i-med Anmeldefrist. This catches the 7 Jan i-med date being
          // attached to the Merkblatt row (or the reverse).
          const clause = clauseWith(r.registration, s.registration_closes!);
          if (!clause) return false;
          const term = s.deadline_type === "filing_cutoff" ? "merkblatt" : "i-med";
          if (!clause.toLowerCase().includes(term)) return false;
        }
        return true;
      });
      expect(paired.length, JSON.stringify(officialRowsFor(s, nextDates))).toBeGreaterThan(0);
    });
  }

  it("shows both publishers for every Stichprobentest sitting", () => {
    const stp = OFFICIAL_SITTINGS.filter((s) => s.exam_key === "stichprobentest");
    const byDate = new Map<string, OfficialSitting[]>();
    for (const s of stp) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
    expect(byDate.size).toBeGreaterThan(0);
    for (const rows of byDate.values()) {
      expect(rows.map((r) => r.deadline_type).sort()).toEqual(["filing_cutoff", "registration"]);
      expect(new Set(rows.map((r) => r.publisher)).size).toBe(2);
    }
  });

  it("never carries a postgraduate ÖÄK sitting (EXAM_SITTINGS.kenntnispruefung)", () => {
    // Role-aware on purpose: some official MedUni Wien dates fall on the same
    // calendar day as an ÖÄK date (e.g. the Jan exam week starts on the ÖÄK
    // sitting day). What must never appear is an ÖÄK sitting itself.
    const oeaek = EXAM_SITTINGS.kenntnispruefung;
    expect(oeaek.length).toBeGreaterThan(0);
    const oeaekPairs = new Set(oeaek.map((s) => `${s.date}|${s.registrationDeadline}`));
    for (const s of OFFICIAL_SITTINGS) {
      expect(oeaekPairs.has(`${s.date}|${s.registration_closes}`), s.date).toBe(false);
      expect(s.source_url).not.toMatch(/arztakademie|aerztekammer/);
      expect(`${s.learner_label.de} ${s.learner_label.en}`).not.toMatch(/Kenntnispr|ÖÄK|Arztpr/);
    }
  });
});

describe("C7 deadline selection in Vienna time", () => {
  // 2026-10-19 21:30 UTC = 23:30 Vienna (CEST, UTC+2).
  it("keeps the SIP window open until the end of Mon 19 Oct in Vienna", () => {
    const now = new Date("2026-10-19T21:30:00Z");
    expect(viennaStamp(now)).toBe("2026-10-19 23:30");
    const g = getNextOfficialDeadlineGroup({
      exams: OFFICIAL_KEYS_BY_BANK.kenntnispruefung,
      now,
    });
    expect(g?.registration_closes).toBe("2026-10-19");
    expect(g?.rows.map((r) => r.exam_key).sort()).toEqual(["sip4a", "sip5a"]);
  });

  it("moves the Vienna bank to the Feb window once 19 Oct has ended in Vienna", () => {
    const now = new Date("2026-10-19T22:00:00Z"); // 00:00 Tue 20 Oct Vienna
    const g = getNextOfficialDeadlineGroup({
      exams: OFFICIAL_KEYS_BY_BANK.kenntnispruefung,
      now,
    });
    expect(g?.registration_closes).toBe("2027-01-18");
    expect(g?.started).toBe(false);
  });

  it("closes the Rezeptierkunde/Gerichtsmedizin window at 12:00 Vienna on Tue 20 Oct", () => {
    const pharma = OFFICIAL_KEYS_BY_BANK.pharma;
    const open = getNextOfficialDeadlineGroup({
      exams: pharma,
      now: new Date("2026-10-20T09:59:00Z"), // 11:59 Vienna
    });
    expect(open?.registration_closes).toBe("2026-10-20");
    expect(open?.closes_at_time).toBe("12:00");
    expect(open?.rows.map((r) => r.exam_key).sort()).toEqual([
      "gerichtsmedizin",
      "rezeptierkunde",
    ]);
    const closed = getNextOfficialDeadlineGroup({
      exams: pharma,
      now: new Date("2026-10-20T10:01:00Z"), // 12:01 Vienna
    });
    expect(closed?.registration_closes).toBe("2026-12-15");
  });

  it("closes the Jan exam-week window at 12:00 Vienna on Tue 15 Dec (CET)", () => {
    const pharma = OFFICIAL_KEYS_BY_BANK.pharma;
    const row = OFFICIAL_SITTINGS.find(
      (s) => s.exam_key === "rezeptierkunde" && s.registration_closes === "2026-12-15"
    )!;
    expect(isOfficialWindowOpen(row, new Date("2026-12-15T10:59:00Z"))).toBe(true); // 11:59 CET
    expect(isOfficialWindowOpen(row, new Date("2026-12-15T11:01:00Z"))).toBe(false); // 12:01 CET
    const next = getNextOfficialDeadlineGroup({ exams: pharma, now: new Date("2026-12-15T11:01:00Z") });
    expect(next).toBeNull();
  });

  it("on 10 Oct the soonest open deadline across all exams is the SIP close on 19 Oct", () => {
    const g = getNextOfficialDeadlineGroup({ now: new Date("2026-10-10T08:00:00Z") });
    expect(g?.registration_closes).toBe("2026-10-19");
    expect(g?.deadline_type).toBe("registration");
  });

  it("keeps both Stichprobentest publishers as separate deadline groups", () => {
    const groups = getOpenOfficialDeadlineGroups({
      exams: OFFICIAL_KEYS_BY_BANK.kmp_innsbruck,
      now: new Date("2026-10-10T08:00:00Z"),
    });
    const first = groups.filter((g) => g.rows[0].date === "2027-02-03");
    expect(first.map((g) => g.deadline_type).sort()).toEqual(["filing_cutoff", "registration"]);
  });

  it("filters by filing university without dropping 'all' rows", () => {
    const wien = getUpcomingOfficialFor({
      exams: ["stichprobentest"],
      filingUniversity: "wien",
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(wien.every((s) => s.deadline_type === "filing_cutoff")).toBe(true);
  });

  it("agent payload labels every Stichprobentest deadline with its publisher and type", () => {
    const rows = officialSittingsForAgents({
      exams: ["stichprobentest"],
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.publisher).toBeTruthy();
      expect(r.deadlineType).toMatch(/Einreichungsfrist|Anmeldefrist/);
      expect(r.windowStatus).toBe("open");
    }
  });
});
