/**
 * Free mentor beta: list candidate learners. READ-ONLY.
 *
 *   node_modules/.bin/vite-node scripts/mentor/pick-beta-users.ts [-- --days 14 --min 20]
 *
 * Candidates: users with at least --min answers (answer_history rows) in the
 * last --days days, excluding admins and internal/test accounts (role or tier
 * admin, @medpruf.com / @medpruef.com addresses, test or demo addresses, and
 * MEDPRUEF_ADMIN_EMAIL / MEDPRUEF_TEST_USER_EMAIL). Prints ids and activity
 * counts only to stdout; emails are read to filter and never printed.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (taken from the
 * environment, else from .env.local). Only SELECTs; it writes nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export interface AnswerRow { user_id: string | null; created_at: string }
export interface UserRow { id: string; role: string | null; tier: string | null; email: string | null }
export interface Candidate { user_id: string; answers: number; active_days: number; last_answer_at: string }

const INTERNAL_DOMAINS = ["@medpruf.com", "@medpruef.com"];

export function isExcludedUser(u: UserRow, extraEmails: readonly string[] = []): boolean {
  if (u.role === "admin" || u.tier === "admin") return true;
  const email = (u.email ?? "").trim().toLowerCase();
  if (!email) return false;
  if (INTERNAL_DOMAINS.some((d) => email.endsWith(d))) return true;
  if (/(^|[^a-z])(test|demo)([^a-z]|$)/.test(email.split("@")[0] ?? "")) return true;
  return extraEmails.some((e) => e.trim().toLowerCase() === email);
}

/** Pure: aggregate answers per user, keep those with >= minAnswers, drop excluded users. */
export function pickCandidates(answers: AnswerRow[], users: UserRow[], minAnswers: number, extraEmails: readonly string[] = []): Candidate[] {
  const byUser = new Map<string, { answers: number; days: Set<string>; last: string }>();
  for (const a of answers) {
    if (!a.user_id) continue;
    const e = byUser.get(a.user_id) ?? { answers: 0, days: new Set<string>(), last: "" };
    e.answers++;
    e.days.add(a.created_at.slice(0, 10));
    if (a.created_at > e.last) e.last = a.created_at;
    byUser.set(a.user_id, e);
  }
  const userById = new Map(users.map((u) => [u.id, u]));
  const out: Candidate[] = [];
  for (const [id, e] of byUser) {
    if (e.answers < minAnswers) continue;
    const u = userById.get(id);
    if (!u || isExcludedUser(u, extraEmails)) continue;
    out.push({ user_id: id, answers: e.answers, active_days: e.days.size, last_answer_at: e.last });
  }
  return out.sort((a, b) => b.answers - a.answers || b.active_days - a.active_days || a.user_id.localeCompare(b.user_id));
}

function arg(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const PAGE = 1000;
const MAX_ROWS = 300_000;

async function main(argv: string[]): Promise<number> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    process.stderr.write("pick-beta-users: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n");
    return 2;
  }
  const days = arg(argv, "days", 14);
  const min = arg(argv, "min", 20);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const answers: AnswerRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db.from("answer_history").select("user_id, created_at")
      .gte("created_at", since).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { process.stderr.write(`pick-beta-users: answer_history read failed (${error.code ?? "unknown"}).\n`); return 1; }
    answers.push(...((data ?? []) as AnswerRow[]));
    if (!data || data.length < PAGE) break;
    if (from + PAGE >= MAX_ROWS) { process.stderr.write("pick-beta-users: row cap reached; counts would be short, refusing.\n"); return 1; }
  }

  const ids = [...new Set(answers.map((a) => a.user_id).filter((v): v is string => Boolean(v)))];
  const users: UserRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("users").select("id, role, tier, email").in("id", ids.slice(i, i + 200));
    if (error) { process.stderr.write(`pick-beta-users: users read failed (${error.code ?? "unknown"}).\n`); return 1; }
    users.push(...((data ?? []) as UserRow[]));
  }

  const extra = [process.env.MEDPRUEF_ADMIN_EMAIL, process.env.MEDPRUEF_TEST_USER_EMAIL].filter((v): v is string => Boolean(v));
  const picked = pickCandidates(answers, users, min, extra);
  process.stdout.write(`# mentor beta candidates: >= ${min} answers in the last ${days} days (since ${since}), admins and test accounts excluded\n`);
  process.stdout.write("user_id\tanswers\tactive_days\tlast_answer_at\n");
  for (const c of picked) process.stdout.write(`${c.user_id}\t${c.answers}\t${c.active_days}\t${c.last_answer_at}\n`);
  process.stdout.write(`# ${picked.length} candidates\n`);
  return 0;
}

const invoked = process.argv[1] ? path.basename(process.argv[1]).startsWith("pick-beta-users") : false;
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`pick-beta-users: ${String((err as Error)?.message ?? err)}\n`); process.exit(2); },
  );
}
