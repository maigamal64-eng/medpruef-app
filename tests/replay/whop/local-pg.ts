/**
 * Throwaway PostgreSQL cluster for the Kassa replay (a-flip-kassa-replay).
 *
 * Schema = the production migration set as the stack proof reads it
 * (a-stack-proof-prod-order, production read 13 Oct, re-checked 16 Oct:
 * 20270102 and 20270103 not applied yet): the April baseline, every file
 * through 20261207 plus 20261221, 20261224 and 20261230, then, for the flip
 * stage, 20270102 (free-credit hooks) and 20270103 (pricing v2) exactly as
 * track-A applies them. The cluster listens on a private socket only and is
 * deleted afterwards; no connection URL or production env is ever read.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type SchemaStage = "dark" | "flip";

const BASE_EXTRA = new Set(["20261221090000", "20261224090000", "20261230090000"]);
const FLIP_ORDER = ["20270102090000", "20270103090000"];
/**
 * Production objects no migration file creates (drift, read 16 Oct). Added
 * after the migrations so the fidelity check can stay exact; each one is
 * listed in the replay report. users.email_status is read by auth and nudge
 * paths only; the three CHECK constraints bind webhook writes.
 */
const PROD_DRIFT = [
  {
    object: "users.email_status (column, default 'unverified', users_email_status_check)",
    sql: `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_status text DEFAULT 'unverified';
      ALTER TABLE public.users ADD CONSTRAINT users_email_status_check CHECK (email_status = ANY (ARRAY['valid'::text, 'bounced'::text, 'unverified'::text]));`,
  },
  // Production is stricter than the migrations here; the replay must fail where production would.
  { object: "users_tier_check", sql: "ALTER TABLE public.users ADD CONSTRAINT users_tier_check CHECK (tier = ANY (ARRAY['free'::text, 'pro'::text, 'admin'::text]));" },
  { object: "users_active_exam_check", sql: "ALTER TABLE public.users ADD CONSTRAINT users_active_exam_check CHECK (active_exam = ANY (ARRAY['kenntnispruefung'::text, 'kmp_innsbruck'::text, 'pharma'::text]));" },
  { object: "webhook_attempts_result_check", sql: "ALTER TABLE public.webhook_attempts ADD CONSTRAINT webhook_attempts_result_check CHECK (result = ANY (ARRAY['processed'::text, 'dup'::text, 'sig_invalid'::text, 'parse_error'::text, 'user_not_found'::text, 'other_error'::text]));" },
];
/** Failures before this version are April dump artifacts the shims cannot carry (as in the stack proof). */
const STRICT_FROM = "20261014110000";

export interface ClusterInfo {
  pgBin: string;
  socketDir: string;
  port: string;
  dataDir: string;
  applied: string[];
  tolerated: Array<{ file: string; error: string }>;
  driftShims: string[];
}

/** The caller's env without any PG* variable, so psql can only reach the throwaway socket. */
export function pgEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
  for (const k of Object.keys(env)) if (k.startsWith("PG")) delete env[k];
  return env;
}

export function discoverPgBin(): string {
  if (process.env.KASSA_REPLAY_PG_BIN) return resolve(process.env.KASSA_REPLAY_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((n) => existsSync(join(dir, n)))) return dir;
  }
  throw new Error("PostgreSQL binaries required for test:replay:whop. Set KASSA_REPLAY_PG_BIN.");
}

function run(bin: string, args: string[], input?: string) {
  const r = spawnSync(bin, args, { encoding: "utf8", env: pgEnv(), input, timeout: 120_000 });
  if (r.error) throw r.error;
  return r;
}

const SHIMS = `
create schema if not exists auth; create schema if not exists extensions; create schema if not exists storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto; create extension if not exists pg_trgm;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
create publication supabase_realtime;
`;

export class LocalCluster {
  info!: ClusterInfo;
  private root = "";
  private running = false;

  constructor(private readonly repo: string, private readonly port = "55447") {}

  psql(db: string, text: string, single = true) {
    const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", this.root, "-p", this.port, "-U", "postgres", "-d", db];
    if (single) args.splice(1, 0, "-1");
    return run(join(this.info.pgBin, "psql"), args, text);
  }

  start(): void {
    if (process.env.KASSA_REPLAY_CLUSTER_ACTIVE === "1") throw new Error("recursion guard: a replay cluster is already being built in this process");
    process.env.KASSA_REPLAY_CLUSTER_ACTIVE = "1";
    const pgBin = discoverPgBin();
    this.root = mkdtempSync(join(tmpdir(), "kassa-replay-pg-"));
    const dataDir = join(this.root, "data");
    const init = run(join(pgBin, "initdb"), ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
    // No TCP listener: the port only names this cluster's private socket.
    const started = run(join(pgBin, "pg_ctl"), ["-D", dataDir, "-l", join(this.root, "server.log"), "-o", `-k ${this.root} -p ${this.port} -h '' -c TimeZone=UTC`, "-w", "start"]);
    if (started.status !== 0) throw new Error(`pg_ctl start failed: ${started.stderr}`);
    this.running = true;
    this.info = { pgBin, socketDir: this.root, port: this.port, dataDir, applied: [], tolerated: [], driftShims: [] };
    const dd = this.psql("postgres", "SHOW data_directory;", false);
    if (!dd.stdout.includes(this.root.split("/").pop() ?? "\0")) throw new Error(`not the throwaway cluster: ${dd.stdout}`);
    const roles = this.psql("postgres", `create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create role supabase_admin superuser; create role authenticator noinherit; create role supabase_auth_admin; create role dashboard_user;`);
    if (roles.status !== 0) throw new Error(`roles failed: ${roles.stderr}`);
  }

  /** Build template database `tmpl_<stage>` with the production migration set. */
  buildTemplate(stage: SchemaStage): string {
    const db = `tmpl_${stage}`;
    const created = this.psql("postgres", `create database ${db};`, false);
    if (created.status !== 0) throw new Error(`create database failed: ${created.stderr}`);
    const shims = this.psql(db, SHIMS, false);
    if (shims.status !== 0) throw new Error(`shims failed: ${shims.stderr}`);
    const migDir = join(this.repo, "supabase/migrations");
    const all = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    // Sequences production owns through tables the April dump left out.
    const seqs = new Set<string>();
    for (const f of all) {
      const text = readFileSync(join(migDir, f), "utf8");
      for (const m of text.matchAll(/nextval\('([a-z_]+)'/g)) seqs.add(m[1].replace(/^public\./, ""));
      for (const m of text.matchAll(/on sequence public\.([a-z_]+)/gi)) seqs.add(m[1]);
    }
    this.psql(db, [...seqs].map((q) => `create sequence if not exists public.${q};`).join("\n"), false);
    const baseline = all.filter((f) => f.includes("baseline_schema"));
    const rest = all.filter((f) => !f.includes("baseline_schema")).filter((f) => {
      const v = f.split("_")[0];
      return v <= "20261207090000" || BASE_EXTRA.has(v);
    });
    const files = [...baseline, ...rest];
    if (stage === "flip") {
      for (const v of FLIP_ORDER) {
        const file = all.find((f) => f.startsWith(`${v}_`));
        if (!file) throw new Error(`flip migration ${v} is not in supabase/migrations on this ref`);
        files.push(file);
      }
    }
    for (const f of files) {
      const r = this.psql(db, readFileSync(join(migDir, f), "utf8"));
      const v = f.split("_")[0];
      if (r.status === 0) {
        this.info.applied.push(`${stage}:${f}`);
        continue;
      }
      const err = (/ERROR:[^\n]*/.exec(r.stderr)?.[0] ?? r.stderr).slice(0, 200);
      if (f.includes("baseline_schema") || v < STRICT_FROM) {
        this.info.tolerated.push({ file: `${stage}:${f}`, error: err });
        continue;
      }
      throw new Error(`migration ${f} failed on the ${stage} template: ${err}`);
    }
    for (const d of PROD_DRIFT) {
      const r = this.psql(db, d.sql);
      if (r.status !== 0) throw new Error(`drift shim ${d.object} failed: ${r.stderr}`);
      if (!this.info.driftShims.includes(d.object)) this.info.driftShims.push(d.object);
    }
    return db;
  }

  /** A fresh scenario database cloned from a template. */
  clone(template: string, name: string): string {
    const r = this.psql("postgres", `create database ${name} template ${template};`, false);
    if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
    return name;
  }

  writeLog(path: string): void {
    writeFileSync(path, JSON.stringify({ applied: this.info.applied, tolerated: this.info.tolerated, drift_shims: this.info.driftShims }, null, 1));
  }

  stop(): void {
    try {
      if (this.running) run(join(this.info.pgBin, "pg_ctl"), ["-D", this.info.dataDir, "-m", "immediate", "-w", "stop"]);
    } finally {
      this.running = false;
      if (this.root) rmSync(this.root, { recursive: true, force: true });
      delete process.env.KASSA_REPLAY_CLUSTER_ACTIVE;
    }
  }
}
