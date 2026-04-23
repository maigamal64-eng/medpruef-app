"use client";

/**
 * /admin/sql — SELECT-only SQL runner.
 *
 * §2.8 of the April 23 admin revamp sprint.
 *
 * Polish pass (Apr 23):
 *   - Layout: saved-queries sidebar on the LEFT, textarea top-right,
 *     results beneath. Ctrl/Cmd+Enter runs.
 *   - Results table: CSV export + column sort + row count + capped
 *     indicator.
 *   - Error panel: red alert box + docs link mapping common Postgres
 *     errors to a human hint ("relation does not exist" → double-check
 *     schema / table name).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Play,
  Save,
  TerminalSquare,
  History,
  ChevronDown,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Alert, TextField, useToast } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { formatInt } from "../_components/primitives";

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  updated_at: string;
}

interface RunResult {
  rows: Array<Record<string, unknown>>;
  row_count: number;
  duration_ms: number;
  capped_at: number;
}

const STORAGE_HISTORY_KEY = "medpruef_admin_sql_history";

// Pattern-match common Postgres errors and give a short hint.
const ERROR_HINTS: Array<{
  pattern: RegExp;
  hint: string;
  docs?: string;
}> = [
  {
    pattern: /relation ".+" does not exist/i,
    hint: "Table or view not found. Check the name/schema spelling.",
    docs: "https://www.postgresql.org/docs/current/sql-select.html",
  },
  {
    pattern: /column ".+" does not exist/i,
    hint: "Column not found. Use the table name as a prefix (`users.email`) if ambiguous.",
    docs: "https://www.postgresql.org/docs/current/ddl-schemas.html",
  },
  {
    pattern: /syntax error at or near/i,
    hint: "Likely a typo or missing comma. Postgres tells you where — read the caret.",
    docs: "https://www.postgresql.org/docs/current/sql-syntax-lexical.html",
  },
  {
    pattern: /only select queries are permitted/i,
    hint: "The SQL runner is SELECT-only. Wrap writes in a migration instead.",
  },
  {
    pattern: /permission denied/i,
    hint: "RLS is blocking the query. The admin runner uses the service role — if this fires, something in the policy is off.",
    docs: "https://supabase.com/docs/guides/database/postgres/row-level-security",
  },
  {
    pattern: /division by zero/i,
    hint: "Guard with NULLIF(denominator, 0) to fall back to NULL.",
  },
];

export default function AdminSqlPage() {
  const toast = useToast();
  const [sql, setSql] = useState(
    "-- SELECT-only runner — capped at 1000 rows.\nselect id, email, tier, created_at\nfrom users\norder by created_at desc\nlimit 50"
  );
  const [saveName, setSaveName] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load saved queries + local history.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/sql");
        if (res.ok) {
          const data = await res.json();
          setSavedQueries(data.items || []);
        }
      } catch {
        /* not fatal */
      }
    })();
    try {
      const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
      setHistory(raw ? JSON.parse(raw) : []);
    } catch {
      /* not fatal */
    }
  }, []);

  const pushHistory = useCallback((q: string) => {
    setHistory((prev) => {
      const next = [q, ...prev.filter((p) => p !== q)].slice(0, 50);
      try {
        localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    if (!sql.trim() || running) return;
    setRunning(true);
    setError(null);
    setSortCol(null);
    setSortDesc(false);
    try {
      const res = await fetch("/api/admin/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql,
          save_as: saveName.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setResult(body as RunResult);
      pushHistory(sql);
      if (saveName.trim()) {
        toast.success(
          "Saved + ran",
          `${saveName.trim()} · ${body.row_count} rows`
        );
        const listRes = await fetch("/api/admin/sql");
        if (listRes.ok) {
          setSavedQueries((await listRes.json()).items || []);
        }
        setSaveName("");
      } else {
        toast.success("Query ran", `${body.row_count} rows · ${body.duration_ms}ms`);
      }
    } catch (e) {
      setError((e as Error).message || "Query failed");
    } finally {
      setRunning(false);
    }
  }, [sql, saveName, running, pushHistory, toast]);

  // Ctrl/Cmd+Enter to run.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const active = document.activeElement;
        if (
          active &&
          (active === textareaRef.current ||
            active.closest?.("[data-admin-sql-panel]"))
        ) {
          e.preventDefault();
          run();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  const matchedHint = useMemo(() => {
    if (!error) return null;
    return ERROR_HINTS.find((h) => h.pattern.test(error)) ?? null;
  }, [error]);

  return (
    <AdminPageShell
      title="SQL runner"
      description="SELECT-only · capped at 1,000 rows · every run audit-logged. Ctrl/⌘ + Enter to run."
      freshness="cached"
      actions={
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5"
        >
          <Play size={12} />
          {running ? "Running…" : "Run"}
          <kbd className="font-mono text-[9px] px-1 py-0.5 rounded bg-white/20 ml-1">
            ⌘↵
          </kbd>
        </button>
      }
    >
      <div
        data-admin-sql-panel
        className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3"
      >
        {/* ─── LEFT sidebar: saved queries + history ──────────────── */}
        <aside className="space-y-3 order-2 lg:order-1">
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] flex items-center gap-1.5">
                <Save size={11} /> Saved queries
              </span>
              <span className="text-[10px] text-[var(--mp-fg-subtle)] tabular-nums">
                {formatInt(savedQueries.length)}
              </span>
            </div>
            {savedQueries.length === 0 ? (
              <p className="text-xs text-[var(--mp-fg-muted)]">
                None yet — save one via the Save field.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {savedQueries.map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => setSql(q.sql)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[var(--mp-surface-sunken)] font-mono truncate text-[var(--mp-fg)]"
                      title={q.sql}
                    >
                      {q.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] flex items-center gap-1.5">
                <History size={11} /> History
              </span>
              <span className="text-[10px] text-[var(--mp-fg-subtle)] tabular-nums">
                {formatInt(history.length)}
              </span>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-[var(--mp-fg-muted)]">
                Your last 50 queries appear here (device-local).
              </p>
            ) : (
              <ul className="space-y-0.5 max-h-[320px] overflow-y-auto">
                {history.slice(0, 16).map((q, idx) => (
                  <li key={`${idx}-${q.slice(0, 24)}`}>
                    <button
                      type="button"
                      onClick={() => setSql(q)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-[var(--mp-surface-sunken)] font-mono truncate text-[var(--mp-fg)]"
                      title={q}
                    >
                      {q.slice(0, 40)}…
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-[11px] text-[var(--mp-fg-muted)]">
            <div className="flex items-center gap-2 mb-1 text-[var(--mp-fg)]">
              <TerminalSquare size={12} />
              <span className="font-semibold">Rules</span>
            </div>
            Only <code>SELECT</code> (or <code>WITH … SELECT</code>) is allowed.
            <br />
            Results capped at 1,000 rows.
            <br />
            Every query lands in <code>admin_audit_log</code>.
          </div>
        </aside>

        {/* ─── RIGHT: editor + results ───────────────────────────── */}
        <div className="space-y-3 order-1 lg:order-2">
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--mp-border-subtle)] text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
              <span>Query</span>
              <span className="font-mono text-[var(--mp-fg-subtle)] normal-case">
                Ctrl/⌘ + ↵ to run
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
              className="w-full min-h-[240px] p-3 bg-transparent text-xs font-mono text-[var(--mp-fg)] outline-none resize-vertical tabular-nums"
              placeholder="select …"
            />
          </div>
          <div className="flex items-end gap-2">
            <TextField
              label="Save as (optional)"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. active_pro_users"
              helper="Save this query under your account (owner_id = you)."
            />
            <button
              type="button"
              onClick={run}
              disabled={running || !saveName.trim()}
              className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5 mb-[1px]"
            >
              <Save size={12} />
              Save + run
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-[var(--mp-error)] text-xs font-semibold">
                  Query failed
                </span>
              </div>
              <pre className="text-[11px] font-mono text-[var(--mp-error)] whitespace-pre-wrap break-words m-0">
                {error}
              </pre>
              {matchedHint && (
                <div className="mt-2 pt-2 border-t border-[var(--mp-error)]/20 text-[11px] text-[var(--mp-fg-muted)] flex items-start gap-2">
                  <BookOpen size={12} className="mt-0.5 flex-shrink-0" />
                  <span className="flex-1">{matchedHint.hint}</span>
                  {matchedHint.docs && (
                    <a
                      href={matchedHint.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--mp-cta-blue)] hover:underline"
                    >
                      Docs →
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {result && (
            <ResultsTable
              result={result}
              sortCol={sortCol}
              sortDesc={sortDesc}
              onSort={(c) => {
                if (sortCol === c) setSortDesc((v) => !v);
                else {
                  setSortCol(c);
                  setSortDesc(false);
                }
              }}
            />
          )}

          {!result && !error && !running && (
            <Alert variant="info" title="Ready">
              Write a SELECT above and hit <kbd>Ctrl/⌘</kbd>+<kbd>↵</kbd> to run.
              Results appear here and stream into <code>admin_audit_log</code>.
            </Alert>
          )}
        </div>
      </div>
    </AdminPageShell>
  );
}

function ResultsTable({
  result,
  sortCol,
  sortDesc,
  onSort,
}: {
  result: RunResult;
  sortCol: string | null;
  sortDesc: boolean;
  onSort: (col: string) => void;
}) {
  const columns = useMemo(
    () => (result.rows[0] ? Object.keys(result.rows[0]) : []),
    [result.rows]
  );

  const sortedRows = useMemo(() => {
    if (!sortCol) return result.rows;
    const copy = [...result.rows];
    copy.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDesc ? bv - av : av - bv;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDesc ? bs.localeCompare(as) : as.localeCompare(bs);
    });
    return copy;
  }, [result.rows, sortCol, sortDesc]);

  function exportCsv() {
    const header = columns.join(",");
    const body = sortedRows
      .map((r) =>
        columns
          .map((c) => {
            const v = r[c];
            if (v == null) return "";
            const s = typeof v === "object" ? JSON.stringify(v) : String(v);
            const q = s.replace(/"/g, '""');
            return /[,"\n]/.test(q) ? `"${q}"` : q;
          })
          .join(",")
      )
      .join("\n");
    const csv = `${header}\n${body}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `medpruef-sql-${new Date().toISOString().slice(0, 19)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (result.rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 text-xs text-[var(--mp-fg-muted)]">
        Query returned 0 rows · {result.duration_ms}ms
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--mp-border-subtle)] text-[11px] text-[var(--mp-fg-muted)]">
        <span>
          <strong className="text-[var(--mp-fg)] tabular-nums">
            {formatInt(result.row_count)}
          </strong>{" "}
          rows ·{" "}
          <span className="tabular-nums">
            {formatInt(result.duration_ms)}ms
          </span>
          {result.row_count >= result.capped_at && (
            <span className="text-amber-500">
              {" "}· capped at {formatInt(result.capped_at)}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={exportCsv}
          className="mp-btn mp-btn--secondary mp-btn--sm"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider sticky top-0">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="text-left px-3 py-1.5 font-mono whitespace-nowrap cursor-pointer hover:text-[var(--mp-fg)]"
                  onClick={() => onSort(c)}
                >
                  <span className="inline-flex items-center gap-1">
                    {c}
                    {sortCol === c && (
                      <ChevronDown
                        size={10}
                        className={`transition-transform ${sortDesc ? "rotate-180" : ""}`}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, i) => (
              <tr
                key={i}
                className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
              >
                {columns.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-1.5 font-mono whitespace-nowrap max-w-[320px] truncate tabular-nums"
                  >
                    {formatCell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
