/**
 * MedPrüf — Austrian Resource Library
 *
 * Verified external resources for candidates preparing for the Austrian
 * Kenntnisprüfung (Route A) and Nostrifizierung / Stichprobentest (Route B).
 *
 * SOURCE: reviews/uiux-overhaul-2026-06-25/A0-austrian-resources.md (Atlas, 2026-06-25)
 * LINK-CHECK: curl -sL GET, 2026-06-25. 12/12 live.
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
}

/**
 * 12 verified Austrian resources, 3 categories.
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
    title: "Arztakademie: Prüfung Ärztin/Arzt für Allgemeinmedizin (Kenntnisprüfung)",
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
