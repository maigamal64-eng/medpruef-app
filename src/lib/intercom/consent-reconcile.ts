/**
 * Catch-up for the Intercom consent mirror (a-intercom-marketing-consent).
 * Every account that ever decided (marketing_consent_at set) is mirrored once
 * more with trigger "reconcile": opt-outs first (removals never wait behind
 * opt-ins), then opt-ins, where a withdrawal made at Intercom is pulled back
 * into our database instead of being overwritten. Covers contacts created
 * after the tick and any failed mirror; meant to run daily once the mirror is
 * on. Dry run lists uid8 and the planned state only. Apply stops after 3
 * failed or unreadable rows in a row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { mirrorMarketingConsent, type MirrorOutcome, type MirrorDeps } from "./marketing-subscription";
import { uid8 } from "./api";

export const RECONCILE_MAX_BATCH = 50;
export const RECONCILE_MAX_LIMIT = 2000;

export interface ReconcileRow { uid8: string; planned: "opt_in" | "opt_out"; outcome: MirrorOutcome | "dry_run" }

export interface ReconcileOptions {
  apply: boolean;
  batch: number;
  limit: number;
  pauseMs?: number;
  mirror?: (sb: SupabaseClient, userId: string, deps?: MirrorDeps) => Promise<MirrorOutcome>;
  sleep?: (ms: number) => Promise<void>;
  onRow?: (row: ReconcileRow) => void;
}

export interface ReconcileSummary { read: number; rows: ReconcileRow[]; stopped: string | null }

export async function reconcileMarketingConsent(sb: SupabaseClient, opts: ReconcileOptions): Promise<ReconcileSummary> {
  const batch = Math.min(Math.max(1, Math.floor(opts.batch)), RECONCILE_MAX_BATCH);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit)), RECONCILE_MAX_LIMIT);
  const mirror = opts.mirror ?? mirrorMarketingConsent;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rows: ReconcileRow[] = [];
  let failedInRow = 0;
  for (const optIn of [false, true]) {
    let after = "00000000-0000-0000-0000-000000000000";
    while (rows.length < limit) {
      const { data, error } = await sb
        .from("users")
        .select("id, marketing_opt_in")
        .not("marketing_consent_at", "is", null)
        .eq("marketing_opt_in", optIn)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(Math.min(batch, limit - rows.length));
      if (error) return { read: rows.length, rows, stopped: "users read failed" };
      const page = (data ?? []) as Array<{ id: string; marketing_opt_in: boolean }>;
      if (page.length === 0) break;
      for (const u of page) {
        const planned = u.marketing_opt_in === true ? "opt_in" : "opt_out";
        const outcome = opts.apply ? await mirror(sb, u.id, { trigger: "reconcile" }) : "dry_run";
        const row: ReconcileRow = { uid8: uid8(u.id), planned, outcome };
        rows.push(row);
        opts.onRow?.(row);
        failedInRow = outcome === "failed" || outcome === "consent_unreadable" ? failedInRow + 1 : 0;
        if (failedInRow >= 3) return { read: rows.length, rows, stopped: "3 failures in a row" };
        // No config at all, or the type is not live: every further row would
        // do the same. "attach_off" continues: withdrawals are still pulled back.
        if (outcome === "off" || outcome === "type_not_live") return { read: rows.length, rows, stopped: `mirror ${outcome}` };
      }
      after = page[page.length - 1].id;
      if (page.length < batch) break;
      if (opts.apply && opts.pauseMs) await sleep(opts.pauseMs);
    }
  }
  return { read: rows.length, rows, stopped: null };
}
