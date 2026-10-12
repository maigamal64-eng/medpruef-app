import Link from 'next/link';
import { billingFreeOffer, VERIFIED_CANCEL_PATH, type BillingLang } from '@/lib/billing-copy';

// While no buyer cancellation has been verified end to end (VERIFIED_CANCEL_PATH
// false), the FAQ link is a neutral explanation, never a self-serve promise.
const COPY = {
  pricing: { de: 'Preise', en: 'Pricing' },
  cancelVerified: { de: 'So kündigen Sie', en: 'How to cancel' },
  cancelNeutral: { de: 'So funktioniert die Kündigung', en: 'How cancellation works' },
} as const;

export function cancelLinkLabel(lang: BillingLang, verified: boolean = VERIFIED_CANCEL_PATH): string {
  return (verified ? COPY.cancelVerified : COPY.cancelNeutral)[lang];
}

/** `tone="onDark"` keeps the text readable on the landing's navy hero in both themes. */
export default function FreeOfferDisclosure({ lang, className = '', tone = 'default' }: { lang: BillingLang; className?: string; tone?: 'default' | 'onDark' }) {
  const text = tone === 'onDark' ? 'text-white/75' : 'text-[var(--mp-fg-muted)]';
  const link = tone === 'onDark' ? 'text-white' : 'text-[var(--mp-accent-text)]';
  return <p className={`text-[13px] leading-relaxed ${text} ${className}`}>
    {billingFreeOffer(lang)}{' '}
    <Link href="/pricing" className={`inline-flex min-h-11 items-center underline ${link}`}>{COPY.pricing[lang]}</Link>{' '}
    <Link href="/faq#cancellation" className={`inline-flex min-h-11 items-center underline ${link}`}>{cancelLinkLabel(lang)}</Link>
  </p>;
}
