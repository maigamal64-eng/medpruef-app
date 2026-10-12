"use client";
/**
 * Inline checkout recovery (UX-ACC-09, LX-26): one panel per plan with copy by
 * cause and the right next step. Pending: the strip's check, never a second
 * checkout. Failed or offline: "Erneut versuchen" re-creates the checkout.
 * Signed out: sign in, then the plan resumes. Errors are role=alert.
 */
import { BILLING_SUPPORT_EMAIL, type BillingLang } from "@/lib/billing-copy";
import { t } from "@/lib/i18n";
import { WHOP_MANAGE_URL } from "@/lib/billing-copy";

export type CheckoutProblemState = "pending" | "failed" | "offline" | "signin" | "renewing" | "already" | "extension" | "unverified";

export default function CheckoutProblem({ state, lang, onRetry, onCheck, onSignIn }: {
  state: CheckoutProblemState;
  lang: BillingLang;
  onRetry: () => void;
  onCheck: () => void;
  onSignIn: () => void;
}) {
  const de = lang === "de";
  const text = state === "pending" ? t("account_do_not_pay_again", lang)
    : state === "offline" ? t("account_checkout_offline", lang)
    : state === "signin" ? t("account_checkout_signin", lang)
    : state === "renewing" ? t("account_checkout_renewing", lang)
    : state === "already" ? t("account_checkout_already", lang)
    : state === "extension" ? t("account_extension_unavailable", lang)
    : state === "unverified" ? t("account_plan_unverified", lang)
    : t("account_checkout_failed", lang);
  const alert = state === "failed" || state === "offline";
  return (
    <div className="mp-card p-4 my-3 text-sm space-y-2" data-checkout-problem={state}>
      <p role={alert ? "alert" : "status"} className="m-0">{text}</p>
      <div className="flex flex-wrap gap-3">
        {(state === "failed" || state === "offline") && <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onRetry}>{t("account_checkout_try_again", lang)}</button>}
        {state === "pending" && <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onCheck}>{de ? "Zahlung prüfen" : "Check payment"}</button>}
        {state === "signin" && <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onSignIn}>{de ? "Anmelden" : "Sign in"}</button>}
        {state === "renewing" && <a className="mp-btn mp-btn--secondary min-h-11" href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer">{de ? "Abo bei Whop verwalten" : "Manage at Whop"}</a>}
        <a className="inline-flex min-h-11 items-center underline" href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent(de ? "Hilfe zur Zahlung" : "Payment help")}`}>{de ? "Hilfe zur Zahlung" : "Payment help"}</a>
      </div>
    </div>
  );
}
