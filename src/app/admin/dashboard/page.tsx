"use client";

/**
 * Admin / Dashboard tab.
 *
 * KPI strip (8 cards) + live-registrations tracker + Clarity UX card
 * + DAU / Peak Hours / Topic Performance / Topic Distribution charts.
 *
 * Fetches `/api/stats/admin` (overview), `/api/stats/admin/new-users`
 * (polled every 30s), `/api/stats/admin/questions` (for the total-Q
 * + explanation-coverage KPIs — only the summary fields are used so
 * no pagination is required).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  FileText,
  Activity,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Zap,
  BarChart3,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { authFetch as fetch } from "@/lib/authFetch";
import { BrandedLoader } from "@/components/ui";
import {
  CHART_COLORS,
  type OverviewData,
  type NewUsersData,
  type QuestionStats,
} from "../_components/types";
import { NewUsersTracker } from "../_components/NewUsersTracker";
import { ClarityCard } from "../_components/ClarityCard";

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [newUsers, setNewUsers] = useState<NewUsersData | null>(null);
  const [newUsersBaseline, setNewUsersBaseline] = useState<number | null>(null);
  const [questionStats, setQuestionStats] = useState<QuestionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin");
      if (!res.ok) throw new Error("Failed to load overview");
      setOverview(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchQuestionStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/questions");
      if (!res.ok) return;
      setQuestionStats(await res.json());
    } catch {
      /* optional */
    }
  }, []);

  const fetchNewUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/new-users", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as NewUsersData;
      setNewUsers(data);
      setNewUsersBaseline((b) => (b === null ? data.total : b));
    } catch {
      /* polling, swallow */
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchOverview(), fetchQuestionStats(), fetchNewUsers()]);
      setLoading(false);
    })();
  }, [fetchOverview, fetchQuestionStats, fetchNewUsers]);

  // Live polling while on the Dashboard route.
  useEffect(() => {
    const id = setInterval(fetchNewUsers, 30000);
    return () => clearInterval(id);
  }, [fetchNewUsers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <BrandedLoader label="Loading dashboard…" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="mx-0 mt-4 bg-[var(--mp-error-bg)] border border-[var(--mp-error)]/25 text-[var(--mp-error)] text-sm rounded-xl px-4 py-3 flex items-center gap-2" role="alert">
        <AlertTriangle size={16} />
        <span className="flex-1">{error || "Failed to load dashboard."}</span>
      </div>
    );
  }

  const totalQuestionsInDB =
    questionStats?.totalAll ?? overview.avgAccuracyByTopic?.reduce((s, t) => s + t.total, 0) ?? 0;
  const explCoverage = questionStats ? questionStats.explPct : 0;

  const kpis = [
    { label: "Total Users", value: overview.totalUsers, icon: Users, color: "var(--mp-viridian)" },
    { label: "Active Users (DAU)", value: overview.dau, icon: Zap, color: "var(--mp-cta-blue)" },
    { label: "Weekly Active (WAU)", value: overview.wau, icon: TrendingUp, color: "var(--mp-status-warning)" },
    { label: "Monthly Active (MAU)", value: overview.mau, icon: Activity, color: "var(--mp-accent-teal)" },
    { label: "Questions Today", value: overview.questionsToday, icon: FileText, color: "var(--mp-error)" },
    { label: "Answered This Week", value: overview.questionsThisWeek, icon: BarChart3, color: "var(--mp-info)" },
    { label: "Total Questions in DB", value: totalQuestionsInDB, icon: FileText, color: "#8B5CF6" },
    { label: "Explanation Coverage", value: `${explCoverage}%`, icon: CheckCircle, color: "var(--mp-viridian)" },
  ];

  return (
    <>
      <NewUsersTracker data={newUsers} baseline={newUsersBaseline} onRefresh={fetchNewUsers} />
      <ClarityCard />

      <div className="space-y-6">
        {/* KPI Strip — .mp-stat primitive (MPDS Admin-A) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="mp-stat">
                <div className="flex items-center justify-between">
                  <span className="mp-stat__label">{kpi.label}</span>
                  <Icon size={16} style={{ color: kpi.color }} aria-hidden />
                </div>
                <span className="mp-stat__value" style={{ color: kpi.color }}>{kpi.value}</span>
              </div>
            );
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* DAU Chart */}
          <div className="card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4">Daily Active Users (30d)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={overview.dailyActiveUsers}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mp-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="users" stroke="var(--mp-viridian)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Peak Hours */}
          <div className="card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4">Peak Study Hours</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={overview.peakStudyHours}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mp-border)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--mp-cta-blue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Topic Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-[var(--mp-viridian)]" /> Top 5 Topics
            </h3>
            <div className="space-y-3">
              {overview.topTopics.map((t, i) => (
                <div key={t.topic} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[var(--mp-fg-subtle)] w-5">{i + 1}.</span>
                    <span className="text-sm text-[var(--mp-fg-muted)] truncate max-w-[180px]">{t.topic}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">{t.total} Q</span>
                    <span className={`text-xs font-mono font-bold ${t.accuracy >= 70 ? "text-[var(--mp-viridian)]" : t.accuracy >= 40 ? "text-[var(--mp-status-warning)]" : "text-[var(--mp-error)]"}`}>
                      {t.accuracy}%
                    </span>
                  </div>
                </div>
              ))}
              {overview.topTopics.length === 0 && (
                <p className="text-xs text-[var(--mp-fg-subtle)] text-center py-4">No data yet</p>
              )}
            </div>
          </div>

          <div className="card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--mp-error)]" /> Weakest 5 Topics
            </h3>
            <div className="space-y-3">
              {overview.weakTopics.map((t, i) => (
                <div key={t.topic} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[var(--mp-fg-subtle)] w-5">{i + 1}.</span>
                    <span className="text-sm text-[var(--mp-fg-muted)] truncate max-w-[180px]">{t.topic}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">{t.total} Q</span>
                    <span className="text-xs font-mono font-bold text-[var(--mp-error)]">{t.accuracy}%</span>
                  </div>
                </div>
              ))}
              {overview.weakTopics.length === 0 && (
                <p className="text-xs text-[var(--mp-fg-subtle)] text-center py-4">No data yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Topic Distribution Pie */}
        {overview.avgAccuracyByTopic.length > 0 && (
          <div className="card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4">Question Distribution by Topic</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={overview.avgAccuracyByTopic.filter((t) => t.total > 0)}
                  dataKey="total"
                  nameKey="topic"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, value }) => `${String(name || "").slice(0, 15)} (${value})`}
                >
                  {overview.avgAccuracyByTopic.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}
