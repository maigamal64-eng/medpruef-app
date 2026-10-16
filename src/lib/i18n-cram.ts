/**
 * Strings for the Home cram card (a-cram-card). Source: the Lektor-gated kits
 * reports/backlog-out/a-cramstart-copy/home-cram-card.json (M4, SIP) and
 * reports/backlog-out/a-rezgm-cram-kit/cram-card-copy.json (Rez/GM), with the
 * edits of their lektor-verdict.json applied. A unit test pins every kit line
 * byte for byte. Same shape as i18n-dates.ts: DE and EN authored, every other
 * language falls back to EN, Arabic ships empty until [name] signs it off.
 *
 * Nothing here states a date or a price. {sittingLabel}, {sittingDate},
 * {daysLeft}, {weekRange}, {balance} and {expiryDate} are filled at render
 * time from OFFICIAL_SITTINGS and the learner's own wallet.
 *
 * Lines the kits still hold (plan_* focus lines waiting for two Visite reads,
 * the 7-day plan page text, cram_m4_trial_note, cram_m4_cta_weak) are NOT here.
 */

const DE = {
  // SIP4a / SIP5a, named sitting
  m4_title: "Noch {daysLeft} Tage bis {sittingLabel}",
  m4_title_one: "Noch 1 Tag bis {sittingLabel}",
  m4_body: "Termin: {sittingDate}. Falls Sie angemeldet sind, zählt jetzt das Üben unter Zeitlimit, mit Erklärungen in Ihrer Sprache.",
  // SIP, bank only (no saved sitting): no named sitting, no countdown
  m4_title_bank: "Wiederholungsphase vor den SIP-Terminen",
  m4_body_bank: "Falls Sie für SIP angemeldet sind, zählt jetzt das Üben unter Zeitlimit, mit Erklärungen in Ihrer Sprache.",
  m4_how: "Starten Sie eine Prüfungssimulation mit Zeitlimit und wiederholen Sie danach Ihre schwächsten Fächer. Ihr Fortschritt bleibt gespeichert.",
  m4_format: "Ob die MedUni Wien Multiple Choice oder KAF vorsieht, legt sie laut Ausschreibung spätestens drei Wochen vor dem Termin fest. Bitte lesen Sie es dort nach.",
  m4_cta_primary: "Prüfungssimulation starten",
  m4_plan: "Welcher Plan zu Ihrem Termin passt, rechnet die Preisseite für Sie aus.",
  m4_plan_cta: "Plan zu meinem Termin ansehen",
  m4_credits: "Ihre Credits für den KI-Mentor: {balance}, gültig bis {expiryDate}.",
  // Rez/GM exam week
  rezgm_a_title: "Rezeptierkunde: Ihre Vorbereitungswoche",
  rezgm_a_body: "Falls Sie für die Prüfungswoche der MedUni Wien angemeldet sind ({weekRange}): In 7 Tagen, je ein Themenblock pro Tag, üben Sie die Fragen der Bank Pharmakologie / Rezeptierkunde.",
  rezgm_a_how: "Antworten Sie zuerst selbst und vergleichen Sie dann mit der hinterlegten Antwort. Ihr Fortschritt bleibt gespeichert.",
  rezgm_a_countdown: "Noch {daysLeft} Tage bis zur Prüfungswoche.",
  rezgm_a_countdown_one: "Noch 1 Tag bis zur Prüfungswoche.",
  rezgm_b_title: "Rezeptierkunde und Gerichtsmedizin: Ihre Vorbereitungswoche",
  // Lektor 15 Oct (a-cram-card): the kit line promises the 7-day plan page, which is not built; restore the kit wording when it ships and Lektor re-gates it.
  rezgm_b_body: "Falls Sie für die Prüfungswoche der MedUni Wien angemeldet sind ({weekRange}): Üben Sie Rezeptierkunde und Gerichtsmedizin in eigenen Übungsblöcken.",
  rezgm_b_gmnote: "Die Gerichtsmedizin-Fragen sind von MedPrüf verfasste Übungsfragen, keine echten Prüfungsfragen. Die offiziellen Seiten der MedUni Wien beschreiben das Prüfungsformat nicht.",
  rezgm_dismiss: "Ausblenden",
  rezgm_official: "Offizielle Informationen der MedUni Wien",
  // New in a-cram-card (Lektor gate in the handover): naming the part.
  part_prompt: "Für welchen Termin lernen Sie?",
  part_option: "{sittingLabel}, {sittingDate}",
  part_saved: "Gespeichert: {sittingLabel}.",
  part_failed: "Das hat nicht geklappt. Bitte versuchen Sie es erneut.",
  region: "Ihre Vorbereitung",
} as const;

export type CramKey = keyof typeof DE;

const EN: Record<CramKey, string> = {
  m4_title: "{daysLeft} days to {sittingLabel}",
  m4_title_one: "1 day to {sittingLabel}",
  m4_body: "Sitting: {sittingDate}. If you are registered, now is the time to practise against the clock, with explanations in your language.",
  m4_title_bank: "Review phase before the SIP sittings",
  m4_body_bank: "If you are registered for SIP, now is the time to practise against the clock, with explanations in your language.",
  m4_how: "Start a timed practice run, then repeat your weakest subjects. Your progress stays saved.",
  m4_format: "MedUni Wien fixes whether it uses multiple choice or KAF in the Ausschreibung at least three weeks before the sitting. Please check it there.",
  m4_cta_primary: "Start a timed practice run",
  m4_plan: "The pricing page works out which plan fits your sitting.",
  m4_plan_cta: "See the plan for my sitting",
  m4_credits: "Your AI Mentor credits: {balance}, valid until {expiryDate}.",
  rezgm_a_title: "Rezeptierkunde: your preparation week",
  rezgm_a_body: "If you are registered for the MedUni Wien exam week ({weekRange}): in seven days, one topic block a day, you practise the Pharmakologie / Rezeptierkunde bank.",
  rezgm_a_how: "Answer yourself first, then compare with the stored answer. Your progress stays saved.",
  rezgm_a_countdown: "{daysLeft} days to the exam week.",
  rezgm_a_countdown_one: "1 day to the exam week.",
  rezgm_b_title: "Rezeptierkunde and Gerichtsmedizin: your preparation week",
  rezgm_b_body: "If you are registered for the MedUni Wien exam week ({weekRange}): practise Rezeptierkunde and Gerichtsmedizin in separate practice blocks.",
  rezgm_b_gmnote: "The Gerichtsmedizin questions are practice questions written by MedPrüf, not real exam questions. The official MedUni Wien pages do not describe the exam format.",
  rezgm_dismiss: "Hide",
  rezgm_official: "Official MedUni Wien information",
  part_prompt: "Which sitting are you studying for?",
  part_option: "{sittingLabel}, {sittingDate}",
  part_saved: "Saved: {sittingLabel}.",
  part_failed: "That did not work. Please try again.",
  region: "Your preparation",
};

/** Arabic ships empty (English fallback) until [name] signs off. */
const AR: Partial<Record<CramKey, string>> = {};
const OVERLAYS: Record<string, Partial<Record<CramKey, string>>> = { ar: AR };

export const CRAM_KEYS = Object.keys(DE) as CramKey[];
export const CRAM_DE: Readonly<Record<CramKey, string>> = DE;
export const CRAM_EN: Readonly<Record<CramKey, string>> = EN;

export function tc(key: CramKey, lang: string = "de", vars: Record<string, string | number> = {}): string {
  const raw = lang === "de" ? DE[key] : lang === "en" ? EN[key] : OVERLAYS[lang]?.[key] || EN[key];
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
