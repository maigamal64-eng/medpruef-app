/**
 * C1 pre-screen file and database I/O (a-content-c1, 2026-10-14).
 *
 * The snapshot is the only database access of the whole job: paged SELECTs
 * through the service-role REST client (8 s deadline per call, keyset pages
 * of 1,000), written once to a JSON file. Every later mode reads that file
 * and never opens the database. No write of any kind.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { freeSetIds } from "@/lib/free-set";
import { BANKS, idsFromJson, idsFromRowClaims, idsFromSql, type Exposure, type QuestionRow } from "./lib";

export const SNAPSHOT_VERSION = 1;
const PAGE = 1000;
/** track-B ROW-CLAIMS packages whose rows another package is rewriting or re-keying. */
export const CLAIM_PKG_PREFIXES = ["b03-", "b06-", "b12-", "b13-"] as const;

export interface Snapshot {
  version: number;
  generated_at: string;
  source: string;
  rows: QuestionRow[];
  /** question id -> answers in the 90 days before generated_at (all learners, counts only). */
  answers_90d: Record<string, number>;
  /** Questions with an approved learner "incorrect answer" report (calibration labels). */
  learner_wrong_key_ids: number[];
}

export function readSnapshot(file: string): Snapshot {
  const s = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  if (s.version !== SNAPSHOT_VERSION || !Array.isArray(s.rows)) throw new Error(`${file} is not a pre-screen snapshot (version ${SNAPSHOT_VERSION})`);
  return s;
}

/** Exposure per question: 90-day answers from the snapshot, free set from the committed data. */
export function exposureMap(s: Snapshot): Map<number, Exposure> {
  const free = new Set<number>(BANKS.flatMap((b) => [...freeSetIds(b)]));
  const m = new Map<number, Exposure>();
  for (const r of s.rows) m.set(r.id, { answers_90d: Math.max(0, Number(s.answers_90d[String(r.id)] ?? 0) || 0), free_set: free.has(r.id) });
  return m;
}

// ─── Database (snapshot only) ───────────────────────────────────────────

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for snapshot (read-only).");
  const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
}

const ROW_COLUMNS = "id, exam_type, topic, question, choices, answer, explanation, tags, image_url, image_urls, is_active";

export async function readActiveRows(sb: SupabaseClient): Promise<QuestionRow[]> {
  const out: QuestionRow[] = [];
  let last = 0;
  for (;;) {
    const { data, error } = await sb.from("questions").select(ROW_COLUMNS).eq("is_active", true).gt("id", last).order("id", { ascending: true }).limit(PAGE);
    if (error) throw new Error(`questions read failed: ${error.message}`);
    const rows = (data ?? []) as QuestionRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    last = rows[rows.length - 1].id;
  }
}

/**
 * 90-day answer counts per question. Keyset paging on the primary key (uuid,
 * compared bytewise like its lowercase hex), so each page starts where the
 * last one ended instead of rescanning an offset (the free-plan database froze
 * on 12 Oct). On a busy database prefer --exposure-file (counts from a replica).
 */
export async function readAnswerCounts(sb: SupabaseClient, since: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let last: string | null = null;
  for (;;) {
    let q = sb.from("answer_history").select("id, question_id").gte("created_at", since.toISOString());
    if (last !== null) q = q.gt("id", last);
    const { data, error } = await q.order("id", { ascending: true }).limit(PAGE);
    if (error) throw new Error(`answer_history read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; question_id: number | null }>;
    for (const r of rows) if (r.question_id) counts[String(r.question_id)] = (counts[String(r.question_id)] ?? 0) + 1;
    if (rows.length < PAGE) return counts;
    last = rows[rows.length - 1].id;
  }
}

export async function readLearnerWrongKeyIds(sb: SupabaseClient): Promise<number[]> {
  const ids = new Set<number>();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("question_suggestions")
      .select("question_id")
      .eq("status", "approved")
      .in("reason", ["incorrect_answer", "wrong_answer"])
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`question_suggestions read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ question_id: number | null }>;
    for (const r of rows) if (Number.isSafeInteger(r.question_id)) ids.add(r.question_id as number);
    if (rows.length < PAGE) return [...ids].sort((a, b) => a - b);
    from += PAGE;
  }
}

/** Accepts {"<id>": n} or [{question_id, n|count|answers}] (for an exposure file from a read-only SQL helper). */
export function parseExposureFile(text: string): Record<string, number> {
  const j = JSON.parse(text) as unknown;
  const out: Record<string, number> = {};
  if (Array.isArray(j)) {
    for (const r of j as Array<Record<string, unknown>>) {
      const id = Number(r.question_id);
      const n = Number(r.n ?? r.count ?? r.answers);
      if (Number.isSafeInteger(id) && Number.isFinite(n) && n > 0) out[String(id)] = Math.floor(n);
    }
  } else if (j && typeof j === "object") {
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) if (/^\d+$/u.test(k) && Number(v) > 0) out[k] = Math.floor(Number(v));
  } else throw new Error("exposure file must be an object or an array");
  return out;
}

// ─── Claims (rows other packages own) ───────────────────────────────────

function walk(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(name)) out.push(p);
  }
  return out;
}

export interface ClaimSource {
  label: string;
  path: string;
  ids: number;
}

/**
 * Ids staged or claimed by a06, a07, kaf-ready (apply.sql files), track-B
 * ROW-CLAIMS b03/b06/b12/b13 and the b06 drafts, under a reports directory.
 * Throws when none of the sources exist, so a wrong --reports never runs
 * the bank without its exclusions.
 */
export function loadClaims(reportsDir: string): { claims: Map<number, string[]>; sources: ClaimSource[] } {
  const claims = new Map<number, string[]>();
  const sources: ClaimSource[] = [];
  const add = (label: string, p: string, ids: Iterable<number>) => {
    let n = 0;
    for (const id of ids) {
      claims.set(id, [...new Set([...(claims.get(id) ?? []), label])]);
      n += 1;
    }
    sources.push({ label, path: p, ids: n });
  };
  const rowClaims = path.join(reportsDir, "track-b-2026-10-11", "data", "ROW-CLAIMS.jsonl");
  if (existsSync(rowClaims)) {
    const m = idsFromRowClaims(readFileSync(rowClaims, "utf8"), CLAIM_PKG_PREFIXES);
    const byPkg = new Map<string, number[]>();
    for (const [id, pkgs] of m) for (const p of pkgs) byPkg.set(p, [...(byPkg.get(p) ?? []), id]);
    for (const [pkg, ids] of byPkg) add(pkg, rowClaims, ids);
  }
  const b06 = path.join(reportsDir, "track-b-2026-10-11", "data", "b06-explanation-blanks", "authored-drafts.json");
  if (existsSync(b06)) add("b06-explanation-blanks", b06, idsFromJson(JSON.parse(readFileSync(b06, "utf8"))));
  const sqlDirs: Array<[string, string]> = [
    ["a06", path.join(reportsDir, "master-plan-2026-10-11", "content-application", "batches")],
    ["a07", path.join(reportsDir, "master-plan-2026-10-11", "held-rows", "batches")],
    ["kaf-ready", path.join(reportsDir, "track-b-2026-10-11", "handover", "a-kaf-ready", "key-fixes")],
  ];
  for (const [label, dir] of sqlDirs) {
    const files = walk(dir, (n) => n === "apply.sql");
    if (files.length === 0) continue;
    const ids = new Set<number>();
    for (const f of files) for (const id of idsFromSql(readFileSync(f, "utf8"))) ids.add(id);
    add(label, dir, ids);
  }
  if (sources.length === 0) throw new Error(`no claim sources under ${reportsDir}; pass --reports <dir> (the main checkout's reports/) or --no-claims`);
  return { claims, sources };
}
