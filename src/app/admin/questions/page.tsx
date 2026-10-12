"use client";

/**
 * Admin / Questions tab.
 *
 * Three sub-tabs kept as local state (one route is enough for this
 * level of hierarchy):
 *   - Browse: paginated filterable editable question table
 *   - Duplicates: content-hash-based duplicate group scanner
 *   - Reviews: user-submitted flag/edit suggestion queue
 *
 * Mutations PATCH `/api/stats/admin/questions` (edits) and
 * `/api/suggestions` (approve/reject). Toasts surface success/failure.
 */

import { changedQuestionFields } from "@/lib/admin/question-edit";
import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Edit3,
  RotateCcw,
  Filter,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  FileText,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useToast,
  TextField,
  Textarea,
  Select,
  EmptyState,
  Alert,
  BrandedLoader,
} from "@/components/ui";
import { ResponsiveTable } from "../_components/ResponsiveTable";
import { AdminPageShell } from "../_components/AdminPageShell";
import { ReviewsQueue } from "./ReviewsQueue";
import type {
  QuestionRow,
  QuestionStats,
  DuplicateData,
} from "../_components/types";

type SubTab = "browse" | "duplicates" | "reviews";

export default function AdminQuestionsPage() {
  const toast = useToast();
  const { can, loading: accessLoading } = useAdminPermissions();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Browse state
  const [stats, setStats] = useState<QuestionStats | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [examTypeFilter, setExamTypeFilter] = useState("all");
  const [explFilter, setExplFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null);
  const [questionEditForm, setQuestionEditForm] = useState<Record<string, unknown>>({});

  // Sub-tab state lives in the URL (UX-ADM-02): ?tab=browse|duplicates|reviews.
  const tabParam = searchParams.get("tab");
  const tab: SubTab = tabParam === "reviews" || tabParam === "duplicates" ? tabParam : "browse";
  const setTab = useCallback((next: SubTab) => {
    const params = new URLSearchParams();
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router]);
  const [duplicates, setDuplicates] = useState<DuplicateData | null>(null);
  const [pendingReports, setPendingReports] = useState<number | null>(null);
  const questionIdParam = searchParams.get("questionId");
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/stats/admin/questions${examTypeFilter === "all" ? "" : `?examType=${examTypeFilter}`}`);
      if (!res.ok) throw new Error("Failed to load question stats");
      setStats(await res.json());
      setReadErrors((current) => ({ ...current, stats: "" }));
      setUpdatedAt(Date.now());
    } catch (e) { setReadErrors((current) => ({ ...current, stats: (e as Error).message })); }
  }, [examTypeFilter]);

  const fetchQuestions = useCallback(
    async (p = 1, topic = "", q = "", hasExpl = "all", isActive = "all", examType = "all") => {
      try {
        const params = new URLSearchParams({ mode: "browse", page: String(p), limit: "25" });
        if (questionIdParam) params.set("questionId", questionIdParam);
        if (topic) params.set("topic", topic);
        if (q) params.set("search", q);
        if (hasExpl === "with") params.set("hasExplanation", "true");
        if (hasExpl === "without") params.set("hasExplanation", "false");
        if (isActive === "active") params.set("isActive", "true");
        if (isActive === "inactive") params.set("isActive", "false");
        if (examType && examType !== "all") params.set("examType", examType);
        const res = await fetch(`/api/stats/admin/questions?${params}`);
        if (!res.ok) throw new Error("Failed to load questions");
        const data = await res.json();
        setQuestions(data.questions || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
        setReadErrors((current) => ({ ...current, questions: "" }));
        setUpdatedAt(Date.now());
      } catch (e) { setReadErrors((current) => ({ ...current, questions: (e as Error).message })); }
    },
    [questionIdParam]
  );

  const fetchDuplicates = useCallback(async () => {
    try {
      const res = await fetch(`/api/stats/admin/duplicates${examTypeFilter === "all" ? "" : `?exam=${examTypeFilter}`}`);
      if (!res.ok) throw new Error("Failed");
      setDuplicates(await res.json());
      setReadErrors((current) => ({ ...current, duplicates: "" }));
    } catch (e) { setReadErrors((current) => ({ ...current, duplicates: (e as Error).message })); }
  }, [examTypeFilter]);
  // Duplicates follow the exam filter: a new filter invalidates the scan.
  useEffect(() => { setDuplicates(null); }, [examTypeFilter]);

  useEffect(() => {
    if (!accessLoading && can("content.read")) void fetchStats();
  }, [accessLoading, can, fetchStats]);
  useEffect(() => {
    if (!accessLoading && can("content.read")) void fetchQuestions(1);
  }, [accessLoading, can, fetchQuestions]);

  useEffect(() => {
    if (tab === "duplicates" && !duplicates) fetchDuplicates();
  }, [tab, duplicates, fetchDuplicates]);

  // Pending count for the Reviews tab badge, before the tab is opened.
  useEffect(() => {
    if (accessLoading || !can("content.read")) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/suggestions?status=pending&limit=1");
        const body = await res.json().catch(() => null);
        if (!cancelled && res.ok && typeof body?.counts?.pending === "number") setPendingReports(body.counts.pending);
      } catch { /* the badge is optional; the tab shows its own error */ }
    })();
    return () => { cancelled = true; };
  }, [accessLoading, can]);

  const handleSearch = () => {
    setPage(1);
    fetchQuestions(1, topicFilter, search, explFilter, activeFilter, examTypeFilter);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchQuestions(p, topicFilter, search, explFilter, activeFilter, examTypeFilter);
  };

  const handleEdit = async (questionId: number) => {
    if (!can("content.moderate")) return;
    const before = questions.find((q) => q.id === questionId);
    if (!before) return;
    const updates = changedQuestionFields(before as unknown as Record<string, unknown>, questionEditForm);
    if (updates.is_active === false && !window.confirm("Hide this question from learners?")) return;
    if (!Object.keys(updates).length) { setEditingQuestion(null); return; }
    try {
      const res = await fetch("/api/stats/admin/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, updates }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `Could not save question #${questionId} (HTTP ${res.status})`);
      }
      setEditingQuestion(null);
      fetchQuestions(page, topicFilter, search, explFilter, activeFilter, examTypeFilter);
      toast.success(`Question #${questionId} saved`);
    } catch (e) { toast.error((e as Error).message || `Could not save question #${questionId}`); }
  };

  const startEdit = (q: QuestionRow) => {
    if (!can("content.moderate")) return;
    setEditingQuestion(q.id);
    setExpandedQuestion(q.id);
    setQuestionEditForm({ explanation: q.explanation || "", topic: q.topic, is_active: q.is_active });
  };

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("content.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to view study content.</Alert></div>;

  return (
    <AdminPageShell
      title="Questions"
      description="Browse, edit, de-duplicate, and review user-flagged content."
      loadState={{ loading: !stats && !readErrors.stats, updatedAt, error: readErrors.stats || (tab === "browse" ? readErrors.questions : tab === "duplicates" ? readErrors.duplicates : undefined) }}
      onRefresh={() => {
        fetchStats();
        if (tab === "browse")
          fetchQuestions(page, topicFilter, search, explFilter, activeFilter, examTypeFilter);
        if (tab === "duplicates") fetchDuplicates();
      }}
    >
      {readErrors.stats && <Alert variant="error" title="Question metrics unavailable">{readErrors.stats} <button type="button" className="ml-3 underline" onClick={() => void fetchStats()}>Retry</button></Alert>}
      {readErrors.questions && tab === "browse" && <Alert variant="error" title="Questions could not be loaded">{readErrors.questions} <button type="button" className="ml-3 underline" onClick={() => void fetchQuestions(page, topicFilter, search, explFilter, activeFilter, examTypeFilter)}>Retry</button></Alert>}
      {readErrors.duplicates && tab === "duplicates" && <Alert variant="error" title="Duplicate scan unavailable">{readErrors.duplicates} <button type="button" className="ml-3 underline" onClick={() => void fetchDuplicates()}>Retry</button></Alert>}
      {/* Stats Cards — .mp-stat tight grid */}
      {stats && !readErrors.stats && (
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
            <span className="mp-stat__label">MCQ (Wien + Innsbruck)</span>
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
          onClick={() => setTab("browse")}
          className={`mp-tabs__tab ${tab === "browse" ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5`}
        >
          <FileText size={13} />Browse
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "duplicates"}
          onClick={() => setTab("duplicates")}
          className={`mp-tabs__tab ${tab === "duplicates" ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5`}
        >
          <AlertTriangle size={13} />Duplicates
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reviews"}
          onClick={() => setTab("reviews")}
          className={`mp-tabs__tab ${tab === "reviews" ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5`}
        >
          Reviews
          {pendingReports ? (
            <span className="ml-0.5 bg-[var(--mp-error)] text-white text-xs font-mono px-1.5 py-0.5 rounded-full" aria-label={`${pendingReports} pending`}>
              {pendingReports}
            </span>
          ) : null}
        </button>
      </div>

      {tab === "browse" && !readErrors.questions && (
        <>
          {/* Search + Filters — MPDS fields */}
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-[13px] text-[var(--mp-fg-subtle)] pointer-events-none z-[1]" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search question text..."
                aria-label="Search questions"
                className="mp-field__input w-full pl-10"
              />
            </div>
            <Select
              label="Filter by exam"
              hideLabel
              value={examTypeFilter}
              onChange={(e) => setExamTypeFilter(e.target.value)}
              options={[
                { value: "all", label: "All Exams" },
                { value: "kenntnispruefung", label: "Kenntnisprüfung" },
                { value: "kmp_innsbruck", label: "Stichprobentest (Innsbruck)" },
                { value: "pharma", label: "Pharma" },
              ]}
            />
            <Select
              label="Filter by topic"
              hideLabel
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              options={[
                { value: "", label: "All Topics" },
                ...(stats?.byTopic || []).map((t) => ({ value: t.topic, label: `${t.topic} (${t.count})` })),
              ]}
            />
            <Select
              label="Filter by explanation status"
              hideLabel
              value={explFilter}
              onChange={(e) => setExplFilter(e.target.value)}
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
              onChange={(e) => setActiveFilter(e.target.value)}
              options={[
                { value: "all", label: "All Status" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
            <button onClick={handleSearch} className="mp-btn mp-btn--primary flex items-center gap-2">
              <Filter size={14} /> Filter
            </button>
          </div>

          {/* Results count */}
          <p className="text-xs text-[var(--mp-fg-subtle)]">{total.toLocaleString()} questions found -- Page {page} of {totalPages}</p>

          {/* Questions Table */}
          <div className="card rounded-xl overflow-hidden">
            {questions.length === 0 ? (
              <div className="px-4 py-2">
                <EmptyState
                  tone="neutral"
                  icon={<FileText className="w-10 h-10" aria-hidden />}
                  title="No questions match these filters"
                  body="Try clearing a filter or adjusting your search."
                />
              </div>
            ) : (
              <ResponsiveTable
                label="Questions"
                testId="questions-table"
                minWidth={860}
                rows={questions}
                rowKey={(q) => q.id}
                onRowClick={(q) => setExpandedQuestion(q.id === expandedQuestion ? null : q.id)}
                rowClassName={(q) => `${expandedQuestion === q.id ? "bg-[var(--mp-viridian)]/5" : ""} ${!q.is_active ? "opacity-50" : ""}`}
                columns={[
                  { key: "id", header: "ID", card: "title", className: "font-mono text-xs text-[var(--mp-fg-subtle)]", cell: (q) => `#${q.id}` },
                  { key: "topic", header: "Topic", card: "meta", cell: (q) => (
                    <span className="text-[10px] bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] px-2 py-0.5 rounded font-medium truncate max-w-[160px] inline-block">
                      {q.topic?.slice(0, 20) || "---"}
                    </span>
                  ) },
                  { key: "question", header: "Question", className: "text-xs text-[var(--mp-fg-muted)] max-w-[300px] lg:truncate", cell: (q) => q.question_preview },
                  { key: "choices", header: "Choices", align: "center", className: "font-mono text-xs", cell: (q) => q.choices_count || "---" },
                  { key: "expl", header: "Expl", cardLabel: "Explanation", align: "center", cell: (q) => (q.has_explanation
                    ? <CheckCircle size={14} className="inline text-[var(--mp-viridian)]" aria-label="Has explanation" />
                    : <EyeOff size={14} className="inline text-[var(--mp-fg-subtle)]" aria-label="No explanation" />) },
                  { key: "img", header: "Img", cardLabel: "Image", align: "center", cell: (q) => (q.has_image
                    ? <Eye size={14} className="inline text-[var(--mp-cta-blue)]" aria-label="Has image" />
                    : <span className="text-[var(--mp-fg-subtle)] text-xs">---</span>) },
                  { key: "dates", header: "Exam Dates", className: "text-xs text-[var(--mp-fg-subtle)]", cell: (q) => (q.exam_dates?.length ? q.exam_dates.slice(0, 2).join(", ") + (q.exam_dates.length > 2 ? ` +${q.exam_dates.length - 2}` : "") : "---") },
                ]}
                actions={(q) => (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpandedQuestion(q.id === expandedQuestion ? null : q.id)}
                      aria-expanded={expandedQuestion === q.id}
                      className="mp-btn mp-btn--ghost mp-btn--sm lg:hidden"
                    >
                      {expandedQuestion === q.id ? "Hide details" : "Show details"}
                    </button>
                    {can("content.moderate") && (
                      <button
                        type="button"
                        onClick={() => startEdit(q)}
                        className="mp-btn mp-btn--secondary mp-btn--sm inline-flex items-center gap-1"
                        title={`Edit question #${q.id}`}
                      >
                        <Edit3 size={13} aria-hidden /> <span>Edit</span>
                      </button>
                    )}
                  </>
                )}
                expanded={(q) => (expandedQuestion === q.id ? (
                  <div className="px-1 py-2">
              {editingQuestion === q.id ? (
                <div className="space-y-3">
                  <h4 className="mp-caption text-[var(--mp-fg)]">Editing Question #{q.id}</h4>
                  <TextField
                    label="Topic"
                    value={(questionEditForm.topic as string) || ""}
                    onChange={(e) => setQuestionEditForm((prev) => ({ ...prev, topic: e.target.value }))}
                  />
                  <Textarea
                    label="Explanation"
                    rows={4}
                    value={(questionEditForm.explanation as string) || ""}
                    onChange={(e) => setQuestionEditForm((prev) => ({ ...prev, explanation: e.target.value }))}
                  />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!questionEditForm.is_active}
                        onChange={(e) => setQuestionEditForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                        className="accent-[var(--mp-viridian)]"
                      />
                      Active
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(q.id)} className="mp-btn mp-btn--primary mp-btn--sm">Save</button>
                    <button onClick={() => setEditingQuestion(null)} className="mp-btn mp-btn--secondary mp-btn--sm">Cancel</button>
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
                  </div>
                ) : null)}
              />
            )}
          </div>

          {/* Pagination — .mp-btn pills */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => handlePageChange(Math.max(1, page - 1))}
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
                    onClick={() => handlePageChange(p)}
                    className={`mp-btn ${p === page ? "mp-btn--success" : "mp-btn--secondary"} mp-btn--sm`}
                    style={{ minWidth: 32, padding: "6px 10px" }}
                    aria-current={p === page ? "page" : undefined}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
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

      {tab === "duplicates" && !readErrors.duplicates && (
        <div className="card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--mp-fg)]">Duplicate Detection</h3>
              <p className="text-xs text-[var(--mp-fg-subtle)]">
                {duplicates
                  ? `${duplicates.totalGroups} groups, ${duplicates.totalExtraCopies} extra copies across all active questions${examTypeFilter === "all" ? "" : " in this exam"}${duplicates.groups.length < duplicates.totalGroups ? ` (largest ${duplicates.groups.length} shown)` : ""}`
                  : "Scanning..."
                }
              </p>
            </div>
            <button onClick={fetchDuplicates} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
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
        <ReviewsQueue canModerate={can("content.moderate")} canReadUsers={can("users.read")} onCounts={setPendingReports} />
      )}
    </AdminPageShell>
  );
}
