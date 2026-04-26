"use client";

/**
 * TelegramActivationCard — slim banner shown on /dashboard when the
 * user registered via the Telegram Login Widget but never DM'd the
 * bot. Without an active chat session we can't push them messages —
 * 47 of 96 users were in this state when the card shipped.
 *
 * Renders only when:
 *   - users.telegram_id IS NOT NULL (we know their Telegram identity)
 *   - users.telegram_chat_id_confirmed IS NULL (they haven't said hi
 *     to the bot yet)
 *
 * Click → opens https://t.me/MedPruefBot?start=auth_<user_id> in a
 * new tab. The bot's /start auth_<uuid> handler (in
 * /api/telegram/webhook) stamps users.telegram_chat_id_confirmed and
 * replies with a thank-you message.
 *
 * The card auto-hides ~5s after the bot confirms (we re-fetch the
 * /api/auth response on focus and hide when telegram_chat_id_confirmed
 * is set).
 *
 * review-2026-04-26-B2.
 */

import { useEffect, useState } from "react";
import { Send, ExternalLink, X } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { authFetch as fetch } from "@/lib/authFetch";

type ActivationState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "show"; userId: string }
  | { kind: "confirmed" };

const DISMISS_KEY = "medpruef_tg_activation_dismissed";

export default function TelegramActivationCard() {
  const lang = useLang();
  const [state, setState] = useState<ActivationState>({ kind: "loading" });

  // Initial load: hit /api/auth to get the user's row including
  // telegram_id + telegram_chat_id_confirmed. We deliberately use the
  // GET endpoint that returns the current session shape instead of
  // reading from localStorage — the cached session may not yet carry
  // these new fields after a deploy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // F16 fix (2026-04-26): the card prompts users to "activate the bot"
      // but if they are ALREADY IN the Telegram WebApp, the bot session is
      // already live — the card is confusing and misleading. Hide it.
      try {
        const tgWin = window as Window & {
          Telegram?: { WebApp?: { initData?: string } };
        };
        if (typeof window !== "undefined" && tgWin.Telegram?.WebApp?.initData) {
          if (!cancelled) setState({ kind: "hidden" });
          return;
        }
      } catch {
        /* Telegram WebApp API may not be available */
      }

      // Honor local dismissal — user shouldn't see it twice in a session.
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") {
          if (!cancelled) setState({ kind: "hidden" });
          return;
        }
      } catch {
        /* localStorage may be disabled */
      }

      try {
        const r = await fetch("/api/user/telegram-activation-state");
        if (!r.ok) {
          if (!cancelled) setState({ kind: "hidden" });
          return;
        }
        const body = (await r.json()) as {
          user_id?: string | null;
          telegram_id?: number | null;
          telegram_chat_id_confirmed?: string | null;
        };
        if (cancelled) return;
        if (!body.telegram_id) {
          // User didn't register via Telegram — card not relevant.
          setState({ kind: "hidden" });
          return;
        }
        if (body.telegram_chat_id_confirmed) {
          // Already activated — nothing to do.
          setState({ kind: "hidden" });
          return;
        }
        if (!body.user_id) {
          setState({ kind: "hidden" });
          return;
        }
        setState({ kind: "show", userId: body.user_id });
      } catch {
        if (!cancelled) setState({ kind: "hidden" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-poll on tab-focus — when the user comes back from Telegram, we
  // want to detect that they activated the bot and hide the card.
  useEffect(() => {
    if (state.kind !== "show") return;
    const onFocus = async () => {
      try {
        const r = await fetch("/api/user/telegram-activation-state");
        if (!r.ok) return;
        const body = (await r.json()) as { telegram_chat_id_confirmed?: string | null };
        if (body.telegram_chat_id_confirmed) setState({ kind: "confirmed" });
      } catch {
        /* swallow */
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state.kind]);

  // Auto-hide after 5s on the confirmed state.
  useEffect(() => {
    if (state.kind !== "confirmed") return;
    const t = setTimeout(() => setState({ kind: "hidden" }), 5000);
    return () => clearTimeout(t);
  }, [state.kind]);

  if (state.kind === "loading" || state.kind === "hidden") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* noop */
    }
    setState({ kind: "hidden" });
  };

  if (state.kind === "confirmed") {
    return (
      <div
        className="rounded-xl border px-4 py-3 flex items-center gap-3 mb-4"
        style={{
          borderColor: "color-mix(in srgb, var(--mp-viridian) 35%, transparent)",
          background: "color-mix(in srgb, var(--mp-viridian) 8%, transparent)",
        }}
        role="status"
        aria-live="polite"
      >
        <Send className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
        <p className="text-sm text-[var(--mp-fg)]">
          {lang === "de"
            ? "Telegram-Benachrichtigungen sind aktiv."
            : "Telegram notifications are now active."}
        </p>
      </div>
    );
  }

  // state.kind === "show"
  const botUrl = `https://t.me/MedPruefBot?start=auth_${state.userId}`;

  return (
    <div
      className="rounded-xl border px-4 py-3 mb-4 relative"
      style={{
        borderColor: "color-mix(in srgb, var(--mp-cta-blue) 35%, transparent)",
        background: "color-mix(in srgb, var(--mp-cta-blue) 6%, transparent)",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={lang === "de" ? "Schließen" : "Dismiss"}
        className="absolute top-2 right-2 text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <Send className="w-5 h-5 text-[var(--mp-cta-blue)] mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--mp-fg)]">
            {lang === "de"
              ? "Erhalte MedPrüf-Updates auf Telegram"
              : "Get MedPrüf updates on Telegram"}
          </p>
          <p className="text-xs text-[var(--mp-fg-muted)] mt-0.5 leading-relaxed">
            {lang === "de"
              ? "Schalte den Bot mit einem Klick frei — antworte direkt, [name] liest mit."
              : "Activate the bot in one tap — reply directly, [name] reads every message."}
          </p>
          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-cta-blue)] hover:underline"
          >
            {lang === "de" ? "Bot freischalten" : "Activate bot"}
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
