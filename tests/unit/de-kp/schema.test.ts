import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildArtifacts, validateCase, taxonomyCodes, DEFAULT_TAXONOMY } from "../../../scripts/content/de-kp/build-seed.mjs";

// KP-DE schema proof on a throwaway PostgreSQL 16 cluster (acceptance test 6): the unapplied
// 20270117090000 changeset, its shape constraints, privileges, the builder's seed artifacts and
// down.sql. Opt-in only (test:db:de-kp); never reads a connection URL or production env.
const databaseEnabled = process.env.DE_KP_DATABASE_TESTS === "1";
const PORT = "55452";
let pgBin = "";
function discoverPgBin() {
  if (process.env.DE_KP_PG_BIN) return resolve(process.env.DE_KP_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:de-kp. Set DE_KP_PG_BIN.");
}
const read = (p: string) => readFileSync(resolve(p), "utf8");
const migration = read("supabase/migrations/20270117090000_a_de_kp_cases.sql");
const fixture = read("scripts/sql/track-a/de-kp/fixture.sql");
const down = read("scripts/sql/track-a/de-kp/down.sql");

const domains = ["aktuelle_beschwerden", "vorerkrankungen", "medikation", "allergien", "sozial", "familie", "vegetativ", "noxen"];
const w = (n: number) => Array.from({ length: n }, (_, i) => `wort${i}`).join(" ");
function validCase(slug: string, isFree: boolean) {
  const hc = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, domain: domains[i % 8], point_de: `Punkt ${i}`, weight: 1 }));
  const rubric = ["anamnese", "diagnose", "prognose", "behandlungsplan", "epikrise"].flatMap((s) => [1, 2].map((n) => ({ id: `${s}${n}`, section: s, point_de: `Punkt ${s}`, weight: 1, critical: n === 1 && s === "behandlungsplan" })));
  const fu = Array.from({ length: 5 }, (_, i) => ({ position: i + 1, scope: i < 2 ? "cross" : "case", stem_de: `Frage ${i}?`, required: 1, accepted: [["Antwort"]], model_answer_de: "Antwort", key_points: [] }));
  return {
    slug, subject: "innere", taxonomy_code: "IM-KARD-01", title_de: "Brustschmerz am Abend", title_en: "Chest pain in the evening",
    vignette_de: w(100), history_checklist: hc, patient_answers_de: Object.fromEntries(hc.map((p) => [p.id, "Antwort"])),
    findings: [{ id: "f1", kind: "ekg", text_de: "EKG ohne ST-Hebung" }],
    differentials: { leading: [["Akutes Koronarsyndrom"]], others: [["Lungenembolie"], ["Aortendissektion"]] },
    bericht_rubric: rubric, model_bericht_de: w(300),
    sources: [{ kind: "awmf", ref: "Leitlinie", url: "https://register.awmf.org/" }],
    provenance: "drafted_from_open_refs", reviewed_by: ["read-a", "read-b"], reviewed_at: "2026-11-20T10:00:00Z", is_free: isFree, followups: fu,
  };
}
const cases = [validCase("fall-eins", true), validCase("fall-zwei", false)];
const art = buildArtifacts(cases);

let cluster = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C", TZ: "UTC" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false, user = "postgres") {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const fails = (text: string, pattern: RegExp) => {
  const result = sql(text, true);
  expect(result.status, result.stdout).not.toBe(0);
  expect(result.stderr).toMatch(pattern);
};
const caseRow = (slug: string, extra: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    slug: `'${slug}'`, subject: `'innere'`, taxonomy_code: `'IM-KARD-01'`, title_de: `'t'`, title_en: `'t'`, vignette_de: `'v'`,
    history_checklist: `'[]'::jsonb`, patient_answers_de: `'{}'::jsonb`, findings: `'[]'::jsonb`, differentials: `'{}'::jsonb`,
    bericht_rubric: `'[]'::jsonb`, model_bericht_de: `'m'`, sources: `'[]'::jsonb`, provenance: `'drafted_from_open_refs'`,
    reviewed_by: `'a,b'`, reviewed_at: `now()`, ...extra,
  };
  return `INSERT INTO public.de_kp_cases (${Object.keys(base).join(", ")}) VALUES (${Object.values(base).join(", ")});`;
};

describe("seed fixtures are valid for the builder", () => {
  it("validateCase accepts the proof cases", () => {
    const codes = taxonomyCodes(JSON.parse(readFileSync(DEFAULT_TAXONOMY, "utf8")));
    for (const c of cases) expect(validateCase(c, codes)).toEqual([]);
  });
});

describe.skipIf(!databaseEnabled)("KP-DE tables on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "dekp-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(migration);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("is idempotent and RLS is on with no policies on all three tables", () => {
    sql(migration);
    for (const t of ["de_kp_cases", "de_kp_followups", "de_kp_case_attempts"]) {
      expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass;`)).toBe("t");
      expect(rows(`SELECT count(*) FROM pg_policies WHERE tablename = '${t}';`)).toBe("0");
    }
  });

  it("anon and authenticated are denied, service_role can read and write", () => {
    for (const t of ["de_kp_cases", "de_kp_followups", "de_kp_case_attempts"]) {
      expect(rows(`SELECT has_table_privilege('anon', 'public.${t}', 'SELECT')::text || has_table_privilege('authenticated', 'public.${t}', 'SELECT')::text || has_table_privilege('anon', 'public.${t}', 'INSERT')::text;`)).toBe("falsefalsefalse");
      sql(`SET ROLE service_role; SELECT count(*) FROM public.${t};`);
      sql(`SET ROLE anon; SELECT count(*) FROM public.${t};`, true);
    }
    fails(`SET ROLE anon; SELECT 1 FROM public.de_kp_cases;`, /permission denied/);
    fails(`SET ROLE authenticated; SELECT 1 FROM public.de_kp_case_attempts;`, /permission denied/);
    fails(`SET ROLE authenticated; SELECT 1 FROM public.de_kp_followups;`, /permission denied/);
    sql(`SET ROLE service_role; ${caseRow("rls-probe")} DELETE FROM public.de_kp_cases WHERE slug = 'rls-probe';`);
  });

  it("case constraints reject a wrong key, subject, provenance and slug", () => {
    fails(caseRow("a1", { exam_key: `'kenntnispruefung'` }), /de_kp_cases_exam_key/);
    fails(caseRow("a2", { subject: `'hno'` }), /de_kp_cases_subject/);
    fails(caseRow("a3", { provenance: `'recalled'` }), /de_kp_cases_provenance/);
    fails(caseRow("Bad Slug"), /de_kp_cases_slug_shape/);
  });

  it("the seed is inserted inactive and idempotent, followups follow, one free case only", () => {
    sql(art["seed.sql"]);
    sql(art["seed.sql"]);
    expect(rows(`SELECT count(*) FROM public.de_kp_cases;`)).toBe("2");
    expect(rows(`SELECT count(*) FROM public.de_kp_cases WHERE is_active;`)).toBe("0");
    expect(rows(`SELECT count(*) FROM public.de_kp_followups;`)).toBe("10");
    expect(rows(`SELECT count(*) FROM public.de_kp_followups f JOIN public.de_kp_cases c ON c.id = f.case_id WHERE c.slug = 'fall-eins' AND f.scope = 'cross';`)).toBe("2");
    // a second free case cannot become active next to the first
    sql(`UPDATE public.de_kp_cases SET is_free = true WHERE slug = 'fall-zwei';`);
    fails(art["activate.sql"], /de_kp_cases_one_free_active/);
    sql(`UPDATE public.de_kp_cases SET is_free = false WHERE slug = 'fall-zwei';`);
    sql(art["activate.sql"]);
    expect(rows(`SELECT count(*) FROM public.de_kp_cases WHERE is_active;`)).toBe("2");
    sql(art["deactivate.sql"]);
    expect(rows(`SELECT count(*) FROM public.de_kp_cases WHERE is_active;`)).toBe("0");
  });

  it("followup shape rules mirror kaf_items", () => {
    const id = rows(`SELECT id FROM public.de_kp_cases WHERE slug = 'fall-eins';`);
    const ins = (pos: number, scope: string, req: number, acc: string, model = "x") =>
      `INSERT INTO public.de_kp_followups (case_id, position, scope, stem_de, required, accepted, model_answer_de) VALUES (${id}, ${pos}, '${scope}', 's', ${req}, '${acc}'::jsonb, '${model}');`;
    fails(ins(6, "case", 2, '[["a"]]'), /required_matches/);
    fails(ins(6, "case", 1, '[["a"],["b"],["c"],["d"]]'), /accepted_shape|required_matches/);
    fails(ins(6, "case", 1, '{"a":1}'), /accepted_shape|required_matches/);
    fails(ins(9, "case", 1, '[["a"]]'), /position_range/);
    fails(ins(6, "other", 1, '[["a"]]'), /de_kp_followups_scope/);
    fails(ins(6, "case", 1, '[["a"]]', "  "), /model_answer_present/);
    fails(ins(1, "case", 1, '[["a"]]'), /unique_position|duplicate key/);
    sql(ins(6, "case", 3, '[["a"],["b"],["c"]]'));
  });

  it("attempts: a user owns a run, step and score rules hold, cascade on user and case", () => {
    const uid = "11111111-1111-1111-1111-111111111111";
    const cid = rows(`SELECT id FROM public.de_kp_cases WHERE slug = 'fall-eins';`);
    sql(`INSERT INTO public.users (id, email) VALUES ('${uid}', 'x@example.invalid');`);
    const ins = (id: string, extra = "") => `INSERT INTO public.de_kp_case_attempts (id, user_id, case_id${extra ? ", " + extra.split("=")[0] : ""}) VALUES ('${id}', '${uid}', ${cid}${extra ? ", " + extra.split("=")[1] : ""});`;
    sql(ins("22222222-2222-2222-2222-222222222222"));
    expect(rows(`SELECT step FROM public.de_kp_case_attempts;`)).toBe("anamnese");
    fails(ins("33333333-3333-3333-3333-333333333333", "step='fertig'"), /de_kp_attempts_step/);
    fails(ins("33333333-3333-3333-3333-333333333333", "history_score=1.5"), /de_kp_attempts_scores/);
    fails(ins("33333333-3333-3333-3333-333333333333", "source='elsewhere'"), /de_kp_attempts_source/);
    fails(ins("33333333-3333-3333-3333-333333333333", "critical_missed=-1"), /de_kp_attempts_critical/);
    fails(`INSERT INTO public.de_kp_case_attempts (id, user_id, case_id) VALUES ('44444444-4444-4444-4444-444444444444', '99999999-9999-9999-9999-999999999999', ${cid});`, /foreign key/);
    sql(`DELETE FROM public.users WHERE id = '${uid}';`);
    expect(rows(`SELECT count(*) FROM public.de_kp_case_attempts;`)).toBe("0");
  });

  it("the rollback artifact deletes exactly the seeded slugs, followups cascade", () => {
    sql(caseRow("keep-me"));
    sql(art["rollback.sql"]);
    expect(rows(`SELECT string_agg(slug, ',') FROM public.de_kp_cases;`)).toBe("keep-me");
    expect(rows(`SELECT count(*) FROM public.de_kp_followups;`)).toBe("0");
  });

  it("down.sql drops all three tables and the migration re-applies", () => {
    sql(down);
    expect(rows(`SELECT count(*) FROM pg_tables WHERE tablename LIKE 'de_kp_%';`)).toBe("0");
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_tables WHERE tablename LIKE 'de_kp_%';`)).toBe("3");
  });
});
