"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────────

type Tab = "overview" | "users" | "questions" | "analytics";

interface OverviewData {
  totalUsers: number;
  dau: number;
  wau: number;
  mau: number;
  questionsToday: number;
  questionsThisWeek: number;
  avgAccuracyByTopic: { topic: string; accuracy: number; total: number }[];
  topTopics: { topic: string; accuracy: number; total: number }[];
  weakTopics: { topic: string; accuracy: number; total: number }[];
  peakStudyHours: { hour: number; count: number }[];
  dailyActiveUsers: { date: string; users: number }[];
}

interface UserRow {
  id: string;
  telegram_id: string | null;
  email: string | null;
  name: string;
  username: string | null;
  photo_url: string | null;
  role: string;
  created_at: string;
  xp: number;
  streak: number;
  questions_answered: number;
  accuracy: number;
  last_active: string;
}

interface DuplicateData {
  totalGroups: number;
  totalExtraCopies: number;
  groups: {
    text: string;
    count: number;
    questions: { id: number; topic: string; exam_dates: string[]; anki_note_id: number | null }[];
  }[];
}

interface ActivityRow {
  id: number;
  user_id: string;
  session_id: string;
  event_type: string;
  page: string | null;
  action: string | null;
  metadata: Record<string, unknown>;
  question_id: number | null;
  topic: string | null;
  duration_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

const COLORS = ["#007B5F", "#003A8C", "#F4A261", "#D64545", "#00A896", "#3A7CA5", "#8B5CF6", "#EC4899"];

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateData | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityEventTypes, setActivityEventTypes] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin");
      if (!res.ok) throw new Error("Failed");
      setOverview(await res.json());
    } catch { setError("Failed to load overview"); }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/users");
      if (!res.ok) throw new Error("Failed");
      setUsers(await res.json());
    } catch { setError("Failed to load users"); }
  }, []);

  const fetchDuplicates = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/duplicates");
      if (!res.ok) throw new Error("Failed");
      setDuplicates(await res.json());
    } catch { /* optional */ }
  }, []);

  const fetchActivity = useCallback(async (eventType?: string, userId?: string) => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (eventType) params.set("eventType", eventType);
      if (userId) params.set("userId", userId);
      const res = await fetch(`/api/stats/admin/activity?${params}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setActivities(data.activities || []);
      setActivityTotal(data.total || 0);
      setActivityEventTypes(data.eventTypes || []);
    } catch { /* optional */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    await Promise.all([fetchOverview(), fetchUsers()]);
    setLoading(false);
  }, [fetchOverview, fetchUsers]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (tab === "questions" && !duplicates) fetchDuplicates();
    if (tab === "analytics" && activities.length === 0) fetchActivity();
  }, [tab, duplicates, activities.length, fetchDuplicates, fetchActivity]);

  const filteredUsers = users.filter((u) => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q) || u.id.includes(q);
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "users", label: `Users (${users.length})` },
    { key: "questions", label: "Questions" },
    { key: "analytics", label: "Analytics" },
  ];

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#1A2B3C]">Admin Dashboard</h1>
            <p className="text-sm text-[#A0AEC0]">MedPrüf Analytics & Management</p>
          </div>
          <button onClick={refresh} className="btn-primary px-4 py-2 text-sm rounded-xl">
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl p-1 shadow-sm border border-[#E4E9F0]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? "bg-[#007B5F] text-white shadow-sm"
                  : "text-[#4A5568] hover:bg-[#F7F9FC]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-[#D64545]/10 border border-[#D64545]/25 text-[#D64545] text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-[#A0AEC0]">Loading...</div>
        ) : (
          <>
            {tab === "overview" && overview && <OverviewTab data={overview} />}
            {tab === "users" && (
              <UsersTab
                users={filteredUsers}
                search={userSearch}
                onSearch={setUserSearch}
                selectedUser={selectedUser}
                onSelectUser={(id) => { setSelectedUser(id === selectedUser ? null : id); }}
              />
            )}
            {tab === "questions" && <QuestionsTab duplicates={duplicates} onRefresh={fetchDuplicates} />}
            {tab === "analytics" && (
              <AnalyticsTab
                activities={activities}
                total={activityTotal}
                eventTypes={activityEventTypes}
                filter={activityFilter}
                onFilterChange={(f) => { setActivityFilter(f); fetchActivity(f || undefined); }}
              />
            )}
          </>
        )}

        <p className="text-center text-xs text-[#A0AEC0] mt-8">MedPrüf Admin — Internal Use Only</p>
      </div>
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────

function OverviewTab({ data }: { data: OverviewData }) {
  const metrics = [
    { label: "Total Users", value: data.totalUsers, color: "text-[#007B5F]" },
    { label: "DAU", value: data.dau, color: "text-[#003A8C]" },
    { label: "WAU", value: data.wau, color: "text-[#F4A261]" },
    { label: "MAU", value: data.mau, color: "text-[#00A896]" },
    { label: "Q Today", value: data.questionsToday, color: "text-[#D64545]" },
    { label: "Q This Week", value: data.questionsThisWeek, color: "text-[#3A7CA5]" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="card rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold font-mono ${m.color}`}>{m.value}</p>
            <p className="text-xs text-[#A0AEC0] mt-1">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DAU Chart */}
        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Daily Active Users (30d)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.dailyActiveUsers}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="users" stroke="#007B5F" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Peak Hours */}
        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Study Hours Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.peakStudyHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F0" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#003A8C" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Topic Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Top Topics (by volume)</h3>
          <div className="space-y-3">
            {data.topTopics.map((t) => (
              <div key={t.topic} className="flex items-center justify-between">
                <span className="text-sm text-[#4A5568] truncate max-w-[200px]">{t.topic}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#A0AEC0] font-mono">{t.total} Q</span>
                  <span className={`text-xs font-mono font-bold ${t.accuracy >= 70 ? "text-[#00A896]" : t.accuracy >= 40 ? "text-[#F4A261]" : "text-[#D64545]"}`}>
                    {t.accuracy}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Weakest Topics (need improvement)</h3>
          <div className="space-y-3">
            {data.weakTopics.map((t) => (
              <div key={t.topic} className="flex items-center justify-between">
                <span className="text-sm text-[#4A5568] truncate max-w-[200px]">{t.topic}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#A0AEC0] font-mono">{t.total} Q</span>
                  <span className="text-xs font-mono font-bold text-[#D64545]">{t.accuracy}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Accuracy by Topic Pie */}
      {data.avgAccuracyByTopic.length > 0 && (
        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Question Distribution by Topic</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data.avgAccuracyByTopic.filter((t) => t.total > 0)}
                dataKey="total"
                nameKey="topic"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, value }) => `${String(name || "").slice(0, 15)} (${value})`}
              >
                {data.avgAccuracyByTopic.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Users Tab ──────────────────────────────────────────────────────────

function UsersTab({
  users, search, onSearch, selectedUser, onSelectUser,
}: {
  users: UserRow[];
  search: string;
  onSearch: (q: string) => void;
  selectedUser: string | null;
  onSelectUser: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search by name, email, username, or ID..."
        className="w-full bg-white border border-[#E4E9F0] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#007B5F]/50"
      />

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#007B5F] font-mono">{users.length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Total Users</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#003A8C] font-mono">{users.filter((u) => u.email).length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Email Users</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#F4A261] font-mono">{users.filter((u) => u.telegram_id).length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Telegram Users</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#D64545] font-mono">{users.filter((u) => u.role === "admin").length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Admins</p>
        </div>
      </div>

      {/* User table */}
      <div className="card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F7F9FC] border-b border-[#E4E9F0]">
                <th className="text-left px-4 py-3 text-[#A0AEC0] font-medium">User</th>
                <th className="text-left px-4 py-3 text-[#A0AEC0] font-medium">Auth</th>
                <th className="text-right px-4 py-3 text-[#A0AEC0] font-medium">XP</th>
                <th className="text-right px-4 py-3 text-[#A0AEC0] font-medium">Streak</th>
                <th className="text-right px-4 py-3 text-[#A0AEC0] font-medium">Answered</th>
                <th className="text-right px-4 py-3 text-[#A0AEC0] font-medium">Accuracy</th>
                <th className="text-right px-4 py-3 text-[#A0AEC0] font-medium">Last Active</th>
                <th className="text-right px-4 py-3 text-[#A0AEC0] font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => onSelectUser(u.id)}
                  className={`border-b border-[#E4E9F0]/50 cursor-pointer transition-colors ${
                    selectedUser === u.id ? "bg-[#007B5F]/5" : "hover:bg-[#F7F9FC]"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#007B5F]/10 flex items-center justify-center text-xs font-bold text-[#007B5F]">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-[#1A2B3C]">{u.name}</p>
                        {u.role === "admin" && (
                          <span className="text-[9px] bg-[#D64545]/10 text-[#D64545] px-1.5 py-0.5 rounded font-semibold">ADMIN</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {u.telegram_id && <span className="text-[9px] bg-[#229ED9]/10 text-[#229ED9] px-1.5 py-0.5 rounded">TG</span>}
                      {u.email && <span className="text-[9px] bg-[#007B5F]/10 text-[#007B5F] px-1.5 py-0.5 rounded">Email</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[#F4A261]">{u.xp}</td>
                  <td className="px-4 py-3 text-right font-mono">{u.streak > 0 ? `🔥${u.streak}` : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{u.questions_answered}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-mono ${u.accuracy >= 70 ? "text-[#00A896]" : u.accuracy >= 40 ? "text-[#F4A261]" : "text-[#D64545]"}`}>
                      {u.accuracy > 0 ? `${u.accuracy}%` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[#A0AEC0] text-xs">{timeAgo(u.last_active)}</td>
                  <td className="px-4 py-3 text-right text-[#A0AEC0] text-xs">{formatDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected user detail */}
      {selectedUser && (() => {
        const u = users.find((x) => x.id === selectedUser);
        if (!u) return null;
        return (
          <div className="card rounded-xl p-6">
            <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">User Detail: {u.name}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-[#A0AEC0]">ID:</span> <span className="font-mono text-xs break-all">{u.id}</span></div>
              <div><span className="text-[#A0AEC0]">Email:</span> {u.email || "—"}</div>
              <div><span className="text-[#A0AEC0]">Telegram:</span> {u.telegram_id || "—"}</div>
              <div><span className="text-[#A0AEC0]">Username:</span> @{u.username || "—"}</div>
              <div><span className="text-[#A0AEC0]">Role:</span> <span className="font-semibold">{u.role}</span></div>
              <div><span className="text-[#A0AEC0]">XP:</span> <span className="font-mono">{u.xp}</span></div>
              <div><span className="text-[#A0AEC0]">Streak:</span> <span className="font-mono">{u.streak}</span></div>
              <div><span className="text-[#A0AEC0]">Accuracy:</span> <span className="font-mono">{u.accuracy}%</span></div>
              <div><span className="text-[#A0AEC0]">Questions:</span> <span className="font-mono">{u.questions_answered}</span></div>
              <div><span className="text-[#A0AEC0]">Joined:</span> {formatDate(u.created_at)}</div>
              <div><span className="text-[#A0AEC0]">Last Active:</span> {formatTime(u.last_active)}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Questions Tab ──────────────────────────────────────────────────────

function QuestionsTab({ duplicates, onRefresh }: { duplicates: DuplicateData | null; onRefresh: () => void }) {
  return (
    <div className="space-y-6">
      {/* Question Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[#007B5F] font-mono">7,725</p>
          <p className="text-xs text-[#A0AEC0]">Active Questions</p>
        </div>
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[#F4A261] font-mono">{duplicates?.totalGroups || "..."}</p>
          <p className="text-xs text-[#A0AEC0]">Duplicate Groups</p>
        </div>
        <div className="card rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-[#D64545] font-mono">{duplicates?.totalExtraCopies || "..."}</p>
          <p className="text-xs text-[#A0AEC0]">Extra Copies</p>
        </div>
      </div>

      {/* Duplicate Scanner */}
      <div className="card rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#1A2B3C]">Duplicate Detection</h3>
            <p className="text-xs text-[#A0AEC0]">Questions with identical text (first 200 chars)</p>
          </div>
          <button onClick={onRefresh} className="btn-secondary text-xs px-3 py-1.5 rounded-lg">
            Re-scan
          </button>
        </div>

        {!duplicates ? (
          <p className="text-sm text-[#A0AEC0] text-center py-4">Scanning...</p>
        ) : duplicates.totalGroups === 0 ? (
          <p className="text-sm text-[#00A896] text-center py-4">✓ No duplicates found</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {duplicates.groups.map((g, i) => (
              <div key={i} className="border border-[#E4E9F0] rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm text-[#4A5568] flex-1">{g.text}</p>
                  <span className="text-xs bg-[#D64545]/10 text-[#D64545] px-2 py-0.5 rounded font-mono ml-2">
                    {g.count}x
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.questions.map((q) => (
                    <span key={q.id} className="text-[10px] bg-[#F7F9FC] border border-[#E4E9F0] rounded px-2 py-1 font-mono">
                      #{q.id} · {q.topic?.slice(0, 15)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Analytics Tab ──────────────────────────────────────────────────────

function AnalyticsTab({
  activities, total, eventTypes, filter, onFilterChange,
}: {
  activities: ActivityRow[];
  total: number;
  eventTypes: string[];
  filter: string;
  onFilterChange: (f: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="bg-white border border-[#E4E9F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
        >
          <option value="">All Events ({total})</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="text-xs text-[#A0AEC0]">
          Showing {activities.length} of {total} events
        </span>
      </div>

      {/* Activity feed */}
      <div className="card rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-[#F7F9FC] border-b border-[#E4E9F0]">
                <th className="text-left px-3 py-2 text-[#A0AEC0] font-medium text-xs">Time</th>
                <th className="text-left px-3 py-2 text-[#A0AEC0] font-medium text-xs">Event</th>
                <th className="text-left px-3 py-2 text-[#A0AEC0] font-medium text-xs">Page</th>
                <th className="text-left px-3 py-2 text-[#A0AEC0] font-medium text-xs">User</th>
                <th className="text-left px-3 py-2 text-[#A0AEC0] font-medium text-xs">Details</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id} className="border-b border-[#E4E9F0]/30 hover:bg-[#F7F9FC]">
                  <td className="px-3 py-2 text-[#A0AEC0] text-xs whitespace-nowrap">{formatTime(a.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs bg-[#003A8C]/10 text-[#003A8C] px-2 py-0.5 rounded font-mono">
                      {a.event_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[#4A5568]">{a.page || "—"}</td>
                  <td className="px-3 py-2 text-xs font-mono text-[#A0AEC0]">{a.user_id?.slice(0, 8)}...</td>
                  <td className="px-3 py-2 text-xs text-[#A0AEC0] max-w-[200px] truncate">
                    {a.topic && <span className="text-[#007B5F]">{a.topic} </span>}
                    {a.question_id && <span>Q#{a.question_id} </span>}
                    {a.duration_ms && <span>{a.duration_ms}ms </span>}
                    {a.ip_address && a.ip_address !== "unknown" && <span className="text-[#A0AEC0]/50">{a.ip_address}</span>}
                  </td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#A0AEC0]">No activity data yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
