/**
 * Cram part plan count for the Monday scoreboard (a-cram-part-plan).
 * READ-ONLY. Counts, never ids, addresses or names.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/cram-part-plan-count.ts -- [--days 14] [--json]
 *
 * Cohort (n): learners (staff and test accounts left out with the shared
 * money rule) whose saved exam date is a future SIP4a or SIP5a sitting of the
 * Kenntnisprüfung bank. Each line is k of n:
 *   - part plan: the saved row resolves to one part (resolveCramPart; same-date
 *     and window_unconfirmed rows keep the all-subject plan),
 *   - viewed: a cram_plan_view with part sip4|sip5 in the window,
 *   - part run: at least one completed kp_sip4 / kp_sip5 run in the window,
 *   - checkout opened / paid: checkout_session_created / grant_succeeded in
 *     the window, overall and split by "with a part run".
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment, else .env.local).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { OFFICIAL_SITTINGS, viennaToday } from "@/lib/exam-dates";
import { CRAM_PRESET_IDS, resolveCramPart } from "@/lib/cram-part-plan";
import { isoDayOf } from "@/lib/journey/moments";

export interface CohortUser { id: string; exam_date: string | null; active_exam: string | null; email: string | null; role: string | null; tier: string | null }

export interface CramCount {
  days: number;
  cohort: number;
  partPlan: number;
  viewedPartPlan: number;
  withPartRun: number;
  checkoutOpened: number;
  paid: number;
  checkoutOpenedWithRun: number;
  paidWithRun: number;
}

/** Future SIP4a / SIP5a sitting dates (and exam-week last days) at `now`. */
export function futureSipDays(now: Date): Set<string> {
  const today = viennaToday(now);
  const out = new Set<string>();
  for (const s of OFFICIAL_SITTINGS) {
    if (s.exam_key !== "sip4a" && s.exam_key !== "sip5a") continue;
    if (s.date > today) out.add(s.date);
    if (s.date_end && s.date_end > today) out.add(s.date_end);
  }
  return out;
}

/** k of n per line; every set holds learner ids already limited to the window. */
export function summarize(
  users: readonly CohortUser[],
  sets: { viewedPart: ReadonlySet<string>; partRun: ReadonlySet<string>; checkout: ReadonlySet<string>; paid: ReadonlySet<string> },
  days: number,
  now: Date,
): CramCount {
  const sip = futureSipDays(now);
  const cohort = users.filter((u) => {
    const day = isoDayOf(u.exam_date);
    return u.active_exam === "kenntnispruefung" && !!day && sip.has(day) && !isStaffOrTestAccount(u);
  });
  const ids = cohort.map((u) => u.id);
  const count = (s: ReadonlySet<string>, within: readonly string[] = ids) => within.filter((id) => s.has(id)).length;
  const withRun = ids.filter((id) => sets.partRun.has(id));
  return {
    days,
    cohort: cohort.length,
    partPlan: cohort.filter((u) => resolveCramPart({ examDate: u.exam_date, activeExam: u.active_exam }, now) !== null).length,
    viewedPartPlan: count(sets.viewedPart),
    withPartRun: withRun.length,
    checkoutOpened: count(sets.checkout),
    paid: count(sets.paid),
    checkoutOpenedWithRun: count(sets.checkout, withRun),
    paidWithRun: count(sets.paid, withRun),
  };
}

export function formatCount(c: CramCount): string {
  const n = c.cohort;
  return [
    `cram part plan, last ${c.days} days: ${n} learners with a future SIP4a or SIP5a sitting`,
    `  part plan ${c.partPlan} of ${n}, viewed a part plan ${c.viewedPartPlan} of ${n}, at least one part run ${c.withPartRun} of ${n}`,
    `  checkout opened ${c.checkoutOpened} of ${n}, paid ${c.paid} of ${n}`,
    `  with a part run: checkout opened ${c.checkoutOpenedWithRun} of ${c.withPartRun}, paid ${c.paidWithRun} of ${c.withPartRun}`,
  ].join("\n");
}

function loadEnv(): void {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const json = args.includes("--json");
  const di = args.indexOf("--days");
  const days = di >= 0 ? Number(args[di + 1]) : 14;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("--days must be 1 to 90");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const today = viennaToday(now);
  const CAP = 20_000;

  // Learners with a saved future date in the Kenntnisprüfung bank (paged, bounded).
  const users: CohortUser[] = [];
  for (let from = 0; ; from += 1000) {
    if (from >= CAP) throw new Error(`more than ${CAP} learners with a future date`);
    const { data, error } = await db.from("users").select("id, exam_date, active_exam, email, role, tier")
      .eq("active_exam", "kenntnispruefung").gt("exam_date", today).order("id").range(from, from + 999);
    if (error) throw new Error("users read failed");
    users.push(...((data ?? []) as CohortUser[]));
    if (!data || data.length < 1000) break;
  }
  const sip = futureSipDays(now);
  const ids = users.filter((u) => { const d = isoDayOf(u.exam_date); return !!d && sip.has(d); }).map((u) => u.id);

  const viewedPart = new Set<string>();
  const partRun = new Set<string>();
  const checkout = new Set<string>();
  const paid = new Set<string>();
  // Every read pages with range() (the server caps a request at 1,000 rows) and stops at CAP.
  type Row = Record<string, unknown>;
  async function paged(what: string, build: (from: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      if (from >= CAP) throw new Error(`more than ${CAP} ${what} rows: narrow --days`);
      const { data, error } = await build(from);
      if (error) throw new Error(`${what} read failed`);
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) return out;
    }
  }
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const views = await paged("user_events", (from) => db.from("user_events").select("id, user_id, event_data").eq("event_type", "cram_plan_view")
      .gte("created_at", since).in("user_id", chunk).order("id").range(from, from + 999));
    for (const v of views) {
      const part = (v.event_data as Record<string, unknown> | null)?.part;
      if (part === "sip4" || part === "sip5") viewedPart.add(String(v.user_id));
    }
    const runs = await paged("exam_simulations", (from) => db.from("exam_simulations").select("id, user_id").eq("status", "completed")
      .in("config->>presetId", [...CRAM_PRESET_IDS]).gte("completed_at", since).in("user_id", chunk).order("id").range(from, from + 999));
    for (const r of runs) partRun.add(String(r.user_id));
    const pay = await paged("payment_events", (from) => db.from("payment_events").select("id, user_id, event").in("event", ["checkout_session_created", "grant_succeeded"])
      .gte("created_at", since).in("user_id", chunk).order("id").range(from, from + 999));
    for (const p of pay) (p.event === "grant_succeeded" ? paid : checkout).add(String(p.user_id));
  }
  const out = summarize(users, { viewedPart, partRun, checkout, paid }, days, now);
  console.log(json ? JSON.stringify(out) : formatCount(out));
}

if (process.argv[1]?.endsWith("cram-part-plan-count.ts")) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
