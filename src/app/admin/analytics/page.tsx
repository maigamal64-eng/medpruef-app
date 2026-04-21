"use client";

/**
 * Admin / Analytics tab.
 *
 * Activity feed with event-type filter. Renders the last 100 events
 * from `/api/stats/admin/activity`.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Select, EmptyState, BrandedLoader } from "@/components/ui";
import { formatTime } from "../_components/helpers";
import type { ActivityRow } from "../_components/types";

export default function AdminAnalyticsPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async (eventType?: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: "100" });
      if (eventType) params.set("eventType", eventType);
      const res = await fetch(`/api/stats/admin/activity?${params}`);
      if (!res.ok) throw new Error("Failed to load activity");
      const data = await res.json();
      setActivities(data.activities || []);
      setTotal(data.total || 0);
      setEventTypes(data.eventTypes || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  if (loading && activities.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <BrandedLoader label="Loading activity…" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select
            label="Filter events"
            hideLabel
            value={filter}
            onChange={(e) => { setFilter(e.target.value); fetchActivity(e.target.value || undefined); }}
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
