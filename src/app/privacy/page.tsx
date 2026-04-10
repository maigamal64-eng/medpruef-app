"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { getLang } from "@/lib/i18n";

type Lang = "de" | "en";

export default function PrivacyPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F9FC] py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[#003A8C] hover:underline mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {lang === "de" ? "Zurück" : "Back"}
        </Link>

        <div className="card rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-7 h-7 text-[#007B5F]" />
            <h1 className="text-2xl font-bold text-[#1A2B3C]">
              {lang === "de" ? "Datenschutzerklärung" : "Privacy Policy"}
            </h1>
          </div>

          <div className="prose prose-sm text-[#4A5568] space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                1. {lang === "de" ? "Verantwortlicher" : "Data Controller"}
              </h2>
              <p>
                [name]<br />
                [name]<br />
                E-Mail: user-0a1d478f@example.com
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                2. {lang === "de" ? "Welche Daten wir erheben" : "What Data We Collect"}
              </h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>{lang === "de" ? "Telegram-Benutzerdaten (Vorname, Benutzer-ID) bei Anmeldung" : "Telegram user data (first name, user ID) on login"}</li>
                <li>{lang === "de" ? "Lernfortschritt (beantwortete Fragen, Genauigkeit, Lesezeichen, Notizen)" : "Study progress (answered questions, accuracy, bookmarks, notes)"}</li>
                <li>{lang === "de" ? "Nutzungsanalysen (Seitenaufrufe, Sitzungsdauer) via Google Analytics 4 und Microsoft Clarity" : "Usage analytics (page views, session duration) via Google Analytics 4 and Microsoft Clarity"}</li>
                <li>{lang === "de" ? "Technische Daten (Browser, Betriebssystem, Bildschirmgröße)" : "Technical data (browser, OS, screen size)"}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                3. {lang === "de" ? "Hosting und Verarbeitung" : "Hosting and Processing"}
              </h2>
              <p>
                {lang === "de"
                  ? "Die Daten werden bei Supabase (Cloud-Datenbank) und Vercel (Hosting) verarbeitet. Beide Dienste erfüllen die DSGVO-Anforderungen."
                  : "Data is processed by Supabase (cloud database) and Vercel (hosting). Both services meet GDPR requirements."}
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                4. {lang === "de" ? "Zweck der Verarbeitung" : "Purpose of Processing"}
              </h2>
              <p>
                {lang === "de"
                  ? "Wir verarbeiten Ihre Daten ausschließlich zur Bereitstellung der Lernplattform, zur Personalisierung Ihres Lernfortschritts und zur Verbesserung unseres Angebots."
                  : "We process your data solely to provide the learning platform, personalize your study progress, and improve our service."}
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                5. {lang === "de" ? "Ihre Rechte (DSGVO)" : "Your Rights (GDPR)"}
              </h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>{lang === "de" ? "Auskunftsrecht (Art. 15 DSGVO)" : "Right of access (Art. 15 GDPR)"}</li>
                <li>{lang === "de" ? "Recht auf Berichtigung (Art. 16 DSGVO)" : "Right to rectification (Art. 16 GDPR)"}</li>
                <li>{lang === "de" ? "Recht auf Löschung (Art. 17 DSGVO)" : "Right to erasure (Art. 17 GDPR)"}</li>
                <li>{lang === "de" ? "Recht auf Datenübertragbarkeit (Art. 20 DSGVO)" : "Right to data portability (Art. 20 GDPR)"}</li>
                <li>{lang === "de" ? "Widerspruchsrecht (Art. 21 DSGVO)" : "Right to object (Art. 21 GDPR)"}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                6. {lang === "de" ? "Cookies und Analysen" : "Cookies and Analytics"}
              </h2>
              <p>
                {lang === "de"
                  ? "Wir verwenden Cookies für Analysezwecke (Google Analytics 4, Microsoft Clarity). Sie können die Verwendung von Cookies über das Banner ablehnen."
                  : "We use cookies for analytics (Google Analytics 4, Microsoft Clarity). You can decline cookies via the consent banner."}
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-2">
                7. {lang === "de" ? "Kontakt" : "Contact"}
              </h2>
              <p>
                {lang === "de"
                  ? "Bei Fragen zum Datenschutz wenden Sie sich bitte an:"
                  : "For data privacy inquiries, please contact:"}
                <br />
                <a href="mailto:user-0a1d478f@example.com" className="text-[#003A8C] hover:underline">
                  user-0a1d478f@example.com
                </a>
              </p>
            </section>

            <p className="text-xs text-[#A0AEC0] pt-4 border-t border-[#E4E9F0]">
              {lang === "de" ? "Stand: April 2026" : "Last updated: April 2026"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
