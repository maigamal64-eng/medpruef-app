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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/favicon-64.png", type: "image/png", sizes: "64x64" },
    ],
    apple: "/apple-touch-icon.png",
  },
  title: "MedPrüf — Prüfungsvorbereitung",
  description: "Österreichische Kenntnisprüfung Vorbereitung (Wien) — SIP 4 & SIP 5",
  openGraph: {
    title: "MedPrüf — Prüfungsvorbereitung",
    description: "Bereite dich optimal auf die Wiener Kenntnisprüfung vor",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
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
