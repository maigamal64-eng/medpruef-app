"use client";

/**
 * /admin/note-reports — moderation queue for public ("community") flash-notes.
 *
 * The takedown half of the Notes safety stack (P6). Lists open reports with the
 * reported note's content; "Entfernen" deactivates the note immediately (removes
 * it from Explore), "Verwerfen" dismisses the report. Every /api/admin/* call is
 * requireAdmin-gated server-side.
 *
 * a15 (UX-ADM-16, ADM-13): reachable from the Inbox sidebar group with an
 * open count; the reason is the first thing on each card (personal data and
 * copyright stand out); the note owner links to their profile (users.read);
 * takedown asks for confirmation first. Restoring a taken-down note needs a
 * new API action and is deferred.
 */

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Trash2, Check, Loader2 } from "lucide-react";
import { Alert, BrandedLoader, Dialog, DialogFooter } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface ReportNote {
  id: string;
  title: string;
  content: {
    blocks?: { type: string; front?: string; back?: string; text?: string }[];
  } | null;
  visibility: string;
  is_active: boolean;
  user_id?: string | null;
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

const URGENT_REASONS = new Set(["pii", "copyright", "wrong"]);

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
  const { can, loading: accessLoading } = useAdminPermissions();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Report | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/note-reports");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || `Could not load note reports (HTTP ${res.status})`);
      if (!Array.isArray(d?.reports)) throw new Error("Note report response was not a list");
      setReports(d.reports);
    } catch (e) {
      setError((e as Error).message || "Could not load note reports");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!accessLoading && can("content.read")) void load();
  }, [accessLoading, can, load]);

  const act = async (reportId: string, action: "takedown" | "dismiss") => {
    if (!can("content.moderate")) return;
    setActing(reportId);
    try {
      const res = await fetch("/api/admin/note-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, action }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `Action failed (HTTP ${res.status})`);
      setConfirming(null);
      await load();
    } catch (e) {
      setError((e as Error).message || "Action failed");
    } finally {
      setActing(null);
    }
  };

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("content.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to read note reports.</Alert></div>;

  return (
    <AdminPageShell title="Community note reports" description="Review learner reports about public study notes. Takedown hides a note from Explore; dismissal closes only the report." loadState={{ loading, error }} onRefresh={() => void load()}>
      {error && <Alert variant="error" title="Could not complete the request">{error}<button type="button" className="ml-3 underline" onClick={() => void load()}>Retry</button></Alert>}
      <p className="text-sm text-[var(--mp-fg-muted)] mb-5">
        Offene Meldungen zu öffentlichen Lernkarten. „Entfernen“ deaktiviert die Notiz sofort und nimmt sie aus Explore.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--mp-fg-muted)] py-10">
          <Loader2 className="w-5 h-5 animate-spin" /> Lädt…
        </div>
      ) : !error && reports.length === 0 ? (
        <div className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-6 text-center text-[var(--mp-fg-muted)]">
          Keine offenen Meldungen.
        </div>
      ) : !error ? (
        <div className="space-y-3">
          {reports.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className={`text-sm font-bold px-2.5 py-1 rounded-full border ${URGENT_REASONS.has(r.reason) ? "border-[var(--mp-error)]/50 bg-[var(--mp-error)]/10 text-[var(--mp-fg)]" : "border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]"}`}>
                  {REASON_LABEL[r.reason] ?? r.reason}
                  <span className="ml-1 font-mono text-xs font-normal text-[var(--mp-fg-muted)]">({r.reason})</span>
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
              {r.notes?.user_id && can("users.read") ? (
                <p className="text-xs mt-1">
                  <Link href={`/admin/users/${r.notes.user_id}`} className="text-[var(--mp-cta-blue)] underline underline-offset-2">Profil der Autorin oder des Autors</Link>
                </p>
              ) : null}
              {r.notes && !r.notes.is_active && (
                <p className="text-xs text-[var(--mp-viridian)] mt-1">
                  Bereits deaktiviert.
                </p>
              )}
              {can("content.moderate") && <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setConfirming(r)}
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
              </div>}
            </div>
          ))}
        </div>
      ) : null}
      <Dialog
        open={!!confirming}
        onOpenChange={(next) => { if (!next && !acting) setConfirming(null); }}
        title="Notiz entfernen?"
        description="Die Notiz wird sofort deaktiviert und aus Explore genommen. Alle offenen Meldungen zu dieser Notiz werden geschlossen."
        footer={(
          <DialogFooter>
            <button type="button" className="mp-btn mp-btn--secondary" disabled={!!acting} onClick={() => setConfirming(null)}>Abbrechen</button>
            <button type="button" className="mp-btn mp-btn--destructive" disabled={!!acting} onClick={() => confirming && void act(confirming.id, "takedown")}>
              {acting ? "Wird entfernt…" : "Entfernen"}
            </button>
          </DialogFooter>
        )}
      >
        <p className="text-sm text-[var(--mp-fg)]">{confirming?.notes?.title || "(ohne Titel)"}</p>
      </Dialog>
    </AdminPageShell>
  );
}
