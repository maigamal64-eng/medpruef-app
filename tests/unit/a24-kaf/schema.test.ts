import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a24 proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261223090000 changeset (kaf_items), its shape constraints and privileges,
// the kaf-seed data artifact with its rollback, and down.sql. Opt-in only
// (test:db:a24); never reads a connection URL or production env.
const databaseEnabled = process.env.A24_DATABASE_TESTS === "1";
const PORT = "55451";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A24_PG_BIN) return resolve(process.env.A24_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a24. Set A24_PG_BIN.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261223090000_a24_kaf_items.sql");
const fixture = read("scripts/sql/track-a/a24-exam/fixture.sql");
const rollback = read("scripts/sql/track-a/a24-exam/down.sql");
const seed = read("scripts/sql/track-a/a24-exam/kaf-seed.sql");
const seedRollback = read("scripts/sql/track-a/a24-exam/kaf-seed.rollback.sql");
const seedIds = [...seed.matchAll(/WHERE id = (\d+) AND is_active/g)].map((m) => Number(m[1]));

let cluster = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C", TZ: "UTC" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const fails = (text: string, pattern: RegExp) => {
  const result = sql(text, true);
  expect(result.status, result.stdout).not.toBe(0);
  expect(result.stderr).toMatch(pattern);
};
const insertItem = (id: number, accepted: string, required: number, extra = "") =>
  `INSERT INTO public.kaf_items (question_id, accepted, required, model_answer, source, reviewed_by, reviewed_at${extra ? ", key_points" : ""})
   VALUES (${id}, '${accepted}'::jsonb, ${required}, 'Antwort', 'test', 'test', now()${extra ? `, ${extra}` : ""});`;

describe.skipIf(!databaseEnabled)("a24 kaf_items on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a24-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(migration);
    // Every seeded id exists and is active, except the first one (inactive) and
    // the second one (missing), so the EXISTS guard is exercised both ways.
    const values = seedIds.slice(2).map((id) => `(${id}, 'Innere Medizin', 'kenntnispruefung', true)`).join(", ");
    sql(`INSERT INTO public.questions (id, topic, exam_type, is_active) VALUES
         (${seedIds[0]}, 'Innere Medizin', 'kenntnispruefung', false), ${values},
         (1, 'HNO', 'kenntnispruefung', true), (2, 'HNO', 'kenntnispruefung', true);`);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("the seed artifact carries 45 ids", () => {
    expect(seedIds).toHaveLength(45);
  });

  it("applies with RLS on, no policies, and is idempotent", () => {
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.kaf_items'::regclass;`)).toBe("t");
    expect(rows(`SELECT count(*) FROM pg_policies WHERE tablename = 'kaf_items';`)).toBe("0");
    sql(migration);
  });

  it("accepts a valid row with one to three required answers", () => {
    sql(insertItem(1, '[["Otitis media","Mittelohrentzündung"]]', 1));
    sql(insertItem(2, '[["a"],["b"],["c"]]', 3, `'["x"]'::jsonb`));
    expect(rows(`SELECT required || ':' || jsonb_array_length(accepted) || ':' || key_points::text FROM public.kaf_items WHERE question_id = 1;`)).toBe("1:1:[]");
    expect(rows(`SELECT is_active FROM public.kaf_items WHERE question_id = 2;`)).toBe("t");
    sql(`DELETE FROM public.kaf_items WHERE question_id IN (1, 2);`);
  });

  it("rejects bad shapes", () => {
    fails(insertItem(1, '[["a"],["b"]]', 1), /kaf_items_required_matches/);
    fails(insertItem(1, "[]", 1), /kaf_items_accepted_shape/);
    fails(insertItem(1, '[["a"],["b"],["c"],["d"]]', 4), /kaf_items_accepted_shape|kaf_items_required_range/);
    fails(insertItem(1, '{"a": 1}', 1), /kaf_items_accepted_shape|kaf_items_required_matches/);
    fails(insertItem(1, '"text"', 1), /kaf_items_accepted_shape|kaf_items_required_matches/);
    fails(insertItem(1, '[["a"]]', 0), /kaf_items_required_range|kaf_items_required_matches/);
    fails(insertItem(1, '[["a"]]', 1, `'{"x":1}'::jsonb`), /kaf_items_key_points_shape/);
    fails(`INSERT INTO public.kaf_items (question_id, accepted, required, model_answer, source, reviewed_by, reviewed_at)
           VALUES (1, '[["a"]]', 1, '   ', 'test', 'test', now());`, /kaf_items_model_answer_present/);
    fails(`INSERT INTO public.kaf_items (question_id, accepted, required, model_answer, source, reviewed_by)
           VALUES (1, '[["a"]]', 1, 'a', 'test', 'test');`, /null value in column "reviewed_at"/);
    fails(insertItem(999999, '[["a"]]', 1), /kaf_items_question_id_fkey/);
    expect(rows(`SELECT count(*) FROM public.kaf_items;`)).toBe("0");
  });

  it("anon and authenticated cannot read or write; service_role can", () => {
    for (const role of ["anon", "authenticated"]) {
      fails(`SET ROLE ${role}; SELECT count(*) FROM public.kaf_items;`, /permission denied/);
      fails(`SET ROLE ${role}; ${insertItem(1, '[["a"]]', 1)}`, /permission denied/);
    }
    expect(rows(`SELECT has_table_privilege('anon', 'public.kaf_items', 'SELECT')::text || has_table_privilege('authenticated', 'public.kaf_items', 'SELECT')::text;`)).toBe("falsefalse");
    sql(`SET ROLE service_role; ${insertItem(1, '[["a"]]', 1)} UPDATE public.kaf_items SET is_active = false WHERE question_id = 1;`);
    expect(rows(`SET ROLE service_role; SELECT count(*) FROM public.kaf_items WHERE NOT is_active;`)).toBe("1");
    sql(`SET ROLE service_role; DELETE FROM public.kaf_items WHERE question_id = 1;`);
  });

  it("deleting a question cascades to its kaf row", () => {
    sql(insertItem(2, '[["a"]]', 1));
    sql(`DELETE FROM public.questions WHERE id = 2;`);
    expect(rows(`SELECT count(*) FROM public.kaf_items WHERE question_id = 2;`)).toBe("0");
  });

  it("the seed skips inactive and missing questions, reruns cleanly, and its rollback removes exactly its ids", () => {
    sql(insertItem(1, '[["keep"]]', 1));
    sql(seed);
    expect(rows(`SELECT count(*) FROM public.kaf_items WHERE question_id <> 1;`)).toBe("43");
    expect(rows(`SELECT count(*) FROM public.kaf_items WHERE question_id IN (${seedIds[0]}, ${seedIds[1]});`)).toBe("0");
    expect(rows(`SELECT count(*) FROM public.kaf_items WHERE question_id IN (63854, 69784, 71616);`)).toBe("0");
    expect(rows(`SELECT bool_and(required = 1 AND jsonb_array_length(accepted) = 1 AND reviewed_by = 'medic-read1+read2' AND source = 'kaf-triage 2026-10-12 two Medic reads') FROM public.kaf_items WHERE question_id <> 1;`)).toBe("t");
    sql(seed);
    expect(rows(`SELECT count(*) FROM public.kaf_items;`)).toBe("44");
    sql(seedRollback);
    expect(rows(`SELECT string_agg(question_id::text, ',') FROM public.kaf_items;`)).toBe("1");
  });

  it("down.sql removes the table and can rerun", () => {
    sql(rollback);
    expect(rows(`SELECT to_regclass('public.kaf_items') IS NULL;`)).toBe("t");
    sql(rollback);
    sql(migration);
    expect(rows(`SELECT to_regclass('public.kaf_items') IS NOT NULL;`)).toBe("t");
    sql(rollback);
  });
});
