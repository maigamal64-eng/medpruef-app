"use client";

/**
 * Admin · per-user detail page — `/admin/users/[id]`.
 *
 * "Everything we have for this user" on one page: identity + quick
 * actions, a stat-card grid, study visuals (heatmap, trend, topic
 * mastery, exam split), and a tabbed lower section (Timeline · Answers ·
 * Sessions · Notes · Money · Feedback) driven by one fetch of
 * `/api/stats/admin/users/[id]`.
 *
 * Requested by [name] 2026-07-04 — the users table now opens this.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  Trophy,
  Flame,
  Target,
  CircleCheck,
  Clock3,
  CalendarCheck,
  MonitorSmartphone,
  StickyNote,
  Eye,
  Search as SearchIcon,
  Star,
  Sparkles,
  Mail,
  Send,
  Fingerprint,
  CalendarClock,
  Ban,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getExamSource } from "@/lib/topics";
import { AdminPageShell } from "../../_components/AdminPageShell";
import { UserQuickActions } from "../../_components/UserQuickActions";
import { TileSkeleton } from "../../_components/primitives";
import type { UserDetail } from "./_parts/types";
import {
  StatCard,
  StudyHeatmap,
  AccuracyTrend,
  TopicBars,
  ExamSplit,
  VizCard,
  fmtInt,
  fmtDurationMs,
  fmtDate,
  fmtDateTime,
  timeAgo,
} from "./_parts/visuals";
import { ActivityTimeline } from "./_parts/ActivityTimeline";
import {
  AnswersPanel,
  SessionsPanel,
  NotesPanel,
  MoneyPanel,
  FeedbackFlagsPanel,
} from "./_parts/panels";

type Tab = "timeline" | "answers" | "sessions" | "notes" | "money" | "voice";

function statusOf(lastActivity: string | null): {
  label: string;
  tone: string;
} {
  if (!lastActivity) return { label: "no activity", tone: "var(--mp-fg-subtle)" };
  const days = (Date.now() - new Date(lastActivity).getTime()) / 86400000;
  if (days <= 1) return { label: "active", tone: "var(--mp-viridian)" };
  if (days <= 7) return { label: "recent", tone: "var(--mp-status-warning)" };
  if (days <= 30) return { label: "cooling", tone: "var(--mp-cta-blue)" };
  return { label: "dormant", tone: "var(--mp-fg-subtle)" };
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("timeline");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/stats/admin/users/${id}`);
      if (res.status === 404) throw new Error("User not found.");
      if (!res.ok) throw new Error("Failed to load user detail.");
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const backLink = (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
    >
      <ArrowLeft size={13} /> All users
    </Link>
  );

  if (loading && !data) {
    return (
      <div className="space-y-5">
        {backLink}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-xl border border-[var(--mp-error)]/25 bg-[var(--mp-error-bg)] text-[var(--mp-error)] text-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} />
          <span className="flex-1">{error || "No data."}</span>
          <button onClick={load} className="mp-btn mp-btn--ghost mp-btn--sm">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { profile: p, gamification: g, stats: s, money } = data;
  const status = statusOf(s.lastActivity);
  const examSrc = p.active_exam ? getExamSource(p.active_exam) : undefined;
  const examDays = p.exam_date
    ? Math.ceil((new Date(p.exam_date).getTime() - Date.now()) / 86400000)
    : null;

  const tierTone =
    p.tier === "pro"
      ? "var(--mp-viridian)"
      : p.tier === "admin"
        ? "var(--mp-error)"
        : "var(--mp-fg-muted)";

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "timeline", label: "Timeline", count: data.timelineTotal },
    { key: "answers", label: "Answers", count: data.answersTotal },
    { key: "sessions", label: "Sessions", count: s.sessionsCount },
    { key: "notes", label: "Notes", count: s.notesCount },
    { key: "money", label: "Money", count: money.subscriptions.length },
    { key: "voice", label: "Feedback", count: data.feedback.length + data.flags.length },
  ];

  return (
    <div className="space-y-5">
      {backLink}

      {/* ── Identity header ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
        <div className="flex items-start gap-4 flex-wrap">
          {/* avatar */}
          {p.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.photo_url}
              alt=""
              className="w-16 h-16 rounded-2xl object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-[var(--mp-viridian)]/10 flex items-center justify-center text-2xl font-bold text-[var(--mp-viridian)] flex-shrink-0">
              {p.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-[var(--mp-fg)] truncate">
                {p.name}
              </h1>
              <span
                className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border"
                style={{ color: tierTone, borderColor: tierTone }}
              >
                {p.tier}
              </span>
              {p.role === "admin" && (
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border border-[var(--mp-error)] text-[var(--mp-error)]">
                  admin
                </span>
              )}
              {p.is_banned && (
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--mp-error)]/10 text-[var(--mp-error)] inline-flex items-center gap-1">
                  <Ban size={10} /> locked
                </span>
              )}
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-medium"
                style={{ color: status.tone }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: status.tone }}
                />
                {status.label}
              </span>
            </div>

            {/* identifiers */}
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-[var(--mp-fg-muted)]">
              {p.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail size={11} /> {p.email}
                </span>
              )}
              {p.telegram_username && (
                <span className="inline-flex items-center gap-1">
                  <Send size={11} /> @{p.telegram_username}
                </span>
              )}
              {p.telegram_id && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Send size={11} /> {p.telegram_id}
                </span>
              )}
              <span className="inline-flex items-center gap-1 font-mono text-[var(--mp-fg-subtle)]">
                <Fingerprint size={11} /> {p.id}
              </span>
              {p.language_code && (
                <span className="uppercase">{p.language_code}</span>
              )}
            </div>

            {/* meta line */}
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-[var(--mp-fg-subtle)]">
              <span>Joined {fmtDate(p.created_at)}</span>
              <span>· Last active {timeAgo(s.lastActivity)}</span>
              {examSrc && (
                <span className="inline-flex items-center gap-1">
                  · {examSrc.badge} {examSrc.label}
                </span>
              )}
              {examDays != null && (
                <span
                  className="inline-flex items-center gap-1"
                  style={{
                    color:
                      examDays <= 30 ? "var(--mp-status-warning)" : undefined,
                  }}
                >
                  <CalendarClock size={11} />
                  {examDays >= 0
                    ? `Exam in ${examDays}d (${fmtDate(p.exam_date)})`
                    : `Exam date passed`}
                </span>
              )}
              {p.referral_code && (
                <span className="font-mono">ref: {p.referral_code}</span>
              )}
            </div>
          </div>

          {/* quick actions */}
          <div className="flex-shrink-0">
            <UserQuickActions
              userId={p.id}
              userEmail={p.email}
              isBanned={p.is_banned}
              onChanged={load}
            />
          </div>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="XP · Level"
          value={fmtInt(g?.total_xp ?? 0)}
          sub={`Level ${g?.level ?? 1}${g?.rank_name ? ` · ${g.rank_name}` : ""}`}
          icon={Trophy}
          accent="var(--mp-status-warning)"
          tint="rgba(244,162,97,0.14)"
        />
        <StatCard
          label="Streak"
          value={`${g?.current_streak ?? 0}d`}
          sub={`Longest ${g?.longest_streak ?? 0}d`}
          icon={Flame}
          accent="var(--mp-error)"
          tint="rgba(214,69,69,0.12)"
        />
        <StatCard
          label="Questions"
          value={fmtInt(s.answersLogged)}
          sub={`${s.activeDays} active day${s.activeDays === 1 ? "" : "s"}`}
          icon={Target}
          accent="var(--mp-fg)"
        />
        <StatCard
          label="Accuracy"
          value={s.answersLogged ? `${s.accuracy}%` : "—"}
          sub={`${fmtInt(s.answersCorrect)} correct`}
          icon={CircleCheck}
          accent={
            s.accuracy >= 70
              ? "var(--mp-viridian)"
              : s.accuracy >= 40
                ? "var(--mp-status-warning)"
                : "var(--mp-error)"
          }
          tint="rgba(0,123,95,0.10)"
        />
        <StatCard
          label="Time studied"
          value={fmtDurationMs(s.totalTimeMs)}
          sub={`avg ${fmtDurationMs(s.avgTimeMs)}/q`}
          icon={Clock3}
          accent="var(--mp-cta-blue)"
        />
        <StatCard
          label="Sessions"
          value={fmtInt(s.sessionsCount)}
          sub={`${fmtInt(s.pageViewsCount)} page views`}
          icon={MonitorSmartphone}
          accent="var(--mp-fg)"
        />
        <StatCard
          label="Flash-notes"
          value={fmtInt(s.notesCount)}
          sub={`${fmtInt(s.aiChatsCount)} AI chats`}
          icon={StickyNote}
          accent="var(--mp-viridian)"
          tint="rgba(0,123,95,0.10)"
        />
        <StatCard
          label="Money"
          value={money.isPayer ? "Payer" : "—"}
          sub={
            money.paidTotalCents > 0
              ? new Intl.NumberFormat("de-AT", {
                  style: "currency",
                  currency: money.currency,
                }).format(money.paidTotalCents / 100)
              : money.trial?.active
                ? "trial active"
                : "no payment"
          }
          icon={CalendarCheck}
          accent={money.isPayer ? "var(--mp-viridian)" : "var(--mp-fg-muted)"}
          tint="rgba(0,123,95,0.10)"
        />
      </div>

      {/* behavior strip */}
      <div className="flex items-center gap-2 flex-wrap">
        <BehaviorChip icon={Eye} label="page views" value={s.pageViewsCount} />
        <BehaviorChip icon={SearchIcon} label="searches" value={s.searchesCount} />
        <BehaviorChip icon={Star} label="bookmarks" value={s.bookmarksCount} />
        <BehaviorChip icon={Sparkles} label="AI chats" value={s.aiChatsCount} />
        {s.firstActivity && (
          <span className="text-[10px] text-[var(--mp-fg-subtle)] ml-auto">
            First answer {fmtDateTime(s.firstActivity)}
          </span>
        )}
      </div>

      {/* ── Study visuals ───────────────────────────────────────────── */}
      <VizCard
        title="Study activity"
        hint={`${fmtInt(s.answersLogged)} answers · last 26 weeks`}
      >
        {s.answersLogged > 0 ? (
          <StudyHeatmap cells={data.heatmap} />
        ) : (
          <div className="text-xs text-[var(--mp-fg-subtle)] italic py-4">
            This user has browsed the app but not answered any questions yet.
            See the Timeline and Sessions for what they did.
          </div>
        )}
      </VizCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VizCard title="Daily volume" hint="last 30 days">
          <AccuracyTrend trend={data.trend} />
        </VizCard>
        <VizCard title="Exam focus">
          <ExamSplit exams={data.exams} />
        </VizCard>
      </div>

      <VizCard title="Topic mastery" hint="accuracy by topic">
        <TopicBars topics={data.topics} />
      </VizCard>

      {/* ── Tabbed detail section ───────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
        <div className="flex items-center gap-1 px-3 pt-3 overflow-x-auto border-b border-[var(--mp-border-subtle)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? "border-[var(--mp-viridian)] text-[var(--mp-fg)]"
                  : "border-transparent text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
              }`}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span className="ml-1.5 text-[10px] tabular-nums opacity-70">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === "timeline" && (
            <ActivityTimeline items={data.timeline} total={data.timelineTotal} />
          )}
          {tab === "answers" && (
            <AnswersPanel answers={data.answers} total={data.answersTotal} />
          )}
          {tab === "sessions" && <SessionsPanel sessions={data.sessions} />}
          {tab === "notes" && <NotesPanel notes={data.notes} />}
          {tab === "money" && <MoneyPanel money={money} />}
          {tab === "voice" && (
            <FeedbackFlagsPanel feedback={data.feedback} flags={data.flags} />
          )}
        </div>
      </div>

      <div className="text-[10px] text-[var(--mp-fg-subtle)] text-center">
        Generated {fmtDateTime(data.generatedAt)} ·{" "}
        <button onClick={load} className="underline hover:text-[var(--mp-fg)]">
          refresh
        </button>
      </div>
    </div>
  );
}

function BehaviorChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-[var(--mp-surface-sunken)] text-[11px] text-[var(--mp-fg-muted)]">
      <Icon size={12} />
      <span className="tabular-nums font-semibold text-[var(--mp-fg)]">
        {fmtInt(value)}
      </span>
      {label}
    </span>
  );
}
