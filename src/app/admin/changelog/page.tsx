"use client";

/**
 * Admin / Changelog tab.
 *
 * Full changelog view including admin-only entries (hidden from the
 * public /changelog page). Source of truth: src/lib/changelog.ts —
 * edits there automatically appear here AND on /changelog.
 */

import { Clock } from "lucide-react";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";

export default function AdminChangelogPage() {
  // Group ALL entries (including admin) by date
  const grouped: Record<string, ChangelogEntry[]> = {};
  for (const entry of CHANGELOG) {
    if (!grouped[entry.date]) grouped[entry.date] = [];
    grouped[entry.date].push(entry);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const tagColors: Record<string, string> = {
    feature: "bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]",
    improvement: "bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]",
    fix: "bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)]",
    admin: "bg-[var(--mp-error)]/10 text-[var(--mp-error)]",
  };

  return (
    <div className="space-y-6">
      <div className="card rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--mp-fg)]">Full Changelog (Admin View)</h3>
            <p className="text-xs text-[var(--mp-fg-subtle)]">
              {CHANGELOG.length} total entries · {CHANGELOG.filter((e) => e.tag === "admin").length} admin-only
            </p>
          </div>
          <a
            href="/changelog"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs px-3 py-1.5 rounded-lg"
          >
            View User Version
          </a>
        </div>
        <p className="text-xs text-[var(--mp-fg-subtle)] italic">
          ⚠️ Maintained in <code className="bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded">src/lib/changelog.ts</code>. Edit that file to add new entries — they automatically appear here AND on /changelog.
        </p>
      </div>

      {/* Timeline */}
      <div className="space-y-6">
        {dates.map((date) => (
          <section key={date}>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-[var(--mp-fg-subtle)]" />
              <h3 className="text-sm font-semibold text-[var(--mp-fg-muted)]">
                {new Date(date).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}
              </h3>
              <span className="text-[10px] text-[var(--mp-fg-subtle)]">({grouped[date].length} entries)</span>
            </div>

            <div className="space-y-2 pl-4 border-l-2 border-[var(--mp-border)]">
              {grouped[date].map((entry, i) => (
                <div key={`${date}-${i}`} className="card rounded-lg p-3 -ml-4 pl-6 relative">
                  <div className={`absolute left-2 top-4 w-2.5 h-2.5 rounded-full ${tagColors[entry.tag].split(" ")[0]}`} />
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tagColors[entry.tag]}`}>
                      {entry.tag.toUpperCase()}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {entry.title.en}
                  </h4>
                  <p className="text-xs text-[var(--mp-fg-muted)] mb-1">{entry.description.en}</p>
                  <p className="text-[10px] text-[var(--mp-fg-subtle)] italic">DE: {entry.title.de}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
