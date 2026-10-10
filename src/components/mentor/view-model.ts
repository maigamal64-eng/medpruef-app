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
import { MENTOR_LOW_CREDITS } from "@/lib/mentor/config";
import type { MentorKey, MentorUiLang } from "@/lib/i18n-mentor";
import { mentorT } from "@/lib/i18n-mentor";
import type { MentorClientError } from "./api";

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
  ru: "Русский",
  uk: "Українська",
  tr: "Türkçe",
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
  tone: "ok" | "low" | "empty" | "rest";
  /** Composer enabled. Resting and exhausted block sending; none stays open (the server decides). */
  canChat: boolean;
  banner: UsageBanner | null;
  expiryText: string | null;
  /** True when buying is on sale (server flag) and the state can use it. */
  showBuy: boolean;
}

const EXPIRY_NOTICE_DAYS = 10;
/** Soft visual reference for the meter only; not a limit and never shown as a number. */
const METER_REFERENCE_CREDITS = 200;

export function usageView(u: MentorUsageResponse, lang: MentorUiLang, now: Date = new Date()): UsageView {
  const credits = Math.max(0, Math.floor(u.credits_left));
  const msgs = Math.max(0, Math.floor(u.messages_left_estimate));

  let expiryText: string | null = null;
  if (u.next_expiry && credits > 0) {
    const t = new Date(u.next_expiry).getTime();
    if (Number.isFinite(t) && t - now.getTime() <= EXPIRY_NOTICE_DAYS * 86_400_000 && t > now.getTime()) {
      const date = formatDate(u.next_expiry, lang);
      if (date) expiryText = mentorT("expiry_note", lang, { date });
    }
  }

  const base = {
    creditsText: mentorT("credits_count", lang, { n: credits }),
    messagesText: mentorT("messages_about", lang, { n: msgs }),
    meterFill: Math.min(1, credits / METER_REFERENCE_CREDITS),
    expiryText,
  };

  const buyable = u.can_buy;
  switch (u.state) {
    case "ok":
      return { ...base, tone: "ok", canChat: true, banner: null, showBuy: false };
    case "low":
      return {
        ...base,
        tone: "low",
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

/** Mirrors the server rule so the UI can hint "low" before the next usage fetch. */
export function isLowCredits(credits: number): boolean {
  return credits < MENTOR_LOW_CREDITS;
}

// ─── Errors ─────────────────────────────────────────────────────────────

export type ErrorAction = "packages" | "retry" | "signin" | "wait" | "new_chat" | "none";

export interface ErrorView {
  messageKey: MentorKey;
  vars?: Record<string, string | number>;
  tone: BannerTone;
  action: ErrorAction;
}

export function errorView(code: MentorClientError, opts: { retryAfterSeconds?: number } = {}): ErrorView {
  switch (code) {
    case "invalid_input":
      return { messageKey: "err_invalid_input", tone: "error", action: "none" };
    case "unauthenticated":
      return { messageKey: "err_unauthenticated", tone: "warning", action: "signin" };
    case "credits_required":
      return { messageKey: "err_credits_required", tone: "info", action: "packages" };
    case "credits_exhausted":
      return { messageKey: "err_credits_exhausted", tone: "warning", action: "packages" };
    case "mentor_disabled":
      return { messageKey: "err_mentor_disabled", tone: "info", action: "none" };
    case "locked_today":
      return { messageKey: "err_locked_today", tone: "warning", action: "none" };
    case "input_too_large":
      return { messageKey: "err_input_too_large", tone: "warning", action: "new_chat" };
    case "rate_limited":
      return opts.retryAfterSeconds && opts.retryAfterSeconds > 0
        ? { messageKey: "err_rate_limited", vars: { s: opts.retryAfterSeconds }, tone: "warning", action: "wait" }
        : { messageKey: "err_rate_limited_nowait", tone: "warning", action: "wait" };
    case "ai_disabled":
    case "global_cap":
    case "reserve_failed":
    case "upstream_error":
      return { messageKey: "err_unavailable", tone: "error", action: "retry" };
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
  "locked_today",
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
}

export function offerView(o: MentorPackageOffer, lang: MentorUiLang): OfferView {
  const isSub = o.kind === "subscription";
  return {
    packageId: o.package_id,
    nameKey: `pkg_name_${o.package_id}` as MentorKey,
    kindKey: isSub ? "pkg_kind_subscription" : "pkg_kind_topup",
    creditsText: mentorT("credits_count", lang, { n: o.credits }),
    messagesText: mentorT("messages_about", lang, { n: o.messages_estimate }),
    priceText: formatEur(o.price_eur_cents, lang),
    periodText: isSub && o.period_days ? mentorT("pkg_period", lang, { n: o.period_days }) : null,
    validText: mentorT("pkg_valid", lang, { n: o.valid_days }),
    renewsNote: isSub && o.period_days ? mentorT("pkg_renews_note", lang, { n: o.period_days }) : null,
    isSubscription: isSub,
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
    );
  });
}

// ─── Checkout return ────────────────────────────────────────────────────

export const VERIFY_RETRIES_MS = [2_500, 5_000, 10_000, 20_000, 40_000, 60_000] as const;
export const VERIFY_STEADY_MS = 60_000;
export const VERIFY_CEILING_MS = 5 * 60 * 1000;

export type VerifyUiState = "pending" | "granted" | "slow" | "failed" | "signin";

export interface VerifyProgress {
  state: VerifyUiState;
  credits: number;
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
  result: { kind: "verify"; status: "granted" | "pending" | "failed"; credits: number } | { kind: "error"; error: MentorClientError },
  attempt: number,
  elapsedMs: number,
): VerifyProgress {
  if (result.kind === "verify") {
    if (result.status === "granted") return { state: "granted", credits: result.credits, nextDelayMs: null };
    if (result.status === "failed") return { state: "failed", credits: result.credits, nextDelayMs: null };
  } else if (result.error === "unauthenticated") {
    return { state: "signin", credits: 0, nextDelayMs: null };
  }
  const delay = attempt < VERIFY_RETRIES_MS.length ? VERIFY_RETRIES_MS[attempt] : VERIFY_STEADY_MS;
  if (elapsedMs + delay > VERIFY_CEILING_MS) return { state: "slow", credits: 0, nextDelayMs: null };
  return { state: "pending", credits: 0, nextDelayMs: delay };
}
