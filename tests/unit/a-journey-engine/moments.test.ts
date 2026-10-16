import { describe, expect, it } from "vitest";
import {
  getLearnerMoments,
  isSittingWeek,
  journeyMomentsForHq,
  momentsEnabled,
  optInDeadlineSchedule,
  optInSendDays,
  resolveNamedSitting,
  hqLearnerState,
} from "@/lib/journey/moments";
import { SITTINGS_EXCERPT as S } from "./sittings-excerpt";

/** 15 Oct 2026, 12:00 Vienna (CEST). */
const OCT15 = new Date("2026-10-15T10:00:00Z");

const closes = (m: ReturnType<typeof getLearnerMoments>) =>
  m.moments.filter((x) => x.kind === "registration_closes").map((x) => ({ on: x.on, at: x.at_time, publisher: x.publisher, type: x.deadline_type }));

describe("getLearnerMoments on the stored excerpt", () => {
  it("a SIP5a 17 Nov learner on 15 Oct shows registration closes 19 Oct (M2 then M3)", () => {
    const m = getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, OCT15, S);
    expect(m.certainty).toBe("named");
    expect(m.named?.exam_keys).toEqual(["sip5a"]);
    expect(m.named?.key).toBe("sip5a:2026-11-17");
    expect(m.phase).toBe("registration");
    expect(m.lead?.kind).toBe("registration_closes");
    expect(m.lead?.on).toBe("2026-10-19");
    expect(m.lead?.at_time).toBeNull();
    // 4 Vienna days left: inside the closing-soon window (M3).
    expect(m.closingSoon).toBe(true);
    expect(m.code).toBe("m3");
    expect(m.canConfirmRegistration).toBe(true);
    // Earlier in the window it is M2.
    const early = getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung" }, new Date("2026-10-06T08:00:00Z"), S);
    expect(early.code).toBe("m2");
  });

  it("an exam date stored as a timestamp still names the sitting", () => {
    const m = getLearnerMoments({ examDate: "2026-11-17T00:00:00+00:00", activeExam: null }, OCT15, S);
    expect(m.named?.key).toBe("sip5a:2026-11-17");
  });

  it("a Rez/GM learner shows closes 20 Oct 12:00 Vienna, one moment for both exams", () => {
    const m = getLearnerMoments({ examDate: "2026-11-23", activeExam: "pharma" }, OCT15, S);
    expect(m.named?.exam_keys).toEqual(["gerichtsmedizin", "rezeptierkunde"]);
    expect(m.named?.date_end).toBe("2026-11-27");
    expect(closes(m)).toEqual([{ on: "2026-10-20", at: "12:00", publisher: "MedUni Wien", type: "registration" }]);
    expect(m.lead?.on).toBe("2026-10-20");
    expect(m.lead?.at_time).toBe("12:00");
    // Open at 11:59 Vienna, closed at 12:00 Vienna.
    expect(getLearnerMoments({ examDate: "2026-11-23", activeExam: "pharma" }, new Date("2026-10-20T09:59:00Z"), S).phase).toBe("registration");
    const after = getLearnerMoments({ examDate: "2026-11-23", activeExam: "pharma" }, new Date("2026-10-20T10:00:00Z"), S);
    expect(after.phase).toBe("after_close");
    expect(after.openDeadlines).toEqual([]);
    // The last day of the exam week also names it.
    expect(resolveNamedSitting({ examDate: "2026-11-27", activeExam: "pharma" }, OCT15, S)?.key).toBe("gerichtsmedizin+rezeptierkunde:2026-11-23");
  });

  it("a 3 Feb Stichprobentest learner shows BOTH the 14 Dec MedUni Wien and the 7 Jan i-med rows and never picks one", () => {
    const m = getLearnerMoments({ examDate: "2027-02-03", activeExam: "kmp_innsbruck" }, OCT15, S);
    expect(m.named?.segment).toBe("stichprobentest");
    expect(closes(m)).toEqual([
      { on: "2026-12-14", at: null, publisher: "MedUni Wien", type: "filing_cutoff" },
      { on: "2027-01-07", at: null, publisher: "Medizinische Universität Innsbruck", type: "registration" },
    ]);
    expect(m.phase).toBe("registration");
    expect(m.openDeadlines.map((d) => d.publisher)).toEqual(["MedUni Wien", "Medizinische Universität Innsbruck"]);
    // Between the two closes the i-med row stays open on its own.
    const dec20 = getLearnerMoments({ examDate: "2027-02-03", activeExam: "kmp_innsbruck" }, new Date("2026-12-20T10:00:00Z"), S);
    expect(dec20.openDeadlines.map((d) => d.publisher)).toEqual(["Medizinische Universität Innsbruck"]);
    // Four weeks out (6 Jan) the cram card shows beside the still open i-med window.
    const jan6 = getLearnerMoments({ examDate: "2027-02-03", activeExam: "kmp_innsbruck" }, new Date("2027-01-06T10:00:00Z"), S);
    expect(jan6.inCram).toBe(true);
    expect(jan6.phase).toBe("registration");
    // A Vienna-bank learner who names the Stichprobentest date is a Stichprobentest learner.
    const vienna = getLearnerMoments({ examDate: "2027-02-03", activeExam: "kenntnispruefung" }, OCT15, S);
    expect(vienna.named?.segment).toBe("stichprobentest");
    expect(vienna.openDeadlines).toHaveLength(2);
  });

  it("the March 2027 SIP rows (window_unconfirmed) never lead", () => {
    const learner = { examDate: "2027-03-10", activeExam: "kenntnispruefung" };
    // Inside the printed (unconfirmed) window: no registration phase, no lead, nothing to confirm.
    const jan30 = getLearnerMoments(learner, new Date("2027-01-30T10:00:00Z"), S);
    expect(jan30.named?.exam_keys).toEqual(["sip4a", "sip5a"]);
    expect(jan30.phase).toBe("before_window");
    expect(jan30.lead).toBeNull();
    expect(jan30.openDeadlines).toEqual([]);
    expect(jan30.canConfirmRegistration).toBe(false);
    // The rows are still listed, marked.
    expect(jan30.moments.filter((x) => x.kind === "registration_closes").every((x) => x.window_unconfirmed)).toBe(true);
    // HQ export marks them too and never lists them as confirmed.
    const hq = journeyMomentsForHq(new Date("2027-01-20T10:00:00Z"), S).filter((x) => x.on === "2027-02-08");
    expect(hq.length).toBeGreaterThan(0);
    expect(hq.every((x) => x.window_unconfirmed)).toBe(true);
    // The a30 sender schedule never sends for them.
    for (const day of ["2027-01-25", "2027-02-06"]) {
      expect(optInDeadlineSchedule("kenntnispruefung", new Date(`${day}T10:00:00Z`), S)).toEqual([]);
    }
  });

  it("a null registration_opens is handled", () => {
    const m = getLearnerMoments({ examDate: "2027-02-03", activeExam: "kmp_innsbruck" }, OCT15, S);
    expect(m.moments.some((x) => x.kind === "registration_opens")).toBe(false);
    // A window with no opening counts as started (exam-dates hasOfficialWindowStarted).
    expect(m.canConfirmRegistration).toBe(true);
  });

  it("past sittings age out", () => {
    const learner = { examDate: "2026-11-17", activeExam: "kenntnispruefung" };
    expect(getLearnerMoments(learner, new Date("2026-11-17T08:00:00Z"), S).phase).toBe("exam_day");
    const results = getLearnerMoments(learner, new Date("2026-11-20T08:00:00Z"), S);
    expect(results.phase).toBe("results");
    expect(results.code).toBe("m6");
    // 60 days after the SIP sitting the named sitting is gone: ask again.
    const gone = getLearnerMoments(learner, new Date("2027-01-17T08:00:00Z"), S);
    expect(gone.certainty).toBe("ask");
    expect(gone.named).toBeNull();
    // HQ export: nothing that ended before today.
    const hq = journeyMomentsForHq(new Date("2026-12-01T10:00:00Z"), S);
    expect(hq.every((x) => x.until >= "2026-12-01")).toBe(true);
    expect(hq.some((x) => x.kind === "registration_closes" && x.on === "2026-10-19")).toBe(false);
  });

  it("a learner with no named exam gets the 'When is your exam?' prompt (certainty)", () => {
    for (const examDate of [null, "", "2026-12-24", "not a date"]) {
      const m = getLearnerMoments({ examDate, activeExam: "kenntnispruefung" }, OCT15, S);
      expect(m.certainty).toBe("ask");
      expect(m.phase).toBe("ask");
      expect(m.code).toBe("ask");
      expect(m.lead).toBeNull();
      expect(m.sittingWeek).toBe(false);
    }
  });

  it("the chosen sitting wins over the stored exam date", () => {
    const m = getLearnerMoments({ examDate: "2026-11-17", activeExam: "kenntnispruefung", chosenSitting: { date: "2027-02-03" } }, OCT15, S);
    expect(m.named?.source).toBe("chosen");
    expect(m.named?.segment).toBe("stichprobentest");
  });

  it("M4 at T minus 28, M5 on exam day, registration confirmation", () => {
    const learner = { examDate: "2026-11-17", activeExam: "kenntnispruefung", registeredKeys: ["sip5a:2026-11-17"] };
    const oct19 = getLearnerMoments(learner, new Date("2026-10-19T08:00:00Z"), S);
    expect(oct19.registered).toBe(true);
    expect(oct19.inCram).toBe(false);
    const oct20 = getLearnerMoments(learner, new Date("2026-10-20T08:00:00Z"), S);
    expect(oct20.phase).toBe("cram");
    expect(oct20.code).toBe("m4");
    expect(getLearnerMoments(learner, new Date("2026-11-16T23:30:00Z"), S).phase).toBe("exam_day"); // 00:30 Vienna on 17 Nov
    expect(getLearnerMoments(learner, new Date("2026-11-16T22:30:00Z"), S).phase).toBe("cram"); // 23:30 Vienna on 16 Nov
  });
});

describe("isSittingWeek", () => {
  it("covers Monday to Sunday of the sitting week, exam weeks included", () => {
    const sip = { date: "2026-11-17", date_end: "2026-11-17" }; // Tuesday
    expect(isSittingWeek(sip, new Date("2026-11-16T08:00:00Z"))).toBe(true);
    expect(isSittingWeek(sip, new Date("2026-11-22T20:00:00Z"))).toBe(true);
    expect(isSittingWeek(sip, new Date("2026-11-15T20:00:00Z"))).toBe(false);
    expect(isSittingWeek(sip, new Date("2026-11-22T23:30:00Z"))).toBe(false); // Monday 23 Nov, 00:30 Vienna
    expect(isSittingWeek(null, OCT15)).toBe(false);
    const m = getLearnerMoments({ examDate: "2026-11-23", activeExam: "pharma" }, new Date("2026-11-25T10:00:00Z"), S);
    expect(m.sittingWeek).toBe(true);
  });
});

describe("a30 opt-in sender export", () => {
  it("plans at most two mails per deadline, the first not before 2 Dec, offsets the ledger accepts", () => {
    const rezJan = S.find((r) => r.exam_key === "rezeptierkunde" && r.date === "2027-01-18")!;
    // Close 15 Dec: T-14 (1 Dec) is before the floor, so T-7 then T-3.
    expect(optInSendDays(rezJan)).toEqual([
      { day: "2026-12-08", offset: 7, send: "first" },
      { day: "2026-12-12", offset: 3, send: "second" },
    ]);
    // An October window closes before the floor: nothing.
    const sipNov = S.find((r) => r.exam_key === "sip5a" && r.date === "2026-11-17")!;
    expect(optInSendDays(sipNov)).toEqual([]);
    // Window 4 to 18 Jan: T-14 is the opening day.
    const sipFeb = S.find((r) => r.exam_key === "sip5a" && r.date === "2027-02-15")!;
    expect(optInSendDays(sipFeb)).toEqual([
      { day: "2027-01-04", offset: 14, send: "first" },
      { day: "2027-01-15", offset: 3, send: "second" },
    ]);
    // A short window: T-3 then T-1.
    expect(optInSendDays({ ...sipFeb, registration_opens: "2027-01-14" })).toEqual([
      { day: "2027-01-15", offset: 3, send: "first" },
      { day: "2027-01-17", offset: 1, send: "second" },
    ]);
  });

  it("returns the due mails of the day and nothing on other days, never the Stichprobentest", () => {
    const dec8 = optInDeadlineSchedule("pharma", new Date("2026-12-08T08:00:00Z"), S);
    // Rezeptierkunde and Gerichtsmedizin share one close: one send names both.
    expect(dec8.map((d) => [d.rows.map((r) => r.exam_key), d.sittingKey, d.send, d.offset])).toEqual([
      [["rezeptierkunde", "gerichtsmedizin"], "gerichtsmedizin+rezeptierkunde:2027-01-18:registration:wien", "first", 7],
    ]);
    expect(optInDeadlineSchedule("pharma", new Date("2026-12-02T08:00:00Z"), S)).toEqual([]);
    expect(optInDeadlineSchedule("pharma", new Date("2026-12-12T08:00:00Z"), S).map((d) => d.send)).toEqual(["second"]);
    // Oct sends are refused (floor 2 Dec), and the Stichprobentest bank never mails.
    expect(optInDeadlineSchedule("all", new Date("2026-10-15T08:00:00Z"), S)).toEqual([]);
    for (const day of ["2026-12-02", "2026-12-12", "2027-01-05"]) {
      expect(optInDeadlineSchedule("kmp_innsbruck", new Date(`${day}T08:00:00Z`), S)).toEqual([]);
    }
    // Over a whole season every deadline gets at most two sends.
    const counts = new Map<string, number>();
    for (let t = Date.parse("2026-10-01T08:00:00Z"); t < Date.parse("2027-05-01T08:00:00Z"); t += 86_400_000) {
      for (const d of optInDeadlineSchedule("all", new Date(t), S)) counts.set(d.sittingKey, (counts.get(d.sittingKey) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    // Every send carries an offset the exam_reminder_sends CHECK accepts.
    for (let t = Date.parse("2026-10-01T08:00:00Z"); t < Date.parse("2027-05-01T08:00:00Z"); t += 86_400_000) {
      for (const d of optInDeadlineSchedule("all", new Date(t), S)) expect([14, 7, 3, 1]).toContain(d.offset);
    }
    expect([...counts.keys()].every((k) => !k.startsWith("stichprobentest"))).toBe(true);
  });
});

describe("HQ export", () => {
  it("lists the next moments with the check values of hq-v2-spec 3.3", () => {
    const hq = journeyMomentsForHq(OCT15, S);
    const closesOn = (on: string) => hq.filter((x) => x.kind === "registration_closes" && x.on === on);
    expect(closesOn("2026-10-19").map((x) => x.exam_key).sort()).toEqual(["sip4a", "sip5a"]);
    expect(closesOn("2026-10-20").map((x) => [x.exam_key, x.at_time])).toEqual([["gerichtsmedizin", "12:00"], ["rezeptierkunde", "12:00"]]);
    expect(closesOn("2026-12-14").map((x) => x.publisher)).toEqual(["MedUni Wien"]);
    expect(closesOn("2027-01-07").map((x) => x.publisher)).toEqual(["Medizinische Universität Innsbruck"]);
    expect(hq.every((x) => x.tz === "Europe/Vienna")).toBe(true);
    expect(hq.filter((x) => x.kind === "results_window").every((x) => x.sourced === false)).toBe(true);
    expect(new Set(hq.map((x) => x.id)).size).toBe(hq.length);
  });

  it("learner state carries no date and no id", () => {
    const s = hqLearnerState({ examDate: "2027-02-03", activeExam: "kenntnispruefung" }, OCT15, S);
    expect(s).toEqual({ segment: "stichprobentest", by: "exam_date", phase: "registration", registered: false });
  });
});

describe("flag", () => {
  it("MOMENTS_ENABLED is on only for the literal true", () => {
    expect(momentsEnabled({})).toBe(false);
    expect(momentsEnabled({ MOMENTS_ENABLED: "1" })).toBe(false);
    expect(momentsEnabled({ MOMENTS_ENABLED: "TRUE" })).toBe(false);
    expect(momentsEnabled({ MOMENTS_ENABLED: "true" })).toBe(true);
  });
});
