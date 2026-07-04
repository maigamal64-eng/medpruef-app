"use client";

/**
 * The activity timeline — the centrepiece of the user-detail page.
 *
 * Renders the merged, server-sorted `TimelineItem[]` as a day-grouped
 * vertical feed: each entry is an icon (by kind) + a tone colour + a
 * human sentence + the exact detail + the exact clock time. This is the
 * "exact activity details rendered visually" [name] asked for.
 */

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Eye,
  Search,
  Star,
  Sparkles,
  LogIn,
  LogOut,
  Languages,
  Zap,
  StickyNote,
  MessageSquare,
  Flag,
  CreditCard,
  Gift,
  Share2,
  Clock,
  Circle,
  type LucideIcon,
} from "lucide-react";
import type { TimelineItem, TimelineKind, TimelineTone } from "./types";

const TONE_COLOR: Record<TimelineTone, string> = {
  success: "var(--mp-viridian)",
  danger: "var(--mp-error)",
  warn: "var(--mp-status-warning)",
  info: "var(--mp-cta-blue)",
  money: "#C08A2D",
  neutral: "var(--mp-fg-subtle)",
};

const TONE_TINT: Record<TimelineTone, string> = {
  success: "rgba(0,123,95,0.12)",
  danger: "rgba(214,69,69,0.12)",
  warn: "rgba(244,162,97,0.14)",
  info: "rgba(0,58,140,0.10)",
  money: "rgba(192,138,45,0.14)",
  neutral: "var(--mp-surface-sunken)",
};

function iconFor(item: TimelineItem): LucideIcon {
  const k: TimelineKind = item.kind;
  if (k === "answer") return item.correct ? CheckCircle2 : XCircle;
  const map: Partial<Record<TimelineKind, LucideIcon>> = {
    page_view: Eye,
    search: Search,
    bookmark: Star,
    ai_chat: Sparkles,
    session_start: LogIn,
    session_end: LogOut,
    translation: Languages,
    feature_use: Zap,
    note_created: StickyNote,
    feedback: MessageSquare,
    flag: Flag,
    subscription: CreditCard,
    trial: Gift,
    referral: Share2,
    payment: CreditCard,
    waitlist: Clock,
  };
  return map[k] || Circle;
}

function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const KIND_FILTERS: { key: string; label: string; kinds: TimelineKind[] }[] = [
  { key: "all", label: "All", kinds: [] },
  { key: "study", label: "Study", kinds: ["answer"] },
  {
    key: "browse",
    label: "Browsing",
    kinds: ["page_view", "search", "session_start", "session_end"],
  },
  { key: "learn", label: "Learning", kinds: ["bookmark", "ai_chat", "translation", "note_created"] },
  {
    key: "money",
    label: "Money",
    kinds: ["subscription", "payment", "trial", "waitlist", "referral"],
  },
  { key: "voice", label: "Feedback", kinds: ["feedback", "flag"] },
];

export function ActivityTimeline({
  items,
  total,
}: {
  items: TimelineItem[];
  total: number;
}) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(60);

  const filtered = useMemo(() => {
    const f = KIND_FILTERS.find((x) => x.key === filter);
    if (!f || !f.kinds.length) return items;
    return items.filter((it) => f.kinds.includes(it.kind));
  }, [items, filter]);

  const visible = filtered.slice(0, limit);

  // group visible items by calendar day
  const groups = useMemo(() => {
    const g: { day: string; items: TimelineItem[] }[] = [];
    let cur: { day: string; items: TimelineItem[] } | null = null;
    for (const it of visible) {
      const day = new Date(it.ts).toISOString().slice(0, 10);
      if (!cur || cur.day !== day) {
        cur = { day, items: [] };
        g.push(cur);
      }
      cur.items.push(it);
    }
    return g;
  }, [visible]);

  if (!items.length) {
    return (
      <div className="text-sm text-[var(--mp-fg-subtle)] italic py-10 text-center">
        No recorded activity for this user yet.
      </div>
    );
  }

  return (
    <div>
      {/* filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {KIND_FILTERS.map((f) => {
          const count = f.kinds.length
            ? items.filter((it) => f.kinds.includes(it.kind)).length
            : items.length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setLimit(60);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border text-[11px] font-medium transition-colors ${
                filter === f.key
                  ? "bg-[var(--mp-viridian)]/15 border-[var(--mp-viridian)]/40 text-[var(--mp-viridian)]"
                  : "bg-[var(--mp-surface-raised)] border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
              }`}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-5">
        {groups.map((grp) => (
          <div key={grp.day}>
            <div className="sticky top-0 z-10 -mx-1 px-1 py-1 mb-1 bg-[var(--mp-surface-raised)]/95 backdrop-blur">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)]">
                {dayHeading(grp.items[0].ts)}
              </span>
            </div>
            <ol className="relative pl-1">
              {grp.items.map((it, i) => {
                const Icon = iconFor(it);
                return (
                  <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                    {/* connector line */}
                    {i < grp.items.length - 1 && (
                      <span
                        className="absolute left-[13px] top-7 bottom-0 w-px bg-[var(--mp-border-subtle)]"
                        aria-hidden
                      />
                    )}
                    <span
                      className="relative z-10 flex-shrink-0 w-[27px] h-[27px] rounded-full flex items-center justify-center border border-[var(--mp-border-subtle)]"
                      style={{ background: TONE_TINT[it.tone], color: TONE_COLOR[it.tone] }}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] text-[var(--mp-fg)] leading-snug">
                          {it.title}
                        </span>
                        <span
                          className="text-[10px] tabular-nums text-[var(--mp-fg-subtle)] flex-shrink-0 font-mono"
                          title={new Date(it.ts).toLocaleString()}
                        >
                          {clock(it.ts)}
                        </span>
                      </div>
                      {it.detail && (
                        <div className="text-[11px] text-[var(--mp-fg-muted)] mt-0.5 truncate">
                          {it.detail}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 80)}
          className="mp-btn mp-btn--secondary mp-btn--sm mt-4 w-full"
        >
          Show more ({visible.length} of {filtered.length})
        </button>
      )}
      {total > items.length && filter === "all" && (
        <div className="text-[10px] text-[var(--mp-fg-subtle)] text-center mt-2">
          Showing the {items.length} most recent of {total} total events.
        </div>
      )}
    </div>
  );
}
