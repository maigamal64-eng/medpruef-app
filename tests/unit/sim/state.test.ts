import { describe, it, expect } from "vitest";
import { activePart, createSession, keyReleased, parseSession, reduce, serializeSession, sessionResult, type SimEvent, type SimSessionState } from "@/lib/sim";
import { KP_PART_IDS, KP_SIM_PROFILE } from "@/lib/de-kp/sim/profile";
import { toSimCase } from "@/lib/de-kp/sim/case-adapter";
import { SID, T0, loadCase, newSession, restoreCtx, run } from "./fixtures";

const P = KP_SIM_PROFILE;
const ORDER = P.parts.map((p) => p.id);
const t = (n: number) => T0 + n * 1000;

function refuse(s: SimSessionState, e: SimEvent) {
  const r = reduce(P, s, e);
  expect(r.ok).toBe(false);
  expect(r.state).toBe(s); // a refusal never changes the state
  return r.ok ? null : r.error;
}

/** Runs every part of a full exam with a little text, submitting each in turn. */
function fullExamToReview(): SimSessionState {
  let s = run(newSession(), [{ type: "start", at: t(0) }]);
  s = run(s, [
    { type: "talk_turn", at: t(1), partId: "talk", text: "Was ist passiert, seit wann haben Sie Beschwerden?" },
    { type: "submit_part", at: t(2), partId: "talk" },
    { type: "submit_part", at: t(3), partId: "findings" },
    { type: "save_text", at: t(4), partId: "diff", slot: "leading", text: "Anaphylaxie" },
    { type: "submit_part", at: t(5), partId: "diff" },
    { type: "save_text", at: t(6), partId: "report", slot: "anamnese", text: "Patient mit Betablocker und Asthma nach Wespenstich." },
    { type: "submit_part", at: t(7), partId: "report" },
    { type: "examiner_ask", at: t(8), partId: "examiner", itemId: "f1", bounded: false },
    { type: "save_text", at: t(9), partId: "examiner", slot: "f1", text: "Adrenalin intramuskulär 0,5 mg" },
    { type: "submit_part", at: t(10), partId: "examiner" },
  ]);
  return s;
}

describe("S1 acceptance: full exam runs parts in profile order, no key before the last part", () => {
  it("opens each part in profile order and releases no key until every part is submitted", () => {
    let s = run(newSession(), [{ type: "start", at: t(0) }]);
    const seen: string[] = [];
    for (const id of ORDER) {
      expect(activePart(s)?.partId).toBe(id);
      seen.push(id);
      for (const k of ORDER) expect(keyReleased(s, k)).toBe(false);
      s = run(s, [{ type: "submit_part", at: t(seen.length), partId: id }]);
    }
    expect(seen).toEqual(ORDER);
    expect(s.status).toBe("review");
    for (const k of ORDER) expect(keyReleased(s, k)).toBe(true);
  });

  it("refuses marks and AI verdicts on a submitted part while later parts are still open", () => {
    const s = run(newSession(), [{ type: "start", at: t(0) }, { type: "submit_part", at: t(1), partId: "talk" }]);
    expect(refuse(s, { type: "self_mark", at: t(2), partId: "talk", itemId: "h01", mark: "covered" })).toBe("key_not_released");
    expect(refuse(s, { type: "set_verdicts", at: t(2), partId: "talk", verdicts: [] })).toBe("key_not_released");
  });

  it("refuses a part out of order", () => {
    const s = run(newSession(), [{ type: "start", at: t(0) }]);
    expect(refuse(s, { type: "submit_part", at: t(1), partId: "report" })).toBe("part_not_active");
    expect(refuse(s, { type: "save_text", at: t(1), partId: "report", slot: "anamnese", text: "x" })).toBe("part_not_active");
  });

  it("needs every part for a full exam", () => {
    const r = createSession({ sessionId: SID, profile: P, caseInput: toSimCase(loadCase()).sim, mode: "full_exam", partIds: ["talk"], aiMarking: true, at: T0 });
    expect(r).toEqual({ ok: false, error: "full_exam_needs_all_parts" });
  });
});

describe("S1 acceptance: practice mode releases the key part by part", () => {
  it("releases a part's key on submit and opens the next part only after the marks are confirmed", () => {
    let s = run(newSession({ mode: "practice_part" }), [{ type: "start", at: t(0) }, { type: "talk_turn", at: t(1), partId: "talk", text: "Haben Sie Allergien?" }, { type: "submit_part", at: t(2), partId: "talk" }]);
    expect(keyReleased(s, "talk")).toBe(true);
    expect(keyReleased(s, "diff")).toBe(false);
    expect(activePart(s)).toBeNull();
    expect(s.status).toBe("running");
    s = run(s, [{ type: "self_mark", at: t(3), partId: "talk", itemId: "h10", mark: "covered" }, { type: "confirm_part", at: t(4), partId: "talk" }]);
    expect(activePart(s)?.partId).toBe("findings");
  });

  it("runs a chosen subset of parts in profile order", () => {
    let s = run(newSession({ mode: "practice_part", partIds: ["report", "diff"] }), [{ type: "start", at: t(0) }]);
    expect(s.parts.map((p) => p.partId)).toEqual(["diff", "report"]);
    expect(activePart(s)?.partId).toBe("diff");
    s = run(s, [{ type: "submit_part", at: t(1), partId: "diff" }, { type: "confirm_part", at: t(2), partId: "diff" }, { type: "submit_part", at: t(3), partId: "report" }]);
    expect(s.status).toBe("review");
    s = run(s, [{ type: "finish", at: t(4) }]);
    expect(s.status).toBe("finished");
  });

  it("refuses a selection with no scored part, an unknown part or a repeat", () => {
    const c = toSimCase(loadCase()).sim;
    const mk = (partIds: string[]) => createSession({ sessionId: SID, profile: P, caseInput: c, mode: "practice_part", partIds, aiMarking: true, at: T0 });
    expect(mk(["findings"])).toEqual({ ok: false, error: "no_scored_part" });
    expect(mk(["nope"])).toEqual({ ok: false, error: "bad_parts" });
    expect(mk(["talk", "talk"])).toEqual({ ok: false, error: "bad_parts" });
    expect(mk([])).toEqual({ ok: false, error: "bad_parts" });
  });
});

describe("transitions", () => {
  it("start only from ready; finish only from review; closed sessions refuse everything", () => {
    const ready = newSession();
    expect(refuse(ready, { type: "finish", at: t(1) })).toBe("not_in_review");
    expect(refuse(ready, { type: "submit_part", at: t(1), partId: "talk" })).toBe("not_running");
    const running = run(ready, [{ type: "start", at: t(0) }]);
    expect(refuse(running, { type: "start", at: t(1) })).toBe("not_ready");
    const finished = run(fullExamToReview(), [{ type: "finish", at: t(20) }]);
    expect(finished.finishedAt).toBe(t(20));
    for (const e of [{ type: "resume", at: t(21) }, { type: "abandon", at: t(21) }, { type: "self_mark", at: t(21), partId: "talk", itemId: "h01", mark: "covered" }] as SimEvent[]) {
      expect(refuse(finished, e)).toBe("closed");
    }
  });

  it("abandon works from ready, running and review and is final", () => {
    for (const s of [newSession(), run(newSession(), [{ type: "start", at: t(0) }]), fullExamToReview()]) {
      const a = run(s, [{ type: "abandon", at: t(30) }]);
      expect(a.status).toBe("abandoned");
      expect(a.abandonedAt).toBe(t(30));
      expect(refuse(a, { type: "resume", at: t(31) })).toBe("closed");
    }
  });

  it("takes time only from events and never moves updatedAt backwards", () => {
    let s = run(newSession(), [{ type: "start", at: t(10) }]);
    expect(s.startedAt).toBe(t(10));
    s = run(s, [{ type: "resume", at: t(5) }]); // another device with a slower clock
    expect(s.updatedAt).toBe(t(10));
    expect(refuse(s, { type: "resume", at: Number.NaN })).toBe("bad_time");
    expect(refuse(s, { type: "resume", at: -1 })).toBe("bad_time");
  });

  it("freezes a part's text once it is submitted", () => {
    const s = run(newSession({ mode: "practice_part" }), [{ type: "start", at: t(0) }, { type: "submit_part", at: t(1), partId: "talk" }]);
    expect(refuse(s, { type: "talk_turn", at: t(2), partId: "talk", text: "Noch eine Frage" })).toBe("part_not_active");
  });

  it("caps saved text at the part's limit and allows only the part's slots", () => {
    const s = run(newSession({ mode: "practice_part", partIds: ["report"] }), [{ type: "start", at: t(0) }]);
    expect(refuse(s, { type: "save_text", at: t(1), partId: "report", slot: "zusammenfassung", text: "x" })).toBe("bad_slot");
    expect(refuse(s, { type: "save_text", at: t(1), partId: "report", slot: "anamnese", text: "x".repeat(4001) })).toBe("too_long");
    const ok = run(s, [{ type: "save_text", at: t(1), partId: "report", slot: "anamnese", text: "x".repeat(4000) }]);
    expect(ok.parts[0].answers.anamnese).toHaveLength(4000);
  });
});

describe("patient talk turn cap (S4 TALK_LIMIT, pure part)", () => {
  it("accepts 40 learner turns and refuses turn 41", () => {
    let s = run(newSession(), [{ type: "start", at: t(0) }]);
    for (let i = 1; i <= 40; i++) s = run(s, [{ type: "talk_turn", at: t(i), partId: "talk", text: `Frage ${i}` }]);
    expect(s.parts[0].turns).toBe(40);
    expect(refuse(s, { type: "talk_turn", at: t(41), partId: "talk", text: "Frage 41" })).toBe("talk_limit");
    expect(s.parts[0].answers.transcript.split("\n")).toHaveLength(40);
    // the learner moves on: submit still works
    expect(run(s, [{ type: "submit_part", at: t(42), partId: "talk" }]).parts[0].phase).toBe("submitted");
  });

  it("does not count an empty turn and refuses a turn on a part that is not a talk", () => {
    const s = run(newSession(), [{ type: "start", at: t(0) }]);
    expect(refuse(s, { type: "talk_turn", at: t(1), partId: "talk", text: "   " })).toBe("empty_text");
    const r = run(s, [{ type: "submit_part", at: t(1), partId: "talk" }]);
    expect(refuse(r, { type: "talk_turn", at: t(2), partId: "findings", text: "Hallo" })).toBe("wrong_kind");
  });
});

describe("examiner round (S6, pure part): at most one bounded follow-up per item", () => {
  const atExaminer = () => run(newSession({ mode: "practice_part", partIds: ["examiner"] }), [{ type: "start", at: t(0) }]);

  it("asks each item once, then at most one bounded follow-up on an item already asked", () => {
    let s = atExaminer();
    expect(refuse(s, { type: "examiner_ask", at: t(1), partId: "examiner", itemId: "f2", bounded: true })).toBe("not_asked");
    s = run(s, [{ type: "examiner_ask", at: t(1), partId: "examiner", itemId: "f2", bounded: false }]);
    expect(refuse(s, { type: "examiner_ask", at: t(2), partId: "examiner", itemId: "f2", bounded: false })).toBe("already_asked");
    s = run(s, [{ type: "examiner_ask", at: t(2), partId: "examiner", itemId: "f2", bounded: true }]);
    expect(refuse(s, { type: "examiner_ask", at: t(3), partId: "examiner", itemId: "f2", bounded: true })).toBe("bounded_limit");
    expect(refuse(s, { type: "examiner_ask", at: t(3), partId: "examiner", itemId: "f99", bounded: false })).toBe("unknown_item");
  });

  it("asks no more than the profile's item cap", () => {
    const strict = { ...P, parts: P.parts.map((p) => (p.kind === "examiner_round" ? { ...p, maxItems: 2 } : p)) };
    let s = run(newSession({ mode: "practice_part", partIds: ["examiner"], profile: strict }), [{ type: "start", at: t(0) }], strict);
    s = run(s, [{ type: "examiner_ask", at: t(1), partId: "examiner", itemId: "f1", bounded: false }, { type: "examiner_ask", at: t(2), partId: "examiner", itemId: "f2", bounded: false }], strict);
    const r = reduce(strict, s, { type: "examiner_ask", at: t(3), partId: "examiner", itemId: "f3", bounded: false });
    expect(r.ok ? null : r.error).toBe("item_limit");
  });
});

describe("AI marking and fallback (PLAN.md 4: AI off, capped or erroring)", () => {
  const verdict = { itemId: "r02", status: "covered" as const, quote: "Betablocker und Asthma", model: "claude-sonnet-5-5", promptVersion: "g1" };

  it("stores verdicts after the quote rule once the key is released", () => {
    const s = run(fullExamToReview(), [{ type: "set_verdicts", at: t(11), partId: "report", verdicts: [verdict, { ...verdict, itemId: "r04", quote: "Anaphylaxie Grad III" }] }]);
    const rep = s.parts.find((p) => p.partId === "report")!;
    expect(rep.verdicts.r02.status).toBe("covered");
    expect(rep.verdicts.r04.status).toBe("missing"); // critical, quote not in the learner's text
  });

  it("refuses verdicts for items not in the part, as a whole", () => {
    const s = fullExamToReview();
    expect(refuse(s, { type: "set_verdicts", at: t(11), partId: "report", verdicts: [verdict, { ...verdict, itemId: "h01" }] })).toBe("unknown_item");
  });

  it("after ai_fallback the session continues self-marked and refuses new verdicts", () => {
    let s = run(newSession(), [{ type: "start", at: t(0) }, { type: "ai_fallback", at: t(1), reason: "spend_cap" }]);
    expect(s.aiMarking).toBe(false);
    s = run(s, [{ type: "ai_fallback", at: t(2), reason: "error" }]);
    expect(s.aiFallbackReason).toBe("spend_cap"); // the first reason is kept
    const review = run(s, ORDER.map((id, i) => ({ type: "submit_part" as const, at: t(3 + i), partId: id })));
    expect(refuse(review, { type: "set_verdicts", at: t(20), partId: "report", verdicts: [verdict] })).toBe("ai_off");
    expect(run(review, [{ type: "self_mark", at: t(20), partId: "report", itemId: "r02", mark: "missing" }]).parts[3].selfMarks.r02).toBe("missing");
  });

  it("a session created without AI marking (free case used, fair use reached) never accepts verdicts", () => {
    const s = run(newSession({ aiMarking: false }), [{ type: "start", at: t(0) }, ...ORDER.map((id, i) => ({ type: "submit_part" as const, at: t(1 + i), partId: id }))]);
    expect(refuse(s, { type: "set_verdicts", at: t(20), partId: "talk", verdicts: [] })).toBe("ai_off");
  });

  it("findings carry no marks", () => {
    const s = fullExamToReview();
    expect(refuse(s, { type: "self_mark", at: t(11), partId: "findings", itemId: "x", mark: "covered" })).toBe("not_marked_part");
    expect(run(s, [{ type: "confirm_part", at: t(11), partId: "findings" }]).parts[1].phase).toBe("marked");
  });

  it("a self-mark can be cleared and must name an item of the part", () => {
    let s = fullExamToReview();
    expect(refuse(s, { type: "self_mark", at: t(11), partId: "report", itemId: "h01", mark: "covered" })).toBe("unknown_item");
    s = run(s, [{ type: "self_mark", at: t(11), partId: "report", itemId: "r01", mark: "partly" }, { type: "self_mark", at: t(12), partId: "report", itemId: "r01", mark: null }]);
    expect(s.parts[3].selfMarks).toEqual({});
  });
});

describe("serialise and resume (S2 stores the string)", () => {
  it("round-trips a session at every stage and resumes it", () => {
    const stages = [newSession(), run(newSession(), [{ type: "start", at: t(0) }, { type: "talk_turn", at: t(1), partId: "talk", text: "Seit wann?" }]), fullExamToReview()];
    for (const s of stages) expect(parseSession(serializeSession(s), P, restoreCtx())).toEqual(s);
    const resumed = run(parseSession(serializeSession(stages[1]), P, restoreCtx())!, [{ type: "resume", at: t(5) }, { type: "talk_turn", at: t(6), partId: "talk", text: "Allergien?" }]);
    expect(resumed.resumeCount).toBe(1);
    expect(resumed.parts[0].turns).toBe(2);
  });

  it("round-trips a practice session waiting for the learner's marks", () => {
    const s = run(newSession({ mode: "practice_part" }), [{ type: "start", at: t(0) }, { type: "talk_turn", at: t(1), partId: "talk", text: "Was ist passiert?" }, { type: "submit_part", at: t(1), partId: "talk" }, { type: "self_mark", at: t(2), partId: "talk", itemId: "h01", mark: "covered" }]);
    expect(parseSession(serializeSession(s), P, restoreCtx())).toEqual(s);
  });

  it("discards malformed or inconsistent stored sessions", () => {
    const s = fullExamToReview();
    const j = JSON.parse(serializeSession(s)) as Record<string, unknown> & { parts: Record<string, unknown>[] };
    const bad: unknown[] = [
      "not json",
      null,
      { ...j, v: 2 },
      { ...j, profileKey: "other" },
      { ...j, sessionId: "123" },
      { ...j, status: "running" }, // every part submitted but still running
      { ...j, parts: [...j.parts].reverse() },
      { ...j, parts: j.parts.slice(1) }, // full exam missing a part
      { ...j, parts: j.parts.map((p, i) => (i === 0 ? { ...p, selfMarks: { h01: "yes" } } : p)) },
      { ...j, parts: j.parts.map((p, i) => (i === 0 ? { ...p, turns: 41 } : p)) },
      { ...j, parts: j.parts.map((p, i) => (i === 3 ? { ...p, answers: { fremd: "x" } } : p)) },
      { ...j, parts: j.parts.map((p, i) => (i === 4 ? { ...p, asked: { f1: { bounded: 2 } } } : p)) },
      { ...j, parts: j.parts.map((p, i) => (i === 1 ? { ...p, phase: "pending" } : p)) }, // a gap in the order
    ];
    for (const b of bad) expect(parseSession(typeof b === "string" ? b : JSON.stringify(b), P, restoreCtx())).toBeNull();
  });

  it("the result reads the session alone (no case file needed)", () => {
    const s = run(fullExamToReview(), [{ type: "self_mark", at: t(11), partId: "report", itemId: "r02", mark: "covered" }, { type: "finish", at: t(12) }]);
    const r = sessionResult(P, parseSession(serializeSession(s), P, restoreCtx())!);
    expect(r.status).toBe("finished");
    expect(r.parts.map((p) => p.partId)).toEqual(["talk", "diff", "report", "examiner"]);
    expect(r.criticalMissed).toEqual(["report:r04", "report:r09", "report:r10", "report:r13"]);
    expect(r.criticalMissedCount).toBe(4);
  });
});

describe("review fixes: the learner's mark and the score agree", () => {
  it("refuses covered or partly on an item whose slot is empty (typed reason); missing stays allowed and final", () => {
    const s = fullExamToReview(); // Bericht has text in "anamnese" only
    const rep = s.parts[3];
    const empty = rep.items.find((it) => it.slot !== "anamnese")!;
    const filled = rep.items.find((it) => it.slot === "anamnese")!;
    expect(refuse(s, { type: "self_mark", at: t(11), partId: "report", itemId: empty.id, mark: "covered" })).toBe("slot_empty");
    expect(refuse(s, { type: "self_mark", at: t(11), partId: "report", itemId: empty.id, mark: "partly" })).toBe("slot_empty");
    const marked = run(s, [{ type: "self_mark", at: t(11), partId: "report", itemId: empty.id, mark: "missing" }, { type: "self_mark", at: t(12), partId: "report", itemId: filled.id, mark: "covered" }]);
    const r = sessionResult(P, run(marked, [{ type: "finish", at: t(13) }])).parts.find((p) => p.partId === "report")!;
    for (const it of r.items) if (it.final === "covered") expect(it.credit).toBe(1);
  });

  it("other differentials: one typed line earns at most one tick, whatever the learner ticks", () => {
    let s = run(newSession({ mode: "practice_part", partIds: ["diff"] }), [{ type: "start", at: t(0) }]);
    s = run(s, [{ type: "save_text", at: t(1), partId: "diff", slot: "leading", text: "Anaphylaxie" }, { type: "save_text", at: t(2), partId: "diff", slot: "others", text: "Urtikaria" }, { type: "submit_part", at: t(3), partId: "diff" }]);
    s = run(s, [{ type: "self_mark", at: t(4), partId: "diff", itemId: "o1", mark: "covered" }]);
    expect(refuse(s, { type: "self_mark", at: t(5), partId: "diff", itemId: "o2", mark: "covered" })).toBe("slot_full");
  });

  it("short answers accept text only in a slot an item is judged on", () => {
    const s = run(newSession({ mode: "practice_part", partIds: ["diff"] }), [{ type: "start", at: t(0) }]);
    expect(refuse(s, { type: "save_text", at: t(1), partId: "diff", slot: "fremd", text: "x" })).toBe("bad_slot");
  });

  it("examiner round: text only for a follow-up that was asked", () => {
    let s = run(newSession({ mode: "practice_part", partIds: ["examiner"] }), [{ type: "start", at: t(0) }]);
    expect(refuse(s, { type: "save_text", at: t(1), partId: "examiner", slot: "f2", text: "Adrenalin i.m." })).toBe("bad_slot");
    s = run(s, [{ type: "examiner_ask", at: t(1), partId: "examiner", itemId: "f2", bounded: false }, { type: "save_text", at: t(2), partId: "examiner", slot: "f2", text: "Adrenalin i.m." }]);
    expect(s.parts[0].answers.f2).toBe("Adrenalin i.m.");
    expect(refuse(s, { type: "save_text", at: t(3), partId: "examiner", slot: "f3", text: "x" })).toBe("bad_slot");
  });

  it("createSession refuses a case that does not fit the profile", () => {
    const c = toSimCase(loadCase()).sim;
    const mk = (caseInput: typeof c) => createSession({ sessionId: SID, profile: P, caseInput, mode: "full_exam", aiMarking: true, at: T0 });
    const zero = { ...c, items: { ...c.items, report: c.items.report.map((it, i) => (i === 0 ? { ...it, weight: 0 } : it)) } };
    const dup = { ...c, items: { ...c.items, talk: [c.items.talk[0], c.items.talk[0]] } };
    const noItems = { ...c, items: { ...c.items, examiner: [] } };
    const badSlot = { ...c, items: { ...c.items, report: c.items.report.map((it, i) => (i === 0 ? { ...it, slot: "fazit" } : it)) } };
    for (const bad of [zero, dup, noItems, badSlot]) expect(mk(bad)).toEqual({ ok: false, error: "case_invalid" });
  });

  it("the result is comparable only for a finished full exam", () => {
    const fin = sessionResult(P, run(fullExamToReview(), [{ type: "finish", at: t(20) }]));
    expect(fin.comparable).toBe(true);
    expect(sessionResult(P, fullExamToReview()).comparable).toBe(false);
    expect(sessionResult(P, run(fullExamToReview(), [{ type: "abandon", at: t(20) }])).comparable).toBe(false);
    const practice = run(newSession({ mode: "practice_part", partIds: ["diff"] }), [{ type: "start", at: t(0) }, { type: "submit_part", at: t(1), partId: "diff" }, { type: "finish", at: t(2) }]);
    expect(sessionResult(P, practice).comparable).toBe(false);
  });
});

describe("review fix 5: parseSession re-checks what the reducer enforces", () => {
  type J = Record<string, unknown> & { parts: (Record<string, unknown> & { items: Record<string, unknown>[] })[] };
  const json = (s: SimSessionState) => JSON.parse(serializeSession(s)) as J;
  const parse = (j: unknown, ctx = restoreCtx()) => parseSession(JSON.stringify(j), P, ctx);
  const withPart = (j: J, i: number, patch: Record<string, unknown>): J => ({ ...j, parts: j.parts.map((p, n) => (n === i ? { ...p, ...patch } : p)) });

  it("refuses self-marks or verdicts on a pending or active part, and in a full exam before the key is released", () => {
    const running = run(newSession(), [{ type: "start", at: t(0) }, { type: "talk_turn", at: t(1), partId: "talk", text: "Was ist passiert?" }]);
    expect(parse(withPart(json(running), 0, { selfMarks: { h01: "covered" } }))).toBeNull(); // active
    expect(parse(withPart(json(running), 3, { selfMarks: { r01: "missing" } }))).toBeNull(); // pending
    const submittedTalk = run(running, [{ type: "submit_part", at: t(2), partId: "talk" }]);
    const verdict = { itemId: "h01", status: "missing", quote: null, model: "m", promptVersion: "p" };
    expect(parse(withPart(json(submittedTalk), 0, { selfMarks: { h01: "covered" } }))).toBeNull(); // full exam, running
    expect(parse(withPart(json(submittedTalk), 0, { verdicts: { h01: verdict } }))).toBeNull();
  });

  it("refuses a finished session without finishedAt and a finishedAt on an open one", () => {
    const fin = json(run(fullExamToReview(), [{ type: "finish", at: t(20) }]));
    expect(parse(fin)).not.toBeNull();
    expect(parse({ ...fin, finishedAt: null })).toBeNull();
    expect(parse({ ...json(fullExamToReview()), finishedAt: t(20) })).toBeNull();
  });

  it("takes items, critical flags and weights from the case, never from the stored state", () => {
    const j = json(fullExamToReview());
    const forged = withPart(j, 3, { items: j.parts[3].items.map((it) => ({ ...it, critical: false, weight: 99 })) });
    const s = parse(forged)!;
    expect(s).not.toBeNull();
    expect(s.parts[3].items).toEqual(toSimCase(loadCase()).sim.items.report.map(({ id, slot, critical, weight }) => ({ id, slot, critical, weight })));
    expect(sessionResult(P, s).criticalMissedCount).toBeGreaterThan(0);
    // stored items that name other ids than the case: discarded
    expect(parse(withPart(j, 3, { items: j.parts[3].items.slice(1) }))).toBeNull();
    // a case id other than the one the server loaded: discarded
    expect(parse({ ...j, caseId: "anderer-fall" })).toBeNull();
  });

  it("turns AI marking on only when the server's access decision allows it", () => {
    const j = json(fullExamToReview());
    expect(parse(j, restoreCtx(undefined, false))!.aiMarking).toBe(false);
    expect(parse({ ...json(newSession({ aiMarking: false })), aiMarking: true }, restoreCtx(undefined, false))!.aiMarking).toBe(false);
    expect(parse(j)!.aiMarking).toBe(true);
    // a fallback stays a fallback
    expect(parse({ ...j, aiMarking: false })!.aiMarking).toBe(false);
  });

  it("re-applies the quote rule to stored verdicts and refuses verdicts on a part that does not mark with AI", () => {
    const j = json(fullExamToReview());
    const forged = withPart(j, 3, { verdicts: { r04: { itemId: "r04", status: "covered", quote: "nicht im Text", model: "m", promptVersion: "p" } } });
    expect(parse(forged)!.parts[3].verdicts.r04.status).toBe("missing"); // critical, quote not in the learner's text
    expect(parse(withPart(j, 1, { verdicts: { x: { itemId: "x", status: "missing", quote: null, model: "m", promptVersion: "p" } } }))).toBeNull();
  });

  it("refuses stored marks the reducer would refuse (empty slot, more ticks than typed lines)", () => {
    const j = json(fullExamToReview());
    const emptySlotItem = (j.parts[3].items as { id: string; slot: string }[]).find((it) => it.slot !== "anamnese")!;
    expect(parse(withPart(j, 3, { selfMarks: { [emptySlotItem.id]: "covered" } }))).toBeNull();
    const diffJ = withPart(j, 2, { answers: { leading: "Anaphylaxie", others: "Urtikaria" } });
    expect(parse(withPart(diffJ, 2, { selfMarks: { o1: "covered" } }))).not.toBeNull();
    expect(parse(withPart(diffJ, 2, { selfMarks: { o1: "covered", o2: "covered" } }))).toBeNull();
  });

  it("refuses examiner text for a follow-up that was not asked", () => {
    const j = json(fullExamToReview());
    expect(parse(withPart(j, 4, { answers: { f1: "Adrenalin", f2: "erfunden" } }))).toBeNull();
  });
});

describe("profile part ids used by the adapter", () => {
  it("match the profile", () => {
    expect(Object.values(KP_PART_IDS)).toEqual(ORDER);
  });
});
