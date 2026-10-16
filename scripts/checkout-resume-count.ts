/**
 * Checkout resume count for the Monday scoreboard (a-checkout-resume).
 * READ-ONLY. Counts, never ids, addresses or names.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/checkout-resume-count.ts -- [--days 7] [--json]
 *
 * Output: learners shown the card, learners who tapped (opened plan, cheaper
 * plan, support), and learners with a grant_succeeded after their first view.
 * Staff and test accounts are left out with the shared money rule.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment, else .env.local).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { RESUME_WINDOW_MS, resumeExcludedIds } from "@/lib/checkout-resume";

export interface EventRow { user_id: string | null; event_type: string; event_data: Record<string, unknown> | null; created_at: string }
export interface GrantRow { user_id: string | null; created_at: string }

export interface ResumeCount {
  days: number;
  shown: number;
  clicked: number;
  clickedOpened: number;
  clickedCheaper: number;
  clickedSupport: number;
  paidAfterShown: number;
}

/** Distinct learners per step; a grant counts only within the card's 14-day window after that learner's first view. */
export function summarize(events: EventRow[], grants: GrantRow[], days: number, excluded: ReadonlySet<string> = new Set()): ResumeCount {
  const firstShown = new Map<string, number>();
  const clicked = new Set<string>();
  const byTarget: Record<string, Set<string>> = { opened: new Set(), cheaper: new Set(), support: new Set() };
  for (const e of events) {
    if (!e.user_id || excluded.has(e.user_id)) continue;
    const at = Date.parse(e.created_at);
    if (e.event_type === "checkout_resume_shown") {
      const prev = firstShown.get(e.user_id);
      if (prev === undefined || at < prev) firstShown.set(e.user_id, at);
    } else if (e.event_type === "checkout_resume_click") {
      clicked.add(e.user_id);
      const target = String(e.event_data?.target ?? "");
      byTarget[target]?.add(e.user_id);
    }
  }
  const paid = new Set<string>();
  for (const g of grants) {
    if (!g.user_id) continue;
    const first = firstShown.get(g.user_id);
    const at = Date.parse(g.created_at);
    if (first !== undefined && at >= first && at - first <= RESUME_WINDOW_MS) paid.add(g.user_id);
  }
  return {
    days, shown: firstShown.size, clicked: clicked.size,
    clickedOpened: byTarget.opened.size, clickedCheaper: byTarget.cheaper.size, clickedSupport: byTarget.support.size,
    paidAfterShown: paid.size,
  };
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
  const days = di >= 0 ? Number(args[di + 1]) : 7;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("--days must be 1 to 90");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const events: EventRow[] = [];
  const CAP = 20_000;
  for (let from = 0; ; from += 1000) {
    if (from >= CAP) throw new Error(`more than ${CAP} card events in range: narrow --days`);
    const { data, error } = await db.from("user_events").select("id, user_id, event_type, event_data, created_at")
      .in("event_type", ["checkout_resume_shown", "checkout_resume_click"]).gte("created_at", since).order("created_at").order("id").range(from, from + 999);
    if (error) throw new Error("user_events read failed");
    events.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(events.map((e) => e.user_id).filter((x): x is string => !!x))];
  const excluded = new Set<string>(resumeExcludedIds());
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("users").select("id, email, role, tier").in("id", ids.slice(i, i + 100));
    if (error) throw new Error("users read failed");
    for (const u of data ?? []) if (isStaffOrTestAccount(u as { email: string | null; role: string | null; tier: string | null })) excluded.add(u.id as string);
  }
  const grants: GrantRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("payment_events").select("user_id, created_at").eq("event", "grant_succeeded").gte("created_at", since).in("user_id", ids.slice(i, i + 100));
    if (error) throw new Error("payment_events read failed");
    grants.push(...((data ?? []) as GrantRow[]));
  }
  const out = summarize(events, grants, days, excluded);
  console.log(json ? JSON.stringify(out) : `checkout resume, last ${days} days: shown ${out.shown}, tapped ${out.clicked} (opened plan ${out.clickedOpened}, cheaper plan ${out.clickedCheaper}, support ${out.clickedSupport}), paid after view ${out.paidAfterShown}`);
}

if (process.argv[1]?.endsWith("checkout-resume-count.ts")) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
