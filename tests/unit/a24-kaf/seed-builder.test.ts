import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isTwoReadPass, kafAcceptedAnswers, kafQuestionsFromPool, type ReviewedKafRow } from "@/lib/master-exam";
// @ts-expect-error plain .mjs script without type declarations
import { acceptedAnswers, buildSeedRows, isTwoReadPass as mjsTwoRead, EXCLUDED_KEY_FIX, KEY_FIX_GUARDS, MODEL_ANSWER_OVERRIDES, ARTIFACTS, DEFAULT_POOL_PATH, DEFAULT_ROWS_PATH, renderSeed, stemMd5 } from "../../../scripts/content/kaf/build-seed.mjs";

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

const artifact = (file: string) => readFileSync(resolve("scripts/sql/track-a/a24-exam", file), "utf8");
const seedSql = artifact("kaf-seed.sql");
const rollbackSql = artifact("kaf-seed.rollback.sql");
const seedIds = [...seedSql.matchAll(/WHERE id = (\d+) AND is_active/g)].map((m) => Number(m[1]));
const listIn = (sql: string) => (sql.match(/IN \(([\d, ]+)\)/)?.[1] ?? "").split(",").map((s) => Number(s.trim()));

describe("a24 KAF seed builder", () => {
  it("mirrors pool.ts: two-read rule and accepted wording", () => {
    for (const row of FIXTURE) {
      expect(mjsTwoRead(row)).toBe(isTwoReadPass(row));
      expect(acceptedAnswers(row)).toEqual(kafAcceptedAnswers(row));
    }
    // The stored wording is dropped when the reads say the key is wrong.
    expect(acceptedAnswers(FIXTURE[2])).toEqual([["Wulstfraktur", "Torusfraktur"]]);
  });

  it("emits two-read, stem-ready rows minus the held ids, the same set pool.ts would run", () => {
    const { seed, counts } = buildSeedRows({ rows: FIXTURE });
    // 69784 is now guarded on its fixed key instead of held out.
    expect(seed.map((s: { question_id: number }) => s.question_id)).toEqual([10, 12, 69784]);
    expect(counts).toMatchObject({ rows: 6, twoRead: 4, stemReady: 3, keyFixPresent: [69784], emitted: 3 });
    const viaPool = kafQuestionsFromPool(FIXTURE).map((q) => q.id).filter((id) => !EXCLUDED_KEY_FIX.includes(id));
    expect(seed.map((s: { question_id: number }) => s.question_id)).toEqual(viaPool);
    expect(seed[0]).toMatchObject({ required: 1, model_answer: "Lungenembolie", key_points: ["Pulmonalembolie", "LE"], guard_answer: null });
    expect(seed[2]).toMatchObject({ guard_answer: KEY_FIX_GUARDS[69784].answer, stem_md5: null });
    // With stems, every row is bound to its reviewed stem; the key-fix row to the fixed stem.
    const stems = new Map(FIXTURE.map((r) => [r.id, `stem ${r.id}`]));
    const bound = buildSeedRows({ rows: FIXTURE }, EXCLUDED_KEY_FIX, KEY_FIX_GUARDS, MODEL_ANSWER_OVERRIDES, stems).seed;
    expect(bound[0].stem_md5).toBe(stemMd5("stem 10"));
    expect(bound[2].stem_md5).toBe(stemMd5(KEY_FIX_GUARDS[69784].question));
    stems.delete(10);
    expect(() => buildSeedRows({ rows: FIXTURE }, EXCLUDED_KEY_FIX, KEY_FIX_GUARDS, MODEL_ANSWER_OVERRIDES, stems)).toThrow(/no reviewed stem/);
  });

  it("a model-answer override replaces the wording and drops the bracketed stored text from the accepted list", () => {
    const o = MODEL_ANSWER_OVERRIDES[63866];
    const row: Row = { id: 63866, topic: "Innere Medizin", stored_answer: o.dropAccepted, stem_fix_needed: false, canonical_model_answer: o.dropAccepted,
      read1: read("include", "yes", "A; B; C"), read2: read("include", "yes", "A, B, C") };
    const [s] = buildSeedRows({ rows: [row] }).seed;
    expect(s.model_answer).toBe(o.model_answer);
    expect(s.accepted).toEqual([["A; B; C", "A, B, C"]]);
    expect(s.source).toMatch(/a-kaf-ready re-read 2026-10-14/);
    // Without the override the commentary would be refused, never seeded.
    expect(() => buildSeedRows({ rows: [row] }, EXCLUDED_KEY_FIX, KEY_FIX_GUARDS, {})).toThrow(/commentary/);
  });

  it("the committed seed has 46 inactive guarded inserts and matching rollback, activate and deactivate lists", () => {
    expect(EXCLUDED_KEY_FIX).toEqual([63854, 71616]);
    expect(seedIds).toHaveLength(46);
    expect(new Set(seedIds).size).toBe(46);
    for (const id of EXCLUDED_KEY_FIX) expect(seedIds).not.toContain(id);
    expect(seedIds).toContain(69784);
    expect(seedSql.match(/ON CONFLICT \(question_id\) DO NOTHING;/g)).toHaveLength(46);
    // Every insert lands inactive; nothing in the seed activates a row.
    expect(seedSql.match(/'2026-10-1[24]'::timestamptz, false\n/g)).toHaveLength(46);
    // Every insert is bound to an md5 of the reviewed stem in the Kenntnisprüfung bank.
    expect(seedSql.match(/AND is_active AND exam_type = 'kenntnispruefung' AND md5\(question\) = '[0-9a-f]{32}'/g)).toHaveLength(46);
    expect(seedSql).not.toMatch(/is_active = true|SET is_active/);
    expect(seedSql).toMatch(/AND answer = \$a24kaf\$Wulstfraktur \(Torusfraktur\)\$a24kaf\$\)/);
    expect(seedSql).toMatch(/emitted rows: 46\./);
    expect(seedSql).toMatch(/-- pool\.json file sha256: [0-9a-f]{64}/);
    expect(seedSql).not.toMatch(/Heilung 2020-05/);
    expect(listIn(rollbackSql)).toEqual(seedIds);
    expect(rollbackSql.match(/DELETE/g)).toHaveLength(1);
    expect(listIn(artifact("kaf-activate.sql"))).toEqual(seedIds);
    expect(listIn(artifact("kaf-deactivate.sql"))).toEqual(seedIds);
    const dry = artifact("kaf-seed.dry-run.sql");
    expect(dry.trim().endsWith("ROLLBACK;")).toBe(true);
    expect(dry).not.toMatch(/COMMIT/);
    expect(artifact("kaf-seed.verify.sql")).not.toMatch(/INSERT|UPDATE|DELETE|BEGIN/);
  });

  it.skipIf(!existsSync(DEFAULT_POOL_PATH) || !existsSync(DEFAULT_ROWS_PATH))("the committed seed is current for the reviewed pool.json and stems", () => {
    const bytes = readFileSync(DEFAULT_POOL_PATH);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const stems = new Map((JSON.parse(readFileSync(DEFAULT_ROWS_PATH, "utf8")) as { id: number; question: string }[]).map((r) => [r.id, r.question]));
    const out = renderSeed(JSON.parse(bytes.toString("utf8")), sha, stems);
    for (const [key, file] of Object.entries(ARTIFACTS as Record<string, string>)) expect(out[key as keyof typeof out], file).toBe(artifact(file));
    expect(out.counts).toMatchObject({ rows: 83, twoRead: 83, stemReady: 46, keyFixPresent: [69784], emitted: 46 });
  });
});
