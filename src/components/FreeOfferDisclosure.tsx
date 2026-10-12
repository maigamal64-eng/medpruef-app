import Link from 'next/link';
import { billingFreeOffer, type BillingLang } from '@/lib/billing-copy';

export default function FreeOfferDisclosure({ lang, className = '' }: { lang: BillingLang; className?: string }) {
  return <p className={`text-[13px] leading-relaxed text-[var(--mp-fg-muted)] ${className}`}>
    {billingFreeOffer(lang)}{' '}
    <Link href="/pricing" className="inline-flex min-h-11 items-center text-[var(--mp-accent-text)] underline">{lang === 'de' ? 'Preise' : 'Pricing'}</Link>{' '}
    <Link href="/faq#cancellation" className="inline-flex min-h-11 items-center text-[var(--mp-accent-text)] underline">{lang === 'de' ? 'So kündigst du' : 'How to cancel'}</Link>
  </p>;
}
