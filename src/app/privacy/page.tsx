"use client";

import { useState, useEffect, useCallback } from "react";
import { getLang, setLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";

type Lang = "de" | "en";

export default function PrivacyPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  return (
    <DocLayout
      lang={lang}
      onLangChange={switchLang}
      kicker={lang === "de" ? "Datenschutz" : "Privacy"}
      title={lang === "de" ? "Datenschutzerklärung" : "Privacy Policy"}
      compactTitle={lang === "de" ? "Datenschutz" : "Privacy"}
      lede={
        lang === "de"
          ? "In Übereinstimmung mit DSGVO Art. 13 und österreichischem DSG."
          : "In accordance with GDPR Art. 13 and the Austrian Data Protection Act (DSG)."
      }
      lastUpdated={lang === "de" ? "April 2026" : "April 2026"}
      backHref="/"
    >
      <section>
        <h2>1. {lang === "de" ? "Verantwortlicher" : "Data Controller"}</h2>
        <p>
          [name]
          <br />
          [name]
          <br />
          E-Mail: user-0a1d478f@example.com
        </p>
      </section>

      <section>
        <h2>2. {lang === "de" ? "Welche Daten wir erheben" : "What Data We Collect"}</h2>
        <ul>
          <li>
            {lang === "de"
              ? "Telegram-Benutzerdaten (Vorname, Benutzer-ID) bei Anmeldung"
              : "Telegram user data (first name, user ID) on login"}
          </li>
          <li>
            {lang === "de"
              ? "Lernfortschritt (beantwortete Fragen, Genauigkeit, Lesezeichen, Notizen)"
              : "Study progress (answered questions, accuracy, bookmarks, notes)"}
          </li>
          <li>
            {lang === "de"
              ? "Nutzungsanalysen (Seitenaufrufe, Sitzungsdauer) via Google Analytics 4 und Microsoft Clarity"
              : "Usage analytics (page views, session duration) via Google Analytics 4 and Microsoft Clarity"}
          </li>
          <li>
            {lang === "de"
              ? "Technische Daten (Browser, Betriebssystem, Bildschirmgröße)"
              : "Technical data (browser, OS, screen size)"}
          </li>
        </ul>
      </section>

      <section>
        <h2>3. {lang === "de" ? "Hosting und Verarbeitung" : "Hosting and Processing"}</h2>
        <p>
          {lang === "de"
            ? "Die Daten werden bei Supabase (Cloud-Datenbank) und Vercel (Hosting) verarbeitet. Beide Dienste erfüllen die DSGVO-Anforderungen."
            : "Data is processed by Supabase (cloud database) and Vercel (hosting). Both services meet GDPR requirements."}
        </p>
      </section>

      <section>
        <h2>4. {lang === "de" ? "Zweck der Verarbeitung" : "Purpose of Processing"}</h2>
        <p>
          {lang === "de"
            ? "Wir verarbeiten Ihre Daten ausschließlich zur Bereitstellung der Lernplattform, zur Personalisierung Ihres Lernfortschritts und zur Verbesserung unseres Angebots."
            : "We process your data solely to provide the learning platform, personalize your study progress, and improve our service."}
        </p>
      </section>

      <section>
        <h2>5. {lang === "de" ? "Ihre Rechte (DSGVO)" : "Your Rights (GDPR)"}</h2>
        <ul>
          <li>
            {lang === "de"
              ? "Auskunftsrecht (Art. 15 DSGVO)"
              : "Right of access (Art. 15 GDPR)"}
          </li>
          <li>
            {lang === "de"
              ? "Recht auf Berichtigung (Art. 16 DSGVO)"
              : "Right to rectification (Art. 16 GDPR)"}
          </li>
          <li>
            {lang === "de"
              ? "Recht auf Löschung (Art. 17 DSGVO)"
              : "Right to erasure (Art. 17 GDPR)"}
          </li>
          <li>
            {lang === "de"
              ? "Recht auf Datenübertragbarkeit (Art. 20 DSGVO)"
              : "Right to data portability (Art. 20 GDPR)"}
          </li>
          <li>
            {lang === "de"
              ? "Widerspruchsrecht (Art. 21 DSGVO)"
              : "Right to object (Art. 21 GDPR)"}
          </li>
        </ul>
      </section>

      <section>
        <h2>6. {lang === "de" ? "Cookies und Analysen" : "Cookies and Analytics"}</h2>
        <p>
          {lang === "de"
            ? "Wir verwenden Cookies für Analysezwecke (Google Analytics 4, Microsoft Clarity). Sie können die Verwendung von Cookies über das Banner ablehnen."
            : "We use cookies for analytics (Google Analytics 4, Microsoft Clarity). You can decline cookies via the consent banner."}
        </p>
      </section>

      <section>
        <h2>7. {lang === "de" ? "Kontakt" : "Contact"}</h2>
        <p>
          {lang === "de"
            ? "Bei Fragen zum Datenschutz wenden Sie sich bitte an:"
            : "For data privacy inquiries, please contact:"}
          <br />
          <a href="mailto:user-0a1d478f@example.com">user-0a1d478f@example.com</a>
        </p>
      </section>
    </DocLayout>
  );
}
