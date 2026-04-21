"use client";

/**
 * Admin / System tab.
 *
 * DB row counts, per-topic breakdown, admin-user roster, and static
 * app-info cards. Fetches question stats + users independently so the
 * page works when deep-linked.
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Shield, Settings, RotateCcw } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { BrandedLoader } from "@/components/ui";
import { formatDate, timeAgo } from "../_components/helpers";
import type { QuestionStats, UserRow } from "../_components/types";

export default function AdminSystemPage() {
  const [questionStats, setQuestionStats] = useState<QuestionStats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/questions");
      if (!res.ok) throw new Error("Failed");
      setQuestionStats(await res.json());
    } catch { /* optional */ }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/users");
      if (!res.ok) throw new Error("Failed");
      setUsers(await res.json());
    } catch { /* optional */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchUsers()]);
      setLoading(false);
    })();
  }, [fetchStats, fetchUsers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <BrandedLoader label="Loading system info…" />
      </div>
    );
  }

  const admins = users.filter((u) => u.role === "admin");

  return (
    <div className="space-y-6">
      {/* Database Stats */}
      <div className="card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2">
            <BarChart3 size={16} className="text-[var(--mp-viridian)]" /> Database Statistics
          </h3>
          <button onClick={fetchStats} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1">
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
                    // eslint-disable-next-line @next/next/no-img-element
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
