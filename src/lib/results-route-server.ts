/**
 * Server reads and writes for the results-day route (a-results-route). Used by
 * GET/POST /api/results-route only. Reads the learner's exam facts, whether
 * they were active before a window sitting, their stored answers
 * (user_events `result_reported`) and, only while the experience reward is
 * on, whether the testimonial ask can still reach them. Nothing here reads
 * feedback text or grants credits.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { EXAM_FORMAT_DATA } from "./exam-formats";
import { readFreeCreditConfig, experienceRewardSourceId } from "./mentor/credits/free-credits";
import { TESTIMONIAL_KIND, readExperienceEligibility } from "./mentor/credits/experience";
import {
  RESULT_EVENT,
  activeBeforeRange,
  candidateSittings,
  isOutcomeFor,
  kindOf,
  resultsWindowSittings,
  routeFor,
  shouldAsk,
  type RouteFlags,
  type RouteKind,
  type RoutePlan,
  type RouteSitting,
  type StoredAnswer,
} from "./results-route";

type Db = Pick<SupabaseClient, "from">;

/** The one official page the route links (MedUni Wien, Nostrifizierung, Prüfungen). */
export const OFFICIAL_SOURCE_ID = "source-15";

export function officialLink(): { url: string; label: string } {
  const s = EXAM_FORMAT_DATA.sources[OFFICIAL_SOURCE_ID];
  return { url: s.url, label: s.label };
}

export interface LearnerSitting {
  sitting: RouteSitting;
  kind: RouteKind;
}

/**
 * The window sittings this learner is asked about: a stored exam date naming
 * one wins, otherwise the active bank's sittings; either way kept only when
 * the learner answered at least one question in the 90 days before the
 * sitting (Vienna days), so a self-set date alone never opens the question.
 */
export async function learnerSittings(sb: Db, userId: string, now: Date): Promise<{ rows: LearnerSitting[]; referralsEnabled: boolean }> {
  const window = resultsWindowSittings(now);
  if (window.length === 0) return { rows: [], referralsEnabled: false };
  const { data: user, error } = await sb.from("users").select("exam_date, active_exam, referrals_enabled").eq("id", userId).maybeSingle();
  if (error) throw error;
  const u = (user ?? {}) as { exam_date?: string | null; active_exam?: string | null; referrals_enabled?: boolean | null };
  const { rows } = candidateSittings({ examDate: u.exam_date ?? null, activeExam: u.active_exam ?? null }, window);
  const checks = await Promise.all(rows.map(async (s) => {
    const r = activeBeforeRange(s);
    const { data, error: e } = await sb.from("answer_history").select("id").eq("user_id", userId).gte("created_at", r.from).lt("created_at", r.before).limit(1);
    if (e) throw e;
    return (data ?? []).length > 0;
  }));
  const kept = rows.filter((_, i) => checks[i]);
  return { rows: kept.map((sitting) => ({ sitting, kind: kindOf(sitting.exam_key) })), referralsEnabled: u.referrals_enabled === true };
}

/** Latest stored answer per sitting key (newest event wins; one read per key). */
export async function latestAnswers(sb: Db, userId: string, keys: readonly string[]): Promise<Map<string, StoredAnswer>> {
  const out = new Map<string, StoredAnswer>();
  const rows = await Promise.all(keys.map(async (key) => {
    const { data, error } = await sb.from("user_events").select("event_data, created_at").eq("user_id", userId).eq("event_type", RESULT_EVENT)
      .eq("event_data->>sitting_key", key).order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    return [key, ((data ?? []) as Array<{ event_data: Record<string, unknown> | null; created_at: string }>)[0]] as const;
  }));
  for (const [key, row] of rows) {
    const outcome = row?.event_data?.outcome;
    if (!row || typeof outcome !== "string") continue;
    const kind = row.event_data?.exam_key === "stichprobentest" ? "spt" : "sip";
    if (!isOutcomeFor(kind, outcome)) continue;
    out.set(key, { sitting_key: key, outcome, at: row.created_at });
  }
  return out;
}

/** Can the testimonial ask still reach this learner? Reads only while the experience reward is on. */
export async function testimonialOpen(sb: Db, userId: string): Promise<boolean> {
  if (!readFreeCreditConfig().experienceEnabled) return false;
  const [sent, lot, eligibility] = await Promise.all([
    sb.from("user_feedback").select("id").eq("user_id", userId).eq("context->>kind", TESTIMONIAL_KIND).limit(1),
    sb.from("ai_credit_lot").select("id").eq("source", "experience_reward").eq("source_id", experienceRewardSourceId(userId)).limit(1),
    readExperienceEligibility(sb, userId),
  ]);
  if (sent.error) throw sent.error;
  if (lot.error) throw lot.error;
  return eligibility.meetsBar && (sent.data ?? []).length === 0 && (lot.data ?? []).length === 0;
}

export interface SittingState {
  key: string;
  exam_key: RouteSitting["exam_key"];
  kind: RouteKind;
  label: { de: string; en: string };
  date: string;
  ask: boolean;
  answer: StoredAnswer | null;
  plan: RoutePlan | null;
}

export function sittingState(s: LearnerSitting, answer: StoredAnswer | null, flags: RouteFlags, now: Date): SittingState {
  return {
    key: s.sitting.key,
    exam_key: s.sitting.exam_key,
    kind: s.kind,
    label: s.sitting.label,
    date: s.sitting.date,
    ask: shouldAsk(answer, now),
    answer,
    plan: answer ? routeFor(answer.outcome, flags) : null,
  };
}
