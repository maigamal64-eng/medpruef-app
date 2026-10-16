/**
 * Code front door (a-code-front-door): read-only per-code counts for the
 * Monday scoreboard (X1, X2, X7, X9 per code instead of "not evaluated").
 *
 *   node_modules/.bin/vite-node scripts/growth/code-counts.ts -- [--days 30] [--out file.json]
 *
 * Reads three event streams and one table with service-role SELECTs only; no
 * write, no send. Prints codes (not personal ids): per code entered,
 * signups, redeemed by kind and payers after. Needs NEXT_PUBLIC_SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY (environment, else .env.local). A guard
 * variable stops a script that re-invokes itself.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { foldCodeCounts, type EnteredRow, type RedeemRow, type SignupRow } from "@/lib/code-entry/counts";

const PAGE = 1000;
const MAX_PAGES = 50;

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await read(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(`read failed: ${error.message ?? "unknown"}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
  throw new Error("read truncated: more than 50 pages, narrow --days");
}

async function collect(sb: SupabaseClient, sinceIso: string) {
  const entered = (await pageAll<{ metadata: Record<string, unknown> | null }>((a, b) =>
    sb.from("user_activity_log").select("metadata").eq("event_type", "funnel_code_entered_pre_signup").gte("created_at", sinceIso).order("created_at").range(a, b)))
    .map((r): EnteredRow => ({ code: String(r.metadata?.code ?? ""), automation: r.metadata?.ua_class === "automation" }));
  const signups = (await pageAll<{ event_data: { attribution?: { utm_source?: string; utm_campaign?: string } } | null }>((a, b) =>
    sb.from("user_events").select("event_data").eq("event_type", "user_registered").gte("created_at", sinceIso).order("created_at").range(a, b)))
    .filter((r) => r.event_data?.attribution?.utm_source === "code")
    .map((r): SignupRow => ({ code: String(r.event_data?.attribution?.utm_campaign ?? "") }));
  const redeemed = (await pageAll<{ user_id: string; created_at: string; event_data: { code?: string; kind?: string } | null }>((a, b) =>
    sb.from("user_events").select("user_id, created_at, event_data").eq("event_type", "code_redeemed").gte("created_at", sinceIso).order("created_at").range(a, b)))
    .map((r): RedeemRow => ({ code: String(r.event_data?.code ?? ""), kind: String(r.event_data?.kind ?? "unknown"), user_id: r.user_id, at: r.created_at }));
  const paidAt = new Map<string, number[]>();
  const ids = [...new Set(redeemed.map((r) => r.user_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("subscriptions").select("user_id, created_at").in("user_id", ids.slice(i, i + 200)).gt("amount_cents", 0).in("status", ["active", "expired", "cancelled"]);
    if (error) throw new Error(`payer read failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ user_id: string; created_at: string | null }>) {
      const t = r.created_at ? Date.parse(r.created_at) : NaN;
      if (Number.isFinite(t)) paidAt.set(r.user_id, [...(paidAt.get(r.user_id) ?? []), t]);
    }
  }
  return foldCodeCounts(entered, signups, redeemed, paidAt);
}

async function main(argv: string[]): Promise<void> {
  if (process.env.MEDPRUEF_CODE_COUNTS_RUNNING === "1") throw new Error("recursion guard: code-counts is already running");
  process.env.MEDPRUEF_CODE_COUNTS_RUNNING = "1";
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1]) : 30;
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error("--days must be 1 to 365");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const counts = await collect(sb, new Date(Date.now() - days * 86_400_000).toISOString());
  const json = JSON.stringify({ window_days: days, generated_at: new Date().toISOString(), codes: counts }, null, 2);
  const oi = argv.indexOf("--out");
  if (oi >= 0 && argv[oi + 1]) writeFileSync(argv[oi + 1], json + "\n");
  console.log(json);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
