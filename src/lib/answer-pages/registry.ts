import raw from "./pages.data.json";
import articlesRaw from "./pages.articles.json";
import { answerPagesEnabled } from "./flag";
import type { AnswerCondition, AnswerFaq, AnswerLang, AnswerPage, AnswerPagesData } from "./types";
import { mentorIncludedCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { referralMentorCreditsOffered } from "@/lib/referral-mentor-credits";

// The guides (a-seo-articles-1019) live in their own file so answer-page batches
// and guide batches append without touching each other; one registry serves both.
const answers = raw as AnswerPagesData;
const articles = articlesRaw as AnswerPagesData;
export const ANSWER_DATA: AnswerPagesData = {
  schemaVersion: 1,
  sources: { ...answers.sources, ...articles.sources },
  pages: [...answers.pages, ...articles.pages],
};
export const ANSWER_PAGES: readonly AnswerPage[] = ANSWER_DATA.pages;
export const ANSWER_BASE_PATH = "/blog";

type Env = Record<string, string | undefined>;

/** Whether a page or FAQ condition holds under this environment. */
export function conditionHolds(condition: AnswerCondition, env: Env = process.env): boolean {
  if (condition === "mentor_public_copy") return mentorPublicCopyEnabled(env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY);
  if (condition === "mentor_included_copy") return mentorIncludedCopyEnabled(env.NEXT_PUBLIC_MENTOR_INCLUDED_COPY, env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY);
  if (condition === "referral_mentor_credits") return referralMentorCreditsOffered(env) !== null;
  if (condition === "reverse_trial_copy") return env.NEXT_PUBLIC_REVERSE_TRIAL === "true";
  return false;
}

/** Pages a visitor may open now: the master flag plus each page's own conditions. */
export function visibleAnswerPages(env: Env = process.env): AnswerPage[] {
  if (!answerPagesEnabled(env.ANSWER_PAGES_ENABLED)) return [];
  return ANSWER_PAGES.filter((page) => (page.requires ?? []).every((c) => conditionHolds(c, env)));
}

/** Visible long-form guides, in data order (the /landing guide list and the blog index). */
export function visibleArticlePages(env: Env = process.env): AnswerPage[] {
  return visibleAnswerPages(env).filter((page) => page.article);
}

/** A visible page by its German slug or its English slug (a-seo-articles-en-1019). */
export function findVisibleAnswerPage(slug: string, env: Env = process.env): AnswerPage | null {
  return visibleAnswerPages(env).find((page) => page.slug === slug || page.en_slug === slug) ?? null;
}

export function isAnswerSlug(slug: string): boolean {
  return ANSWER_PAGES.some((page) => page.slug === slug || page.en_slug === slug);
}

/** FAQ entries whose conditions hold (text entries may depend on a live programme). */
export function visibleFaq(page: AnswerPage, env: Env = process.env): AnswerFaq[] {
  return page.faq.filter((item) => item.kind !== "text" || !item.when || conditionHolds(item.when, env));
}

/** Whether a language-only section or FAQ item shows in `lang`. */
export function shownIn(item: { only?: AnswerLang }, lang: AnswerLang): boolean {
  return !item.only || item.only === lang;
}

/** The page's URL in `lang`: its English slug when it has one, else ?lang=en. */
export function answerPath(page: Pick<AnswerPage, "slug" | "en_slug">, lang: AnswerLang = "de"): string {
  if (lang === "en" && page.en_slug) return `${ANSWER_BASE_PATH}/${page.en_slug}`;
  return `${ANSWER_BASE_PATH}/${page.slug}${lang === "en" ? "?lang=en" : ""}`;
}

/**
 * A link written in the copy as /blog/<german slug>, pointed at that page's URL in
 * `lang` so English pages link English pages without a redirect hop. Other hrefs
 * come back unchanged.
 */
export function localAnswerHref(href: string, lang: AnswerLang): string {
  const match = /^\/blog\/([^/?#]+)$/.exec(href);
  const page = match ? ANSWER_PAGES.find((p) => p.slug === match[1]) : undefined;
  return page ? answerPath(page, lang) : href;
}

/** Fill code-owned values into copy. Unknown placeholders stay visible so a test catches them. */
export function fillPlaceholders(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
