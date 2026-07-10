import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/referrals/pending-exam-rewards
 *
 * The Level-2 review queue for the 2026-07-11 referral exam-reward
 * mechanic (src/lib/referral-exam-reward.ts). Returns one row per
 * referrer who has crossed REFERRAL_EXAM_REWARD_THRESHOLD qualified
 * `pro_until_exam` referrals and is awaiting the one-click admin
 * confirm at POST /api/admin/referrals/grant-exam-reward.
 *
 * Sybil control (spec §3.2): we deliberately do NOT hard-gate
 * qualification on telegram_id/email_confirmed_at (the seed cohort is
 * email-based and has no confirm-link flow) — instead this endpoint
 * surfaces the farm signals so a human eyeballs the pattern before
 * confirming: per-referee signup method (email vs telegram), signup
 * timestamps, email domain, distinct-question count, distinct-day
 * span, and answer timing.
 *
 * Stuck-queue fix (2026-07-11): grantExamRewardToReferrer's terminal
 * no-op branches (no active_exam / already covers a later expiry) call
 * resolveQueueEntry() to stamp hold_reason to a value OTHER than
 * 'exam_reward_pending_review' (e.g. 'exam_reward_no_active_exam',
 * 'exam_reward_already_covered'). The exact-match filter below is what
 * makes that resolution actually clear the row from this queue — a row
 * whose hold_reason changed no longer matches and drops out
 * automatically. Before this fix, those no-op branches returned without
 * touching hold_reason at all, so the referrer stayed in this queue
 * forever with a "Grant" button that would silently no-op every time an
 * admin clicked it.
 */
export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();

    // 1. Find the trigger rows: qualified/rewarded pro_until_exam
    //    referrals whose hold_reason marks them enqueued for review
    //    (exact match — anything resolved to a terminal hold_reason by
    //    resolveQueueEntry() no longer matches and is excluded).
    const { data: triggerRows, error: triggerErr } = await sb
      .from("referrals")
      .select("id, referrer_user_id, hold_expires_at")
      .eq("reward_type", "pro_until_exam")
      .eq("hold_reason", "exam_reward_pending_review");

    if (triggerErr) {
      return NextResponse.json({ error: triggerErr.message }, { status: 500 });
    }

    const referrerIds = Array.from(
      new Set(
        (triggerRows || [])
          .map((r) => r.referrer_user_id as string | null)
          .filter((v): v is string => !!v)
      )
    );

    if (referrerIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // 2. Already-rewarded referrers should not reappear in the queue —
    //    filter them out even if a stale hold_reason lingers on a row.
    const { data: rewardedRows } = await sb
      .from("referrals")
      .select("referrer_user_id")
      .eq("reward_type", "pro_until_exam")
      .eq("status", "rewarded")
      .in("referrer_user_id", referrerIds);
    const alreadyRewarded = new Set(
      (rewardedRows || []).map((r) => r.referrer_user_id as string)
    );
    const pendingReferrerIds = referrerIds.filter((id) => !alreadyRewarded.has(id));
    if (pendingReferrerIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // 3. All qualified/rewarded pro_until_exam rows for these referrers
    //    (the referees whose activity earned them the credit).
    const { data: allRows, error: allErr } = await sb
      .from("referrals")
      .select(
        "id, referrer_user_id, referee_user_id, status, qualified_at, created_at"
      )
      .eq("reward_type", "pro_until_exam")
      .in("status", ["qualified", "rewarded"])
      .in("referrer_user_id", pendingReferrerIds);
    if (allErr) {
      return NextResponse.json({ error: allErr.message }, { status: 500 });
    }

    const refereeIds = Array.from(
      new Set(
        (allRows || [])
          .map((r) => r.referee_user_id as string | null)
          .filter((v): v is string => !!v)
      )
    );
    const allUserIds = Array.from(new Set([...pendingReferrerIds, ...refereeIds]));

    // 4. Hydrate users — email, telegram_id (signup method), active_exam,
    //    created_at (signup timestamp).
    const { data: users, error: usersErr } = await sb
      .from("users")
      .select("id, email, telegram_id, first_name, active_exam, created_at")
      .in("id", allUserIds);
    if (usersErr) {
      return NextResponse.json({ error: usersErr.message }, { status: 500 });
    }
    const userMap = new Map(
      (users || []).map((u) => [u.id as string, u])
    );

    // 5. Per-referee farm signals: distinct-question count + distinct-day
    //    span + first/last answer timestamps, from answer_history.
    const { data: history } = await sb
      .from("answer_history")
      .select("user_id, question_id, created_at")
      .in("user_id", refereeIds)
      .limit(50000);

    const signalsByReferee = new Map<
      string,
      { distinctQuestions: Set<number>; days: Set<string>; timestamps: string[] }
    >();
    for (const h of history || []) {
      const uid = h.user_id as string;
      if (!signalsByReferee.has(uid)) {
        signalsByReferee.set(uid, {
          distinctQuestions: new Set(),
          days: new Set(),
          timestamps: [],
        });
      }
      const sig = signalsByReferee.get(uid)!;
      const qid = h.question_id as number | null;
      if (typeof qid === "number") sig.distinctQuestions.add(qid);
      const createdAt = h.created_at as string | null;
      if (createdAt) {
        sig.days.add(new Date(createdAt).toISOString().slice(0, 10));
        sig.timestamps.push(createdAt);
      }
    }

    // 6. Assemble one item per pending referrer.
    const items = pendingReferrerIds.map((referrerId) => {
      const referrer = userMap.get(referrerId);
      const referrerRows = (allRows || []).filter(
        (r) => r.referrer_user_id === referrerId
      );
      const referees = referrerRows.map((r) => {
        const refereeId = r.referee_user_id as string | null;
        const refereeUser = refereeId ? userMap.get(refereeId) : null;
        const sig = refereeId ? signalsByReferee.get(refereeId) : undefined;
        const timestamps = sig ? [...sig.timestamps].sort() : [];
        return {
          referee_user_id: refereeId,
          email: refereeUser?.email || null,
          email_domain: refereeUser?.email
            ? (refereeUser.email as string).split("@")[1] || null
            : null,
          signup_method: refereeUser?.telegram_id ? "telegram" : "email",
          signup_at: refereeUser?.created_at || null,
          distinct_question_count: sig ? sig.distinctQuestions.size : 0,
          distinct_day_span: sig ? sig.days.size : 0,
          first_answer_at: timestamps[0] || null,
          last_answer_at: timestamps[timestamps.length - 1] || null,
          qualified_at: r.qualified_at || null,
          referral_row_status: r.status,
        };
      });

      return {
        referrer_user_id: referrerId,
        referrer_email: referrer?.email || null,
        referrer_first_name: referrer?.first_name || null,
        referrer_active_exam: referrer?.active_exam || null,
        qualified_referral_count: referees.length,
        referees,
      };
    });

    return NextResponse.json({ items });
  },
  { route: "/api/admin/referrals/pending-exam-rewards" }
);
