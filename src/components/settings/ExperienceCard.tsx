"use client";

/**
 * Settings "Your experience with MedPrüf" (a-free-credit-hooks L5): a
 * first-party testimonial with a separate public-use consent tick. The thank-
 * you credits are granted by an admin after a spam check, whatever the text
 * says. Reads GET /api/testimonial; renders nothing while the reward is off
 * or the state is unreadable. Sent through POST /api/feedback.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MessageSquareHeart } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { Textarea } from "@/components/ui";
import { freeCreditsCopy, TESTIMONIAL_MAX_CHARS, TESTIMONIAL_MIN_CHARS } from "@/lib/free-credits-copy";

interface State { enabled: boolean; eligible?: boolean; credits?: number; expiry_days?: number; submitted?: boolean; rewarded?: boolean }

export default function ExperienceCard({ lang }: { lang: string }) {
  const c = freeCreditsCopy(lang);
  const ids = useId();
  const [state, setState] = useState<State | null>(null);
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch("/api/testimonial", { skipAuthRedirect: true });
        const body = res.ok ? ((await res.json()) as State) : null;
        if (alive) setState(body);
      } catch { /* unreadable: render nothing */ }
    })();
    return () => { alive = false; };
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (text.trim().length < TESTIMONIAL_MIN_CHARS) { setMessage({ ok: false, text: c.expTooShort }); return; }
    inFlight.current = true;
    setBusy(true);
    let next: { ok: boolean; text: string };
    try {
      const res = await authFetch("/api/feedback", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text.trim(), context: { kind: "testimonial", consent_public: consent, lang, url: "/settings" } }) });
      if (res.ok) {
        next = { ok: true, text: c.expSent };
        setState((s) => (s ? { ...s, submitted: true } : s));
        setText("");
      } else next = { ok: false, text: c.expFailed };
    } catch { next = { ok: false, text: c.expFailed }; }
    inFlight.current = false;
    setBusy(false);
    setMessage(next);
    announce(next.text, next.ok ? "polite" : "assertive");
  }, [text, consent, c, lang]);

  const done = !!(state?.rewarded || state?.submitted);
  // Shown only to learners the reward can reach (L5 bar), or to show what they already sent.
  if (!state?.enabled || (!state.eligible && !done)) return null;
  return (
    <section id="erfahrung" data-testid="settings-experience" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{c.expTitle}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 flex flex-col gap-3">
        <p className="flex items-start gap-2 text-[14px] text-[var(--mp-fg-muted)]"><MessageSquareHeart aria-hidden size={16} className="mt-0.5 shrink-0 text-[var(--mp-viridian)]" /><span>{state.rewarded ? c.expRewarded : state.submitted && !message ? c.expSent : c.expLead(state.credits ?? 0, state.expiry_days ?? 30)}</span></p>
        {!done && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <Textarea label={c.expLabel} helper={c.expHelper} value={text} onChange={(e) => setText(e.target.value)} maxLength={TESTIMONIAL_MAX_CHARS} rows={4} />
            <label className="flex min-h-11 items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby={`${ids}-consent-help`} />
              <span>{c.expConsent}</span>
            </label>
            <p id={`${ids}-consent-help`} className="text-[13px] text-[var(--mp-fg-muted)]">{c.expConsentHelper}</p>
            <button type="submit" disabled={busy} aria-busy={busy} className="mp-btn mp-btn--primary min-h-11 self-start">{busy ? c.expSending : c.expSubmit}</button>
          </form>
        )}
        {message && <p role={message.ok ? "status" : "alert"} className={`text-[13px] ${message.ok ? "text-[var(--mp-fg)]" : "text-[var(--mp-error-text)]"}`}>{message.text}</p>}
      </div>
    </section>
  );
}
