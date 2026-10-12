/**
 * Pure exam engine contracts (b34-exam-pure). No UI, no Supabase, no React.
 *
 * Two shapes owned by sibling packages are mirrored here structurally so this
 * folder compiles on the base without their files:
 * - SittingDurationRecord is the subset of SittingFormat in src/lib/exam-formats.ts
 *   (b07) that duration resolution reads. Pass EXAM_FORMAT_DATA.sittings directly.
 * - SPT_FIELD_BLUEPRINT mirrors STP_FIELDS in src/lib/stp-fields.ts (b21). A unit
 *   test pins both to the Merkblatt counts; track-A swaps the copy for the import
 *   once both branches are merged.
 */

export type ExamLanguage = "de" | "en";
export type FactStatus = "official" | "reported" | "not_confirmed";

/** Mirror of b07 SittingFormat (fields read here only). */
export interface SittingDurationRecord {
  examKey: string;
  date: string;
  status: FactStatus;
  sourceId: string;
  durationMin?: number;
}

/** One blueprint line. `topic` matches questions.topic exactly; `fieldTag` selects by tag instead. */
export interface BlueprintEntry {
  topic: string;
  count: number;
  fieldTag?: string;
}

/** Bank row shape the pure engine needs. Option order is the order shown to the learner. */
export interface GradableQuestion {
  id: number | string;
  topic: string;
  options?: { text: string; correct: boolean }[];
  /** Open-answer (KAF) rows: every accepted wording of each required answer. */
  acceptedAnswers?: string[][];
}

export const SPT_FIELD_SOURCE = {
  url: "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/pdf/Merkblatt_Nostri_Human_VS_1._9._2026-1.pdf",
  label: "MedUni Wien, Merkblatt Nostrifizierung Humanmedizin",
  edition: "1 September 2026, page 7",
  readOn: "2026-10-11",
  status: "official" as FactStatus,
};

/** The ten official Stichprobentest fields and their question counts (sum 250). */
export const SPT_FIELD_BLUEPRINT: readonly { key: string; label: Record<ExamLanguage, string>; count: number }[] = [
  { key: "innere_medizin", label: { de: "Innere Medizin", en: "Internal medicine" }, count: 30 },
  { key: "chirurgie", label: { de: "Chirurgie", en: "Surgery" }, count: 30 },
  { key: "kinderheilkunde", label: { de: "Kinderheilkunde", en: "Paediatrics" }, count: 30 },
  { key: "neurologie", label: { de: "Neurologie", en: "Neurology" }, count: 25 },
  { key: "gynaekologie", label: { de: "Gynäkologie", en: "Gynaecology" }, count: 25 },
  { key: "dermatologie", label: { de: "Dermatologie", en: "Dermatology" }, count: 25 },
  { key: "notfallmedizin", label: { de: "Notfallmedizin", en: "Emergency medicine" }, count: 25 },
  { key: "hno", label: { de: "Hals-Nasen-Ohrenheilkunde", en: "ENT" }, count: 20 },
  { key: "psychiatrie", label: { de: "Psychiatrie", en: "Psychiatry" }, count: 20 },
  { key: "augenheilkunde", label: { de: "Augenheilkunde", en: "Ophthalmology" }, count: 20 },
];
