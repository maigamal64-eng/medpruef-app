/**
 * a43 pharma cutover (pick-pharma-conversion A, CNT-21, SIM-05).
 *
 * Pharmacology practice moves to the Vienna Rezeptierkunde shape in place:
 * five options, exactly one best answer. Rows switch only when their reviewed
 * MC data is applied (track-B b26 SQL, two independent medical reads each), so
 * the bank is mixed while the conversion runs: converted rows render as
 * single-answer MC, the rest keep the open-answer renderer.
 *
 * The learner note is switched on in the same release train as the data
 * (NEXT_PUBLIC_PHARMA_MC_NOTE, default OFF; only the literal "true" enables it).
 * The simulation preset (rx_mc_30) needs no flag: it lights up from live counts.
 */
import { renderLang, type UiLanguage } from "./language-model";
import { safeStorage } from "./safe-storage";

export const PHARMA_EXAM_SOURCE = "pharma";

/** Build-time client flag; anything but the literal "true" keeps the note off. */
export function pharmaMcNoteEnabled(value: string | undefined = process.env.NEXT_PUBLIC_PHARMA_MC_NOTE): boolean {
  return value === "true";
}

/** Dismissal is per account on this device; v1 is the first announcement of the switch. */
export function pharmaMcNoteKey(userId: string): string {
  return `medpruef_pharma_mc_note_v1:${userId}`;
}

export function pharmaMcNoteDismissed(userId: string): boolean {
  return safeStorage.getItem(pharmaMcNoteKey(userId)) === "1";
}

export function dismissPharmaMcNote(userId: string): void {
  safeStorage.setItem(pharmaMcNoteKey(userId), "1");
}

/** Whether the note may show: flag on, pharmacology bank, signed-in non-guest account. */
export function shouldShowPharmaMcNote(input: { enabled: boolean; examSource: string; userId: string | null | undefined }): boolean {
  if (!input.enabled || input.examSource !== PHARMA_EXAM_SOURCE) return false;
  return !!input.userId && !input.userId.startsWith("guest_");
}

/**
 * Learner copy. German in Sie, English for every unreviewed language. Honest for
 * a partial conversion: converted questions show options, the others still ask
 * for an own answer. No em dashes, no claim of real exam questions.
 */
const STRINGS = {
  title: { de: "Pharmakologie: Fragen mit Antwortoptionen", en: "Pharmacology: questions with answer options" },
  body: {
    de: "Die Pharmakologie-Fragen werden schrittweise auf das Format der Wiener Rezeptierkunde-Prüfung umgestellt: fünf Antwortoptionen, genau eine ist die beste. Manche wurden dabei neu formuliert; noch nicht umgestellte Fragen fragen weiter nach Ihrer eigenen Antwort. Ihr Verlauf bleibt erhalten.",
    en: "Pharmacology questions are moving step by step to the format of the Vienna Rezeptierkunde exam: five answer options with exactly one best answer. Some were reworded; questions not yet converted still ask for your own answer. Your history is kept.",
  },
  offline: {
    de: "Offline gespeicherte Fragen laden Sie unter Einstellungen neu herunter.",
    en: "Download offline questions again under Settings.",
  },
  format_link: { de: "Zum Prüfungsformat", en: "About the exam format" },
  dismiss: { de: "Verstanden", en: "Got it" },
} as const;

export type PharmaMcKey = keyof typeof STRINGS;

/** Exposed for the copy guard test; never mutate. */
export const PHARMA_MC_STRINGS: Readonly<Record<PharmaMcKey, { readonly de: string; readonly en: string }>> = STRINGS;

function isUi(value: unknown): value is UiLanguage {
  return value === "de" || value === "en" || value === "ru" || value === "uk" || value === "tr" || value === "ar";
}

export function tpm(key: PharmaMcKey, lang: string | null | undefined): string {
  const rendered = isUi(lang) ? renderLang(lang) : "en";
  return STRINGS[key][rendered === "de" ? "de" : "en"];
}
