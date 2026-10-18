/**
 * PostgREST stand-in for the Kassa replay (a-flip-kassa-replay).
 *
 * supabase-js speaks HTTP to PostgREST. Here every `/rest/v1/...` request the
 * real client sends is translated into one SQL statement and run against a
 * throwaway local PostgreSQL that carries the production migration set, so
 * the webhook route, the supabase-js query builder and the real grant/revoke
 * SQL functions all run unchanged. Only the subset of the PostgREST grammar
 * that supabase-js emits is covered; the unsupported features named in
 * restToSql throw (the replay then fails instead of silently answering
 * something PostgREST would not). Known approximations: HTTP status per
 * SQLSTATE is coarse (statusForSqlState) and a two-statement plan (count,
 * void rpc) runs as two transactions; the webhook branches on error codes,
 * not statuses, and requests run one at a time.
 *
 * `restToSql` is pure (unit-tested without a database); `PgRest.handle`
 * executes through psql on the cluster's private socket.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export interface RestPlan {
  sql: string;
  /** Request wanted exactly one object (Accept: vnd.pgrst.object+json). */
  single: boolean;
  /** Prefer: return=representation (writes) or always for reads/rpc. */
  returnRows: boolean;
  /** Prefer: count=exact. */
  count: boolean;
  head: boolean;
  method: string;
  table: string;
}

export interface FnSignature {
  args: Array<{ name: string; type: string }>;
  returnsSet: boolean;
  /** pg type category of the return: 'composite', 'void', 'scalar'. */
  returns: "composite" | "void" | "scalar";
}

/** The rpc target does not exist (PostgREST answers 404 PGRST202). */
export class MissingFunctionError extends Error {}

export interface RestContext {
  primaryKey(table: string): string[];
  fn(name: string, argNames: string[]): FnSignature;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`pgrest: unsupported identifier '${name}'`);
  return `"${name}"`;
}

export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** `col`, `col->a->>b`, `col::text` into SQL, qualified with an alias. */
export function columnExpr(raw: string, alias: string | null): { sql: string; name: string } {
  let cast = "";
  let base = raw;
  const castAt = raw.indexOf("::");
  if (castAt >= 0) {
    cast = raw.slice(castAt + 2);
    base = raw.slice(0, castAt);
    if (!IDENT.test(cast)) throw new Error(`pgrest: unsupported cast '${cast}'`);
  }
  const parts = base.split(/(->>|->)/);
  const head = parts[0];
  let sql = alias ? `${alias}.${ident(head)}` : ident(head);
  let name = head;
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const key = parts[i + 1];
    sql = /^\d+$/.test(key) ? `${sql}${op}${key}` : `${sql}${op}${lit(key)}`;
    name = key;
  }
  return { sql: cast ? `(${sql})::${cast}` : sql, name };
}

/** Split on commas that are not inside parentheses or double quotes. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") quoted = !quoted;
    if (!quoted && c === "(") depth++;
    if (!quoted && c === ")") depth--;
    if (!quoted && depth === 0 && c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}

/** Double quotes delimit a value only inside `in.(...)` lists and or/and trees. */
function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return v;
}

/**
 * One `op.value` (optionally `not.op.value`) against a column expression.
 * `inList` is true for a term inside an or/and tree, where PostgREST reads a
 * double-quoted value; a top-level filter value is taken literally.
 */
export function operatorSql(colSql: string, expr: string, inList = false): string {
  let negate = false;
  let rest = expr;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot < 0) throw new Error(`pgrest: bad filter '${expr}'`);
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  const v1 = inList ? unquote(value) : value;
  let sql: string;
  switch (op) {
    case "eq": sql = `${colSql} = ${lit(v1)}`; break;
    case "neq": sql = `${colSql} <> ${lit(v1)}`; break;
    case "gt": sql = `${colSql} > ${lit(v1)}`; break;
    case "gte": sql = `${colSql} >= ${lit(v1)}`; break;
    case "lt": sql = `${colSql} < ${lit(v1)}`; break;
    case "lte": sql = `${colSql} <= ${lit(v1)}`; break;
    case "like": sql = `${colSql} LIKE ${lit(v1.replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${colSql} ILIKE ${lit(v1.replace(/\*/g, "%"))}`; break;
    case "is": {
      const v = value.toLowerCase();
      if (!["null", "true", "false", "unknown"].includes(v)) throw new Error(`pgrest: bad is value '${value}'`);
      sql = `${colSql} IS ${v.toUpperCase()}`;
      break;
    }
    case "in": {
      if (!value.startsWith("(") || !value.endsWith(")")) throw new Error(`pgrest: bad in list '${value}'`);
      const items = splitTop(value.slice(1, -1)).map((x) => lit(unquote(x)));
      sql = items.length ? `${colSql} IN (${items.join(", ")})` : "false";
      break;
    }
    case "cs": sql = `${colSql} @> ${lit(value)}`; break;
    case "cd": sql = `${colSql} <@ ${lit(value)}`; break;
    case "ov": sql = `${colSql} && ${lit(value)}`; break;
    default:
      throw new Error(`pgrest: unsupported operator '${op}'`);
  }
  return negate ? `NOT (${sql})` : sql;
}

/** `or=(a.eq.1,b.is.null,and(c.eq.2,d.gt.3))` into SQL. */
export function logicSql(kind: "or" | "and", body: string, alias: string | null): string {
  if (!body.startsWith("(") || !body.endsWith(")")) throw new Error(`pgrest: bad ${kind} '${body}'`);
  const parts = splitTop(body.slice(1, -1)).map((p) => {
    const m = /^(not\.)?(or|and)(\(.*\))$/.exec(p);
    if (m) {
      const inner = logicSql(m[2] as "or" | "and", m[3], alias);
      return m[1] ? `NOT ${inner}` : inner;
    }
    const firstDot = p.indexOf(".");
    if (firstDot < 0) throw new Error(`pgrest: bad ${kind} term '${p}'`);
    const col = columnExpr(p.slice(0, firstDot), alias).sql;
    return operatorSql(col, p.slice(firstDot + 1), true);
  });
  return `(${parts.join(kind === "or" ? " OR " : " AND ")})`;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

function whereSql(params: URLSearchParams, alias: string | null): string {
  const terms: string[] = [];
  for (const [key, value] of params.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") terms.push(logicSql(key, value, alias));
    else if (key === "not.or" || key === "not.and") terms.push(`NOT ${logicSql(key.slice(4) as "or" | "and", value, alias)}`);
    else terms.push(operatorSql(columnExpr(key, alias).sql, value));
  }
  return terms.length ? ` WHERE ${terms.join(" AND ")}` : "";
}

function orderSql(params: URLSearchParams, alias: string | null): string {
  const order = params.get("order");
  if (!order) return "";
  const items = splitTop(order).map((item) => {
    const bits = item.split(".");
    const dirs = bits.filter((b) => ["asc", "desc", "nullsfirst", "nullslast"].includes(b));
    const col = bits.filter((b) => !dirs.includes(b)).join(".");
    const dir = dirs.includes("desc") ? " DESC" : " ASC";
    const nulls = dirs.includes("nullsfirst") ? " NULLS FIRST" : dirs.includes("nullslast") ? " NULLS LAST" : "";
    return `${columnExpr(col, alias).sql}${dir}${nulls}`;
  });
  return ` ORDER BY ${items.join(", ")}`;
}

function pageSql(params: URLSearchParams): string {
  const limit = params.get("limit");
  const offset = params.get("offset");
  let s = "";
  if (limit !== null) {
    if (!/^\d+$/.test(limit)) throw new Error(`pgrest: bad limit '${limit}'`);
    s += ` LIMIT ${limit}`;
  }
  if (offset !== null) {
    if (!/^\d+$/.test(offset)) throw new Error(`pgrest: bad offset '${offset}'`);
    s += ` OFFSET ${offset}`;
  }
  return s;
}

/** The select list as SQL over alias `t` (embedded resources are refused). */
export function selectList(select: string | null, alias: string): string {
  const raw = (select ?? "*").replace(/\s+/g, "");
  if (raw === "" || raw === "*") return `${alias}.*`;
  return splitTop(raw).map((item) => {
    if (item === "*") return `${alias}.*`;
    if (item.includes("(")) throw new Error(`pgrest: embedded resource or aggregate not supported: '${item}'`);
    let label: string | null = null;
    let expr = item;
    const colon = item.indexOf(":");
    if (colon > 0 && item[colon + 1] !== ":") {
      label = item.slice(0, colon);
      expr = item.slice(colon + 1);
    }
    const c = columnExpr(expr, alias);
    return `${c.sql} AS ${ident(label ?? c.name)}`;
  }).join(", ");
}

function preferSet(headers: Headers): Set<string> {
  const s = new Set<string>();
  for (const part of (headers.get("prefer") ?? "").split(",")) {
    const p = part.trim();
    if (p) s.add(p);
  }
  return s;
}

function jsonAgg(inner: string): string {
  return `SELECT coalesce(jsonb_agg(to_jsonb(__r)), '[]'::jsonb)::text FROM (${inner}) __r`;
}

/** SQLSTATE raised when a single() write touched other than one row (rolled back, answered 406). */
export const SINGLE_WRITE_STATE = "22012";

/**
 * A write as one statement. With single(), PostgREST rolls the write back
 * unless exactly one row was affected: a division by zero evaluated only
 * then aborts the statement (so nothing commits) and is answered as PGRST116.
 */
function writeSql(write: string, single: boolean): string {
  const rows = `(SELECT coalesce(jsonb_agg(to_jsonb(__w)), '[]'::jsonb)::text FROM __w)`;
  if (!single) return `WITH __w AS (${write}) SELECT ${rows}`;
  // The divisor is a subquery, so the planner cannot fold it: it errors only when the ELSE branch runs.
  return `WITH __w AS (${write}) SELECT CASE WHEN (SELECT count(*) FROM __w) = 1 THEN ${rows} ELSE (1 / (SELECT count(*) - count(*) FROM __w))::text END`;
}

/** Build the SQL for one PostgREST request. Pure. */
export function restToSql(method: string, url: URL, headers: Headers, body: unknown, ctx: RestContext): RestPlan {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const params = url.searchParams;
  const prefer = preferSet(headers);
  const accept = headers.get("accept") ?? "";
  const single = accept.includes("vnd.pgrst.object+json");
  const count = [...prefer].some((p) => p.startsWith("count="));
  const head = method === "HEAD";

  if (count && method !== "GET" && method !== "HEAD") throw new Error("pgrest: count on a write or rpc is not supported");
  if (prefer.has("missing=default")) throw new Error("pgrest: Prefer missing=default is not supported");

  if (path.startsWith("rpc/")) {
    if (method !== "POST") throw new Error("pgrest: rpc over GET/HEAD is not supported");
    if (single) throw new Error("pgrest: single() on an rpc is not supported");
    const fn = path.slice(4);
    if (!IDENT.test(fn)) throw new Error(`pgrest: bad rpc '${fn}'`);
    const args = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const sig = ctx.fn(fn, Object.keys(args));
    const argSql = Object.entries(args).map(([name, value]) => {
      const type = sig.args.find((a) => a.name === name)?.type;
      if (!type) throw new Error(`pgrest: rpc ${fn} has no argument '${name}'`);
      return `${ident(name)} => ${valueLiteral(value, type)}`;
    }).join(", ");
    const call = `public.${ident(fn)}(${argSql})`;
    let sql: string;
    if (sig.returnsSet) sql = `SELECT coalesce(jsonb_agg(to_jsonb(__r)), '[]'::jsonb)::text FROM ${call} __r`;
    else if (sig.returns === "void") sql = `SELECT ${call}; SELECT 'null'`;
    else if (sig.returns === "composite") sql = `SELECT to_jsonb(__r)::text FROM ${call} __r`;
    else sql = `SELECT to_jsonb(${call})::text`;
    return { sql, single, returnRows: true, count: false, head: false, method, table: `rpc:${fn}` };
  }

  if (!IDENT.test(path)) throw new Error(`pgrest: bad table path '${path}'`);
  const table = `public.${ident(path)}`;
  const alias = "__t";
  const returnRows = method === "GET" || method === "HEAD" || prefer.has("return=representation");

  if (method === "GET" || method === "HEAD") {
    const where = whereSql(params, alias);
    const inner = `SELECT ${selectList(params.get("select"), alias)} FROM ${table} ${alias}${where}${orderSql(params, alias)}${pageSql(params)}`;
    let sql = head ? "SELECT '[]'" : jsonAgg(inner);
    if (count) sql += `; SELECT count(*)::text FROM ${table} ${alias}${where}`;
    return { sql, single, returnRows: !head, count, head, method, table: path };
  }

  if (method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length === 0) throw new Error("pgrest: empty insert");
    const colParam = params.get("columns");
    const cols = colParam
      ? colParam.split(",").map((c) => unquote(c))
      : [...new Set(rows.flatMap((r) => Object.keys((r ?? {}) as Record<string, unknown>)))];
    const colList = cols.map(ident).join(", ");
    const src = `json_populate_recordset(NULL::${table}, ${lit(JSON.stringify(rows))}::json) __src`;
    const selectCols = cols.map((c) => `__src.${ident(c)}`).join(", ");
    let conflict = "";
    const merge = prefer.has("resolution=merge-duplicates");
    const ignore = prefer.has("resolution=ignore-duplicates");
    if (merge || ignore) {
      const target = params.get("on_conflict")
        ? params.get("on_conflict")!.split(",").map((c) => unquote(c.trim()))
        : ctx.primaryKey(path);
      const targetSql = target.map(ident).join(", ");
      if (ignore) conflict = ` ON CONFLICT (${targetSql}) DO NOTHING`;
      else {
        const sets = cols.filter((c) => !target.includes(c)).map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
        conflict = sets.length ? ` ON CONFLICT (${targetSql}) DO UPDATE SET ${sets.join(", ")}` : ` ON CONFLICT (${targetSql}) DO NOTHING`;
      }
    }
    const insert = `INSERT INTO ${table} AS ${alias} (${colList}) SELECT ${selectCols} FROM ${src}${conflict} RETURNING ${selectList(params.get("select"), alias)}`;
    return { sql: writeSql(insert, single), single, returnRows, count, head: false, method, table: path };
  }

  if ((method === "PATCH" || method === "DELETE") && whereSql(params, alias) === "") {
    // Supabase rejects an UPDATE or DELETE without a filter (safeupdate).
    throw new Error(`pgrest: ${method} without a filter is refused`);
  }

  if (method === "PATCH") {
    const patch = (body ?? {}) as Record<string, unknown>;
    const cols = Object.keys(patch);
    if (cols.length === 0) throw new Error("pgrest: empty update");
    const sets = cols.map((c) => `${ident(c)} = __src.${ident(c)}`).join(", ");
    const src = `(SELECT * FROM json_populate_record(NULL::${table}, ${lit(JSON.stringify(patch))}::json)) __src`;
    const update = `UPDATE ${table} AS ${alias} SET ${sets} FROM ${src}${whereSql(params, alias)} RETURNING ${selectList(params.get("select"), alias)}`;
    return { sql: writeSql(update, single), single, returnRows, count, head: false, method, table: path };
  }

  if (method === "DELETE") {
    const del = `DELETE FROM ${table} AS ${alias}${whereSql(params, alias)} RETURNING ${selectList(params.get("select"), alias)}`;
    return { sql: writeSql(del, single), single, returnRows, count, head: false, method, table: path };
  }

  throw new Error(`pgrest: unsupported method ${method}`);
}

/** A JSON value as a typed SQL literal for an rpc argument. */
export function valueLiteral(value: unknown, type: string): string {
  if (value === null || value === undefined) return `NULL::${type}`;
  if (type === "json" || type === "jsonb") return `${lit(JSON.stringify(value))}::${type}`;
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) throw new Error(`pgrest: array argument expected for ${type}`);
    return `ARRAY(SELECT json_array_elements_text(${lit(JSON.stringify(value))}::json))::${type}`;
  }
  if (typeof value === "object") return `${lit(JSON.stringify(value))}::${type}`;
  return `${lit(String(value))}::${type}`;
}

/** PostgREST's HTTP status for a SQLSTATE. */
export function statusForSqlState(code: string): number {
  if (code === "23505" || code === "23503") return 409;
  if (code === "42501") return 403;
  if (code === "42883" || code === "42P01") return 404;
  if (code.startsWith("08") || code === "57014") return 503;
  return 400;
}

export interface PgRestLog {
  method: string;
  table: string;
  status: number;
  sql: string;
  error?: string;
}

/**
 * Executes RestPlans on a local cluster through psql, as the service_role,
 * one statement per request (PostgREST's per-request transaction).
 */
export class PgRest {
  readonly log: PgRestLog[] = [];
  private pkCache = new Map<string, string[]>();
  private fnCache = new Map<string, FnSignature[]>();
  constructor(private readonly pgBin: string, private readonly socketDir: string, private readonly port: string, public database: string) {}

  /** psql with the cluster's socket, no PG* leakage from the caller's shell. */
  psql(sqlText: string, opts: { asService?: boolean } = {}): { ok: boolean; out: string; code: string | null; message: string | null } {
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
    for (const k of Object.keys(env)) if (k.startsWith("PG")) delete env[k];
    const prelude = `\\set VERBOSITY verbose\nSET TIME ZONE 'UTC';\n${opts.asService ? "SET ROLE service_role;\nSELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false) \\g /dev/null\n" : ""}`;
    const r = spawnSync(join(this.pgBin, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", this.socketDir, "-p", this.port, "-U", "postgres", "-d", this.database], {
      input: `${prelude}${sqlText}\n`, encoding: "utf8", env, timeout: 30_000,
    });
    if (r.error) throw r.error;
    if (r.status === 0) return { ok: true, out: r.stdout, code: null, message: null };
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(r.stderr);
    return { ok: false, out: r.stdout, code: m?.[1] ?? "XX000", message: m?.[2] ?? r.stderr.trim().slice(0, 300) };
  }

  rows<T = Record<string, unknown>>(sqlText: string): T[] {
    const r = this.psql(`SELECT coalesce(jsonb_agg(to_jsonb(__q)), '[]'::jsonb)::text FROM (${sqlText}) __q`);
    if (!r.ok) throw new Error(`pgrest rows: ${r.code} ${r.message}`);
    return JSON.parse(r.out.trim() || "[]") as T[];
  }

  /** One write with RETURNING, as JSON rows. */
  returning<T = Record<string, unknown>>(writeSql: string): T[] {
    const r = this.psql(`WITH __w AS (${writeSql}) SELECT coalesce(jsonb_agg(to_jsonb(__w)), '[]'::jsonb)::text FROM __w`);
    if (!r.ok) throw new Error(`pgrest returning: ${r.code} ${r.message}`);
    return JSON.parse(r.out.trim() || "[]") as T[];
  }

  exec(sqlText: string): void {
    const r = this.psql(sqlText);
    if (!r.ok) throw new Error(`pgrest exec: ${r.code} ${r.message}`);
  }

  private ctx(): RestContext {
    return {
      primaryKey: (table) => {
        const key = `${this.database}:${table}`;
        if (!this.pkCache.has(key)) {
          const cols = this.rows<{ a: string }>(`SELECT a.attname AS a FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = 'public.${table}'::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`).map((r) => r.a);
          this.pkCache.set(key, cols);
        }
        return this.pkCache.get(key)!;
      },
      fn: (name, argNames) => {
        const key = `${this.database}:${name}`;
        if (!this.fnCache.has(key)) {
          const sigs = this.rows<{ names: string[] | null; types: string[]; retset: boolean; rettype: string; typtype: string }>(
            `SELECT p.proargnames AS names, ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t) AS types, p.proretset AS retset, format_type(p.prorettype, NULL) AS rettype, rt.typtype::text AS typtype FROM pg_proc p JOIN pg_type rt ON rt.oid = p.prorettype WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ${lit(name)}`,
          ).map((s) => ({
            args: s.types.map((type, i) => ({ name: s.names?.[i] ?? `$${i + 1}`, type })),
            returnsSet: s.retset,
            returns: (s.rettype === "void" ? "void" : s.typtype === "c" || s.rettype === "record" ? "composite" : "scalar") as FnSignature["returns"],
          }));
          this.fnCache.set(key, sigs);
        }
        const sigs = this.fnCache.get(key)!;
        // PostgREST picks the overload whose named inputs match the body keys.
        // Exact arity first, then the fewest extra (defaulted) parameters.
        const match = sigs.filter((s) => argNames.every((n) => s.args.some((a) => a.name === n)))
          .sort((a, b) => Math.abs(a.args.length - argNames.length) - Math.abs(b.args.length - argNames.length));
        if (!match.length) throw new MissingFunctionError(`Could not find the function public.${name}(${argNames.join(", ")}) in the schema cache`);
        return match[0];
      },
    };
  }

  /** Answer one supabase-js request like PostgREST would. */
  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const text = method === "GET" || method === "HEAD" ? "" : await req.text();
    const body = text ? JSON.parse(text) : undefined;
    let plan: RestPlan;
    try {
      plan = restToSql(method, url, req.headers, body, this.ctx());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof MissingFunctionError) {
        this.log.push({ method, table: url.pathname, status: 404, sql: "", error: `PGRST202 ${message}` });
        return new Response(JSON.stringify({ code: "PGRST202", message, details: null, hint: null }), { status: 404, headers: { "content-type": "application/json" } });
      }
      this.log.push({ method, table: url.pathname, status: 500, sql: "", error: message });
      throw err;
    }
    const r = this.psql(plan.sql, { asService: true });
    if (!r.ok && plan.single && r.code === SINGLE_WRITE_STATE && method !== "GET") {
      this.log.push({ method, table: plan.table, status: 406, sql: plan.sql, error: "PGRST116 single() write affected other than one row (rolled back)" });
      return new Response(JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null }), { status: 406, headers: { "content-type": "application/json" } });
    }
    if (!r.ok) {
      const status = statusForSqlState(r.code ?? "XX000");
      this.log.push({ method, table: plan.table, status, sql: plan.sql, error: `${r.code} ${r.message}` });
      return new Response(JSON.stringify({ code: r.code, message: r.message, details: null, hint: null }), { status, headers: { "content-type": "application/json" } });
    }
    const lines = r.out.split("\n").filter((l) => l !== "");
    const payload = lines[0] ?? "null";
    const total = plan.count ? lines[lines.length - 1] : null;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (total !== null) headers["content-range"] = `0-0/${total}`;
    if (plan.table.startsWith("rpc:")) {
      this.log.push({ method, table: plan.table, status: 200, sql: plan.sql });
      return new Response(payload, { status: 200, headers });
    }
    const data = JSON.parse(payload) as unknown[];
    if (plan.single) {
      if (data.length !== 1) {
        this.log.push({ method, table: plan.table, status: 406, sql: plan.sql });
        return new Response(JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${data.length} rows`, hint: null }), { status: 406, headers });
      }
      this.log.push({ method, table: plan.table, status: 200, sql: plan.sql });
      return new Response(JSON.stringify(data[0]), { status: 200, headers });
    }
    const status = method === "POST" ? 201 : 200;
    this.log.push({ method, table: plan.table, status, sql: plan.sql });
    if (plan.head) return new Response(null, { status: 200, headers });
    if (!plan.returnRows) return new Response(null, { status: method === "POST" ? 201 : 204, headers });
    return new Response(JSON.stringify(data), { status, headers });
  }
}
