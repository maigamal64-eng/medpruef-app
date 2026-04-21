"use client";

import type { NewUsersData } from "./types";

/**
 * Live-registrations widget used on the dashboard. Fully self-contained
 * render: the parent handles the `data` / `baseline` / `onRefresh`
 * plumbing (polls + first-load baseline capture).
 */
export function NewUsersTracker({
  data,
  baseline,
  onRefresh,
}: {
  data: NewUsersData | null;
  baseline: number | null;
  onRefresh: () => void;
}) {
  if (!data) {
    return (
      <div className="card rounded-2xl p-5 mb-6 animate-pulse">
        <div className="h-5 w-48 bg-[var(--mp-border)] rounded mb-3" />
        <div className="h-12 w-32 bg-[var(--mp-border)] rounded" />
      </div>
    );
  }

  const sinceOpened = baseline !== null ? Math.max(0, data.total - baseline) : 0;
  const updated = new Date(data.generatedAt);
  const updatedStr = updated.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const stats: Array<{ label: string; value: number; tone: string }> = [
    { label: "Last Hour", value: data.lastHour, tone: "text-[var(--mp-accent-teal)]" },
    { label: "Today", value: data.today, tone: "text-[var(--mp-viridian)]" },
    { label: "7 Days", value: data.lastSevenDays, tone: "text-[var(--mp-cta-blue)]" },
    { label: "30 Days", value: data.lastThirtyDays, tone: "text-[var(--mp-info)]" },
  ];

  return (
    <div className="card rounded-2xl p-5 mb-6 border-l-4 border-l-[var(--mp-accent-teal)]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="relative w-2.5 h-2.5">
              <span className="absolute inset-0 rounded-full bg-[var(--mp-accent-teal)] animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full bg-[var(--mp-accent-teal)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--mp-fg)]">
              Live Registrations
            </h3>
            {sinceOpened > 0 && (
              <span className="text-xs font-mono font-bold text-white bg-[var(--mp-accent-teal)] px-2 py-0.5 rounded-full animate-pulse">
                +{sinceOpened} since opened
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--mp-fg-subtle)] font-mono">
            {data.total.toLocaleString("en-GB")} users · updated {updatedStr}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors px-2 py-1"
        >
          ↻ Jetzt
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]/60 px-3 py-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-1">
              {s.label}
            </p>
            <p className={`text-2xl font-bold font-mono ${s.tone}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {data.recent.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2">
            Letzte 10 Anmeldungen
          </p>
          <div className="space-y-1">
            {data.recent.map((u) => {
              const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim()
                || u.telegram_username
                || u.email
                || u.id.slice(0, 8);
              const ts = new Date(u.created_at);
              const isFresh = baseline !== null && ts.getTime() > new Date(Date.now() - 60_000 * 10).getTime();
              return (
                <div
                  key={u.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                    isFresh
                      ? "bg-[var(--mp-accent-teal)]/8 border border-[var(--mp-accent-teal)]/30"
                      : "bg-[var(--mp-surface-sunken)]/60"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isFresh && <span className="w-1.5 h-1.5 rounded-full bg-[var(--mp-accent-teal)] animate-pulse" />}
                    <span className="font-medium text-[var(--mp-fg)] truncate">
                      {name}
                    </span>
                    {u.tier && u.tier !== "free" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)] font-semibold uppercase">
                        {u.tier}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono whitespace-nowrap ml-3">
                    {ts.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
