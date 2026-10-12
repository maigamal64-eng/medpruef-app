/**
 * /verify-email result copy and exits (UX-ONB-40), per state and per whether
 * this browser holds a session. Kept out of the page module so it can be
 * unit-tested (Next page files export only the page).
 */
import { CheckCircle, XCircle, AlertCircle, MailCheck } from "lucide-react";
import { t } from "@/lib/i18n";
import { TELEGRAM_BOT_LINK } from "@/components/TelegramCodeHandoff";

export type VerifyState =
  | "ready"
  | "loading"
  | "success"
  | "already_linked"
  | "invalid_token"
  | "token_expired"
  | "token_already_used"
  | "email_taken"
  | "session_mismatch"
  | "error";

interface ContentSpec {
  icon: React.ReactNode;
  title: string;
  body: string;
  extra?: string;
  ctaHref: string;
  ctaLabel: string;
  secondary?: { href: string; label: string };
}

export function verifyContent(
  state: VerifyState,
  lang: "de" | "en",
  ctx: { signedIn: boolean; linkedEmail: string | null; signInHref: string; continueHref: string },
): ContentSpec {
  const ok = <CheckCircle className="w-14 h-14 text-[var(--mp-viridian)]" aria-hidden />;
  const warn = <AlertCircle className="w-14 h-14 text-[var(--mp-status-warning)]" aria-hidden />;
  const bad = <XCircle className="w-14 h-14 text-[var(--mp-error)]" aria-hidden />;
  const signIn = { ctaHref: ctx.signInHref, ctaLabel: t("a22_verify_sign_in", lang) };
  const settings = { ctaHref: "/settings", ctaLabel: t("a22_verify_settings", lang) };
  switch (state) {
    case "ready":
    case "loading":
      return { icon: <MailCheck className="w-14 h-14 text-[var(--mp-cta-blue)]" aria-hidden />, title: t("a22_verify_ready_title", lang), body: t("a22_verify_ready_body", lang), ...settings };
    case "success":
    case "already_linked": {
      const title = ctx.linkedEmail
        ? t("a22_verify_success_named", lang).replace("{email}", ctx.linkedEmail)
        : t(state === "success" ? "verify_email_confirmed" : "verify_already_linked", lang);
      return ctx.signedIn
        ? { icon: ok, title, body: t("a22_verify_success_body", lang), ctaHref: ctx.continueHref, ctaLabel: t("a22_verify_continue", lang), secondary: { href: "/settings", label: t("a22_verify_settings", lang) } }
        : { icon: ok, title, body: t("a22_verify_success_body", lang), extra: t("a22_verify_success_close", lang), ...signIn, secondary: { href: TELEGRAM_BOT_LINK, label: t("a22_login_telegram_cta", lang) } };
    }
    case "token_already_used":
      return { icon: warn, title: t("verify_link_already_used", lang), body: t("a22_verify_used_body", lang), ...(ctx.signedIn ? settings : signIn) };
    case "token_expired":
      return { icon: warn, title: t("verify_link_expired", lang), body: t("a22_verify_expired_body", lang), ...(ctx.signedIn ? { ctaHref: "/settings", ctaLabel: t("a22_verify_new_link", lang) } : signIn) };
    case "email_taken":
      return { icon: bad, title: t("verify_email_already_in_use", lang), body: t("a22_verify_taken_body", lang), ...(ctx.signedIn ? settings : signIn) };
    case "session_mismatch":
      return { icon: bad, title: t("verify_wrong_account", lang), body: t("a22_verify_mismatch_body", lang), ...settings };
    case "invalid_token":
    case "error":
    default:
      return { icon: bad, title: t("verify_invalid_link", lang), body: t(state === "error" ? "a22_verify_error_body" : "a22_verify_invalid_body", lang), ...signIn };
  }
}
