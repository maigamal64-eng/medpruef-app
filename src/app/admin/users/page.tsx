"use client";

/**
 * Admin / Users tab.
 *
 * Searchable, server-paginated user directory with per-user detail rows.
 * Profile and entitlement actions are permission-gated and audited by their APIs.
 *
 * Polish pass (Apr 23):
 *   - AdminPageShell title + freshness badge
 *   - Filter chips for tier + auth method
 *   - Quick actions consolidated into a kebab menu (⋮)
 *   - Sticky search row (scrolls-with-table-head)
 *   - Skeleton rows instead of a full-page spinner
 */

import { readUsersUrl } from "@/lib/admin/users-url";
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  ChevronDown,
  Edit3,
  Gift,
  RotateCcw,
  Search,
  Users as UsersIcon,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import {
  Dialog,
  DialogFooter,
  useToast,
  TextField,
  EmptyState,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  FilterChip,
  KebabMenu,
  RowSkeleton,
  StatusDot,
  formatInt,
} from "../_components/primitives";
import { formatDate, formatTime, timeAgo } from "../_components/helpers";
import type { UserRow } from "../_components/types";
import { UserQuickActions } from "../_components/UserQuickActions";

type TierFilter = "all" | "free" | "pro" | "admin";
type AuthFilter = "all" | "email" | "telegram";
type UsersResponse = { items: UserRow[]; total: number; page: number; limit: number; totalPages: number };
const PAGE_SIZE = 25;

export default function AdminUsersPage() {
  const toast = useToast();
  const router = useRouter();
  const { can, loading: accessLoading } = useAdminPermissions();
  const canRead = can("users.read");
  const canReadRevenue = can("revenue.read");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const urlState = readUsersUrl(new URLSearchParams(searchParams.toString()));
  const query = urlState.query;
  const page = urlState.page;
  const tierFilter = urlState.tier as TierFilter;
  const authFilter = urlState.auth as AuthFilter;
  const sort = urlState.sort;
  const [search, setSearch] = useState(query);
  useEffect(() => { setSearch(query); }, [query]);
  const updateUrl = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all") params.delete(key); else params.set(key, value);
    }
    router.replace(`/admin/users?${params}`, { scroll: false });
  }, [router, searchParams]);
  const setPage = (value: number | ((current: number) => number)) => updateUrl({ page: String(typeof value === "function" ? value(page) : value) });
  const setTierFilter = (value: TierFilter) => updateUrl({ tier: value, page: "1" });
  const setAuthFilter = (value: AuthFilter) => updateUrl({ auth: value, page: "1" });
  const setSort = (value: (current: typeof sort) => typeof sort) => { const next = value(sort); updateUrl({ sort: next.col, order: next.asc ? "asc" : "desc", page: "1" }); };
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = search.trim();
      const next = trimmed.length >= 2 ? trimmed : "";
      if (next !== query) updateUrl({ q: next, page: "1" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, query, updateUrl]);

  const fetchUsers = useCallback(async () => {
    if (!can("users.read")) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort: !canReadRevenue && sort.col === "tier" ? "last_active" : sort.col,
        order: sort.asc ? "asc" : "desc",
      });
      if (query) params.set("q", query);
      if (canReadRevenue && tierFilter !== "all") params.set("tier", tierFilter);
      if (authFilter !== "all") params.set("auth", authFilter);
      const res = await fetch(`/api/stats/admin/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load users");
      const data = (await res.json()) as UsersResponse;
      setUsers(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authFilter, can, canReadRevenue, page, query, sort.col, sort.asc, tierFilter]);

  useEffect(() => {
    if (accessLoading) return;
    if (canRead) void fetchUsers();
    else setLoading(false);
  }, [accessLoading, canRead, fetchUsers]);

  // ── Actions ─────────────────────────────────────────────────────
  const handleEdit = async (userId: string) => {
    if (!can("users.write")) return;
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
    } catch {
      toast.error("Failed to update user");
    }
  };

  const handleResetGamification = async (userId: string) => {
    if (!can("users.write")) return;
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          updates: { reset_gamification: true },
        }),
      });
      if (!res.ok) throw new Error("Failed");
      await fetchUsers();
      setResetTarget(null);
      toast.success("Gamification reset");
    } catch {
      toast.error("Failed to reset gamification");
    }
  };

  const startEdit = (u: UserRow) => {
    setEditingUser(u.id);
    setExpandedUser(u.id);
    setEditForm({
      first_name: u.first_name || "",
      last_name: u.last_name || "",
      email: u.email || "",
    });
  };

  return (
    <AdminPageShell
      title="Users"
      description={loading && users.length === 0 ? "Loading user directory…" : error ? (users.length ? `Showing a saved snapshot of ${formatInt(users.length)} users. The latest request failed.` : "User directory unavailable. Retry the request.") : `Showing ${formatInt(users.length)} of ${formatInt(total)} matching users`}
      freshness={error ? (users.length ? "cached" : "disconnected") : loading ? "cached" : "live"}
      onRefresh={fetchUsers}
    >
      {!accessLoading && !canRead && (
        <div role="alert" className="rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] px-4 py-3 text-sm text-[var(--mp-error)]">
          You do not have permission to view user records.
        </div>
      )}
      {error && (
        <div
          className="bg-[var(--mp-error-bg)] border border-[var(--mp-error)]/25 text-[var(--mp-error)] text-sm rounded-xl px-4 py-3 flex items-center gap-2"
          role="alert"
        >
          <AlertTriangle size={16} />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => void fetchUsers()}
            className="mp-btn mp-btn--ghost mp-btn--sm"
            aria-label="Retry loading users"
            disabled={loading}
          >
            Retry
          </button>
        </div>
      )}

      {accessLoading && (
        <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">
          Checking your admin access…
        </div>
      )}

      {canRead && <>
      {/* Sticky filter row */}
      <div className="sticky top-[52px] z-20 -mx-3 sm:-mx-6 px-3 sm:px-6 py-3 bg-[var(--mp-surface-sunken)]/90 backdrop-blur border-b border-[var(--mp-border-subtle)]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-full max-w-[440px] min-w-0 flex-none sm:flex-1 sm:min-w-[240px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mp-fg-subtle)] pointer-events-none"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, username, or ID"
              aria-label="Search users"
              className="w-full pl-9 pr-3 h-9 rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] text-sm text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]/40"
            />
            {search.trim().length === 1 && (
              <p className="mt-1 text-[10px] text-[var(--mp-fg-muted)]">Enter at least 2 characters to search. Showing the unfiltered directory until then.</p>
            )}
          </div>

          {canReadRevenue && <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mr-1">
              Tier
            </span>
            {(["all", "free", "pro", "admin"] as TierFilter[]).map((t) => (
              <FilterChip
                key={t}
                active={tierFilter === t}
                onClick={() => { setTierFilter(t); }}
              >
                {t === "all" ? "All" : t}
              </FilterChip>
            ))}
          </div>}

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mr-1">
              Auth
            </span>
            {(["all", "email", "telegram"] as AuthFilter[]).map((a) => (
              <FilterChip
                key={a}
                active={authFilter === a}
                onClick={() => { setAuthFilter(a); }}
              >
                {a === "all" ? "All" : a === "email" ? "Email" : "Telegram"}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => { if (!open) setResetTarget(null); }}
        title="Reset learner progress counters?"
        description={resetTarget ? `This resets XP, streak, and answered-question counters for ${resetTarget.name}.` : undefined}
        footer={(
          <DialogFooter>
            <button type="button" className="mp-btn mp-btn--secondary" onClick={() => setResetTarget(null)}>Cancel</button>
            <button type="button" className="mp-btn mp-btn--destructive" disabled={!resetTarget || !can("users.write")} onClick={() => resetTarget && void handleResetGamification(resetTarget.id)}>Reset counters</button>
          </DialogFooter>
        )}
      >
        <p className="text-sm text-[var(--mp-fg-muted)]">This is an irreversible support operation. It does not erase answer history or subscription records.</p>
      </Dialog>

      {/* User Table */}
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
        <div className="hidden lg:block">
        <div className="flex items-center gap-1.5 border-b border-[var(--mp-border-subtle)] px-3 py-2 text-xs text-[var(--mp-fg-muted)] lg:hidden">
          <ArrowLeftRight size={14} aria-hidden="true" />
          <span>Scroll horizontally to see all columns</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead>
              <tr className="bg-[var(--mp-surface-sunken)] border-b border-[var(--mp-border-subtle)] text-[10px] uppercase tracking-wider">
                {(
                  [
                    { key: "name", label: "User", align: "left" },
                    { key: "auth", label: "Auth", align: "left" },
                    ...(canReadRevenue ? [{ key: "tier", label: "Tier", align: "left" as const }] : []),
                    { key: "status", label: "Status", align: "left" },
                    { key: "xp", label: "XP", align: "right" },
                    { key: "streak", label: "Streak", align: "right" },
                    {
                      key: "questions_answered",
                      label: "Questions",
                      align: "right",
                    },
                    {
                      key: "accuracy",
                      label: "Accuracy",
                      align: "right",
                    },
                    {
                      key: "last_active",
                      label: "Last Active",
                      align: "right",
                    },
                    { key: "created_at", label: "Joined", align: "right" },
                    { key: "actions", label: "", align: "center" },
                  ] as Array<{
                    key: string;
                    label: string;
                    align: "left" | "right" | "center";
                  }>
                ).filter((col) => col.key !== "tier" || canReadRevenue).map((col) => (
                  <th
                    key={col.key}
                    aria-sort={sort.col === col.key ? (sort.asc ? "ascending" : "descending") : "none"}
                    className={`px-3 py-2.5 text-[var(--mp-fg-muted)] font-medium whitespace-nowrap ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {col.key === "auth" || col.key === "actions" ? col.label : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-[var(--mp-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--mp-viridian)]"
                        onClick={() => {
                          setSort((prev) => ({ col: col.key, asc: prev.col === col.key ? !prev.asc : false }));
                        }}
                      >
                        {col.label}
                        {sort.col === col.key && (
                          <ChevronDown size={10} className={`transition-transform ${sort.asc ? "rotate-180" : ""}`} aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <RowSkeleton key={i} cols={canReadRevenue ? 11 : 10} />
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={canReadRevenue ? 11 : 10} className="px-4 py-8">
                    {error ? (
                      <p className="text-center text-sm text-[var(--mp-fg-muted)]">The user directory could not be loaded. Retry the request before treating this as an empty result.</p>
                    ) : (
                      <EmptyState
                        tone="neutral"
                        icon={<UsersIcon className="w-10 h-10" aria-hidden />}
                        title={
                          query || tierFilter !== "all" || authFilter !== "all"
                            ? "No users match your filters"
                            : "No users yet"
                        }
                        body={
                          query || tierFilter !== "all" || authFilter !== "all"
                            ? "Try a broader filter, or clear the search."
                            : "Users will appear here as they register."
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <Fragment key={u.id}>
                    <tr
                      className={`border-b border-[var(--mp-border-subtle)]/50 transition-colors ${
                        expandedUser === u.id
                          ? "bg-[var(--mp-viridian)]/5"
                          : "hover:bg-[var(--mp-surface-sunken)]"
                      }`}
                    >
                      {/* Avatar + Name */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {u.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={u.photo_url}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 flex items-center justify-center text-xs font-bold text-[var(--mp-viridian)]">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                          <Link
                            href={`/admin/users/${u.id}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Open full profile"
                            className="font-medium text-[var(--mp-fg)] truncate max-w-[160px] hover:text-[var(--mp-viridian)] hover:underline"
                          >
                            {u.name}
                          </Link>
                          <p className="text-xs text-[var(--mp-fg-muted)] truncate max-w-[220px]">{u.email || (u.username ? `@${u.username}` : "")}</p>
                          </div>
                        </div>
                      </td>
                      {/* Auth Badges */}
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          {u.telegram_id && (
                            <span className="text-[9px] bg-[#229ED9]/10 text-[#229ED9] px-1.5 py-0.5 rounded font-semibold">
                              TG
                            </span>
                          )}
                          {u.email && (
                            <span className="text-[9px] bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] px-1.5 py-0.5 rounded font-semibold">
                              Email
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Entitlements are visible only to revenue readers. */}
                      {canReadRevenue && <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          (u.tier || "free") === "pro"
                            ? "border-[var(--mp-status-warning)] text-[var(--mp-status-warning)] bg-[var(--mp-status-warning)]/5"
                            : (u.tier || "free") === "admin"
                              ? "border-[var(--mp-error)] text-[var(--mp-error)] bg-[var(--mp-error)]/5"
                              : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)] bg-[var(--mp-surface-raised)]"
                        }`}>
                          {u.tier || "free"}
                        </span>
                      </td>}
                      {/* Status */}
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot
                            tone={
                              u.status === "active"
                                ? "success"
                                : u.status === "recent"
                                  ? "warn"
                                  : "neutral"
                            }
                            size={6}
                          />
                          <span className="text-[10px] font-medium text-[var(--mp-fg-muted)]">
                            {u.status}
                          </span>
                        </span>
                      </td>
                      {/* XP */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--mp-status-warning)] text-xs">
                        {formatInt(u.xp)}
                      </td>
                      {/* Streak */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">
                        {u.streak > 0 ? `${u.streak}d` : "—"}
                      </td>
                      {/* Questions */}
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">
                        {formatInt(u.questions_answered)}
                      </td>
                      {/* Accuracy */}
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`font-mono tabular-nums text-xs ${
                            u.accuracy >= 70
                              ? "text-[var(--mp-viridian)]"
                              : u.accuracy >= 40
                                ? "text-[var(--mp-status-warning)]"
                                : "text-[var(--mp-error)]"
                          }`}
                        >
                          {u.accuracy > 0 ? `${u.accuracy}%` : "—"}
                        </span>
                      </td>
                      {/* Last Active */}
                      <td className="px-3 py-2.5 text-right text-[var(--mp-fg-subtle)] text-xs whitespace-nowrap">
                        {timeAgo(u.last_active)}
                      </td>
                      {/* Joined */}
                      <td className="px-3 py-2.5 text-right text-[var(--mp-fg-subtle)] text-xs whitespace-nowrap">
                        {formatDate(u.created_at)}
                      </td>
                      {/* Actions kebab */}
                      <td
                        className="px-3 py-2.5 text-center"
                      >
                        <KebabMenu
                          label={`Actions for ${u.name}`}
                          items={[
                            {
                              key: "open",
                              label: "Open full profile",
                              icon: ArrowUpRight,
                              onSelect: () => router.push(`/admin/users/${u.id}`),
                            },
                            ...(can("users.write") ? [{
                              key: "edit",
                              label: "Edit profile",
                              icon: Edit3,
                              onSelect: () => startEdit(u),
                            }] : []),
                            ...((can("users.entitlements.write") || can("users.sessions.write")) ? [{
                              key: "actions",
                              label: "Account actions…",
                              icon: Gift,
                              onSelect: () => setExpandedUser(u.id),
                            }] : []),
                            ...(can("users.write") ? [{
                              key: "reset",
                              label: "Reset gamification",
                              icon: RotateCcw,
                              onSelect: () => setResetTarget(u),
                            }] : []),
                          ]}
                        />
                      </td>
                    </tr>

                    {/* Expanded Detail / Edit */}
                    {expandedUser === u.id && (
                      <tr>
                        <td
                          colSpan={canReadRevenue ? 11 : 10}
                          className="px-4 py-4 bg-[var(--mp-surface-sunken)]/50 border-b border-[var(--mp-border-subtle)]"
                        >
                          {editingUser === u.id ? (
                            <div className="space-y-3">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)]">
                                Editing: {u.name}
                              </h4>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <TextField
                                  label="First Name"
                                  value={editForm.first_name || ""}
                                  onChange={(e) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      first_name: e.target.value,
                                    }))
                                  }
                                />
                                <TextField
                                  label="Last Name"
                                  value={editForm.last_name || ""}
                                  onChange={(e) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      last_name: e.target.value,
                                    }))
                                  }
                                />
                                <TextField
                                  label="Email"
                                  type="email"
                                  value={editForm.email || ""}
                                  onChange={(e) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      email: e.target.value,
                                    }))
                                  }
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEdit(u.id)}
                                  className="mp-btn mp-btn--primary mp-btn--sm"
                                >
                                  Save Changes
                                </button>
                                <button
                                  onClick={() => setEditingUser(null)}
                                  className="mp-btn mp-btn--secondary mp-btn--sm"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                <DetailField
                                  label="ID"
                                  value={u.id}
                                  mono
                                />
                                <DetailField
                                  label="Email"
                                  value={u.email || "—"}
                                />
                                <DetailField
                                  label="Telegram"
                                  value={u.telegram_id || "—"}
                                  mono
                                />
                                <DetailField
                                  label="Username"
                                  value={u.username ? `@${u.username}` : "—"}
                                />
                                <DetailField
                                  label="Daily Today"
                                  value={formatInt(u.daily_today)}
                                  mono
                                />
                                <DetailField
                                  label="Last Study"
                                  value={
                                    u.last_study
                                      ? formatDate(u.last_study)
                                      : "—"
                                  }
                                />
                                <DetailField
                                  label="Last Active"
                                  value={formatTime(u.last_active)}
                                />
                                <DetailField
                                  label="Photo"
                                  value={
                                    u.photo_url ? (
                                      <a
                                        href={u.photo_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-[var(--mp-cta-blue)] underline"
                                      >
                                        View
                                      </a>
                                    ) : (
                                      "—"
                                    )
                                  }
                                />
                              </div>
                              <div
                                className="pt-2 border-t border-[var(--mp-border-subtle)] flex items-center justify-between gap-3 flex-wrap"
                                data-user-quickactions={u.id}
                              >
                                <div className="text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-wider">
                                  Available actions are limited by your permissions.
                                </div>
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/admin/users/${u.id}`}
                                    className="mp-btn mp-btn--primary mp-btn--sm inline-flex items-center gap-1"
                                  >
                                    <ArrowUpRight size={12} /> Open full profile
                                  </Link>
                                  <UserQuickActions
                                    userId={u.id}
                                    userEmail={u.email}
                                    isAdmin={u.role === "admin"}
                                    onChanged={fetchUsers}
                                  />
                                  {can("users.write") && <button
                                    type="button"
                                    onClick={() => startEdit(u)}
                                    className="mp-btn mp-btn--ghost mp-btn--sm inline-flex items-center gap-1"
                                  >
                                    <Edit3 size={12} /> Edit profile
                                  </button>}
                                </div>
                              </div>
                              {u.status === "dormant" && (
                                <div className="text-[11px] text-[var(--mp-fg-muted)] italic flex items-center gap-1">
                                  <Ban size={11} />
                                  Dormant: no activity for 30+ days.
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
        <div className="divide-y divide-[var(--mp-border-subtle)] lg:hidden">
          {loading && users.length === 0 ? (
            <div role="status" className="px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">{error ? "The user directory could not be loaded. Retry the request before treating this as empty." : query || tierFilter !== "all" || authFilter !== "all" ? "No users match your filters." : "No users yet."}</div>
          ) : users.map((u) => (
            <article key={u.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin/users/${u.id}`} className="font-semibold text-sm text-[var(--mp-fg)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--mp-viridian)]">
                    {u.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--mp-fg-muted)] break-all">{u.email || (u.username ? `@${u.username}` : u.id)}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--mp-fg-muted)] whitespace-nowrap">
                  <StatusDot tone={u.status === "active" ? "success" : u.status === "recent" ? "warn" : "neutral"} size={6} />
                  {u.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-[var(--mp-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--mp-fg-muted)]">{u.role === "admin" ? "Admin account" : "Learner"}</span>
                {canReadRevenue && <span className="rounded-full border border-[var(--mp-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--mp-fg-muted)]">{u.tier || "free"}</span>}
                {u.telegram_id && <span className="rounded-full bg-[#229ED9]/10 px-2 py-0.5 text-[10px] text-[#229ED9]">Telegram</span>}
                {u.email && <span className="rounded-full bg-[var(--mp-viridian)]/10 px-2 py-0.5 text-[10px] text-[var(--mp-viridian)]">Email</span>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div><dt className="text-[10px] text-[var(--mp-fg-subtle)]">Questions answered</dt><dd className="font-mono tabular-nums">{formatInt(u.questions_answered)}</dd></div>
                <div><dt className="text-[10px] text-[var(--mp-fg-subtle)]">Accuracy</dt><dd className="font-mono tabular-nums">{u.accuracy > 0 ? `${u.accuracy}%` : "—"}</dd></div>
                <div><dt className="text-[10px] text-[var(--mp-fg-subtle)]">XP · streak</dt><dd className="font-mono tabular-nums">{formatInt(u.xp)} · {u.streak > 0 ? `${u.streak}d` : "—"}</dd></div>
                <div><dt className="text-[10px] text-[var(--mp-fg-subtle)]">Last active</dt><dd>{timeAgo(u.last_active)}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--mp-border-subtle)] pt-3">
                <Link href={`/admin/users/${u.id}`} className="mp-btn mp-btn--secondary mp-btn--sm">Open profile</Link>
                {(can("users.entitlements.write") || can("users.sessions.write")) && <UserQuickActions userId={u.id} userEmail={u.email} isAdmin={u.role === "admin"} onChanged={fetchUsers} />}
                {can("users.write") && <button type="button" className="mp-btn mp-btn--ghost mp-btn--sm" onClick={() => setResetTarget(u)}>Reset progress…</button>}
              </div>
            </article>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--mp-border-subtle)] px-3 py-2 text-xs text-[var(--mp-fg-muted)]">
          <span aria-live="polite">{error ? "Directory counts unavailable" : `Page ${totalPages === 0 ? 0 : page} of ${totalPages} · ${formatInt(total)} matching users`}</span>
          <div className="flex items-center gap-2">
            {loading && <span role="status">Updating…</span>}
            <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" disabled={loading || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          </div>
        </div>
      </div>
      </>}
    </AdminPageShell>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] mb-0.5">
        {label}
      </div>
      <div
        className={`text-xs text-[var(--mp-fg)] ${mono ? "font-mono break-all" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
