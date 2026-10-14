#!/usr/bin/env node
// a24 KAF seed builder (pick-kaf-pool = build, [name] 2026-10-12), reworked by
// a-kaf-ready (2026-10-14) for the 5 Nov switch-on.
//
// Reads the reviewed kaf-triage pool (two Medic reads per row) and writes DATA
// ARTIFACTS, never a migration (all under scripts/sql/track-a/a24-exam/):
//   kaf-seed.sql             one guarded INSERT per runnable row, every row INACTIVE
//   kaf-seed.dry-run.sql     the same inserts plus a report, ending in ROLLBACK
//   kaf-seed.verify.sql      read-only report (seeded, active, guard state per row)
//   kaf-activate.sql         flips exactly the seeded ids to active (guards rechecked)
//   kaf-deactivate.sql       flips them back to inactive (the activation rollback)
//   kaf-seed.rollback.sql    deletes exactly the seeded ids
//
// Runnable = both reads include or fix-then-include AND agree on key correctness
// (isTwoReadPass in src/lib/master-exam/pool.ts) AND stem_fix_needed is false.
// 63854 and 71616 (live MC key defects) also need a stem fix, so they stay out.
// 69784's MC key fix (a-kaf-ready key-fixes, two reads) is a precondition: its
// insert and activation run only while the live row carries the fixed answer.
// 63866's model answer carried bracketed Anki commentary; a-kaf-ready's two
// reads approved a cleaned wording (MODEL_ANSWER_OVERRIDES).
// Every row is bound to the exact stem its reads saw: insert and activation
// require md5(question) of the 12 Oct triage stem (rows.json next to pool.json;
// for 69784 the stem after its key fix). A later stem edit (for example a07's
// staged 70720 file) makes that row drop out until it is read again.
// The rules below mirror pool.ts (isTwoReadPass, kafAcceptedAnswers); a unit test
// (tests/unit/a24-kaf/seed-builder.test.ts) keeps them equal.
//
// Usage: node scripts/content/kaf/build-seed.mjs [path/to/pool.json] [--check]
//        (rows.json is read from the same directory as pool.json)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
export const DEFAULT_POOL_PATH = "./reports/track-b-2026-10-11/data/kaf-triage/pool.json";
export const DEFAULT_ROWS_PATH = path.join(path.dirname(DEFAULT_POOL_PATH), "rows.json");
const DIR = path.join(ROOT, "scripts/sql/track-a/a24-exam");
export const SEED_PATH = path.join(DIR, "kaf-seed.sql");
export const ROLLBACK_PATH = path.join(DIR, "kaf-seed.rollback.sql");
export const ARTIFACTS = Object.freeze({
  seedSql: "kaf-seed.sql",
  rollbackSql: "kaf-seed.rollback.sql",
  dryRunSql: "kaf-seed.dry-run.sql",
  verifySql: "kaf-seed.verify.sql",
  activateSql: "kaf-activate.sql",
  deactivateSql: "kaf-deactivate.sql",
});

/**
 * needs-track-a.json live-key-defect rows still held out: 63854 and 71616 also
 * need a KAF stem fix (stem_fix_needed), so the key fix alone does not make
 * them runnable.
 */
export const EXCLUDED_KEY_FIX = Object.freeze([63854, 71616]);
/**
 * Rows whose live MC key is corrected by a guarded content file. Seeded and
 * activated only while the live row carries the fixed answer (a-kaf-ready
 * key-fixes/batches/rekey-<id>, two Medic reads 2026-10-14).
 */
export const KEY_FIX_GUARDS = Object.freeze({
  69784: Object.freeze({
    answer: "Wulstfraktur (Torusfraktur)",
    // The key fix also removes the welded Anki variant from the stem.
    question: "Bei einem 7-jährigen Kind, das am Spielplatz auf die rechte Hand gestürzt ist, findet sich bei der Röntgenuntersuchung eine Aufwölbung der Kortikalis im Bereich des distalen Radius. Wie nennt man diese Frakturform?",
  }),
});
/**
 * Model answers corrected after the triage. The bracketed stored wording is
 * also dropped from the accepted list. Approved by a-kaf-ready's two reads
 * (kaf-read-A, kaf-read-B, 2026-10-14).
 */
export const MODEL_ANSWER_OVERRIDES = Object.freeze({
  63866: Object.freeze({
    model_answer: "Verlängerung des Gesamtüberlebens; Verbesserung der Lebensqualität; Hemmung weiterer Metastasierung",
    dropAccepted: "Verlängerung des Gesamtüberlebens Verbesserung der Lebensqualität Hemmung weiterer Metastasierung [Hauptziel einer neo-adjuvanten Chemotherapie: Tumorverkleinerung für eine Operation, Heilung 2020-05 etc. Hauptziele einer adjuvanten Chemotherapie: Vermeidung eines Rückfalls, Heilung 2019-06]",
  }),
});
export const SOURCE = "kaf-triage 2026-10-12 two Medic reads";
export const REVIEWED_BY = "medic-read1+read2";
export const REVIEWED_AT = "2026-10-12";
const RE_READ_SOURCE = "kaf-triage 2026-10-12 two Medic reads; a-kaf-ready re-read 2026-10-14";
const RE_READ_AT = "2026-10-14";
const COMMENTARY = /\[|\b(19|20)\d\d-\d\d\b/;
export const stemMd5 = (text) => createHash("md5").update(String(text), "utf8").digest("hex");
const RE_READ_BY = "medic-read1+read2; kaf-read-A+kaf-read-B";
const TAG = "$a24kaf$";

const INCLUDE = new Set(["include", "fix-then-include"]);

export function isTwoReadPass(row) {
  return INCLUDE.has(row.read1.verdict) && INCLUDE.has(row.read2.verdict) && row.read1.key_correct === row.read2.key_correct;
}

function storedKeyConfirmed(row) {
  return row.read1.key_correct !== "no" && row.read2.key_correct !== "no";
}

/** Same order and dedupe as kafAcceptedAnswers: stored (when confirmed), read1, read2, read1 key points, read2 key points. */
export function acceptedAnswers(row) {
  const alternatives = [
    ...(storedKeyConfirmed(row) ? [row.stored_answer] : []),
    row.read1.model_answer,
    row.read2.model_answer,
    ...(row.read1.key_points ?? []),
    ...(row.read2.key_points ?? []),
  ]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);
  return [[...new Set(alternatives)]];
}

function unionKeyPoints(row) {
  const all = [...(row.read1.key_points ?? []), ...(row.read2.key_points ?? [])].map((s) => String(s ?? "").trim()).filter(Boolean);
  return [...new Set(all)];
}

/** Rows to seed, sorted by id, plus the counts recorded in the header. */
/** `stems` (id -> triage stem) binds each row to the stem its reads saw; omitted only in fixture tests. */
export function buildSeedRows(pool, excluded = EXCLUDED_KEY_FIX, guards = KEY_FIX_GUARDS, overrides = MODEL_ANSWER_OVERRIDES, stems = null) {
  const rows = Array.isArray(pool) ? pool : pool.rows;
  const twoRead = rows.filter(isTwoReadPass);
  const stemReady = twoRead.filter((r) => r.stem_fix_needed !== true);
  const skip = new Set(excluded);
  const keyFixPresent = stemReady.filter((r) => Object.hasOwn(guards, r.id)).map((r) => r.id);
  const seed = stemReady
    .filter((r) => !skip.has(r.id))
    .map((r) => {
      const o = overrides[r.id];
      const accepted = acceptedAnswers(r).map((list) => list.filter((a) => !o || a !== o.dropAccepted));
      const reRead = !!o || Object.hasOwn(guards, r.id);
      return {
        question_id: r.id,
        accepted,
        required: 1,
        model_answer: String(o?.model_answer ?? r.canonical_model_answer ?? "").trim(),
        key_points: unionKeyPoints(r),
        guard_answer: guards[r.id]?.answer ?? null,
        stem_md5: stems ? stemMd5(guards[r.id]?.question ?? stems.get(r.id) ?? "") : null,
        source: reRead ? RE_READ_SOURCE : SOURCE,
        reviewed_by: reRead ? RE_READ_BY : REVIEWED_BY,
        reviewed_at: reRead ? RE_READ_AT : REVIEWED_AT,
      };
    })
    .sort((a, b) => a.question_id - b.question_id);
  for (const s of seed) {
    if (!Number.isInteger(s.question_id) || s.question_id <= 0) throw new Error(`bad id ${s.question_id}`);
    if (!s.model_answer) throw new Error(`row ${s.question_id}: empty canonical_model_answer`);
    if ([s.model_answer, ...s.accepted.flat(), ...s.key_points].some((t) => COMMENTARY.test(t))) throw new Error(`row ${s.question_id}: model answer, accepted wording or key point carries commentary or an exam date`);
    if (stems && !stems.has(s.question_id) && !guards[s.question_id]?.question) throw new Error(`row ${s.question_id}: no reviewed stem`);
    if (s.accepted[0].length === 0) throw new Error(`row ${s.question_id}: no accepted wording`);
  }
  return {
    seed,
    counts: { rows: rows.length, twoRead: twoRead.length, stemReady: stemReady.length, keyFixPresent, emitted: seed.length },
  };
}

function dollar(text) {
  if (text.includes(TAG)) throw new Error("content contains the dollar-quote tag");
  return `${TAG}${text}${TAG}`;
}

function lit(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/** The condition a seeded row needs on its question: active, plus the fixed answer for key-fix rows. */
function questionGuard(s) {
  if (!s.stem_md5) throw new Error(`row ${s.question_id}: no stem guard`);
  return `SELECT 1 FROM public.questions WHERE id = ${s.question_id} AND is_active AND exam_type = 'kenntnispruefung' AND md5(question) = '${s.stem_md5}'${s.guard_answer ? ` AND answer = ${dollar(s.guard_answer)}` : ""}`;
}

export function renderSeed(pool, poolSha256, stems, rowsSha256 = "n/a") {
  const { seed, counts } = buildSeedRows(pool, EXCLUDED_KEY_FIX, KEY_FIX_GUARDS, MODEL_ANSWER_OVERRIDES, stems);
  const ids = seed.map((s) => s.question_id);
  const idList = ids.join(", ");
  const guarded = seed.filter((s) => s.guard_answer);
  const provenance = `-- pool.json file sha256: ${poolSha256} (rows_sha256 field: ${pool.rows_sha256 ?? "n/a"}); stems from rows.json sha256: ${rowsSha256}`;
  const generated = "-- GENERATED by scripts/content/kaf/build-seed.mjs; do not edit by hand.";
  const header = [
    "-- a24 KAF seed: DATA ARTIFACT, not a migration. track-A applies it once, after",
    "-- supabase/migrations/20261223090000_a24_kaf_items.sql and the a-kaf-ready key fixes, on a release GO.",
    generated,
    provenance,
    `-- pool rows ${counts.rows}, two-read pass ${counts.twoRead}, stem_fix_needed false ${counts.stemReady},`,
    `-- held out (live MC key defect plus a needed stem fix): ${EXCLUDED_KEY_FIX.join(", ")},`,
    `-- key fix required before insert and activation: ${guarded.map((s) => s.question_id).join(", ") || "none"},`,
    `-- model answer corrected after the triage (two reads 2026-10-14): ${Object.keys(MODEL_ANSWER_OVERRIDES).join(", ")},`,
    `-- emitted rows: ${counts.emitted}. Every row is inserted INACTIVE (is_active = false):`,
    "-- the learner routes serve only active rows, so nothing is visible until kaf-activate.sql runs.",
    "-- accepted = kafAcceptedAnswers (stored wording only when both reads confirm it), required = 1,",
    "-- model_answer = canonical_model_answer, key_points = union of both reads.",
    "-- Every insert (and activation) needs the question active in the Kenntnisprüfung bank with",
    "-- md5(question) equal to the stem the reads saw (for a key-fix row: the fixed stem and answer);",
    "-- otherwise the row is skipped and the reports list it. Reruns change nothing.",
    "-- Dry run: kaf-seed.dry-run.sql. Report: kaf-seed.verify.sql. Rollback: kaf-seed.rollback.sql.",
  ];
  const inserts = seed.map((s) => [
    "INSERT INTO public.kaf_items (question_id, accepted, required, model_answer, key_points, source, reviewed_by, reviewed_at, is_active)",
    `SELECT ${s.question_id}, ${dollar(JSON.stringify(s.accepted))}::jsonb, ${s.required}, ${dollar(s.model_answer)}, ${dollar(JSON.stringify(s.key_points))}::jsonb,`,
    `       ${lit(s.source)}, ${lit(s.reviewed_by)}, '${s.reviewed_at}'::timestamptz, false`,
    `WHERE EXISTS (${questionGuard(s)})`,
    "ON CONFLICT (question_id) DO NOTHING;",
  ].join("\n"));
  const report = [
    "SELECT count(*) FILTER (WHERE k.question_id IS NOT NULL) AS seeded,",
    "       count(*) FILTER (WHERE k.is_active) AS active,",
    "       count(*) FILTER (WHERE k.question_id IS NULL) AS not_seeded,",
    "       string_agg(s.id::text, ',' ORDER BY s.id) FILTER (WHERE k.question_id IS NULL) AS not_seeded_ids",
    `FROM unnest(ARRAY[${idList}]::int[]) AS s(id)`,
    "LEFT JOIN public.kaf_items k ON k.question_id = s.id;",
  ].join("\n");
  const body = inserts.join("\n\n");
  const seedSql = [...header, "", "BEGIN;", "", body, "", "COMMIT;", ""].join("\n");
  const dryRunSql = [
    "-- Dry run of kaf-seed.sql: the same inserts inside one transaction, a report, then ROLLBACK.",
    "-- Nothing persists. Expected before the real seed: seeded = rows whose question passes its guard, active = 0.",
    generated,
    provenance,
    "BEGIN;",
    "",
    body,
    "",
    report,
    "",
    "ROLLBACK;",
    "",
  ].join("\n");
  const verifySql = [
    "-- Read-only report for the KAF seed: per seeded id, whether the row exists, is active, its question is live,",
    "-- and the question still shows the reviewed stem (and, for a key-fix row, the fixed answer).",
    generated,
    "SELECT s.id, k.question_id IS NOT NULL AS seeded, coalesce(k.is_active, false) AS active,",
    "       EXISTS (SELECT 1 FROM public.questions q WHERE q.id = s.id AND q.is_active AND q.exam_type = 'kenntnispruefung') AS question_live,",
    `       CASE s.id ${seed.map((g) => `WHEN ${g.question_id} THEN EXISTS (${questionGuard(g)})`).join(" ")} END AS reviewed_content_live`,
    `FROM unnest(ARRAY[${idList}]::int[]) AS s(id)`,
    "LEFT JOIN public.kaf_items k ON k.question_id = s.id",
    "ORDER BY s.id;",
    "",
    report,
    "",
  ].join("\n");
  const activateSql = [
    "-- Activates exactly the seeded KAF rows (a-kaf-ready, 5 Nov), each only while its question still shows",
    "-- the reviewed stem (key-fix rows: and the fixed answer).",
    "-- Rollback: kaf-deactivate.sql.",
    generated,
    "BEGIN;",
    "UPDATE public.kaf_items k SET is_active = true",
    `WHERE k.question_id IN (${idList}) AND NOT k.is_active`,
    "  AND CASE k.question_id",
    ...seed.map((g) => `    WHEN ${g.question_id} THEN EXISTS (${questionGuard(g)})`),
    "    ELSE false END",
    ";",
    report,
    "COMMIT;",
    "",
  ].join("\n");
  const deactivateSql = [
    "-- Rollback of kaf-activate.sql: the seeded KAF rows go back to inactive (the pool route then reports 0 items).",
    generated,
    "BEGIN;",
    `UPDATE public.kaf_items SET is_active = false WHERE question_id IN (${idList}) AND is_active;`,
    report,
    "COMMIT;",
    "",
  ].join("\n");
  const rollbackSql = [
    "-- Rollback for scripts/sql/track-a/a24-exam/kaf-seed.sql (a24 KAF seed data artifact).",
    generated,
    provenance,
    `-- Deletes exactly the ${ids.length} seeded ids and nothing else.`,
    "BEGIN;",
    `DELETE FROM public.kaf_items WHERE question_id IN (${idList});`,
    "COMMIT;",
    "",
  ].join("\n");
  return { seedSql, rollbackSql, dryRunSql, verifySql, activateSql, deactivateSql, counts, ids };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const poolPath = args.find((a) => !a.startsWith("--")) ?? DEFAULT_POOL_PATH;
  const bytes = readFileSync(poolPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const rowsPath = path.join(path.dirname(poolPath), "rows.json");
  const rowsBytes = readFileSync(rowsPath);
  const stems = new Map(JSON.parse(rowsBytes.toString("utf8")).map((r) => [r.id, r.question]));
  const out = renderSeed(JSON.parse(bytes.toString("utf8")), sha, stems, createHash("sha256").update(rowsBytes).digest("hex"));
  const { counts } = out;
  if (check) {
    const stale = Object.entries(ARTIFACTS).filter(([key, file]) => {
      try { return readFileSync(path.join(DIR, file), "utf8") !== out[key]; } catch { return true; }
    }).map(([, file]) => file);
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}; rerun build-seed.mjs`); process.exit(1); }
    console.log(`kaf seed artifacts up to date (${counts.emitted} rows, all inserted inactive)`);
  } else {
    for (const [key, file] of Object.entries(ARTIFACTS)) writeFileSync(path.join(DIR, file), out[key]);
    console.log(`wrote ${counts.emitted} rows (pool ${counts.rows}, two-read ${counts.twoRead}, stem-ready ${counts.stemReady}, key-fix guarded ${counts.keyFixPresent.join(",") || "none"})`);
  }
}
