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
            ? "Die kostenlose Version bietet eingeschränkten Zugang (150 Fragen pro Prüfungstyp). Bezahlte Tarife (Erster Monat €19, Juni-26-Kohorte €114, sowie 3-, 6- und 12-Monats-Tarife sobald Stripe live ist) werden einmalig oder als Abonnement berechnet."
            : "The free version offers limited access (150 questions per exam type). Paid tiers (First Month €19, June 26 Cohort €114, plus 3-, 6-, and 12-month plans once Stripe goes live) are charged once or on a subscription basis."}
        </p>
        <p>
          {lang === "de"
            ? "7-Tage-Geld-zurück-Garantie: Du kannst innerhalb von 7 Tagen nach Kauf eine vollständige Rückerstattung per E-Mail an user-b7e46e80@example.com beantragen — keine Begründung nötig. Anträge werden innerhalb von 72 Stunden bearbeitet."
            : "7-day money-back guarantee: You can request a full refund within 7 days of purchase by emailing user-b7e46e80@example.com — no reason required. Requests are processed within 72 hours."}
        </p>
        <p>
          {lang === "de"
            ? "Pass-Until-You-Pass: Auf der Juni-26-Kohorte (€114) und dem 12-Monats-Tarif (€229) verlängern wir deinen Zugang kostenlos, wenn du nach mindestens 70 % bearbeiteter Fragenbank durchfällst und einen offiziellen Bescheid einreichst (max. zwei Verlängerungen). Details: /faq."
            : "Pass-Until-You-Pass: On the June 26 Cohort (€114) and 12-month plan (€229), we extend your access free if you fail after working through at least 70 % of the question bank and submit an official result (max. two extensions). Details at /faq."}
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
