import { describe, expect, it } from "vitest";
import {
  clampPoolLimit, cleanTyped, kafHistoryBody, kafPendingKey, kafResultCounts, kafSessionKey, parseKafKeys, parseKafSession,
  sampleItems, suggestMark, formatClock, countChoices, KAF_DURATION_S,
} from "@/lib/kaf-run";

describe("suggestMark", () => {
  const accepted = [["Pulmonalembolie", "Lungenembolie"]];
  it("matches after normalisation only (case, punctuation, ß)", () => {
    expect(suggestMark(accepted, ["  lungenembolie. "])).toBe("matches");
    expect(suggestMark([["Fuß"]], ["FUSS"])).toBe("matches");
  });
  it("anything else is left to the learner", () => {
    expect(suggestMark(accepted, ["LE"])).toBe("compare");
    expect(suggestMark(accepted, ["Lungenembolie mit Infarkt"])).toBe("compare");
    expect(suggestMark([], ["x"])).toBe("compare");
  });
  it("empty input is empty", () => {
    expect(suggestMark(accepted, [])).toBe("empty");
    expect(suggestMark(accepted, ["  ", "-"])).toBe("empty");
    expect(suggestMark(accepted, undefined)).toBe("empty");
  });
  it("needs every required answer, each matched once", () => {
    const two = [["Kultur"], ["Zellzahl"]];
    expect(suggestMark(two, ["zellzahl", "kultur"])).toBe("matches");
    expect(suggestMark(two, ["kultur", "kultur"])).toBe("compare");
    expect(suggestMark(two, ["kultur"])).toBe("compare");
  });
});

describe("kaf-run helpers", () => {
  it("clamps the pool limit", () => {
    expect(clampPoolLimit(null)).toBe(30);
    expect(clampPoolLimit("abc")).toBe(30);
    expect(clampPoolLimit("0")).toBe(1);
    expect(clampPoolLimit("500")).toBe(60);
    expect(clampPoolLimit("12.7")).toBe(12);
  });
  it("samples without repeats and never more than the pool", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const s = sampleItems(items, 4, () => 0.5);
    expect(s).toHaveLength(4);
    expect(new Set(s).size).toBe(4);
    expect(sampleItems(items, 50)).toHaveLength(10);
    expect(sampleItems([], 5)).toEqual([]);
  });
  it("count chips fit the pool", () => {
    expect(countChoices(45)).toEqual([10, 20, 30]);
    expect(countChoices(25)).toEqual([10, 20]);
    expect(countChoices(7)).toEqual([7]);
    expect(countChoices(0)).toEqual([]);
  });
  it("cleans typed answers like the history POST", () => {
    expect(cleanTyped(["  a ", "", "b", "c"], 2)).toEqual(["a"]);
    expect(cleanTyped(["x".repeat(400)], 1)[0]).toHaveLength(300);
  });
  it("counts only answered items marked right; a mark on an empty answer never counts", () => {
    const items = [{ id: 1, required: 1 }, { id: 2, required: 1 }, { id: 3, required: 1 }, { id: 4, required: 1 }];
    const c = kafResultCounts(items, { "1": ["a"], "2": ["b"], "3": [""] }, { "1": true, "2": false, "3": true });
    expect(c).toEqual({ total: 4, answered: 2, right: 1, undecided: 0, pct: 25 });
  });
  it("builds the history body with kind kaf and true marks only for answered items", () => {
    const body = kafHistoryBody({
      attemptId: "11111111-1111-4111-8111-111111111111", title: "KAF-Übung",
      items: [{ id: 5, required: 1 }, { id: 6, required: 2 }, { id: 7, required: 1 }],
      answers: { "5": ["a"], "6": ["b", " "], "7": [] }, marks: { "5": false, "6": true, "7": true },
      startedAt: 1_000, finishedAt: 61_000, durationS: KAF_DURATION_S, timeExpired: false,
    });
    expect(body).toMatchObject({
      exam_type: "kenntnispruefung",
      config: { kind: "kaf", presetId: "kaf_timed", durationS: 14_400, count: 3, timeExpired: false },
      question_ids: [5, 6, 7], answers: { "5": ["a"], "6": ["b"] }, self_marks: { "6": true }, duration_ms: 60_000,
    });
  });
  it("uses its own account-scoped keys, never the /exam keys", () => {
    expect(kafSessionKey("u 1")).toBe("medpruef_kaf_session:v1:u%201");
    expect(kafPendingKey("u1")).toBe("medpruef_kaf_pending:v1:u1");
    expect(kafSessionKey(" ")).toBeNull();
    expect(kafSessionKey("u1")).not.toMatch(/medpruef_exam_/);
  });
  it("parses only valid sessions", () => {
    const ok = {
      v: 1, attemptId: "11111111-1111-4111-8111-111111111111", startedAt: 1, durationS: 14400, finishedAt: null, timeExpired: false,
      phase: "running", items: [{ id: 1, topic: "t", stem: "s", image_url: null, required: 1 }], answers: {}, marks: {}, keys: null, currentIdx: 9, savedAt: 1,
    };
    expect(parseKafSession(JSON.stringify(ok))?.currentIdx).toBe(0);
    expect(parseKafSession(JSON.stringify({ ...ok, attemptId: "x" }))).toBeNull();
    expect(parseKafSession(JSON.stringify({ ...ok, items: [] }))).toBeNull();
    expect(parseKafSession(JSON.stringify({ ...ok, items: [{ ...ok.items[0], required: 4 }] }))).toBeNull();
    expect(parseKafSession("{")).toBeNull();
  });
  it("parses answer keys for requested ids only", () => {
    const keys = parseKafKeys({ "1": { accepted: [["a", ""]], model_answer: "a", key_points: ["k", 3] }, "2": { accepted: [], model_answer: "b" }, "9": { accepted: [["z"]], model_answer: "z" } }, [1, 2]);
    expect(keys).toEqual({ "1": { accepted: [["a"]], model_answer: "a", key_points: ["k"] } });
  });
  it("formats the clock", () => {
    expect(formatClock(14_400)).toBe("04:00:00");
    expect(formatClock(-3)).toBe("00:00:00");
  });
});

describe("suggestMark never treats a single key point as a full answer (a24)", () => {
  it("key point alone reads compare; the model wording reads matches", async () => {
    const { suggestMark } = await import("@/lib/kaf-run");
    const accepted = [["Blutkultur, Echokardiographie und Antibiose", "Kultur"]];
    expect(suggestMark(accepted, ["Kultur"], ["Kultur"])).toBe("compare");
    expect(suggestMark(accepted, ["Blutkultur, Echokardiographie und Antibiose"], ["Kultur"])).toBe("matches");
  });
});
