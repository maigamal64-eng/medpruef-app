"use client";

import { useState, useEffect, useCallback } from "react";
import { getLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";
import {
  BILLING_SUPPORT_EMAIL,
  WHOP_MANAGE_TEXT,
  WHOP_MANAGE_URL,
  billingSurfaceText,
  billingTrialSummary,
  REPORT_ACK_PROMISE,
  SUPPORT_REPLY_PROMISE,
} from "@/lib/billing-copy";
import { COMPANY, REFUND } from "@/lib/content-truth";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { puypDefinition, puypExamples, puypExamplesHeading } from "@/lib/puyp-copy";
import MentorTermsBlock from "@/components/mentor/public/MentorTermsBlock";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { useHalfYearReady } from "@/lib/pricing-v2/readiness-context";
import { ticketNotRefund, ticketTerms } from "@/lib/pricing-v2/ticket";

type Lang = "de" | "en";

// a-pricing-v2 (PRICING_V2_ENABLED): the ticket section title and the line
// that keeps the PUYP terms for Cohorts already bought.
const TICKET_TERMS_TITLE: Record<Lang, string> = { de: "Garantie-Ticket: kostenlose Verlängerungsjahre", en: "Guarantee Ticket: free renewal years" };
const COHORT_STILL_APPLIES: Record<Lang, string> = { de: "Für bereits gekaufte Prüfungs-Kohorten gilt weiterhin:", en: "For Exam Cohorts already bought, this still applies:" };

export default function TermsPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const halfYear = useHalfYearReady();

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
      kicker={lang === "de" ? "AGB" : "Terms"}
      title={lang === "de" ? "Nutzungsbedingungen" : "Terms of Service"}
      compactTitle={lang === "de" ? "AGB" : "Terms"}
      lede={
        lang === "de"
          ? "Diese Nutzungsbedingungen regeln die Verwendung von MedPrüf."
          : "These terms govern your use of MedPrüf."
      }
      lastUpdated={lang === "de" ? "Oktober 2026" : "October 2026"}
      backHref="/"
    >
      <section>
        <h2>1. {lang === "de" ? "Geltungsbereich" : "Scope"}</h2>
        <p>
          {lang === "de"
            ? `Diese Nutzungsbedingungen gelten für die Nutzung der Lernplattform MedPrüf, betrieben von ${COMPANY.founder} (${COMPANY.location.de}). Durch die Nutzung der Plattform akzeptieren Sie diese Bedingungen.`
            : `These terms apply to the use of the MedPrüf learning platform operated by ${COMPANY.founder} (${COMPANY.location.en}). By using the platform, you accept these terms.`}
        </p>
      </section>

      <section>
        <h2>2. {lang === "de" ? "Leistungsbeschreibung" : "Service Description"}</h2>
        <p>
          {lang === "de"
            ? `MedPrüf bietet eine digitale Lernplattform mit Übungsmaterial für österreichische Prüfungen in drei Fragenbanken: ${getExamLabel("kenntnispruefung", "full", "de")}, ${getExamLabel("kmp_innsbruck", "full", "de")} und ${getExamLabel("pharma", "full", "de")}. Die Fragen sind Übungsmaterial, keine offiziellen Prüfungsfragen. Die Inhalte dienen ausschließlich Lernzwecken. Support per E-Mail an ${BILLING_SUPPORT_EMAIL}: ${SUPPORT_REPLY_PROMISE.de} ${REPORT_ACK_PROMISE.de}`
            : `MedPrüf provides a digital learning platform with practice material for Austrian exams in three question banks: ${getExamLabel("kenntnispruefung", "full", "en")}, ${getExamLabel("kmp_innsbruck", "full", "en")} and ${getExamLabel("pharma", "full", "en")}. The questions are practice material, not official exam questions. Content is for educational purposes only. Support by email to ${BILLING_SUPPORT_EMAIL}: ${SUPPORT_REPLY_PROMISE.en} ${REPORT_ACK_PROMISE.en}`}
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
            ? billingSurfaceText("surface_31", "de", { halfYear })
            : billingSurfaceText("surface_32", "en", { halfYear })}
        </p>
        <p>
          {billingTrialSummary(lang)}
        </p>
        <p>
          {lang === "de" ? "Kündigung: " : "Cancellation: "}
          {lang === "de"
            ? "Sie verwalten Ihre Mitgliedschaft bei Whop unter "
            : "You can manage your membership at Whop, at "}
          <a href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer">
            {WHOP_MANAGE_TEXT}
          </a>
          {lang === "de"
            ? ` (Mitgliedschaft auswählen, dann „Cancel membership“; die Whop-Seite ist auf Englisch). Kündigen Sie vor dem nächsten Verlängerungsdatum, damit nicht erneut abgebucht wird. Hilfe: ${BILLING_SUPPORT_EMAIL}.`
            : ` (select your membership, then "Cancel membership"; the Whop page is in English). Cancel before the next renewal date so you are not charged again. Help: ${BILLING_SUPPORT_EMAIL}.`}
        </p>
        <p>
          {lang === "de"
            ? `${REFUND.window_days}-Tage-Geld-zurück-Garantie: Sie können innerhalb von ${REFUND.window_days} Tagen nach Kauf eine vollständige Rückerstattung per E-Mail an ${BILLING_SUPPORT_EMAIL} beantragen, keine Begründung nötig. Anträge werden innerhalb von 72 Stunden bearbeitet.`
            : `${REFUND.window_days}-day money-back guarantee: You can request a full refund within ${REFUND.window_days} days of purchase by emailing ${BILLING_SUPPORT_EMAIL}, no reason required. Requests are processed within 72 hours.`}
        </p>
        {/* a-pricing-v2: the Guarantee Ticket's renewal on proof (PRICING_V2_ENABLED). */}
        {pricingV2Enabled() && (
          <div data-terms-ticket>
            <h3>{TICKET_TERMS_TITLE[lang]}</h3>
            <dl>
              {ticketTerms(lang, null).map((row) => (
                <div key={row.label}><dt><strong>{row.label}</strong></dt><dd>{row.value}</dd></div>
              ))}
            </dl>
            <p>{ticketNotRefund(lang)}</p>
          </div>
        )}
        {pricingV2Enabled() && (
          <p>{COHORT_STILL_APPLIES[lang]}</p>
        )}
        <p>{puypDefinition(lang)}</p>
        <p>{puypExamplesHeading(lang)}</p>
        <ul>
          {puypExamples(lang).map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
        <MentorTermsBlock lang={lang} />
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
