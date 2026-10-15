/**
 * Admin view of free mentor credit grants (a-free-credit-hooks): every lot of
 * a house-funded source this Vienna month, counted per kind against its
 * breaker, plus the newest rows. "Every grant logged and visible in /admin":
 * the lots and their ledger 'grant' rows are the log; this is the window.
 * Counts and 8-character account ids only. Server only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { viennaMonthStart } from "@/lib/vienna-month";
import { creditsFromMicro } from "../config";
import type { FreeCreditConfig } from "./free-credits";

export const FREE_GRANT_SOURCES = ["welcome_taste", "campaign_code", "experience_reward", "referral_reward", "trial_taste", "free_taste", "pro_included"] as const;

export type FreeGrantKind = "welcome" | "campaign" | "experience" | "referral_first_charge" | "referral_trial_start" | "referral_exam" | "trial" | "free_taste" | "included";

export function grantKind(source: string, sourceId: string): FreeGrantKind | null {
  switch (source) {
    case "welcome_taste": return "welcome";
    case "campaign_code": return "campaign";
    case "experience_reward": return "experience";
    case "trial_taste": return "trial";
    case "free_taste": return "free_taste";
    case "pro_included": return "included";
    case "referral_reward":
      return sourceId.startsWith("first_charge:") ? "referral_first_charge" : sourceId.startsWith("trial_start:") ? "referral_trial_start" : "referral_exam";
    default: return null;
  }
}

export interface FreeGrantRow { source: string; source_id: string; user_id: string; granted_micro: number; created_at: string; expires_at: string; status: string }

export interface FreeGrantSummary {
  month_start: string;
  counts: Record<FreeGrantKind, { lots: number; credits: number }>;
  /** Breakers that apply per month across all accounts (null = none; referral caps are per referrer). */
  caps: { welcome: number };
  flags: Record<string, boolean | string>;
  recent: Array<{ kind: FreeGrantKind; account: string; credits: number; created_at: string; expires_at: string; status: string }>;
  truncated: boolean;
}

const KINDS: FreeGrantKind[] = ["welcome", "campaign", "experience", "referral_first_charge", "referral_trial_start", "referral_exam", "trial", "free_taste", "included"];

export function summarizeFreeGrants(rows: FreeGrantRow[], fc: FreeCreditConfig, monthStart: Date, truncated: boolean): FreeGrantSummary {
  const counts = Object.fromEntries(KINDS.map((k) => [k, { lots: 0, credits: 0 }])) as FreeGrantSummary["counts"];
  const recent: FreeGrantSummary["recent"] = [];
  for (const r of rows) {
    const kind = grantKind(r.source, r.source_id);
    if (!kind) continue;
    counts[kind].lots++;
    counts[kind].credits += creditsFromMicro(Number(r.granted_micro));
    if (recent.length < 50) recent.push({ kind, account: String(r.user_id).slice(0, 8), credits: creditsFromMicro(Number(r.granted_micro)), created_at: r.created_at, expires_at: r.expires_at, status: r.status });
  }
  return {
    month_start: monthStart.toISOString(),
    counts,
    caps: { welcome: fc.welcomeMonthlyCap },
    flags: {
      MENTOR_HOUSE_GRANTS_SCOPE: fc.houseGrantsScope,
      MENTOR_INCLUDED_RAISE_ENABLED: fc.includedRaise,
      MENTOR_WELCOME_ENABLED: fc.welcomeEnabled,
      REFERRAL_MENTOR_RAISE_ENABLED: fc.referralRaise,
      REFERRAL_TRIAL_START_CREDITS_ENABLED: fc.referralTrialStartEnabled,
      MENTOR_EXPERIENCE_REWARD_ENABLED: fc.experienceEnabled,
      MENTOR_CAMPAIGN_CODES_ENABLED: fc.campaignEnabled,
    },
    recent,
    truncated,
  };
}

const PAGE = 1000;
const MAX_ROWS = 5000;

/** This Vienna month's free-source lots, newest first, paged past the 1000-row cap. Throws on a read error. */
export async function loadFreeGrantSummary(sb: Pick<SupabaseClient, "from">, fc: FreeCreditConfig, now: Date): Promise<FreeGrantSummary> {
  const monthStart = viennaMonthStart(now);
  const rows: FreeGrantRow[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("ai_credit_lot").select("source, source_id, user_id, granted_micro, created_at, expires_at, status")
      .in("source", [...FREE_GRANT_SOURCES]).gte("created_at", monthStart.toISOString())
      .order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw new Error(`free grant read failed: ${error.code ?? "unknown"}`);
    const page = (data ?? []) as FreeGrantRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    if (rows.length >= MAX_ROWS) { truncated = true; break; }
  }
  return summarizeFreeGrants(rows, fc, monthStart, truncated);
}
