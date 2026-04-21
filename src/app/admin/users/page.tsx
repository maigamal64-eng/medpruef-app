"use client";

/**
 * Admin / Users tab.
 *
 * Searchable sortable user table with inline Role + Tier dropdowns,
 * reset-gamification, delete (with MPDS Dialog confirm), and an
 * expandable per-user detail row (edit first_name / last_name / email).
 *
 * Fetches `/api/stats/admin/users` on mount and re-fetches after
 * edits. All mutations go through PATCH / DELETE on the same endpoint.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Search,
  Edit3,
  Trash2,
  RotateCcw,
  Users as UsersIcon,
  AlertTriangle,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import {
  Dialog,
  useToast,
  TextField,
  EmptyState,
  BrandedLoader,
} from "@/components/ui";
import { formatDate, formatTime, timeAgo, statusColor } from "../_components/helpers";
import type { UserRow } from "../_components/types";

export default function AdminUsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: string; asc: boolean }>({ col: "last_active", asc: false });

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

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ── Actions ────────────────────────────────────────────────────────
  const handleRoleChange = async (userId: string, newRole: string) => {
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

  const handleTierChange = async (userId: string, newTier: string) => {
    try {
      const res = await fetch("/api/stats/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, updates: { tier: newTier } }),
      });
      if (!res.ok) throw new Error("Failed");
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, tier: newTier } : u));
    } catch { toast.error("Failed to update tier"); }
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

  const handleDelete = async (userId: string) => {
    try {
      const res = await fetch(`/api/stats/admin/users?id=${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setDeletingUser(null);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
    } catch { toast.error("Failed to delete user"); }
  };

  const startEdit = (u: UserRow) => {
    setEditingUser(u.id);
    setEditForm({ first_name: u.first_name || "", last_name: u.last_name || "", email: u.email || "" });
  };

  // ── Filtered & Sorted ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((u) =>
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
  }, [users, search, sort]);

  const activeToday = users.filter((u) => u.status === "active").length;
  const deletingUserRow = deletingUser ? users.find((u) => u.id === deletingUser) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <BrandedLoader label="Loading users…" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-[var(--mp-error-bg)] border border-[var(--mp-error)]/25 text-[var(--mp-error)] text-sm rounded-xl px-4 py-3 flex items-center gap-2" role="alert">
          <AlertTriangle size={16} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="mp-btn mp-btn--ghost mp-btn--sm" aria-label="Dismiss error">Dismiss</button>
        </div>
      )}

      {/* Search — MPDS field with search-icon prefix */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-[13px] text-[var(--mp-fg-subtle)] pointer-events-none z-[1]" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, username, or ID..."
          aria-label="Search users"
          className="mp-field__input w-full pl-10"
        />
      </div>

      {/* Stats Row — tight .mp-stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Total</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-viridian)" }}>{users.length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Email Users</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-cta-blue)" }}>{users.filter((u) => u.email).length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Telegram Users</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-accent-teal)" }}>{users.filter((u) => u.telegram_id).length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Admins</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-error)" }}>{users.filter((u) => u.role === "admin").length}</span>
        </div>
        <div className="mp-stat" style={{ padding: 12 }}>
          <span className="mp-stat__label">Active Today</span>
          <span className="mp-stat__value" style={{ fontSize: 22, color: "var(--mp-status-warning)" }}>{activeToday}</span>
        </div>
      </div>

      {/* Delete Confirmation Dialog (MPDS) */}
      <Dialog
        open={!!deletingUser}
        onOpenChange={(open) => { if (!open) setDeletingUser(null); }}
        title="Delete user?"
        description={deletingUserRow ? `This will permanently delete ${deletingUserRow.name}. This action cannot be undone.` : undefined}
        footer={
          <>
            <button className="mp-btn mp-btn--secondary" onClick={() => setDeletingUser(null)}>Cancel</button>
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
                    onClick={() => col.key !== "auth" && col.key !== "actions" && setSort((prev) => ({ col: col.key, asc: prev.col === col.key ? !prev.asc : false }))}
                  >
                    {col.label}
                    {sort.col === col.key && <ChevronDown size={12} className={`inline ml-1 transition-transform ${sort.asc ? "rotate-180" : ""}`} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <Fragment key={u.id}>
                  <tr
                    onClick={() => setExpandedUser(u.id === expandedUser ? null : u.id)}
                    className={`border-b border-[var(--mp-border)]/50 cursor-pointer transition-colors ${
                      expandedUser === u.id ? "bg-[var(--mp-viridian)]/5" : "hover:bg-[var(--mp-surface-sunken)]"
                    }`}
                  >
                    {/* Avatar + Name */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {u.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
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
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
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
                        onChange={(e) => handleTierChange(u.id, e.target.value)}
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
                          onClick={() => startEdit(u)}
                          className="p-1.5 rounded-md hover:bg-[var(--mp-viridian)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-viridian)] transition-colors"
                          title="Edit"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => handleResetGamification(u.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--mp-status-warning)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-status-warning)] transition-colors"
                          title="Reset gamification"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          onClick={() => setDeletingUser(u.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--mp-error)]/10 text-[var(--mp-fg-muted)] hover:text-[var(--mp-error)] transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>

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
                                onChange={(e) => setEditForm((prev) => ({ ...prev, first_name: e.target.value }))}
                              />
                              <TextField
                                label="Last Name"
                                value={editForm.last_name || ""}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, last_name: e.target.value }))}
                              />
                              <TextField
                                label="Email"
                                type="email"
                                value={editForm.email || ""}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleEdit(u.id)} className="mp-btn mp-btn--primary mp-btn--sm">Save Changes</button>
                              <button onClick={() => setEditingUser(null)} className="mp-btn mp-btn--secondary mp-btn--sm">Cancel</button>
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-2">
                    <EmptyState
                      tone="neutral"
                      icon={<UsersIcon className="w-10 h-10" aria-hidden />}
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
