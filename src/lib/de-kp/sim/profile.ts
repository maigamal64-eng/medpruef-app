/**
 * The Kenntnisprüfung simulation profile (PLAN.md 2.2, 2.3). It lives on the
 * Germany surface, not in src/lib/sim/profiles, because the boundary test keeps
 * the exam key and every Germany import inside the Germany paths; the core stays
 * exam-agnostic and imports nothing from here.
 */
import type { SimProfile } from "@/lib/sim";
import { DE_KP_EXAM_KEY } from "../index";
import { BERICHT_SECTIONS, DE_KP_BERICHT_MAX_CHARS, DE_KP_LINE_MAX_CHARS, DE_KP_MAX_OTHERS } from "../case-run";
import { DE_KP_LAW_URL } from "../copy";

export const KP_PART_IDS = { talk: "talk", findings: "findings", diff: "diff", report: "report", examiner: "examiner" } as const;

export const KP_MAX_TURNS = 40;
export const KP_MAX_FOLLOWUPS = 8;

/** The federal rule (ÄApprO § 37 as in force since 1 November 2026), the same text the landing cites. */
const LAW = { ref: "ÄApprO § 37, Fassung seit 1. November 2026", url: DE_KP_LAW_URL } as const;

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
      // "Anamnese und Untersuchung (höchstens 20 Minuten), danach ein schriftlicher Bericht (höchstens 30 Minuten)."
      { partIds: [KP_PART_IDS.talk, KP_PART_IDS.findings], maxSeconds: 20 * 60, land: "all", source: LAW },
      { partIds: [KP_PART_IDS.report], maxSeconds: 30 * 60, land: "all", source: LAW },
    ],
  },
  access: {
    freeCase: { aiFullSimulations: 1 },
    paid: { aiFullSimulationsPerWindow: 20, windowDays: 30, aiPracticeParts: "unlimited" },
    fallbackMarking: "self",
  },
  honestyCopyKey: "honesty",
};
