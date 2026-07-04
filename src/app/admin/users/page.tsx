"use client";

/**
 * Admin / Users tab.
 *
 * Searchable sortable user table + kebab menu per row + expandable
 * per-user detail row (edit first/last/email, Grant days, Lock). All
 * mutations go through `/api/stats/admin/users` PATCH/DELETE and
 * `/api/admin/users/{grant,lock}` which audit-log server-side.
 *
 * Polish pass (Apr 23):
 *   - AdminPageShell title + freshness badge
 *   - Filter chips for tier + auth method
 *   - Quick actions consolidated into a kebab menu (⋮)
 *   - Sticky search row (scrolls-with-table-head)
 *   - Skeleton rows instead of a full-page spinner
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  ChevronDown,
  Edit3,
  Gift,
  RotateCcw,
  Search,
  Trash2,
  Users as UsersIcon,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import {
  Dialog,
  useToast,
  TextField,
  EmptyState,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  FilterChip,
  FormatInt,
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

export default function AdminUsersPage() {
  const toast = useToast();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [authFilter, setAuthFilter] = useState<AuthFilter>("all");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: string; asc: boolean }>({
    col: "last_active",
    asc: false,
  });

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/stats/admin/users");
      if (!res.ok) throw new Error("Failed to load users");
      setUsers(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Actions ─────────────────────────────────────────────────────
  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updates: { role: newRole } }),
      });
      if (!res.ok) throw new Error("Failed");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      toast.success(`Role updated to ${newRole}`);
    } catch {
      toast.error("Failed to update role");
    }
  };

  const handleTierChange = async (userId: string, newTier: string) => {
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updates: { tier: newTier } }),
      });
      if (!res.ok) throw new Error("Failed");
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, tier: newTier } : u))
      );
    } catch {
      toast.error("Failed to update tier");
    }
  };

  const handleEdit = async (userId: string) => {
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
      toast.success("Gamification reset");
    } catch {
      toast.error("Failed to reset gamification");
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      const res = await fetch(`/api/stats/admin/users?id=${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      setDeletingUser(null);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
    } catch {
      toast.error("Failed to delete user");
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

  // ── Counts by tier/auth (used for chip labels) ──────────────────
  const tierCounts = useMemo(() => {
    const by: Record<TierFilter, number> = { all: users.length, free: 0, pro: 0, admin: 0 };
    for (const u of users) {
      const t = (u.tier || "free") as TierFilter;
      if (by[t] != null) by[t]++;
    }
    return by;
  }, [users]);

  const authCounts = useMemo(() => {
    const email = users.filter((u) => !!u.email).length;
    const telegram = users.filter((u) => !!u.telegram_id).length;
    return { all: users.length, email, telegram };
  }, [users]);

  // ── Filtered & Sorted ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = users;
    if (tierFilter !== "all") {
      result = result.filter((u) => (u.tier || "free") === tierFilter);
    }
    if (authFilter === "email") result = result.filter((u) => !!u.email);
    if (authFilter === "telegram") result = result.filter((u) => !!u.telegram_id);

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q) ||
          u.username?.toLowerCase().includes(q) ||
          u.id.includes(q)
      );
    }
    return [...result].sort((a, b) => {
      const col = sort.col as keyof UserRow;
      const aVal = a[col] ?? "";
      const bVal = b[col] ?? "";
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sort.asc ? aVal - bVal : bVal - aVal;
      }
      return sort.asc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [users, search, tierFilter, authFilter, sort]);

  const deletingUserRow = deletingUser
    ? users.find((u) => u.id === deletingUser)
    : null;

  return (
    <AdminPageShell
      title="Users"
      description={`${formatInt(users.length)} total · search by name, email, username, ID`}
      freshness={loading ? "cached" : "live"}
      onRefresh={fetchUsers}
    >
      {error && (
        <div
          className="bg-[var(--mp-error-bg)] border border-[var(--mp-error)]/25 text-[var(--mp-error)] text-sm rounded-xl px-4 py-3 flex items-center gap-2"
          role="alert"
        >
          <AlertTriangle size={16} />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError("")}
            className="mp-btn mp-btn--ghost mp-btn--sm"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sticky filter row */}
      <div className="sticky top-[52px] z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[var(--mp-surface-sunken)]/90 backdrop-blur border-b border-[var(--mp-border-subtle)]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-[440px]">
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
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mr-1">
              Tier
            </span>
            {(["all", "free", "pro", "admin"] as TierFilter[]).map((t) => (
              <FilterChip
                key={t}
                active={tierFilter === t}
                onClick={() => setTierFilter(t)}
                count={tierCounts[t]}
              >
                {t === "all" ? "All" : t}
              </FilterChip>
            ))}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mr-1">
              Auth
            </span>
            {(["all", "email", "telegram"] as AuthFilter[]).map((a) => (
              <FilterChip
                key={a}
                active={authFilter === a}
                onClick={() => setAuthFilter(a)}
                count={authCounts[a]}
              >
                {a === "all" ? "All" : a === "email" ? "Email" : "Telegram"}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deletingUser}
        onOpenChange={(open) => {
          if (!open) setDeletingUser(null);
        }}
        title="Delete user?"
        description={
          deletingUserRow
            ? `This will permanently delete ${deletingUserRow.name}. This action cannot be undone.`
            : undefined
        }
        footer={
          <>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => setDeletingUser(null)}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--destructive"
              onClick={() => deletingUser && handleDelete(deletingUser)}
            >
              Delete user
            </button>
          </>
        }
      />

      {/* User Table */}
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--mp-surface-sunken)] border-b border-[var(--mp-border-subtle)] text-[10px] uppercase tracking-wider">
                {(
                  [
                    { key: "name", label: "User", align: "left" },
                    { key: "auth", label: "Auth", align: "left" },
                    { key: "role", label: "Role", align: "left" },
                    { key: "tier", label: "Tier", align: "left" },
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
                ).map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 text-[var(--mp-fg-muted)] font-medium whitespace-nowrap ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left"
                    } ${
                      col.key !== "auth" && col.key !== "actions"
                        ? "cursor-pointer hover:text-[var(--mp-fg)]"
                        : ""
                    }`}
                    onClick={() =>
                      col.key !== "auth" &&
                      col.key !== "actions" &&
                      setSort((prev) => ({
                        col: col.key,
                        asc: prev.col === col.key ? !prev.asc : false,
                      }))
                    }
                  >
                    {col.label}
                    {sort.col === col.key && (
                      <ChevronDown
                        size={10}
                        className={`inline ml-1 transition-transform ${sort.asc ? "rotate-180" : ""}`}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <RowSkeleton key={i} cols={12} />
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8">
                    <EmptyState
                      tone="neutral"
                      icon={<UsersIcon className="w-10 h-10" aria-hidden />}
                      title={
                        search || tierFilter !== "all" || authFilter !== "all"
                          ? "No users match your filters"
                          : "No users yet"
                      }
                      body={
                        search || tierFilter !== "all" || authFilter !== "all"
                          ? "Try a broader filter, or clear the search."
                          : "Users will appear here as they register."
                      }
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <Fragment key={u.id}>
                    <tr
                      onClick={() =>
                        setExpandedUser(u.id === expandedUser ? null : u.id)
                      }
                      className={`border-b border-[var(--mp-border-subtle)]/50 cursor-pointer transition-colors ${
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
                          <Link
                            href={`/admin/users/${u.id}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Open full profile"
                            className="font-medium text-[var(--mp-fg)] truncate max-w-[160px] hover:text-[var(--mp-viridian)] hover:underline"
                          >
                            {u.name}
                          </Link>
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
                      {/* Role dropdown */}
                      <td
                        className="px-3 py-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={u.role}
                          onChange={(e) =>
                            handleRoleChange(u.id, e.target.value)
                          }
                          className="text-xs border border-[var(--mp-border-subtle)] rounded px-2 py-1 bg-[var(--mp-surface-raised)] text-[var(--mp-fg)] focus:outline-none focus:border-[var(--mp-viridian)]/50"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      {/* Tier dropdown */}
                      <td
                        className="px-3 py-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={u.tier || "free"}
                          onChange={(e) =>
                            handleTierChange(u.id, e.target.value)
                          }
                          className={`text-[10px] border rounded px-2 py-1 font-semibold focus:outline-none ${
                            (u.tier || "free") === "pro"
                              ? "border-[var(--mp-status-warning)] text-[var(--mp-status-warning)] bg-[var(--mp-status-warning)]/5"
                              : (u.tier || "free") === "admin"
                                ? "border-[var(--mp-error)] text-[var(--mp-error)] bg-[var(--mp-error)]/5"
                                : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)] bg-[var(--mp-surface-raised)]"
                          }`}
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
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
                        onClick={(e) => e.stopPropagation()}
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
                            {
                              key: "edit",
                              label: "Edit profile",
                              icon: Edit3,
                              onSelect: () => startEdit(u),
                            },
                            {
                              key: "actions",
                              label: "Grant / Lock / Ban…",
                              icon: Gift,
                              onSelect: () => setExpandedUser(u.id),
                            },
                            {
                              key: "reset",
                              label: "Reset gamification",
                              icon: RotateCcw,
                              onSelect: () => handleResetGamification(u.id),
                            },
                            {
                              key: "delete",
                              label: "Delete user",
                              icon: Trash2,
                              tone: "danger",
                              onSelect: () => setDeletingUser(u.id),
                            },
                          ]}
                        />
                      </td>
                    </tr>

                    {/* Expanded Detail / Edit */}
                    {expandedUser === u.id && (
                      <tr>
                        <td
                          colSpan={12}
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
                                  Quick actions: Grant / Lock / Ban
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
                                    onChanged={fetchUsers}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => startEdit(u)}
                                    className="mp-btn mp-btn--ghost mp-btn--sm inline-flex items-center gap-1"
                                  >
                                    <Edit3 size={12} /> Edit profile
                                  </button>
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
