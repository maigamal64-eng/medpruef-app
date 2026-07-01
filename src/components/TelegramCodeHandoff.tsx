"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Smartphone, ArrowRight } from "lucide-react";
import { BrandedLoader } from "@/components/Logo";

/**
 * Mobile-PWA login hand-off screen (FB-08, 2026-07-01).
 *
 * Rendered by the home page when a `?tg_token=` login link is opened on a
 * phone OUTSIDE the installed app — i.e. inside Telegram's in-app browser
 * or a mobile browser tab. Auto-exchanging the token there would mint the
 * session in that throwaway/isolated storage, so the installed PWA (where
 * the user studies) would still be logged out.
 *
 * The robust cross-context fix: don't exchange here. Show the one-time
 * code, the user opens the MedPrüf app and pastes it on the login screen
 * ("Sign in with Telegram code"), and the session mints inside the app.
 * Same single-use, 10-minute token, exchanged through the same audited
 * /api/auth path — no weakened security.
 *
 * "Continue in this browser" is the escape hatch for users who genuinely
 * study in the mobile browser (not the installed app): it runs the normal
 * exchange in this context. The token is single-use, so whichever path
 * the user takes first wins and the other becomes a no-op.
 */
export default function TelegramCodeHandoff({
  code,
  lang,
  onContinueInBrowser,
}: {
  code: string;
  lang: "de" | "en";
  onContinueInBrowser: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [continuing, setContinuing] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard API is unavailable in some in-app WebViews / insecure
      // contexts. Fall back to a hidden textarea + execCommand.
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      } catch {
        /* give up — the code is visible on screen for manual copy */
      }
    }
  }, [code]);

  const t = {
    heading: lang === "de" ? "Fast geschafft" : "Almost there",
    lead:
      lang === "de"
        ? "Um dich in der installierten MedPrüf-App anzumelden, kopiere diesen Code, öffne die App und füge ihn dort ein."
        : "To sign in to the installed MedPrüf app, copy this code, open the app, and paste it there.",
    codeLabel:
      lang === "de" ? "Dein Anmelde-Code (10 Min. gültig)" : "Your sign-in code (valid 10 min)",
    copy: lang === "de" ? "Code kopieren" : "Copy code",
    copied: lang === "de" ? "Kopiert" : "Copied",
    steps:
      lang === "de"
        ? [
            "Code kopieren (Button oben).",
            "MedPrüf-App vom Home-Bildschirm öffnen.",
            'Zur Anmeldung gehen, auf „Mit Telegram-Code anmelden“ tippen und einfügen.',
          ]
        : [
            "Copy the code (button above).",
            "Open the MedPrüf app from your home screen.",
            'Go to sign in, tap "Sign in with Telegram code" and paste it.',
          ],
    noApp:
      lang === "de"
        ? "MedPrüf noch nicht installiert? Füge die App über das Browser-Menü „Zum Home-Bildschirm“ hinzu, dann melde dich mit dem Code an."
        : "MedPrüf not installed yet? Add it via your browser menu “Add to Home Screen”, then sign in with the code.",
    continue:
      lang === "de" ? "Stattdessen hier im Browser anmelden" : "Sign in here in this browser instead",
  };

  if (continuing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)] gap-4">
        <BrandedLoader size="lg" />
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {lang === "de" ? "Anmeldung läuft..." : "Signing in..."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/25 flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-[var(--mp-viridian)]" aria-hidden />
          </div>
          <h1 className="mp-h2 text-[var(--mp-fg)] mb-2">{t.heading}</h1>
          <p className="mp-small text-[var(--mp-fg-muted)] leading-relaxed">{t.lead}</p>
        </div>

        <div className="mp-card rounded-2xl p-5 space-y-4">
          {/* Code + copy */}
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-[var(--mp-fg-subtle)] mb-2" style={{ letterSpacing: "0.08em" }}>
              {t.codeLabel}
            </p>
            <div
              className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-3 py-3 font-mono text-[13px] text-[var(--mp-fg)] break-all select-all"
              aria-label={t.codeLabel}
            >
              {code}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="mp-btn mp-btn--primary w-full justify-center mt-3"
              aria-live="polite"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" aria-hidden />
                  {t.copied}
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" aria-hidden />
                  {t.copy}
                </>
              )}
            </button>
          </div>

          {/* Steps */}
          <ol className="space-y-2.5 pt-1">
            {t.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--mp-viridian)] text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="mp-small text-[var(--mp-fg-muted)]">{step}</span>
              </li>
            ))}
          </ol>

          <p className="mp-small text-[var(--mp-fg-subtle)] leading-snug border-t border-[var(--mp-border-subtle)] pt-3">
            {t.noApp}
          </p>
        </div>

        {/* Escape hatch — sign in right here */}
        <button
          type="button"
          onClick={() => {
            setContinuing(true);
            onContinueInBrowser();
          }}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--mp-cta-blue)] hover:opacity-80 transition-opacity mt-5 mp-focusable py-2"
        >
          {t.continue}
          <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
