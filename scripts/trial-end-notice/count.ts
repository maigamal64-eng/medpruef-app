/**
 * Reverse-trial end notice count for the Monday scoreboard (a-reverse-trial-end-mail).
 * READ-ONLY. Counts, never ids, addresses or names.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/trial-end-notice/count.ts -- [--days 14] [--json]
 *
 * Output: notices sent (email, telegram), held by reason, and the holdout
 * comparison: learners with a grant_succeeded within 4 days after their
 * notice (sent) versus after their holdout decision (held, reason holdout).
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment, else .env.local).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export interface EventRow { user_id: string | null; event_type: string; event_data: Record<string, unknown> | null; created_at: string }
export interface GrantRow { user_id: string | null; created_at: string }

const PAID_WINDOW_MS = 4 * 86_400_000;

export interface NoticeCount {
  days: number;
  sent: number;
  sentEmail: number;
  sentTelegram: number;
  held: Record<string, number>;
  holdout: number;
  paidAfterSent: number;
  paidAfterHoldout: number;
}

export function summarize(events: EventRow[], grants: GrantRow[], days: number): NoticeCount {
  const sent = new Map<string, number>();
  const holdout = new Map<string, number>();
  const heldByReason: Record<string, Set<string>> = {};
  let email = 0; let telegram = 0;
  for (const e of events) {
    if (!e.user_id) continue;
    const at = Date.parse(e.created_at);
    if (e.event_type === "trial_end_notice_sent") {
      if (!sent.has(e.user_id)) { sent.set(e.user_id, at); if (e.event_data?.channel === "telegram") telegram++; else email++; }
    } else if (e.event_type === "trial_end_notice_held") {
      const reason = String(e.event_data?.reason ?? "unknown");
      (heldByReason[reason] ??= new Set()).add(e.user_id);
      if (reason === "holdout" && !holdout.has(e.user_id)) holdout.set(e.user_id, at);
    }
  }
  const paid = (from: Map<string, number>) => {
    const out = new Set<string>();
    for (const g of grants) {
      const t = g.user_id ? from.get(g.user_id) : undefined;
      const at = Date.parse(g.created_at);
      if (g.user_id && t !== undefined && at >= t && at - t <= PAID_WINDOW_MS) out.add(g.user_id);
    }
    return out.size;
  };
  return {
    days, sent: sent.size, sentEmail: email, sentTelegram: telegram,
    held: Object.fromEntries(Object.entries(heldByReason).map(([k, v]) => [k, v.size])),
    holdout: holdout.size, paidAfterSent: paid(sent), paidAfterHoldout: paid(holdout),
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
  const days = di >= 0 ? Number(args[di + 1]) : 14;
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
    if (from >= CAP) throw new Error(`more than ${CAP} notice events in range: narrow --days`);
    const { data, error } = await db.from("user_events").select("id, user_id, event_type, event_data, created_at")
      .in("event_type", ["trial_end_notice_sent", "trial_end_notice_held"]).gte("created_at", since).order("created_at").order("id").range(from, from + 999);
    if (error) throw new Error("user_events read failed");
    events.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(events.map((e) => e.user_id).filter((x): x is string => !!x))];
  const grants: GrantRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("payment_events").select("user_id, created_at").eq("event", "grant_succeeded").gte("created_at", since).in("user_id", ids.slice(i, i + 100));
    if (error) throw new Error("payment_events read failed");
    grants.push(...((data ?? []) as GrantRow[]));
  }
  const out = summarize(events, grants, days);
  console.log(json ? JSON.stringify(out) : `trial end notice, last ${days} days: sent ${out.sent} (email ${out.sentEmail}, telegram ${out.sentTelegram}), held ${JSON.stringify(out.held)}, paid within 4 days: sent ${out.paidAfterSent}/${out.sent}, holdout ${out.paidAfterHoldout}/${out.holdout}`);
}

if (process.argv[1]?.endsWith("trial-end-notice/count.ts")) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
