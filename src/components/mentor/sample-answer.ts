import type { MentorCitation } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";

/**
 * MUX-19 static sample answer: zero model call, zero ledger touch.
 *
 * Built from one confirmed fact row in content/mentor-facts/sip.json. The row
 * is snapshotted here (no facts JSON in the client bundle). The unit test
 * tests/unit/a39-mentor-surfaces/sample-answer.test.ts fails as soon as the
 * row changes (text, source, read date, verdict, status), so the sample is
 * re-verified with the fact. At runtime it expires on its own once the row's
 * review interval has passed since it was read, or the row stops being live.
 */
export const SAMPLE_FACT = {
  id: "sip4a.registration.no-late-registration",
  text_de: "SIP4a: Nachmeldungen können laut Prüfungskalender aus keinem Grund durchgeführt werden; die Anmeldefrist kann nicht überschritten werden. Bei technischen Problemen oder fehlender Bestätigung ist die Studienabteilung innerhalb der Anmeldefrist per E-Mail über den Studierendenaccount zu kontaktieren.",
  text_en: "SIP4a: per the Prüfungskalender, late registrations cannot be made for any reason; the Anmeldefrist cannot be exceeded. For technical problems or a missing confirmation, contact the Studienabteilung by email from the student account within the Anmeldefrist.",
  source_url: "https://www.meduniwien.ac.at/web/studierende/mein-studium/diplomstudium-humanmedizin/pruefungen-pruefungsergebnisse/pruefungskalender/",
  source_label: "MedUni Wien, Prüfungskalender (SIP)",
  read_on: "2026-10-10",
  review_every_days: 90,
  verdict: "confirmed",
  status: "live",
  valid_until: null as string | null,
} as const;

const QUESTION = {
  de: "Kann ich mich für die SIP4a nach Ende der Anmeldefrist noch nachmelden?",
  en: "Can I still register for SIP4a after the registration period has ended?",
} as const;

const LEAD = {
  de: "Nein. Laut Prüfungskalender der MedUni Wien gibt es keine Nachmeldung.",
  en: "No. According to the MedUni Wien exam calendar there is no late registration.",
} as const;

export interface SampleAnswer {
  question: string;
  lead: string;
  body: string;
  citation: MentorCitation;
  readOn: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** null when the snapshot is no longer within its review window. */
export function sampleAnswer(lang: MentorUiLang, now: Date = new Date()): SampleAnswer | null {
  const f = SAMPLE_FACT;
  if (f.verdict !== "confirmed" || f.status !== "live") return null;
  const read = Date.parse(`${f.read_on}T00:00:00Z`);
  if (!Number.isFinite(read) || now.getTime() > read + f.review_every_days * DAY_MS) return null;
  if (f.valid_until && now.getTime() > Date.parse(`${f.valid_until}T23:59:59Z`)) return null;
  const de = lang === "de";
  return {
    question: de ? QUESTION.de : QUESTION.en,
    lead: de ? LEAD.de : LEAD.en,
    body: de ? f.text_de : f.text_en,
    citation: { fact_id: f.id, source_label: f.source_label, source_url: f.source_url, read_on: f.read_on, review_every_days: f.review_every_days },
    readOn: f.read_on,
  };
}
