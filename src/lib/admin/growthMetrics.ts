/**
 * growthMetrics — the GROWTH FUNNEL behind /admin/growth (Autonomy Control
 * Plane, AUTONOMY.md F-08). The reach/funnel counterpart to controlPlaneMetrics:
 * control-plane owns EUROS (MRR, conversion, churn, LTV); growth owns the
 * top-of-funnel SHAPE — how many real people sign up, activate, get engaged,
 * and (the one number both panels share) pay.
 *
 * The funnel is signups → activated → engaged → paying, each step a count plus
 * its percentage of signups, so the drop-off between stages is visible.
 *
 * REAL-USER + REAL-PAYING DEFINITIONS (mirrored from controlPlaneMetrics so the
 * two panels never disagree — that module is the canonical owner of both the
 * internal-email exclusion and the real-paying rule; replicated here, not
 * imported, because those consts are module-private there):
 *   - signups   = REAL users = all users minus admin (role='admin') and
 *                 internal @medpruf.com / @medpruef.com accounts (the admin,
 *                 the comped client [name], and the demo/test user all carry an
 *                 internal email; Telegram-auth users have a NULL email and ARE
 *                 real — isInternalEmail() returns false for null, so they stay).
 *   - activated = real users with >= 1 answer_history row.
 *   - engaged   = real users with >= 25 answer_history rows.
 *   - paying    = distinct real users holding an active, unexpired subscription
 *                 on a real rail (whop/stripe/nowpayments — manual/comped
 *                 excluded). This is the SAME computation as
 *                 controlPlaneMetrics.active_paid_users; if it ever differs,
 *                 one of the two has drifted. It is 0 today and ticks up by
 *                 itself on the first real card payment.
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

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Email domains whose accounts are NOT real users (admin, the comped client
 * [name], demo/test all live on @medpruf.com / @medpruef.com). Canonical owner of
 * this exclusion is controlPlaneMetrics (INTERNAL_EMAIL_DOMAINS); kept in sync
 * here because that const is module-private there.
 */
const INTERNAL_EMAIL_DOMAINS = ["@medpruf.com", "@medpruef.com"];

/**
 * Payment rails that represent real money changing hands (manual = comped/gift).
 * MUST match controlPlaneMetrics.REAL_PAYMENT_RAILS exactly (3 elements) so
 * `paying` here equals control-plane's `active_paid_users`.
 */
const REAL_PAYMENT_RAILS = ["whop", "stripe", "nowpayments"] as const;

/** Engagement threshold — answer_history rows for a real user to count "engaged". */
const ENGAGED_MIN_ANSWERS = 25;

/** Per-user count requests issued concurrently (keeps the service pool sane). */
const CHUNK_SIZE = 20;

function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return INTERNAL_EMAIL_DOMAINS.some((d) => e.endsWith(d));
}

export interface GrowthFunnelStep {
  /** Absolute count at this stage. */
  count: number;
  /** Share of signups (0..1). signups itself is 1 when signups > 0, else 0. */
  pctOfSignups: number;
}

export interface GrowthMetrics {
  generated_at: string;
  /** Real users (all minus admin + internal-email accounts). */
  signups: GrowthFunnelStep;
  /** Real users with >= 1 answer_history row. */
  activated: GrowthFunnelStep;
  /** Real users with >= 25 answer_history rows. */
  engaged: GrowthFunnelStep;
  /** Distinct real users with an active+unexpired sub on a real rail. */
  paying: GrowthFunnelStep;
  /** Plain-language note on how each funnel figure was derived. */
  basis: {
    signups: string;
    activated: string;
    engaged: string;
    paying: string;
  };
}

function step(count: number, signups: number): GrowthFunnelStep {
  return {
    count,
    pctOfSignups: signups > 0 ? count / signups : 0,
  };
}

/**
 * Compute the growth funnel from the live DB. READ-ONLY: every query here is a
 * SELECT/count; this never mutates. The internal-email exclusion + the
 * real-paying rule are mirrored from controlPlaneMetrics (the canonical owner).
 */
export async function computeGrowthMetrics(
  sb: SupabaseClient
): Promise<GrowthMetrics> {
  const now = new Date();
  const nowIso = now.toISOString();

  // ─── signups: real users = all users minus admin + internal-email ─────────
  // Same single cheap projection as controlPlaneMetrics. (Inherits the same
  // latent 1000-row cap on the users table itself; fine at 114 — we add no new
  // cap bug below.)
  const [allUsersRes, activeSubsRes] = await Promise.all([
    sb.from("users").select("id, email, role"),
    // REAL paying base — replicated VERBATIM from controlPlaneMetrics'
    // activeSubsRes: active subs on a real rail, fetched (not head-counted) so
    // we can de-dupe by user_id and drop internal accounts. Tiny set (0 today).
    sb
      .from("subscriptions")
      .select("user_id, expires_at")
      .eq("status", "active")
      .in("payment_provider", REAL_PAYMENT_RAILS as unknown as string[]),
  ]);

  const allUsers = (allUsersRes.data ?? []) as Array<{
    id: string;
    email: string | null;
    role: string | null;
  }>;
  const realUserIds: string[] = [];
  const realUserIdSet = new Set<string>();
  for (const u of allUsers) {
    if (u.role === "admin") continue;
    if (isInternalEmail(u.email)) continue;
    realUserIds.push(u.id);
    realUserIdSet.add(u.id);
  }
  const signups = realUserIds.length;

  // ─── activated + engaged: per-real-user HEAD count of answer_history ──────
  // Cap-safe (head counts return only the integer). Chunked so we never open
  // `signups` concurrent connections. One pass buckets both tiers.
  let activated = 0;
  let engaged = 0;
  for (let i = 0; i < realUserIds.length; i += CHUNK_SIZE) {
    const chunk = realUserIds.slice(i, i + CHUNK_SIZE);
    const counts = await Promise.all(
      chunk.map((uid) =>
        sb
          .from("answer_history")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
      )
    );
    for (const res of counts) {
      const n = res.count ?? 0;
      if (n >= 1) activated += 1;
      if (n >= ENGAGED_MIN_ANSWERS) engaged += 1;
    }
  }

  // ─── paying: distinct real users with an active+unexpired sub on a real rail
  // (mirrors controlPlaneMetrics exactly — must equal active_paid_users). ────
  const activeSubs = (activeSubsRes.data ?? []) as Array<{
    user_id: string | null;
    expires_at: string | null;
  }>;
  const payingUserIds = new Set<string>();
  for (const s of activeSubs) {
    if (!s.user_id) continue;
    if (!realUserIdSet.has(s.user_id)) continue; // drop internal/comped/admin
    const unexpired =
      !s.expires_at || new Date(s.expires_at).getTime() > now.getTime();
    if (unexpired) payingUserIds.add(s.user_id);
  }
  const paying = payingUserIds.size;

  return {
    generated_at: nowIso,
    signups: step(signups, signups),
    activated: step(activated, signups),
    engaged: step(engaged, signups),
    paying: step(paying, signups),
    basis: {
      signups: `Real users: all accounts minus the admin and internal @medpruf.com / @medpruef.com accounts (admin, the comped client, the demo user). Telegram-auth users with no email are kept.`,
      activated: `Real users with at least 1 answered question (a row in answer_history).`,
      engaged: `Real users with ${ENGAGED_MIN_ANSWERS} or more answered questions. Counted per user via an exact HEAD count of answer_history (no rows fetched), so the 1000-row REST cap never applies even for the heaviest users.`,
      paying:
        paying === 0
          ? `Distinct real users with an active, unexpired subscription on a real rail (whop / stripe / nowpayments; comped / manual excluded). 0 today; rises by itself on the first real card payment. Same definition as the control plane's paying customers.`
          : `${paying} distinct real paying customer${paying === 1 ? "" : "s"} (active, unexpired sub on a real rail; comped / manual excluded). Same definition as the control plane's paying customers.`,
    },
  };
}
