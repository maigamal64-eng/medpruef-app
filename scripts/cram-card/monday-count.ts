/**
 * Monday count of the Home cram card (a-cram-card). READ-ONLY: SELECTs only,
 * prints counts as "k of n", never an address, name or full id.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/cram-card/monday-count.ts -- [--out f.json] [--since 2026-10-20] [--days 14]
 *
 * Cohort n = real learners (staff and test accounts excluded) with a
 * cram_card_shown event since --since. Per variant and in total:
 *   shown            n
 *   part_named       sitting_set with source cram_card
 *   plan_opens       cram_card_click target plan
 *   pricing_opens    cram_card_click target pricing
 *   simulation       cram_card_click target simulation
 *   checkout_opens   payment_events checkout_session_created within --days of the first shown
 *   payments         payment_events grant_succeeded within --days of the first shown
 * Each is the number of distinct learners (k) of n. Needs
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";

function loadEnvLocal() {
  const file = path.resolve(".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export interface CramEvent { user_id: string; event_type: string; event_data: Record<string, unknown> | null; created_at: string }
export interface CramPayment { user_id: string | null; event: string; created_at: string }

const COUNTS = ["shown", "part_named", "plan_opens", "pricing_opens", "simulation", "checkout_opens", "payments"] as const;
type CountKey = (typeof COUNTS)[number];
export type CramCounts = Record<CountKey, { k: number; n: number }>;

const DAY = 86_400_000;

/** Pure: the k-of-n table per variant and in total. `real` is the set of learner ids that count. */
export function cramCounts(events: CramEvent[], payments: CramPayment[], real: ReadonlySet<string>, windowDays: number): Record<string, CramCounts> {
  const firstShown = new Map<string, { at: number; variant: string }>();
  for (const e of events) {
    if (e.event_type !== "cram_card_shown" || !real.has(e.user_id)) continue;
    const at = Date.parse(e.created_at);
    const variant = String(e.event_data?.variant ?? "unknown");
    const prev = firstShown.get(e.user_id);
    if (!prev || at < prev.at) firstShown.set(e.user_id, { at, variant });
  }
  const sets: Record<string, Record<CountKey, Set<string>>> = {};
  const bucket = (variant: string) => (sets[variant] ??= Object.fromEntries(COUNTS.map((c) => [c, new Set<string>()])) as Record<CountKey, Set<string>>);
  const mark = (user: string, key: CountKey) => {
    const f = firstShown.get(user);
    if (!f) return;
    bucket(f.variant)[key].add(user);
    bucket("all")[key].add(user);
  };
  for (const [user] of firstShown) mark(user, "shown");
  for (const e of events) {
    if (!firstShown.has(e.user_id)) continue;
    const d = e.event_data ?? {};
    if (e.event_type === "sitting_set" && d.source === "cram_card") mark(e.user_id, "part_named");
    if (e.event_type === "cram_card_click") {
      if (d.target === "plan") mark(e.user_id, "plan_opens");
      if (d.target === "pricing") mark(e.user_id, "pricing_opens");
      if (d.target === "simulation") mark(e.user_id, "simulation");
    }
  }
  for (const p of payments) {
    if (!p.user_id) continue;
    const f = firstShown.get(p.user_id);
    if (!f) continue;
    const at = Date.parse(p.created_at);
    if (at < f.at || at > f.at + windowDays * DAY) continue;
    if (p.event === "checkout_session_created") mark(p.user_id, "checkout_opens");
    if (p.event === "grant_succeeded") mark(p.user_id, "payments");
  }
  bucket("all");
  return Object.fromEntries(Object.entries(sets).map(([variant, s]) => [
    variant,
    Object.fromEntries(COUNTS.map((c) => [c, { k: s[c].size, n: s.shown.size }])) as CramCounts,
  ]));
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error("read failed");
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function realLearners(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const real = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("users").select("id, email, role, tier").in("id", ids.slice(i, i + 100));
    if (error) throw new Error("read failed");
    for (const u of (data ?? []) as Array<{ id: string; email: string | null; role: string | null; tier: string | null }>) {
      if (!isStaffOrTestAccount(u)) real.add(u.id);
    }
  }
  return real;
}

async function main(argv: string[]) {
  if (process.env.CRAM_MONDAY_COUNT_RUNNING === "1") throw new Error("the count is already running in this process tree");
  process.env.CRAM_MONDAY_COUNT_RUNNING = "1";
  loadEnvLocal();
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const since = /^\d{4}-\d{2}-\d{2}$/.test(arg("--since") ?? "") ? (arg("--since") as string) : "2026-10-20";
  const windowDays = Math.max(1, Math.min(60, Number(arg("--days") ?? 14)));
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const sinceIso = `${since}T00:00:00Z`;
  const events = await pageAll<CramEvent>((from, to) =>
    sb.from("user_events").select("user_id, event_type, event_data, created_at")
      .in("event_type", ["cram_card_shown", "cram_card_click", "sitting_set"])
      .gte("created_at", sinceIso).order("created_at", { ascending: true }).range(from, to));
  const shownIds = [...new Set(events.filter((e) => e.event_type === "cram_card_shown").map((e) => e.user_id))];
  const real = await realLearners(sb, shownIds);
  const payments = shownIds.length === 0 ? [] : await pageAll<CramPayment>((from, to) =>
    sb.from("payment_events").select("user_id, event, created_at")
      .in("event", ["checkout_session_created", "grant_succeeded"])
      .gte("created_at", sinceIso).order("created_at", { ascending: true }).range(from, to));
  const counts = cramCounts(events, payments, real, windowDays);
  const report = { read_at: new Date().toISOString(), since, window_days: windowDays, learners_shown: real.size, table: counts };
  const text = JSON.stringify(report, null, 2);
  const out = arg("--out");
  if (out) writeFileSync(out, text + "\n");
  console.log(text);
  for (const [variant, c] of Object.entries(counts)) {
    console.log(`${variant}: ` + COUNTS.map((k) => `${k} ${c[k].k} of ${c[k].n}`).join(", "));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("cram-card", "monday-count.ts"));
if (isMain) {
  main(process.argv.slice(2).filter((a) => a !== "--")).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
