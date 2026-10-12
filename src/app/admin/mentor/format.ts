/**
 * Mentor admin cost view: pure formatting helpers (W3-COSTVIEW).
 * Money in the admin view is micro-USD of true API cost. Learners never see
 * dollars; only this admin page does.
 */

import { CREDIT_MICRO_USD } from "@/lib/mentor/config";

/** "$0.0023", "$12.40": 4 decimals under $1, 2 from $1 up. Never NaN, never negative or "-0". */
export function formatUsd(micro: number): string {
  const v = Number.isFinite(micro) && micro > 0 ? micro / 1_000_000 : 0;
  const digits = Math.abs(v) < 1 ? 4 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Credits at the display ratio (1 credit = 5,000 micro-USD), one decimal. */
export function formatCredits(micro: number): string {
  const c = Number.isFinite(micro) && micro > 0 ? micro / CREDIT_MICRO_USD : 0;
  return c.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** 12_345 -> "12.3k", 1_200_000 -> "1.2M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatPct(pct: number): string {
  return `${Number.isFinite(pct) ? pct.toFixed(1) : "0.0"}%`;
}

/** First 8 characters of an id: enough to look up, short enough to scan. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** "5 d", "3 h 20 m", "42 m" for a stale-hold age in minutes. */
export function formatAge(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "0 m";
  if (minutes >= 1_440) return `${Math.floor(minutes / 1_440)} d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${Math.floor(minutes % 60)} m`;
  return `${Math.floor(minutes)} m`;
}

/** Expired and unused credit of a package: granted minus spent, clawed back and still live. */
export function expiredUnusedMicro(row: {
  granted_micro: number;
  spent_micro: number;
  clawed_back_micro: number;
  live_remaining_micro: number;
}): number {
  return Math.max(row.granted_micro - row.spent_micro - row.clawed_back_micro - row.live_remaining_micro, 0);
}

/** "2026-10-07" -> "07" for chart axis labels. */
export function dayOfMonth(day: string): string {
  return day.slice(8, 10);
}

export const PACKAGE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  mentor_basis: "Mentor Basis (sold)",
  mentor_plus: "Mentor Plus (sold)",
  mentor_topup: "Top-up (sold)",
  included_pro_monthly: "Pro monthly (included)",
  included_pro_quarterly: "Pro quarterly (included)",
  included_cohort: "Cohort (included)",
  trial_taste: "Trial taste",
  gift_admin: "Admin gift",
  referral_reward: "Referral reward",
  included_admin: "Admin (included)",
  included_unknown: "Unknown paid tier",
  free: "Free",
  free_taste: "Free taste (5 credits)",
  beta_grant: "Beta grant",
});
