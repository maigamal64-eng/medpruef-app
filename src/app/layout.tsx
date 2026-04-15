import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import TrackerInit from "@/components/TrackerInit";
import ThemeProvider from "@/components/ThemeProvider";
import PWAInstall from "@/components/PWAInstall";
import FeedbackWidget from "@/components/FeedbackWidget";
import GuestMigrationBanner from "@/components/GuestMigrationBanner";

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
  description: "Prepare for the Austrian Kenntnisprüfung (Vienna) with 7,725+ clinical questions across 10 medical specialties. SIP 4 & SIP 5 exam simulation, flashcards, performance analytics. Built for foreign doctors.",
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
    description: "7,725+ clinical questions for the Vienna Kenntnisprüfung. Exam simulation, flashcards, analytics. Built for foreign doctors seeking Austrian medical licensure.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "MedPrüf — Kenntnisprüfung Preparation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MedPrüf — Austrian Kenntnisprüfung Preparation",
    description: "7,725+ clinical questions for the Vienna Kenntnisprüfung. Built for foreign doctors.",
    images: ["/brand/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
  if(!('serviceWorker' in navigator))return;
  try{if(sessionStorage.getItem('medpruef_sw_reloaded'))return;}catch(e){}
  var EXPECTED=${JSON.stringify(process.env.NEXT_PUBLIC_BUILD_ID || "")};
  function killStale(){
    try{sessionStorage.setItem('medpruef_sw_reloaded','1');}catch(e){}
    var p1=navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}).catch(function(){});
    var p2=('caches' in window)?caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}).catch(function(){}):Promise.resolve();
    Promise.all([p1,p2]).then(function(){location.reload();});
  }
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
              "description": "Austrian Kenntnisprüfung preparation platform with 7,725+ clinical questions across 10 medical specialties.",
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
              },
              "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "4.8",
                "ratingCount": "156"
              }
            }),
          }}
        />
        {/* Google Analytics 4 */}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_ID}',{page_path:window.location.pathname});`}
            </Script>
          </>
        )}
        {/* Microsoft Clarity */}
        {process.env.NEXT_PUBLIC_CLARITY_ID && (
          <Script id="clarity-init" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${process.env.NEXT_PUBLIC_CLARITY_ID}");`}
          </Script>
        )}
        {/* Telegram WebApp SDK — afterInteractive so it doesn't block, graceful in browser */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${inter.className} ${plusJakarta.variable} bg-[#F7F9FC] text-[#1A2B3C] min-h-screen antialiased`}
      >
        <ThemeProvider />
        <TrackerInit />
        <PWAInstall />
        <GuestMigrationBanner />
        <FeedbackWidget />
        {children}
      </body>
    </html>
  );
}
