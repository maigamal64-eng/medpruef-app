"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";

/**
 * Microsoft Clarity UX-insights card. Self-contained fetch of
 * `/api/stats/admin/clarity` on mount; renders nothing until the
 * request completes (matches historical behavior).
 */
export function ClarityCard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/api/stats/admin/clarity")
      .then((r) => r.json())
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
                <span className="text-[var(--mp-fg-muted)] truncate">{p.url.replace("https://medpruf.com", "")}</span>
                <span className="text-[var(--mp-fg-subtle)] font-mono ml-2 flex-shrink-0">{p.visitsCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
