"use client";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import {
  referralDisclosure,
  referralMentorCreditsCopy,
  referralEmptyLine,
  referralInviteMessage,
  referralRewardBullets,
  referralRewardSentence,
  referralRowState,
  referralWindowDefinition,
} from "@/lib/referral-copy";
import { referralNativeSharePayload, referralShareUrls } from "@/lib/referrals";

import { DataRegion } from "@/components/ui/DataRegion";

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
 * Copy (a21, 2026-10-12): the reward sentence, the window definition,
 * the invite message, row states and the empty line all come from
 * src/lib/referral-copy.ts (UX-ACC-50, TR-27). Formal Sie, no em dashes,
 * no automation or timing promise, "Wir bestätigen das persönlich".
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
import { getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";
import { forgetReferralStatus } from "@/lib/hooks/useReferralCodeCopied";
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
  /** a-mentor-open: referral mentor credits per first payment, present only while the program is on. */
  mentorCredits?: number;
  mentorCreditTerms?: { monthlyCap: number; trialStartCredits: number | null; trialStartMonthlyCap: number | null };
}

interface SocialProofResponse {
  qualifiedLast7d: number;
  qualifiedLast30d: number;
  qualifiedAllTime: number;
}

function formatDate(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(
      lang === "de" ? "de-AT" : "en-GB",
      { day: "numeric", month: "short", year: "numeric" }
    );
  } catch {
    return "";
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

  const [dataError, setDataError] = useState(false);
  const loadData = useCallback(async () => {
    setLoading(true); setDataError(false);
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
        if (!json || typeof json !== "object") throw new Error("Invalid referrals");
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
      setDataError(true);
    } finally {
      setLoading(false);
    }
  }, []);

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
    setLangState(l);
  };

  const copyLink = async () => {
    if (!data?.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
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
      forgetReferralStatus();
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

  // TR-27: every share path (native share, Telegram, WhatsApp, copy
  // message) sends the one invite from referral-copy.ts: written to the
  // friend, free path first, the trial with its terms, and the sender's
  // reward disclosed in the first person.
  const inviteMessage = (): string => {
    if (!data?.referralLink) return "";
    return referralInviteMessage(lang, data.referralLink, data.mentorCredits, data.mentorCreditTerms);
  };

  const shareNative = async () => {
    if (!data?.referralLink) return;
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (!nav.share) {
      void copyInviteMessage();
      return;
    }
    try {
      await nav.share(
        referralNativeSharePayload(inviteMessage(), "MedPrüf"),
      );
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
  const copiedWord = lang === "de" ? "Kopiert" : "Copied";

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
            {(() => {
              // UX-ACC-49 / UX-PUB-39: a real support link, no time promise.
              const gate = lang === "de"
                ? {
                    body: "Das Empfehlungsprogramm ist derzeit auf ausgewählte Konten beschränkt. Wenn Sie teilnehmen möchten, schreiben Sie uns an",
                    reply: "Wir melden uns per E-Mail.",
                    home: "Zur Startseite",
                  }
                : {
                    body: "The referral program is currently limited to selected accounts. If you would like to take part, write to us at",
                    reply: "We will reply by email.",
                    home: "Go to home",
                  };
              return (
                <>
                  <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed max-w-sm">
                    {gate.body}{" "}
                    <a
                      href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent("Empfehlungsprogramm")}`}
                      className="font-semibold text-[var(--mp-fg)] underline break-all"
                    >
                      {BILLING_SUPPORT_EMAIL}
                    </a>
                    . {gate.reply}
                  </p>
                  <Link href="/" className="mp-btn mp-btn--secondary mt-2 min-h-[44px]">
                    {gate.home}
                  </Link>
                </>
              );
            })()}
          </div>
          <BottomNav lang={lang} />
        </main>
      </div>
    );
  }

  // Row status → (badge, date line), UX-ACC-50 states from referral-copy.
  // The status API exposes only the referral row status per referee:
  // `pending` (signed up, conditions not yet met) and `qualified` /
  // `rewarded` (all three conditions met). "Lernt, Pro-Test fehlt" needs
  // per-referee trial and activity flags the route does not return, so a
  // pending row reads "Angemeldet".
  const rowMeta = (r: ReferralRow) => {
    if (r.status === "rewarded" || r.status === "qualified") {
      return {
        badge: (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--mp-success-bg)] text-[var(--mp-success-text)]">
            <Check className="w-3 h-3" aria-hidden />
            {referralRowState("counts", lang)}
          </span>
        ),
        sub:
          (lang === "de" ? "Zählt seit " : "Counts since ") +
          formatDate(r.qualified_at ?? r.rewarded_at, lang),
      };
    }
    return {
      badge: (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] border border-[var(--mp-border)]">
          {referralRowState("signed_up", lang)}
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
        <DataRegion error={dataError} retry={() => void loadData()} />
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
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
                    ? "Laden Sie Kolleginnen und Kollegen ein, die sich auf eine Prüfung in Österreich vorbereiten."
                    : "Invite colleagues preparing for a medical exam in Austria."}
                </h2>
                <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
                  {referralRewardSentence(lang)}
                </p>
                <p className="text-xs text-[var(--mp-fg-subtle)] leading-relaxed mt-2">
                  {referralWindowDefinition(lang)}
                </p>
                {(() => {
                  const mentor = referralMentorCreditsCopy(lang, data?.mentorCredits, data?.mentorCreditTerms);
                  return mentor ? (
                    <div data-referral-mentor-credits className="mt-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-3 py-2">
                      <p className="text-sm text-[var(--mp-fg)] leading-relaxed">{mentor.line}</p>
                      <p className="text-xs text-[var(--mp-fg-subtle)] leading-relaxed mt-1">{mentor.terms}</p>
                    </div>
                  ) : null;
                })()}
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
                    onClick={copyInviteMessage}
                    className="mp-btn mp-btn--primary justify-center gap-2 min-h-[44px]"
                  >
                    {messageCopied ? (
                      <Check className="w-4 h-4" aria-hidden />
                    ) : (
                      <Copy className="w-4 h-4" aria-hidden />
                    )}
                    {messageCopied
                      ? copiedWord
                      : lang === "de" ? "Einladung kopieren" : "Copy invite"}
                  </button>
                  <button
                    type="button"
                    onClick={shareNative}
                    className="mp-btn mp-btn--secondary justify-center gap-2 min-h-[44px] sm:hidden"
                  >
                    <Share2 className="w-4 h-4" aria-hidden />
                    {lang === "de" ? "Teilen" : "Share"}
                  </button>
                </div>

                {/* UX-ACC-52: one polite status region announces the copy. */}
                <span role="status" className="mp-sr-only">
                  {messageCopied || copied ? copiedWord : ""}
                </span>

                {/* Direct share deeplinks (TR-27): the same invite message,
                    built once by referralShareUrls. No X target: the
                    invite does not fit a post without losing the
                    disclosure. */}
                {data?.referralLink && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wider mr-1">
                      {lang === "de" ? "Direkt teilen" : "Share directly"}
                    </span>
                    {(() => {
                      const urls = referralShareUrls(inviteMessage(), data.referralLink);
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
                            href={urls.telegram}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => trackShare("telegram")}
                            className="mp-btn mp-btn--secondary justify-center gap-2 text-sm min-h-[44px]"
                          >
                            <Share2 className="w-3.5 h-3.5" aria-hidden />
                            Telegram
                          </a>
                          <a
                            href={urls.whatsapp}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => trackShare("whatsapp")}
                            className="mp-btn mp-btn--secondary justify-center gap-2 text-sm min-h-[44px]"
                          >
                            <Share2 className="w-3.5 h-3.5" aria-hidden />
                            WhatsApp
                          </a>
                          <button
                            type="button"
                            onClick={copyLink}
                            className="mp-btn mp-btn--ghost justify-center gap-2 text-sm min-h-[44px]"
                          >
                            {copied ? (
                              <Check className="w-3.5 h-3.5" aria-hidden />
                            ) : (
                              <Copy className="w-3.5 h-3.5" aria-hidden />
                            )}
                            {copied
                              ? copiedWord
                              : lang === "de" ? "Nur Link kopieren" : "Copy link only"}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* The bare link carries no message: say what the invite discloses. */}
                <p className="mt-3 text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                  {referralDisclosure(lang, data?.mentorCredits)}
                </p>

                <p className="mt-2 text-xs text-[var(--mp-fg-subtle)]">
                  {lang === "de" ? "Ihr Code: " : "Your code: "}
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
              <h3 id="referral-progress-heading" className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Ihr Fortschritt" : "Your progress"}
              </h3>
            </div>

            {data?.proUntilExamGrantedAt ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--mp-success-bg)] border border-[var(--mp-border)]">
                <Check className="w-5 h-5 text-[var(--mp-success-text)] flex-shrink-0" aria-hidden />
                <p className="text-sm text-[var(--mp-fg)]">
                  {lang === "de"
                    ? "Ihre Empfehlungen zählen: MedPrüf Pro ist bis zum Ende Ihres Prüfungsfensters aktiv."
                    : "Your referrals count: MedPrüf Pro is active until the end of your exam window."}
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
                      ? `von ${data?.thresholdN ?? 2} zählen`
                      : `of ${data?.thresholdN ?? 2} count`}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden"
                  role="progressbar"
                  aria-labelledby="referral-progress-heading"
                  aria-valuenow={data?.qualifiedActivityCount ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={data?.thresholdN ?? 2}
                  aria-valuetext={
                    lang === "de"
                      ? `${data?.qualifiedActivityCount ?? 0} von ${data?.thresholdN ?? 2} zählen`
                      : `${data?.qualifiedActivityCount ?? 0} of ${data?.thresholdN ?? 2} count`
                  }
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
              </>
            )}
          </section>

          {/* ─────────── Referrals list ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-3">
              {lang === "de" ? "Ihre Empfehlungen" : "Your referrals"}
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
                  const initial = r.referee_first_initial ?? "";
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
                            <span className="text-xs text-[var(--mp-fg-muted)] truncate">
                              · {plan}
                            </span>
                          )}
                          {meta.badge}
                        </div>
                        <div className="text-xs text-[var(--mp-fg-subtle)]">
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
                body={referralEmptyLine(lang)}
                action={
                  <button
                    type="button"
                    onClick={copyInviteMessage}
                    className="mp-btn mp-btn--primary gap-2 min-h-[44px]"
                  >
                    <Copy className="w-4 h-4" aria-hidden />
                    {lang === "de" ? "Einladung kopieren" : "Copy invite"}
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
              {referralRewardBullets(lang).map((step, i) => (
                <li key={i} className="flex gap-3">
                  <div
                    className="w-7 h-7 rounded-full bg-[var(--mp-success-bg)] text-[var(--mp-success-text)] text-xs font-bold flex items-center justify-center flex-shrink-0"
                    aria-hidden
                  >
                    {i + 1}
                  </div>
                  <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
            <p className="text-xs text-[var(--mp-fg-subtle)] mt-3">
              <Link href="/faq#referrals" className="underline">
                {lang === "de" ? "Mehr in den FAQ" : "More in the FAQ"}
              </Link>
            </p>
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
            ? "Das Empfehlungsprogramm ist neu. Noch zählt keine Empfehlung."
            : "The referral program is new. No referral counts yet."}
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
            <div className="text-xs text-[var(--mp-fg-subtle)] mt-1 leading-tight">
              {row.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
