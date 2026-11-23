import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain ESM script without types
import { buildArtifacts } from "../../../scripts/content/de-kp/build-seed.mjs";

// de_kp_cases extension proof on a throwaway PostgreSQL 16 cluster (npm run test:db:sim-case-ext):
// the unapplied 20270119 changeset on top of the 20270117 tables, its constraints, the S0 seed before and after, down.sql.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.SIM_CASE_EXT_DATABASE_TESTS === "1";
const PORT = "55482";
let pgBin = "";
function discoverPgBin() {
  if (process.env.SIM_CASE_EXT_PG_BIN) return resolve(process.env.SIM_CASE_EXT_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:sim-case-ext. Set SIM_CASE_EXT_PG_BIN.");
}
const read = (p: string) => readFileSync(resolve(p), "utf8");
const base = read("supabase/migrations/20270117090000_a_de_kp_cases.sql");
const migration = read("supabase/migrations/20270119090000_a_sim_case_ext.sql");
const fixture = read("scripts/sql/track-a/de-kp/fixture.sql");
const down = read("scripts/sql/track-a/a-sim-case-ext/down.sql");
const seed = read("scripts/sql/track-a/de-kp/seed.sql");

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
const CASES = resolve("content/de-kp/cases");
const first = () => JSON.parse(readFileSync(join(CASES, readdirSync(CASES).filter((f) => f.endsWith(".json")).sort()[0]), "utf8"));
const proto = { kind: "exam_protocol", ref: "Protokoll", land: "Bayern", exam_date: "2026-10" };
const insert = (slug: string, extra: Record<string, string>) => {
  const c = first();
  const cols: Record<string, string> = {
    slug: `'${slug}'`, subject: `'innere'`, taxonomy_code: `'IM-KARD-01'`, title_de: `'t'`, title_en: `'t'`, vignette_de: `'v'`,
    history_checklist: `'[]'::jsonb`, patient_answers_de: `'{}'::jsonb`, findings: `'[]'::jsonb`, differentials: `'{}'::jsonb`, bericht_rubric: `'[]'::jsonb`,
    model_bericht_de: `'m'`, sources: `'${JSON.stringify(c.sources)}'::jsonb`, provenance: `'drafted_from_open_refs'`, reviewed_by: `'a,b'`, reviewed_at: `now()`, is_active: "false", ...extra,
  };
  return `INSERT INTO public.de_kp_cases (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")});`;
};

describe("builder output for an S0 case does not need the S3 columns", () => {
  it("the checked-in seed names no S3 column", () => expect(seed).not.toMatch(/patient_persona_de|examiner_notes/));
  it("a bank with an extended case does", () => {
    const art = buildArtifacts([{ ...first(), patient_persona_de: "x".repeat(50) }]);
    expect(art["seed.sql"]).toMatch(/patient_persona_de/);
  });
});

describe.skipIf(!databaseEnabled)("de_kp_cases extension on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "sim-case-ext-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(base);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("the S0 seed loads before the changeset and keeps loading after it, rows unchanged", () => {
    sql(seed);
    const before = rows(`SELECT count(*), md5(string_agg(slug || provenance || sources::text, ',' ORDER BY slug)) FROM public.de_kp_cases;`);
    expect(before.startsWith("30|")).toBe(true);
    fails(insert("early-protocol", { provenance: `'protocol_informed'` }), /de_kp_cases_provenance/);
    sql(migration);
    sql(migration);
    expect(rows(`SELECT count(*), md5(string_agg(slug || provenance || sources::text, ',' ORDER BY slug)) FROM public.de_kp_cases;`)).toBe(before);
    expect(rows(`SELECT count(*) FROM public.de_kp_cases WHERE patient_persona_de IS NOT NULL OR examiner_notes IS NOT NULL;`)).toBe("0");
    sql(seed); // idempotent (on conflict do nothing)
    expect(rows(`SELECT count(*) FROM public.de_kp_cases;`)).toBe("30");
  });

  it("stores persona, notes and a protocol case; enforces the shape rules", () => {
    sql(insert("ext-ok", { patient_persona_de: `'${"p".repeat(60)}'`, examiner_notes: `'[{"position":1,"may_probe_de":["x"]}]'::jsonb` }));
    const src = JSON.stringify([...first().sources, proto]);
    sql(insert("ext-proto", { provenance: `'protocol_informed'`, sources: `'${src}'::jsonb` }));
    fails(insert("ext-nosrc", { provenance: `'protocol_informed'` }), /de_kp_cases_protocol_source/);
    fails(insert("ext-short", { patient_persona_de: `'kurz'` }), /de_kp_cases_persona_length/);
    fails(insert("ext-long", { patient_persona_de: `'${"p".repeat(1501)}'` }), /de_kp_cases_persona_length/);
    fails(insert("ext-notes", { examiner_notes: `'{"a":1}'::jsonb` }), /de_kp_cases_examiner_notes_shape/);
    fails(insert("ext-prov", { provenance: `'recalled'` }), /de_kp_cases_provenance/);
  });

  it("the service role keeps its access and anon stays locked out", () => {
    expect(rows(`SELECT has_column_privilege('service_role', 'public.de_kp_cases', 'patient_persona_de', 'SELECT');`)).toBe("t");
    expect(rows(`SELECT has_column_privilege('anon', 'public.de_kp_cases', 'patient_persona_de', 'SELECT');`)).toBe("f");
  });

  it("down.sql refuses while the extension is in use, then restores the S0 shape and the migration re-applies", () => {
    fails(down, /rollback refused/);
    sql(`DELETE FROM public.de_kp_cases WHERE slug LIKE 'ext-%';`);
    sql(down);
    expect(rows(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'de_kp_cases' AND column_name IN ('patient_persona_de','examiner_notes');`)).toBe("0");
    fails(insert("late-protocol", { provenance: `'protocol_informed'` }), /de_kp_cases_provenance/);
    expect(rows(`SELECT count(*) FROM public.de_kp_cases;`)).toBe("30");
    sql(migration);
    expect(rows(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'de_kp_cases' AND column_name IN ('patient_persona_de','examiner_notes');`)).toBe("2");
  });
});
