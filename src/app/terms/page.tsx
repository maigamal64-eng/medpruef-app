"use client";

import { useState, useEffect, useCallback } from "react";
import { getLang, setLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";

type Lang = "de" | "en";

export default function TermsPage() {
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
      kicker={lang === "de" ? "AGB" : "Terms"}
      title={lang === "de" ? "Nutzungsbedingungen" : "Terms of Service"}
      compactTitle={lang === "de" ? "AGB" : "Terms"}
      lede={
        lang === "de"
          ? "Diese Nutzungsbedingungen regeln die Verwendung von MedPrüf."
          : "These terms govern your use of MedPrüf."
      }
      lastUpdated={lang === "de" ? "April 2026" : "April 2026"}
      backHref="/"
    >
      <section>
        <h2>1. {lang === "de" ? "Geltungsbereich" : "Scope"}</h2>
        <p>
          {lang === "de"
            ? "Diese Nutzungsbedingungen gelten für die Nutzung der Lernplattform MedPrüf, betrieben von [name] ([name]). Durch die Nutzung der Plattform akzeptieren Sie diese Bedingungen."
            : "These terms apply to the use of the MedPrüf learning platform operated by [name] ([name]). By using the platform, you accept these terms."}
        </p>
      </section>

      <section>
        <h2>2. {lang === "de" ? "Leistungsbeschreibung" : "Service Description"}</h2>
        <p>
          {lang === "de"
            ? "MedPrüf bietet eine digitale Lernplattform zur Vorbereitung auf die österreichische Kenntnisprüfung (Wien). Die Inhalte dienen ausschließlich Lernzwecken."
            : "MedPrüf provides a digital learning platform for preparation for the Austrian Kenntnisprüfung (Vienna). Content is for educational purposes only."}
        </p>
      </section>

      <section>
        <h2>3. {lang === "de" ? "Kein medizinischer Rat" : "No Medical Advice"}</h2>
        <p>
          {lang === "de"
            ? "Die Inhalte auf MedPrüf stellen keinen medizinischen Rat dar und ersetzen nicht die professionelle medizinische Beratung, Diagnose oder Behandlung. Alle Fragen und Antworten dienen ausschließlich der Prüfungsvorbereitung."
            : "Content on MedPrüf does not constitute medical advice and is not a substitute for professional medical consultation, diagnosis, or treatment. All questions and answers are for exam preparation purposes only."}
        </p>
      </section>

      <section>
        <h2>4. {lang === "de" ? "Nutzerpflichten" : "User Obligations"}</h2>
        <ul>
          <li>
            {lang === "de"
              ? "Korrekte Angabe von Informationen bei der Registrierung"
              : "Provide correct information during registration"}
          </li>
          <li>
            {lang === "de"
              ? "Keine Weitergabe von Prüfungsinhalten an Dritte"
              : "Do not share exam content with third parties"}
          </li>
          <li>
            {lang === "de"
              ? "Keine automatisierte Abfrage oder Scraping der Plattform"
              : "No automated querying or scraping of the platform"}
          </li>
          <li>
            {lang === "de"
              ? "Respektvoller Umgang mit anderen Nutzern"
              : "Respectful conduct towards other users"}
          </li>
        </ul>
      </section>

      <section>
        <h2>5. {lang === "de" ? "Abonnement und Zahlung" : "Subscription and Payment"}</h2>
        <p>
          {lang === "de"
            ? "Die kostenlose Version bietet eingeschränkten Zugang. Pro-Abonnements werden monatlich berechnet und können jederzeit gekündigt werden. Bereits bezahlte Zeiträume werden nicht erstattet."
            : "The free version offers limited access. Pro subscriptions are billed monthly and can be cancelled at any time. Already paid periods are not refunded."}
        </p>
      </section>

      <section>
        <h2>6. {lang === "de" ? "Haftungsausschluss" : "Disclaimer"}</h2>
        <p>
          {lang === "de"
            ? "Wir bemühen uns um die Richtigkeit der Inhalte, übernehmen aber keine Garantie. MedPrüf haftet nicht für Prüfungsergebnisse oder Entscheidungen, die auf Basis der Plattforminhalte getroffen werden."
            : "We strive for content accuracy but provide no guarantees. MedPrüf is not liable for exam results or decisions made based on platform content."}
        </p>
      </section>

      <section>
        <h2>7. {lang === "de" ? "Anwendbares Recht" : "Applicable Law"}</h2>
        <p>
          {lang === "de"
            ? "Es gilt österreichisches Recht. Gerichtsstand ist Wien."
            : "Austrian law applies. Place of jurisdiction is Vienna."}
        </p>
      </section>
    </DocLayout>
  );
}
