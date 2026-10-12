/**
 * growthMetrics — the GROWTH FUNNEL behind /admin/growth (AUTONOMY.md F-08).
 * Payments and Today own EUROS (money in, paying, refunds); growth owns the
 * top-of-funnel SHAPE — how many real people sign up, activate, get engaged,
 * and (the one number both panels share) pay.
 *
 * The funnel is signups → activated → engaged → paying, each step a count plus
 * its percentage of signups, so the drop-off between stages is visible.
 *
 * WINDOW + SOURCES (a20, ADM-18 A, 2026-10-12): the funnel is a signup cohort,
 * the real users created inside the chosen window (7, 30 or 90 rolling days,
 * or all time; 30 by default), so last week's distribution is visible instead
 * of drowning in the all-time totals. Alongside it, a counts-only Sources
 * table: landing arrivals (landing_hits), cohort signups by their first-touch
 * utm tag (user_registered event, older email signups from user_activity_log)
 * and cohort payers, plus the same per Telegram post campaign. Rules live in
 * ./growth-rules; nothing identifying leaves the server.
 *
 * REAL-USER + PAYING DEFINITIONS (a14, 2026-10-12): owned by ./money-rules and
 * shared with Overview, Payments, the paid roster and the control plane:
 *   - signups   = real users = all accounts minus staff and test accounts
 *                 (isStaffOrTestAccount). Telegram-only accounts have no email
 *                 and stay counted.
 *   - activated = real users with >= 1 answer_history row.
 *   - engaged   = real users with >= 25 answer_history rows.
 *   - paying    = distinct real learners with an active, unexpired real-rail
 *                 subscription AND a positive payment (classifyPayers). A trial
 *                 without a charge is in trial, not paying.
 *
 * ── HOW "engaged" IS COUNTED WITHOUT THE 1000-ROW REST CAP (the method the
 *    task asks to be documented) ──────────────────────────────────────────────
 * answer_history is large and skewed: confirmed on prod (2026-06-23, the
 * 20260623120000_topic_progress_aggregates migration) there are 75 users with
 * answers and 4 of them exceed 1000 rows (1557 / 1508 / 1407 / 1203). A bare
 * `sb.from('answer_history').select('user_id')` is silently capped at 1000 rows
 * server-side (the standing PostgREST ceiling that get_topic_counts /
 * get_user_topic_stats / get_user_topic_progress all exist to dodge), so
 * grouping by user in JS would undercount the heavy users and mis-bucket who is
 * "engaged".
 *
 * We therefore use a COUNT-BASED approach, never a row fetch: for each REAL user
 * we issue a HEAD count (`select('id', { count: 'exact', head: true })`) of
 * their answer_history rows. A head count returns only the integer — no rows,
 * so the 1000-row cap is irrelevant and the number is exact at any size. One
 * pass yields both tiers (>=1 ⇒ activated, >=25 ⇒ engaged). This is the same
 * count-based escape the task sanctions ("a count-based approach OR an RPC like
 * get_user_topic_stats if present"); no such global per-user-total RPC exists,
 * and adding a migration is out of scope for this build, so the per-user head
 * count is the robust no-migration path.
 *
 * Tradeoff (documented, accepted at current scale): this is O(real users) round
 * trips (114 today). We chunk them (CHUNK_SIZE at a time) so we never open 114
 * concurrent connections on the service-role pool. If the user base grows into
 * the thousands, replace this loop with a single grouped RPC
 * (`SELECT user_id, count(*) FROM answer_history GROUP BY user_id HAVING ...`,
 * mirroring the get_user_topic_stats convention) — at that point the migration
 * is warranted. READ-ONLY throughout: every query here is a SELECT/count.
 */

import { assertReadSucceeded } from "./read-result";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsById, loadAccounts, loadLedger, loadSubscriptions, readAll } from "./moneyMetrics";
import { PAYING_BASIS, STAFF_TEST_BASIS, classifyPayers, isStaffOrTestAccount } from "./money-rules";
import {
  DEFAULT_GROWTH_WINDOW,
  MAX_CAMPAIGN_ROWS,
  MAX_SOURCE_ROWS,
  buildSourceTables,
  growthWindowStart,
  pickSignupAttribution,
  type GrowthWindow,
  type SourceRow,
  type TaggedSignup,
} from "./growth-rules";

// Real users and paying people (a14, 2026-10-12) come from the ONE shared
// definition in ./money-rules (isStaffOrTestAccount + classifyPayers), the
// same rules Overview, Payments, the paid roster and the control plane use.

/** Engagement threshold — answer_history rows for a real user to count "engaged". */
const ENGAGED_MIN_ANSWERS = 25;

/** Per-user count requests issued concurrently (keeps the service pool sane). */
const CHUNK_SIZE = 20;

export interface GrowthFunnelStep {
  /** Absolute count at this stage. */
  count: number;
  /** Share of signups (0..1). signups itself is 1 when signups > 0, else 0. */
  pctOfSignups: number;
}

export interface GrowthMetrics {
  generated_at: string;
  /** The cohort window: rolling days, or "all". */
  window: GrowthWindow;
  /** Start of the window (null for all time). */
  since: string | null;
  /** Real users created in the window. */
  signups: GrowthFunnelStep;
  /** Of those, with >= 1 answer_history row. */
  activated: GrowthFunnelStep;
  /** Of those, with >= 25 answer_history rows. */
  engaged: GrowthFunnelStep;
  /** Of those, paying now (shared definition in ./money-rules). */
  paying: GrowthFunnelStep;
  /** Real-user signups for the fixed windows, so the hero can compare. */
  signup_totals: { last_7d: number; last_30d: number; all_time: number };
  /** Counts per first-touch source in the window (arrivals, signups, payers). */
  sources: SourceRow[];
  /** Counts per tagged source and campaign (one row per post). */
  campaigns: SourceRow[];
  /** pricing_waitlist sign-ups (the old waitlist page is gone). */
  waitlist: { total: number; in_window: number; latest_at: string | null };
  /** Plain-language note on how each figure was derived. */
  basis: {
    signups: string;
    activated: string;
    engaged: string;
    paying: string;
    sources: string;
  };
}

function step(count: number, signups: number): GrowthFunnelStep {
  return {
    count,
    pctOfSignups: signups > 0 ? count / signups : 0,
  };
}

type Jsonish = Record<string, unknown> | null;

/** First-touch tags of the cohort's signups, keyed by user id. */
async function loadSignupAttribution(sb: SupabaseClient, sinceIso: string | null): Promise<{ events: Map<string, Jsonish>; activity: Map<string, Jsonish> }> {
  const [eventRows, activityRows] = await Promise.all([
    readAll<{ user_id: string; event_data: Jsonish }>((from, to) => {
      let q = sb.from("user_events").select("user_id, event_data").eq("event_type", "user_registered");
      if (sinceIso) q = q.gte("created_at", sinceIso);
      return q.order("id", { ascending: true }).range(from, to);
    }),
    readAll<{ user_id: string | null; metadata: Jsonish }>((from, to) => {
      let q = sb.from("user_activity_log").select("user_id, metadata").eq("event_type", "register").not("metadata->attribution", "is", null);
      if (sinceIso) q = q.gte("created_at", sinceIso);
      return q.order("id", { ascending: true }).range(from, to);
    }),
  ]);
  const events = new Map<string, Jsonish>();
  for (const r of eventRows) {
    const attr = (r.event_data as Record<string, unknown> | null)?.attribution;
    if (attr && typeof attr === "object" && !events.has(r.user_id)) events.set(r.user_id, attr as Jsonish);
  }
  const activity = new Map<string, Jsonish>();
  for (const r of activityRows) {
    const attr = (r.metadata as Record<string, unknown> | null)?.attribution;
    if (r.user_id && attr && typeof attr === "object" && !activity.has(r.user_id)) activity.set(r.user_id, attr as Jsonish);
  }
  return { events, activity };
}

/** Anonymous landing arrivals in the window (paged past the 1000-row cap). */
async function loadArrivals(sb: SupabaseClient, sinceIso: string | null) {
  return readAll<{ utm_source: string | null; utm_campaign: string | null }>((from, to) => {
    let q = sb.from("landing_hits").select("utm_source, utm_campaign");
    if (sinceIso) q = q.gte("at", sinceIso);
    return q.order("id", { ascending: true }).range(from, to);
  });
}

async function loadWaitlist(sb: SupabaseClient, sinceIso: string | null) {
  const [total, inWindow, latest] = await Promise.all([
    sb.from("pricing_waitlist").select("id", { count: "exact", head: true }),
    sinceIso ? sb.from("pricing_waitlist").select("id", { count: "exact", head: true }).gte("created_at", sinceIso) : null,
    sb.from("pricing_waitlist").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  assertReadSucceeded(total);
  if (inWindow) assertReadSucceeded(inWindow);
  assertReadSucceeded(latest);
  const latestRow = (latest.data as Array<{ created_at: string | null }> | null)?.[0];
  return {
    total: total.count ?? 0,
    in_window: inWindow ? inWindow.count ?? 0 : total.count ?? 0,
    latest_at: latestRow?.created_at ?? null,
  };
}

/**
 * Compute the growth funnel for one signup-cohort window from the live DB.
 * READ-ONLY: every query here is a SELECT/count; this never mutates. Real
 * users and paying come from ./money-rules.
 */
export async function computeGrowthMetrics(
  sb: SupabaseClient,
  window: GrowthWindow = DEFAULT_GROWTH_WINDOW,
  now: Date = new Date(),
): Promise<GrowthMetrics> {
  const nowIso = now.toISOString();
  const since = growthWindowStart(window, now);
  const sinceIso = since ? since.toISOString() : null;

  const [accounts, subs, { ledger }, attribution, arrivals, waitlist] = await Promise.all([
    loadAccounts(sb),
    loadSubscriptions(sb, nowIso),
    loadLedger(sb),
    loadSignupAttribution(sb, sinceIso),
    loadArrivals(sb, sinceIso),
    loadWaitlist(sb, sinceIso),
  ]);

  // ─── signups: real users (all minus staff and test) created in the window ─
  const realUsers = accounts.filter((u) => !isStaffOrTestAccount(u));
  const createdAfter = (u: { created_at?: string | null }, from: Date | null) =>
    !from || (u.created_at != null && new Date(u.created_at).getTime() >= from.getTime());
  const cohort = realUsers.filter((u) => createdAfter(u, since));
  const cohortIds = cohort.map((u) => u.id);
  const signups = cohortIds.length;

  // ─── activated + engaged: per-cohort-user HEAD count of answer_history ───
  // Cap-safe (head counts return only the integer). Chunked so we never open
  // `signups` concurrent connections. One pass buckets both tiers.
  let activated = 0;
  let engaged = 0;
  for (let i = 0; i < cohortIds.length; i += CHUNK_SIZE) {
    const chunk = cohortIds.slice(i, i + CHUNK_SIZE);
    const counts = await Promise.all(
      chunk.map((uid) =>
        sb
          .from("answer_history")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
      )
    );
    for (const res of counts) {
      assertReadSucceeded(res);
      const n = res.count ?? 0;
      if (n >= 1) activated += 1;
      if (n >= ENGAGED_MIN_ANSWERS) engaged += 1;
    }
  }

  // ─── paying: the shared definition (positive payment, trials apart) ──────
  const payers = classifyPayers(subs, accountsById(accounts), now, new Map(ledger.payments.map((p) => [p.payment_id, p])));
  const cohortSet = new Set(cohortIds);
  const paying = [...payers.paying].filter((id) => cohortSet.has(id)).length;

  // ─── sources: first-touch tag per cohort signup, arrivals per tag ────────
  const taggedSignups: TaggedSignup[] = cohort.map((u) => ({
    user_id: u.id,
    ...pickSignupAttribution(attribution.events.get(u.id), attribution.activity.get(u.id)),
  }));
  const { sources, campaigns } = buildSourceTables({ arrivals, signups: taggedSignups, paying: payers.paying });

  const day = 86_400_000;
  const signupTotals = {
    last_7d: realUsers.filter((u) => createdAfter(u, new Date(now.getTime() - 7 * day))).length,
    last_30d: realUsers.filter((u) => createdAfter(u, new Date(now.getTime() - 30 * day))).length,
    all_time: realUsers.length,
  };
  const windowLabel = window === "all" ? "all time" : `the last ${window} days`;

  return {
    generated_at: nowIso,
    window,
    since: sinceIso,
    signups: step(signups, signups),
    activated: step(activated, signups),
    engaged: step(engaged, signups),
    paying: step(paying, signups),
    signup_totals: signupTotals,
    sources,
    campaigns,
    waitlist,
    basis: {
      signups: `Real users created in ${windowLabel}: all accounts minus staff and test accounts. ${STAFF_TEST_BASIS}`,
      activated: `Of those, with at least 1 answered question (a row in answer_history).`,
      engaged: `Of those, with ${ENGAGED_MIN_ANSWERS} or more answered questions. Counted per user via an exact HEAD count of answer_history (no rows fetched), so the 1000-row REST cap never applies even for the heaviest users.`,
      paying: `Of those, ${paying} paying now (${payers.paying.size} paying learners in total, ${payers.inTrial.size} in trial). ${PAYING_BASIS}`,
      sources: `Arrivals: anonymous landing hits in ${windowLabel} by utm_source (no identity stored). Signups: the window's real users by their first-touch utm tag, from the signup event (email and Telegram sign-ins) or the older email signup record; no tag reads "(untagged)". Payers: those signups paying now. Tags are lower-cased; past ${MAX_SOURCE_ROWS} sources and ${MAX_CAMPAIGN_ROWS} campaigns the rest fold into "(other)".`,
    },
  };
}
