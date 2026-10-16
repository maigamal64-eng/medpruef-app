"use client";
/**
 * Opt-in study reminder for tomorrow (a-activation-48h), on the a30 study
 * nudge sender. Renders only when GET /api/nudge says the sender is on
 * (STUDY_NUDGE_ENABLED) and the learner has no reminder yet, so nothing
 * promises a message that no sender would send. The hour is this hour in
 * Vienna (kept inside the sender's 06 to 22); Telegram when the learner's
 * linked account can receive it, otherwise email with the confirmation link.
 * The sender writes only when the learner has not practised that day.
 */
import { useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { trackEvent } from "@/lib/tracker";
import { at } from "@/lib/activation/copy";
import { announce } from "@/lib/announce";

interface NudgeState {
  enabled?: boolean;
  opt_in?: boolean | null;
  confirmation_pending?: boolean;
  email_available?: boolean;
  telegram_available?: boolean;
}

type Phase = "idle" | "saving" | "saved" | "pending" | "failed";

export default function ActivationReminder({ lang, hour, exam, source }: { lang: string; hour: number; exam: string; source: "quiz" | "home" }) {
  const [channel, setChannel] = useState<"email" | "telegram" | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    authFetch("/api/nudge", { timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: NudgeState | null) => {
        if (!live || !s || s.enabled !== true || s.opt_in === true || s.confirmation_pending === true) return;
        const ch = s.telegram_available ? "telegram" : s.email_available ? "email" : null;
        setChannel(ch);
        if (ch) trackEvent("activation_step", { step: "reminder_shown", exam, lang });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [exam, lang]);

  if (!channel) return null;

  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("saving");
    try {
      const r = await authFetch("/api/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opt_in: true, channel, hour }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
      const body = (await r.json().catch(() => null)) as { ok?: boolean; opt_in?: boolean; confirmation_pending?: boolean } | null;
      if (!r.ok || body?.ok !== true) throw new Error("not saved");
      if (body.opt_in === true) {
        setPhase("saved");
        announce(at("reminder_saved", lang));
        trackEvent("activation_step", { step: "reminder_saved", exam, lang });
      } else if (body.confirmation_pending === true) {
        setPhase("pending");
        announce(at("reminder_pending", lang));
        trackEvent("activation_step", { step: "reminder_pending", exam, lang });
      } else {
        throw new Error("unexpected");
      }
    } catch {
      setPhase("failed");
      announce(at("reminder_failed", lang));
    } finally {
      busy.current = false;
    }
  };

  const body = at(channel === "telegram" ? "reminder_body_telegram" : "reminder_body_email", lang).replace("{hour}", String(hour));

  return (
    <div data-activation="reminder" data-source={source} className="mt-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 text-left">
      <div className="flex items-start gap-2.5">
        <BellRing className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--mp-fg)]">{at("reminder_title", lang)}</p>
          {phase === "saved" || phase === "pending" ? (
            <p role="status" className="mt-0.5 text-sm leading-snug text-[var(--mp-fg)]">
              {at(phase === "saved" ? "reminder_saved" : "reminder_pending", lang)}
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg-muted)]">{body}</p>
              <button
                type="button"
                onClick={save}
                aria-busy={phase === "saving" || undefined}
                aria-disabled={phase === "saving" || undefined}
                className="mp-btn mp-btn--secondary mt-2 min-h-11"
              >
                {phase === "saving" ? at("reminder_saving", lang) : at("reminder_button", lang)}
              </button>
              {phase === "failed" && (
                <p role="alert" className="mt-1 text-xs text-[var(--mp-error-text)]">{at("reminder_failed", lang)}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
