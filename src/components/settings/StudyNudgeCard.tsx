"use client";

/**
 * LX-11 study reminders in Settings (a30). Reads GET /api/nudge and renders
 * nothing while the sender is off, still loading or unreadable
 * (UX-GLOBAL-40: no reminder promise without a working sender). An email
 * opt-in is shown as pending until the learner clicks the confirmation link,
 * never as on. Telegram appears only when the server offers it (flag on and
 * the account started the customer bot). Failed saves keep the last saved state.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { Switch } from "@/components/ui";
import { studyNudgeCopy } from "./study-nudge-copy";
import { parseNudgeState, type Channel, type NudgeState } from "./study-nudge-state";

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function StudyNudgeCard({ lang }: { lang: string }) {
  const c = studyNudgeCopy(lang);
  const ids = useId();
  const [state, setState] = useState<NudgeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch("/api/nudge", { skipAuthRedirect: true });
        const next = res.ok ? parseNudgeState(await res.json()) : null;
        if (alive) setState(next);
      } catch { /* unreadable: render nothing */ }
    })();
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (optIn: boolean, channel: Channel, hour: number) => {
    if (!state || inFlight.current) return;
    inFlight.current = true;
    const previous = state;
    // The chosen channel and hour show at once; a failed save puts the saved state back.
    setState({ ...state, channel, hour });
    setBusy(true);
    setMessage({ ok: true, text: c.saving });
    let next: { ok: boolean; text: string };
    try {
      const res = await authFetch("/api/nudge", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opt_in: optIn, channel, hour }) });
      const body = res.ok ? await res.json().catch(() => null) as { opt_in?: boolean; confirmation_pending?: boolean } | null : null;
      if (res.ok && body) {
        const pending = body.confirmation_pending === true;
        setState({ ...state, opt_in: body.opt_in === true, channel, hour, confirmation_pending: pending });
        next = { ok: true, text: pending ? c.pending : c.saved };
      } else {
        setState(previous);
        next = { ok: false, text: res.status === 429 ? c.rateLimited : c.failed };
      }
    } catch { setState(previous); next = { ok: false, text: c.failed }; }
    inFlight.current = false;
    setBusy(false);
    setMessage(next);
    announce(next.text, next.ok ? "polite" : "assertive");
  }, [state, c]);

  if (!state) return null;
  const channels: Channel[] = [...(state.email_available || state.channel === "email" ? ["email" as const] : []), ...(state.telegram_available ? ["telegram" as const] : [])];
  const noDestination = !state.email_available && !state.telegram_available;
  const activeOrPending = state.opt_in || state.confirmation_pending;
  const channelName = state.channel === "telegram" ? c.telegram : c.email;
  const status = state.opt_in ? c.on(channelName, hh(state.hour)) : state.confirmation_pending ? c.pending : c.off;

  return (
    <section id="lernerinnerungen" data-testid="settings-study-nudge" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{c.title}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <BellRing className="w-5 h-5 mt-0.5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
          <Switch
            className="flex-1 min-w-0 min-h-11"
            checked={activeOrPending}
            label={c.switchLabel}
            description={c.lead}
            disabled={busy || (noDestination && !activeOrPending)}
            onChange={(next) => void save(next, channels.includes(state.channel) ? state.channel : channels[0] ?? "email", state.hour)}
          />
        </div>
        <p className="text-sm text-[var(--mp-fg)]" data-testid="study-nudge-status">{status}</p>
        {noDestination && !activeOrPending && <p className="text-sm text-[var(--mp-fg-muted)]">{c.noDestination}</p>}
        {activeOrPending && (
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {channels.length > 1 && (
              <fieldset className="min-w-0">
                <legend className="text-xs font-semibold text-[var(--mp-fg-muted)] pb-1">{c.channel}</legend>
                <div className="flex gap-4">
                  {channels.map((ch) => (
                    <label key={ch} className="inline-flex items-center gap-2 min-h-11 text-sm text-[var(--mp-fg)] cursor-pointer">
                      <input type="radio" name={`${ids}-channel`} value={ch} checked={state.channel === ch} disabled={busy}
                        onChange={() => void save(true, ch, state.hour)} className="w-4 h-4" />
                      {ch === "telegram" ? (state.telegram_handle ? `${c.telegram} (${state.telegram_handle})` : c.telegram) : c.email}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--mp-fg-muted)]">
              {c.hour}
              <select className="mp-field min-h-11 text-sm font-normal text-[var(--mp-fg)]" value={state.hour} disabled={busy}
                onChange={(e) => void save(true, state.channel, Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
              </select>
            </label>
          </div>
        )}
        {activeOrPending && state.channel === "telegram" && <p className="text-xs text-[var(--mp-fg-muted)]">{c.telegramStart}</p>}
        {activeOrPending && <p className="text-xs text-[var(--mp-fg-muted)]">{c.unsubscribe}</p>}
        {message && <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-[var(--mp-fg-muted)]" : "text-[var(--mp-error-text)]"}`}>{message.text}</p>}
      </div>
    </section>
  );
}
