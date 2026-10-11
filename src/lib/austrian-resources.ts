/**
 * MedPrüf — Austrian Resource Library
 *
 * Verified external resources for candidates preparing for the Austrian
 * Kenntnisprüfung (Route A) and Nostrifizierung / Stichprobentest (Route B).
 *
 * SOURCE: reviews/uiux-overhaul-2026-06-25/A0-austrian-resources.md (Atlas, 2026-06-25)
 * LINK-CHECK: run scripts/linkcheck.mjs for dated HTTP and content hashes.
 *   arztakademie.at/anmeldung returned 404 (dead page); rows 2+3 merged into
 *   one Arztakademie card on the live /allgemeinmedizin URL.
 *
 * MAINTENANCE: treat this file as the single source of truth for the link set.
 * Dead links must be fixed here; never hardcode URLs in page components.
 * Do NOT hardcode exam dates — those are owned by src/lib/exam-dates.ts.
 */

export type ResourceCategory = "official" | "guidelines" | "reference"
export type ResourceRoute = "A" | "B" | "both"

export interface AustrianResource {
  /** Stable numeric id matching the A0 spec row number */
  id: number
  title: string
  url: string
  deOneLiner: string
  enOneLiner: string
  category: ResourceCategory
  /** Route A = Kenntnisprüfung Wien; Route B = Stichprobentest/Nostrifizierung */
  route?: ResourceRoute
  /** True when the resource is only partially free (e.g. AMBOSS) */
  freemium?: boolean
  /** Edition belongs to the linked document, never inferred from its file name. */
  edition?: string
}

/**
 * Austrian resources in 3 categories, with official registration sources.
 * All external links open in a new tab (enforced in the page component).
 * One-liners are in both DE and EN; no em dashes in either language.
 */
export const AUSTRIAN_RESOURCES: AustrianResource[] = [

  // --- Category 1: Official & registration (Route A/B labels required) ---

  {
    id: 1,
    title: "Österreichische Ärztekammer: Ärztliche Tätigkeit in Österreich",
    url: "https://www.aerztekammer.at/aerztliche-taetigkeit-in-oesterreich",
    deOneLiner:
      "Die offizielle ÖÄK-Seite zur Anerkennung und Eintragung in die Ärzteliste, mit Infoblättern und Antragsformularen.",
    enOneLiner:
      "The official Austrian Medical Chamber page on recognition and entry into the physician register, with info sheets and application forms.",
    category: "official",
    route: "A",
  },
  {
    id: 2,
    title: "Arztakademie: Postgraduale Prüfung Ärztin/Arzt für Allgemeinmedizin",
    url: "https://www.arztakademie.at/allgemeinmedizin",
    deOneLiner:
      "Die offizielle Akademie-der-Ärzte-Seite zur Arztprüfung Allgemeinmedizin: Ablauf, Termine, Anmeldung und Prüfungsgebühr.",
    enOneLiner:
      "The official Academy of Physicians page for the General Medicine exam: format, dates, registration, and fee.",
    category: "official",
    route: "A",
  },
  {
    id: 4,
    title: "MedUni Wien: Nostrifizierung Humanmedizin (Ermittlungsverfahren)",
    url: "https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/ermittlungsverfahren/",
    deOneLiner:
      "Die offizielle MedUni-Wien-Seite zum Nostrifizierungsverfahren: Curriculumsvergleich, Stichprobentest, Ergänzungsprüfungen.",
    enOneLiner:
      "The official MedUni Vienna page on the Nostrifizierung procedure: curriculum comparison, Stichprobentest, supplementary exams.",
    category: "official",
    route: "B",
  },
  {
    id: 5,
    title: "MedUni Innsbruck: Nostrifizierungsablauf (Stichprobentest)",
    url: "https://www.i-med.ac.at/de/studium/services/nostrifizierungsablauf/",
    deOneLiner:
      "Die offizielle MedUni-Innsbruck-Seite zum Ablauf, inkl. dem gemeinsam durchgeführten Stichprobentest und den Terminen.",
    enOneLiner:
      "The official MedUni Innsbruck page on the procedure, including the jointly run Stichprobentest and its dates.",
    category: "official",
    route: "B",
  },
  {
    id: 6,
    title: "MedUni Graz: Nostrifizierung",
    url: "https://www.medunigraz.at/en/study-guidance/nostrification",
    deOneLiner:
      "Die offizielle MedUni-Graz-Seite zur Nostrifizierung, mit der Blockstruktur des Stichprobentests und den Bestehensregeln.",
    enOneLiner:
      "The official MedUni Graz page on Nostrifizierung, with the Stichprobentest block structure and pass rules.",
    category: "official",
    route: "B",
  },
  {
    id: 7,
    title: "berufsanerkennung.at (ÖIF / Bundesministerium)",
    url: "https://www.berufsanerkennung.at/",
    deOneLiner:
      "Das offizielle österreichische Portal zur Berufsanerkennung, mit Anerkennungs-Wegweiser in 8 Sprachen (inkl. Arabisch).",
    enOneLiner:
      "The official Austrian portal for professional recognition, with a recognition pathfinder in 8 languages (including Arabic).",
    category: "official",
    route: "both",
  },

  // Official source hub for university nostrification candidates.
  {
    id: 14,
    title: "MedUni Wien: SIP-Prüfungskalender",
    url: "https://www.meduniwien.ac.at/web/studierende/mein-studium/diplomstudium-humanmedizin/pruefungen-pruefungsergebnisse/pruefungskalender/",
    deOneLiner: "SIP-Termine, Anmeldefristen und Hinweise zur Veröffentlichung der Fragenformate.",
    enOneLiner: "SIP dates, registration windows and information on publication of question formats.",
    category: "official",
    route: "B",
  },
  {
    id: 15,
    title: "MedUni Wien: Nostrifizierung, Prüfungen",
    url: "https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/pruefungen/",
    deOneLiner: "Anmeldeformulare und Anmeldewege für SIP-Prüfungsteile, Rezeptierkunde und Gerichtsmedizin.",
    enOneLiner: "Registration forms and procedures for SIP exam parts, Rezeptierkunde and legal medicine.",
    category: "official",
    route: "B",
  },
  {
    id: 16,
    title: "MedUni Wien: Merkblatt Humanmedizin (1. September 2026)",
    url: "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/pdf/Merkblatt_Nostri_Human_VS_1._9._2026-1.pdf",
    deOneLiner: "Merkblatt zur Nostrifizierung Humanmedizin, Ausgabe 1. September 2026: Voraussetzungen, Verfahren und Ergänzungsprüfungen.",
    enOneLiner: "Human medicine nostrification information sheet, edition 1 September 2026: requirements, procedure and supplementary exams.",
    category: "official",
    route: "B",
    edition: "1 September 2026",
  },
  {
    id: 17,
    title: "MedUni Wien: Rezeptierkunde und Gerichtsmedizin, WS 2026/27",
    url: "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/WS26Pr%C3%BCf_modus_EW_03062026.pdf",
    deOneLiner: "Prüfungswochen und Anmeldefristen für Rezeptierkunde und Gerichtsmedizin im Wintersemester 2026/27.",
    enOneLiner: "Exam weeks and registration windows for Rezeptierkunde and legal medicine in winter semester 2026/27.",
    category: "official",
    route: "B",
    edition: "3 June 2026, WS 2026/27",
  },
  {
    id: 18,
    title: "MedUni Wien: Rezeptierkunde und Gerichtsmedizin, SS 2026",
    url: "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/SS26Pruef_modus_EW_13012026.pdf",
    deOneLiner: "Vergangene Prüfungswochen und Anmeldefristen im Sommersemester 2026, keine Termine für 2027.",
    enOneLiner: "Past exam weeks and registration windows in summer semester 2026, not dates for 2027.",
    category: "official",
    route: "B",
    edition: "13 January 2026, SS 2026",
  },
  {
    id: 19,
    title: "MedUni Innsbruck: Stichprobentest, Termine 2027",
    url: "https://www.i-med.ac.at/studium-services/media/Termine-Stichprobentest-2027-1.pdf",
    deOneLiner: "Offizielle Stichprobentest-Termine 2027 und Anmeldefristen des Innsbrucker Dokuments. Beachte auch das Merkblatt deiner Antragsuniversität.",
    enOneLiner: "Official 2027 Stichprobentest dates and registration deadlines in the Innsbruck document. Also check your filing university information sheet.",
    category: "official",
    route: "B",
    edition: "27 August 2026, sittings 2027",
  },
  {
    id: 20,
    title: "MedUni Wien: Nostrifizierung, Antragstellung",
    url: "https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/antragstellung/",
    deOneLiner: "Voraussetzungen, Unterlagen und aktuelle Merkblätter für den Nostrifizierungsantrag.",
    enOneLiner: "Requirements, documents and current information sheets for the nostrification application.",
    category: "official",
    route: "B",
  },
  {
    id: 21,
    title: "MedUni Wien: Med.Campus",
    url: "https://campus.meduniwien.ac.at/",
    deOneLiner: "Studierendenportal zur Prüfung der Anmeldung und für Abmeldungen. Nostrifikant:innen beachten die besonderen Anmeldewege.",
    enOneLiner: "Student portal to check registration and withdraw. Nostrification candidates must follow their specific registration procedures.",
    category: "official",
    route: "B",
  },
  {
    id: 22,
    title: "Arztakademie: Sprachprüfung Deutsch",
    url: "https://www.arztakademie.at/sprachpruefung",
    deOneLiner: "Informationen zur österreichischen ärztlichen Sprachprüfung, getrennt von SIP und Stichprobentest.",
    enOneLiner: "Information on the Austrian medical German language exam, separate from SIP and the Stichprobentest.",
    category: "official",
    route: "B",
  },
  {
    id: 23,
    title: "MedUni Wien: SIP-Ausschreibungen",
    url: "https://www.meduniwien.ac.at/web/studierende/mein-studium/diplomstudium-humanmedizin/pruefungen-pruefungsergebnisse/pruefungsausschreibungen/",
    deOneLiner: "Ausschreibungen mit dem verbindlichen Fragenformat des jeweiligen SIP-Termins. Der Zugriff kann eine Anmeldung erfordern.",
    enOneLiner: "Exam notices with the binding question format for each SIP sitting. Access may require sign-in.",
    category: "official",
    route: "B",
  },

  // --- Category 2: Free clinical guidelines ---

  {
    id: 8,
    title: "AWMF Leitlinienregister",
    url: "https://register.awmf.org/de/leitlinien/aktuelle-leitlinien",
    deOneLiner:
      "Das deutschsprachige Register medizinischer Leitlinien, frei lesbar, von den wissenschaftlichen Fachgesellschaften gepflegt.",
    enOneLiner:
      "The German-language register of medical guidelines, free to read, maintained by the scientific medical societies.",
    category: "guidelines",
  },
  {
    id: 9,
    title: "ÖGAM: Leitlinien Allgemeinmedizin",
    url: "https://oegam.at/tags/leitlinie",
    deOneLiner:
      "Die Leitlinien-Sammlung der Österreichischen Gesellschaft für Allgemein- und Familienmedizin, frei einsehbar.",
    enOneLiner:
      "The guideline collection of the Austrian Society for General and Family Medicine, freely viewable.",
    category: "guidelines",
  },
  {
    id: 10,
    title: "ÖDG: Leitlinien für die Praxis (Diabetes)",
    url: "https://www.oedg.at/oedg_leitlinien.html",
    deOneLiner:
      "Die Praxis-Leitlinien der Österreichischen Diabetes Gesellschaft, Vollversion gratis als PDF.",
    enOneLiner:
      "The practice guidelines of the Austrian Diabetes Society, full version free as a PDF.",
    category: "guidelines",
  },

  // --- Category 3: Reference & language ---

  {
    id: 11,
    title: "DocCheck Flexikon",
    url: "https://flexikon.doccheck.com/de/Hauptseite",
    deOneLiner:
      "Das offene, kostenlose deutschsprachige Medizin-Lexikon mit über 85.000 Fachartikeln.",
    enOneLiner:
      "The open, free German-language medical encyclopedia with over 85,000 specialist articles.",
    category: "reference",
  },
  {
    id: 12,
    title: "AMBOSS",
    url: "https://www.amboss.com/de",
    deOneLiner:
      "Eine medizinische Wissensplattform mit kostenlosem Anki-Add-on und Chrome-Erweiterung; Vollzugang ist kostenpflichtig.",
    enOneLiner:
      "A medical knowledge platform with a free Anki add-on and Chrome extension; full access is paid.",
    category: "reference",
    freemium: true,
  },
  {
    id: 13,
    title: "IMED-KOMM-EU",
    url: "https://www.imed-komm.eu/",
    deOneLiner:
      "Die EU-geförderte Gratis-Plattform mit Selbstlernübungen, Glossaren und Selbsttests zur medizinischen Fachsprache.",
    enOneLiner:
      "The EU-funded free platform with self-learning exercises, glossaries, and self-tests for medical German.",
    category: "reference",
  },
]
