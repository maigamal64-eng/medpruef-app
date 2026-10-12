import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a17 Ops approvals proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261204090000 changeset on top of the applied Ops stack (P0, reads, OAuth,
// content actions). Opt-in only (test:db:a17); never reads a connection URL
// or production env.
const databaseEnabled = process.env.A17_DATABASE_TESTS === "1";
const PORT = "55441";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A17_PG_BIN) return resolve(process.env.A17_PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 10_000 });
  if (config.status === 0 && config.stdout.trim()) return config.stdout.trim();
  throw new Error("PostgreSQL 16 binaries required for test:db:a17. Set A17_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const stack = [
  "services/ops-mcp/tests/fixture.sql",
  "services/ops-mcp/tests/reads.fixture.sql",
  "supabase/migrations/20260928231024_admin_rbac.sql",
  "supabase/migrations/20261005150000_ops_mcp.sql",
  "supabase/migrations/20261006100000_ops_mcp_reads.sql",
  "supabase/migrations/20261006110000_ops_oauth.sql",
  "supabase/migrations/20261006120000_ops_content_actions.sql",
].map(read);
const migration = read("supabase/migrations/20261204090000_a17_ops_approvals.sql");
const rollback = read("scripts/sql/track-a/a17-ops-approvals/down.sql");

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const OUTSIDER = "00000000-0000-4000-8000-0000000000c1";
const PRINCIPAL = "00000000-0000-4000-8000-0000000000d1";
const CREDENTIAL = "[secret]";
const NOTE = "00000000-0000-4000-8000-0000000000f1";
const REPORT = "00000000-0000-4000-8000-0000000000f2";
const AUD = "https://ops.example.test/mcp";
const TOKEN = "encode(sha256('a17-fixture-token'::bytea),'hex')";

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };

function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const json = <T>(text: string) => JSON.parse(rows(text)) as T;
function fails(text: string, code: string, message?: RegExp) {
  const result = sql(text, true);
  expect(result.status, result.stdout).not.toBe(0);
  expect(result.stderr).toContain(`ERROR:  ${code}`);
  if (message) expect(result.stderr).toMatch(message);
}
const agent = (fn: string, args: string) => `SET ROLE medpruf_ops_mcp; SELECT public.${fn}(${TOKEN},'production','${AUD}',${args})::text;`;
const owner = (fn: string, args: string) => `SET ROLE service_role; SELECT public.${fn}(${args})::text;`;
type Action = { id: string; status: string; payload_hash: string; expires_at: string; created_at: string; decision_reason?: string | null; result?: Record<string, unknown> };

describe.skipIf(!databaseEnabled)("a17 Ops approvals on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a17-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    for (const file of stack) sql(file);
    sql("GRANT USAGE ON SCHEMA public TO service_role;");
    sql(migration);
    sql(`
      INSERT INTO public.users(id,email,first_name,role,tier,is_banned) VALUES
        ('${OWNER}','owner@invalid.local','Owner','admin','free',false),
        ('${LEARNER}','learner@invalid.local','Lea','user','free',false),
        ('${OUTSIDER}','outsider@invalid.local','Out','admin','free',false);
      INSERT INTO public.admin_user_roles(user_id,role_id) SELECT '${OWNER}',id FROM public.admin_roles WHERE role_key='owner';
      INSERT INTO public.ops_principals(id,name,project,environment,audience,delegating_user_id)
        VALUES('${PRINCIPAL}','Kassa monitor (personal token)','medpruf','production','${AUD}','${OWNER}');
      INSERT INTO public.ops_credentials(id,principal_id,token_hash,scopes,expires_at)
        VALUES('${CREDENTIAL}','${PRINCIPAL}',${TOKEN},ARRAY['feedback.manage','users.entitlements.write','content.moderate','users.notes.read','feedback.read'],now()+interval '7 days');
      INSERT INTO public.ops_grants(principal_id,permission) VALUES
        ('${PRINCIPAL}','feedback.manage'),('${PRINCIPAL}','users.entitlements.write'),('${PRINCIPAL}','content.moderate'),('${PRINCIPAL}','users.notes.read'),('${PRINCIPAL}','feedback.read');
      INSERT INTO public.user_feedback(id,user_id,message,status,admin_note) VALUES
        (501,'${LEARNER}','The timer froze on my phone','new','zoho_msg_id: 1234 | emailed learner'),
        (502,'${LEARNER}','Already handled','resolved',NULL);
      INSERT INTO public.notes(id,user_id,source_type,title,content,visibility,is_active,search_text)
        VALUES('${NOTE}','${LEARNER}','manual','Reported note','{"body":"x"}','public',true,'reported note body');
      INSERT INTO public.note_reports(id,note_id,reporter_user_id,reason,status) VALUES('${REPORT}','${NOTE}','${LEARNER}','unsafe','open');
      UPDATE public.ops_settings SET enabled=true;
    `);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("keeps both Ops runtime privilege checks passing and exposes new functions to service_role only", () => {
    expect(rows("SET ROLE medpruf_ops_mcp; SELECT (public.ops_runtime_check()->>'ok');")).toBe("true");
    expect(rows("SET ROLE medpruf_ops_oauth; SELECT (public.ops_oauth_runtime_check()->>'ok');")).toBe("true");
    for (const fn of [
      "public.ops_admin_reject_action(uuid,uuid,text,text)",
      "public.ops_admin_queue(uuid,integer)",
      "public.ops_admin_queue_summary(uuid)",
      "public.ops_admin_connections(uuid)",
      "public.ops_admin_disconnect(uuid,uuid,text)",
    ]) {
      expect(rows(`SELECT ${["anon", "authenticated", "medpruf_ops_mcp", "medpruf_ops_oauth", "service_role"].map((r) => `has_function_privilege('${r}','${fn}','EXECUTE')::text`).join("||','||")};`))
        .toBe("false,false,false,false,true");
    }
    expect(rows("SELECT has_function_privilege('service_role','public.ops_target_summary(text,jsonb)','EXECUTE')::text;")).toBe("false");
    // Existing agent and owner grants survive CREATE OR REPLACE.
    expect(rows("SELECT has_function_privilege('medpruf_ops_mcp','public.ops_prepare_feedback(text,text,text,bigint,text,text,text)','EXECUTE')::text;")).toBe("true");
    expect(rows("SELECT has_function_privilege('service_role','public.ops_admin_approve_action(uuid,uuid,text)','EXECUTE')::text;")).toBe("true");
    expect(rows("SELECT has_function_privilege('medpruf_ops_oauth','public.ops_oauth_put(text,text,text,timestamptz,text,text,text,jsonb)','EXECUTE')::text;")).toBe("true");
  });

  it("feedback triage waits 24 hours, needs owner approval and appends its note", () => {
    const prepared = json<Action>(agent("ops_prepare_feedback", "501::bigint,'resolved','Fixed in the timer patch','fb-501-key'"));
    const hours = (Date.parse(prepared.expires_at) - Date.parse(prepared.created_at)) / 3_600_000;
    expect(hours).toBeCloseTo(24, 1);
    // Previously the feedback branch ran without any approval row.
    fails(agent("ops_execute_action", `'${prepared.id}'::uuid`), "42501", /Owner approval required/);
    const approved = json<Action>(owner("ops_admin_approve_action", `'${OWNER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}'`));
    expect(approved.status).toBe("approved");
    const executed = json<Action>(agent("ops_execute_action", `'${prepared.id}'::uuid`));
    expect(executed.status).toBe("succeeded");
    expect(executed.result).toMatchObject({ status: "resolved", note_appended: true, previous: { status: "new" } });
    const note = rows("SELECT admin_note FROM public.user_feedback WHERE id=501;");
    expect(note.startsWith("zoho_msg_id: 1234 | emailed learner\n[Ops ")).toBe(true);
    expect(note).toContain("] Fixed in the timer patch");
    expect(rows("SELECT status FROM public.user_feedback WHERE id=501;")).toBe("resolved");
    expect(rows(`SELECT decided_by FROM public.ops_actions WHERE id='${prepared.id}';`)).toBe(OWNER);
  });

  it("refuses to prepare triage for feedback that is not open", () => {
    fails(agent("ops_prepare_feedback", "502::bigint,'dismissed','late','fb-502-key'"), "55000", /not open/);
  });

  it("requires a reject reason for access changes and records it", () => {
    const prepared = json<Action>(agent("ops_prepare_entitlement", `'${LEARNER}'::uuid,30,'Payment pay_123 unmapped','ent-1-key'`));
    fails(owner("ops_admin_reject_action", `'${OWNER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}',NULL`), "22023", /Reason required/);
    fails(owner("ops_admin_reject_action", `'${OWNER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}'`), "22023", /Reason required/);
    fails(owner("ops_admin_reject_action", `'${OUTSIDER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}','Wrong amount'`), "42501");
    const rejected = json<Action>(owner("ops_admin_reject_action", `'${OWNER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}','  Wrong amount  '`));
    expect(rejected).toMatchObject({ status: "rejected", decision_reason: "Wrong amount" });
    fails(agent("ops_execute_action", `'${prepared.id}'::uuid`), "55000");
  });

  it("grants an approved entitlement with a before-image", () => {
    const prepared = json<Action>(agent("ops_prepare_entitlement", `'${LEARNER}'::uuid,30,'Payment pay_456 unmapped','ent-2-key'`));
    json<Action>(owner("ops_admin_approve_action", `'${OWNER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}'`));
    const executed = json<Action>(agent("ops_execute_action", `'${prepared.id}'::uuid`));
    expect(executed.result).toMatchObject({ tier: "pro", previous: { tier: "free", tier_expires_at: null } });
  });

  it("keeps a takedown before-image as the restore path", () => {
    const prepared = json<Action>(agent("ops_prepare_notes_moderation", `'${REPORT}'::uuid,'takedown','Confirmed unsafe content','note-1-key'`));
    fails(agent("ops_execute_action", `'${prepared.id}'::uuid`), "42501");
    json<Action>(owner("ops_admin_approve_action", `'${OWNER}'::uuid,'${prepared.id}'::uuid,'${prepared.payload_hash}'`));
    const executed = json<Action>(agent("ops_execute_action", `'${prepared.id}'::uuid`));
    expect(executed.result).toMatchObject({ takedown: true, previous: { note_visibility: "public", note_is_active: true, report_status: "open" } });
  });

  it("lists the queue with live target state, live items first", () => {
    const waiting = json<Action>(agent("ops_prepare_entitlement", `'${LEARNER}'::uuid,7,'Goodwill after outage','ent-3-key'`));
    type QueueItem = Action & { principal_name: string; target: Record<string, unknown>; approved_by: string | null };
    const queue = json<{ items: QueueItem[] }>(owner("ops_admin_queue", `'${OWNER}'::uuid,50`));
    expect(queue.items[0].id).toBe(waiting.id);
    expect(queue.items[0].principal_name).toBe("Kassa monitor (personal token)");
    expect(queue.items[0].target).toMatchObject({ kind: "learner", user_id: LEARNER, current_tier: "pro" });
    const done = queue.items.find((item) => item.status === "succeeded" && item.target.kind === "feedback");
    expect(done?.target).toMatchObject({ current_status: "resolved", message_excerpt: "The timer froze on my phone" });
    expect(done?.approved_by).toBe(OWNER);
    const summary = json<{ waiting: number; approved: number }>(owner("ops_admin_queue_summary", `'${OWNER}'::uuid`));
    expect(summary).toMatchObject({ waiting: 1, approved: 0 });
    fails(owner("ops_admin_queue", `'${OUTSIDER}'::uuid,50`), "42501");
    fails(owner("ops_admin_queue_summary", `'${OUTSIDER}'::uuid`), "42501");
  });

  it("lists connections and disconnects one in a single owner action", () => {
    type Connection = { id: string; active: boolean; kind: string; scopes: string[]; live_credentials: number };
    const before = json<{ items: Connection[] }>(owner("ops_admin_connections", `'${OWNER}'::uuid`));
    expect(before.items[0]).toMatchObject({ id: PRINCIPAL, active: true, kind: "token", live_credentials: 1 });
    expect(before.items[0].scopes).toContain("users.entitlements.write");
    fails(owner("ops_admin_disconnect", `'${OWNER}'::uuid,'${PRINCIPAL}'::uuid,'  '`), "22023");
    fails(owner("ops_admin_disconnect", `'${OUTSIDER}'::uuid,'${PRINCIPAL}'::uuid,'Lost laptop'`), "42501");
    const result = json<{ active: boolean; revoked_credentials: number; closed_actions: number }>(owner("ops_admin_disconnect", `'${OWNER}'::uuid,'${PRINCIPAL}'::uuid,'Lost laptop'`));
    expect(result).toMatchObject({ active: false, revoked_credentials: 1, closed_actions: 1 });
    fails(agent("ops_action_status", `'${PRINCIPAL}'::uuid`), "28000");
    expect(rows("SELECT count(*) FROM public.ops_actions WHERE status IN ('prepared','approved');")).toBe("0");
    expect(rows("SELECT decision_reason FROM public.ops_actions WHERE idempotency_key='ent-3-key';")).toBe("Connection disconnected: Lost laptop");
    expect(rows("SELECT count(*) FROM public.admin_audit_log WHERE action='ops_disconnect';")).toBe("1");
  });

  it("bounds personal token lifetime for new credentials", () => {
    fails(`INSERT INTO public.ops_credentials(principal_id,token_hash,scopes,expires_at) VALUES('${PRINCIPAL}',encode(sha256('long'::bytea),'hex'),'{}',now()+interval '40 days');`, "23514");
  });

  it("purges expired issuer records as the issuer writes", () => {
    sql(`INSERT INTO public.ops_oauth_records(model,id_hash,ciphertext,expires_at) VALUES('Interaction',repeat('a',64),repeat('x',30),now()-interval '2 hours');`);
    rows(`SET ROLE medpruf_ops_oauth; SELECT public.ops_oauth_put('Interaction',repeat('b',64),repeat('y',30),now()+interval '10 minutes',NULL,NULL,NULL,NULL)::text;`);
    expect(rows("SELECT string_agg(left(id_hash,1),',' ORDER BY id_hash) FROM public.ops_oauth_records;")).toBe("b");
  });

  it("re-applies cleanly and rolls back to the pre-a17 bodies", () => {
    sql(migration);
    sql(rollback);
    expect(rows("SELECT count(*) FROM pg_proc WHERE proname IN ('ops_admin_queue','ops_admin_queue_summary','ops_admin_connections','ops_admin_disconnect','ops_target_summary');")).toBe("0");
    expect(rows("SELECT count(*) FROM pg_proc WHERE proname='ops_admin_reject_action';")).toBe("1");
    expect(rows("SELECT count(*) FROM information_schema.columns WHERE table_name='ops_actions' AND column_name IN ('decided_by','decided_at','decision_reason');")).toBe("0");
    expect(rows("SET ROLE medpruf_ops_mcp; SELECT (public.ops_runtime_check()->>'ok');")).toBe("true");
    sql(migration);
    expect(rows("SELECT count(*) FROM pg_proc WHERE proname='ops_admin_reject_action';")).toBe("2");
  });
});
