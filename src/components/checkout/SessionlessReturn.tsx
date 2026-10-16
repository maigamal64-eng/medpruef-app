"use client";
/**
 * a-tg-checkout-context: the success pages opened with no session (the
 * external browser after paying, flag TG_CHECKOUT_OPENLINK_ENABLED on).
 *
 * Reads nothing: no verify call, no account read, no payment claim. It names
 * the app to go back to; the Telegram button is a hard-coded bot link, and the
 * hint is only the enum value `via=tg_webapp` the server appended to the
 * Whop redirect. The webhook grant stays the backstop. A sign-in link is a
 * quiet secondary option, never a wall.
 */
import Link from "next/link";
import { Clock } from "lucide-react";
import { TELEGRAM_RETURN_URL } from "@/lib/checkout-context";
import { tgCheckoutCopy } from "@/lib/tg-checkout-copy";

export default function SessionlessReturn({ kind, hint, lang, signInHref, signInLabel }: {
  kind: "access" | "credits" | "trial";
  hint: "tg_webapp" | null;
  lang: string;
  signInHref: string;
  signInLabel: string;
}) {
  const body = kind === "credits"
    ? tgCheckoutCopy(hint ? "return_body_credits_tg" : "return_body_credits", lang)
    : kind === "trial"
      ? tgCheckoutCopy(hint ? "return_body_trial_tg" : "return_body_trial", lang)
      : tgCheckoutCopy(hint ? "return_body_tg" : "return_body", lang);
  return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]" data-testid="checkout-sessionless">
    <div className="mp-card mx-auto max-w-lg p-5 sm:p-8 space-y-4">
      <div role="status" aria-live="polite" className="space-y-3">
        <Clock aria-hidden className="h-10 w-10 text-[var(--mp-fg-muted)]" />
        <h1 className="mp-h2">{tgCheckoutCopy("return_title", lang)}</h1>
        <p className="mp-body">{body}</p>
        <p className="mp-body">{tgCheckoutCopy(kind === "trial" ? "return_no_repeat_trial" : "return_no_repeat", lang)}</p>
      </div>
      {hint === "tg_webapp" && <a className="mp-btn mp-btn--primary min-h-12 w-full justify-center" href={TELEGRAM_RETURN_URL} rel="noopener noreferrer" data-testid="checkout-return-telegram">{tgCheckoutCopy("return_telegram", lang)}</a>}
      <Link className="inline-flex min-h-11 items-center text-sm underline text-[var(--mp-fg-muted)]" href={signInHref}>{signInLabel}</Link>
    </div>
  </main>;
}
