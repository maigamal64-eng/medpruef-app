"use client";

/**
 * PreCheckoutTrustDialog — interrupts every "Pay with crypto" / "Try
 * for €19 with crypto" CTA on /pricing so the user sees company name,
 * 7-day refund, PUYP guarantee, USDT-TRC20 explainer, and a
 * "Ich habe keine Krypto" escape-hatch BEFORE we redirect them to
 * NOWPayments.
 *
 * Why this exists (rescue-sprint §1.2): the prod UX tour caught that
 * clicking "Try for €19 with crypto" fired `/api/checkout/nowpayments`
 * immediately and jumped straight to nowpayments.io with no trust
 * signals visible. The 5/5 invoice abandonment in the audit is partly
 * explained by that: users land on a stranger's payment page with no
 * company branding, no refund policy, no understanding of USDT.
 *
 * Copy comes from `context/COPY-BUNDLE-2026-04-24.md` §2 verbatim —
 * [name] pre-approved every string. Do NOT edit copy here without
 * updating the source document.
 *
 * The dialog also hosts the "Ich habe keine Krypto" follow-up form
 * (NoCryptoEscapeForm). On submit it POSTs to
 * `/api/non-crypto-waitlist` and replaces its body with the
 * confirmation copy — Stripe Atlas eta + user-b7e46e80@example.com escape.
 */

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogFooter } from "@/components/ui";
import { ShieldCheck, RefreshCw, Receipt, Mail, MessageCircle, X } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { formatEuro } from "@/lib/content-truth";

type Lang = "de" | "en";
type TierKey =
  | "first_3mo_27"
  | "first_month_19"
  | "premium_pass_guaranteed"
  | "monthly"
  | "three_month"
  | "six_month"
  | "twelve_month";

export interface PreCheckoutTrustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which tier the user is buying — drives the price + plan summary. */
  tier: TierKey;
  /** User's email to show in the "Rechnung an: …" line. */
  userEmail?: string | null;
  /** Lang for DE/EN copy. */
  lang: Lang;
  /** Called when user clicks "Verstanden — weiter zur Zahlung". */
  onConfirm: () => void;
}

interface TierSummary {
  planLabel: string;
  priceLabel: string;
  durationLabel: string;
  inclusionLine: string;
  hasPuyp: boolean;
}

function tierSummary(tier: TierKey, lang: Lang): TierSummary {
  if (tier === "premium_pass_guaranteed") {
    return {
      planLabel:
        lang === "de"
          ? "Kenntnisprüfung-Kohorte · 6 Monate Vollzugriff mit PUYP-Garantie"
          : "Kenntnisprüfung Cohort · 6 months full access with PUYP guarantee",
      // formatEuro from content-truth.ts emits the canonical "114 €" form
      // (number + space + €). The pre-checkout dialog is the highest-stakes
      // surface in the funnel — currency-format drift here is the worst place
      // to break the COPY-BUNDLE rule (review-2026-04-25-B8).
      priceLabel: formatEuro(11400),
      durationLabel: lang === "de" ? "einmalig (6 Monate Zugang)" : "one-time (6 months access)",
      inclusionLine:
        lang === "de"
          ? "alle drei Prüfungstypen, 10.992 Fragen, Wiederholungsplan, Mock-Prüfung, KI-Chat"
          : "all three exam types, 10,992 questions, spaced repetition, mock exam, AI chat",
      hasPuyp: true,
    };
  }
  if (tier === "first_3mo_27") {
    return {
      planLabel:
        lang === "de"
          ? "3-Monats-Einstieg — MedPrüf Pro testen für ~9 € pro Monat"
          : "3-Month Starter — try MedPrüf Pro for ~€9/month",
      priceLabel: formatEuro(2700),
      durationLabel:
        lang === "de"
          ? "einmalig · 3 Monate Zugang · keine automatische Verlängerung"
          : "one-time · 3 months access · no auto-renewal",
      inclusionLine:
        lang === "de"
          ? "90 Tage Vollzugriff, alle drei Prüfungstypen, 10.992 Fragen, KI-Chat. Einmal pro Konto verfügbar — danach Kohorte oder Einzelmonat."
          : "90 days full access, all three exam types, 10,992 questions, AI chat. One-time per account — afterward upgrade to Cohort or buy a single month.",
      hasPuyp: false,
    };
  }
  if (tier === "first_month_19") {
    return {
      planLabel:
        lang === "de"
          ? "Einzelmonat — MedPrüf Pro testen"
          : "Single Month — try MedPrüf Pro",
      priceLabel: formatEuro(1900),
      durationLabel:
        lang === "de"
          ? "einmalig · keine automatische Verlängerung"
          : "one-time · no auto-renewal",
      inclusionLine:
        lang === "de"
          ? "30 Tage Vollzugriff, alle drei Prüfungstypen, 10.992 Fragen, KI-Chat"
          : "30 days full access, all three exam types, 10,992 questions, AI chat",
      hasPuyp: false,
    };
  }
  // Standard tiers (waitlist-style — present here for completeness; the
  // pricing-page CTAs for them already route through the waitlist
  // dialog, not this trust dialog).
  return {
    planLabel: tier,
    priceLabel: "",
    durationLabel: "",
    inclusionLine: "",
    hasPuyp: tier === "twelve_month",
  };
}

export function PreCheckoutTrustDialog({
  open,
  onOpenChange,
  tier,
  userEmail,
  lang,
  onConfirm,
}: PreCheckoutTrustDialogProps) {
  const summary = tierSummary(tier, lang);
  const [showNoCrypto, setShowNoCrypto] = useState(false);
  // Double-click guard (review-2026-04-25-B8). The parent's onConfirm
  // closes the dialog AND fires `POST /api/checkout/nowpayments` — that
  // POST takes 5-10s. A user clicking twice in that window can hit the
  // 5/10min rate limit and silently fail. We lock the button locally
  // and show "Erstelle Rechnung..." until the dialog unmounts.
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);

  // Reset the "Ich habe keine Krypto" sub-state + the confirming flag
  // whenever the parent opens or closes. Prevents stale state surviving
  // across dialog mounts.
  useEffect(() => {
    if (!open) {
      setShowNoCrypto(false);
      setConfirming(false);
      confirmingRef.current = false;
    }
  }, [open]);

  const handleConfirm = () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    onConfirm();
  };

  const title =
    lang === "de"
      ? "Bevor wir dich zu NOWPayments weiterleiten"
      : "Before we redirect you to NOWPayments";
  const subtitle =
    lang === "de"
      ? "Ein paar Dinge, damit du dich sicher fühlst."
      : "A few things so you feel comfortable.";

  if (showNoCrypto) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={lang === "de" ? "Ich habe keine Krypto" : "I don't have crypto"}
        description={
          lang === "de"
            ? "Sobald Stripe live ist, schicken wir dir einen Karten-Zahlungs-Link per E-Mail."
            : "As soon as Stripe goes live, we'll email you a card-payment link."
        }
      >
        <NoCryptoEscapeForm
          lang={lang}
          tier={tier}
          userEmail={userEmail}
          onClose={() => onOpenChange(false)}
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={subtitle}
    >
      <div className="space-y-5 text-sm text-[var(--mp-fg)]">
        {/* Company block */}
        <section>
          <h4 className="mp-ui font-semibold mb-1">
            {lang === "de" ? "Du kaufst bei" : "You're buying from"}
          </h4>
          <p className="text-[var(--mp-fg-muted)]">
            <strong>MedPrüf</strong>
            {" · "}
            {lang === "de" ? "betrieben von" : "operated by"}{" "}
            <strong>[name]</strong> · [name] · Österreich
          </p>
          {userEmail && (
            <p className="text-[var(--mp-fg-muted)] text-xs mt-1">
              {lang === "de" ? "Rechnung per E-Mail an" : "Invoice emailed to"}{" "}
              <strong>{userEmail}</strong>
            </p>
          )}
        </section>

        {/* Tier summary */}
        <section className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3">
          <h4 className="mp-ui font-semibold mb-1">
            {lang === "de" ? "Plan" : "Plan"}
          </h4>
          <p className="text-[var(--mp-fg)]">{summary.planLabel}</p>
          {summary.priceLabel && (
            <p className="text-[var(--mp-fg-muted)] text-xs mt-1">
              <strong>{summary.priceLabel}</strong>{" "}
              {summary.durationLabel} ({lang === "de" ? "in USDT-TRC20" : "in USDT-TRC20"})
            </p>
          )}
          {summary.inclusionLine && (
            <p className="text-[var(--mp-fg-muted)] text-xs mt-1">
              {lang === "de" ? "Inklusive: " : "Included: "}
              {summary.inclusionLine}
            </p>
          )}
        </section>

        {/* Guarantees */}
        <section>
          <h4 className="mp-ui font-semibold mb-2">
            {lang === "de" ? "Was du bekommst" : "What you get"}
          </h4>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <RefreshCw className="w-4 h-4 mt-0.5 text-[var(--mp-viridian)] flex-shrink-0" />
              <span>
                <strong>
                  {lang === "de" ? "7-Tage-Geld-zurück-Garantie." : "7-day refund guarantee."}
                </strong>{" "}
                {lang === "de"
                  ? "Keine Fragen, volle Rückerstattung. Schreib einfach an"
                  : "No questions, full refund. Just email"}{" "}
                <a
                  href="mailto:user-b7e46e80@example.com"
                  className="underline text-[var(--mp-cta-blue)]"
                >
                  user-b7e46e80@example.com
                </a>
                .
              </span>
            </li>
            {summary.hasPuyp && (
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 mt-0.5 text-[var(--mp-viridian)] flex-shrink-0" />
                <span>
                  <strong>Pass-Until-You-Pass.</strong>{" "}
                  {lang === "de"
                    ? "Fällst du beim ersten echten Prüfungsversuch durch und hast ≥70% der Fragen bearbeitet, verlängern wir dein Abo kostenlos bis zum nächsten Versuch."
                    : "If you fail your first real exam attempt and have answered ≥70% of the question bank, we extend your access free until the next attempt."}
                </span>
              </li>
            )}
            <li className="flex items-start gap-2">
              <X className="w-4 h-4 mt-0.5 text-[var(--mp-viridian)] flex-shrink-0" />
              <span>
                <strong>
                  {lang === "de"
                    ? "Keine stille automatische Verlängerung."
                    : "No silent auto-renewal."}
                </strong>{" "}
                {lang === "de"
                  ? "Jeder Kauf ist einmalig — du entscheidest aktiv, ob du verlängerst."
                  : "Every purchase is one-time — you actively decide whether to renew."}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Receipt className="w-4 h-4 mt-0.5 text-[var(--mp-viridian)] flex-shrink-0" />
              <span>
                <strong>
                  {lang === "de" ? "Rechnung per E-Mail" : "Invoice by email"}
                </strong>
                {" — "}
                {lang === "de" ? "als PDF, mit USt.-Hinweis." : "as PDF, with VAT note."}
              </span>
            </li>
          </ul>
        </section>

        {/* USDT explainer */}
        <details className="rounded-xl border border-[var(--mp-border)] p-3 group">
          <summary className="cursor-pointer mp-ui font-semibold list-none flex items-center justify-between">
            <span>
              {lang === "de"
                ? "Was ist USDT? Wie bekomme ich USDT?"
                : "What is USDT? How do I get USDT?"}
            </span>
            <span className="text-xs text-[var(--mp-fg-subtle)] group-open:rotate-180 transition-transform">
              ▾
            </span>
          </summary>
          <div className="text-[var(--mp-fg-muted)] text-xs mt-2 space-y-2">
            <p>
              {lang === "de"
                ? "Du zahlst mit USDT (TRC20). USDT ist ein Stablecoin — 1 USDT = 1 USD, keine Kursschwankung. TRC20 ist das schnellste und günstigste Netzwerk (Zahlung dauert typischerweise unter 1 Minute, Gebühren unter 1 USD)."
                : "You pay in USDT (TRC20). USDT is a stablecoin — 1 USDT = 1 USD, no rate fluctuation. TRC20 is the fastest and cheapest network (payment usually under 1 minute, fees under 1 USD)."}
            </p>
            <p>
              {lang === "de"
                ? "USDT (Tether) ist der weltweit meistgenutzte Stablecoin. Du kannst USDT mit einer Kreditkarte auf Binance, Kraken oder Coinbase kaufen (~3-5 Minuten). Wichtig: wähle das TRC20-Netzwerk beim Senden (niedrige Gebühren). Bei Fragen: user-b7e46e80@example.com — wir helfen dir durch."
                : "USDT (Tether) is the world's most-used stablecoin. You can buy USDT with a credit card on Binance, Kraken, or Coinbase (~3-5 minutes). Important: pick the TRC20 network when sending (low fees). Questions: user-b7e46e80@example.com — we'll walk you through it."}
            </p>
          </div>
        </details>
      </div>

      {/* Live human escape — Telegram-deep-link "Stuck? DM [name]" line.
          Funnel agent finding §9: a first-time crypto buyer who sees
          a real human is 5-10× more likely to push through. The
          existing dialog has the email path; this adds the faster
          Telegram channel. Renders quietly above the footer so it's
          there if needed but doesn't dominate the trust signals. */}
      <p className="text-xs text-[var(--mp-fg-muted)] mb-3">
        <MessageCircle className="w-3.5 h-3.5 inline mr-1 align-text-bottom" />
        {lang === "de" ? "Unsicher? Schreib [name] direkt: " : "Unsure? Message [name] directly: "}
        <a
          href="https://t.me/owner_at"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--mp-cta-blue)] underline"
        >
          @owner_at
        </a>
        {lang === "de" ? " · Antwort meist <30 Min." : " · usually replies in <30 min"}
      </p>

      <DialogFooter>
        <button
          type="button"
          onClick={() => setShowNoCrypto(true)}
          disabled={confirming}
          className="text-sm text-[var(--mp-cta-blue)] underline mr-auto disabled:opacity-50"
        >
          <Mail className="w-4 h-4 inline mr-1" />
          {lang === "de" ? "Ich habe keine Krypto" : "I don't have crypto"}
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={confirming}
          className="mp-btn mp-btn-secondary disabled:opacity-50"
        >
          {lang === "de" ? "Abbrechen" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="mp-btn mp-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {confirming
            ? lang === "de"
              ? "Erstelle Rechnung …"
              : "Creating invoice …"
            : lang === "de"
              ? "Verstanden — weiter zur Zahlung"
              : "Understood — continue to payment"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}

interface NoCryptoEscapeFormProps {
  lang: Lang;
  tier: TierKey;
  userEmail?: string | null;
  onClose: () => void;
}

const PROVIDER_OPTIONS: { value: string; labelDe: string; labelEn: string }[] = [
  { value: "binance", labelDe: "Binance", labelEn: "Binance" },
  { value: "kraken", labelDe: "Kraken", labelEn: "Kraken" },
  { value: "coinbase", labelDe: "Coinbase", labelEn: "Coinbase" },
  { value: "other", labelDe: "Andere", labelEn: "Other" },
  { value: "none", labelDe: "Habe keins", labelEn: "Have none" },
];

function NoCryptoEscapeForm({
  lang,
  tier,
  userEmail,
  onClose,
}: NoCryptoEscapeFormProps) {
  const [email, setEmail] = useState(userEmail || "");
  const [provider, setProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/non-crypto-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          tier_interest: tier,
          current_provider: provider || undefined,
          notes: notes || undefined,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { error?: string }).error ||
            (lang === "de" ? "Speichern fehlgeschlagen." : "Save failed."),
        );
      }
    } catch {
      setError(lang === "de" ? "Speichern fehlgeschlagen." : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-[var(--mp-fg)]">
          <strong>
            {lang === "de"
              ? "Danke — wir melden uns, sobald Karten-Zahlung live ist."
              : "Thanks — we'll email you as soon as card payment goes live."}
          </strong>
        </p>
        <p className="text-[var(--mp-fg-muted)]">
          {lang === "de"
            ? "Das ist voraussichtlich Anfang Mai 2026 (Stripe Atlas wird gerade bearbeitet). Du bekommst dann eine E-Mail mit einem direkten Zahlungs-Link, ohne Krypto-Einrichtung."
            : "Estimated early May 2026 (Stripe Atlas is being processed). You'll get an email with a direct payment link, no crypto setup."}
        </p>
        <p className="text-[var(--mp-fg-muted)] text-xs">
          {lang === "de"
            ? "Falls es dringend ist und du trotzdem mit USDT zahlen willst: schreib an"
            : "If it's urgent and you want to pay with USDT after all, email"}{" "}
          <a
            href="mailto:user-b7e46e80@example.com"
            className="underline text-[var(--mp-cta-blue)]"
          >
            user-b7e46e80@example.com
          </a>{" "}
          —{" "}
          {lang === "de"
            ? "wir helfen dir in 5 Minuten durch den Binance-Kauf."
            : "we'll walk you through the Binance purchase in 5 minutes."}
        </p>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="mp-btn mp-btn-primary"
          >
            {lang === "de" ? "Schließen" : "Close"}
          </button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="text-xs font-semibold text-[var(--mp-fg-muted)]">
          {lang === "de" ? "Deine E-Mail" : "Your email"}
        </span>
        <input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mp-field mt-1 w-full"
          placeholder="user-b7e46e80@example.com"
        />
      </label>

      <fieldset>
        <legend className="text-xs font-semibold text-[var(--mp-fg-muted)] mb-1">
          {lang === "de" ? "Hast du eine Krypto-Plattform?" : "Do you have a crypto platform?"}
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {PROVIDER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center gap-2 px-2 py-1 rounded border cursor-pointer text-xs ${
                provider === opt.value
                  ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10"
                  : "border-[var(--mp-border)]"
              }`}
            >
              <input
                type="radio"
                name="current_provider"
                value={opt.value}
                checked={provider === opt.value}
                onChange={(e) => setProvider(e.target.value)}
                className="sr-only"
              />
              <span>{lang === "de" ? opt.labelDe : opt.labelEn}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-xs font-semibold text-[var(--mp-fg-muted)]">
          {lang === "de" ? "Anmerkungen (optional)" : "Notes (optional)"}
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          className="mp-field mt-1 w-full"
          placeholder={
            lang === "de"
              ? "Was sollen wir wissen?"
              : "Anything we should know?"
          }
        />
      </label>

      {error && (
        <p className="text-xs text-[var(--mp-error)]" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="mp-btn mp-btn-secondary"
        >
          {lang === "de" ? "Abbrechen" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !email}
          className="mp-btn mp-btn-primary"
        >
          {submitting
            ? lang === "de"
              ? "Speichere…"
              : "Saving…"
            : lang === "de"
            ? "Auf Liste setzen"
            : "Add me to the list"}
        </button>
      </DialogFooter>
    </div>
  );
}
