"use client";

import { t as tr, type Lang } from "@/lib/i18n";
import LanguagePicker from "./LanguagePicker";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Smartphone, ExternalLink } from "lucide-react";
import { BrandedLoader } from "@/components/Logo";
import { trackEvent } from "@/lib/tracker";

/**
 * Telegram sign-in hand-off on phones (FB-08, UX-ONB-21).
 *
 * Shown when a `?tg_token=` link opens on a phone outside the installed app
 * (Telegram's in-app browser or a mobile browser tab). Most learners have not
 * installed the app, so the primary action signs in right here and says
 * plainly that the session lives only in this window. Two optional paths stay
 * reachable: a copyable link to open in Safari or Chrome, and the one-time code
 * for the installed app.
 *
 * One token, one consumer: whichever path exchanges the token first wins; the
 * others then hit the "already used" recovery on /login (UX-ONB-22).
 */
export const TELEGRAM_BOT_LINK = "https://t.me/MedPruefBot?start=web_login";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API is unavailable in some in-app WebViews: textarea fallback.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function TelegramCodeHandoff({
  code,
  lang,
  onContinueInBrowser,
  continuing = false,
  networkError = false,
}: {
  code: string;
  lang: Lang;
  onContinueInBrowser: () => void;
  /** Exchange in progress (the token is being used here). */
  continuing?: boolean;
  /** The exchange could not reach the server; the token is kept for a retry. */
  networkError?: boolean;
}) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [link, setLink] = useState("");
  const codeId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { setLink(window.location.href); }, []);

  const handleCopy = useCallback(async (what: "code" | "link") => {
    if (await copyText(what === "code" ? code : link)) {
      setCopied(what);
      trackEvent("tg_handoff_choice", { choice: what === "code" ? "code_copied" : "link_copied" });
      setTimeout(() => setCopied(null), 2500);
    }
  }, [code, link]);

  if (continuing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--mp-surface-sunken)] gap-4" role="status">
        <BrandedLoader size="lg" />
        <p className="text-sm text-[var(--mp-fg-muted)]">{tr("handoff_signing_in", lang)}</p>
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/25 flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-[var(--mp-viridian)]" aria-hidden />
          </div>
          <LanguagePicker className="mb-4" />
          <h1 ref={headingRef} tabIndex={-1} className="mp-h2 text-[var(--mp-fg)] mb-2">{tr("a22_handoff_title", lang)}</h1>
        </div>

        <div className="mp-card rounded-2xl p-5 space-y-4">
          {networkError && (
            <p role="alert" className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-3 py-2 text-sm text-[var(--mp-fg)]">
              {tr("a22_tg_network_error", lang)}
            </p>
          )}
          <button
            type="button"
            onClick={() => { trackEvent("tg_handoff_choice", { choice: "here" }); onContinueInBrowser(); }}
            className="mp-btn mp-btn--primary w-full justify-center min-h-11"
          >
            {networkError ? tr("a22_tg_retry", lang) : tr("a22_handoff_here", lang)}
          </button>
          <p className="mp-small text-[var(--mp-fg-muted)] leading-relaxed">{tr("a22_handoff_here_note", lang)}</p>

          <div className="border-t border-[var(--mp-border-subtle)] pt-4">
            <p className="text-sm font-semibold text-[var(--mp-fg)]">{tr("a22_handoff_browser_title", lang)}</p>
            <p className="mp-small text-[var(--mp-fg-muted)] mt-1">{tr("a22_handoff_browser_note", lang)}</p>
            <button
              type="button"
              onClick={() => void handleCopy("link")}
              className="mp-btn mp-btn--secondary w-full justify-center min-h-11 mt-2"
              disabled={!link}
            >
              <ExternalLink className="w-4 h-4" aria-hidden />
              {copied === "link" ? tr("a22_handoff_link_copied", lang) : tr("a22_handoff_copy_link", lang)}
            </button>
          </div>

          <div className="border-t border-[var(--mp-border-subtle)] pt-4">
            <button
              type="button"
              aria-expanded={showCode}
              aria-controls={codeId}
              onClick={() => { setShowCode((v) => !v); if (!showCode) trackEvent("tg_handoff_choice", { choice: "installed" }); }}
              className="w-full min-h-11 text-start text-sm font-semibold text-[var(--mp-cta-blue)] mp-focusable"
            >
              {tr("a22_handoff_installed", lang)}
            </button>
            <div id={codeId} hidden={!showCode} className="mt-2 space-y-3">
              <label htmlFor={`${codeId}-input`} className="block text-[13px] font-semibold text-[var(--mp-fg)]">
                {tr("a22_handoff_code_label", lang)}
              </label>
              <input
                id={`${codeId}-input`}
                readOnly
                value={code}
                onFocus={(e) => e.currentTarget.select()}
                className="mp-field__input w-full font-mono text-[13px]"
              />
              <button type="button" onClick={() => void handleCopy("code")} className="mp-btn mp-btn--secondary w-full justify-center min-h-11">
                {copied === "code" ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
                {copied === "code" ? tr("handoff_copied", lang) : tr("handoff_copy_code", lang)}
              </button>
              <p className="mp-small text-[var(--mp-fg-muted)]">{tr("a22_handoff_code_steps", lang)}</p>
              <p className="mp-small text-[var(--mp-fg-muted)]">
                {tr("a22_handoff_code_expiry", lang)}{" "}
                <a href={TELEGRAM_BOT_LINK} className="underline underline-offset-2 text-[var(--mp-cta-blue)]">{tr("a22_handoff_new_code", lang)}</a>
              </p>
            </div>
          </div>
          {/* One polite status, separate from the buttons, for the copy confirmation. */}
          <p className="sr-only" role="status" aria-live="polite">{copied ? tr("a22_handoff_copied_status", lang) : ""}</p>
        </div>
      </div>
    </main>
  );
}
