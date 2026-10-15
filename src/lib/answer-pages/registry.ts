import raw from "./pages.data.json";
import { answerPagesEnabled } from "./flag";
import type { AnswerCondition, AnswerFaq, AnswerPage, AnswerPagesData } from "./types";
import { mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { referralMentorCreditsOffered } from "@/lib/referral-mentor-credits";

export const ANSWER_DATA = raw as AnswerPagesData;
export const ANSWER_PAGES: readonly AnswerPage[] = ANSWER_DATA.pages;
export const ANSWER_BASE_PATH = "/blog";

type Env = Record<string, string | undefined>;

/** Whether a page or FAQ condition holds under this environment. */
export function conditionHolds(condition: AnswerCondition, env: Env = process.env): boolean {
  if (condition === "mentor_public_copy") return mentorPublicCopyEnabled(env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY);
  if (condition === "referral_mentor_credits") return referralMentorCreditsOffered(env) !== null;
  return false;
}

/** Pages a visitor may open now: the master flag plus each page's own conditions. */
export function visibleAnswerPages(env: Env = process.env): AnswerPage[] {
  if (!answerPagesEnabled(env.ANSWER_PAGES_ENABLED)) return [];
  return ANSWER_PAGES.filter((page) => (page.requires ?? []).every((c) => conditionHolds(c, env)));
}

export function findVisibleAnswerPage(slug: string, env: Env = process.env): AnswerPage | null {
  return visibleAnswerPages(env).find((page) => page.slug === slug) ?? null;
}

export function isAnswerSlug(slug: string): boolean {
  return ANSWER_PAGES.some((page) => page.slug === slug);
}

/** FAQ entries whose conditions hold (text entries may depend on a live programme). */
export function visibleFaq(page: AnswerPage, env: Env = process.env): AnswerFaq[] {
  return page.faq.filter((item) => item.kind !== "text" || !item.when || conditionHolds(item.when, env));
}

export function answerPath(page: Pick<AnswerPage, "slug">, lang: "de" | "en" = "de"): string {
  return `${ANSWER_BASE_PATH}/${page.slug}${lang === "en" ? "?lang=en" : ""}`;
}

/** Fill code-owned values into copy. Unknown placeholders stay visible so a test catches them. */
export function fillPlaceholders(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
