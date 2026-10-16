/**
 * Day-2 and day-7 return by segment (a-activation-48h). Read-only report for
 * the Growth Analyst and the HQ; definitions in src/lib/activation/return-metrics.ts.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/activation/return-by-segment.ts -- [--days 180] [--out file.json]
 *
 * Reads users (created in the window), their answer_history rows of the first
 * 9 days and their activation_step user_events; staff and test accounts are
 * left out (isStaffOrTestAccount). Prints counts per group only: never an id,
 * an address or a name. No write. Needs NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (environment, else .env.local).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { viennaDay } from "@/lib/home-study-core";
import { getLearnerMoments } from "@/lib/journey/moments";
import { activationSegment } from "@/lib/activation/rules";
import { returnBySegment, type CohortLearner } from "@/lib/activation/return-metrics";

const PAGE = 1000;
const MAX_PAGES = 200; // recursion guard: at most 200k rows per read
const CHUNK = 100;

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

type Sb = SupabaseClient;

async function paged<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await read(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`more than ${MAX_PAGES * PAGE} rows; narrow --days`);
}

interface UserRow {
  id: string; email: string | null; role: string | null; tier: string | null; created_at: string;
  active_exam: string | null; exam_date: string | null; language_code: string | null;
  onboarding_completed_at: string | null; telegram_id: number | string | null;
}

async function readCohort(sb: Sb, since: Date, now: Date): Promise<CohortLearner[]> {
  const users = (await paged<UserRow>((a, b) => sb.from("users")
    .select("id,email,role,tier,created_at,active_exam,exam_date,language_code,onboarding_completed_at,telegram_id")
    .gte("created_at", since.toISOString()).order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b)))
    .filter((u) => !isStaffOrTestAccount(u));
  const byId = new Map(users.map((u) => [u.id, u]));
  const answers = new Map<string, Record<string, number>>();
  const steps = new Map<string, Set<string>>();
  const ids = [...byId.keys()];
  const lastSignup = users.reduce((m, u) => Math.max(m, Date.parse(u.created_at)), since.getTime());
  const until = new Date(Math.min(now.getTime(), lastSignup + 9 * 86_400_000)).toISOString();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await paged<{ user_id: string; created_at: string }>((a, b) => sb.from("answer_history")
      .select("user_id,created_at").in("user_id", chunk).gte("created_at", since.toISOString()).lte("created_at", until).order("id", { ascending: true }).range(a, b));
    for (const r of rows) {
      const u = byId.get(r.user_id);
      if (!u) continue;
      // Only the first 9 days after signup matter here.
      if (Date.parse(r.created_at) - Date.parse(u.created_at) > 9 * 86_400_000) continue;
      const day = viennaDay(new Date(r.created_at));
      const m = answers.get(r.user_id) ?? {};
      m[day] = (m[day] ?? 0) + 1;
      answers.set(r.user_id, m);
    }
    const ev = await paged<{ user_id: string; event_data: { step?: unknown } | null }>((a, b) => sb.from("user_events")
      .select("user_id,event_data").in("user_id", chunk).eq("event_type", "activation_step").order("id", { ascending: true }).range(a, b));
    for (const e of ev) {
      const step = typeof e.event_data?.step === "string" ? e.event_data.step : null;
      if (!step) continue;
      const set = steps.get(e.user_id) ?? new Set<string>();
      set.add(step);
      steps.set(e.user_id, set);
    }
  }
  return users.map((u) => {
    const named = getLearnerMoments({ examDate: u.exam_date, activeExam: u.active_exam }, now).named;
    return {
      signupDay: viennaDay(new Date(u.created_at)),
      segment: activationSegment(named?.segment ?? null, u.active_exam),
      lang: (u.language_code ?? "unknown").slice(0, 2) || "unknown",
      hasDate: Boolean(u.exam_date),
      onboarded: Boolean(u.onboarding_completed_at),
      telegram: u.telegram_id !== null && u.telegram_id !== undefined,
      answersByDay: answers.get(u.id) ?? {},
      steps: [...(steps.get(u.id) ?? [])],
    };
  });
}

async function main(argv: string[]): Promise<void> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1]) : 180;
  if (!Number.isInteger(days) || days < 9 || days > 730) throw new Error("--days must be 9..730");
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const learners = await readCohort(sb, since, now);
  const report = {
    read_at: now.toISOString(),
    today_vienna: viennaDay(now),
    window_days: days,
    definitions: "Vienna days, day 0 = signup day. returned_day2: an answer on day 1 or 2. returned_week1: an answer on days 3 to 7. Day-2 denominators need signup day <= today-3, week-1 denominators <= today-8. Segment: the official sitting named by users.exam_date as of the read (a sitting past its results window drops back to the bank).",
    rows: returnBySegment(learners, viennaDay(now)),
  };
  const json = JSON.stringify(report, null, 2);
  const oi = argv.indexOf("--out");
  if (oi >= 0 && argv[oi + 1]) writeFileSync(argv[oi + 1], json + "\n");
  console.log(json);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
