"use client";

/**
 * MUX-110: the "KI-Mentor" group in Settings, shown only while the mentor is
 * available. Reads GET /api/mentor/usage; erasure uses the owner route
 * DELETE /api/mentor/chat/history behind a confirm. Answer-language server
 * sync is not part of this card (not built).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bot, ExternalLink, Trash2 } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { ConfirmAction } from "@/components/ui";
import { useMentorAvailability } from "@/components/mentor/useMentorAvailability";
import type { MentorUsageResponse } from "@/lib/mentor/contract";
import { entryT } from "./entry-copy";
import { formatMentorDate, mentorPackageName } from "./settings-format";

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; usage: MentorUsageResponse };

const ROW = "flex items-center justify-between gap-3 min-h-11 py-2 border-b border-[var(--mp-border-subtle)] last:border-b-0";

export default function MentorSettingsCard({ lang }: { lang: string }) {
  const availability = useMentorAvailability();
  const [mounted, setMounted] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const available = mounted && availability === "available";

  useEffect(() => { setMounted(true); }, []);

  const fetchUsage = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await authFetch("/api/mentor/usage", { skipAuthRedirect: true });
      const body = res.ok ? await res.json() as MentorUsageResponse : null;
      if (body && typeof body.credits_left === "number" && Array.isArray(body.subscriptions)) setLoad({ state: "ok", usage: body });
      else setLoad({ state: "error" });
    } catch { setLoad({ state: "error" }); }
  }, []);

  useEffect(() => { if (available) void fetchUsage(); }, [available, fetchUsage]);

  if (!available) return null;

  const erase = async () => {
    setDeleting(true);
    setResult(null);
    let next: { ok: boolean; text: string };
    try {
      const res = await authFetch("/api/mentor/chat/history", { method: "DELETE", skipAuthRedirect: true });
      next = res.ok ? { ok: true, text: entryT("settings_delete_done", lang) }
        : { ok: false, text: entryT(res.status === 409 ? "settings_delete_busy" : "settings_delete_failed", lang) };
    } catch { next = { ok: false, text: entryT("settings_delete_failed", lang) }; }
    setDeleting(false);
    setConfirmOpen(false);
    setResult(next);
    announce(next.text, next.ok ? "polite" : "assertive");
  };

  const usage = load.state === "ok" ? load.usage : null;
  const sub = usage?.subscriptions[0];
  const renewal = formatMentorDate(usage?.renewal_at ?? sub?.renews_at ?? null, lang);
  const expiry = formatMentorDate(usage?.next_expiry ?? null, lang);
  const pkg = mentorPackageName(usage?.source_package ?? sub?.package_id, lang);
  const manageUrl = sub?.management_url && /^https:\/\//.test(sub.management_url) ? sub.management_url : null;

  return (
    <section id="ki-mentor" data-testid="settings-mentor-card" aria-labelledby="ki-mentor-title">
      <h2 id="ki-mentor-title" className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{entryT("settings_title", lang)}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-2">
        {load.state === "loading" && <p role="status" className="min-h-11 flex items-center text-sm text-[var(--mp-fg-muted)]">…</p>}
        {load.state === "error" && (
          <div role="alert" className={ROW}>
            <span className="text-sm text-[var(--mp-fg)]">{entryT("settings_load_failed", lang)}</span>
            <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm min-h-11" onClick={() => void fetchUsage()}>{entryT("settings_retry", lang)}</button>
          </div>
        )}
        {usage && (
          <dl>
            <div className={ROW}>
              <dt className="text-sm text-[var(--mp-fg-muted)]">{entryT("settings_credits", lang)}</dt>
              <dd className="text-sm font-semibold text-[var(--mp-fg)] tabular-nums">{usage.credits_left}</dd>
            </div>
            {pkg && (
              <div className={ROW}>
                <dt className="text-sm text-[var(--mp-fg-muted)]">{entryT("settings_package", lang)}</dt>
                <dd className="text-sm font-semibold text-[var(--mp-fg)]">{pkg}</dd>
              </div>
            )}
            {renewal && (
              <div className={ROW}>
                <dt className="text-sm text-[var(--mp-fg-muted)]">{entryT("settings_renewal", lang)}</dt>
                <dd className="text-sm text-[var(--mp-fg)]">{renewal}</dd>
              </div>
            )}
            {expiry && (
              <div className={ROW}>
                <dt className="text-sm text-[var(--mp-fg-muted)]">{entryT("settings_expiry", lang)}</dt>
                <dd className="text-sm text-[var(--mp-fg)]">{expiry}</dd>
              </div>
            )}
            {usage.included_allowance && (
              <div className={ROW}>
                <dt className="text-sm text-[var(--mp-fg)]">{entryT("settings_included", lang, { n: usage.included_allowance.credits })}</dt>
                <dd />
              </div>
            )}
          </dl>
        )}
        <div className="flex flex-col py-1">
          <Link href="/mentor?from=nav" className="inline-flex items-center gap-2 min-h-11 text-sm font-semibold text-[var(--mp-viridian)]">
            <Bot className="w-4 h-4" aria-hidden />{entryT("settings_open", lang)}
          </Link>
          {manageUrl && (
            <a href={manageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 min-h-11 text-sm font-semibold text-[var(--mp-viridian)]">
              <ExternalLink className="w-4 h-4" aria-hidden />{entryT("settings_manage", lang)}
            </a>
          )}
          <button type="button" onClick={() => { setResult(null); setConfirmOpen(true); }} className="inline-flex items-center gap-2 min-h-11 text-sm font-semibold text-[var(--mp-error-text)] text-left">
            <Trash2 className="w-4 h-4" aria-hidden />{entryT("settings_delete", lang)}
          </button>
          {result && <p role={result.ok ? "status" : "alert"} className={`text-sm pb-2 ${result.ok ? "text-[var(--mp-fg)]" : "text-[var(--mp-error-text)]"}`}>{result.text}</p>}
        </div>
      </div>
      <ConfirmAction
        open={confirmOpen}
        onOpenChange={(open) => { if (!deleting) setConfirmOpen(open); }}
        title={entryT("settings_delete_title", lang)}
        consequence={entryT("settings_delete_body", lang)}
        confirmLabel={entryT("settings_delete_confirm", lang)}
        cancelLabel={entryT("settings_delete_cancel", lang)}
        pendingLabel={entryT("settings_delete_pending", lang)}
        pending={deleting}
        destructive
        onConfirm={() => void erase()}
      />
    </section>
  );
}
