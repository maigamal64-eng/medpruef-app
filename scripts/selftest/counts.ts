/**
 * a-public-selftest: read-only counts for the Monday scoreboard.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/selftest/counts.ts -- [--days 7] [--out file.json]
 *
 * Service-role SELECTs only; no write, no send. Prints counts (no ids):
 * arrivals on /selbsttest (landing_hits campaign selbsttest), starts, finishes
 * by score band, register taps (named sitting or open), signups (funnel
 * registration_success with intent selftest; user_registered with first touch
 * selbsttest), accounts that saved (named sitting or open) and of those the
 * accounts that opened a checkout within 14 days of saving. Needs
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment, else
 * .env.local). A guard variable stops a script that re-invokes itself.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CHECKOUT_WINDOW_DAYS, foldSelftestCounts, type FunnelRow } from "@/lib/public-selftest/counts";
import { SELFTEST_SAVED_EVENT } from "@/lib/public-selftest";

const PAGE = 1000;
const MAX_PAGES = 50;
const FUNNEL = ["selftest_start", "selftest_finish", "selftest_register_click", "registration_success"];

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
  const { count: arrivals, error: aErr } = await sb.from("landing_hits").select("*", { count: "exact", head: true }).eq("utm_campaign", "selbsttest").gte("at", sinceIso);
  if (aErr) throw new Error(`arrivals read failed: ${aErr.message}`);
  const funnel = (await pageAll<{ event_type: string; metadata: Record<string, unknown> | null }>((a, b) =>
    sb.from("user_activity_log").select("event_type, metadata").in("event_type", FUNNEL.map((e) => `funnel_${e}`)).gte("created_at", sinceIso).order("created_at").range(a, b)))
    .map((r): FunnelRow => ({ event: r.event_type.replace(/^funnel_/, ""), metadata: r.metadata }));
  const registered = await pageAll<{ event_data: { attribution?: { utm_campaign?: string } } | null }>((a, b) =>
    sb.from("user_events").select("event_data").eq("event_type", "user_registered").gte("created_at", sinceIso).order("created_at").range(a, b));
  const saved = (await pageAll<{ user_id: string; created_at: string; event_data: { sitting?: string } | null }>((a, b) =>
    sb.from("user_events").select("user_id, created_at, event_data").eq("event_type", SELFTEST_SAVED_EVENT).gte("created_at", sinceIso).order("created_at").range(a, b)))
    .map((r) => ({ user_id: r.user_id, at: r.created_at, sitting: String(r.event_data?.sitting ?? "open") }));
  const ids = [...new Set(saved.map((s) => s.user_id))];
  const checkouts: { user_id: string; at: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("payment_events").select("user_id, created_at").eq("event", "checkout_session_created").in("user_id", ids.slice(i, i + 200)).gte("created_at", sinceIso);
    if (error) throw new Error(`checkout read failed: ${error.message}`);
    for (const r of (data ?? []) as { user_id: string; created_at: string }[]) checkouts.push({ user_id: r.user_id, at: r.created_at });
  }
  return foldSelftestCounts({
    arrivals: arrivals ?? 0,
    funnel,
    firstTouchSignups: registered.filter((r) => r.event_data?.attribution?.utm_campaign === "selbsttest").length,
    saved,
    checkouts,
  });
}

async function main(argv: string[]): Promise<void> {
  if (process.env.MEDPRUEF_SELFTEST_COUNTS_RUNNING === "1") throw new Error("recursion guard: selftest counts is already running");
  process.env.MEDPRUEF_SELFTEST_COUNTS_RUNNING = "1";
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1]) : 7;
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error("--days must be 1 to 365");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const counts = await collect(sb, new Date(Date.now() - days * 86_400_000).toISOString());
  const json = JSON.stringify({ window_days: days, checkout_window_days: CHECKOUT_WINDOW_DAYS, generated_at: new Date().toISOString(), counts }, null, 2);
  const oi = argv.indexOf("--out");
  if (oi >= 0 && argv[oi + 1]) writeFileSync(argv[oi + 1], json + "\n");
  console.log(json);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
