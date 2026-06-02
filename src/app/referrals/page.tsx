"use client";

/**
 * /referrals — Referral dashboard.
 *
 * Lock #3 (2026-04-23): tiered payouts replace the flat €40/€400 model.
 *   Monthly / 3mo  → €25
 *   6mo / 12mo     → €50
 *   June 26 Cohort → €75
 *
 * 30-day hold after a referee pays their first subscription, then the
 * row becomes claimable. Annual cap: €600/year per referrer. SEPA is
 * no longer offered — payouts are USDT (TRC20/ERC20/Polygon) or Wise.
 *
 * Data source: GET /api/referrals/status. Payout method is updated via
 * PATCH /api/referrals/payout-method.
 *
 * Design: MPDS v2 semantic tokens + primitives throughout — no hex
 * literals, no ad-hoc modal chrome, dark mode is a token flip.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock as ClockIcon,
  Copy,
  Gift,
  Share2,
  Trophy,
  Wallet,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Alert,
  Dialog,
  DialogFooter,
  EmptyState,
  Select,
  TextField,
  useToast,
} from "@/components/ui";
import {
  maskEmail,
  maskWalletAddress,
  PAYOUT_WALLET_CHAINS,
  type PayoutWalletChain,
} from "@/lib/referrals";

type Lang = "de" | "en";
type MethodChoice = "crypto_wallet" | "wise_account" | "";

interface ReferralRow {
  id: string;
  status: "pending" | "qualified" | "rewarded";
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
  tieredPayouts: Array<{ plan: string; payoutEuros: number }>;
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

function euros(cents: number): string {
  return `€${Math.floor(cents / 100)}`;
}

export default function ReferralsPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatusResponse | null>(null);
  const [socialProof, setSocialProof] = useState<SocialProofResponse | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(
    null
  );

  // Payout-method dialog
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [methodChoice, setMethodChoice] = useState<MethodChoice>("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletChain, setWalletChain] =
    useState<PayoutWalletChain>("TRC20");
  const [wiseEmail, setWiseEmail] = useState("");
  const [payoutError, setPayoutError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

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
            ? "MedPrüf — Österreichische Ärzteprüfung"
            : "MedPrüf — Austrian medical exam prep",
        text:
          lang === "de"
            ? "Lern mit mir für die Kenntnisprüfung auf MedPrüf. 90 Tage Vollzugang für 27 € (≈ 9 €/Monat) oder die Juni-26-Kohorte mit Pass-Until-You-Pass-Garantie. Mein Empfehlungslink:"
            : "Prep with me for the Austrian medical exam on MedPrüf. 90 days for €27 (≈ €9/month) or the June 26 Cohort with a Pass-Until-You-Pass guarantee. My referral link:",
        url: data.referralLink,
      });
    } catch {
      // user cancelled; no-op
    }
  };

  // Open the payout dialog pre-filled with current values so the
  // "change" flow doesn't wipe existing data if the user cancels.
  const openPayout = () => {
    if (!data) return;
    setMethodChoice(data.payoutMethod ?? "");
    setWalletAddress(data.payoutWalletAddress ?? "");
    setWalletChain(
      (data.payoutWalletChain as PayoutWalletChain) || "TRC20"
    );
    setWiseEmail(data.payoutWiseEmail ?? "");
    setPayoutError(undefined);
    setPayoutOpen(true);
  };

  const submitPayout = async () => {
    setPayoutError(undefined);
    setSaving(true);

    let body: Record<string, unknown>;

    if (methodChoice === "") {
      body = { method: null };
    } else if (methodChoice === "crypto_wallet") {
      const a = walletAddress.trim();
      if (!a) {
        setPayoutError(
          lang === "de"
            ? "Bitte Wallet-Adresse eingeben."
            : "Please enter a wallet address."
        );
        setSaving(false);
        return;
      }
      if (walletChain === "TRC20" && !/^T/.test(a)) {
        setPayoutError(
          lang === "de"
            ? "TRC20-Adressen beginnen mit T."
            : "TRC20 addresses start with T."
        );
        setSaving(false);
        return;
      }
      if (
        (walletChain === "ERC20" || walletChain === "POLYGON") &&
        !/^0x[a-fA-F0-9]{40}$/.test(a)
      ) {
        setPayoutError(
          lang === "de"
            ? "EVM-Adressen beginnen mit 0x gefolgt von 40 Hex-Zeichen."
            : "EVM addresses start with 0x followed by 40 hex characters."
        );
        setSaving(false);
        return;
      }
      body = {
        method: "crypto_wallet",
        walletAddress: a,
        walletChain,
      };
    } else {
      const e = wiseEmail.trim();
      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        setPayoutError(
          lang === "de"
            ? "Bitte gültige E-Mail eingeben."
            : "Please enter a valid email."
        );
        setSaving(false);
        return;
      }
      body = { method: "wise_account", wiseEmail: e };
    }

    try {
      const r = await authFetch("/api/referrals/payout-method", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPayoutError(
          json?.error ||
            (lang === "de" ? "Konnte nicht speichern." : "Could not save.")
        );
        setSaving(false);
        return;
      }
      toast.success(
        lang === "de" ? "Gespeichert" : "Saved",
        methodChoice === ""
          ? lang === "de"
            ? "Auszahlungsmethode entfernt."
            : "Payout method cleared."
          : lang === "de"
          ? "Auszahlungsmethode aktualisiert."
          : "Payout method updated."
      );
      setPayoutOpen(false);
      await loadData();
    } catch {
      setPayoutError(
        lang === "de" ? "Netzwerkfehler." : "Network error."
      );
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  const user = session?.user;
  const stats = data?.stats;

  // Method-label helpers
  const methodLabel = (
    m: "crypto_wallet" | "wise_account" | null | undefined
  ): string => {
    if (m === "crypto_wallet")
      return lang === "de" ? "USDT / USDC Wallet" : "USDT / USDC wallet";
    if (m === "wise_account")
      return lang === "de" ? "Wise-Konto" : "Wise account";
    return lang === "de" ? "Nicht gesetzt" : "Not set";
  };

  // Row status → (badge element, date label)
  const rowMeta = (r: ReferralRow) => {
    if (r.status === "rewarded") {
      return {
        badge: (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)]">
            <Check className="w-3 h-3" />
            {lang === "de" ? "Ausgezahlt" : "Paid"}
          </span>
        ),
        sub:
          (lang === "de" ? "Ausgezahlt am " : "Paid ") +
          formatDate(r.rewarded_at, lang),
      };
    }
    if (r.claimable) {
      return {
        badge: (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--mp-cta-blue)]/15 text-[var(--mp-cta-blue)]">
            <Trophy className="w-3 h-3" />
            {lang === "de" ? "Auszahlbar" : "Claimable"}
          </span>
        ),
        sub:
          (lang === "de" ? "Qualifiziert am " : "Qualified ") +
          formatDate(r.qualified_at, lang),
      };
    }
    if (r.in_hold) {
      const holdLabel = formatDate(r.hold_expires_at, lang);
      return {
        badge: (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]">
            <ClockIcon className="w-3 h-3" />
            {lang === "de"
              ? `In 30-Tage-Sperre bis ${holdLabel}`
              : `In 30-day hold until ${holdLabel}`}
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
          {lang === "de" ? "Ausstehend" : "Pending"}
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
                    ? "Lade andere Prüflinge ein. Verdiene €25–€75 pro Empfehlung."
                    : "Invite fellow Prüflinge. Earn €25–€75 per referral."}
                </h2>
                <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
                  {lang === "de"
                    ? "Teile deinen Link. Sobald jemand ein Abo bezahlt, wird deine Prämie qualifiziert — nach einer 30-tägigen Sperrfrist kannst du sie in USDT oder per Wise abrufen."
                    : "Share your link. Once someone pays for a plan, your reward is qualified — after a 30-day hold it becomes claimable in USDT or via Wise."}
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

                {/* Direct social-share deeplinks (Telegram / WhatsApp /
                    X). Web Share API only fires native sheets on
                    mobile; these explicit buttons let desktop users
                    one-click into their group chats too. Pre-filled
                    with referral copy that mentions the new
                    €27 / 3-month entry tier. */}
                {data?.referralLink && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wider mr-1">
                      {lang === "de" ? "Direkt teilen" : "Share directly"}
                    </span>
                    {(() => {
                      const shareTextDe = `MedPrüf — Österreichische Ärzteprüfung. 90 Tage Vollzugang für 27 € (≈ 9 €/Monat) oder die Juni-26-Kohorte mit Pass-Until-You-Pass-Garantie. Mein Empfehlungslink: ${data.referralLink}`;
                      const shareTextEn = `MedPrüf — Austrian medical exam prep. 90 days full access for €27 (≈ €9/month) or the June 26 Cohort with a Pass-Until-You-Pass guarantee. My referral link: ${data.referralLink}`;
                      const shareText = lang === "de" ? shareTextDe : shareTextEn;
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

          {/* ─────────── Stat strip ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-2xl font-display font-extrabold text-[var(--mp-fg)] tabular-nums">
                  {stats?.totalReferrals ?? 0}
                </div>
                <div className="text-[11px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mt-1">
                  {lang === "de" ? "Empfehlungen gesamt" : "Total referrals"}
                </div>
              </div>
              <div>
                <div className="text-2xl font-display font-extrabold text-[var(--mp-status-warning)] tabular-nums">
                  {stats?.qualifiedInHold ?? 0}
                </div>
                <div className="text-[11px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mt-1">
                  {lang === "de"
                    ? "In 30-Tage-Sperre"
                    : "In 30-day hold"}
                </div>
              </div>
              <div>
                <div className="text-2xl font-display font-extrabold text-[var(--mp-cta-blue)] tabular-nums">
                  {stats?.claimable ?? 0}
                </div>
                <div className="text-[11px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mt-1">
                  {lang === "de" ? "Auszahlbar" : "Claimable"}
                </div>
              </div>
              <div>
                <div className="text-2xl font-display font-extrabold text-[var(--mp-viridian)] tabular-nums">
                  {euros(stats?.earnedCents ?? 0)}
                </div>
                <div className="text-[11px] text-[var(--mp-fg-subtle)] uppercase tracking-wider mt-1">
                  {lang === "de" ? "Verdient" : "Earned"}
                </div>
                <div className="text-[10px] text-[var(--mp-fg-subtle)] mt-1 tabular-nums">
                  {lang === "de" ? "€600/Jahr-Limit · " : "€600/year cap · "}
                  {euros(stats?.annualCapRemainingCents ?? 60000)}{" "}
                  {lang === "de" ? "verbleibend" : "remaining"}
                </div>
              </div>
            </div>
          </section>

          {/* ─────────── Tiered payout table ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] mb-3">
              {lang === "de" ? "Prämie pro Abo-Typ" : "Payout per plan"}
            </h3>
            <div className="overflow-hidden rounded-xl border border-[var(--mp-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-[11px] uppercase tracking-wider">
                      {lang === "de"
                        ? "Abo deines Empfehlten"
                        : "Plan your referee picks"}
                    </th>
                    <th className="text-right px-4 py-2 font-semibold text-[11px] uppercase tracking-wider">
                      {lang === "de" ? "Du bekommst" : "You get"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
                  {(data?.tieredPayouts ?? [
                    { plan: "monthly", payoutEuros: 25 },
                    { plan: "3 months", payoutEuros: 25 },
                    { plan: "6 months", payoutEuros: 50 },
                    { plan: "12 months", payoutEuros: 50 },
                    { plan: "June 26 Cohort", payoutEuros: 75 },
                  ]).map((row) => (
                    <tr key={row.plan}>
                      <td className="px-4 py-2.5 text-[var(--mp-fg)]">
                        {row.plan}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-[var(--mp-viridian)] tabular-nums">
                        €{row.payoutEuros}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-3">
              {lang === "de"
                ? "30-Tage-Sperrfrist nach Zahlungseingang deines Empfehlten. €600 Obergrenze pro Kalenderjahr."
                : "30-day hold after your referee pays. €600 per calendar year cap."}
            </p>
          </section>

          {/* ─────────── Payout method ─────────── */}
          <section className="mp-card p-5 lg:p-7">
            <div className="flex items-center gap-3 mb-2">
              <Wallet className="w-4 h-4 text-[var(--mp-viridian)]" />
              <h3 className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Auszahlungsmethode" : "Payout method"}
              </h3>
            </div>

            {data?.payoutMethod ? (
              <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--mp-fg)] truncate">
                    {methodLabel(data.payoutMethod)}
                  </div>
                  <div className="text-xs text-[var(--mp-fg-muted)] font-mono mt-0.5 truncate">
                    {data.payoutMethod === "crypto_wallet"
                      ? `${data.payoutWalletChain} · ${maskWalletAddress(
                          data.payoutWalletAddress ?? ""
                        )}`
                      : maskEmail(data.payoutWiseEmail ?? "")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openPayout}
                  className="mp-btn mp-btn--secondary flex-shrink-0"
                >
                  {lang === "de" ? "Ändern" : "Change"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                  {lang === "de"
                    ? "Lege deine Auszahlungsmethode fest, damit wir deine Prämien überweisen können, sobald sie abrufbar sind. Zahlung in USDT (TRC20/ERC20/Polygon) oder per Wise-E-Mail-Überweisung."
                    : "Set your payout method to receive your earnings when claims become available. We pay in USDT (TRC20/ERC20/Polygon) or via Wise email transfer."}
                </p>
                <button
                  type="button"
                  onClick={openPayout}
                  className="mp-btn mp-btn--primary w-full justify-center"
                >
                  {lang === "de"
                    ? "Auszahlungsmethode einrichten"
                    : "Set up payout method"}
                </button>
              </div>
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
                        {r.hold_reason === "annual_cap" && (
                          <div className="text-[11px] text-[var(--mp-fg-subtle)] italic mt-0.5">
                            {lang === "de"
                              ? "€600-Jahreslimit erreicht — zählt in deiner Statistik, keine Prämie mehr dieses Jahr."
                              : "€600/year cap reached — counts toward your stats, no payout this year."}
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-mono font-bold text-[var(--mp-viridian)] tabular-nums flex-shrink-0 pt-0.5">
                        {r.reward_credit_cents > 0
                          ? `+${euros(r.reward_credit_cents)}`
                          : "—"}
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
                    ? "Teile deinen Link mit anderen Prüflingen — sobald jemand ein Abo bezahlt, startet die 30-Tage-Sperrfrist, danach zahlen wir dir €25–€75 aus."
                    : "Share your link with fellow candidates — once someone pays, a 30-day hold starts, then we pay out €25–€75."
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
                      ? "Sende deinen Link an andere Prüflinge, die sich auf die österreichische Kenntnisprüfung vorbereiten."
                      : "Send your link to other doctors preparing for the Austrian medical exam."}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  2
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {lang === "de" ? "Dein Freund zahlt ein Abo" : "Friend pays"}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                    {lang === "de"
                      ? "Sobald jemand über deinen Link ein Abo bezahlt, wird deine Prämie qualifiziert. Die Höhe hängt vom gewählten Tarif ab (€25–€75)."
                      : "When someone signs up via your link and pays, your reward is qualified. The amount depends on the plan they pick (€25–€75)."}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                  3
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                    {lang === "de"
                      ? "Nach 30-Tage-Sperre auszahlen"
                      : "Claim after 30-day hold"}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                    {lang === "de"
                      ? "Nach 30 Tagen wird deine Prämie auszahlbar — wir überweisen per USDT (TRC20/ERC20/Polygon) oder Wise-E-Mail."
                      : "After a 30-day hold, your reward becomes claimable — we pay via USDT (TRC20/ERC20/Polygon) or Wise email transfer."}
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

          {/* ─────────── Info alert ─────────── */}
          <Alert
            variant="info"
            title={
              lang === "de"
                ? "Auszahlung: USDT oder Wise"
                : "Payout: USDT or Wise"
            }
          >
            {lang === "de"
              ? "Stelle sicher, dass deine Auszahlungsmethode hinterlegt ist, bevor die erste Empfehlung die 30-Tage-Sperrfrist verlässt. Änderungen sind jederzeit möglich."
              : "Make sure your payout method is set before your first referral clears the 30-day hold. You can change it any time."}
          </Alert>
        </div>

        <BottomNav lang={lang} />
      </main>

      {/* ─────────── Payout-method dialog ─────────── */}
      <Dialog
        open={payoutOpen}
        onOpenChange={setPayoutOpen}
        title={lang === "de" ? "Auszahlungsmethode" : "Payout method"}
        description={
          lang === "de"
            ? "Wähle, wie du deine Empfehlungsprämie erhalten möchtest."
            : "Choose how you want to receive your referral reward."
        }
        footer={
          <DialogFooter>
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setPayoutOpen(false)}
              disabled={saving}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--primary"
              onClick={submitPayout}
              disabled={saving}
            >
              {saving
                ? lang === "de"
                  ? "Speichern…"
                  : "Saving…"
                : lang === "de"
                ? "Speichern"
                : "Save"}
            </button>
          </DialogFooter>
        }
      >
        <fieldset
          className="space-y-2"
          aria-label={lang === "de" ? "Methode" : "Method"}
        >
          <legend className="sr-only">
            {lang === "de" ? "Auszahlungsmethode" : "Payout method"}
          </legend>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              methodChoice === "crypto_wallet"
                ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10"
                : "border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40"
            }`}
          >
            <input
              type="radio"
              name="payout-method"
              value="crypto_wallet"
              checked={methodChoice === "crypto_wallet"}
              onChange={() => setMethodChoice("crypto_wallet")}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "USDT / USDC Wallet" : "USDT / USDC wallet"}
              </div>
              <div className="text-xs text-[var(--mp-fg-muted)]">
                {lang === "de"
                  ? "Schnellste Auszahlung. TRC20 empfohlen (niedrigste Gebühren)."
                  : "Fastest payout. TRC20 recommended (lowest fees)."}
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              methodChoice === "wise_account"
                ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10"
                : "border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40"
            }`}
          >
            <input
              type="radio"
              name="payout-method"
              value="wise_account"
              checked={methodChoice === "wise_account"}
              onChange={() => setMethodChoice("wise_account")}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Wise-Konto" : "Wise account"}
              </div>
              <div className="text-xs text-[var(--mp-fg-muted)]">
                {lang === "de"
                  ? "Überweisung per Wise. Gib deine Wise-E-Mail-Adresse an."
                  : "Transfer via Wise. Provide your Wise email address."}
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              methodChoice === ""
                ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10"
                : "border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40"
            }`}
          >
            <input
              type="radio"
              name="payout-method"
              value=""
              checked={methodChoice === ""}
              onChange={() => setMethodChoice("")}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Später entscheiden" : "Decide later"}
              </div>
              <div className="text-xs text-[var(--mp-fg-muted)]">
                {lang === "de"
                  ? "Du kannst die Methode jederzeit ändern."
                  : "You can change this any time."}
              </div>
            </div>
          </label>
        </fieldset>

        {methodChoice === "crypto_wallet" && (
          <div className="mt-4 space-y-3">
            <Select
              label={lang === "de" ? "Blockchain" : "Chain"}
              value={walletChain}
              onChange={(e) =>
                setWalletChain(e.target.value as PayoutWalletChain)
              }
              options={PAYOUT_WALLET_CHAINS.map((c) => ({
                value: c,
                label:
                  c === "TRC20"
                    ? `TRC20 (Tron) — ${
                        lang === "de" ? "empfohlen" : "recommended"
                      }`
                    : c === "ERC20"
                    ? "ERC20 (Ethereum)"
                    : "POLYGON (Matic)",
              }))}
              helper={
                lang === "de"
                  ? "Stelle sicher, dass deine Wallet das gewählte Netzwerk unterstützt."
                  : "Make sure your wallet supports the selected network."
              }
            />
            <TextField
              label={lang === "de" ? "Wallet-Adresse" : "Wallet address"}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder={
                walletChain === "TRC20" ? "TR9kL..." : "0x742d35..."
              }
              helper={
                lang === "de"
                  ? "Keine Anfangs- oder Endleerzeichen. Wir senden eine kleine Test-Transaktion vor der ersten Auszahlung."
                  : "No leading/trailing whitespace. We'll send a small test transaction before the first payout."
              }
            />
          </div>
        )}

        {methodChoice === "wise_account" && (
          <div className="mt-4">
            <TextField
              label={
                lang === "de" ? "Wise-E-Mail-Adresse" : "Wise email address"
              }
              type="email"
              autoComplete="email"
              value={wiseEmail}
              onChange={(e) => setWiseEmail(e.target.value)}
              placeholder="name@example.com"
              helper={
                lang === "de"
                  ? "Die E-Mail, mit der du Wise-Zahlungen empfängst."
                  : "The email address you receive Wise payments at."
              }
            />
          </div>
        )}

        {payoutError && (
          <div className="mt-4">
            <Alert variant="error">{payoutError}</Alert>
          </div>
        )}
      </Dialog>
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
            ? "Du wärst die erste Empfehlung — der Code ist neu."
            : "You'd be the first referral — the code is brand new."}
        </p>
        <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">
          {lang === "de"
            ? "Teile den Code mit einer Person aus deiner Lerngruppe — die Belohnung wird sofort nach Zahlung qualifiziert."
            : "Share the code with one person from your study group — the reward qualifies immediately after they pay."}
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
