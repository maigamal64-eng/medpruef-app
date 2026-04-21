import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import TrackerInit from "@/components/TrackerInit";
import ThemeProvider from "@/components/ThemeProvider";
import PWAInstall from "@/components/PWAInstall";
import FeedbackWidget from "@/components/FeedbackWidget";
import GuestMigrationBanner from "@/components/GuestMigrationBanner";
import EmailValidationModal from "@/components/EmailValidationModal";
import CookieBannerMount from "@/components/CookieBannerMount";
import ConsentGatedAnalytics from "@/components/ConsentGatedAnalytics";
import OfflineIndicator from "@/components/OfflineIndicator";
import TrackRouteChange from "@/components/TrackRouteChange";
import SearchModalMount from "@/components/SearchModalMount";
import { ToastProvider } from "@/components/ui";
import { Suspense } from "react";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-display",
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
  title: {
    default: "MedPrüf — Austrian Kenntnisprüfung Preparation (Vienna)",
    template: "%s | MedPrüf",
  },
  description: "Prepare for Austrian medical exams (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie) with 10,993+ clinical questions across 16 specialties. Exam simulation, flashcards, spaced repetition, performance analytics. Built for foreign doctors.",
  keywords: [
    "Kenntnisprüfung", "Austrian medical exam", "Vienna medical license",
    "SIP 4", "SIP 5", "medical exam preparation", "Ärztekammer Wien",
    "Kenntnisprüfung Vorbereitung", "Prüfungsvorbereitung Medizin",
    "foreign doctor Austria", "Approbation Österreich",
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
  alternates: {
    canonical: "https://medpruf.com",
  },
  openGraph: {
    type: "website",
    locale: "de_AT",
    url: "https://medpruf.com",
    siteName: "MedPrüf",
    title: "MedPrüf — Austrian Kenntnisprüfung Preparation",
    description: "10,993+ clinical questions for Austrian medical licensing (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie). Exam simulation, flashcards, analytics. Built for foreign doctors.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "MedPrüf — Kenntnisprüfung Preparation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MedPrüf — Austrian Kenntnisprüfung Preparation",
    description: "10,993+ clinical questions for Austrian medical exams. Built for foreign doctors.",
    images: ["/brand/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // WCAG 2.1 1.4.4 requires that users can resize text to 200%
  // without loss of content or functionality. Previously this export
  // set `maximumScale: 1, userScalable: false` which blocked pinch-
  // zoom entirely — a hard a11y fail, especially given the audience
  // (doctors reading dense German clinical text on mobile). Fixed
  // 2026-04-15 (Infra P2-INFRA-3 + UX audit, cross-referenced by
  // Frontend agent).
  themeColor: "#F7F9FC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" dir="ltr" suppressHydrationWarning>
      <head>
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
  // Stale-SW kill-switch — now time-bucketed instead of once-per-session
  // (changed 2026-04-21 after Abobaker-case diagnosis). Previous guard
  // used sessionStorage boolean 'medpruef_sw_reloaded' which NEVER
  // cleared in the same browser session — if the reload cycle didn't
  // actually purge the old SW (iOS Safari edge case), the user was
  // trapped for the lifetime of that tab session. Now the flag is a
  // timestamp; the kill-switch is allowed to re-try every 30 minutes.
  if(!('serviceWorker' in navigator))return;
  var LAST_KILL_KEY='medpruef_sw_last_kill';
  var RETRY_MS=30*60*1000;
  try{
    var last=parseInt(sessionStorage.getItem(LAST_KILL_KEY)||'0',10);
    if(last && (Date.now()-last)<RETRY_MS)return;
  }catch(e){}
  var EXPECTED=${JSON.stringify(process.env.NEXT_PUBLIC_BUILD_ID || "")};
  function killStale(){
    try{sessionStorage.setItem(LAST_KILL_KEY,String(Date.now()));}catch(e){}
    var p1=navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}).catch(function(){});
    var p2=('caches' in window)?caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}).catch(function(){}):Promise.resolve();
    Promise.all([p1,p2]).then(function(){location.reload();});
  }
  // Expose a user-invocable escape hatch so stuck users (like the
  // Apr-21 Abobaker case on iOS Safari PWA) can force a rebuild even
  // if the SW never responds with a build-id. PWAInstall.tsx already
  // surfaces a "Reload now" banner when the SW posts an update event
  // — this is the belt-and-suspenders fallback when it doesn't.
  try{window.__medpruefForceRefresh=killStale;}catch(e){}
  if(!navigator.serviceWorker.controller)return;
  var responded=false;
  var timer=setTimeout(function(){if(responded)return;responded=true;console.warn('[medpruef] stale SW: no build-id response, nuking');killStale();},1500);
  function onMsg(ev){
    if(responded)return;
    if(!ev.data||ev.data.type!=='BUILD_ID')return;
    responded=true;clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('message',onMsg);
    var swBuild=ev.data.buildId||'';
    if(EXPECTED&&swBuild&&swBuild!==EXPECTED){console.warn('[medpruef] SW build mismatch:',swBuild,'!=',EXPECTED);killStale();}
  }
  navigator.serviceWorker.addEventListener('message',onMsg);
  try{navigator.serviceWorker.controller.postMessage({type:'GET_BUILD_ID'});}catch(e){}
})();`,
          }}
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="canonical" href="https://medpruf.com" />
        {/* Structured data — Organization + WebApplication */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "MedPrüf",
              "url": "https://medpruf.com",
              "description": "Austrian medical exam preparation platform with 10,993+ clinical questions across 16 specialties and 3 exam types.",
              "applicationCategory": "EducationalApplication",
              "operatingSystem": "Web",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "EUR",
                "description": "Free tier with full question bank access"
              },
              "author": {
                "@type": "Organization",
                "name": "[name]",
                "url": "https://example.com"
              }
              // aggregateRating removed 2026-04-22: hard-coded 4.8/156 did not
              // match real user-data (23 surveys, avg 4.70). Google can penalize
              // fabricated review metadata. Re-introduce when we have 100+ real
              // reviews, ideally wired dynamically to user_feedback.
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
        {/* Telegram WebApp SDK — afterInteractive so it doesn't block, graceful in browser */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${inter.className} ${plusJakarta.variable} bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] min-h-screen antialiased`}
      >
        <ThemeProvider />
        <TrackerInit />
        {/* TrackRouteChange uses useSearchParams; Suspense wrapper
            is required by Next.js 15 for components that read it. */}
        <Suspense fallback={null}>
          <TrackRouteChange />
        </Suspense>
        {/* ToastProvider wraps the app so any component can call useToast()
            to push a transient notification. Renders a single a11y-live
            region for screen readers. See src/components/ui/Toast.tsx. */}
        <ToastProvider>
          <PWAInstall />
          <GuestMigrationBanner />
          <EmailValidationModal />
          <FeedbackWidget />
          <SearchModalMount />
          <CookieBannerMount />
          <ConsentGatedAnalytics />
          <OfflineIndicator />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
