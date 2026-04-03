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
    icon: "/brand/favicon-64.png",
    apple: "/brand/app-icon.png"
  },
  title: "MedPrüf — Prüfungsvorbereitung",
  description: "Deutsche Medizinprüfung Vorbereitung",
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

        {/* Telegram WebApp SDK — afterInteractive so it doesn't block, graceful in browser */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${inter.className} bg-[#F7F9FC] text-[#1A2B3C] min-h-screen antialiased`}
      >
        <TrackerInit />
        {children}
      </body>
    </html>
  );
}
