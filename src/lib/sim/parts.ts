/**
 * Part kinds of the simulation core (PLAN.md 2.2). A session is an ordered list
 * of parts; each part kind has one engine (built in S4 to S6, F3) and one rubric
 * shape. Pure data and types: no React, no fetch, no env.
 */

export const PART_KINDS = [
  "patient_talk", // learner questions a simulated patient (S4)
  "findings", // learner reads findings; nothing to mark
  "short_answers", // differentials or short items
  "written_report", // sectioned text: KP Bericht now, FSP Arztbrief later (F3)
  "examiner_round", // examiner chat over reviewed follow-ups (S6)
  "presentation", // FSP handover to a colleague (F3); typed now, no profile uses it yet
] as const;
export type PartKind = (typeof PART_KINDS)[number];

/**
 * How a part is marked. In every mode that marks, the learner's self-mark is final:
 * "ai" means an AI suggestion (S5) is shown first and the learner confirms or overrides it.
 */
export const MARKING_MODES = ["ai", "self", "none"] as const;
export type MarkingMode = (typeof MARKING_MODES)[number];

/** Documents a written_report part can be. "arztbrief" is room for the FSP letter (F3). */
export const REPORT_DOCUMENTS = ["bericht", "arztbrief"] as const;
export type ReportDocument = (typeof REPORT_DOCUMENTS)[number];

/** Slot keys name a piece of learner text inside a part (a report section, a follow-up, the talk). */
export const SLOT_RE = /^[a-z0-9_]{1,40}$/;
/** Part ids are stable data keys inside a profile ("talk", "report"). */
export const PART_ID_RE = /^[a-z][a-z0-9_]{0,23}$/;

/** The learner text slot of a patient talk: every learner question, one per line. */
export const TALK_SLOT = "transcript";

interface PartBase {
  /** Stable id inside the profile; stored in sessions, never renamed. */
  id: string;
  marking: MarkingMode;
  /** Weight of this part in the session total (parts with marking "none" never count). */
  totalWeight: number;
  /** Max characters stored per slot (the cap for autosave). */
  maxCharsPerSlot: number;
  /** F2 attaches a language review to a free-text part; it never changes medical marks. */
  languageReview: boolean;
}

export interface PatientTalkPart extends PartBase {
  kind: "patient_talk";
  rubric: "history_checklist";
  /** Learner turns allowed; turn maxTurns + 1 is refused (TALK_LIMIT). */
  maxTurns: number;
}

export interface FindingsPart extends PartBase {
  kind: "findings";
  marking: "none";
}

export interface ShortAnswersPart extends PartBase {
  kind: "short_answers";
  rubric: "differentials";
  /** Most short answers the learner may type. */
  maxItems: number;
}

export interface WrittenReportPart extends PartBase {
  kind: "written_report";
  rubric: "report_rubric";
  document: ReportDocument;
  /** Section slots in display order. */
  sections: readonly string[];
}

export interface ExaminerRoundPart extends PartBase {
  kind: "examiner_round";
  rubric: "followups";
  /** Most reviewed follow-ups asked. */
  maxItems: number;
  /** Bounded extra questions per item, drawn from examiner_notes (S6). The plan sets 1. */
  maxBoundedPerItem: number;
}

export interface PresentationPart extends PartBase {
  kind: "presentation";
  rubric: "presentation";
  minColleagueQuestions: number;
  maxColleagueQuestions: number;
}

export type PartConfig =
  | PatientTalkPart
  | FindingsPart
  | ShortAnswersPart
  | WrittenReportPart
  | ExaminerRoundPart
  | PresentationPart;

/**
 * Parts where the learner writes free text. Their part score is 0 when the
 * learner wrote nothing or one word (PLAN.md 4). Short answers are excluded: a
 * one-word diagnosis is a real answer.
 */
export function isFreeTextKind(kind: PartKind): boolean {
  switch (kind) {
    case "patient_talk":
    case "written_report":
    case "examiner_round":
    case "presentation":
      return true;
    case "short_answers":
    case "findings":
      return false;
    default:
      return assertNever(kind);
  }
}

export function isScored(part: Pick<PartConfig, "marking">): boolean {
  return part.marking !== "none";
}

export function assertNever(x: never): never {
  throw new Error(`unexpected value: ${String(x)}`);
}
