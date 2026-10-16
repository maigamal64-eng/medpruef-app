/**
 * Handout model (a-partner-kit): what one partner code's printed sheet and
 * square image say. Pure: the A4 PDF writer (./pdf.ts), the image renderer
 * (./handout-image.tsx), the offline script and the admin route all read this
 * one structure, so a sentence is written once and the two formats cannot drift.
 *
 * What a member gets comes from the code's own kind (campaign credits or a seed
 * seat) and its own numbers. No price, no promise beyond the row, no university
 * endorsement. The redeem line follows CODE_AT_SIGNUP_ENABLED (the register
 * field) or the Settings code card.
 */
import { handoutCopy, type RedeemVariant } from "./copy";
import type { PartnerCodeInfo, PartnerLang } from "./index";

export type HandoutFormat = "print" | "image";

export interface HandoutModel {
  lang: PartnerLang;
  variant: RedeemVariant;
  format: HandoutFormat;
  brand: string;
  kicker: string;
  codeLabel: string;
  code: string;
  whatTitle: string;
  what: string;
  mentor: string;
  howTitle: string;
  steps: string[];
  rule: string;
  independence: string;
}

/** Vienna calendar date of the code's end, in the handout language. */
export function handoutDate(iso: string, lang: PartnerLang): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "de-AT", { timeZone: "Europe/Vienna", day: "numeric", month: "long", year: "numeric" }).format(new Date(t));
}

/** The register variant exists only while the typed-code field is built in (CODE_AT_SIGNUP_ENABLED). */
export function variantFromEnv(env: Record<string, string | undefined> = process.env): RedeemVariant {
  return env.CODE_AT_SIGNUP_ENABLED === "true" ? "register" : "settings";
}

export function buildHandout(info: PartnerCodeInfo, lang: PartnerLang, variant: RedeemVariant, format: HandoutFormat): HandoutModel {
  const c = handoutCopy(lang);
  const until = handoutDate(info.endsAt, lang);
  const seat = info.kind === "seat" && info.proDays;
  return {
    lang,
    variant,
    format,
    brand: c.brand,
    kicker: c.kicker,
    codeLabel: c.codeLabel,
    code: info.code,
    whatTitle: c.whatTitle,
    what: seat ? c.seatWhat(info.proDays as number, info.credits) : c.creditsWhat(info.credits, info.expiryDays),
    mentor: c.mentorLine,
    howTitle: c.howTitle,
    steps: [
      format === "print" ? c.stepSearchPrint : c.stepSearchImage,
      variant === "register" ? c.stepRegister : c.stepSettings,
      ...(variant === "register" ? [c.stepAfterRegister] : []),
    ],
    rule: seat ? c.seatRule(info.maxAccountAgeDays, until) : c.creditsRule(info.maxAccountAgeDays, until),
    independence: c.independence,
  };
}
