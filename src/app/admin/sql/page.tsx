"use client";

/**
 * /admin/sql — SELECT-only SQL runner.
 *
 * §2.8 of the April 23 admin revamp sprint.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Save, TerminalSquare } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import {
  Alert,
  TextField,
  useToast,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

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
        toast.success("Saved + ran", `${saveName.trim()} · ${body.row_count} rows`);
        // Refresh the saved list.
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

  return (
    <AdminPageShell
      title="SQL runner"
      description="SELECT-only. Capped at 1000 rows. Every run is logged to admin_audit_log."
      freshness="cached"
      actions={
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5"
        >
          <Play size={12} />
          {running ? "Running…" : "Run (⌘↵)"}
        </button>
      }
    >
      <div
        data-admin-sql-panel
        className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3"
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
              className="w-full min-h-[220px] p-3 bg-transparent text-xs font-mono text-[var(--mp-fg)] outline-none resize-vertical tabular-nums"
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
            <Alert variant="error" title="Query failed">
              {error}
            </Alert>
          )}

          {result && (
            <ResultsTable result={result} />
          )}
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mb-2">
              Saved queries ({savedQueries.length})
            </div>
            {savedQueries.length === 0 ? (
              <p className="text-xs text-[var(--mp-fg-muted)]">
                None yet — save one via the field on the left.
              </p>
            ) : (
              <ul className="space-y-1">
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
            <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mb-2">
              History
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-[var(--mp-fg-muted)]">
                Your last 50 queries appear here (device-local).
              </p>
            ) : (
              <ul className="space-y-1">
                {history.slice(0, 8).map((q, idx) => (
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
            Results capped at 1000 rows.
            <br />
            Every query lands in <code>admin_audit_log</code>.
          </div>
        </aside>
      </div>
    </AdminPageShell>
  );
}

function ResultsTable({ result }: { result: RunResult }) {
  if (result.rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 text-xs text-[var(--mp-fg-muted)]">
        Query returned 0 rows · {result.duration_ms}ms
      </div>
    );
  }
  const columns = Object.keys(result.rows[0]);

  function exportCsv() {
    const header = columns.join(",");
    const body = result.rows
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

  return (
    <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--mp-border-subtle)] text-[11px] text-[var(--mp-fg-muted)]">
        <span>
          {result.row_count} rows · {result.duration_ms}ms ·
          {result.row_count >= result.capped_at && (
            <span className="text-amber-500"> capped at {result.capped_at}</span>
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
                  className="text-left px-3 py-1.5 font-mono whitespace-nowrap"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr
                key={i}
                className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
              >
                {columns.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-1.5 font-mono whitespace-nowrap max-w-[320px] truncate"
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
