import type { FreeEmptyKind } from "@/lib/i18n-free-set";
import { dualLang } from "./lang";

/** Rolls per quiz session; a free sample is 150 questions, so this never loops. */
export const MAX_TOPIC_ROLLS = 5;

/**
 * a-first-five-1104: when a free learner's single chosen topic has run out of
 * free questions ("all_seen"), the next topic that still has free ones, else
 * null (the honest empty state stays, with the Vienna sitting line where it
 * applies). The server already lists topics with free questions left, most
 * first, never the requested one.
 */
export function nextRollTopic(
  empty: { reason: FreeEmptyKind; topics: ReadonlyArray<{ topic: string; left: number }> },
  currentTopics: readonly string[],
  rollsSoFar: number,
): string | null {
  if (empty.reason !== "all_seen" || currentTopics.length !== 1 || rollsSoFar >= MAX_TOPIC_ROLLS) return null;
  const next = empty.topics.find((t) => t.left > 0 && t.topic !== currentTopics[0]);
  return next ? next.topic : null;
}

export function topicRollLine(from: string, to: string, lang: string): string {
  return {
    de: `Die freien Fragen zu ${from} sind durch. Weiter mit ${to}.`,
    en: `You have finished the free questions on ${from}. Continuing with ${to}.`,
  }[dualLang(lang)];
}
