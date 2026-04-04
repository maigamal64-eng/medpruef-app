import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import TrackerInit from "@/components/TrackerInit";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  display: "swap",
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
  description: "Deutsche Medizinprüfung Vorbereitung — SIP Staatsexamen",
  openGraph: {
    title: "MedPrüf — Prüfungsvorbereitung",
    description: "Bereite dich optimal auf die deutsche Medizinprüfung vor",
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
    <html lang="de" dir="ltr" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        {/* Telegram WebApp SDK — afterInteractive so it doesn't block, graceful in browser */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${inter.className} bg-[#F7F9FC] text-[#152B4E] min-h-screen antialiased`}
      >
        <TrackerInit />
        {children}
      </body>
    </html>
  );
}
