/**
 * Mentor refusals and fallbacks (W2-BRAIN).
 *
 * Every refusal carries an official link. Links are NEVER written here: they
 * are looked up by id in src/lib/austrian-resources.ts (the verified owner),
 * so the mentor can only point at a page the resources list already vetted.
 * The model never supplies a link; the validator attaches it from this table.
 *
 * Copy: DE and EN only. Other mentor languages fall back to EN (contract C9);
 * Arabic wording waits for [name]'s sign-off. No em dashes.
 */

import { AUSTRIAN_RESOURCES } from "@/lib/austrian-resources";
import type { MentorLang, MentorRefusalReason } from "../contract";
import type { FilingUniversity, MentorExamKey } from "../seam";

/** Resource ids in austrian-resources.ts (official category). */
export const OFFICIAL_RESOURCE_IDS = Object.freeze({
  oeak: 1,
  meduniWienNostrifizierung: 4,
  imedNostrifizierung: 5,
  medunigrazNostrifizierung: 6,
  berufsanerkennung: 7,
});

function resourceUrl(id: number): string {
  const r = AUSTRIAN_RESOURCES.find((x) => x.id === id && x.category === "official");
  if (r) return r.url;
  // Fail safe: the first official resource, never a hand-written URL.
  const first = AUSTRIAN_RESOURCES.find((x) => x.category === "official");
  if (!first) throw new Error("austrian-resources has no official entry");
  return first.url;
}

/** Official page per exam (used for no_verified_source and the validator fallback). */
export function officialLinkForExam(exam: MentorExamKey | null | undefined): string {
  switch (exam) {
    case "stichprobentest":
      return resourceUrl(OFFICIAL_RESOURCE_IDS.imedNostrifizierung);
    case "general":
      return resourceUrl(OFFICIAL_RESOURCE_IDS.berufsanerkennung);
    case "fsp":
      return resourceUrl(OFFICIAL_RESOURCE_IDS.oeak);
    default:
      return resourceUrl(OFFICIAL_RESOURCE_IDS.meduniWienNostrifizierung);
  }
}

/** Official page per filing university (deadline questions without a verified row). */
export function officialLinkForUniversity(u: FilingUniversity): string {
  switch (u) {
    case "innsbruck":
      return resourceUrl(OFFICIAL_RESOURCE_IDS.imedNostrifizierung);
    case "graz":
      return resourceUrl(OFFICIAL_RESOURCE_IDS.medunigrazNostrifizierung);
    default:
      return resourceUrl(OFFICIAL_RESOURCE_IDS.meduniWienNostrifizierung);
  }
}

const REASON_RESOURCE: Readonly<Record<MentorRefusalReason, number | "exam">> = Object.freeze({
  individual_ruling: OFFICIAL_RESOURCE_IDS.berufsanerkennung,
  legal_or_documents: OFFICIAL_RESOURCE_IDS.meduniWienNostrifizierung,
  certificate_acceptance: OFFICIAL_RESOURCE_IDS.oeak,
  patient_advice: OFFICIAL_RESOURCE_IDS.oeak,
  real_exam_recall: "exam",
  competitor_comparison: "exam",
  no_verified_source: "exam",
  out_of_scope: OFFICIAL_RESOURCE_IDS.berufsanerkennung,
});

export function refusalLink(reason: MentorRefusalReason, exam: MentorExamKey | null | undefined): string {
  const r = REASON_RESOURCE[reason];
  return r === "exam" ? officialLinkForExam(exam) : resourceUrl(r);
}

/** Every link the mentor may ever show (validator allow-list for links in answer text). */
export function allOfficialLinks(): string[] {
  return [...new Set(AUSTRIAN_RESOURCES.filter((r) => r.category === "official").map((r) => r.url))];
}

type Lines = Readonly<Record<MentorRefusalReason, string>>;

const REFUSAL_LINES_DE: Lines = Object.freeze({
  individual_ruling:
    "Ob das in deinem Fall gilt, kann nur die zuständige Stelle entscheiden. Bitte frag dort direkt nach.",
  legal_or_documents:
    "Rechtliche Fragen und Fragen zu Unterlagen kann ich nicht beantworten. Bitte wende dich an die zuständige Universität.",
  certificate_acceptance:
    "Welches Zertifikat anerkannt wird, entscheidet die zuständige Stelle. Bitte frag dort direkt nach.",
  patient_advice:
    "Ich gebe keine Ratschläge zu echten Patientinnen oder Patienten. Ich helfe nur bei der Prüfungsvorbereitung.",
  real_exam_recall:
    "Ob eine Frage in einer echten Prüfung vorkam, kann ich nicht sagen. Ich erkläre dir gern den Inhalt.",
  competitor_comparison: "Andere Anbieter vergleiche ich nicht. Ich helfe dir gern bei deiner Vorbereitung.",
  no_verified_source:
    "Dazu habe ich keine bestätigte offizielle Quelle. Bitte prüf das direkt bei der zuständigen Stelle.",
  out_of_scope: "Dabei kann ich nicht helfen. Ich beantworte Fragen zu Prüfungen, Abläufen und deiner Vorbereitung.",
});

const REFUSAL_LINES_EN: Lines = Object.freeze({
  individual_ruling: "Only the responsible office can decide whether this applies to you. Please ask them directly.",
  legal_or_documents:
    "I cannot answer legal or document questions. Please contact the responsible university.",
  certificate_acceptance:
    "Which certificate is accepted is decided by the responsible office. Please ask them directly.",
  patient_advice: "I do not give advice about real patients. I only help with exam preparation.",
  real_exam_recall: "I cannot say whether a question appeared in a real exam. I am happy to explain the content.",
  competitor_comparison: "I do not compare other providers. I am happy to help with your preparation.",
  no_verified_source: "I have no confirmed official source for this. Please check directly with the responsible office.",
  out_of_scope: "I cannot help with that. I answer questions about the exams, the procedure and your preparation.",
});

export function refusalLine(reason: MentorRefusalReason, lang: MentorLang | null | undefined): string {
  return (lang === "de" ? REFUSAL_LINES_DE : REFUSAL_LINES_EN)[reason];
}

/** Sentence that replaces an unsupported value (the link is appended by the validator). */
export function fallbackLine(lang: MentorLang | null | undefined, link: string): string {
  return lang === "de"
    ? `Diese Angabe ist nicht offiziell bestätigt. Bitte prüf sie auf der offiziellen Seite: ${link}`
    : `This detail is not officially confirmed. Please check it on the official page: ${link}`;
}

const FALLBACK_PREFIXES: readonly string[] = (["de", "en"] as const).map((l) => fallbackLine(l, "\u0000").split("\u0000")[0]);
const FALLBACK_LINE_RE = new RegExp(
  FALLBACK_PREFIXES.map((p) => `${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\S+`).join("|"),
  "gu",
);

/**
 * True when a text says nothing but the generic "not officially confirmed,
 * check the official page" line(s) (list markers and punctuation aside): the
 * whole answer was replaced by the fallback notice. Such a turn is not charged
 * to the learner (turn.ts). A text with any other word or number is a real,
 * partly replaced answer and is false.
 */
export function isFallbackOnlyText(text: string): boolean {
  if (typeof text !== "string" || text.trim().length === 0) return false;
  let hit = false;
  const rest = text.replace(FALLBACK_LINE_RE, () => {
    hit = true;
    return " ";
  });
  return hit && !/[\p{L}\p{N}]/u.test(rest);
}

/** Exported for the no-em-dash test. */
export const REFUSAL_COPY = Object.freeze({ de: REFUSAL_LINES_DE, en: REFUSAL_LINES_EN });
