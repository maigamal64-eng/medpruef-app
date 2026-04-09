import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import TrackerInit from "@/components/TrackerInit";
import ThemeProvider from "@/components/ThemeProvider";
import PWAInstall from "@/components/PWAInstall";

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
      { url: "/favicon.ico", sizes: "any" },
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
        {children}
      </body>
    </html>
  );
}
