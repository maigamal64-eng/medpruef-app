"use client";

import { useEffect, useState } from "react";
import { getStoredSession } from "@/lib/auth";
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
} from "recharts";

const ADMIN_IDS = ["1", "admin"]; // extend with real Telegram user IDs

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

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-[#191F31] border border-[#3D4947] rounded p-4">
      <p className="text-[#879391] text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${accent || "text-[#DCE1FB]"}`}>{value}</p>
      {sub && <p className="text-[#879391] text-xs mt-1">{sub}</p>}
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "#191F31",
  border: "1px solid #3D4947",
  borderRadius: 6,
  color: "#DCE1FB",
  fontSize: 12,
};

export default function AdminPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const session = getStoredSession();
    const uid = session?.user?.id || "";
    // Allow if userId is in ADMIN_IDS, or if id starts with known admin prefix
    if (ADMIN_IDS.includes(uid) || uid.startsWith("admin")) {
      setAuthorized(true);
      fetch("/api/stats/admin")
        .then((r) => r.json())
        .then((d) => setStats(d))
        .catch(() => setError("Failed to load stats"))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
        <div className="w-10 h-10 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
        <div className="text-center">
          <p className="text-5xl mb-4">🔒</p>
          <p className="text-[#879391]">Access denied</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
        <p className="text-[#FFB4AB]">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const shortDate = (d: string) => d.slice(5); // "MM-DD"

  return (
    <div className="min-h-screen bg-[#0C1324] text-[#DCE1FB] p-4 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#DCE1FB]">Admin Dashboard</h1>
          <p className="text-[#879391] text-sm mt-1">MedPrüf Analytics</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total Users" value={stats.totalUsers} accent="text-[#6BD8CB]" />
          <StatCard label="DAU" value={stats.dau} sub="Active today" accent="text-[#4EDEA3]" />
          <StatCard label="WAU" value={stats.wau} sub="Active this week" />
          <StatCard label="MAU" value={stats.mau} sub="Active this month" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-8">
          <StatCard
            label="Questions Today"
            value={stats.questionsToday}
            accent="text-[#FFB95F]"
          />
          <StatCard
            label="Questions This Week"
            value={stats.questionsThisWeek}
            accent="text-[#FFB95F]"
          />
        </div>

        {/* Daily Active Users Chart */}
        <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#BCC9C6] uppercase tracking-wider mb-4">
            Daily Active Users — Last 30 Days
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={stats.dailyActiveUsers}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23293C" />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: "#879391", fontSize: 10 }}
                interval={4}
              />
              <YAxis tick={{ fill: "#879391", fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => `Date: ${v}`}
                formatter={(v) => [`${v} users`, "DAU"]}
              />
              <Line
                type="monotone"
                dataKey="users"
                stroke="#6BD8CB"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Peak Study Hours */}
        <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#BCC9C6] uppercase tracking-wider mb-4">
            Peak Study Hours (UTC)
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.peakStudyHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="#23293C" />
              <XAxis
                dataKey="hour"
                tickFormatter={(h) => `${h}h`}
                tick={{ fill: "#879391", fontSize: 10 }}
                interval={2}
              />
              <YAxis tick={{ fill: "#879391", fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(h) => `Hour: ${h}:00`}
                formatter={(v) => [`${v}`, "Questions"]}
              />
              <Bar dataKey="count" fill="#FFB95F" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Accuracy by Topic */}
        <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#BCC9C6] uppercase tracking-wider mb-4">
            Accuracy by Topic (last 30 days)
          </h2>
          {stats.avgAccuracyByTopic.length === 0 ? (
            <p className="text-[#879391] text-sm">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={stats.avgAccuracyByTopic}
                layout="vertical"
                margin={{ left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#23293C" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "#879391", fontSize: 10 }} />
                <YAxis
                  dataKey="topic"
                  type="category"
                  width={130}
                  tick={{ fill: "#879391", fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => [`${v}%`, "Accuracy"]}
                />
                <Bar dataKey="accuracy" fill="#4EDEA3" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top & Weak Topics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-4">
            <h2 className="text-sm font-semibold text-[#4EDEA3] uppercase tracking-wider mb-3">
              Top Topics by Volume
            </h2>
            <div className="space-y-2">
              {stats.topTopics.length === 0 && (
                <p className="text-[#879391] text-sm">No data yet</p>
              )}
              {stats.topTopics.map((t) => (
                <div key={t.topic} className="flex items-center justify-between text-sm">
                  <span className="text-[#BCC9C6] truncate max-w-[65%]">{t.topic}</span>
                  <span className="text-[#879391] font-mono text-xs">{t.total} Qs</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#191F31] border border-[#3D4947] rounded p-4">
            <h2 className="text-sm font-semibold text-[#FFB4AB] uppercase tracking-wider mb-3">
              Weak Topics (lowest accuracy)
            </h2>
            <div className="space-y-2">
              {stats.weakTopics.length === 0 && (
                <p className="text-[#879391] text-sm">No data yet</p>
              )}
              {stats.weakTopics.map((t) => (
                <div key={t.topic} className="flex items-center justify-between text-sm">
                  <span className="text-[#BCC9C6] truncate max-w-[65%]">{t.topic}</span>
                  <span
                    className={`font-mono text-xs ${
                      t.accuracy >= 60 ? "text-[#4EDEA3]" : t.accuracy >= 40 ? "text-[#FFB95F]" : "text-[#FFB4AB]"
                    }`}
                  >
                    {t.accuracy}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
