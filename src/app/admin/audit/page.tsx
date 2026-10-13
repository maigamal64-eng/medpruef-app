"use client";

/**
 * /admin/audit: who changed what, and why (ADM-15 A, UX-ADM-34, UX-ADM-21).
 *
 * Filters live in the URL: People and access, Content, System, Ops
 * decisions; a learner id; an actor email; an exact action. Each row
 * expands to its full payload, targets link to the learner, and the footer
 * says how many rows exist instead of cutting at 200. Older rows load on
 * request. Direct database writes are not in this log (fleet rule,
 * pick-admin-15: agents use the admin API, the Ops lane or a named guarded
 * changeset).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { FilterChip } from "../_components/primitives";
import { ListFooter } from "../_components/ListFooter";
import { ResponsiveTable } from "../_components/ResponsiveTable";
import { UserLink } from "../_components/UserLink";
import { ADMIN_POLL_MS } from "../_components/freshness";
import { AUDIT_BASIS, AUDIT_CATEGORY_LABELS, type AuditCategory } from "@/lib/admin/learner-history";

interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  category: AuditCategory;
}

interface OpsRow {
  id: number;
  at: string;
  event: string;
  operation: string;
  status: string;
  actor_email: string | null;
  principal: string | null;
  user_id: string | null;
  feedback_id: string | null;
  days: string | null;
  decision: string | null;
  reason: string | null;
}

type Category = AuditCategory | "all" | "ops";
const CATEGORIES: Category[] = ["all", "people", "content", "system", "ops"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function when(iso: string) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" })
    : iso;
}

function learnerOf(r: AuditRow): string | null {
  if (r.target_type === "user" && r.target_id) return r.target_id;
  const u = r.payload?.user_id;
  return typeof u === "string" && UUID_RE.test(u) ? u : null;
}

export default function AdminAuditPage() {
  return <AdminPermissionGate permission="system.read"><AdminAuditPageContent /></AdminPermissionGate>;
}

function AdminAuditPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawCategory = searchParams.get("category") as Category | null;
  const category: Category = rawCategory && CATEGORIES.includes(rawCategory) ? rawCategory : "all";
  const learnerParam = searchParams.get("learner") ?? "";
  const learner = UUID_RE.test(learnerParam) ? learnerParam : "";
  const actor = searchParams.get("actor") ?? "";
  const action = searchParams.get("action") ?? "";

  const [items, setItems] = useState<AuditRow[]>([]);
  const [ops, setOps] = useState<OpsRow[]>([]);
  const [opsAvailable, setOpsAvailable] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [scanned, setScanned] = useState(0);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ learner: learnerParam, actor, action });
  useEffect(() => setDraft({ learner: learnerParam, actor, action }), [learnerParam, actor, action]);

  const updateUrl = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all") params.delete(key); else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `/admin/audit?${qs}` : "/admin/audit", { scroll: false });
  }, [router, searchParams]);

  const query = useCallback((before: string | null) => {
    const params = new URLSearchParams({ category, limit: "50" });
    if (learner) params.set("learner", learner);
    if (actor && category !== "ops") params.set("actor", actor);
    if (action && category !== "ops") params.set("action", action);
    if (before) params.set("before", before);
    return `/api/admin/audit?${params}`;
  }, [action, actor, category, learner]);

  const seq = useRef(0);
  const [paged, setPaged] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // silent: the 60 s poll refreshes the first page without blanking the list.
  const load = useCallback(async (before: string | null = null, silent = false) => {
    const mine = ++seq.current;
    if (before) setLoadingMore(true); else if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(query(before));
      const body = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      if (!res.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error || `Could not load the audit log (HTTP ${res.status})`);
      if (category === "ops") {
        setOpsAvailable(body.available !== false);
        setOps((current) => (before ? [...current, ...body.items] : body.items));
        setItems([]);
      } else {
        setItems((current) => (before ? [...current, ...body.items] : body.items));
        setOps([]);
      }
      if (!before) setTotal(typeof body.total === "number" ? body.total : null);
      setPaged(Boolean(before));
      if (!before) setUpdatedAt(Date.now());
      setScanned((current) => (before ? current + body.scanned : body.scanned));
      setNextBefore(body.next_before ?? null);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message || "Could not load the audit log");
    } finally {
      if (mine === seq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [category, query]);

  useEffect(() => {
    void load(null);
  }, [load]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrl({ learner: draft.learner.trim(), actor: draft.actor.trim(), action: draft.action.trim() });
  };
  const filtered = Boolean(learner || actor || action);
  const shown = category === "ops" ? ops.length : items.length;
  const learnerInvalid = draft.learner.trim() !== "" && !UUID_RE.test(draft.learner.trim());

  return (
    <AdminPageShell
      title="Audit log"
      description="Who changed what, when and why. Admin API actions and Ops decisions."
      loadState={{ loading, error, updatedAt }}
      // ADM-20 A: polled every 60 s while visible; paused once older rows are loaded so the poll never drops them.
      pollMs={paged ? undefined : ADMIN_POLL_MS}
      autoRefresh={!paged}
      onRefresh={() => void load(null, !paged)}
    >
      <div className="space-y-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Category">
          {CATEGORIES.map((c) => (
            <FilterChip key={c} active={category === c} onClick={() => updateUrl({ category: c })}>
              {c === "all" ? "All" : c === "ops" ? "Ops decisions" : AUDIT_CATEGORY_LABELS[c]}
            </FilterChip>
          ))}
        </div>
        <form onSubmit={applyFilters} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="text-[11px] text-[var(--mp-fg-muted)]">
            Learner id
            <input
              value={draft.learner}
              onChange={(e) => setDraft((d) => ({ ...d, learner: e.target.value }))}
              placeholder="Learner UUID"
              aria-invalid={learnerInvalid}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-2 font-mono text-xs text-[var(--mp-fg)]"
            />
          </label>
          <label className="text-[11px] text-[var(--mp-fg-muted)]">
            Actor email
            <input
              value={draft.actor}
              onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
              placeholder="user-b7e46e80@example.com"
              disabled={category === "ops"}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-2 text-xs text-[var(--mp-fg)]"
            />
          </label>
          <label className="text-[11px] text-[var(--mp-fg-muted)]">
            Action
            <input
              value={draft.action}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
              placeholder="grant_free_access"
              disabled={category === "ops"}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-2 font-mono text-xs text-[var(--mp-fg)] disabled:opacity-50"
            />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={learnerInvalid} className="mp-btn mp-btn--primary mp-btn--sm min-h-9">Apply</button>
            {filtered && (
              <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm min-h-9" onClick={() => updateUrl({ learner: "", actor: "", action: "" })}>
                Clear
              </button>
            )}
          </div>
        </form>
        {learnerInvalid && <p className="text-[11px] text-[var(--mp-error)]">A learner id is a full UUID; copy it from the learner page.</p>}
        {learner && (
          <p className="text-[11px] text-[var(--mp-fg-muted)]">
            Learner: <UserLink id={learner} />
          </p>
        )}
        <p className="text-[10px] text-[var(--mp-fg-subtle)]">{AUDIT_BASIS}</p>
      </div>

      {error && (
        <Alert variant="error" title="Failed to load">
          {error} <button type="button" className="ml-3 underline" onClick={() => void load(null)}>Retry</button>
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading audit log…" />
        </div>
      ) : error && shown === 0 ? null : category === "ops" && !opsAvailable ? (
        <EmptyState
          tone="neutral"
          icon={<BarChart3 className="w-10 h-10" aria-hidden />}
          title="Ops decisions not readable yet"
          body="Ops approvals, rejections and executions appear here after the a16 database changeset is applied."
        />
      ) : shown === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<BarChart3 className="w-10 h-10" aria-hidden />}
          title={filtered || category !== "all" ? "No matching rows" : "Audit log empty"}
          body={filtered || category !== "all" ? "Try a broader filter." : "Admin mutations will appear here from the moment they fire."}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
          {category === "ops" ? (
            <ResponsiveTable
              label="Ops decisions"
              testId="audit-ops-table"
              rows={ops}
              rowKey={(o) => o.id}
              columns={[
                { key: "when", header: "When", card: "meta", className: "whitespace-nowrap font-mono text-[10px] text-[var(--mp-fg-muted)]", cell: (o) => when(o.at) },
                { key: "decision", header: "Decision", card: "title", className: "font-mono", cell: (o) => o.event.replace("action.", "") },
                { key: "operation", header: "Operation", className: "font-mono", cell: (o) => `${o.operation}${o.days ? ` · ${o.days} days` : ""}${o.decision ? ` · ${o.decision}` : ""}` },
                { key: "by", header: "By", className: "text-[var(--mp-fg-muted)]", cell: (o) => o.actor_email ?? (o.principal ? `Ops agent ${o.principal}` : "Ops agent") },
                { key: "target", header: "Target", cell: (o) => (o.user_id ? <UserLink id={o.user_id} /> : o.feedback_id ? `Feedback #${o.feedback_id}` : "--") },
                { key: "reason", header: "Reason", className: "text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]", cell: (o) => o.reason ?? "--" },
              ]}
            />
          ) : (
            <ResponsiveTable
              label="Audit rows"
              testId="audit-table"
              rows={items}
              rowKey={(r) => r.id}
              columns={[
                { key: "when", header: "When", card: "meta", className: "whitespace-nowrap font-mono text-[10px] text-[var(--mp-fg-muted)]", cell: (r) => when(r.created_at) },
                { key: "action", header: "Action", card: "title", cell: (r) => (
                  <>
                    <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => updateUrl({ action: r.action })} title="Filter by this action">
                      {r.action}
                    </button>
                    <span className="ml-1 text-[10px] font-normal text-[var(--mp-fg-subtle)]">{AUDIT_CATEGORY_LABELS[r.category]}</span>
                  </>
                ) },
                { key: "actor", header: "Actor", className: "text-[var(--mp-fg-muted)]", cell: (r) => r.actor_email ?? "--" },
                { key: "target", header: "Target", className: "text-[10px]", cell: (r) => {
                  const learnerId = learnerOf(r);
                  return learnerId ? <UserLink id={learnerId} /> : r.target_type && r.target_id ? (
                    <span className="font-mono [overflow-wrap:anywhere]">{r.target_type}:{r.target_id}</span>
                  ) : r.target_type ?? "--";
                } },
                { key: "reason", header: "Reason", className: "max-w-[260px] text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]", cell: (r) => {
                  const reason = r.payload?.reason ?? r.payload?.note;
                  return typeof reason === "string" && reason ? reason : "--";
                } },
              ]}
              actionsHeader="Payload"
              actions={(r) => (r.payload && Object.keys(r.payload).length > 0 ? (
                <button
                  type="button"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  aria-expanded={open === r.id}
                  className="mp-btn mp-btn--ghost mp-btn--sm inline-flex items-center gap-1 text-[11px]"
                >
                  Payload {open === r.id ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />}
                </button>
              ) : null)}
              expanded={(r) => (open === r.id ? (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--mp-fg)]">{JSON.stringify(r.payload, null, 2)}</pre>
              ) : null)}
            />
          )}
          <ListFooter
            shown={shown}
            total={category === "all" || category === "ops" ? total : null}
            noun={category === "ops" ? "Ops decisions" : "audit rows"}
            note={category !== "all" && category !== "ops" ? `${scanned.toLocaleString("en-GB")} of ${total?.toLocaleString("en-GB") ?? "?"} rows scanned for this category.` : null}
          />
          {nextBefore && (
            <div className="border-t border-[var(--mp-border-subtle)] p-2 text-center">
              <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" disabled={loadingMore} onClick={() => void load(nextBefore)}>
                {loadingMore ? "Loading…" : "Load older rows"}
              </button>
            </div>
          )}
        </div>
      )}
    </AdminPageShell>
  );
}
