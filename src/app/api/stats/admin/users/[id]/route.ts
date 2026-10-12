/**
 * GET /api/stats/admin/users/[id]
 *
 * The full per-user dossier that powers the admin user-detail page:
 * profile, gamification, derived study stats, a study heatmap, an
 * accuracy trend, per-topic + per-exam mastery, a merged reverse-chron
 * activity timeline, the answered-questions detail, sessions (device),
 * notes, feedback, flags, and money.
 *
 * Requested by [name] 2026-07-04 — he saw new real users land but the
 * old inline expand-row exposed none of their activity. This assembles
 * "everything we have for this user" server-side so the page is one
 * fast fetch.
 *
 * Notes on the data model (verified live 2026-07-04):
 *  - answer_history.user_id is UUID; user_events / user_sessions.user_id
 *    are TEXT (they also hold guest_ ids), so those filters use the id
 *    string form.
 *  - question_answer is ALSO emitted to user_events, but answer_history
 *    is the canonical, richer source (xp + the actual answer text), so
 *    the timeline draws answers from answer_history and every OTHER
 *    event from user_events — no double-counting.
 *  - a since-archived question won't be in `questions`; those render as
 *    "removed" rather than throwing or blanking.
 *  - subscriptions (reliable user_id) is the canonical payer verdict;
 *    per-user payment_events is partial (checkout_redirected carries no
 *    user id) so it feeds the timeline only.
 *
 * a16 (ADM-07 A, ADM-15 A, 2026-10-12):
 *  - every answer row is read (paged past PostgREST's 1000-row cap), stats
 *    and streaks are computed here on Vienna days (learner-stats.ts);
 *  - last active = latest answer, learner event or session start, never
 *    users.updated_at and never webhook/cron/admin events;
 *  - paid needs a payment reference (learner-access.ts), so cancelled
 *    unpaid crypto invoices no longer read as "Payer";
 *  - the Access strip says where Pro comes from (subscription, audited admin
 *    grant, or set outside admin); revenue.read only;
 *  - Admin history lists admin and Ops actions on this learner.
 */

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getExamSource } from "@/lib/topics";
import { readAll } from "@/lib/admin/moneyMetrics";
import { computeLearnerStudyStats } from "@/lib/admin/learner-stats";
import { isSystemEvent, latestStamp, LAST_ACTIVE_BASIS } from "@/lib/admin/learner-activity";
import { describeLearnerAccess, learnerMoneyVerdict, rowPaidCents, PAID_BASIS, type LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { summarizeAuditPayload } from "@/lib/admin/learner-history";
import { isMissingFunction } from "@/lib/admin/learner-segments";
import { tierDurationMonths } from "@/lib/whop";
import type {
  UserDetail,
  TimelineItem,
  ExamStat,
  AnswerDetail,
  AdminHistoryItem,
} from "@/app/admin/users/[id]/_parts/types";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_FETCH_CAP = 500;
const HISTORY_CAP = 50;
const ANSWER_DETAIL_CAP = 150;
const TIMELINE_CAP = 300;
const HEATMAP_DAYS = 182; // ~26 weeks
const TREND_DAYS = 30;

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

interface AnswerRow {
  id: string;
  question_id: number | null;
  user_answer: string | null;
  is_correct: boolean | null;
  time_spent_ms: number | null;
  xp_earned: number | null;
  created_at: string;
}

function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const t = String(s).trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/** Parse a userAgent into a coarse browser label. */
function browserFromUA(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/edg/i.test(ua)) return "Edge";
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) return "Safari";
  return "Other";
}

export const GET = adminRouteShell(
  async ({ req, actor }) => {
    const url = new URL(req.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 1];
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const db = getServiceClient();
    const permissionSnapshot = await loadAdminPermissionSnapshot(actor.userId);
    const canReadRevenue = canAccessAdminPermission(permissionSnapshot, "revenue.read");
    const canReadFeedback = canAccessAdminPermission(permissionSnapshot, "feedback.read");
    const canReadContentReports = canAccessAdminPermission(permissionSnapshot, "content.read");
    const canReadSessions = canAccessAdminPermission(permissionSnapshot, "users.sessions.read");
    const canReadNotes = canAccessAdminPermission(permissionSnapshot, "users.notes.read");

    // ── Profile ──────────────────────────────────────────────────────
    const { data: user, error: userErr } = await db
      .from("users")
      .select(
        `id, email, telegram_id, telegram_username, first_name, last_name,
         photo_url, role, tier, is_banned, language_code, active_exam,
         exam_date, daily_goal, referral_code, referred_by_code,
         tier_expires_at, onboarding_completed_at, created_at, updated_at,
         last_active_date`
      )
      .eq("id", id)
      .maybeSingle();

    if (userErr) {
      console.error("[admin/users/[id]] profile", userErr);
      return NextResponse.json(
        { error: "Failed to load user" },
        { status: 500 }
      );
    }
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // ── Parallel fan-out of everything this user touched ─────────────
    const [
      gamRes,
      answersRes,
      eventsRes,
      sessionsRes,
      notesRes,
      feedbackRes,
      flagsRes,
      subsRes,
      payRes,
      trialRes,
      refMadeRes,
    ] = await Promise.all([
      db
        .from("user_gamification")
        .select(
          `total_xp, level, rank_name, current_streak, longest_streak,
           total_questions_answered, total_correct, daily_questions_today,
           last_study_date`
        )
        .eq("user_id", id)
        .maybeSingle(),
      // Every answer, paged: the REST cap is 1000 rows per request.
      readAll<AnswerRow>((from, to) => db
        .from("answer_history")
        .select(
          "id, question_id, user_answer, is_correct, time_spent_ms, xp_earned, created_at"
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      db
        .from("user_events")
        .select("event_type, event_data, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(EVENT_FETCH_CAP),
      canReadSessions ? db
        .from("user_sessions")
        .select(
          "started_at, ended_at, duration_seconds, pages_visited, device_info, exam_source"
        )
        .eq("user_id", id)
        .order("started_at", { ascending: false })
        .limit(60) : Promise.resolve({ data: [] as never[] }),
      canReadNotes ? db
        .from("notes")
        .select(
          "id, title, topic, exam_type, visibility, is_active, source_type, created_at"
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(100) : Promise.resolve({ data: [] as never[] }),
      canReadFeedback ? db
        .from("user_feedback")
        .select("id, message, status, admin_note, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50) : Promise.resolve({ data: [] as never[] }),
      canReadContentReports ? db
        .from("question_suggestions")
        .select("id, question_id, type, reason, details, status, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50) : Promise.resolve({ data: [] as never[] }),
      canReadRevenue ? db
        .from("subscriptions")
        .select(
          "tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, crypto_tx_hash, granted_payment_ids, started_at, expires_at, created_at"
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false }) : Promise.resolve({ data: [] as never[] }),
      canReadRevenue ? db
        .from("payment_events")
        .select("event, provider, tier, amount_cents, currency, reason, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(60) : Promise.resolve({ data: [] as never[] }),
      canReadRevenue ? db
        .from("trials")
        .select("started_at, expires_at, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(1) : Promise.resolve({ data: [] as never[] }),
      canReadRevenue ? db
        .from("referrals")
        .select("status, reward_credit_cents, created_at, qualified_at")
        .eq("referrer_user_id", id) : Promise.resolve({ data: [] as never[] }),
    ]);

    for (const r of [gamRes, eventsRes, sessionsRes, notesRes, feedbackRes, flagsRes, subsRes, payRes, trialRes, refMadeRes] as Array<{ error?: unknown }>) {
      if (r.error) throw r.error;
    }
    const gam = gamRes.data;
    const answers = answersRes;
    const events = eventsRes.data ?? [];
    const sessions = sessionsRes.data ?? [];
    const notes = notesRes.data ?? [];
    const feedback = feedbackRes.data ?? [];
    const flags = flagsRes.data ?? [];
    const subs = subsRes.data ?? [];
    const payEvents = payRes.data ?? [];
    const trialRow = trialRes.data?.[0] ?? null;
    const refsMade = refMadeRes.data ?? [];

    // ── Batch-fetch question metadata for every answered id ──────────
    const qIds = Array.from(
      new Set(answers.map((a) => a.question_id).filter((x) => x != null))
    ) as number[];
    const qMeta = new Map<
      number,
      { topic: string | null; exam_type: string | null; question: string | null }
    >();
    for (let i = 0; i < qIds.length; i += 400) {
      const chunk = qIds.slice(i, i + 400);
      const { data: qs } = await db
        .from("questions")
        .select("id, topic, exam_type, question")
        .in("id", chunk);
      for (const q of qs ?? []) {
        qMeta.set(q.id as number, {
          topic: (q.topic as string) ?? null,
          exam_type: (q.exam_type as string) ?? null,
          question: (q.question as string) ?? null,
        });
      }
    }

    // ── Derived study analytics (every answer, Vienna days) ──────────
    const now = new Date();
    const study = computeLearnerStudyStats(answers, qMeta, now, { heatmapDays: HEATMAP_DAYS, trendDays: TREND_DAYS });
    const exams: ExamStat[] = study.exams.map((e) => ({ ...e, label: getExamSource(e.examType)?.label || e.examType }));

    // ── Behavior counts (from events) ────────────────────────────────
    const behavior = {
      page_view: 0,
      search: 0,
      bookmark: 0,
      ai_chat: 0,
      translation: 0,
      feature_use: 0,
    };
    for (const e of events) {
      const t = e.event_type as string;
      if (t === "page_view") behavior.page_view++;
      else if (t === "search") behavior.search++;
      else if (t === "bookmark") behavior.bookmark++;
      else if (t.startsWith("ai_chat")) behavior.ai_chat++;
      else if (t === "translation") behavior.translation++;
      else if (t === "feature_use") behavior.feature_use++;
    }

    // ── Answered-questions detail (most recent N) ────────────────────
    const answerDetails: AnswerDetail[] = answers
      .slice(0, ANSWER_DETAIL_CAP)
      .map((a) => {
        const meta = qMeta.get(a.question_id as number);
        return {
          id: a.id as string,
          questionId: a.question_id as number,
          stem: truncate(meta?.question ?? null, 240),
          removed: !meta,
          topic: meta?.topic ?? null,
          examType: meta?.exam_type ?? null,
          userAnswer: truncate(a.user_answer as string, 400),
          isCorrect: !!a.is_correct,
          timeMs: (a.time_spent_ms as number) ?? null,
          xp: (a.xp_earned as number) ?? null,
          createdAt: a.created_at as string,
        };
      });

    // ── Timeline: merge everything except question_answer events ─────
    const timeline: TimelineItem[] = [];

    // answers (rich)
    for (const a of answers) {
      const meta = qMeta.get(a.question_id as number);
      const topic = meta?.topic ?? null;
      timeline.push({
        ts: a.created_at as string,
        kind: "answer",
        title: `Answered question #${a.question_id}${
          a.is_correct ? " correctly" : " incorrectly"
        }`,
        detail:
          [
            topic,
            a.time_spent_ms ? `${((a.time_spent_ms as number) / 1000).toFixed(1)}s` : null,
            a.xp_earned ? `+${a.xp_earned} XP` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        tone: a.is_correct ? "success" : "danger",
        correct: !!a.is_correct,
        questionId: a.question_id as number,
        topic,
        examType: meta?.exam_type ?? null,
      });
    }

    // non-answer events
    for (const e of events) {
      const t = e.event_type as string;
      if (t === "question_answer") continue; // represented via answer_history
      const data = (e.event_data || {}) as Record<string, unknown>;
      const ts = e.created_at as string;
      if (t === "page_view") {
        timeline.push({
          ts,
          kind: "page_view",
          title: `Viewed ${String(data.page ?? "a page")}`,
          tone: "neutral",
        });
      } else if (t === "search") {
        const q =
          (data.query as string) ||
          (data.q as string) ||
          (data.term as string) ||
          (data.text as string) ||
          "";
        timeline.push({
          ts,
          kind: "search",
          title: q ? `Searched “${truncate(q, 60)}”` : "Ran a search",
          tone: "info",
        });
      } else if (t === "bookmark") {
        timeline.push({
          ts,
          kind: "bookmark",
          title: `Bookmarked question #${data.questionId ?? data.question_id ?? "?"}`,
          tone: "warn",
          questionId: (data.questionId as number) ?? null,
        });
      } else if (t.startsWith("ai_chat")) {
        const label =
          t === "ai_chat_open"
            ? "Opened AI explanation chat"
            : t === "ai_chat_completed"
              ? "Got an AI explanation"
              : t === "ai_chat_failed"
                ? "AI explanation failed"
                : "AI chat";
        timeline.push({
          ts,
          kind: "ai_chat",
          title: label,
          tone: t === "ai_chat_failed" ? "danger" : "info",
        });
      } else if (t === "session_start") {
        timeline.push({ ts, kind: "session_start", title: "Started a session", tone: "neutral" });
      } else if (t === "session_end") {
        timeline.push({ ts, kind: "session_end", title: "Ended a session", tone: "neutral" });
      } else if (t === "translation") {
        timeline.push({
          ts,
          kind: "translation",
          title: `Translated an explanation${data.lang ? ` → ${String(data.lang).toUpperCase()}` : ""}`,
          tone: "info",
        });
      } else if (t === "feature_use") {
        timeline.push({
          ts,
          kind: "feature_use",
          title: `Used ${String(data.feature ?? data.name ?? "a feature")}`,
          tone: "neutral",
        });
      } else if (t === "referral_code_copied") {
        timeline.push({ ts, kind: "referral", title: "Copied their referral code", tone: "info" });
      } else if (t === "non_crypto_waitlist_signed") {
        timeline.push({ ts, kind: "waitlist", title: "Joined the payments waitlist", tone: "money" });
      } else if (
        t.startsWith("nowpayments") ||
        t.startsWith("whop") ||
        t === "notes_trial_activated"
      ) {
        timeline.push({
          ts,
          kind: t === "notes_trial_activated" ? "trial" : "payment",
          title:
            t === "notes_trial_activated"
              ? "Activated the free Pro trial"
              : t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          tone: "money",
          amountCents: (data.amount_cents as number) ?? null,
        });
      } else {
        timeline.push({
          ts,
          kind: "other",
          title: t.replace(/_/g, " "),
          tone: "neutral",
        });
      }
    }

    // notes
    for (const n of notes) {
      timeline.push({
        ts: n.created_at as string,
        kind: "note_created",
        title: `Created a flash-note${n.title ? `: ${truncate(n.title as string, 60)}` : ""}`,
        detail: (n.topic as string) ?? null,
        tone: "success",
      });
    }
    // feedback
    for (const f of feedback) {
      timeline.push({
        ts: f.created_at as string,
        kind: "feedback",
        title: "Sent feedback",
        detail: truncate(f.message as string, 120),
        tone: "info",
        status: f.status as string,
      });
    }
    // flags
    for (const fl of flags) {
      timeline.push({
        ts: fl.created_at as string,
        kind: "flag",
        title: `${fl.type === "edit" ? "Suggested an edit to" : "Flagged"} question #${fl.question_id ?? "?"}`,
        detail: truncate((fl.reason as string) || (fl.details as string), 120),
        tone: "warn",
        questionId: (fl.question_id as number) ?? null,
        status: fl.status as string,
      });
    }
    // subscriptions
    for (const s of subs) {
      timeline.push({
        ts: (s.created_at as string) || (s.started_at as string),
        kind: "subscription",
        title: `Subscription ${s.status ?? ""} — ${s.tier ?? ""}`.trim(),
        detail: [s.payment_provider, s.payment_method].filter(Boolean).join(" · ") || null,
        tone: "money",
        amountCents: (s.amount_cents as number) ?? null,
        status: s.status as string,
      });
    }
    // trial
    if (trialRow) {
      timeline.push({
        ts: (trialRow.started_at as string) || (trialRow.created_at as string),
        kind: "trial",
        title: "Started the free Pro trial",
        detail: trialRow.expires_at
          ? `expires ${dayKey(trialRow.expires_at as string)}`
          : null,
        tone: "money",
      });
    }
    // payment_events (partial per-user; timeline colour only)
    for (const p of payEvents) {
      timeline.push({
        ts: p.created_at as string,
        kind: "payment",
        title: `Payment funnel: ${String(p.event).replace(/_/g, " ")}`,
        detail:
          [p.tier, p.reason].filter(Boolean).join(" · ") || (p.provider as string) || null,
        tone: "money",
        amountCents: (p.amount_cents as number) ?? null,
      });
    }

    timeline.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    const visibleTimeline = timeline.filter((item) => {
      if (item.kind === "note_created") return canReadNotes;
      if (item.kind === "feedback") return canReadFeedback;
      if (item.kind === "flag") return canReadContentReports;
      if (["session_start", "session_end"].includes(item.kind)) return canReadSessions;
      if (["payment", "subscription", "trial", "referral", "waitlist"].includes(item.kind)) return canReadRevenue;
      return true;
    });
    const timelineTotal = visibleTimeline.length;
    const timelineTop = visibleTimeline.slice(0, TIMELINE_CAP);

    // ── Money verdict: paid needs a payment reference (ADM-07 A) ─────
    const subRows = subs as unknown as LearnerSubscriptionRow[];
    const verdict = learnerMoneyVerdict(subRows);

    // ── Access strip (revenue.read) ──────────────────────────────────
    let access: UserDetail["access"] = null;
    if (canReadRevenue) {
      const whopPayments = subRows
        .filter((s) => s.status === "active" && s.payment_provider === "whop" && s.provider_payment_id)
        .map((s) => s.provider_payment_id as string);
      const planByPayment = new Map<string, string>();
      if (whopPayments.length) {
        const { data: planRows, error: planError } = await db
          .from("payment_events")
          .select("payment_id, plan_id")
          .in("payment_id", whopPayments)
          .not("plan_id", "is", null);
        if (planError) throw planError;
        for (const r of planRows ?? []) {
          if (r.plan_id && !planByPayment.has(r.payment_id as string)) planByPayment.set(r.payment_id as string, r.plan_id as string);
        }
      }
      const { data: grantRows, error: grantError } = await db
        .from("admin_audit_log")
        .select("actor_email, created_at, payload")
        .eq("target_id", id)
        .eq("action", "grant_free_access")
        .order("created_at", { ascending: false })
        .limit(20);
      if (grantError) throw grantError;
      const described = describeLearnerAccess({
        tier: (user.tier as string) ?? null,
        tier_expires_at: (user.tier_expires_at as string) ?? null,
        role: (user.role as string) ?? null,
        subscriptions: subRows.map((s) => ({ ...s, plan_id: s.provider_payment_id ? planByPayment.get(s.provider_payment_id) ?? null : null })),
        grants: (grantRows ?? []).map((g) => {
          const pl = (g.payload ?? {}) as Record<string, unknown>;
          return {
            actor_email: (g.actor_email as string) ?? null,
            created_at: g.created_at as string,
            days: typeof pl.days === "number" ? pl.days : null,
            reason: typeof pl.reason === "string" ? pl.reason : null,
            new_expiry: typeof pl.new_expiry === "string" ? pl.new_expiry : null,
          };
        }),
        monthsForTier: (t) => tierDurationMonths(t),
      }, now);
      access = {
        state: described.state,
        endsAt: described.endsAt,
        source: described.source,
        sourceLabel: described.sourceLabel,
        renewal: described.renewal,
        grantReason: described.grant?.reason ?? null,
        grantAt: described.grant?.created_at ?? null,
      };
    }

    // ── Admin history (ADM-15 A): admin + Ops actions on this learner ─
    const historyRes = await db
      .from("admin_audit_log")
      .select("id, actor_email, action, target_type, payload, created_at", { count: "exact" })
      .or(`target_id.eq.${id},payload->>user_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_CAP);
    if (historyRes.error) throw historyRes.error;
    const adminHistory: AdminHistoryItem[] = (historyRes.data ?? []).map((h) => ({
      id: String(h.id),
      at: h.created_at as string,
      actor: (h.actor_email as string) ?? null,
      action: h.action as string,
      summary: summarizeAuditPayload(h.action as string, h.payload as Record<string, unknown> | null, { revenue: canReadRevenue }),
      origin: "admin",
    }));
    let adminHistoryTotal = historyRes.count ?? adminHistory.length;
    let adminHistoryOpsAvailable = true;
    const opsRes = await db.rpc("admin_ops_decisions", { p_actor_id: actor.userId, p_user_id: id, p_limit: HISTORY_CAP, p_before: null });
    if (opsRes.error && isMissingFunction(opsRes.error)) {
      adminHistoryOpsAvailable = false;
    } else if (opsRes.error) {
      throw opsRes.error;
    } else {
      const ops = opsRes.data as { total?: number; items?: Array<Record<string, unknown>> } | null;
      for (const o of ops?.items ?? []) {
        adminHistory.push({
          id: `ops-${String(o.id)}`,
          at: String(o.at),
          actor: (o.actor_email as string) ?? (o.principal ? `Ops agent ${String(o.principal)}` : "Ops agent"),
          action: `ops ${String(o.operation)} ${String(o.event).replace("action.", "")}`,
          summary: [o.days ? `${String(o.days)} days` : null, o.reason ? String(o.reason) : null].filter(Boolean).join(" · ") || null,
          origin: "ops",
        });
      }
      adminHistoryTotal += Number(ops?.total ?? 0);
      adminHistory.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
    }

    // ── Last activity: learner actions only (ADM-07 A) ───────────────
    const lastLearnerEvent = events.find((e) => !isSystemEvent(e.event_type as string));
    const lastActivity = latestStamp([
      study.lastAnswerAt,
      lastLearnerEvent?.created_at as string | undefined,
      sessions[0]?.started_at as string | undefined,
    ]);

    const detail: UserDetail = {
      profile: {
        id: user.id as string,
        email: (user.email as string) ?? null,
        telegram_id: user.telegram_id != null ? String(user.telegram_id) : null,
        telegram_username: (user.telegram_username as string) ?? null,
        first_name: (user.first_name as string) ?? null,
        last_name: (user.last_name as string) ?? null,
        name:
          [user.first_name, user.last_name].filter(Boolean).join(" ") ||
          (user.telegram_username as string) ||
          (user.email as string) ||
          "Anonymous",
        photo_url: (user.photo_url as string) ?? null,
        role: (user.role as string) || "user",
        tier: canReadRevenue ? (user.tier as string) || "free" : null,
        is_banned: !!user.is_banned,
        language_code: (user.language_code as string) ?? null,
        active_exam: (user.active_exam as string) ?? null,
        exam_date: (user.exam_date as string) ?? null,
        daily_goal: (user.daily_goal as number) ?? null,
        referral_code: canReadRevenue ? (user.referral_code as string) ?? null : null,
        referred_by_code: canReadRevenue ? (user.referred_by_code as string) ?? null : null,
        tier_expires_at: canReadRevenue ? (user.tier_expires_at as string) ?? null : null,
        onboarding_completed_at: (user.onboarding_completed_at as string) ?? null,
        created_at: user.created_at as string,
        updated_at: (user.updated_at as string) ?? null,
        last_active_date: (user.last_active_date as string) ?? null,
      },
      gamification: gam
        ? {
            total_xp: (gam.total_xp as number) || 0,
            level: (gam.level as number) || 1,
            rank_name: (gam.rank_name as string) ?? null,
            current_streak: (gam.current_streak as number) || 0,
            longest_streak: (gam.longest_streak as number) || 0,
            total_questions_answered: (gam.total_questions_answered as number) || 0,
            total_correct: (gam.total_correct as number) || 0,
            daily_questions_today: (gam.daily_questions_today as number) || 0,
            last_study_date: (gam.last_study_date as string) ?? null,
          }
        : null,
      access,
      adminHistory: adminHistory.slice(0, HISTORY_CAP),
      adminHistoryTotal,
      adminHistoryOpsAvailable,
      stats: {
        answersLogged: study.answersLogged,
        answersCorrect: study.answersCorrect,
        accuracy: study.accuracy,
        totalTimeMs: study.totalTimeMs,
        avgTimeMs: study.avgTimeMs,
        xpFromAnswers: study.xpFromAnswers,
        activeDays: study.activeDays,
        firstActivity: study.firstActivity,
        lastActivity,
        lastActivityBasis: LAST_ACTIVE_BASIS,
        currentStreak: study.currentStreak,
        longestStreak: study.longestStreak,
        answersComplete: true,
        sessionsCount: canReadSessions ? sessions.length : null,
        notesCount: canReadNotes ? notes.length : null,
        bookmarksCount: behavior.bookmark,
        aiChatsCount: behavior.ai_chat,
        searchesCount: behavior.search,
        pageViewsCount: behavior.page_view,
      },
      heatmap: study.heatmap,
      trend: study.trend,
      topics: study.topics,
      exams,
      timeline: timelineTop,
      timelineTotal,
      answers: answerDetails,
      answersTotal: answers.length,
      ...(canReadSessions ? { sessions: sessions.map((s) => {
        const dev = (s.device_info || {}) as Record<string, unknown>;
        return {
          startedAt: s.started_at as string,
          endedAt: (s.ended_at as string) ?? null,
          durationSeconds: (s.duration_seconds as number) ?? null,
          platform: (dev.platform as string) ?? null,
          browser: browserFromUA(dev.userAgent as string),
          timezone: (dev.timezone as string) ?? null,
          language: (dev.language as string) ?? null,
          screen:
            dev.screenWidth && dev.screenHeight
              ? `${dev.screenWidth}×${dev.screenHeight}`
              : null,
          examSource: (s.exam_source as string) ?? null,
          pagesVisited: Array.isArray(s.pages_visited)
            ? (s.pages_visited as string[])
            : [],
        };
      }) } : {}),
      ...(canReadNotes ? { notes: notes.map((n) => ({
        id: n.id as string,
        title: (n.title as string) ?? null,
        topic: (n.topic as string) ?? null,
        examType: (n.exam_type as string) ?? null,
        visibility: (n.visibility as string) ?? null,
        isActive: n.is_active !== false,
        sourceType: (n.source_type as string) ?? null,
        createdAt: n.created_at as string,
      })) } : {}),
      ...(canReadFeedback ? { feedback: feedback.map((f) => ({
        id: f.id as number,
        message: (f.message as string) || "",
        status: (f.status as string) || "new",
        adminNote: (f.admin_note as string) ?? null,
        createdAt: f.created_at as string,
      })) } : {}),
      ...(canReadContentReports ? { flags: flags.map((fl) => ({
        id: fl.id as number,
        questionId: (fl.question_id as number) ?? null,
        type: (fl.type as string) || "flag",
        reason: (fl.reason as string) ?? null,
        details: (fl.details as string) ?? null,
        status: (fl.status as string) || "pending",
        createdAt: fl.created_at as string,
      })) } : {}),
      money: canReadRevenue ? {
        isPayer: verdict.isPayer,
        paidByCurrency: verdict.paidByCurrency,
        refundedByCurrency: verdict.refundedByCurrency,
        unpaidInvoiceRows: verdict.unpaidInvoiceRows,
        basis: PAID_BASIS,
        subscriptions: subRows.map((s) => ({
          tier: (s.tier as string) ?? null,
          status: (s.status as string) ?? null,
          provider: (s.payment_provider as string) ?? null,
          method: (s.payment_method as string) ?? null,
          amountCents: (s.amount_cents as number) ?? null,
          currency: (s.currency as string) ?? null,
          startedAt: (s.started_at as string) ?? null,
          expiresAt: (s.expires_at as string) ?? null,
          createdAt: s.created_at as string,
          paid: rowPaidCents(s) > 0,
        })),
        trial: trialRow
          ? {
              startedAt:
                (trialRow.started_at as string) || (trialRow.created_at as string),
              expiresAt: (trialRow.expires_at as string) ?? null,
              active: trialRow.expires_at
                ? new Date(trialRow.expires_at as string).getTime() > now.getTime()
                : false,
            }
          : null,
        referralsMade: refsMade.length,
        referralsQualified: refsMade.filter(
          (r) => r.status === "qualified" || r.status === "rewarded"
        ).length,
        referredByCode: (user.referred_by_code as string) ?? null,
      } : null,
      restricted_sections: [
        ...(!canReadSessions ? ["sessions"] : []),
        ...(!canReadNotes ? ["notes"] : []),
        ...(!canReadFeedback ? ["feedback"] : []),
        ...(!canReadContentReports ? ["content_reports"] : []),
        ...(!canReadRevenue ? ["revenue"] : []),
      ],
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(detail);
  },
  {
    route: "/api/stats/admin/users/[id]",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
