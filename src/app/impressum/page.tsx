"use client";

import { useState, useEffect, useCallback } from "react";
import { getLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";
import { COMPANY, CONTACT } from "@/lib/content-truth";

type Lang = "de" | "en";

export default function ImpressumPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLangState(l);
  }, []);

  return (
    <DocLayout
      lang={lang}
      onLangChange={switchLang}
      kicker="Impressum"
      title="Impressum"
      compactTitle="Impressum"
      lede={
        lang === "de"
          ? "Angaben gemäß § 5 E-Commerce-Gesetz (ECG) und Mediengesetz."
          : "Legal disclosure pursuant to § 5 Austrian E-Commerce Act (ECG) and Media Act."
      }
      lastUpdated={lang === "de" ? "Oktober 2026" : "October 2026"}
      backHref="/"
    >
      <section>
        <h2>
          {lang === "de" ? "Angaben gemäß § 5 ECG" : "Information pursuant to § 5 ECG"}
        </h2>
        <p>
          <strong>MedPrüf</strong>
          <br />
          {lang === "de" ? "Ein persönliches Projekt von" : "A personal project by"}{" "}
          {COMPANY.founder}
          <br />
          {lang === "de" ? "Betrieben durch" : "Operated by"}: {COMPANY.operator_brand}
          <br />
          E-Mail: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
          <br />
          {lang === "de"
            ? "Kairo, Ägypten (Betrieb für Nutzer in Österreich)"
            : "Cairo, Egypt (operated for users in Austria)"}
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Kontakt" : "Contact"}</h2>
        <p>
          E-Mail: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Unternehmensform" : "Business type"}</h2>
        <p>
          {lang === "de"
            ? "Betrieben von einer Einzelperson, derzeit kein eingetragenes Unternehmen und keine UID-Nummer."
            : "Operated by an individual, currently not a registered company and without a VAT ID."}
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Haftung für Inhalte" : "Liability for Content"}</h2>
        <p>
          {lang === "de"
            ? "Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen."
            : "The contents of our pages have been created with the greatest care. However, we cannot guarantee the accuracy, completeness, or timeliness of the content."}
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Haftung für Links" : "Liability for Links"}</h2>
        <p>
          {lang === "de"
            ? "Unsere Plattform enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter verantwortlich."
            : "Our platform contains links to external third-party websites, the content of which we have no influence over. The respective provider is always responsible for the content of the linked pages."}
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Streitschlichtung" : "Dispute Resolution"}</h2>
        <p>
          {lang === "de"
            ? "Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: https://ec.europa.eu/consumers/odr. Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren teilzunehmen."
            : "The European Commission provides a platform for online dispute resolution (ODR): https://ec.europa.eu/consumers/odr. We are not obligated or willing to participate in dispute resolution proceedings."}
        </p>
      </section>
    </DocLayout>
  );
}
