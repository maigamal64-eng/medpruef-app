/**
 * Learner copy for the free question set (a-free-set, 2026-10-12): the honest
 * empty state when a free learner picks a topic without free questions, the
 * "free questions left" line on topic cards, and the plan prompt after the
 * first round. Own dictionary so the shared src/lib/i18n.ts stays untouched.
 *
 * de and en are authored. Every other account language reads English until a
 * native review exists (Arabic additionally needs [name]'s sign-off). German
 * uses formal Sie. No em dashes; a unit test enforces both rules.
 */
import type { Lang } from "@/lib/i18n";

export interface FreeSetCopy {
  /** {topic} has no question in the free set. */
  noFreeTitle: string;
  noFreeBody: string;
  /** The learner answered every free question of {topic}. */
  allSeenTitle: string;
  allSeenBody: string;
  /** Any other empty free selection (several topics, filters, a linked question). */
  otherTitle: string;
  otherBody: string;
  suggestionsLabel: string;
  leftOne: string;
  leftMany: string;
  /** Topic card: no free question left in this topic. */
  cardProOnly: string;
  proLink: string;
  backHome: string;
  planTitle: string;
  planBody: string;
  planLater: string;
}

const DE: FreeSetCopy = {
  noFreeTitle: "{topic} ist Teil von Pro.",
  noFreeBody: "In diesem Fachgebiet gibt es keine kostenlosen Fragen. Ihre kostenlosen Fragen verteilen sich auf andere Fachgebiete.",
  allSeenTitle: "Sie haben alle kostenlosen Fragen in {topic} beantwortet.",
  allSeenBody: "Weitere Fragen in diesem Fachgebiet sind Teil von Pro.",
  otherTitle: "Diese Auswahl ist Teil von Pro.",
  otherBody: "Für diese Auswahl gibt es keine kostenlosen Fragen mehr.",
  suggestionsLabel: "Kostenlose Fragen gibt es noch in:",
  leftOne: "1 kostenlose Frage übrig",
  leftMany: "{n} kostenlose Fragen übrig",
  cardProOnly: "Teil von Pro",
  proLink: "Pro ansehen",
  backHome: "Zur Startseite",
  planTitle: "Planen Sie Ihre Vorbereitung",
  planBody: "Mit Prüfungstermin und Tagesziel erstellen wir Ihren Lernplan. Sie können beides jederzeit in den Einstellungen ändern.",
  planLater: "Später",
};

const EN: FreeSetCopy = {
  noFreeTitle: "{topic} is part of Pro.",
  noFreeBody: "This subject has no free questions. Your free questions are spread across other subjects.",
  allSeenTitle: "You have answered all free questions in {topic}.",
  allSeenBody: "More questions in this subject are part of Pro.",
  otherTitle: "This selection is part of Pro.",
  otherBody: "There are no free questions left for this selection.",
  suggestionsLabel: "Free questions are still available in:",
  leftOne: "1 free question left",
  leftMany: "{n} free questions left",
  cardProOnly: "Part of Pro",
  proLink: "See Pro",
  backHome: "Back to Home",
  planTitle: "Plan your preparation",
  planBody: "With your exam date and daily goal we build your study plan. You can change both at any time in Settings.",
  planLater: "Later",
};

export const FREE_SET_COPY = { de: DE, en: EN } as const;

/** German for German, English for every other language (reviewed fallback). */
export function freeSetCopy(lang: Lang | string): FreeSetCopy {
  return lang === "de" ? DE : EN;
}

/** "1 kostenlose Frage übrig" / "{n} kostenlose Fragen übrig". */
export function freeLeftLine(copy: FreeSetCopy, n: number): string {
  return n === 1 ? copy.leftOne : copy.leftMany.replace("{n}", String(n));
}

export type FreeEmptyKind = "no_free_in_topic" | "all_seen" | "other";

/** Title and body for an empty free selection. */
export function freeEmptyText(copy: FreeSetCopy, kind: FreeEmptyKind, topic: string | null): { title: string; body: string } {
  if (kind === "no_free_in_topic" && topic) return { title: copy.noFreeTitle.replace("{topic}", topic), body: copy.noFreeBody };
  if (kind === "all_seen" && topic) return { title: copy.allSeenTitle.replace("{topic}", topic), body: copy.allSeenBody };
  return { title: copy.otherTitle, body: copy.otherBody };
}
