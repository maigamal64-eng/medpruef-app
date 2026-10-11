/** Official Austrian Stichprobentest fields, not the bank's legacy topic labels. */
export const STP_FIELD_SOURCE = {
  url: "https://www.meduniwien.ac.at/web/fileadmin/content/serviceeinrichtungen/studienabteilung/studium/nostrifikation/pdf/Merkblatt_Nostri_Human_VS_1._9._2026-1.pdf",
  label: "MedUni Wien, Merkblatt Nostrifizierung Humanmedizin",
  edition: "1 September 2026, page 7",
  readOn: "2026-10-11",
  status: "official",
} as const;

export const STP_FIELDS = [
  { key: "innere_medizin", label: { de: "Innere Medizin", en: "Internal medicine" }, questionCount: 30 },
  { key: "chirurgie", label: { de: "Chirurgie", en: "Surgery" }, questionCount: 30 },
  { key: "kinderheilkunde", label: { de: "Kinderheilkunde", en: "Paediatrics" }, questionCount: 30 },
  { key: "neurologie", label: { de: "Neurologie", en: "Neurology" }, questionCount: 25 },
  { key: "gynaekologie", label: { de: "Gynäkologie", en: "Gynaecology" }, questionCount: 25 },
  { key: "dermatologie", label: { de: "Dermatologie", en: "Dermatology" }, questionCount: 25 },
  { key: "notfallmedizin", label: { de: "Notfallmedizin", en: "Emergency medicine" }, questionCount: 25 },
  { key: "hno", label: { de: "Hals-Nasen-Ohrenheilkunde", en: "ENT" }, questionCount: 20 },
  { key: "psychiatrie", label: { de: "Psychiatrie", en: "Psychiatry" }, questionCount: 20 },
  { key: "augenheilkunde", label: { de: "Augenheilkunde", en: "Ophthalmology" }, questionCount: 20 },
] as const;

export type StpFieldKey = (typeof STP_FIELDS)[number]["key"];
export type StpFieldTag = `field:${StpFieldKey}`;
export const STP_TOTAL_QUESTIONS = STP_FIELDS.reduce((sum, field) => sum + field.questionCount, 0);
export const STP_FIELD_PASS_PERCENT = 60;
export const STP_POSITIVE_FIELD_COUNT = 6;

export function isStpFieldKey(value: string): value is StpFieldKey {
  return STP_FIELDS.some((field) => field.key === value);
}

export function stpFieldTag(key: StpFieldKey): StpFieldTag {
  return `field:${key}`;
}

function normalizeTopic(topic: string): string {
  return topic.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-AT");
}

const TOPIC_FIELDS: Readonly<Record<string, StpFieldKey>> = {
  "innere medizin": "innere_medizin",
  "allgemeine chirurgie": "chirurgie",
  "chirurgie": "chirurgie",
  "kinder und jugendheilkunde": "kinderheilkunde",
  "kinder- und jugendheilkunde": "kinderheilkunde",
  "kinderheilkunde": "kinderheilkunde",
  "neurologie": "neurologie",
  "frauenheilkunde/gynäkologie": "gynaekologie",
  "gynäkologie": "gynaekologie",
  "dermatologie und venerologie": "dermatologie",
  "dermatologie": "dermatologie",
  "hals-nasen-ohrenheilkunde": "hno",
  "psychiatrie": "psychiatrie",
  "augenheilkunde": "augenheilkunde",
  // The official curriculum groups emergency and intensive medicine together (page 6).
  "intensivmedizin": "notfallmedizin",
  "notfall- und intensivmedizin": "notfallmedizin",
  "notfallmedizin": "notfallmedizin",
  // Psychiatric disorders remain psychiatry, including in children and adolescents.
  "kinder und jugendpsychiatrie": "psychiatrie",
  "kinder- und jugendpsychiatrie": "psychiatrie",
};

/** Mixed surgical/anaesthesia and unknown topics require a reviewed row decision. */
export function stpFieldForTopic(topic: string): StpFieldKey | null {
  const normalized = normalizeTopic(topic);
  return Object.hasOwn(TOPIC_FIELDS, normalized) ? TOPIC_FIELDS[normalized] : null;
}

export function requiresStpRowReview(topic: string): boolean {
  return normalizeTopic(topic) === "chirurgische spezialfächer und anästhesie";
}
