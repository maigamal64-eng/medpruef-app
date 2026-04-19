"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import {
  LayoutDashboard, Users, FileText, Activity, Settings, Sparkles,
  ChevronDown, Search, Edit3, Trash2, RotateCcw, Shield, Mail,
  Download, Filter, Eye, EyeOff, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Zap, BarChart3, MessageSquarePlus,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
} from "recharts";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
// Use the auth-aware fetch wrapper for every admin API call. It adds
// the `x-user-id` header that the server-side requireAdmin guard
// checks. Aliased to `fetch` so the 20 existing call sites don't need
// to be rewritten — they just automatically pick up the header.
import { authFetch as fetch } from "@/lib/authFetch";
// MPDS v2 primitives — replace ad-hoc modals, toasts, form fields, banners.
import {
  Dialog,
  useToast,
  TextField,
  Textarea,
  Select,
  EmptyState,
  BrandedLoader,
} from "@/components/ui";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type Section = "dashboard" | "users" | "questions" | "analytics" | "feedback" | "changelog" | "system";

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

// Chart palette — recharts Cell fill requires literal colors, not CSS vars.
// Sourced from MPDS tokens: viridian, cta-blue, warning (WCAG-safe amber), error, accent-teal, info.
// Purple + pink round out the 8 slots for topic distribution pie — not yet tokenized.
const COLORS = ["#007B5F", "#003A8C", "#D68A3A", "#D64545", "#00A896", "#3A7CA5", "#8B5CF6", "#EC4899"];

const NAV_ITEMS: { key: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "users", label: "Users", icon: Users },
  { key: "questions", label: "Questions", icon: FileText },
  { key: "analytics", label: "Analytics", icon: Activity },
  { key: "feedback", label: "Feedback", icon: MessageSquarePlus },
  { key: "changelog", label: "Changelog", icon: Sparkles },
  { key: "system", label: "System", icon: Settings },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDate(iso: string) {
  if (!iso) return "---";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso: string) {
  if (!iso) return "---";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
  if (status === "active") return "bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]";
  if (status === "recent") return "bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)]";
  return "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]";
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminDashboard() {
  const toast = useToast();
  const [section, setSection] = useState<Section>("dashboard");
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
      toast.success(`Role updated to ${newRole}`);
    } catch { toast.error("Failed to update role"); }
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
      toast.success("User saved");
    } catch { toast.error("Failed to update user"); }
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
      toast.success("Gamification reset");
    } catch { toast.error("Failed to reset gamification"); }
  };

  const handleUserDelete = async (userId: string) => {
    try {
      const res = await fetch(`/api/stats/admin/users?id=${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setDeletingUser(null);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
    } catch { toast.error("Failed to delete user"); }
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
      toast.success(`Question #${questionId} saved`);
    } catch { toast.error("Failed to update question"); }
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
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      {/* ═══ HEADER BAR (MPDS Admin-A) ═══ */}
      <header className="sticky top-0 z-20 bg-[var(--mp-oxford-blue)] border-b border-black/20">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--mp-viridian)] flex items-center justify-center flex-shrink-0 shadow-sm">
              <Shield size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="mp-h3 text-white leading-tight flex items-center gap-2">
                MedPr&uuml;f Admin
                <span className="text-[10px] font-mono font-semibold bg-white/10 text-white/80 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  Production
                </span>
              </h1>
              <p className="text-[11px] text-white/60">Analytics &amp; Management</p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5"
            aria-label="Refresh admin data"
          >
            <RotateCcw size={14} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Horizontal .mp-tabs nav (7 tabs, overflow-x on narrow) */}
        <div className="px-4 sm:px-6 pb-3">
          <div className="overflow-x-auto -mx-2 px-2">
            <div
              className="mp-tabs"
              role="tablist"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }}
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = section === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSection(item.key)}
                    className={`mp-tabs__tab ${active ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5 whitespace-nowrap`}
                    style={!active ? { color: "rgba(255,255,255,0.7)" } : undefined}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="min-w-0">
        {/* Error Banner (non-fatal fetch errors; actions use toasts) */}
        {error && (
          <div className="mx-4 sm:mx-6 mt-4 bg-[var(--mp-error-bg)] border border-[var(--mp-error)]/25 text-[var(--mp-error)] text-sm rounded-xl px-4 py-3 flex items-center gap-2" role="alert">
            <AlertTriangle size={16} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="mp-btn mp-btn--ghost mp-btn--sm" aria-label="Dismiss error">Dismiss</button>
          </div>
        )}

        {/* Content Area */}
        <div className="px-4 sm:px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <BrandedLoader label="Loading dashboard…" />
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
                  <ClarityCard />
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
              {section === "feedback" && <FeedbackSection />}
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
        <div className="h-5 w-48 bg-[var(--mp-border)] rounded mb-3" />
        <div className="h-12 w-32 bg-[var(--mp-border)] rounded" />
      </div>
    );
  }

  const sinceOpened = baseline !== null ? Math.max(0, data.total - baseline) : 0;
  const updated = new Date(data.generatedAt);
  const updatedStr = updated.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const stats: Array<{ label: string; value: number; tone: string }> = [
    { label: "Last Hour", value: data.lastHour, tone: "text-[var(--mp-accent-teal)]" },
    { label: "Today", value: data.today, tone: "text-[var(--mp-viridian)]" },
    { label: "7 Days", value: data.lastSevenDays, tone: "text-[var(--mp-cta-blue)]" },
    { label: "30 Days", value: data.lastThirtyDays, tone: "text-[var(--mp-info)]" },
  ];

  return (
    <div className="card rounded-2xl p-5 mb-6 border-l-4 border-l-[var(--mp-accent-teal)]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="relative w-2.5 h-2.5">
              <span className="absolute inset-0 rounded-full bg-[var(--mp-accent-teal)] animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-[var(--mp-accent-teal)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--mp-fg)]">
              Live Registrations
            </h3>
            {sinceOpened > 0 && (
              <span className="text-xs font-mono font-bold text-white bg-[var(--mp-accent-teal)] px-2 py-0.5 rounded-full animate-pulse">
                +{sinceOpened} since opened
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--mp-fg-subtle)] font-mono">
            {data.total.toLocaleString("en-GB")} users · updated {updatedStr}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors px-2 py-1"
        >
          ↻ Jetzt
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]/60 px-3 py-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-1">
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
          <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2">
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
                      ? "bg-[var(--mp-accent-teal)]/8 border border-[var(--mp-accent-teal)]/30"
                      : "bg-[var(--mp-surface-sunken)]/60"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isFresh && <span className="w-1.5 h-1.5 rounded-full bg-[var(--mp-accent-teal)] animate-pulse" />}
                    <span className="font-medium text-[var(--mp-fg)] truncate">
                      {name}
                    </span>
                    {u.tier && u.tier !== "free" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)] font-semibold uppercase">
                        {u.tier}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono whitespace-nowrap ml-3">
                    {ts.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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
    { label: "Total Users", value: data.totalUsers, icon: Users, color: "var(--mp-viridian)" },
    { label: "Active Users (DAU)", value: data.dau, icon: Zap, color: "var(--mp-cta-blue)" },
    { label: "Weekly Active (WAU)", value: data.wau, icon: TrendingUp, color: "var(--mp-status-warning)" },
    { label: "Monthly Active (MAU)", value: data.mau, icon: Activity, color: "var(--mp-accent-teal)" },
    { label: "Questions Today", value: data.questionsToday, icon: FileText, color: "var(--mp-error)" },
    { label: "Answered This Week", value: data.questionsThisWeek, icon: BarChart3, color: "var(--mp-info)" },
    { label: "Total Questions in DB", value: totalQuestions, icon: FileText, color: "#8B5CF6" },
    { label: "Explanation Coverage", value: `${explCoverage}%`, icon: CheckCircle, color: "var(--mp-viridian)" },
  ];

  return (
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
            <LineChart data={data.dailyActiveUsers}>
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
            <BarChart data={data.peakStudyHours}>
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
            {data.topTopics.map((t, i) => (
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
            {data.topTopics.length === 0 && <p className="text-xs text-[var(--mp-fg-subtle)] text-center py-4">No data yet</p>}
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-[var(--mp-error)]" /> Weakest 5 Topics
          </h3>
          <div className="space-y-3">
            {data.weakTopics.map((t, i) => (
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
            {data.weakTopics.length === 0 && <p className="text-xs text-[var(--mp-fg-subtle)] text-center py-4">No data yet</p>}
          </div>
        </div>
      </div>

      {/* Topic Distribution Pie */}
      {data.avgAccuracyByTopic.length > 0 && (
        <div className="card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4">Question Distribution by Topic</h3>
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
  const deletingUserRow = deletingUser ? allUsers.find((u) => u.id === deletingUser) : null;

  return (
    <div className="space-y-4">
      {/* Search — MPDS field with search-icon prefix */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-[13px] text-[var(--mp-fg-subtle)] pointer-events-none z-[1]" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name, email, username, or ID..."
          aria-label="Search users"
          className="mp-field__input w-full pl-10"
        />
      </div>

      {/* Stats Row — tight .mp-stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Total</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-viridian)" }}>{allUsers.length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Email Users</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-cta-blue)" }}>{allUsers.filter((u) => u.email).length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Telegram Users</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-accent-teal)" }}>{allUsers.filter((u) => u.telegram_id).length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Admins</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-error)" }}>{allUsers.filter((u) => u.role === "admin").length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Active Today</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-status-warning)" }}>{activeToday}</span>
        </div>
      </div>

      {/* Delete Confirmation Dialog (MPDS) */}
      <Dialog
        open={!!deletingUser}
        onOpenChange={(open) => { if (!open) onDeleteCancel(); }}
        title="Delete user?"
        description={deletingUserRow ? `This will permanently delete ${deletingUserRow.name}. This action cannot be undone.` : undefined}
        footer={
          <>
            <button className="mp-btn mp-btn--secondary" onClick={onDeleteCancel}>Cancel</button>
            <button
              className="mp-btn mp-btn--destructive"
              onClick={() => deletingUser && onDeleteConfirm(deletingUser)}
            >
              Delete user
            </button>
          </>
        }
      />

      {/* User Table */}
      <div className="card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--mp-surface-sunken)] border-b border-[var(--mp-border)]">
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
                    className={`px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs whitespace-nowrap ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"} ${col.key !== "auth" && col.key !== "actions" ? "cursor-pointer hover:text-[var(--mp-fg-muted)]" : ""}`}
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
                // Fragment key must be on the root node of the map
                // callback, not on an inner <tr>. The previous bare
                // <> caused React to warn about missing keys and
                // reconcile incorrectly (Frontend audit P0-2).
                <Fragment key={u.id}>
                  <tr
                    onClick={() => onExpandUser(u.id)}
                    className={`border-b border-[var(--mp-border)]/50 cursor-pointer transition-colors ${
                      expandedUser === u.id ? "bg-[var(--mp-viridian)]/5" : "hover:bg-[var(--mp-surface-sunken)]"
                    }`}
                  >
                    {/* Avatar + Name */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {u.photo_url ? (
                          <img src={u.photo_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 flex items-center justify-center text-xs font-bold text-[var(--mp-viridian)]">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-[var(--mp-fg)] truncate max-w-[120px]">{u.name}</span>
                      </div>
                    </td>
                    {/* Auth Badges */}
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {u.telegram_id && <span className="text-[9px] bg-[#229ED9]/10 text-[#229ED9] px-1.5 py-0.5 rounded font-semibold">TG</span>}
                        {u.email && <span className="text-[9px] bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] px-1.5 py-0.5 rounded font-semibold">Email</span>}
                      </div>
                    </td>
                    {/* Role dropdown */}
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={u.role}
                        onChange={(e) => onRoleChange(u.id, e.target.value)}
                        className="text-xs border border-[var(--mp-border)] rounded px-2 py-1 bg-white focus:outline-none focus:border-[var(--mp-viridian)]/50"
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
                          (u.tier || "free") === "pro" ? "border-[var(--mp-status-warning)] text-[var(--mp-status-warning)] bg-[var(--mp-status-warning)]/5" :
                          (u.tier || "free") === "admin" ? "border-[var(--mp-error)] text-[var(--mp-error)] bg-[var(--mp-error)]/5" :
                          "border-[var(--mp-border)] text-[var(--mp-fg-muted)] bg-white"
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
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--mp-status-warning)] text-xs">{u.xp.toLocaleString()}</td>
                    {/* Streak */}
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{u.streak > 0 ? `${u.streak}d` : "---"}</td>
                    {/* Questions */}
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{u.questions_answered}</td>
                    {/* Accuracy */}
                    <td className="px-3 py-2.5 text-right">
                      <span className={`font-mono text-xs ${u.accuracy >= 70 ? "text-[var(--mp-viridian)]" : u.accuracy >= 40 ? "text-[var(--mp-status-warning)]" : "text-[var(--mp-error)]"}`}>
                        {u.accuracy > 0 ? `${u.accuracy}%` : "---"}
                      </span>
                    </td>
                    {/* Last Active */}
                    <td className="px-3 py-2.5 text-right text-[var(--mp-fg-subtle)] text-xs whitespace-nowrap">{timeAgo(u.last_active)}</td>
                    {/* Joined */}
                    <td className="px-3 py-2.5 text-right text-[var(--mp-fg-subtle)] text-xs whitespace-nowrap">{formatDate(u.created_at)}</td>
                    {/* Actions */}
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onStartEdit(u)}
                          className="p-1.5 rounded-md hover:bg-[var(--mp-viridian)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-viridian)] transition-colors"
                          title="Edit"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => onResetGamification(u.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--mp-status-warning)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-status-warning)] transition-colors"
                          title="Reset gamification"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          onClick={() => onDeleteRequest(u.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--mp-error)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-error)] transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Delete confirmation handled by top-level <Dialog> (MPDS) */}

                  {/* Expanded Detail / Edit */}
                  {expandedUser === u.id && (
                    <tr>
                      <td colSpan={11} className="px-4 py-4 bg-[var(--mp-surface-sunken)]/50 border-b border-[var(--mp-border)]">
                        {editingUser === u.id ? (
                          <div className="space-y-3">
                            <h4 className="mp-caption text-[var(--mp-fg)]">Editing: {u.name}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <TextField
                                label="First Name"
                                value={editForm.first_name || ""}
                                onChange={(e) => onEditFormChange("first_name", e.target.value)}
                              />
                              <TextField
                                label="Last Name"
                                value={editForm.last_name || ""}
                                onChange={(e) => onEditFormChange("last_name", e.target.value)}
                              />
                              <TextField
                                label="Email"
                                type="email"
                                value={editForm.email || ""}
                                onChange={(e) => onEditFormChange("email", e.target.value)}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => onSaveEdit(u.id)} className="mp-btn mp-btn--primary mp-btn--sm">Save Changes</button>
                              <button onClick={onCancelEdit} className="mp-btn mp-btn--secondary mp-btn--sm">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">ID:</span> <span className="font-mono text-[10px] break-all">{u.id}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Email:</span> <span className="text-xs">{u.email || "---"}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Telegram:</span> <span className="text-xs font-mono">{u.telegram_id || "---"}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Username:</span> <span className="text-xs">@{u.username || "---"}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Daily Today:</span> <span className="text-xs font-mono">{u.daily_today}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Last Study:</span> <span className="text-xs">{u.last_study ? formatDate(u.last_study) : "---"}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Last Active:</span> <span className="text-xs">{formatTime(u.last_active)}</span></div>
                            <div><span className="text-[var(--mp-fg-subtle)] text-xs">Photo:</span> {u.photo_url ? <a href={u.photo_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--mp-cta-blue)] underline">View</a> : <span className="text-xs">---</span>}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-2">
                    <EmptyState
                      tone="neutral"
                      icon={<Users className="w-10 h-10" aria-hidden />}
                      title={search ? "No users match your search" : "No users yet"}
                      body={search ? "Try a different name, email, or ID." : "Users will appear here as they register."}
                    />
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
      {/* Stats Cards — .mp-stat tight grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="mp-stat" style={{ padding: 12 }}>
            <span className="mp-stat__label">Total</span>
            <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-viridian)" }}>{stats.totalAll.toLocaleString()}</span>
          </div>
          <div className="mp-stat" style={{ padding: 12 }}>
            <span className="mp-stat__label">Active</span>
            <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-cta-blue)" }}>{stats.active.toLocaleString()}</span>
          </div>
          <div className="mp-stat" style={{ padding: 12 }}>
            <span className="mp-stat__label">Inactive</span>
            <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-fg-subtle)" }}>{stats.inactive.toLocaleString()}</span>
          </div>
          <div className="mp-stat" style={{ padding: 12 }}>
            <span className="mp-stat__label">MCQ</span>
            <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-accent-teal)" }}>{stats.mcqPct}%</span>
          </div>
          <div className="mp-stat" style={{ padding: 12 }}>
            <span className="mp-stat__label">Explanation</span>
            <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-status-warning)" }}>{stats.explPct}%</span>
          </div>
          <div className="mp-stat" style={{ padding: 12 }}>
            <span className="mp-stat__label">Image</span>
            <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-error)" }}>{stats.imgPct}%</span>
          </div>
        </div>
      )}

      {/* Sub-tab switcher — .mp-tabs */}
      <div className="mp-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "browse"}
          onClick={() => onTabChange("browse")}
          className={`mp-tabs__tab ${tab === "browse" ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5`}
        >
          <FileText size={13} />Browse
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "duplicates"}
          onClick={() => onTabChange("duplicates")}
          className={`mp-tabs__tab ${tab === "duplicates" ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5`}
        >
          <AlertTriangle size={13} />Duplicates
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reviews"}
          onClick={() => onTabChange("reviews")}
          className={`mp-tabs__tab ${tab === "reviews" ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5`}
        >
          Reviews
          {suggestions?.counts.pending ? (
            <span className="ml-0.5 bg-[var(--mp-error)] text-white text-[10px] font-mono px-1.5 py-0.5 rounded-full">
              {suggestions.counts.pending}
            </span>
          ) : null}
        </button>
      </div>

      {tab === "browse" && (
        <>
          {/* Search + Filters — MPDS fields */}
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-[13px] text-[var(--mp-fg-subtle)] pointer-events-none z-[1]" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearch()}
                placeholder="Search question text..."
                aria-label="Search questions"
                className="mp-field__input w-full pl-10"
              />
            </div>
            <Select
              label="Filter by exam"
              hideLabel
              value={examTypeFilter}
              onChange={(e) => onExamTypeFilterChange(e.target.value)}
              options={[
                { value: "all", label: "All Exams" },
                { value: "kenntnispruefung", label: "Kenntnisprüfung" },
                { value: "kmp_innsbruck", label: "KMP Innsbruck" },
                { value: "pharma", label: "Pharma" },
              ]}
            />
            <Select
              label="Filter by topic"
              hideLabel
              value={topicFilter}
              onChange={(e) => onTopicFilterChange(e.target.value)}
              options={[
                { value: "", label: "All Topics" },
                ...(stats?.byTopic || []).map((t) => ({ value: t.topic, label: `${t.topic} (${t.count})` })),
              ]}
            />
            <Select
              label="Filter by explanation status"
              hideLabel
              value={explFilter}
              onChange={(e) => onExplFilterChange(e.target.value)}
              options={[
                { value: "all", label: "All Explanations" },
                { value: "with", label: "With Explanation" },
                { value: "without", label: "Without Explanation" },
              ]}
            />
            <Select
              label="Filter by active status"
              hideLabel
              value={activeFilter}
              onChange={(e) => onActiveFilterChange(e.target.value)}
              options={[
                { value: "all", label: "All Status" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
            <button onClick={onSearch} className="mp-btn mp-btn--primary flex items-center gap-2">
              <Filter size={14} /> Filter
            </button>
          </div>

          {/* Results count */}
          <p className="text-xs text-[var(--mp-fg-subtle)]">{total.toLocaleString()} questions found -- Page {page} of {totalPages}</p>

          {/* Questions Table */}
          <div className="card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--mp-surface-sunken)] border-b border-[var(--mp-border)]">
                    <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">ID</th>
                    <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Topic</th>
                    <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Question</th>
                    <th className="text-center px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Choices</th>
                    <th className="text-center px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Expl</th>
                    <th className="text-center px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Img</th>
                    <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Exam Dates</th>
                    <th className="text-center px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => (
                    <Fragment key={q.id}>
                      <tr
                        onClick={() => onExpandQuestion(q.id)}
                        className={`border-b border-[var(--mp-border)]/50 cursor-pointer transition-colors ${
                          expandedQuestion === q.id ? "bg-[var(--mp-viridian)]/5" : "hover:bg-[var(--mp-surface-sunken)]"
                        } ${!q.is_active ? "opacity-50" : ""}`}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs text-[var(--mp-fg-subtle)]">#{q.id}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] px-2 py-0.5 rounded font-medium truncate max-w-[120px] inline-block">
                            {q.topic?.slice(0, 20) || "---"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[var(--mp-fg-muted)] max-w-[300px] truncate">{q.question_preview}</td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs">{q.choices_count || "---"}</td>
                        <td className="px-3 py-2.5 text-center">
                          {q.has_explanation
                            ? <CheckCircle size={14} className="inline text-[var(--mp-viridian)]" />
                            : <EyeOff size={14} className="inline text-[var(--mp-fg-subtle)]" />
                          }
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {q.has_image
                            ? <Eye size={14} className="inline text-[var(--mp-cta-blue)]" />
                            : <span className="text-[var(--mp-fg-subtle)] text-xs">---</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[var(--mp-fg-subtle)]">
                          {q.exam_dates?.length ? q.exam_dates.slice(0, 2).join(", ") + (q.exam_dates.length > 2 ? ` +${q.exam_dates.length - 2}` : "") : "---"}
                        </td>
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onStartEditQuestion(q)}
                            className="p-1.5 rounded-md hover:bg-[var(--mp-viridian)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-viridian)] transition-colors"
                            title="Edit"
                          >
                            <Edit3 size={13} />
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Question Detail */}
                      {expandedQuestion === q.id && (
                        <tr>
                          <td colSpan={8} className="px-4 py-4 bg-[var(--mp-surface-sunken)]/50 border-b border-[var(--mp-border)]">
                            {editingQuestion === q.id ? (
                              <div className="space-y-3">
                                <h4 className="mp-caption text-[var(--mp-fg)]">Editing Question #{q.id}</h4>
                                <TextField
                                  label="Topic"
                                  value={(questionEditForm.topic as string) || ""}
                                  onChange={(e) => onQuestionEditFormChange("topic", e.target.value)}
                                />
                                <Textarea
                                  label="Explanation"
                                  rows={4}
                                  value={(questionEditForm.explanation as string) || ""}
                                  onChange={(e) => onQuestionEditFormChange("explanation", e.target.value)}
                                />
                                <div className="flex items-center gap-3">
                                  <label className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={!!questionEditForm.is_active}
                                      onChange={(e) => onQuestionEditFormChange("is_active", e.target.checked)}
                                      className="accent-[var(--mp-viridian)]"
                                    />
                                    Active
                                  </label>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => onSaveQuestionEdit(q.id)} className="mp-btn mp-btn--primary mp-btn--sm">Save</button>
                                  <button onClick={onCancelQuestionEdit} className="mp-btn mp-btn--secondary mp-btn--sm">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {/* Full question text */}
                                <div>
                                  <p className="text-[10px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1">Question</p>
                                  <p className="text-sm text-[var(--mp-fg)] whitespace-pre-wrap">{q.question}</p>
                                </div>

                                {/* Choices */}
                                {q.choices && q.choices.length > 0 && (
                                  <div>
                                    <p className="text-[10px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1">Choices</p>
                                    <div className="space-y-1">
                                      {q.choices.map((c, i) => (
                                        <div key={i} className={`flex items-start gap-2 text-sm px-2 py-1 rounded ${c.correct ? "bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] font-medium" : "text-[var(--mp-fg-muted)]"}`}>
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
                                    <p className="text-[10px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1">Answer</p>
                                    <p className="text-sm text-[var(--mp-viridian)] font-medium">{q.answer}</p>
                                  </div>
                                )}

                                {/* Explanation */}
                                <div>
                                  <p className="text-[10px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1">Explanation</p>
                                  <p className="text-sm text-[var(--mp-fg-muted)] whitespace-pre-wrap">{q.explanation || "No explanation yet."}</p>
                                </div>

                                {/* Metadata */}
                                <div className="flex flex-wrap gap-4 text-xs text-[var(--mp-fg-subtle)]">
                                  <span>Anki: {q.anki_note_id || "---"}</span>
                                  <span>Tags: {q.tags?.join(", ") || "---"}</span>
                                  <span>Active: {q.is_active ? "Yes" : "No"}</span>
                                  {q.image_url && (
                                    <a href={q.image_url} target="_blank" rel="noopener noreferrer" className="text-[var(--mp-cta-blue)] underline">View Image</a>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {questions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-2">
                        <EmptyState
                          tone="neutral"
                          icon={<FileText className="w-10 h-10" aria-hidden />}
                          title="No questions match these filters"
                          body="Try clearing a filter or adjusting your search."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination — .mp-btn pills */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40"
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
                    className={`mp-btn ${p === page ? "mp-btn--success" : "mp-btn--secondary"} mp-btn--sm`}
                    style={{ minWidth: 32, padding: "6px 10px" }}
                    aria-current={p === page ? "page" : undefined}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}

          {/* Topic Breakdown (collapsible) */}
          {stats && stats.byTopic.length > 0 && (
            <details className="card rounded-xl p-4">
              <summary className="text-sm font-semibold text-[var(--mp-fg)] cursor-pointer">
                Topic Breakdown ({stats.byTopic.length} topics)
              </summary>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {stats.byTopic.map((t) => (
                  <div key={t.topic} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[var(--mp-surface-sunken)]">
                    <span className="text-xs text-[var(--mp-fg-muted)] truncate max-w-[200px]">{t.topic}</span>
                    <span className="text-xs font-mono text-[var(--mp-viridian)] font-bold">{t.count}</span>
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
              <h3 className="text-sm font-semibold text-[var(--mp-fg)]">Duplicate Detection</h3>
              <p className="text-xs text-[var(--mp-fg-subtle)]">
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
            <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-8">Scanning for duplicates...</p>
          ) : duplicates.totalGroups === 0 ? (
            <div className="text-center py-8">
              <CheckCircle size={32} className="text-[var(--mp-viridian)] mx-auto mb-2" />
              <p className="text-sm text-[var(--mp-viridian)] font-medium">No duplicates found</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {duplicates.groups.map((g, i) => (
                <div key={i} className="border border-[var(--mp-border)] rounded-lg p-3">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-xs text-[var(--mp-fg-muted)] flex-1 line-clamp-2">{g.text}</p>
                    <span className="text-[10px] bg-[var(--mp-error)]/10 text-[var(--mp-error)] px-2 py-0.5 rounded font-mono ml-2 flex-shrink-0">
                      {g.count}x
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.questions.map((q) => (
                      <span key={q.id} className="text-[10px] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded px-2 py-1 font-mono">
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
                <p className="text-lg font-bold text-[var(--mp-fg)] font-mono">{suggestions.counts.total}</p>
                <p className="text-[10px] text-[var(--mp-fg-subtle)]">Total</p>
              </div>
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[var(--mp-status-warning)] font-mono">{suggestions.counts.pending}</p>
                <p className="text-[10px] text-[var(--mp-fg-subtle)]">Pending</p>
              </div>
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[var(--mp-accent-teal)] font-mono">{suggestions.counts.approved}</p>
                <p className="text-[10px] text-[var(--mp-fg-subtle)]">Approved</p>
              </div>
              <div className="card rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-[var(--mp-error)] font-mono">{suggestions.counts.rejected}</p>
                <p className="text-[10px] text-[var(--mp-fg-subtle)]">Rejected</p>
              </div>
            </div>
          )}

          {/* Suggestions List */}
          <div className="card rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--mp-border)]">
              <h3 className="text-sm font-semibold text-[var(--mp-fg)]">User Suggestions & Flags</h3>
              <button onClick={onRefreshSuggestions} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
                <RotateCcw size={12} /> Refresh
              </button>
            </div>

            {!suggestions ? (
              <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-8">Loading suggestions...</p>
            ) : suggestions.suggestions.length === 0 ? (
              <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-8">No suggestions yet</p>
            ) : (
              <div className="divide-y divide-[var(--mp-border)]">
                {(suggestions.suggestions as Record<string, unknown>[]).map((s) => (
                  <div key={s.id as number} className="px-4 py-3 hover:bg-[var(--mp-surface-sunken)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            s.type === "flag" ? "bg-[var(--mp-error)]/10 text-[var(--mp-error)]" : "bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]"
                          }`}>
                            {(String(s.type)) === "flag" ? "FLAG" : "EDIT"}
                          </span>
                          {s.reason ? (
                            <span className="text-[10px] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] px-2 py-0.5 rounded border border-[var(--mp-border)]">
                              {String(s.reason)}
                            </span>
                          ) : null}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            s.status === "pending" ? "bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)]" :
                            s.status === "approved" ? "bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)]" :
                            "bg-[var(--mp-error)]/10 text-[var(--mp-error)]"
                          }`}>
                            {String(s.status)}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--mp-fg)] mb-0.5">Q#{s.question_id as number}: {(String(s.question_text || ""))?.slice(0, 100)}...</p>
                        <p className="text-xs text-[var(--mp-fg-subtle)]">
                          By {String(s.user_name || "Anonymous")} · {String(s.question_topic || "")} · {new Date(String(s.created_at)).toLocaleDateString("en-GB")}
                        </p>
                        {s.details ? <p className="text-xs text-[var(--mp-fg-muted)] mt-1 italic">&quot;{String(s.details)}&quot;</p> : null}
                        {(() => {
                          const ctx = s.context as Record<string, unknown> | null;
                          if (!ctx) return null;
                          const url = ctx.url as string | undefined;
                          const examType = ctx.exam_type as string | undefined;
                          const ua = ctx.user_agent as string | undefined;
                          const viewport = ctx.viewport as string | undefined;
                          const guestId = ctx.guest_id as string | undefined;
                          const sessionName = ctx.session_first_name as string | undefined;
                          const ip = ctx.ip as string | undefined;
                          const buildId = ctx.build_id as string | undefined;
                          return (
                            <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                              {sessionName && <span className="bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] px-1.5 py-0.5 rounded">{sessionName}</span>}
                              {guestId && <span className="bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)] px-1.5 py-0.5 rounded">guest: {guestId.slice(0, 18)}</span>}
                              {examType && <span className="bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] px-1.5 py-0.5 rounded">{examType}</span>}
                              {url && <span className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] px-1.5 py-0.5 rounded border border-[var(--mp-border)] truncate max-w-[220px]" title={url}>{new URL(url).pathname}</span>}
                              {viewport && <span className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-1.5 py-0.5 rounded border border-[var(--mp-border)]">{viewport}</span>}
                              {ip && <span className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-1.5 py-0.5 rounded border border-[var(--mp-border)]">{ip}</span>}
                              {buildId && <span className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-1.5 py-0.5 rounded border border-[var(--mp-border)]" title={buildId}>build: {buildId.slice(0, 7)}</span>}
                              {ua && <span className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-1.5 py-0.5 rounded border border-[var(--mp-border)] truncate max-w-[260px]" title={ua}>{(ua.match(/\(([^)]+)\)/)?.[1] || ua).slice(0, 40)}</span>}
                            </div>
                          );
                        })()}
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
                            className="text-[10px] bg-[var(--mp-accent-teal)] text-white px-2.5 py-1 rounded-lg font-medium hover:bg-[var(--mp-viridian-dk)]"
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
                            className="text-[10px] bg-[var(--mp-error)]/10 text-[var(--mp-error)] px-2.5 py-1 rounded-lg font-medium hover:bg-[var(--mp-error)]/20"
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
// CLARITY UX CARD
// ═══════════════════════════════════════════════════════════════════════════

function ClarityCard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/api/stats/admin/clarity")
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const deadClicks = data.DeadClickCount as { percentage: number; count: string } | undefined;
  const rageClicks = data.RageClickCount as { percentage: number; count: string } | undefined;
  const scrollDepth = data.scrollDepth as number | undefined;
  const totalSessions = data.totalSessions as string | undefined;
  const popularPages = (data.popularPages || []) as Array<{ url: string; visitsCount: string }>;

  return (
    <div className="card rounded-2xl p-5 mb-6 border-l-4 border-l-[#8B5CF6]">
      <div className="flex items-center gap-2 mb-4">
        <Eye className="w-4 h-4 text-[#8B5CF6]" />
        <h3 className="text-sm font-bold text-[var(--mp-fg)]">Clarity UX Insights</h3>
        <span className="text-[10px] text-[var(--mp-fg-subtle)] ml-auto">{totalSessions || "—"} sessions</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[var(--mp-surface-sunken)] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[var(--mp-error)] font-mono">{deadClicks?.percentage || 0}%</p>
          <p className="text-[10px] text-[var(--mp-fg-subtle)]">Dead Clicks</p>
        </div>
        <div className="bg-[var(--mp-surface-sunken)] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[var(--mp-status-warning)] font-mono">{rageClicks?.percentage || 0}%</p>
          <p className="text-[10px] text-[var(--mp-fg-subtle)]">Rage Clicks</p>
        </div>
        <div className="bg-[var(--mp-surface-sunken)] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[var(--mp-accent-teal)] font-mono">{scrollDepth ? Math.round(scrollDepth) : 0}%</p>
          <p className="text-[10px] text-[var(--mp-fg-subtle)]">Avg Scroll Depth</p>
        </div>
      </div>
      {popularPages.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2">Top Pages</p>
          <div className="space-y-1">
            {popularPages.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-[var(--mp-fg-muted)] truncate">{p.url.replace('https://medpruf.com', '')}</span>
                <span className="text-[var(--mp-fg-subtle)] font-mono ml-2 flex-shrink-0">{p.visitsCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FEEDBACK SECTION
// ═══════════════════════════════════════════════════════════════════════════

interface FeedbackItem {
  id: number;
  user_id: string | null;
  message: string;
  context: Record<string, unknown>;
  status: string;
  admin_note: string | null;
  created_at: string;
}

function FeedbackSection() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchFeedback = useCallback(async (status = "all") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feedback?status=${status}&limit=100`);
      if (res.ok) setItems(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFeedback(statusFilter); }, [fetchFeedback, statusFilter]);

  const updateStatus = async (id: number, status: string, note?: string) => {
    await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, admin_note: note }),
    });
    fetchFeedback(statusFilter);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="mp-h2">User Feedback</h2>
        <div className="mp-tabs" role="tablist">
          {["all", "new", "reviewed", "resolved", "dismissed"].map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`mp-tabs__tab ${statusFilter === s ? "mp-tabs__tab--active" : ""}`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <BrandedLoader size={60} label="Loading feedback…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone={statusFilter === "new" ? "success" : "neutral"}
          icon={<MessageSquarePlus className="w-10 h-10" aria-hidden />}
          title={statusFilter === "new" ? "No new feedback" : "No feedback in this filter"}
          body={statusFilter === "new" ? "Your inbox is empty. New user feedback will show up here." : "Try another filter to see feedback in different statuses."}
        />
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="card rounded-xl p-4 border-l-4 border-l-[var(--mp-cta-blue)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--mp-fg)] whitespace-pre-wrap mb-2">{item.message}</p>
                  <div className="flex flex-wrap gap-2 text-[10px] text-[var(--mp-fg-subtle)]">
                    <span>{new Date(item.created_at).toLocaleString("en-GB")}</span>
                    {item.user_id && <span>User: {item.user_id.slice(0, 8)}...</span>}
                    {!item.user_id && <span className="text-[var(--mp-error)]">Anonymous</span>}
                    {item.context?.pathname ? <span>Page: {String(item.context.pathname)}</span> : null}
                    {item.context?.examType ? <span>Exam: {String(item.context.examType)}</span> : null}
                    {item.context?.screenSize ? <span>Screen: {String(item.context.screenSize)}</span> : null}
                  </div>
                  {item.admin_note && (
                    <p className="text-xs text-[var(--mp-viridian)] mt-2 italic">Note: {item.admin_note}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
                    item.status === "new" ? "bg-[var(--mp-error)]/15 text-[var(--mp-error)]" :
                    item.status === "reviewed" ? "bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]" :
                    item.status === "resolved" ? "bg-[var(--mp-accent-teal)]/15 text-[var(--mp-accent-teal)]" :
                    "bg-[var(--mp-fg-subtle)]/15 text-[var(--mp-fg-subtle)]"
                  }`}>{item.status}</span>
                  {item.status === "new" && (
                    <>
                      <button onClick={() => updateStatus(item.id, "reviewed")}
                        className="text-[9px] px-2 py-1 bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)] rounded hover:bg-[var(--mp-status-warning)]/20">
                        Mark Reviewed
                      </button>
                      <button onClick={() => updateStatus(item.id, "resolved")}
                        className="text-[9px] px-2 py-1 bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)] rounded hover:bg-[var(--mp-accent-teal)]/20">
                        Resolve
                      </button>
                      <button onClick={() => updateStatus(item.id, "dismissed")}
                        className="text-[9px] px-2 py-1 bg-[var(--mp-fg-subtle)]/10 text-[var(--mp-fg-subtle)] rounded hover:bg-[var(--mp-fg-subtle)]/20">
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
          <Select
            label="Filter events"
            hideLabel
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            options={[
              { value: "", label: "All Events" },
              ...eventTypes.map((t) => ({ value: t, label: t })),
            ]}
          />
          <span className="text-xs text-[var(--mp-fg-subtle)]">
            Showing {activities.length} of {total.toLocaleString()} events
          </span>
        </div>
        <div className="card rounded-xl px-4 py-2">
          <p className="text-lg font-bold text-[var(--mp-viridian)] font-mono">{total.toLocaleString()}</p>
          <p className="text-[10px] text-[var(--mp-fg-subtle)]">Total Events</p>
        </div>
      </div>

      {/* Activity Feed Table */}
      <div className="card rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="bg-[var(--mp-surface-sunken)] border-b border-[var(--mp-border)]">
                <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Time</th>
                <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Event Type</th>
                <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Page</th>
                <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">User ID</th>
                <th className="text-left px-3 py-2.5 text-[var(--mp-fg-subtle)] font-medium text-xs">Details</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id} className="border-b border-[var(--mp-border)]/30 hover:bg-[var(--mp-surface-sunken)]">
                  <td className="px-3 py-2.5 text-[var(--mp-fg-subtle)] text-xs whitespace-nowrap">{formatTime(a.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] px-2 py-0.5 rounded font-mono">
                      {a.event_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--mp-fg-muted)]">{a.page || "---"}</td>
                  <td className="px-3 py-2.5 text-xs font-mono text-[var(--mp-fg-subtle)]">{a.user_id?.slice(0, 8)}...</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--mp-fg-subtle)] max-w-[250px] truncate">
                    {a.topic && <span className="text-[var(--mp-viridian)] mr-1">{a.topic}</span>}
                    {a.question_id && <span className="mr-1">Q#{a.question_id}</span>}
                    {a.duration_ms && <span className="mr-1">{a.duration_ms}ms</span>}
                    {a.ip_address && a.ip_address !== "unknown" && <span className="text-[var(--mp-fg-subtle)]/60">{a.ip_address}</span>}
                  </td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-2">
                    <EmptyState
                      tone="neutral"
                      icon={<Activity className="w-10 h-10" aria-hidden />}
                      title="No activity data yet"
                      body="Events from user sessions will appear here in real time."
                    />
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
          <h3 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2">
            <BarChart3 size={16} className="text-[var(--mp-viridian)]" /> Database Statistics
          </h3>
          <button onClick={onRefreshStats} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
            <RotateCcw size={12} /> Refresh
          </button>
        </div>
        {questionStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-viridian)] font-mono">{questionStats.totalAll.toLocaleString()}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">Total Questions</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-cta-blue)] font-mono">{questionStats.active.toLocaleString()}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">Active</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-fg-subtle)] font-mono">{questionStats.inactive.toLocaleString()}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">Inactive</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-accent-teal)] font-mono">{questionStats.byTopic?.length || 0}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">Topics</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-status-warning)] font-mono">{questionStats.withMCQ.toLocaleString()}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">With MCQ</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-error)] font-mono">{questionStats.withExplanations.toLocaleString()}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">With Explanations</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[#8B5CF6] font-mono">{questionStats.withImages.toLocaleString()}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">With Images</p>
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
              <p className="text-lg font-bold text-[var(--mp-viridian)] font-mono">{users.length}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">Total Users</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-4">Loading stats...</p>
        )}

        {/* Topic Counts Table */}
        {questionStats && questionStats.byTopic.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-[var(--mp-fg-muted)] mb-2">Questions per Topic</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {questionStats.byTopic.map((t) => (
                <div key={t.topic} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[var(--mp-surface-sunken)] text-xs">
                  <span className="text-[var(--mp-fg-muted)] truncate max-w-[200px]">{t.topic}</span>
                  <span className="font-mono text-[var(--mp-viridian)] font-bold">{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Admin Users */}
      <div className="card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4 flex items-center gap-2">
          <Shield size={16} className="text-[var(--mp-error)]" /> Admin Users ({admins.length})
        </h3>
        {admins.length > 0 ? (
          <div className="space-y-2">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--mp-surface-sunken)]">
                <div className="flex items-center gap-3">
                  {a.photo_url ? (
                    <img src={a.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[var(--mp-error)]/10 flex items-center justify-center text-xs font-bold text-[var(--mp-error)]">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-[var(--mp-fg)]">{a.name}</p>
                    <p className="text-[10px] text-[var(--mp-fg-subtle)]">{a.email || a.username || a.id.slice(0, 12)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--mp-fg-subtle)]">Last active: {timeAgo(a.last_active)}</p>
                  <p className="text-[10px] text-[var(--mp-fg-subtle)]">Joined: {formatDate(a.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-4">No admin users configured</p>
        )}
      </div>

      {/* App Info */}
      <div className="card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4 flex items-center gap-2">
          <Settings size={16} className="text-[var(--mp-fg-muted)]" /> App Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
            <p className="text-[10px] text-[var(--mp-fg-subtle)] mb-0.5">Application</p>
            <p className="text-[var(--mp-fg)] font-medium">MedPr&uuml;f v2.0</p>
          </div>
          <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
            <p className="text-[10px] text-[var(--mp-fg-subtle)] mb-0.5">Supabase Project</p>
            <p className="font-mono text-xs text-[var(--mp-fg-muted)]">xfgllbkpgbginbjikjbb</p>
          </div>
          <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
            <p className="text-[10px] text-[var(--mp-fg-subtle)] mb-0.5">Deployment</p>
            <p className="text-[var(--mp-fg-muted)]">Vercel (auto-deploy from main)</p>
          </div>
          <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
            <p className="text-[10px] text-[var(--mp-fg-subtle)] mb-0.5">Domain</p>
            <p className="text-[var(--mp-cta-blue)]">medpruf.com</p>
          </div>
          <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
            <p className="text-[10px] text-[var(--mp-fg-subtle)] mb-0.5">Framework</p>
            <p className="text-[var(--mp-fg-muted)]">Next.js 15 + TypeScript</p>
          </div>
          <div className="bg-[var(--mp-surface-sunken)] rounded-lg p-3">
            <p className="text-[10px] text-[var(--mp-fg-subtle)] mb-0.5">Auth</p>
            <p className="text-[var(--mp-fg-muted)]">Telegram (Widget + Bot) + Email + Guest</p>
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
    feature: "bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]",
    improvement: "bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]",
    fix: "bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)]",
    admin: "bg-[var(--mp-error)]/10 text-[var(--mp-error)]",
  };

  return (
    <div className="space-y-6">
      <div className="card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--mp-fg)]">Full Changelog (Admin View)</h3>
            <p className="text-xs text-[var(--mp-fg-subtle)]">
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
        <p className="text-xs text-[var(--mp-fg-subtle)] italic">
          ⚠️ Maintained in <code className="bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded">src/lib/changelog.ts</code>. Edit that file to add new entries — they automatically appear here AND on /changelog.
        </p>
      </div>

      {/* Timeline */}
      <div className="space-y-6">
        {dates.map((date) => (
          <section key={date}>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-[var(--mp-fg-subtle)]" />
              <h3 className="text-sm font-semibold text-[var(--mp-fg-muted)]">
                {new Date(date).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}
              </h3>
              <span className="text-[10px] text-[var(--mp-fg-subtle)]">({grouped[date].length} entries)</span>
            </div>

            <div className="space-y-2 pl-4 border-l-2 border-[var(--mp-border)]">
              {grouped[date].map((entry, i) => (
                <div key={`${date}-${i}`} className="card rounded-lg p-3 -ml-4 pl-6 relative">
                  <div className={`absolute left-2 top-4 w-2.5 h-2.5 rounded-full ${tagColors[entry.tag].split(' ')[0]}`} />
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tagColors[entry.tag]}`}>
                      {entry.tag.toUpperCase()}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {entry.title.en}
                  </h4>
                  <p className="text-xs text-[var(--mp-fg-muted)] mb-1">{entry.description.en}</p>
                  <p className="text-[10px] text-[var(--mp-fg-subtle)] italic">DE: {entry.title.de}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
