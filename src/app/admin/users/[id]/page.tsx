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
 *
 * a16 (ADM-07 A, ADM-15 A, ADM-Q17, UX-ADM-20): Access strip under the
 * name (where Pro comes from and when it ends), the header stacks on
 * phones, the open tab lives in the URL, streaks come from answer days and
 * an Admin history block lists admin and Ops actions on this learner.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
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
  ShieldCheck,
  History,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { getExamSource } from "@/lib/topics";
import { UserQuickActions } from "../../_components/UserQuickActions";
import { TileSkeleton } from "../../_components/primitives";
import type { AccessStrip, AdminHistoryItem, UserDetail } from "./_parts/types";
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
  fmtByCurrency,
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

import { MentorPanel } from "./_parts/MentorPanel";

type Tab = "timeline" | "answers" | "sessions" | "notes" | "money" | "voice";
const TABS: Tab[] = ["timeline", "answers", "sessions", "notes", "money", "voice"];

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
  const { can, loading: accessLoading } = useAdminPermissions();
  const canRead = can("users.read");
  const canReadSessions = can("users.sessions.read");
  const canReadNotes = can("users.notes.read");
  const canReadContent = can("content.read");
  const canReadFeedback = can("feedback.read");
  const canReadRevenue = can("revenue.read");
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "timeline";
  // UX-ADM-20: the open tab lives in the URL so Back and refresh keep it.
  const setTab = useCallback((next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "timeline") params.delete("tab"); else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const load = useCallback(async () => {
    if (!can("users.read")) return;
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
  }, [can, id]);

  useEffect(() => {
    if (accessLoading) return;
    if (id && canRead) void load();
    else setLoading(false);
  }, [accessLoading, canRead, id, load]);

  useEffect(() => {
    if (accessLoading) return;
    if (tab === "sessions" && !canReadSessions) setTab("timeline");
    else if (tab === "notes" && !canReadNotes) setTab("timeline");
    else if (tab === "money" && !canReadRevenue) setTab("timeline");
    else if (tab === "voice" && !canReadFeedback && !canReadContent) setTab("timeline");
  }, [accessLoading, tab, setTab, canReadSessions, canReadNotes, canReadRevenue, canReadFeedback, canReadContent]);

  const backLink = (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
    >
      <ArrowLeft size={13} /> All users
    </Link>
  );

  if (accessLoading || (loading && !data)) {
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

  if (!canRead || !data) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-xl border border-[var(--mp-error)]/25 bg-[var(--mp-error-bg)] text-[var(--mp-error)] text-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} />
          <span className="flex-1">{!canRead ? "You do not have permission to view this user record." : error || "No data."}</span>
          {canRead && <button onClick={load} className="mp-btn mp-btn--ghost mp-btn--sm">
            Retry
          </button>}
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
    ...(canReadSessions ? [{ key: "sessions" as const, label: "Sessions", count: s.sessionsCount ?? 0 }] : []),
    ...(canReadNotes ? [{ key: "notes" as const, label: "Notes", count: s.notesCount ?? 0 }] : []),
    ...(canReadRevenue && money ? [{ key: "money" as const, label: "Money", count: money.subscriptions.length }] : []),
    ...(canReadFeedback || canReadContent ? [{
      key: "voice" as const,
      label: "Feedback & reports",
      count: (canReadFeedback ? data.feedback?.length ?? 0 : 0) + (canReadContent ? data.flags?.length ?? 0 : 0),
    }] : []),
  ];

  return (
    <div className="space-y-5">
      {backLink}

      {error && (
        <div role="status" className="rounded-xl border border-[var(--mp-status-warning)]/30 bg-[var(--mp-status-warning)]/10 text-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} />
          <span className="flex-1">Showing the last loaded user record. Refresh failed: {error}</span>
          <button type="button" onClick={load} className="mp-btn mp-btn--ghost mp-btn--sm" disabled={loading}>Retry</button>
        </div>
      )}

      {/* ── Identity header ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
        {/* ADM-Q17: avatar and name share a row on phones; quick actions wrap below. */}
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0 w-full lg:flex-1">
          {p.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.photo_url}
              alt=""
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl object-cover flex-shrink-0"
            />
          ) : (
            <div aria-hidden className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-[var(--mp-viridian)]/10 flex items-center justify-center text-xl sm:text-2xl font-bold text-[var(--mp-viridian)] flex-shrink-0">
              {p.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="min-w-0 max-w-full text-lg sm:text-xl font-semibold text-[var(--mp-fg)] [overflow-wrap:anywhere]">
                {p.name}
              </h1>
              {canReadRevenue && p.tier && <span
                className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border"
                style={{ color: tierTone, borderColor: tierTone }}
              >
                {p.tier}
              </span>}
              {can("access.manage") && p.role === "admin" && (
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

            {data.access && <AccessStripView access={data.access} />}

            {/* identifiers */}
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-[var(--mp-fg-muted)]">
              {p.email && (
                <span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]">
                  <Mail size={11} className="shrink-0" /> {p.email}
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
              <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[var(--mp-fg-subtle)] [overflow-wrap:anywhere]">
                <Fingerprint size={11} className="shrink-0" /> {p.id}
              </span>
              {p.language_code && (
                <span className="uppercase">{p.language_code}</span>
              )}
            </div>

            {/* meta line */}
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-[var(--mp-fg-subtle)]">
              <span>Joined {fmtDate(p.created_at)}</span>
              <span title={s.lastActivityBasis}>· Last active {s.lastActivity ? timeAgo(s.lastActivity) : "never"}</span>
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
              {canReadRevenue && p.referral_code && (
                <span className="font-mono">ref: {p.referral_code}</span>
              )}
            </div>
          </div>

          </div>

          {/* quick actions */}
          <div className="w-full lg:w-auto lg:flex-shrink-0">
            <UserQuickActions
            userId={p.id}
            userEmail={p.email}
            isBanned={!!p.is_banned}
            isAdmin={p.role === "admin"}
            tier={canReadRevenue ? p.tier : undefined}
            tierExpiresAt={canReadRevenue ? p.tier_expires_at : undefined}
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
          value={`${s.currentStreak}d`}
          sub={`Longest ${s.longestStreak}d · from answer days`}
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
        {canReadSessions && <StatCard
          label="Sessions"
          value={fmtInt(s.sessionsCount ?? 0)}
          sub={`${fmtInt(s.pageViewsCount)} page views`}
          icon={MonitorSmartphone}
          accent="var(--mp-fg)"
        />}
        {canReadNotes && <StatCard
          label="Flash-notes"
          value={fmtInt(s.notesCount ?? 0)}
          sub={`${fmtInt(s.aiChatsCount)} AI chats`}
          icon={StickyNote}
          accent="var(--mp-viridian)"
          tint="rgba(0,123,95,0.10)"
        />}
        {canReadRevenue && money && <StatCard
          label="Money"
          value={money.isPayer ? "Payer" : "—"}
          sub={
            money.isPayer
              ? fmtByCurrency(money.paidByCurrency)
              : money.trial?.active
                ? "trial active"
                : "no payment"
          }
          icon={CalendarCheck}
          accent={money.isPayer ? "var(--mp-viridian)" : "var(--mp-fg-muted)"}
          tint="rgba(0,123,95,0.10)"
        />}
      </div>

      {canReadRevenue && <MentorPanel userId={id} />}

      {/* behavior strip */}
      <div className="flex items-center gap-2 flex-wrap">
        <BehaviorChip icon={Eye} label="page views" value={s.pageViewsCount} />
        <BehaviorChip icon={SearchIcon} label="searches" value={s.searchesCount} />
        <BehaviorChip icon={Star} label="bookmarks" value={s.bookmarksCount} />
        {canReadNotes && <BehaviorChip icon={Sparkles} label="AI chats" value={s.aiChatsCount} />}
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

      {data.restricted_sections.length > 0 && (
        <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-4 py-3 text-xs text-[var(--mp-fg-muted)]">
          Some dossier sections are hidden because your role does not include those permissions.
        </div>
      )}

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
          {tab === "sessions" && canReadSessions && <SessionsPanel sessions={data.sessions ?? []} />}
          {tab === "notes" && canReadNotes && <NotesPanel notes={data.notes ?? []} />}
          {tab === "money" && canReadRevenue && money && <MoneyPanel money={money} />}
          {tab === "voice" && (canReadFeedback || canReadContent) && (
            <FeedbackFlagsPanel
              feedback={canReadFeedback ? data.feedback ?? [] : []}
              flags={canReadContent ? data.flags ?? [] : []}
              hasRestrictedSections={
                (data.restricted_sections.includes("feedback") && !canReadFeedback) ||
                (data.restricted_sections.includes("content_reports") && !canReadContent)
              }
            />
          )}
        </div>
      </div>

      <AdminHistoryBlock
        items={data.adminHistory}
        total={data.adminHistoryTotal}
        opsAvailable={data.adminHistoryOpsAvailable}
        canOpenAudit={can("system.read")}
        userId={p.id}
      />

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

function AccessStripView({ access }: { access: AccessStrip }) {
  const ends = access.endsAt ? fmtDate(access.endsAt) : null;
  const headline =
    access.state === "pro" ? `Pro until ${ends}` :
    access.state === "pro_no_end" ? "Pro, no end date" :
    access.state === "ended" ? `Pro ended ${ends}` :
    access.state === "admin_account" ? "Admin account" :
    "Free";
  const tone = access.source === "outside_admin" ? "var(--mp-status-warning)" : access.state === "pro" || access.state === "pro_no_end" ? "var(--mp-viridian)" : "var(--mp-fg-muted)";
  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: tone, color: "var(--mp-fg)" }}
      data-testid="access-strip"
    >
      <ShieldCheck size={14} className="mt-0.5 shrink-0" style={{ color: tone }} aria-hidden />
      <div className="min-w-0">
        <span className="font-semibold">{headline}</span>
        {access.state !== "free" && access.state !== "admin_account" && (
          <span className="text-[var(--mp-fg-muted)]"> ({access.sourceLabel})</span>
        )}
        {access.grantReason && (
          <p className="mt-0.5 text-[11px] text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]">
            Grant reason: {access.grantReason}{access.grantAt ? ` · ${fmtDate(access.grantAt)}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function AdminHistoryBlock({
  items,
  total,
  opsAvailable,
  canOpenAudit,
  userId,
}: {
  items: AdminHistoryItem[];
  total: number;
  opsAvailable: boolean;
  canOpenAudit: boolean;
  userId: string;
}) {
  return (
    <section aria-labelledby="admin-history-title" className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <History size={15} className="text-[var(--mp-fg-muted)]" aria-hidden />
        <h2 id="admin-history-title" className="text-sm font-semibold text-[var(--mp-fg)]">Admin history</h2>
        <span className="text-[11px] text-[var(--mp-fg-muted)]">Who changed this learner and why</span>
        {canOpenAudit && (
          <Link href={`/admin/audit?learner=${userId}`} className="ml-auto text-[11px] text-[var(--mp-cta-blue)] underline underline-offset-2">
            Open in audit log
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--mp-fg-muted)]">No admin or Ops action on this learner is recorded.</p>
      ) : (
        <ol className="divide-y divide-[var(--mp-border-subtle)] text-xs">
          {items.map((h) => (
            <li key={h.id} className="py-2 flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <span className="shrink-0 font-mono text-[10px] text-[var(--mp-fg-muted)] sm:w-36">{fmtDateTime(h.at)}</span>
              <div className="min-w-0">
                <span className="font-medium text-[var(--mp-fg)]">{h.action.replace(/_/g, " ")}</span>
                <span className="text-[var(--mp-fg-muted)]"> · {h.actor ?? "unknown actor"}</span>
                {h.origin === "ops" && <span className="ml-1 rounded bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--mp-fg-muted)]">Ops</span>}
                {h.summary && <p className="text-[11px] text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]">{h.summary}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[10px] text-[var(--mp-fg-subtle)]">
        Showing {items.length} of {total} recorded actions.
        {!opsAvailable && " Ops decisions appear after the a16 database changeset is applied."}
        {" "}Direct database writes are not recorded.
      </p>
    </section>
  );
}
