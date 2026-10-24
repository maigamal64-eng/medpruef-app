import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import PublicIntegrations from "@/components/PublicIntegrations";
import TrackerInit from "@/components/TrackerInit";
import ThemeProvider from "@/components/ThemeProvider";
import { LANGUAGE_HEAD_SCRIPT } from "@/lib/language-model";
import { CONSENT_HEAD_SCRIPT } from "@/lib/consent-copy";
import LegalFooter from "@/components/LegalFooter";
import { TIERS, FREE_TIER } from "@/lib/content-truth";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { v2JsonLdOffers } from "@/lib/pricing-v2/structured";
import { billingAmount } from "@/lib/billing-copy";
import PWAInstall from "@/components/PWAInstall";
import IntercomMessenger from "@/components/IntercomMessenger";
import GuestMigrationBanner from "@/components/GuestMigrationBanner";
import CohortCountdownBanner from "@/components/CohortCountdownBanner";
import RenewalPrompt from "@/components/RenewalPrompt";
import CookieBannerMount from "@/components/CookieBannerMount";
import LangHtmlSync from "@/components/LangHtmlSync";
import AttributionCapture from "@/components/AttributionCapture";
import PendingCodeRedeemer from "@/components/code-entry/PendingCodeRedeemer";
import PendingExamRecovery from "@/components/exam/PendingExamRecovery";
import TrackRouteChange from "@/components/TrackRouteChange";
import SearchModalMount from "@/components/SearchModalMount";
import StatusRegion, { StatusSlot } from "@/components/shell/StatusRegion";
import RunningExamChip from "@/components/exam/RunningExamChip";
import NavigationMarker from "@/components/shell/NavigationMarker";
import OfflineIndicator from "@/components/OfflineIndicator";
import CheckoutReturnReader from "@/components/CheckoutReturnReader";
import { LiveRegions } from "@/components/ui/LiveRegions";
import WebMCP from "@/components/WebMCP";
import { ToastProvider } from "@/components/ui";
import RootErrorBoundary from "@/components/RootErrorBoundary";
import { Suspense } from "react";

// Fonts are committed woff2 files (latin subset, variable axis) served through
// next/font/local, so a build never fetches from fonts.googleapis.com
// (a no-cache Vercel redeploy failed on that fetch, 24 Oct 2026).
const inter = localFont({
  src: "../fonts/inter-latin-var.woff2",
  weight: "300 900",
  display: "swap",
  // latin-ext and cyrillic come from the unicode-range @font-face rules at the top of globals.css (ru, uk, tr, sr text).
  fallback: ["MP Inter Cyrillic", "MP Inter Latin Ext"],
  // The size-adjusted Arial face would sit before the extra subsets and catch their glyphs.
  adjustFontFallback: false,
});

const plusJakarta = localFont({
  src: "../fonts/plus-jakarta-sans-latin-var.woff2",
  weight: "600 800",
  display: "swap",
  fallback: ["MP Jakarta Latin Ext"],
  adjustFontFallback: false,
  variable: "--font-display",
});

// JetBrains Mono — the "lab-header" voice. Powers the landing's mono
// eyebrows (.lp-eyebrow), the provenance stamp, exam-tab pills, and the
// tabular metric numerals (--mp-font-mono / .font-mono). globals.css has
// long referenced `--font-jetbrains-mono` but no loader ever defined it,
// so those surfaces silently fell back to system mono (Menlo/Consolas) —
// inconsistent across OSes. Loading it here makes the clinical-record
// type system real and consistent. Two weights keep the payload small.
const jetbrainsMono = localFont({
  src: "../fonts/jetbrains-mono-latin-var.woff2",
  weight: "500 600",
  display: "swap",
  variable: "--font-jetbrains-mono",
});



export const metadata: Metadata = {
  metadataBase: new URL("https://medpruf.com"),
  icons: {
    icon: [
      // SVG favicon: transparent background + prefers-color-scheme for auto
      // dark/light. Preferred by all modern browsers.
      { url: "/favicon.svg", type: "image/svg+xml" },
      // PNG fallback for browsers that don't support SVG favicons.
      { url: "/brand/favicon-64.png", type: "image/png", sizes: "64x64" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // LX-13: the home-screen app on iOS launches full screen with its own name.
  // statusBarStyle "default" keeps content below the status bar, so it needs
  // no safe-area handling; "black-translucent" and viewport-fit=cover wait
  // for the staged safe-area audit and a real-iPhone check (a28 release.md).
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MedPrüf",
  },
  title: {
    default: "MedPrüf: SIP4a, SIP5a und Stichprobentest üben",
    // Per-page titles are already formatted as "{Page} — MedPrüf" in
    // each route's metadata, so the template uses `%s` verbatim — we
    // do NOT want a trailing " | MedPrüf" on a value that already ends
    // with "— MedPrüf".
    template: "%s",
  },
  description:
    `Kuratierte Übungsfragen für SIP4a, SIP5a, Stichprobentest und Rezeptierkunde in Österreich. ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank als kostenlose Probe, ohne Karte.`,
  keywords: [
    "Kenntnisprüfung", "Austrian medical exam", "Vienna medical license",
    "SIP 4", "SIP 5", "medical exam preparation",
    "Kenntnisprüfung Vorbereitung", "Prüfungsvorbereitung Medizin",
    "foreign doctor Austria",
    "medical MCQ", "clinical questions", "exam simulation",
  ],
  authors: [{ name: "MedPrüf", url: "https://medpruf.com" }],
  creator: "MedPrüf",
  publisher: "[name]",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  // a-seo-from-gsc (15 Oct 2026): no default canonical. The old default
  // (the /landing URL) was inherited by every page without its own
  // canonical, so Search Console listed the guidance pages as "Alternate page
  // with proper canonical tag" of /landing. Pages set their own canonical;
  // /landing keeps "/".
  openGraph: {
    type: "website",
    locale: "de_AT",
    url: "https://medpruf.com/",
    siteName: "MedPrüf",
    title: "MedPrüf: SIP4a, SIP5a und Stichprobentest üben",
    description:
      `Kuratierte Übungsfragen für SIP4a, SIP5a, Stichprobentest und Rezeptierkunde in Österreich. ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank als kostenlose Probe, ohne Karte.`,
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "MedPrüf: Kenntnisprüfung Preparation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MedPrüf: SIP4a, SIP5a und Stichprobentest üben",
    description:
      `Kuratierte Übungsfragen für SIP4a, SIP5a, Stichprobentest und Rezeptierkunde in Österreich. ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank als kostenlose Probe, ohne Karte.`,
    images: ["/brand/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // ONB-50 / UX-GLOBAL-11: the soft keyboard resizes the layout viewport, so
  // fixed bars and focused fields are not covered. viewport-fit=cover waits
  // for the staged safe-area work and a real-iPhone test (release.md).
  interactiveWidget: "resizes-content",
  // WCAG 2.1 1.4.4 requires that users can resize text to 200%
  // without loss of content or functionality. Previously this export
  // set `maximumScale: 1, userScalable: false` which blocked pinch-
  // zoom entirely — a hard a11y fail, especially given the audience
  // (doctors reading dense German clinical text on mobile). Fixed
  // 2026-04-15 (Infra P2-INFRA-3 + UX audit, cross-referenced by
  // Frontend agent).
  //
  // theme-color = Oxford navy to match manifest.json `theme_color`
  // (#001B3D) — was #F7F9FC (the light surface), a mismatch the
  // brand-sweep audit flagged. Single source: the dark brand surface.
  themeColor: "#001B3D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" dir="ltr" translate="no" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANGUAGE_HEAD_SCRIPT }} />
        {/* UX-GLOBAL-13: reserve the consent bar's height before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: CONSENT_HEAD_SCRIPT }} />
        {/*
          Tell Google Translate (and Edge / iOS Safari translate) to leave
          the DOM alone. The native language picker is the supported way to
          switch language; when Translate rewrites text nodes mid-render,
          React's reconciliation crashes with "NotFoundError: Failed to
          execute 'removeChild' / 'insertBefore'" — see Sentry issue,
          review-2026-04-26-B3.

          This meta plus the `<html translate="no">` attribute below
          (`translate="no"`) gives all modern browsers the right hint
          without breaking i18n hreflang.
        */}
        <meta name="google" content="notranslate" />

        {/*
          Stale-SW kill-switch — MUST run before anything else.

          Problem: users who registered the pre-2026-04-14 static SW
          (public/sw.js, medpruef-v1) are in a cache-purgatory loop. The old
          SW does stale-while-revalidate for every same-origin request, so
          their browser keeps serving pre-daffcb5 JS — which has no
          captureClientContext — which means every flag/feedback from them
          lands in the DB anonymous. The *new* /api/sw is deployed, but the
          old SW won't be replaced until Chrome's own 24h update check fires
          OR the user hard-reloads.

          This inline script closes the loop: on every HTML load, it pings
          the current SW controller with GET_BUILD_ID. The *new* SW responds
          with its build id. The *old* SW has no handler and never responds.
          After 1.5s of no response (or a build-id mismatch) we unregister
          every SW, delete every cache, and hard-reload. A sessionStorage
          flag prevents a reload loop if something goes wrong.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  if(!('serviceWorker' in navigator))return;
  var LAST_KILL_KEY='medpruef_sw_last_kill';
  var RETRY_MS=30*60*1000;
  try{
    var last=parseInt(sessionStorage.getItem(LAST_KILL_KEY)||'0',10);
    if(last && (Date.now()-last)<RETRY_MS)return;
  }catch(e){}
  var EXPECTED=${JSON.stringify(process.env.NEXT_PUBLIC_BUILD_ID || "")};
  function shouldReload(swBuild){
    if(!EXPECTED||EXPECTED==='dev-local')return false;
    if(swBuild===null)return true;
    if(swBuild==='')return false;
    return EXPECTED!==swBuild;
  }
  function killStale(){
    try{sessionStorage.setItem(LAST_KILL_KEY,String(Date.now()));}catch(e){}
    var p1=navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}).catch(function(){});
    var p2=('caches' in window)?caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}).catch(function(){}):Promise.resolve();
    Promise.all([p1,p2]).then(function(){location.reload();});
  }
  // Expose a user-invocable escape hatch so a stuck user can force a
  // rebuild even if the SW never responds with a build-id.
  try{window.__medpruefForceRefresh=killStale;}catch(e){}
  if(!navigator.serviceWorker.controller)return;
  var responded=false;
  var timer=setTimeout(function(){if(responded)return;responded=true;if(shouldReload(null)){console.warn('[medpruef] stale SW: no build-id response, nuking');killStale();}},1500);
  function onMsg(ev){
    if(responded)return;
    if(!ev.data||ev.data.type!=='BUILD_ID')return;
    responded=true;clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('message',onMsg);
    var swBuild=ev.data.buildId||'';
    if(shouldReload(swBuild)){console.warn('[medpruef] SW build mismatch:',swBuild,'!=',EXPECTED);killStale();}
  }
  navigator.serviceWorker.addEventListener('message',onMsg);
  try{navigator.serviceWorker.controller.postMessage({type:'GET_BUILD_ID'});}catch(e){}
})();`,
          }}
        />
        <link rel="manifest" href="/manifest.json" />
        {/*
          Canonical is emitted via the Next.js Metadata API
          (`alternates.canonical`), defaulting to /landing here and
          overridden per-route in each child layout. Do NOT also hard-code a
          <link rel="canonical"> here — a static one rendered on every page
          (pointing at the redirecting "/" root) produced a DOUBLE canonical
          on /landing and fought the metadata one. Brand-sweep 2026-06-04.
        */}
        {/*
          Structured data — one @graph so the entities interlink by @id
          (MedPrüf Organization ⇄ WebApplication ⇄ parent [name]).

          Honesty rules baked in (brand-sweep 2026-06-04):
          - Offers list ONLY the tiers that are actually purchasable today:
            the free tier + the three live tiers (amounts from content-truth TIERS), all
            paid by card via Whop.
          - No aggregateRating / Review (removed 2026-04-22 — the hard-coded
            4.8/156 didn't match real data; re-introduce only when wired to
            real user_feedback).
          - Question count is described qualitatively ("over 10,000"); the
            exact figure is DB-owned and drifts, so it is not frozen here.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": "https://medpruf.com/#organization",
                  "name": "MedPrüf",
                  "url": "https://medpruf.com",
                  "logo": "https://medpruf.com/brand/logomark.svg",
                  "image": "https://medpruf.com/brand/og-image.png",
                  "description":
                    "Exam preparation for the Austrian medical licensing exams (Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie) for foreign-trained doctors. German-language questions, Austrian exam scope.",
                  "areaServed": {
                    "@type": "Country",
                    "name": "Austria",
                  },
                  "knowsAbout": [
                    "Kenntnisprüfung Wien",
                    "Stichprobentest",
                    "Stichprobentest Innsbruck",
                    "Pharmakologie",
                    "Austrian medical licensing",
                    "Nostrifikation",
                  ],
                  "parentOrganization": {
                    "@id": "https://example.com/#organization",
                  },
                  "contactPoint": {
                    "@type": "ContactPoint",
                    "email": "user-b7e46e80@example.com",
                    "contactType": "customer support",
                    "availableLanguage": ["German", "English"],
                  },
                  "sameAs": [
                    "https://example.com",
                    "https://example.com",
                    "https://t.me/MedPruefBot",
                  ],
                },
                {
                  "@type": "Organization",
                  "@id": "https://example.com/#organization",
                  "name": "[name]",
                  "url": "https://example.com",
                },
                {
                  "@type": "WebApplication",
                  "@id": "https://medpruf.com/#webapp",
                  "name": "MedPrüf",
                  "url": "https://medpruf.com",
                  "description":
                    "Austrian medical exam preparation platform with over 10,000 clinical questions across 16 specialties and 3 exam types (Kenntnisprüfung Wien, Stichprobentest (Innsbruck), Pharmakologie).",
                  "applicationCategory": "EducationalApplication",
                  "operatingSystem": "Web",
                  "inLanguage": "de",
                  "publisher": { "@id": "https://medpruf.com/#organization" },
                  "author": { "@id": "https://example.com/#organization" },
                  // Only purchasable tiers are listed. Free + the three live
                  // paid tiers (priced in EUR, paid by card via Whop).
                  "offers": [
                    {
                      "@type": "Offer",
                      "name": "Free tier",
                      "price": "0",
                      "priceCurrency": "EUR",
                      "availability": "https://schema.org/InStock",
                      "description":
                        "150 questions per exam type, with clinical explanations where available, no credit card.",
                    },
                    // a-pricing-v2: the v2 offer when PRICING_V2_ENABLED (read at build).
                    ...(pricingV2Enabled() ? v2JsonLdOffers() : [
                    {
                      "@type": "Offer",
                      "name": "Single month",
                      "price": String(TIERS.first_month_19.price_cents / 100),
                      "priceCurrency": "EUR",
                      "availability": "https://schema.org/InStock",
                      // UX-GLOBAL-08: amounts from the plan data; no cancel promise while VERIFIED_CANCEL_PATH is off.
                      "description":
                        `Monthly recurring full access at ${billingAmount(TIERS.first_month_19.price_cents, "en")}. Renews every 30 days until cancelled at Whop. Payable by card (Visa, Mastercard, Apple Pay).`,
                    },
                    {
                      "@type": "Offer",
                      "name": "3-month starter",
                      "price": String(TIERS.first_3mo_27.price_cents / 100),
                      "priceCurrency": "EUR",
                      "availability": "https://schema.org/InStock",
                      "description":
                        `Quarterly recurring full access at ${billingAmount(TIERS.first_3mo_27.price_cents, "en")} every 90 days until cancelled at Whop. Payable by card (Visa, Mastercard, Apple Pay).`,
                    },
                    {
                      "@type": "Offer",
                      "name": "Exam Cohort",
                      "price": String(TIERS.premium_pass_guaranteed.price_cents / 100),
                      "priceCurrency": "EUR",
                      "availability": "https://schema.org/InStock",
                      "description":
                        "6 months of full access with the Pass-Until-You-Pass guarantee. Payable by card (Visa, Mastercard, Apple Pay).",
                    },
                    ]),
                  ],
                },
              ],
            }),
          }}
        />
        {/*
          Google Analytics 4 + Microsoft Clarity are now loaded by
          <ConsentGatedAnalytics /> ONLY after the user explicitly
          accepts cookies. This is the ePrivacy / Austrian TTDSG fix
          the 2026-04-15 audit flagged as a P0 legal issue (the prior
          implementation unconditionally loaded both on first paint
          regardless of consent, and the CookieBanner was defined in
          the repo but never mounted).
        */}
      </head>
      <body
        className={`${inter.className} ${plusJakarta.variable} ${jetbrainsMono.variable} bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] min-h-screen min-h-dvh antialiased`}
      >
        <ThemeProvider />
        {/* Keep <html lang> in sync with the user's chosen language. SSR
            renders <html lang="de">; this client component flips it on
            mount + on every setLang() event. review-2026-04-25-B9. */}

        <TrackerInit />
        {/* TrackRouteChange uses useSearchParams; Suspense wrapper
            is required by Next.js 15 for components that read it. */}
        <Suspense fallback={null}>
          <TrackRouteChange />
        </Suspense>
        {/* RootErrorBoundary catches NotFoundError-class crashes
            (Translate-extension DOM mutations, portal cleanup races)
            and renders a calm reload toast instead of a white screen.
            review-2026-04-26-B3. */}
        <RootErrorBoundary>
          {/* ToastProvider wraps the app so any component can call useToast()
              to push a transient notification. Renders a single a11y-live
              region for screen readers. See src/components/ui/Toast.tsx. */}
          <ToastProvider>
            {/* Top-fixed banners share ONE fixed flex-col stack so they never
                overlap each other when more than one is active (similar-sweep
                P2, 2026-07-01). Each banner's own root is normal flow now; this
                container owns the single fixed top-0 slot. Priority order top to
                bottom: guest migration, renewal prompt, cohort countdown,
                PWA install. The renewal prompt sits high because it is the
                only one of these that a PAYING user ever sees (the cohort
                banner and the announcement gate both suppress themselves
                for paid accounts), so the two can never compete. */}
            {/* UX-GLOBAL-11: one in-flow, sticky top status region in the
                gate's priority order (offline, renewal, guest, cohort,
                then the PWA update/install strip). One at a time on phones; it publishes --mp-banner-h
                so headers and focus never sit under it. */}
            <StatusRegion>
              <StatusSlot name="offline"><OfflineIndicator /></StatusSlot>
              <StatusSlot name="exam"><RunningExamChip /></StatusSlot>
              <StatusSlot name="renewal"><RenewalPrompt /></StatusSlot>
              <StatusSlot name="guest"><GuestMigrationBanner /></StatusSlot>
              <StatusSlot name="cohort"><CohortCountdownBanner /></StatusSlot>
              {/* PWAInstall renders both the update banner and the install
                  prompt; the install prompt must not outrank real status. */}
              <StatusSlot name="pwa"><PWAInstall /></StatusSlot>
            </StatusRegion>
            <LiveRegions />
            <NavigationMarker />
            <IntercomMessenger />
            <SearchModalMount />
            <CookieBannerMount />
            <LangHtmlSync />
            <PublicIntegrations />
            {/* First-touch campaign attribution (utm_* + rdt_cid) captured to
                localStorage on landing, attached to the register call. Not a
                tracker, no consent gate needed (first-party, no network). */}
            <AttributionCapture />
            <PendingCodeRedeemer />
            <PendingExamRecovery />
            <CheckoutReturnReader />
            {/* WebMCP tool surface (agent-readiness) — registers read-only
                exam-calendar tools with an in-browser AI agent via the
                experimental navigator.modelContext API. Feature-detects and
                no-ops on every browser that doesn't implement it yet
                (expected — WebMCP is not yet standardized). Renders null. */}
            <WebMCP />
            {children}
            {/* LegalFooter — slim Impressum/Datenschutz/AGB/Kontakt strip
                on authenticated pages. Auto-hides on /landing (full
                footer), /login (pre-auth), /onboarding, and /admin/*
                (own footer). review-2026-04-25-B13. */}
            <LegalFooter />
          </ToastProvider>
        </RootErrorBoundary>
      </body>
    </html>
  );
}
