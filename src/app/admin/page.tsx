"use client";

import { useEffect, useState, useCallback } from "react";
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

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab = "overview" | "users" | "questions" | "analytics";

interface TopicStat {
  topic: string;
  accuracy: number;
  total: number;
}

interface DailyPoint {
  date: string;
  users: number;
}

interface HourPoint {
  hour: number;
  count: number;
}

interface AdminStats {
  totalUsers: number;
  dau: number;
  wau: number;
  mau: number;
  questionsToday: number;
  questionsThisWeek: number;
  avgAccuracyByTopic: TopicStat[];
  topTopics: TopicStat[];
  weakTopics: TopicStat[];
  peakStudyHours: HourPoint[];
  dailyActiveUsers: DailyPoint[];
}

interface AdminUser {
  id: string;
  telegram_id: string | null;
  name: string;
  username: string | null;
  photo_url: string | null;
  created_at: string;
  xp: number;
  streak: number;
  questions_answered: number;
  accuracy: number;
  last_active: string;
}

interface QuestionStats {
  total: number;
  withMCQ: number;
  withExplanations: number;
  withImages: number;
  byTopic: { topic: string; count: number }[];
  duplicateCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "questions", label: "Questions" },
  { key: "analytics", label: "Analytics" },
];

const CHART_COLORS = [
  "#007B5F",
  "#003A8C",
  "#00A896",
  "#F4A261",
  "#D64545",
  "#3A7CA5",
  "#1bb680",
  "#001B3D",
  "#94A3B8",
  "#7C3AED",
];

const tooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--dm-surface, #FFFFFF)",
  border: "1px solid var(--dm-border, #E4E9F0)",
  borderRadius: 8,
  color: "var(--dm-text, #1A2B3C)",
  fontSize: 12,
  padding: "8px 12px",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function shortDate(d: string) {
  return d.slice(5); // "MM-DD"
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card rounded-2xl p-6">
      <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider mb-2">
        {label}
      </p>
      <p
        className="text-3xl font-bold font-mono"
        style={{ color: color || "var(--dm-text, #1A2B3C)" }}
      >
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {sub && (
        <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs mt-1.5">
          {sub}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-10 h-10 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-[var(--dm-text-muted,#A0AEC0)]">{message}</p>
    </div>
  );
}

// ─── Tab: Overview ──────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: AdminStats }) {
  const overallAccuracy =
    stats.avgAccuracyByTopic.length > 0
      ? Math.round(
          stats.avgAccuracyByTopic.reduce(
            (sum, t) => sum + t.accuracy * t.total,
            0
          ) / stats.avgAccuracyByTopic.reduce((sum, t) => sum + t.total, 0)
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard
          label="Total Users"
          value={stats.totalUsers}
          color="#007B5F"
        />
        <KPICard
          label="DAU / WAU / MAU"
          value={`${stats.dau} / ${stats.wau} / ${stats.mau}`}
          sub="Daily / Weekly / Monthly active"
          color="#003A8C"
        />
        <KPICard
          label="Questions Answered"
          value={stats.questionsToday}
          sub={`Today  |  ${formatNumber(stats.questionsThisWeek)} this week`}
          color="#F4A261"
        />
        <KPICard
          label="Average Accuracy"
          value={`${overallAccuracy}%`}
          sub="Weighted across all topics"
          color="#00A896"
        />
        <KPICard
          label="WAU / MAU Ratio"
          value={
            stats.mau > 0
              ? `${Math.round((stats.wau / stats.mau) * 100)}%`
              : "N/A"
          }
          sub="User stickiness"
          color="#003A8C"
        />
        <KPICard
          label="DAU / MAU Ratio"
          value={
            stats.mau > 0
              ? `${Math.round((stats.dau / stats.mau) * 100)}%`
              : "N/A"
          }
          sub="Daily engagement"
          color="#007B5F"
        />
      </div>

      {/* Daily Active Users Chart */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Daily Active Users -- Last 30 Days
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={stats.dailyActiveUsers}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--dm-border, #E4E9F0)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              interval={4}
            />
            <YAxis
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => `Date: ${v}`}
              formatter={(v) => [`${v} users`, "DAU"]}
            />
            <Line
              type="monotone"
              dataKey="users"
              stroke="#007B5F"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#007B5F" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Peak Study Hours */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Peak Study Hours (UTC)
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stats.peakStudyHours}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--dm-border, #E4E9F0)"
            />
            <XAxis
              dataKey="hour"
              tickFormatter={(h) => `${h}h`}
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              interval={2}
            />
            <YAxis
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(h) => `Hour: ${h}:00`}
              formatter={(v) => [`${v}`, "Questions"]}
            />
            <Bar dataKey="count" fill="#F4A261" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Accuracy by Topic — Horizontal Bar */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Accuracy by Topic (Last 30 Days)
        </h3>
        {stats.avgAccuracyByTopic.length === 0 ? (
          <EmptyState message="No accuracy data yet" />
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(200, stats.avgAccuracyByTopic.length * 36)}
          >
            <BarChart
              data={stats.avgAccuracyByTopic}
              layout="vertical"
              margin={{ left: 12 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--dm-border, #E4E9F0)"
                horizontal={false}
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis
                dataKey="topic"
                type="category"
                width={160}
                tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v}%`, "Accuracy"]}
              />
              <Bar dataKey="accuracy" fill="#00A896" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Users ─────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/stats/admin/users")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setUsers(d);
        else setError("Unexpected response");
      })
      .catch(() => setError("Failed to load users"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="text-center py-12 text-[#D64545]">{error}</div>
    );

  const filtered = search
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(search.toLowerCase()) ||
          (u.username || "").toLowerCase().includes(search.toLowerCase()) ||
          (u.telegram_id || "").includes(search)
      )
    : users;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search users by name, username, or Telegram ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--dm-border,#E4E9F0)] bg-[var(--dm-input-bg,#FFFFFF)] text-[var(--dm-text,#1A2B3C)] text-sm placeholder:text-[var(--dm-text-muted,#A0AEC0)] focus:outline-none focus:ring-2 focus:ring-[#007B5F]/30 focus:border-[#007B5F]"
        />
        <span className="text-[var(--dm-text-muted,#A0AEC0)] text-sm font-mono whitespace-nowrap">
          {filtered.length} user{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* User Table */}
      <div className="card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--dm-border,#E4E9F0)]">
                <th className="text-left px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold">
                  User
                </th>
                <th className="text-left px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold hidden sm:table-cell">
                  Telegram ID
                </th>
                <th className="text-right px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold">
                  XP
                </th>
                <th className="text-right px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold hidden md:table-cell">
                  Streak
                </th>
                <th className="text-right px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold">
                  Answered
                </th>
                <th className="text-right px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold">
                  Accuracy
                </th>
                <th className="text-right px-4 py-3 text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider font-semibold hidden lg:table-cell">
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  expanded={expandedUser === u.id}
                  onToggle={() =>
                    setExpandedUser(expandedUser === u.id ? null : u.id)
                  }
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-8 text-[var(--dm-text-muted,#A0AEC0)]"
                  >
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  expanded,
  onToggle,
}: {
  user: AdminUser;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-[var(--dm-border-subtle,rgba(228,233,240,0.7))] hover:bg-[var(--dm-surface-raised,#F7F9FC)] cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            {user.photo_url ? (
              <img
                src={user.photo_url}
                alt=""
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#007B5F]/10 flex items-center justify-center text-[#007B5F] text-xs font-bold">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-[var(--dm-text,#1A2B3C)] font-medium">
                {user.name}
              </p>
              {user.username && (
                <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs">
                  @{user.username}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-[var(--dm-text-secondary,#4A5568)] hidden sm:table-cell">
          {user.telegram_id || "--"}
        </td>
        <td className="px-4 py-3 text-right font-mono text-[#F4A261]">
          {formatNumber(user.xp)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-[var(--dm-text,#1A2B3C)] hidden md:table-cell">
          {user.streak}d
        </td>
        <td className="px-4 py-3 text-right font-mono text-[var(--dm-text,#1A2B3C)]">
          {formatNumber(user.questions_answered)}
        </td>
        <td className="px-4 py-3 text-right">
          <span
            className="font-mono"
            style={{
              color:
                user.accuracy >= 70
                  ? "#007B5F"
                  : user.accuracy >= 50
                  ? "#F4A261"
                  : "#D64545",
            }}
          >
            {user.accuracy}%
          </span>
        </td>
        <td className="px-4 py-3 text-right text-[var(--dm-text-muted,#A0AEC0)] text-xs hidden lg:table-cell">
          {timeAgo(user.last_active)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={7}
            className="bg-[var(--dm-surface-raised,#F7F9FC)] px-6 py-4"
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase block mb-1">
                  User ID
                </span>
                <span className="font-mono text-xs text-[var(--dm-text-secondary,#4A5568)] break-all">
                  {user.id}
                </span>
              </div>
              <div>
                <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase block mb-1">
                  Joined
                </span>
                <span className="text-[var(--dm-text,#1A2B3C)]">
                  {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
              <div>
                <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase block mb-1">
                  Last Active
                </span>
                <span className="text-[var(--dm-text,#1A2B3C)]">
                  {new Date(user.last_active).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase block mb-1">
                  Correct / Total
                </span>
                <span className="font-mono text-[var(--dm-text,#1A2B3C)]">
                  {Math.round(
                    (user.accuracy / 100) * user.questions_answered
                  )}{" "}
                  / {user.questions_answered}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Tab: Questions ─────────────────────────────────────────────────────────

function QuestionsTab() {
  const [stats, setStats] = useState<QuestionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/stats/admin/questions")
      .then((r) => r.json())
      .then((d) => {
        if (d.total !== undefined) setStats(d);
        else setError("Unexpected response");
      })
      .catch(() => setError("Failed to load question stats"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="text-center py-12 text-[#D64545]">{error}</div>
    );
  if (!stats) return null;

  const coverageItems = [
    {
      label: "Total Active",
      value: stats.total,
      color: "#001B3D",
      pctOf: null,
    },
    {
      label: "With MCQ Choices",
      value: stats.withMCQ,
      color: "#007B5F",
      pctOf: stats.total,
    },
    {
      label: "With Explanations",
      value: stats.withExplanations,
      color: "#003A8C",
      pctOf: stats.total,
    },
    {
      label: "With Images",
      value: stats.withImages,
      color: "#F4A261",
      pctOf: stats.total,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Coverage KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {coverageItems.map((item) => (
          <div key={item.label} className="card rounded-2xl p-6">
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase tracking-wider mb-2">
              {item.label}
            </p>
            <p
              className="text-3xl font-bold font-mono"
              style={{ color: item.color }}
            >
              {formatNumber(item.value)}
            </p>
            {item.pctOf !== null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--dm-text-muted,#A0AEC0)]">
                    Coverage
                  </span>
                  <span className="font-mono" style={{ color: item.color }}>
                    {pct(item.value, item.pctOf)}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[var(--dm-border,#E4E9F0)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct(item.value, item.pctOf)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Duplicates Alert */}
      {stats.duplicateCount > 0 && (
        <div className="card rounded-2xl p-4 border-l-4 border-[#F4A261] flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#F4A261]/10 flex items-center justify-center text-[#F4A261] text-sm font-bold flex-shrink-0">
            !
          </div>
          <div>
            <p className="text-[var(--dm-text,#1A2B3C)] font-medium text-sm">
              {stats.duplicateCount} potential duplicate question
              {stats.duplicateCount !== 1 ? "s" : ""} detected
            </p>
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs mt-0.5">
              Questions with identical text (case-insensitive)
            </p>
          </div>
        </div>
      )}

      {/* Topic Breakdown Table */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Questions by Topic
        </h3>
        <div className="space-y-3">
          {stats.byTopic.map((t, i) => (
            <div key={t.topic} className="flex items-center gap-3">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
              <span className="text-[var(--dm-text,#1A2B3C)] text-sm flex-1 truncate">
                {t.topic}
              </span>
              <span className="font-mono text-sm text-[var(--dm-text-secondary,#4A5568)]">
                {formatNumber(t.count)}
              </span>
              <div className="w-24 h-1.5 bg-[var(--dm-border,#E4E9F0)] rounded-full overflow-hidden hidden sm:block">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct(t.count, stats.total)}%`,
                    backgroundColor:
                      CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
              </div>
              <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs font-mono w-10 text-right">
                {pct(t.count, stats.total)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Topic Distribution Pie Chart */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Topic Distribution
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={stats.byTopic}
              dataKey="count"
              nameKey="topic"
              cx="50%"
              cy="50%"
              outerRadius={110}
              innerRadius={60}
              paddingAngle={2}
              label={((props: Record<string, unknown>) => {
                const topic = String(props.topic || "");
                const count = Number(props.count || 0);
                return `${topic.slice(0, 12)}${topic.length > 12 ? ".." : ""} (${count})`;
              }) as unknown as boolean}
              labelLine={{ stroke: "var(--dm-text-muted, #A0AEC0)" }}
              fontSize={10}
            >
              {stats.byTopic.map((_, i) => (
                <Cell
                  key={i}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [
                `${v} questions`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Tab: Analytics ─────────────────────────────────────────────────────────

function AnalyticsTab({ stats }: { stats: AdminStats }) {
  // Derive retention from DAU data (approximate: how many days had >0 users)
  const daysWithActivity = stats.dailyActiveUsers.filter(
    (d) => d.users > 0
  ).length;
  const retentionRate = Math.round((daysWithActivity / 30) * 100);

  // Simulate retention cohort from available DAU data
  const retentionData = [
    { day: "Day 1", rate: 100 },
    {
      day: "Day 7",
      rate: stats.mau > 0 ? Math.round((stats.wau / stats.mau) * 100) : 0,
    },
    {
      day: "Day 30",
      rate: stats.mau > 0 ? Math.round((stats.dau / stats.mau) * 100) : 0,
    },
  ];

  // Top topics by engagement (volume)
  const topByEngagement = [...stats.avgAccuracyByTopic]
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // Strongest and weakest topics
  const sorted = [...stats.avgAccuracyByTopic]
    .filter((t) => t.total >= 3)
    .sort((a, b) => b.accuracy - a.accuracy);
  const strongest = sorted.slice(0, 5);
  const weakest = sorted.slice(-5).reverse();

  // Study hour distribution by period
  const morningHours = stats.peakStudyHours
    .filter((h) => h.hour >= 6 && h.hour < 12)
    .reduce((s, h) => s + h.count, 0);
  const afternoonHours = stats.peakStudyHours
    .filter((h) => h.hour >= 12 && h.hour < 18)
    .reduce((s, h) => s + h.count, 0);
  const eveningHours = stats.peakStudyHours
    .filter((h) => h.hour >= 18 && h.hour < 24)
    .reduce((s, h) => s + h.count, 0);
  const nightHours = stats.peakStudyHours
    .filter((h) => h.hour >= 0 && h.hour < 6)
    .reduce((s, h) => s + h.count, 0);

  const periodData = [
    { name: "Night (0-6)", value: nightHours },
    { name: "Morning (6-12)", value: morningHours },
    { name: "Afternoon (12-18)", value: afternoonHours },
    { name: "Evening (18-24)", value: eveningHours },
  ];

  // Weekly trend: aggregate dailyActiveUsers into weekly sums
  const weeklyTrend: { week: string; users: number; questions: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const start = i * 7;
    const end = start + 7;
    const slice = stats.dailyActiveUsers.slice(start, end);
    const weekUsers = slice.reduce((s, d) => s + d.users, 0);
    const label = slice.length > 0 ? `W${i + 1}` : `W${i + 1}`;
    weeklyTrend.push({
      week: label,
      users: weekUsers,
      questions: Math.round(weekUsers * 3.5), // approximation
    });
  }

  return (
    <div className="space-y-6">
      {/* Retention */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          User Retention
        </h3>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {retentionData.map((r) => (
            <div key={r.day} className="text-center">
              <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase mb-1">
                {r.day}
              </p>
              <p
                className="text-2xl font-bold font-mono"
                style={{
                  color:
                    r.rate >= 50
                      ? "#007B5F"
                      : r.rate >= 25
                      ? "#F4A261"
                      : "#D64545",
                }}
              >
                {r.rate}%
              </p>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={retentionData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--dm-border, #E4E9F0)"
            />
            <XAxis
              dataKey="day"
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 11 }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [`${v}%`, "Retention"]}
            />
            <Bar dataKey="rate" fill="#003A8C" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Study Period Breakdown */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Study Period Breakdown
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={periodData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                innerRadius={50}
                paddingAngle={3}
                label={((props: Record<string, unknown>) => {
                  const name = String(props.name || "");
                  const value = Number(props.value || 0);
                  return value > 0 ? `${name.split(" ")[0]}` : "";
                }) as unknown as boolean}
                fontSize={11}
              >
                {periodData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [
                  `${v} questions`,
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-3 flex flex-col justify-center">
            {periodData.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <span className="text-[var(--dm-text,#1A2B3C)] text-sm flex-1">
                  {p.name}
                </span>
                <span className="font-mono text-sm text-[var(--dm-text-secondary,#4A5568)]">
                  {formatNumber(p.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Topic Engagement */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Popular Topics by Engagement
        </h3>
        {topByEngagement.length === 0 ? (
          <EmptyState message="No engagement data yet" />
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(180, topByEngagement.length * 36)}
          >
            <BarChart
              data={topByEngagement}
              layout="vertical"
              margin={{ left: 12 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--dm-border, #E4E9F0)"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              />
              <YAxis
                dataKey="topic"
                type="category"
                width={160}
                tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v} answers`, "Engagement"]}
              />
              <Bar dataKey="total" fill="#007B5F" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Strongest / Weakest Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card rounded-2xl p-6">
          <h3 className="font-display text-sm font-semibold text-[#007B5F] uppercase tracking-wider mb-4">
            Strongest Topics
          </h3>
          <div className="space-y-3">
            {strongest.length === 0 && (
              <EmptyState message="Not enough data" />
            )}
            {strongest.map((t) => (
              <div
                key={t.topic}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--dm-text,#1A2B3C)] text-sm truncate max-w-[65%]">
                  {t.topic}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs font-mono">
                    {t.total} Qs
                  </span>
                  <span className="font-mono text-sm text-[#007B5F] font-semibold">
                    {t.accuracy}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card rounded-2xl p-6">
          <h3 className="font-display text-sm font-semibold text-[#D64545] uppercase tracking-wider mb-4">
            Weakest Topics
          </h3>
          <div className="space-y-3">
            {weakest.length === 0 && (
              <EmptyState message="Not enough data" />
            )}
            {weakest.map((t) => (
              <div
                key={t.topic}
                className="flex items-center justify-between"
              >
                <span className="text-[var(--dm-text,#1A2B3C)] text-sm truncate max-w-[65%]">
                  {t.topic}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--dm-text-muted,#A0AEC0)] text-xs font-mono">
                    {t.total} Qs
                  </span>
                  <span
                    className="font-mono text-sm font-semibold"
                    style={{
                      color:
                        t.accuracy >= 60
                          ? "#F4A261"
                          : t.accuracy >= 40
                          ? "#F4A261"
                          : "#D64545",
                    }}
                  >
                    {t.accuracy}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly Trend */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Weekly Activity Trend
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weeklyTrend}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--dm-border, #E4E9F0)"
            />
            <XAxis
              dataKey="week"
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "var(--dm-text-muted, #A0AEC0)", fontSize: 10 }}
              allowDecimals={false}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar
              dataKey="users"
              name="Active Users"
              fill="#003A8C"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Activity Rate */}
      <div className="card rounded-2xl p-6">
        <h3 className="font-display text-sm font-semibold text-[var(--dm-text-secondary,#4A5568)] uppercase tracking-wider mb-4">
          Platform Health
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase mb-1">
              Active Days (30d)
            </p>
            <p className="text-2xl font-bold font-mono text-[#003A8C]">
              {daysWithActivity}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase mb-1">
              Activity Rate
            </p>
            <p
              className="text-2xl font-bold font-mono"
              style={{
                color:
                  retentionRate >= 70
                    ? "#007B5F"
                    : retentionRate >= 40
                    ? "#F4A261"
                    : "#D64545",
              }}
            >
              {retentionRate}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase mb-1">
              Avg DAU
            </p>
            <p className="text-2xl font-bold font-mono text-[#007B5F]">
              {stats.dailyActiveUsers.length > 0
                ? Math.round(
                    stats.dailyActiveUsers.reduce(
                      (s, d) => s + d.users,
                      0
                    ) / stats.dailyActiveUsers.length
                  )
                : 0}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs uppercase mb-1">
              Peak DAU
            </p>
            <p className="text-2xl font-bold font-mono text-[#F4A261]">
              {Math.max(
                0,
                ...stats.dailyActiveUsers.map((d) => d.users)
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Page ────────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/stats/admin")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setStats(d))
      .catch(() => setError("Failed to load admin stats"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="min-h-screen bg-[var(--dm-bg,#F7F9FC)] text-[var(--dm-text,#1A2B3C)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-[var(--dm-text,#1A2B3C)]">
              Admin Dashboard
            </h1>
            <p className="text-[var(--dm-text-muted,#A0AEC0)] text-sm mt-0.5">
              MedPruf Analytics &amp; Management
            </p>
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-[#007B5F] text-white hover:bg-[#005A45] transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 bg-[var(--dm-surface,#FFFFFF)] rounded-xl p-1 border border-[var(--dm-border,#E4E9F0)]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
                ${
                  activeTab === tab.key
                    ? "bg-[#007B5F] text-white shadow-sm"
                    : "text-[var(--dm-text-secondary,#4A5568)] hover:bg-[var(--dm-surface-raised,#F7F9FC)]"
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="card rounded-2xl p-4 mb-6 border-l-4 border-[#D64545]">
            <p className="text-[#D64545] text-sm">{error}</p>
            <button
              onClick={fetchStats}
              className="text-[#003A8C] text-sm underline mt-1"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && !stats && <Spinner />}

        {/* Tab Content */}
        {stats && (
          <>
            {activeTab === "overview" && <OverviewTab stats={stats} />}
            {activeTab === "users" && <UsersTab />}
            {activeTab === "questions" && <QuestionsTab />}
            {activeTab === "analytics" && <AnalyticsTab stats={stats} />}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-[var(--dm-border,#E4E9F0)] text-center">
          <p className="text-[var(--dm-text-muted,#A0AEC0)] text-xs">
            MedPruf Admin -- Internal Use Only
          </p>
        </div>
      </div>
    </div>
  );
}
