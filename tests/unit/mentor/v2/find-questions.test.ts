/**
 * a-mentor-better-1106: find_questions, the grounded bank route. Keywords are sanitized before any
 * PostgREST filter, non-paid callers get only free-readable rows (NOTES.md 3b), and every row is a
 * registered question.<id> fact.
 */
import { describe, expect, it, vi } from "vitest";
import {
  FIND_MAX_ROWS,
  rankBankRows,
  runFindQuestions,
  sanitizeKeywords,
  supabaseBankSearch,
  type BankRow,
  type BankSearch,
} from "@/lib/mentor/v2/find-questions";
import type { MentorFact, TurnContext } from "@/lib/mentor/seam";

const NOW = new Date("2026-11-06T10:00:00Z");

const ROWS: BankRow[] = [
  {
    id: 101, exam_type: "kenntnispruefung", topic: "Psychiatrie",
    question: "Welches der folgenden Medikamente gehört zu den selektiven Serotonin-Wiederaufnahmehemmern (SSRI)?",
    answer: "Sertralin", explanation: "Sertralin ist ein SSRI. Haloperidol ist ein Neuroleptikum.",
    choices: [{ text: "Sertralin", correct: true }, { text: "Haloperidol", correct: false }, { text: "Lithium", correct: false }],
  },
  {
    id: 102, exam_type: "kenntnispruefung", topic: "Psychiatrie",
    question: "Welche Nebenwirkung ist typisch für SSRI zu Therapiebeginn?",
    answer: "Unruhe", explanation: "SSRI können zu Beginn Unruhe und Übelkeit auslösen.",
    choices: [{ text: "Unruhe", correct: true }, { text: "Bradykardie", correct: false }],
  },
  {
    id: 103, exam_type: "kenntnispruefung", topic: "Chirurgische Fächer",
    question: "Ein 61-jähriger Mann klagt beim Tennisspiel über plötzliche Schulterschmerzen. Die aktive Abduktion ist aufgehoben. Wahrscheinlichste Diagnose?",
    answer: "Rotatorenmanschettenruptur", explanation: "Ein Sturz oder eine Überkopfbewegung beim älteren Patienten spricht für eine Rotatorenmanschettenruptur.",
    choices: [{ text: "Rotatorenmanschettenruptur", correct: true }, { text: "Frozen shoulder", correct: false }],
  },
  {
    id: 201, exam_type: "pharma", topic: "Psychopharmaka",
    question: "Rezept: SSRI bei Depression", answer: "Sertralin", explanation: "SSRI Beispiel.",
    choices: [{ text: "Sertralin", correct: true }],
  },
];

function ctx(over: Partial<TurnContext> = {}): TurnContext {
  return { userId: "u1", requestId: "r1", lang: "de", mode: "facts", now: NOW, paidAccess: true, ...over };
}

function memorySearch(rows = ROWS): BankSearch & { calls: Array<{ keywords: string[]; exam: string | null }> } {
  const calls: Array<{ keywords: string[]; exam: string | null }> = [];
  const fn = (async ({ keywords, exam }) => {
    calls.push({ keywords, exam });
    return rows.filter((r) => (!exam || r.exam_type === exam) && keywords.some((k) => `${r.question} ${r.answer} ${r.explanation}`.toLowerCase().includes(k)));
  }) as BankSearch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

function env(search: BankSearch, freeFilter?: (ids: number[]) => Set<number>) {
  const remembered: MentorFact[] = [];
  const filter = vi.fn(async (_db: unknown, _u: string, ids: number[]) => (freeFilter ? freeFilter(ids) : new Set(ids)));
  return { remembered, filter, env: { db: () => ({ from: () => { throw new Error("no db in this test"); } }) as never, remember: (f: MentorFact) => remembered.push(f), search, freeFilter: filter } };
}

describe("sanitizeKeywords", () => {
  it("keeps letters, digits and hyphens only, so nothing can break out of a PostgREST filter", () => {
    const k = sanitizeKeywords("SSRI,question.ilike.%*),or=(id.gt.0) Serotonin-Wiederaufnahmehemmer");
    for (const w of k) expect(w).toMatch(/^[\p{L}\p{N}-]+$/u);
    expect(k).toContain("serotonin-wiederaufnahmehemmer");
    expect(k).toContain("ssri");
    expect(k.join(" ")).not.toMatch(/[,.%*()=]/);
  });
  it("drops stop words and short words, dedupes, at most six, longest first", () => {
    expect(sanitizeKeywords("Was ist die Diagnose bei Patient mit SSRI SSRI")).toEqual(["ssri"]);
    const many = sanitizeKeywords("Abduktion Rotatorenmanschette Tennis Schulter Schmerzen Ruptur Sehne Arm");
    expect(many).toHaveLength(6);
    expect(many[0]).toBe("rotatorenmanschette");
  });
  it("returns nothing for junk", () => {
    expect(sanitizeKeywords("!!! ,, 12 a")).toEqual([]);
    expect(sanitizeKeywords(undefined)).toEqual([]);
  });
});

describe("rankBankRows", () => {
  it("needs at least half the keywords; stem hits rank first", () => {
    const k = sanitizeKeywords("Tennis Schulter Abduktion aufgehoben");
    expect(rankBankRows(ROWS, k).map((r) => r.id)).toEqual([103]);
  });
  it("a single keyword ranks stem hits above explanation-only hits, ties by id", () => {
    expect(rankBankRows(ROWS, ["ssri"]).map((r) => r.id)).toEqual([101, 102, 201]);
  });
  it("caps at three and drops duplicates", () => {
    expect(rankBankRows([...ROWS, ...ROWS], ["ssri"], FIND_MAX_ROWS)).toHaveLength(3);
  });
});

describe("runFindQuestions", () => {
  it("searches the learner's own exam and registers each row as an internal question fact", async () => {
    const search = memorySearch();
    const e = env(search);
    const r = await runFindQuestions({ query_de: "SSRI Serotonin" }, ctx({ v2: { learner: { activeExam: "kenntnispruefung", sittingBand: "later", weakTopics: [], recentWrongTopics: [], answeredBand: "some" }, moment: "open", depth: "short" } }), e.env);
    expect(r.isError).toBeUndefined();
    expect(search.calls[0].exam).toBe("kenntnispruefung");
    const body = JSON.parse(r.content);
    expect(body.rows.map((x: { id: number }) => x.id)).toEqual([101, 102]);
    expect(body.rows[0].keyed_answer).toEqual(["Sertralin"]);
    expect(body.rows[0].fact_id).toBe("question.101");
    expect(r.factIds).toEqual(["question.101", "question.102"]);
    expect(e.remembered.map((f) => f.id)).toEqual(["question.101", "question.102"]);
    expect(e.remembered[0].text_de).toContain("Sertralin ist ein SSRI");
    expect(e.filter).not.toHaveBeenCalled(); // paid caller
    expect(r.content).not.toContain("exam_dates");
  });

  it("nothing in the learner's own bank: one more search across every bank", async () => {
    const search = memorySearch();
    const r = await runFindQuestions({ query_de: "Tennis Abduktion Schulter" }, ctx({ v2: { learner: { activeExam: "pharma", sittingBand: "later", weakTopics: [], recentWrongTopics: [], answeredBand: "some" }, moment: "open", depth: "short" } }), env(search).env);
    expect(search.calls.map((c) => c.exam)).toEqual(["pharma", null]);
    expect(JSON.parse(r.content).rows.map((x: { id: number }) => x.id)).toEqual([103]);
  });

  it("the model naming the learner's own bank widens like the default", async () => {
    const search = memorySearch();
    const learner = { activeExam: "pharma" as const, sittingBand: "later" as const, weakTopics: [], recentWrongTopics: [], answeredBand: "some" as const };
    await runFindQuestions({ query_de: "Tennis Abduktion Schulter", exam_source: "pharma" }, ctx({ v2: { learner, moment: "open", depth: "short" } }), env(search).env);
    expect(search.calls.map((c) => c.exam)).toEqual(["pharma", null]);
  });

  it("a model-named exam with no match is not widened", async () => {
    const search = memorySearch();
    const r = await runFindQuestions({ query_de: "Tennis Abduktion Schulter", exam_source: "pharma" }, ctx(), env(search).env);
    expect(search.calls.map((c) => c.exam)).toEqual(["pharma"]);
    expect(JSON.parse(r.content).rows).toEqual([]);
  });

  it("a model-named exam wins over the learner's exam", async () => {
    const search = memorySearch();
    const r = await runFindQuestions({ query_de: "SSRI", exam_source: "pharma" }, ctx(), env(search).env);
    expect(search.calls[0].exam).toBe("pharma");
    expect(JSON.parse(r.content).rows.map((x: { id: number }) => x.id)).toEqual([201]);
  });

  it("a non-paid caller only gets rows the free-access rule allows (NOTES.md 3b)", async () => {
    const e = env(memorySearch(), () => new Set([102]));
    const r = await runFindQuestions({ query_de: "SSRI" }, ctx({ paidAccess: false }), e.env);
    expect(e.filter).toHaveBeenCalledTimes(1);
    expect(JSON.parse(r.content).rows.map((x: { id: number }) => x.id)).toEqual([102]);
    expect(r.factIds).toEqual(["question.102"]);
    expect(e.remembered.map((f) => f.id)).toEqual(["question.102"]);
  });

  it("nothing readable: no rows and the refusal instruction, no fact registered", async () => {
    const e = env(memorySearch(), () => new Set());
    const r = await runFindQuestions({ query_de: "SSRI" }, ctx({ paidAccess: false }), e.env);
    const body = JSON.parse(r.content);
    expect(body.rows).toEqual([]);
    expect(body.instruction).toContain("kind=medical_concept");
    expect(r.factIds).toEqual([]);
    expect(e.remembered).toEqual([]);
  });

  it("bad input and a failed search are tool errors, never an exception", async () => {
    expect((await runFindQuestions({ query_de: "!!" }, ctx(), env(memorySearch()).env)).isError).toBe(true);
    expect((await runFindQuestions("SSRI", ctx(), env(memorySearch()).env)).isError).toBe(true);
    const failing: BankSearch = async () => { throw new Error("boom"); };
    const r = await runFindQuestions({ query_de: "SSRI" }, ctx(), env(failing).env);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("question search unavailable");
  });
});

describe("supabaseBankSearch", () => {
  it("one bounded read per keyword, active rows of the exam only, the keyword placed as sanitized text", async () => {
    const filters: string[] = [];
    const eqs: Array<[string, unknown]> = [];
    const db = {
      from: (table: string) => {
        expect(table).toBe("questions");
        const q = {
          select: (cols: string) => { expect(cols).not.toContain("exam_dates"); return q; },
          eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
          or: (f: string) => { filters.push(f); return q; },
          limit: async () => ({ data: [{ id: 5, exam_type: "pharma", topic: "T", question: "Q SSRI", answer: "A", explanation: "E", choices: [{ text: "A", correct: true }] }], error: null }),
        };
        return q;
      },
    };
    const rows = await supabaseBankSearch(() => db as never)({ keywords: sanitizeKeywords("SSRI) or (id.gt.0"), exam: "pharma", perKeyword: 40 });
    expect(rows[0].id).toBe(5);
    expect(eqs).toContainEqual(["is_active", true]);
    expect(eqs).toContainEqual(["exam_type", "pharma"]);
    for (const f of filters) expect(f).toMatch(/^question\.ilike\.%[\p{L}\p{N}-]+%,answer\.ilike\.%[\p{L}\p{N}-]+%,explanation\.ilike\.%[\p{L}\p{N}-]+%$/u);
  });
});
