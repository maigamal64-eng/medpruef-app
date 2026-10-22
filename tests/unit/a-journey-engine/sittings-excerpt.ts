/**
 * Stored excerpt of OFFICIAL_SITTINGS (src/lib/exam-dates.ts, rows read
 * 2026-10-10) for the journey engine tests. The engine tests run on this
 * excerpt, never on the live constant, so a later calendar edit cannot
 * silently change what they prove; excerpt-drift.test.ts fails loudly when
 * the live rows stop matching.
 */
import type { OfficialSitting } from "@/lib/exam-dates";

const SIP = "https://www.meduniwien.ac.at/web/studierende/mein-studium/diplomstudium-humanmedizin/pruefungen-pruefungsergebnisse/pruefungskalender/";
const RIG = "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/WS26Pr%C3%BCf_modus_EW_03062026.pdf";
const MERKBLATT = "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/pdf/Merkblatt_Nostri_Human_VS_1._9._2026-1.pdf";
const IMED = "https://www.i-med.ac.at/studium-services/media/Termine-Stichprobentest-2027-1.pdf";
const READ = "2026-10-21"; // OFFICIAL_SITTINGS re-read 2026-10-21 (a-n2-merge-pass-1022)
const MUW = "MedUni Wien";

const sip = (exam_key: "sip4a" | "sip5a", date: string, opens: string, closes: string): OfficialSitting => ({
  exam_key,
  learner_label: exam_key === "sip4a" ? { de: "SIP4a (MedUni Wien)", en: "SIP4a (MedUni Vienna)" } : { de: "SIP5a (MedUni Wien)", en: "SIP5a (MedUni Vienna)" },
  date,
  registration_opens: opens,
  registration_closes: closes,
  deadline_type: "registration",
  publisher: MUW,
  filing_university: "wien",
  source_url: SIP,
  read_on: READ,
});

const rig = (exam_key: "rezeptierkunde" | "gerichtsmedizin", date: string, end: string, opens: string, closes: string): OfficialSitting => ({
  exam_key,
  learner_label: exam_key === "rezeptierkunde"
    ? { de: "Rezeptierkunde (Pharmakologie), MedUni Wien", en: "Rezeptierkunde (pharmacology), MedUni Vienna" }
    : { de: "Gerichtsmedizin, MedUni Wien", en: "Gerichtsmedizin (forensic medicine), MedUni Vienna" },
  date,
  date_end: end,
  registration_opens: opens,
  registration_closes: closes,
  closes_at_time: "12:00",
  deadline_type: "registration",
  publisher: MUW,
  filing_university: "wien",
  source_url: RIG,
  read_on: READ,
});

const stp = (date: string, cutoff: string, imed: string): OfficialSitting[] => [
  {
    exam_key: "stichprobentest",
    learner_label: { de: "Stichprobentest Innsbruck", en: "Stichprobentest Innsbruck" },
    date,
    registration_opens: null,
    registration_closes: cutoff,
    deadline_type: "filing_cutoff",
    publisher: MUW,
    filing_university: "wien",
    source_url: MERKBLATT,
    read_on: READ,
  },
  {
    exam_key: "stichprobentest",
    learner_label: { de: "Stichprobentest Innsbruck", en: "Stichprobentest Innsbruck" },
    date,
    registration_opens: null,
    registration_closes: imed,
    deadline_type: "registration",
    publisher: "Medizinische Universität Innsbruck",
    filing_university: "innsbruck",
    source_url: IMED,
    read_on: READ,
  },
];

/** The rows the tests use, in OFFICIAL_SITTINGS order. */
export const SITTINGS_EXCERPT: readonly OfficialSitting[] = [
  sip("sip5a", "2026-11-17", "2026-10-05", "2026-10-19"), // date-ok: official SIP calendar row (stored excerpt)
  sip("sip4a", "2026-11-18", "2026-10-05", "2026-10-19"), // date-ok: official SIP calendar row (stored excerpt)
  rig("rezeptierkunde", "2026-11-23", "2026-11-27", "2026-10-07", "2026-10-20"), // date-ok: official MedUni Wien exam week (stored excerpt)
  rig("gerichtsmedizin", "2026-11-23", "2026-11-27", "2026-10-07", "2026-10-20"), // date-ok: official MedUni Wien exam week (stored excerpt)
  rig("rezeptierkunde", "2027-01-18", "2027-01-22", "2026-12-02", "2026-12-15"), // date-ok: official MedUni Wien exam week (WS26 PDF), not the OeAEK sitting
  rig("gerichtsmedizin", "2027-01-18", "2027-01-22", "2026-12-02", "2026-12-15"), // date-ok: official MedUni Wien exam week (WS26 PDF), not the OeAEK sitting
  ...stp("2027-02-03", "2026-12-14", "2027-01-07"),
  sip("sip5a", "2027-02-15", "2027-01-04", "2027-01-18"), // date-ok: official SIP registration close (SIP calendar), not the OeAEK sitting
  sip("sip4a", "2027-02-19", "2027-01-04", "2027-01-18"), // date-ok: official SIP registration close (SIP calendar), not the OeAEK sitting
  { ...sip("sip4a", "2027-03-10", "2027-01-25", "2027-02-08"), window_unconfirmed: true },
  { ...sip("sip5a", "2027-03-10", "2027-01-25", "2027-02-08"), window_unconfirmed: true },
  sip("sip4a", "2027-04-27", "2027-03-15", "2027-03-29"),
  sip("sip5a", "2027-04-28", "2027-03-15", "2027-03-29"),
];
