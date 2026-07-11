"use client";

/**
 * /referrals — Referral dashboard.
 *
 * REWRITE 2026-07-11 (Praxis synthesis, spec §4 Step 5): the cash
 * program (€40 flat, then €25-75 tiered per Lock #3 2026-04-23) is
 * PAUSED for new/enrolled users — MEDPRUF-SOT.md §2.x. This page now
 * frames the referral reward as "invite 2, get Pro free through your
 * exam window" — no payout table, no payout-method dialog (nothing to
 * pay out: this is a non-cash reward). Mechanics live in
 * src/lib/referral-exam-reward.ts.
 *
 * Data source: GET /api/referrals/status (extended 2026-07-11 with
 * qualifiedActivityCount / thresholdN / proUntilExamGrantedAt).
 *
 * Voice rules (binding, MEDPRUF-SOT.md §2.x): Austrian not German, lead
 * with "Stichprobentest, 23. September (Graz)" where the exam is named,
 * no em dashes in any user-facing string, "free through the exam
 * window" never "until your exam date", no 26-Aug deadline, no prices
 * in referral copy.
 *
 * Design: MPDS v2 semantic tokens + primitives throughout — no hex
 * literals, no ad-hoc modal chrome, dark mode is a token flip.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  GraduationCap,
  Gift,
  Share2,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { EmptyState, useToast } from "@/components/ui";
import { useUserTier } from "@/lib/hooks/useUserTier";

type Lang = "de" | "en";

interface ReferralRow {
  id: string;
  status: "pending" | "qualified" | "rewarded";
  reward_type: "cash" | "pro_until_exam";
  reward_credit_cents: number;
  referral_code: string | null;
  qualified_at: string | null;
  hold_expires_at: string | null;
  rewarded_at: string | null;
  created_at: string;
  hold_reason: string | null;
  in_hold: boolean;
  claimable: boolean;
  referee_first_initial: string | null;
  referee_plan_humanname: string | null;
}

interface StatusResponse {
  referralCode: string;
  referralLink: string;
  stats: {
    totalReferrals: number;
    pending: number;
    qualifiedInHold: number;
    claimable: number;
    rewarded: number;
    earnedCents: number;
    paidOutCents: number;
    annualCapCents: number;
    annualCapRemainingCents: number;
  };
  referrals: ReferralRow[];
  payoutMethod: "crypto_wallet" | "wise_account" | null;
  payoutWalletAddress: string | null;
  payoutWalletChain: string | null;
  payoutWiseEmail: string | null;
  /**
   * Added 2026-04-24 (rescue-sprint §4): NULL means the user has
   * never copied their code. Drives the sidebar nudge-dot + some
   * micro-copy on this page.
   */
  referralCodeCopiedAt: string | null;
  /** Referral exam-reward (2026-07-11) — this referrer's activity progress. */
  qualifiedActivityCount: number;
  thresholdN: number;
  proUntilExamGrantedAt: string | null;
}

interface SocialProofResponse {
  qualifiedLast7d: number;
  qualifiedLast30d: number;
  qualifiedAllTime: number;
}

function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(
      lang === "de" ? "de-AT" : "en-GB",
      { day: "numeric", month: "short", year: "numeric" }
    );
  } catch {
    return "—";
  }
}

export default function ReferralsPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  // Invite-only gate (2026-06-25): the referral program is OFF by default.
  // We wait for tierLoading=false before showing the gate message so that
  // an enabled user never sees a flash of "not available" during the fetch.
  const { referralsEnabled, isLoading: tierLoading } = useUserTier();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [socialProof, setSocialProof] = useState<SocialProofResponse | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(
    null
  );

  const toast = useToast();

  const loadData = useCallback(async () => {
    try {
      const [statusRes, socialRes] = await Promise.allSettled([
        authFetch("/api/referrals/status"),
        authFetch("/api/referrals/social-proof", { skipAuthRedirect: true }),
      ]);

      if (statusRes.status === "fulfilled") {
        const r = statusRes.value;
        if (!r.ok) {
          if (r.status === 401) {
            window.location.href = "/login";
            return;
          }
          throw new Error(`status ${r.status}`);
        }
        const json: StatusResponse = await r.json();
        setData(json);
      } else {
        throw statusRes.reason;
      }

      // Social proof is best-effort — a failed fetch just means we
      // fall back to the "Sei der erste!" empty state.
      if (socialRes.status === "fulfilled" && socialRes.value.ok) {
        try {
          const json: SocialProofResponse = await socialRes.value.json();
          setSocialProof(json);
        } catch {
          /* non-critical */
        }
      }
    } catch (err) {
      console.error("[referrals] load", err);
      toast.error(
        lang === "de" ? "Fehler beim Laden" : "Failed to load",
        lang === "de"
          ? "Bitte Seite neu laden."
          : "Please refresh the page."
      );
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => {
    setLangState(getLang());
    const s = getStoredSession();
    setSession(s);
    setMounted(true);
    if (!s?.user?.id) {
      window.location.href = "/login";
      return;
    }
    loadData();
  }, [loadData]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const copyLink = async () => {
    if (!data?.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      toast.success(
        lang === "de" ? "Link kopiert" : "Link copied",
        lang === "de" ? "Jetzt teilen." : "Share it now."
      );
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(
        lang === "de" ? "Kopieren fehlgeschlagen" : "Copy failed",
        lang === "de"
          ? "Bitte manuell kopieren."
          : "Please copy manually."
      );
    }

    // Stamp referral_code_copied_at so the sidebar nudge-dot clears.
    // Idempotent — safe to re-fire on every click. Rescue-sprint §4.
    try {
      await authFetch("/api/referrals/mark-copied", {
        method: "POST",
        headers: { "content-type": "application/json" },
        skipAuthRedirect: true,
      });
    } catch {
      /* non-critical */
    }

    // Analytics
    try {
      const { trackEvent } = await import("@/lib/tracker");
      trackEvent("referral_code_copied", { source: "referrals_page" });
    } catch {
      /* non-critical */
    }
  };

  // Invite-message copy, one line, per user's UI language, exam-window
  // framed (MEDPRUF-SOT.md §2.x voice rules): lead with the exam+date,
  // "free through the exam window" never "until your exam date", no
  // em dashes, no price for the REFERRER's reward. Code substituted at
  // the end so the recipient has the exact link.
  //
  // Card-trial gate (2026-07-11): the qualification terms must state the
  // trial honestly per SoT §2 — card on file, 0 € today, 19 €/month
  // after 7 days unless cancelled during the trial. This is the
  // REFEREE's trial (the person clicking the link), not a charge on the
  // referrer — stated plainly so nobody reads it as a hidden fee.
  const inviteMessage = (): string => {
    if (!data?.referralLink) return "";
    return lang === "de"
      ? `Lad zwei Kolleg:innen ein: wenn beide den kostenlosen Pro-Trial starten (Karte hinterlegt, 0 € heute, danach 19 €/Monat, in der Testwoche jederzeit kündbar) und wirklich mitlernen, bekommst du Pro kostenlos durchs Prüfungsfenster: ${data.referralLink}`
      : `Invite two colleagues: once both start the free Pro trial (card on file, 0 € today, then 19 €/month, cancel anytime during the trial week) and really study along, you get Pro free through the exam window: ${data.referralLink}`;
  };

  const shareNative = async () => {
    if (!data?.referralLink) return;
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (!nav.share) {
      copyLink();
      return;
    }
    try {
      await nav.share({
        title:
          lang === "de"
            ? "MedPrüf: Österreichische Ärzteprüfung"
            : "MedPrüf: Austrian medical exam prep",
        text: inviteMessage(),
        url: data.referralLink,
      });
    } catch {
      // user cancelled; no-op
    }
  };

  const copyInviteMessage = async () => {
    const msg = inviteMessage();
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg);
      setMessageCopied(true);
      toast.success(
        lang === "de" ? "Nachricht kopiert" : "Message copied",
        lang === "de" ? "Jetzt einfügen und senden." : "Paste it and send."
      );
      setTimeout(() => setMessageCopied(false), 2500);
    } catch {
      toast.error(
        lang === "de" ? "Kopieren fehlgeschlagen" : "Copy failed",
        lang === "de" ? "Bitte manuell kopieren." : "Please copy manually."
      );
    }
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  const user = session?.user;

  // Invite-only gate: only enrolled accounts may open the referral dashboard.
  // We wait for tierLoading=false so enabled users never see a flash of the
  // "not available" screen while /api/auth/me is still in flight.
  if (!tierLoading && !referralsEnabled) {
    return (
      <div className="app-layout">
        <Sidebar
          lang={lang}
          userId={user?.id}
          userName={user?.first_name}
          totalXp={user?.xp_total ?? 0}
          streak={user?.streak_count ?? 0}
        />
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
          <div className="max-w-3xl mx-auto px-4 lg:px-8 py-16 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--mp-surface-raised)] flex items-center justify-center">
              <Gift className="w-6 h-6 text-[var(--mp-fg-muted)]" />
            </div>
            <h2 className="text-xl font-display font-bold text-[var(--mp-fg)]">
              {lang === "de"
                ? "Empfehlungsprogramm auf Einladung"
                : "Referral program by invitation"}
            </h2>
            <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed max-w-sm">
              {lang === "de"
                ? "Das Empfehlungsprogramm ist derzeit auf ausgewählte Nutzer beschränkt. Kontaktiere den Support, wenn du teilnehmen möchtest."
                : "The referral program is currently limited to selected users. Contact support if you would like to participate."}
            </p>
            <Link href="/" className="mp-btn mp-btn--secondary mt-2">
              {lang === "de" ? "Zurück zum Dashboard" : "Back to dashboard"}
            </Link>
          </div>
          <BottomNav lang={lang} />
        </main>
      </div>
    );
  }

  // Row status → (badge element, date label). Activity-qualified framing
  // (2026-07-11): a referral row now qualifies by STUDYING, not paying,
  // so the badges read "studying" / "qualified" / "Pro granted" instead
  // of the old hold/claimable/paid cash language.
  const rowMeta = (r: ReferralRow) => {
    if (r.status === "rewarded") {
      return {
        badge: (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)]">
            <Check className="w-3 h-3" />
            {lang === "de" ? "Pro vergeben" : "Pro granted"}
          </span>
        ),
        sub:
          (lang === "de" ? "Vergeben am " : "Granted ") +
          formatDate(r.rewarded_at, lang),
      };
    }
    if (r.status === "qualified") {
      return {
        badge: (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--mp-cta-blue)]/15 text-[var(--mp-cta-blue)]">
            <GraduationCap className="w-3 h-3" />
            {lang === "de" ? "Qualifiziert" : "Qualified"}
          </span>
        ),
        sub:
          (lang === "de" ? "Qualifiziert am " : "Qualified ") +
          formatDate(r.qualified_at, lang),
      };
    }
    return {
      badge: (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] border border-[var(--mp-border)]">
          {lang === "de" ? "Lernt gerade" : "Studying"}
        </span>
      ),
      sub:
        (lang === "de" ? "Angemeldet am " : "Signed up ") +
        formatDate(r.created_at, lang),
    };
  };

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={user?.id}
        userName={user?.first_name}
        totalXp={user?.xp_total ?? 0}
        streak={user?.streak_count ?? 0}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
            <Gift className="w-4 h-4 text-[var(--mp-viridian)]" />
            {lang === "de" ? "Empfehlungen" : "Referrals"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-6 space-y-6">
          {/* ─────────── Hero ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)]/10 flex items-center justify-center flex-shrink-0">
                <Gift className="w-5 h-5 text-[var(--mp-viridian)]" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl lg:text-2xl font-display font-extrabold text-[var(--mp-fg)] mb-1">
                  {lang === "de"
                    ? "Lad zwei Kolleg:innen ein, die für den Stichprobentest am 23. September in Graz lernen."
                    : "Invite two colleagues studying for the Stichprobentest on 23 September in Graz."}
                </h2>
                <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
                  {lang === "de"
                    ? "Teile deinen Link. Sobald beide den kostenlosen Pro-Trial starten (Karte hinterlegt, 0 € heute, danach 19 €/Monat) und wirklich aktiv üben, bekommst du MedPrüf Pro kostenlos durch dein Prüfungsfenster. Für dich als Empfehlenden komplett kostenlos."
                    : "Share your link. Once both start the free Pro trial (card on file, 0 € today, then 19 €/month) and are actively practising, you get MedPrüf Pro free through your exam window. Completely free for you as the referrer."}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="h-12 rounded-xl bg-[var(--mp-surface-sunken)] animate-pulse" />
            ) : (
              <>
                <div className="flex flex-col sm:flex-row items-stretch gap-2">
                  <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] font-mono text-sm text-[var(--mp-fg)] truncate">
                    <span className="truncate select-all">
                      {data?.referralLink}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="mp-btn mp-btn--primary justify-center gap-2"
                    aria-label={
                      lang === "de" ? "Link kopieren" : "Copy link"
                    }
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        {lang === "de" ? "Kopiert" : "Copied"}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        {lang === "de" ? "Kopieren" : "Copy"}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={shareNative}
                    className="mp-btn mp-btn--secondary justify-center gap-2 sm:hidden"
                    aria-label={lang === "de" ? "Teilen" : "Share"}
                  >
                    <Share2 className="w-4 h-4" />
                    {lang === "de" ? "Teilen" : "Share"}
                  </button>
                </div>

                {/* Copy-my-invite-message button (spec §4 Step 5): the
                    localized, exam-window-framed one-liner from
                    MEDPRUF-SOT.md §2.x with the user's code substituted,
                    ready to paste into a WhatsApp/Telegram study group. */}
                {data?.referralLink && (
                  <button
                    type="button"
                    onClick={copyInviteMessage}
                    className="mp-btn mp-btn--secondary justify-center gap-2 mt-3 w-full sm:w-auto"
                  >
                    {messageCopied ? (
                      <>
                        <Check className="w-4 h-4" />
                        {lang === "de" ? "Nachricht kopiert" : "Message copied"}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        {lang === "de"
                          ? "Meine Einladungsnachricht kopieren"
                          : "Copy my invite message"}
                      </>
                    )}
                  </button>
                )}

                {/* Direct social-share deeplinks (Telegram / WhatsApp /
                    X). Web Share API only fires native sheets on
                    mobile; these explicit buttons let desktop users
                    one-click into their group chats too. Pre-filled
                    with the same exam-window-framed invite message. */}
                {data?.referralLink && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wider mr-1">
                      {lang === "de" ? "Direkt teilen" : "Share directly"}
                    </span>
                    {(() => {
                      const shareText = inviteMessage();
                      const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(
                        data.referralLink,
                      )}&text=${encodeURIComponent(shareText)}`;
                      const waUrl = `https://wa.me/?text=${encodeURIComponent(
                        shareText,
                      )}`;
                      const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
                        shareText,
                      )}`;
                      const trackShare = (channel: string) => {
                        void import("@/lib/tracker").then(({ trackEvent }) => {
                          trackEvent("referral_share_clicked", {
                            channel,
                            source: "referrals_page_deeplink",
                          });
                        }).catch(() => {});
                      };
                      return (
                        <>
                          <a
                            href={tgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => trackShare("telegram")}
                            className="mp-btn mp-btn--secondary justify-center gap-2 text-sm"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            Telegram
                          </a>
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => trackShare("whatsapp")}
                            className="mp-btn mp-btn--secondary justify-center gap-2 text-sm"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            WhatsApp
                          </a>
                          <a
                            href={xUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => trackShare("x")}
                            className="mp-btn mp-btn--secondary justify-center gap-2 text-sm"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            X
                          </a>
                        </>
                      );
                    })()}
                  </div>
                )}

                <p className="mt-3 text-xs text-[var(--mp-fg-subtle)]">
                  {lang === "de" ? "Dein Code: " : "Your code: "}
                  <span className="font-mono font-bold text-[var(--mp-fg)]">
                    {data?.referralCode}
                  </span>
                </p>
              </>
            )}
          </section>

          {/* ─────────── Social proof (aggregate) ─────────── */}
          <SocialProofStrip lang={lang} proof={socialProof} />

          {/* ─────────── Progress card: "X of 2 invited are studying" ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <div className="flex items-center gap-3 mb-3">
              <GraduationCap className="w-4 h-4 text-[var(--mp-viridian)]" />
              <h3 className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Dein Fortschritt" : "Your progress"}
              </h3>
            </div>

            {data?.proUntilExamGrantedAt ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/20">
                <Check className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0" />
                <p className="text-sm text-[var(--mp-fg)]">
                  {lang === "de"
                    ? "MedPrüf Pro ist aktiv, kostenlos durch dein Prüfungsfenster."
                    : "MedPrüf Pro is active, free through your exam window."}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-display font-extrabold text-[var(--mp-viridian)] tabular-nums">
                    {data?.qualifiedActivityCount ?? 0}
                  </span>
                  <span className="text-sm text-[var(--mp-fg-muted)]">
                    {lang === "de"
                      ? `von ${data?.thresholdN ?? 2} lernen bereits aktiv`
                      : `of ${data?.thresholdN ?? 2} invited are studying`}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden"
                  role="progressbar"
                  aria-valuenow={data?.qualifiedActivityCount ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={data?.thresholdN ?? 2}
                >
                  <div
                    className="h-full bg-[var(--mp-viridian)] transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        ((data?.qualifiedActivityCount ?? 0) / (data?.thresholdN ?? 2)) * 100
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-[var(--mp-fg-muted)] mt-3 leading-relaxed">
                  {lang === "de"
                    ? "Ein Kollege oder eine Kollegin zählt, sobald sie sich mit deinem Link anmelden, den kostenlosen Pro-Trial starten (Karte hinterlegt, 0 € heute, jederzeit in der Testwoche kündbar, danach 19 €/Monat) und mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantworten."
                    : "A colleague counts once they sign up with your link, start the free Pro trial (card on file, 0 € today, cancel anytime during the trial week, then 19 €/month), and answer at least 20 different questions across at least 2 different days."}
                </p>
              </>
            )}
          </section>

          {/* ─────────── Referrals list ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-3">
              {lang === "de" ? "Deine Empfehlungen" : "Your referrals"}
            </h3>

            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 rounded-lg bg-[var(--mp-surface-sunken)] animate-pulse"
                  />
                ))}
              </div>
            ) : data?.referrals && data.referrals.length > 0 ? (
              <ul className="divide-y divide-[var(--mp-border)]">
                {data.referrals.map((r) => {
                  const meta = rowMeta(r);
                  const initial =
                    r.referee_first_initial ??
                    (lang === "de" ? "—" : "—");
                  const plan = r.referee_plan_humanname;
                  return (
                    <li
                      key={r.id}
                      className="flex items-start justify-between gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center flex-wrap gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-[var(--mp-fg)]">
                            {initial}
                          </span>
                          {plan && (
                            <span className="text-[11px] text-[var(--mp-fg-muted)] truncate">
                              · {plan}
                            </span>
                          )}
                          {meta.badge}
                        </div>
                        <div className="text-[11px] text-[var(--mp-fg-subtle)]">
                          {meta.sub}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                tone="success"
                icon={<Gift className="w-10 h-10" aria-hidden />}
                title={
                  lang === "de"
                    ? "Noch keine Empfehlungen"
                    : "No referrals yet"
                }
                body={
                  lang === "de"
                    ? "Teile deinen Link mit anderen Prüflingen. Sobald zwei den kostenlosen Pro-Trial starten und wirklich aktiv lernen, bekommst du Pro kostenlos durch dein Prüfungsfenster."
                    : "Share your link with fellow candidates. Once two start the free Pro trial and are actively studying, you get Pro free through your exam window."
                }
                action={
                  <button
                    type="button"
                    onClick={copyLink}
                    className="mp-btn mp-btn--primary gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    {lang === "de" ? "Link kopieren" : "Copy link"}
                  </button>
                }
              />
            )}
          </section>

          {/* ─────────── 3-step explainer ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-4">
              {lang === "de" ? "So funktioniert's" : "How it works"}
            </h3>
            <ol className="space-y-3">
              <li className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  1
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {lang === "de" ? "Link teilen" : "Share your link"}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                    {lang === "de"
                      ? "Sende deinen Link an zwei Kolleginnen oder Kollegen, die wirklich mit dir für den Stichprobentest am 23. September in Graz lernen."
                      : "Send your link to two colleagues who really start studying with you for the Stichprobentest on 23 September in Graz."}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  2
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {lang === "de" ? "Beide starten den Pro-Trial" : "Both start the Pro trial"}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                    {lang === "de"
                      ? "Jede Person hinterlegt eine Karte und startet den Pro-Trial: 0 € heute, jederzeit in der Testwoche kündbar, danach 19 €/Monat. Das ist der Trial deines Kollegen oder deiner Kollegin, dir wird nichts berechnet."
                      : "Each person links a card and starts the Pro trial: 0 € today, cancel anytime during the trial week, then 19 €/month. This is your colleague's trial, you are never charged."}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  3
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {lang === "de" ? "Beide üben aktiv" : "Both start practising"}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                    {lang === "de"
                      ? "Sobald jede Person mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantwortet hat, qualifiziert sich die Empfehlung."
                      : "Once each person answers at least 20 different questions across at least 2 different days, the referral qualifies."}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  4
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {lang === "de"
                      ? "Pro kostenlos durchs Prüfungsfenster"
                      : "Pro free through the exam window"}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                    {lang === "de"
                      ? "Nach der zweiten qualifizierten Empfehlung prüft unser Team kurz und schaltet MedPrüf Pro für dich frei, kostenlos bis zum Ende deines Prüfungsfensters. Für dich als Empfehlenden ist das komplett kostenlos."
                      : "After your second qualified referral, our team does a quick review and unlocks MedPrüf Pro for you, free through the end of your exam window. Completely free for you as the referrer."}
                  </p>
                  <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-1">
                    <Link href="/faq#referrals" className="underline">
                      {lang === "de"
                        ? "Mehr in der FAQ"
                        : "More in the FAQ"}
                    </Link>
                  </p>
                </div>
              </li>
            </ol>
          </section>

        </div>

        <BottomNav lang={lang} />
      </main>
    </div>
  );
}

/**
 * SocialProofStrip — the "N referrals this week" block.
 *
 * Rescue-sprint §4.5 (2026-04-24): pulls aggregate qualified-referral
 * counts from /api/referrals/social-proof. Honest numbers — no
 * invented totals. When all three windows are zero we flip to the
 * motivational "Sei der erste!" empty state, which also doubles as
 * gentle loss-aversion (the first 10 referrers get a small bonus).
 *
 * Behavior:
 *  - While fetching: render a shimmer-strip so the layout doesn't jump
 *  - All zeros: render the "first-mover" empty state
 *  - Otherwise: render the three windowed counts side by side
 */
function SocialProofStrip({
  lang,
  proof,
}: {
  lang: Lang;
  proof: SocialProofResponse | null;
}) {
  // Loading shimmer — until the first fetch returns.
  if (proof === null) {
    return (
      <section
        className="mp-card p-5 lg:p-7"
        aria-busy="true"
        aria-label={
          lang === "de"
            ? "Empfehlungsstatistik lädt"
            : "Loading referral stats"
        }
      >
        <div className="h-4 w-48 rounded bg-[var(--mp-surface-sunken)] animate-pulse mb-3" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-12 rounded-lg bg-[var(--mp-surface-sunken)] animate-pulse" />
          <div className="h-12 rounded-lg bg-[var(--mp-surface-sunken)] animate-pulse" />
          <div className="h-12 rounded-lg bg-[var(--mp-surface-sunken)] animate-pulse" />
        </div>
      </section>
    );
  }

  const allZero =
    proof.qualifiedLast7d === 0 &&
    proof.qualifiedLast30d === 0 &&
    proof.qualifiedAllTime === 0;

  // First-mover motivational state. Honest, no invented numbers —
  // empty is empty, but we make it feel like an opportunity.
  if (allZero) {
    return (
      <section
        className="mp-card p-5 lg:p-7"
        aria-label={
          lang === "de" ? "Empfehlungs-Community" : "Referral community"
        }
      >
        <p className="text-sm font-semibold text-[var(--mp-fg)]">
          {lang === "de"
            ? "Du wärst die erste Empfehlung, der Code ist neu."
            : "You'd be the first referral; the code is brand new."}
        </p>
        <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">
          {lang === "de"
            ? "Teile den Code mit jemandem aus deiner Lerngruppe, die Empfehlung zählt, sobald diese Person den kostenlosen Pro-Trial startet und aktiv übt."
            : "Share the code with someone from your study group; the referral counts once that person starts the free Pro trial and is actively practising."}
        </p>
      </section>
    );
  }

  const rows: Array<{ label: string; value: number }> = [
    {
      label:
        lang === "de"
          ? "Empfehlungen diese Woche"
          : "Referrals this week",
      value: proof.qualifiedLast7d,
    },
    {
      label:
        lang === "de" ? "Diesen Monat" : "This month",
      value: proof.qualifiedLast30d,
    },
    {
      label:
        lang === "de"
          ? "Insgesamt seit dem Launch"
          : "Since launch",
      value: proof.qualifiedAllTime,
    },
  ];

  return (
    <section
      className="mp-card p-5 lg:p-7"
      aria-label={
        lang === "de" ? "Empfehlungs-Community" : "Referral community"
      }
    >
      <p className="text-xs uppercase tracking-wider font-bold text-[var(--mp-fg-subtle)] mb-3">
        {lang === "de" ? "Community" : "Community"}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="text-2xl font-display font-extrabold text-[var(--mp-viridian)] tabular-nums">
              {row.value}
            </div>
            <div className="text-[11px] text-[var(--mp-fg-subtle)] mt-1 leading-tight">
              {row.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
