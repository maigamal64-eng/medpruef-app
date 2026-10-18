"use client";
/**
 * The no-card 3-day reverse trial on /pricing (a-pricing-v2, REVERSE_TRIAL_ENABLED).
 * Visitors: what the trial is and a register button (the trial starts when
 * the new account is confirmed, nothing to tap). A learner in the trial: the
 * end date and what happens after it. Anyone else: nothing. The free
 * allowance line is honest: answers given during the trial count toward it
 * (a-free-set rule). Formal Sie, no em dashes.
 */
import Link from "next/link";
import { buildAuthHref } from "@/lib/auth-entry";
import { FREE_TIER } from "@/lib/content-truth";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";
import type { BillingLang } from "@/lib/billing-copy";
import type { ExamSourceId } from "@/lib/topics";
import { longDate } from "./plans";
import TelegramTrialLink from "@/components/telegram-link/TelegramTrialLink";

export default function ReverseTrialTile({ lang, exam, signedIn, endsAt, mentor, telegramLink = false }: {
  lang: BillingLang;
  exam: ExamSourceId;
  signedIn: boolean;
  endsAt: string | null;
  /** Mentor credits reach trial accounts (house grants and access on); else the tile does not name them. */
  mentor: boolean;
  /** a-trial-phone-gate: a signed-in account that waits only for a linked Telegram (TELEGRAM_LINK_ENABLED). */
  telegramLink?: boolean;
}) {
  const de = lang === "de";
  const days = REVERSE_TRIAL_DAYS;
  const after = de
    // copy-audit F20 (a-pricing-v2-fit), byte-exact: "free" only with the sample.
    ? `Danach üben Sie mit der kostenlosen Probe weiter: ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank. Fragen, die Sie im Test beantworten, zählen dazu.`
    : `Afterwards you keep practising with the free sample: ${FREE_TIER.questions_per_exam_type} questions per question bank. Questions you answer during the trial count toward them.`;
  if (signedIn && endsAt) {
    return (
      <article aria-labelledby="reverse-trial" data-reverse-trial="active" className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
        <h2 id="reverse-trial" className="mp-h3 mb-1">{de ? "Ihr Testzugang läuft" : "Your trial is running"}</h2>
        <p className="text-sm text-[var(--mp-fg-muted)] m-0">
          {de ? `Voller Zugang bis ${longDate(endsAt, lang)}, ohne Karte und ohne Abo. ${after}` : `Full access until ${longDate(endsAt, lang)}, no card and no subscription. ${after}`}
        </p>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-2 mb-0">
          {de ? "Wenn Sie jetzt einen Tarif wählen, beginnt er sofort." : "If you choose a plan now, it starts at once."}
        </p>
      </article>
    );
  }
  if (signedIn && telegramLink) {
    return (
      <article aria-labelledby="reverse-trial" data-reverse-trial="telegram" className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
        <h2 id="reverse-trial" className="mp-h3 mb-1">{de ? `${days} Tage alles testen, ohne Karte` : `Try everything for ${days} days, no card`}</h2>
        <TelegramTrialLink lang={lang} mode="trial" embedded />
      </article>
    );
  }
  if (signedIn) return null;
  return (
    <article aria-labelledby="reverse-trial" data-reverse-trial="visitor" className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
      <h2 id="reverse-trial" className="mp-h3 mb-1">{de ? `${days} Tage alles testen, ohne Karte` : `Try everything for ${days} days, no card`}</h2>
      <p className="text-sm text-[var(--mp-fg-muted)] m-0">
        {de
          ? `Neue Konten mit verknüpftem Telegram erhalten ${days} Tage vollen Zugang: alle Fragen, Übersetzungen und Prüfungssimulationen${mentor ? " sowie Mentor-Credits zum Ausprobieren" : ""}. Keine Karte, kein Abo, einmal pro Person und Telegram-Konto. ${after}`
          : `New accounts with a linked Telegram account get ${days} days of full access: every question, translations and exam simulations${mentor ? ", plus Mentor credits to try" : ""}. No card, no subscription, once per person and Telegram account. ${after}`}
      </p>
      <Link href={buildAuthHref({ exam, next: "/" })} className="mp-btn mp-btn--secondary min-h-12 mt-3 inline-flex">
        {de ? "Konto erstellen" : "Create account"}
      </Link>
    </article>
  );
}
