"use client";

/**
 * Overview "Needs you" strip (a15, UX-ADM-16): open question reports,
 * community note reports and feedback needing action, from
 * /api/admin/inbox. Shown to admins with content.read or feedback.read
 * (the Operational Queues section is revenue-gated). A count the admin
 * cannot read, or that failed to load, shows "Not available", never 0.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquare, NotebookPen, ShieldAlert } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";

type Counts = { question_reports: number | null; note_reports: number | null; feedback: number | null };

export function InboxStrip() {
  const { can } = useAdminPermissions();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  const visible = can("content.read") || can("feedback.read");

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/inbox");
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) throw new Error("inbox");
        setCounts({ question_reports: body.question_reports ?? null, note_reports: body.note_reports ?? null, feedback: body.feedback ?? null });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  if (!visible) return null;
  const tiles = [
    { key: "question_reports" as const, label: "Question reports", href: "/admin/flagged", icon: ShieldAlert, show: can("content.read") },
    { key: "note_reports" as const, label: "Note reports", href: "/admin/note-reports", icon: NotebookPen, show: can("content.read") },
    { key: "feedback" as const, label: "Feedback needing action", href: "/admin/feedback", icon: MessageSquare, show: can("feedback.read") },
  ].filter((t) => t.show);

  return (
    <section aria-labelledby="needs-you-title" className="space-y-2" data-testid="overview-needs-you">
      <h2 id="needs-you-title" className="text-sm font-semibold text-[var(--mp-fg)]">Needs you</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map(({ key, label, href, icon: Icon }) => {
          const n = counts?.[key];
          return (
            <Link key={key} href={href} className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-sm">
              <Icon className="h-5 w-5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
              <span className="flex-1 text-[var(--mp-fg)]">{label}</span>
              <span className={`font-mono font-semibold ${typeof n === "number" && n > 0 ? "text-[var(--mp-fg)]" : "text-[var(--mp-fg-muted)]"}`}>
                {typeof n === "number" ? n.toLocaleString("en-GB") : failed || counts ? "Not available" : "…"}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
