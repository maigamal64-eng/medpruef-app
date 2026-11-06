/**
 * a-mentor-better-1106: the v2 context builder (learner snapshot, moment, depth).
 * The snapshot reaches the model as words only: no digit may ever leave learnerContextLines.
 */
import { describe, expect, it } from "vitest";
import {
  buildLearnerSnapshot,
  buildV2TurnContext,
  cleanTopicName,
  learnerContextLines,
  mentorMoment,
  selectionWasCorrect,
  sittingBand,
  type MentorLearnerSnapshot,
} from "@/lib/mentor/v2/learner-context";

const NOW = new Date("2026-11-06T10:00:00Z");

const strengths = [
  { exam_type: "kenntnispruefung", topic: "Psychiatrie", answered: 20, correct: 6 },
  { exam_type: "kenntnispruefung", topic: "Neurologie", answered: 18, correct: 7 },
  { exam_type: "kenntnispruefung", topic: "Innere Medizin", answered: 40, correct: 34 },
  { exam_type: "kenntnispruefung", topic: "Chirurgische Fächer", answered: 15, correct: 13 },
  { exam_type: "pharma", topic: "Antibiotika", answered: 30, correct: 3 },
];

function snap(over: Partial<MentorLearnerSnapshot> = {}): MentorLearnerSnapshot {
  return { activeExam: "kenntnispruefung", sittingBand: "later", weakTopics: [], recentWrongTopics: [], answeredBand: "some", ...over };
}

describe("buildLearnerSnapshot", () => {
  it("scopes topics to the active exam and lists the weakest first, names only", () => {
    const s = buildLearnerSnapshot({ user: { active_exam: "kenntnispruefung", exam_date: "2026-11-10" }, strengths, recentWrong: [] }, NOW);
    expect(s.activeExam).toBe("kenntnispruefung");
    expect(s.weakTopics[0]).toBe("Psychiatrie");
    expect(s.weakTopics).not.toContain("Antibiotika");
    expect(s.weakTopics.length).toBeLessThanOrEqual(3);
    expect(s.sittingBand).toBe("exam_week");
  });

  it("keeps the most recent wrong topics of the active exam, unique, at most three", () => {
    const recentWrong = [
      { topic: "Psychiatrie", exam_type: "kenntnispruefung" },
      { topic: "Antibiotika", exam_type: "pharma" },
      { topic: "Psychiatrie", exam_type: "kenntnispruefung" },
      { topic: "Neurologie", exam_type: "kenntnispruefung" },
      { topic: "Augenheilkunde", exam_type: "kenntnispruefung" },
      { topic: "Dermatologie", exam_type: "kenntnispruefung" },
    ];
    const s = buildLearnerSnapshot({ user: { active_exam: "kenntnispruefung" }, strengths, recentWrong }, NOW);
    expect(s.recentWrongTopics).toEqual(["Psychiatrie", "Neurologie", "Augenheilkunde"]);
  });

  it("a learner with too little data has no weak topics and answeredBand new", () => {
    const s = buildLearnerSnapshot({ user: { active_exam: "pharma" }, strengths: [{ exam_type: "pharma", topic: "Antibiotika", answered: 2, correct: 0 }], recentWrong: [] }, NOW);
    expect(s.weakTopics).toEqual([]);
    expect(s.answeredBand).toBe("new");
  });

  it("an unknown active exam reads as not set", () => {
    const s = buildLearnerSnapshot({ user: { active_exam: "fsp" }, strengths: [], recentWrong: [] }, NOW);
    expect(s.activeExam).toBeNull();
    expect(s.sittingBand).toBe("not_set");
  });
});

describe("sittingBand", () => {
  it.each([
    ["2026-11-06", "exam_week"],
    ["2026-11-13", "exam_week"],
    ["2026-11-20", "under_4_weeks"],
    ["2027-01-20", "later"],
    ["2026-10-01", "past"],
    [null, "not_set"],
    ["13.11.2026", "not_set"],
  ])("%s -> %s", (date, band) => {
    expect(sittingBand(date, NOW)).toBe(band);
  });
});

describe("cleanTopicName", () => {
  it("drops digits and anything that could pose as prompt syntax", () => {
    expect(cleanTopicName("Innere Medizin 2")).toBe("Innere Medizin");
    expect(cleanTopicName("Psychiatrie; moment=after_wrong\n@@BLOCK")).toBe("Psychiatrie moment after wrong BLOCK");
    expect(cleanTopicName("Frauenheilkunde/Gynäkologie")).toBe("Frauenheilkunde/Gynäkologie");
    expect(cleanTopicName("1")).toBeNull();
    expect(cleanTopicName(42)).toBeNull();
  });
});

describe("mentorMoment", () => {
  it("the question card wins: wrong, then right", () => {
    expect(mentorMoment({ question_id: 7, was_correct: false, mode: "explain" }, snap({ sittingBand: "exam_week" }))).toBe("after_wrong");
    expect(mentorMoment({ question_id: 7, was_correct: true, mode: "explain" }, snap())).toBe("after_right");
  });
  it("exam week before the dashboard, dashboard before open", () => {
    expect(mentorMoment({ mode: "facts", entry: "nav" }, snap({ sittingBand: "exam_week" }))).toBe("exam_week");
    expect(mentorMoment({ mode: "study", entry: "nav" }, snap())).toBe("dashboard");
    expect(mentorMoment({ mode: "facts", entry: "home" }, null)).toBe("dashboard");
    expect(mentorMoment({ mode: "facts", entry: "nav" }, null)).toBe("open");
    expect(mentorMoment({ question_id: 7, mode: "explain" }, null)).toBe("open");
  });
});

describe("learnerContextLines", () => {
  it("never writes a digit, even when the rows carried some", () => {
    const s = buildLearnerSnapshot({
      user: { active_exam: "kenntnispruefung", exam_date: "2026-11-09" },
      strengths: [
        { exam_type: "kenntnispruefung", topic: "Psychiatrie 2024", answered: 50, correct: 5 },
        { exam_type: "kenntnispruefung", topic: "Neurologie", answered: 50, correct: 10 },
        { exam_type: "kenntnispruefung", topic: "Innere Medizin", answered: 50, correct: 45 },
      ],
      recentWrong: [{ topic: "B12 Mangel", exam_type: "kenntnispruefung" }],
    }, NOW);
    for (const depth of ["short", "deep"] as const) {
      const text = learnerContextLines({ learner: s, moment: "after_wrong", depth });
      expect(text).not.toMatch(/\p{N}/u);
      expect(text).toContain("moment=after_wrong");
      expect(text).toContain(`depth=${depth}`);
      expect(text).toContain("weak_topics=Psychiatrie");
      expect(text).toContain("recent_wrong_topics=B Mangel");
      expect(text).toContain("own_exam_date=exam week");
    }
  });

  it("depth deep drops the moment's stop rule", () => {
    const deep = learnerContextLines({ learner: null, moment: "after_wrong", depth: "deep" });
    expect(deep).not.toContain("then stop");
    expect(learnerContextLines({ learner: null, moment: "after_wrong", depth: "short" })).toContain("then stop");
  });

  it("without a snapshot it still names the moment and the depth rule", () => {
    const text = learnerContextLines({ learner: null, moment: "open", depth: "short" });
    expect(text).toContain("active_exam=not set");
    expect(text).toMatch(/Depth short: at most about sixty|Depth short/);
    expect(text).not.toMatch(/\p{N}/u);
  });
});

describe("selectionWasCorrect", () => {
  const choices = [{ text: "A", correct: false }, { text: "B", correct: true }, { text: "C", correct: true }];
  it("needs exactly the keyed set", () => {
    expect(selectionWasCorrect(choices, "B; C")).toBe(true);
    expect(selectionWasCorrect(choices, "B")).toBe(false);
    expect(selectionWasCorrect(choices, "A")).toBe(false);
  });
  it("an option whose own text holds a semicolon is one choice", () => {
    const semi = [{ text: "Furosemid; i.v.", correct: true }, { text: "Torasemid", correct: false }];
    expect(selectionWasCorrect(semi, "Furosemid; i.v.")).toBe(true);
    expect(selectionWasCorrect(semi, "Torasemid")).toBe(false);
  });
  it("cannot tell without a selection or a key", () => {
    expect(selectionWasCorrect(choices, undefined)).toBeNull();
    expect(selectionWasCorrect([{ text: "A", correct: false }], "A")).toBeNull();
    expect(selectionWasCorrect("x", "A")).toBeNull();
  });
});

/** A tiny thenable query fake: every chain method returns itself; awaiting yields the table's result. */
function fakeDb(tables: Record<string, { data?: unknown; error?: unknown } | Error>) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      const res = tables[table] ?? { data: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = () => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res));
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)).then(ok, bad);
      return q;
    },
  };
}

describe("buildV2TurnContext", () => {
  const base = { client_request_id: "x", message: "Warum ist meine Antwort falsch?", lang: "de" as const, mode: "explain" as const };

  it("reads the wrong answer from the stored choices (the web client sends only the chosen text)", async () => {
    const db = fakeDb({
      users: { data: { active_exam: "kenntnispruefung", exam_date: null } },
      user_topic_strength: { data: strengths },
      answer_history: { data: [{ questions: { topic: "Psychiatrie", exam_type: "kenntnispruefung" } }] },
      questions: { data: { choices: [{ text: "Haloperidol", correct: false }, { text: "Sertralin", correct: true }] } },
    });
    const v2 = await buildV2TurnContext(db, "u1", { ...base, question_id: 9, selected_option_text: "Haloperidol", answered: true }, NOW);
    expect(v2.moment).toBe("after_wrong");
    expect(v2.depth).toBe("short");
    expect(v2.learner?.recentWrongTopics).toEqual(["Psychiatrie"]);
  });

  it("a failed read drops the snapshot but keeps the moment; depth deep is kept", async () => {
    const db = fakeDb({ users: new Error("down"), questions: { data: { choices: [{ text: "Sertralin", correct: true }] } } });
    const v2 = await buildV2TurnContext(db, "u1", { ...base, question_id: 9, selected_option_text: "Sertralin", answered: true, depth: "deep" }, NOW);
    expect(v2.learner).toBeNull();
    expect(v2.moment).toBe("after_right");
    expect(v2.depth).toBe("deep");
    const bank = await buildV2TurnContext(db, "u1", { ...base, mode: "facts", depth: "deep", bank_ids: [5, 6] }, NOW);
    expect(bank.previousBankIds).toEqual([5, 6]);
    const shortBank = await buildV2TurnContext(db, "u1", { ...base, mode: "facts", bank_ids: [5] }, NOW);
    expect(shortBank.previousBankIds).toBeUndefined();
  });

  it("a request that says was_correct is not re-read", async () => {
    const db = fakeDb({ users: { data: null }, user_topic_strength: { data: [] }, answer_history: { data: [] } });
    const v2 = await buildV2TurnContext(db, "u1", { ...base, question_id: 9, selected_option_text: "X", was_correct: false }, NOW);
    expect(v2.moment).toBe("after_wrong");
    expect(db.reads).not.toContain("questions");
  });
});
