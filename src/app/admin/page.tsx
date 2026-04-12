"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  LayoutDashboard, Users, FileText, Activity, Settings, Sparkles,
  ChevronDown, Search, Edit3, Trash2, RotateCcw, Shield, Mail,
  Download, Filter, Eye, EyeOff, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Zap, BarChart3,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type Section = "dashboard" | "users" | "questions" | "analytics" | "changelog" | "system";

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
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  role: string;
  tier: string;
  status: string;
  created_at: string;
  xp: number;
  streak: number;
  questions_answered: number;
  accuracy: number;
  daily_today: number;
  last_study: string | null;
  last_active: string;
}

interface QuestionStats {
  totalAll: number;
  active: number;
  inactive: number;
  withMCQ: number;
  withExplanations: number;
  withImages: number;
  mcqPct: number;
  explPct: number;
  imgPct: number;
  byTopic: { topic: string; count: number }[];
}

interface QuestionRow {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string | null;
  choices: { text: string; correct?: boolean }[] | null;
  image_url: string | null;
  exam_dates: string[] | null;
  tags: string[] | null;
  is_active: boolean;
  anki_note_id: number | null;
  created_at: string;
  question_preview: string;
  choices_count: number;
  has_explanation: boolean;
  has_image: boolean;
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

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = ["#007B5F", "#003A8C", "#F4A261", "#D64545", "#00A896", "#3A7CA5", "#8B5CF6", "#EC4899"];

const NAV_ITEMS: { key: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: Users },
  { key: "questions", label: "Questions", icon: FileText },
  { key: "analytics", label: "Analytics", icon: Activity },
  { key: "changelog", label: "Changelog", icon: Sparkles },
  { key: "system", label: "System", icon: Settings },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(iso: string) {
  if (!iso) return "---";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  if (!iso) return "---";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string) {
  if (!iso) return "---";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusColor(status: string) {
  if (status === "active") return "bg-[#007B5F]/10 text-[#007B5F]";
  if (status === "recent") return "bg-[#F4A261]/10 text-[#F4A261]";
  return "bg-[#A0AEC0]/10 text-[#A0AEC0]";
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminDashboard() {
  const [section, setSection] = useState<Section>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Dashboard state
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [newUsers, setNewUsers] = useState<{
    lastHour: number;
    today: number;
    lastSevenDays: number;
    lastThirtyDays: number;
    total: number;
    recent: Array<{
      id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      telegram_username: string | null;
      tier: string | null;
      created_at: string;
    }>;
    generatedAt: string;
  } | null>(null);
  // Baseline used to highlight signups that arrive after the page loaded
  const [newUsersBaseline, setNewUsersBaseline] = useState<number | null>(null);

  // Users state
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [userSort, setUserSort] = useState<{ col: string; asc: boolean }>({ col: "last_active", asc: false });

  // Questions state
  const [questionStats, setQuestionStats] = useState<QuestionStats | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [questionTotalPages, setQuestionTotalPages] = useState(0);
  const [questionSearch, setQuestionSearch] = useState("");
  const [questionTopicFilter, setQuestionTopicFilter] = useState("");
  const [questionExamTypeFilter, setQuestionExamTypeFilter] = useState("all");
  const [questionExplFilter, setQuestionExplFilter] = useState("all");
  const [questionActiveFilter, setQuestionActiveFilter] = useState("all");
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null);
  const [questionEditForm, setQuestionEditForm] = useState<Record<string, unknown>>({});
  const [questionTab, setQuestionTab] = useState<"browse" | "duplicates" | "reviews">("browse");
  const [duplicates, setDuplicates] = useState<DuplicateData | null>(null);
  const [suggestions, setSuggestions] = useState<{ suggestions: unknown[]; counts: { pending: number; approved: number; rejected: number; total: number } } | null>(null);

  // Analytics state
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityEventTypes, setActivityEventTypes] = useState<string[]>([]);
  const [activityFilter, setActivityFilter] = useState("");

  // ─── Fetch Functions ────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin");
      if (!res.ok) throw new Error("Failed to load overview");
      setOverview(await res.json());
    } catch (e) { setError((e as Error).message); }
  }, []);

  // Live new-users tracker (polls every 30s while admin is on the dashboard)
  const fetchNewUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/new-users", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setNewUsers(data);
      // Capture the very first total as the baseline so the "since opened"
      // counter is meaningful for outreach monitoring.
      setNewUsersBaseline((b) => (b === null ? data.total : b));
    } catch {
      /* polling, swallow */
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/users");
      if (!res.ok) throw new Error("Failed to load users");
      setUsers(await res.json());
    } catch (e) { setError((e as Error).message); }
  }, []);

  const fetchQuestionStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/questions");
      if (!res.ok) throw new Error("Failed to load question stats");
      setQuestionStats(await res.json());
    } catch (e) { setError((e as Error).message); }
  }, []);

  const fetchQuestions = useCallback(async (page = 1, topic = "", search = "", hasExpl = "all", isActive = "all", examType = "all") => {
    try {
      const params = new URLSearchParams({ mode: "browse", page: String(page), limit: "25" });
      if (topic) params.set("topic", topic);
      if (search) params.set("search", search);
      if (hasExpl === "with") params.set("hasExplanation", "true");
      if (hasExpl === "without") params.set("hasExplanation", "false");
      if (isActive === "active") params.set("isActive", "true");
      if (isActive === "inactive") params.set("isActive", "false");
      if (examType && examType !== "all") params.set("examType", examType);
      const res = await fetch(`/api/stats/admin/questions?${params}`);
      if (!res.ok) throw new Error("Failed to load questions");
      const data = await res.json();
      setQuestions(data.questions || []);
      setQuestionTotal(data.total || 0);
      setQuestionTotalPages(data.totalPages || 0);
    } catch (e) { setError((e as Error).message); }
  }, []);

  const fetchDuplicates = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/duplicates");
      if (!res.ok) throw new Error("Failed");
      setDuplicates(await res.json());
    } catch { /* optional */ }
  }, []);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/suggestions?limit=100");
      if (!res.ok) throw new Error("Failed");
      setSuggestions(await res.json());
    } catch { /* optional */ }
  }, []);

  const fetchActivity = useCallback(async (eventType?: string) => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (eventType) params.set("eventType", eventType);
      const res = await fetch(`/api/stats/admin/activity?${params}`);
      if (!res.ok) throw new Error("Failed to load activity");
      const data = await res.json();
      setActivities(data.activities || []);
      setActivityTotal(data.total || 0);
      setActivityEventTypes(data.eventTypes || []);
    } catch (e) { setError((e as Error).message); }
  }, []);

  // ─── Initial Load ───────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    await Promise.all([fetchOverview(), fetchUsers(), fetchNewUsers()]);
    setLoading(false);
  }, [fetchOverview, fetchUsers, fetchNewUsers]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live new-users polling — only while the admin is on the dashboard tab.
  useEffect(() => {
    if (section !== "dashboard") return;
    const id = setInterval(fetchNewUsers, 30000);
    return () => clearInterval(id);
  }, [section, fetchNewUsers]);

  // ─── Section-specific Loading ───────────────────────────────────────

  useEffect(() => {
    if (section === "questions" && !questionStats) fetchQuestionStats();
    if (section === "questions" && questions.length === 0) fetchQuestions(1);
    if (section === "questions" && questionTab === "duplicates" && !duplicates) fetchDuplicates();
    if (section === "questions" && questionTab === "reviews" && !suggestions) fetchSuggestions();
    if (section === "analytics" && activities.length === 0) fetchActivity();
  }, [section, questionStats, questions.length, questionTab, duplicates, suggestions, activities.length, fetchQuestionStats, fetchQuestions, fetchDuplicates, fetchSuggestions, fetchActivity]);

  // ─── User Actions ───────────────────────────────────────────────────

  const handleUserRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updates: { role: newRole } }),
      });
      if (!res.ok) throw new Error("Failed");
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    } catch { setError("Failed to update role"); }
  };

  const handleUserEdit = async (userId: string) => {
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updates: editForm }),
      });
      if (!res.ok) throw new Error("Failed");
      setEditingUser(null);
      await fetchUsers();
    } catch { setError("Failed to update user"); }
  };

  const handleResetGamification = async (userId: string) => {
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updates: { reset_gamification: true } }),
      });
      if (!res.ok) throw new Error("Failed");
      await fetchUsers();
    } catch { setError("Failed to reset gamification"); }
  };

  const handleUserDelete = async (userId: string) => {
    try {
      const res = await fetch(`/api/stats/admin/users?id=${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setDeletingUser(null);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch { setError("Failed to delete user"); }
  };

  // ─── Question Actions ───────────────────────────────────────────────

  const handleQuestionSearch = () => {
    setQuestionPage(1);
    fetchQuestions(1, questionTopicFilter, questionSearch, questionExplFilter, questionActiveFilter, questionExamTypeFilter);
  };

  const handleQuestionEdit = async (questionId: number) => {
    try {
      const res = await fetch("/api/stats/admin/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, updates: questionEditForm }),
      });
      if (!res.ok) throw new Error("Failed");
      setEditingQuestion(null);
      fetchQuestions(questionPage, questionTopicFilter, questionSearch, questionExplFilter, questionActiveFilter, questionExamTypeFilter);
    } catch { setError("Failed to update question"); }
  };

  // ─── Filtered & Sorted Users ────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    let result = users;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      result = result.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q) ||
        u.id.includes(q)
      );
    }
    return [...result].sort((a, b) => {
      const col = userSort.col as keyof UserRow;
      const aVal = a[col] ?? "";
      const bVal = b[col] ?? "";
      if (typeof aVal === "number" && typeof bVal === "number") {
        return userSort.asc ? aVal - bVal : bVal - aVal;
      }
      return userSort.asc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [users, userSearch, userSort]);

  const totalQuestionsInDB = questionStats?.totalAll ?? overview?.avgAccuracyByTopic?.reduce((s, t) => s + t.total, 0) ?? 0;
  const explanationCoverage = questionStats ? questionStats.explPct : 0;

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-[#F7F9FC]">
      {/* ═══ SIDEBAR ═══ */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen z-30 bg-[#001B3D] transition-all duration-300 flex flex-col ${
          sidebarOpen ? "w-[220px]" : "w-0 lg:w-[64px]"
        } overflow-hidden`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-[#007B5F] flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-white" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="text-white text-sm font-bold leading-tight">MedPr&uuml;f</p>
              <p className="text-[#A0AEC0] text-[10px]">Admin Panel</p>
            </div>
          )}
        </div>

        {/* Nav Items */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { setSection(item.key); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  active
                    ? "bg-[#007B5F] text-white shadow-md"
                    : "text-[#A0AEC0] hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon size={18} className="flex-shrink-0" />
                {sidebarOpen && <span className="font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        {sidebarOpen && (
          <div className="px-4 py-4 border-t border-white/10">
            <p className="text-[10px] text-[#A0AEC0]">MedPr&uuml;f Admin v2.0</p>
            <p className="text-[10px] text-[#A0AEC0]/50">Internal Use Only</p>
          </div>
        )}
      </aside>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-[#E4E9F0] px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 rounded-lg hover:bg-[#F7F9FC] text-[#4A5568]"
              >
                <BarChart3 size={20} />
              </button>
              <div>
                <h1 className="text-lg font-bold text-[#1A2B3C]">
                  {NAV_ITEMS.find((n) => n.key === section)?.label || "Dashboard"}
                </h1>
                <p className="text-xs text-[#A0AEC0]">MedPr&uuml;f Analytics &amp; Management</p>
              </div>
            </div>
            <button onClick={refresh} className="btn-primary px-4 py-2 text-sm rounded-xl flex items-center gap-2">
              <RotateCcw size={14} />
              Refresh
            </button>
          </div>
        </header>

        {/* Error Banner */}
        {error && (
          <div className="mx-4 sm:mx-6 mt-4 bg-[#D64545]/10 border border-[#D64545]/25 text-[#D64545] text-sm rounded-xl px-4 py-3 flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
            <button onClick={() => setError("")} className="ml-auto text-xs underline">Dismiss</button>
          </div>
        )}

        {/* Content Area */}
        <div className="px-4 sm:px-6 py-6">
          {loading ? (
            <div className="text-center py-20 text-[#A0AEC0]">
              <RotateCcw size={24} className="animate-spin mx-auto mb-3" />
              <p className="text-sm">Loading dashboard...</p>
            </div>
          ) : (
            <>
              {section === "dashboard" && overview && (
                <>
                  <NewUsersTracker
                    data={newUsers}
                    baseline={newUsersBaseline}
                    onRefresh={fetchNewUsers}
                  />
                  <DashboardSection data={overview} totalQuestions={totalQuestionsInDB} explCoverage={explanationCoverage} />
                </>
              )}
              {section === "users" && (
                <UsersSection
                  users={filteredUsers}
                  allUsers={users}
                  search={userSearch}
                  onSearch={setUserSearch}
                  expandedUser={expandedUser}
                  onExpandUser={(id) => setExpandedUser(id === expandedUser ? null : id)}
                  editingUser={editingUser}
                  onStartEdit={(u) => {
                    setEditingUser(u.id);
                    setEditForm({ first_name: u.first_name || "", last_name: u.last_name || "", email: u.email || "" });
                  }}
                  editForm={editForm}
                  onEditFormChange={(k, v) => setEditForm((prev) => ({ ...prev, [k]: v }))}
                  onSaveEdit={handleUserEdit}
                  onCancelEdit={() => setEditingUser(null)}
                  onRoleChange={handleUserRoleChange}
                  onResetGamification={handleResetGamification}
                  deletingUser={deletingUser}
                  onDeleteRequest={(id) => setDeletingUser(id)}
                  onDeleteConfirm={handleUserDelete}
                  onDeleteCancel={() => setDeletingUser(null)}
                  sort={userSort}
                  onSort={(col) => setUserSort((prev) => ({ col, asc: prev.col === col ? !prev.asc : false }))}
                />
              )}
              {section === "questions" && (
                <QuestionsSection
                  stats={questionStats}
                  questions={questions}
                  page={questionPage}
                  total={questionTotal}
                  totalPages={questionTotalPages}
                  search={questionSearch}
                  topicFilter={questionTopicFilter}
                  examTypeFilter={questionExamTypeFilter}
                  explFilter={questionExplFilter}
                  activeFilter={questionActiveFilter}
                  onSearchChange={setQuestionSearch}
                  onTopicFilterChange={setQuestionTopicFilter}
                  onExamTypeFilterChange={setQuestionExamTypeFilter}
                  onExplFilterChange={setQuestionExplFilter}
                  onActiveFilterChange={setQuestionActiveFilter}
                  onSearch={handleQuestionSearch}
                  onPageChange={(p) => { setQuestionPage(p); fetchQuestions(p, questionTopicFilter, questionSearch, questionExplFilter, questionActiveFilter, questionExamTypeFilter); }}
                  expandedQuestion={expandedQuestion}
                  onExpandQuestion={(id) => setExpandedQuestion(id === expandedQuestion ? null : id)}
                  editingQuestion={editingQuestion}
                  onStartEditQuestion={(q) => {
                    setEditingQuestion(q.id);
                    setQuestionEditForm({ explanation: q.explanation || "", topic: q.topic, is_active: q.is_active });
                  }}
                  questionEditForm={questionEditForm}
                  onQuestionEditFormChange={(k, v) => setQuestionEditForm((prev) => ({ ...prev, [k]: v }))}
                  onSaveQuestionEdit={handleQuestionEdit}
                  onCancelQuestionEdit={() => setEditingQuestion(null)}
                  tab={questionTab}
                  onTabChange={setQuestionTab}
                  duplicates={duplicates}
                  onRefreshDuplicates={fetchDuplicates}
                  suggestions={suggestions}
                  onRefreshSuggestions={fetchSuggestions}
                />
              )}
              {section === "analytics" && (
                <AnalyticsSection
                  activities={activities}
                  total={activityTotal}
                  eventTypes={activityEventTypes}
                  filter={activityFilter}
                  onFilterChange={(f) => { setActivityFilter(f); fetchActivity(f || undefined); }}
                />
              )}
              {section === "changelog" && <ChangelogSection />}
              {section === "system" && (
                <SystemSection questionStats={questionStats} users={users} onRefreshStats={fetchQuestionStats} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: LIVE NEW USERS TRACKER
// ═══════════════════════════════════════════════════════════════════════════

interface NewUsersData {
  lastHour: number;
  today: number;
  lastSevenDays: number;
  lastThirtyDays: number;
  total: number;
  recent: Array<{
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    telegram_username: string | null;
    tier: string | null;
    created_at: string;
  }>;
  generatedAt: string;
}

function NewUsersTracker({
  data,
  baseline,
  onRefresh,
}: {
  data: NewUsersData | null;
  baseline: number | null;
  onRefresh: () => void;
}) {
  if (!data) {
    return (
      <div className="card rounded-2xl p-5 mb-6 animate-pulse">
        <div className="h-5 w-48 bg-[#E4E9F0] rounded mb-3" />
        <div className="h-12 w-32 bg-[#E4E9F0] rounded" />
      </div>
    );
  }

  const sinceOpened = baseline !== null ? Math.max(0, data.total - baseline) : 0;
  const updated = new Date(data.generatedAt);
  const updatedStr = updated.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const stats: Array<{ label: string; value: number; tone: string }> = [
    { label: "Letzte Stunde", value: data.lastHour, tone: "text-[#00A896]" },
    { label: "Heute", value: data.today, tone: "text-[#007B5F]" },
    { label: "7 Tage", value: data.lastSevenDays, tone: "text-[#003A8C]" },
    { label: "30 Tage", value: data.lastThirtyDays, tone: "text-[#3A7CA5]" },
  ];

  return (
    <div className="card rounded-2xl p-5 mb-6 border-l-4 border-l-[#00A896]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="relative w-2.5 h-2.5">
              <span className="absolute inset-0 rounded-full bg-[#00A896] animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-[#00A896]" />
            </div>
            <h3 className="text-base font-semibold text-[#1A2B3C] dark:text-[#E2E8F0]">
              Live Registrierungen
            </h3>
            {sinceOpened > 0 && (
              <span className="text-xs font-mono font-bold text-white bg-[#00A896] px-2 py-0.5 rounded-full animate-pulse">
                +{sinceOpened} seit Öffnen
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#A0AEC0] font-mono">
            {data.total.toLocaleString("de-DE")} Nutzer · aktualisiert {updatedStr}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-[#A0AEC0] hover:text-[#1A2B3C] dark:hover:text-[#E2E8F0] transition-colors px-2 py-1"
        >
          ↻ Jetzt
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-[#F7F9FC] dark:bg-[#1E293B] border border-[#E4E9F0]/60 dark:border-[#334155]/60 px-3 py-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1">
              {s.label}
            </p>
            <p className={`text-2xl font-bold font-mono ${s.tone}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {data.recent.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-2">
            Letzte 10 Anmeldungen
          </p>
          <div className="space-y-1">
            {data.recent.map((u) => {
              const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim()
                || u.telegram_username
                || u.email
                || u.id.slice(0, 8);
              const ts = new Date(u.created_at);
              const isFresh = baseline !== null && ts.getTime() > new Date(Date.now() - 60_000 * 10).getTime();
              return (
                <div
                  key={u.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                    isFresh
                      ? "bg-[#00A896]/8 border border-[#00A896]/30"
                      : "bg-[#F7F9FC]/60 dark:bg-[#1E293B]/60"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isFresh && <span className="w-1.5 h-1.5 rounded-full bg-[#00A896] animate-pulse" />}
                    <span className="font-medium text-[#1A2B3C] dark:text-[#E2E8F0] truncate">
                      {name}
                    </span>
                    {u.tier && u.tier !== "free" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F4A261]/15 text-[#F4A261] font-semibold uppercase">
                        {u.tier}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#A0AEC0] font-mono whitespace-nowrap ml-3">
                    {ts.toLocaleString("de-DE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

function DashboardSection({ data, totalQuestions, explCoverage }: { data: OverviewData; totalQuestions: number; explCoverage: number }) {
  const kpis = [
    { label: "Total Users", value: data.totalUsers, icon: Users, color: "#007B5F" },
    { label: "Active Users (DAU)", value: data.dau, icon: Zap, color: "#003A8C" },
    { label: "Weekly Active (WAU)", value: data.wau, icon: TrendingUp, color: "#F4A261" },
    { label: "Monthly Active (MAU)", value: data.mau, icon: Activity, color: "#00A896" },
    { label: "Questions Today", value: data.questionsToday, icon: FileText, color: "#D64545" },
    { label: "Answered This Week", value: data.questionsThisWeek, icon: BarChart3, color: "#3A7CA5" },
    { label: "Total Questions in DB", value: totalQuestions, icon: FileText, color: "#8B5CF6" },
    { label: "Explanation Coverage", value: `${explCoverage}%`, icon: CheckCircle, color: "#007B5F" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="card rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <Icon size={18} style={{ color: kpi.color }} />
                <span className="text-[10px] text-[#A0AEC0] uppercase tracking-wider">{kpi.label}</span>
              </div>
              <p className="text-2xl font-bold font-mono" style={{ color: kpi.color }}>{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DAU Chart */}
        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Daily Active Users (30d)</h3>
          <ResponsiveContainer width="100%" height={220}>
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
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4">Peak Study Hours</h3>
          <ResponsiveContainer width="100%" height={220}>
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
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-[#007B5F]" /> Top 5 Topics
          </h3>
          <div className="space-y-3">
            {data.topTopics.map((t, i) => (
              <div key={t.topic} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#A0AEC0] w-5">{i + 1}.</span>
                  <span className="text-sm text-[#4A5568] truncate max-w-[180px]">{t.topic}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#A0AEC0] font-mono">{t.total} Q</span>
                  <span className={`text-xs font-mono font-bold ${t.accuracy >= 70 ? "text-[#007B5F]" : t.accuracy >= 40 ? "text-[#F4A261]" : "text-[#D64545]"}`}>
                    {t.accuracy}%
                  </span>
                </div>
              </div>
            ))}
            {data.topTopics.length === 0 && <p className="text-xs text-[#A0AEC0] text-center py-4">No data yet</p>}
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-[#D64545]" /> Weakest 5 Topics
          </h3>
          <div className="space-y-3">
            {data.weakTopics.map((t, i) => (
              <div key={t.topic} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#A0AEC0] w-5">{i + 1}.</span>
                  <span className="text-sm text-[#4A5568] truncate max-w-[180px]">{t.topic}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#A0AEC0] font-mono">{t.total} Q</span>
                  <span className="text-xs font-mono font-bold text-[#D64545]">{t.accuracy}%</span>
                </div>
              </div>
            ))}
            {data.weakTopics.length === 0 && <p className="text-xs text-[#A0AEC0] text-center py-4">No data yet</p>}
          </div>
        </div>
      </div>

      {/* Topic Distribution Pie */}
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

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: USERS
// ═══════════════════════════════════════════════════════════════════════════

function UsersSection({
  users, allUsers, search, onSearch, expandedUser, onExpandUser,
  editingUser, onStartEdit, editForm, onEditFormChange, onSaveEdit, onCancelEdit,
  onRoleChange, onResetGamification, deletingUser, onDeleteRequest, onDeleteConfirm, onDeleteCancel,
  sort, onSort,
}: {
  users: UserRow[];
  allUsers: UserRow[];
  search: string;
  onSearch: (q: string) => void;
  expandedUser: string | null;
  onExpandUser: (id: string) => void;
  editingUser: string | null;
  onStartEdit: (u: UserRow) => void;
  editForm: Record<string, string>;
  onEditFormChange: (k: string, v: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onRoleChange: (id: string, role: string) => void;
  onResetGamification: (id: string) => void;
  deletingUser: string | null;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  sort: { col: string; asc: boolean };
  onSort: (col: string) => void;
}) {
  const activeToday = allUsers.filter((u) => u.status === "active").length;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0AEC0]" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name, email, username, or ID..."
          className="w-full bg-white border border-[#E4E9F0] rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#007B5F]/50"
        />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#007B5F] font-mono">{allUsers.length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Total</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#003A8C] font-mono">{allUsers.filter((u) => u.email).length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Email Users</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#00A896] font-mono">{allUsers.filter((u) => u.telegram_id).length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Telegram Users</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#D64545] font-mono">{allUsers.filter((u) => u.role === "admin").length}</p>
          <p className="text-[10px] text-[#A0AEC0]">Admins</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#F4A261] font-mono">{activeToday}</p>
          <p className="text-[10px] text-[#A0AEC0]">Active Today</p>
        </div>
      </div>

      {/* User Table */}
      <div className="card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F7F9FC] border-b border-[#E4E9F0]">
                {[
                  { key: "name", label: "User", align: "left" },
                  { key: "auth", label: "Auth", align: "left" },
                  { key: "role", label: "Role", align: "left" },
                  { key: "tier", label: "Tier", align: "left" },
                  { key: "status", label: "Status", align: "left" },
                  { key: "xp", label: "XP", align: "right" },
                  { key: "streak", label: "Streak", align: "right" },
                  { key: "questions_answered", label: "Questions", align: "right" },
                  { key: "accuracy", label: "Accuracy", align: "right" },
                  { key: "last_active", label: "Last Active", align: "right" },
                  { key: "created_at", label: "Joined", align: "right" },
                  { key: "actions", label: "Actions", align: "center" },
                ].map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 text-[#A0AEC0] font-medium text-xs whitespace-nowrap ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"} ${col.key !== "auth" && col.key !== "actions" ? "cursor-pointer hover:text-[#4A5568]" : ""}`}
                    onClick={() => col.key !== "auth" && col.key !== "actions" && onSort(col.key)}
                  >
                    {col.label}
                    {sort.col === col.key && <ChevronDown size={12} className={`inline ml-1 transition-transform ${sort.asc ? "rotate-180" : ""}`} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <>
                  <tr
                    key={u.id}
                    onClick={() => onExpandUser(u.id)}
                    className={`border-b border-[#E4E9F0]/50 cursor-pointer transition-colors ${
                      expandedUser === u.id ? "bg-[#007B5F]/5" : "hover:bg-[#F7F9FC]"
                    }`}
                  >
                    {/* Avatar + Name */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {u.photo_url ? (
                          <img src={u.photo_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[#007B5F]/10 flex items-center justify-center text-xs font-bold text-[#007B5F]">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-[#1A2B3C] truncate max-w-[120px]">{u.name}</span>
                      </div>
                    </td>
                    {/* Auth Badges */}
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {u.telegram_id && <span className="text-[9px] bg-[#229ED9]/10 text-[#229ED9] px-1.5 py-0.5 rounded font-semibold">TG</span>}
                        {u.email && <span className="text-[9px] bg-[#007B5F]/10 text-[#007B5F] px-1.5 py-0.5 rounded font-semibold">Email</span>}
                      </div>
                    </td>
                    {/* Role dropdown */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={u.role}
                        onChange={(e) => onRoleChange(u.id, e.target.value)}
                        className="text-xs border border-[#E4E9F0] rounded px-2 py-1 bg-white focus:outline-none focus:border-[#007B5F]/50"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    {/* Tier dropdown */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={u.tier || "free"}
                        onChange={async (e) => {
                          await fetch("/api/stats/admin/users", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: u.id, updates: { tier: e.target.value } }),
                          });
                        }}
                        className={`text-[10px] border rounded px-2 py-1 font-semibold focus:outline-none ${
                          (u.tier || "free") === "pro" ? "border-[#F4A261] text-[#F4A261] bg-[#F4A261]/5" :
                          (u.tier || "free") === "admin" ? "border-[#D64545] text-[#D64545] bg-[#D64545]/5" :
                          "border-[#E4E9F0] text-[#4A5568] bg-white"
                        }`}
                      >
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusColor(u.status)}`}>
                        {u.status}
                      </span>
                    </td>
                    {/* XP */}
                    <td className="px-3 py-2.5 text-right font-mono text-[#F4A261] text-xs">{u.xp.toLocaleString()}</td>
                    {/* Streak */}
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{u.streak > 0 ? `${u.streak}d` : "---"}</td>
                    {/* Questions */}
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{u.questions_answered}</td>
                    {/* Accuracy */}
                    <td className="px-3 py-2.5 text-right">
                      <span className={`font-mono text-xs ${u.accuracy >= 70 ? "text-[#007B5F]" : u.accuracy >= 40 ? "text-[#F4A261]" : "text-[#D64545]"}`}>
                        {u.accuracy > 0 ? `${u.accuracy}%` : "---"}
                      </span>
                    </td>
                    {/* Last Active */}
                    <td className="px-3 py-2.5 text-right text-[#A0AEC0] text-xs whitespace-nowrap">{timeAgo(u.last_active)}</td>
                    {/* Joined */}
                    <td className="px-3 py-2.5 text-right text-[#A0AEC0] text-xs whitespace-nowrap">{formatDate(u.created_at)}</td>
                    {/* Actions */}
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onStartEdit(u)}
                          className="p-1.5 rounded-md hover:bg-[#007B5F]/10 text-[#4A5568] hover:text-[#007B5F] transition-colors"
                          title="Edit"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => onResetGamification(u.id)}
                          className="p-1.5 rounded-md hover:bg-[#F4A261]/10 text-[#4A5568] hover:text-[#F4A261] transition-colors"
                          title="Reset gamification"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          onClick={() => onDeleteRequest(u.id)}
                          className="p-1.5 rounded-md hover:bg-[#D64545]/10 text-[#4A5568] hover:text-[#D64545] transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Delete Confirmation */}
                  {deletingUser === u.id && (
                    <tr key={`del-${u.id}`}>
                      <td colSpan={11} className="px-4 py-3 bg-[#D64545]/5 border-b border-[#D64545]/20">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-[#D64545] font-medium">
                            <AlertTriangle size={14} className="inline mr-1" />
                            Are you sure you want to delete {u.name}? This cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <button onClick={() => onDeleteConfirm(u.id)} className="text-xs bg-[#D64545] text-white px-3 py-1.5 rounded-lg font-medium">
                              Confirm Delete
                            </button>
                            <button onClick={onDeleteCancel} className="text-xs bg-white border border-[#E4E9F0] text-[#4A5568] px-3 py-1.5 rounded-lg">
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Expanded Detail / Edit */}
                  {expandedUser === u.id && (
                    <tr key={`exp-${u.id}`}>
                      <td colSpan={11} className="px-4 py-4 bg-[#F7F9FC]/50 border-b border-[#E4E9F0]">
                        {editingUser === u.id ? (
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-[#1A2B3C] uppercase tracking-wider">Editing: {u.name}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="text-[10px] text-[#A0AEC0] block mb-1">First Name</label>
                                <input
                                  value={editForm.first_name || ""}
                                  onChange={(e) => onEditFormChange("first_name", e.target.value)}
                                  className="w-full border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#007B5F]/50"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-[#A0AEC0] block mb-1">Last Name</label>
                                <input
                                  value={editForm.last_name || ""}
                                  onChange={(e) => onEditFormChange("last_name", e.target.value)}
                                  className="w-full border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#007B5F]/50"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-[#A0AEC0] block mb-1">Email</label>
                                <input
                                  value={editForm.email || ""}
                                  onChange={(e) => onEditFormChange("email", e.target.value)}
                                  className="w-full border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#007B5F]/50"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => onSaveEdit(u.id)} className="btn-primary text-xs px-4 py-2 rounded-lg">Save Changes</button>
                              <button onClick={onCancelEdit} className="btn-secondary text-xs px-4 py-2 rounded-lg">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div><span className="text-[#A0AEC0] text-xs">ID:</span> <span className="font-mono text-[10px] break-all">{u.id}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Email:</span> <span className="text-xs">{u.email || "---"}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Telegram:</span> <span className="text-xs font-mono">{u.telegram_id || "---"}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Username:</span> <span className="text-xs">@{u.username || "---"}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Daily Today:</span> <span className="text-xs font-mono">{u.daily_today}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Last Study:</span> <span className="text-xs">{u.last_study ? formatDate(u.last_study) : "---"}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Last Active:</span> <span className="text-xs">{formatTime(u.last_active)}</span></div>
                            <div><span className="text-[#A0AEC0] text-xs">Photo:</span> {u.photo_url ? <a href={u.photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#003A8C] underline">View</a> : <span className="text-xs">---</span>}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-[#A0AEC0] text-sm">
                    {search ? "No users match your search" : "No users found"}
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

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: QUESTIONS
// ═══════════════════════════════════════════════════════════════════════════

function QuestionsSection({
  stats, questions, page, total, totalPages,
  search, topicFilter, examTypeFilter, explFilter, activeFilter,
  onSearchChange, onTopicFilterChange, onExamTypeFilterChange, onExplFilterChange, onActiveFilterChange, onSearch, onPageChange,
  expandedQuestion, onExpandQuestion,
  editingQuestion, onStartEditQuestion, questionEditForm, onQuestionEditFormChange, onSaveQuestionEdit, onCancelQuestionEdit,
  tab, onTabChange, duplicates, onRefreshDuplicates, suggestions, onRefreshSuggestions,
}: {
  stats: QuestionStats | null;
  questions: QuestionRow[];
  page: number;
  total: number;
  totalPages: number;
  search: string;
  topicFilter: string;
  examTypeFilter: string;
  explFilter: string;
  activeFilter: string;
  onSearchChange: (v: string) => void;
  onTopicFilterChange: (v: string) => void;
  onExamTypeFilterChange: (v: string) => void;
  onExplFilterChange: (v: string) => void;
  onActiveFilterChange: (v: string) => void;
  onSearch: () => void;
  onPageChange: (p: number) => void;
  expandedQuestion: number | null;
  onExpandQuestion: (id: number) => void;
  editingQuestion: number | null;
  onStartEditQuestion: (q: QuestionRow) => void;
  questionEditForm: Record<string, unknown>;
  onQuestionEditFormChange: (k: string, v: unknown) => void;
  onSaveQuestionEdit: (id: number) => void;
  onCancelQuestionEdit: () => void;
  tab: "browse" | "duplicates" | "reviews";
  onTabChange: (t: "browse" | "duplicates" | "reviews") => void;
  duplicates: DuplicateData | null;
  onRefreshDuplicates: () => void;
  suggestions: { suggestions: unknown[]; counts: { pending: number; approved: number; rejected: number; total: number } } | null;
  onRefreshSuggestions: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="card rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-[#007B5F] font-mono">{stats.totalAll.toLocaleString()}</p>
            <p className="text-[10px] text-[#A0AEC0]">Total</p>
          </div>
          <div className="card rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-[#003A8C] font-mono">{stats.active.toLocaleString()}</p>
            <p className="text-[10px] text-[#A0AEC0]">Active</p>
          </div>
          <div className="card rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-[#A0AEC0] font-mono">{stats.inactive.toLocaleString()}</p>
            <p className="text-[10px] text-[#A0AEC0]">Inactive</p>
          </div>
          <div className="card rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-[#00A896] font-mono">{stats.mcqPct}%</p>
            <p className="text-[10px] text-[#A0AEC0]">MCQ</p>
          </div>
          <div className="card rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-[#F4A261] font-mono">{stats.explPct}%</p>
            <p className="text-[10px] text-[#A0AEC0]">Explanation</p>
          </div>
          <div className="card rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-[#D64545] font-mono">{stats.imgPct}%</p>
            <p className="text-[10px] text-[#A0AEC0]">Image</p>
          </div>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-[#E4E9F0] w-fit">
        <button
          onClick={() => onTabChange("browse")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "browse" ? "bg-[#007B5F] text-white" : "text-[#4A5568] hover:bg-[#F7F9FC]"}`}
        >
          <FileText size={14} className="inline mr-1.5" />Browse
        </button>
        <button
          onClick={() => onTabChange("duplicates")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "duplicates" ? "bg-[#007B5F] text-white" : "text-[#4A5568] hover:bg-[#F7F9FC]"}`}
        >
          <AlertTriangle size={14} className="inline mr-1.5" />Duplicates
        </button>
        <button
          onClick={() => onTabChange("reviews")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "reviews" ? "bg-[#F4A261] text-white" : "text-[#4A5568] hover:bg-[#F7F9FC]"}`}
        >
          Reviews {suggestions?.counts.pending ? <span className="ml-1 bg-[#D64545] text-white text-[10px] px-1.5 py-0.5 rounded-full">{suggestions.counts.pending}</span> : null}
        </button>
      </div>

      {tab === "browse" && (
        <>
          {/* Search + Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0AEC0]" />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                placeholder="Search question text..."
                className="w-full bg-white border border-[#E4E9F0] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
              />
            </div>
            <select
              value={examTypeFilter}
              onChange={(e) => onExamTypeFilterChange(e.target.value)}
              className="bg-white border border-[#E4E9F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
            >
              <option value="all">All Exams</option>
              <option value="kenntnispruefung">Kenntnisprüfung</option>
              <option value="kmp_innsbruck">KMP Innsbruck</option>
              <option value="pharma">Pharma</option>
            </select>
            <select
              value={topicFilter}
              onChange={(e) => onTopicFilterChange(e.target.value)}
              className="bg-white border border-[#E4E9F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
            >
              <option value="">All Topics</option>
              {(stats?.byTopic || []).map((t) => (
                <option key={t.topic} value={t.topic}>{t.topic} ({t.count})</option>
              ))}
            </select>
            <select
              value={explFilter}
              onChange={(e) => onExplFilterChange(e.target.value)}
              className="bg-white border border-[#E4E9F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
            >
              <option value="all">All Explanations</option>
              <option value="with">With Explanation</option>
              <option value="without">Without Explanation</option>
            </select>
            <select
              value={activeFilter}
              onChange={(e) => onActiveFilterChange(e.target.value)}
              className="bg-white border border-[#E4E9F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button onClick={onSearch} className="btn-primary px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
              <Filter size={14} /> Filter
            </button>
          </div>

          {/* Results count */}
          <p className="text-xs text-[#A0AEC0]">{total.toLocaleString()} questions found -- Page {page} of {totalPages}</p>

          {/* Questions Table */}
          <div className="card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F7F9FC] border-b border-[#E4E9F0]">
                    <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">ID</th>
                    <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Topic</th>
                    <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Question</th>
                    <th className="text-center px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Choices</th>
                    <th className="text-center px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Expl</th>
                    <th className="text-center px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Img</th>
                    <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Exam Dates</th>
                    <th className="text-center px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => (
                    <>
                      <tr
                        key={q.id}
                        onClick={() => onExpandQuestion(q.id)}
                        className={`border-b border-[#E4E9F0]/50 cursor-pointer transition-colors ${
                          expandedQuestion === q.id ? "bg-[#007B5F]/5" : "hover:bg-[#F7F9FC]"
                        } ${!q.is_active ? "opacity-50" : ""}`}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs text-[#A0AEC0]">#{q.id}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] bg-[#003A8C]/10 text-[#003A8C] px-2 py-0.5 rounded font-medium truncate max-w-[120px] inline-block">
                            {q.topic?.slice(0, 20) || "---"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[#4A5568] max-w-[300px] truncate">{q.question_preview}</td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs">{q.choices_count || "---"}</td>
                        <td className="px-3 py-2.5 text-center">
                          {q.has_explanation
                            ? <CheckCircle size={14} className="inline text-[#007B5F]" />
                            : <EyeOff size={14} className="inline text-[#A0AEC0]" />
                          }
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {q.has_image
                            ? <Eye size={14} className="inline text-[#003A8C]" />
                            : <span className="text-[#A0AEC0] text-xs">---</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[#A0AEC0]">
                          {q.exam_dates?.length ? q.exam_dates.slice(0, 2).join(", ") + (q.exam_dates.length > 2 ? ` +${q.exam_dates.length - 2}` : "") : "---"}
                        </td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onStartEditQuestion(q)}
                            className="p-1.5 rounded-md hover:bg-[#007B5F]/10 text-[#4A5568] hover:text-[#007B5F] transition-colors"
                            title="Edit"
                          >
                            <Edit3 size={13} />
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Question Detail */}
                      {expandedQuestion === q.id && (
                        <tr key={`exp-q-${q.id}`}>
                          <td colSpan={8} className="px-4 py-4 bg-[#F7F9FC]/50 border-b border-[#E4E9F0]">
                            {editingQuestion === q.id ? (
                              <div className="space-y-3">
                                <h4 className="text-xs font-semibold text-[#1A2B3C] uppercase tracking-wider">Editing Question #{q.id}</h4>
                                <div>
                                  <label className="text-[10px] text-[#A0AEC0] block mb-1">Topic</label>
                                  <input
                                    value={(questionEditForm.topic as string) || ""}
                                    onChange={(e) => onQuestionEditFormChange("topic", e.target.value)}
                                    className="w-full border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#007B5F]/50"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-[#A0AEC0] block mb-1">Explanation</label>
                                  <textarea
                                    value={(questionEditForm.explanation as string) || ""}
                                    onChange={(e) => onQuestionEditFormChange("explanation", e.target.value)}
                                    rows={4}
                                    className="w-full border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#007B5F]/50"
                                  />
                                </div>
                                <div className="flex items-center gap-3">
                                  <label className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={!!questionEditForm.is_active}
                                      onChange={(e) => onQuestionEditFormChange("is_active", e.target.checked)}
                                      className="accent-[#007B5F]"
                                    />
                                    Active
                                  </label>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => onSaveQuestionEdit(q.id)} className="btn-primary text-xs px-4 py-2 rounded-lg">Save</button>
                                  <button onClick={onCancelQuestionEdit} className="btn-secondary text-xs px-4 py-2 rounded-lg">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {/* Full question text */}
                                <div>
                                  <p className="text-[10px] text-[#A0AEC0] uppercase tracking-wider mb-1">Question</p>
                                  <p className="text-sm text-[#1A2B3C] whitespace-pre-wrap">{q.question}</p>
                                </div>

                                {/* Choices */}
                                {q.choices && q.choices.length > 0 && (
                                  <div>
                                    <p className="text-[10px] text-[#A0AEC0] uppercase tracking-wider mb-1">Choices</p>
                                    <div className="space-y-1">
                                      {q.choices.map((c, i) => (
                                        <div key={i} className={`flex items-start gap-2 text-sm px-2 py-1 rounded ${c.correct ? "bg-[#007B5F]/10 text-[#007B5F] font-medium" : "text-[#4A5568]"}`}>
                                          <span className="font-mono text-xs mt-0.5">{String.fromCharCode(65 + i)}.</span>
                                          <span>{c.text}</span>
                                          {c.correct && <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Answer */}
                                {q.answer && (
                                  <div>
                                    <p className="text-[10px] text-[#A0AEC0] uppercase tracking-wider mb-1">Answer</p>
                                    <p className="text-sm text-[#007B5F] font-medium">{q.answer}</p>
                                  </div>
                                )}

                                {/* Explanation */}
                                <div>
                                  <p className="text-[10px] text-[#A0AEC0] uppercase tracking-wider mb-1">Explanation</p>
                                  <p className="text-sm text-[#4A5568] whitespace-pre-wrap">{q.explanation || "No explanation yet."}</p>
                                </div>

                                {/* Metadata */}
                                <div className="flex flex-wrap gap-4 text-xs text-[#A0AEC0]">
                                  <span>Anki: {q.anki_note_id || "---"}</span>
                                  <span>Tags: {q.tags?.join(", ") || "---"}</span>
                                  <span>Active: {q.is_active ? "Yes" : "No"}</span>
                                  {q.image_url && (
                                    <a href={q.image_url} target="_blank" rel="noopener noreferrer" className="text-[#003A8C] underline">View Image</a>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {questions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[#A0AEC0] text-sm">No questions found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="btn-secondary text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
              >
                Prev
              </button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 7) {
                  p = i + 1;
                } else if (page <= 4) {
                  p = i + 1;
                } else if (page >= totalPages - 3) {
                  p = totalPages - 6 + i;
                } else {
                  p = page - 3 + i;
                }
                return (
                  <button
                    key={p}
                    onClick={() => onPageChange(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                      p === page ? "bg-[#007B5F] text-white" : "bg-white border border-[#E4E9F0] text-[#4A5568] hover:bg-[#F7F9FC]"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="btn-secondary text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}

          {/* Topic Breakdown (collapsible) */}
          {stats && stats.byTopic.length > 0 && (
            <details className="card rounded-xl p-4">
              <summary className="text-sm font-semibold text-[#1A2B3C] cursor-pointer">
                Topic Breakdown ({stats.byTopic.length} topics)
              </summary>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {stats.byTopic.map((t) => (
                  <div key={t.topic} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#F7F9FC]">
                    <span className="text-xs text-[#4A5568] truncate max-w-[200px]">{t.topic}</span>
                    <span className="text-xs font-mono text-[#007B5F] font-bold">{t.count}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {tab === "duplicates" && (
        <div className="card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#1A2B3C]">Duplicate Detection</h3>
              <p className="text-xs text-[#A0AEC0]">
                {duplicates
                  ? `${duplicates.totalGroups} groups, ${duplicates.totalExtraCopies} extra copies`
                  : "Scanning..."
                }
              </p>
            </div>
            <button onClick={onRefreshDuplicates} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
              <RotateCcw size={12} /> Re-scan
            </button>
          </div>

          {!duplicates ? (
            <p className="text-sm text-[#A0AEC0] text-center py-8">Scanning for duplicates...</p>
          ) : duplicates.totalGroups === 0 ? (
            <div className="text-center py-8">
              <CheckCircle size={32} className="text-[#007B5F] mx-auto mb-2" />
              <p className="text-sm text-[#007B5F] font-medium">No duplicates found</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {duplicates.groups.map((g, i) => (
                <div key={i} className="border border-[#E4E9F0] rounded-lg p-3">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-xs text-[#4A5568] flex-1 line-clamp-2">{g.text}</p>
                    <span className="text-[10px] bg-[#D64545]/10 text-[#D64545] px-2 py-0.5 rounded font-mono ml-2 flex-shrink-0">
                      {g.count}x
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.questions.map((q) => (
                      <span key={q.id} className="text-[10px] bg-[#F7F9FC] border border-[#E4E9F0] rounded px-2 py-1 font-mono">
                        #{q.id} -- {q.topic?.slice(0, 15)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "reviews" && (
        <div className="space-y-4">
          {/* Review Stats */}
          {suggestions && (
            <div className="grid grid-cols-4 gap-3">
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[#1A2B3C] font-mono">{suggestions.counts.total}</p>
                <p className="text-[10px] text-[#A0AEC0]">Total</p>
              </div>
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[#F4A261] font-mono">{suggestions.counts.pending}</p>
                <p className="text-[10px] text-[#A0AEC0]">Pending</p>
              </div>
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[#00A896] font-mono">{suggestions.counts.approved}</p>
                <p className="text-[10px] text-[#A0AEC0]">Approved</p>
              </div>
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[#D64545] font-mono">{suggestions.counts.rejected}</p>
                <p className="text-[10px] text-[#A0AEC0]">Rejected</p>
              </div>
            </div>
          )}

          {/* Suggestions List */}
          <div className="card rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E9F0]">
              <h3 className="text-sm font-semibold text-[#1A2B3C]">User Suggestions & Flags</h3>
              <button onClick={onRefreshSuggestions} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
                <RotateCcw size={12} /> Refresh
              </button>
            </div>

            {!suggestions ? (
              <p className="text-sm text-[#A0AEC0] text-center py-8">Loading suggestions...</p>
            ) : suggestions.suggestions.length === 0 ? (
              <p className="text-sm text-[#A0AEC0] text-center py-8">No suggestions yet</p>
            ) : (
              <div className="divide-y divide-[#E4E9F0]">
                {(suggestions.suggestions as Record<string, unknown>[]).map((s) => (
                  <div key={s.id as number} className="px-4 py-3 hover:bg-[#F7F9FC]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            s.type === "flag" ? "bg-[#D64545]/10 text-[#D64545]" : "bg-[#007B5F]/10 text-[#007B5F]"
                          }`}>
                            {(String(s.type)) === "flag" ? "FLAG" : "EDIT"}
                          </span>
                          {s.reason ? (
                            <span className="text-[10px] bg-[#F7F9FC] text-[#4A5568] px-2 py-0.5 rounded border border-[#E4E9F0]">
                              {String(s.reason)}
                            </span>
                          ) : null}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            s.status === "pending" ? "bg-[#F4A261]/10 text-[#F4A261]" :
                            s.status === "approved" ? "bg-[#00A896]/10 text-[#00A896]" :
                            "bg-[#D64545]/10 text-[#D64545]"
                          }`}>
                            {String(s.status)}
                          </span>
                        </div>
                        <p className="text-sm text-[#1A2B3C] mb-0.5">Q#{s.question_id as number}: {(String(s.question_text || ""))?.slice(0, 100)}...</p>
                        <p className="text-xs text-[#A0AEC0]">
                          By {String(s.user_name || "Anonymous")} · {String(s.question_topic || "")} · {new Date(String(s.created_at)).toLocaleDateString("de-DE")}
                        </p>
                        {s.details ? <p className="text-xs text-[#4A5568] mt-1 italic">&quot;{String(s.details)}&quot;</p> : null}
                      </div>

                      {/* Actions */}
                      {s.status === "pending" && (
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={async () => {
                              await fetch("/api/suggestions", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ suggestionId: s.id, action: "approve" }),
                              });
                              onRefreshSuggestions();
                            }}
                            className="text-[10px] bg-[#00A896] text-white px-2.5 py-1 rounded-lg font-medium hover:bg-[#008F80]"
                          >
                            Approve
                          </button>
                          <button
                            onClick={async () => {
                              await fetch("/api/suggestions", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ suggestionId: s.id, action: "reject" }),
                              });
                              onRefreshSuggestions();
                            }}
                            className="text-[10px] bg-[#D64545]/10 text-[#D64545] px-2.5 py-1 rounded-lg font-medium hover:bg-[#D64545]/20"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

function AnalyticsSection({
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
      {/* Header + Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="bg-white border border-[#E4E9F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#007B5F]/50"
          >
            <option value="">All Events</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="text-xs text-[#A0AEC0]">
            Showing {activities.length} of {total.toLocaleString()} events
          </span>
        </div>
        <div className="card rounded-xl px-4 py-2">
          <p className="text-lg font-bold text-[#007B5F] font-mono">{total.toLocaleString()}</p>
          <p className="text-[10px] text-[#A0AEC0]">Total Events</p>
        </div>
      </div>

      {/* Activity Feed Table */}
      <div className="card rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-[#F7F9FC] border-b border-[#E4E9F0]">
                <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Time</th>
                <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Event Type</th>
                <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Page</th>
                <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">User ID</th>
                <th className="text-left px-3 py-2.5 text-[#A0AEC0] font-medium text-xs">Details</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id} className="border-b border-[#E4E9F0]/30 hover:bg-[#F7F9FC]">
                  <td className="px-3 py-2.5 text-[#A0AEC0] text-xs whitespace-nowrap">{formatTime(a.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] bg-[#003A8C]/10 text-[#003A8C] px-2 py-0.5 rounded font-mono">
                      {a.event_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#4A5568]">{a.page || "---"}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-[#A0AEC0]">{a.user_id?.slice(0, 8)}...</td>
                  <td className="px-3 py-2.5 text-xs text-[#A0AEC0] max-w-[250px] truncate">
                    {a.topic && <span className="text-[#007B5F] mr-1">{a.topic}</span>}
                    {a.question_id && <span className="mr-1">Q#{a.question_id}</span>}
                    {a.duration_ms && <span className="mr-1">{a.duration_ms}ms</span>}
                    {a.ip_address && a.ip_address !== "unknown" && <span className="text-[#A0AEC0]/60">{a.ip_address}</span>}
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

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

function SystemSection({
  questionStats, users, onRefreshStats,
}: {
  questionStats: QuestionStats | null;
  users: UserRow[];
  onRefreshStats: () => void;
}) {
  const admins = users.filter((u) => u.role === "admin");

  return (
    <div className="space-y-6">
      {/* Database Stats */}
      <div className="card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#1A2B3C] flex items-center gap-2">
            <BarChart3 size={16} className="text-[#007B5F]" /> Database Statistics
          </h3>
          <button onClick={onRefreshStats} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
            <RotateCcw size={12} /> Refresh
          </button>
        </div>
        {questionStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#007B5F] font-mono">{questionStats.totalAll.toLocaleString()}</p>
              <p className="text-[10px] text-[#A0AEC0]">Total Questions</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#003A8C] font-mono">{questionStats.active.toLocaleString()}</p>
              <p className="text-[10px] text-[#A0AEC0]">Active</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#A0AEC0] font-mono">{questionStats.inactive.toLocaleString()}</p>
              <p className="text-[10px] text-[#A0AEC0]">Inactive</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#00A896] font-mono">{questionStats.byTopic?.length || 0}</p>
              <p className="text-[10px] text-[#A0AEC0]">Topics</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#F4A261] font-mono">{questionStats.withMCQ.toLocaleString()}</p>
              <p className="text-[10px] text-[#A0AEC0]">With MCQ</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#D64545] font-mono">{questionStats.withExplanations.toLocaleString()}</p>
              <p className="text-[10px] text-[#A0AEC0]">With Explanations</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#8B5CF6] font-mono">{questionStats.withImages.toLocaleString()}</p>
              <p className="text-[10px] text-[#A0AEC0]">With Images</p>
            </div>
            <div className="bg-[#F7F9FC] rounded-lg p-3">
              <p className="text-lg font-bold text-[#007B5F] font-mono">{users.length}</p>
              <p className="text-[10px] text-[#A0AEC0]">Total Users</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#A0AEC0] text-center py-4">Loading stats...</p>
        )}

        {/* Topic Counts Table */}
        {questionStats && questionStats.byTopic.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-[#4A5568] mb-2">Questions per Topic</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {questionStats.byTopic.map((t) => (
                <div key={t.topic} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#F7F9FC] text-xs">
                  <span className="text-[#4A5568] truncate max-w-[200px]">{t.topic}</span>
                  <span className="font-mono text-[#007B5F] font-bold">{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Admin Users */}
      <div className="card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
          <Shield size={16} className="text-[#D64545]" /> Admin Users ({admins.length})
        </h3>
        {admins.length > 0 ? (
          <div className="space-y-2">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[#F7F9FC]">
                <div className="flex items-center gap-3">
                  {a.photo_url ? (
                    <img src={a.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#D64545]/10 flex items-center justify-center text-xs font-bold text-[#D64545]">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-[#1A2B3C]">{a.name}</p>
                    <p className="text-[10px] text-[#A0AEC0]">{a.email || a.username || a.id.slice(0, 12)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#A0AEC0]">Last active: {timeAgo(a.last_active)}</p>
                  <p className="text-[10px] text-[#A0AEC0]">Joined: {formatDate(a.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#A0AEC0] text-center py-4">No admin users configured</p>
        )}
      </div>

      {/* App Info */}
      <div className="card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
          <Settings size={16} className="text-[#4A5568]" /> App Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="bg-[#F7F9FC] rounded-lg p-3">
            <p className="text-[10px] text-[#A0AEC0] mb-0.5">Application</p>
            <p className="text-[#1A2B3C] font-medium">MedPr&uuml;f v2.0</p>
          </div>
          <div className="bg-[#F7F9FC] rounded-lg p-3">
            <p className="text-[10px] text-[#A0AEC0] mb-0.5">Supabase Project</p>
            <p className="font-mono text-xs text-[#4A5568]">xfgllbkpgbginbjikjbb</p>
          </div>
          <div className="bg-[#F7F9FC] rounded-lg p-3">
            <p className="text-[10px] text-[#A0AEC0] mb-0.5">Deployment</p>
            <p className="text-[#4A5568]">Vercel (auto-deploy from main)</p>
          </div>
          <div className="bg-[#F7F9FC] rounded-lg p-3">
            <p className="text-[10px] text-[#A0AEC0] mb-0.5">Domain</p>
            <p className="text-[#003A8C]">medpruf.com</p>
          </div>
          <div className="bg-[#F7F9FC] rounded-lg p-3">
            <p className="text-[10px] text-[#A0AEC0] mb-0.5">Framework</p>
            <p className="text-[#4A5568]">Next.js 15 + TypeScript</p>
          </div>
          <div className="bg-[#F7F9FC] rounded-lg p-3">
            <p className="text-[10px] text-[#A0AEC0] mb-0.5">Auth</p>
            <p className="text-[#4A5568]">Telegram (Widget + Bot) + Email + Guest</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION: CHANGELOG (admin view — shows ALL entries including admin-only)
// ═══════════════════════════════════════════════════════════════════════════

function ChangelogSection() {
  // Group ALL entries (including admin) by date
  const grouped: Record<string, ChangelogEntry[]> = {};
  for (const entry of CHANGELOG) {
    if (!grouped[entry.date]) grouped[entry.date] = [];
    grouped[entry.date].push(entry);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const tagColors: Record<string, string> = {
    feature: "bg-[#007B5F]/10 text-[#007B5F]",
    improvement: "bg-[#003A8C]/10 text-[#003A8C]",
    fix: "bg-[#F4A261]/10 text-[#F4A261]",
    admin: "bg-[#D64545]/10 text-[#D64545]",
  };

  return (
    <div className="space-y-6">
      <div className="card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[#1A2B3C]">Full Changelog (Admin View)</h3>
            <p className="text-xs text-[#A0AEC0]">
              {CHANGELOG.length} total entries · {CHANGELOG.filter((e) => e.tag === "admin").length} admin-only
            </p>
          </div>
          <a
            href="/changelog"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs px-3 py-1.5 rounded-lg"
          >
            View User Version
          </a>
        </div>
        <p className="text-xs text-[#A0AEC0] italic">
          ⚠️ Maintained in <code className="bg-[#F7F9FC] px-1.5 py-0.5 rounded">src/lib/changelog.ts</code>. Edit that file to add new entries — they automatically appear here AND on /changelog.
        </p>
      </div>

      {/* Timeline */}
      <div className="space-y-6">
        {dates.map((date) => (
          <section key={date}>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-[#A0AEC0]" />
              <h3 className="text-sm font-semibold text-[#4A5568]">
                {new Date(date).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}
              </h3>
              <span className="text-[10px] text-[#A0AEC0]">({grouped[date].length} entries)</span>
            </div>

            <div className="space-y-2 pl-4 border-l-2 border-[#E4E9F0]">
              {grouped[date].map((entry, i) => (
                <div key={`${date}-${i}`} className="card rounded-lg p-3 -ml-4 pl-6 relative">
                  <div className={`absolute left-2 top-4 w-2.5 h-2.5 rounded-full ${tagColors[entry.tag].split(' ')[0]}`} />
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tagColors[entry.tag]}`}>
                      {entry.tag.toUpperCase()}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-[#1A2B3C] mb-0.5">
                    {entry.title.en}
                  </h4>
                  <p className="text-xs text-[#4A5568] mb-1">{entry.description.en}</p>
                  <p className="text-[10px] text-[#A0AEC0] italic">DE: {entry.title.de}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
