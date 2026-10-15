/**
 * a-content-c1: C1 pre-screen. Pure rules plus the CLI end to end on fixture
 * rows against a fake Message Batches API. No network, no database.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readResults } from "../../../scripts/ai-batch/runner";
import {
  buildRowStates,
  customId,
  deterministicFlags,
  idsFromJson,
  idsFromSql,
  keyDoubtLines,
  nextItems,
  parseBlind,
  parseCustomId,
  parseReview,
  pass1Flagged,
  rankQueue,
  rowHash,
  verdictFor,
  type QuestionRow,
} from "../../../scripts/content/prescreen/lib";
import { loadClaims, parseExposureFile } from "../../../scripts/content/prescreen/io";
import { runCli } from "../../../scripts/content/prescreen/main";
import { fakeBatches, type FakeAnswer } from "./fake-batches";

const LONG = "Die Erklärung begründet die richtige Antwort ausführlich und nennt die aktuelle Leitlinie der Fachgesellschaft.";

function row(id: number, exam: string, keyIdx: number[], extra: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id,
    exam_type: exam,
    topic: "Innere Medizin",
    question: `Frage ${id}: Welche Aussage trifft zu?`,
    choices: ["Option A", "Option B", "Option C", "Option D", "Option E"].map((text, i) => ({ text, correct: keyIdx.includes(i), position: i })),
    answer: "Option A",
    explanation: LONG,
    tags: [],
    image_url: null,
    image_urls: null,
    is_active: true,
    ...extra,
  };
}

// 70001 STP, blind disagrees and the review keeps disagreeing (strong, confirmed by Opus).
// 70002 KP, explanation contradicts the key (Opus refuses once, Sonnet fallback confirms).
// 70003 KP, clean everywhere. 70004 KP, short explanation only (below the pass 2 bar).
// 70005 STP, would be flagged but is claimed by b12. 70006 pharma, clean, never answered.
const ROWS: QuestionRow[] = [
  row(70001, "kmp_innsbruck", [0]),
  row(70002, "kenntnispruefung", [1]),
  row(70003, "kenntnispruefung", [2]),
  row(70004, "kenntnispruefung", [0], { explanation: "Kurz." }),
  row(70005, "kmp_innsbruck", [0]),
  row(70006, "pharma", [3]),
];
const ANSWERS: Record<string, number> = { "70001": 40, "70002": 300, "70003": 50, "70004": 10, "70005": 90 };

const blind = (picks: string[], confidence = 0.9): FakeAnswer => ({
  text: JSON.stringify({ picks, free_answer: "", confidence, answerable_without_image: true, multiple_correct_likely: false, stem_depends_on_option_wording: false, note: "" }),
});
const review = (flags: Partial<Record<string, boolean>> = {}, severity = "none", reason = ""): FakeAnswer => ({
  text: JSON.stringify({
    key_disagree: false,
    multi_answer: false,
    option_dependent_stem: false,
    explanation_contradicts_key: false,
    explanation_thin_or_english: false,
    outdated_guideline_or_year: false,
    image_needed_missing: false,
    ...flags,
    key_disagree_confidence: flags.key_disagree ? 0.8 : 0.05,
    own_answer: [],
    severity,
    reason,
  }),
});

const KEY: Record<number, string[]> = { 70001: ["A"], 70002: ["B"], 70003: ["C"], 70004: ["A"], 70005: ["A"], 70006: ["D"] };

function responder(refusedOnce: Set<string>) {
  return (id: string): FakeAnswer => {
    const p = parseCustomId(id)!;
    const q = p.questionId;
    if (p.stage === "p2b" && q === 70002 && !refusedOnce.has(id)) {
      refusedOnce.add(id);
      return { text: "", stop_reason: "refusal" };
    }
    if (p.stage.endsWith("b") || p.stage === "p2bf") {
      if (q === 70001 || q === 70005) return blind(["B"]);
      return blind(KEY[q]);
    }
    if (q === 70001 || q === 70005) return review({ key_disagree: true }, "high", "Stored key A contradicts the current guideline; B is first line.");
    if (q === 70002) return review({ explanation_contradicts_key: true }, "medium", "Explanation argues for option C while the key is B.");
    return review();
  };
}

let tmp: string;
let reports: string;
let snapFile: string;
const env = () => ({ ANTHROPIC_AUTH_MODE: "wif-local" }) as NodeJS.ProcessEnv;
const bearer = async () => ({ kind: "bearer" as const, value: "test-bearer-not-real", expiresAt: Date.now() + 3_600_000 });

beforeEach(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "c1-"));
  reports = path.join(tmp, "reports");
  mkdirSync(path.join(reports, "track-b-2026-10-11", "data"), { recursive: true });
  writeFileSync(path.join(reports, "track-b-2026-10-11", "data", "ROW-CLAIMS.jsonl"), JSON.stringify({ pkg: "b12-explanation-short", ids: [70005] }) + "\n" + JSON.stringify({ pkg: "b21-stp-field-map", ids: [70001] }) + "\n");
  snapFile = path.join(tmp, "snap.json");
  const out: string[] = [];
  await runCli(["snapshot", "--out", snapFile], { out: (l) => out.push(l), now: () => new Date("2026-10-14T12:00:00Z"), readDb: async () => ({ rows: ROWS, answers_90d: ANSWERS, learner_wrong_key_ids: [70001] }) });
  expect(out[0]).toMatch(/6 active rows, 5 answered/);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("pure rules", () => {
  it("custom ids carry stage, question and a row hash that changes with the content", () => {
    const r = ROWS[0];
    const id = customId("p1b", r, rowHash(r));
    expect(parseCustomId(id)).toEqual({ stage: "p1b", questionId: 70001, hash: rowHash(r) });
    expect(rowHash({ ...r, explanation: `${LONG} Neu.` })).not.toBe(rowHash(r));
    expect(parseCustomId("p9_1_x")).toBeNull();
  });

  it("deterministic flags: stated count, image reference without an image, short explanation", () => {
    const d = deterministicFlags(row(1, "kenntnispruefung", [0], { question: "Im EKG ist zu sehen ... (2 richtige Antworten)", explanation: "x" }));
    expect(d).toMatchObject({ stated_count_mismatch: true, image_ref_without_image: true, explanation_short: true, open_answer: false });
  });

  it("parsers are strict: unknown letters dropped, wrong types throw", () => {
    expect(parseBlind(blind(["A", "Z", "E"]).text, 4).picks).toEqual(["A"]);
    expect(() => parseBlind("{\"picks\": \"A\"}", 5)).toThrow();
    expect(() => parseReview(JSON.stringify({ severity: "huge" }), 5)).toThrow();
  });

  it("pass 2 needs strength 0.45: a short explanation alone does not send a row to Opus", () => {
    const st = buildRowStates([ROWS[3]], [
      { custom_id: customId("p1b", ROWS[3], rowHash(ROWS[3])), batch_id: "b", type: "succeeded", text: blind(["A"]).text, stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: null, cost_micro: 1, error: null, collected_at: "t" },
      { custom_id: customId("p1r", ROWS[3], rowHash(ROWS[3])), batch_id: "b", type: "succeeded", text: review().text, stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: null, cost_micro: 1, error: null, collected_at: "t" },
    ]).get(70004)!;
    expect(pass1Flagged(st)).toBe(false);
    expect(pass1Flagged(st, 0.2)).toBe(true);
    expect(nextItems([st], { pass2: "flagged_and_sample", seed: "never-sampled-seed-x" }).items.length).toBeLessThanOrEqual(1);
  });

  it("claims: SQL ids incl. ANY(ARRAY[...]), JSON ids, and a missing reports dir fails closed", () => {
    expect(idsFromSql("UPDATE q WHERE q.id = 70001; SELECT id FROM questions WHERE id = ANY(ARRAY[70002,\n70003]) AND id IN (70004, 70005)")).toEqual([70001, 70002, 70003, 70004, 70005]);
    expect(idsFromJson({ rows: [{ id: 70001 }, { question_id: 70002, n: 5 }, { id: 3 }] })).toEqual([70001, 70002]);
    expect(() => loadClaims(path.join(tmp, "nope"))).toThrow(/no claim sources/);
    const { claims } = loadClaims(reports);
    expect(claims.get(70005)).toEqual(["b12-explanation-short"]);
    expect(claims.has(70001)).toBe(false); // b21 is a field map, not a rewrite
  });

  it("exposure file: object or array form", () => {
    expect(parseExposureFile('{"70001": 3, "x": 2, "70002": 0}')).toEqual({ "70001": 3 });
    expect(parseExposureFile('[{"question_id": 70001, "n": 4}]')).toEqual({ "70001": 4 });
  });
});

describe("CLI end to end (fake Batches API, keyless bearer)", () => {
  async function runAll(maxUsd = "5") {
    const refused = new Set<string>();
    const api = fakeBatches(responder(refused));
    const state = path.join(tmp, "state");
    const lines: string[] = [];
    const deps = { env: env(), out: (l: string) => lines.push(l), fetch: api.fetch, resolveAuth: bearer, root: tmp };
    for (let i = 0; i < 8; i++) {
      await runCli(["step", "--snapshot", snapFile, "--state", state, "--live", "--max-usd", maxUsd, "--reports", reports], deps);
      api.endAll();
      if (lines.at(-1)?.includes("nothing open and nothing left")) break;
    }
    return { api, state, lines, deps };
  }

  it("plan makes no model call", async () => {
    const lines: string[] = [];
    await runCli(["plan", "--snapshot", snapFile, "--state", path.join(tmp, "state"), "--reports", reports], { out: (l) => lines.push(l), root: tmp });
    expect(lines[0]).toMatch(/5 rows \(1 claimed rows skipped\), next step sends 5 items/);
    const plan = JSON.parse(readFileSync(path.join(tmp, "state", "plan.json"), "utf8"));
    expect(plan.next_items_by_stage.p1b).toBe(5);
  });

  it("runs pass 1 and pass 2, re-queues the Opus refusal on Sonnet, then writes queue, verdicts and cost report", async () => {
    const { api, state, lines } = await runAll();
    expect(lines.at(-1)).toMatch(/nothing open and nothing left/);
    // Every request carried the keyless bearer and never an API key.
    for (const c of api.calls) {
      expect(c.headers.authorization).toBe("Bearer [secret]");
      expect(c.headers).not.toHaveProperty("x-api-key");
    }
    const sent = api.posts().flatMap((p) => p.body!.requests!);
    // STP first in the first batch; the claimed row never went out.
    expect(parseCustomId(sent[0].custom_id)!.questionId).toBe(70001);
    expect(sent.some((r) => parseCustomId(r.custom_id)!.questionId === 70005)).toBe(false);
    // Blind requests never show the key or the explanation.
    const p1b = sent.find((r) => r.custom_id.startsWith("p1b_70002_"))!;
    expect(JSON.stringify(p1b.params)).not.toContain("Stored answer key");
    expect(JSON.stringify(p1b.params)).not.toContain(LONG);
    expect(p1b.params).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
    // Pass 2 on Opus; the refused row was re-sent on Sonnet (p2bf).
    expect(sent.some((r) => r.custom_id.startsWith("p2b_70001_") && r.params.model === "claude-opus-5-5")).toBe(true);
    expect(sent.some((r) => r.custom_id.startsWith("p2bf_70002_") && r.params.model === "claude-sonnet-5-5")).toBe(true);
    // The short-explanation row (strength 0.3) did not go to Opus.
    expect(sent.some((r) => /^p2/.test(r.custom_id) && parseCustomId(r.custom_id)!.questionId === 70004)).toBe(false);
    const ids = new Set(sent.map((r) => r.custom_id));
    expect(ids.size).toBe(sent.length); // nothing sent twice

    const out: string[] = [];
    await runCli(["report", "--snapshot", snapFile, "--state", state, "--reports", reports, "--top", "10"], { out: (l) => out.push(l), now: () => new Date("2026-10-14T13:00:00Z"), root: tmp });
    const queue = readFileSync(path.join(state, "queue.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(queue.map((q) => q.id)).toEqual([70001, 70002, 70004]);
    expect(queue[2]).toMatchObject({ flags: ["explanation_short"], pass2: "not_run" });
    expect(queue[0]).toMatchObject({ id: 70001, pkg: "prescreen-2026-10", status: "needs-track-a-medic", proposed_key: null, rank: 1, pass2: "confirmed" });
    expect(queue[0].reason).toMatch(/contradicts the current guideline/);
    expect(queue.some((q) => q.id === 70005)).toBe(false);
    const verdicts = readFileSync(path.join(state, "verdicts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(verdicts.find((v) => v.id === 70003)).toMatchObject({ status: "clean" });
    expect(verdicts.find((v) => v.id === 70005)).toMatchObject({ status: "incomplete", claimed_by: ["b12-explanation-short"] });
    const cost = JSON.parse(readFileSync(path.join(state, "cost-report.json"), "utf8"));
    expect(cost.refusals).toBe(1);
    expect(cost.spent_usd).toBeGreaterThan(0);
    expect(cost.rows).toMatchObject({ flagged: expect.any(Number), clean: expect.any(Number) });
    expect(cost.by_stage_all_attempts.find((s: { stage: string }) => s.stage === "p2b")).toMatchObject({ refusals: 1 });
    // Calibration scoring on the same state.
    const idsFile = path.join(tmp, "cal.json");
    writeFileSync(idsFile, JSON.stringify({ ids: [70001, 70003], labels: [{ id: 70001, key_doubt: true, explanation_defect: false, source: ["test"] }, { id: 70003, key_doubt: false, explanation_defect: false, source: ["test"] }] }));
    await runCli(["calibrate-score", "--snapshot", snapFile, "--state", state, "--ids", idsFile], { out: () => {}, root: tmp });
    const cal = JSON.parse(readFileSync(path.join(state, "calibration.json"), "utf8"));
    expect(cal.any_flag.p1).toMatchObject({ tp: 1, fp: 0, tn: 1, fn: 0, precision: 1 });
    expect(cal.note_on_n).toMatch(/sanity check/);
  });

  it("is idempotent: a second full run sends nothing", async () => {
    const { state, deps } = await runAll();
    const before = readResults(state).length;
    const api2 = fakeBatches(() => blind(["A"]));
    await runCli(["step", "--snapshot", snapFile, "--state", state, "--live", "--max-usd", "5", "--reports", reports], { ...deps, fetch: api2.fetch });
    expect(api2.posts()).toHaveLength(0);
    expect(readResults(state).length).toBe(before);
  });

  it("the budget cap holds items back", async () => {
    const api = fakeBatches(responder(new Set()));
    const lines: string[] = [];
    await runCli(["step", "--snapshot", snapFile, "--state", path.join(tmp, "s2"), "--live", "--max-usd", "0.02", "--reports", reports], { env: env(), out: (l) => lines.push(l), fetch: api.fetch, resolveAuth: bearer, root: tmp });
    expect(lines[0]).toMatch(/held by the USD 0.02 cap/);
    const sent = api.posts().flatMap((p) => p.body!.requests!);
    expect(sent.length).toBeLessThan(5);
  });

  it("refuses without --live, without keyless mode, and with an over-cap budget; nothing is sent", async () => {
    const api = fakeBatches(() => blind(["A"]));
    const base = ["step", "--snapshot", snapFile, "--state", path.join(tmp, "s3"), "--reports", reports];
    await expect(runCli(base.concat(["--max-usd", "1"]), { env: env(), fetch: api.fetch, resolveAuth: bearer, root: tmp })).rejects.toThrow(/--live/);
    await expect(runCli(base.concat(["--live", "--max-usd", "500"]), { env: env(), fetch: api.fetch, resolveAuth: bearer, root: tmp })).rejects.toThrow(/max-usd/);
    const e = { ANTHROPIC_API_KEY: "[secret]" } as NodeJS.ProcessEnv;
    await expect(runCli(base.concat(["--live", "--max-usd", "1"]), { env: e, fetch: api.fetch, resolveAuth: bearer, root: tmp })).rejects.toThrow(/wif-local/);
    expect(api.calls).toHaveLength(0);
  });

  it("calibrate picks known-outcome rows from b11, KEY-DOUBTS and learner reports", async () => {
    const b11 = path.join(reports, "track-b-2026-10-11", "handover", "b11-explanation-audit");
    mkdirSync(b11, { recursive: true });
    writeFileSync(path.join(b11, "audit.json"), JSON.stringify([{ id: 70002, verdict: "REJECT", key_doubt: false }, { id: 70003, verdict: "UNSURE", key_doubt: false }]));
    writeFileSync(path.join(reports, "track-b-2026-10-11", "data", "KEY-DOUBTS.jsonl"), JSON.stringify({ pkg: "b11-explanation-audit", id: 70004 }) + "\n");
    const out = path.join(tmp, "cal.json");
    await runCli(["calibrate", "--snapshot", snapFile, "--out", out, "--n", "4", "--reports", reports], { out: () => {}, root: tmp });
    const j = JSON.parse(readFileSync(out, "utf8"));
    expect(j.ids).toEqual([70001, 70002, 70003, 70004]);
    expect(j.known_positive).toBe(3);
  });
});

describe("queue lines", () => {
  it("never propose a key and say they are triage only", () => {
    const st = buildRowStates([ROWS[0]], []).get(70001)!;
    const v = { ...verdictFor(st, { answers_90d: 1, free_set: false }, new Map()), status: "flagged" as const, strength: 1, score: 1 };
    const [line] = keyDoubtLines(rankQueue([v], 5), "t", "/x");
    expect(JSON.parse(line)).toMatchObject({ proposed_key: null, note: expect.stringMatching(/not a medical verdict/) });
  });
});
