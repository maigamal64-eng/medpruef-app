"use client";

/**
 * EmailConfirmLine (a-email-confirm-trial): one calm Home line for an email
 * account that has not confirmed its address yet, at most 7 days old, with a
 * rate-limited "send the link again". Asks /api/email-confirm only while
 * /api/auth/me reports email_confirm (EMAIL_CONFIRM_ENABLED, default off), so
 * nothing is fetched or rendered while the step is off. Never a gate: the
 * line blocks nothing and the free sample stays open.
 */
import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { EMAIL_CONFIRM_COPY, fillConfirm, type ConfirmLang } from "@/lib/email-confirm/copy";

type Status = { pending: true; email: string; trial: boolean; sent: boolean } | { pending: false };
type SendState = "idle" | "sending" | "sent" | "wait" | "failed";

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Status }>();

export default function EmailConfirmLine({ userId, lang, className = "" }: { userId: string; lang: ConfirmLang; className?: string }) {
  const { emailConfirm } = useUserTier();
  const [status, setStatus] = useState<Status | null>(null);
  const [send, setSend] = useState<SendState>("idle");
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    if (!emailConfirm || !userId) {
      setStatus(null);
      return;
    }
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setStatus(hit.value);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/email-confirm", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { enabled?: boolean; pending?: boolean; email?: unknown; trial?: unknown; sent?: unknown };
        const value: Status = body.enabled && body.pending && typeof body.email === "string"
          ? { pending: true, email: body.email, trial: body.trial === true, sent: body.sent === true }
          : { pending: false };
        cache.set(userId, { at: Date.now(), value });
        if (live) setStatus(value);
      } catch {
        /* the line simply stays hidden */
      }
    })();
    return () => { live = false; };
  }, [emailConfirm, userId]);

  if (!emailConfirm || !status || !status.pending) return null;
  const t = EMAIL_CONFIRM_COPY[lang].home;

  const onSend = async () => {
    if (send === "sending") return;
    setSend("sending");
    try {
      const res = await fetch("/api/email-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { email?: unknown; pending?: boolean };
        if (body.pending === false) {
          cache.set(userId, { at: Date.now(), value: { pending: false } });
          setStatus({ pending: false });
          return;
        }
        setSentTo(typeof body.email === "string" ? body.email : status.email);
        cache.set(userId, { at: Date.now(), value: { ...status, sent: true } });
        setSend("sent");
        return;
      }
      setSend(res.status === 429 ? "wait" : "failed");
    } catch {
      setSend("failed");
    }
  };

  const note = send === "sent" ? fillConfirm(t.sent, { email: sentTo })
    : send === "wait" ? t.wait
    : send === "failed" ? t.failed
    : null;

  return (
    <section
      data-email-confirm-line
      className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <MailCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-[var(--mp-fg)]">{status.trial ? t.lineTrial : t.line}</p>
          {send !== "sent" && (
            <button
              type="button"
              onClick={onSend}
              aria-busy={send === "sending"}
              className="mt-1 inline-flex items-center min-h-11 text-sm font-semibold text-[var(--mp-viridian)] underline underline-offset-2 disabled:opacity-60"
            >
              {send === "sending" ? t.sending : status.sent ? t.resend : t.send}
            </button>
          )}
          <p role="status" aria-live="polite" className="text-xs leading-snug text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]">
            {note ?? ""}
          </p>
        </div>
      </div>
    </section>
  );
}
