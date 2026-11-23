/**
 * The Kenntnisprüfung simulation profile (PLAN.md 2.2, 2.3). It lives on the
 * Germany surface, not in src/lib/sim/profiles, because the boundary test keeps
 * the exam key and every Germany import inside the Germany paths; the core stays
 * exam-agnostic and imports nothing from here.
 */
import type { SimProfile } from "@/lib/sim";
import { DE_KP_EXAM_KEY } from "../index";
import { BERICHT_SECTIONS, DE_KP_BERICHT_MAX_CHARS, DE_KP_LINE_MAX_CHARS, DE_KP_MAX_OTHERS } from "../case-run";

export const KP_PART_IDS = { talk: "talk", findings: "findings", diff: "diff", report: "report", examiner: "examiner" } as const;

export const KP_MAX_TURNS = 40;
export const KP_MAX_FOLLOWUPS = 8;

/**
 * Opened Land sheets (SOURCES-CHECKED.md 4 and 5, PLAN.md "Verified facts", D-17). Only these
 * Länder get a cited time; every other Land, and no Land chosen, runs on "Ihre Übungszeit".
 * The federal ÄApprO § 37 sets no time for the talk or the Bericht, so no budget is "all".
 */
const NI_SHEET = {
  ref: "NiZzA Informationsblatt Kenntnisprüfung (Ärztin/Arzt), Stand 01.01.2026: Patientenvorstellung \"insgesamt etwa 60 Minuten\"",
  url: "https://www.nizza.niedersachsen.de/download/224581/Aerztin_Arzt_Informationsblatt_Kenntnispruefung.pdf",
} as const;
const NW_PAGE = {
  ref: "Ärztekammer Westfalen-Lippe, Kenntnisprüfung (Webseite, kein Stand angegeben): 30 Minuten Anamnese und Untersuchung, 30 Minuten Bericht",
  url: "https://www.aekwl.de/fuer-aerzte/weitere-themen/kenntnispruefung/",
} as const;

export const KP_SIM_PROFILE: SimProfile = {
  key: DE_KP_EXAM_KEY,
  surface: "de",
  language: "de",
  uiLanguages: ["de", "en", "ar"],
  parts: [
    { kind: "patient_talk", id: KP_PART_IDS.talk, rubric: "history_checklist", maxTurns: KP_MAX_TURNS, marking: "ai", totalWeight: 1, maxCharsPerSlot: KP_MAX_TURNS * DE_KP_LINE_MAX_CHARS, languageReview: false },
    { kind: "findings", id: KP_PART_IDS.findings, marking: "none", totalWeight: 0, maxCharsPerSlot: 1, languageReview: false },
    { kind: "short_answers", id: KP_PART_IDS.diff, rubric: "differentials", maxItems: 1 + DE_KP_MAX_OTHERS, marking: "ai", totalWeight: 1, maxCharsPerSlot: DE_KP_MAX_OTHERS * DE_KP_LINE_MAX_CHARS, languageReview: false },
    { kind: "written_report", id: KP_PART_IDS.report, rubric: "report_rubric", document: "bericht", sections: BERICHT_SECTIONS, marking: "ai", totalWeight: 1, maxCharsPerSlot: DE_KP_BERICHT_MAX_CHARS, languageReview: false },
    { kind: "examiner_round", id: KP_PART_IDS.examiner, rubric: "followups", maxItems: KP_MAX_FOLLOWUPS, maxBoundedPerItem: 1, marking: "ai", totalWeight: 1, maxCharsPerSlot: 3 * DE_KP_LINE_MAX_CHARS, languageReview: false },
  ],
  timing: {
    mode: "learner_clock",
    cited: [
      // Niedersachsen: one budget over history, examination and Bericht, "etwa" 60 minutes.
      { partIds: [KP_PART_IDS.talk, KP_PART_IDS.findings, KP_PART_IDS.report], maxSeconds: 60 * 60, approximate: true, land: "NI", source: NI_SHEET },
      // Nordrhein-Westfalen (ÄKWL): 30 minutes history and examination, then 30 minutes Bericht.
      { partIds: [KP_PART_IDS.talk, KP_PART_IDS.findings], maxSeconds: 30 * 60, land: "NW", source: NW_PAGE },
      { partIds: [KP_PART_IDS.report], maxSeconds: 30 * 60, land: "NW", source: NW_PAGE },
    ],
  },
  access: {
    freeCase: { aiFullSimulations: 1 },
    paid: { aiFullSimulationsPerWindow: 20, windowDays: 30, aiPracticeParts: "unlimited" },
    fallbackMarking: "self",
  },
  honestyCopyKey: "honesty",
};
