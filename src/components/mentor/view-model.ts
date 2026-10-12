/**
 * Pure view-models for the mentor screens (W2-UI): what to show for a usage
 * state, an error code, a package offer, an answer. No React, no I/O.
 *
 * Money rule: learners see credits, "about N messages" and the EUR price of a
 * package (a price the server sends). Never dollars, never micro-units.
 */

import type {
  MentorErrorCode,
  MentorLang,
  MentorPackageOffer,
  MentorRefusalReason,
  MentorUsageResponse,
} from "@/lib/mentor/contract";
import { MENTOR_LANGS } from "@/lib/mentor/contract";
import type { MentorKey, MentorUiLang } from "@/lib/i18n-mentor";
import { mentorT } from "@/lib/i18n-mentor";
import type { MentorClientError } from "./api";
import { shellT } from "./r1-shell-copy";
import { r3PackageCopy } from "./r3-package-copy";

// ─── Formatting ─────────────────────────────────────────────────────────

const LOCALES: Record<MentorUiLang, string> = {
  de: "de-AT",
  en: "en-GB",
  ru: "ru-RU",
  uk: "uk-UA",
  tr: "tr-TR",
  // Arabic copy is not live yet (strings fall back to English), so dates and
  // prices format in English too; mixing Arabic month names into an English
  // sentence breaks bidi. Switch to "ar-EG-u-nu-latn" when the wording ships.
  ar: "en-GB",
};

export function uiLocale(lang: MentorUiLang): string {
  return LOCALES[lang] ?? "de-AT";
}

/** "Stand" dates are shown in Vienna time, the exam calendar's zone. */
export function formatDate(iso: string | null | undefined, lang: MentorUiLang): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(d);
  } catch {
    return "";
  }
}

export function formatEur(cents: number, lang: MentorUiLang): string {
  if (!Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat(uiLocale(lang), { style: "currency", currency: "EUR" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} EUR`;
  }
}

/** Near zero, show the actual fractional balance with one localized decimal. */
export function formatCreditBalance(credits: number, lang: MentorUiLang): string {
  const amount = Math.max(0, Number.isFinite(credits) ? credits : 0);
  return new Intl.NumberFormat(uiLocale(lang), { minimumFractionDigits: amount < 20 ? 1 : 0, maximumFractionDigits: amount < 20 ? 1 : 0 }).format(amount < 20 ? amount : Math.floor(amount));
}

// ─── Answer language ────────────────────────────────────────────────────

/**
 * Languages the learner may pick for the Mentor's answers. Arabic is left
 * out on purpose: the plan keeps Arabic mentor wording off until [name] signs
 * it off (UI strings fall back to English the same way). To switch Arabic
 * on, add "ar" here and nothing else.
 */
export const MENTOR_ANSWER_LANGS: readonly MentorLang[] = ["de", "en", "ru", "uk", "tr", "fr"] as const;

export function isAnswerLang(x: unknown): x is MentorLang {
  return typeof x === "string" && (MENTOR_ANSWER_LANGS as readonly string[]).includes(x) && (MENTOR_LANGS as readonly string[]).includes(x);
}

/** Default answer language for a UI language (ar maps to en until signed off). */
export function defaultAnswerLang(ui: MentorUiLang): MentorLang {
  return isAnswerLang(ui) ? ui : "en";
}

const ANSWER_LANG_LABELS: Record<MentorLang, string> = {
  de: "Deutsch",
  en: "English",
  ru: "Русский (бета)",
  uk: "Українська (бета)",
  tr: "Türkçe (beta)",
  ar: "العربية",
  fr: "Français",
};
export function answerLangLabel(l: MentorLang): string {
  return ANSWER_LANG_LABELS[l];
}

// ─── Usage ──────────────────────────────────────────────────────────────

export type BannerTone = "info" | "warning" | "error";

export interface UsageBanner {
  tone: BannerTone;
  titleKey: MentorKey;
  bodyKey: MentorKey;
  /** Offer the packages page from this banner. */
  offerPackages: boolean;
}

export interface UsageView {
  creditsText: string;
  messagesText: string;
  /** Meter fill 0..1 against a soft reference, for the small bar only. */
  meterFill: number;
  tone: "ok" | "low" | "empty" | "rest" | "trial";
  trialNoticeText?: string | null;
  hideCostDetails?: boolean;
  /** Composer enabled. Resting and exhausted block sending; none stays open (the server decides). */
  canChat: boolean;
  banner: UsageBanner | null;
  expiryText: string | null;
  /** True when buying is on sale (server flag) and the state can use it. */
  showBuy: boolean;
}

/** Soft visual reference for the meter only; not a limit and never shown as a number. */
const METER_REFERENCE_CREDITS = 200;

export function usageView(u: MentorUsageResponse, lang: MentorUiLang, now: Date = new Date()): UsageView {
  const credits = Math.max(0, Number.isFinite(u.credits_left) ? u.credits_left : 0);
  const formattedCredits = formatCreditBalance(credits, lang);
  const displayCredits = credits < 20 ? Math.round(credits * 10) / 10 : Math.floor(credits);
  const balanceText = mentorT("credits_count", lang, { n: displayCredits }).replace(String(displayCredits), formattedCredits);
  const trial = u.trial;
  const trialDate = trial ? formatDate(trial.expires_at, lang) : "";
  const activeTrial = !!trial && !trial.expired && !!trialDate && new Date(trial.expires_at).getTime() > now.getTime();
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endsTomorrow = activeTrial && new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date(trial!.expires_at)) === new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(nextDay);
  const includedCredits = trial?.pro_included_credits ?? u.included_allowance?.credits;
  const forward = includedCredits !== undefined ? r3PackageCopy("trialForward", lang, { credits: includedCredits }) : null;
  const trialNoticeText = trial?.expired ? [r3PackageCopy("trialExpired", lang), forward].filter(Boolean).join(". ") : endsTomorrow && includedCredits !== undefined ? r3PackageCopy("trialTomorrow", lang, { credits: includedCredits }) : null;

  let expiryText: string | null = null;
  if (u.next_expiry) {
    const t = new Date(u.next_expiry).getTime();
    if (Number.isFinite(t) && t > now.getTime()) {
      const date = formatDate(u.next_expiry, lang);
      if (date) expiryText = mentorT("expiry_note", lang, { date });
    }
  }

  const base = {
    creditsText: activeTrial ? r3PackageCopy("trial", lang, { credits: trial!.credits, date: trialDate }) : balanceText,
    trialNoticeText,
    hideCostDetails: u.state === "exhausted",
    // The pilot has not measured its cold-cache share. A fixed cost explanation
    // avoids silently rebasing an individual learner's message estimate.
    messagesText: shellT("cost", lang),
    meterFill: Math.min(1, credits / METER_REFERENCE_CREDITS),
    expiryText,
  };

  const buyable = u.can_buy;
  switch (u.state) {
    case "ok":
      return { ...base, tone: activeTrial ? "trial" : "ok", canChat: true, banner: null, showBuy: false };
    case "low":
      return {
        ...base,
        tone: activeTrial ? "trial" : "low",
        canChat: true,
        banner: { tone: "warning", titleKey: "state_low_title", bodyKey: "state_low_body", offerPackages: buyable },
        showBuy: buyable,
      };
    case "exhausted":
      return {
        ...base,
        tone: "empty",
        canChat: false,
        banner: { tone: "warning", titleKey: "state_exhausted_title", bodyKey: "state_exhausted_body", offerPackages: buyable },
        showBuy: buyable,
      };
    case "none":
      return {
        ...base,
        tone: "empty",
        canChat: true,
        banner: { tone: "info", titleKey: "state_none_title", bodyKey: "state_none_body", offerPackages: buyable },
        showBuy: buyable,
      };
    case "resting":
      return {
        ...base,
        tone: "rest",
        canChat: false,
        banner: { tone: "info", titleKey: "state_resting_title", bodyKey: "state_resting_body", offerPackages: false },
        showBuy: false,
      };
  }
}

/** Consume the server-owned threshold; clients never recreate its grant rule. */
export function isLowCredits(credits: number, threshold: number): boolean {
  return credits < threshold;
}

// ─── Errors ─────────────────────────────────────────────────────────────

export type ErrorAction = "packages" | "retry" | "signin" | "wait" | "new_chat" | "none" | "rephrase" | "pro";

export interface ErrorView {
  messageKey: MentorKey;
  /** Already formatted line that replaces messageKey (MUX-23 admission gap). */
  text?: string;
  vars?: Record<string, string | number>;
  tone: BannerTone;
  action: ErrorAction;
}

export function errorView(code: MentorClientError, opts: { retryAfterSeconds?: number; reason?: string } = {}): ErrorView {
  switch (code) {
    case "invalid_input":
      return opts.reason === "question_access"
        ? { messageKey: "err_question_access", tone: "info", action: "pro" }
        : { messageKey: "err_invalid_input", tone: "error", action: "rephrase" };
    case "unauthenticated":
      return { messageKey: "err_unauthenticated", tone: "warning", action: "signin" };
    case "credits_required":
      // Free taste (MUX-20 A) funds facts mode only: say so instead of a bare paywall.
      return opts.reason === "facts_only"
        ? { messageKey: "err_facts_only", tone: "info", action: "packages" }
        : { messageKey: "err_credits_required", tone: "info", action: "packages" };
    case "credits_exhausted":
      return { messageKey: "err_credits_exhausted", tone: "warning", action: "packages" };
    case "mentor_disabled":
      return { messageKey: "err_mentor_disabled", tone: "info", action: "none" };
    case "input_too_large":
      return { messageKey: "err_input_too_large", tone: "warning", action: "new_chat" };
    case "rate_limited":
      return opts.retryAfterSeconds && opts.retryAfterSeconds > 0
        ? { messageKey: "err_rate_limited", vars: { s: opts.retryAfterSeconds }, tone: "warning", action: "wait" }
        : { messageKey: "err_rate_limited_nowait", tone: "warning", action: "wait" };
    case "ai_disabled":
    case "global_cap":
    case "mentor_resting":
      return { messageKey: "state_resting_body", tone: "info", action: "none" };
    case "already_subscribed":
      return { messageKey: "pkg_already_subscribed", tone: "info", action: "none" };
    case "pending_purchase":
      return { messageKey: "purchase_pending", tone: "info", action: "none" };
    case "reserve_failed":
      return { messageKey: "err_reserve_failed", tone: "error", action: "retry" };
    case "upstream_error":
      return { messageKey: opts.reason === "answer_timeout" ? "err_answer_not_arrived" : "err_upstream_error", tone: "error", action: "retry" };
    case "network":
      return { messageKey: "err_network", tone: "error", action: "retry" };
    default:
      return { messageKey: "err_unknown", tone: "error", action: "retry" };
  }
}

/** Server codes that mean "hide the mentor": the learner is not allowed or it is off. */
export function isDisabledError(code: MentorClientError | undefined): boolean {
  return code === "mentor_disabled";
}

export const ALL_SERVER_ERROR_CODES: readonly MentorErrorCode[] = [
  "invalid_input",
  "unauthenticated",
  "credits_required",
  "credits_exhausted",
  "mentor_disabled",
  "mentor_resting",
  "already_subscribed",
  "pending_purchase",
  "input_too_large",
  "rate_limited",
  "ai_disabled",
  "global_cap",
  "reserve_failed",
  "upstream_error",
];

// ─── Refusals ───────────────────────────────────────────────────────────

export function refusalKey(reason: MentorRefusalReason): MentorKey {
  return `refusal_${reason}` as MentorKey;
}

/** Only https links the server sent are rendered as links. */
export function safeExternalUrl(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// ─── Package offers ─────────────────────────────────────────────────────

export interface OfferView {
  packageId: MentorPackageOffer["package_id"];
  nameKey: MentorKey;
  kindKey: MentorKey;
  creditsText: string;
  messagesText: string;
  priceText: string;
  periodText: string | null;
  validText: string;
  renewsNote: string | null;
  isSubscription: boolean;
  buyText: string;
}

/** A conservative minimum, consistently derived from the granted package row. */
export function conservativeMessageFloor(o: Pick<MentorPackageOffer, "credits">): number {
  return Number.isFinite(o.credits) ? Math.max(0, Math.floor(o.credits)) : 0;
}

export function offerView(o: MentorPackageOffer, lang: MentorUiLang): OfferView {
  const isSub = o.kind === "subscription";
  return {
    packageId: o.package_id,
    nameKey: `pkg_name_${o.package_id}` as MentorKey,
    kindKey: isSub ? "pkg_kind_subscription" : "pkg_kind_topup",
    creditsText: mentorT("credits_count", lang, { n: o.credits }),
    messagesText: shellT("floor", lang, { n: conservativeMessageFloor(o) }),
    priceText: formatEur(o.price_eur_cents, lang),
    periodText: isSub && o.period_days ? mentorT("pkg_period", lang, { n: o.period_days }) : null,
    validText: mentorT("pkg_valid", lang, { n: o.valid_days }),
    renewsNote: isSub && o.period_days ? mentorT("pkg_renews_note", lang, { n: o.period_days }) : null,
    isSubscription: isSub,
    buyText: mentorT(isSub ? "pkg_buy_subscription" : "pkg_buy_once", lang, { price: formatEur(o.price_eur_cents, lang), n: o.period_days ?? 0 }),
  };
}

/** Keep only offers the UI can render safely (known ids, sane numbers). */
export function sanitizeOffers(list: unknown): MentorPackageOffer[] {
  if (!Array.isArray(list)) return [];
  const ids = new Set(["mentor_basis", "mentor_plus", "mentor_topup"]);
  return list.filter((o): o is MentorPackageOffer => {
    if (!o || typeof o !== "object") return false;
    const x = o as Record<string, unknown>;
    return (
      typeof x.package_id === "string" &&
      ids.has(x.package_id) &&
      (x.kind === "subscription" || x.kind === "topup") &&
      typeof x.credits === "number" &&
      x.credits > 0 &&
      typeof x.price_eur_cents === "number" &&
      x.price_eur_cents > 0 &&
      typeof x.messages_estimate === "number" &&
      typeof x.valid_days === "number"
      && (x.kind !== "subscription" || (typeof x.period_days === "number" && x.period_days > 0))
    );
  });
}

/** Pending guards are server-owned. The clock only decides when to offer support. */
export const PENDING_SUPPORT_AFTER_MS = 30 * 60 * 1000;
export const PENDING_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;

export function pendingPurchaseView(u: MentorUsageResponse | undefined, now = Date.now()) {
  const pending = u?.pending_purchase;
  const since = pending ? new Date(pending.since).getTime() : Number.NaN;
  const age = now - since;
  if (!pending || !Number.isFinite(since) || age >= PENDING_EXPIRES_AFTER_MS) return null;
  return { ...pending, showSupport: age >= PENDING_SUPPORT_AFTER_MS, mayRetry: age >= PENDING_SUPPORT_AFTER_MS && pending.retry_allowed === true };
}

/** Never offer the same active plan or a second payment while the first is pending. */
export function packagePurchaseState(u: MentorUsageResponse | undefined, id: MentorPackageOffer["package_id"], now = Date.now()) {
  const subscription = id !== "mentor_topup" ? u?.subscriptions.find((s) => s.package_id === id) : undefined;
  const pending = pendingPurchaseView(u, now);
  const pendingThis = pending?.package_id === id;
  const resting = u?.state === "resting";
  const disabled = !u || !u.can_buy || resting || !!subscription || pendingThis;
  const reasonKey: MentorKey | null = resting ? "pkg_resting" : subscription ? "pkg_active" : pendingThis ? "purchase_pending" : !u?.can_buy ? "state_buy_unavailable" : null;
  return { subscription, pending: pendingThis ? pending : null, resting, disabled, reasonKey, mayRetry: pendingThis && pending.mayRetry && !resting && !!u?.can_buy && !subscription };
}

export function subscriptionText(s: MentorUsageResponse["subscriptions"][number], lang: MentorUiLang): string {
  if (s.status === "payment_failed") return mentorT("pkg_payment_failed", lang);
  const renewDate = formatDate(s.renews_at, lang);
  if (s.renews && renewDate) return mentorT("pkg_active_renews", lang, { date: renewDate });
  const endDate = formatDate(s.ends_at, lang);
  if (endDate) return mentorT("pkg_subscription_ends", lang, { date: endDate });
  return mentorT("pkg_active", lang);
}

// ─── Checkout return ────────────────────────────────────────────────────

export const VERIFY_RETRIES_MS = [2_500, 5_000, 10_000, 20_000, 40_000, 60_000] as const;
export const VERIFY_STEADY_MS = 60_000;
export const VERIFY_CEILING_MS = 5 * 60 * 1000;

export type VerifyUiState = "pending" | "granted" | "slow" | "failed" | "signin";

export interface VerifyProgress {
  state: VerifyUiState;
  credits: number;
  creditsAdded?: number;
  /** Delay before the next automatic check, or null when polling stopped. */
  nextDelayMs: number | null;
}

/**
 * Honesty contract (copied from the Pro checkout success page after the
 * double-payment incident): never report credits as granted until the server
 * says `granted`; keep polling on pending or on a transient failure up to a
 * ceiling; after the ceiling say it is slow, never "done".
 */
export function verifyProgress(
  result: { kind: "verify"; status: "granted" | "pending" | "failed"; credits: number; creditsAdded?: number } | { kind: "error"; error: MentorClientError },
  attempt: number,
  elapsedMs: number,
): VerifyProgress {
  if (result.kind === "verify") {
    if (result.status === "granted") return { state: "granted", credits: result.credits, creditsAdded: result.creditsAdded ?? 0, nextDelayMs: null };
    if (result.status === "failed") return { state: "failed", credits: result.credits, nextDelayMs: null };
  } else if (result.error === "unauthenticated") {
    return { state: "signin", credits: 0, nextDelayMs: null };
  }
  const delay = attempt < VERIFY_RETRIES_MS.length ? VERIFY_RETRIES_MS[attempt] : VERIFY_STEADY_MS;
  if (elapsedMs + delay > VERIFY_CEILING_MS) return { state: "slow", credits: 0, nextDelayMs: null };
  return { state: "pending", credits: 0, nextDelayMs: delay };
}
