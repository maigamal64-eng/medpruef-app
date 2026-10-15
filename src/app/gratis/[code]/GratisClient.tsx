"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Gift, Sparkles } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { Alert } from "@/components/ui";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { announce } from "@/lib/announce";
import { getUiLang, renderLang } from "@/lib/i18n";
import { FREE_QUESTIONS_PER_BANK, formatCreditDate, freeCreditsCopy, redeemMessage, redeemMessageKey } from "@/lib/free-credits-copy";
import type { GuidanceLang } from "@/lib/guidance/facts";

interface Props {
  campaign: { code: string; credits: number; expiryDays: number } | null;
  maxAgeDays: number;
  lang: GuidanceLang;
}

type Result = { ok: true; text: string } | { ok: false; text: string };

/** Set when the visitor leaves this page to sign in; only then does ?redeem=1 post on return. */
const PENDING_KEY = "medpruef_gratis_pending";

export default function GratisClient({ campaign, maxAgeDays, lang }: Props) {
  const c = freeCreditsCopy(lang);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const s = getStoredSession();
    setSignedIn(!!s?.user && !String(s.user.id ?? "").startsWith("guest_"));
  }, []);

  // Without ?lang a non-German browser reads English (pick-ux-pub-03 A), as on the guidance pages.
  useEffect(() => {
    if (search.has("lang")) return;
    try {
      if (getUiLang() !== "de") {
        const params = new URLSearchParams(search.toString());
        params.set("lang", "en");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    } catch { /* The URL works when storage is unavailable. */ }
  }, [pathname, router, search]);

  const redeem = useCallback(async () => {
    if (!campaign || started.current) return;
    started.current = true;
    setBusy(true);
    let next: Result;
    try {
      const res = await authFetch("/api/mentor/campaign/redeem", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: campaign.code, via: "landing" }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; duplicate?: boolean; credits?: number; expires_at?: string | null; reason?: string } | null;
      if (res.ok && body?.ok) {
        const date = formatCreditDate(body.expires_at, lang);
        next = body.duplicate ? { ok: true, text: c.redeem.duplicate } : { ok: true, text: date ? c.redeemSuccess(body.credits ?? campaign.credits, date) : c.redeem.success };
      } else {
        next = { ok: false, text: redeemMessage(lang, res.status === 429 ? "rate_limited" : redeemMessageKey(body?.reason), maxAgeDays) };
        // A failure that a retry can fix keeps the button.
        if (res.status === 429 || res.status >= 500) started.current = false;
      }
    } catch {
      next = { ok: false, text: c.redeem.unavailable };
      started.current = false;
    }
    setBusy(false);
    setResult(next);
    announce(next.text, next.ok ? "polite" : "assertive");
  }, [campaign, c, lang, maxAgeDays]);

  // Back from sign-in or registration with ?redeem=1: one POST, but only when this
  // browser started that sign-in from this page for this code (a crafted link
  // alone never spends someone's one redemption); then the flag leaves the URL.
  useEffect(() => {
    if (!signedIn || !campaign || search.get("redeem") !== "1") return;
    const params = new URLSearchParams(search.toString());
    params.delete("redeem");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch { /* storage blocked: the button stays */ }
    if (pending === campaign.code) void redeem();
  }, [signedIn, campaign, search, pathname, redeem]);
  const markPending = () => { try { if (campaign) sessionStorage.setItem(PENDING_KEY, campaign.code); } catch { /* storage blocked */ } };

  const back = campaign ? `/gratis/${encodeURIComponent(campaign.code)}?redeem=1&lang=${lang}` : "/";
  const utm = campaign ? `&utm_source=gratis&utm_medium=code&utm_campaign=${encodeURIComponent(campaign.code.toLowerCase())}` : "";
  const registerHref = `/login?mode=register&next=${encodeURIComponent(back)}${utm}`;
  const signInHref = `/login?mode=login&next=${encodeURIComponent(back)}${utm}`;

  return (
    <div lang={lang} className="min-h-screen bg-[var(--mp-surface)] text-[var(--mp-fg)]">
      <header className="border-b border-[var(--mp-border)]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <Link href="/landing" className="font-display text-lg font-bold">MedPrüf</Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={(next) => {
              let stored: string | null = null;
              try { stored = renderLang(getUiLang()); } catch { /* storage unavailable */ }
              if (next === lang || (stored !== null && next !== stored)) return;
              const params = new URLSearchParams(search.toString());
              params.set("lang", next);
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }} />
          </div>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-3xl px-4 py-10 sm:px-5 sm:py-14">
        {campaign ? (
          <section aria-labelledby="gratis-title" data-testid="gratis-live">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--mp-viridian)]"><Gift aria-hidden size={16} />{c.landingEyebrow}</p>
            <h1 id="gratis-title" className="mt-3 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{c.landingTitle(campaign.credits)}</h1>
            <p className="mt-4 text-lg leading-relaxed text-[var(--mp-fg-muted)]">{c.landingLead(campaign.credits)}</p>
            <div className="mp-card mt-8 flex flex-col gap-3 p-5">
              <p className="flex items-start gap-2"><Sparkles aria-hidden size={18} className="mt-1 shrink-0 text-[var(--mp-viridian)]" /><span>{c.landingWhat}</span></p>
              <p>{c.landingExpiry(campaign.expiryDays)}</p>
              <p>{c.landingRule(maxAgeDays)}</p>
              <p className="text-[var(--mp-fg-muted)]">{c.landingFreeStart(FREE_QUESTIONS_PER_BANK)}</p>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row" aria-live="polite">
              {signedIn === false && (
                <>
                  <Link href={registerHref} onClick={markPending} className="mp-btn mp-btn--primary min-h-11 justify-center" data-testid="gratis-register">{c.landingRegister}</Link>
                  <Link href={signInHref} onClick={markPending} className="mp-btn mp-btn--secondary min-h-11 justify-center">{c.landingSignIn}</Link>
                </>
              )}
              {signedIn === true && !result?.ok && (
                <button type="button" onClick={() => void redeem()} disabled={busy} aria-busy={busy} className="mp-btn mp-btn--primary min-h-11 justify-center" data-testid="gratis-redeem">{busy ? c.landingRedeeming : c.landingRedeemNow}</button>
              )}
              {result?.ok && <Link href="/mentor" className="mp-btn mp-btn--primary min-h-11 justify-center">{c.landingToMentor}</Link>}
            </div>
            {result && <div className="mt-4" data-testid="gratis-result"><Alert variant={result.ok ? "success" : "warning"}>{result.text}</Alert></div>}
          </section>
        ) : (
          <section aria-labelledby="gratis-title" data-testid="gratis-inactive">
            <h1 id="gratis-title" className="break-words text-3xl font-semibold leading-tight tracking-tight">{c.landingInactiveTitle}</h1>
            <p className="mt-4 text-lg leading-relaxed text-[var(--mp-fg-muted)]">{c.landingInactiveBody(FREE_QUESTIONS_PER_BANK)}</p>
            <Link href="/login?intent=free" className="mp-btn mp-btn--primary mt-8 inline-flex min-h-11">{c.landingInactiveCta}</Link>
          </section>
        )}
      </main>
    </div>
  );
}
