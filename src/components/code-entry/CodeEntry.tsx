"use client";

import { userTierStore } from "@/lib/hooks/useUserTier";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { Alert } from "@/components/ui";
import { announce } from "@/lib/announce";
import { getStoredSession } from "@/lib/auth";
import { renderLang, useLang } from "@/lib/i18n";
import { formatCreditDate } from "@/lib/free-credits-copy";
import { codeAtSignupSurfaceEnabled, normalizeTypedCode, type CodeResult } from "@/lib/code-entry";
import { codeEntryCopy } from "@/lib/code-entry/copy";
import { clearPendingCode, isRetryable, redeemCode, rememberTypedCode } from "@/lib/code-entry/client";

/**
 * "Code einlösen" entry on the landing hero and below the Home hero
 * (a-code-front-door). Signed out: keeps the code, makes it the first touch
 * and goes to the register form; the code is redeemed after sign-in by
 * PendingCodeRedeemer. Signed in (Home): redeems on the spot. Renders nothing
 * while the build flag is off.
 */
export default function CodeEntry({ surface, tone = "light", className = "" }: { surface: "landing" | "home"; tone?: "light" | "dark"; className?: string }) {
  const uiLang = useLang();
  const c = codeEntryCopy(renderLang(uiLang));
  const lang = renderLang(uiLang);
  const router = useRouter();
  const inputId = useId();
  const openRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const s = getStoredSession();
    setSignedIn(!!s?.user && !String(s.user.id ?? "").startsWith("guest_"));
  }, []);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!codeAtSignupSurfaceEnabled()) return null;

  const dark = tone === "dark";
  const say = (text: string, ok: boolean) => announce(text, ok ? "polite" : "assertive");
  const close = () => { setOpen(false); setError(null); requestAnimationFrame(() => openRef.current?.focus()); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    const code = normalizeTypedCode(value);
    if (!code) { setError(c.fieldInvalid); say(c.fieldInvalid, false); inputRef.current?.focus(); return; }
    setError(null);
    if (!signedIn) {
      const kept = rememberTypedCode(value, surface);
      if (!kept) return;
      router.push("/login?mode=register&next=%2F");
      return;
    }
    busyRef.current = true; setBusy(true); say(c.working, true);
    const r: CodeResult = await redeemCode(code, surface);
    busyRef.current = false; setBusy(false);
    if (r.ok) {
      // a-release-int-5: a seat grants Pro at once; refresh the tier store so Home shows it.
      if (r.kind === "seat") void userTierStore().refresh();
      const text = r.duplicate ? c.duplicate
        : r.kind === "referral" ? c.successReferral
        : r.kind === "seat" ? c.successSeat(formatCreditDate(r.expiresAt, lang), typeof r.credits === "number" ? r.credits : 0)
        : typeof r.credits === "number" && r.credits > 0 ? c.successCampaign(r.credits, formatCreditDate(r.expiresAt, lang))
        : c.successCampaignPlain;
      clearPendingCode();
      setDone(text); setOpen(false); setValue(""); say(text, true);
      return;
    }
    const text = c.failures[r.reason];
    if (!isRetryable(r.reason)) clearPendingCode();
    setError(text); say(text, false); inputRef.current?.focus();
  };

  const linkTone = dark ? "text-white/75 hover:text-white focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)]" : "text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] focus:ring-[var(--mp-accent-teal)]";

  return (
    <div className={className} data-testid={`code-entry-${surface}`}>
      {done ? (
        <div data-testid="code-entry-done"><Alert variant="success">{done}</Alert></div>
      ) : !open ? (
        <button ref={openRef} type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={`${inputId}-panel`}
          className={`inline-flex min-h-11 items-center gap-2 rounded text-[13px] font-semibold underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-offset-2 ${linkTone}`}>
          <Ticket aria-hidden size={15} />{c.entryOpen}
        </button>
      ) : (
        <form id={`${inputId}-panel`} onSubmit={submit} noValidate className="max-w-sm space-y-2">
          <label htmlFor={inputId} className={`block text-[13px] font-semibold ${dark ? "text-white" : "text-[var(--mp-fg)]"}`}>{c.entryLabel}</label>
          <input ref={inputRef} id={inputId} value={value} onChange={(e) => { setValue(e.target.value); setError(null); }}
            inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={40}
            aria-invalid={!!error} aria-describedby={error ? `${inputId}-err` : !signedIn ? `${inputId}-hint` : undefined}
            className="mp-field__control min-h-11 w-full rounded-lg border border-[var(--mp-border-control)] bg-[var(--mp-surface-raised)] px-3 text-[15px] text-[var(--mp-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--mp-accent-teal)]" />
          {error && <p id={`${inputId}-err`} role="alert" className={`text-[13px] ${dark ? "text-[#FFB4B4]" : "text-[var(--mp-error-text)]"}`}>{error}</p>}
          {!signedIn && !error && <p id={`${inputId}-hint`} className={`text-[12px] ${dark ? "text-white/70" : "text-[var(--mp-fg-muted)]"}`}>{c.entryHintSignedOut}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="mp-btn mp-btn--primary min-h-11">{signedIn ? c.entrySubmitSignedIn : c.entrySubmitSignedOut}</button>
            <button type="button" onClick={close} className={`inline-flex min-h-11 items-center rounded px-2 text-[13px] underline underline-offset-2 ${linkTone}`}>{c.entryClose}</button>
            {!signedIn && <a href="/login?mode=login&next=%2F" onClick={() => { rememberTypedCode(value, surface); }} className={`inline-flex min-h-11 items-center rounded px-2 text-[13px] underline underline-offset-2 ${linkTone}`}>{c.entryHaveAccount}</a>}
          </div>
        </form>
      )}
    </div>
  );
}
