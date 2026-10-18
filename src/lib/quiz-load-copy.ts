/**
 * a-quiz-load-failed-honest: the quiz load-error box (Lektor APPROVE,
 * reports/backlog-out/a-learner-watch/lektor.md item 3, copy 3).
 *
 * Behind NEXT_PUBLIC_QUIZ_LOAD_HONEST (client, build time, default OFF; only
 * the literal "true"). Off = the error box renders exactly as before. The pack
 * button also needs NEXT_PUBLIC_QUIZ_PACK_FALLBACK=true: pack questions carry
 * the answer key of their download date, and a-fo-08 serves them online only
 * once the stale-key guard (ANSWER_KEY_GUARD=enforce) has held.
 * German uses Sie; every other language falls back to English (i18n keys qlh_*).
 */
import { t, type Lang } from "./i18n";

export function quizLoadHonestEnabled(env?: Record<string, string | undefined>): boolean {
  if (env) return env.NEXT_PUBLIC_QUIZ_LOAD_HONEST === "true";
  return process.env.NEXT_PUBLIC_QUIZ_LOAD_HONEST === "true";
}

const KEYS = { error: "qlh_load_error", use_pack: "qlh_use_pack" } as const;

export type QuizLoadCopyKey = keyof typeof KEYS;

export function quizLoadCopy(key: QuizLoadCopyKey, lang: Lang): string {
  return t(KEYS[key], lang);
}

/** The offline-pack button shows only for Pro with a stored pack that can serve this selection. */
export function showUsePackButton(input: {
  enabled: boolean;
  audience: string;
  storedCount: number | null;
  mode: string;
  filter?: string | null;
}): boolean {
  if (!input.enabled || input.audience !== "pro") return false;
  if (input.mode === "wrong" || input.mode === "review" || input.filter === "unused") return false;
  return (input.storedCount ?? 0) > 0;
}
