import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkBatch, PACKAGE, reviewHash } from "../../../scripts/content/gate/check.mjs";
import { emitBatch, literal } from "../../../scripts/content/gate/emit.mjs";
import { buildBatches, parseIdMap } from "../../../scripts/content/gm/build-batches.mjs";

// a44 proof on a throwaway PostgreSQL 16 cluster: the live questions shape
// with the applied 202611 stack, then the Gerichtsmedizin seed artifact, the
// b20 activation gate on the real reviewed rows in batches of at most 50
// (emitted through the track-B guard, applied and rolled back), and the seed
// rollback with its refusals. Opt-in only (test:db:a44); it starts its own
// cluster on a private socket and never reads a connection URL.
const databaseEnabled = process.env.A44_DATABASE_TESTS === "1";
const PORT = process.env.A44_PG_PORT ?? "55457";
const reportRoot = process.env.TRACK_B_REPORT_ROOT ?? "./reports/track-b-2026-10-11";
const guardPath = join(reportRoot, "track-b-guard.mjs");
const read = (path: string) => readFileSync(resolve(path), "utf8");
const dir = "scripts/sql/track-a/a44-gm-delivery";
const seed = read(`${dir}/gm-seed.sql`);
const seedRollback = read(`${dir}/gm-seed.rollback.sql`);
const verify = read(`${dir}/gm-seed.verify.sql`);
const receipts = JSON.parse(read("reports/master-plan-2026-10-11/gm-delivery/receipts.json")) as {
  rows: { anki_note_id: number; author_key: string; held?: string; reviews: { reviewed_content_sha256: string }[] }[];
};
const migrationNames = readdirSync(resolve("supabase/migrations")).filter((n) => /^202611\d{8}_.+\.sql$/.test(n)).sort();
const actor = { id: "00000000-0000-4000-8000-000000000044", email: "track-a-proof@example.invalid" };
const SRC = "TRACK_B_AUTHORED_GERICHTSMEDIZIN_2026_10";

let pgBin = "";
let cluster = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PG"))), LC_ALL: "C", LANG: "C", TZ: "UTC" };
function discoverPgBin() {
  if (process.env.A44_PG_BIN) return resolve(process.env.A44_PG_BIN);
  for (const d of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((n) => existsSync(join(d, n)))) return d;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a44. Set A44_PG_BIN.");
}
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
// Through a file, not stdin: psql stops reading at the first error, and a
// large artifact would otherwise end in EPIPE instead of the real message.
function sql(text: string, allowFailure = false) {
  const file = join(cluster, "input.sql");
  writeFileSync(file, text);
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-f", file]);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const fails = (text: string, pattern: RegExp) => {
  const result = sql(text, true);
  expect(result.status, result.stdout).not.toBe(0);
  expect(result.stderr).toMatch(pattern);
};
const count = (where: string) => Number(rows(`SELECT count(*) FROM public.questions WHERE ${where};`));
type Row = { id: number; is_active: boolean; anki_note_id: number | null; [k: string]: unknown };
const liveRows = (): Row[] => rows("SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]') FROM public.questions q;")
  .split("\n").filter(Boolean).flatMap((line) => JSON.parse(line) as Row[]);

describe.skipIf(!databaseEnabled)("a44 Gerichtsmedizin seed and activation on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a44-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(read("scripts/sql/track-b/a05-data-proof/fixture.sql"));
    sql(read("supabase/migrations/20260703180000_exam_reminders.sql"));
    sql(read(`${dir}/fixture.sql`));
    for (const name of migrationNames) sql(read(`supabase/migrations/${name}`));
    sql(`INSERT INTO public.users (id, email) VALUES ('00000000-0000-4000-8000-000000000001', 'learner@example.invalid');
      INSERT INTO public.questions (topic, question, answer, exam_type, is_active, source_file, tags)
      VALUES ('Pharmakologie', 'Welche Dosis gilt für das Fixture-Präparat X im Lokaltest?', 'Fixture-Antwort', 'pharma', true, 'PHARMA_REZEPTIERKUNDE_2026', '{}');`);
  }, 180_000);
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("the stack includes the applied 202611 migrations and the activation ledger", () => {
    expect(migrationNames).toContain("20261112090000_question_activation_log.sql");
    expect(rows("SELECT to_regclass('public.question_activation_log') IS NOT NULL;")).toBe("t");
  });

  it("refuses a stem that already exists in the bank and inserts nothing", () => {
    const contentHash = seed.match(/content_hash = ANY\(ARRAY\[E'([a-f0-9]{64})'/)?.[1];
    expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
    sql(`INSERT INTO public.questions (topic, question, answer, exam_type, is_active, content_hash) VALUES ('X', 'dup', 'a', 'pharma', false, '${contentHash}');`);
    fails(seed, /duplicate content_hash/);
    expect(count(`source_file = '${SRC}'`)).toBe(0);
    sql(`DELETE FROM public.questions WHERE question = 'dup';`);
    sql(`INSERT INTO public.questions (topic, question, answer, exam_type, anki_note_id, source_file) VALUES ('X', 'other', 'a', 'pharma', ${receipts.rows[5].anki_note_id}, 'SOMEONE_ELSE');`);
    fails(seed, /reserved anki_note_id belongs to another source/);
    sql(`DELETE FROM public.questions WHERE question = 'other';`);
  });

  it("seeds 128 inactive rows once; a rerun inserts nothing", () => {
    sql(seed);
    sql(seed);
    expect(count(`source_file = '${SRC}'`)).toBe(128);
    expect(count(`source_file = '${SRC}' AND is_active`)).toBe(0);
    expect(count(`source_file = '${SRC}' AND exam_type = 'pharma' AND topic = 'Gerichtsmedizin' AND 'field:gerichtsmedizin' = ANY(tags)`)).toBe(128);
    expect(count(`source_file = '${SRC}' AND key_revision = 0 AND id > 114657`)).toBe(128);
    expect(count("is_active AND topic = 'Pharmakologie'")).toBe(1);
  });

  it("the rows read back hash exactly to both reviewed receipts (jsonb key order included)", () => {
    const byAnki = new Map(liveRows().filter((r) => r.anki_note_id).map((r) => [Number(r.anki_note_id), r]));
    for (const r of receipts.rows) {
      const live = byAnki.get(r.anki_note_id);
      expect(live, String(r.anki_note_id)).toBeTruthy();
      for (const review of r.reviews) expect(reviewHash(live)).toBe(review.reviewed_content_sha256);
    }
  });

  it("a seed rerun refuses rows that drifted from the reviewed content", () => {
    const anki = receipts.rows[3].anki_note_id;
    sql(`UPDATE public.questions SET answer = answer || ' (bearbeitet)' WHERE anki_note_id = ${anki};`);
    fails(seed, /existing rows differ from the reviewed set/);
    sql(`UPDATE public.questions SET answer = regexp_replace(answer, ' \\(bearbeitet\\)$', '') WHERE anki_note_id = ${anki};`);
    // An edited explanation or option is drift too, not only the key.
    sql(`UPDATE public.questions SET explanation = explanation || ' x' WHERE anki_note_id = ${anki};`);
    fails(seed, /existing rows differ from the reviewed set/);
    sql(`UPDATE public.questions SET explanation = regexp_replace(explanation, ' x$', '') WHERE anki_note_id = ${anki};`);
    sql(seed);
  });

  it("activates through the b20 gate in batches of 10, idempotently, then rolls back", async () => {
    const { checkSql } = await import(/* @vite-ignore */ pathToFileURL(guardPath).href);
    const policy = JSON.parse(read(join(reportRoot, "FREEZE.json")));
    const batches = buildBatches(receipts, parseIdMap(rows(verify)), actor);
    expect(batches.map((b) => b.entries.length)).toEqual([...Array(12).fill(10), 5]);
    const held = receipts.rows.filter((r) => r.held).map((r) => r.anki_note_id);
    expect(held).toHaveLength(3);
    const emitted: { apply: string; rollback: string; verify: string; verifyBefore: string }[] = [];
    for (const batch of batches) {
      const corpus = liveRows();
      const candidates = batch.entries.map((e) => corpus.find((r) => r.id === e.id)!);
      const results = checkBatch(candidates, batch.entries, corpus, policy);
      expect(results.filter((r: { pass: boolean }) => !r.pass).map((r: { id: number; errors: string[] }) => `${r.id}:${r.errors}`)).toEqual([]);
      const files = emitBatch(batch, candidates, results, guardPath);
      for (const text of [files.apply, files.rollback]) expect(checkSql({ text, packageId: PACKAGE, freeze: policy }).violations).toEqual([]);
      sql(files.apply);
      sql(files.apply);
      expect(rows(files.verify).split("\n").every((line) => /\|t\|t$/.test(line))).toBe(true);
      emitted.push(files);
    }
    expect(count(`source_file = '${SRC}' AND is_active`)).toBe(125);
    expect(count(`anki_note_id IN (${held.join(", ")}) AND is_active`)).toBe(0);
    // While any seeded row is active the seed rollback refuses.
    fails(seedRollback, /roll back its activation batch first/);
    for (const files of [...emitted].reverse()) { sql(files.rollback); sql(files.rollback); }
    expect(count(`source_file = '${SRC}' AND is_active`)).toBe(0);
    for (const files of emitted) expect(rows(files.verifyBefore).split("\n").every((line) => /\|t$/.test(line))).toBe(true);
  }, 300_000);

  it("the seed rollback refuses learner references, then deletes exactly the seeded rows", () => {
    const id = rows(`SELECT id FROM public.questions WHERE anki_note_id = ${receipts.rows[0].anki_note_id};`);
    sql(`INSERT INTO public.answer_history (user_id, question_id) VALUES ('00000000-0000-4000-8000-000000000001', ${id});`);
    fails(seedRollback, /answer_history references a seeded row/);
    sql("DELETE FROM public.answer_history;");
    sql(`INSERT INTO public.explanation_ratings (user_id, question_id, rating) VALUES ('00000000-0000-4000-8000-000000000001', ${id}, 1);`);
    fails(seedRollback, /explanation_ratings references a seeded row/);
    sql("DELETE FROM public.explanation_ratings;");
    sql(seedRollback);
    sql(seedRollback);
    expect(count(`source_file = '${SRC}'`)).toBe(0);
    expect(count("is_active AND topic = 'Pharmakologie'")).toBe(1);
  });

  // Reviewer P2-3: time an emitted apply against the live-size bank (track-B's
  // read-only 2026-10-11 corpus, 11,395 rows) under the gate's own 30 s
  // statement timeout. Opt-in: A44_LIVE_CORPUS=<path to live-corpus.json>,
  // A44_TIME_SIZE=<rows per batch, default 1>. Before a-b20-perf (per-row
  // recheck) 1 row took 25.7 s and 10 or 50 rows hit the timeout. The recheck
  // is now set-based (one pass over the bank per batch), so the apply must
  // finish inside the unchanged 30 s bound, and the rollback must restore it.
  it.skipIf(!process.env.A44_LIVE_CORPUS)("an apply on a bank of production size finishes inside the gate timeout and rolls back", async () => {
    const corpus = JSON.parse(readFileSync(process.env.A44_LIVE_CORPUS!, "utf8")).rows as Record<string, string | boolean | number | null>[];
    const text = (v: unknown, fallback = "") => (typeof v === "string" && v !== "None" ? v : fallback);
    const values = corpus.map((r) => `(${Number(r.id)}, ${literal(text(r.topic, "x"))}, ${literal(text(r.question))}, ${literal(text(r.answer))}, ${literal(text(r.exam_type, "kenntnispruefung"))}, ${r.is_active === true || r.is_active === "True"}, ${text(r.source_file) ? literal(text(r.source_file)) : "NULL"}, ${text(r.content_hash) ? literal(text(r.content_hash)) : "NULL"})`);
    for (let i = 0; i < values.length; i += 2000) {
      sql(`INSERT INTO public.questions (id, topic, question, answer, exam_type, is_active, source_file, content_hash) VALUES ${values.slice(i, i + 2000).join(",\n")};`);
    }
    expect(count("is_active")).toBeGreaterThan(10_000);
    sql(seed);
    const { checkSql } = await import(/* @vite-ignore */ pathToFileURL(guardPath).href);
    const policy = JSON.parse(read(join(reportRoot, "FREEZE.json")));
    const [batch] = buildBatches(receipts, parseIdMap(rows(verify)), actor, "a44-gm", Number(process.env.A44_TIME_SIZE ?? 1));
    const live = liveRows();
    const candidates = batch.entries.map((e) => live.find((r) => r.id === e.id)!);
    const results = checkBatch(candidates, batch.entries, live, policy);
    expect(results.filter((r: { pass: boolean }) => !r.pass).map((r: { id: number; errors: string[] }) => `${r.id}:${r.errors}`)).toEqual([]);
    const files = emitBatch(batch, candidates, results, guardPath);
    expect(checkSql({ text: files.apply, packageId: PACKAGE, freeze: policy }).violations).toEqual([]);
    const started = Date.now();
    const applied = sql(files.apply, true);
    const ms = Date.now() - started;
    console.log(`a44 live-size apply of ${batch.entries.length} rows: ${applied.status === 0 ? "finished" : "aborted"} after ${ms} ms`);
    expect(applied.status, applied.stderr).toBe(0);
    expect(count(`source_file = '${SRC}' AND is_active`)).toBe(batch.entries.length);
    sql(files.rollback);
    expect(count(`source_file = '${SRC}' AND is_active`)).toBe(0);
    sql(seedRollback);
  }, 600_000);
});
