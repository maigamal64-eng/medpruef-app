import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Whop checkout success landing (redirect target set on the checkout
 * configuration). Access is granted by the /api/webhooks/whop webhook on
 * `payment.succeeded`, not here — so this page only reassures + routes the
 * user back in. Tier flip usually lands within a minute.
 */
export default function CheckoutSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[#F7F9FC] dark:bg-[#0F172A]">
      <div className="w-full max-w-md text-center rounded-2xl border border-[#E4E9F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] p-8 shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#007B5F]/10 text-[#007B5F]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-[#1A2B3C] dark:text-[#E2E8F0]">
          Zahlung erhalten, danke
        </h1>
        <p className="mt-3 text-[#4A5568] dark:text-[#A0AEC0]">
          Wir schalten deinen MedPrüf-Pro-Zugang gerade frei. Das dauert meist unter einer Minute. Lade die Seite danach einmal neu, falls Pro noch nicht aktiv ist.
        </p>
        <p className="mt-2 text-sm text-[#4A5568] dark:text-[#A0AEC0]">
          Payment received. We are unlocking your MedPrüf Pro access now (usually under a minute). If it is not active yet, just refresh.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#003A8C] px-6 py-3 font-semibold text-white transition hover:opacity-90"
        >
          Weiter zu MedPrüf
        </Link>
        <p className="mt-4 text-xs text-[#A0AEC0]">
          Eine Frage? Schreib an user-b7e46e80@example.com
        </p>
      </div>
    </main>
  );
}
