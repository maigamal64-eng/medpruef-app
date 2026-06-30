"use client";

/**
 * /admin/note-reports — moderation queue for public ("community") flash-notes.
 *
 * The takedown half of the Notes safety stack (P6). Lists open reports with the
 * reported note's content; "Entfernen" deactivates the note immediately (removes
 * it from Explore), "Verwerfen" dismisses the report. Every /api/admin/* call is
 * requireAdmin-gated server-side.
 */

import { useEffect, useState, useCallback } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { ShieldAlert, Trash2, Check, Loader2 } from "lucide-react";

interface ReportNote {
  id: string;
  title: string;
  content: {
    blocks?: { type: string; front?: string; back?: string; text?: string }[];
  } | null;
  visibility: string;
  is_active: boolean;
}
interface Report {
  id: string;
  note_id: string;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string;
  notes: ReportNote | null;
}

const REASON_LABEL: Record<string, string> = {
  pii: "Persönliche Daten",
  wrong: "Medizinisch falsch",
  spam: "Spam",
  copyright: "Urheberrecht",
  other: "Sonstiges",
};

function flatten(content: ReportNote["content"]): string {
  const blocks = content?.blocks ?? [];
  return blocks
    .map((b) => (b.type === "concept" ? `${b.front ?? ""} ${b.back ?? ""}` : b.text ?? ""))
    .join(" · ")
    .slice(0, 400);
}

export default function NoteReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/note-reports");
      const d = await res.json().catch(() => ({}));
      setReports(Array.isArray(d?.reports) ? d.reports : []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (reportId: string, action: "takedown" | "dismiss") => {
    setActing(reportId);
    try {
      await fetch("/api/admin/note-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, action }),
      });
      await load();
    } catch {
      /* ignore */
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="mp-h1 flex items-center gap-2 mb-1">
        <ShieldAlert className="w-6 h-6 text-[var(--mp-status-warning)]" />
        Öffentliche Notizen — Meldungen
      </h1>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5">
        Offene Meldungen zu öffentlichen Lernkarten. „Entfernen“ deaktiviert die
        Notiz sofort und nimmt sie aus Explore.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--mp-fg-muted)] py-10">
          <Loader2 className="w-5 h-5 animate-spin" /> Lädt…
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-6 text-center text-[var(--mp-fg-muted)]">
          Keine offenen Meldungen.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-4"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </span>
                <span className="text-xs text-[var(--mp-fg-subtle)]">
                  {new Date(r.created_at).toLocaleString("de-AT")}
                </span>
              </div>
              <p className="font-semibold text-[var(--mp-fg)]">
                {r.notes?.title || "(ohne Titel)"}
              </p>
              <p className="text-sm text-[var(--mp-fg-muted)] line-clamp-3 mt-0.5">
                {flatten(r.notes?.content ?? null)}
              </p>
              {r.detail && (
                <p className="text-xs italic text-[var(--mp-fg-subtle)] mt-1">
                  „{r.detail}“
                </p>
              )}
              {r.notes && !r.notes.is_active && (
                <p className="text-xs text-[var(--mp-viridian)] mt-1">
                  Bereits deaktiviert.
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => act(r.id, "takedown")}
                  disabled={acting === r.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 text-[var(--mp-error)] hover:bg-[var(--mp-error)]/20 transition-colors disabled:opacity-50"
                >
                  {acting === r.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Entfernen
                </button>
                <button
                  type="button"
                  onClick={() => act(r.id, "dismiss")}
                  disabled={acting === r.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  Verwerfen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
