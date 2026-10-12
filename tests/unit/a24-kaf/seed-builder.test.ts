import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isTwoReadPass, kafAcceptedAnswers, kafQuestionsFromPool, type ReviewedKafRow } from "@/lib/master-exam";
// @ts-expect-error plain .mjs script without type declarations
import { acceptedAnswers, buildSeedRows, isTwoReadPass as mjsTwoRead, EXCLUDED_KEY_FIX, DEFAULT_POOL_PATH, renderSeed } from "../../../scripts/content/kaf/build-seed.mjs";

type Row = ReviewedKafRow & { canonical_model_answer: string };
const read = (verdict: string, key_correct: string, model: string, kps: string[] = []) => ({ verdict, key_correct, model_answer: model, key_points: kps });
const FIXTURE: Row[] = [
  { id: 10, topic: "Innere Medizin", stored_answer: "Lungenembolie", stem_fix_needed: false, canonical_model_answer: "Lungenembolie",
    read1: read("include", "yes", "Lungenembolie", ["Pulmonalembolie"]), read2: read("fix-then-include", "yes", "Pulmonalembolie", ["LE"]) },
  { id: 11, topic: "Neurologie", stored_answer: "x", stem_fix_needed: true, canonical_model_answer: "x",
    read1: read("include", "yes", "x"), read2: read("include", "yes", "x") },
  { id: 12, topic: "Chirurgie", stored_answer: "Grünholzfraktur", stem_fix_needed: false, canonical_model_answer: "Wulstfraktur",
    read1: read("include", "no", "Wulstfraktur", ["Torusfraktur"]), read2: read("include", "no", "Wulstfraktur") },
  { id: 13, topic: "HNO", stored_answer: "a", stem_fix_needed: false, canonical_model_answer: "a",
    read1: read("include", "yes", "a"), read2: read("exclude", "yes", "a") },
  { id: 69784, topic: "Kinder", stored_answer: "b", stem_fix_needed: false, canonical_model_answer: "b",
    read1: read("include", "yes", "b"), read2: read("include", "yes", "b") },
  { id: 14, topic: "Psych", stored_answer: "c", stem_fix_needed: false, canonical_model_answer: "c",
    read1: read("include", "no", "c"), read2: read("include", "yes", "c") },
];

const seedSql = readFileSync(resolve("scripts/sql/track-a/a24-exam/kaf-seed.sql"), "utf8");
const rollbackSql = readFileSync(resolve("scripts/sql/track-a/a24-exam/kaf-seed.rollback.sql"), "utf8");
const seedIds = [...seedSql.matchAll(/WHERE id = (\d+) AND is_active/g)].map((m) => Number(m[1]));

describe("a24 KAF seed builder", () => {
  it("mirrors pool.ts: two-read rule and accepted wording", () => {
    for (const row of FIXTURE) {
      expect(mjsTwoRead(row)).toBe(isTwoReadPass(row));
      expect(acceptedAnswers(row)).toEqual(kafAcceptedAnswers(row));
    }
    // The stored wording is dropped when the reads say the key is wrong.
    expect(acceptedAnswers(FIXTURE[2])).toEqual([["Wulstfraktur", "Torusfraktur"]]);
  });

  it("emits two-read, stem-ready rows minus the key-fix ids, the same set pool.ts would run", () => {
    const { seed, counts } = buildSeedRows({ rows: FIXTURE });
    expect(seed.map((s: { question_id: number }) => s.question_id)).toEqual([10, 12]);
    expect(counts).toMatchObject({ rows: 6, twoRead: 4, stemReady: 3, keyFixPresent: [69784], emitted: 2 });
    const viaPool = kafQuestionsFromPool(FIXTURE).map((q) => q.id).filter((id) => !EXCLUDED_KEY_FIX.includes(id));
    expect(seed.map((s: { question_id: number }) => s.question_id)).toEqual(viaPool);
    expect(seed[0]).toMatchObject({ required: 1, model_answer: "Lungenembolie", key_points: ["Pulmonalembolie", "LE"] });
  });

  it("the committed seed has 45 ids, none of the key-fix rows, guarded inserts and a matching rollback", () => {
    expect(EXCLUDED_KEY_FIX).toEqual([63854, 69784, 71616]);
    expect(seedIds).toHaveLength(45);
    expect(new Set(seedIds).size).toBe(45);
    for (const id of EXCLUDED_KEY_FIX) expect(seedIds).not.toContain(id);
    expect(seedSql.match(/ON CONFLICT \(question_id\) DO NOTHING;/g)).toHaveLength(45);
    expect(seedSql).toMatch(/emitted rows: 45\./);
    expect(seedSql).toMatch(/-- pool\.json file sha256: [0-9a-f]{64}/);
    const rollbackIds = (rollbackSql.match(/IN \(([\d, ]+)\)/)?.[1] ?? "").split(",").map((s) => Number(s.trim()));
    expect(rollbackIds).toEqual(seedIds);
    expect(rollbackSql.match(/DELETE/g)).toHaveLength(1);
  });

  it.skipIf(!existsSync(DEFAULT_POOL_PATH))("the committed seed is current for the reviewed pool.json", () => {
    const bytes = readFileSync(DEFAULT_POOL_PATH);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const out = renderSeed(JSON.parse(bytes.toString("utf8")), sha);
    expect(out.seedSql).toBe(seedSql);
    expect(out.rollbackSql).toBe(rollbackSql);
    expect(out.counts).toMatchObject({ rows: 83, twoRead: 83, stemReady: 46, keyFixPresent: [69784], emitted: 45 });
  });
});
