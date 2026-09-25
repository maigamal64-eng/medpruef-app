"use client";

import { useState, useEffect, useCallback } from "react";
import { getLang, setLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";

type Lang = "de" | "en";

interface Processor {
  name: string;
  purpose: { de: string; en: string };
  jurisdiction: { de: string; en: string };
  policyUrl: string;
  policyLabel: string;
}

const PROCESSORS: Processor[] = [
  {
    name: "Supabase",
    purpose: {
      de: "Datenbank (Konto- und Lernfortschrittsdaten), Objektspeicher (Fragebilder).",
      en: "Database (account and study-progress data), object storage (question images).",
    },
    jurisdiction: {
      de: "Supabase Inc., USA, EU-Region (Frankfurt).",
      en: "Supabase Inc., USA, EU region (Frankfurt).",
    },
    policyUrl: "https://supabase.com/privacy",
    policyLabel: "supabase.com/privacy",
  },
  {
    name: "Vercel",
    purpose: {
      de: "Hosting der Webanwendung und API-Routen, Edge-Caching.",
      en: "Hosting of the web application and API routes, edge caching.",
    },
    jurisdiction: {
      de: "Vercel Inc., USA, EU-Edge-Knoten. SCCs in Kraft.",
      en: "Vercel Inc., USA, EU edge nodes. SCCs in place.",
    },
    policyUrl: "https://vercel.com/legal/privacy-policy",
    policyLabel: "vercel.com/legal/privacy-policy",
  },
  {
    name: "Whop",
    purpose: {
      de: "Checkout und Abwicklung von Kartenzahlungen und wiederkehrenden Mitgliedschaften. Vollständige Kartennummern werden im Whop-Checkout eingegeben.",
      en: "Checkout and handling of card payments and recurring memberships. Full card numbers are entered in Whop checkout.",
    },
    jurisdiction: {
      de: "Whop, Inc. Siehe die Datenschutzinformationen von Whop für weitere Angaben.",
      en: "Whop, Inc. See Whop's privacy information for further details.",
    },
    policyUrl: "https://whop.com/privacy",
    policyLabel: "whop.com/privacy",
  },
  {
    name: "Sentry",
    purpose: {
      de: "Fehler- und Absturzüberwachung (Stack-Traces, Anfrage-Kontext, User-ID als Hash).",
      en: "Error and crash monitoring (stack traces, request context, hashed user ID).",
    },
    jurisdiction: {
      de: "Functional Software, Inc. (Sentry), USA, EU-Ingest-Endpunkt (de.sentry.io).",
      en: "Functional Software, Inc. (Sentry), USA, EU ingest endpoint (de.sentry.io).",
    },
    policyUrl: "https://sentry.io/privacy/",
    policyLabel: "sentry.io/privacy",
  },
  {
    name: "OpenAI",
    purpose: {
      de: "KI-gestützte Erklärungen und Übersetzungen (Fallback-Modell für /api/ai-chat und /api/translate).",
      en: "AI-generated explanations and translations (fallback model for /api/ai-chat and /api/translate).",
    },
    jurisdiction: {
      de: "OpenAI OpCo, LLC, USA. SCCs in Kraft; API-Eingaben werden nicht für Modelltraining verwendet.",
      en: "OpenAI OpCo, LLC, USA. SCCs in place; API inputs are not used for model training.",
    },
    policyUrl: "https://openai.com/policies/privacy-policy",
    policyLabel: "openai.com/policies/privacy-policy",
  },
  {
    name: "Intercom",
    purpose: {
      de: "Kunden-Support-Messenger und In-App-Nachrichten (Name, E-Mail, Konto-ID, Nachrichtenverlauf, Seitenaufrufe).",
      en: "Customer-support messenger and in-app messaging (name, email, account ID, conversation history, page views).",
    },
    jurisdiction: {
      de: "Intercom R&D Unlimited Company, Irland (EU); Muttergesellschaft Intercom, Inc., USA. SCCs in Kraft.",
      en: "Intercom R&D Unlimited Company, Ireland (EU); parent Intercom, Inc., USA. SCCs in place.",
    },
    policyUrl: "https://www.intercom.com/legal/privacy",
    policyLabel: "intercom.com/legal/privacy",
  },
  {
    name: "Anthropic",
    purpose: {
      de: "KI-gestützte Erklärungen und Übersetzungen (primäres Modell für /api/ai-chat und /api/translate).",
      en: "AI-generated explanations and translations (primary model for /api/ai-chat and /api/translate).",
    },
    jurisdiction: {
      de: "Anthropic PBC, USA. SCCs in Kraft; API-Eingaben werden nicht für Modelltraining verwendet.",
      en: "Anthropic PBC, USA. SCCs in place; API inputs are not used for model training.",
    },
    policyUrl: "https://www.anthropic.com/legal/privacy",
    policyLabel: "anthropic.com/legal/privacy",
  },
  {
    name: "Zoho Mail",
    purpose: {
      de: "Ausgehender E-Mail-Versand (z.B. Antworten auf Feedback, Benachrichtigungen zu gemeldeten Fragen) über user-b7e46e80@example.com.",
      en: "Outbound email (e.g. feedback replies, notifications for flagged questions) via user-b7e46e80@example.com.",
    },
    jurisdiction: {
      de: "Zoho Corporation, Indien (EU-Rechenzentrum verfügbar).",
      en: "Zoho Corporation, India (EU data center optional).",
    },
    policyUrl: "https://www.zoho.com/privacy.html",
    policyLabel: "zoho.com/privacy",
  },
  {
    name: "Telegram",
    purpose: {
      de: "Login per Telegram-Bot (Deep-Link) und Mini-App, Push-Benachrichtigungen.",
      en: "Login via Telegram bot (deep link) and Mini App, push notifications.",
    },
    jurisdiction: {
      de: "Telegram FZ-LLC, Vereinigte Arabische Emirate. Nur übermittelt: Telegram-ID, Vorname, optional Benutzername.",
      en: "Telegram FZ-LLC, United Arab Emirates. Only transferred: Telegram ID, first name, optional username.",
    },
    policyUrl: "https://telegram.org/privacy",
    policyLabel: "telegram.org/privacy",
  },
  {
    name: "Google Analytics 4",
    purpose: {
      de: "Aggregierte Nutzungsanalyse (Seitenaufrufe, Sitzungsdauer); in der Beta standardmäßig aktiv, Widerspruch jederzeit über das Cookie-Banner (Ablehnen).",
      en: "Aggregated usage analytics (page views, session duration); active by default during beta, opt out anytime via the cookie banner (Decline).",
    },
    jurisdiction: {
      de: "Google LLC, USA (EU-Daten über Google Ireland Ltd.). SCCs + IP-Anonymisierung aktiv.",
      en: "Google LLC, USA (EU data via Google Ireland Ltd.). SCCs + IP anonymization enabled.",
    },
    policyUrl: "https://policies.google.com/privacy",
    policyLabel: "policies.google.com/privacy",
  },
  {
    name: "Microsoft Clarity",
    purpose: {
      de: "UX-Analyse (Heatmaps, Sitzungswiedergabe, Dead-Clicks); in der Beta standardmäßig aktiv, Widerspruch jederzeit über das Cookie-Banner (Ablehnen). Passwörter und Zahlungseingaben werden maskiert.",
      en: "UX analytics (heatmaps, session replay, dead clicks); active by default during beta, opt out anytime via the cookie banner (Decline). Passwords and payment inputs are masked.",
    },
    jurisdiction: {
      de: "Microsoft Corporation, USA. SCCs in Kraft.",
      en: "Microsoft Corporation, USA. SCCs in place.",
    },
    policyUrl: "https://privacy.microsoft.com/privacystatement",
    policyLabel: "privacy.microsoft.com/privacystatement",
  },
];

export default function PrivacyPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  const t = lang === "de";

  return (
    <DocLayout
      lang={lang}
      onLangChange={switchLang}
      kicker={t ? "Datenschutz" : "Privacy"}
      title={t ? "Datenschutzerklärung" : "Privacy Policy"}
      compactTitle={t ? "Datenschutz" : "Privacy"}
      lede={
        t
          ? "Diese Erklärung beschreibt, welche personenbezogenen Daten MedPrüf erhebt und verarbeitet, welche Anbieter einzelne Funktionen unterstützen und welche Rechte Sie nach der DSGVO und dem österreichischen DSG haben."
          : "This policy describes which personal data MedPrüf collects and processes, which providers support individual features, and your rights under the GDPR and the Austrian Data Protection Act (DSG)."
      }
      lastUpdated={t ? "25. September 2026" : "25 September 2026"}
      backHref="/"
    >
      {/* 1. Verantwortlicher */}
      <section>
        <h2>1. {t ? "Verantwortlicher" : "Data Controller"}</h2>
        <p>
          {t
            ? "Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO ist:"
            : "The controller within the meaning of Art. 4(7) GDPR is:"}
        </p>
        <p>
          <strong>
            [
            {t
              ? "Vorläufig: MedPrüf / [name], Rechtsform wird bei Registrierung der österreichischen Niederlassung finalisiert"
              : "Provisional: MedPrüf / [name]; legal entity will be finalized upon registration of the Austrian branch"}
            ]
          </strong>
          <br />
          {t ? "Inhaber" : "Operator"}: [name]
          <br />
          {t ? "Anschrift" : "Address"}:{" "}
          {t ? "wird bei Launch finalisiert" : "to be finalized at launch"} (
          {t ? "siehe" : "see"} /impressum)
          <br />
          E-Mail:{" "}
          <a href="mailto:user-ad61df73@example.com">user-ad61df73@example.com</a>{" "}
          ({t ? "vorläufig auch" : "provisionally also"}:{" "}
          <a href="mailto:user-b7e46e80@example.com">user-b7e46e80@example.com</a>)
          <br />
          {t ? "Allgemeiner Kontakt" : "General contact"}:{" "}
          <a href="mailto:user-77be0a2a@example.com">user-77be0a2a@example.com</a>
        </p>
        <p>
          {t
            ? "Für den laufenden Betrieb ist kein verpflichtender Datenschutzbeauftragter bestellt (Art. 37 DSGVO); für alle Datenschutzanliegen wenden Sie sich bitte direkt an die oben genannte E-Mail-Adresse."
            : "No mandatory data protection officer has been appointed for current operations (Art. 37 GDPR); for all data protection matters, please contact the email address above directly."}
        </p>
      </section>

      {/* 2. Welche Daten wir erheben */}
      <section>
        <h2>2. {t ? "Welche Daten wir erheben" : "What Data We Collect"}</h2>

        <h3>{t ? "2.1 Kontodaten" : "2.1 Account data"}</h3>
        <ul>
          <li>
            {t
              ? "E-Mail-Adresse und Passwort (gehasht mit bcrypt) bei Registrierung über das Login-Formular."
              : "Email address and password (bcrypt-hashed) on registration via the login form."}
          </li>
          <li>
            {t
              ? "Telegram-ID, Vorname, optional Benutzername und Profilbild-URL, wenn Sie sich über den Telegram-Bot oder die Mini-App anmelden."
              : "Telegram ID, first name, optional username and profile photo URL when you log in via the Telegram bot or Mini App."}
          </li>
          <li>
            {t
              ? "Von Ihnen freiwillig angegebene Felder: Prüfungsdatum, tägliches Lernziel, bevorzugte Prüfungsart."
              : "Fields you voluntarily provide: exam date, daily study goal, preferred exam type."}
          </li>
        </ul>

        <h3>{t ? "2.2 Lern- und Nutzungsdaten" : "2.2 Study and usage data"}</h3>
        <ul>
          <li>
            {t
              ? "Beantwortete Fragen, Antworten, richtig/falsch, Zeitaufwand, XP, Streaks, Lesezeichen, Notizen, Markierungen, Meldungen zu Fragen."
              : "Answered questions, your answers, correct/incorrect, time spent, XP, streaks, bookmarks, notes, highlights, question flags."}
          </li>
          <li>
            {t
              ? "Feedback- und Supportnachrichten, die Sie über das In-App-Feedback-Widget senden."
              : "Feedback and support messages sent via the in-app feedback widget."}
          </li>
        </ul>

        <h3>{t ? "2.3 Zahlungsdaten" : "2.3 Payment data"}</h3>
        <ul>
          <li>
            {t
              ? "Bei kostenpflichtigen Tarifen werden Rechnungsvorgang und Zahlung über den Whop-Checkout abgewickelt. Kartendaten gibst du direkt im Whop-Checkout ein; MedPrüf speichert keine vollständigen Kartennummern."
              : "For paid plans, checkout and payment run through Whop. You enter card details directly in Whop checkout; MedPrüf does not store full card numbers."}
          </li>
        </ul>

        <h3>{t ? "2.4 Technische Daten" : "2.4 Technical data"}</h3>
        <ul>
          <li>
            {t
              ? "IP-Adresse (gekürzt/anonymisiert sobald technisch möglich), Browser, Betriebssystem, Bildschirmauflösung, Zeitzone, Referrer, Request-Zeitstempel."
              : "IP address (truncated/anonymized as soon as technically feasible), browser, operating system, screen resolution, time zone, referrer, request timestamp."}
          </li>
          <li>
            {t
              ? "Bei Fehlern: Stack-Traces und App-Kontext (nur bei tatsächlichem Laufzeitfehler) via Sentry."
              : "In case of errors: stack traces and app context (only on actual runtime error) via Sentry."}
          </li>
        </ul>

        <h3>{t ? "2.5 Analysedaten (Beta: standardmäßig aktiv, Widerspruch jederzeit möglich)" : "2.5 Analytics data (beta: on by default, opt out anytime)"}</h3>
        <ul>
          <li>
            {t
              ? "Während der Beta-Phase sind Google Analytics 4 und Microsoft Clarity standardmäßig aktiv, sofern du im Cookie-Banner nicht „Ablehnen“ gewählt hast. Deine Auswahl wird gespeichert. Werbe-Pixel von Meta und Reddit laden ausschließlich nach aktiver Einwilligung."
              : "During the beta phase, Google Analytics 4 and Microsoft Clarity are active by default unless you chose “Decline” in the cookie banner. Your choice is saved. Meta and Reddit advertising pixels load only after active consent."}
          </li>
        </ul>
      </section>

      {/* 3. Zu welchen Zwecken + Rechtsgrundlagen */}
      <section>
        <h2>
          3.{" "}
          {t
            ? "Wofür wir Daten verwenden"
            : "How we use data"}
        </h2>

        <h3>
          {t
            ? "3.1 Konto und Nutzung des Dienstes"
            : "3.1 Account and use of the service"}
        </h3>
        <ul>
          <li>
            {t
              ? "Bereitstellung des Nutzerkontos, Authentifizierung und Speicherung Ihres Lernfortschritts."
              : "Provision of your user account, authentication, and storage of your study progress."}
          </li>
          <li>
            {t
              ? "Abwicklung kostenpflichtiger Pro- und Group-Tarife einschließlich Rechnungsstellung."
              : "Processing of paid Pro and Group tiers including invoicing."}
          </li>
        </ul>

        <h3>
          {t
            ? "3.2 Sicherheit und Produktbetrieb"
            : "3.2 Security and service operation"}
        </h3>
        <ul>
          <li>
            {t
              ? "Fehler- und Absturzüberwachung via Sentry zur Sicherstellung eines stabilen Dienstes."
              : "Error and crash monitoring via Sentry to ensure a stable service."}
          </li>
          <li>
            {t
              ? "Schutz vor Missbrauch, Betrug und Rate-Limit-Umgehung (z.B. anonymisiertes IP-Logging bei Login-Versuchen)."
              : "Protection against abuse, fraud, and rate-limit circumvention (e.g. anonymized IP logging on login attempts)."}
          </li>
          <li>
            {t
              ? "Aggregierte, anonymisierte Produktverbesserung (z.B. welche Fragen am häufigsten gemeldet werden)."
              : "Aggregated, anonymized product improvement (e.g. which questions are most often flagged)."}
          </li>
        </ul>

        <h3>
          {t
            ? "3.3 Einwilligung für Marketing-E-Mails"
            : "3.3 Consent for marketing emails"}
        </h3>
        <ul>
          <li>
            {t
              ? "Versand von Marketing- oder Produkt-News-E-Mails (Opt-In, jederzeit widerrufbar)."
              : "Sending of marketing or product-news emails (opt-in, revocable at any time)."}
          </li>
        </ul>

        <h3>
          {t
            ? "3.4 Gesetzliche Pflichten"
            : "3.4 Legal obligations"}
        </h3>
        <ul>
          <li>
            {t
              ? "Erfüllung gesetzlicher Aufbewahrungspflichten für Rechnungsdaten, soweit diese anwendbar sind."
              : "Meeting legal retention requirements for invoice data where applicable."}
          </li>
          <li>
            {t
              ? "Beantwortung behördlicher Auskunftsersuchen."
              : "Responding to official requests for information."}
          </li>
        </ul>
      </section>

      {/* 4. Anbieter */}
      <section>
        <h2>
          4. {t ? "Anbieter, die MedPrüf unterstützen" : "Providers that support MedPrüf"}
        </h2>
        <p>
          {t
            ? "Wir verkaufen oder vermieten Ihre Daten nicht. Die folgenden Anbieter unterstützen den Betrieb und die Funktionen von MedPrüf. Welche Daten bei einer Funktion verarbeitet werden, hängt von Ihrer Nutzung ab. Weitere Informationen finden Sie in den Datenschutzinformationen der jeweiligen Anbieter."
            : "We do not sell or rent your data. The following providers support MedPrüf's operation and features. Which data they process depends on how you use each feature. See each provider's privacy information for further details."}
        </p>

        <div style={{ display: "grid", gap: "12px", margin: "16px 0" }}>
          {PROCESSORS.map((p) => (
            <div
              key={p.name}
              className="mp-card"
              style={{ padding: "14px 16px" }}
            >
              <h3 style={{ margin: "0 0 6px" }}>{p.name}</h3>
              <p style={{ margin: "0 0 6px" }}>
                <strong>{t ? "Zweck" : "Purpose"}:</strong>{" "}
                {t ? p.purpose.de : p.purpose.en}
              </p>
              <p style={{ margin: "0 0 6px" }}>
                <strong>{t ? "Rechtsträger" : "Jurisdiction"}:</strong>{" "}
                {t ? p.jurisdiction.de : p.jurisdiction.en}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{t ? "Datenschutz" : "Privacy policy"}:</strong>{" "}
                <a
                  href={p.policyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {p.policyLabel}
                </a>
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Drittländer / Internationale Übermittlungen */}
      <section>
        <h2>
          5.{" "}
          {t
            ? "Übermittlungen in Drittländer"
            : "International Data Transfers"}
        </h2>
        <p>
          {t
            ? "Einige unserer Auftragsverarbeiter haben ihren Hauptsitz außerhalb des Europäischen Wirtschaftsraums (EWR), insbesondere in den USA (OpenAI, Anthropic, Vercel, Google, Microsoft, Sentry), in den Vereinigten Arabischen Emiraten (Telegram) und in Indien (Zoho). Wir übermitteln personenbezogene Daten in diese Drittländer nur auf Grundlage geeigneter Garantien:"
            : "Some of our processors are headquartered outside the European Economic Area (EEA), in particular in the USA (OpenAI, Anthropic, Vercel, Google, Microsoft, Sentry), in the United Arab Emirates (Telegram), and in India (Zoho). We transfer personal data to these third countries only on the basis of appropriate safeguards:"}
        </p>
        <ul>
          <li>
            {t
              ? "Für US-Anbieter: EU-US Data Privacy Framework (DPF) soweit zertifiziert, ergänzend Standardvertragsklauseln (SCCs) der EU-Kommission gem. Art. 46 Abs. 2 lit. c DSGVO."
              : "For US providers: EU-US Data Privacy Framework (DPF) where certified, supplemented by Standard Contractual Clauses (SCCs) issued by the EU Commission pursuant to Art. 46(2)(c) GDPR."}
          </li>
          <li>
            {t
              ? "Für Telegram und Zoho: Standardvertragsklauseln (SCCs) und technische Schutzmaßnahmen (Transportverschlüsselung, Datenminimierung)."
              : "For Telegram and Zoho: Standard Contractual Clauses (SCCs) and technical safeguards (transport encryption, data minimization)."}
          </li>
          <li>
            {t
              ? "Bei allen KI-Anbietern (OpenAI, Anthropic): Deaktivierung des Modelltrainings über API-Eingaben vertraglich zugesichert."
              : "For all AI providers (OpenAI, Anthropic): model training on API inputs is contractually disabled."}
          </li>
        </ul>
        <p>
          {t
            ? "Eine Kopie der SCCs stellen wir Ihnen auf Anfrage an user-ad61df73@example.com zur Verfügung."
            : "A copy of the SCCs will be provided on request to user-ad61df73@example.com."}
        </p>
      </section>

      {/* 6. Speicherdauer */}
      <section>
        <h2>6. {t ? "Speicherdauer" : "Retention Periods"}</h2>
        <p>
          {t
            ? "Feste Aufbewahrungsfristen für alle Datenkategorien konnten wir nicht verifizieren. Für Auskunft zu einer bestimmten Datenkategorie oder eine Löschanfrage kontaktieren Sie user-ad61df73@example.com."
            : "We could not verify fixed retention periods for every data category. To ask about a specific category or request deletion, contact user-ad61df73@example.com."}
        </p>
      </section>

      {/* 7. Ihre Rechte */}
      <section>
        <h2>7. {t ? "Ihre Rechte" : "Your Rights"}</h2>
        <p>
          {t
            ? "Als betroffene Person stehen Ihnen die folgenden Rechte zu. Sie können diese formlos per E-Mail an user-ad61df73@example.com geltend machen; wir antworten in der Regel innerhalb eines Monats."
            : "As a data subject, you have the following rights. You can exercise these informally by email to user-ad61df73@example.com; we will generally respond within one month."}
        </p>
        <ul>
          <li>
            <strong>{t ? "Auskunft (Art. 15 DSGVO)" : "Right of access (Art. 15 GDPR)"}:</strong>{" "}
            {t
              ? "Sie können eine Kopie der über Sie gespeicherten personenbezogenen Daten anfordern."
              : "You may request a copy of the personal data stored about you."}
          </li>
          <li>
            <strong>{t ? "Berichtigung (Art. 16 DSGVO)" : "Rectification (Art. 16 GDPR)"}:</strong>{" "}
            {t
              ? "Sie können verlangen, dass unrichtige Daten korrigiert oder unvollständige Daten ergänzt werden."
              : "You may request correction of inaccurate data or completion of incomplete data."}
          </li>
          <li>
            <strong>{t ? "Löschung (Art. 17 DSGVO)" : "Erasure (Art. 17 GDPR)"}:</strong>{" "}
            {t
              ? "Sie haben das Recht auf Löschung Ihrer Daten („Recht auf Vergessenwerden“), soweit keine gesetzliche Aufbewahrungspflicht entgegensteht."
              : "You have the right to erasure of your data (right to be forgotten), unless a statutory retention obligation applies."}
          </li>
          <li>
            <strong>
              {t
                ? "Einschränkung der Verarbeitung (Art. 18 DSGVO)"
                : "Restriction of processing (Art. 18 GDPR)"}
              :
            </strong>{" "}
            {t
              ? "Sie können die Verarbeitung Ihrer Daten auf reine Speicherung einschränken lassen, z.B. während der Prüfung eines Widerspruchs."
              : "You may request that processing be restricted to mere storage, e.g. during review of an objection."}
          </li>
          <li>
            <strong>
              {t
                ? "Datenübertragbarkeit (Art. 20 DSGVO)"
                : "Data portability (Art. 20 GDPR)"}
              :
            </strong>{" "}
            {t
              ? "Sie erhalten Ihre Daten in einem strukturierten, gängigen, maschinenlesbaren Format (JSON) und können sie einem anderen Verantwortlichen übermitteln."
              : "You will receive your data in a structured, commonly used, machine-readable format (JSON) and may transmit it to another controller."}
          </li>
          <li>
            <strong>{t ? "Widerspruch (Art. 21 DSGVO)" : "Objection (Art. 21 GDPR)"}:</strong>{" "}
            {t
              ? "Sie können der Verarbeitung auf Basis berechtigter Interessen (insb. Fehlermonitoring, Missbrauchsschutz) jederzeit widersprechen."
              : "You may object to processing based on legitimate interest (in particular error monitoring, abuse prevention) at any time."}
          </li>
          <li>
            <strong>
              {t
                ? "Widerruf der Einwilligung (Art. 7 Abs. 3 DSGVO)"
                : "Withdrawal of consent (Art. 7(3) GDPR)"}
              :
            </strong>{" "}
            {t
              ? "Erteilte Einwilligungen (Analytics, Marketing) können Sie jederzeit mit Wirkung für die Zukunft widerrufen: über das Cookie-Banner, die Einstellungen oder formlos per E-Mail."
              : "Given consents (analytics, marketing) can be withdrawn at any time with effect for the future: via the cookie banner, settings, or informally by email."}
          </li>
          <li>
            <strong>
              {t
                ? "Beschwerde bei der Aufsichtsbehörde (Art. 77 DSGVO)"
                : "Complaint to the supervisory authority (Art. 77 GDPR)"}
              :
            </strong>{" "}
            {t
              ? "Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren (Details siehe Abschnitt 8)."
              : "You have the right to lodge a complaint with a data protection supervisory authority (see Section 8)."}
          </li>
        </ul>
      </section>

      {/* 8. Beschwerderecht */}
      <section>
        <h2>8. {t ? "Beschwerderecht" : "Right to Lodge a Complaint"}</h2>
        <p>
          {t
            ? "Sie haben nach Art. 77 DSGVO das Recht, sich über die Verarbeitung Ihrer personenbezogenen Daten bei einer Aufsichtsbehörde zu beschweren. Für Nutzer mit Sitz in Österreich ist die zuständige Behörde:"
            : "You have the right under Art. 77 GDPR to lodge a complaint about the processing of your personal data with a supervisory authority. For users based in Austria, the competent authority is:"}
        </p>
        <div className="mp-card" style={{ padding: "14px 16px", margin: "12px 0" }}>
          <p style={{ margin: 0 }}>
            <strong>Österreichische Datenschutzbehörde (DSB)</strong>
            <br />
            Barichgasse 40–42
            <br />
            1030 Wien, {t ? "Österreich" : "Austria"}
            <br />
            {t ? "Telefon" : "Phone"}: +43 1 52 152-0
            <br />
            E-Mail: <a href="mailto:user-1cfb5e21@example.com">user-1cfb5e21@example.com</a>
            <br />
            {t ? "Website" : "Website"}:{" "}
            <a
              href="https://www.dsb.gv.at"
              target="_blank"
              rel="noopener noreferrer"
            >
              www.dsb.gv.at
            </a>
          </p>
        </div>
        <p>
          {t
            ? "Alternativ können Sie sich an die Aufsichtsbehörde Ihres gewöhnlichen Aufenthaltsorts, Arbeitsplatzes oder des mutmaßlichen Verstoßes wenden."
            : "Alternatively, you may contact the supervisory authority of your habitual residence, place of work, or of the alleged violation."}
        </p>
      </section>

      {/* 9. Cookies und Tracking */}
      <section>
        <h2>9. {t ? "Cookies und Tracking" : "Cookies and Tracking"}</h2>
        <p>
          {t
            ? "MedPrüf verwendet technisch notwendige Cookies für die Sitzungsverwaltung (Login, Sprache, Theme). Diese sind nach § 165 Abs. 3 TKG 2021 einwilligungsfrei."
            : "MedPrüf uses strictly necessary cookies for session management (login, language, theme). These are exempt from consent under § 165(3) TKG 2021."}
        </p>
        <p>
          {t
            ? "Während der Beta-Phase sind Google Analytics 4 und Microsoft Clarity standardmäßig aktiv. Wenn Sie im Cookie-Banner „Ablehnen“ wählen, werden sie deaktiviert; Ihre Auswahl wird gespeichert. Sie können die Anwendung auch dann vollständig nutzen. Werbe-Pixel von Meta und Reddit laden nur nach aktiver Einwilligung."
            : "During the beta phase, Google Analytics 4 and Microsoft Clarity are active by default. Choosing “Decline” in the cookie banner disables them, and your choice is saved. You can use the application fully either way. Meta and Reddit advertising pixels load only after active consent."}
        </p>
        <p>
          {t
            ? "Die Werbe-Pixel von Meta und Reddit laden ausschließlich nach Ihrer aktiven Einwilligung im Cookie-Banner. Wenn es aktiviert ist, kann das Whop-Attributions-Pixel Besuche mit Checkout-Aktivitäten verknüpfen und dafür eine Gerätekennung verwenden. Informationen zu Ihren Rechten finden Sie in Abschnitt 7."
            : "The Meta and Reddit advertising pixels load only after your active consent in the cookie banner. When enabled, the Whop attribution pixel can link visits with checkout activity and may use a device identifier for this purpose. See section 7 for information about your rights."}
        </p>
      </section>

      {/* 10. Kinder */}
      <section>
        <h2>10. {t ? "Kinder" : "Children"}</h2>
        <p>
          {t
            ? "MedPrüf richtet sich ausschließlich an volljährige, in der Regel akademisch gebildete Nutzer (Ärztinnen und Ärzte mit nichtösterreichischem Studienabschluss). Die Dienste sind nicht für Personen unter 18 Jahren bestimmt. Wir erheben wissentlich keine Daten von Minderjährigen. Sollten wir Kenntnis davon erlangen, dass wir Daten einer minderjährigen Person verarbeiten, löschen wir diese unverzüglich."
            : "MedPrüf is directed exclusively at adults, typically academically trained users (physicians with a non-Austrian medical degree). The services are not intended for persons under 18. We do not knowingly collect data from minors. If we become aware that we have processed data of a minor, we will delete it without delay."}
        </p>
      </section>

      {/* 11. Änderungen */}
      <section>
        <h2>11. {t ? "Änderungen dieser Erklärung" : "Changes to This Policy"}</h2>
        <p>
          {t
            ? "Wir aktualisieren diese Datenschutzerklärung, wenn sich unsere Dienste, Auftragsverarbeiter oder die gesetzliche Lage ändern. Die jeweils aktuelle Fassung finden Sie stets unter /privacy. Bei wesentlichen Änderungen (z.B. neue Kategorien personenbezogener Daten oder neue Empfänger) informieren wir Sie zusätzlich per E-Mail an Ihre registrierte Adresse oder über ein deutlich sichtbares In-App-Banner, bevor die Änderung wirksam wird."
            : "We update this policy when our services, processors, or the legal situation change. The current version is always available at /privacy. For material changes (e.g. new categories of personal data or new recipients), we will additionally notify you by email to your registered address or via a clearly visible in-app banner before the change takes effect."}
        </p>
      </section>

      {/* 12. Kontakt */}
      <section>
        <h2>12. {t ? "Kontakt" : "Contact"}</h2>
        <p>
          {t
            ? "Bei Fragen zu dieser Datenschutzerklärung, zur Ausübung Ihrer Rechte oder zu konkreten Verarbeitungsvorgängen erreichen Sie uns unter:"
            : "For questions about this policy, exercising your rights, or specific processing activities, you can reach us at:"}
        </p>
        <p>
          E-Mail:{" "}
          <a href="mailto:user-ad61df73@example.com">user-ad61df73@example.com</a>
          <br />
          {t ? "Support" : "Support"}:{" "}
          <a href="mailto:user-77be0a2a@example.com">user-77be0a2a@example.com</a>
          <br />
          {t ? "Verantwortlicher" : "Controller"}:{" "}
          <a href="mailto:user-b7e46e80@example.com">user-b7e46e80@example.com</a>
        </p>
      </section>

      {/* Disclaimer */}
      <section>
        <h2>
          {t ? "Rechtlicher Hinweis" : "Legal Notice"}
        </h2>
        <p>
          <em>
            {t
              ? "Diese Datenschutzerklärung wurde sorgfältig vorbereitet, ersetzt jedoch keine individuelle Rechtsberatung. Letzte Aktualisierung: 25. September 2026."
            : "This privacy policy has been prepared with care but does not replace individual legal advice. Last updated: 25 September 2026."}
          </em>
        </p>
      </section>
    </DocLayout>
  );
}
